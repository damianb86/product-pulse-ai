# Return/refund relationship analysis

This document describes the Phase 1 backend model for classifying how returns and refunds relate to each product/order line. It is intentionally read-only and does not change Product Risk, UI cards, Shopify data, or Shopify mutations.

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

The persisted summary lives in `ProductRiskSnapshot.metrics.returnRefundRelationshipSummary` and, after a deep diagnosis, in the updated snapshot metrics as well.

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

## Current limitations

- Raw Shopify source records are not persisted as relational rows.
- Historical relationship data starts only after new QuickScan/deep diagnosis runs store the summary.
- Exchange/replacement is inferred from source text only.
- Product-scoped deep diagnosis may have less cross-product order context than QuickScan.
- Order-level refund fallback remains weak and is intentionally not over-attributed.
- The summary is not yet used in Product Risk, charts, cards, or labels.

## Future scoring impact

Product Risk:

- Increase risk when `returned_and_refunded_units` is high and match confidence is strong.
- Treat `returned_not_refunded` differently from `returned_and_refunded`; a return without refund can be operationally different from a financially confirmed product issue.
- Penalize `refunded_without_return` when repeated, because it can indicate goodwill refunds, billing adjustments, damage claims, or support escalations that do not appear in return data.
- Do not let `unattributed_refund_amount` directly blame a product; use it as uncertainty or diagnostic context.

Financial Exposure:

- Prefer `attributed_refund_amount` over raw `refundAmount`.
- Split exposure into `refund_amount_with_return` and `refund_amount_without_return`.
- Keep `unattributed_refund_amount` separate from product-attributed exposure.

Return Pressure:

- Replace the current independent return/refund blend with a relationship-aware pressure model.
- Weight `returned_and_refunded`, `refunded_without_return`, and `pending_return_resolution` differently.

Refund Leakage:

- Use `refund_rate_revenue` and `refund_attribution_rate`.
- Display or score leakage only from attributed refunds, with unattributed refunds as context.

Diagnosis Confidence:

- Increase confidence for exact line item matches.
- Reduce confidence when `relationship_unknown_count` is high or `refund_attribution_rate` is low.
- Treat single-product order fallback as usable but not equal to exact line attribution.

Customer Signals:

- Avoid double-counting a return and its matching refund as two independent product complaints.
- Count `returned_and_refunded` as one confirmed relationship signal plus financial severity.
- Keep `refunded_without_return` as a separate operational signal.

Monthly Order Activity and Return Rate Prediction:

- Continue to keep units, orders, and revenue separate.
- Later revisions can show relationship-aware overlays, such as attributed refunds with returns vs refunds without returns.
