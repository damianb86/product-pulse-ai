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

Revenue and margin exposure are calculated in the same financial impact model.

### Revenue At Risk

Revenue at risk is an estimated gross revenue exposure, rounded to money.

Formula:

`revenueAtRisk = roundMoney(max(calculatedRevenueAtRisk, storedRevenueAtRisk))`

`calculatedRevenueAtRisk = projectedLostRevenue + returnRevenueExposure + reviewConversionRevenueDrag + refundAmount`

Where:

- `projectedLostRevenue = projectedFutureUnits * excessReturnRate * avgUnitRevenue`
- `returnRevenueExposure = returnUnits * avgUnitRevenue`
- `reviewConversionRevenueDrag = revenueWindow * estimatedConversionDelta`
- `revenueWindow = salesAmount > 0 ? (salesAmount / windowDays) * projectionDays : 0`
- `projectedFutureUnits = soldUnits > 0 ? (soldUnits / windowDays) * projectionDays : 0`
- `excessReturnRate = max(smoothedReturnRate - storeReturnBaseline, 0)`

Defaults:

- Projection days fallback: 90.

Caveats:

- Revenue at risk is revenue exposure, not guaranteed lost revenue.
- It includes refund amount and conversion drag estimates.
- It uses the maximum of calculated exposure and any stored `revenueAtRisk` value.

### Margin At Risk

Margin at risk is estimated margin/cost exposure, rounded to money.

Formula:

`marginAtRisk = roundMoney(max(calculatedMarginAtRisk, storedMarginAtRisk))`

`calculatedMarginAtRisk = projectedLostMargin + refundMarginLoss + returnProcessingCost + reviewConversionMarginDrag`

Where:

- `projectedLostMargin = projectedFutureUnits * excessReturnRate * avgUnitRevenue * marginRate`
- `refundMarginLoss = refundAmount * marginRate`
- `returnProcessingCost = returnUnits * processingCostPerReturn`
- `reviewConversionMarginDrag = reviewConversionRevenueDrag * marginRate`

Defaults:

- Margin rate fallback: 45%.
- Return processing cost fallback: 8.

### Estimated Impact / Impact Score

Estimated impact is the money value used as `impactScore`.

Formula:

`estimatedImpact = roundMoney(max(observedLoss + projectedReturnLoss + reviewConversionMarginDrag, marginAtRisk, refundAmount, storedMarginAtRisk))`

Where:

- `observedLoss = refundAmount + returnProcessingCost + lostMarginFromReturnedUnits`
- `lostMarginFromReturnedUnits = returnUnits * avgUnitRevenue * marginRate`
- `projectedReturnLoss = projectedFutureUnits * excessReturnRate * (avgUnitRevenue * marginRate + returnProcessingCost)`

The impact range uses sample-size multipliers:

- effective sample size below 10: low 0.55x, high 1.75x.
- effective sample size below 25: low 0.70x, high 1.45x.
- otherwise: low 0.84x, high 1.22x.

### Return And Refund Rates

QuickScan stores return and refund rates as percentages.

Formula:

- `returnRate = roundPercent(returnUnits / soldUnits)`
- `refundRate = roundPercent(refundUnits / soldUnits)`
- `roundPercent(rate) = round(rate * 1000) / 10`

If sold units are zero, the rate is 0.

### Return Pressure

Return pressure is the Product Detail metric for product return friction. The visible card uses returned units and return rate. The risk model uses a baseline-aware anomaly with sample support.

Visible formula:

`returnPressure = returnRate = returnedUnits / soldUnits`

Risk contribution:

`returnRiskWeight = returnAnomaly * sampleSupport`

Where:

`returnAnomaly = storeAvgReturnRate > 0 ? max(0, min(25, ((returnRate / storeAvgReturnRate) - 1) * 14)) : min(22, returnRate * 1.2)`

Return pressure is intentionally separate from refund dollars.

### Refund Leakage

Refund leakage is the Product Detail metric for sales value leaking into refunds. The visible card uses refunded units, refund rate, refund amount, and attribution context. The risk model uses refund anomaly, amount impact, high-pressure rules, and support.

Visible formula:

`refundLeakage = refundRate = refundedUnits / soldUnits`

Risk contribution:

`refundRiskWeight = (refundAnomaly + impact + pressure) * refundSupport`

Where:

- `refundAnomaly = storeAvgRefundRate > 0 ? max(0, min(20, ((refundRate / storeAvgRefundRate) - 1) * 11)) : min(18, refundRate)`
- `impact = min(15, log10(refundAmount + 1) * 4)`

Refund leakage is money-focused. Return pressure is friction-focused.

### Review Rating And Negative Review Rate

For QuickScan CSV review ratings:

- `reviewRating = roundRating(csvReviewRatingSum / csvReviewRatingCount)`
- `negativeReviewRate = roundPercent(csvLowRatingCount / csvReviewRatingCount)`

If review count is zero, rating and negative rate are 0.

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

### Velocity

Velocity is the current Product Momentum sales velocity component.

Formula:

`currentVelocity = clamp(0.65 * unitsVelocityScore + 0.35 * revenueVelocityScore, 0, 96)`

Where:

- `unitsVelocityScore = percentileRank(unitsLast30Days, catalog.unitsLast30Distribution)`
- `revenueVelocityScore = percentileRank(revenueLast30Days, catalog.revenueLast30Distribution)`

If catalog distribution is missing, percentile rank falls back to a log-scaled volume score.

### Growth

Growth compares the last 30 days with the previous 30 days using smoothed unit and revenue ratios.

Formula:

`growthScore = clamp(50 + 28 * log2(combinedGrowthRatio), 0, 96)`

For products with no previous 30-day units or revenue but current activity:

`growthScore = clamp(66 + 22 * volumeConfidence, 0, 88)`

Where:

- unit ratio uses `(unitsLast30Days + 3) / (unitsPrevious30Days + 3)`;
- revenue ratio uses `(revenueLast30Days + 25) / (revenuePrevious30Days + 25)`;
- unit ratio weight is usually 0.72;
- revenue ratio weight is 0.28 when previous revenue exists.

### Catalog Share

Catalog share measures how important the product is relative to the wider catalog.

Formula when catalog baseline exists:

`catalogShareScore = clamp(0.55 * liftScore + 0.45 * currentVelocity, 0, 96)`

`liftScore = clamp(50 + 26 * log2(shareLiftRatio), 0, 96)`

Where:

- `productShareLast30 = unitsLast30Days / storeUnitsLast30Days`
- `productShareBaseline = unitsPrevious90Days / storeUnitsPrevious90Days`
- `shareLiftRatio = (productShareLast30 + 0.0001) / (productShareBaseline + 0.0001)`

Fallback when only catalog rank is available:

`positionScore = clamp(98 - topCatalogPercent * 1.55, 42, 94)`

`catalogShareScore = clamp(0.65 * positionScore + 0.35 * min(storedScore || positionScore, 92), 0, 94)`

### Lift

Lift is a baseline comparison ratio. ProductPulse uses it in Product Momentum Catalog Share and in Product Relationship Intelligence.

Catalog share lift:

`shareLiftRatio = (productShareLast30 + 0.0001) / (productShareBaseline + 0.0001)`

`liftScore = clamp(50 + 26 * log2(shareLiftRatio), 0, 96)`

Product relationship lift:

- `sameOrderLift = attachRate / relatedProductBaseRate`
- `beforeAfterLift = relationshipRate / customerBaseRateOfRelatedProduct`

Interpretation:

- Above `1x`: stronger than baseline.
- Around `1x`: about baseline.
- Below `1x`: weaker than baseline.

High lift with low sample size should not be treated as reliable by itself.

### Trend Consistency

Trend consistency uses the last four weekly unit buckets.

Formula:

`trendDirectionScore = clamp(50 + 70 * normalizedSlope, 0, 100)`

`trendConsistencyScore = clamp(0.58 * trendDirectionScore + 0.42 * activeWeekRatio * 100, 0, 100)`

Where:

- `normalizedSlope = linearRegressionSlope(weeklyUnitsLast4Weeks) / max(averageWeeklyUnits, 1)`
- `activeWeekRatio = weeksWithUnits / 4`

### Recency

Recency exists in two ProductPulse scoring areas.

Product Momentum recency:

`recencyScore = clamp(base + recentShare * 10 + (unitsLast7Days >= 5 ? 4 : 0), 0, 96)`

Where:

- if `lastSaleAt` is known, base is 86 for <=2 days, 78 for <=7 days, 60 for <=14 days, 38 for <=30 days, otherwise 0;
- if `lastSaleAt` is unknown, base falls back to 82 when the last 7 days have units, 64 when the last 14 days have units, 42 when the last 30 days have units, otherwise 0;
- `recentShare = unitsLast7Days / unitsLast30Days`.

Risk recency bonus:

`recencyBonus = clamp(recentSignalUnits / signalEventCount * 6 + (recentSignalUnits >= 3 ? 1.5 : 0), 0, 5)`

Evidence strength recency:

`recencyScore = freshnessScore = clamp(recentSignalUnits > 0 ? 4 + min(6, recentSignalUnits / signalEventCount * 8) : 0, 0, 10)`

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

## Negative Review Pressure

The Product Detail insight card named "Negative review pressure" displays the connected negative review rate.

Formula:

`negativeReviewPressure = negativeReviewRate = roundPercent(negativeReviewCount / reviewCount)`

If review count is zero, the rate is 0.

Related internal review evidence pressure can also combine:

`reviewSignalValue = negativeReviewRate * 0.7 + ratingPressure + samplePressure + criticalPressure + csvRatingRisk * 0.55 + negativeReviewCount * 2`

Where:

- `ratingPressure = max(0, 4 - averageRating) * 14`
- `samplePressure = min(18, log2(reviewCount + 1) * 4)`
- `criticalPressure = csvCriticalRatingCount * 5`

The visible Negative review pressure card should be read as sentiment pressure from connected reviews, not as a standalone risk score.
