import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import { serializeCsvRows } from "../../app/lib/product-pulse-csv.server";
import { buildProductPurchaseContextSummary } from "../../app/lib/product-pulse-purchase-context.server";
import { buildProductRelationshipSummary } from "../../app/lib/product-pulse-product-relationships.server";
import { buildReturnRefundRelationshipSummary } from "../../app/lib/product-pulse-return-refund-relationship.server";
import { getConfiguredShopifyScopes } from "../../app/lib/product-pulse-scopes";
import {
  SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS,
  SHOPIFY_MOCK_DATASET_PRODUCT_COUNT,
  __productPulseShopifyMockDatasetTestHooks,
  getMissingShopifyMockDatasetScopes,
  normalizeShopifyMockDatasetStage,
} from "../../app/lib/product-pulse-shopify-mock-dataset.server";

const FIXED_NOW = Date.parse("2026-05-21T12:00:00.000Z");

function productId(key) {
  return `gid://shopify/Product/${key}`;
}

function buildTestProducts() {
  return __productPulseShopifyMockDatasetTestHooks.MOCK_PRODUCTS.map((spec) => ({
    ...spec,
    id: productId(spec.key),
    handle: `gen-${spec.key}`,
    status: "ACTIVE",
    variants: spec.variants.map((variant, index) => ({
      id: `gid://shopify/ProductVariant/${spec.key}-${index}`,
      title: Object.values(variant.options || {}).join(" / ") || "Default Title",
      price: variant.price,
      sku: variant.sku,
      selectedOptions: Object.entries(variant.options || {}).map(([name, value]) => ({ name, value })),
      productKey: spec.key,
    })),
  }));
}

function buildPlans() {
  return __productPulseShopifyMockDatasetTestHooks.buildOrderPlans(buildTestProducts(), "USD", { now: FIXED_NOW });
}

function buildTestCustomers() {
  return __productPulseShopifyMockDatasetTestHooks.RELTEST_CUSTOMERS.map((customer) => ({
    ...customer,
    id: `gid://shopify/Customer/${customer.key}`,
  }));
}

function buildPlansWithCustomers() {
  return __productPulseShopifyMockDatasetTestHooks.attachCustomersToOrderPlans(buildPlans(), buildTestCustomers());
}

function getReltestPlans(plans) {
  return plans.filter((plan) => plan.tags.includes(__productPulseShopifyMockDatasetTestHooks.RELTEST_ORDER_TAG));
}

function orderId(plan) {
  return `gid://shopify/Order/${plan.index + 1}`;
}

function lineItemId(plan, lineIndex) {
  return `gid://shopify/LineItem/${plan.index + 1}-${lineIndex + 1}`;
}

function customerIdForPlan(plan) {
  if (!plan.customerProfileKey) return null;
  return `gid://shopify/Customer/${plan.customerProfileKey}`;
}

function buildSaleEvents(plans) {
  return plans.flatMap((plan) => {
    const customerKey = plan.customerId || customerIdForPlan(plan);
    const basketLineItems = plan.items.map((item, lineIndex) => ({
      id: lineItemId(plan, lineIndex),
      lineItemId: lineItemId(plan, lineIndex),
      productId: productId(item.productKey),
      handle: item.handle,
      title: item.productTitle,
      variantId: item.variantId,
      variantTitle: item.variantTitle,
      sku: item.sku,
      quantity: item.quantity,
      amount: item.quantity * item.unitPrice,
    }));

    return plan.items.map((item, lineIndex) => ({
      type: "sale",
      id: lineItemId(plan, lineIndex),
      orderId: orderId(plan),
      lineItemId: lineItemId(plan, lineIndex),
      productId: productId(item.productKey),
      variantId: item.variantId,
      title: item.productTitle,
      handle: item.handle,
      quantity: item.quantity,
      amount: item.quantity * item.unitPrice,
      createdAt: plan.processedAt,
      orderDate: plan.processedAt,
      customerKey,
      customerId: customerKey,
      basketLineItems,
    }));
  });
}

function buildReltestOutcomeEvents(plans) {
  return __productPulseShopifyMockDatasetTestHooks.RELTEST_OUTCOME_PLANS.map((outcome, index) => {
    const plan = plans.find((candidate) => candidate.tags.includes(outcome.orderTag));
    const lineIndex = plan?.items.findIndex((item) => item.productKey === outcome.productKey) ?? -1;
    const item = lineIndex >= 0 ? plan.items[lineIndex] : null;
    if (!plan || !item) return null;
    return {
      type: outcome.type,
      id: `reltest-${outcome.type}-${index + 1}`,
      orderId: orderId(plan),
      lineItemId: lineItemId(plan, lineIndex),
      productId: productId(item.productKey),
      variantId: item.variantId,
      quantity: outcome.quantity || 1,
      amount: outcome.type === "refund" ? item.unitPrice : 0,
      reason: outcome.returnReason || outcome.note,
      reasonNote: outcome.note,
      note: outcome.note,
      occurredAt: new Date(Date.parse(plan.processedAt) + 24 * 60 * 60 * 1000).toISOString(),
    };
  }).filter(Boolean);
}

describe("Shopify mock dataset scopes", () => {
  it("keeps Shopify CLI configs review-scoped and adds mock dataset scopes only in development runtime", () => {
    for (const fileName of ["shopify.app.toml", "shopify.app.product-pulse-ia.toml"]) {
      const config = readFileSync(join(cwd(), fileName), "utf8");
      const scopeLine = config.match(/scopes\s*=\s*"([^"]+)"/);
      expect(scopeLine, `${fileName} should define access scopes`).toBeTruthy();

      const configuredScopes = scopeLine[1].split(",").map((scope) => scope.trim());
      expect(
        getMissingShopifyMockDatasetScopes(configuredScopes.join(",")),
        `${fileName} should not include development-only mock dataset write scopes`,
      ).toEqual(["write_orders", "write_customers", "write_returns"]);
    }

    expect(
      getMissingShopifyMockDatasetScopes(getConfiguredShopifyScopes("", { includeDevelopmentScopes: true }).join(",")),
      "runtime development scopes should keep the mock dataset generator usable",
    ).toEqual([]);
  });

  it("treats write scopes as satisfying equivalent read scopes", () => {
      const missing = getMissingShopifyMockDatasetScopes([
        "write_products",
        "write_orders",
        "read_all_orders",
        "write_returns",
        "read_locations",
        "write_customers",
      ].join(","));

    expect(missing).toEqual([]);
  });

  it("still reports genuinely missing protected scopes", () => {
    const missing = getMissingShopifyMockDatasetScopes("write_products,write_orders,write_returns");

      expect(missing).toEqual(["read_all_orders", "read_customers", "write_customers", "read_locations"]);
  });

  it("normalizes staged mock dataset actions", () => {
    expect(normalizeShopifyMockDatasetStage("orders")).toBe("orders");
    expect(normalizeShopifyMockDatasetStage("bad-stage")).toBe("all");
    expect(normalizeShopifyMockDatasetStage()).toBe("all");
  });

  it("reports the expanded mock dataset shape", () => {
      expect(SHOPIFY_MOCK_DATASET_PRODUCT_COUNT).toBe(23);
      expect(__productPulseShopifyMockDatasetTestHooks.SHOPIFY_MOCK_DATASET_CUSTOMER_COUNT).toBe(24);
      expect(SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS.orders).toBe(225);
    expect(SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS.evolution).toBe(41);
  });

  it("keeps existing generated orders intact and appends deterministic RELTEST orders", () => {
      const plans = buildPlans();
      const plansWithCustomers = buildPlansWithCustomers();
    const reltestPlans = getReltestPlans(plans);

      expect(plans).toHaveLength(225);
      expect(plans.every((plan) => plan.customerProfileKey)).toBe(true);
      expect(plansWithCustomers.every((plan) => plan.customerId)).toBe(true);
      expect(plans.slice(0, 3).map((plan) => plan.customerProfileKey)).toEqual([
        "reltest-customer-018",
        "reltest-customer-019",
        "reltest-customer-020",
      ]);
      expect(plans.slice(0, 200).some((plan) => plan.tags.includes("productpulse-reltest-order"))).toBe(false);
      expect(plans.slice(0, 200).some((plan) => plan.items.some((item) => item.productKey === "travel-mug-leak"))).toBe(true);
      expect(reltestPlans).toHaveLength(25);
      expect(reltestPlans.slice(0, 13).map((plan) => plan.customerProfileKey)).toEqual([
        "reltest-customer-005",
        "reltest-customer-006",
        "reltest-customer-007",
        "reltest-customer-008",
        "reltest-customer-009",
        "reltest-customer-010",
        "reltest-customer-011",
        "reltest-customer-012",
        "reltest-customer-013",
        "reltest-customer-014",
        "reltest-customer-015",
        "reltest-customer-016",
        "reltest-customer-017",
      ]);
      expect(reltestPlans.slice(0, 13).some((plan) => plan.tags.includes("reltest-sequence-source-01"))).toBe(false);
      expect(reltestPlans.slice(13).filter((plan) => plan.customerProfileKey)).toHaveLength(12);
      expect(__productPulseShopifyMockDatasetTestHooks.buildOrderPlans(buildTestProducts(), "USD", { now: FIXED_NOW })).toEqual(plans);
  });

  it("assigns deterministic customers to recent evolution orders", () => {
    const products = buildTestProducts();
    const customers = buildTestCustomers();
    const plans = __productPulseShopifyMockDatasetTestHooks.buildEvolutionOrderPlans(
      products,
      "USD",
      new Date("2026-05-21T12:00:00.000Z"),
      "recent-watchlist-evolution-v1",
    );
    const plansWithCustomers = __productPulseShopifyMockDatasetTestHooks.attachCustomersToOrderPlans(plans, customers);

    expect(plans).toHaveLength(41);
    expect(plans.every((plan) => plan.customerProfileKey)).toBe(true);
    expect(plansWithCustomers.every((plan) => plan.customerId)).toBe(true);
    expect(plans.slice(0, 3).map((plan) => plan.customerProfileKey)).toEqual([
      "reltest-customer-018",
      "reltest-customer-019",
      "reltest-customer-020",
    ]);
  });

  it("generates RELTEST products and unchanged CSV review headers", () => {
    const products = buildTestProducts();
    const reltestProducts = products.filter((product) => product.key.startsWith("reltest-"));
    const rows = __productPulseShopifyMockDatasetTestHooks.buildReviewRows(products, new Date("2026-05-21T00:00:00.000Z"));
    const reviewCounts = rows.reduce((counts, row) => ({
      ...counts,
      [row.source_product_id]: (counts[row.source_product_id] || 0) + 1,
    }), {});

    expect(reltestProducts.map((product) => product.title)).toEqual([
      "GEN RELTEST Source Product",
      "GEN RELTEST Bought Together Product",
      "GEN RELTEST Bought Before Product",
      "GEN RELTEST Bought After Product",
      "GEN RELTEST Multi Variant Product",
      "GEN RELTEST Bulk Quantity Product",
      "GEN RELTEST Return Refund Product",
      "GEN RELTEST Refund Only Product",
    ]);
    expect(serializeCsvRows(rows.slice(0, 1)).split("\n")[0]).toBe("source_row,product_handle,shopify_product_id,rating,review_title,review_body,review_date,reviewer_name,review_status,source_product_id");
    expect(reviewCounts["reltest-source-product"]).toBe(12);
    expect(reviewCounts["reltest-return-refund-product"]).toBe(8);
    expect(rows.some((row) => row.source_product_id === "reltest-source-product" && /bundle|variant|bulk/i.test(row.review_body))).toBe(true);
  });

  it("creates source product relationship and purchase context data", () => {
    const products = buildTestProducts();
      const plans = buildPlansWithCustomers();
    const reltestPlans = getReltestPlans(plans);
    const sourcePlans = reltestPlans.filter((plan) => plan.items.some((item) => item.productKey === "reltest-source-product"));
    const sourceTogetherPlans = sourcePlans.filter((plan) => plan.items.some((item) => item.productKey === "reltest-bought-together-product"));
    const sourceQuantities = sourcePlans.map((plan) => plan.items
      .filter((item) => item.productKey === "reltest-source-product")
      .reduce((total, item) => total + item.quantity, 0));
    const events = [...buildSaleEvents(plans), ...buildReltestOutcomeEvents(plans)];

      expect(sourcePlans).toHaveLength(14);
      expect(sourcePlans.filter((plan) => new Set(plan.items.map((item) => item.productKey)).size === 1)).toHaveLength(8);
      expect(sourceTogetherPlans).toHaveLength(6);
      expect(sourceQuantities.filter((quantity) => quantity === 1)).toHaveLength(11);
      expect(sourceQuantities.filter((quantity) => quantity > 1)).toHaveLength(3);
    expect(sourceQuantities.filter((quantity) => quantity >= 4)).toHaveLength(1);
    expect(sourcePlans.filter((plan) => plan.items.filter((item) => item.productKey === "reltest-source-product").length > 1)).toHaveLength(1);

    const relationship = buildProductRelationshipSummary({
      productId: productId("reltest-source-product"),
      products,
      events,
      windowDays: 60,
      assumeCompleteOrderEvents: true,
    });
    const boughtTogether = relationship.same_order_relationships.find((item) => item.related_product_id === productId("reltest-bought-together-product"));
      expect(boughtTogether).toMatchObject({
        related_product_title: "GEN RELTEST Bought Together Product",
        co_order_count: 6,
        attach_rate: 0.4286,
      });
    expect(Number(boughtTogether.delta_return_rate || 0) > 0 || Number(boughtTogether.delta_refund_rate || 0) > 0).toBe(true);

    const purchaseContext = buildProductPurchaseContextSummary({
      productId: productId("reltest-source-product"),
      products,
      events,
      assumeCompleteOrderEvents: true,
    });
    expect(purchaseContext).toMatchObject({
        total_orders_containing_product: 14,
        solo_product_order_count: 8,
        multi_product_order_count: 6,
        single_unit_order_count: 11,
      multi_unit_order_count: 3,
      bulk_order_count: 1,
      multi_variant_order_count: 1,
    });
    expect(purchaseContext.top_co_purchased_products[0]).toMatchObject({
      productId: productId("reltest-bought-together-product"),
      title: "GEN RELTEST Bought Together Product",
      co_order_count: 6,
    });
  });

    it("creates customer sequence relationships for bought-before and bought-after products", () => {
      const products = buildTestProducts();
      const plans = buildPlansWithCustomers();
      const events = [...buildSaleEvents(plans), ...buildReltestOutcomeEvents(plans)];
      const reltestPlans = getReltestPlans(plans);
      const sequencePlans = reltestPlans.filter((plan) => plan.tags.some((tag) => tag.includes("reltest-sequence")));
      const sourceSequencePlans = sequencePlans.filter((plan) => plan.tags.includes("reltest-source-sequence"));

      expect(sequencePlans).toHaveLength(12);
      expect(sourceSequencePlans).toHaveLength(4);
      expect(new Set(sequencePlans.map((plan) => plan.customerProfileKey))).toEqual(new Set([
        "reltest-customer-001",
        "reltest-customer-002",
        "reltest-customer-003",
        "reltest-customer-004",
      ]));

      const sourceRelationship = buildProductRelationshipSummary({
        productId: productId("reltest-source-product"),
        products,
        events,
        windowDays: 90,
        assumeCompleteOrderEvents: true,
      });
      const boughtBefore = sourceRelationship.previous_purchase_relationships.find((item) => (
        item.related_product_id === productId("reltest-bought-before-product") && item.time_window === "30d_before"
      ));
      const boughtAfter = sourceRelationship.next_purchase_relationships.find((item) => (
        item.related_product_id === productId("reltest-bought-after-product") && item.time_window === "30d_after"
      ));

      expect(boughtBefore).toMatchObject({
        related_product_title: "GEN RELTEST Bought Before Product",
        customer_count: 4,
        order_count: 4,
      });
      expect(boughtAfter).toMatchObject({
        related_product_title: "GEN RELTEST Bought After Product",
        customer_count: 4,
        order_count: 4,
      });
    });

    it("creates return/refund relationship buckets", () => {
      const products = buildTestProducts();
      const plans = buildPlansWithCustomers();
      const events = [...buildSaleEvents(plans), ...buildReltestOutcomeEvents(plans)];

    const source = buildReturnRefundRelationshipSummary({
      productId: productId("reltest-source-product"),
      products,
      events,
    });
    expect(source.returned_and_refunded_units).toBe(1);
    expect(source.returned_not_refunded_units).toBe(1);
    expect(source.refunded_without_return_units).toBe(1);
    expect(source.exchange_or_replacement_units).toBe(1);

    const returnRefund = buildReturnRefundRelationshipSummary({
      productId: productId("reltest-return-refund-product"),
      products,
      events,
    });
    expect(returnRefund.returned_and_refunded_units).toBe(1);
    expect(returnRefund.returned_not_refunded_units).toBe(1);

    const refundOnly = buildReturnRefundRelationshipSummary({
      productId: productId("reltest-refund-only-product"),
      products,
      events,
    });
    expect(refundOnly.refunded_without_return_units).toBe(1);

    });

    it("documents customer sequence, unattributed refund and exchange scenarios", () => {
      const docs = readFileSync(join(cwd(), "docs/generated-demo-data-scenarios.md"), "utf8");

      expect(docs).toContain("RELTEST_CUSTOMER_001");
      expect(docs).toContain("Bought before: GEN RELTEST Bought Before Product");
      expect(docs).toContain("Bought after: GEN RELTEST Bought After Product");
    expect(docs).toContain("Unattributed order-level refund: unavailable");
    expect(docs).toContain("exchange/replacement return on a source line");
    expect(docs).toContain("Medium White to Large");
    expect(docs).toContain("Rose to Black");
    expect(docs).toContain("Run Catalog Scan to refresh catalog-wide snapshots");
  });

  it("does not add new Shopify mutation operations to the generator", () => {
    const source = readFileSync(join(cwd(), "app/lib/product-pulse-shopify-mock-dataset.server.js"), "utf8");
    const mutationNames = [...source.matchAll(/mutation\s+(ProductPulseCreate\w+)/g)].map((match) => match[1]);

    expect(new Set(mutationNames)).toEqual(new Set([
        "ProductPulseCreateMockProduct",
        "ProductPulseCreateMockVariants",
        "ProductPulseCreateMockCustomer",
        "ProductPulseCreateMockOrder",
      "ProductPulseCreateMockReturn",
      "ProductPulseCreateMockRefund",
    ]));
  });
});
