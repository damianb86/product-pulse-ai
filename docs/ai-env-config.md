# AI Environment Configuration

ProductPulse uses ChatKit for UI, ProductPulse backend services for orchestration/data access/actions, and OpenAI APIs for model inference. The VM does not host an AI model.

## Required For Enabled AI

```bash
OPENAI_API_KEY=
AI_CHATKIT_DOMAIN_KEY=
```

`OPENAI_API_KEY` is server-only. Never expose it to client code.

`AI_CHATKIT_DOMAIN_KEY` is the public OpenAI domain allowlist key used by ChatKit in the browser.

`AI_CHATKIT_WORKFLOW_ID` is not required for the default custom-backend architecture.

## Feature Flags

```bash
AI_ASSISTANT_ENABLED=true
AI_CHATKIT_ENABLED=true
AI_INTERNAL_ACTIONS_ENABLED=true
AI_ACTION_CONFIRMATIONS_ENABLED=true
AI_DEBUG_MODE=false
AI_EVAL_MODE=false
```

- `AI_ASSISTANT_ENABLED=false`: disables assistant endpoints.
- `AI_CHATKIT_ENABLED=false`: disables ChatKit UI/session while leaving backend code deployable.
- `AI_INTERNAL_ACTIONS_ENABLED=false`: keeps read-only chat available but blocks internal action proposals and confirmations.
- `AI_ACTION_CONFIRMATIONS_ENABLED=false`: blocks confirmation/execution even if proposals are otherwise available.
- `AI_DEBUG_MODE=true`: internal debugging only. Keep off in production.
- `AI_EVAL_MODE=true`: eval-specific mode; keep off in production runtime.

## Model And Limits

```bash
AI_CHAT_MODEL=gpt-5.4-mini
AI_CHAT_STRONG_MODEL=gpt-5.4
AI_CHAT_CHEAP_MODEL=gpt-5.4-nano
AI_CHAT_MAX_TOOL_CALLS_PER_TURN=5
AI_CHAT_MAX_RECENT_MESSAGES=8
AI_CHAT_MAX_TOOL_RESULT_CHARACTERS=6000
AI_CHAT_MAX_OUTPUT_TOKENS=1600
AI_CHAT_MAX_STRUCTURED_RESPONSE_RETRIES=1
AI_CHAT_MAX_ACTION_PROPOSALS_PER_TURN=1
AI_CHAT_OPENAI_TIMEOUT_MS=30000
AI_CHAT_TEMPERATURE=0.2
```

These limits bound normal chat cost and prevent unbounded tool loops/history growth.

## Rate Limits

```bash
AI_RATE_LIMIT_ENABLED=true
AI_RATE_LIMIT_WINDOW_MS=60000
AI_CHAT_RATE_LIMIT_PER_MINUTE=20
AI_ACTION_RATE_LIMIT_PER_MINUTE=30
AI_CHATKIT_SESSION_RATE_LIMIT_PER_MINUTE=60
AI_CHATKIT_ACTION_RATE_LIMIT_PER_MINUTE=60
```

Current implementation is in-memory and scoped by endpoint, shop, and user/session. Use a shared store for multi-instance production.

## Cost Tracking

```bash
AI_COST_TRACKING_ENABLED=true
AI_DEBUG_COSTS=false
AI_COST_DASHBOARD_ENABLED=false
AI_MODEL_PRICING_JSON=
```

`AI_COST_DASHBOARD_ENABLED=true` shows the internal AI Costs menu/page for authenticated app sessions. Keep merchant exposure deliberate.

## Development Defaults

For local development:
- `AI_ASSISTANT_ENABLED=true`
- `AI_CHATKIT_ENABLED=true`
- `AI_DEBUG_MODE=false`
- `AI_COST_DASHBOARD_ENABLED=true` only when testing costs
- `AI_RATE_LIMIT_ENABLED=true`, with higher limits if needed

## Production Defaults

Recommended production baseline:
- `AI_ASSISTANT_ENABLED=false` until rollout starts.
- `AI_CHATKIT_ENABLED=true` only after domain key verification.
- `AI_INTERNAL_ACTIONS_ENABLED=false` for read-only pilot.
- `AI_ACTION_CONFIRMATIONS_ENABLED=false` for read-only pilot.
- `AI_RATE_LIMIT_ENABLED=true`.
- `AI_DEBUG_MODE=false`.
- `AI_EVAL_MODE=false`.
