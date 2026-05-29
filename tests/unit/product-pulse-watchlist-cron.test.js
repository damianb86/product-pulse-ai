import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));
vi.mock("../../app/lib/product-pulse-jobs.server", () => ({ runSelectedProductDiagnosesForShop: vi.fn() }));
vi.mock("../../app/lib/product-pulse-points.server", () => ({ getStorePointBalanceForShop: vi.fn() }));
vi.mock("../../app/lib/product-pulse-watchlist-alerts.server", () => ({
  maybeSendWatchlistRunAlertForQueuedActivity: vi.fn(),
  sendWatchlistCreditExhaustedEmailForShop: vi.fn(),
}));
vi.mock("../../app/lib/product-pulse-watchlist.server", () => ({
  getWatchSettingsForShop: vi.fn(),
  recordWatchActivityForShop: vi.fn(),
}));

import { __productPulseWatchlistCronTestHooks } from "../../app/lib/product-pulse-watchlist-cron.server";

describe("ProductPulse watchlist cron helpers", () => {
  it("queues only as many watchlist products as available credits allow", () => {
    const items = [
      { productGid: "gid://shopify/Product/1", productTitle: "One" },
      { productGid: "gid://shopify/Product/2", productTitle: "Two" },
      { productGid: "gid://shopify/Product/3", productTitle: "Three" },
    ];

    const result = __productPulseWatchlistCronTestHooks.splitWatchlistItemsByAvailableCredits(items, 2);

    expect(result.availableCredits).toBe(2);
    expect(result.queueItems.map((item) => item.productTitle)).toEqual(["One", "Two"]);
    expect(result.skippedForCredits.map((item) => item.productTitle)).toEqual(["Three"]);
  });

  it("skips every watched product when no credits are available", () => {
    const items = [
      { productGid: "gid://shopify/Product/1", productTitle: "One" },
      { productGid: "gid://shopify/Product/2", productTitle: "Two" },
    ];

    const result = __productPulseWatchlistCronTestHooks.splitWatchlistItemsByAvailableCredits(items, 0);

    expect(result.queueItems).toHaveLength(0);
    expect(result.skippedForCredits).toHaveLength(2);
  });
});
