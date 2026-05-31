# Product purchase context scoring impact

Phase 2 scope: use Product Purchase Context as a diagnostic modifier in existing ProductPulse metrics. No UI changes, no Shopify mutations, and no separate scoring system.

## Current scoring integration points

ProductPulse scoring is centralized in `app/lib/product-pulse-scoring.js`.

Current affected flows:

- Catalog Scan calls `calculateProductScoreModel` in `app/lib/product-pulse-quick-scan.server.js`.
- Product Diagnosis calls `calculateProductScoreModel` in `app/lib/product-pulse-diagnosis.server.js`.
- Recompute/backfill calls `calculateProductScoreModel` in `app/lib/product-pulse-recalculation.server.js`.

Purchase context is stored in:

- `metrics.productPurchaseContextSummary`
- `metrics.productPurchaseContextFactors`
- `metrics.productPurchaseContextScoringImpact`
- `metrics.purchaseContextSignalBreakdown`

Score version was updated to:

`purchase_context_v3`

## Metrics affected

Product Risk:

- affected lightly;
- purchase context is a modifier, not a primary risk family;
- solo-purchase context can increase attribution when negative signals already exist;
- multi-variant purchase context can add a bounded variant/fit/expectation modifier when returns are present;
- bulk purchase context can add a small severity modifier when returns/refunds exist;
- multi-product basket ambiguity can reduce weak refund-driven product attribution.

Diagnosis Confidence:

- affected more strongly than Product Risk;
- confidence increases when purchase context is reliable and attribution is clearer;
- confidence decreases when basket context is incomplete or weak order-level refunds happen in multi-product baskets.

Financial Exposure:

- affected only by quantity/bulk behavior;
- bulk purchase exposure is added as a bounded operational/margin exposure when return/refund evidence exists;
- multi-product basket size is not treated as direct product loss.

Return Pressure:

- existing return pressure remains return/friction focused;
- backend now exposes purchase-context segments:
  - return rate when bought alone;
  - return rate when bought with others;
  - return rate for single-unit orders;
  - return rate for multi-unit orders;
  - return rate for bulk orders;
  - return rate for multi-variant orders.

Refund Leakage:

- existing refund leakage remains money focused;
- backend now exposes purchase-context segments:
  - refund rate when bought alone;
  - refund rate when bought with others;
  - refund rate for bulk orders;
  - refund amount for bulk orders;
  - refund rate for multi-variant orders.

Customer Signals:

- backend exposes compact purchase-context signal summaries:
  - mostly bought alone;
  - often bought with other products;
  - mostly single-unit purchases;
  - frequent multi-unit purchases;
  - multi-variant orders detected;
  - bulk orders detected;
  - weak basket context;
  - top co-purchase count.

Recommended Actions:

- Product Diagnosis rule recommendations now use purchase context only when enough data exists.
- purchase-context signals can support:
  - variant clarity review;
  - specs/details guidance for product-level or basket-context ambiguity;
  - QA review for bulk return/refund evidence.

## Metrics not affected

Purchase context does not directly affect:

- Sales Momentum;
- Return Rate Prediction forecast model;
- raw sold units;
- raw return units;
- raw refund units;
- raw review counts;
- source coverage;
- Shopify mutations or action application.

Purchase context may become an explanatory feature for prediction later, but Phase 2 keeps return prediction distinct from basket analysis.

## Product Risk logic

Solo purchase attribution boost:

- requires existing negative signals;
- requires reliable purchase context;
- stronger when `solo_purchase_rate >= 65%`;
- capped as a small score contribution.

Multi-product attribution uncertainty:

- applies when `multi_product_basket_rate >= 65%`;
- requires weak refund attribution or unknown relationship data;
- reduces refund-driven product-specific risk via a multiplier;
- mostly affects confidence.

Multi-variant modifier:

- requires `multi_variant_order_rate >= 8%`;
- requires return evidence;
- stronger when return reasons include `size_or_fit`;
- capped so it cannot overwhelm direct return/refund/review evidence.

Bulk quantity severity:

- requires `bulk_purchase_rate >= 15%`;
- requires return/refund evidence;
- increases severity only modestly;
- healthy bulk behavior with low return/refund rates does not increase risk.

## Diagnosis Confidence logic

Confidence increases from:

- purchase-context confidence;
- sufficient order sample;
- mostly solo purchases with negative signals;
- multi-variant behavior aligned with return evidence.

Confidence decreases from:

- fewer than 5 product-containing orders;
- incomplete basket context;
- multi-product baskets plus weak refund attribution;
- ambiguous co-purchase context and unknown relationship events.

Minimum data rule:

- Most purchase-context recommendation and confidence boosts require at least 5 product-containing orders and purchase-context confidence of at least 55%.

## Financial Exposure logic

Bulk estimated margin exposure uses:

- average product quantity per order;
- bulk purchase rate;
- return/refund evidence;
- average unit revenue;
- margin rate;
- return processing cost.

It produces:

- `bulkQuantityExposure`
- `bulkRevenueExposure`

These are bounded and only apply when evidence exists. A product bought in bulk with low return/refund rates becomes a healthy reliability signal, not a risk source.

## Return/refund segmentation

Purchase-context service now calculates outcome segments when returns/refunds can be joined by order and product context:

- `bought_alone`
- `bought_with_others`
- `single_unit_orders`
- `multi_unit_orders`
- `bulk_orders`
- `multi_variant_orders`

Each segment includes:

- orders;
- sold units;
- returned units;
- refunded units;
- refund amount;
- affected orders;
- return rate by units;
- refund rate by units;
- affected order rate;
- sufficient-data flag.

The scoring layer exposes these as backend factors but does not change UI in Phase 2.

## Recommended action rules

Purchase context can support recommendations only with enough data and existing problem evidence:

- `multi_variant_order_rate` plus returns can support `correct-variant-options`.
- multi-product basket returns with a top co-purchased product can support specs/context guidance.
- bulk purchase returns/refunds can support `recommend-qa-review`.
- solo purchase returns/refunds can support product-level copy/spec priority.

Weak data does not create new recommendations.

## Recalculation and backfill

`app/lib/product-pulse-recalculation.server.js` recomputes:

- Product Risk;
- impact/confidence;
- relationship factors;
- purchase context factors;
- purchase context explanations;
- purchase context signal breakdown.

Supported scopes:

- one product;
- one shop;
- all shops with a bounded limit.

Existing snapshots without `productPurchaseContextSummary` cannot reconstruct basket context because raw orders are not persisted. They still receive scoring version `purchase_context_v3`, but purchase-context modifiers become active only after Catalog Scan or Product Diagnosis stores the summary.

Recommended actions are regenerated by Product Diagnosis. Snapshot recompute updates metrics and factors but does not rewrite existing `ProductDiagnosis.recommendations` because those are diagnosis artifacts and may include AI/rule outputs tied to source evidence at diagnosis time.

## Known limitations

- No raw relational order persistence exists.
- Segmented return/refund rates require order/product attribution.
- Event-level basket context is strongest in Catalog Scan and in Product Diagnosis after source cache schema v3.
- Co-purchase ambiguity is bounded and mostly affects confidence.
- Shopify bundle configuration is not detected.
- UI does not display these fields until a later phase.
