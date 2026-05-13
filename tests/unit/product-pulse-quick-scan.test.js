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
    expect(candidates[0].riskScore).toBeGreaterThanOrEqual(80);
    expect(candidates[0].confidence).toBeLessThanOrEqual(80);
    expect(candidates[0].metrics.riskComponents).toMatchObject({
      returnRisk: expect.any(Number),
      refundRisk: expect.any(Number),
      repeatedReasonRisk: expect.any(Number),
    });
    expect(candidates[0].metrics.confidenceFactors.maxConfidence).toBeLessThanOrEqual(86);
    expect(candidates[0].metrics.topReturnReasons).toContain("Size Too Small");
  });

  it("escalates sparse but severe Shopify risk while keeping confidence moderate", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [
        {
          id: "gid://shopify/Product/1",
          handle: "puzzle-box",
          title: "Puzzle Box",
          productType: "Toys",
          variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "PUZ" }],
        },
        {
          id: "gid://shopify/Product/2",
          handle: "steady-seller",
          title: "Steady Seller",
          productType: "Toys",
          variants: [{ id: "gid://shopify/ProductVariant/2", title: "Default Title", sku: "STEADY" }],
        },
      ],
      events: [
        ...Array.from({ length: 10 }, () => ({
          type: "sale",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 40,
        })),
        ...Array.from({ length: 100 }, () => ({
          type: "sale",
          productId: "gid://shopify/Product/2",
          variantId: "gid://shopify/ProductVariant/2",
          quantity: 1,
          amount: 35,
        })),
        ...Array.from({ length: 2 }, () => ({
          type: "return",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          reason: "DAMAGED",
          note: "arrived damaged",
          occurredAt: new Date().toISOString(),
        })),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      handle: "puzzle-box",
      primaryIssue: "Product defect or durability",
    });
    expect(candidates[0].riskScore).toBeGreaterThanOrEqual(60);
    expect(candidates[0].confidence).toBeLessThanOrEqual(70);
  });

  it("uses repeated high refund pressure as a lightweight risk signal", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [{
        id: "gid://shopify/Product/1",
        handle: "fragile-lamp",
        title: "Fragile Lamp",
        productType: "Home",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "LAMP" }],
      }],
      events: [
        ...Array.from({ length: 20 }, () => ({
          type: "sale",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 55,
        })),
        ...Array.from({ length: 5 }, () => ({
          type: "refund",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 55,
          note: "Refunded because the lamp arrived broken",
          occurredAt: new Date().toISOString(),
        })),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].metrics.refundRate).toBe(25);
    expect(candidates[0].metrics.refundPressure).toMatchObject({
      highPressure: true,
      level: "high",
      noteCount: 5,
    });
    expect(candidates[0].metrics.refundNotes[0]).toContain("arrived broken");
    expect(candidates[0].riskScore).toBeGreaterThanOrEqual(50);
  });

  it("does not surface one isolated low-value refund as a risky candidate", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [{
        id: "gid://shopify/Product/1",
        handle: "steady-mug",
        title: "Steady Mug",
        productType: "Home",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "MUG" }],
      }],
      events: [
        ...Array.from({ length: 20 }, () => ({
          type: "sale",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 25,
        })),
        {
          type: "refund",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
          amount: 25,
          note: "One-off goodwill refund",
          occurredAt: new Date().toISOString(),
        },
      ],
    });

    expect(candidates).toEqual([]);
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
