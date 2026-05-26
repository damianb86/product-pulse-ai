# AI App Knowledge Discovery

## App Overview

ProductPulse AI is a Shopify embedded app for ecommerce operators, catalog managers, CX leads, and founders who need product-level guidance from fragmented product quality signals. The app combines Shopify product, order, refund, return, return reason, review, CSV review, and future support/PDP Q&A sources to identify products that create avoidable friction and convert those signals into ProductPulse actions.

Primary workflows found in the codebase:

- Connect or review source coverage.
- Run Catalog Signal Scan / QuickScan from Dashboard or Products.
- Review Dashboard ranking and “start here” recommendations.
- Review Products and Candidates tables.
- Queue deep AI Product Diagnosis for stored products.
- Open Product detail to inspect diagnosis, evidence, metrics, recommendations, actions, and history.
- Track important products in Watchlist.
- Use Analytics to interpret risk, impact, source coverage, issues, and trends.
- Tune thresholds and analysis limits in Settings.

Main entities:

- `ProductPulseSource`: source availability/coverage.
- `CatalogSignalJob`: scan, mock dataset, and diagnosis job state.
- `ProductRiskSnapshot`: stored product-level risk snapshot.
- `ProductDiagnosis`: deep diagnosis result with issues/evidence/recommendations.
- `ProductAction`: app-owned action/recommendation history.
- `ProductWatchlistItem`, `ProductWatchSettings`, `ProductWatchActivity`: watchlist state, settings, and activity.
- `ProductScoreHistory`: stored risk/momentum/history points.
- `CreditLedgerEntry`: diagnosis credit balance.

## Analysis Modes

### QuickScan / Catalog Signal Scan

Implementation: `app/lib/product-pulse-quick-scan.server.js`, `runShopifyQuickScan`, `buildQuickScanCandidates`, `scoreProductAggregate`.

QuickScan is a deterministic scan that reads Shopify catalog data, orders, refunds, returns, and connected CSV review ratings. It calculates product risk and Product Momentum without calling the AI model. It stores candidates in `ProductRiskSnapshot`.

Key behavior:

- Default analysis window comes from Settings, default 60 days.
- Shopify data extraction uses Bulk Operations when possible, with paginated fallback.
- If Shopify order access is denied, QuickScan falls back to catalog-only extraction and marks order data as unavailable.
- CSV review ratings can be loaded and used for rating/count signals; QuickScan does not read full review text.
- Candidates are sorted by `quickScanCandidateScore = max(riskScore, productMomentum.score)`.
- Only the top 50 persistable candidates are returned from scoring.
- Persisted candidates satisfy `riskScore >= settings.risk.minimumScore` or `productMomentum.score >= settings.momentum.minimumScore`.
- Products with completed full diagnoses are retained and ignored by QuickScan persistence so full diagnosis data is not overwritten.

### Deep AI Product Diagnosis

Implementation: `app/lib/product-pulse-jobs.server.js` (`queueProductDiagnosisForShop`, diagnosis queue worker) and `app/lib/product-pulse-diagnosis.server.js`.

Deep diagnosis is a queued background job for one or more stored products. It uses deterministic ProductPulse metrics and source snippets, then uses AI for classification, likely-cause explanation, evidence synthesis, and recommendation generation. It persists `ProductDiagnosis`, updates `ProductRiskSnapshot`, records score history, and may create watchlist activity. It consumes diagnosis credit according to app workflow.

Limits:

- Bulk diagnosis submissions are not capped by ProductPulse settings.
- Deep diagnosis requires an existing ProductPulse snapshot; dashboard action returns “Run QuickScan before starting a product diagnosis” if none exists.

### Candidates

Candidates are stored `ProductRiskSnapshot` rows from QuickScan that are not full diagnoses. Products table loads two views:

- `analysis: "full"` for products with completed/queued full diagnosis data.
- `analysis: "quickscan"` for QuickScan candidates.

Manual candidate creation exists via `addShopifyProductCandidateForShop`; it can create a snapshot for a Shopify product without running diagnosis.

### Watchlist

Implementation: `app/lib/product-pulse-watchlist.server.js`.

Watchlist is an app-owned list capped at 50 products. It stores product GID/title/handle/SKU/status/image metadata and can be scanned/refreshed. Settings include scan cadence, trigger rule, summary schedule, alert recipients, and alerts enabled. Alert recipient emails are not safe for AI output; expose counts only.

Allowed statuses include `Watching` and `Paused`. Watch activity records product-added/removed/paused/resumed, settings changes, scan updates, diagnosis completions, and change reports.

### Dashboard

Implementation: `app/routes/app._index.jsx`, `getDashboardDataForShop`, `buildDashboardViewData`.

Dashboard authenticates with Shopify, loads snapshots, current credit balance, active scan/diagnosis jobs, settings, product count, actions, latest diagnoses, images, and active jobs. It presents operational next steps, highest-risk products, product cards, jobs, issues, and KPIs.

### Analytics

Implementation: `app/routes/app.analytics.jsx`, `getAnalyticsDataForShop`, `buildAnalyticsViewData`.

Analytics uses snapshots, sources, actions, score history, settings, and latest diagnoses. It is derived view data, not raw source data. It includes risk/impact summaries, issues, trends, source coverage, and action/recommendation counts.

### Recommended Actions And App-Owned Mutations

Implementation: `app/lib/product-pulse-diagnosis.server.js`, `app/lib/product-pulse-jobs.server.js`, `app/ai/appMutations`.

Recommendations are generated/stored as ProductPulse app-owned actions or diagnosis recommendation JSON. Chat-confirmed app mutations write real `ProductAction` rows and update diagnosis recommendations when relevant. The AI assistant must not directly update Shopify.

## Scoring And Calculations

### Coverage Score

Implementation: `app/lib/product-pulse-scoring.js`, `calculateCoverageScore`, `SOURCE_WEIGHTS`.

Weights:

- Shopify products: 18
- Shopify orders: 18
- Shopify returns: 18
- Judge.me reviews: 14
- Chatme reviews: 10
- CSV reviews: 8
- Support tickets: 8
- PDP questions: 6

Formula:

`coverageScore = round((connectedWeight / totalWeight) * 100)`

Interpretation:

- `>= 75`: Strong coverage
- `>= 45`: Partial coverage
- `< 45`: Low coverage

### Risk Score

Implementation: `app/lib/product-pulse-scoring.js`, `calculateProductScoreModel`, `calculateRiskComponents`.

Range: 0 to 100.

The risk score is deterministic. It sums capped component families and bonuses:

`riskScore = round(clamp(base + returns + reviews + sentiment + contentGap + refund + variant + agreementBonus + recencyBonus, 0, 100))`

Component caps:

- Base: 5 to 8 when evidence exists, otherwise 0.
- Returns score: max 25.
- Reviews score: max 25.
- Sentiment score: max 6 when it shares review source; max 15 when treated separately.
- Content gap score: max 15.
- Refund score: max 20.
- Variant concentration score: max 10.
- Agreement bonus: max 8.
- Recency bonus: max 5.

Risk labels:

- Default scoring helper: `>= 75` High risk, `>= 55` Watch, `>= 35` Emerging, otherwise Healthy.
- Settings UI labels: high/medium/low use configurable thresholds; defaults are high 75, medium 55, minimum QuickScan 18.

Limitations:

- Risk is a heuristic deterministic score, not a probability.
- Some source families may be missing due to Shopify scopes or unavailable integrations.
- Low sample sizes are smoothed/capped to avoid overconfidence.

### Confidence Score

Implementation: `app/lib/product-pulse-scoring.js`, `calculateDiagnosisConfidence`.

Range: 0 to 99 after caps.

Inputs:

- Source count, independent source count, effective sample size, product match confidence, source agreement, recent signals.
- Penalties for missing orders/returns/refunds, low sales sample, stale evidence, weak match, duplicate signals, single source, subjective-only issue, reconstructed score.

Logic:

`confidenceRaw = coverage + independentSources + effectiveSample + productMatch + agreement + freshness - penalties`

Then confidence is capped by sample size, source independence, data quality, and reconstruction state.

### Evidence Strength Score

Implementation: `calculateDiagnosisConfidence`.

Range: 0 to 100.

Formula:

`evidenceStrengthScore = round(clamp(signalVolumeScore * 1.3 + independentSourceScore * 1.4 + sourceAgreementScore * 1.3 + recencyScore * 1.1, 0, 100))`

It represents support strength, not product risk.

### Impact Score / Estimated Impact

Implementation: `app/lib/product-pulse-scoring.js`, `calculateFinancialImpact`.

Impact is money, not a 0-100 score. `impactScore` equals `estimatedImpact`.

Inputs:

- Sold units, sales amount, refund units/amount, return units/rate, average unit revenue, review rating/negative rate, default margin rate, return processing cost, analysis window.

Logic:

- Estimates observed refunds, return processing cost, lost margin from returned units.
- Projects future return loss over a default 90-day projection.
- Estimates review conversion drag from negative review rate and rating deficit.
- Uses the maximum of calculated values and stored `revenueAtRisk`/`marginAtRisk` when present.

Defaults:

- Margin rate fallback: 45%.
- Return processing cost fallback: 8.
- Projection days fallback: 90.

Limitations:

- Does not include external ad spend, taxes, chargebacks, or fulfillment exceptions unless connected and modeled.

### Priority Score

Implementation: `calculatePriorityScore`.

Range: 0 to 100.

Formula:

`priorityScore = round(clamp(0.5 * riskScore + 0.25 * confidenceScore + 0.25 * normalizedLogImpactScore, 0, 100))`

`normalizedLogImpactScore = 100 * log1p(impactScore) / log1p(maxReferenceImpact)`, default max reference impact 25000.

### Product Momentum

Implementation: `app/lib/product-pulse-diagnosis.server.js`, `buildProductMomentum`.

Range: 0 to 100.

Formula:

`momentum = 0.35 * currentVelocity + 0.25 * growth + 0.20 * catalogShare + 0.15 * trendConsistency + 0.05 * recency`

Caps/adjustments:

- No units and no revenue in last 30 days => 0.
- Very low unit volume caps score unless velocity is very high.
- New activity with no previous 30-day sales is capped around 78-87 based on volume.
- Products younger than 30 days cap at 85.
- Inventory constraints cap confidence at 70.

Tiers:

- `>= 80`: Hot
- `>= 60`: Rising
- `>= 40`: Stable
- `>= 20`: Cooling
- `< 20`: Low activity

Recommended use:

- `>= 70`: Add to Watchlist
- `>= 50`: Monitor if risk rises
- otherwise no commercial follow-up needed

## Screens And UX

### Dashboard

Purpose: operational home. Read it as "where should I start?" It shows priority products, KPIs, active jobs, credits, and top issues.

Data flow: `app/routes/app._index.jsx` authenticates the Shopify admin session and calls `getDashboardDataForShop`, which combines stored snapshots, current credit ledger balance, active scan/diagnosis jobs, settings, Shopify catalog count, product images, actions, and latest completed diagnoses through `buildDashboardViewData`.

User actions: run a scan, queue diagnosis for a dashboard product, navigate to product detail, and inspect current jobs. The dashboard is a derived ProductPulse view; it does not expose raw source rows.

### Products

Purpose: filterable product queue. Full-analysis table shows stored diagnoses; Candidates table shows QuickScan candidates.

Data flow: `app/routes/app.products.jsx` loads product view data from stored snapshots, diagnosis jobs, actions, settings, watchlist state, and source coverage.

User actions: run fast product scan, bulk queue diagnoses, search Shopify products, add a Shopify product candidate, add/remove watchlist items, mark resolved/unresolved, and delete ProductPulse internal analysis. The delete action removes app-owned ProductPulse records, not the Shopify product.

### Product Detail

Purpose: product-level diagnosis, evidence, metrics, recommended actions, action history, score history, watchlist status, and product images.

Data flow: `app/routes/app.products_.$productId.jsx` calls `getProductDetailDataForShop`, which loads the current snapshot, ProductActions, latest diagnosis, active diagnosis jobs, settings, watchlist item, score history, and Shopify product images.

User actions: queue/run diagnosis, manage watchlist state, review/edit app-owned ProductPulse actions, and inspect evidence. AI chat actions should navigate or update ProductPulse app-owned records only.

### Evidence Report

Purpose: focused evidence view for one product, using formatted product detail and bounded snippets. It is intended to explain why a diagnosis or recommendation exists without dumping raw source data.

### Watchlist

Purpose: capped monitored product list. It shows current watched products, status, risk trend, recent activity, cadence/settings, active diagnosis jobs, and scan history.

Data flow: `app/routes/app.watchlist.jsx` and `app/lib/product-pulse-watchlist.server.js` load `ProductWatchlistItem`, `ProductWatchSettings`, `ProductWatchActivity`, latest snapshots, active jobs, and score history.

User actions: add, pause, resume, or remove watched products; save watchlist settings; run/refresh watchlist scan depending on current workflow.

### Analytics

Purpose: aggregate risk, impact, source coverage, issues, trends, and action/recommendation view from stored ProductPulse data.

Data flow: `app/routes/app.analytics.jsx` calls `getAnalyticsDataForShop`, which combines snapshots, sources, actions, settings, latest diagnoses, active jobs, and score history through `buildAnalyticsViewData`. It is calculated view data, not raw source data.

### Settings

Purpose: tune ProductPulse thresholds, evidence windows, and generated HTML style.

Data flow: `app/routes/app.settings.jsx` reads and writes `ProductPulseSettings` through `product-pulse-settings.server.js`.

User actions: save risk thresholds, momentum threshold, evidence lookback window, HTML injection style, and development-only mock dataset controls.

### AI Costs / AI Debug

Purpose: internal/developer observability screens for AI turns, token usage, estimated costs, traces, and debug status when feature flags allow them. These screens are not part of merchant scoring logic.

## Settings And Configuration

- `risk.minimumScore`: default 18, allowed 0-90. QuickScan keeps products at or above this risk score unless momentum also qualifies them.
- `risk.mediumThreshold`: default 55, must be above minimum and <= 95. Starts medium risk label.
- `risk.highThreshold`: default 75, must be above medium and <= 100. Starts high risk label.
- `momentum.minimumScore`: default 70, allowed 0-100. QuickScan keeps products with momentum at or above this even if risk is below minimum.
- `analysis.lookbackDays`: default 60, allowed 10-365. Controls how far back QuickScan and full diagnostics read orders, returns, refunds, and connected reviews.
- Watchlist `scanCadenceDays`: default 3, options 1, 2, 3, 7, 14.
- Watchlist `triggerRule`: default `new_or_rising_risk`; options include new issue only, risk score increase, medium/high risk, any change.
- Watchlist `summarySchedule`: default `daily_digest_8am`; options daily, weekly, immediate only, none.
- Watchlist `alertsEnabled`: default true.

## Unknowns

- Exact merchant-facing billing and production credit rules beyond current internal credit ledger are not fully implemented.
- Some Analytics view-model formulas live in UI/data builder code and are documented conceptually here rather than as one exported formula.
- Some recommendation generation rules are long and issue-specific in `product-pulse-diagnosis.server.js`; the knowledge layer should summarize supported behavior and avoid claiming every possible action template.
- Legacy internal names still use “draft” in some app product action statuses and payload fields. In the current AI chat mutation path, confirmed saves create app-visible ProductPulse records and do not create final chat-only records.
