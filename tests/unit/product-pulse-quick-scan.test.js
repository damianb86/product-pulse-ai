import { describe, expect, it } from "vitest";
import {
  __productPulseQuickScanTestHooks,
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

  it("uses normalized CSV review ratings as a deterministic QuickScan source", () => {
    const productId = "gid://shopify/Product/12345";
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [{
        id: productId,
        handle: "night-watch-print",
        title: "Night Watch Print",
        productType: "Art",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "ART-NW" }],
      }],
      events: Array.from({ length: 12 }, () => ({
        type: "sale",
        productId,
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 1,
        amount: 100,
      })),
      csvReviewRatings: [
        { productHandle: "night-watch-print", rating: 1, reviewDate: "2026-05-01" },
        { productHandle: "night-watch-print", rating: 2, reviewDate: "2026-05-02" },
        { productHandle: "night-watch-print", rating: 1, reviewDate: "2026-05-03" },
        { productHandle: "night-watch-print", rating: 2, reviewDate: "2026-05-04" },
        { productHandle: "night-watch-print", rating: 1, reviewDate: "2026-05-05" },
        { productHandle: "night-watch-print", rating: 2, reviewDate: "2026-05-06" },
        { productHandle: "night-watch-print", rating: 1, reviewDate: "2026-05-07" },
        { productHandle: "night-watch-print", rating: 2, reviewDate: "2026-05-08" },
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      handle: "night-watch-print",
      primaryIssue: "Low CSV review rating",
    });
    expect(candidates[0].sourceCoverage).toContain("CSV review ratings");
    expect(candidates[0].riskScore).toBeGreaterThanOrEqual(50);
    expect(candidates[0].confidence).toBeLessThanOrEqual(76);
    expect(candidates[0].metrics).toMatchObject({
      avgRating: 1.5,
      reviewCount: 8,
      negativeReviewCount: 8,
      negativeReviewRate: 100,
    });
    expect(candidates[0].metrics.riskComponents.csvRatingRisk).toBeGreaterThan(30);
  });

  it("does not promote one isolated bad CSV rating into a QuickScan candidate", () => {
    const productId = "gid://shopify/Product/12345";
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [{
        id: productId,
        handle: "steady-print",
        title: "Steady Print",
        productType: "Art",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "ART-ST" }],
      }],
      events: Array.from({ length: 12 }, () => ({
        type: "sale",
        productId,
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 1,
        amount: 100,
      })),
      csvReviewRatings: [
        { productHandle: "steady-print", rating: 1, reviewDate: "2026-05-01" },
      ],
    });

    expect(candidates).toEqual([]);
  });

  it("does not treat positive CSV ratings as product risk", () => {
    const productId = "gid://shopify/Product/12345";
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [{
        id: productId,
        handle: "well-rated-print",
        title: "Well Rated Print",
        productType: "Art",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "ART-GOOD" }],
      }],
      events: [],
      csvReviewRatings: Array.from({ length: 20 }, () => ({
        productHandle: "well-rated-print",
        rating: 5,
        reviewDate: "2026-05-01",
      })),
    });

    expect(candidates).toEqual([]);
  });

  it("matches CSV review ratings by Shopify numeric product ID", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      products: [{
        id: "gid://shopify/Product/98765",
        handle: "numeric-id-match",
        title: "Numeric ID Match",
        productType: "Art",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "ART-ID" }],
      }],
      events: [],
      csvReviewRatings: Array.from({ length: 6 }, (_, index) => ({
        shopifyProductId: "98765",
        rating: index % 2 ? 2 : 1,
        reviewDate: "2026-05-01",
      })),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].handle).toBe("numeric-id-match");
    expect(candidates[0].metrics.reviewCount).toBe(6);
  });

  it("keeps refund line item connections out of the orders bulk query", () => {
    const query = buildOrdersBulkQuery(60);

    expect(query).toContain("lineItems");
    expect(query).toContain("returns");
    expect(query).not.toMatch(/\brefunds\s*\{/);
    expect(query).not.toContain("refundLineItems");
  });

  it("requests flat Shopify bulk query output explicitly", () => {
    expect(__productPulseQuickScanTestHooks.quickScanBulkGroupObjects).toBe(false);
  });

  it("normalizes legacy grouped bulk output if Shopify returns nested objects", () => {
    const { products, events } = __productPulseQuickScanTestHooks.normalizeBulkQuickScanData(
      [{
        __typename: "Product",
        id: "gid://shopify/Product/1",
        handle: "legacy-shirt",
        title: "Legacy Shirt",
        vendor: "Acme",
        productType: "Apparel",
        tags: ["fit"],
        status: "ACTIVE",
        options: [{ name: "Size", values: ["M"] }],
        variants: {
          edges: [{
            node: {
              __typename: "ProductVariant",
              id: "gid://shopify/ProductVariant/1",
              title: "M",
              sku: "LEG-M",
              selectedOptions: [{ name: "Size", value: "M" }],
            },
          }],
        },
        collections: {
          edges: [{
            node: {
              __typename: "Collection",
              id: "gid://shopify/Collection/1",
              handle: "shirts",
              title: "Shirts",
            },
          }],
        },
      }],
      [{
        __typename: "Order",
        id: "gid://shopify/Order/1",
        createdAt: "2026-05-13T12:00:00Z",
        lineItems: {
          edges: [{
            node: {
              __typename: "LineItem",
              id: "gid://shopify/LineItem/1",
              quantity: 2,
              title: "Legacy Shirt",
              sku: "LEG-M",
              product: { id: "gid://shopify/Product/1", handle: "legacy-shirt", title: "Legacy Shirt" },
              variant: { id: "gid://shopify/ProductVariant/1", title: "M", sku: "LEG-M", selectedOptions: [{ name: "Size", value: "M" }] },
              originalTotalSet: { shopMoney: { amount: "80.00" } },
            },
          }],
        },
        returns: {
          edges: [{
            node: {
              __typename: "Return",
              id: "gid://shopify/Return/1",
              createdAt: "2026-05-14T12:00:00Z",
              returnLineItems: {
                edges: [{
                  node: {
                    __typename: "ReturnLineItem",
                    id: "gid://shopify/ReturnLineItem/1",
                    quantity: 1,
                    customerNote: "too small",
                    returnReason: "SIZE_TOO_SMALL",
                    fulfillmentLineItem: {
                      lineItem: {
                        id: "gid://shopify/LineItem/1",
                        title: "Legacy Shirt",
                        sku: "LEG-M",
                        product: { id: "gid://shopify/Product/1", handle: "legacy-shirt", title: "Legacy Shirt" },
                        variant: { id: "gid://shopify/ProductVariant/1", title: "M", sku: "LEG-M", selectedOptions: [{ name: "Size", value: "M" }] },
                      },
                    },
                  },
                }],
              },
            },
          }],
        },
      }],
    );

    expect(products).toHaveLength(1);
    expect(products[0].variants).toHaveLength(1);
    expect(products[0].collections).toEqual([{ id: "gid://shopify/Collection/1", handle: "shirts", title: "Shirts" }]);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["sale", "return"]);
    expect(events[1]).toMatchObject({
      productId: "gid://shopify/Product/1",
      reason: "SIZE_TOO_SMALL",
      note: "too small",
    });
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
