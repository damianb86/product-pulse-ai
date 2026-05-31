# Product Relationship Intelligence discovery

Phase 1 scope: discovery, data inventory, relationship data model, and processing plan. No UI changes, no scoring changes, no AI-generated insights, no Shopify mutations, and no fake data.

## Executive decision

Product Relationship Intelligence should start as a hybrid precomputed metrics layer:

- Same-order relationships can be calculated now from existing Shopify order line item data.
- Previous-purchase and next-purchase relationships require customer identity, which is not currently fetched, normalized, cached, or persisted.
- Relationship impact can be calculated only where return/refund events can be joined to the same order and line item.
- The first implementation should store compact output in `ProductRiskSnapshot.metrics.productRelationshipIntelligenceSummary`, following the existing `returnRefundRelationshipSummary` and `productPurchaseContextSummary` pattern.
- Runtime Product Detail loaders should read precomputed summaries only. They should not issue live Shopify relationship queries.
- A dedicated relationship table should be deferred until relationship volume, retention, or query requirements exceed what compact metrics JSON can support.

## Current storage model

The Prisma schema does not contain relational order, customer, order-line, return, refund, basket, co-purchase, or product-relationship tables.

Current durable ProductPulse storage is product-level:

- `ProductRiskSnapshot.metrics`: primary persisted product metric payload.
- `ProductDiagnosis`: diagnosis output, evidence, issues, recommendations, and completion metadata.
- `ProductScoreHistory.metrics`: historical metric snapshots.
- `CatalogSignalJob.payload`: queued job metadata, not a durable analytics store.
- AI tools read compact summaries from `ProductRiskSnapshot`, `ProductDiagnosis`, `ProductAction`, `ProductScoreHistory`, and watchlist tables.

Implication: relationship intelligence should use the existing scan/diagnosis pipelines to precompute compact product-level summaries. It should not assume raw local order history exists.

## Available data

### Customer identity

Customer identity is not currently available in ProductPulse analysis events.

Current Shopify order queries in Catalog Scan and Product Diagnosis read:

- order id;
- order created/processed timestamps;
- order line items;
- returns;
- refunds;
- optional shipping/billing geography in Product Diagnosis.

They do not read `customer`, `customer.id`, email, phone, customer name, or any stable local customer key.

Safest future identifier:

- Use Shopify customer GID only when available and permitted by scopes/privacy settings.
- Hash it with shop context before any persistence if raw identity is not needed.
- Do not use names, emails, phone numbers, or addresses for relationship intelligence.
- Guest checkouts and missing customer records must remain unknown, not inferred from PII.

Current support level:

- Same-order relationships: supported now.
- Previous/next/time-window by same customer: not supported yet.

### Order timestamps

Order timestamps are available.

Current code generally treats the order cohort date as:

1. `processedAt`;
2. `createdAt`;
3. `updatedAt` as a fallback.

Relevant code paths:

- Catalog Scan sales: `extractOrderLineItemEventsWithPaginatedQueries`.
- Catalog Scan bulk orders: `buildOrdersBulkQuery`.
- Product Diagnosis sales: `fetchShopifySalesEvents`.
- Monthly order activity and purchase context: cohort month derived from order date.

For relationship intelligence, order cohort date should use the same basis to avoid chart/scoring inconsistencies.

### Line item fields

Line item data is available in current order ingestion.

Current normalized sale events include:

- `orderId`;
- `lineItemId`;
- `productId`;
- `variantId`;
- product handle;
- product title;
- line item title;
- SKU;
- variant title;
- selected variant options;
- quantity;
- line amount from `originalTotalSet.shopMoney.amount`;
- order dates.

Product Diagnosis also preserves compact `basketLineItems` on product-scoped sales when basket context is available.

### Revenue data

Line-item revenue can be calculated from `originalTotalSet.shopMoney.amount`.

Current limitations:

- This is line-level gross/order amount as exposed by Shopify, not necessarily margin.
- Discounts, taxes, shipping, presentment currency, refunds, and partial captures are not modeled as a full accounting ledger.
- Refund amount is available separately from refund line item subtotal/fallback refund values.

### Return/refund joins

Returns and refunds can be joined back to products and order lines when Shopify supplies:

- `orderId`;
- `lineItemId`;
- `productId` or `variantId`.

Existing return/refund matching already supports:

- exact line item match;
- same order + product/variant match;
- single-product-order fallback;
- weak order-level attribution;
- unattributed refund handling.

Relationship impact should reuse this logic rather than duplicate attribution rules.

### Historical completeness

Historical completeness is limited by the active scan/diagnosis window and whether source event cache exists.

Current constraints:

- There is no local raw order history table.
- Catalog Scan can see broad shop order events within its configured window.
- Product Diagnosis is product-scoped but can preserve basket line items for matched orders.
- `ProductScoreHistory` stores product metric history, not raw relationship event history.
- Relationships from older orders are unavailable unless they were included in a prior snapshot or source cache.

### Product titles, images, and status

Product title and handle are available in snapshots and order line items.

Product display data is available through:

- `ProductRiskSnapshot.productTitle`;
- `ProductRiskSnapshot.handle`;
- product metrics such as vendor/type/collections/media where present;
- live Product Detail image attachment from Shopify;
- product catalog data loaded during Catalog Scan.

Order line items do not provide reliable current product images or status. For future relationship UI, related product cards should join to `ProductRiskSnapshot` or the scanned product catalog when available. If a product was deleted or is not in ProductPulse snapshots, show a title-only related product with a warning.

### Product and variant relationship support

Product-level relationships are currently supportable.

Variant-level relationships are partially supportable because variant ids and titles are available on order lines, returns, and refunds. However, the initial relationship model should remain product-level because:

- deleted/renamed variants can make historical variant attribution fragile;
- product risk and Product Detail views are product-level;
- purchase context already treats multi-variant same-product behavior as a modifier rather than a first-class product relationship.

Variant relationship details can be added later as optional drill-down data.

## Data limitations

- Customer IDs are not fetched or persisted today.
- Guest checkout and missing customer records prevent sequence relationships.
- Duplicate customer accounts can split a real shopper journey into multiple identities.
- Merged customer accounts can combine unrelated historical behavior.
- Deleted products can leave only stale line item title/product id references.
- Product titles and handles can change after historical orders.
- Variants can be deleted, renamed, merged, or represented only by SKU/title in older data.
- Order history is only as complete as the configured scan/diagnosis window.
- Very large orders may be capped by Shopify line-item pagination settings.
- Order-level refunds without line item attribution cannot be safely blamed on a related product pair.
- Low-volume products can produce misleading lift/affinity values.
- Stores with too little order data should show low confidence or unavailable relationship intelligence.
- Relationship impact can be biased if returns/refunds are fetched from an updated-at window while sales are grouped by order cohort month.

## Relationship types to support

### A. Same-order relationship

Products purchased together in the same Shopify order.

Current support: supported.

Inputs:

- complete order line items from Catalog Scan;
- `basketLineItems` from Product Diagnosis;
- product id and order id.

This is the strongest initial relationship type because it does not require customer identity.

### B. Previous-purchase relationship

Products purchased by the same customer before buying the current product.

Current support: not supported yet.

Required future input:

- stable non-PII customer key;
- order date;
- customer purchase sequence.

Do not infer this from product titles, addresses, names, emails, or order notes.

### C. Next-purchase relationship

Products purchased by the same customer after buying the current product.

Current support: not supported yet.

Required future input is the same as previous-purchase relationships.

### D. Temporal-window relationship

Products bought inside defined windows around the current product purchase:

- 7 days before;
- 14 days before;
- 30 days before;
- optional 60 or 90 days before;
- same order;
- 7 days after;
- 14 days after;
- 30 days after;
- optional 60 or 90 days after.

Current support:

- same order: supported;
- before/after windows: supported when sale events include a safe `customerKey`, now sourced from Shopify `order.customer.id` when `read_customers` is granted.

### E. Relationship trend

Monthly or cohort trend showing whether relationship strength is increasing, decreasing, or stable.

Current support:

- same-order trend by order cohort month is supported when enough order lines are available.
- before/after trend is supported when same-customer sequence events include `customerKey`.

### F. Relationship impact

Whether related purchases change:

- return rate;
- refund rate;
- refund amount;
- product risk;
- diagnosis confidence;
- estimated margin exposure.

Current support:

- same-order impact can be calculated when same-order pairs can be linked to return/refund events through existing relationship matching.
- sequence impact requires customer identity and should be future-only.
- Product Risk and scoring must not be changed in Phase 1.

## Proposed data model

Use snake_case for persisted metrics JSON to match existing summaries. Internal TypeScript/JS can expose camelCase adapters later.

### ProductRelationshipSummary

```ts
type ProductRelationshipSummary = {
  schema_version: 1;
  source_product_id: string;
  source_product_handle?: string;
  source_product_title?: string;
  calculated_at: string;
  window_days: number;
  relationship_model_version: "product_relationship_v1";
  data_basis: {
    same_order_available: boolean;
    customer_sequence_available: boolean;
    customer_identity_basis: "none" | "shopify_customer_gid_hash";
    order_count: number;
    customer_count: number;
    known_customer_order_count: number;
    unknown_customer_order_count: number;
    known_basket_order_count: number;
    unknown_basket_order_count: number;
  };
  same_order: ProductRelationshipItem[];
  previous_purchases: ProductRelationshipItem[];
  next_purchases: ProductRelationshipItem[];
  temporal_windows: ProductRelationshipTimeWindow[];
  trends: ProductRelationshipTrend[];
  impact: ProductRelationshipImpact;
  confidence: ProductRelationshipConfidence;
  warnings: string[];
};
```

### ProductRelationshipItem

```ts
type ProductRelationshipItem = {
  source_product_id: string;
  related_product_id: string;
  related_product_handle?: string;
  related_product_title?: string;
  related_product_status?: string;
  relationship_type: "same_order" | "previous_purchase" | "next_purchase" | "temporal_window";
  direction: "together" | "before" | "after";
  window: "same_order" | "7d_before" | "14d_before" | "30d_before" | "60d_before" | "90d_before" | "7d_after" | "14d_after" | "30d_after" | "60d_after" | "90d_after";
  order_count: number;
  customer_count: number;
  unit_count: number;
  revenue: number;
  relationship_rate: number;
  lift: number | null;
  confidence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  trend: "rising" | "falling" | "stable" | "insufficient_data";
  return_rate_when_related: number | null;
  refund_rate_when_related: number | null;
  refund_amount_when_related: number | null;
  financial_impact_when_related: number | null;
  sample_size: number;
  warnings: string[];
};
```

### ProductRelationshipTimeWindow

```ts
type ProductRelationshipTimeWindow = {
  window: ProductRelationshipItem["window"];
  direction: ProductRelationshipItem["direction"];
  available: boolean;
  relationship_count: number;
  top_relationships: ProductRelationshipItem[];
  order_count: number;
  customer_count: number;
  confidence: number;
  warnings: string[];
};
```

### ProductRelationshipTrend

```ts
type ProductRelationshipTrend = {
  related_product_id: string;
  relationship_type: ProductRelationshipItem["relationship_type"];
  direction: ProductRelationshipItem["direction"];
  window: ProductRelationshipItem["window"];
  monthly: Array<{
    month: string;
    order_count: number;
    customer_count: number;
    unit_count: number;
    revenue: number;
    relationship_rate: number;
    return_rate_when_related: number | null;
    refund_rate_when_related: number | null;
  }>;
  trend: "rising" | "falling" | "stable" | "insufficient_data";
  confidence: number;
};
```

### ProductRelationshipImpact

```ts
type ProductRelationshipImpact = {
  available: boolean;
  same_order: {
    return_rate_when_related: number | null;
    return_rate_when_not_related: number | null;
    refund_rate_when_related: number | null;
    refund_rate_when_not_related: number | null;
    refund_amount_when_related: number;
    refund_amount_when_not_related: number;
    financial_impact_when_related: number;
    sample_size: number;
    sufficient_data: boolean;
  };
  sequence: {
    available: boolean;
    reason_unavailable?: string;
  };
  risk_modifier_recommendation: "none" | "relationship_context_only" | "future_scoring_candidate";
  diagnosis_confidence_effect: "none" | "increase" | "decrease" | "mixed" | "unknown";
  warnings: string[];
};
```

### ProductRelationshipConfidence

```ts
type ProductRelationshipConfidence = {
  score: number;
  label: "High" | "Medium" | "Low" | "Unavailable";
  components: {
    order_volume_score: number;
    basket_completeness_score: number;
    customer_identity_score: number;
    product_mapping_score: number;
    return_refund_join_score: number;
    trend_sample_score: number;
  };
  reasons: string[];
};
```

### ProductRelationshipInsightInput

This is a future read-only AI/UI input, not AI-generated output.

```ts
type ProductRelationshipInsightInput = {
  product: {
    product_id: string;
    title: string;
    handle?: string;
  };
  summary: ProductRelationshipSummary;
  compact_relationships: ProductRelationshipItem[];
  safe_context: {
    no_pii: true;
    customer_journeys_hidden: true;
    aggregate_only: true;
  };
};
```

## Metrics and formulas

### Same-order relationship rate

`relationship_rate = orders_containing_source_and_related / orders_containing_source`

### Same-order lift

`lift = P(related_product | source_product) / P(related_product)`

Use the same affinity approach already used in purchase context. If the store-wide denominator is incomplete, return `lift: null` and a warning.

### Previous/next relationship rate

`relationship_rate = customers_or_orders_with_related_in_window / customers_or_orders_with_source_product`

The denominator must be explicit. Customer-based rates are preferable for sequence relationships, while order-based rates can be used for same-order relationships.

### Relationship impact

For same-order impact:

- related cohort: source product line bought in an order containing the related product;
- not-related cohort: source product line bought without that related product;
- return/refund outcomes: matched to source product line, not simply to the whole order;
- order-level unattributed refunds in multi-product baskets must not be assigned to a product pair.

## Data collection strategy

### Current same-order pipeline

1. Use existing Catalog Scan order extraction to gather shop-wide sale events.
2. Group sale events by `shop + orderId`.
3. Build a distinct product set for each order.
4. For each product in the order, increment pair counts for every other product in that order.
5. Track product-level order counts for relationship rate and lift.
6. Track monthly cohort counts from the order date.
7. Join return/refund outcomes by `orderId + lineItemId` through existing return/refund relationship logic where available.
8. Persist top relationships and compact trend/impact summaries in `ProductRiskSnapshot.metrics`.

### Product Diagnosis pipeline

1. Use product-scoped sales events for the current product.
2. Use each sale event's `basketLineItems` to calculate same-order related products.
3. Mark relationship confidence lower when `basketLineItems` is missing.
4. Do not calculate customer sequence relationships in Product Diagnosis until customer key support exists.
5. Update the current product snapshot only.

### Future customer-sequence pipeline

Only after customer identity is safely available:

1. Extend Shopify order queries to read a stable customer identifier if permitted.
2. Normalize it to `customer_key`, preferably a shop-scoped hash.
3. Exclude emails, names, phones, addresses, and notes.
4. Group order-product events by `customer_key`.
5. Sort each customer's orders by order cohort date.
6. For every source product purchase, find related products in before/after windows.
7. Aggregate by product pair, direction, window, month, and impact cohorts.
8. Persist aggregate outputs only; do not store individual journeys in ProductPulse summaries.

### Recompute support

The service should support:

- one product recompute from Product Diagnosis source events;
- one shop recompute from Catalog Scan source events;
- future scheduled recompute through `CatalogSignalJob`;
- tenant isolation through server-derived `shop`;
- bounded top-N relationships to avoid large metrics JSON payloads.

Recommended limits:

- top 5 same-order relationships;
- top 5 previous relationships;
- top 5 next relationships;
- max 12 monthly trend points per relationship;
- max 5 relationship-impact rows.

## Privacy and identity

Relationship intelligence must be aggregate-only.

Rules:

- Do not expose customer names, emails, phone numbers, addresses, order notes, or individual customer journeys.
- Do not send PII to AI tools or model calls.
- Use server-derived `shop`; never accept shop/customer override from client or AI tool input.
- If customer identity is added later, prefer `customer.id` or equivalent stable platform id, then hash or tokenize it per shop before persistence.
- Guest/unknown customer events should remain in aggregate order data but excluded from sequence metrics requiring identity.
- AI outputs should receive product relationship aggregates only.

## Initial implementation plan

### New backend module

Create a future module:

`app/lib/product-pulse-product-relationships.server.js`

Suggested exports:

- `PRODUCT_RELATIONSHIP_SCHEMA_VERSION`
- `PRODUCT_RELATIONSHIP_MODEL_VERSION`
- `buildProductRelationshipSummary`
- `buildProductRelationshipSummaries`
- `getProductRelationshipSummaryForShop`
- `normalizeProductRelationshipSaleEvent`
- `normalizeProductRelationshipImpactEvent`

This mirrors the existing purchase-context and return/refund relationship modules.

### Snapshot metrics keys

Store future outputs under:

- `metrics.productRelationshipIntelligenceSummary`
- `metrics.productRelationshipFactors` only in later scoring phases, not Phase 1.

Do not change Product Risk, Diagnosis Confidence, recommended actions, or AI tools in Phase 1.

### Cache/table decision

Start with metrics JSON.

Reasons:

- Existing related analysis layers are stored in `ProductRiskSnapshot.metrics`.
- Product Detail and AI tools already load product-level summaries from snapshots.
- There is no local raw order table, so a dedicated relationship table would still depend on scan-time source events.
- Same-order top-N summaries are compact enough for metrics JSON.

Future table option:

`ProductRelationshipSnapshot`

Use only if needed for store-wide relationship graph queries or large trend retention:

- `shop`;
- `sourceProductGid`;
- `relatedProductGid`;
- `relationshipType`;
- `direction`;
- `window`;
- `metrics Json`;
- `calculatedAt`;
- indexes on `[shop, sourceProductGid]`, `[shop, relatedProductGid]`, and `[shop, relationshipType]`.

## How relationship data should later affect analysis

Not implemented in Phase 1, but planned inputs:

- Product Risk: same-order impact may reveal product-pair friction, but should not directly blame the source product without line-level outcomes.
- Diagnosis Confidence: confidence can decrease when negative outcomes happen only in multi-product contexts with weak attribution, or increase when a related pair has repeated line-level return/refund outcomes.
- Financial Exposure: related-pair cohorts can show whether refunds are concentrated in specific bundles or combinations.
- Return Pressure: same-order return pressure can show compatibility or expectation issues between products.
- Refund Leakage: refund-only outcomes in related-product baskets need careful attribution and should not over-blame either product.
- Recommended Actions: future recommendations may suggest bundle copy, compatibility messaging, cross-sell review, or variant/context clarification only when sample size is sufficient.

## Known unavailable outputs today

These must remain unavailable until required data exists:

- previous purchases by same customer;
- next purchases by same customer;
- 7/14/30/60/90 day before/after windows;
- customer-level retention or repurchase paths;
- individual customer journeys;
- PII-based matching;
- relationship AI insight generation;
- scoring changes from relationships.

## Readiness checklist for Phase 2

Before implementation beyond same-order relationships:

- Confirm Shopify scopes and privacy constraints for reading customer id.
- Add customer key extraction without PII exposure.
- Add tests for guest/unknown customers.
- Add tests for duplicate customer ids across shops to preserve tenant isolation.
- Add tests for same-order pair aggregation and lift.
- Add tests for before/after windows only after customer key is available.
- Add tests that order-level unattributed refunds do not affect pair-level impact.
- Add docs and AI-tool safety rules before exposing summaries to the assistant.
