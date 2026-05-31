# AI Internal Actions Discovery

## Existing Internal Actions

ProductPulse already has several app-owned workflows that mutate ProductPulse database records or queue ProductPulse jobs without directly editing Shopify resources.

### Product Diagnosis Jobs

Existing UI routes:

- `app/routes/app._index.jsx`
- `app/routes/app.products.jsx`
- `app/routes/app.products_.$productId.jsx`
- `app/routes/app.watchlist.jsx`

Existing services:

- `queueProductDiagnosisForShop(shop, productId)`
- `rerunProductDiagnosisForShop(shop, productId)`
- `runSelectedProductDiagnosesForShop(shop, productIds, options)`

Affected tables:

- `CatalogSignalJob`
- `ProductPulseJobLog`
- Later worker output can affect `ProductDiagnosis`, `ProductRiskSnapshot`, `ProductScoreHistory`, `ProductAction`, and `ProductWatchActivity`.

AI suitability:

- Safe to expose as a confirmed internal action for stored ProductPulse products.
- Requires confirmation because it creates jobs and may consume diagnosis capacity/diagnosis credits.
- Does not directly mutate Shopify products.
- Reversible: no, but repeated requests are mostly idempotent because the existing service reuses active jobs for the same product.

### Watchlist Add/Remove/Scan

Existing UI routes:

- `app/routes/app.products.jsx`
- `app/routes/app.products_.$productId.jsx`
- `app/routes/app.watchlist.jsx`

Existing services:

- `addWatchedProductForShop(shop, product)`
- `removeWatchedProductForShop(shop, productGid)`
- `getActiveWatchedProductsForShop(shop)`
- `recordWatchActivityForShop(shop, activity)`
- `runSelectedProductDiagnosesForShop(shop, productIds, options)`

Affected tables:

- `ProductWatchlistItem`
- `ProductWatchActivity`
- `CatalogSignalJob` and `ProductPulseJobLog` when watchlist diagnoses are queued.

AI suitability:

- Adding a stored ProductPulse product to the app watchlist is safe with confirmation.
- Removing a product from the app watchlist is safe with stronger confirmation because it deletes a watchlist row.
- Running the watchlist process is safe with confirmation because it queues internal diagnosis jobs for active watched products.
- These actions must not alter Shopify products.
- Duplicate add is handled by the existing watchlist service.

### Recommended Product Action Statuses

Existing UI routes:

- `app/routes/app.products.jsx`
- `app/routes/app.products_.$productId.jsx`

Existing service:

- `recordProductDetailActionForShop(shop, productId, actionId, payloadOverride, admin)`

Affected tables:

- `ProductAction`

AI suitability:

- Safe statuses for AI-confirmed internal action are `dismissed`, `reviewed`, and `active` restore.
- `applyMode: "apply"` is not safe for this phase because it can call Shopify mutation logic through the existing service.
- Marking actions as `applied` is not exposed because it could imply a Shopify change happened.
- Requires confirmation because it changes recommendation state.
- Reversible: `active` can restore dismissed/reviewed-style recommendations where the existing service supports restoration.

### App-Only Analysis Deletion

Existing UI route:

- `app/routes/app.products.jsx` with `_action=delete-product-analysis`

Existing service:

- `deleteProductAnalysisForShop(shop, productId)`

Affected tables:

- `ProductAction`
- `ProductDiagnosis`
- `ProductScoreHistory`
- `ProductWatchActivity`
- `ProductWatchlistItem`
- `ProductRiskSnapshot`
- `ProductPulseJobLog`
- `CatalogSignalJob`

AI suitability:

- This is app-only and does not delete or archive a Shopify product.
- It is potentially destructive and not reversible.
- It may be exposed only with high-risk confirmation and wording that clearly says “remove ProductPulse analysis/tracking,” not “delete product.”
- The action should be named `archive_internal_product_analysis` or similar to avoid Shopify deletion confusion.

## Actions Safe To Expose Now

- `product_pulse_run_product_diagnosis`: queue an app-owned ProductPulse diagnosis job for a stored product.
- `product_pulse_add_to_watchlist`: add a stored ProductPulse product to `ProductWatchlistItem`.
- `product_pulse_remove_from_watchlist`: remove a stored ProductPulse product from `ProductWatchlistItem`.
- `product_pulse_run_watchlist_diagnoses`: queue app-owned diagnosis jobs for active watched products.
- `product_pulse_mark_recommended_action`: mark a stored recommendation/action as `dismissed`, `reviewed`, or `active`.
- `product_pulse_archive_internal_product_analysis`: delete app-owned ProductPulse analysis/tracking records for a stored product, with high-risk confirmation.

## Actions That Require Confirmation

All mutating internal actions require confirmation. The assistant can create proposals, but execution must happen only after the user confirms a server-stored proposal.

Confirmation levels:

- `low`: add to watchlist, run Product Diagnosis, run watchlist diagnoses.
- `medium`: remove from watchlist, mark recommendation status.
- `high`: archive/remove internal ProductPulse analysis.

## Actions Unavailable In This Phase

- Any Shopify product edit.
- Price, inventory, product status, description, SEO, tags, metafields, variant, or image updates.
- Any Shopify product delete/archive operation.
- Applying generated recommended copy to Shopify.
- Directly marking a recommendation as “applied” when no app-only execution happened.
- Watchlist settings changes, alert recipient changes, or pause/resume all watches from AI.
- Mock dataset generation.
- Help/contact data deletion or global data reset.

## Delete/Product Wording

“Delete product” is not an AI action. ProductPulse can only remove internal ProductPulse analysis/tracking records through `archive_internal_product_analysis`. This deletes app records and may remove the product from the ProductPulse watchlist, but it never deletes the Shopify product.

## Side Effects And Reversibility

- `run_product_diagnosis`: creates/reuses a job; not reversible, but active-job reuse makes it mostly idempotent.
- `add_to_watchlist`: creates a watchlist row and activity; reversible by `remove_from_watchlist`.
- `remove_from_watchlist`: deletes a watchlist row and records activity; reversible by adding again if product data is still available.
- `run_watchlist_diagnoses`: creates diagnosis jobs; not reversible.
- `mark_recommended_action`: creates/updates `ProductAction` status; partially reversible by restoring `active`.
- `archive_internal_product_analysis`: deletes app-owned analysis/tracking records; not reversible.

## Security Notes

- All actions must use server-derived `AiToolContext.shop`.
- Action inputs must never accept `shop`, `storeId`, `merchantId`, or user tenancy identifiers.
- Product/entity ownership must be re-checked server-side before proposal creation and again before execution.
- ChatKit confirm/cancel payloads should contain only `proposalId`.
- The backend must reload the proposal and execute stored validated input, not client-supplied action input.
- Confirm/cancel responses should be deterministic backend responses with `action_result` cards, not extra model calls.
