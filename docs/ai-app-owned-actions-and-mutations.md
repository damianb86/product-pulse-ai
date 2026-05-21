# AI App-Owned Actions And Mutations

## Purpose

ProductPulse AI can help create or edit ProductPulse-owned actions from ChatKit, but it must not create final data that only the chat can read. Confirmed saves write to the same app data used by the product detail UI.

The AI assistant still never updates Shopify. Product descriptions, SEO fields, metafields, prices, inventory, status, tags, variants, images, collections, and other Shopify Admin resources remain outside the chat mutation path.

## Architecture

```text
ChatKit editable confirmation card
-> /api/ai/app-mutations/* or ChatKit custom action
-> AiAppMutationRegistry
-> server-side confirmation proposal and audit log
-> ProductAction + ProductDiagnosis.recommendations
```

The proposal store is used only to validate and audit the confirmation flow. It is not the final merchant-facing record. After confirmation, the saved record ID returned to ChatKit is the real `ProductAction.id`.

## Saved Data Contract

Confirmed ProductPulse mutations:
- create or update `ProductAction` rows scoped to the authenticated shop;
- update the latest `ProductDiagnosis.recommendations` JSON when the action belongs there;
- mark payloads with safe provenance such as `aiGeneratedBy` or `aiRegeneratedBy`;
- store generated fields such as `draftText`, `field`, `descriptionOperation`, media metadata, FAQ items, or tags as ProductPulse action payload data;
- never store `proposalId` in the real `ProductAction.payload`;
- never send `applyMode=apply`;
- never call Shopify Admin mutation helpers.

## Supported Mutations

- `product_pulse_create_product_description_draft`: legacy mutation name; now creates a real ProductPulse product-description action after confirmation.
- `product_pulse_create_seo_draft`: legacy mutation name; now creates a real ProductPulse SEO action after confirmation.
- `product_pulse_create_metafield_value_draft`: legacy mutation name; now creates a real ProductPulse allowlisted metafield action after confirmation.
- `product_pulse_create_recommended_action`: creates an app-owned `ProductAction` recommendation record.
- `product_pulse_create_product_action`: creates a new ProductPulse product action with real action payload fields.
- `product_pulse_update_recommended_action_draft`: legacy mutation name; rewrites an existing ProductPulse recommendation/action and updates app-visible records.
- `product_pulse_mark_recommended_action_status`: records an app-owned recommendation status change.

The legacy names are kept for compatibility with existing model instructions, tests, and pending proposals. Their save behavior is no longer chat-only.

## Confirmation Flow

1. The model uses read-only tools to gather ProductPulse context.
2. The model calls `product_pulse_propose_app_only_mutation`.
3. The backend validates input and re-fetches the product by authenticated shop.
4. The backend stores a pending proposal for confirmation/audit.
5. ChatKit renders an editable ProductPulse mutation card.
6. The user edits fields and clicks “Save in ProductPulse”.
7. The backend reloads the proposal by `proposalId`, validates ownership/status/expiration/editable fields, and writes real app records.
8. ChatKit receives a result block with a primary action to open the product/action in the app.

## ChatKit Cards

`app_draft_proposal` and `app_draft_result` are legacy internal presentation block names. They render ProductPulse mutation proposal/result cards in ChatKit. They should not be interpreted as final chat-only drafts.

Save payloads contain a `proposalId` plus edited fields. The server reloads all target and mutation metadata. The frontend cannot change the target product or tenant by tampering with the payload.

## Editing ProductPulse Actions From Chat

The assistant can create or rewrite ProductPulse actions only through the app mutation proposal tool. The model must pass a product reference returned by read-only ProductPulse tools and, for rewrites, the recommendation `actionId` when it has one.

The backend accepts safe aliases so equivalent model payloads do not fail unnecessarily:
- `proposedValue`, `value`, `text`, `draftText`, `proposedText`, or `note` for generated copy;
- `targetField`, `target`, `field`, or `shopifyField` for the intended field;
- `title`, `label`, or `actionTitle` for the action title;
- root-level tool arguments are normalized into `input` before mutation validation.

If an exact recommendation `actionId` is unavailable, ProductPulse tries to match the existing recommendation from the title/label, target field, mutation type, or first available recommendation. This remains scoped to the authenticated shop and product.

## Security

- Tenant identity comes only from Shopify Admin auth session.
- Client/model payloads cannot set shop/user IDs.
- Proposals are shop-scoped and expire.
- Edited fields are allowlisted per mutation.
- Metafield mutations require an allowlisted namespace/key/type.
- Audit logs avoid secrets and large raw prompts.

## Configuration

- `AI_APP_MUTATIONS_ENABLED=false` disables ProductPulse app mutation proposals/saves while leaving read-only chat available.
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

Coverage includes proposal creation, tenant isolation, edited ProductPulse action saving, allowlisted metafields, ChatKit save actions, and verification that no Shopify apply mode is used.
