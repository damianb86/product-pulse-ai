import { describe, expect, it } from "vitest";
import {
  SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS,
  SHOPIFY_MOCK_DATASET_PRODUCT_COUNT,
  getMissingShopifyMockDatasetScopes,
  normalizeShopifyMockDatasetStage,
} from "../../app/lib/product-pulse-shopify-mock-dataset.server";

describe("Shopify mock dataset scopes", () => {
  it("treats write scopes as satisfying equivalent read scopes", () => {
    const missing = getMissingShopifyMockDatasetScopes([
      "write_products",
      "write_orders",
      "read_all_orders",
      "write_returns",
      "read_locations",
    ].join(","));

    expect(missing).toEqual([]);
  });

  it("still reports genuinely missing protected scopes", () => {
    const missing = getMissingShopifyMockDatasetScopes("write_products,write_orders,write_returns");

    expect(missing).toEqual(["read_all_orders", "read_locations"]);
  });

  it("normalizes staged mock dataset actions", () => {
    expect(normalizeShopifyMockDatasetStage("orders")).toBe("orders");
    expect(normalizeShopifyMockDatasetStage("bad-stage")).toBe("all");
    expect(normalizeShopifyMockDatasetStage()).toBe("all");
  });

  it("reports the expanded mock dataset shape", () => {
    expect(SHOPIFY_MOCK_DATASET_PRODUCT_COUNT).toBe(15);
    expect(SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS.orders).toBe(200);
    expect(SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS.evolution).toBe(41);
  });
});
