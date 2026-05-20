# AI ChatKit Integration

## Purpose

OpenAI ChatKit is the user-facing chat surface for ProductPulse. ChatKit owns the conversation UI, while ProductPulse owns authentication, tenant isolation, AI orchestration, tool execution, action confirmation, logging, and data access.

The default implementation uses the ChatKit advanced custom-backend mode. It does not use Agent Builder hosted workflows and does not require `AI_CHATKIT_WORKFLOW_ID`.

## Package Choice

The app uses:

- `@openai/chatkit-react@1.5.1`
- `@openai/chatkit@1.7.0` as its type dependency

The React component still loads the OpenAI ChatKit browser script from:

```html
https://cdn.platform.openai.com/deployments/chatkit/chatkit.js
```

The model still runs on OpenAI through the server-side OpenAI API calls made by `AiChatOrchestrator`.

## Mount Point

ChatKit is mounted globally inside the authenticated embedded app layout:

- `app/routes/app.jsx`
- `app/components/ProductPulseChatKitAssistant.jsx`
- `app/styles/product-pulse-chatkit.css`

The surrounding drawer/launcher is app chrome. The chat experience itself is ChatKit.

## Configuration

Server environment variables:

- `OPENAI_API_KEY`: required for server-side OpenAI model calls.
- `AI_CHAT_MODEL`: optional default chat model. Fallback is handled by the Phase 2 chat config.
- `AI_CHATKIT_ENABLED`: set to `false`, `0`, `off`, or `disabled` to disable the ChatKit UI.
- `AI_CHATKIT_API_URL`: optional custom endpoint. Defaults to `/api/ai/chatkit/message`.
- `AI_CHATKIT_DOMAIN_KEY`: required public ChatKit domain key from the OpenAI domain allowlist. Current Cloudflare tunnel key: `domain_pk_6a0e373140408193b67487c54e353dbd09dbeb51913073da`.
- `AI_CHATKIT_HISTORY_RECENT_THREADS`: optional history limit.
- `AI_CHATKIT_DEBUG`: enables client-safe debug state.

Not required by default:

- `AI_CHATKIT_WORKFLOW_ID`
- `AI_CHATKIT_WORKFLOW_VERSION`

Client-safe config is exposed from the app loader through `getAiChatKitClientConfig()`. The browser receives only `enabled`, `debug`, `apiUrl`, `domainKey`, and a safe disabled reason. The `domainKey` is public by design. The browser never receives `OPENAI_API_KEY`.

## Backend Flow

Default message flow:

```text
ChatKit UI
-> POST /api/ai/chatkit/message
-> Shopify authenticated server context
-> AiChatOrchestrator.runAiChatTurnWithContext()
-> OpenAI Responses API
-> Phase 1 read-only AI tool registry
-> ProductPulse repositories/database
```

Implemented in:

- `app/routes/api.ai.chatkit.message.jsx`
- `app/ai/chatkit/message.server.ts`
- `app/ai/chat/aiChatOrchestrator.server.ts`

The custom ChatKit endpoint accepts ChatKit protocol requests such as `threads.create`, `threads.add_user_message`, `threads.get_by_id`, `threads.list`, and `items.list`. Streaming message requests return ChatKit thread events as `text/event-stream`.

The previous `product_pulse_chat_turn` hosted-workflow client tool bridge has been removed from the default path.

## Session Endpoint

`POST /api/ai/chatkit/session`

Implemented in:

- `app/routes/api.ai.chatkit.session.jsx`
- `app/ai/chatkit/session.server.ts`

This endpoint is now an app-owned preflight/conversation endpoint. It:

- authenticates the Shopify Admin request;
- derives shop/user context server-side;
- creates or reuses the internal `AiConversation`;
- validates/sanitizes page context;
- returns `conversationId`, `apiUrl`, `domainKey`, sanitized page context, and safe warnings.

It does not create an OpenAI-hosted ChatKit session and does not return a ChatKit `client_secret`.

## Page Context

`app/routes/app.jsx` derives page context from the current route. The ChatKit component injects that context into ChatKit backend requests as untrusted metadata.

For product pages, the server verifies the referenced product through the Phase 1 read-only registry under the authenticated shop context. If verification fails, product identifiers are stripped before the context reaches the orchestrator.

## Widgets

`app/ai/chatkit/widgets.ts` maps neutral ProductPulse presentation blocks into ChatKit widget JSON:

- `summary` -> `Card`
- `product_reference` -> `Card`
- `diagnosis_summary` -> `Card`
- `evidence_list` -> `ListView`
- `metric_table` -> `Card`
- `action_proposal` -> confirmation `Card`

Widgets are presentation-only. The backend structured response remains the source of truth.

## Actions

`POST /api/ai/chatkit/action`

Implemented in:

- `app/routes/api.ai.chatkit.action.jsx`
- `app/ai/chatkit/actions.server.ts`

Allowed actions include read-only navigation/refinement and Phase 4 proposal confirmation/cancellation:

- `open_product`
- `open_evidence`
- `open_analytics`
- `open_watchlist`
- `show_more_evidence`
- `refine_query`
- `confirm_ai_action`
- `cancel_ai_action`

Confirm and Cancel send only a `proposalId`. The backend reloads the stored proposal, validates tenant ownership and status, then executes through the internal action registry. Shopify resources are not mutated.

## Security

- Every request authenticates through Shopify Admin auth.
- Shop/user IDs are derived server-side only.
- Client metadata cannot override tenant context.
- Page context is validated before use.
- The model sees app data only through the Phase 1 read-only tool registry.
- Internal actions execute only through the Phase 4 action registry after explicit confirmation.
- OpenAI API keys and server secrets are never exposed to the browser.

## Tests

Focused tests:

```bash
npm test -- --run tests/unit/product-pulse-ai-chatkit.test.js tests/components/product-pulse-chatkit-assistant.test.jsx
```

Coverage includes session preflight, missing workflow ID behavior, custom-backend message routing, page-context validation, widget conversion, action validation, product ownership checks, and drawer rendering.

## Limitations

- The custom backend currently returns complete responses as SSE events rather than token-level streaming.
- ChatKit history uses internal `AiConversation` records; there is no separate custom conversation management UI.
- File uploads, transcription, and Shopify mutations are intentionally unsupported.

## Future Steps

- Add token-level streaming if latency becomes a real issue.
- Add richer widgets as neutral presentation blocks mature.
- Add Shopify write actions only in a future explicit confirmation and authorization phase.
