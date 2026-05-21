# AI App-Owned Actions Discovery

## Existing App-Owned Records

- `ProductRiskSnapshot`: shop-scoped ProductPulse snapshot for a Shopify product. It stores product identifiers, handle, title, risk score, impact/confidence, primary issue, source coverage, and compact metrics.
- `ProductDiagnosis`: shop-scoped internal diagnosis output. It stores issues, evidence, and recommendations as JSON plus risk/confidence metadata. The product detail UI reads recommendations from here.
- `ProductAction`: shop-scoped app-owned recommendation/action history. It stores `actionType`, `label`, `status`, `payload`, and optional `diagnosisId`. The product detail UI can render these records and related diagnosis recommendations.
- `ProductWatchlistItem`, `ProductWatchActivity`, and `ProductWatchSettings`: shop-scoped watchlist state and activity.
- `AiActionProposal` and `AiActionAuditLog`: confirmed internal action proposal/audit system for job/watchlist style actions.
- `AiConversation`, `AiConversationMessage`, `AiConversationToolCall`, and `AiUsageEvent`: chat persistence, tool logging, and cost tracking.

## Existing Internal Mutation Flows

- Product detail route `app/routes/app.products_.$productId.jsx` accepts `_action=apply-action`, `dismiss-action`, `restore-action`, and `review-action`.
- `recordProductDetailActionForShop()` can create `ProductAction` rows with status `draft`, `reviewed`, `dismissed`, `active`, `ignored`, or `applied`.
- The same service can call Shopify mutations only when `payloadOverride.applyMode === "apply"`. The AI assistant must never send `applyMode=apply` or call Shopify mutation helpers.
- Current diagnosis recommendations may include generated copy, SEO guidance, FAQ/metafield suggestions, media/title ideas, and QA/review actions. For the chat flow, confirmed saves must become app-visible `ProductAction` rows and/or updated `ProductDiagnosis.recommendations`.

## Safe App-Owned Mutations

- Create a product-description ProductPulse action.
- Create an SEO ProductPulse action.
- Create an allowlisted metafield ProductPulse action. The current allowlist includes ProductPulse FAQ metafield shape (`productpulse.faq_html`); arbitrary namespace/key values must be rejected.
- Create a new ProductPulse product action with real action payload fields such as `draftText`, target `field`, description operation, media update metadata, FAQ items, or tags.
- Rewrite an existing ProductPulse recommendation/action by `actionId`. The save path records a `ProductAction` row and updates the latest stored diagnosis recommendation JSON when that recommendation exists, adding AI provenance such as `aiRegeneratedBy: ProductPulse AI chat`.
- Update an app-owned recommended action status to `active`, `reviewed`, `dismissed`, or `completed` when the target belongs to the authenticated shop.

## Unsafe Or Unavailable Mutations

- Direct Shopify product description, SEO, metafield, price, inventory, status, tag, variant, image, collection, or delete/archive mutations are forbidden from the AI assistant flow.
- Arbitrary metafield namespace/key mutations are not safe unless explicitly allowlisted.
- Bulk mutations and autonomous execution are out of scope.

## Storage Decision

The final saved result must be visible to the normal ProductPulse frontend. Therefore confirmed chat saves write real app records:

- `ProductAction` for action history and product action UI;
- `ProductDiagnosis.recommendations` when the action should appear in the diagnosis recommendation list.

The server may keep a short-lived pending confirmation proposal and audit log so a ChatKit button cannot directly mutate app data from an untrusted payload. That proposal is not the final saved artifact and is not the source of truth for the product UI.

## Tenant And Security Rules

- Every proposal and saved action is scoped with `shop` from the authenticated server-side AI context.
- Client and model payloads may include product references but never tenant identifiers.
- The backend re-fetches the target product through ProductPulse repositories before proposal creation, editing, saving, or cancellation.
- ChatKit action payloads reference a server-stored `proposalId`; edited fields are validated server-side before saving.
- No AI app mutation registry entry is allowed to call Shopify Admin mutation endpoints.
