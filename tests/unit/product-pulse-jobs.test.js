/* eslint-env node */
import { beforeAll, describe, expect, it } from "vitest";

let productPulseJobsTestHooks;

beforeAll(async () => {
  process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "http://127.0.0.1:3000";
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test";
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test";
  process.env.SCOPES = process.env.SCOPES || "read_products";
  ({ __productPulseJobsTestHooks: productPulseJobsTestHooks } = await import("../../app/lib/product-pulse-jobs.server"));
});

describe("ProductPulse product job helpers", () => {
  it("adds storefront and Shopify admin URLs to product table rows", () => {
    const row = productPulseJobsTestHooks.formatProductRow("damian-xdcxxupp.myshopify.com", {
      productGid: "gid://shopify/Product/1234567890",
      handle: "gen-voice-lock-safe-26a108d0",
      productTitle: "GEN Voice Lock Safe",
      primaryIssue: "Product content",
      riskScore: 64,
      confidence: 82,
      updatedAt: "2026-05-18T12:00:00.000Z",
      sourceCoverage: ["Shopify products"],
      metrics: { signalCount: 3 },
    });

    expect(row.shopifyStorefrontUrl).toBe("https://damian-xdcxxupp.myshopify.com/products/gen-voice-lock-safe-26a108d0");
    expect(row.shopifyAdminUrl).toBe("https://admin.shopify.com/store/damian-xdcxxupp/products/1234567890");
  });

  it("formats Catalog Scan jobs as no-credit work by default", () => {
    const process = productPulseJobsTestHooks.formatBackgroundProcess({
      id: "scan-job-1",
      shop: "damian-xdcxxupp.myshopify.com",
      kind: "fast-product-scan",
      source: "Queued Shopify Catalog Scan",
      status: "Queued",
      progress: 0,
      priority: 20,
      attempts: 0,
      payload: {
        pointCost: 0,
        creditCost: 0,
        pointsConsumed: 0,
        creditsConsumed: 0,
        pointDebitStatus: "not_charged",
      },
      startedAt: new Date("2026-06-07T12:00:00.000Z"),
      updatedAt: new Date("2026-06-07T12:00:00.000Z"),
      finishedAt: null,
    });

    expect(process.name).toBe("Catalog Scan");
    expect(process.creditCost).toBe(0);
    expect(process.creditsConsumed).toBe(0);
    expect(process.pointsConsumed).toBe(0);
    expect(process.payloadItems.map((item) => item.label)).not.toEqual(expect.arrayContaining([
      "Point cost",
      "Credit cost",
      "Points consumed",
      "Credits consumed",
      "Point debit status",
    ]));
  });

  it("uses stored product image metrics for product table rows", () => {
    const row = productPulseJobsTestHooks.formatProductRow("damian-xdcxxupp.myshopify.com", {
      productGid: "gid://shopify/Product/1234567890",
      handle: "linen-shirt",
      productTitle: "Linen Shirt",
      primaryIssue: "Product content",
      riskScore: 64,
      confidence: 82,
      updatedAt: "2026-05-18T12:00:00.000Z",
      sourceCoverage: ["Shopify products"],
      metrics: {
        product: {
          featuredMedia: {
            preview: {
              image: {
                url: "https://cdn.shopify.com/s/files/linen-shirt.jpg",
                altText: "Linen Shirt photo",
              },
            },
          },
        },
      },
    });

    expect(row.imageUrl).toBe("https://cdn.shopify.com/s/files/linen-shirt.jpg");
    expect(row.imageAlt).toBe("Linen Shirt photo");
  });

  it("adds Shopify admin review metadata for applied product changes", () => {
    const metadata = productPulseJobsTestHooks.getAppliedProductReviewToastMetadata({
      shop: "damian-xdcxxupp.myshopify.com",
      snapshot: { productGid: "gid://shopify/Product/1234567890" },
      applyResult: { change: { target: "Product description" } },
    });

    expect(metadata).toMatchObject({
      reviewUrl: "https://admin.shopify.com/store/damian-xdcxxupp/products/1234567890",
      reviewLabel: "Open product in Shopify admin",
      reviewMessage: "Please open this product in Shopify admin and verify that the applied changes are correct.",
      toastDurationMs: 12000,
    });
  });

  it("keeps resolved products out of unresolved table views and out of the status filter", () => {
    const snapshots = [
      {
        productGid: "gid://shopify/Product/open",
        handle: "open-product",
        productTitle: "Open Product",
        primaryIssue: "Returns",
        riskScore: 82,
        metrics: { vendor: "Zuam", collections: ["Featured"] },
        sourceCoverage: ["Returns"],
      },
      {
        productGid: "gid://shopify/Product/resolved",
        handle: "resolved-product",
        productTitle: "Resolved Product",
        primaryIssue: "Refunds",
        riskScore: 24,
        metrics: { vendor: "Zuam", collections: ["Featured"] },
        sourceCoverage: ["Refunds"],
      },
    ];
    const resolvedActions = new Map([
      ["gid://shopify/Product/resolved", { productGid: "gid://shopify/Product/resolved", actionType: "mark-resolved" }],
    ]);

    const unresolved = productPulseJobsTestHooks.filterProductSnapshots(snapshots, { resolution: "unresolved" }, resolvedActions);
    const resolved = productPulseJobsTestHooks.filterProductSnapshots(snapshots, { resolution: "resolved" }, resolvedActions);
    const filterOptions = productPulseJobsTestHooks.getProductTableFilterOptions(snapshots, resolvedActions);

    expect(unresolved.map((snapshot) => snapshot.productGid)).toEqual(["gid://shopify/Product/open"]);
    expect(resolved.map((snapshot) => snapshot.productGid)).toEqual(["gid://shopify/Product/resolved"]);
    expect(filterOptions.statuses.map((option) => option.value)).not.toContain("resolved");
    expect(filterOptions.statuses.map((option) => option.label)).not.toContain("Resolved");
  });

  it("builds collapsible and modal-style FAQ HTML blocks", () => {
    const faqItems = [
      { question: "How does this fit?", answer: "Check measurements before purchase." },
      { question: "Can I use it outdoors?", answer: "Review the selected variant and product details." },
    ];

    const collapsible = productPulseJobsTestHooks.buildProductPulseFaqHtml({
      faqItems,
      variant: "description-collapsible",
      action: { id: "create-product-faq" },
    });
    const modal = productPulseJobsTestHooks.buildProductPulseFaqHtml({
      faqItems,
      variant: "description-modal",
      action: { id: "create-product-faq" },
    });

    expect(collapsible).toContain("<details>");
    expect(collapsible).toContain("Frequently asked questions");
    expect(collapsible).toContain("<summary style=");
    expect(collapsible).toContain("productpulse-callout");
    expect(collapsible).toContain("border-left:2px solid #2563eb");
    expect(modal).toContain("<dialog");
    expect(modal).toContain("productpulse-faq-dialog-create-product-faq");
    expect(modal).toContain("showModal()");
    expect(modal).toContain("method=\"dialog\"");
    expect(modal).toContain("Close FAQ modal");
    expect(modal).toContain("View FAQ");
  });

  it("uses custom HTML style templates for generated ProductPulse description blocks", () => {
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtml({
      currentHtml: "<p>Existing copy.</p>",
      draftText: "Add clearer expectation guidance.",
      operation: "append",
      action: { id: "add-guidance-note", payload: {} },
      htmlStyle: {
        preset: "custom",
        customTemplate: "<aside {{ATTRIBUTES}}><h3>{{TITLE}}</h3><div class=\"merchant-guidance\">{{CONTENT_HTML}}</div></aside>",
      },
    });

    expect(html).toContain("<p>Existing copy.</p>");
    expect(html).toContain("<aside data-productpulse-action=\"add-guidance-note\"");
    expect(html).toContain("<h3>Product note</h3>");
    expect(html).toContain("merchant-guidance");
    expect(html).toContain("Add clearer expectation guidance.");
  });

  it("adds missing FAQ items to an existing FAQ definition list when possible", () => {
    const currentHtml = [
      "<section class=\"productpulse-faq productpulse-callout\">",
      "<p>Frequently asked questions</p>",
      "<dl>",
      "<dt>How does this fit?</dt>",
      "<dd>Check measurements before purchase.</dd>",
      "</dl>",
      "</section>",
    ].join("\n");

    const merged = productPulseJobsTestHooks.mergeFaqItemsIntoExistingDescriptionHtml({
      descriptionHtml: currentHtml,
      faqItems: [{ question: "Can I use it outdoors?", answer: "Review the selected variant and product details." }],
    });

    expect(merged).toContain("<dt>How does this fit?</dt>");
    expect(merged).toContain("Can I use it outdoors?");
    expect(merged.indexOf("Can I use it outdoors?")).toBeLessThan(merged.indexOf("</dl>"));
    expect((merged.match(/productpulse-faq/g) || []).length).toBe(1);
  });

  it("keeps open recommendations neutral in return-rate forecasts", () => {
    const prediction = {
      forecastPoints: [
        { key: "2026-05-18", predictedReturnRate: 12 },
        { key: "2026-05-25", predictedReturnRate: 12 },
      ],
      summary: { forecastNext90ReturnRate: 12 },
    };
    const recommendations = [
      { id: "update-product-description", label: "Update product description" },
      { id: "create-product-faq", label: "Create product FAQ" },
    ];

    const adjusted = productPulseJobsTestHooks.adjustReturnRatePredictionForActions(prediction, recommendations, []);

    expect(adjusted.actionAdjustment).toMatchObject({
      pending: 2,
      applied: 0,
      reviewed: 0,
      dismissed: 0,
      adjustmentPoints: 0,
      direction: "neutral",
    });
    expect(adjusted.forecastPoints.map((point) => point.predictedReturnRate)).toEqual([12, 12]);
  });

  it("only lowers return-rate forecasts for applied or reviewed recommendations", () => {
    const prediction = {
      forecastPoints: [
        { key: "2026-05-18", predictedReturnRate: 20 },
        { key: "2026-05-25", predictedReturnRate: 20 },
      ],
      summary: { forecastNext90ReturnRate: 20 },
    };
    const recommendations = [
      { id: "update-product-description", label: "Update product description" },
      { id: "create-product-faq", label: "Create product FAQ" },
      { id: "add-product-tag", label: "Add product tag" },
    ];
    const storedActions = [
      { actionId: "update-product-description", status: "applied", createdAt: "2026-05-16T00:00:00.000Z" },
      { actionId: "create-product-faq", status: "reviewed", createdAt: "2026-05-16T00:01:00.000Z" },
      { actionId: "add-product-tag", status: "dismissed", createdAt: "2026-05-16T00:02:00.000Z" },
    ];

    const adjusted = productPulseJobsTestHooks.adjustReturnRatePredictionForActions(prediction, recommendations, storedActions);

    expect(adjusted.actionAdjustment.direction).toBe("improving");
    expect(adjusted.actionAdjustment.adjustmentPoints).toBe(-5.4);
    expect(adjusted.actionAdjustment.uncertaintyMultiplier).toBe(1.11);
    expect(adjusted.forecastPoints[0].actionAdjustedReturnRateShift).toBeLessThan(-3.5);
    expect(adjusted.forecastPoints[0].predictedReturnRate).toBeLessThan(16.5);
    expect(adjusted.forecastPoints[1].predictedReturnRate).toBeLessThan(adjusted.forecastPoints[0].predictedReturnRate);
  });

  it("parses edited FAQ text before falling back to stored FAQ items", () => {
    const parsed = productPulseJobsTestHooks.normalizeFaqItemsForApply(
      [{ question: "Original question?", answer: "Original answer." }],
      "Edited question?\nEdited answer.",
    );

    expect(parsed).toEqual([{ question: "Edited question?", answer: "Edited answer." }]);
  });

  it("turns answer-only compatibility FAQ drafts into an appliable question and answer", () => {
    const draftText = [
      "Cases with wallet flaps, card sleeves, ring holders, pop-grips, metal plates, thick bumpers, or raised case lips may prevent proper alignment and charging.",
      "",
      "If you use one of these case styles every day, please confirm compatibility before ordering or plan to use the stand with a bare phone or a verified magnetic-compatible case.",
    ].join("\n");

    const parsed = productPulseJobsTestHooks.normalizeFaqItemsForApply([], draftText);

    expect(parsed).toEqual([{
      question: "Which phone cases may prevent proper alignment or charging?",
      answer: "Cases with wallet flaps, card sleeves, ring holders, pop-grips, metal plates, thick bumpers, or raised case lips may prevent proper alignment and charging. If you use one of these case styles every day, please confirm compatibility before ordering or plan to use the stand with a bare phone or a verified magnetic-compatible case.",
    }]);
  });

  it("infers a product metafield write from editable metafield action fields", () => {
    const metafields = productPulseJobsTestHooks.getProductMetafieldsForApply({
      field: "product.metafield.productpulse.faq_html",
      metafieldType: "multi_line_text_field",
      draftText: "<section>FAQ HTML</section>",
      label: "FAQ HTML",
    });

    expect(metafields).toEqual([{
      namespace: "productpulse",
      key: "faq_html",
      type: "multi_line_text_field",
      value: "<section>FAQ HTML</section>",
      label: "FAQ HTML",
      definitionName: "FAQ HTML",
      definitionDescription: "",
    }]);
  });

  it("creates the product metafield definition before saving a missing product metafield", async () => {
    const calls = [];
    const admin = {
      graphql: async (query, options = {}) => {
        calls.push({ query, variables: options.variables });
        if (query.includes("ProductPulseFindProductMetafieldDefinition")) {
          return { json: async () => ({ data: { metafieldDefinitions: { edges: [] } } }) };
        }
        if (query.includes("ProductPulseCreateProductMetafieldDefinition")) {
          return {
            json: async () => ({
              data: {
                metafieldDefinitionCreate: {
                  createdDefinition: {
                    id: "gid://shopify/MetafieldDefinition/1",
                    namespace: "productpulse",
                    key: "faq_html",
                    name: "FAQ HTML",
                    type: { name: "multi_line_text_field" },
                  },
                  userErrors: [],
                },
              },
            }),
          };
        }
        return {
          json: async () => ({
            data: {
              metafieldsSet: {
                metafields: [{
                  id: "gid://shopify/Metafield/1",
                  namespace: "productpulse",
                  key: "faq_html",
                  type: "multi_line_text_field",
                  value: "<section>FAQ HTML</section>",
                }],
                userErrors: [],
              },
            },
          }),
        };
      },
    };

    const result = await productPulseJobsTestHooks.setProductMetafields(admin, "gid://shopify/Product/123", [{
      namespace: "productpulse",
      key: "faq_html",
      type: "multi_line_text_field",
      value: "<section>FAQ HTML</section>",
      label: "FAQ HTML",
    }]);

    expect(result.status).toBe("success");
    expect(calls.map((call) => (
      call.query.includes("ProductPulseFindProductMetafieldDefinition") ? "find"
        : call.query.includes("ProductPulseCreateProductMetafieldDefinition") ? "create"
        : "set"
    ))).toEqual(["find", "create", "set"]);
    expect(calls[1].variables.definition).toMatchObject({
      namespace: "productpulse",
      key: "faq_html",
      type: "multi_line_text_field",
      ownerType: "PRODUCT",
      name: "FAQ HTML",
    });
    expect(calls[2].variables.metafields[0]).toMatchObject({
      ownerId: "gid://shopify/Product/123",
      namespace: "productpulse",
      key: "faq_html",
      type: "multi_line_text_field",
      value: "<section>FAQ HTML</section>",
    });
  });

  it("creates and saves the FAQ HTML product metafield", async () => {
    const calls = [];
    const admin = {
      graphql: async (query, options = {}) => {
        calls.push({ query, variables: options.variables });
        if (query.includes("ProductPulseFindProductMetafieldDefinition")) {
          return { json: async () => ({ data: { metafieldDefinitions: { edges: [] } } }) };
        }
        if (query.includes("ProductPulseCreateProductMetafieldDefinition")) {
          return {
            json: async () => ({
              data: {
                metafieldDefinitionCreate: {
                  createdDefinition: {
                    id: "gid://shopify/MetafieldDefinition/faq",
                    namespace: "productpulse",
                    key: "buyer_faq_html",
                    name: "ProductPulse FAQ HTML",
                    type: { name: "multi_line_text_field" },
                  },
                  userErrors: [],
                },
              },
            }),
          };
        }
        return {
          json: async () => ({
            data: {
              metafieldsSet: {
                metafields: [{
                  id: "gid://shopify/Metafield/faq",
                  namespace: "productpulse",
                  key: "buyer_faq_html",
                  type: "multi_line_text_field",
                  value: options.variables.metafields[0].value,
                }],
                userErrors: [],
              },
            },
          }),
        };
      },
    };

    const result = await productPulseJobsTestHooks.setProductFaqMetafield(admin, "gid://shopify/Product/123", {
      namespace: "productpulse",
      key: "buyer_faq_html",
      type: "multi_line_text_field",
      faqItems: [{ question: "Can I use it with thick cases?", answer: "Use a verified magnetic-compatible case." }],
      sourceActionId: "create-product-faq",
    });

    expect(result.status).toBe("success");
    expect(calls[1].variables.definition).toMatchObject({
      namespace: "productpulse",
      key: "buyer_faq_html",
      name: "ProductPulse FAQ HTML",
      type: "multi_line_text_field",
      ownerType: "PRODUCT",
    });
    expect(calls[2].variables.metafields[0].value).toContain("Frequently asked questions");
    expect(calls[2].variables.metafields[0].value).toContain("Can I use it with thick cases?");
  });

  it("does not report success when Shopify does not confirm the saved metafield", async () => {
    const admin = {
      graphql: async (query) => {
        if (query.includes("ProductPulseFindProductMetafieldDefinition")) {
          return {
            json: async () => ({
              data: {
                metafieldDefinitions: {
                  edges: [{
                    node: {
                      id: "gid://shopify/MetafieldDefinition/1",
                      namespace: "productpulse",
                      key: "faq_html",
                      name: "FAQ HTML",
                      type: { name: "multi_line_text_field" },
                    },
                  }],
                },
              },
            }),
          };
        }
        return { json: async () => ({ data: { metafieldsSet: { metafields: [], userErrors: [] } } }) };
      },
    };

    const result = await productPulseJobsTestHooks.setProductMetafields(admin, "gid://shopify/Product/123", [{
      namespace: "productpulse",
      key: "faq_html",
      type: "multi_line_text_field",
      value: "<section>FAQ HTML</section>",
    }]);

    expect(result.status).toBe("validation_error");
    expect(result.message).toMatch(/did not confirm/i);
  });

  it("preserves description HTML when applying targeted description replacements", () => {
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtml({
      currentHtml: "<div><p>The Vans SK8-Hi in <strong>True White</strong> is a classic high-top.</p></div>",
      draftText: "The Vans SK8-Hi in Black is a classic high-top.",
      operation: "replace",
      action: {
        id: "correct-product-description",
        payload: {
          preserveHtml: true,
          descriptionReplacements: [{ from: "True White", to: "Black" }],
        },
      },
    });

    expect(html).toContain("<strong>Black</strong>");
    expect(html).toContain("<div><p>");
    expect(html).not.toContain("True White");
  });

  it("adds targeted description details to the original HTML instead of flattening rich descriptions", () => {
    const currentHtml = [
      "<section>",
      "<h3>GEN DriftWeave overshirt</h3>",
      "<p>Packable overshirt for travel layers and cool offices <strong>GEN DriftWeave</strong> is a lightweight shell.</p>",
      "<table><tbody><tr><th>Size</th><th>Chest</th></tr><tr><td>M</td><td>42 in</td></tr></tbody></table>",
      "<ul><li>Cotton-nylon blend</li><li>Low-crinkle finish</li></ul>",
      "</section>",
    ].join("");
    const addition = "For precise fit, compare the body-size chart with finished garment measurements before purchase.";
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtml({
      currentHtml,
      draftText: [
        "GEN DriftWeave overshirt.",
        "Packable overshirt for travel layers and cool offices GEN DriftWeave is a lightweight shell.",
        addition,
      ].join(" "),
      operation: "replace",
      action: {
        id: "correct-product-description",
        payload: {
          preserveHtml: true,
          descriptionReplacements: [{
            from: "Packable overshirt for travel layers and cool offices GEN DriftWeave is a lightweight shell.",
            to: `Packable overshirt for travel layers and cool offices GEN DriftWeave is a lightweight shell. ${addition}`,
          }],
        },
      },
    });

    expect(html).toContain("<table><tbody><tr><th>Size</th><th>Chest</th></tr>");
    expect(html).toContain("<ul><li>Cotton-nylon blend</li><li>Low-crinkle finish</li></ul>");
    expect(html).toContain("<strong>GEN DriftWeave</strong>");
    expect(html).toContain(`<p>${addition}</p>`);
    expect(html).not.toContain("Product note");
  });

  it("wraps appended description guidance in a ProductPulse callout without replacing current HTML", () => {
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtml({
      currentHtml: "<div><p>Current product description.</p></div>",
      draftText: "Current product description.\n\nPlease note: check compatibility before purchase.",
      operation: "replace",
      action: { id: "product-description-changes", payload: {} },
    });

    expect(html).toContain("<div><p>Current product description.</p></div>");
    expect(html).toContain("productpulse-callout");
    expect(html).toContain("Please note: check compatibility before purchase.");
    expect(html).toContain("Product note");
  });

  it("replaces full product descriptions without a ProductPulse wrapper", () => {
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtml({
      currentHtml: "<div><p>Old product description.</p></div>",
      draftText: "<h3>Updated product description</h3><p>New copy with <strong>safe HTML</strong>.</p><script>alert('x')</script>",
      operation: "replace",
      action: { id: "rewrite-product-description", payload: {} },
    });

    expect(html).toContain("<h3>Updated product description</h3>");
    expect(html).toContain("<p>New copy with <strong>safe HTML</strong>.</p>");
    expect(html).not.toContain("Old product description");
    expect(html).not.toContain("productpulse-callout");
    expect(html).not.toContain("data-productpulse-action");
    expect(html).not.toContain("Updated product description</p>");
    expect(html).not.toContain("<script");
  });

  it("applies grouped description changes as separate wrapped blocks", () => {
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtmlFromChanges({
      currentHtml: "<div><p>Current product description.</p></div>",
      changes: [
        { id: "fit-note", operation: "prepend", text: "Edited fit note for layering." },
        { id: "specs-note", operation: "append", text: "Edited technical specifications block." },
      ],
      action: { id: "product-description-changes", payload: {} },
    });

    expect(html).toContain('data-productpulse-action="fit-note"');
    expect(html).toContain('data-productpulse-action="specs-note"');
    expect(html).toContain("<div><p>Current product description.</p></div>");
    expect(html.indexOf('data-productpulse-action="fit-note"')).toBeLessThan(html.indexOf("<div><p>Current product description.</p></div>"));
    expect(html.indexOf("<div><p>Current product description.</p></div>")).toBeLessThan(html.indexOf('data-productpulse-action="specs-note"'));
  });

  it("renders safe generated HTML inside ProductPulse description notes", () => {
    const html = productPulseJobsTestHooks.buildUpdatedProductDescriptionHtml({
      currentHtml: "<div><p>Smart indoor herb planter.</p></div>",
      draftText: "<h3>Important Setup Requirements:</h3>\n<ul>\n<li><b>Wi-Fi Compatibility:</b> Requires a 2.4 GHz Wi-Fi network.</li>\n<li><b>App Language:</b> English only.</li>\n</ul>",
      operation: "prepend",
      action: { id: "add-product-description-guidance", payload: {} },
    });

    expect(html).toContain("<h3");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("<b>Wi-Fi Compatibility:</b>");
    expect(html).not.toContain("&lt;h3&gt;");
    expect(html).toContain("<div><p>Smart indoor herb planter.</p></div>");
  });

  it("builds product-list evidence bars in fixed source-family order with real metric detail", () => {
    const bars = productPulseJobsTestHooks.getSignalLifecycleBars({
      productType: "Toys",
      vendor: "Zuam",
      tags: ["gift", "kids"],
      collections: ["Featured"],
      variantCount: 3,
      skuCount: 2,
      optionNames: ["Color"],
      descriptionWordCount: 12,
      contentIssueCount: 1,
      contentQualityRisk: 10,
      reviewCount: 12,
      negativeReviewCount: 5,
      negativeReviewRate: 41.6,
      avgRating: 3.1,
      topReturnReasonDetails: [{ label: "Scary packaging", count: 4 }],
      topRefundReasonDetails: [{ label: "Damaged before shipment", count: 2 }],
      affectedVariants: ["Blue"],
      refundRate: 18,
      refundUnits: 3,
      refundAmount: 250,
      returnRate: 24,
      returnUnits: 5,
      recentSignalUnits: 2,
      signalTrend: [1, 0, 3, 6],
      riskComponents: {
        returnRisk: 38,
        refundRisk: 24,
        repeatedReasonRisk: 20,
        recentSpike: 16,
      },
    });

    expect(bars.map((bar) => bar.label)).toEqual([
      "Product / PDP content",
      "Reviews",
      "Customer language",
      "Returns",
      "Refunds / financial",
    ]);
    expect(bars.some((bar) => bar.label === "Baseline")).toBe(false);
    expect(bars.find((bar) => bar.label === "Product / PDP content").detail).toContain("content issue");
    expect(bars.find((bar) => bar.label === "Reviews").detail).toContain("negative or low-rated");
    expect(bars.find((bar) => bar.label === "Returns").detail).toContain("return rate");
    expect(bars.find((bar) => bar.label === "Refunds / financial").detail).toContain("refund rate");
    expect(new Set(bars.map((bar) => bar.value)).size).toBeGreaterThan(3);
  });

  it("builds a minimal snapshot for manually selected Shopify products", () => {
    const snapshot = productPulseJobsTestHooks.buildManualProductRiskSnapshotPayload("damian-xdcxxupp", {
      id: "gid://shopify/Product/1234567890",
      title: "Manual Search Product",
      handle: "manual-search-product",
      descriptionHtml: "<p>A useful product description for shoppers.</p>",
      vendor: "Zuam",
      productType: "Toy",
      status: "ACTIVE",
      tags: ["featured", "gift"],
      options: [{ name: "Color", values: ["Blue"] }],
      variants: {
        nodes: [
          { id: "gid://shopify/ProductVariant/1", sku: "MSP-BLUE", title: "Blue" },
          { id: "gid://shopify/ProductVariant/2", sku: "", title: "Red" },
        ],
      },
      collections: {
        nodes: [{ title: "New arrivals", handle: "new-arrivals" }],
      },
    });

    expect(snapshot.productGid).toBe("gid://shopify/Product/1234567890");
    expect(snapshot.riskScore).toBe(0);
    expect(snapshot.confidence).toBe(0);
    expect(snapshot.primaryIssue).toBe("Manual diagnosis requested");
    expect(snapshot.sourceCoverage).toEqual(["Shopify products"]);
    expect(snapshot.metrics.manualDiagnosisRequested).toBe(true);
    expect(snapshot.metrics.variantCount).toBe(2);
    expect(snapshot.metrics.skuCount).toBe(1);
    expect(snapshot.metrics.collections).toEqual(["New arrivals"]);
    expect(snapshot.metrics.descriptionWordCount).toBeGreaterThan(0);
  });

  it("formats background process details with payload summaries and per-job logs", () => {
    const process = productPulseJobsTestHooks.formatBackgroundProcess(
      {
        id: "job-1",
        shop: "test.myshopify.com",
        kind: "product-diagnosis",
        source: "Queued Product Diagnosis - GEN EchoLock Voice Safe",
        status: "Running",
        progress: 42,
        payload: {
          productGid: "gid://shopify/Product/123",
          handle: "gen-echolock-voice-safe",
          productTitle: "GEN EchoLock Voice Safe",
          riskScore: 81,
          queuedAt: "2026-05-24T14:00:00.000Z",
        },
        startedAt: new Date("2026-05-24T14:00:00.000Z"),
        updatedAt: new Date("2026-05-24T14:02:00.000Z"),
        finishedAt: null,
      },
      [{ id: "log-1", jobId: "job-1", event: "product_diagnosis.started", message: "Started.", createdAtIso: "2026-05-24T14:00:10.000Z" }],
    );

    expect(process.displayTitle).toBe("GEN EchoLock Voice Safe");
    expect(process.productHref).toBe("/app/products/gen-echolock-voice-safe");
    expect(process.statusKey).toBe("running");
    expect(process.logCount).toBe(1);
    expect(process.payloadItems).toEqual(expect.arrayContaining([
      { label: "Product GID", value: "gid://shopify/Product/123" },
      { label: "Handle", value: "gen-echolock-voice-safe" },
      { label: "Queued risk score", value: "81" },
    ]));
  });

  it("summarizes background process counts by status and kind", () => {
    const stats = productPulseJobsTestHooks.buildBackgroundProcessStats([
      { kind: "product-diagnosis", status: "Running", updatedAt: new Date("2026-05-24T14:02:00.000Z") },
      { kind: "shopify-mock-dataset", status: "Completed", updatedAt: new Date("2026-05-24T14:00:00.000Z") },
      { kind: "fast-product-scan", status: "Failed", updatedAt: new Date("2026-05-24T13:00:00.000Z") },
    ], [{ id: "log-1" }, { id: "log-2" }]);

    expect(stats).toMatchObject({
      total: 3,
      active: 1,
      running: 1,
      queued: 0,
      completed: 1,
      failed: 1,
      logs: 2,
    });
    expect(stats.kindCounts).toMatchObject({
      "Product Diagnosis": 1,
      "Shopify mock dataset": 1,
      "Catalog Scan": 1,
    });
  });

  it("preserves persisted evidence metrics when formatting stored product snapshots", () => {
    const detail = productPulseJobsTestHooks.formatSnapshotForDiagnosis({
      productGid: "gid://shopify/Product/linen",
      productTitle: "GEN Linen Breeze Shirt",
      handle: "gen-linen-shirt-fit-9fe68b03",
      riskScore: 72,
      confidence: 97,
      primaryIssue: "Fit & sizing",
      updatedAt: "2026-05-18T12:00:00.000Z",
      sourceCoverage: ["Shopify products", "Shopify orders", "Shopify returns", "Shopify refunds"],
      metrics: {
        soldUnits: 10,
        returnUnits: 6,
        refundUnits: 1,
        returnRate: 60,
        refundRate: 10,
        monthlyOrderActivity: {
          summary: {
            totalOrderUnits: 11,
            returnRate: 54.55,
            refundRate: 9.09,
          },
        },
        variantCount: 4,
        skuCount: 4,
        optionNames: ["Size", "Color"],
        variants: [{ title: "M / White", sku: "GEN-SHIRT-M-WHT" }],
        affectedVariants: ["M / White"],
        affectedVariantDetails: [{ label: "M / White", count: 7 }],
        topRefundReasons: ["Refund Discrepancy - No restock"],
        topRefundReasonDetails: [{ label: "Refund Discrepancy - No restock", count: 1 }],
        refundInsights: {
          total: 1,
          sentiment: { total: 1, negative: 1, neutral: 0, positive: 0 },
          repeatedLanguage: [],
        },
        returnRefundRelationshipSummary: {
          sold_units: 11,
          sold_orders: 7,
          returned_units: 6,
          refunded_units: 1,
          returned_and_refunded_units: 1,
          relationship_match_confidence_avg: 1,
        },
        returnRefundRelationshipFactors: {
          hasRelationshipSummary: true,
          customerSignalBreakdown: {
            linkedReturnRefundCount: 1,
            returnOnlyCount: 5,
          },
        },
        productPurchaseContextSummary: {
          total_orders_containing_product: 7,
          total_units_sold: 11,
          solo_product_order_count: 5,
          multi_product_order_count: 2,
          avg_product_quantity_per_order: 1.57,
        },
        productPurchaseContextFactors: {
          hasPurchaseContextSummary: true,
          customerSignalBreakdown: {
            primaryContext: "Mostly bought alone",
          },
        },
        productPurchaseContextScoringImpact: [
          "Usually bought alone, so negative signals are easier to attribute.",
        ],
        chartInterpretations: {
          insightVersion: "product_chart_interpretations_v1",
          status: "available",
          interpretations: {
            monthlyOrderActivity: {
              text: "Orders and returns moved together, so demand should be read with post-purchase friction.",
            },
          },
        },
      },
    });

    expect(detail.metrics.soldUnits).toBe(11);
    expect(detail.metrics.returnRate).toBe(54.55);
    expect(detail.metrics.refundRate).toBe(9.09);
    expect(detail.metrics.variantCount).toBe(4);
    expect(detail.metrics.skuCount).toBe(4);
    expect(detail.metrics.optionNames).toEqual(["Size", "Color"]);
    expect(detail.metrics.affectedVariantDetails).toEqual([{ label: "M / White", count: 7 }]);
    expect(detail.metrics.topRefundReasonDetails).toEqual([{ label: "Refund Discrepancy - No restock", count: 1 }]);
    expect(detail.metrics.refundInsights.sentiment.negative).toBe(1);
    expect(detail.metrics.returnRefundRelationshipSummary).toMatchObject({
      sold_units: 11,
      returned_and_refunded_units: 1,
    });
    expect(detail.metrics.returnRefundRelationshipFactors.hasRelationshipSummary).toBe(true);
    expect(detail.metrics.productPurchaseContextSummary).toMatchObject({
      total_orders_containing_product: 7,
      solo_product_order_count: 5,
    });
    expect(detail.metrics.productPurchaseContextFactors.hasPurchaseContextSummary).toBe(true);
    expect(detail.metrics.productPurchaseContextScoringImpact).toEqual([
      "Usually bought alone, so negative signals are easier to attribute.",
    ]);
    expect(detail.metrics.chartInterpretations).toMatchObject({
      status: "available",
      interpretations: {
        monthlyOrderActivity: {
          text: "Orders and returns moved together, so demand should be read with post-purchase friction.",
        },
      },
    });
  });

  it("exposes stored action diagnosis ids so reanalysis can reopen equivalent recommendations", () => {
    const detail = productPulseJobsTestHooks.formatSnapshotForDiagnosis(
      {
        productGid: "gid://shopify/Product/reanalyzed",
        productTitle: "Reanalyzed Product",
        handle: "reanalyzed-product",
        riskScore: 78,
        confidence: 84,
        primaryIssue: "Product content",
        updatedAt: "2026-05-18T12:00:00.000Z",
        sourceCoverage: ["Shopify products"],
        metrics: {
          latestDiagnosisId: "diagnosis-new",
          soldUnits: 4,
          signalCount: 3,
        },
      },
      [{
        id: "action-old",
        diagnosisId: "diagnosis-old",
        actionType: "rewrite-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { sourceActionId: "rewrite-description" },
        createdAt: "2026-05-14T10:00:00.000Z",
        appliedAt: "2026-05-14T10:00:00.000Z",
      }],
      {
        id: "diagnosis-new",
        status: "Completed",
        productGid: "gid://shopify/Product/reanalyzed",
        riskScore: 78,
        confidence: 84,
        likelyCause: "Product content",
        recommendations: [{
          id: "rewrite-description",
          label: "Rewrite product description",
          type: "PDP copy",
          status: "Ready",
        }],
        issues: [],
        evidence: [],
        completedAt: "2026-05-18T12:30:00.000Z",
      },
    );

    expect(detail.latestDiagnosisId).toBe("diagnosis-new");
    expect(detail.actionHistory[0]).toMatchObject({
      diagnosisId: "diagnosis-old",
      actionId: "rewrite-description",
      status: "applied",
    });
  });
});
