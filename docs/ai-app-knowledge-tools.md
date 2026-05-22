# AI App Knowledge Tools

## Purpose

The app knowledge layer lets ProductPulse AI answer questions about how the application works without inventing methodology, formulas, settings, or workflows.

It is separate from product data access:

- Product/data tools read tenant-scoped ProductPulse records.
- App knowledge tools read curated ProductPulse documentation and implementation-backed explanations.
- App knowledge tools are read-only and do not mutate ProductPulse or Shopify data.

## Knowledge Sources

Curated user/developer knowledge lives in:

- `docs/app-knowledge/overview.md`
- `docs/app-knowledge/quick-analysis.md`
- `docs/app-knowledge/deep-analysis.md`
- `docs/app-knowledge/candidate-selection.md`
- `docs/app-knowledge/scoring.md`
- `docs/app-knowledge/watchlist.md`
- `docs/app-knowledge/dashboard.md`
- `docs/app-knowledge/analytics.md`
- `docs/app-knowledge/settings.md`
- `docs/app-knowledge/recommended-actions.md`
- `docs/app-knowledge/app-owned-actions.md`
- `docs/app-knowledge/product-detail-cards.md`
- `docs/app-knowledge/interaction-guidance.md`
- `docs/app-knowledge/glossary.md`

Runtime tools use the curated index in `app/ai/appKnowledge/knowledgeBase.ts` and guided next-step definitions in `app/ai/appKnowledge/interactionGuidance.server.ts`. The app does not scan arbitrary source files on every chat turn.

## Tools

Registered through the existing AI tool registry:

- `product_pulse_search_app_knowledge`
- `product_pulse_get_app_concept_explanation`
- `product_pulse_get_score_explanation`
- `product_pulse_get_screen_guide`
- `product_pulse_get_setting_explanation`
- `product_pulse_get_interaction_guidance`
- `product_pulse_search_product_detail_cards`
- `product_pulse_get_product_detail_card_explanation`

All tools are:

- read-only;
- provider-agnostic;
- independent from ChatKit;
- safe to expose through the existing OpenAI tool adapter;
- strict about input validation;
- unrelated to Shopify mutations.

`product_pulse_get_interaction_guidance` is used when the merchant request is broad or ambiguous. It returns supported next-step options and example prompts for product information, methodology explanations, watchlist work, creating ProductPulse actions, editing ProductPulse actions, and safe alternatives to direct Shopify mutations.

`product_pulse_get_product_detail_card_explanation` and `product_pulse_search_product_detail_cards` are used when the merchant asks what a visible product-page card, metric tile, timeline label, relationship metric, title, or subtitle means. They cover Overview, Recommended Actions, Product Momentum, Basket Context, Return pressure, Refund leakage, Lift, Return/refund resolution, Product relationship timeline, rates, and related detail cards.

## Merchant vs Developer Output

Default audience is `merchant`.

Merchant output includes:

- document title;
- section;
- explanation;
- formula/logic when documented;
- caveats and limitations.

Developer output may additionally include implementation references such as source files or function names. The assistant instructions tell the model not to expose developer references in normal merchant-facing answers.

## Scoring Explanations

The scoring knowledge currently documents:

- source coverage;
- risk score;
- confidence score;
- evidence strength;
- impact / estimated impact;
- revenue at risk;
- margin at risk;
- return rate;
- refund rate;
- review rating;
- negative review rate;
- QuickScan candidate score;
- priority score;
- Product Momentum;
- Velocity;
- Growth;
- Catalog share;
- Trend consistency;
- Recency;
- Lift;
- Return pressure;
- Refund leakage;
- Negative review pressure.

When a score or formula is unknown, the tool returns `found: false` and explicitly tells the assistant not to invent the formula.

## Presentation Blocks

The assistant response schema supports app knowledge blocks:

- `score_explanation`;
- `process_guide`;
- `screen_guide`;
- `setting_explanation`;
- `interaction_guidance`.

The ChatKit widget adapter maps these blocks into compact ProductPulse cards. These cards are deterministic UI payloads; the model does not control arbitrary HTML or styling.

## How To Update Knowledge

When ProductPulse behavior changes:

1. Update the relevant file in `docs/app-knowledge/`.
2. Update `app/ai/appKnowledge/knowledgeBase.ts`.
3. For guided next-step options, update `app/ai/appKnowledge/interactionGuidance.server.ts`.
4. Add or adjust unit tests in `tests/unit/product-pulse-ai-app-knowledge.test.js`.
5. If adding a new block type, update:
   - `app/ai/presentation/blocks.ts`;
   - `app/ai/chat/responseSchema.ts`;
   - `app/ai/chatkit/widgets.ts`;
   - tests.

## Unknowns

Unknown or partially documented behavior should stay explicit. The assistant should say ProductPulse does not document the detail clearly yet instead of guessing.

Known current unknowns:

- merchant-facing billing and final credit rules beyond the internal credit ledger;
- some Analytics view-model formulas that are documented conceptually but not as one exported formula;
- the full set of issue-specific recommendation templates.

## Testing

Unit tests cover:

- search relevance;
- merchant redaction of developer refs;
- developer refs when explicitly requested;
- score explanations and unknown score behavior;
- setting and screen guide lookup;
- registry integration;
- tenant override rejection through strict tool schemas;
- ChatKit mapping for app knowledge cards.
