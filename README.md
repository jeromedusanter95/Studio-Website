# Studio Website

Static HTML site for Jérôme Dusanter's Studio. Plain HTML, no build step.

The download counts on `index.html`, `apps.html`, and `stats.html` are read
from `stats-data.json` at page load. Edit that file by hand whenever you
want the numbers to change, then commit and push.

## stats-data.json

```json
{
  "last_updated": "2026-04-28",
  "totals": {
    "downloads": 40231,
    "impressions": 118561,
    "published_apps": 4,
    "average_rating": 4.7
  },
  "apps": {
    "space_blaster":   { "downloads": 40000 },
    "parallel_hearts": { "downloads": 170 },
    "wishbone_snap":   { "downloads": 52 },
    "who_picked_who":  { "downloads": 8 }
  }
}
```

`totals.downloads` should equal the sum of the per-app `downloads`. The
frontend uses `totals.*` for the headline KPIs on `stats.html` and
`apps[slug].downloads` for the per-card numbers on `apps.html` and
`index.html`.

## Local preview

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```
