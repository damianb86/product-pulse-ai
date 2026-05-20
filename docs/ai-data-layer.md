# AI Data Layer

## Purpose

The AI data layer is a provider-neutral, server-side read API for ProductPulse data. It is designed for a future custom Polaris chat UI, ChatKit/AgentKit adapter, internal automation, or OpenAI function-calling adapter without coupling the app to any one interface.

This layer does not call OpenAI, does not build prompts, does not render UI, and does not perform Shopify mutations.

## Discovered ProductPulse Concepts

The implemented layer is based on existing persisted app concepts:

- Product risk snapshots from `ProductRiskSnapshot`.
- Completed deep diagnoses from `ProductDiagnosis`.
- Product action history from `ProductAction`.
- Source coverage and source health from `ProductPulseSource`.
- Product risk history from `ProductScoreHistory`.
- Watchlist status/settings/activity from `ProductWatchlistItem`, `ProductWatchSettings`, and `ProductWatchActivity`.

Excluded by design:

- Shopify `Session` token data.
- Source credentials.
- Contact requests.
- AI provider fallback state.
- Raw job logs, raw job payloads, raw diagnosis metric caches, raw source-event caches, and raw database errors.

## Implemented Modules

- `app/ai/domain/types.ts`: provider-neutral domain and tool types.
- `app/ai/domain/errors.ts`: safe tool error abstraction.
- `app/ai/context.server.ts`: `createAiToolContext()` and `createAiToolContextFromAuthenticatedRequest()`.
- `app/ai/repositories/productPulseAiRepository.server.ts`: compact repository layer for products, analytics, and watchlist data.
- `app/ai/tools/productPulseTools.server.ts`: read-only ProductPulse tool definitions with Zod validation.
- `app/ai/tools/registry.server.ts`: provider-neutral registry and execution surface.
- `app/ai/tools/adapters/openAiToolAdapter.ts`: placeholder converter from internal tools to JSON-schema-like OpenAI tool definitions.
- `app/ai/logging/aiToolCallLogger.server.ts`: logging interface plus noop/console implementations.

## Repositories

`ProductPulseAiRepository`

- Lists stored product risk summaries.
- Gets one stored product risk detail by product GID or handle.
- Gets bounded evidence snippets for one stored product.

`ProductPulseAnalyticsAiRepository`

- Builds a compact store-level analytics snapshot from stored ProductPulse data.
- Samples at most 1000 stored products to avoid unbounded analytics reads.

`ProductPulseWatchlistAiRepository`

- Reads current watchlist status, settings summary, and recent safe watch activity.
- Exposes alert recipient count only, never recipient emails.

Every repository method requires `AiToolContext` and scopes Prisma queries with `context.shop`.

## Tools

Registered read-only tools:

- `product_pulse_list_product_risk_summaries`
- `product_pulse_get_product_risk_detail`
- `product_pulse_get_product_evidence_snippets`
- `product_pulse_get_store_analytics_snapshot`
- `product_pulse_get_watchlist_snapshot`

Execution example:

```ts
import {
  createAiToolContextFromAuthenticatedRequest,
  executeAiTool,
} from "../ai/index.server";

const context = await createAiToolContextFromAuthenticatedRequest(request);
const result = await executeAiTool("product_pulse_get_product_risk_detail", context, {
  productRef: "gid://shopify/Product/123",
});
```

Tool inputs never include `shop`, `storeId`, `merchantId`, or user tenancy identifiers. Unknown input keys are stripped by Zod and tenant context always comes from the server-created context.

## Tenant Isolation

Tenant isolation is enforced by construction:

- `AiToolContext.shop` is created from `authenticate.admin(request)` or from explicit server-side test setup.
- Tool schemas do not accept tenant identifiers.
- Repositories use `context.shop` in every Prisma `where` clause.
- Product lookup by handle or product GID is always scoped with `shop`.
- The registry masks raw exceptions and never returns Prisma errors or stack traces.

## Validation, Limits, and Errors

- Tool input validation uses Zod.
- Default limits are conservative, usually 5 or 10.
- Result limits are hard-capped at 25, with evidence capped at 12.
- Missing product records return structured `NOT_FOUND` tool errors.
- Unknown tools return `UNKNOWN_TOOL`.
- Validation failures return `VALIDATION_ERROR`.
- Unexpected repository/database failures return `TOOL_EXECUTION_ERROR` with a generic message.

## Logging

`AiToolCallLogger` supports:

- `logToolCallStart()`
- `logToolCallSuccess()`
- `logToolCallError()`

The registry logs validated input, server-side shop/user/request/conversation metadata, tool name, duration, result count, status, safe error, and timestamp. Persistence is intentionally not implemented because there is no AI tool call table yet.

## OpenAI/ChatKit Boundary

`toOpenAiToolDefinitions()` converts internal definitions into JSON-schema-like placeholder objects. It does not call OpenAI and does not require ChatKit.

Future OpenAI or ChatKit adapters should:

- Use `listAiTools()` to discover internal tools.
- Convert tool schemas through the adapter.
- Execute calls through `executeAiTool(toolName, context, rawInput)`.
- Keep prompts, streaming, memory, and UI rendering outside this layer.

## Intentionally Not Implemented

- Chat UI.
- ChatKit or AgentKit integration.
- OpenAI API calls.
- Prompt engineering.
- Embeddings/vector search.
- Shopify write operations.
- Product edits.
- Confirmed or autonomous actions.
- Scheduled proactive notifications.
- Persistent AI tool call logs.
- Raw job-log tools.
- Live Shopify product search tools.

## Tests

Added `tests/unit/product-pulse-ai-data-layer.test.js`, covering:

- Tenant-scoped repository queries.
- Compact AI-safe repository output.
- Watchlist alert email redaction.
- Tool input validation.
- Unknown tool rejection.
- Excessive limit normalization.
- Invalid product reference handling.
- Raw repository/database error masking.

Run focused tests with:

```bash
npm test -- --run tests/unit/product-pulse-ai-data-layer.test.js
```
