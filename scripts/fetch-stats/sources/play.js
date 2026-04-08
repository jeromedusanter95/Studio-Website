import { getGoogleAccessToken } from './google-auth.js';

// Default Android package -> internal slug map. The package names come from
// the actual store links in apps.html. If you ever rename a package or add a
// new app, update this map. The PLAY_PACKAGE_NAMES env var can override this
// using the format "package:slug,package:slug,..." but it is optional.
const DEFAULT_PACKAGE_MAP = {
  'com.jeromedusanter.space_impact':   'space_blaster',
  'com.jeromedusanter.parallel_hearts': 'parallel_hearts',
  'com.jeromedusanter.wishbone':        'wishbone_snap',
  'com.jeromedusanter.whopickedwho':    'who_picked_who',
};

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

function dateToTimestamp(isoDate) {
  const [year, month, day] = isoDate.split('-').map(n => parseInt(n, 10));
  return { year, month, day };
}

export async function fetchPlay(dates) {
  const packageMap = parsePackageMap(process.env.PLAY_PACKAGE_NAMES);
  const packages = Object.keys(packageMap);
  if (packages.length === 0) {
    console.warn('[play] no packages to fetch');
    return [];
  }
  console.log(`[play] fetching ${packages.length} package(s): ${packages.join(', ')}`);

  const accessToken = await getGoogleAccessToken([
    'https://www.googleapis.com/auth/playdeveloperreporting',
  ]);

  const sortedDates = [...dates].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];

  // End time is exclusive in the Play Developer Reporting API, so we add
  // one day to include the last requested date.
  const endExclusive = new Date(endDate + 'T00:00:00Z');
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endIso = endExclusive.toISOString().slice(0, 10);

  const rows = [];

  for (const pkg of packages) {
    const slug = packageMap[pkg];
    const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${encodeURIComponent(pkg)}/installsMetricSet:query`;
    const body = {
      timelineSpec: {
        aggregationPeriod: 'DAILY',
        startTime: { ...dateToTimestamp(startDate), timeZone: { id: 'UTC' } },
        endTime:   { ...dateToTimestamp(endIso),    timeZone: { id: 'UTC' } },
      },
      metrics: ['activeDeviceInstalls'],
    };

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error(`[play] network error for ${pkg}:`, e.message);
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[play] ${pkg} ${resp.status}: ${text.slice(0, 500)}`);
      continue;
    }

    const data = await resp.json();
    const timeline = data.rows || [];

    for (const tl of timeline) {
      const start = tl.startTime || {};
      const year = start.year;
      const month = String(start.month || 0).padStart(2, '0');
      const day = String(start.day || 0).padStart(2, '0');
      if (!year) continue;
      const date = `${year}-${month}-${day}`;
      if (!dates.includes(date)) continue;

      const metricVal = (tl.metrics || []).find(m => m.metric === 'activeDeviceInstalls');
      const downloads = metricVal?.decimalValue?.value
        ? Math.round(parseFloat(metricVal.decimalValue.value))
        : parseInt(metricVal?.integerValue || '0', 10) || 0;

      rows.push({
        source: 'play',
        date,
        platform: 'android',
        app_id: slug,
        downloads,
      });
    }
  }

  return rows;
}
