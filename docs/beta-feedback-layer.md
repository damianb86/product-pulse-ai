# Beta Feedback Layer

ProductPulse beta feedback is intentionally isolated so it can be disabled or removed after the beta period.

## Where It Lives

- Client UI: `app/components/beta-feedback/BetaFeedbackLayer.jsx`
- Styles: `app/styles/product-pulse-beta-feedback.css`
- API route: `app/routes/api.beta-feedback.jsx`
- Server service: `app/lib/beta-feedback.server.js`
- Feature config: `app/lib/beta-feedback-config.server.js`
- Persistence: `BetaFeedbackReport` and `BetaFeedbackPanelPreference` in `prisma/schema.prisma`

## Enable Or Disable

Set:

```env
BETA_FEEDBACK_ENABLED=true
BETA_FEEDBACK_RECIPIENT=internal@example.com
```

When `BETA_FEEDBACK_ENABLED` is not true, the provider renders only its children. There is no floating launcher, no contextual panel controls, no hide prompts, and `/api/beta-feedback` rejects writes.

`BETA_FEEDBACK_RECIPIENT` controls notification email delivery. If it is missing, the layer falls back to `CONTACT_EMAIL`. In development with no SMTP configured, the existing email utility logs the payload instead of sending.

## What Is Stored

`BetaFeedbackReport` stores feedback category, severity, message, page, panel/source identifiers, optional related entity metadata, safe context, status, and timestamps.

`BetaFeedbackPanelPreference` stores per-shop/user/page/panel hidden state and the first hide reason. Panel preferences are scoped by `shop`, `userKey`, `pageKey`, and `panelId`.

## Context Safety

The server sanitizes feedback context before writing it:

- redacts sensitive keys such as tokens, cookies, credentials, session data, API keys, payment and card fields
- limits string length, array size, object breadth, nesting depth, and total JSON size
- stores structured summaries rather than raw DOM or cookies

## Removing Later

To remove the layer:

1. Remove `<BetaFeedbackProvider>` from `app/routes/app.jsx`.
2. Remove `BetaFeedbackPanelControls` / `BetaFeedbackPanelFrame` imports and usages.
3. Remove `app/components/beta-feedback`, `app/styles/product-pulse-beta-feedback.css`, `app/routes/api.beta-feedback.jsx`, and `app/lib/beta-feedback*.server.js`.
4. Drop the two beta feedback Prisma models and create a migration.
