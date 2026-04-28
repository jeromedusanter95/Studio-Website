import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HISTORY_PATH = path.join(REPO_ROOT, 'stats-history.json');
const AGGREGATED_PATH = path.join(REPO_ROOT, 'stats-data.json');

// App slugs that the frontend looks up via [data-app-dl="..."] in
// index.html and apps.html. Add a new entry here if you publish a 5th app.
export const APP_SLUGS = [
  'space_blaster',
  'parallel_hearts',
  'wishbone_snap',
  'who_picked_who',
];

// Hand-maintained values with no API source. Edit when you want them to
// change. Ad impressions used to come from the AdMob Reporting API but
// AdMob no longer exposes self-service API access in most accounts, so
// the number on the stats page is a manual total you bump occasionally.
export const MANUAL_AVERAGE_RATING = 4.7;
export const MANUAL_IMPRESSIONS = 118561;

export function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    console.error('[storage] failed to read stats-history.json:', e.message);
    return [];
  }
}

export function saveHistory(rows) {
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    const aid = a.app_id || '';
    const bid = b.app_id || '';
    if (aid < bid) return -1;
    if (aid > bid) return 1;
    return 0;
  });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(rows, null, 2) + '\n');
}

// Per-source idempotency: if any row for (source, date) already exists,
// we do not refetch that source on that date.
export function needsFetch(history, source, date) {
  return !history.some(r => r.source === source && r.date === date);
}

export function saveAggregated(history) {
  const totals = {
    downloads: 0,
    impressions: MANUAL_IMPRESSIONS,
    published_apps: APP_SLUGS.length,
    average_rating: MANUAL_AVERAGE_RATING,
  };

  const apps = {};
  for (const slug of APP_SLUGS) apps[slug] = { downloads: 0 };

  for (const row of history) {
    totals.downloads += row.downloads || 0;
    if (row.app_id && apps[row.app_id]) {
      apps[row.app_id].downloads += row.downloads || 0;
    }
  }

  const aggregated = {
    last_updated: new Date().toISOString().slice(0, 10),
    totals,
    apps,
  };

  fs.writeFileSync(AGGREGATED_PATH, JSON.stringify(aggregated, null, 2) + '\n');
}
