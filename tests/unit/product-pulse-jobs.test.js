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
    expect(collapsible).toContain("background:#eff6ff");
    expect(modal).toContain("role=\"dialog\"");
    expect(modal).toContain("Open frequently asked questions");
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
    expect(adjusted.actionAdjustment.adjustmentPoints).toBeLessThan(0);
    expect(adjusted.forecastPoints[0].predictedReturnRate).toBeLessThan(20);
    expect(adjusted.forecastPoints[1].predictedReturnRate).toBeLessThan(adjusted.forecastPoints[0].predictedReturnRate);
  });

  it("parses edited FAQ text before falling back to stored FAQ items", () => {
    const parsed = productPulseJobsTestHooks.normalizeFaqItemsForApply(
      [{ question: "Original question?", answer: "Original answer." }],
      "Edited question?\nEdited answer.",
    );

    expect(parsed).toEqual([{ question: "Edited question?", answer: "Edited answer." }]);
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

  it("builds product-list evidence bars in fixed source-family order with real metric detail", () => {
    const bars = productPulseJobsTestHooks.getSignalLifecycleBars({
      productType: "Toys",
      vendor: "Qorve",
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
    const snapshot = productPulseJobsTestHooks.buildManualProductRiskSnapshotPayload("qorve-dev.myshopify.com", {
      id: "gid://shopify/Product/1234567890",
      title: "Manual Search Product",
      handle: "manual-search-product",
      descriptionHtml: "<p>A useful product description for shoppers.</p>",
      vendor: "Qorve",
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
});
