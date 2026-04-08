import { Storage } from '@google-cloud/storage';

// Default Android package -> internal slug map. The package names come from
// the actual store links in apps.html. If you ever rename a package or add a
// new app, update this map. The PLAY_PACKAGE_NAMES env var can override this
// using the format "package:slug,package:slug,..." but it is optional.
const DEFAULT_PACKAGE_MAP = {
  'com.jeromedusanter.space_impact':   'space_blaster',
  'com.jeromedusanter.parallelhearts': 'parallel_hearts',
  'com.jeromedusanter.wishbone':       'wishbone_snap',
  'com.jeromedusanter.whopickedwho':   'who_picked_who',
};

// Preferred column name for the daily per-day install count, in order of
// preference. We match case-insensitively on substrings so small renames
// from Google do not break the parser.
const DAILY_COLUMN_CANDIDATES = [
  'Daily Device Installs',
  'Daily User Installs',
  'Install events',
];

function parsePackageMap(envValue) {
  if (!envValue) return { ...DEFAULT_PACKAGE_MAP };
  const map = {};
  for (const entry of envValue.split(',').map(s => s.trim()).filter(Boolean)) {
    const [pkg, slug] = entry.split(':').map(s => s.trim());
    if (!pkg) continue;
    map[pkg] = slug || DEFAULT_PACKAGE_MAP[pkg] || pkg.split('.').pop();
  }
  return map;
}

function getStorageClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  const credentials = JSON.parse(raw);
  return new Storage({ credentials, projectId: credentials.project_id });
}

function yearMonthsForDates(dates) {
  const out = new Set();
  for (const d of dates) out.add(d.slice(0, 7).replace('-', '')); // "2026-04-07" -> "202604"
  return [...out];
}

function parseCsv(text) {
  // Play bulk reports are CSVs without embedded commas or quoted fields, so a
  // simple split is safe. If Google ever changes this we'll see the parser
  // fall apart in the logs before silently reporting wrong numbers.
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^\ufeff/, ''));
  const rows = lines.slice(1).map(l => l.split(','));
  return { headers, rows };
}

function findColumn(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase());
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const idx = lower.findIndex(h => h === target);
    if (idx >= 0) return idx;
  }
  // Fallback: substring match so "Daily Device Installs by country" still
  // matches "Daily Device Installs".
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const idx = lower.findIndex(h => h.includes(target));
    if (idx >= 0) return idx;
  }
  return -1;
}

async function downloadReportForMonth(storage, bucketName, pkg, yearMonth) {
  const filename = `stats/installs/installs_${pkg}_${yearMonth}_overview.csv`;
  const file = storage.bucket(bucketName).file(filename);

  const [exists] = await file.exists();
  if (!exists) {
    console.warn(`[play] ${pkg} ${yearMonth}: ${filename} does not exist (yet)`);
    return null;
  }

  const [buffer] = await file.download();
  // Play bulk reports are UTF-16LE with a BOM. Node's Buffer.toString supports
  // 'utf16le' natively; decodeURIComponent etc are not needed.
  const text = buffer.toString('utf16le').replace(/^\ufeff/, '');
  return text;
}

function extractRows(csvText, pkg, slug, wantedDates) {
  const { headers, rows } = parseCsv(csvText);
  if (headers.length === 0) return [];

  const dateIdx = findColumn(headers, ['Date']);
  const metricIdx = findColumn(headers, DAILY_COLUMN_CANDIDATES);

  if (dateIdx < 0 || metricIdx < 0) {
    console.warn(
      `[play] ${pkg}: could not find required columns. Headers: ${headers.join(' | ')}`,
    );
    return [];
  }

  const out = [];
  for (const cols of rows) {
    const rawDate = (cols[dateIdx] || '').trim();
    // Play bulk reports use "YYYY-MM-DD" format. Accept "MM/DD/YY" just in case.
    let date = rawDate;
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(rawDate)) {
      const [mm, dd, yy] = rawDate.split('/');
      date = `20${yy}-${mm}-${dd}`;
    }
    if (!wantedDates.includes(date)) continue;

    const downloads = parseInt((cols[metricIdx] || '0').trim(), 10) || 0;
    out.push({
      source: 'play',
      date,
      platform: 'android',
      app_id: slug,
      downloads,
    });
  }
  return out;
}

export async function fetchPlay(dates) {
  const bucketName = process.env.PLAY_BULK_REPORTS_BUCKET;
  if (!bucketName) {
    throw new Error('PLAY_BULK_REPORTS_BUCKET env var is not set');
  }

  const packageMap = parsePackageMap(process.env.PLAY_PACKAGE_NAMES);
  const packages = Object.keys(packageMap);
  if (packages.length === 0) {
    console.warn('[play] no packages to fetch');
    return [];
  }
  console.log(`[play] fetching ${packages.length} package(s) from gs://${bucketName}`);

  const storage = getStorageClient();
  const yearMonths = yearMonthsForDates(dates);
  const rows = [];

  for (const pkg of packages) {
    const slug = packageMap[pkg];
    for (const yearMonth of yearMonths) {
      try {
        const csv = await downloadReportForMonth(storage, bucketName, pkg, yearMonth);
        if (!csv) continue;
        rows.push(...extractRows(csv, pkg, slug, dates));
      } catch (e) {
        console.error(`[play] ${pkg} ${yearMonth}:`, e.message);
      }
    }
  }

  return rows;
}
