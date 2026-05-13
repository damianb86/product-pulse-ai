# App Store Review Checklist

## Installation
- App installs through Shopify OAuth.
- App opens embedded in Shopify Admin.
- Reinstall does not expose old shop data incorrectly.

## Authentication
- Uses Shopify template OAuth/session tokens.
- No access token reaches the browser.
- Session expiry reauth is handled by template flow.

## Navigation
- Embedded navigation uses App Bridge-compatible app navigation.
- Each route has a clear heading and primary action.

## Scopes
- MVP requests only `read_products`, `read_orders`, `read_returns`.
- Order/return data purpose is documented as product quality intelligence.
- `read_orders` is used only for product-level order/refund aggregates and may require protected customer data approval for Order object access.
- No customer scopes are requested.
- Product writes require a future explicit `write_products` review.

## Billing
- Real paid plans are not enabled in MVP.
- Credit UI is internal/demo until Shopify billing is wired.

## Webhooks
- `app/uninstalled` registered.
- `app/scopes_update` registered.
- Future source refresh webhooks documented.

## Error Handling
- Missing scopes show permission guidance.
- 401/403/404/500 and GraphQL errors show recoverable states.
- Empty stores show onboarding states.

## UI
- Uses Polaris web components.
- No raw secret or debug JSON is visible to merchants.
- Narrow viewport remains usable.

## Accessibility
- Axe scan on preview routes.
- Inputs have labels.
- Main navigation and buttons are keyboard reachable.

## Reviewer Instructions
- Use a dev store with products, orders, returns/refunds and fixture CSV reviews.
- Start from Dashboard, open Connect sources, run Catalog Signal Scan, open Products, run/open Product diagnosis and review Analyses.
- No real AI provider or billing credentials are required for MVP review.

## Limitations
- Third-party connectors are placeholders.
- Real product writes are draft-only until production write confirmation is implemented.
- AI output is mocked/validated in tests; production provider setup is future work.
