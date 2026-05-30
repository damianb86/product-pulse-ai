# AI ChatKit Custom Backend

## Final Architecture

ProductPulse uses ChatKit as the chat UI only. The AI backend is the existing ProductPulse server orchestration layer:

```text
ChatKit UI
-> /api/ai/chatkit/message
-> Shopify authenticated server context
-> AiChatOrchestrator
-> OpenAI Responses API
-> ProductPulse AI tool registry / action registry
-> ProductPulse database and services
```

No AI model is hosted on the ProductPulse VM. The VM handles authentication, database queries, tool/action validation, tenant isolation, logs, and OpenAI API calls.

## Why Agent Builder Was Removed

The previous ChatKit implementation created an OpenAI-hosted ChatKit session with an Agent Builder workflow ID. That introduced an extra hosted workflow hop before calling the ProductPulse backend through a client tool.

The custom-backend architecture removes that dependency:

- no `AI_CHATKIT_WORKFLOW_ID`;
- no Agent Builder workflow setup;
- no `product_pulse_chat_turn` bridge;
- no possible hosted-workflow model call before the ProductPulse orchestrator call.

Each user message normally results in one backend OpenAI call path through `AiChatOrchestrator`, plus any tool-call loop turns requested by that orchestrator.

## What Still Runs On OpenAI

The language model runs on OpenAI through the server-side OpenAI SDK. Model selection remains centralized in the Phase 2 chat config:

- `OPENAI_API_KEY`
- `AI_CHAT_MODEL`
- `AI_CHAT_STRONG_MODEL`
- `AI_CHAT_CHEAP_MODEL`
- `AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT`
- `AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT`
- `AI_CHATKIT_DOMAIN_KEY`: public ChatKit domain allowlist key, currently `domain_pk_6a0e373140408193b67487c54e353dbd09dbeb51913073da`

The browser never receives the OpenAI API key.

## What Runs On ProductPulse

ProductPulse runs:

- Shopify Admin authentication;
- server-derived shop/user context;
- conversation persistence;
- page-context validation;
- AI tool registry execution;
- internal action proposal/confirmation;
- audit and tool-call logs;
- ChatKit protocol adaptation.

## Message Endpoint

`POST /api/ai/chatkit/message`

Implemented by:

- `app/routes/api.ai.chatkit.message.jsx`
- `app/ai/chatkit/message.server.ts`

The endpoint accepts ChatKit custom-backend protocol requests. The supported request types are:

- `threads.create`
- `threads.add_user_message`
- `threads.get_by_id`
- `threads.list`
- `items.list`
- `threads.update`
- `threads.custom_action`
- `threads.sync_custom_action`
- `items.feedback`

Message-producing requests are translated into `AiChatOrchestrator.runAiChatTurnWithContext()` and returned to ChatKit as thread events.

## Session Endpoint

`POST /api/ai/chatkit/session`

This is now ProductPulse preflight state, not an OpenAI ChatKit hosted-session creator. It authenticates the request, creates/reuses an internal conversation, validates page context, and returns:

- `conversationId`
- `apiUrl`
- `domainKey`, the public OpenAI domain allowlist key used by ChatKit
- sanitized `pageContext`
- safe warnings

It does not call `client.beta.chatkit.sessions.create()` and does not return `client_secret`.

## Tools And Data Access

The model cannot query the database directly. The orchestrator exposes only internal registered tools from Phase 1. Tool execution receives `AiToolContext` derived from the Shopify authenticated session. Tenant identifiers from ChatKit metadata are ignored.

## Widgets

The orchestrator returns neutral ProductPulse blocks. `app/ai/chatkit/widgets.ts` converts them to ChatKit widgets. The custom backend emits those widgets as ChatKit `widget` thread items.

No arbitrary HTML is returned.

The reusable card/widget layer is documented in `docs/ai-chatkit-card-system.md`.

## Actions

Widget actions still use:

`POST /api/ai/chatkit/action`

The action endpoint validates payloads, re-checks product ownership when needed, and sends confirmation/cancel requests through the internal action registry. Confirmed actions can mutate ProductPulse app-owned records only. Shopify product mutations remain excluded.

## Tenant Isolation

- The frontend may send `conversationId` and `pageContext`.
- The backend derives `shop`, `userId`, and `sessionId` from `authenticate.admin(request)`.
- Conversation loads are filtered by authenticated shop.
- Product page context is verified through the read-only tool registry before reaching the model.
- Client metadata is never accepted as tenant authority.

## Hosted Workflow Difference

Hosted workflow mode:

```text
ChatKit UI -> OpenAI ChatKit session -> Agent Builder workflow -> client tool -> ProductPulse backend
```

Current custom backend mode:

```text
ChatKit UI -> ProductPulse backend -> OpenAI Responses API
```

The current mode is simpler, cheaper, easier to debug, and keeps ProductPulse permissions/data access in the repository.

## Rollback Notes

No legacy hosted-workflow runtime is active by default. A rollback would require restoring the hosted session creation path and reintroducing a workflow ID. That should stay separate from the default custom-backend path to avoid accidentally creating a second model hop.
