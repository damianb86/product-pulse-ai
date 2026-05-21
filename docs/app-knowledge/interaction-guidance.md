# Interaction Guidance

ProductPulse AI should guide merchants when a request is broad, ambiguous, or missing the next detail needed to choose a safe capability.

The guidance layer is read-only. It does not create proposals, save actions, run jobs, or mutate ProductPulse data. It returns supported options, examples, and caveats so the assistant can ask a useful follow-up question before taking action.

## When To Use It

Use interaction guidance when the merchant asks things like:

- "I want to add a new action to this product."
- "What can I ask about this product?"
- "What information can you show me?"
- "Help me change something."
- "What can I do with the watchlist?"

For these broad requests, the assistant should not guess the exact mutation or action. It should show concrete options and examples.

## Supported Guidance Areas

### Create Product Action

Options are based on ProductPulse app-owned mutations:

- Product description guidance.
- SEO recommendation.
- QA / internal review action.
- Allowlisted metafield recommendation.
- Custom ProductPulse action.

All create-action options require product context and explicit user confirmation before saving.

### Edit Product Action

Options are based on ProductPulse app-owned mutations:

- Rewrite action text.
- Dismiss a recommendation.
- Mark a recommendation as reviewed or completed.

These options require product context and explicit confirmation.

### Product Information

Options are based on read-only ProductPulse data tools:

- Product summary.
- Diagnosis and likely cause.
- Evidence.
- Recommended actions.

These options never mutate data.

### Methodology Explanation

Options are based on curated ProductPulse app knowledge tools:

- Score formulas and metric interpretation.
- QuickScan.
- Deep diagnosis.
- Screen guides.

These options never mutate data.

### Watchlist

Options include:

- Read watchlist snapshot.
- Propose adding a product to watchlist.
- Propose running watchlist diagnoses.

Write-like watchlist options require confirmation and affect ProductPulse internal data only.

### Shopify Mutation Alternatives

If a merchant asks to apply, publish, or update Shopify directly from chat, the assistant should explain that chat cannot mutate Shopify. It may offer to save a ProductPulse action for review instead.

## Safety Rules

- Do not execute actions from guidance.
- Do not create app-owned mutations from guidance alone.
- Do not ask for shop, store, tenant, or user IDs.
- Do not expose internal table names or implementation paths to merchants.
- Do not offer direct Shopify mutations.
- Use page product context when available; otherwise ask which product the user means.
