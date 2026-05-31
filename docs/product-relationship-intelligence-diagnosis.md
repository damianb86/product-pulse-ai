# Product Relationship Intelligence diagnosis integration

Phase 3 scope: use deterministic product relationship metrics as diagnosis context, recommendation inputs, compact AI-written insights, read-only assistant tools, and assistant-only ChatKit cards. No product detail UI changes and no Shopify mutations.

Phase 4 presents these metrics in the product detail UI and adds richer ChatKit relationship cards. See `docs/product-relationship-intelligence-presentation.md`.

## Product Risk

Product relationships are contextual signals. They do not directly overwrite Product Risk and they do not add a blind risk-score lift.

Implemented behavior:

- Same-order relationships with higher return/refund rates add `productRelationshipContextScore` metadata and explanation text.
- `productRelationshipRiskAdjustment` is always `0` in this phase.
- Sequential relationships such as products bought after the source product are treated as commercial opportunity, not risk.
- Strong bought-together relationships without negative outcomes can create a merchandising recommendation, but they do not increase Product Risk.
- Complex baskets plus weak return/refund attribution can reduce diagnosis confidence instead of blaming the source product.

Valid conclusion:

“Return/refund pressure is higher when this product is bought with Product B, so the pairing should be reviewed.”

Invalid conclusion:

“Product B causes this product’s returns.”

## Diagnosis Confidence

Relationship data affects confidence more than risk.

Confidence can increase when:

- relationship evidence is sufficiently sampled;
- a pattern is stable across source cohorts;
- the relationship context supports a consistent deterministic diagnosis.

Confidence can decrease when:

- bad outcomes happen only in complex baskets;
- refunds are order-level or unattributed;
- the relationship is low-volume;
- one customer dominates the relationship;
- the related product may be the real source of ambiguity.

The scoring model stores:

- `productRelationshipContextScore`
- `productRelationshipSequenceStabilityScore`
- `productRelationshipAmbiguityPenalty`
- `productRelationshipLowEvidencePenalty`
- `productRelationshipCustomerDominancePenalty`

## Recommendations

Relationship recommendations are generated only when sample size and confidence are sufficient.

Minimum action gate:

- summary order count at least `3`;
- summary confidence at least `55`;
- relationship sample size at least `3`;
- relationship confidence at least `55`.

Generated recommendation types:

- `test-product-bundle`: high-lift same-order relationship with no elevated return/refund impact.
- `create-post-purchase-cross-sell`: product commonly bought after the source product.
- `review-product-pairing-expectations`: return/refund pressure is higher when bought with a related product.
- `position-as-upgrade-path`: product commonly bought after another product, suggesting an upgrade/refill/next-step path.

Recommendations are app-owned ProductPulse workflow suggestions. They do not write to Shopify and they do not imply the assistant can mutate Shopify.

## AI Insights

AI-generated relationship insights are optional and compact.

The backend calculates all numbers first. The AI receives only a sanitized summary:

- source product title and handle;
- related product title/id;
- relationship type and direction;
- time window;
- relationship strength;
- lift;
- confidence;
- sample size;
- trend;
- return/refund deltas;
- deterministic caveats.

The AI does not receive:

- raw orders;
- order ids;
- customer ids;
- customer names, emails, phone numbers, or addresses;
- line item payloads;
- unbounded raw datasets.

Model configuration:

- Preferred env: `AI_RELATIONSHIP_INSIGHTS_MODEL`
- Fallback env: `AI_CHAT_MODEL`
- Existing fallback chain: `OPENAI_PRO_MODEL`, `OPENAI_PREMIUM_MODEL`, `OPENAI_BASIC_MODEL`
- Default fallback model: `gpt-5.4-mini`

Insights are persisted in:

`ProductRiskSnapshot.metrics.productRelationshipAiInsights`

and copied into:

`ProductRiskSnapshot.metrics.diagnosisReport.relationshipInsights`

The app does not regenerate relationship AI insights on every page load.

## AI Safety Rules

The prompt and normalizer enforce:

- no invented relationships;
- no invented product names;
- no invented percentages or counts in generated prose;
- no causal claims;
- no customer-level data;
- no PII;
- no direct Shopify mutation recommendations;
- low-confidence caveats when the source relationship has low confidence or low sample size.

AI insight rows must reference a deterministic `source_relationship_id`. Unknown source ids are discarded.

## AI Tools

Read-only tools added:

- `product_pulse_get_product_relationship_summary`
- `product_pulse_get_product_bought_together_relationships`
- `product_pulse_get_product_previous_purchase_relationships`
- `product_pulse_get_product_next_purchase_relationships`
- `product_pulse_get_product_relationship_risk_impact`
- `product_pulse_get_product_relationship_insights`

All tools read compact summaries from ProductPulse storage, preserve tenant isolation through server context, and return no PII or raw order/customer records.

## AI ChatKit Cards

The assistant presentation schema supports `product_relationship_summary`.

The card shows:

- relationship confidence;
- compact top relationships;
- direction: together, before, or after;
- lift, sample size, and timing window when available;
- return/refund delta context when available;
- a short risk-context and opportunity summary.

The card is generated from deterministic tool or backend output only. It does not expose raw orders, customer journeys, customer identifiers, or PII.

## Limitations

- Previous/next relationships require customer sequence data; when customer keys are unavailable, these remain unavailable or low-confidence.
- Relationship impact is associative, not causal.
- Low-volume products can show high lift from a small number of orders; confidence and caveats should be used.
- Deleted or renamed related products may appear as title-only records.
- Product relationships do not replace return/refund relationship analysis, purchase context, reviews, or direct diagnosis evidence.
