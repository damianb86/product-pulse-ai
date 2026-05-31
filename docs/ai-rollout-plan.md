# AI Rollout Plan

## Architecture

ChatKit UI -> ProductPulse backend -> OpenAI Responses API -> ProductPulse AI tools/actions -> ProductPulse database.

No Agent Builder workflow is required. No model runs on the VM.

## Development Enablement

1. Set `OPENAI_API_KEY`.
2. Set `AI_CHATKIT_DOMAIN_KEY` to the registered local tunnel domain key.
3. Set:

```bash
AI_ASSISTANT_ENABLED=true
AI_CHATKIT_ENABLED=true
AI_INTERNAL_ACTIONS_ENABLED=true
AI_ACTION_CONFIRMATIONS_ENABLED=true
AI_RATE_LIMIT_ENABLED=true
```

4. Run `npm run dev`.
5. Verify `/app/ai-debug` and `/app/ai-costs` only if their flags are enabled.

## Pilot Shop Rollout

Start read-only:

```bash
AI_ASSISTANT_ENABLED=true
AI_CHATKIT_ENABLED=true
AI_INTERNAL_ACTIONS_ENABLED=false
AI_ACTION_CONFIRMATIONS_ENABLED=false
```

Monitor:
- AI turn failures.
- OpenAI API errors.
- Average and p95 duration.
- Token usage and estimated cost.
- Tool call counts.
- Rate limit events.
- Invalid structured-response fallbacks.

Then enable internal actions:

```bash
AI_INTERNAL_ACTIONS_ENABLED=true
AI_ACTION_CONFIRMATIONS_ENABLED=true
```

Confirm that action proposals remain app-internal and Shopify resources are not mutated.

## All-Shop Rollout

1. Keep rate limits enabled.
2. Keep debug flags off.
3. Keep cost tracking enabled.
4. Review AI Costs daily for the first week.
5. Review failed traces and action audit logs.

## Quick Disable

Disable all assistant behavior:

```bash
AI_ASSISTANT_ENABLED=false
```

Disable only ChatKit UI:

```bash
AI_CHATKIT_ENABLED=false
```

Disable internal actions while keeping read-only chat:

```bash
AI_INTERNAL_ACTIONS_ENABLED=false
AI_ACTION_CONFIRMATIONS_ENABLED=false
```

## Rollback

1. Set `AI_ASSISTANT_ENABLED=false`.
2. Redeploy/restart if env changes require it.
3. Confirm `/api/ai/chatkit/session` returns disabled.
4. Monitor for remaining OpenAI usage.

## Known Limitations

- Rate limiting is in-memory per process.
- Permissions are authenticated-user only until app roles are introduced.
- Chat history is per browser session for active-thread restoration and persisted per shop in the database.
- No Shopify mutations are implemented.
- No proactive/autonomous workflows are implemented.
