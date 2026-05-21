# QuickScan / Catalog Signal Scan

QuickScan is the deterministic product candidate scan.

Implementation reference: `app/lib/product-pulse-quick-scan.server.js`.

What it reads:

- Shopify catalog data.
- Shopify orders, refunds, returns, and return reasons when available.
- Connected CSV review ratings inside the configured lookback window.
- Source coverage metadata.

What it does not do:

- It does not call the AI model.
- It does not read full review text during QuickScan.
- It does not overwrite completed full diagnoses.
- It does not mutate Shopify.

Core flow:

1. Read ProductPulse settings, especially `analysis.lookbackDays`, risk thresholds, and momentum threshold.
2. Extract Shopify catalog/order data through Bulk Operations when possible, with paginated fallback.
3. If Shopify order access is denied, fall back to catalog-only extraction and mark order data unavailable.
4. Aggregate product-level sales, return, refund, review-rating, variant, recency, and source signals.
5. Calculate deterministic risk, confidence, impact, priority, and Product Momentum scores.
6. Sort products by `quickScanCandidateScore = max(riskScore, productMomentum.score)`.
7. Persist candidates that pass risk or momentum thresholds.

Candidate persistence rules:

- A product qualifies by risk when `riskScore >= settings.risk.minimumScore`.
- A product qualifies by momentum when `productMomentum.score >= settings.momentum.minimumScore`.
- QuickScan keeps up to the top 50 scored candidates from the scan result.
- Products with completed full diagnoses are retained instead of overwritten by QuickScan.

Default window:

- `analysis.lookbackDays` defaults to 60 days.

Limitations:

- QuickScan quality depends on available Shopify scopes and connected sources.
- Missing orders/returns/refunds reduce confidence.
- Low sample sizes are smoothed and capped to avoid overconfidence.
