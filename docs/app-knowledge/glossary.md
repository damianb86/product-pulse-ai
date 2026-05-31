# Glossary

Catalog Scan:

- Deterministic catalog scan that creates product candidates without calling the AI model.

Product Diagnosis:

- Queued diagnosis job that uses deterministic metrics and AI synthesis to create diagnosis, evidence, and recommendations.

Candidate:

- Stored ProductPulse product snapshot that qualifies by risk or Sales Momentum and may need review or diagnosis.

Risk score:

- Deterministic 0-100 heuristic score for product risk.

Confidence:

- 0-99 score for how much ProductPulse trusts the available evidence and sample quality.

Impact:

- Estimated money at risk. It is not a 0-100 score.

Priority:

- 0-100 blend of risk, confidence, and log-normalized impact.

Sales Momentum:

- 0-100 commercial activity signal based on velocity, growth, catalog share, trend consistency, and recency.

Evidence support:

- 0-100 score for support strength behind a finding, not the risk itself.

Watchlist:

- ProductPulse monitored product list capped by the current plan, with beta-expanded Free and Starter limits.

ProductAction:

- ProductPulse app-owned recommendation/action record visible in the app.

App-owned mutation:

- Backend-confirmed change to ProductPulse app data only.

Shopify mutation:

- Direct change to Shopify Admin resources. This is forbidden in the AI assistant flow.
