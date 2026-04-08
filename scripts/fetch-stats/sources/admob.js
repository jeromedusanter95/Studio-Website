import { getGoogleAccessToken } from './google-auth.js';

// After the first workflow run, inspect the raw rows in the Action logs to
// learn the AdMob app IDs (format: "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"),
// then fill them in here. Each entry maps an AdMob app ID to our internal
// slug and the platform it belongs to.
//
// Example:
//   'ca-app-pub-1234567890123456~1111111111': { slug: 'space_blaster',   platform: 'android' },
//   'ca-app-pub-1234567890123456~2222222222': { slug: 'space_blaster',   platform: 'ios' },
export const ADMOB_APP_MAP = {
  // fill in after first run
};

function parseYyyymmdd(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export async function fetchAdMob(dates) {
  const publisherId = process.env.ADMOB_PUBLISHER_ID;
  if (!publisherId) throw new Error('ADMOB_PUBLISHER_ID env var is not set');

  const accessToken = await getGoogleAccessToken([
    'https://www.googleapis.com/auth/admob.report',
  ]);

  const sortedDates = [...dates].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];
  const [sy, sm, sd] = startDate.split('-').map(n => parseInt(n, 10));
  const [ey, em, ed] = endDate.split('-').map(n => parseInt(n, 10));

  const url = `https://admob.googleapis.com/v1/accounts/${encodeURIComponent(publisherId)}/networkReport:generate`;
  const body = {
    reportSpec: {
      dateRange: {
        startDate: { year: sy, month: sm, day: sd },
        endDate:   { year: ey, month: em, day: ed },
      },
      dimensions: ['DATE', 'APP'],
      metrics: ['IMPRESSIONS', 'ESTIMATED_EARNINGS'],
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AdMob ${resp.status}: ${text.slice(0, 500)}`);
  }

  // AdMob returns a JSON array of { header } / { row } / { footer } objects.
  const payload = await resp.json();
  const items = Array.isArray(payload) ? payload : [payload];

  const rows = [];
  const unknownApps = new Set();

  for (const item of items) {
    const row = item?.row;
    if (!row) continue;

    const dimVals = row.dimensionValues || {};
    const metVals = row.metricValues || {};

    const dateRaw = dimVals.DATE?.value;
    const appRaw = dimVals.APP?.value;
    if (!dateRaw || !appRaw) continue;

    const date = parseYyyymmdd(dateRaw);
    if (!dates.includes(date)) continue;

    const impressions = parseInt(metVals.IMPRESSIONS?.integerValue || '0', 10) || 0;
    const earningsMicros = parseInt(metVals.ESTIMATED_EARNINGS?.microsValue || '0', 10) || 0;
    const earnings = earningsMicros / 1_000_000;

    const mapping = ADMOB_APP_MAP[appRaw];
    if (!mapping) {
      unknownApps.add(appRaw);
      // Still record the data under an unknown slug so totals are correct;
      // per_app attribution will be missing until the map is filled in.
      rows.push({
        source: 'admob',
        date,
        platform: 'android', // unknown platform; default to android
        app_id: null,
        downloads: 0,
        impressions,
        estimated_earnings_usd: earnings,
      });
      continue;
    }

    rows.push({
      source: 'admob',
      date,
      platform: mapping.platform,
      app_id: mapping.slug,
      downloads: 0,
      impressions,
      estimated_earnings_usd: earnings,
    });
  }

  if (unknownApps.size > 0) {
    console.warn(
      `[admob] unknown AdMob app IDs (add them to ADMOB_APP_MAP in sources/admob.js): ${[...unknownApps].join(', ')}`,
    );
  }

  return rows;
}
