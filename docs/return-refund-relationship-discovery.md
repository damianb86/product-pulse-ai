# Return/refund relationship discovery

Phase 1 scope: discovery, backend modeling, deterministic matching, aggregation, and tests. No UI changes, no score changes, no Shopify writes.

## Current storage model

ProductPulse does not currently persist Shopify orders, order line items, returns, refunds, exchanges, or replacements in dedicated database tables. The durable product state is stored in:

- `ProductRiskSnapshot.metrics` as JSON.
- `ProductDiagnosis.evidence`, `ProductDiagnosis.issues`, and `ProductDiagnosis.recommendations` as JSON.
- `ProductScoreHistory.metrics` as JSON snapshots of product metrics over time.

The Prisma schema has product-level ProductPulse tables only. There is no first-class `Order`, `OrderLineItem`, `Return`, `Refund`, `Exchange`, or `Replacement` model.

## Shopify order ingestion

QuickScan reads orders in `app/lib/product-pulse-quick-scan.server.js`.

- Bulk order query: `buildOrdersBulkQuery`.
- Paginated fallback query: `extractOrderLineItemEventsWithPaginatedQueries`.
- Order date: `getShopifyOrderDate(order)` prefers `processedAt`, then `createdAt`, then `updatedAt`.
- Sales are normalized into `sale` events with `orderId`, `lineItemId`, `productId`, `variantId`, quantity, amount, and order dates.

Deep diagnosis reads product-scoped sales in `app/lib/product-pulse-diagnosis.server.js`.

- `fetchShopifySalesEvents` queries orders by `processed_at`.
- It filters line items to the active product with `lineItemMatchesProduct`.
- It now includes `lineItemId` and `productId` in the normalized events so relationship analysis can match line-level outcomes.

## Shopify return ingestion

QuickScan:

- Bulk orders include `returns { returnLineItems { fulfillmentLineItem { lineItem { ... } } } }`.
- Paginated fallback uses `extractReturnEventsWithPaginatedQueries`.
- Return line item fields include line item id, product, variant, quantity, processed quantity, refunded quantity, status, return reason, return reason note, and customer note when Shopify exposes them.

Deep diagnosis:

- `fetchShopifyReturnEvents` and `fetchShopifyReturnEventsWithPlan` query return line items for the current product.
- The query supports both `returnReasonDefinition` and legacy `returnReason` shapes.
- Return events are product-scoped and now include `lineItemId`, `returnLineItemId`, `returnId`, `orderId`, product id, status, quantity, processed quantity, refunded quantity, reason, and notes.

How returns were counted before this phase:

- QuickScan increments `aggregate.returnUnits` directly from each return event quantity.
- Deep diagnosis calculates `returnUnits` as `sumBy(returns, "quantity")`, with a fallback to persisted snapshot metrics.
- Return rates are unit-based: `returnUnits / soldUnits`, stored as a percentage.
- Monthly Order Activity uses return events assigned back to the original order cohort when `orderId` is known.
- Return Rate Prediction is also unit-based for rate calculation but stores both order and unit counts.

## Shopify refund ingestion

QuickScan:

- Refunds are intentionally fetched outside the bulk order query with paginated queries because refund line items are excluded from the bulk query.
- `extractRefundEventsWithPaginatedQueries` reads orders updated in the window and orders with refunded financial statuses.
- It reads `refunds`, `refundLineItems`, `orderAdjustments`, `totalRefundedSet`, order line items, product and variant ids, restock type, and refund notes.
- When Shopify does not expose refund line items, QuickScan creates fallback order-level refund events from order financial status and line items.

Deep diagnosis:

- `fetchShopifyRefundEvents` uses several query plans to stay under Shopify query-cost limits.
- It filters refund line items to the current product through `lineItemMatchesProduct`.
- It also creates order-level fallback refund events when no refund line items exist.
- Refund events now include `lineItemId`, `refundLineItemId`, `refundId`, `orderId`, product id, quantity, amount, restock type, adjustment reasons, notes, and fallback source.

How refunds were counted before this phase:

- QuickScan increments `aggregate.refundUnits` directly from each refund event quantity and `aggregate.refundAmount` from the refund amount.
- Deep diagnosis calculates `refundUnits` and `refundAmount` as sums of product-scoped refund events, with fallback to snapshot metrics.
- Refund rate is unit-based: `refundUnits / soldUnits`, stored as a percentage.
- Refund leakage and financial exposure use refund amount, sales amount, margin assumptions, and return handling costs.

## Matching capability

Returns and refunds can be matched by line item when these fields are present:

- `orderId`.
- `lineItemId`.
- Product or variant ids.

The app can also match at lower confidence when:

- The event has the same order and same product/variant but no line item id.
- The order contains exactly one product/line item.
- Amount, quantity, and event dates uniquely match one product line.

The app should not over-attribute order-level refunds. If an order-level refund appears in a multiproduct order without true refund line item attribution, it must remain `unattributed_refund`.

## Product attribution

Current refund data can be:

- Product-attributed: refund line item has a Shopify line item with product/variant data.
- Order-line-attributed: refund line item has `orderId + lineItemId`.
- Weakly product-attributed: order-level fallback event is attached to a product line only because the order financial status indicates a refund.
- Unattributed: order-level or weak refund cannot be safely assigned to one product or line.

Current return data is usually product-attributed because Shopify return line items point back through `fulfillmentLineItem.lineItem`.

## Exchange and replacement data

No dedicated exchange or replacement object is currently queried or stored.

The current queries can only infer exchange or replacement when source text says so, for example:

- return status/reason/note contains exchange or replacement language;
- refund reason/note contains exchange or replacement language.

This is intentionally conservative. Without explicit Shopify exchange/replacement fields, the analysis should not invent exchange outcomes.

## Return and refund reasons

Available return reason fields:

- `returnReason`.
- `returnReasonDefinition` when available.
- `returnReasonNote`.
- `customerNote`.

Available refund reason fields:

- refund note;
- refund line item restock type;
- order adjustment reasons;
- order financial status fallback label.

Reason data may be absent or generic. The new classifier only emits broad reason categories when actual source text exists.

## Metric basis audit

Order-based metrics:

- Monthly Order Activity stores `totalOrders`, `returnedOrders`, and `refundedOrders`.
- Return Rate Prediction stores `totalOrders` and `totalReturnedOrders`.
- Product Momentum uses order-level sales events and weekly order/unit activity.

Unit-based metrics:

- `soldUnits`.
- `returnUnits`.
- `refundUnits`.
- `returnRate`.
- `refundRate`.
- Product Risk return/refund components.
- Return Pressure.
- Customer Signals when returns/refunds are counted as signal units.

Revenue-based metrics:

- `salesAmount`.
- `refundAmount`.
- `revenueAtRisk`.
- `marginAtRisk`.
- Financial Exposure.
- Refund Leakage.

Possible misleading labels:

- Some UI copy says “returns” or “refunds” without clarifying whether the denominator is units or orders.
- `refundRate` is unit-based, not revenue-based, while Refund Leakage is financially oriented.
- Monthly Order Activity mixes order counts, unit counts, revenue, return units, refund units, and refund amount in one data object.
- Return Rate Prediction is named as a return-rate forecast, but it uses weekly order cohorts plus returned units; order-count labels can be misleading if read as unit rates.
- Return Pressure blends returns, refunds, and reviews but does not yet distinguish “returned and refunded” from “refund without return”.
- Diagnosis Confidence currently sees returns and refunds as independent source families; it does not yet penalize weak refund attribution or reward exact return/refund matching.

## Current limitations

- No dedicated raw order/return/refund persistence exists.
- QuickScan has the best cross-product order context, but order-level refund fallback can still be weak.
- Deep diagnosis is product-scoped and may not know whether an order had other products unless the fallback refund query includes enough order line context.
- Exchange/replacement detection is text-based only.
- Shopify refund line items may be missing or inaccessible for some stores/API plans.
- Return and refund reasons are inconsistent across Shopify fields.
- Historical relationship summaries start only after this phase is deployed and scans/diagnoses run again.
- This phase stores relationship summary data but does not change Product Risk, Financial Exposure, Return Pressure, Refund Leakage, Diagnosis Confidence, Customer Signals, charts, or UI labels yet.
