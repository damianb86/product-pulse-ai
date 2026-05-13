import { describe, expect, it } from "vitest";
import {
  buildOrdersBulkQuery,
  buildQuickScanCandidates,
  getPersistableQuickScanCandidates,
  isShopifyOrderAccessDeniedError,
} from "../../app/lib/product-pulse-quick-scan.server";

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

  it("keeps refund line item connections out of the orders bulk query", () => {
    const query = buildOrdersBulkQuery(60);

    expect(query).toContain("lineItems");
    expect(query).toContain("returns");
    expect(query).not.toMatch(/\brefunds\s*\{/);
    expect(query).not.toContain("refundLineItems");
  });

  it("detects Shopify Order object approval errors", () => {
    expect(isShopifyOrderAccessDeniedError(new Error("orders bulk operation failed: ACCESS_DENIED."))).toBe(true);
    expect(isShopifyOrderAccessDeniedError(new Error("orders bulk operation failed: ACCESS_DENIED. This app is not approved to access the Order object"))).toBe(true);
    expect(isShopifyOrderAccessDeniedError(new Error("bulk operation failed: ACCESS_DENIED."), "orders")).toBe(true);
    expect(isShopifyOrderAccessDeniedError(new Error("products bulk operation failed: ACCESS_DENIED."))).toBe(false);
  });

  it("does not persist QuickScan candidates that already have full diagnoses", () => {
    const result = getPersistableQuickScanCandidates(
      [
        { productGid: "gid://shopify/Product/1", title: "Full diagnosis product" },
        { productGid: "gid://shopify/Product/2", title: "QuickScan product" },
      ],
      ["gid://shopify/Product/1"],
    );

    expect(result.ignoredFullDiagnosisProducts).toBe(1);
    expect(result.persistableCandidates).toEqual([
      { productGid: "gid://shopify/Product/2", title: "QuickScan product" },
    ]);
  });
});
