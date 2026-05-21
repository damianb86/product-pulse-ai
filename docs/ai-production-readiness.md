# AI Production Readiness

## Final Architecture

ProductPulse uses:
- ChatKit as the chat UI.
- ProductPulse backend as the orchestration layer.
- OpenAI APIs for inference.
- ProductPulse AI tool registry for read-only app data.
- ProductPulse internal action registry for confirmed app-internal side effects.
- ProductPulse app-only draft mutation registry for editable drafts that never apply to Shopify.

The default architecture does not use Agent Builder hosted workflows and does not require `AI_CHATKIT_WORKFLOW_ID`.

## Feature Flags

- `AI_ASSISTANT_ENABLED`: global kill switch.
- `AI_CHATKIT_ENABLED`: ChatKit UI/session switch.
- `AI_INTERNAL_ACTIONS_ENABLED`: internal action proposal switch.
- `AI_APP_MUTATIONS_ENABLED`: editable app-only draft proposal/save switch.
- `AI_ACTION_CONFIRMATIONS_ENABLED`: internal action confirmation/execution switch.
- `AI_RATE_LIMIT_ENABLED`: request protection switch.
- `AI_COST_TRACKING_ENABLED`: token/cost logging switch.
- `AI_DEBUG_MODE`: internal debug switch.
- `AI_EVAL_MODE`: eval-only switch.

## Permissions Model

Current permission model:
- Shopify Admin auth is required for all AI endpoints.
- Tenant context is derived from server session.
- Authenticated app users can use read-only chat.
- Authenticated app users can use internal actions only when action flags are enabled.
- Authenticated app users can save app-only AI drafts only when app mutation and confirmation flags are enabled.

Future extension:
- Add merchant role checks to `app/ai/security/permissions.server.ts`.
- Restrict medium/high side-effect actions by role.

## Rate Limits

Rate limits are scoped by endpoint bucket, shop, and user/session.

Protected paths:
- `/api/ai/chat`
- `/api/ai/chatkit/message`
- `/api/ai/chatkit/session`
- `/api/ai/chatkit/action`
- `/api/ai/actions/propose`
- `/api/ai/actions/confirm`
- `/api/ai/actions/cancel`

Current storage is in-memory. Replace with Redis or database-backed counters for multi-instance production.

## Operational Limits

Configured limits include:
- max user message length;
- max ChatKit payload size;
- max page context size;
- max action input size;
- max tool calls per turn;
- max recent messages sent to OpenAI;
- max tool result characters;
- max output tokens;
- max structured response retries;
- max action proposals per turn;
- OpenAI timeout.

## Logging And Alerts

Log and monitor:
- OpenAI errors/timeouts;
- failed AI turns;
- tool failures;
- action proposal/confirmation/execution failures;
- rate limit events;
- high-cost turns;
- invalid structured responses;
- tenant not-found/cross-shop attempts.

Do not log:
- OpenAI API keys;
- Shopify secrets;
- huge raw prompts by default;
- unnecessary raw customer data.

## Rollout And Rollback

See `docs/ai-rollout-plan.md`.

Recommended pilot:
1. Enable read-only ChatKit first.
2. Watch costs and traces.
3. Enable internal actions only after confirmation UX is validated.
4. Keep Shopify mutations unavailable.

Rollback:
- set `AI_ASSISTANT_ENABLED=false`.

## Known Limitations

- Rate limiting is per process.
- Permissions are coarse until app roles exist.
- No Shopify mutations.
- No billing integration.
- No proactive/autonomous assistant behavior.
- No complex long-term memory.
