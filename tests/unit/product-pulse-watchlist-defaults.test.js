import { describe, expect, it, vi } from "vitest";
import { getWatchlistDefaultAlertRecipients } from "../../app/lib/product-pulse-watchlist-defaults.server";

describe("ProductPulse Watchlist defaults", () => {
  it("uses the Shopify shop email before the session email", async () => {
    const admin = buildAdminGraphqlMock({ email: "shop-owner@example.com" });

    await expect(getWatchlistDefaultAlertRecipients(admin, {
      email: "staff@example.com",
    })).resolves.toEqual(["shop-owner@example.com"]);
  });

  it("falls back to the session email when the shop email is unavailable", async () => {
    const admin = buildAdminGraphqlMock({ email: "" });

    await expect(getWatchlistDefaultAlertRecipients(admin, {
      email: "staff@example.com",
    })).resolves.toEqual(["staff@example.com"]);
  });

  it("falls back to the session email when Shopify cannot be queried", async () => {
    const admin = {
      graphql: vi.fn().mockRejectedValue(new Error("unauthorized")),
    };

    await expect(getWatchlistDefaultAlertRecipients(admin, {
      email: "staff@example.com",
    })).resolves.toEqual(["staff@example.com"]);
  });
});

function buildAdminGraphqlMock({ email }) {
  return {
    graphql: vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          shop: { email },
        },
      }),
    }),
  };
}
