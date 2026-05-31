# ProductPulse Overview

ProductPulse is a Shopify embedded app for ecommerce teams that need product-level guidance from fragmented product quality and commerce signals.

The app reads Shopify product, order, refund, return, return reason, review, CSV review, and configured ProductPulse sources. It turns those signals into stored product risk snapshots, deep diagnoses, evidence summaries, watchlist activity, and app-owned recommended actions.

Main workflows:

- Run Catalog Scan to identify product candidates.
- Review Dashboard priorities and top issues.
- Review Products and Candidates tables.
- Queue Product Diagnosis for stored products.
- Inspect product detail for evidence, metrics, recommendations, action history, and score history.
- Track important products in Watchlist.
- Use Analytics to understand aggregate risk, impact, sources, and trends.
- Tune thresholds, evidence windows, and generated HTML style in Settings.

Main app-owned entities:

- `ProductPulseSource`: source availability and coverage metadata.
- `CatalogSignalJob`: scan, diagnosis, and mock dataset job state.
- `ProductRiskSnapshot`: stored product-level risk or candidate snapshot.
- `ProductDiagnosis`: Product Diagnosis output with issues, evidence, and recommendations.
- `ProductAction`: app-owned recommendation/action record visible in the product UI.
- `ProductWatchlistItem`, `ProductWatchSettings`, `ProductWatchActivity`: watchlist state.
- `ProductScoreHistory`: stored score trend points.
- `CreditLedgerEntry`: internal diagnosis credit state.

Important limits:

- ProductPulse AI tools must not access raw database rows directly.
- AI app mutations save ProductPulse app-owned records only.
- The AI assistant must not modify Shopify products, prices, inventory, descriptions, SEO, tags, variants, images, collections, or metafields.
