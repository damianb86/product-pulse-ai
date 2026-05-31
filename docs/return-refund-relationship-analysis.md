# Return/refund relationship analysis

This document describes the backend model for classifying how returns and refunds relate to each product/order line and how Phase 2 feeds that data into existing ProductPulse scoring. It remains read-only with respect to Shopify: no Shopify mutations or Shopify writes are performed.

## Relationship buckets

The backend uses these buckets:

- `returned_and_refunded`: a returned unit/order line also has an attributed refund.
- `returned_not_refunded`: a returned unit/order line exists with no attributed refund.
- `refunded_without_return`: a refund is attributed to the product/order line but no return event exists.
- `exchange_or_replacement`: source data indicates the return became an exchange or replacement.
- `pending_return_resolution`: a return exists but status/quantity indicates the final financial outcome is not known.
- `unattributed_refund`: an order-level or weak refund exists but cannot be safely tied to one product, variant, or line item.
- `no_return_no_refund`: sold units with no return or refund event.

## Matching logic

Matching is deterministic and intentionally conservative.

Priority:

1. Exact line item match: `orderId + lineItemId`, confidence `1.00`.
2. Same order plus same product or variant, confidence `0.80`.
3. Single-product/single-line order fallback, confidence `0.60`.
4. Amount, quantity, and date heuristic only when exactly one line safely matches, confidence `0.30`.
5. Unattributed, confidence `0.00`.

Important rule:

If a refund came from an order-level financial-status fallback in a multiproduct order, the analysis does not attribute it to the product even if the fallback event contains a product id. It records the amount as `unattributed_refund_amount`.

## Data model

The persisted summary lives in `ProductRiskSnapshot.metrics.returnRefundRelationshipSummary` and, after a Product Diagnosis, in the updated snapshot metrics as well.

Core fields:

- `sold_units`
- `sold_orders`
- `returned_units`
- `returned_orders`
- `refunded_units`
- `refunded_orders`
- `returned_and_refunded_units`
- `returned_and_refunded_orders`
- `returned_not_refunded_units`
- `returned_not_refunded_orders`
- `refunded_without_return_units`
- `refunded_without_return_orders`
- `exchange_or_replacement_units`
- `exchange_or_replacement_orders`
- `pending_return_units`
- `pending_return_orders`
- `unattributed_refund_amount`
- `attributed_refund_amount`
- `refund_amount_with_return`
- `refund_amount_without_return`
- `total_product_revenue`
- `total_refund_amount_related_to_product_or_orders`
- `relationship_match_confidence_avg`
- `relationship_match_confidence_min`
- `relationship_unknown_count`
- `relationship_buckets`
- optional `return_reason_categories`
- optional `refund_reason_categories`

Reason categories are emitted only when source reason/note/status text exists.

## Formulas

All rates are decimals between `0` and `1`; presentation can later convert them to percentages.

- `return_rate_units = returned_units / sold_units`
- `return_rate_orders = returned_orders / sold_orders`
- `refund_rate_revenue = attributed_refund_amount / total_product_revenue`
- `refund_rate_units = refunded_units / sold_units`
- `return_to_refund_rate = returned_and_refunded_units / returned_units`
- `refund_with_return_rate = returned_and_refunded_units / refunded_units`
- `refund_without_return_rate = refunded_without_return_units / sold_units`
- `return_without_refund_rate = returned_not_refunded_units / sold_units`
- `exchange_rate = exchange_or_replacement_units / sold_units`
- `unattributed_refund_rate = unattributed_refund_amount / total_product_revenue`
- `refund_attribution_rate = attributed_refund_amount / total_refund_amount_related_to_product_or_orders`

All division by zero returns `0`.

## Reason categories

Supported broad categories:

- `product_quality`
- `damaged_or_defective`
- `not_as_described`
- `size_or_fit`
- `wrong_item`
- `shipping_issue`
- `fulfillment_issue`
- `customer_service`
- `billing_or_adjustment`
- `goodwill`
- `unknown`

The classifier uses existing reason, note, restock type, adjustment reason, status, and customer-note fields only.

## Scoring integration

Relationship data is consumed by the existing `calculateProductScoreModel` flow in `app/lib/product-pulse-scoring.js`. The current scoring version is `return_refund_relationship_v2`.

Persisted fields added in Phase 2:

- `metrics.scoringVersion`
- `metrics.returnRefundRelationshipFactors`
- `metrics.returnRefundScoringImpact`
- `metrics.returnPressure`
- `metrics.refundLeakage`
- `metrics.customerSignalBreakdown`
- `metrics.financialExposureBreakdown`

These are written by Catalog Scan and Product Diagnosis. Recompute support lives in `app/lib/product-pulse-recalculation.server.js`.

## Scoring impact

Product Risk:

- `returned_and_refunded` increases product risk strongly because product friction and confirmed financial loss align.
- `refunded_without_return` increases product risk when reason categories are product-quality, damaged/defective, not-as-described, size/fit, or wrong-item.
- `refunded_without_return` with shipping, fulfillment, customer-service, billing, or goodwill reasons is treated as lower product-specific risk and stronger financial context.
- `returned_not_refunded` increases product friction moderately without treating it as confirmed refund loss.
- `exchange_or_replacement` is medium friction with lower direct financial loss.
- `pending_return_resolution` is intentionally small until resolved.
- `unattributed_refund` lowers confidence and contributes to financial context but does not directly blame the product.

Financial Exposure:

- confirmed loss uses `attributed_refund_amount`;
- `refund_amount_with_return` and `refund_amount_without_return` are stored separately;
- `estimatedFutureRefundFromReturnOnlyCases` estimates potential future refund loss from unresolved return-only cases;
- `unattributed_refund_amount` remains separate and low-confidence.

Return Pressure:

- focuses on product friction: returns, return-only cases, linked return/refund cases, exchanges, pending returns, and product-related reasons;
- does not primarily use refund amount.

Refund Leakage:

- focuses on money: attributed refunds, refunds with returns, refunds without returns, unattributed refund amount, and attribution confidence.

Diagnosis Confidence:

- increases with exact/strong relationship matching and clear reasons;
- decreases with unattributed refunds, unknown relationships, missing reasons, and pending relationships.

Customer Signals:

- exposes linked return/refund count, return-only count, refund-only count, exchange/replacement count, pending/unknown count, and unattributed refund count for future UI.

Return Rate Prediction:

- remains return-focused;
- relationship data may later become a severity feature or feed a separate refund leakage/estimated margin exposure forecast.

## Recalculation and backfill

`app/lib/product-pulse-recalculation.server.js` can recompute:

- one product by `shop + productGid`;
- one shop with a bounded limit;
- all shops with a bounded limit capped at `250`.

Recompute updates `ProductRiskSnapshot` risk, impact, confidence, score components, relationship factors, and scoring version. It does not call Shopify, mutate Shopify data, or create Shopify write payloads.

Existing snapshots without `returnRefundRelationshipSummary` cannot reconstruct line-level relationships because raw source events are not persisted. They are still recalculated under v2, but relationship-aware impact becomes meaningful after Catalog Scan or Product Diagnosis stores the summary.

## Current limitations

- Raw Shopify source records are not persisted as relational rows.
- Historical relationship data starts only after new Catalog Scan/Product Diagnosis runs store the summary.
- Exchange/replacement is inferred from source text only.
- Product-scoped Product Diagnosis may have less cross-product order context than Catalog Scan.
- Order-level refund fallback remains weak and is intentionally not over-attributed.

## Phase 3 UI integration

Product detail now exposes relationship-aware data without changing scoring logic.

Top cards:

- Return Pressure is product-friction focused. It shows return rate, returned units, linked refunds, return-only cases, and refund-only cases when matched.
- Refund Leakage is financial-loss focused. It shows refund leakage as revenue rate plus refund amount split into with-return, without-return, and unattributed buckets.
- Customer Signals keeps returns, refunds, and negative reviews, and adds linked, return-only, and refund-only relationship counts.
- Diagnosis Confidence includes refund attribution quality in the subtext and lowers clarity when refunds are unattributed.
- Financial Exposure separates confirmed refunds from return-related risk.
- Product Risk tooltip now explains return+refund severity, return-only friction, refund-only compensation, and attribution uncertainty.

New product detail section:

- `Return & refund resolution` appears after the top metric cards.
- The matrix reads:
  - Return yes / Refund yes: returned + refunded units.
  - Return yes / Refund no: returned, not refunded units.
  - Return no / Refund yes: refund without return units.
  - Return no / Refund no: intentionally shown as `-` because normal sold units are not a problem bucket.
- Supporting stats show percent of returned units that were refunded, percent of refunds without returns, attribution confidence, exchange/replacement count, pending/unknown count, and unattributed refund amount.
- Missing relationship data shows “Refund relationship not matched yet” instead of fake zero buckets.

Monthly Order Activity:

- Volume view keeps the existing orders / returned order cohorts / refunded order cohorts / revenue chart.
- Summary labels now distinguish unit-based rates from order-count bars: returned and refunded summary tiles use units and say “of ordered units.”
- Resolution view uses relationship buckets: return+refund, return-only, refund-only, exchange/replacement, and pending/unknown.
- The chart is labeled as cohort month. Event-month grouping is not currently implemented, so the UI does not present an event-month toggle.

Tooltip wording:

- Return + refund: “Returned units that also had an attributed refund.”
- Return only: “Returned units without an attributed refund. These may be exchanges, pending refunds, replacements, or return-only cases.”
- Refund without return: “Refunds attributed to this product without a matching return event.”
- Unattributed refund: “Refund amount that could not be confidently assigned to a specific product or line item.”
- Attribution confidence: “How confidently refunds and returns were matched to this product.”

## Phase 3 AI assistant integration

New read-only AI tools:

- `product_pulse_get_return_refund_relationship_summary`
- `product_pulse_get_product_return_refund_resolution`
- `product_pulse_get_product_financial_exposure_breakdown`

These tools return compact summaries only. They are scoped by server tenant context, do not accept client tenant overrides, do not expose raw order/refund datasets, and do not perform Shopify mutations.

The assistant can now answer:

- How many refunds were linked to returns.
- Whether refunds are happening without returns.
- Whether returns are leading to refunds.
- Whether the product is creating confirmed financial loss or mostly friction.
- Why refund leakage is high.
- Why diagnosis confidence is lower.
- How to interpret return pressure.

ChatKit now supports a compact `return_refund_resolution` card with return+refund, return-only, refund-only, unattributed count, attribution confidence, and a short interpretation.
