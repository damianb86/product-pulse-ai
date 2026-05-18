import { describe, expect, it } from "vitest";
import {
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
});
