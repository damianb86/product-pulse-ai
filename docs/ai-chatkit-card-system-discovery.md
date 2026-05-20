# AI ChatKit Card System Discovery

## Existing UI Patterns

ProductPulse already has strong visual patterns in `app/components/ProductPulseScreens.jsx` and `app/styles/product-pulse.css`:

- KPI cards for dashboard and analytics summaries.
- Product table rows with product title, risk badge, risk score, trend, momentum, status, evidence, source icons, and last analysis.
- Product detail overview cards with risk snapshot, diagnosis confidence, financial exposure, evidence strength, customer signals, and main issue.
- Evidence panels with source labels, compact findings, AI evidence synthesis, metric cards, and empty states.
- Watchlist stat cards, watchlist empty states, recent activity, and change cards.
- Recommended action cards and confirmation modal patterns for app-owned internal actions.
- Consistent risk/status colors through CSS variables such as `--pp-risk-red`, `--pp-warning-amber`, `--pp-success-green`, `--pp-pulse-blue`, and matching soft backgrounds.

ChatKit widgets are JSON payloads rendered by the ChatKit runtime, so existing React/Polaris components cannot be reused directly inside the chat. The adapter should reuse the same information hierarchy, tone mapping, compact spacing, and risk/status language rather than importing those components.

## Existing Data Display Concepts

The Phase 1/2 backend exposes real AI-safe data through typed tools and neutral presentation blocks:

- Product references: `productGid`, `title`, `handle`, `riskScore`, `riskLabel`.
- Diagnosis summaries: `productGid`, `title`, `likelyCause`, `riskScore`, `confidence`, `issues`.
- Evidence snippets: `source`, `quote`, `weight`, bounded by schema.
- Metrics: `label`, `value`, `detail`.
- Internal action proposals: `proposalId`, title, summary, target label, reason, expected result, risks, confirmation level, side effect level, reversibility, expiry.
- Domain types also support recommendation summaries, watchlist items, analytics snapshots, recent activity, and product risk summaries, but the current neutral block schema only covered some of those shapes.

## Needed ChatKit Widgets

Supported now or appropriate to add with existing fields:

- Product/entity summary card from `product_reference`.
- Diagnosis/analysis card from `diagnosis_summary`.
- Evidence list card from `evidence_list`.
- Metrics card from `metric_table`.
- Action confirmation card from `action_proposal`.
- Compact entity/list card for product/watchlist/activity/ranked lists using existing summary fields.
- Recommendation list card using existing `AiRecommendationSummary`-style fields.
- Empty/unavailable state card for missing diagnosis, evidence, products, analytics, or action availability.

Not implemented as a separate chart card yet:

- The app uses custom SVG charts in React screens, not a shared chart library.
- ChatKit widget JSON does not currently expose the same reusable chart primitives.
- The safest chat presentation for this phase is compact metric rows and lists. Sparkline/chart blocks can be added later if the neutral block schema includes validated chart data.

## Reuse Assessment

Direct reuse:

- No existing React/Polaris card component can be embedded directly in ChatKit widgets.

Reusable patterns:

- Risk label tone mapping: high -> danger, medium -> warning, low -> success.
- Compact card hierarchy: title, badges, short text, evidence/reason rows, CTA row.
- Empty states with explicit title and short message.
- Confirmation language from the internal action proposal flow.
- Server-routed navigation and confirmation actions.

## Backend Fields Available

Available through current neutral blocks:

- `summary`: title, text.
- `product_reference`: product GID, title, handle, risk score, risk label.
- `diagnosis_summary`: product GID, title, likely cause, risk score, confidence, issue list.
- `evidence_list`: product GID, source, quote, weight.
- `metric_table`: title, metric label/value/detail.
- `action_proposal`: proposal ID, title, summary, target, reason, expected result, risks, confirmation level, side effect level, reversibility, expiry.

Available in domain types and safe to model in presentation blocks:

- Entity list item title/subtitle/detail/status/risk/product reference fields.
- Recommendation item label/status/issue/effort/draft preview.
- Unavailable state title/message/reason/next step.

Unavailable for ChatKit cards today:

- Product images are not exposed by the AI-safe presentation block schema.
- Vendor/type/status are not exposed on `product_reference`.
- Validated chart series are not exposed as neutral presentation blocks.
- Large raw reviews, raw returns, raw database rows, and internal tenant/user identifiers are intentionally unavailable.

## Design Constraints

- The adapter must not parse natural-language assistant text to create widgets.
- The model may only choose among validated neutral block shapes.
- Widget actions must keep routing through backend validation.
- Action confirmation buttons must send only `proposalId`.
- Cards should cap long text and item counts.
- Unknown or invalid block types must fall back to safe unavailable cards without exposing raw JSON.
