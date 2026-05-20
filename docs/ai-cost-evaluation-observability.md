# AI Cost, Evaluation, And Observability

## Purpose

This phase makes the ProductPulse assistant measurable before adding more features. It tracks OpenAI call counts, token usage, estimated cost, structured-response validity, tool usage, action proposals, action confirmations, and fallback behavior.

## Runtime Call Flow

See `docs/ai-cost-and-call-flow.md` for the detailed sequence diagram.

Expected behavior:

- A simple chat turn usually makes one backend OpenAI call.
- A data-backed turn makes one call to request tools and another call after tool results.
- Structured-output repair can add one configured retry.
- ChatKit action confirmation/cancellation executes through the backend action registry and does not call OpenAI.

## Token Tracking

`app/ai/observability/tokenUsage.ts` normalizes usage from OpenAI response objects:

- `inputTokens`
- `outputTokens`
- `cachedInputTokens`
- `reasoningOutputTokens`
- `totalTokens`

The orchestrator combines usage across every OpenAI response in the turn.

## Cost Estimation

`app/ai/observability/pricing.ts` centralizes model pricing and cost estimation.

Supported configuration:

- `AI_COST_TRACKING_ENABLED`: default `true`.
- `AI_DEBUG_COSTS`: exposes debug cost metadata only in development API responses.
- `AI_MODEL_PRICING_JSON`: JSON map for model pricing overrides.
- `AI_CHAT_INPUT_PRICE_PER_MILLION`, `AI_CHAT_CACHED_INPUT_PRICE_PER_MILLION`, `AI_CHAT_OUTPUT_PRICE_PER_MILLION`: simple override for the configured `AI_CHAT_MODEL`.

Estimates are marked as estimates and stored in the internal trace. Missing usage or unknown pricing produces a non-crashing trace with `missingUsage` or `missingPricing`.

## Cost Guardrails

Configured in `app/ai/chat/config.server.ts`:

- max tool calls per turn;
- max structured-response retries;
- max recent messages sent to the model;
- max tool result size;
- max output tokens;
- OpenAI timeout;
- max action proposals per response.

Schema validation also caps:

- response blocks/widgets;
- evidence snippets;
- metric rows;
- suggested replies;
- referenced entities.

## Conversation History Trimming

The orchestrator persists full conversation messages but sends only the latest `AI_CHAT_MAX_RECENT_MESSAGES` user/assistant messages to OpenAI. Tool outputs are not persisted as conversation history messages, so large tool payloads are not repeatedly sent in later turns.

Current page context is sent separately as a compact reference when available.

## Eval Cases

Eval cases live in:

- `app/ai/evals/cases/productPulseEvalCases.js`

They cover:

- product summary;
- diagnosis/evidence-style data access;
- watchlist query;
- recommended internal action proposal;
- action confirmation;
- missing data;
- cross-tenant prompt attempt;
- general question with no tools;
- Shopify mutation request refusal.

Run:

```bash
npm run ai:eval
```

The eval runner uses mocked OpenAI responses by default. It does not make real OpenAI calls unless a future runner explicitly wires that behind `AI_EVAL_REAL_OPENAI=true`.

## Behavioral Assertions

Assertions live in:

- `app/ai/evals/assertions.js`

They check:

- expected and forbidden tool calls;
- expected and forbidden action proposals;
- actions not executed before confirmation;
- expected block types;
- missing/hallucinated text markers;
- tenant isolation;
- cost thresholds;
- structured response shape.

## Hallucination Checks

Current checks are practical string/structure checks, not a second-model judge. They catch:

- unavailable metrics mentioned as if real;
- product names or evidence not present in the eval fixture;
- action execution claims before confirmation;
- Shopify mutation claims;
- unsupported action claims.

## AI Trace Logging

Each assistant message stores `structuredContent.trace` with:

- schema version;
- conversation/message IDs;
- shop and user IDs server-side;
- model;
- instruction version;
- OpenAI response IDs;
- OpenAI call count;
- token usage;
- estimated cost;
- tool/action counts;
- structured response validation state;
- guardrail settings;
- page context;
- duration;
- error status.

The trace does not include raw prompts, secrets, API keys, raw database rows, or large tool outputs.

## Debug Workflow

Development/debug route:

- `/app/ai-debug`

It is available only in development mode or when `AI_DEBUG_COSTS=true`. It shows recent internal AI traces for the authenticated shop.

Normal ChatKit UI and normal `/api/ai/chat` responses do not expose token usage or estimated cost unless development debug is explicitly enabled.

## Known Limitations

- Cost estimates depend on OpenAI usage payloads and locally configured pricing.
- Real-model eval execution is intentionally not wired into the default runner.
- Hallucination checks are deterministic and fixture-based.
- There is no merchant-facing cost dashboard in this phase.

## Future Improvements

- Persist traces in a dedicated table if querying traces becomes important.
- Add real-model eval mode behind an explicit opt-in.
- Add regression snapshots for high-value conversations.
- Add percentile latency and cost aggregation per shop.
