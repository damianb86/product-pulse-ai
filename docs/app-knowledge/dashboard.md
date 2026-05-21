# Dashboard Guide

Implementation references:

- `app/routes/app._index.jsx`
- `getDashboardDataForShop`
- `buildDashboardViewData`

Purpose:

The Dashboard is the operational home. It answers "where should I start?"

What it shows:

- Priority products.
- High-risk or high-momentum products.
- Current KPIs.
- Active scan and diagnosis jobs.
- Credit balance.
- Top issues.
- Latest diagnoses and recommended actions.

How to read it:

1. Start with active jobs to understand whether ProductPulse is still scanning or diagnosing.
2. Review top priority products, balancing risk, confidence, impact, and momentum.
3. Use issue summaries to see repeated patterns across the catalog.
4. Open product detail before acting on a recommendation.

Available actions:

- Run a scan.
- Queue a product diagnosis for stored products.
- Open product detail.

Limitations:

- Dashboard data is a derived ProductPulse view, not raw source data.
- A product without a stored snapshot may need QuickScan before diagnosis.
