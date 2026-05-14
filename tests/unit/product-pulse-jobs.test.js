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
    expect(collapsible).toContain("<summary>Frequently asked questions</summary>");
    expect(modal).toContain("role=\"dialog\"");
    expect(modal).toContain("Open frequently asked questions");
  });

  it("parses edited FAQ text before falling back to stored FAQ items", () => {
    const parsed = productPulseJobsTestHooks.normalizeFaqItemsForApply(
      [{ question: "Original question?", answer: "Original answer." }],
      "Edited question?\nEdited answer.",
    );

    expect(parsed).toEqual([{ question: "Edited question?", answer: "Edited answer." }]);
  });

  it("builds product-list signal bars in lifecycle order with real metric detail", () => {
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
      "Product setup",
      "PDP content",
      "Reviews",
      "Repeated reasons",
      "Refund pressure",
      "Return pressure",
      "Recent trend",
    ]);
    expect(bars.some((bar) => bar.label === "Baseline")).toBe(false);
    expect(bars.find((bar) => bar.label === "Product setup").detail).toContain("catalog checks");
    expect(bars.find((bar) => bar.label === "Refund pressure").detail).toContain("refund rate");
    expect(bars.find((bar) => bar.label === "Return pressure").detail).toContain("return rate");
    expect(new Set(bars.map((bar) => bar.value)).size).toBeGreaterThan(4);
  });
});
