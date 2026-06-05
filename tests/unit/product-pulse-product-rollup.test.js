import { describe, expect, it } from "vitest";
import { buildProductPulseProductRollupData } from "../../app/lib/product-pulse-product-rollup.server";

describe("ProductPulse product rollup", () => {
  it("stores product images from nested Shopify media metrics", () => {
    const rollup = buildProductPulseProductRollupData({
      id: "snapshot-1",
      shop: "damian-xdcxxupp.myshopify.com",
      productGid: "gid://shopify/Product/123",
      productTitle: "Linen Shirt",
      handle: "linen-shirt",
      riskScore: 72,
      impactScore: 30,
      confidence: 80,
      primaryIssue: "Product content",
      sourceCoverage: ["Shopify products"],
      metrics: {
        product: {
          media: {
            nodes: [{
              preview: {
                image: {
                  url: "https://cdn.shopify.com/s/files/linen-shirt.jpg",
                  altText: "Linen Shirt photo",
                },
              },
            }],
          },
        },
      },
      calculatedAt: "2026-06-05T12:00:00.000Z",
      updatedAt: "2026-06-05T12:00:00.000Z",
    });

    expect(rollup.imageUrl).toBe("https://cdn.shopify.com/s/files/linen-shirt.jpg");
    expect(rollup.imageAlt).toBe("Linen Shirt photo");
  });
});
