# App-Owned Actions And Mutations

ProductPulse AI app mutations affect ProductPulse app data only.

Implementation references:

- `app/ai/actions`
- `app/ai/appMutations`
- `app/lib/product-pulse-jobs.server.js`

Supported concept:

- The assistant may propose an action.
- The user confirms.
- The backend validates context, ownership, status, and input.
- The backend saves or updates ProductPulse app-owned records.
- Shopify is not modified.

Examples of app-owned changes:

- Queue a ProductPulse diagnosis job.
- Add a product to ProductPulse watchlist.
- Remove or pause a ProductPulse watchlist item.
- Create or update a ProductPulse product action/recommendation.
- Save generated ProductPulse action text for later review inside the app.

Confirmation rules:

- ChatKit action payloads are untrusted.
- The payload should identify a server-side proposal or target, not carry authority.
- The backend re-fetches and validates the proposal or target before executing.

Forbidden from AI assistant flow:

- Shopify product description updates.
- Shopify SEO updates.
- Shopify metafield updates.
- Price changes.
- Inventory changes.
- Product status changes.
- Tag, variant, image, or collection changes.
- Arbitrary Shopify GraphQL mutations.

Terminology note:

- Some internal fields still use the word `draft` for ProductPulse action status or editable generated text. In the current AI flow, confirmed saves create ProductPulse records visible to the app, not chat-only records.
