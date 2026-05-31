# Fixtures

## Shops
- `installedShop`: installed with required scopes and starter diagnosis credits.
- `newShop`: installed with product data only and no optional sources.
- `missingScopeShop`: lacks `read_returns`.
- `expiredSessionShop`: simulated auth issue.

## Products
- `coreLinenTrouser`: high fit-risk product with return and review signals.
- `trailRunVest`: high defect-risk product with refunds and support notes.
- `ceramicPourOver`: medium risk with pre-purchase confusion.
- `minimalCanvasTote`: low risk product with strong review health.

## Sources
- Shopify products/variants.
- Shopify orders/refunds.
- Shopify returns/return reasons.
- Judge.me reviews.
- ChatMe reviews.
- CSV reviews.
- Gorgias, Zendesk, Return Prime, Loop Returns, Yotpo, Loox and Q&A are future/disconnected fixtures.

## API Scenarios
- GraphQL success.
- GraphQL top-level errors.
- GraphQL `userErrors`.
- API rate limit.
- Missing required scope.
- Expired session.

## Billing/Diagnosis Credits
- Billing accepted.
- Billing declined/pending.
- Diagnosis Credits available.
- Diagnosis Credits exhausted.
- Diagnosis consumed one diagnosis credit.

## AI
- Valid diagnosis JSON.
- Invalid diagnosis JSON.
- Empty AI response.
- Low-confidence AI response.

## Webhooks
- Valid uninstall webhook.
- Invalid webhook signature placeholder.
- Scope update webhook.
