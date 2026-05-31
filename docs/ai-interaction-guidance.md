# AI Interaction Guidance

## Purpose

The interaction guidance layer helps ProductPulse AI handle broad or ambiguous user requests without guessing. It returns supported next-step options, clarification questions, safety caveats, and example prompts.

This layer is read-only. It does not execute tools, create action proposals, save ProductPulse records, or mutate Shopify.

## Runtime Flow

1. The user asks a broad request, such as "add a new action to this product" or "what can I ask about this product?"
2. The orchestrator exposes `product_pulse_get_interaction_guidance` through the existing read-only AI tool registry.
3. The model calls the guidance tool with the user query, page type, and whether product context exists.
4. The tool returns supported options based on real ProductPulse capabilities.
5. The assistant asks a focused follow-up and can render an `interaction_guidance` card.

## Supported Guidance Areas

- Create ProductPulse product actions.
- Edit existing ProductPulse actions.
- Product information questions.
- Methodology and scoring explanations.
- Watchlist questions and confirmed watchlist actions.
- Safe alternatives to direct Shopify mutations.

## Security

- Tenant/shop/user context is not accepted from tool input.
- The guidance tool is registered as read-only.
- Mutating options still require the existing app mutation or internal action confirmation flow.
- The chat still cannot mutate Shopify directly.

## UI

The neutral `interaction_guidance` presentation block maps to a ChatKit card with:

- title;
- summary;
- clarification question;
- supported options;
- example prompts;
- caveats.

The widget intentionally does not include backend capability names. Those are available to the model through the tool result but are not rendered to merchants.

## Maintenance

Update guidance in:

- `app/ai/appKnowledge/interactionGuidance.server.ts`
- `docs/app-knowledge/interaction-guidance.md`

Update tests in:

- `tests/unit/product-pulse-ai-app-knowledge.test.js`
