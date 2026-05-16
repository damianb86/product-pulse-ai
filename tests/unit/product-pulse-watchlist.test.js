import { describe, expect, it } from "vitest";
import { __productPulseWatchlistTestHooks } from "../../app/lib/product-pulse-watchlist.server";

describe("ProductPulse watchlist helpers", () => {
  it("labels watchlist row risk with configured ProductPulse thresholds", () => {
    const row = __productPulseWatchlistTestHooks.formatWatchlistRow(
      {
        id: "watch-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Watched product",
        handle: "watched-product",
        status: "Watching",
        addedAt: new Date("2026-05-01T12:00:00.000Z"),
        updatedAt: new Date("2026-05-02T12:00:00.000Z"),
      },
      {
        productGid: "gid://shopify/Product/1",
        riskScore: 63,
        primaryIssue: "Stored signal",
        updatedAt: new Date("2026-05-03T12:00:00.000Z"),
        metrics: {},
      },
      {
        risk: {
          minimumScore: 20,
          mediumThreshold: 70,
          highThreshold: 90,
        },
      },
    );

    expect(row.riskScore).toBe(63);
    expect(row.riskLabel).toBe("Low");
    expect(row.riskTone).toBe("success");
  });

  it("labels watchlist trend average with configured ProductPulse thresholds", () => {
    const trend = __productPulseWatchlistTestHooks.buildWatchlistTrend(
      [{
        productGid: "gid://shopify/Product/1",
        title: "Watched product",
        href: "/app/products/watched-product",
        riskScore: 63,
        latestChangeDetail: "Stored signal",
      }],
      new Map([[
        "gid://shopify/Product/1",
        [
          { riskScore: 58, recordedAt: new Date("2026-05-01T12:00:00.000Z"), source: "quickscan" },
          { riskScore: 63, recordedAt: new Date("2026-05-02T12:00:00.000Z"), source: "full-diagnosis" },
        ],
      ]]),
      {
        risk: {
          minimumScore: 20,
          mediumThreshold: 70,
          highThreshold: 90,
        },
      },
    );

    expect(trend.riskScore).toBe(63);
    expect(trend.riskLabel).toBe("Low");
    expect(trend.series[0].riskLabel).toBe("Low");
  });
});
