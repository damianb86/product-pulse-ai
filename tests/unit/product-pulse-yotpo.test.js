/* eslint-env node */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchYotpoProductReviewPages,
  testYotpoReviewConnection,
  fetchYotpoReviewPages,
} from "../../app/lib/product-pulse-yotpo.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductPulse Yotpo Reviews client", () => {
  it("authenticates and verifies review API access", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/oauth/token")) {
        expect(JSON.parse(options.body)).toEqual({
          client_id: "store_1234567890",
          client_secret: "secret_1234567890",
          grant_type: "client_credentials",
        });
        return jsonResponse({ access_token: "utoken_123" });
      }

      expect(String(url)).toBe("https://api.yotpo.com/v1/apps/store_1234567890/reviews?page=1&count=1");
      expect(options.headers.Authorization).toBe("Bearer utoken_123");
      expect(options.headers["X-Yotpo-Token"]).toBe("utoken_123");
      return jsonResponse({
        response: {
          reviews: [{ id: 10, score: 5, title: "Great" }],
          current_page: 1,
          total_pages: 3,
          total_reviews: 14,
        },
      });
    });

    const result = await testYotpoReviewConnection({
      storeId: "store_1234567890",
      apiSecret: "secret_1234567890",
      fetchImpl: fetchMock,
    });

    expect(result.utoken).toBe("utoken_123");
    expect(result.reviewSampleCount).toBe(1);
    expect(result.totalReviews).toBe(14);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the utoken query parameter when header auth is rejected", async () => {
    const fetchMock = vi.fn(async (url) => {
      const textUrl = String(url);
      if (!textUrl.includes("utoken=utoken_456")) {
        return jsonResponse({ message: "Unauthorized" }, { status: 401 });
      }
      return jsonResponse({ response: { reviews: [{ id: 99, score: 1 }], total_pages: 1 } });
    });

    const result = await fetchYotpoReviewPages({
      storeId: "store_1234567890",
      utoken: "utoken_456",
      maxPages: 1,
      count: 100,
      fetchImpl: fetchMock,
    });

    expect(result.reviews).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("utoken=utoken_456");
  });

  it("reads product reviews from Yotpo's product widget endpoint", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe("https://api-cdn.yotpo.com/v1/widget/store_1234567890/products/987654321/reviews.json?per_page=150&page=1&sort=date&direction=desc");
      expect(options.headers.accept).toBe("application/json");
      return jsonResponse({
        response: {
          reviews: [
            { id: 1, score: 2, title: "Too small", content: "The fit runs small." },
            { id: 2, score: 5, title: "Great", content: "Better than expected." },
          ],
          bottomline: { total_review: 2, average_score: 3.5 },
        },
      });
    });

    const result = await fetchYotpoProductReviewPages({
      storeId: "store_1234567890",
      productId: "987654321",
      fetchImpl: fetchMock,
    });

    expect(result.reviews).toHaveLength(2);
    expect(result.totalReviews).toBe(2);
    expect(result.bottomline.average_score).toBe(3.5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}
