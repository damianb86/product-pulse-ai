# Generated Demo Data Scenarios

## Generated Products Added

- GEN RELTEST Source Product
- GEN RELTEST Bought Together Product
- GEN RELTEST Bought Before Product
- GEN RELTEST Bought After Product
- GEN RELTEST Multi Variant Product
- GEN RELTEST Bulk Quantity Product
- GEN RELTEST Return Refund Product
- GEN RELTEST Refund Only Product

## What To Inspect

Inspect this product first:

- GEN RELTEST Source Product

Also inspect these for Return & Refund Resolution buckets:

- GEN RELTEST Return Refund Product
- GEN RELTEST Refund Only Product

Expected sections:

- Purchase Context
- Product Relationships
- Return & Refund Resolution
- Customer Signals
- Product Risk
- Diagnosis Confidence
- AI assistant relationship explanations

## Orders Creating The Relationship

The RELTEST orders are appended after the existing 200 generated orders and keep the existing `ppgen-order-N` indexing.

- `ppgen-order-201` to `ppgen-order-204`: source product solo orders.
- `ppgen-order-205` to `ppgen-order-210`: source product bought with GEN RELTEST Bought Together Product.
- `ppgen-order-204`: source product bulk quantity order, quantity 4.
- `ppgen-order-209`: source product multi-variant same-product order, Standard plus Extended variants in one order.
- `ppgen-order-211`: GEN RELTEST Return Refund Product return plus refund case.
- `ppgen-order-212`: GEN RELTEST Return Refund Product return-only case.
- `ppgen-order-213`: GEN RELTEST Refund Only Product refund-only case.
- `ppgen-order-214`, `ppgen-order-217`, `ppgen-order-220`, `ppgen-order-223`: GEN RELTEST Bought Before Product bought by RELTEST customers before the source product.
- `ppgen-order-215`, `ppgen-order-218`, `ppgen-order-221`, `ppgen-order-224`: GEN RELTEST Source Product bought by the same RELTEST customers 16 days after the before product.
- `ppgen-order-216`, `ppgen-order-219`, `ppgen-order-222`, `ppgen-order-225`: GEN RELTEST Bought After Product bought by the same RELTEST customers 15 days after the source product.

Visible relationship:

- Bought together: GEN RELTEST Bought Together Product.
- Co-order count: 6 source orders.
- Source-product denominator: 14 source orders.
- Source solo orders: 8.
- Source basket orders: 6.
- Bought before: GEN RELTEST Bought Before Product, 4 customers.
- Bought after: GEN RELTEST Bought After Product, 4 customers.

## Customer IDs For Before/After Sequences

The customer stage creates 24 fake Shopify customers. Every generated Shopify order is assigned to one of these customers so `order.customer.id` is available as the safe internal `customerKey`; names and emails are not needed for analytics.

Customer groups:

- RELTEST_CUSTOMER_001 to RELTEST_CUSTOMER_004: reserved for before/source/after sequence relationships.
- RELTEST_CUSTOMER_005 to RELTEST_CUSTOMER_017: one isolated customer per non-sequence RELTEST order, so solo, basket, quantity and return/refund orders do not pollute before/after sequence relationships.
- RELTEST_CUSTOMER_018 to RELTEST_CUSTOMER_024: general deterministic customers reused across the 200 base historical orders and the recent evolution orders.

Important compatibility note:

- If old generated Shopify orders already exist without a customer, the generator logs them as legacy customerless orders and creates customer-attributed replacement orders for the same generated plan. Shopify generally does not allow deleting orders, so the generator does not require deletion.

- RELTEST_CUSTOMER_001: buys GEN RELTEST Bought Before Product, then GEN RELTEST Source Product, then GEN RELTEST Bought After Product.
- RELTEST_CUSTOMER_002: buys GEN RELTEST Bought Before Product, then GEN RELTEST Source Product, then GEN RELTEST Bought After Product.
- RELTEST_CUSTOMER_003: buys GEN RELTEST Bought Before Product, then GEN RELTEST Source Product, then GEN RELTEST Bought After Product.
- RELTEST_CUSTOMER_004: buys GEN RELTEST Bought Before Product, then GEN RELTEST Source Product, then GEN RELTEST Bought After Product.

Customer sequence order mapping:

- RELTEST_CUSTOMER_001: `ppgen-order-214` -> `ppgen-order-215` -> `ppgen-order-216`.
- RELTEST_CUSTOMER_002: `ppgen-order-217` -> `ppgen-order-218` -> `ppgen-order-219`.
- RELTEST_CUSTOMER_003: `ppgen-order-220` -> `ppgen-order-221` -> `ppgen-order-222`.
- RELTEST_CUSTOMER_004: `ppgen-order-223` -> `ppgen-order-224` -> `ppgen-order-225`.

Expected result:

- Bought-before: GEN RELTEST Bought Before Product.
- Bought-after: GEN RELTEST Bought After Product.
- Time window: 30-day and 90-day relationship windows should have non-zero counts. The 7-day and 14-day windows should not capture these sequence orders because the deterministic gap is 15 to 16 days.

## Returns And Refunds Added

For GEN RELTEST Source Product:

- `reltest-risk-return-refund`: return plus refund on a source line bought with the companion product.
- `reltest-risk-return-only`: return without refund on a source line bought with the companion product.
- `reltest-risk-refund-only`: refund without return on a source line bought with the companion product.
- `reltest-source-together-multi-variant`: exchange/replacement return on a source line; customer returns Standard Pack and the shop sends Extended Pack without refund.

For GEN RELTEST Return Refund Product:

- `reltest-return-refund-both`: returned and refunded.
- `reltest-return-only`: returned without refund.

For GEN RELTEST Refund Only Product:

- `reltest-refund-only`: refunded without return.

Variant exchange examples outside RELTEST:

- GEN Linen Shirt Fit Lab: size exchange note from Medium White to Large.
- GEN Rose Tone Earbuds: color exchange note from Rose to Black.
- Recent evolution batch also includes new size and color exchange return notes for those same variant families.

Not generated:

- Unattributed order-level refund: unavailable in the current generator because the existing refund generator creates line-item refunds.
- Native Shopify exchange-line-item objects are not generated by the current script; exchange/replacement is intentionally represented through return notes because ProductPulse's current resolution logic classifies that bucket from source text.

## Reviews Added

The Settings reviews stage writes the same normalized CSV format as before: `mock-reviews-<runId>.normalized.csv`.

- GEN RELTEST Source Product: 12 reviews with basket, bundle, bulk and variant language.
- GEN RELTEST Bought Together Product: 8 reviews with mostly positive companion-product language.
- GEN RELTEST Bought Before Product: 4 reviews with neutral-positive setup/companion language.
- GEN RELTEST Bought After Product: 4 reviews with neutral-positive follow-on product language.
- GEN RELTEST Multi Variant Product: 6 reviews with variant comparison language.
- GEN RELTEST Bulk Quantity Product: 5 reviews with quantity expectation language.
- GEN RELTEST Return Refund Product: 8 reviews aligned with defective, returned and unresolved resolution language.
- GEN RELTEST Refund Only Product: 6 reviews aligned with goodwill refund without physical return.

The CSV headers and row shape are unchanged.

## Expected Analytics

Product Relationships on GEN RELTEST Source Product:

- Bought together should show GEN RELTEST Bought Together Product.
- Attach rate should be 6 / 14 source orders when source-order basket context is used.
- Lift may be higher when Catalog Scan has store-wide order context.
- Risk impact should be positive because source returns/refunds are concentrated in bought-together orders while source solo orders are clean.
- Bought before should show GEN RELTEST Bought Before Product with 4 customers.
- Bought after should show GEN RELTEST Bought After Product with 4 customers.

Purchase Context on GEN RELTEST Source Product:

- Total source orders: 14.
- Solo source orders: 8.
- Multi-product basket source orders: 6.
- Single-unit source orders: 11.
- Multi-unit source orders: 3.
- Bulk source orders: 1, quantity 4.
- Multi-variant same-product source orders: 1.
- Co-purchased product: GEN RELTEST Bought Together Product.

Return & Refund Resolution:

- GEN RELTEST Source Product should show return plus refund, return only, and refund only activity in bought-together baskets.
- GEN RELTEST Source Product should show exchange/replacement activity from the multi-variant source return.
- GEN RELTEST Return Refund Product should show returned-and-refunded and returned-not-refunded buckets.
- GEN RELTEST Refund Only Product should show refunded-without-return.
- Unattributed refund should remain unavailable or zero.

Reviews and evidence:

- Customer Signals and evidence snippets should include RELTEST bundle confusion, source quantity/bulk expectations, variant comparison, defective return language, and goodwill refund language.
- Product Risk and Diagnosis Confidence should treat calculated metric changes as supporting context, with raw orders, returns, refunds and reviews as the primary RELTEST evidence.

## Recompute / Refresh Behavior

The Settings generator creates Shopify products, Shopify orders, Shopify returns/refunds, and the CSV review source. It does not automatically run Catalog Scan or deep Product Diagnosis after the data is generated.

After generation:

- Run the Settings mock dataset stages through `manifest`, or run `all`.
- Run Catalog Scan to refresh catalog-wide snapshots and Product Relationship Intelligence with store-wide context.
- Open GEN RELTEST Source Product and run Product Diagnosis to refresh the product detail metrics.
- Open GEN RELTEST Return Refund Product and GEN RELTEST Refund Only Product for the dedicated resolution buckets.
