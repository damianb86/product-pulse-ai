# Analytics Guide

Implementation references:

- `app/routes/app.analytics.jsx`
- `getAnalyticsDataForShop`
- `buildAnalyticsViewData`

Purpose:

Analytics explains aggregate ProductPulse state across stored products.

Inputs:

- Product risk snapshots.
- Source coverage.
- Product actions.
- Settings.
- Latest completed diagnoses.
- Active jobs.
- Product score history.

What it can show:

- Risk distribution.
- Average risk and confidence.
- Top issues.
- Source coverage.
- Action/recommendation counts.
- Risk and impact trends.
- Product-level history from stored score points.

How to interpret:

- Treat Analytics as a portfolio-level summary.
- Use Product Detail for root-cause evidence.
- Use source coverage before trusting missing-signal conclusions.

Limitations:

- Some Analytics values are view-model aggregations rather than one exported scoring formula.
- Sparse catalog history can make trends less meaningful.
