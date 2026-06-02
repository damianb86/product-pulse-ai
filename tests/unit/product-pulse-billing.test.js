import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRODUCT_PULSE_STARTER_PLAN_CONFIG,
  getProductPulseBillingView,
  resolveProductPulseBillingPlan,
} from "../../app/lib/product-pulse-billing.server";

const originalBillingTest = process.env.SHOPIFY_BILLING_TEST;

afterEach(() => {
  if (originalBillingTest === undefined) {
    delete process.env.SHOPIFY_BILLING_TEST;
  } else {
    process.env.SHOPIFY_BILLING_TEST = originalBillingTest;
  }
});

describe("ProductPulse Shopify Billing", () => {
  it("resolves Free when there is no active Starter subscription", async () => {
    process.env.SHOPIFY_BILLING_TEST = "true";
    const billing = createBillingMock([]);
    const plan = await resolveProductPulseBillingPlan({
      admin: createAdminMock(),
      billing,
      session: { shop: "free-shop.myshopify.com" },
    });

    expect(plan).toMatchObject({
      isTest: true,
      planKey: "free",
      planName: "Free",
      monthlyCredits: 10,
      subscriptionId: null,
    });
    expect(billing.calls[0]).toMatchObject({
      plans: [PRODUCT_PULSE_STARTER_PLAN_CONFIG.shopifyPlanName],
      isTest: true,
    });
  });

  it("resolves Starter from Shopify Billing subscriptions", async () => {
    process.env.SHOPIFY_BILLING_TEST = "true";
    const subscription = {
      id: "gid://shopify/AppSubscription/123",
      name: PRODUCT_PULSE_STARTER_PLAN_CONFIG.shopifyPlanName,
      test: true,
      status: "ACTIVE",
    };
    const plan = await resolveProductPulseBillingPlan({
      admin: createAdminMock(),
      billing: createBillingMock([subscription]),
      session: { shop: "starter-shop.myshopify.com" },
    });

    expect(plan).toMatchObject({
      planKey: "starter",
      planName: "Starter",
      monthlyCredits: 50,
      subscriptionId: subscription.id,
    });
  });

  it("exposes Starter and one-time diagnosis credit packs for the UI", () => {
    const view = getProductPulseBillingView();

    expect(view).toMatchObject({
      shopifyBillingEnabled: true,
      starterPlan: {
        key: "starter",
        monthlyCredits: 50,
      },
    });
    expect(view.creditPacks.map((pack) => pack.credits)).toEqual([10, 25, 50, 100, 250]);
    expect(view.creditPacks[1]).toMatchObject({
      id: "pack_25",
      amountCents: 650,
      compareAtPriceCents: 1300,
      priceLabel: "$6.50",
      compareAtPriceLabel: "$13",
    });
  });
});

function createAdminMock() {
  return {
    graphql: async () => ({
      json: async () => ({
        data: {
          shop: {
            plan: {
              partnerDevelopment: true,
              publicDisplayName: "Development",
            },
          },
        },
      }),
    }),
  };
}

function createBillingMock(appSubscriptions) {
  const calls = [];
  return {
    calls,
    check: async (options = {}) => {
      calls.push(options);
      return { appSubscriptions };
    },
  };
}
