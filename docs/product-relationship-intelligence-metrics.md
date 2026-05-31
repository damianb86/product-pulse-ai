# Product Relationship Intelligence metrics

Phase 2 scope: deterministic numerical relationship metrics, temporal windows, cohort processing, compact summaries, persistence in existing ProductPulse metrics JSON, and tests. No UI changes, no Product Risk scoring changes, no AI-generated insights, and no Shopify writes.

Phase 3 adds diagnosis/context integration on top of these metrics. See `docs/product-relationship-intelligence-diagnosis.md` for Product Risk context rules, recommendation gates, AI insight safety, and assistant tools.

## Implemented backend module

The calculation lives in:

`app/lib/product-pulse-product-relationships.server.js`

Main exports:

- `buildProductRelationshipSummary`
- `buildProductRelationshipSummaries`
- `getProductRelationshipSummaryForShop`
- `normalizeProductRelationshipSaleEvents`
- `normalizeProductRelationshipImpactEvents`

The module is read-only. It does not call Shopify, OpenAI, ChatKit, or write to Prisma. It consumes normalized order, return, and refund events produced by existing Catalog Scan and Product Diagnosis flows.

## Persistence

Relationship summaries are persisted under:

`ProductRiskSnapshot.metrics.productRelationshipIntelligenceSummary`

Catalog Scan calculates summaries shop-wide from the extracted order event set and stores the product-specific summary on each persisted candidate.

Product Diagnosis calculates the current product summary from product-scoped sales, returns, refunds, and available `basketLineItems`.

Product Detail serialization preserves the persisted summary for future phases, but Phase 2 does not render it.

## Relationship types

### Same-order

Products bought in the same Shopify order.

Current support: available when order basket line items are known.

Direction:

`together`

Window:

`same_order`

### Previous purchase

Products bought by the same customer before buying the source product.

Current support: available when sale events contain a safe customer key such as `customerKey` or a non-PII platform customer id. Shopify extraction reads `order.customer.id` when `read_customers` is granted and stores it internally as `customerKey`.

Direction:

`before`

Windows:

- `7d_before`
- `14d_before`
- `30d_before`
- `90d_before`

### Next purchase

Products bought by the same customer after buying the source product.

Current support: same customer-key limitation as previous purchase.

Direction:

`after`

Windows:

- `7d_after`
- `14d_after`
- `30d_after`
- `90d_after`

## Same-order formulas

For source product `A` and related product `B`:

`coOrderCount = count(orders containing A and B)`

`attachRate = orders_with_A_and_B / orders_with_A`

`relatedProductBaseRate = orders_with_B / total_known_basket_orders`

`lift = attachRate / relatedProductBaseRate`

`coUnitCount = units of B in orders containing A and B`

`coRevenue = line revenue of B in orders containing A and B`

Products are not ranked by raw `coOrderCount` alone. Ranking uses deterministic relationship strength first, then lift, relationship rate, and only then raw count as a tie-breaker. This prevents broadly popular products from dominating every relationship list.

## Previous/next formulas

For source product `A`, related product `B`, customer set `C`, and window `W`:

`relationshipRate = customers_who_bought_B_in_window / customers_who_bought_A`

`liftBefore` or `liftAfter = relationshipRate / customer_base_rate_of_B`

`customer_base_rate_of_B = customers_who_bought_B / total_known_customers`

`medianDaysBefore` / `medianDaysAfter` is the median absolute day difference between the source purchase and the related purchase.

`avgDaysBefore` / `avgDaysAfter` is the average absolute day difference.

`followOnRevenue` is returned for next-purchase relationships and represents related-product line revenue in after-window orders.

Previous and next are directional. `A -> B after 30 days` is stored separately from `B -> A after 30 days`.

## Cohort and trend processing

Relationship trends use the cohort month of the source product purchase.

Each monthly row includes:

- `month`
- `source_product_orders`
- `related_order_count`
- `customer_count`
- `unit_count`
- `revenue`
- `relationship_rate`
- `lift` when calculable
- `confidence`

Trend classification:

- `insufficient_data`: fewer than two source cohort months.
- `emerging`: only one non-zero relationship month and the latest month is non-zero.
- `fading`: first month is non-zero and latest month is zero.
- `increasing`: latest rate is at least `0.15` higher than the first rate, or at least `1.35x` the first rate.
- `decreasing`: latest rate is at least `0.15` lower than the first rate, or no more than `0.65x` the first rate.
- `stable`: none of the above.

Low-volume trends should not be interpreted as causal or definitive.

## Relationship strength

Relationship strength is deterministic and documented. It is not an AI score.

Inputs:

- relationship rate;
- lift;
- sample size;
- customer count;
- confidence;
- trend classification;
- number of active months.

Score components:

- relationship rate: up to `32` points;
- lift above `1.0`: up to `24` points;
- sample size: up to `16` points;
- customer count: up to `10` points;
- monthly consistency: up to `8` points;
- positive/stable trend: up to `5` points;
- confidence: up to `10` points.

Qualitative levels:

- `very_strong`: `75+`
- `strong`: `60-74.9`
- `moderate`: `40-59.9`
- `weak`: `20-39.9`
- `insufficient_data`: sample size below `2` or confidence below `25`

## Relationship confidence

Confidence is deterministic and separate from strength.

Confidence increases when:

- sample size is sufficient;
- basket data is known;
- customer identity is available for sequence relationships;
- the related product maps to a known catalog product;
- the relationship appears across more than one month;
- lift is meaningful.

Confidence decreases when:

- sample size is low;
- customer identity is missing for previous/next relationships;
- a single customer dominates the signal;
- related product data is missing or deleted;
- basket context is incomplete.

Warnings include:

- `customer_identity_unavailable`
- `low_sample_size`
- `single_customer_dominates`
- `related_product_not_in_catalog`
- `basket_context_incomplete_warning`

## Return/refund impact

Same-order relationships calculate source-product outcome deltas.

For source product `A` and related product `B`:

- `returnRateWhenBoughtTogether`
- `refundRateWhenBoughtTogether`
- `refundAmountWhenBoughtTogether`
- `returnRateWhenNotBoughtTogether`
- `refundRateWhenNotBoughtTogether`
- `deltaReturnRate`
- `deltaRefundRate`

Rules:

- Outcomes are matched to the source product line by `lineItemId` where possible.
- Product-level match is allowed when the event has the source product id.
- Order-level unattributed refunds in multi-product baskets must not be used as pair-level impact.
- Before/after sequence impact is marked non-causal and is not used to claim risk causality in Phase 2.

## Product-level summary fields

`productRelationshipIntelligenceSummary` includes:

- `same_order_relationships`
- `previous_purchase_relationships`
- `next_purchase_relationships`
- `relationship_trends`
- `relationship_impact`
- `top_bought_together`
- `top_bought_before`
- `top_bought_after`
- `strongest_relationships`
- `emerging_relationships`
- `relationships_with_return_risk_impact`
- `relationships_with_cross_sell_opportunity`
- `warnings`
- `confidence`
- `data_basis`

Outputs are compact and top-N bounded. Raw order lists and customer journeys are never returned.

## Processing strategy

Catalog Scan:

1. Extract catalog and order events.
2. Build product indexes and order/basket state.
3. Calculate summaries for all products in the extracted event set.
4. Attach each summary to persisted candidate metrics.

Product Diagnosis:

1. Use product-scoped sales, returns, refunds, and basket line items.
2. Calculate the current product summary.
3. Persist it in the updated product snapshot.

Recompute:

- one product: rerun Product Diagnosis;
- one shop: rerun Catalog Scan;
- scheduled recomputation: use existing job patterns in future phases.

## Privacy and PII

The module does not output customer identifiers.

Customer sequence metrics use `customerKey` internally only when supplied by upstream normalized events. Shopify customer GIDs can be used as the key; emails are ignored as customer keys. Individual customer journeys are not persisted or exposed.

AI tools are not updated in Phase 2. Future AI tools must expose aggregate summaries only and must not send PII to the model.

## Current limitations

- Previous/next relationships require `read_customers` and sale events with `customerKey`; without that scope or cached key, customer-sequence metrics remain unavailable.
- There are no local raw order tables, so relationship history is limited by scan/diagnosis windows and cached event availability.
- Large baskets can be limited by Shopify line-item page size.
- Deleted products may appear as unknown related products if not present in the scanned catalog.
- Relationship impact is observational. It must not be described as causality.
- Phase 2 does not update Product Risk, Diagnosis Confidence, Recommended Actions, UI cards, charts, or AI-generated explanations.
