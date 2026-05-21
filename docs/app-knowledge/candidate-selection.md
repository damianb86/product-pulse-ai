# Candidate Selection

Candidates are stored products that ProductPulse believes are worth review after QuickScan.

Implementation reference: `buildQuickScanCandidates` and `scoreProductAggregate` in `app/lib/product-pulse-quick-scan.server.js`.

Candidate score:

`quickScanCandidateScore = max(riskScore, productMomentum.score)`

Inclusion rules:

- Risk-qualified candidate: `riskScore >= settings.risk.minimumScore`.
- Momentum-qualified candidate: `productMomentum.score >= settings.momentum.minimumScore`.
- The stored inclusion reason is `risk_threshold` or `momentum_threshold`.

Default thresholds:

- Minimum risk score: 18.
- Momentum threshold: 70.

Candidate views:

- Products page has full-analysis products and QuickScan candidates.
- A candidate with no completed full diagnosis should be treated as a QuickScan result, not a full diagnosis.
- Manual candidate creation can add a Shopify product to ProductPulse tracking without running full diagnosis.

Important interpretation:

- A candidate is not always a bad product.
- Some candidates are included because they have strong commercial momentum and should be watched even if risk is low.
- A candidate needs deeper diagnosis before the app can make strong causal claims.
