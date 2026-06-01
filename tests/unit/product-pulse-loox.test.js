/* eslint-env node */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLooxProductReviewPages,
  fetchLooxReviewPages,
  testLooxReviewConnection,
} from "../../app/lib/product-pulse-loox.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductPulse Loox Reviews client", () => {
  it("verifies Merchant API review access with the API secret key", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.origin).toBe("https://api.loox.io");
      expect(parsedUrl.pathname).toBe("/api/v1/store/loox_public_store_123456/product-reviews");
      expect(parsedUrl.searchParams.get("page")).toBe("1");
      expect(parsedUrl.searchParams.get("limit")).toBe("1");
      expect(parsedUrl.searchParams.get("status")).toBe("published");
      expect(options.headers["X-Api-Secret-Key"]).toBe("loox_secret_123456");
      return jsonResponse({
        reviews: [{ id: "review_1", rating: 5, body: "Great" }],
        pagination: { total: 14, page: 1, limit: 1, hasMore: true },
      });
    });

    const result = await testLooxReviewConnection({
      publicStoreId: "loox_public_store_123456",
      apiSecret: "loox_secret_123456",
      fetchImpl: fetchMock,
    });

    expect(result.reviewSampleCount).toBe(1);
    expect(result.totalReviews).toBe(14);
    expect(result.hasMore).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads paginated Merchant API product reviews by Shopify product ID", async () => {
    const fetchMock = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.pathname).toBe("/api/v1/store/loox_public_store_123456/product-reviews");
      expect(parsedUrl.searchParams.get("product_id")).toBe("987654321");
      expect(parsedUrl.searchParams.get("sort")).toBe("date");
      return jsonResponse({
        reviews: [
          { id: "review_1", rating: 2, body: "Material felt thin." },
          { id: "review_2", rating: 5, body: "Looks great in photos." },
        ],
        pagination: { total: 2, page: 1, limit: 100, hasMore: false },
      });
    });

    const result = await fetchLooxReviewPages({
      publicStoreId: "loox_public_store_123456",
      apiSecret: "loox_secret_123456",
      productId: "987654321",
      fetchImpl: fetchMock,
    });

    expect(result.reviews).toHaveLength(2);
    expect(result.totalReviews).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads product reviews from the public Storefront API", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.origin).toBe("https://storefront-api.loox.io");
      expect(parsedUrl.pathname).toBe("/storefront/v1/store/loox_public_store_123456/product-reviews");
      expect(parsedUrl.searchParams.get("product_id")).toBe("987654321");
      expect(options.headers.accept).toBe("application/json");
      return jsonResponse({
        reviews: [
          { id: "review_1", rating: 4, body: "Photo helped a lot." },
        ],
        pagination: { total: 1, page: 1, limit: 100, hasMore: false },
      });
    });

    const result = await fetchLooxProductReviewPages({
      publicStoreId: "loox_public_store_123456",
      productId: "987654321",
      fetchImpl: fetchMock,
    });

    expect(result.reviews).toHaveLength(1);
    expect(result.totalReviews).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}
