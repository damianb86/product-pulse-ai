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
});
