# Implementation Plan

## Expected File Tree
- `app/components/ProductPulseScreens.jsx`
- `app/lib/product-pulse-data.js`
- `app/lib/product-pulse-scoring.js`
- `app/lib/product-pulse-validation.js`
- `app/routes/app.*.jsx`
- `app/routes/preview.jsx`
- `tests/setup.js`
- `tests/fixtures/product-pulse-fixtures.js`
- `tests/mocks/handlers.js`
- `tests/unit/*.test.js`
- `tests/components/*.test.jsx`
- `tests/integration/*.test.js`
- `tests/e2e/*.spec.js`
- `tests/accessibility/*.spec.js`
- `docs/*.md`
- `Dockerfile`, `docker-compose.yml`, `.env.example`, `docker/app/init-db.sh`
- `.github/workflows/qa.yml`

## Changes By Area
- Product docs: formalize app scope, requirements and acceptance criteria.
- Shopify config: set ProductPulse scopes and remove template demo metafields/metaobjects.
- Prisma: switch to PostgreSQL and add app-owned ProductPulse models.
- UI: replace scaffold demo with ProductPulse screens and preview route.
- Services: add deterministic scoring, fixtures, validations and action handlers.
- QA: add Vitest, Testing Library, MSW, Playwright and axe tests.
- CI: add QA workflow with Postgres service and gated E2E.

## Dependencies
- `vitest`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `jsdom`
- `msw`
- `@playwright/test`
- `@axe-core/playwright`
- `@vitejs/plugin-react`

## Scripts
- `typecheck`
- `lint`
- `test`
- `test:watch`
- `test:coverage`
- `test:e2e`
- `test:e2e:ui`
- `test:a11y`
- `shopify:validate`
- `shopify:build`
- `qa`

## Work Order
1. Commit generated scaffold.
2. Add product/architecture docs.
3. Add data, scoring, validation helpers and Prisma models.
4. Replace app screens.
5. Add tests, fixtures, mocks and CI.
6. Run install, typecheck, lint, tests, build and Shopify validations.
7. Fix failures and push all commits.

## Risks
- Shopify CLI validation requires login in non-interactive environments.
- Real order/return scopes require clear App Store justification.
- Product write actions require careful merchant confirmation and App Store review.
- AI diagnosis requires provider credentials and output validation before production.

## Credentials Needed
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `DATABASE_URL`
- Optional future AI provider API key.
