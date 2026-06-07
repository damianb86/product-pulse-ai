# Recommended Actions

ProductPulse recommendations are app-owned guidance records attached to products and diagnoses.

Implementation references:

- `app/lib/product-pulse-diagnosis.server.js`
- `app/lib/product-pulse-jobs.server.js`
- `app/ai/appMutations`

Where recommendations live:

- Product Diagnosis can store recommendations inside `ProductDiagnosis`.
- Confirmed AI app mutations can create or update real `ProductAction` rows.
- Product detail reads these ProductPulse records and displays them in the app.
- Successive Product Diagnosis runs include handled `ProductAction` history as evolution context, so recommendations can be framed as follow-up work instead of repeating the original baseline diagnosis.

Important distinction:

- A recommendation label is not the same as an internal action name.
- Recommendations such as description edits, SEO text, FAQ text, media notes, or QA review are ProductPulse app-owned records until a separate non-AI workflow applies anything to Shopify.

What the AI assistant may do:

- Explain existing recommendations.
- Propose creating or updating ProductPulse app-owned actions.
- Save confirmed ProductPulse actions after backend validation.
- Mark app-owned recommendation/action status when supported.

What the AI assistant must not do:

- Apply a description to Shopify.
- Publish SEO to Shopify.
- Update Shopify metafields.
- Change prices, inventory, status, tags, variants, images, or collections.
- Execute app-owned mutations without explicit confirmation.

Current limitation:

- Some recommendation generation rules are issue-specific and long. The knowledge layer summarizes the supported behavior instead of claiming every possible template.
- If only action status changed and no new source/product evidence exists, exact handled recommendations are suppressed during reanalysis unless future evidence shows the issue persisted or returned.
