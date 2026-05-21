# ProductPulse Scoring

Implementation reference: `app/lib/product-pulse-scoring.js`.

## Source Coverage

Weights:

- Shopify products: 18
- Shopify orders: 18
- Shopify returns: 18
- Judge.me reviews: 14
- Chatme reviews: 10
- CSV reviews: 8
- Support tickets: 8
- PDP questions: 6

Formula:

`coverageScore = round((connectedWeight / totalWeight) * 100)`

Interpretation:

- 75 or more: Strong coverage.
- 45 to 74: Partial coverage.
- Below 45: Low coverage.

## Risk Score

Range: 0 to 100.

Formula:

`riskScore = round(clamp(base + returns + reviews + sentiment + contentGap + refund + variant + agreementBonus + recencyBonus, 0, 100))`

Component caps:

- Base evidence: 5 to 8 when evidence exists.
- Returns: max 25.
- Reviews: max 25.
- Sentiment: max 6 when shared with review source, max 15 when separate.
- Content gap: max 15.
- Refund: max 20.
- Variant concentration: max 10.
- Source agreement bonus: max 8.
- Recency bonus: max 5.

Default ProductPulse label thresholds:

- 75 or more: High risk.
- 55 to 74: Watch / Medium.
- 35 to 54: Emerging.
- Below 35: Healthy / Low.

Settings can change the UI low/medium/high thresholds. Defaults are minimum 18, medium 55, high 75.

## Confidence Score

Range: 0 to 99 after caps.

Positive inputs:

- Source count.
- Independent source count.
- Effective sample size.
- Product match confidence.
- Source agreement.
- Freshness and recent signals.

Penalties:

- Missing orders, returns, or refunds.
- Low sales sample.
- Stale evidence.
- Weak product match.
- Duplicate signals.
- Single source.
- Subjective-only issue.
- Reconstructed score.

Logic:

`confidenceRaw = coverage + independentSources + effectiveSample + productMatch + agreement + freshness - penalties`

Then confidence is capped by sample size, source independence, data quality, and reconstruction state.

## Evidence Strength

Range: 0 to 100.

Formula:

`evidenceStrengthScore = round(clamp(signalVolumeScore * 1.3 + independentSourceScore * 1.4 + sourceAgreementScore * 1.3 + recencyScore * 1.1, 0, 100))`

Evidence strength is support strength, not risk.

## Impact / Estimated Impact

Impact is estimated money, not a 0-100 score. In the stored model, `impactScore` equals `estimatedImpact`.

Inputs:

- Sold units and sales amount.
- Return units/rate.
- Refund units/amount.
- Average unit revenue.
- Review rating and negative review rate.
- Margin rate fallback.
- Return processing cost.
- Projection window.

Defaults:

- Margin rate fallback: 45%.
- Return processing cost fallback: 8.
- Projection days fallback: 90.

The impact model estimates observed refunds, return processing cost, lost margin, projected future return loss, and review conversion drag. It uses the maximum of calculated values and stored risk-money metrics when present.

## Priority Score

Range: 0 to 100.

Formula:

`priorityScore = round(clamp(0.5 * riskScore + 0.25 * confidenceScore + 0.25 * normalizedLogImpactScore, 0, 100))`

`normalizedLogImpactScore = 100 * log1p(impactScore) / log1p(maxReferenceImpact)`.

Default `maxReferenceImpact` is 25000.

## Product Momentum

Implementation reference: `buildProductMomentum` in `app/lib/product-pulse-diagnosis.server.js`.

Range: 0 to 100.

Formula:

`momentum = 0.35 * currentVelocity + 0.25 * growth + 0.20 * catalogShare + 0.15 * trendConsistency + 0.05 * recency`

Tiers:

- 80 or more: Hot.
- 60 to 79: Rising.
- 40 to 59: Stable.
- 20 to 39: Cooling.
- Below 20: Low activity.

Caps and adjustments:

- No units and no revenue in the last 30 days gives score 0.
- Very low unit volume caps the score unless velocity is very high.
- New activity after no previous 30-day sales is capped around 78 to 87 depending on volume.
- Products younger than 30 days cap at 85.
- Inventory constraints cap momentum confidence at 70.

Recommended interpretation:

- 70 or more: useful for watchlist inclusion.
- 50 to 69: monitor if risk rises.
- Below 50: no commercial follow-up by momentum alone.
