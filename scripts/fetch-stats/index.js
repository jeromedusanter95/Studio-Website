import { loadHistory, saveHistory, saveAggregated, needsFetch } from './storage.js';
import { fetchPlay } from './sources/play.js';
import { fetchAppStore } from './sources/appstore.js';
import { fetchAdMob } from './sources/admob.js';

// 3-day rolling window to accommodate App Store Connect's ~24h processing
// lag. Per-source idempotency in storage.needsFetch ensures re-runs are
// cheap.
function lastNDates(n) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function runSource(name, fn, history, dates) {
  const missing = dates.filter(date => needsFetch(history, name, date));
  if (missing.length === 0) {
    console.log(`[${name}] all dates already in history, skipping`);
    return [];
  }
  console.log(`[${name}] fetching ${missing.length} date(s): ${missing.join(', ')}`);
  try {
    const rows = await fn(missing);
    console.log(`[${name}] fetched ${rows.length} row(s)`);
    return rows;
  } catch (e) {
    console.error(`[${name}] failed:`, e.message);
    if (e.stack) console.error(e.stack);
    return [];
  }
}

async function main() {
  const history = loadHistory();
  console.log(`[main] loaded ${history.length} existing rows from stats-history.json`);

  const dates = lastNDates(3);
  console.log(`[main] target window: ${dates.join(', ')}`);

  const results = await Promise.all([
    runSource('play',     fetchPlay,     history, dates),
    runSource('appstore', fetchAppStore, history, dates),
    runSource('admob',    fetchAdMob,    history, dates),
  ]);
  const newRows = results.flat();

  if (newRows.length === 0) {
    console.log('[main] no new rows fetched, skipping write');
    return;
  }

  history.push(...newRows);
  saveHistory(history);
  saveAggregated(history);
  console.log(`[main] wrote ${newRows.length} new row(s), total=${history.length}`);
}

main()
  .catch(e => {
    console.error('[main] fatal:', e);
  })
  .finally(() => {
    // Exit 0 unconditionally so the commit step in the workflow still runs.
    process.exit(0);
  });
