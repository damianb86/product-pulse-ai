/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/lib/product-pulse-job-logs.server", () => ({
  recordJobLog: vi.fn(),
  serializeError: (error) => ({ message: error?.message || String(error) }),
}));

const {
  calculateProductRetentionMetricRows,
  buildProductRetentionPayload,
  __productPulseRetentionTestHooks,
} = await import("../../app/lib/product-pulse-retention.server.js");

const PRODUCT_A = "gid://shopify/Product/A";
const PRODUCT_B = "gid://shopify/Product/B";
const VARIANT_A_1 = "gid://shopify/ProductVariant/A1";
const VARIANT_A_2 = "gid://shopify/ProductVariant/A2";

function order({
  id,
  customerId,
  email,
  createdAt,
  lineItems,
  cancelledAt = null,
  test = false,
  sourceName = "web",
  discountCodes = [],
  country = "United States",
  province = "CA",
  customerTags = [],
  marketingConsent = "subscribed",
}) {
  return {
    id,
    customerGid: customerId ? `gid://shopify/Customer/${customerId}` : null,
    email,
    createdAt,
    processedAt: createdAt,
    cancelledAt,
    test,
    displayFinancialStatus: "PAID",
    sourceName,
    discountCodes,
    shippingAddress: { country, province },
    customer: {
      id: customerId ? `gid://shopify/Customer/${customerId}` : null,
      email,
      tags: customerTags,
      emailMarketingConsent: { marketingState: marketingConsent },
    },
    lineItems: lineItems.map((lineItem, index) => ({
      id: `${id}:line:${index + 1}`,
      productGid: lineItem.productGid,
      variantGid: lineItem.variantGid || null,
      quantity: lineItem.quantity || 1,
      grossRevenueCents: lineItem.grossRevenueCents ?? lineItem.netRevenueCents,
      netRevenueCents: lineItem.netRevenueCents,
      refundedRevenueCents: lineItem.refundedRevenueCents || 0,
      discountCodes: lineItem.discountCodes || [],
      sku: lineItem.sku || "",
      title: lineItem.title || "Fixture line",
    })),
  };
}

function buildFixtureOrders() {
  return [
    order({
      id: "prior-existing-customer",
      customerId: "5",
      createdAt: "2023-12-01T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_B, netRevenueCents: 3000 }],
    }),
    order({
      id: "c1-first-a",
      customerId: "1",
      createdAt: "2024-01-01T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 10000 }],
    }),
    order({
      id: "c2-first-a",
      customerId: "2",
      createdAt: "2024-01-01T10:05:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 5000 }],
    }),
    order({
      id: "c2-repeat-a",
      customerId: "2",
      createdAt: "2024-01-11T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 5000 }],
    }),
    order({
      id: "c3-first-a",
      customerId: "3",
      createdAt: "2024-01-01T11:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 4000 }],
    }),
    order({
      id: "c3-cross-b",
      customerId: "3",
      createdAt: "2024-01-21T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_B, netRevenueCents: 3000 }],
    }),
    order({
      id: "c4-first-a",
      customerId: "4",
      createdAt: "2024-01-01T12:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 7000 }],
    }),
    order({
      id: "c4-repeat-a-and-b",
      customerId: "4",
      createdAt: "2024-02-10T12:00:00.000Z",
      lineItems: [
        { productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 7000 },
        { productGid: PRODUCT_B, netRevenueCents: 2000 },
      ],
    }),
    order({
      id: "c5-first-a-discount",
      customerId: "5",
      createdAt: "2024-01-01T13:00:00.000Z",
      discountCodes: ["SAVE10"],
      customerTags: ["vip"],
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_2, netRevenueCents: 6000 }],
    }),
    order({
      id: "c5-cross-b",
      customerId: "5",
      createdAt: "2024-03-30T13:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_B, netRevenueCents: 4000 }],
    }),
    order({
      id: "c6-first-a-refunded",
      customerId: "6",
      createdAt: "2024-02-01T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, grossRevenueCents: 10000, netRevenueCents: 8000, refundedRevenueCents: 2000 }],
    }),
    order({
      id: "c6-cancelled-repeat",
      customerId: "6",
      createdAt: "2024-02-20T10:00:00.000Z",
      cancelledAt: "2024-02-20T12:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_B, netRevenueCents: 5000 }],
    }),
    order({
      id: "c7-first-a",
      customerId: "7",
      createdAt: "2024-02-01T10:30:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 10000 }],
    }),
    order({
      id: "c7-repeat-a",
      customerId: "7",
      createdAt: "2024-05-01T10:30:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 10000 }],
    }),
    order({
      id: "c8-immature-first-a",
      customerId: "8",
      createdAt: "2024-06-20T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 10000 }],
    }),
    order({
      id: "c8-immature-cross-b",
      customerId: "8",
      createdAt: "2024-06-25T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_B, netRevenueCents: 5000 }],
    }),
    order({
      id: "c11-first-a-quantity",
      customerId: "11",
      createdAt: "2024-01-01T14:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_2, quantity: 3, netRevenueCents: 3000 }],
    }),
    order({
      id: "c11-same-day-next-a-and-b",
      customerId: "11",
      createdAt: "2024-01-02T14:00:00.000Z",
      lineItems: [
        { productGid: PRODUCT_A, variantGid: VARIANT_A_2, netRevenueCents: 3000 },
        { productGid: PRODUCT_B, netRevenueCents: 2000 },
      ],
    }),
    order({
      id: "c12-first-a-email-only",
      email: " Buyer12@Example.COM ",
      createdAt: "2024-02-01T11:00:00.000Z",
      marketingConsent: "not_subscribed",
      lineItems: [{ productGid: PRODUCT_A, variantGid: VARIANT_A_1, netRevenueCents: 5000 }],
    }),
    order({
      id: "c12-cross-b-email-only",
      email: "buyer12@example.com",
      createdAt: "2024-02-15T11:00:00.000Z",
      marketingConsent: "not_subscribed",
      lineItems: [{ productGid: PRODUCT_B, netRevenueCents: 1000 }],
    }),
    order({
      id: "anonymous-excluded",
      createdAt: "2024-01-15T10:00:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, netRevenueCents: 9999 }],
    }),
    order({
      id: "cancelled-first-a-excluded",
      customerId: "10",
      createdAt: "2024-01-01T09:00:00.000Z",
      cancelledAt: "2024-01-01T09:30:00.000Z",
      lineItems: [{ productGid: PRODUCT_A, netRevenueCents: 9999 }],
    }),
  ];
}

function calculateRows() {
  return calculateProductRetentionMetricRows({
    shopId: "fixture-shop.myshopify.com",
    productGid: PRODUCT_A,
    diagnosisId: "diagnosis-1",
    retentionRunId: "run-1",
    asOfDate: "2024-07-01T00:00:00.000Z",
    timezone: "UTC",
    windowStartDate: "2024-01-01T00:00:00.000Z",
    windowEndDate: "2024-06-30T23:59:59.000Z",
    maxCohortAgeDays: 180,
    orders: buildFixtureOrders(),
  });
}

describe("Product retention deterministic engine", () => {
  it("calculates daily product cohorts, repeat rates, timing and LTV from valid orders", () => {
    const rows = calculateRows();
    const jan1 = rows.dailyCohorts.find((row) => row.cohortDate === "2024-01-01");
    const feb1 = rows.dailyCohorts.find((row) => row.cohortDate === "2024-02-01");
    const immature = rows.dailyCohorts.find((row) => row.cohortDate === "2024-06-20");

    expect(jan1).toMatchObject({
      cohortSize: 6,
      anyRepeatWithin90dCount: 5,
      sameProductRepeatWithin90dCount: 3,
      boughtOtherProductWithin90dCount: 4,
      nextPurchaseSameProductCount: 3,
      nextPurchaseOtherProductCount: 2,
      didNotReturnCount: 1,
      totalNetRevenueWithin90dCents: 61000,
      ltv90Cents: 10167,
      sameProductRevenueWithin90dCents: 50000,
      otherProductRevenueWithin90dCents: 11000,
      avgDaysToNextPurchase: 32,
      medianDaysToNextPurchase: 20,
      isMature90d: true,
    });
    expect(feb1).toMatchObject({
      cohortSize: 3,
      anyRepeatWithin90dCount: 2,
      sameProductRepeatWithin90dCount: 1,
      boughtOtherProductWithin90dCount: 1,
      ltv90Cents: 11333,
    });
    expect(immature).toMatchObject({
      cohortSize: 1,
      anyRepeatWithin90dCount: 1,
      isMature90d: false,
    });

    expect(rows.summary).toMatchObject({
      totalCustomersAnalyzed: 10,
      totalProductOrdersAnalyzed: 14,
      repeatPurchaseRate90d: 0.777778,
      sameProductRepurchaseRate90d: 0.444444,
      crossSellRetentionRate90d: 0.555556,
      productLtv90Cents: 10556,
      hasEnoughData: true,
    });
  });

  it("builds cohort cells for heatmaps and marks immature cells as unobserved", () => {
    const rows = calculateRows();
    const janAge30 = rows.cohortCells.find((row) => row.cohortDate === "2024-01-01" && row.ageDay === 30);
    const immatureAge90 = rows.cohortCells.find((row) => row.cohortDate === "2024-06-20" && row.ageDay === 90);

    expect(janAge30).toMatchObject({
      cohortSize: 6,
      anyRepeatCumulativeCount: 3,
      sameProductRepeatCumulativeCount: 2,
      anyRepeatRate: 0.5,
      sameProductRepeatRate: 0.333333,
      cumulativeLtvCents: 8000,
      isObserved: true,
    });
    expect(immatureAge90).toMatchObject({
      isObserved: false,
      anyRepeatRate: null,
      cumulativeLtvCents: 0,
    });
  });

  it("calculates segment metrics and low-sample flags without exposing plain email identity", () => {
    const rows = calculateRows();
    const existingCustomer = rows.segmentDaily.find((row) => row.segmentType === "customer_type_at_first_product_purchase" && row.segmentValue === "existing_customer");
    const discountCode = rows.segmentDaily.find((row) => row.segmentType === "discount_code" && row.segmentValue === "SAVE10");
    const normalizedEmailOrders = __productPulseRetentionTestHooks.normalizeRetentionOrders(buildFixtureOrders(), { timezone: "UTC" })
      .filter((row) => row.id.startsWith("c12"));

    expect(existingCustomer).toMatchObject({
      cohortSize: 1,
      anyRepeatWithin90dCount: 1,
      boughtOtherProductWithin90dCount: 1,
      isLowSampleSize: true,
    });
    expect(discountCode).toMatchObject({
      cohortSize: 1,
      ltv90Cents: 10000,
      isLowSampleSize: true,
    });
    expect(normalizedEmailOrders[0].customerKey).toBe(normalizedEmailOrders[1].customerKey);
    expect(normalizedEmailOrders[0].customerKey).toMatch(/^email_hash:/);
    expect(normalizedEmailOrders[0].customerKey).not.toContain("buyer12@example.com");
  });

  it("does not request protected customer email fields from Shopify orders", () => {
    const query = __productPulseRetentionTestHooks.buildProductRetentionOrdersQuery();

    expect(query).toContain("customer {");
    expect(query).toContain("id");
    expect(query).not.toMatch(/\\bemail\\b/);
    expect(query).not.toContain("emailMarketingConsent");
  });

  it("builds the product detail payload contract and stays idempotent for the same inputs", () => {
    const first = buildProductRetentionPayload(calculateRows());
    const second = buildProductRetentionPayload(calculateRows());

    expect(first).toEqual(second);
    expect(first.summary.repeatPurchaseRate90d).toBe(0.777778);
    expect(first.dailyRetentionTrend[0]).toEqual(expect.objectContaining({
      date: "2024-01-01",
      cohortSize: 6,
      repeatPurchaseRate90d: 0.833333,
      sameProductRepurchaseRate90d: 0.5,
      crossSellRetentionRate90d: 0.666667,
      isMature90d: true,
    }));
    expect(first.nextPurchaseOutcome[0]).toEqual(expect.objectContaining({
      date: "2024-01-01",
      sameProductAgainPercent: 0.5,
      boughtAnotherProductPercent: 0.333333,
      didNotReturnPercent: 0.166667,
    }));
    expect(first.cohortHeatmap).toContainEqual(expect.objectContaining({
      cohortDate: "2024-01-01",
      ageDay: 30,
      cumulativeLtvCents: 8000,
    }));
    expect(first.timeToRepeatPurchase.find((point) => point.ageDay === 30)).toMatchObject({
      anyRepeatCumulativeRate: 0.444444,
    });
    expect(first.ltvCurve.find((point) => point.ageDay === 30)).toMatchObject({
      cumulativeLtvCents: 8000,
    });
    expect(first.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        segmentType: "customer_type_at_first_product_purchase",
        segmentValue: "new_to_store",
      }),
    ]));
  });
});
