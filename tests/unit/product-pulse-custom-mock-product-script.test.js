import { describe, expect, test } from "vitest";
import {
  buildScenario,
  buildScenarioReviewRows,
  calculateScenarioPlanSummary,
} from "../../scripts/seed-custom-mock-product.js";

describe("custom mock product seed scenario", () => {
  test("defines a LumaSpan scenario with retention and relationship probes", () => {
    const scenario = buildScenario("gen-lumispan-v1", {
      now: new Date("2026-05-25T12:00:00.000Z"),
    });
    const summary = calculateScenarioPlanSummary(scenario);

    expect(scenario.product.title).toBe("GEN LumaSpan Modular Desk Rail Light");
    expect(scenario.product.handle).toBe("gen-lumispan-modular-desk-rail-light");
    expect(scenario.product.descriptionHtml).toMatch(/Wall adapter is not included/i);
    expect(scenario.product.descriptionHtml).toMatch(/left side by default/i);
    expect(scenario.product.descriptionHtml).toMatch(/lowest two dimming levels can show banding/i);
    expect(scenario.product.tags).toEqual(expect.arrayContaining(["retention-test", "relationship-test", "camera-flicker-note"]));
    expect(scenario.relationshipAddOns.map((item) => item.sku)).toEqual(expect.arrayContaining([
      "GEN-RELTEST-TOGETHER",
      "GEN-RELTEST-BEFORE",
      "GEN-RELTEST-AFTER",
    ]));
    expect(new Set(scenario.orderPlans.map((plan) => plan.ref)).size).toBe(scenario.orderPlans.length);
    expect(scenario.orderPlans.filter((plan) => plan.customerKey === "reltest-customer-001")).toHaveLength(2);
    expect(scenario.orderPlans.filter((plan) => plan.customerKey === "reltest-customer-002")).toHaveLength(2);
    expect(scenario.orderPlans.filter((plan) => plan.addOns?.length)).toHaveLength(4);
    expect(summary).toMatchObject({
      plannedOrders: 10,
      plannedUnits: 11,
      plannedReturns: 3,
      plannedRefunds: 3,
      plannedRefundUnits: 3,
      plannedReviews: 13,
      plannedNegativeReviews: 6,
    });
    expect(summary.plannedReturnRate).toBeCloseTo(3 / 11);
    expect(summary.plannedRefundRate).toBeCloseTo(3 / 11);
    expect(scenario.product.expectedActions.join(" ")).toMatch(/Do not recommend adding wall-adapter/i);
  });

  test("defines a coherent repeatable HazeDock scenario", () => {
    const scenario = buildScenario("gen-hazedock-v2", {
      now: new Date("2026-05-25T12:00:00.000Z"),
    });
    const summary = calculateScenarioPlanSummary(scenario);

    expect(scenario.key).toBe("gen-hazedock-v2");
    expect(scenario.product.title).toBe("GEN HazeDock CaseFit Charging Stand");
    expect(scenario.product.tags).toEqual(expect.arrayContaining(["compatibility", "case-compatibility"]));
    expect(new Set(scenario.orderPlans.map((plan) => plan.ref)).size).toBe(scenario.orderPlans.length);
    expect(new Set(scenario.customers.map((customer) => customer.key)).size).toBe(scenario.customers.length);
    expect(summary).toMatchObject({
      plannedOrders: 7,
      plannedUnits: 8,
      plannedReturns: 3,
      plannedRefunds: 2,
      plannedRefundUnits: 2,
      plannedReviews: 10,
      plannedNegativeReviews: 5,
    });
    expect(summary.plannedReturnRate).toBeCloseTo(0.375);
    expect(summary.plannedRefundRate).toBeCloseTo(0.25);
    expect(scenario.outcomePlans.filter((plan) => /not compatible|compatibility/i.test(plan.note))).toHaveLength(5);
  });

  test("builds normalized CSV rows tied to the Shopify product", () => {
    const scenario = buildScenario("gen-hazedock-v2", {
      now: new Date("2026-05-25T12:00:00.000Z"),
    });
    const rows = buildScenarioReviewRows({
      scenario,
      product: {
        id: "gid://shopify/Product/123",
        handle: "gen-hazedock-casefit-charging-stand",
      },
      startRow: 700,
    });

    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      source_row: 700,
      product_handle: "gen-hazedock-casefit-charging-stand",
      shopify_product_id: "gid://shopify/Product/123",
      review_status: "published",
      source_product_id: "gen-hazedock-casefit-stand",
    });
    expect(rows.map((row) => row.source_row)).toEqual([700, 701, 702, 703, 704, 705, 706, 707, 708, 709]);
    expect(rows.filter((row) => /not compatible|compatibility|magnetic-compatible/i.test(row.review_body))).toHaveLength(10);
  });

  test("keeps the original v1 scenario available for existing seeded data", () => {
    const scenario = buildScenario("gen-hazedock-v1", {
      now: new Date("2026-05-25T12:00:00.000Z"),
    });

    expect(scenario.product.title).toBe("GEN HazeDock Magnetic Charging Stand");
    expect(scenario.product.handle).toBe("gen-hazedock-magnetic-charging-stand");
    expect(scenario.scenarioTag).toBe("ppcustom-gen-hazedock-v1");
  });
});
