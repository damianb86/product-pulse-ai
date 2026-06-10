# Shopify Integration

## CLI And Template
- Generated with Shopify CLI using the modern React Router template.
- Embedded authentication, OAuth and session handling are provided by `@shopify/shopify-app-react-router`.
- Shopify CLI commands stay in `package.json` for validation, build, app dev and deploy preparation.

## Scopes
- Production configured scopes: `read_products`, `write_products`, `read_orders`, `read_all_orders`, `read_customers`, `read_returns`, `read_inventory`, `read_locations`.
- `read_products` is needed for product titles, handles, variants, tags and collections.
- `read_orders` is needed for order/refund signals.
- `read_all_orders` is needed to read historical orders beyond Shopify's standard recent-order window. Shopify requires protected access approval in the Partner Dashboard before this scope can be used in production.
- `read_returns` is needed for return reasons and return-quality signals.
- `write_products` is needed for merchant-confirmed product description, tag and catalog updates.
- `read_customers` is needed to read Shopify customer IDs as safe same-customer keys for before/after product relationship analytics.
- Development mode adds `write_orders`, `write_returns`, `write_customers` and `write_inventory` for the Settings mock dataset generator, which creates controlled test customers, orders, refunds, returns and inventory-backed products in Shopify for repeatable Product Diagnosis QA.
- Local `SCOPES` can add extra scopes, but required scopes are merged from `app/lib/product-pulse-scopes.js` at app boot so stale env values do not remove required permissions from OAuth requests.
- Shopify can report only the write scope in a granted session even when that write scope includes equivalent read access. ProductPulse treats `write_products`, `write_orders`, `write_customers` and `write_returns` as satisfying `read_products`, `read_orders`, `read_customers` and `read_returns` for development mock dataset validation.
- The Settings mock dataset generator is staged and resumable: products, customers, orders, returns/refunds, CSV reviews and the manifest can be run separately. ProductPulse reuses existing GEN products, RELTEST customers and generated orders instead of creating duplicates.

## Admin GraphQL Patterns
- Run Admin GraphQL only from server loaders/actions.
- Normalize top-level `errors` and `userErrors`.
- Keep GIDs as strings.
- Use cursor pagination for products and orders.
- Avoid customer PII; aggregate product-level signals.

## Product Diagnosis Order Extraction
- Product Diagnosis reads product sales through Shopify Admin GraphQL `orders` with a `processed_at` lower bound and a product-variant SKU filter, then cursor-paginates each SKU until Shopify returns no next page.
- `PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDER_MAX_PAGES=0` is the default and means uncapped product-order pagination. This is the intended production default for high-volume stores.
- If an operational cap is required, set `PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDER_MAX_PAGES` to a positive integer. The maximum product-order search envelope is:
  `MAX_PAGES * PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE * min(unique_variant_skus, PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDER_MAX_SKUS)`.
- Product Diagnosis marks order extraction incomplete when the targeted SKU scan reaches that cap, Shopify pagination stalls, or an order has more line items than the configured line-item page and the product line cannot be confirmed in the returned slice. Incomplete extraction lowers confidence and is surfaced in the Monthly order activity panel instead of silently presenting a partial count as complete.
- Products without variant SKUs fall back to the limited global order scan. That fallback preserves best-effort signals, but it is marked incomplete if the global scan hits its cap.
- Every order fetched by a targeted SKU scan is expanded into compact line-level sales cache rows for all returned line items, not only the product being diagnosed. Those rows are appended to the shared per-shop cache with `skipDuplicates`, so a multi-product order can be associated with several products without duplicating the same line event.
- Product Diagnosis can read those partial product-specific sales rows even when the full shop-level cache is not complete. It still runs the targeted SKU scan unless the full shop cache is usable, because a partial basket hit does not prove that all orders for the next product are already cached.
- The shared shop source-event cache is persisted only when shop-level sales, refunds and returns are complete. Product-scoped sales can still be complete through targeted SKU pagination even when the shop-level relationship scan is intentionally limited.

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
- Product Diagnosis should run after deterministic evidence collection, not while paging unbounded source data.

## Multi-Shop Isolation
- Every app-owned table includes `shop`.
- No global product IDs are trusted without shop context.
- Logs and test fixtures must not include real merchant data.

## Validation Status
- Shopify access-scope docs were used to verify that Product/Variant/Collection data requires `read_products`, Order data requires `read_orders`, historical order access requires `read_all_orders`, Customer data requires `read_customers`, Customer creation requires `write_customers`, Order creation requires `write_orders`, and Return creation requires `write_returns`.
- Live Shopify CLI validation may require an interactive Shopify login in local or configured CI credentials.
