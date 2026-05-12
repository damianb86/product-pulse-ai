import { describe, expect, it } from "vitest";
import { buildQuickScanCandidates } from "../../app/lib/product-pulse-quick-scan.server";

describe("ProductPulse QuickScan", () => {
  it("keeps only deterministic high-risk candidates from Shopify-native events", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [
        {
          id: "gid://shopify/Product/1",
          handle: "linen-shirt",
          title: "Linen Shirt",
          productType: "Apparel",
          variants: [{ id: "gid://shopify/ProductVariant/1", title: "M", sku: "LIN-M" }],
        },
        {
          id: "gid://shopify/Product/2",
          handle: "canvas-tote",
          title: "Canvas Tote",
          productType: "Accessories",
          variants: [{ id: "gid://shopify/ProductVariant/2", title: "Default Title", sku: "TOTE" }],
        },
      ],
      events: [
        ...Array.from({ length: 20 }, () => ({
          type: "sale",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 80,
        })),
        ...Array.from({ length: 20 }, () => ({
          type: "sale",
          productId: "gid://shopify/Product/2",
          variantId: "gid://shopify/ProductVariant/2",
          quantity: 1,
          amount: 40,
        })),
        ...Array.from({ length: 7 }, () => ({
          type: "return",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          reason: "SIZE_TOO_SMALL",
          note: "too small",
          occurredAt: new Date().toISOString(),
        })),
        ...Array.from({ length: 4 }, () => ({
          type: "refund",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 320,
          occurredAt: new Date().toISOString(),
        })),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      handle: "linen-shirt",
      primaryIssue: "Fit & sizing",
    });
    expect(candidates[0].riskScore).toBeGreaterThanOrEqual(50);
    expect(candidates[0].metrics.topReturnReasons).toContain("Size Too Small");
  });
});
