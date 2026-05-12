# QA Plan

## Strategy
ProductPulse AI uses layered QA: deterministic unit tests for scoring and validation, component tests for Polaris screens, integration tests for action/view-model behavior, Playwright smoke tests for local preview and axe accessibility scans.

## Unit
- Coverage score calculation.
- Risk score calculation.
- Credit validation.
- GraphQL top-level error parsing.
- GraphQL `userErrors` parsing.
- AI output validation shape.
- Source/category helpers.

## Components
- Dashboard KPIs and start-here recommendation.
- Connect sources empty/partial/strong states.
- Products table filtering and empty state.
- Diagnosis evidence and actions.
- Billing credits and source health.

## Integration
- Catalog scan action creates a job result.
- Diagnosis action consumes/blocks credits.
- Apply action validates product/action IDs.
- Missing scope and API error view models render correctly.

## E2E
- Open preview home.
- Navigate to every ProductPulse screen.
- Run scan in preview.
- Open a product diagnosis.
- Validate narrow viewport usability.

## Accessibility
- Axe scan Dashboard, Connect sources, Products, Diagnosis and Billing preview routes.
- Keyboard-visible controls and labeled inputs.
- Error/validation states are visible in text.

## Manual Tests
- Run `shopify app dev` against a dev store.
- Install/reinstall app.
- Confirm embedded navigation.
- Confirm missing scopes state by removing a configured scope in a dev app.
- Confirm Shopify CLI config validation with an authenticated terminal.

## Exit Criteria
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm run test` passes.
- `npm run build` passes.
- Shopify CLI validation/build either pass locally or are documented as blocked by login in CI.
- E2E/accessibility run locally when Playwright browsers are installed.
