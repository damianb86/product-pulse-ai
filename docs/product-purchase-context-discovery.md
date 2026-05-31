# Product purchase context discovery

Phase 1 scope: discovery, backend modeling, aggregation, persistence through existing metrics JSON, and tests. No UI changes, no Product Risk scoring changes, no Shopify writes.

## Current storage model

ProductPulse does not persist raw Shopify orders or order line items in dedicated relational tables. The durable product state is product-level:

- `ProductRiskSnapshot.metrics` stores the current calculated metric payload.
- `ProductDiagnosis` stores diagnosis output, evidence, issues, recommendations, and actions.
- `ProductScoreHistory.metrics` stores historical product metric snapshots.

There is no first-class `Order`, `OrderLineItem`, `OrderBasket`, `PurchaseContext`, or `CoPurchase` database model. Purchase context therefore belongs in the existing metrics JSON unless a future phase introduces raw order persistence.

## Shopify order and line item data

Catalog Scan reads Shopify catalog and order data in `app/lib/product-pulse-quick-scan.server.js`.

- Bulk mode uses `buildOrdersBulkQuery`.
- Paginated fallback uses `extractOrderLineItemEventsWithPaginatedQueries`.
- Order date uses `getShopifyOrderDate(order)`, which prefers `processedAt`, then `createdAt`, then `updatedAt`.
- Sales are normalized to `sale` events with `orderId`, `lineItemId`, `productId`, `variantId`, `quantity`, `amount`, and order dates.
- Because Catalog Scan reads all line items in scanned orders, it can infer basket composition by grouping sale events by `orderId`.

Product Diagnosis reads product-scoped Shopify evidence in `app/lib/product-pulse-diagnosis.server.js`.

- `fetchShopifySalesEvents` queries orders, reads line items, then filters matching line items to the active product.
- Phase 1 now keeps a compact `basketLineItems` array on each product sale event while the order is in memory.
- The compact basket data includes line item id, product id, handle/title, variant id/title, SKU, quantity, and line amount.
- Source event cache schema moved to version `3` so future cached diagnosis sales can preserve basket context.

## Quantity and variant data

Quantity per order line is available from Shopify `LineItem.quantity` in both Catalog Scan and Product Diagnosis.

Variant-level data is available when Shopify returns `variant.id` and selected options. Some events can be variantless, for example deleted variants, API-limited fallback data, or older cached rows. The purchase-context confidence score is lower when variant mapping is missing, but quantity/order metrics can still be calculated when product id and quantity exist.

## Basket composition

Basket composition is currently supported in two ways:

- Catalog Scan: inferred from complete sale events grouped by `orderId`.
- Product Diagnosis: read from `basketLineItems` attached to each product sale event.

If a product-scoped sale event has no basket context and the caller does not mark order events as complete, the analysis does not classify the order as solo. It marks the order incomplete and lowers confidence.

## Co-purchase capability

Co-purchased products can be calculated when basket composition is known.

Implemented co-purchase fields:

- co-purchased product id, title, and handle;
- `co_order_count`;
- `co_order_rate`;
- `affinity_score`.

The affinity score is:

`P(other product | this product) / P(other product)`

This avoids listing only best-selling products. If the store-wide order denominator is incomplete, the summary still returns co-order counts and rates, but confidence reflects source limitations.

## Return/refund joins

Return/refund relationship data already exists at product/order-line level in `returnRefundRelationshipSummary`, but Phase 1 does not join return/refund outcomes to basket context.

Future integration can calculate:

- return rate when bought alone;
- return rate when bought with other products;
- refund rate when bought alone;
- refund rate when bought with other products;
- return/refund behavior for bulk orders;
- return/refund behavior for multi-variant same-product orders.

This requires careful matching by `orderId + lineItemId` and should use the existing return/refund relationship service rather than duplicating matching logic.

## Metric basis audit

Order-based:

- total orders containing product;
- solo product order count;
- multi-product order count;
- single-unit, multi-unit, bulk, and multi-variant order counts;
- co-order counts;
- monthly order cohort counts.

Unit-based:

- total units sold;
- product quantity per order;
- quantity distribution;
- bulk purchase threshold;
- average total units per basket.

Revenue-based:

- line revenue for the target product;
- optional total product revenue in the purchase context summary.

Variant-based:

- multi-variant same-product order detection.

Date-based:

- monthly purchase context uses the order cohort month.

## Valid metrics now

Supported and reliable when order access is available:

- solo vs multi-product basket;
- single-unit vs multi-unit purchase;
- conservative bulk detection;
- multi-variant same-product order detection;
- quantity distribution;
- average product quantity per order;
- average distinct products per order;
- average total units per order;
- top co-purchased products;
- affinity score;
- monthly order cohort purchase context.

## Future-only or low-confidence metrics

Not implemented in Phase 1:

- basket-context return/refund rates;
- basket-context Product Risk changes;
- Shopify bundle configuration detection;
- exchange/replacement behavior by basket context;
- profitability by basket context;
- customer-level repeat-purchase context.

Low-confidence scenarios:

- order access denied;
- product-scoped cached events without `basketLineItems`;
- incomplete line item pages when an order has more line items than the requested page size;
- missing product ids;
- missing quantities;
- missing variant ids;
- small sample sizes.

## Current limitations

- Raw orders are not stored relationally.
- Catalog Scan and Product Diagnosis only analyze the configured lookback window.
- Shopify line-item pagination can cap very large baskets.
- Bulk threshold defaults to `4+` unless enough product-specific order quantities exist to choose a higher 90th-percentile threshold.
- Co-purchase affinity is only as good as the available order universe.
- Phase 1 persists the summary under existing metrics JSON but does not recalculate Product Risk or change UI labels.
