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
SCOPES=read_products,read_orders,read_returns
DATABASE_URL=postgresql://qorve_dev:replace-with-local-password@127.0.0.1:5432/product_pulse_ai
```

The local Shopify CLI project is configured for `qorve-dev.myshopify.com` in `.shopify/project.json`, which is intentionally ignored by Git.

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

## Documentation
- `docs/product-brief.md`
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/shopify-integration.md`
- `docs/qa-plan.md`
- `docs/requirement-traceability-matrix.md`
- `docs/app-store-review-checklist.md`

## MVP Limitations
- Real third-party connectors are placeholders.
- AI diagnosis is represented through deterministic fixtures and validated output contracts.
- Product write actions are stored as draft recommendations; production Shopify writes require explicit `write_products` scope and merchant confirmation.
- Real Shopify billing is not enabled yet.
