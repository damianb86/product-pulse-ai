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
- The app requests product, order, historical order, customer, return and inventory scopes needed by the current Product Diagnosis workflow.
- Order/return data purpose is documented as product quality intelligence.
- `read_orders` and `read_all_orders` are used only for product-level order/refund aggregates. `read_all_orders` requires Shopify protected-scope approval before production use.
- `read_customers` is used only to derive safe same-customer keys from Shopify customer IDs for aggregate before/after product relationships.
- Production config excludes mock-dataset write scopes (`write_orders`, `write_returns`, `write_customers`, `write_inventory`). Development mode adds them at runtime only for controlled QA data generation.
- Product writes use merchant-confirmed `write_products` actions only.

## Billing
- Real paid plans are not enabled in MVP.
- Diagnosis credit UI does not expose prices, payment methods or purchasable diagnosis credit packs until Shopify Billing or Shopify App Pricing is wired.

## Webhooks
- `app/uninstalled` registered.
- `app/scopes_update` registered.
- Mandatory privacy compliance webhooks registered: `customers/data_request`, `customers/redact`, `shop/redact`.
- Webhook handlers use Shopify SDK webhook authentication, which validates HMAC before processing payloads.
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
- Start from Dashboard, open Connect sources, run Catalog Scan, open Products, run/open Product diagnosis and review Analyses.
- No real AI provider or billing credentials are required for MVP review.

## Limitations
- Third-party connectors are placeholders.
- Real product writes are draft-only until production write confirmation is implemented.
- AI output is mocked/validated in tests; production provider setup is future work.
