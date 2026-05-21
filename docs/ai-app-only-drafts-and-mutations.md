# AI App-Only Drafts And Mutations

## Purpose

This layer lets ProductPulse AI generate, edit, preview, and save app-owned drafts from ChatKit. It does not update Shopify. Saved content remains inside ProductPulse for later merchant review through a separate non-AI workflow.

## Architecture

```text
ChatKit editable card
-> /api/ai/app-mutations/* or ChatKit custom action
-> AiAppMutationRegistry
-> AiAppDraftProposal / AiAppDraftAuditLog
-> ProductPulse app-owned records when applicable
```

The registry is separate from:
- read-only AI tools;
- confirmed internal action proposals;
- Shopify Admin API write flows.

## Supported Mutations

- `product_pulse_create_product_description_draft`: stores an editable product description draft in ProductPulse only.
- `product_pulse_create_seo_draft`: stores SEO title/description draft fields in ProductPulse only.
- `product_pulse_create_metafield_value_draft`: stores an allowlisted metafield value draft in ProductPulse only. Default allowlist: `productpulse.faq_html` with type `multi_line_text_field`.
- `product_pulse_create_recommended_action`: creates an app-owned `ProductAction` recommendation record.
- `product_pulse_mark_recommended_action_status`: records an app-owned recommendation status change.

## Blocked Shopify Mutations

The AI assistant flow must not update Shopify product descriptions, SEO fields, metafields, prices, inventory, product status, tags, variants, images, collections, or any Admin API mutation. Direct Shopify update requests should be redirected to app draft creation with clear wording: “I can save this as an app draft for review, but I cannot apply it directly to Shopify from the chat.”

## Proposal Lifecycle

1. The model uses read-only tools to gather ProductPulse context.
2. The model calls `product_pulse_propose_app_only_mutation`.
3. The backend validates input, re-fetches the product by authenticated shop, and stores `AiAppDraftProposal`.
4. ChatKit renders an editable draft card.
5. The user edits fields and clicks “Save draft in app”.
6. The backend loads the proposal by `proposalId`, validates ownership/status/expiration/editable fields, and saves app-owned data only.
7. `AiAppDraftAuditLog` records proposed, edited, save requested, saved, cancelled, expired, or failed events.

## ChatKit Cards

`app_draft_proposal` maps to a ChatKit `Card` with a `Form`, validated fields, a “Save draft in app” submit button, and a cancel button. Payloads contain `proposalId` plus edited field values. The target product and mutation metadata are reloaded server-side.

`app_draft_result` shows saved/cancelled/failed outcomes. It never reports Shopify changes.

## Security

- Tenant identity comes only from Shopify Admin auth session.
- Client/model payloads cannot set shop/user IDs.
- Proposals are shop-scoped and expire.
- Edited fields are allowlisted per mutation.
- Metafield drafts require an allowlisted namespace/key/type.
- Audit logs avoid secrets and large raw prompts.

## Configuration

- `AI_APP_MUTATIONS_ENABLED=false` disables app-only draft proposals/saves while leaving read-only chat available.
- `AI_ALLOWED_METAFIELD_DRAFTS` may contain a JSON array of allowlisted metafields:

```json
[
  { "namespace": "productpulse", "key": "faq_html", "type": "multi_line_text_field", "label": "ProductPulse FAQ HTML" }
]
```

## Tests

Run:

```bash
npm test -- --run tests/unit/product-pulse-ai-app-mutations.test.js
```

Coverage includes proposal creation, tenant isolation, edited draft saving, allowlisted metafields, ChatKit save actions, and verification that no Shopify apply mode is used.
