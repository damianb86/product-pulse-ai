# Settings

Implementation reference: `app/lib/product-pulse-settings.server.js`.

## Risk minimum score

Key: `risk.minimumScore`

Default: 18.

Allowed range: 0 to 90.

Effect: Catalog Scan keeps products with risk at or above this value, unless Sales Momentum qualifies them separately.

## Medium risk threshold

Key: `risk.mediumThreshold`

Default: 55.

Allowed range: must be greater than minimum score and no more than 95.

Effect: Starts the medium risk label in the UI.

## High risk threshold

Key: `risk.highThreshold`

Default: 75.

Allowed range: must be greater than medium threshold and no more than 100.

Effect: Starts the high risk label in the UI.

## Sales Momentum minimum score

Key: `momentum.minimumScore`

Default: 70.

Allowed range: 0 to 100.

Effect: Catalog Scan keeps products with Sales Momentum at or above this value even when risk is below the minimum risk threshold.

## Analysis lookback days

Key: `analysis.lookbackDays`

Default: 60.

Allowed range: 10 to 365.

Effect: Controls how far back Catalog Scan and Product Diagnosis read orders, returns, refunds, and connected reviews.

## Watchlist settings

Defaults:

- Scan cadence: 3 days.
- Trigger rule: new or rising risk.
- Summary schedule: daily digest at 8am.
- Alerts enabled: true.

Safe AI output:

- AI can explain settings and recipient counts.
- AI should not expose alert recipient email addresses.
