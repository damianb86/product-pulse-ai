# Product Diagnosis

Product Diagnosis is a queued ProductPulse job for one or more stored products.

Implementation references:

- `app/lib/product-pulse-jobs.server.js`
- `app/lib/product-pulse-diagnosis.server.js`

Purpose:

- Explain why a product appears risky.
- Classify likely causes.
- Summarize bounded evidence.
- Generate ProductPulse recommendations/actions.
- Update stored snapshots and score history.

How it runs:

1. The user queues diagnosis from Dashboard, Products, Product Detail, Watchlist, or a confirmed internal app action.
2. ProductPulse creates a `CatalogSignalJob` diagnosis job.
3. The diagnosis worker reads the stored product snapshot and source evidence.
4. Deterministic metrics and source snippets are prepared.
5. AI is used for classification, likely-cause explanation, evidence synthesis, and recommendation generation.
6. The app persists `ProductDiagnosis`, updates `ProductRiskSnapshot`, records `ProductScoreHistory`, and may record watchlist activity.

No-change reanalysis:

- When a product already has a completed Product Diagnosis, reanalysis first compares product content, Shopify order/return/refund source events, review/customer text, refund text, and the stored source fingerprint.
- Reanalysis also checks merchant-facing ProductPulse action history since the previous diagnosis.
- If no concrete source changes are found, ProductPulse reuses the previous Product Diagnosis instead of running the Product Diagnosis flow again.
- This no-change path consumes 0 diagnosis credits and records the job as skipped/reused.
- Date-window metrics that can move only because time passed, such as sales momentum, recent activity windows, forecast/window summaries, retention preview, return/refund window summaries, purchase context, and relationship summaries, are refreshed deterministically.
- The previous Product Diagnosis, evidence synthesis, chart interpretation text, content-gap interpretation, primary issue, and recommendations remain in place until there is new evidence or product content that can affect them.
- If the only movement is a rolling date-window change with no newly fetched orders, returns, refunds, reviews, or product-content changes, the reanalysis is still treated as a zero diagnosis credit no-AI refresh.
- If a merchant-facing action was applied, reviewed, dismissed, or ignored after the previous diagnosis, ProductPulse treats that as transition context and reruns the diagnosis instead of presenting the old report unchanged.
- Successive AI reports receive a compact evolution context: previous diagnosis summary, handled actions, current source/content changes, material metric movement, and issue transitions.
- In action-only reanalysis, repeated handled recommendations are suppressed unless new/current evidence shows the problem persisted or changed.

Requirements and limits:

- Diagnosis requires an existing ProductPulse product snapshot.
- Bulk diagnosis submissions are not capped by ProductPulse settings.
- Diagnosis may consume app diagnosis credits depending on the configured workflow.

Limitations:

- Product Diagnosis is not a Shopify mutation.
- Recommendations are ProductPulse app-owned guidance until a separate non-AI workflow applies anything to Shopify.
- If source data is weak, stale, or sparse, confidence should be lower.
