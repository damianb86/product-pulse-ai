# Product Detail Cards

This document is the curated knowledge source for ProductPulse product-page card titles, subtitles, metric names, and popover explanations. The assistant should use this document through the app knowledge tools instead of guessing formulas from the visible UI.

Implementation references:

- `app/components/ProductPulseScreens.jsx`
- `app/lib/product-pulse-scoring.js`
- `app/lib/product-pulse-diagnosis.server.js`
- `app/lib/product-pulse-product-relationships.server.js`
- `docs/product-relationship-intelligence-metrics.md`
- `docs/product-purchase-context-scoring-impact.md`

## Product Detail Card Glossary

### Overview

Purpose: summarizes the current ProductPulse state for one product: latest snapshot, latest diagnosis, score state, watchlist state, active jobs, and app-owned ProductAction state.

Formula:

`overview = latest ProductRiskSnapshot + latest ProductDiagnosis + ProductAction/watchlist/job state`

Related formulas:

- `riskScore = round(clamp(base + returns + reviews + sentiment + contentGap + refund + variant + agreementBonus + recencyBonus, 0, 100))`
- `priorityScore = round(clamp(0.5 * riskScore + 0.25 * confidenceScore + 0.25 * normalizedLogImpactScore, 0, 100))`
- `estimatedImpact = roundMoney(max(observedLoss + projectedReturnLoss + reviewConversionMarginDrag, marginAtRisk, refundAmount, storedMarginAtRisk))`

Interpretation: start here, then inspect evidence and Recommended Actions before deciding what to change inside ProductPulse.

### Recommended Actions

Purpose: displays ProductPulse app-owned guidance records. These are recommendations or internal tasks, not Shopify changes.

Formula:

`recommendedActions = ProductDiagnosis.recommendations + ProductAction rows for the product`

Interpretation: actions can be reviewed, edited, dismissed, accepted, completed, or created inside ProductPulse when the app supports that state. The AI assistant may create or update ProductAction records after confirmation, but it must not apply changes to Shopify.

### Product Momentum

Purpose: measures commercial strength right now, separate from Product Risk.

Formula:

`momentum = 0.35 * currentVelocity + 0.25 * growth + 0.20 * catalogShare + 0.15 * trendConsistency + 0.05 * recency`

Tiers:

- 80 or more: Hot.
- 60 to 79: Rising.
- 40 to 59: Stable.
- 20 to 39: Cooling.
- Below 20: Low activity.

### Velocity

Purpose: current sales strength relative to the catalog.

Formula:

`currentVelocity = clamp(0.65 * unitsVelocityScore + 0.35 * revenueVelocityScore, 0, 96)`

Where:

- `unitsVelocityScore = percentileRank(unitsLast30Days, catalog.unitsLast30Distribution)`
- `revenueVelocityScore = percentileRank(revenueLast30Days, catalog.revenueLast30Distribution)`

### Growth

Purpose: compares the last 30 days with the previous 30 days.

Formula:

`growthScore = clamp(50 + 28 * log2(combinedGrowthRatio), 0, 96)`

Where:

- `unitRatio = (unitsLast30Days + 3) / (unitsPrevious30Days + 3)`
- `revenueRatio = (revenueLast30Days + 25) / (revenuePrevious30Days + 25)`
- products with current activity and no previous activity use `growthScore = clamp(66 + 22 * volumeConfidence, 0, 88)`.

### Catalog Share

Purpose: measures this product's current share or position inside the catalog.

Formula:

`catalogShareScore = clamp(0.55 * liftScore + 0.45 * currentVelocity, 0, 96)`

Where:

- `productShareLast30 = unitsLast30Days / storeUnitsLast30Days`
- `productShareBaseline = unitsPrevious90Days / storeUnitsPrevious90Days`
- `shareLiftRatio = (productShareLast30 + 0.0001) / (productShareBaseline + 0.0001)`
- `liftScore = clamp(50 + 26 * log2(shareLiftRatio), 0, 96)`

Fallback:

- `positionScore = clamp(98 - topCatalogPercent * 1.55, 42, 94)`
- `catalogShareScore = clamp(0.65 * positionScore + 0.35 * min(storedScore || positionScore, 92), 0, 94)`

### Trend Consistency

Purpose: checks whether recent weekly sales are active and directionally consistent.

Formula:

- `trendDirectionScore = clamp(50 + 70 * normalizedSlope, 0, 100)`
- `trendConsistencyScore = clamp(0.58 * trendDirectionScore + 0.42 * activeWeekRatio * 100, 0, 100)`

Where:

- `normalizedSlope = linearRegressionSlope(weeklyUnitsLast4Weeks) / max(averageWeeklyUnits, 1)`
- `activeWeekRatio = weeksWithUnits / 4`

### Recency

Purpose: keeps ProductPulse focused on current commercial or risk signals.

Product Momentum formula:

`recencyScore = clamp(base + recentShare * 10 + (unitsLast7Days >= 5 ? 4 : 0), 0, 96)`

Where:

- `recentShare = unitsLast7Days / unitsLast30Days`
- base is 86 for a sale within 2 days, 78 within 7 days, 60 within 14 days, 38 within 30 days, otherwise 0.

Risk recency bonus:

`recencyBonus = clamp(recentSignalUnits / signalEventCount * 6 + (recentSignalUnits >= 3 ? 1.5 : 0), 0, 5)`

Evidence freshness:

`freshnessScore = clamp(recentSignalUnits > 0 ? 4 + min(6, recentSignalUnits / signalEventCount * 8) : 0, 0, 10)`

### Lift

Purpose: compares an observed rate with a baseline rate. It appears in product relationships and in Catalog share methodology.

Relationship formulas:

- `sameOrderLift = attachRate / relatedProductBaseRate`
- `beforeAfterLift = relationshipRate / customerBaseRateOfRelatedProduct`

Catalog share formula:

`shareLiftRatio = (productShareLast30 + 0.0001) / (productShareBaseline + 0.0001)`

Interpretation:

- Above `1x`: stronger than baseline.
- Around `1x`: about baseline.
- Below `1x`: weaker than baseline.

Caveat: high lift with tiny sample size should not be treated as reliable by itself.

### Product Risk

Purpose: shows severity of product-level friction over time.

Formula:

`riskScore = round(clamp(base + returns + reviews + sentiment + contentGap + refund + variant + agreementBonus + recencyBonus, 0, 100))`

Interpretation: rising means risk is building; falling means the product is improving or pressure is cooling.

### Diagnosis Confidence

Purpose: measures reliability of the evidence behind the diagnosis.

Formula:

`confidenceRaw = coverage + independentSources + effectiveSample + productMatch + agreement + freshness - penalties`

Confidence is then capped by sample size, source independence, data quality, and reconstruction state.

### Financial Exposure

Purpose: estimated money exposure from product friction.

Formula:

`estimatedImpact = roundMoney(max(observedLoss + projectedReturnLoss + reviewConversionMarginDrag, marginAtRisk, refundAmount, storedMarginAtRisk))`

Where:

- `observedLoss = refundAmount + returnProcessingCost + lostMarginFromReturnedUnits`
- `projectedReturnLoss = projectedFutureUnits * excessReturnRate * (avgUnitRevenue * marginRate + returnProcessingCost)`
- `reviewConversionMarginDrag = reviewConversionRevenueDrag * marginRate`

### Return Pressure

Purpose: customer friction from returned units and return/refund resolution state. It does not include refund dollars.

Visible formula:

`returnPressure = returnRate = returnedUnits / soldUnits`

Risk contribution:

- `returnRiskWeight = returnAnomaly * sampleSupport`
- `returnAnomaly = storeAvgReturnRate > 0 ? max(0, min(25, ((returnRate / storeAvgReturnRate) - 1) * 14)) : min(22, returnRate * 1.2)`

Purchase-context segments can include return rate when bought alone, bought with others, single-unit, multi-unit, bulk, and multi-variant.

### Refund Leakage

Purpose: sales value leaking into refunds. It is money-focused and separate from return friction.

Visible formula:

`refundLeakage = refundRate = refundedUnits / soldUnits`

Risk contribution:

- `refundRiskWeight = (refundAnomaly + impact + pressure) * refundSupport`
- `refundAnomaly = storeAvgRefundRate > 0 ? max(0, min(20, ((refundRate / storeAvgRefundRate) - 1) * 11)) : min(18, refundRate)`
- `impact = min(15, log10(refundAmount + 1) * 4)`

### Evidence Strength

Purpose: support strength behind the diagnosis.

Formula:

`evidenceStrengthScore = round(clamp(signalVolumeScore * 1.3 + independentSourceScore * 1.4 + sourceAgreementScore * 1.3 + recencyScore * 1.1, 0, 100))`

Evidence strength is not risk severity. It is evidence support.

### Customer Signals

Purpose: volume of customer-facing signals behind the diagnosis.

Formula:

`customerSignals = returnUnits + refundUnits + negativeReviewCount + matchedReturnRefundSignalCount`

This is a compact signal summary, not a standalone severity model.

### Negative Review Pressure

Purpose: connected negative reviews as a share of all connected reviews.

Visible formula:

`negativeReviewPressure = negativeReviewRate = negativeReviewCount / reviewCount`

Related review signal formula:

`reviewSignalValue = negativeReviewRate * 0.7 + ratingPressure + samplePressure + criticalPressure + csvRatingRisk * 0.55 + negativeReviewCount * 2`

Where:

- `ratingPressure = max(0, 4 - averageRating) * 14`
- `samplePressure = min(18, log2(reviewCount + 1) * 4)`
- `criticalPressure = csvCriticalRatingCount * 5`

### Main Issue

Purpose: strongest issue category currently detected.

Formula:

`mainIssue = highest weighted issue/category from diagnosis and score component evidence`

Inputs include risk component weights, diagnosis issue labels, evidence snippets, customer language, and recommendation context.

### Recommended Fix

Purpose: the safest next internal ProductPulse action suggested from available evidence.

Formula:

`recommendedFix = highest priority supported action derived from diagnosis evidence and ProductAction state`

It should be treated as ProductPulse internal guidance, not a Shopify change.

### Basket Context

Purpose: explains how the product is bought inside Shopify orders: alone, with other products, in quantity, or across variants.

Formula:

- `multiProductBasketRate = multiProductOrderCount / totalOrdersContainingProduct`
- `soloPurchaseRate = soloProductOrderCount / totalOrdersContainingProduct`
- `bulkPurchaseRate = bulkOrderCount / totalOrdersContainingProduct`
- `multiVariantOrderRate = multiVariantOrderCount / totalOrdersContainingProduct`
- `affinityScore = P(other product | this product) / P(other product)`

Interpretation:

- Mostly bought alone can strengthen product attribution when negative signals exist.
- Often bought with other products can reduce confidence for weak order-level refunds.
- Bulk or multi-variant patterns can support QA, specs, or variant clarity recommendations when return/refund evidence exists.

### Product Relationship Timeline

Purpose: shows products bought with, before, or after the current product.

Same-order formulas:

- `attachRate = orders_with_A_and_B / orders_with_A`
- `relatedProductBaseRate = orders_with_B / total_known_basket_orders`
- `sameOrderLift = attachRate / relatedProductBaseRate`

Previous/next formulas:

- `relationshipRate = customers_who_bought_B_in_window / customers_who_bought_A`
- `customerBaseRateOfRelatedProduct = customers_who_bought_B / total_known_customers`
- `beforeAfterLift = relationshipRate / customerBaseRateOfRelatedProduct`

Timeline buckets:

- 0 to 7 days.
- 8 to 30 days.
- 30 or more days.

Caveat: product relationships are observational. They must not be described as causality.

### Return & Refund Resolution

Purpose: shows whether friction became confirmed financial loss, stayed return-only, or remained unattributed.

Formulas:

- `linkedPercent = returnedAndRefundedUnits / returnedUnits`
- `returnOnlyPercent = returnedNotRefundedUnits / returnedUnits`
- `refundOnlyPercent = refundedWithoutReturnUnits / max(refundedUnits, returnedAndRefundedUnits + refundedWithoutReturnUnits)`

Buckets:

- Return + refund.
- Return only.
- Refund only.
- Exchange/replacement.
- Pending/unknown.

### Return Rate

Purpose: returned units as a share of sold units.

Formula:

`returnRate = roundPercent(returnUnits / soldUnits)`

### Refund Rate

Purpose: refunded units as a share of sold units.

Formula:

`refundRate = roundPercent(refundUnits / soldUnits)`

### Monthly Order Activity

Purpose: order, return, refund, revenue, and unresolved return cohorts by month.

Formula:

`monthlyActivity = group orders, returned order cohorts, refunded order cohorts, revenue, and unresolved returns by cohort month`

This requires deep diagnosis and stored order evidence.

### Return Rate Prediction

Purpose: observed weekly return-rate cohorts projected three months forward.

Formula:

`forecastNext90ReturnRate = smoothed observed return-rate trend projected over the next 90 days`

Supporting formulas:

- `totalReturnRate = totalReturnedUnits / totalOrderUnits`
- `last60DayReturnRate = returned units in last 60 days / order units in last 60 days`
- `last30DayReturnRate = returned units in last 30 days / order units in last 30 days`

The forecast range is an estimate and widens as uncertainty grows.
