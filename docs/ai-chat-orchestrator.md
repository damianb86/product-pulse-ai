# AI Chat Orchestrator

## Purpose

The AI chat orchestrator is the backend-only Phase 2 layer for ProductPulse AI chat. It receives a user message, authenticates the Shopify embedded app request, creates a server-side AI context, exposes Phase 1 read-only ProductPulse tools to OpenAI, executes requested tools through the internal registry, and returns a UI-neutral structured response.

It does not render UI, stream responses, integrate ChatKit widgets, create Polaris chat components, perform Shopify mutations, apply actions, or run autonomous workflows.

## Main Modules

- `app/ai/chat/aiChatOrchestrator.server.ts`: `AiChatOrchestrator` and `runAiChatTurn` orchestration flow.
- `app/ai/chat/config.server.ts`: centralized model and cost-control config.
- `app/ai/chat/openAiClient.server.ts`: server-only OpenAI Responses client wrapper.
- `app/ai/chat/instructions.ts`: centralized assistant instructions.
- `app/ai/chat/pageContext.ts`: flexible validated page context.
- `app/ai/chat/responseSchema.ts`: schema for final UI-neutral assistant responses.
- `app/ai/chat/conversationStore.server.ts`: Prisma-backed conversation/message/tool-call persistence.
- `app/ai/presentation/blocks.ts`: neutral presentation block schema.
- `app/routes/api.ai.chat.jsx`: non-streaming `POST /api/ai/chat` endpoint.

## Persistence

Prisma models added:

- `AiConversation`: shop-scoped conversation shell.
- `AiConversationMessage`: user/assistant/system/tool message log.
- `AiConversationToolCall`: per-tool-call event log with tool name, input, status, duration, result count, and safe error.

Tool results are not stored in full. This keeps the database smaller and avoids persisting large or sensitive derived context unnecessarily.

## Tenant Isolation

The API route and `runAiChatTurn()` authenticate via Shopify Admin auth. The orchestrator then calls `createAiToolContextFromAuthenticatedRequest()` and uses only that server-derived context.

Rules enforced:

- Tool inputs do not accept tenant identifiers.
- Model-supplied `shop`, `storeId`, `merchantId`, or similar fields are stripped or ignored by Phase 1 validation.
- Tool execution goes through `AiToolRegistry.executeAiTool()`.
- Repositories continue to scope queries by `context.shop`.
- Conversations and messages are stored with `shop`.
- Existing conversations are loaded only when both `id` and `shop` match.

## OpenAI Tool Calling

The OpenAI adapter in `app/ai/tools/adapters/openAiToolAdapter.ts` converts internal Phase 1 tool definitions into OpenAI function tools.

The registry remains the source of truth:

- Tool name.
- Description.
- Zod input schema.
- Read-only flag.
- Category and metadata.

The orchestrator sends those tool definitions to the Responses API. When the model returns a function call, the orchestrator maps the OpenAI tool name back to the internal tool name and executes it through the registry.

The OpenAI-facing schemas are sent with `strict: false` because the internal Zod schemas intentionally use optional fields and defaults. The security boundary is still the internal registry: every tool call is revalidated with the original Zod schema and executed only with the server-created tenant context.

Safeguards:

- Unknown tool calls return safe `UNKNOWN_TOOL` errors through the registry.
- Invalid tool input returns safe validation errors.
- Per-turn tool calls are capped by `AI_CHAT_MAX_TOOL_CALLS_PER_TURN` or the default of 5.
- Tool outputs are compacted before being returned to the model.
- Tool call start/success/error/blocked events are logged.

## Model Config

Environment variables:

- `OPENAI_API_KEY`: required for real AI chat calls.
- `AI_CHAT_MODEL`: default chat model. Fallback: `OPENAI_CHAT_MODEL`, then `gpt-5.4-mini`.
- `AI_CHAT_STRONG_MODEL`: optional stronger model. Fallback: `OPENAI_PREMIUM_MODEL`, then `gpt-5.4`.
- `AI_CHAT_CHEAP_MODEL`: optional cheaper model. Fallback: `OPENAI_BASIC_MODEL`, then the default model.
- `AI_CHAT_MAX_TOOL_CALLS_PER_TURN`: default 5.
- `AI_CHAT_MAX_RECENT_MESSAGES`: default 8.
- `AI_CHAT_MAX_TOOL_RESULT_CHARACTERS`: default 6000.
- `AI_CHAT_TEMPERATURE`: default 0.2.

The API key is server-only and is never returned to the client.

## Final Response Shape

The model must return JSON matching `AiAssistantResponse`:

- `assistantText`
- `blocks`
- `suggestedReplies`
- `referencedEntities`
- `followUpQuestions`
- `warnings`

Blocks are UI-neutral and can later be rendered by either a custom Polaris chat UI or ChatKit/AgentKit:

- `summary`
- `product_reference`
- `diagnosis_summary`
- `evidence_list`
- `metric_table`

No HTML, Polaris component descriptors, or ChatKit widget descriptors are returned.

If the model returns invalid structured output, the orchestrator retries once. If the retry also fails, it returns a safe text-only fallback.

## Page Context

The route accepts optional `pageContext`:

```json
{
  "type": "product",
  "entityId": "gid://shopify/Product/123",
  "entityHandle": "linen-shirt"
}
```

Supported page types:

- `dashboard`
- `products`
- `product`
- `analytics`
- `watchlist`
- `connect`
- `settings`
- `unknown`

The orchestrator uses product page context to help the model resolve phrases like “this product” without the UI needing chat-specific business logic.

## API Route

`POST /api/ai/chat`

Input:

```json
{
  "conversationId": "optional-existing-id",
  "message": "Explain why this product is high risk",
  "pageContext": {
    "type": "product",
    "entityId": "gid://shopify/Product/123"
  }
}
```

Output:

```json
{
  "conversationId": "...",
  "messageId": "...",
  "userMessageId": "...",
  "assistantText": "...",
  "blocks": [],
  "suggestedReplies": [],
  "referencedEntities": [],
  "followUpQuestions": [],
  "warnings": [],
  "metadata": {
    "model": "gpt-5.4-mini",
    "toolCallCount": 1,
    "blockedToolCallCount": 0,
    "openAiResponseId": "...",
    "usage": {},
    "pageContext": {}
  }
}
```

## Future ChatKit Integration

ChatKit can call the same backend route or a thin ChatKit-specific adapter that delegates to `AiChatOrchestrator`. ChatKit widgets/actions should be layered on top of the stable response shape rather than embedded in the orchestrator.

## Future Custom Polaris UI

A custom Polaris chat drawer can call `POST /api/ai/chat`, render `assistantText`, and map neutral blocks to app-specific components. The UI should not parse prose to infer actions.

## Current Limitations

- Non-streaming only.
- No action confirmation flow.
- No Shopify mutations.
- No embeddings or long-term memory.
- No conversation summarization yet; only recent-message trimming is implemented.
- No persisted full tool results.
- No raw job log access.
- No live Shopify product search tool beyond Phase 1’s stored ProductPulse data tools.

## Tests

Added `tests/unit/product-pulse-ai-chat-orchestrator.test.js`, covering:

- Authenticated context creation.
- Tenant override protection.
- Unknown tool rejection.
- Tool call limit enforcement.
- Invalid structured response fallback.
- Product page context.
- Conversation/message/tool-call persistence with mocks.
- Missing OpenAI configuration fallback.

Run focused tests with:

```bash
npm test -- --run tests/unit/product-pulse-ai-chat-orchestrator.test.js
```
