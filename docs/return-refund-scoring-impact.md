# Return/refund scoring impact

Phase 2 integrates the Phase 1 relationship summary into the existing ProductPulse scoring model. It does not add UI changes, Shopify mutations, or a parallel Product Risk score.

## Current calculation map

Core scoring lives in `app/lib/product-pulse-scoring.js`.

- Product Risk: `calculateProductScoreModel` -> `calculateRiskComponents`.
- Financial Exposure: `calculateProductScoreModel` -> `calculateFinancialImpact`.
- Diagnosis Confidence and Evidence Strength: `calculateProductScoreModel` -> `calculateDiagnosisConfidence`.
- Priority Score: `calculatePriorityScore`.
- Product Momentum: `buildProductMomentum` in `app/lib/product-pulse-diagnosis.server.js`.
- Monthly Order Activity: `buildMonthlyOrderActivity` in `app/lib/product-pulse-diagnosis.server.js`.
- Return Rate Prediction: `buildReturnRatePrediction` in `app/lib/product-pulse-diagnosis.server.js`.
- Main Issue: QuickScan uses `getPrimaryIssue`; deep diagnosis uses `getMainIssueFromCounts`.
- Negative Review Pressure is derived from review counts/rates and is not changed by relationship data.

Persistence:

- QuickScan calculates candidates in `app/lib/product-pulse-quick-scan.server.js` and upserts `ProductRiskSnapshot`.
- Deep diagnosis recalculates deterministic metrics in `app/lib/product-pulse-diagnosis.server.js`, writes `ProductDiagnosis`, updates `ProductRiskSnapshot`, and records `ProductScoreHistory`.
- Product history is compressed by `app/lib/product-pulse-history.server.js`.
- Relationship-aware recompute is provided by `app/lib/product-pulse-recalculation.server.js`.

## Scoring version

The scoring version is `return_refund_relationship_v2`.

It is stored in:

- `ProductRiskSnapshot.metrics.scoringVersion`
- `ProductScoreHistory.metrics.scoringVersion`
- `ProductRiskSnapshot.metrics.returnRefundRelationshipFactors.version`

No schema migration is required because ProductPulse already stores product metrics as JSON.

## Product Risk changes

The existing Product Risk model now includes a relationship component inside `riskComponents.relationshipScore`. Existing return, refund, review, sentiment, content, variant, agreement, and recency components remain in the same score.

Bucket effects:

- `returned_and_refunded`: strong product risk, high financial confirmation, higher confidence when matching confidence is strong.
- `refunded_without_return` with product-quality, damage, not-as-described, size/fit, or wrong-item reason: elevated product risk.
- `refunded_without_return` with shipping, fulfillment, support, billing, or goodwill reason: lower product-specific risk; still counted as financial leakage.
- `returned_not_refunded`: medium product friction and lower financial impact.
- `exchange_or_replacement`: medium friction and lower direct financial loss.
- `pending_return_resolution`: small unresolved-friction signal; intentionally not overweighted.
- `unattributed_refund`: does not directly blame Product Risk; it lowers attribution confidence and contributes only to financial context.

The legacy refund-risk component is dampened when refunds are operational or unattributed, so weak refunds do not over-increase product-specific risk.

## Financial Exposure changes

Financial Exposure remains a single compatible `impactScore`, but the internal breakdown now separates:

- `confirmedRefundAmount`
- `attributedRefundAmount`
- `refundAmountWithReturn`
- `refundAmountWithoutReturn`
- `unattributedRefundAmount`
- `estimatedFutureRefundFromReturnOnlyCases`
- `relationshipAdjustedRefundAmount`

Confirmed attributed refunds drive observed loss. Return-only cases add potential future refund risk. Unattributed refunds are included with a low-confidence weight and remain separate from product-attributed loss.

## Return Pressure changes

Backend `metrics.returnPressure` is now relationship-aware. It focuses on product friction:

- returned and refunded units;
- returned but not refunded units;
- exchanges or replacements;
- pending return units;
- product-related reason share.

Refund amount is not the main input. Money belongs to Refund Leakage and Financial Exposure.

## Refund Leakage changes

Backend `metrics.refundLeakage` now focuses on money:

- attributed refund amount;
- refund amount with return;
- refund amount without return;
- unattributed refund amount;
- refund attribution rate;
- refund-rate revenue.

It distinguishes linked return refunds from refund-only and unattributed refunds.

## Diagnosis Confidence changes

Confidence now considers relationship quality.

Confidence increases when:

- return/refund events match by line item or strong product/variant attribution;
- relationship reasons are present;
- there is enough relationship event volume.

Confidence decreases when:

- refunds are unattributed;
- relationship reasons are missing;
- events are pending;
- relationship unknown count is high.

The confidence factors are stored under `confidenceFactors.relationshipMatchScore`, `relationshipReasonScore`, `refundAttributionPenalty`, `pendingRelationshipPenalty`, `relationshipUnknownPenalty`, and `missingRelationshipReasonPenalty`.

## Customer Signals changes

Backend `metrics.customerSignalBreakdown` now exposes:

- `linkedReturnRefundCount`
- `returnOnlyCount`
- `refundOnlyCount`
- `exchangeOrReplacementCount`
- `pendingOrUnknownCount`
- `unattributedRefundCount`

This is available for Phase 3 UI without changing the current UI.

## Prediction model impact

Return Rate Prediction remains return-focused. Refunds are not blindly injected into the return-rate model.

Relationship data can later support separate models:

- refund leakage prediction;
- return/refund severity prediction;
- financial exposure prediction.

For now, return/refund relationship data is stored beside the prediction and can be used as a severity feature, but the return-rate forecast still predicts returns.

## Recompute and backfill

`app/lib/product-pulse-recalculation.server.js` provides:

- `recomputeProductPulseMetricsForProduct(shop, productGid, options)`
- `recomputeProductPulseMetricsForShop(shop, options)`
- `recomputeProductPulseMetricsForAllShops(options)`
- `recalculateProductPulseSnapshotMetrics(snapshot, options)`

Safety:

- product recompute is scoped by `shop + productGid`;
- shop recompute is scoped by `shop`;
- all-shop recompute is bounded by a limit capped at `250`;
- no Shopify Admin API, GraphQL mutation, or Shopify write path is used;
- recompute writes only ProductPulse app database metrics;
- optional job logging records recompute counts and scoring version.

Backfill note:

Existing snapshots without `returnRefundRelationshipSummary` cannot reconstruct line-level relationships because raw orders, returns, and refunds are not stored as relational rows. They are still recalculated with the v2 scoring version, but relationship-aware Product Risk is available only after a new QuickScan or deep diagnosis stores the Phase 1 summary.

## Metrics that should not change

- Product Momentum remains commercial velocity and catalog share based.
- Negative Review Pressure remains review-sentiment based.
- Monthly Order Activity still shows orders, returns, refunds, and revenue by time bucket.
- Return Rate Prediction remains a return-rate model.
- UI labels and cards are intentionally unchanged in this phase.

## Known limitations

- Deep diagnosis is product-scoped and may have weaker multiproduct order context than QuickScan.
- Exchange/replacement detection is text-based unless Shopify exposes richer data later.
- ProductDiagnosis narratives from old diagnoses are not regenerated during recompute; new deep diagnoses include relationship-aware explanations in snapshot metrics.
- Historical ProductScoreHistory points only gain relationship-aware compressed metrics when new snapshots or recompute-generated snapshots are recorded.
