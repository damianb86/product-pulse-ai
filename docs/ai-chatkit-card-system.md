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

- Renders the Product Summary / Product Detail visual pattern from the supplied ProductPulse card mockup.
- Supports optional product image, subtitle, vendor, type, price, status, updated-at text, and up to four metrics when those fields are present.
- Falls back to a ProductPulse icon tile when no validated image URL is available.
- Includes safe navigation buttons only when a product reference is present.

`diagnosis_summary`

- Renders risk score, confidence, likely cause, and primary issues.
- Handles missing risk/confidence gracefully.
- Includes evidence/product navigation only when `productGid` exists.

`evidence_list`

- Renders the Evidence Summary card pattern with source/signal counters, bounded snippets, and safe evidence navigation.
- Caps visible evidence rows and text length.
- Adds a read-only “show more evidence” action only when a product reference exists.

`metric_table`

- Renders a compact Table/Data card with metric, value, and detail columns.
- Does not add chart visuals yet because there is no validated neutral chart block and no shared chart library.

`entity_list`

- Renders compact panel rows for product/watchlist/activity/ranked lists using title, subtitle, detail, status, risk, and optional product references.
- Product rows can navigate through the existing backend action validation path.

`recommendation_list`

- Renders Recommended Action card rows with an icon tile, status/issue badges, optional impact/risk/effort/confidence fields, and review/open-product actions.
- Does not mark recommendations or execute actions directly.

`unavailable_state`

- Renders explicit empty/missing-data cards for unavailable products, diagnosis, evidence, analytics, watchlist, or actions.

`action_proposal`

- Renders the Expanded Action Detail confirmation card pattern.
- Shows summary, target, reason, expected result, risks, confirmation level, side-effect level, reversibility, and expiry.
- Confirm/Cancel buttons send only `proposalId`.

`action_result`

- Renders completed, cancelled, or failed internal app action results.
- Shows the safe backend summary, target label, affected entities, side-effect level, and created job ID when present.
- Does not render execution buttons or accept action input from the client.

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

Confirm/cancel responses are deterministic backend responses. They emit `action_result` widgets directly and do not make a second OpenAI call after the user clicks Confirm or Cancel.

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

- Product images render only when a safe `http` or `https` image URL is present in the validated block.
- Vendor/type/status render only when present in the validated block.
- Charts/sparklines are intentionally omitted.
- The adapter cannot reuse Polaris components inside ChatKit.
- ChatKit widget styling is constrained to ChatKit’s widget primitives.

## Future Card Ideas

- Validated analytics chart block for small trend or distribution visuals.
- Product image support if the AI-safe product summary exposes image URL/alt text.
- Watchlist summary block based on `AiWatchlistSnapshot`.
- Source coverage block based on `AiSourceSummary`.
- Recommendation status update proposals generated through the existing action proposal flow.
