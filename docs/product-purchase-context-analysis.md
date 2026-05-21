# Product purchase context analysis

Product Purchase Context explains how a product is bought inside Shopify orders. It is a diagnostic layer for understanding basket behavior before changing Product Risk, Diagnosis Confidence, or UI cards.

This phase is read-only. It does not call Shopify mutations and does not write anything back to Shopify.

## Purpose

The analysis answers:

- Is the product usually bought alone or with other products?
- Do customers buy one unit or several?
- Are high-quantity orders common?
- Do customers buy multiple variants of the same product in the same order?
- Which products are meaningfully bought together?
- Is future return/refund behavior potentially dependent on basket context?

## Purchase context buckets

Implemented buckets:

- `solo_product_order`: the order contains this product and no other distinct product.
- `multi_product_order`: the order contains this product plus at least one other distinct product.
- `single_unit_purchase`: the order contains exactly one unit of this product.
- `multi_unit_purchase`: the order contains more than one unit of this product.
- `bulk_purchase`: the order contains a high quantity of this product.
- `multi_variant_same_product_order`: the order contains more than one variant of this product.
- `bundled_or_associated_purchase`: the product is commonly bought with one or more other products.

`bundled_or_associated_purchase` is derived from co-purchase frequency and affinity. It does not assume Shopify bundle configuration exists.

## Summary fields

The backend stores or returns `productPurchaseContextSummary` with:

- `product_id`
- `total_orders_containing_product`
- `total_units_sold`
- `total_revenue_if_available`
- `solo_product_order_count`
- `multi_product_order_count`
- `single_unit_order_count`
- `multi_unit_order_count`
- `bulk_order_count`
- `multi_variant_order_count`
- `avg_product_quantity_per_order`
- `median_product_quantity_per_order`
- `avg_distinct_products_per_order`
- `avg_total_units_per_order`
- `top_co_purchased_products`
- `purchase_context_confidence`
- `purchase_context_confidence_label`
- `unknown_or_incomplete_order_count`
- `quantity_distribution`
- `monthly_context`
- `context_buckets`

QuickScan writes this into `ProductRiskSnapshot.metrics.productPurchaseContextSummary` for persisted candidates. Deep diagnosis also adds it to diagnosis metrics and the updated snapshot metrics when basket context is available.

## Formulas

All rates are decimals between `0` and `1`.

- `solo_purchase_rate = solo_product_order_count / total_orders_containing_product`
- `multi_product_basket_rate = multi_product_order_count / total_orders_containing_product`
- `single_unit_purchase_rate = single_unit_order_count / total_orders_containing_product`
- `multi_unit_purchase_rate = multi_unit_order_count / total_orders_containing_product`
- `bulk_purchase_rate = bulk_order_count / total_orders_containing_product`
- `multi_variant_order_rate = multi_variant_order_count / total_orders_containing_product`
- `avg_product_qty_per_order = total_units_sold / total_orders_containing_product`

All division by zero returns `0`.

## Quantity distribution

The service returns:

- `one_unit_count`
- `two_unit_count`
- `three_unit_count`
- `four_plus_unit_count`
- corresponding rates

The default bulk threshold is `4+` units. When at least 20 product-containing orders are available, the threshold can move higher based on the 90th percentile of observed product quantities. This keeps the threshold conservative and avoids treating ordinary two-unit purchases as bulk.

## Co-purchase affinity

Top co-purchased products include:

- `productId`
- `title`
- `handle`
- `co_order_count`
- `co_order_rate`
- `co_order_rate_basis`
- `affinity_score`

Affinity formula:

`affinity_score = P(other_product | this_product) / P(other_product)`

Sorting uses affinity first, then co-order count. This prevents common best sellers from dominating unless they are truly associated with the product.

## Monthly context

Monthly aggregation uses order cohort month.

Fields per month:

- `orders_containing_product`
- `units_sold`
- `solo_product_orders`
- `multi_product_orders`
- `avg_product_quantity_per_order`
- `multi_variant_orders`
- `bulk_orders`

Event-month reporting is not implemented in Phase 1.

## Confidence logic

`purchase_context_confidence` is a 0-100 score.

Confidence increases when:

- enough product-containing orders exist;
- basket composition is known;
- product quantities are available;
- variant ids are available;
- product/variant mapping is complete.

Confidence decreases when:

- sample size is small;
- product-scoped sales lack `basketLineItems`;
- line items are missing product ids;
- quantities are missing;
- variant data is missing;
- orders have incomplete basket context.

Labels:

- `High`: 80+
- `Medium`: 55-79.9
- `Low`: greater than 0 and below 55
- `Unavailable`: 0

## Relationship to Product Risk and Diagnosis Confidence

Phase 1 does not change scoring.

Phase 2 integrates the summary as a bounded diagnostic modifier under scoring version `purchase_context_v3`.

Future Product Risk use:

- high return/refund rates in solo purchases may point more directly at product fit, quality, or expectation issues;
- high return/refund rates only in multi-product baskets may point at bundle confusion, compatibility, substitutions, or cross-sell mismatch;
- bulk purchases with returns may indicate reseller/customer-type behavior rather than ordinary product quality;
- multi-variant same-product purchases can explain sizing/color exploration and may need separate interpretation from ordinary returns.

Implemented Product Risk use:

- solo purchases strengthen attribution only when negative signals already exist;
- multi-product baskets reduce confidence in weak order-level refunds;
- multi-variant orders add a small variant/fit/expectation modifier when returns are present;
- bulk purchases add bounded severity only when return/refund evidence exists;
- healthy bulk behavior with low return/refund rates does not increase risk.

Future Diagnosis Confidence use:

- confidence should rise when basket context is complete and relationship-aware return/refund data aligns with basket patterns;
- confidence should fall when basket context is unknown, co-purchase data is sparse, or return/refund outcomes cannot be joined to order lines.

Implemented Diagnosis Confidence use:

- purchase-context confidence contributes to evidence strength;
- mostly solo purchases can increase attribution confidence;
- incomplete basket context and small samples reduce confidence;
- multi-product baskets with weak refund attribution reduce product-specific confidence.

## Future return/refund integration

Phase 2 can combine this summary with `returnRefundRelationshipSummary` to calculate:

- return rate when bought alone;
- return rate when bought with other products;
- refund leakage when bought alone;
- refund leakage when bought with other products;
- return/refund severity for bulk orders;
- return/refund severity for multi-variant orders;
- confidence penalties for unresolved basket context.

The join should be deterministic by `orderId + lineItemId` where possible and conservative when attribution is weak.

Implemented in Phase 2:

- return/refund outcome segments by bought-alone, bought-with-others, single-unit, multi-unit, bulk, and multi-variant contexts;
- segment rates are exposed in backend scoring factors;
- segments are marked with `sufficient_data` and should only drive explanations or actions when data volume is adequate.

## Recalculation

Recompute/backfill updates ProductPulse snapshot metrics with:

- `productPurchaseContextFactors`;
- `productPurchaseContextScoringImpact`;
- `purchaseContextSignalBreakdown`;
- updated risk, impact, confidence, evidence strength, and scoring version.

Scopes:

- one product;
- one shop;
- all shops with bounded limits.

Snapshots without `productPurchaseContextSummary` cannot reconstruct historical basket context because raw orders are not stored.

## Minimum sample rules

Most purchase-context scoring and recommendation boosts require:

- at least 5 product-containing orders;
- purchase-context confidence of at least 55%;
- existing negative evidence such as returns, refunds, or reviews.

Weak purchase context may still lower confidence when it reveals incomplete baskets or ambiguous multi-product refund attribution.

## Future UI ideas

Potential UI surfaces:

- Purchase context card near Customer Signals.
- Solo vs basket segmented bar.
- Quantity distribution mini chart.
- Top co-purchased products list with affinity.
- Basket-context warning inside Return & refund resolution when returns differ by solo vs multi-product orders.

These are not implemented in Phase 1.

## Limitations

- No raw relational order persistence exists.
- Shopify order access can be denied.
- Very large orders may exceed line-item page limits.
- Historical context starts after QuickScan or deep diagnosis stores this summary.
- Co-purchase rates are window-based, not full-store lifetime rates.
- Shopify bundle configuration is not detected.
- Return/refund context by basket is future work.
