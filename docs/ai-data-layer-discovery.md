# AI Data Layer Discovery

## Existing Data Inventory

ProductPulse is a Shopify embedded app backed by Prisma/PostgreSQL. App-owned tenant isolation is consistently modeled with a `shop` string on merchant-scoped records. The Shopify `Session` table also stores `shop`, but it contains OAuth/session material and should not be exposed to an LLM.

### Tables and AI relevance

- `Session`: Shopify session and OAuth data. Relevant only for server authentication. Do not expose `accessToken`, refresh tokens, user profile fields, scopes, or session IDs to AI tools.
- `ProductPulseSource`: one row per source per shop. Represents source availability, connection state, health, and coverage weight. AI-safe fields are source key/name/category, connected/active/available/health, coverage weight, and sync timestamps. Do not expose `credentials`, raw `config` fields that include file paths, checksums, token fragments, or import internals.
- `CatalogSignalJob`: scan/import/diagnosis jobs. Useful for compact activity/status summaries. AI-safe fields are kind, source label, status, progress, started/updated/finished timestamps, and product references from payload when already merchant-visible. Do not expose raw payloads or database errors.
- `ProductPulseAiProviderState`: provider/model fallback state. Internal operational state only. Do not expose to LLMs.
- `ProductPulseJobLog`: development-only job logs. Too low-level and may include serialized operational data. Do not expose raw logs. Future activity tools should summarize safe events only.
- `ProductRiskSnapshot`: primary ProductPulse product risk snapshot per shop/product. Useful for AI. Relevant fields are product GID/title/handle, risk/impact/confidence, primary issue, source coverage, compact metrics, calculated/updated timestamps. Do not return the full `metrics` JSON because it can contain cached source events, customer text caches, Shopify product internals, and detailed AI usage.
- `ProductDiagnosis`: completed or in-progress product diagnosis output. Useful for AI when compacted. Relevant fields are product GID/title, status, risk score, confidence, likely cause, issues, evidence, recommendations, credits consumed, created/completed timestamps. Do not expose raw full arrays without limits. Do not expose cached prompt inputs or raw model outputs, which are not stored here directly but may be present in related metric caches.
- `ProductAction`: stored draft/applied/dismissed actions. Useful as read-only action history and recommendation status. Relevant fields are action type, label, status, created/applied timestamps, diagnosis link, and small safe payload summaries. Do not expose full payloads unbounded; draft copy should be truncated.
- `ProductWatchlistItem`: merchant watchlist rows. Useful for watchlist status. Relevant fields are product GID/title/handle/SKU/status/image metadata and timestamps. Tenant scoped by `shop`.
- `ProductWatchSettings`: watch cadence and alert configuration. Useful only as a compact settings summary. Do not expose `alertRecipients` emails; expose recipient count instead.
- `ProductWatchActivity`: watchlist activity and change reports. Useful as recent activity if summarized. Relevant fields are event type, title/detail, product title/GID, timestamps, and selected safe metadata such as risk score/label/primary issue. Do not expose raw `metadata.report` or cached evidence details without limits.
- `ProductPulseSchedulerLock`: cron lock state. Internal only. Do not expose.
- `ProductScoreHistory`: product risk history over time. Useful for compact trends. Relevant fields are product GID/title, source, risk/impact/confidence, primary issue, recorded timestamp, and selected metrics. Tenant scoped by `shop`.
- `ContactRequest`: merchant help/contact content. Not useful for product diagnosis chat. Contains free-form message and email; do not expose.
- `CreditLedgerEntry`: credit balance history. Potentially useful for billing UI but not needed for product analysis tools. If exposed later, use current balance only; do not expose raw ledger history by default.

## Existing UI/Data Flow Inventory

- Dashboard (`app/routes/app._index.jsx`, `DashboardScreen`): authenticates with Shopify, then calls `getDashboardDataForShop(session.shop, admin)`. Data comes from `ProductRiskSnapshot`, latest `CreditLedgerEntry`, active `CatalogSignalJob`, `ProductAction`, latest completed `ProductDiagnosis`, Shopify product image/count reads, and `buildDashboardViewData`. It is aggregated and formatted, not raw.
- Products (`app/routes/app.products.jsx`, `ProductsScreen`): calls `getProductsQueueForShop(session.shop, admin, filters, settings)`. Data comes from risk snapshots, active scan/diagnosis jobs, watchlist rows, latest completed diagnoses, score history, and Shopify image reads. Rows are filtered, sorted, paginated, formatted, and partly calculated.
- Product detail (`app/routes/app.products_.$productId.jsx`, `ProductDiagnosisScreen`): calls `getProductDetailForShop(session.shop, params.productId, admin)`. It first resolves a scoped ProductPulse snapshot, then falls back to live Shopify product detail if no snapshot exists. Stored details combine snapshot metrics, latest diagnosis issues/evidence/recommendations, action history, watchlist status, and risk history.
- Product evidence report (`app/routes/app.products_.$productId_.evidence.jsx`, `ProductEvidenceReportScreen`): reuses `getProductDetailForShop` and renders evidence/report sections from the formatted product detail. Evidence is persisted/generated, not directly queried from source systems at render time.
- Analytics (`app/routes/app.analytics.jsx`, `AnalyticsScreen`): calls `getAnalyticsDataForShop(session.shop)`. Data comes from snapshots, sources, actions, score history, settings, and latest diagnoses, then `buildAnalyticsViewData` calculates analytics.
- Watchlist (`app/routes/app.watchlist.jsx`, `WatchlistScreen`): calls `getWatchlistForShop(session.shop)`. Data comes from watchlist items, risk snapshots, latest watch change report activities, active diagnosis jobs, product score history, watch settings, and aggregated activity stats.
- Watchlist activity (`app/routes/app.watchlist.activity.jsx`, `WatchlistActivityScreen`): calls `getWatchlistActivityForShop(session.shop)`. Data comes from `ProductWatchActivity` summarized for display.
- Connect (`app/routes/app.connect.jsx`, `ConnectScreen`): calls `getConnectViewDataForShop(session.shop)`. It ensures source rows exist, then formats `ProductPulseSource` records. Credential-bearing fields are not intended for UI display.
- Settings (`app/routes/app.settings.jsx`, `SettingsScreen`): calls settings and mock dataset state services. Settings include scan thresholds/cadence and should not be mixed into product evidence except for labels/threshold interpretation.
- Job monitor (`app/routes/app.job-status.jsx`, `ProductPulseJobMonitor`): calls `getJobMonitorForShop(session.shop)`. It displays active/recent jobs and development logs. Logs are low-level and should not be raw AI input.

## Existing Business Concepts

- Shopify shop/tenant: represented by `session.shop` and app-owned `shop` columns.
- Source coverage: Shopify product/orders/returns/refunds, Judge.me reviews, CSV reviews, and future sources represented by `ProductPulseSource` plus snapshot `sourceCoverage`.
- QuickScan/product risk snapshot: deterministic product-level risk record in `ProductRiskSnapshot`.
- Deep product diagnosis: completed AI-assisted persisted analysis in `ProductDiagnosis`, with issues, evidence, recommendations, and updated snapshot metrics.
- Product action: draft/applied/dismissed ProductPulse recommendation or workflow record in `ProductAction`. Some action payloads can contain draft product copy but no Shopify write should happen in this AI data layer.
- Watchlist: capped merchant watchlist in `ProductWatchlistItem`, settings in `ProductWatchSettings`, activity/change reports in `ProductWatchActivity`.
- Analytics: derived view data from snapshots, score history, sources, actions, and settings.
- Jobs and logs: background work state in `CatalogSignalJob` and development logs in `ProductPulseJobLog`.
- Credits: credit ledger entries consumed by deep diagnoses.

## AI Suitability Assessment

Safe and useful:

- Compact product risk summaries from `ProductRiskSnapshot`.
- Latest completed diagnosis summary from `ProductDiagnosis`.
- Bounded issue/evidence/recommendation snippets.
- Compact metrics: return/refund rates, review counts/ratings, signal counts, estimated impact, source coverage, risk history points.
- Source connection/coverage summaries without credentials/config internals.
- Watchlist status and recent safe activity summaries.

Needs summarization/limits:

- `ProductRiskSnapshot.metrics`: large nested object with cached source events and source-specific internals. Expose allow-listed metric fields only.
- `ProductDiagnosis.issues`, `evidence`, and `recommendations`: can be useful but should be capped and text-truncated.
- `ProductAction.payload`: expose only selected safe summaries and truncated draft previews.
- `ProductScoreHistory`: return recent compact points only.
- `ProductWatchActivity.metadata`: expose selected risk/change fields only.

Too large/noisy/low-level:

- Raw job logs.
- Full job payloads.
- Full watch change reports.
- Full source import config.
- Full cached source event data under diagnosis/snapshot metrics.

Never expose:

- Shopify session tokens, refresh tokens, credentials, API keys, HMACs, cookies.
- `ProductPulseSource.credentials`.
- Merchant alert recipient emails from watch settings.
- Contact request emails/messages.
- Raw database errors, stack traces, Prisma error details.
- Tenant identifiers in tool outputs unless needed internally by logging. Tool inputs must never accept shop/store/user IDs.

## Proposed AI Data Layer Design

### Domain types

Create provider-neutral TypeScript domain types under `app/ai/domain`:

- `AiToolContext`: server-created context containing authenticated `shop`, optional user/session metadata, conversation/request IDs, scopes, and timestamp.
- `AiDataFreshness`: source/timestamp metadata for compact results.
- `AiProductRiskSummary` and `AiProductRiskDetail`: compact ProductPulse product summaries/details.
- `AiDiagnosisSummary`, `AiIssueSummary`, `AiEvidenceSnippet`, `AiRecommendationSummary`, `AiActionHistorySummary`.
- `AiAnalyticsSnapshot`, `AiSourceSummary`, `AiWatchlistSnapshot`, `AiWatchlistItemSummary`, `AiRecentActivityItem`.
- `AiToolResult`, `AiToolError`, `AiToolDefinition`, `AiToolExecutionResult`.

### Repositories

Create repository classes that require `AiToolContext` for every method and scope all Prisma queries with `context.shop`:

- `ProductPulseAiRepository`: product risk summaries, product details, evidence snippets.
- `ProductPulseAnalyticsAiRepository`: store-level compact analytics.
- `ProductPulseWatchlistAiRepository`: watchlist status and recent watch activity.

Each method should enforce conservative limits, return AI-facing domain objects, and avoid raw rows.

### Read-only tools

Create only tools supported by current stored data:

- `productPulse.listProductRiskSummaries`: list/search stored ProductPulse product snapshots.
- `productPulse.getProductRiskDetail`: get a compact product risk/diagnosis/action detail for one stored product by product GID or handle.
- `productPulse.getProductEvidenceSnippets`: get bounded evidence snippets for one stored product.
- `productPulse.getStoreAnalyticsSnapshot`: get compact aggregate product risk/source/action analytics.
- `productPulse.getWatchlistSnapshot`: get current watchlist status and recent safe watch activity.

Future tools, not implemented in this phase:

- Live Shopify product search tools. Existing code can search Shopify, but future AI tools would need explicit Admin API cost/permission handling and should stay read-only.
- Any tool that queues diagnoses, applies actions, edits products, mutates watchlist state, or uses OpenAI/ChatKit.
- Raw job-log inspection tools.

### Tool registry

Create a provider-neutral registry exposing:

- `listAiTools()`
- `getAiToolDefinition(toolName)`
- `executeAiTool(toolName, context, rawInput)`

Tool definitions should include name, description, Zod input schema, executor, `readOnly`, category, permission level, and safe metadata. The registry should catch validation, unknown-tool, repository, and unexpected errors and return structured safe errors.

### OpenAI adapter boundary

Create a placeholder adapter under `app/ai/tools/adapters` that converts internal definitions into JSON-schema-like objects later. It must not call OpenAI and must keep provider-specific logic outside the internal tool definitions.

### Logging strategy

Create an `AiToolCallLogger` interface with start/success/error methods. Implement a noop logger and a console-safe logger. Log server-side shop/user/request/conversation IDs, tool name, validated input, duration, result count, status, safe errors, and timestamps. Do not persist yet because there is no AI tool call table.

### Test strategy

Use Vitest unit tests with fake Prisma-like repositories or injected mock database clients. Cover tenant isolation, output compaction, input validation, unknown tools, limit normalization, missing data, raw error masking, registry execution, and logger calls. Tests should not call Shopify, OpenAI, ChatKit, or React UI.

## Open Questions and Assumptions

- Product-level tools will initially operate on stored ProductPulse snapshots only. Live Shopify-only products are omitted because they require Admin API access and are not stored as complete ProductPulse risk records.
- `productGid` and product `handle` are considered safe product references for tool input. Tenant/shop is always server-derived.
- Draft recommendation text is useful but can be long; initial tools should return truncated previews rather than full raw payloads.
- Source connection summaries are useful, but source credentials and import file internals must stay hidden.
