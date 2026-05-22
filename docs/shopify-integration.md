# Shopify Integration

## CLI And Template
- Generated with Shopify CLI using the modern React Router template.
- Embedded authentication, OAuth and session handling are provided by `@shopify/shopify-app-react-router`.
- Shopify CLI commands stay in `package.json` for validation, build, app dev and deploy preparation.

## Scopes
- Configured scopes: `read_products`, `write_products`, `read_orders`, `read_all_orders`, `write_orders`, `read_customers`, `write_customers`, `read_returns`, `write_returns`, `read_inventory`, `write_inventory`, `read_locations`.
- `read_products` is needed for product titles, handles, variants, tags and collections.
- `read_orders` is needed for order/refund signals.
- `read_all_orders` is needed to read historical orders beyond Shopify's standard recent-order window. Shopify requires protected access approval in the Partner Dashboard before this scope can be used in production.
- `read_returns` is needed for return reasons and return-quality signals.
- `write_products` is needed for merchant-confirmed product description, tag and catalog updates.
- `read_customers` is needed to read Shopify customer IDs as safe same-customer keys for before/after product relationship analytics.
- `write_orders`, `write_returns` and `write_customers` are needed for the Settings mock dataset generator, which creates controlled test customers, orders, refunds and returns in Shopify for repeatable diagnostics QA.
- Local `SCOPES` can add extra scopes, but required scopes are merged from `app/lib/product-pulse-scopes.js` at app boot so stale env values do not remove required permissions from OAuth requests.
- Shopify can report only the write scope in a granted session even when that write scope includes equivalent read access. ProductPulse treats `write_products`, `write_orders`, `write_customers` and `write_returns` as satisfying `read_products`, `read_orders`, `read_customers` and `read_returns` for mock dataset validation.
- The Settings mock dataset generator is staged and resumable: products, customers, orders, returns/refunds, CSV reviews and the manifest can be run separately. ProductPulse reuses existing GEN products, RELTEST customers and generated orders instead of creating duplicates.

## Admin GraphQL Patterns
- Run Admin GraphQL only from server loaders/actions.
- Normalize top-level `errors` and `userErrors`.
- Keep GIDs as strings.
- Use cursor pagination for products and orders.
- Avoid customer PII; aggregate product-level signals.

## Planned Read Queries
- Products and variants: title, handle, status, tags, collections, variant count.
- Orders/refunds: product line item context, refund amount, refund date and aggregate counts.
- Returns/reasons: return reason definition and product-line context when available.

## Planned Write Mutations
Writes are disabled in MVP. Future gated writes:
- Add product tag such as `productpulse:fit-risk`.
- Update app-owned product metafields for fit notes, QA notes or support snippets.
- Update product description only after explicit merchant confirmation.

## Webhooks
- `app/uninstalled`: clean or mark shop data inactive.
- `app/scopes_update`: detect missing scopes and show permission state.
- Future: product/order/return update webhooks for incremental refresh.

## OAuth And Staff Permissions
- Authentication must be handled by the Shopify template.
- Staff users without needed resource permissions should see permission guidance.
- Session expiry should trigger reauth rather than a raw error page.

## Rate Limits
- Batch scans should paginate and checkpoint.
- Future production jobs should back off on throttling and resume from cursors.
- AI diagnosis should run after deterministic evidence collection, not while paging unbounded source data.

## Multi-Shop Isolation
- Every app-owned table includes `shop`.
- No global product IDs are trusted without shop context.
- Logs and test fixtures must not include real merchant data.

## Validation Status
- Shopify access-scope docs were used to verify that Product/Variant/Collection data requires `read_products`, Order data requires `read_orders`, historical order access requires `read_all_orders`, Customer data requires `read_customers`, Customer creation requires `write_customers`, Order creation requires `write_orders`, and Return creation requires `write_returns`.
- Live Shopify CLI validation may require an interactive Shopify login in local or configured CI credentials.
