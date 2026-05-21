# Watchlist

Implementation reference: `app/lib/product-pulse-watchlist.server.js`.

The watchlist is an app-owned monitored product list.

Limits:

- Maximum watched products: 5.
- Adding the same product twice is avoided.
- Products can be Watching or Paused.

Default settings:

- Scan cadence: every 3 days.
- Trigger rule: new or rising risk.
- Summary schedule: daily digest at 8am.
- Alerts enabled: true.

Allowed scan cadence options:

- 1, 2, 3, 7, or 14 days.

Trigger rule options:

- New or rising risk.
- New issue only.
- Risk score increase.
- Medium or high risk.
- Any watch change.

What watchlist loads:

- Watched products.
- Product snapshots.
- Latest change reports.
- Active diagnosis jobs.
- Product score history.
- Watchlist activity.
- Watchlist settings.

What watchlist activity records:

- Product added.
- Product removed.
- Product paused.
- Product resumed.
- Settings changed.
- Watch scan activity.
- Diagnosis completed.
- Change reports.

Privacy note:

- Alert recipient emails are not AI-safe output. AI-facing tools expose recipient counts only.
