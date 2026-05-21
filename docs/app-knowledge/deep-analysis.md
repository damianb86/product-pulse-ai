# Deep Product Diagnosis

Deep Product Diagnosis is a queued ProductPulse job for one or more stored products.

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

Requirements and limits:

- Diagnosis requires an existing ProductPulse product snapshot.
- Bulk queue size is capped by `diagnosis.maxQueuedPerSubmission`; default 25, maximum 500.
- Diagnosis may consume app diagnosis credits depending on the configured workflow.

Limitations:

- Deep diagnosis is not a Shopify mutation.
- Recommendations are ProductPulse app-owned guidance until a separate non-AI workflow applies anything to Shopify.
- If source data is weak, stale, or sparse, confidence should be lower.
