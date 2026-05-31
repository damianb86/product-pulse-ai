# Product Relationship Intelligence presentation

Phase 4 exposes deterministic product relationship metrics in the product detail page and AI assistant. It does not write to Shopify and does not create Shopify mutation payloads.

## Product Detail Section

Section title: `Product relationships`.

Placement: after `Purchase context` and before `Return & refund resolution`.

The placement keeps the diagnostic flow readable:

- purchase context explains basket behavior;
- product relationships explain product-to-product associations;
- return/refund resolution explains financial outcomes.

## Cards

### Bought Together

Shows the top same-order relationship.

Fields:

- related product title;
- attach rate;
- lift;
- order count;
- strength;
- trend;
- confidence.

Tooltip:

“Attach rate is the share of source-product orders that also included the related product. Lift adjusts for how common the related product is overall.”

### Bought Before

Shows the top previous-purchase relationship when customer sequence data is available.

Fields:

- related product title;
- timing window;
- relationship rate;
- lift;
- median days before;
- customer/sample count;
- confidence.

Empty state:

“Customer identity is unavailable, so before relationships cannot be calculated.”

### Bought After

Shows the top next-purchase relationship.

Fields:

- related product title;
- timing window;
- relationship rate;
- lift;
- median days after;
- follow-on revenue when available;
- confidence.

### Risk Context

Shown only when a relationship has enough sample size and confidence and has a positive return/refund delta.

Rules:

- sample size at least 3;
- confidence at least 55;
- positive return or refund delta.

The card uses associative language only. It does not claim causality.

## Timeline

The compact timeline shows:

- top product bought before;
- top product bought in the same order;
- current product;
- top product bought after.

It is intentionally not a network graph. The goal is fast merchant comprehension, not dense relationship exploration.

## Trend Chart

The trend chart shows at most the top 3 relationships with stored monthly relationship-rate data.

It uses small bars rather than a large chart to avoid clutter.

## Relationship Table

The table includes segmented views:

- Together;
- Before;
- After;
- Risk impact.

Columns:

- Product;
- Relationship;
- Window;
- Rate;
- Lift;
- Strength;
- Confidence;
- Risk impact.

Rows are capped to keep the section compact.

## AI Insight Text

The section displays up to 3 stored AI-written relationship insights.

Rules:

- text must come from sanitized backend output;
- no raw orders;
- no customer data;
- no PII;
- no causal overclaiming;
- caveats are displayed when provided.

## Empty States

The UI distinguishes:

- relationship metrics not calculated;
- no strong product relationships detected;
- same-order data available but customer sequence unavailable;
- low-confidence relationship risk that should not be emphasized.

Messages:

- “Not enough order history to detect product relationships yet.”
- “No strong product relationships detected.”
- “Customer identity is unavailable, so before relationships cannot be calculated.”
- “No meaningful return/refund relationship impact detected.”

## ChatKit Widgets

Supported assistant cards:

- `product_relationship_summary`
- `product_relationship_timeline`
- `product_relationship_risk`
- `product_relationship_opportunity`

Widgets render compact, sanitized summaries only. They do not expose customer journeys, raw order IDs, customer identifiers, names, emails, or other PII.

## Assistant Behavior

The assistant can answer:

- what products are bought with this product;
- what customers buy before it;
- what customers buy after it;
- whether there is a cross-sell, bundle, or journey opportunity;
- whether return/refund outcomes are worse in a related-product context.

The assistant should use “association”, “relationship”, “pattern”, or “opportunity” language unless future causal evidence is added.

## Limitations

- Previous/next relationships require customer identity.
- Low-volume products may have high lift but low confidence.
- Deleted or renamed related products may show title-only records.
- Relationship impact is associative, not causal.
- Product relationships are contextual signals and do not replace direct return, refund, review, evidence, or estimated margin exposure signals.
