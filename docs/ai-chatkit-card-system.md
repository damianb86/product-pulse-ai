# AI ChatKit Card System

## Purpose

The ChatKit card system converts ProductPulse neutral presentation blocks into ChatKit widget payloads. ChatKit is the renderer; ProductPulse remains the backend source of truth for tools, permissions, actions, tenant isolation, and OpenAI orchestration.

The adapter lives in:

- `app/ai/presentation/blocks.ts`
- `app/ai/chatkit/widgets.ts`

It does not parse assistant natural language and does not build cards from raw database rows.

## Implemented Block Types

`summary`

- Renders a compact summary card.
- Caps body text before sending it to ChatKit.

`product_reference`

- Renders product title, risk label/score when available, handle when available, and safe navigation buttons.
- Does not require image, vendor, type, or status because those fields are not in the AI presentation block today.

`diagnosis_summary`

- Renders risk score, confidence, likely cause, and primary issues.
- Handles missing risk/confidence gracefully.
- Includes evidence/product navigation only when `productGid` exists.

`evidence_list`

- Renders bounded evidence snippets in a ChatKit `ListView`.
- Caps visible evidence rows and text length.
- Adds a read-only “show more evidence” action only when a product reference exists.

`metric_table`

- Renders compact key/value metric rows with optional detail text.
- Does not add chart visuals yet because there is no validated neutral chart block and no shared chart library.

`entity_list`

- Renders compact product/watchlist/activity/ranked lists using title, subtitle, detail, status, risk, and optional product references.
- Product rows can navigate through the existing backend action validation path.

`recommendation_list`

- Renders read-only recommendation summaries using label, status, issue, effort, and draft preview.
- Does not mark recommendations or execute actions directly.

`unavailable_state`

- Renders explicit empty/missing-data cards for unavailable products, diagnosis, evidence, analytics, watchlist, or actions.

`action_proposal`

- Renders pending internal app action confirmation cards.
- Shows summary, target, reason, expected result, risks, confirmation level, side-effect level, reversibility, and expiry.
- Confirm/Cancel buttons send only `proposalId`.

## Existing UI Reuse

ChatKit widgets are JSON payloads, so existing React/Polaris components cannot be reused directly. The adapter reuses ProductPulse display patterns instead:

- risk tone mapping from ProductPulse badges;
- compact title/body/badge/action hierarchy;
- short evidence rows;
- metric key/value rows;
- explicit empty states;
- confirmation language from the internal action flow.

## Mapping Flow

```text
AiAssistantResponse.blocks
-> aiPresentationBlockSchema validation
-> mapAiPresentationBlockToChatKitWidget()
-> ChatKit widget payload
-> ChatKit custom backend stream item
```

Unknown or invalid blocks fall back to an “Unsupported assistant card” widget. The fallback does not render raw JSON or internal fields.

## Actions

All widget actions continue through ProductPulse backend validation:

- `open_product`
- `open_evidence`
- `show_more_evidence`
- `confirm_ai_action`
- `cancel_ai_action`

Navigation actions are validated server-side and emitted back as ChatKit client effects. Confirmation actions are executed only through the internal action registry and only after the backend reloads the stored proposal.

## Chart Cards

No standalone chart card is implemented in this phase.

The existing app has custom SVG charts in React screens, but the AI presentation schema does not expose validated chart series yet. The ChatKit adapter therefore renders metrics as compact rows. A future chart block should define validated series, labels, units, and caps before any visual chart is added.

## Security Rules

- The adapter receives validated blocks and never queries the database.
- The adapter does not expose tenant IDs, user IDs, session IDs, raw database rows, secrets, or raw JSON.
- It does not return arbitrary HTML.
- Action payloads are deterministic and minimal.
- Product/entity ownership remains checked by backend routes and registries, not by widget code.

## Known Limitations

- Product images are not rendered because they are not part of `product_reference`.
- Vendor/type/status are not rendered on product cards until the AI presentation schema exposes them.
- Charts/sparklines are intentionally omitted.
- The adapter cannot reuse Polaris components inside ChatKit.
- ChatKit widget styling is constrained to ChatKit’s widget primitives.

## Future Card Ideas

- Validated analytics chart block for small trend or distribution visuals.
- Product image support if the AI-safe product summary exposes image URL/alt text.
- Watchlist summary block based on `AiWatchlistSnapshot`.
- Source coverage block based on `AiSourceSummary`.
- Recommendation status update proposals generated through the existing action proposal flow.
