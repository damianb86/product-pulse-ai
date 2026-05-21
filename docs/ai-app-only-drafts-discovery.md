# AI App-Only Drafts Discovery

## Existing App-Owned Records

- `ProductRiskSnapshot`: shop-scoped ProductPulse snapshot for a Shopify product. It stores product identifiers, handle, title, risk score, impact/confidence, primary issue, source coverage, and compact metrics. AI may use this to target a product, but tenant identity must always come from the authenticated Shopify session.
- `ProductDiagnosis`: shop-scoped internal diagnosis output. It stores issues, evidence, and recommendations as JSON plus risk/confidence metadata. AI may read and summarize this data through existing repositories/tools. It should not expose raw large JSON.
- `ProductAction`: shop-scoped app-owned recommendation/action history. It stores `actionType`, `label`, `status`, and `payload`. Existing UI can save draft/review/dismiss records and, outside this AI flow, has an `applyMode=apply` path that can call Shopify Admin mutations. The AI assistant must not use that apply path.
- `ProductWatchlistItem`, `ProductWatchActivity`, and `ProductWatchSettings`: shop-scoped watchlist state and activity. These are app-owned and already covered by the internal action registry for confirmed watchlist operations.
- `AiActionProposal` and `AiActionAuditLog`: existing confirmed internal action proposal/audit system. This is intentionally separate from read-only tools.
- `AiConversation`, `AiConversationMessage`, `AiConversationToolCall`, and `AiUsageEvent`: chat persistence, tool call logging, and cost/usage tracking.

## Existing Internal Mutation Flows

- Product detail route `app/routes/app.products_.$productId.jsx` accepts `_action=apply-action`, `dismiss-action`, `restore-action`, and `review-action`.
- `recordProductDetailActionForShop()` can create `ProductAction` rows with status `draft`, `reviewed`, `dismissed`, `active`, `ignored`, or `applied`.
- The same service can call Shopify mutations only when `payloadOverride.applyMode === "apply"`. The AI assistant must never send `applyMode=apply` or call the Shopify mutation helpers.
- Current diagnosis recommendations may include draft copy, SEO guidance, FAQ/metafield suggestions, media/title ideas, and QA/review actions. They are recommendations until stored as app-owned `ProductAction` rows or a new app-only draft.
- Recommended action payloads can include Shopify-facing field names because the normal product UI may later review them, but the AI app-only mutation path stores those payloads only in ProductPulse. It does not execute the existing Shopify apply path.

## Safe App-Only Mutations

- Create a product description draft and store it in ProductPulse only.
- Create SEO title/description draft content and store it in ProductPulse only.
- Create an allowlisted metafield value draft and store it in ProductPulse only. The current code has a ProductPulse FAQ metafield path (`productpulse.faq_html`); arbitrary namespace/key values must be rejected.
- Create a new app-owned recommended action record for a product.
- Create a new ProductPulse product action with real action payload fields such as `draftText`, target `field`, description operation, media update metadata, FAQ items, or tags. These are stored as ProductPulse data only.
- Rewrite an existing ProductPulse recommendation/action by `actionId`. The save path records a `ProductAction` row and updates the latest stored diagnosis recommendation JSON when that recommendation exists, adding AI provenance such as `aiRegeneratedBy: ProductPulse AI chat`.
- Update an app-owned recommended action status to `active`, `reviewed`, `dismissed`, or `completed` when the target belongs to the authenticated shop.

## Unsafe Or Unavailable Mutations

- Direct Shopify product description, SEO, metafield, price, inventory, status, tag, variant, image, collection, or delete/archive mutations are forbidden from the AI assistant flow.
- Arbitrary metafield namespace/key drafts are not safe unless explicitly allowlisted.
- Applying generated text to Shopify is outside this phase. A future non-AI merchant workflow may review saved app drafts and apply them to Shopify.
- Bulk mutations and autonomous execution are out of scope.

## Storage Decision

Existing `ProductAction` can store app-owned recommendation records, but it is not a good fit for editable generated drafts because it mixes historical action records with recommendation/application payloads. This phase adds dedicated app-only draft proposal tables for generated text, SEO, metafield, and recommendation edits. Saved recommendation drafts may also create/update `ProductAction` rows when the mutation explicitly targets app-owned recommendation records.

## Tenant And Security Rules

- Every proposal is stored with `shop` from the authenticated server-side AI context.
- Client and model payloads may include product references but never tenant identifiers.
- The backend re-fetches the target product via ProductPulse repositories before proposal creation, editing, saving, or cancellation.
- ChatKit action payloads must reference a server-stored `proposalId`; edited fields are validated server-side before saving.
- No AI app mutation registry entry is allowed to call Shopify Admin mutation endpoints.
