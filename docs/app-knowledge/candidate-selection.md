# Candidate Selection

Candidates are stored products that ProductPulse believes are worth review after Catalog Scan.

Implementation reference: `buildQuickScanCandidates` and `scoreProductAggregate` in `app/lib/product-pulse-quick-scan.server.js`.

Candidate score:

`quickScanCandidateScore = max(riskScore, productMomentum.score)`

Inclusion rules:

- Risk-qualified candidate: `riskScore >= settings.risk.minimumScore`.
- Sales Momentum-qualified candidate: `productMomentum.score >= settings.momentum.minimumScore`.
- The stored inclusion reason is `risk_threshold` or `momentum_threshold`.

Default thresholds:

- Minimum risk score: 18.
- Sales Momentum threshold: 70.

Candidate views:

- Products page has diagnosed products and Catalog Scan candidates.
- A candidate with no completed Product Diagnosis should be treated as a Catalog Scan result, not a Product Diagnosis.
- Manual candidate creation can add a Shopify product to ProductPulse tracking without running Product Diagnosis.

Important interpretation:

- A candidate is not always a bad product.
- Some candidates are included because they have strong Sales Momentum and should be watched even if risk is low.
- A candidate needs deeper diagnosis before the app can make strong causal claims.
