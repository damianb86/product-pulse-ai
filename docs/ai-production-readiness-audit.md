# AI Production Readiness Audit

Last updated: 2026-05-20

## Status Summary

Production-ready:
- ChatKit uses the ProductPulse custom backend, not Agent Builder workflows.
- `AI_CHATKIT_WORKFLOW_ID` is not required in the default runtime path.
- OpenAI inference runs only from the server through the orchestrator.
- ProductPulse data access is scoped through authenticated server context and AI tool repositories.
- Tenant identifiers are not accepted from client/model input.
- Internal app actions are separate from read-only tools and require stored proposals plus explicit confirmation.
- Conversations, messages, tool calls, action proposals, action audit logs, traces, token usage, and estimated cost are persisted or logged server-side.
- Normal client config does not expose `OPENAI_API_KEY`.

Partially ready:
- App-level permissions are currently a placeholder: authenticated embedded app users may use the assistant and internal actions.
- Rate limiting is in-memory per app process. This is acceptable for controlled rollout and local/dev, but should move to Redis or a shared store for horizontally scaled production.
- Debug/cost views are guarded by environment flags and development checks, but should remain internal-only.
- Chat history is persisted server-side and the active ChatKit thread is restored in the browser session.

Risky or disabled by default:
- Direct Shopify mutations are not implemented for AI actions and must stay unavailable.
- Agent Builder workflow bridge code is not part of the default architecture.
- Eval real-model mode is off unless explicitly enabled.
- Debug metadata is hidden from normal API responses unless development debug flags are enabled.

## Configuration Checklist

- [ ] `OPENAI_API_KEY` is set only on the server.
- [ ] `AI_ASSISTANT_ENABLED=true` only for shops included in rollout.
- [ ] `AI_CHATKIT_ENABLED=true` only when the ChatKit domain key is configured.
- [ ] `AI_CHATKIT_DOMAIN_KEY` contains the public OpenAI domain allowlist key.
- [ ] `AI_INTERNAL_ACTIONS_ENABLED` is set deliberately.
- [ ] `AI_ACTION_CONFIRMATIONS_ENABLED` is set deliberately.
- [ ] `AI_RATE_LIMIT_ENABLED=true`.
- [ ] `AI_COST_TRACKING_ENABLED=true`.
- [ ] `AI_DEBUG_MODE=false` in production.
- [ ] `AI_DEBUG_COSTS=false` in production unless internal-only debugging is needed.
- [ ] `AI_COST_DASHBOARD_ENABLED` is enabled only for internal/admin usage.

## Security Checklist

- [ ] All AI endpoints authenticate with Shopify Admin session.
- [ ] Shop context is derived from the server session.
- [ ] Client-supplied shop/store/user IDs are rejected or ignored.
- [ ] Conversation reads are filtered by shop.
- [ ] Action proposals are loaded by shop before confirmation/execution.
- [ ] Action proposal payloads are revalidated server-side.
- [ ] ChatKit widget actions are untrusted and validated server-side.
- [ ] No route exposes OpenAI secrets to the browser.
- [ ] No AI action calls Shopify Admin product mutation APIs.

## Monitoring Checklist

- [ ] AI turn failures.
- [ ] OpenAI API errors and timeouts.
- [ ] Rate limit events.
- [ ] Tool execution failures.
- [ ] Invalid structured-response fallbacks.
- [ ] Action proposal failures.
- [ ] Action execution failures.
- [ ] Estimated high-cost turns.
- [ ] Cross-tenant access attempts or not-found responses.

## Database Check

Relevant tables:
- `AiConversation`: indexed by `shop, updatedAt` and `shop, userId`.
- `AiConversationMessage`: indexed by `shop, conversationId, createdAt`.
- `AiConversationToolCall`: indexed by `shop, conversationId, createdAt`.
- `AiActionProposal` and `AiActionAuditLog`: shop-scoped with proposal/action indexes.
- `AiUsageEvent`: shop/time indexed for cost observability.

Current data policy:
- Messages store compact assistant text and structured blocks.
- Tool outputs are not stored as long-running conversation messages.
- Tool/action logs store validated inputs and safe errors, not secrets.
- A future cleanup job should prune old traces/messages if retention requirements demand it.

## Not Ready For User Exposure

- Direct Shopify product edits.
- AI-generated product mutation previews.
- Autonomous action execution.
- Scheduled proactive assistant workflows.
- Merchant-facing billing or cost dashboard.
- Granular user role enforcement.
