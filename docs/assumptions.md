# Assumptions

- The app is intended as a public Shopify embedded app, developed first against a dev store.
- Shopify CLI created the current React Router template and manages OAuth/session token handling.
- MVP can use realistic fixtures and local persisted records while live connectors are developed.
- Product writes are intentionally stored as draft actions in MVP because production write flows require careful review, merchant confirmation and optional `write_products`.
- Order data access is limited to the business need of product-level return/refund quality intelligence.
- ProductPulse requests `read_all_orders` so Catalog Scan and Product Diagnosis can analyze historical order windows configured by the merchant. This requires Shopify protected-scope approval before production use.
- ProductPulse requests order, return, customer and inventory write scopes only in development mode for the controlled Shopify mock dataset generator exposed from Settings.
- CSV reviews are handled as imported review signal rows in future implementation; this MVP includes fixtures and validation shape.
- The AI provider is not configured yet. All AI output contracts are documented and tested with mocks/placeholders.
- Billing is modeled as diagnosis credits in app data but real Shopify billing is not activated in MVP.
- Screens are in English to match Shopify Admin conventions and the rest of the generated apps.

## Open Questions
- Which review connector should be implemented first after CSV: Judge.me or ChatMe?
- Should ProductPulse write tags/metafields automatically or always require a draft-review confirmation step?
- Which paid plan names, prices and monthly diagnosis credits should production use?
- Should diagnosis credits be reserved when a job starts or consumed only after successful completion?
- What is the accepted historical window for analysis: 30, 60, 90 or 180 days?

## Decisions To Move Forward
- Use deterministic score helpers for all numeric metrics.
- Use mocked diagnosis data and server action state for the MVP UI.
- Keep App Store-sensitive scopes minimal and document future optional scopes.
- Use PostgreSQL locally and in Docker so the app can move toward production without switching the Prisma provider.
