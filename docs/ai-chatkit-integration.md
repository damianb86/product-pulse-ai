# AI ChatKit Integration

## Purpose

Phase 3 mounts OpenAI ChatKit as the user-facing assistant surface for ProductPulse. ChatKit owns the chat interaction UI, while the existing Phase 1 data layer and Phase 2 orchestrator remain the source of truth for ProductPulse data access, tool execution, tenant isolation, logging, and structured responses.

This phase does not add Shopify mutations, product edits, confirmation cards, autonomous workflows, embeddings, billing, proactive notifications, or a custom Polaris chat UI.

## Package Choice

The app uses:

- `@openai/chatkit-react@1.5.1`
- `@openai/chatkit@1.7.0` as its type dependency

The root document loads the ChatKit browser script from OpenAI:

```html
<script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async></script>
```

The implementation follows the hosted ChatKit pattern: the server creates a short-lived ChatKit session and returns only the `client_secret` needed by the browser component. OpenAI API keys stay server-side.

## Mount Point

ChatKit is mounted globally inside the authenticated embedded app layout:

- `app/routes/app.jsx`
- `app/components/ProductPulseChatKitAssistant.jsx`
- `app/styles/product-pulse-chatkit.css`

The UI is a small global assistant launcher plus a drawer containing the ChatKit component. The drawer shell is minimal app chrome; the conversation experience itself is ChatKit.

## Configuration

Server environment variables:

- `OPENAI_API_KEY`: required to create ChatKit sessions.
- `AI_CHATKIT_WORKFLOW_ID`: required Agent Builder workflow ID.
- `AI_CHATKIT_WORKFLOW_VERSION`: optional workflow version.
- `AI_CHATKIT_ENABLED`: set to `false`, `0`, `off`, or `disabled` to disable.
- `AI_CHATKIT_SESSION_TTL_SECONDS`: default `600`, capped to `60..3600`.
- `AI_CHATKIT_RATE_LIMIT_PER_MINUTE`: default `10`, capped to `1..60`.
- `AI_CHATKIT_HISTORY_RECENT_THREADS`: default `10`, capped to `0..50`.
- `AI_CHATKIT_DEBUG`: enables workflow tracing when set to `true`, `1`, `on`, or `enabled`.

Client-safe config is exposed from the app loader through `getAiChatKitClientConfig()`. Secrets and workflow internals are not exposed.

## Session Endpoint

`POST /api/ai/chatkit/session`

Implemented in:

- `app/routes/api.ai.chatkit.session.jsx`
- `app/ai/chatkit/session.server.ts`

Responsibilities:

- Authenticates the Shopify Admin request.
- Builds `AiToolContext` from the server session.
- Creates or reuses the internal `AiConversation`.
- Validates/sanitizes page context.
- Creates an OpenAI ChatKit session with `client.beta.chatkit.sessions.create`.
- Returns `client_secret`, internal `conversationId`, sanitized page context, and safe warnings.

The ChatKit `user` value is a SHA-256-derived opaque ID based on server-side shop/session/user context. Raw shop IDs are not sent as the ChatKit user.

## Orchestrator Connection

The hosted ChatKit workflow should use the client tool:

`product_pulse_chat_turn`

Expected params:

```json
{
  "message": "Explain why this product is high risk"
}
```

The browser handler in `ProductPulseChatKitAssistant` ignores tenant identifiers and sends the message to:

`POST /api/ai/chat`

That endpoint is the Phase 2 orchestrator. It then executes OpenAI tool calls through the Phase 1 registry and repositories. The ChatKit client tool output includes:

- `assistantText`
- `widgets`
- `suggestedReplies`
- `referencedEntities`
- `warnings`
- metadata such as tool-call counts

This keeps ChatKit as the presentation surface and the Phase 2 orchestrator as the app brain. A future self-hosted ChatKit runtime could replace the hosted workflow and call the same orchestrator directly.

## Page Context

`app/routes/app.jsx` derives safe page context from the current route:

- dashboard
- product list
- product detail
- analytics
- watchlist
- connect
- settings

For product pages, the server verifies the referenced product through `product_pulse_get_product_risk_detail` under the authenticated shop context. If the product cannot be verified, product identifiers are stripped and a warning is returned.

## Widgets

`app/ai/chatkit/widgets.ts` maps neutral Phase 2 presentation blocks into ChatKit widget JSON:

- `summary` -> `Card`
- `product_reference` -> `Card` with read-only navigation actions
- `diagnosis_summary` -> `Card`
- `evidence_list` -> `ListView`
- `metric_table` -> `Card`

Widgets are presentation-only. They do not mutate Shopify or ProductPulse data.

## Actions

`POST /api/ai/chatkit/action`

Implemented in:

- `app/routes/api.ai.chatkit.action.jsx`
- `app/ai/chatkit/actions.server.ts`

Allowed actions:

- `open_product`
- `open_evidence`
- `open_analytics`
- `open_watchlist`
- `show_more_evidence`
- `refine_query`

Security rules:

- Action payloads are validated with Zod.
- Unknown actions are rejected.
- Payloads cannot include `shop`, `storeId`, `merchantId`, or equivalent tenant identifiers.
- Product navigation actions re-check product ownership through the Phase 1 read-only registry before returning a URL.
- No write actions are implemented.

Intentionally rejected examples:

- `apply_change`
- `update_product`
- `edit_description`
- `add_to_watchlist`
- `remove_from_watchlist`
- `run_diagnosis`
- any Shopify mutation-like action

## Error Handling

Missing ChatKit config returns a safe disabled state. The drawer shows a short message and does not mount ChatKit.

Session creation, action validation, unknown action, and unavailable product errors return short safe messages. Internal details stay out of client responses.

## Tests

Added:

- `tests/unit/product-pulse-ai-chatkit.test.js`
- `tests/components/product-pulse-chatkit-assistant.test.jsx`

Coverage includes:

- authenticated session creation;
- client tenant metadata ignored/rejected;
- disabled/misconfigured ChatKit handling;
- product page-context sanitization;
- neutral block to ChatKit widget conversion;
- client tool output conversion;
- unknown/unsafe action rejection;
- product ownership validation before navigation;
- disabled/enabled drawer rendering.

Focused test command:

```bash
npm test -- --run tests/unit/product-pulse-ai-chatkit.test.js tests/components/product-pulse-chatkit-assistant.test.jsx
```

## Limitations

- Requires an Agent Builder workflow configured outside this repository.
- The workflow must call the `product_pulse_chat_turn` client tool for ProductPulse data questions.
- Non-mutating navigation actions only.
- No streaming adapter changes beyond ChatKit's hosted UI behavior.
- No custom conversation-history UI yet.
- No write actions or confirmation flows.
- No direct self-hosted ChatKit backend protocol implementation in Node yet.

## Future Steps

- Add a workflow setup checklist or exported Agent Builder configuration when available.
- Add mutation-capable action tools only after a separate confirmation and authorization phase.
- Add richer widgets for read-only recommendation summaries if the app exposes stable neutral blocks for them.
- Add conversation list/history surfaces if merchants need to revisit assistant threads from inside ProductPulse.
