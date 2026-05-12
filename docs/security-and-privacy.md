# Security And Privacy

## Secrets
- Do not commit `.env`, API secrets, access tokens or merchant credentials.
- `.env.example` contains placeholders only.
- CI uses placeholders unless repository secrets are configured.

## Server-Side Boundaries
- Shopify Admin API calls stay server-side.
- Client receives only aggregated, product-level view models.
- Actions validate form input server-side before creating jobs, diagnoses or draft actions.

## Data Minimization
- Store only the product-level signal data needed for diagnosis and traceability.
- Avoid customer names, emails, addresses or raw support ticket PII.
- CSV imports must be scrubbed or mapped to product-level review signals.

## Logs
- No access tokens, request HMACs, customer PII or raw AI prompts with sensitive data in logs.
- Future audit logs should use shop, action type, product GID and non-sensitive status.

## AI Safety
- AI input should contain bounded evidence snippets and redacted personal data.
- Prompts are versioned in code/docs before production.
- AI output must be JSON/schema validated.
- Invalid AI output must not be automatically applied to Shopify.
- Generated recommendations remain draft actions until merchant confirmation.

## Permissions
- MVP scopes are read-only for Shopify resources.
- `write_products` is intentionally future-gated.
- Missing required scopes create a permission state instead of silent partial analysis.

## Development Posture
- Local PostgreSQL may use simple development credentials.
- Production migration requires managed Postgres, rotated credentials, HTTPS app URL, Shopify billing configuration and operational monitoring.
