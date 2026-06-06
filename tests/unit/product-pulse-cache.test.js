import { afterEach, describe, expect, it } from "vitest";
import {
  invalidateProductPulseBackgroundProcessCache,
  invalidateProductPulseDashboardAndAnalyticsCache,
  invalidateProductPulseJobMonitorCache,
} from "../../app/lib/product-pulse-cache.server";

describe("ProductPulse cache invalidation", () => {
  afterEach(() => {
    delete global.productPulseDashboardCache;
    delete global.productPulseAnalyticsCache;
    delete global.productPulseJobMonitorCache;
    delete global.productPulseBackgroundProcessCache;
  });

  it("clears dashboard and analytics cache for one shop", () => {
    global.productPulseDashboardCache = new Map([
      ["shop-a.myshopify.com", { dashboard: true }],
      ["shop-b.myshopify.com", { dashboard: true }],
    ]);
    global.productPulseAnalyticsCache = new Map([
      ["shop-a.myshopify.com", { analytics: true }],
      ["shop-b.myshopify.com", { analytics: true }],
    ]);

    invalidateProductPulseDashboardAndAnalyticsCache("SHOP-A.myshopify.com");

    expect(global.productPulseDashboardCache.has("shop-a.myshopify.com")).toBe(false);
    expect(global.productPulseAnalyticsCache.has("shop-a.myshopify.com")).toBe(false);
    expect(global.productPulseDashboardCache.has("shop-b.myshopify.com")).toBe(true);
    expect(global.productPulseAnalyticsCache.has("shop-b.myshopify.com")).toBe(true);
  });

  it("clears derived job monitor and background process cache keys for one shop", () => {
    global.productPulseJobMonitorCache = new Map([
      ["shop-a.myshopify.com:active:summary:points", { monitor: true }],
      ["shop-b.myshopify.com:active:summary:points", { monitor: true }],
    ]);
    global.productPulseBackgroundProcessCache = new Map([
      ["shop-a.myshopify.com:page-1:no-logs", { processes: true }],
      ["shop-b.myshopify.com:page-1:no-logs", { processes: true }],
    ]);

    invalidateProductPulseJobMonitorCache("shop-a.myshopify.com");

    expect(global.productPulseJobMonitorCache.has("shop-a.myshopify.com:active:summary:points")).toBe(false);
    expect(global.productPulseBackgroundProcessCache.has("shop-a.myshopify.com:page-1:no-logs")).toBe(false);
    expect(global.productPulseJobMonitorCache.has("shop-b.myshopify.com:active:summary:points")).toBe(true);
    expect(global.productPulseBackgroundProcessCache.has("shop-b.myshopify.com:page-1:no-logs")).toBe(true);

    invalidateProductPulseBackgroundProcessCache("shop-b.myshopify.com");
    expect(global.productPulseBackgroundProcessCache.has("shop-b.myshopify.com:page-1:no-logs")).toBe(false);
  });
});
