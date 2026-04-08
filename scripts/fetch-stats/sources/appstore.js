import jwt from 'jsonwebtoken';
import zlib from 'node:zlib';

// Default Apple ID -> internal slug map. These IDs come from the actual App
// Store links in apps.html. The ASC_APP_IDS env var can override this using
// the format "appleId:slug,appleId:slug,..." but it is optional.
const DEFAULT_APP_ID_MAP = {
  '6741807489': 'space_blaster',
  '6748090986': 'parallel_hearts',
  '6754912803': 'wishbone_snap',
  '6759918364': 'who_picked_who',
};

function parseAppIdMap(envValue) {
  if (!envValue) return { ...DEFAULT_APP_ID_MAP };
  const map = {};
  for (const entry of envValue.split(',').map(s => s.trim()).filter(Boolean)) {
    const [appleId, slug] = entry.split(':').map(s => s.trim());
    if (appleId && slug) map[appleId] = slug;
  }
  return map;
}

function buildJwt() {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const privateKey = process.env.ASC_PRIVATE_KEY;
  if (!keyId || !issuerId || !privateKey) {
    throw new Error('ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY must all be set');
  }
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: issuerId,
      iat: now,
      exp: now + 20 * 60, // 20 minutes
      aud: 'appstoreconnect-v1',
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: keyId, typ: 'JWT' },
    },
  );
}

async function fetchReport(token, vendor, date) {
  const params = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': vendor,
    'filter[reportDate]': date,
    'filter[version]': '1_0',
  });
  const url = `https://api.appstoreconnect.apple.com/v1/salesReports?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/a-gzip',
    },
  });

  if (resp.status === 404) {
    // Report not available yet for this date.
    console.warn(`[appstore] ${date} not available yet (404)`);
    return null;
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ASC ${resp.status} for ${date}: ${text.slice(0, 500)}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  // When the response is JSON (e.g. error), it won't be gzipped. Check magic.
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) {
    console.warn(`[appstore] ${date}: unexpected non-gzip response`);
    return null;
  }
  return zlib.gunzipSync(buf).toString('utf8');
}

function parseTsv(tsv, appIdMap, date) {
  const lines = tsv.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map(h => h.trim());
  const idxAppleId = headers.indexOf('Apple Identifier');
  const idxUnits = headers.indexOf('Units');
  const idxProductType = headers.indexOf('Product Type Identifier');

  if (idxAppleId < 0 || idxUnits < 0) {
    console.warn(`[appstore] ${date}: TSV headers missing expected columns`);
    return [];
  }

  // Sum units per app, keeping only app-install product types. Apple's
  // product type identifiers for free/paid iOS and iPadOS installs all
  // start with "1" (1, 1F, 1T, 1E, 1EP, 1EU, etc.). In-app purchases use
  // "IA1", subscriptions "IAY"/"IAC" — those we exclude.
  const totals = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const appleId = cols[idxAppleId]?.trim();
    const units = parseInt(cols[idxUnits] || '0', 10) || 0;
    const productType = idxProductType >= 0 ? (cols[idxProductType] || '').trim() : '';
    if (!appleId) continue;
    if (productType && !/^1[A-Z]*$/.test(productType)) continue;
    const slug = appIdMap[appleId];
    if (!slug) continue;
    totals[slug] = (totals[slug] || 0) + units;
  }

  return Object.entries(totals).map(([slug, units]) => ({
    source: 'appstore',
    date,
    platform: 'ios',
    app_id: slug,
    downloads: units,
    impressions: 0,
    estimated_earnings_usd: 0,
  }));
}

export async function fetchAppStore(dates) {
  const vendor = process.env.ASC_VENDOR_NUMBER;
  if (!vendor) throw new Error('ASC_VENDOR_NUMBER env var is not set');

  const appIdMap = parseAppIdMap(process.env.ASC_APP_IDS);
  if (Object.keys(appIdMap).length === 0) {
    console.warn('[appstore] ASC_APP_IDS is empty, no apps will be matched');
  }

  const token = buildJwt();
  const rows = [];
  for (const date of dates) {
    try {
      const tsv = await fetchReport(token, vendor, date);
      if (!tsv) continue;
      rows.push(...parseTsv(tsv, appIdMap, date));
    } catch (e) {
      console.error(`[appstore] ${date}:`, e.message);
    }
  }
  return rows;
}
