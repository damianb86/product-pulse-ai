# ProductPulse AI

ProductPulse AI is a Shopify embedded app that connects product, return, refund and review signals to detect product quality problems and turn them into concrete catalog actions.

## Stack
- Shopify CLI React Router template
- React Router loaders/actions
- App Bridge embedded shell
- Polaris web components
- Prisma + PostgreSQL
- Vitest, React Testing Library, MSW, Playwright and axe

## Local Setup
```bash
npm install
cp .env.example .env
npm run setup
npm run dev
```

Set real local values in `.env`:
```bash
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=
SHOPIFY_ADMIN_APP_HANDLE=product-pulse-ai
SCOPES=read_products,write_products,read_orders,read_all_orders,write_orders,read_customers,write_customers,read_returns,write_returns,read_inventory,write_inventory,read_locations
DATABASE_URL=postgresql://qorve_dev:replace-with-local-password@127.0.0.1:5432/product_pulse_ai
PRODUCT_PULSE_AI_LEVEL=1
OPENAI_API_KEY=
OPENAI_BASIC_MODEL=gpt-5.4-nano
OPENAI_PRO_MODEL=gpt-5.4-mini
OPENAI_PREMIUM_MODEL=gpt-5.4
GEMINI_API_KEY=
GEMINI_MODEL=
AI_CHAT_MODEL=gpt-5.4-mini
AI_CHATKIT_DOMAIN_KEY=domain_pk_6a0e373140408193b67487c54e353dbd09dbeb51913073da
```

`PRODUCT_PULSE_AI_LEVEL` controls ProductPulse diagnosis AI routing:
- `1`: development mode using Gemini first, with OpenAI Basic fallback when Gemini is exhausted.
- `2`: development mode using `OPENAI_BASIC_MODEL` for every ProductPulse diagnosis AI task.
- `3`: production mode using task-specific `OPENAI_BASIC_MODEL`, `OPENAI_PRO_MODEL`, and `OPENAI_PREMIUM_MODEL`.

When `PRODUCT_PULSE_AI_LEVEL` is not set, local development defaults to `1` and non-development runtime defaults to `3`.

The Shopify app requests `read_all_orders` together with `read_orders` so ProductPulse can analyze historical orders beyond Shopify's standard recent-order window. It also requests `read_customers` so same-customer product sequence relationships can use Shopify customer IDs without exposing names or emails. `write_orders`, `write_returns`, and `write_customers` are used by the Settings mock dataset generator, which creates controlled Shopify test customers, orders, refunds and returns. Protected scopes must be approved in the Partner Dashboard before installing or reauthorizing the app on a store.

Required scopes are also defined in code. If local `SCOPES` is present but stale, ProductPulse merges it with the required scope list so a local environment variable cannot silently remove permissions the app needs.

The local Shopify CLI project is configured for `damian-xdcxxupp` in `.shopify/project.json`, which is intentionally ignored by Git.

## Preview Without Shopify Auth
```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/product_pulse_ai npm run dev:preview
```

Open `http://127.0.0.1:3000/preview`.

## QA
```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/product_pulse_ai npm run qa
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/product_pulse_ai PLAYWRIGHT_START_SERVER=true npm run test:e2e
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/product_pulse_ai PLAYWRIGHT_START_SERVER=true npm run test:a11y
```

`npm run qa` runs typecheck, lint, Vitest, Shopify config validation and Shopify build. E2E and accessibility are separate because CI gates them behind `RUN_E2E=true`.

## Watchlist Cron
Production should run Watchlist scans from an external scheduler, not from an in-process Node timer. Configure the scheduler to call:

```bash
GET https://your-app.example.com/cron/watchlist
Authorization: Bearer $PRODUCT_PULSE_WATCHLIST_CRON_SECRET
```

The route is idempotent for the configured schedule window and uses a Postgres-backed distributed lock so multiple app instances or duplicate scheduler requests do not queue the same Watchlist run at the same time.

Relevant env vars:

```bash
PRODUCT_PULSE_WATCHLIST_CRON_TIME=03:00
PRODUCT_PULSE_WATCHLIST_CRON_TIMEZONE=UTC
PRODUCT_PULSE_WATCHLIST_CRON_WINDOW_MINUTES=120
PRODUCT_PULSE_WATCHLIST_CRON_LOCK_TTL_MINUTES=120
PRODUCT_PULSE_WATCHLIST_CRON_SECRET=
```

If the host supports a literal server cron instead of HTTP cron, run:

```bash
npm run watchlist:cron
```

For local testing:

```bash
npm run watchlist:cron:force
```

## AI ChatKit

The embedded assistant uses OpenAI ChatKit for the UI and the ProductPulse backend for orchestration. It does not require an Agent Builder workflow or `AI_CHATKIT_WORKFLOW_ID`.

Relevant env vars:

```bash
OPENAI_API_KEY=
AI_ASSISTANT_ENABLED=true
AI_CHAT_MODEL=gpt-5.4-mini
PRODUCT_PULSE_CHAT_MESSAGES_PER_POINT=10
AI_CHAT_MAX_TOOL_CALLS_PER_TURN=5
AI_CHAT_MAX_OUTPUT_TOKENS=1600
AI_RATE_LIMIT_ENABLED=true
AI_CHAT_RATE_LIMIT_PER_MINUTE=20
AI_ACTION_RATE_LIMIT_PER_MINUTE=30
AI_COST_TRACKING_ENABLED=true
AI_DEBUG_COSTS=false
AI_DEBUG_MODE=false
AI_COST_DASHBOARD_ENABLED=false
AI_CHATKIT_ENABLED=true
AI_CHATKIT_API_URL=/api/ai/chatkit/message
AI_CHATKIT_DOMAIN_KEY=domain_pk_6a0e373140408193b67487c54e353dbd09dbeb51913073da
AI_INTERNAL_ACTIONS_ENABLED=true
AI_ACTION_CONFIRMATIONS_ENABLED=true
```

The browser receives only safe ChatKit config, including the public ChatKit domain key from OpenAI's domain allowlist. OpenAI inference runs server-side through the existing `/api/ai/chatkit/message` adapter and `AiChatOrchestrator`.

`AI_ASSISTANT_ENABLED=false` disables all assistant endpoints. `AI_INTERNAL_ACTIONS_ENABLED=false` keeps read-only chat available while blocking internal app action proposals and confirmations. `AI_CHATKIT_WORKFLOW_ID` is intentionally not required for the default custom-backend architecture.
`PRODUCT_PULSE_CHAT_MESSAGES_PER_POINT` controls how many successful assistant responses consume 1 ProductPulse credit; the default is `10`.

AI cost/eval tooling:

```bash
npm run ai:eval
```

The eval runner uses mocked OpenAI responses by default. Internal traces with token usage and estimated cost are stored server-side on assistant messages; normal ChatKit responses do not expose token or cost data.

Set `AI_COST_DASHBOARD_ENABLED=true` to show the internal `AI Costs` menu item at `/app/ai-costs`. The dashboard aggregates tracked chat, diagnosis, CSV import, watchlist and other AI usage for the authenticated shop. USD values are estimates from token usage and the configured pricing table.

## Documentation
- `docs/product-brief.md`
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/ai-cost-and-call-flow.md`
- `docs/ai-cost-evaluation-observability.md`
- `docs/ai-env-config.md`
- `docs/ai-production-readiness.md`
- `docs/ai-rollout-plan.md`
- `docs/shopify-integration.md`
- `docs/qa-plan.md`
- `docs/requirement-traceability-matrix.md`
- `docs/app-store-review-checklist.md`

## MVP Limitations
- Real third-party connectors are placeholders.
- AI diagnosis is represented through deterministic fixtures and validated output contracts.
- Product write actions are stored as draft recommendations; production Shopify writes require explicit `write_products` scope and merchant confirmation.
- Real Shopify billing is not enabled yet.
