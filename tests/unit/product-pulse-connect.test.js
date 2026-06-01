/* eslint-env node */
import { describe, expect, it } from "vitest";
import { buildConnectViewData, buildLooxShopifyAdminAppUrl } from "../../app/lib/product-pulse-connect";

describe("ProductPulse Connect view data", () => {
  it("uses a short CSV import display name for processed upload details", () => {
    const connectView = buildConnectViewData([
      {
        sourceKey: "csvReviews",
        category: "reviews",
        connected: true,
        active: true,
        available: true,
        health: "connected",
        config: {
          fileName: "-review-export%2Fzuam-dev-all-published-reviews-in-judgeme-format-2026-05-14-1778771736.csv",
          normalizedRowCount: 33,
        },
      },
    ]);

    const csvSource = connectView.signalCategories
      .flatMap((category) => category.sources)
      .find((source) => source.key === "csvReviews");

    expect(csvSource.detail).toBe("CSV import processed (33 reviews)");
  });

  it("marks disabled CSV imports as inactive source evidence", () => {
    const connectView = buildConnectViewData([
      {
        sourceKey: "csvReviews",
        category: "reviews",
        connected: true,
        active: false,
        available: true,
        health: "disabled",
        config: {
          fileName: "CSV import",
          normalizedRowCount: 33,
        },
      },
    ]);

    const reviewsCategory = connectView.signalCategories.find((category) => category.id === "reviews");
    const csvSource = reviewsCategory.sources.find((source) => source.key === "csvReviews");

    expect(reviewsCategory.connected).toBe(false);
    expect(connectView.coverage).toBe(0);
    expect(csvSource.status).toBe("Disabled");
    expect(csvSource.active).toBe(false);
    expect(csvSource.detail).toBe("CSV import disabled; ignored by Catalog Scan and Product Diagnosis.");
  });

  it("enables Yotpo Reviews as a configurable review connector", () => {
    const connectView = buildConnectViewData([
      {
        sourceKey: "yotpoReviews",
        category: "reviews",
        connected: true,
        active: true,
        available: true,
        health: "connected",
        config: {
          storeIdLast4: "7890",
          reviewSampleCount: 1,
        },
      },
    ]);

    const reviewsCategory = connectView.signalCategories.find((category) => category.id === "reviews");
    const yotpoSource = reviewsCategory.sources.find((source) => source.key === "yotpoReviews");

    expect(reviewsCategory.connected).toBe(true);
    expect(connectView.coverage).toBe(60);
    expect(yotpoSource.available).toBe(true);
    expect(yotpoSource.status).toBe("Connected");
    expect(yotpoSource.detail).toBe("Store ID ending in 7890; 1 review sample read");
  });

  it("enables Loox Reviews as a configurable review connector", () => {
    const connectView = buildConnectViewData([
      {
        sourceKey: "looxReviews",
        category: "reviews",
        connected: true,
        active: true,
        available: true,
        health: "connected",
        config: {
          publicStoreIdLast4: "3456",
          reviewSampleCount: 1,
        },
      },
    ]);

    const reviewsCategory = connectView.signalCategories.find((category) => category.id === "reviews");
    const looxSource = reviewsCategory.sources.find((source) => source.key === "looxReviews");

    expect(reviewsCategory.connected).toBe(true);
    expect(connectView.coverage).toBe(60);
    expect(looxSource.available).toBe(true);
    expect(looxSource.status).toBe("Connected");
    expect(looxSource.action).toBe("Manage");
    expect(looxSource.detail).toBe("publicStoreId ending in 3456; 1 review sample read");
  });

  it("builds Loox Shopify Admin API key links with the current publicStoreId", () => {
    expect(buildLooxShopifyAdminAppUrl("damian-xdcxxupp.myshopify.com")).toBe("https://admin.shopify.com/store/damian-xdcxxupp/apps/loox-fashion-reviews");
    expect(buildLooxShopifyAdminAppUrl("damian-xdcxxupp.myshopify.com", "eGumiAREI8")).toBe("https://admin.shopify.com/store/damian-xdcxxupp/apps/loox-fashion-reviews/merchant/eGumiAREI8/settings/api-keys");
  });
});
