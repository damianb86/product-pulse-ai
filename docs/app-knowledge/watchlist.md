# Watchlist

Implementation reference: `app/lib/product-pulse-watchlist.server.js`.
Cron reference: `app/lib/product-pulse-watchlist-cron.server.js`.
Email alert reference: `app/lib/product-pulse-watchlist-alerts.server.js`.

The watchlist is an app-owned monitored product list.

Limits:

- Maximum watched products: 99.
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
- Scheduled cron queue events.
- Diagnosis credit-exhausted cron skips.
- Email sent/skipped/failed events.

Scheduled Watchlist cron:

- The `/cron/watchlist` endpoint scans all shops that have active watched products.
- The daily cron only queues shops whose configured cadence is due based on the latest scheduled Watchlist queue or diagnosis-credit-exhausted event.
- A shop's active watched products are processed in added order.
- The cron checks the store diagnosis credit balance before queueing Product Diagnosis jobs.
- It queues at most one Product Diagnosis job per available diagnosis credit.
- Products beyond the available diagnosis credit balance are skipped for that cron run and recorded in the queued activity metadata.
- If the shop has no available diagnosis credits, no Product Diagnosis job is queued for that shop and the cron moves to the next shop.
- Actual diagnosis credit debit still happens when each Product Diagnosis job finishes and only when the diagnosis consumes diagnosis credits. No-change reused diagnoses consume 0 diagnosis credits.
- A queued watched product can finish as a no-change date refresh: ProductPulse refreshes deterministic date-window metrics, reuses the previous Product Diagnosis, skips AI calls, and consumes 0 diagnosis credits.

Scheduled Watchlist email alerts:

- Emails are sent after all Product Diagnosis jobs in a scheduled shop run have reached a terminal state.
- The email uses the generated Watchlist change reports, so product sections show concrete source changes first and calculated product-state movement second.
- If a product has no new orders, returns, refunds, reviews, or content updates but Sales Momentum or other date-derived metrics moved, the report should say there were no concrete source changes and place those movements as secondary calculated context.
- Alerts require `alertsEnabled`, at least one configured alert recipient, and a summary schedule other than `none`.
- Trigger rules are evaluated per shop run:
  - `new_or_rising_risk`: sends for new issue evidence or risk score increase.
  - `new_issue_only`: sends for new return, refund, review, content, or primary-issue signals.
  - `risk_score_increase`: sends when product risk increases.
  - `medium_or_high_risk`: sends when a changed product is currently medium or high risk.
  - `any_watch_change`: sends when any watched product change is detected.
- Diagnosis credit exhaustion and failed Watchlist jobs are operational alerts and can send even when no product-change trigger matched.

Manual Watchlist scans:

- The Watchlist page `Run scan now` button queues the same Product Diagnosis jobs as the scheduled cron, with the same diagnosis credit precheck and per-finished-job diagnosis credit debit behavior.
- Manual scans do not check cadence and do not update the scheduled cadence clock.
- Manual scans record `watch_manual_scan_queued` instead of `watch_scan_queued`, so the next scheduled cron run remains based on the latest scheduled queue or diagnosis-credit-exhausted event.
- Manual scans force a confirmation email after all queued jobs finish, ignoring trigger rule, alerts enabled state, and summary schedule.
- Manual confirmation email still needs at least one configured Watchlist alert recipient.
- If a manual scan finds no changes, the confirmation email should still send and say that no meaningful Watchlist changes were detected.

Privacy note:

- Alert recipient emails are not AI-safe output. AI-facing tools expose recipient counts only.
