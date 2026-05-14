/* eslint-env node */
import { describe, expect, it } from "vitest";
import { buildConnectViewData } from "../../app/lib/product-pulse-connect";

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
          fileName: "-review-export%2Fqorve-dev-all-published-reviews-in-judgeme-format-2026-05-14-1778771736.csv",
          normalizedRowCount: 33,
        },
      },
    ]);

    const csvSource = connectView.signalCategories
      .flatMap((category) => category.sources)
      .find((source) => source.key === "csvReviews");

    expect(csvSource.detail).toBe("CSV import processed (33 reviews)");
  });
});
