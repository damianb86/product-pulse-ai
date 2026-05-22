# Requirements

## Functional Requirements
- FR-001: The app must render as an embedded Shopify Admin app using Shopify CLI, React Router, App Bridge and Polaris web components.
- FR-002: The authenticated app shell must expose navigation for Dashboard, Connect sources, Running jobs, Products, Product diagnosis, Analytics, Analyses and Sources & Billing.
- FR-003: Connect sources must group sources by Reviews, Returns & Refunds, Chat & Support, PDP Q&A and Product data, showing connected state, contribution and missing-source guidance.
- FR-004: Data coverage score must be deterministic from connected source weights and must show empty, partial and strong coverage states.
- FR-005: Catalog Signal Scan must be available as an included scan and create a visible running/completed job state.
- FR-006: Running jobs must show job type, source, progress, status, last update and recoverable errors.
- FR-007: Dashboard must show KPIs, start-here recommendation, highest-risk products, top issues and suggested fixes.
- FR-008: Products must show a filterable product table sorted by risk with signals, source coverage, last analysis, credit cost and Analyze action.
- FR-009: Product diagnosis must show likely cause, evidence by source, risk score, confidence, estimated impact, detected issues and applicable actions.
- FR-010: AI Product Diagnosis must consume one base credit per product in MVP and block with a validation state when credits are insufficient.
- FR-011: Applying an action must create an internal draft/action record and show success/error states. Actual product writes are limited to documented safe future mutations unless enabled with valid scopes.
- FR-012: Analyses must show completed and running diagnoses with status, risk, main issue, confidence, credits used and applied actions.
- FR-013: Analytics must show visual summaries for signals over time, issue distribution, contribution by source, risk vs impact, margin at risk by collection and source coverage.
- FR-014: Sources & Billing must show source health, coverage, plan, credits, usage and upgrade placeholders.
- FR-015: Server-side loaders/actions must authenticate with `authenticate.admin` for `/app` routes and must not expose tokens to the client.
- FR-016: Shopify Admin API operations must handle top-level `errors`, `userErrors`, 401/403/404/500 states, pagination and GIDs.
- FR-017: The app must include preview routes for local QA that do not require real merchant data.
- FR-018: The app must include fixtures, MSW mocks, unit tests, component tests, integration tests, E2E tests, accessibility tests and requirement traceability.

## Screens
- Dashboard: operational home, KPIs, recommended next product, high-risk product cards/table, issues and suggested fixes.
- Connect sources: grouped source cards, coverage score, missing sources and source-specific benefits.
- Running jobs: progress table/timeline for scan and diagnosis jobs.
- Products: table with search, risk filter, source filters, credit cost and Analyze links.
- Product diagnosis: evidence, cause, confidence, deterministic metrics and action panel.
- Analytics: charts and breakdowns using accessible HTML/CSS blocks.
- Analyses: history and running queue.
- Sources & Billing: connection state, coverage, plan and credits.

## Merchant Actions
- Connect or review each source state.
- Run Catalog Signal Scan.
- Monitor jobs.
- Search/filter products by risk and source coverage.
- Run AI Product Diagnosis for one product.
- Apply draft recommendations to a product workflow.
- Review historical analyses and credit usage.

## Data
- Created: source connection state, jobs, product risk snapshots, diagnoses, draft actions, credit ledger entries.
- Read: Shopify product, variant, order, refund and return data when scopes are granted; imported CSV reviews; future third-party sources.
- Updated: source health, job status, action status, credit balance.
- Deleted: no merchant data deletion in MVP; app uninstall cleanup is documented.

## Shopify Admin API
- Products and variants are read for titles, handles, tags, collections and variant context.
- Orders/refunds/returns are read for deterministic return/refund metrics and return reasons.
- Product writes are future-gated for tags, product copy and metafields; MVP stores draft actions internally.

## Scopes
- Request: `read_products`, `write_products`, `read_orders`, `read_all_orders`, `write_orders`, `read_customers`, `write_customers`, `read_returns`, `write_returns`, `read_inventory`, `write_inventory`, `read_locations`.
- `read_all_orders` is required for full historical order analysis and must be approved in the Shopify Partner Dashboard before production use.
- `read_customers` is required to use Shopify customer IDs as safe same-customer keys for before/after product relationship analytics.
- `write_orders`, `write_returns` and `write_customers` are required only for the controlled Shopify mock dataset generator in Settings.

## Webhooks
- Required: `app/uninstalled`, `app/scopes_update`.
- Future: `products/update`, `orders/updated`, return-related updates if available and needed.

## Billing
- MVP shows plan and credit state internally.
- Production needs Shopify billing before paid plans or purchasable credits are enabled.

## AI
- AI is only used for classification, grouping phrases, separating noise, explaining likely causes and drafting recommendations.
- Deterministic metrics such as return rate, refund rate, estimated impact, trends and risk score must be computed by app code.
- AI output must be schema-validated before storage or display.

## Non-Functional Requirements
- Security: tokens server-side only, no secrets in repo, input validation in server actions.
- Privacy: minimize customer/order data, avoid PII in logs and fixtures.
- Performance: cursor pagination for Shopify reads, bounded diagnosis inputs and lazy loading for future heavy charts.
- Accessibility: semantic headings, labels, keyboard navigation, visible focus and axe coverage.
- Resilience: recoverable UI for missing scopes, expired sessions, API errors and rate limits.
- Maintainability: pure scoring helpers, app config constants, fixtures and traceability matrix.
- Observability: future audit events per shop without PII.
- Localization: English UI for MVP, copy isolated for future i18n.
