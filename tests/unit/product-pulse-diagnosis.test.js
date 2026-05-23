/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/lib/product-pulse-ai.server.js", () => ({
  runProductDiagnosisAiAnalysis: vi.fn(),
}));
vi.mock("../../app/lib/product-pulse-job-logs.server", () => ({
  recordJobLog: vi.fn(),
  serializeError: (error) => ({ message: error?.message || String(error) }),
}));

const { __productPulseDiagnosisTestHooks } = await import("../../app/lib/product-pulse-diagnosis.server.js");

describe("ProductPulse diagnosis return extraction helpers", () => {
  it("reads Shopify return notes from reason and customer note fields", () => {
    const returnLineItem = {
      returnReason: "OTHER",
      returnReasonNote: "Scares me more than nothing.",
      customerNote: "I want them to take him away.",
      returnReasonDefinition: {
        handle: "OTHER",
        name: "Other",
      },
    };

    expect(__productPulseDiagnosisTestHooks.getReturnReasonValue(returnLineItem)).toBe("OTHER");
    expect(__productPulseDiagnosisTestHooks.getReturnLineItemNoteText(returnLineItem)).toBe("Scares me more than nothing. I want them to take him away.");
  });

  it("groups generic other return reasons under the captured note", () => {
    const reasons = __productPulseDiagnosisTestHooks.buildTopReturnReasonDetails([
      {
        reason: "OTHER",
        reasonLabel: "Other reason",
        reasonNote: "Too soft for balance poses; expected a firmer yoga surface.",
        quantity: 4,
      },
    ]);

    expect(reasons).toEqual([
      expect.objectContaining({
        label: "Other: Too soft for balance poses; expected a firmer yoga surface.",
        category: "Other",
        count: 4,
        subReasons: [
          expect.objectContaining({
            label: "Too soft for balance poses; expected a firmer yoga surface.",
            count: 4,
          }),
        ],
      }),
    ]);
  });

  it("matches returned line items by title when Shopify omits the product object", () => {
    const lineItem = {
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      sku: "",
      product: null,
      variant: null,
    };
    const product = {
      id: "gid://shopify/Product/123",
      numericId: "123",
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
      variants: [],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
    };

    expect(__productPulseDiagnosisTestHooks.lineItemMatchesProduct(lineItem, product, snapshot)).toBe(true);
  });

  it("matches returned line items with strong title overlap when Shopify sends a shortened line title", () => {
    const lineItem = {
      title: "The Night Watch",
      sku: "",
      product: null,
      variant: null,
    };
    const product = {
      id: "gid://shopify/Product/123",
      numericId: "123",
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
      variants: [],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
    };

    expect(__productPulseDiagnosisTestHooks.lineItemMatchesProduct(lineItem, product, snapshot)).toBe(true);
  });

  it("does not match different Shopify products only because titles overlap", () => {
    const lineItem = {
      title: "Transformers Generation Project Storm Autobot Optimus Prime",
      sku: "TOY259",
      product: {
        id: "gid://shopify/Product/999",
        handle: "transformers-project-storm-optimus-prime",
      },
      variant: {
        id: "gid://shopify/ProductVariant/999",
        sku: "TOY259",
      },
    };
    const product = {
      id: "gid://shopify/Product/123",
      numericId: "123",
      title: "Transformers Power of the Primes Voyager Terrorcon Hun-Gurrr",
      handle: "transformers-power-of-the-primes-voyager-terrorcon-hun-gurrr",
      variants: [{ id: "gid://shopify/ProductVariant/123", sku: "TOY251" }],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: product.title,
      handle: product.handle,
    };

    expect(__productPulseDiagnosisTestHooks.lineItemMatchesProduct(lineItem, product, snapshot)).toBe(false);
  });

  it("reads GraphQL connections returned as either nodes or edges", () => {
    expect(__productPulseDiagnosisTestHooks.getNodes({ edges: [{ node: { id: "1" } }, { node: null }] })).toEqual([{ id: "1" }]);
    expect(__productPulseDiagnosisTestHooks.getNodes({ nodes: [{ id: "2" }] })).toEqual([{ id: "2" }]);
  });

  it("can request latest returnReasonDefinition while keeping a legacy query path", () => {
    const latestQuery = __productPulseDiagnosisTestHooks.buildDiagnosisReturnsQuery({ includeReasonDefinition: true });
    const legacyQuery = __productPulseDiagnosisTestHooks.buildDiagnosisReturnsQuery({ includeReasonDefinition: false });

    expect(latestQuery).toContain("returnReasonDefinition");
    expect(latestQuery).toContain("returnReasonNote");
    expect(latestQuery).toContain("customerNote");
    expect(latestQuery).toContain("sortKey: UPDATED_AT");
    expect(latestQuery).toContain("orders(first: $ordersFirst");
    expect(latestQuery).toContain("processedAt");
    expect(latestQuery).toContain("returns(first: $returnsFirst");
    expect(latestQuery).toContain("returnLineItems(first: $returnLineItemsFirst");
    expect(legacyQuery).not.toContain("returnReasonDefinition");
    expect(legacyQuery).toContain("returnReasonNote");
    expect(legacyQuery).toContain("customerNote");
  });

  it("requests refund notes, adjustment reasons, and variant product data for refund extraction", () => {
    const query = __productPulseDiagnosisTestHooks.buildDiagnosisRefundsQuery({
      includeVariantProduct: true,
      includeAdjustments: true,
    });
    const fallbackQuery = __productPulseDiagnosisTestHooks.buildDiagnosisRefundsQuery({
      includeVariantProduct: false,
      includeAdjustments: false,
    });
    const queryModes = __productPulseDiagnosisTestHooks.buildRefundOrderQueries(90).map((item) => item.mode);

    expect(query).toContain("refunds");
    expect(query).toContain("note");
    expect(query).toContain("processedAt");
    expect(query).toContain("orderAdjustments");
    expect(query).toContain("reason");
    expect(query).toContain("displayFinancialStatus");
    expect(query).toContain("totalRefundedSet");
    expect(query).toContain("lineItems(first: $fallbackLineItemsFirst");
    expect(query).toContain("refundLineItems(first: $refundLineItemsFirst");
    expect(query).toMatch(/variant\s*{[\s\S]*?product\s*{/);
    expect(fallbackQuery).not.toContain("orderAdjustments");
    expect(fallbackQuery).not.toContain(`                      product {
                        id
                        legacyResourceId
                        handle
                        title
                      }`);
    expect(queryModes).toEqual(["updated_at", "partially_refunded", "refunded"]);
  });

  it("requests Shopify order geography for sales extraction", () => {
    const query = __productPulseDiagnosisTestHooks.buildDiagnosisSalesQuery();

    expect(query).toContain("sortKey: PROCESSED_AT");
    expect(query).toContain("reverse: true");
    expect(query).toContain("customer");
    expect(query).toContain("shippingAddress");
    expect(query).toContain("billingAddress");
    expect(query).toContain("countryCodeV2");
    expect(query).toContain("provinceCode");
    expect(query).toContain("city");
    expect(query).toContain("featuredMedia");
    expect(query).toContain("media(first: 1)");
    expect(query).toContain("image");
    expect(query).toContain("altText");
  });

  it("backfills missing sale lines from matched return and refund evidence", () => {
    const product = {
      id: "gid://shopify/Product/123",
      title: "GEN CloudSoft Yoga Mat 12mm",
      variants: [{ id: "gid://shopify/ProductVariant/456", sku: "GEN-MAT-CHAR" }],
    };
    const snapshot = {
      productGid: product.id,
      productTitle: product.title,
      handle: "gen-soft-yoga-mat",
    };
    const operational = {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1",
      productId: product.id,
      variantId: "gid://shopify/ProductVariant/456",
      title: product.title,
      sku: "GEN-MAT-CHAR",
      quantity: 2,
      orderDate: "2026-05-21T19:19:49.000Z",
      orderProcessedAt: "2026-05-21T19:19:49.000Z",
      orderCreatedAt: "2026-05-21T19:19:49.000Z",
      selectedOptions: [{ name: "Color", value: "Charcoal" }],
    };

    const sales = __productPulseDiagnosisTestHooks.backfillMissingSalesFromOperationalEvents({
      product,
      snapshot,
      sales: [],
      returns: [{ ...operational, id: "return-1", amount: 0 }],
      refunds: [{ ...operational, id: "refund-1", amount: 84 }],
    });

    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      orderId: operational.orderId,
      lineItemId: operational.lineItemId,
      productId: product.id,
      quantity: 2,
      amount: 84,
      createdAt: "2026-05-21T19:19:49.000Z",
      source: "operational_event_derived_sale",
      derivedFromOperationalEventCount: 2,
    });

    const deduped = __productPulseDiagnosisTestHooks.backfillMissingSalesFromOperationalEvents({
      product,
      snapshot,
      sales,
      returns: [{ ...operational, id: "return-1", amount: 0 }],
      refunds: [{ ...operational, id: "refund-1", amount: 84 }],
    });
    expect(deduped).toHaveLength(1);

    const filtered = __productPulseDiagnosisTestHooks.filterDiagnosisEventsForProduct([
      { ...operational, id: "matching-refund" },
      { ...operational, id: "other-transformer", productId: "gid://shopify/Product/999", variantId: "gid://shopify/ProductVariant/999", sku: "OTHER" },
    ], product, snapshot);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("matching-refund");
  });

  it("can normalize order-level refunded line items when refundLineItems are missing", () => {
    expect(__productPulseDiagnosisTestHooks.shouldUseDiagnosisOrderLevelRefundFallback({
      displayFinancialStatus: "REFUNDED",
      totalRefundedSet: { shopMoney: { amount: "1100.00" } },
    }, null, [{ id: "line-1" }])).toBe(true);

    const event = __productPulseDiagnosisTestHooks.normalizeDiagnosisOrderLevelRefundLineItemEvent({
      id: "gid://shopify/LineItem/1",
      quantity: 1,
      title: "SELF-PORTRAIT WITHOUT BEARD | VINCENT VAN RIJN",
      sku: "PAINT09",
      variant: { id: "gid://shopify/ProductVariant/paint09v", title: "Default Title", sku: "PAINT09", selectedOptions: [] },
      originalTotalSet: { shopMoney: { amount: "1100.00" } },
    }, {
      id: "order-refund:gid://shopify/Order/1135",
      orderId: "gid://shopify/Order/1135",
      createdAt: "2026-05-12T19:28:00Z",
      displayFinancialStatus: "REFUNDED",
      totalRefundedAmount: 1100,
      adjustmentReasons: [],
      lineItems: [{ originalTotalSet: { shopMoney: { amount: "1100.00" } } }],
    }, { title: "SELF-PORTRAIT WITHOUT BEARD | VINCENT VAN RIJN" });

    expect(event).toMatchObject({
      quantity: 1,
      amount: 1100,
      reason: "Refunded",
      fallbackSource: "order_financial_status",
    });
  });

  it("builds refund operational text from refund notes, adjustment reasons, and restock context", () => {
    const text = __productPulseDiagnosisTestHooks.getRefundOperationalText({
      note: "Refunded because the item arrived broken.",
      restockType: "NO_RESTOCK",
      adjustmentReasons: ["Damage"],
    });

    expect(text).toContain("arrived broken");
    expect(text).toContain("Damage");
    expect(text).toContain("No restock");
  });

  it("can omit variant product data for the lowest-cost return query fallback", () => {
    const fallbackQuery = __productPulseDiagnosisTestHooks.buildDiagnosisReturnsQuery({
      includeReasonDefinition: true,
      includeVariantProduct: false,
    });

    expect(fallbackQuery).toContain("variant {");
    expect(fallbackQuery).not.toMatch(/variant\s*{[\s\S]*?product\s*{/);
  });

  it("uses return status queries as a fallback to updated order search", () => {
    const queryModes = __productPulseDiagnosisTestHooks.buildReturnOrderQueries(90).map((query) => query.mode);

    expect(queryModes).toEqual([
      "updated_at",
      "return_requested",
      "in_progress",
      "inspection_complete",
      "returned",
    ]);
  });

  it("detects Shopify query-cost limit errors for retry", () => {
    const error = new Error("Query cost is 1492, which exceeds the single query max cost limit (1000).");

    expect(__productPulseDiagnosisTestHooks.isShopifyQueryCostLimitError(error)).toBe(true);
  });

  it("classifies fear language without objective danger as a subjective negative reaction", () => {
    expect(__productPulseDiagnosisTestHooks.classifyIssueText("Scares me more than nothing. I want them to take him away.")).toBe("subjective_negative_reaction");
    expect(__productPulseDiagnosisTestHooks.classifyIssueText("This product is unsafe and dangerous for children.")).toBe("safety_concern");
  });

  it("extracts return-note sentiment and subjective evidence from Other returns", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [{
        reason: "OTHER",
        reasonNote: "Scares me more than nothing.",
        customerNote: "I want them to take him away.",
        createdAt: "2026-05-13T12:00:00Z",
      }],
      reviews: [],
    });

    expect(insights.sentiment.total).toBe(1);
    expect(insights.sentiment.negative).toBe(1);
    expect(insights.subjectiveNegativity.count).toBe(1);
    expect(insights.otherReturnClassifications[0].issueCode).toBe("subjective_negative_reaction");
    expect(insights.returns.examples[0].text).toContain("Scares me");
  });

  it("excludes default return-reason context from repeated customer language", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [
        {
          reason: "Other reason",
          reasonNote: "Scares me more than nothing.",
          customerNote: "",
          createdAt: "2026-05-13T12:00:00Z",
        },
        {
          reason: "Other reason",
          reasonNote: "Scares me more than anything.",
          customerNote: "",
          createdAt: "2026-05-13T12:05:00Z",
        },
      ],
      reviews: [],
    });
    const terms = insights.repeatedLanguage.map((item) => item.term);

    expect(terms).toContain("scares");
    expect(terms).not.toContain("other");
    expect(terms).not.toContain("reason");
    expect(terms).not.toContain("other reason");
    expect(insights.returns.examples[0].text).not.toContain("Other reason");
  });

  it("excludes common stop words from repeated customer language", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [],
      reviews: [
        { title: "", body: "I took it back because the softness was missing.", rating: 2, createdAt: "2026-05-13T12:00:00Z" },
        { title: "", body: "Took this back; softness was not what I expected.", rating: 2, createdAt: "2026-05-13T12:05:00Z" },
        { title: "", body: "The softness was poor and I would not buy again.", rating: 2, createdAt: "2026-05-13T12:10:00Z" },
      ],
    });
    const terms = insights.repeatedLanguage.map((item) => item.term);

    expect(terms).toContain("softness");
    expect(terms).not.toContain("took");
    expect(terms).not.toContain("would");
    expect(terms).not.toContain("because");
  });

  it("keeps mixed 3-star reviews neutral and stores review sentiment trend buckets", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [],
      reviews: [
        {
          title: "Matched the page",
          body: "The item was good and matched the description.",
          rating: 5,
          sourceType: "csv_review",
          sourceLabel: "CSV reviews",
          createdAt: "2026-01-10T12:00:00Z",
        },
        {
          title: "Average overall",
          body: "It is okay overall, mixed feelings, average experience.",
          rating: 3,
          sourceType: "csv_review",
          sourceLabel: "CSV reviews",
          createdAt: "2026-03-10T12:00:00Z",
        },
        {
          title: "Not what I expected",
          body: "The product was damaged and I had to return it.",
          rating: 2,
          sourceType: "csv_review",
          sourceLabel: "CSV reviews",
          createdAt: "2026-06-10T12:00:00Z",
        },
      ],
    });

    expect(insights.reviews.sentiment).toMatchObject({
      total: 3,
      positive: 1,
      neutral: 1,
      negative: 1,
    });
    expect(insights.reviews.bySource.csv.sentimentTrend).toEqual([
      expect.objectContaining({ label: "Jan 2026", positive: 1, neutral: 0, negative: 0, total: 1 }),
      expect.objectContaining({ label: "Mar 2026", positive: 0, neutral: 1, negative: 0, total: 1 }),
      expect.objectContaining({ label: "Jun 2026", positive: 0, neutral: 0, negative: 1, total: 1 }),
    ]);
    expect(insights.reviews.bySource.csv.ratingTrend).toEqual([
      expect.objectContaining({ label: "Jan 2026", averageRating: 5, reviewCount: 1 }),
      expect.objectContaining({ label: "Mar 2026", averageRating: 3, reviewCount: 1 }),
      expect.objectContaining({ label: "Jun 2026", averageRating: 2, reviewCount: 1 }),
    ]);
  });

  it("ignores generic Other return reasons when there is no customer note", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [{
        reason: "Other reason",
        reasonNote: "",
        customerNote: "",
        createdAt: "2026-05-13T12:00:00Z",
      }],
      reviews: [],
    });

    expect(insights.sentiment.total).toBe(0);
    expect(insights.repeatedLanguage).toEqual([]);
  });

  it("summarizes operational refund notes separately from customer return language", () => {
    const insights = __productPulseDiagnosisTestHooks.buildRefundOperationalInsights({
      soldUnits: 20,
      refundUnits: 5,
      refundRate: 25,
      refundAmount: 250,
      refunds: Array.from({ length: 5 }, (_, index) => ({
        note: index < 3 ? "Refunded because item arrived broken" : "Refunded for damaged quality issue",
        restockType: "NO_RESTOCK",
        quantity: 1,
        amount: 50,
        createdAt: `2026-05-13T12:0${index}:00Z`,
      })),
    });

    expect(insights.highPressure).toBe(true);
    expect(insights.shouldSurface).toBe(true);
    expect(insights.noteCount).toBe(5);
    expect(insights.textSignalCount).toBe(5);
    expect(insights.riskLift).toBeGreaterThan(0);
    expect(insights.repeatedLanguage.map((item) => item.term)).not.toContain("refunded");
    expect(insights.examples[0].text).toContain("arrived broken");
  });

  it("deduplicates repeated refund note examples without changing refund signal counts", () => {
    const insights = __productPulseDiagnosisTestHooks.buildRefundOperationalInsights({
      soldUnits: 20,
      refundUnits: 5,
      refundRate: 25,
      refundAmount: 250,
      refunds: Array.from({ length: 5 }, (_, index) => ({
        note: index < 4 ? "Warehouse refund memo repeated from Shopify" : "Separate refund memo from Shopify",
        restockType: "NO_RESTOCK",
        quantity: 1,
        amount: 50,
        createdAt: `2026-05-13T12:0${index}:00Z`,
      })),
    });

    expect(insights.noteCount).toBe(5);
    expect(insights.textSignalCount).toBe(5);
    expect(insights.examples.filter((example) => example.noteText === "Warehouse refund memo repeated from Shopify")).toHaveLength(1);
    expect(insights.examples.map((example) => example.noteText)).toContain("Separate refund memo from Shopify");
  });

  it("surfaces repeated refund reasons even when Shopify refund notes are empty", () => {
    const insights = __productPulseDiagnosisTestHooks.buildRefundOperationalInsights({
      soldUnits: 24,
      refundUnits: 6,
      refundRate: 25,
      refundAmount: 600,
      refunds: Array.from({ length: 6 }, (_, index) => ({
        note: "",
        restockType: index < 4 ? "NO_RESTOCK" : "RETURN",
        adjustmentReasons: index < 4 ? ["Damage"] : ["Customer request"],
        quantity: 1,
        amount: 100,
        createdAt: `2026-05-13T12:0${index}:00Z`,
      })),
    });

    expect(insights.highPressure).toBe(true);
    expect(insights.noteCount).toBe(0);
    expect(insights.reasonCount).toBeGreaterThanOrEqual(6);
    expect(insights.topReasons.map((item) => item.label)).toContain("Damage");
    expect(insights.examples[0].reasonText).toContain("Damage");
  });

  it("keeps single subjective signals low-confidence while repeated subjective evidence escalates", () => {
    const baseMetrics = {
      soldUnits: 0,
      returnUnits: 0,
      refundUnits: 0,
      refundAmount: 0,
      returnRate: 0,
      refundRate: 0,
      reviewCount: 0,
      avgRating: 0,
      negativeReviewCount: 0,
      negativeReviewRate: 0,
      signalEvents: [],
      affectedVariants: [],
      contentQualityRisk: 0,
      contentIssueCount: 0,
    };
    const oneSubjective = {
      sentiment: { total: 1, negative: 1, negativeRatio: 1 },
      subjectiveNegativity: { count: 1, total: 1, ratio: 1 },
    };
    const repeatedSubjective = {
      sentiment: { total: 5, negative: 5, negativeRatio: 1 },
      subjectiveNegativity: { count: 5, total: 5, ratio: 1 },
    };

    const oneRisk = __productPulseDiagnosisTestHooks.calculateRiskScore({
      snapshot: { metrics: {} },
      metrics: { ...baseMetrics, signalCount: 1, customerSignalCount: 1, textInsights: oneSubjective, sourceCoverage: ["Shopify returns"] },
    });
    const repeatedRisk = __productPulseDiagnosisTestHooks.calculateRiskScore({
      snapshot: { metrics: {} },
      metrics: { ...baseMetrics, signalCount: 5, customerSignalCount: 5, textInsights: repeatedSubjective, sourceCoverage: ["Shopify returns"] },
    });
    const oneConfidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 1,
      sourceCoverage: ["Shopify returns"],
      judgeMeMatchConfidence: 0,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 1,
      mainIssue: "subjective_negative_reaction",
      textInsights: oneSubjective,
    });
    const repeatedConfidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 5,
      sourceCoverage: ["Shopify returns"],
      judgeMeMatchConfidence: 0,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 5,
      mainIssue: "subjective_negative_reaction",
      textInsights: repeatedSubjective,
    });

    expect(oneRisk).toBeLessThan(repeatedRisk);
    expect(oneConfidence).toBeLessThanOrEqual(45);
    expect(repeatedConfidence).toBeGreaterThan(oneConfidence);
  });

  it("reconstructs cumulative product risk history during deterministic diagnosis", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: "Nintendo Switch",
      handle: "nintendo-switch",
      riskScore: 0,
      metrics: {
        storeAvgReturnRate: 4,
        storeAvgRefundRate: 2,
        storeAvgNegativeReviewRate: 12,
      },
    };
    const product = {
      id: snapshot.productGid,
      title: snapshot.productTitle,
      handle: snapshot.handle,
      description: "Nintendo Switch console with Joy-Con controllers, dock, power adapter, and setup guidance included.",
      descriptionHtml: "<p>Nintendo Switch console with Joy-Con controllers, dock, power adapter, and setup guidance included.</p>",
      variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "SWITCH", selectedOptions: [] }],
      options: [],
      tags: [],
      collections: [],
      media: [],
    };

    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: {
        product,
        sales: [
          { id: "sale-1", orderId: "order-1", quantity: 8, amount: 2400, createdAt: daysAgo(42) },
          { id: "sale-2", orderId: "order-2", quantity: 8, amount: 2400, createdAt: daysAgo(28) },
          { id: "sale-3", orderId: "order-3", quantity: 8, amount: 2400, createdAt: daysAgo(14) },
        ],
        returns: [
          { id: "return-1", orderId: "order-1", quantity: 1, reason: "OTHER", reasonNote: "Arrived broken.", createdAt: daysAgo(24), variantTitle: "Default Title" },
          { id: "return-2", orderId: "order-2", quantity: 1, reason: "OTHER", reasonNote: "Poor quality and broken.", createdAt: daysAgo(13), variantTitle: "Default Title" },
          { id: "return-3", orderId: "order-3", quantity: 1, reason: "OTHER", reasonNote: "Defective and disappointed.", createdAt: daysAgo(5), variantTitle: "Default Title" },
        ],
        refunds: [],
        orderAccessDenied: false,
      },
      judgeMeData: {
        connected: true,
        matchConfidence: 1,
        internalProductId: "jm-123",
        reviews: [
          { id: "review-1", rating: 1, title: "Broken", body: "Poor quality and broken.", createdAt: daysAgo(11) },
          { id: "review-2", rating: 2, title: "Disappointed", body: "Defect out of the box.", createdAt: daysAgo(4) },
        ],
      },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 60,
    });

    const history = deterministic.metrics.riskHistory;

    expect(history.length).toBeGreaterThanOrEqual(5);
    expect(history[0].granularity).toBe("weekly");
    expect(history.at(-1).isCurrent).toBe(true);
    expect(history.at(-1).riskScore).toBe(deterministic.riskScore);
    expect(Math.max(...history.map((point) => point.metrics.returnUnits))).toBe(3);
    expect(history.find((point) => point.metrics.returnUnits === 0).riskScore).toBeLessThan(history.at(-1).riskScore);
  });

  it("uses full-window relationship sales to calculate before and after purchase relationships", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sourceProductId = "gid://shopify/Product/rel-source";
    const beforeProductId = "gid://shopify/Product/rel-before";
    const afterProductId = "gid://shopify/Product/rel-after";
    const snapshot = {
      shop: "relationship-test.myshopify.com",
      productGid: sourceProductId,
      productTitle: "REL Source Product",
      handle: "rel-source-product",
      riskScore: 0,
      metrics: {},
    };
    const product = {
      id: sourceProductId,
      title: "REL Source Product",
      handle: "rel-source-product",
      description: "Relationship test source product.",
      descriptionHtml: "<p>Relationship test source product.</p>",
      variants: [{ id: "gid://shopify/ProductVariant/rel-source", title: "Default Title", sku: "REL-SOURCE", selectedOptions: [] }],
      options: [],
      tags: [],
      collections: [],
      media: [],
    };
    const relationshipSales = [
      { type: "sale", id: "before-sale", orderId: "before-order", lineItemId: "before-line", productId: beforeProductId, title: "REL Bought Before", handle: "rel-bought-before", customerKey: "customer-1", customerId: "customer-1", quantity: 1, amount: 35, orderDate: daysAgo(35), createdAt: daysAgo(35) },
      { type: "sale", id: "source-sale", orderId: "source-order", lineItemId: "source-line", productId: sourceProductId, title: "REL Source Product", handle: "rel-source-product", customerKey: "customer-1", customerId: "customer-1", quantity: 1, amount: 50, orderDate: daysAgo(20), createdAt: daysAgo(20) },
      { type: "sale", id: "after-sale", orderId: "after-order", lineItemId: "after-line", productId: afterProductId, title: "REL Bought After", handle: "rel-bought-after", customerKey: "customer-1", customerId: "customer-1", quantity: 1, amount: 42, orderDate: daysAgo(6), createdAt: daysAgo(6) },
      { type: "sale", id: "before-sale-2", orderId: "before-order-2", lineItemId: "before-line-2", productId: beforeProductId, title: "REL Bought Before", handle: "rel-bought-before", customerKey: "customer-2", customerId: "customer-2", quantity: 1, amount: 35, orderDate: daysAgo(34), createdAt: daysAgo(34) },
      { type: "sale", id: "source-sale-2", orderId: "source-order-2", lineItemId: "source-line-2", productId: sourceProductId, title: "REL Source Product", handle: "rel-source-product", customerKey: "customer-2", customerId: "customer-2", quantity: 1, amount: 50, orderDate: daysAgo(19), createdAt: daysAgo(19) },
      { type: "sale", id: "after-sale-2", orderId: "after-order-2", lineItemId: "after-line-2", productId: afterProductId, title: "REL Bought After", handle: "rel-bought-after", customerKey: "customer-2", customerId: "customer-2", quantity: 1, amount: 42, orderDate: daysAgo(5), createdAt: daysAgo(5) },
    ];

    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: {
        product,
        sales: relationshipSales.filter((saleEvent) => saleEvent.productId === sourceProductId),
        relationshipSales,
        returns: [],
        refunds: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 60,
    });

    const summary = deterministic.metrics.productRelationshipIntelligenceSummary;
    expect(summary.top_bought_before.find((item) => item.related_product_id === beforeProductId)).toMatchObject({
      related_product_title: "REL Bought Before",
      related_product_handle: "rel-bought-before",
      relationship_direction: "before",
    });
    expect(summary.top_bought_after.find((item) => item.related_product_id === afterProductId)).toMatchObject({
      related_product_title: "REL Bought After",
      related_product_handle: "rel-bought-after",
      relationship_direction: "after",
    });
  });

  it("builds ProductPulse candidate snapshots for discovered relationship products", () => {
    const payloads = __productPulseDiagnosisTestHooks.buildProductRelationshipCandidateSnapshotPayloads({
      shop: "relationship-test.myshopify.com",
      sourceSnapshot: {
        productGid: "gid://shopify/Product/source",
        productTitle: "Source Product",
      },
      relationshipSummary: {
        top_bought_together: [{
          related_product_id: "gid://shopify/Product/related",
          related_product_title: "Related Shopify Product",
          related_product_handle: "related-shopify-product",
          relationship_type: "same_order",
          relationship_direction: "together",
          time_window: "same_order",
          attach_rate: 0.33,
          lift: 2.4,
          sample_size: 6,
          confidence: 72,
        }],
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      shop: "relationship-test.myshopify.com",
      productGid: "gid://shopify/Product/related",
      productTitle: "Related Shopify Product",
      handle: "related-shopify-product",
      primaryIssue: "Relationship candidate",
      sourceCoverage: ["Shopify orders", "Product relationship intelligence"],
      metrics: {
        relationshipCandidate: true,
        productRelationshipCandidate: {
          sourceProductGid: "gid://shopify/Product/source",
          relationshipDirection: "together",
          attachRate: 0.33,
          lift: 2.4,
          sampleSize: 6,
          confidence: 72,
        },
      },
    });
  });

  it("keeps one isolated customer text as evidence instead of merchant-facing issues", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [{
        reason: "Other reason",
        reasonNote: "Not enough softness for me.",
        customerNote: "",
        createdAt: "2026-05-13T12:00:00Z",
      }],
      reviews: [],
    });
    const deterministic = {
      riskScore: 31,
      confidence: 45,
      mainIssue: "quality_defect",
      issueSignalCounts: { quality_defect: 1 },
      metrics: {
        signalCount: 1,
        customerSignalCount: 1,
        returnUnits: 1,
        refundUnits: 0,
        negativeReviewCount: 0,
        reviewCount: 0,
        textInsights: insights,
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        topReturnReasons: ["Other reason"],
        affectedVariants: [],
        issueSignalTrends: {},
        signalTrend: [],
      },
    };

    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic,
      recommendations: [],
      mainIssue: "quality_defect",
      ai: {
        classification: {
          clusters: [{
            issue_category: "quality_defect",
            human_name: "Insufficient softness",
            summary: "One return note mentions softness.",
            signals: 1,
            source_types: ["shopify_return_note"],
            severity: "medium",
          }],
          granular_findings: [{
            finding: "One customer mentions softness",
            issue_category: "quality_defect",
            signals: 1,
            source_types: ["shopify_return_note"],
            evidence: ["Not enough softness for me."],
          }],
          repeated_language: [{
            term: "softness",
            count: 1,
            source_types: ["shopify_return_note"],
            issue_category: "quality_defect",
          }],
        },
        emergentSentiments: { emergent_sentiments: [] },
      },
    });

    expect(insights.otherReturnClassifications[0]).toMatchObject({ issueCode: "quality_defect", count: 1 });
    expect(insights.granularIssues).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("persists sales, returns, refunds, and review evidence by variant", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = {
      productGid: "gid://shopify/Product/variant-insights",
      productTitle: "GEN Dinner Set",
      handle: "gen-dinner-set",
      riskScore: 0,
      metrics: {},
    };
    const product = {
      id: snapshot.productGid,
      title: snapshot.productTitle,
      handle: snapshot.handle,
      description: "Dinner set available in Aurora Blue and Warm White.",
      variants: [
        { id: "gid://shopify/ProductVariant/blue", title: "Aurora Blue", sku: "GEN-BLUE", price: 118, selectedOptions: [{ name: "Color", value: "Aurora Blue" }] },
        { id: "gid://shopify/ProductVariant/white", title: "Warm White", sku: "GEN-WHITE", price: 112, selectedOptions: [{ name: "Color", value: "Warm White" }] },
      ],
      options: [{ name: "Color" }],
      tags: [],
      collections: [],
      media: [],
    };

    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: {
        product,
        sales: [
          { id: "sale-blue", orderId: "order-blue", quantity: 5, amount: 590, createdAt: daysAgo(20), variantId: "gid://shopify/ProductVariant/blue", variantTitle: "Aurora Blue", sku: "GEN-BLUE", countryCode: "US", provinceCode: "TX", city: "Austin" },
          { id: "sale-white", orderId: "order-white", quantity: 8, amount: 896, createdAt: daysAgo(18), variantId: "gid://shopify/ProductVariant/white", variantTitle: "Warm White", sku: "GEN-WHITE", countryCode: "CA", provinceCode: "ON", city: "Toronto" },
        ],
        returns: [
          { id: "return-blue", quantity: 1, reason: "OTHER", reasonNote: "Aurora Blue color was not as pictured.", createdAt: daysAgo(10), variantId: "gid://shopify/ProductVariant/blue", variantTitle: "Aurora Blue", sku: "GEN-BLUE" },
        ],
        refunds: [
          { id: "refund-blue", quantity: 2, amount: 118, reason: "Not as described", note: "Refund connected to Aurora Blue color mismatch.", createdAt: daysAgo(8), variantId: "gid://shopify/ProductVariant/blue", variantTitle: "Aurora Blue", sku: "GEN-BLUE" },
        ],
        orderAccessDenied: false,
      },
      judgeMeData: {
        connected: true,
        matchConfidence: 1,
        reviews: [
          { id: "review-blue", rating: 2, title: "Aurora Blue looks muted", body: "The Aurora Blue variant looks darker than expected.", createdAt: daysAgo(7) },
          { id: "review-white", rating: 5, title: "Warm White is great", body: "Warm White matched the photos.", createdAt: daysAgo(6) },
        ],
      },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 60,
    });

    const blue = deterministic.metrics.variantInsights.find((item) => item.variantTitle === "Aurora Blue");
    const white = deterministic.metrics.variantInsights.find((item) => item.variantTitle === "Warm White");

    expect(blue).toMatchObject({
      sku: "GEN-BLUE",
      sales: { units: 5, amount: 590 },
      returns: { units: 1 },
      refunds: { units: 2, amount: 118 },
      reviews: { count: 1, negativeCount: 1 },
      signalCount: 4,
    });
    expect(blue.reviews.examples[0]?.text).toContain("Aurora Blue");
    expect(white).toMatchObject({
      sku: "GEN-WHITE",
      sales: { units: 8, amount: 896 },
      returns: { units: 0 },
      refunds: { units: 0, amount: 0 },
      reviews: { count: 1, negativeCount: 0 },
      signalCount: 0,
    });
    expect(deterministic.metrics.affectedVariants).toContain("Aurora Blue");
    expect(deterministic.metrics.orderGeography).toEqual([
      expect.objectContaining({ label: "Canada", count: 1, share: 50 }),
      expect.objectContaining({ label: "Texas, United States", count: 1, share: 50 }),
    ]);
  });

  it("matches reviews to variant values without treating option names as variant evidence", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = {
      productGid: "gid://shopify/Product/variants",
      productTitle: "GEN Buds",
      handle: "gen-buds",
      metrics: {},
    };
    const product = {
      id: snapshot.productGid,
      title: snapshot.productTitle,
      handle: snapshot.handle,
      description: "Wireless earbuds with multiple color variants, charging case, Bluetooth pairing, silicone tips, and product care guidance for daily listening.",
      descriptionHtml: "<p>Wireless earbuds with multiple color variants, charging case, Bluetooth pairing, silicone tips, and product care guidance for daily listening.</p>",
      variants: [
        { id: "gid://shopify/ProductVariant/black", title: "Black", sku: "GEN-BUD-BLK", selectedOptions: [{ name: "Color", value: "Black" }] },
        { id: "gid://shopify/ProductVariant/rose", title: "Rose", sku: "GEN-BUD-ROS", selectedOptions: [{ name: "Color", value: "Rose" }] },
        { id: "gid://shopify/ProductVariant/blue", title: "Blue", sku: "GEN-BUD-BLU", selectedOptions: [{ name: "Color", value: "Blue" }] },
      ],
      options: [{ name: "Color" }],
      tags: [],
      collections: [],
      media: [],
    };

    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: {
        product,
        sales: [],
        returns: [],
        refunds: [],
        orderAccessDenied: false,
      },
      judgeMeData: {
        connected: true,
        matchConfidence: 1,
        reviews: [
          { id: "rose-negative", rating: 1, title: "Rose color mismatch", body: "Rose color does not match the product photos.", createdAt: daysAgo(3) },
          { id: "rose-positive", rating: 5, title: "Rose is perfect", body: "Rose looks beautiful and matches what I expected.", createdAt: daysAgo(2) },
          { id: "black-positive", rating: 5, title: "Black is great", body: "The Black color is perfect and sounds good.", createdAt: daysAgo(1) },
        ],
      },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 60,
    });

    const black = deterministic.metrics.variantInsights.find((item) => item.variantTitle === "Black");
    const rose = deterministic.metrics.variantInsights.find((item) => item.variantTitle === "Rose");
    const blue = deterministic.metrics.variantInsights.find((item) => item.variantTitle === "Blue");

    expect(black.reviews).toMatchObject({ count: 1, negativeCount: 0, positiveCount: 1 });
    expect(rose.reviews).toMatchObject({ count: 2, negativeCount: 1, positiveCount: 1 });
    expect(blue.reviews).toMatchObject({ count: 0, negativeCount: 0, positiveCount: 0 });
    expect(rose.reviews.examples.map((example) => example.sentiment)).toEqual(expect.arrayContaining(["negative", "positive"]));
  });

  it("merges repeated evidence for the same issue into one merchant-facing issue", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [
        {
          reason: "Other reason",
          reasonNote: "Not enough softness for me.",
          customerNote: "",
          createdAt: "2026-05-13T12:00:00Z",
        },
        {
          reason: "Other reason",
          reasonNote: "The fabric lacks softness.",
          customerNote: "",
          createdAt: "2026-05-13T12:10:00Z",
        },
      ],
      reviews: [],
    });
    const deterministic = {
      riskScore: 48,
      confidence: 58,
      mainIssue: "quality_defect",
      issueSignalCounts: { quality_defect: 2 },
      metrics: {
        signalCount: 2,
        customerSignalCount: 2,
        returnUnits: 2,
        refundUnits: 0,
        negativeReviewCount: 0,
        reviewCount: 0,
        textInsights: insights,
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        topReturnReasons: ["Other reason"],
        affectedVariants: [],
        issueSignalTrends: {},
        signalTrend: [],
      },
    };

    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic,
      recommendations: [{ label: "Review text evidence" }],
      mainIssue: "quality_defect",
      ai: {
        classification: {
          clusters: [{
            issue_category: "quality_defect",
            human_name: "Insufficient softness",
            summary: "Two return notes mention softness.",
            signals: 2,
            source_types: ["shopify_return_note"],
            severity: "low",
          }],
          granular_findings: [{
            finding: "Return notes mention insufficient softness",
            issue_category: "quality_defect",
            signals: 2,
            source_types: ["shopify_return_note"],
            evidence: ["Not enough softness for me.", "The fabric lacks softness."],
          }],
          repeated_language: [{
            term: "softness",
            count: 2,
            source_types: ["shopify_return_note"],
            issue_category: "quality_defect",
          }],
        },
        emergentSentiments: { emergent_sentiments: [] },
      },
    });

    expect(insights.granularIssues.length).toBeGreaterThan(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issueCode: "quality_defect",
      signals: 2,
    });
  });

  it("keeps one or two review-only negatives as weak main-finding evidence", () => {
    const weakRelevance = __productPulseDiagnosisTestHooks.buildSignalRelevanceGuidance({
      metrics: {
        negativeReviewCount: 2,
        reviewCount: 12,
        returnUnits: 0,
        refundUnits: 0,
        contentIssueCount: 0,
      },
    });
    const confidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 2,
      sourceCoverage: ["Judge.me reviews"],
      judgeMeMatchConfidence: 1,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 2,
      negativeReviewCount: 2,
      returnUnits: 0,
      refundUnits: 0,
    });

    expect(weakRelevance.reviewSignals.level).toBe("weak");
    expect(weakRelevance.reviewSignals.guidance).toContain("do not lead the main finding");
    expect(confidence).toBeLessThanOrEqual(49);
  });

  it("treats three to four review-only negatives as emerging, not confirmed", () => {
    const emergingRelevance = __productPulseDiagnosisTestHooks.buildSignalRelevanceGuidance({
      metrics: {
        negativeReviewCount: 4,
        reviewCount: 20,
        returnUnits: 0,
        refundUnits: 0,
        contentIssueCount: 0,
      },
    });
    const confidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 4,
      sourceCoverage: ["Judge.me reviews"],
      judgeMeMatchConfidence: 1,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 4,
      negativeReviewCount: 4,
      returnUnits: 0,
      refundUnits: 0,
    });

    expect(emergingRelevance.reviewSignals.level).toBe("emerging");
    expect(confidence).toBeGreaterThanOrEqual(52);
    expect(confidence).toBeLessThanOrEqual(64);
  });

  it("uses imported CSV reviews as deep-diagnosis review evidence", () => {
    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        productGid: "gid://shopify/Product/123",
        productTitle: "Night Watch Print",
        handle: "night-watch-print",
        primaryIssue: "Product quality",
        metrics: {},
      },
      shopifyData: {
        product: {
          id: "gid://shopify/Product/123",
          numericId: "123",
          title: "Night Watch Print",
          handle: "night-watch-print",
          description: "Museum-inspired wall art printed on canvas with a dark palette and framed finish for home decor.",
          variants: [],
          tags: ["art", "canvas"],
          collections: ["Art prints"],
        },
        sales: [],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
      },
      judgeMeData: {
        connected: false,
        reviews: [],
        matchConfidence: 0,
      },
      csvReviewData: {
        connected: true,
        matchConfidence: 0.94,
        reviews: [
          {
            title: "Too unsettling",
            body: "This print scares me and feels too creepy for my wall.",
            rating: 1,
            createdAt: "2026-05-10T12:00:00Z",
            sourceType: "csv_review",
            sourceLabel: "CSV reviews",
          },
          {
            title: "Dark mood",
            body: "The image is scary and darker than expected.",
            rating: 2,
            createdAt: "2026-05-11T12:00:00Z",
            sourceType: "csv_review",
            sourceLabel: "CSV reviews",
          },
          {
            title: "Good print",
            body: "The print quality is good.",
            rating: 5,
            createdAt: "2026-05-12T12:00:00Z",
            sourceType: "csv_review",
            sourceLabel: "CSV reviews",
          },
        ],
      },
    });

    expect(deterministic.metrics.reviewCount).toBe(3);
    expect(deterministic.metrics.csvReviewCount).toBe(3);
    expect(deterministic.metrics.csvNegativeReviewCount).toBe(2);
    expect(deterministic.metrics.csvAverageRating).toBe(2.7);
    expect(deterministic.sourceCoverage).toContain("CSV reviews");
    expect(deterministic.evidenceSnippets.filter((snippet) => snippet.source === "csv_review")).toHaveLength(2);
    expect(deterministic.metrics.textInsights.reviews.sentiment.negative).toBe(2);
    expect(deterministic.metrics.textInsights.reviews.examples[0]).toMatchObject({
      source: "csv_review",
      sourceLabel: "CSV reviews",
    });
  });

  it("reuses cached customer text analysis and only analyzes new text on incremental deep diagnosis", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const product = {
      id: "gid://shopify/Product/123",
      numericId: "123",
      title: "Night Watch Print",
      handle: "night-watch-print",
      updatedAt: daysAgo(10),
      description: "Museum-inspired wall art printed on canvas with a dark palette and framed finish for home decor.",
      variants: [],
      tags: ["art", "canvas"],
      collections: ["Art prints"],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: "Night Watch Print",
      handle: "night-watch-print",
      primaryIssue: "Product quality",
      metrics: {},
    };
    const oldReturn = {
      id: "return-old",
      reason: "OTHER",
      reasonNote: "Scary and unsettling on the wall.",
      quantity: 1,
      createdAt: daysAgo(9),
    };
    const oldReview = {
      id: "review-old",
      title: "Too creepy",
      body: "It feels scary in the room.",
      rating: 1,
      createdAt: daysAgo(8),
    };
    const first = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: { product, sales: [], refunds: [], returns: [oldReturn], orderAccessDenied: false },
      judgeMeData: { connected: true, reviews: [oldReview], matchConfidence: 1 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });
    const cutoff = daysAgo(3);
    const newReturn = {
      id: "return-new",
      reason: "OTHER",
      reasonNote: "The print arrived darker than expected.",
      quantity: 1,
      createdAt: daysAgo(1),
    };
    const newReview = {
      id: "review-new",
      title: "Too dark",
      body: "The image is much darker than expected.",
      rating: 2,
      createdAt: daysAgo(1),
    };

    const second = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        ...snapshot,
        metrics: {
          ...first.metrics,
          lastDetailedDiagnosisAt: cutoff,
        },
      },
      shopifyData: { product, sales: [], refunds: [], returns: [oldReturn, newReturn], orderAccessDenied: false },
      judgeMeData: { connected: true, reviews: [oldReview, newReview], matchConfidence: 1 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });

    expect(second.metrics.incrementalDiagnosis.mode).toBe("incremental");
    expect(second.metrics.incrementalDiagnosis.productContent.reused).toBe(true);
    expect(second.metrics.incrementalDiagnosis.customerText.mode).toBe("incremental");
    expect(second.metrics.incrementalDiagnosis.customerText.reusedItems).toBe(2);
    expect(second.metrics.incrementalDiagnosis.customerText.analyzedItems).toBe(2);
    expect(second.metrics.textInsights.sentiment.total).toBe(4);
    expect(second.metrics.textInsights.returns.total).toBe(2);
    expect(second.metrics.textInsights.reviews.total).toBe(2);
    expect(second.evidenceSnippets.map((snippet) => snippet.text).join(" ")).toContain("darker than expected");
    expect(second.evidenceSnippets.map((snippet) => snippet.text).join(" ")).not.toContain("scary in the room");
  });

  it("marks unchanged cached reviews as reusable without new AI evidence snippets", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const product = {
      id: "gid://shopify/Product/321",
      numericId: "321",
      title: "Canvas Print",
      handle: "canvas-print",
      updatedAt: daysAgo(10),
      description: "Canvas wall art with framed finish.",
      variants: [],
      tags: ["art"],
      collections: ["Art prints"],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/321",
      productTitle: "Canvas Print",
      handle: "canvas-print",
      primaryIssue: "Product quality",
      metrics: {},
    };
    const oldReview = {
      id: "review-old-stable",
      title: "Too dark",
      body: "The image is darker than expected.",
      rating: 2,
      createdAt: daysAgo(8),
    };
    const first = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: { product, sales: [], refunds: [], returns: [], orderAccessDenied: false },
      judgeMeData: { connected: true, reviews: [oldReview], matchConfidence: 1 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });

    const second = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        ...snapshot,
        riskScore: first.riskScore,
        confidence: first.confidence,
        metrics: {
          ...first.metrics,
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: daysAgo(3),
        },
      },
      shopifyData: { product, sales: [], refunds: [], returns: [], orderAccessDenied: false },
      judgeMeData: { connected: true, reviews: [oldReview], matchConfidence: 1 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });
    const reuseDecision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        ...snapshot,
        riskScore: first.riskScore,
        confidence: first.confidence,
        metrics: {
          ...first.metrics,
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: daysAgo(3),
        },
      },
      deterministic: second,
    });

    expect(second.metrics.incrementalDiagnosis.customerText.mode).toBe("incremental");
    expect(second.metrics.incrementalDiagnosis.customerText.analyzedItems).toBe(0);
    expect(second.metrics.incrementalDiagnosis.aiEvidenceSnippetCount).toBe(0);
    expect(reuseDecision.shouldReuse).toBe(true);
  });

  it("stores and merges Shopify source events so incremental fetches do not refetch the full window", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = {
      productGid: "gid://shopify/Product/987",
      productTitle: "Canvas Print",
      handle: "canvas-print",
      metrics: {},
    };
    const product = {
      id: snapshot.productGid,
      title: snapshot.productTitle,
      handle: snapshot.handle,
      updatedAt: daysAgo(20),
      description: "Framed canvas print with included hanging hardware.",
      variants: [],
      tags: ["art"],
      collections: ["Prints"],
    };
    const oldSale = {
      id: "sale-old",
      orderId: "order-old",
      createdAt: daysAgo(12),
      quantity: 1,
      amount: 100,
    };
    const oldReturn = {
      id: "return-old",
      returnId: "return-1",
      orderId: "order-old",
      createdAt: daysAgo(11),
      quantity: 1,
      reason: "OTHER",
      reasonNote: "Looked darker than expected.",
    };
    const first = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: { product, sales: [oldSale], refunds: [], returns: [oldReturn], orderAccessDenied: false },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });
    const cutoff = daysAgo(3);
    const context = __productPulseDiagnosisTestHooks.getIncrementalSourceFetchContext({
      snapshot: {
        ...snapshot,
        metrics: {
          ...first.metrics,
          lastDetailedDiagnosisAt: cutoff,
          incrementalDiagnosis: {
            ...first.metrics.incrementalDiagnosis,
            cache: {
              ...first.metrics.incrementalDiagnosis.cache,
              sourceEvents: {
                ...first.metrics.incrementalDiagnosis.cache.sourceEvents,
                cachedAt: cutoff,
                fetchedThroughAt: cutoff,
              },
            },
          },
        },
      },
      windowDays: 30,
    });
    const updatedOldSale = {
      ...oldSale,
      quantity: 2,
      amount: 200,
    };
    const newSale = {
      id: "sale-new",
      orderId: "order-new",
      createdAt: daysAgo(1),
      quantity: 1,
      amount: 120,
    };

    const merged = __productPulseDiagnosisTestHooks.mergeIncrementalSourceEvents({
      previous: context.previousSourceEvents,
      current: { sales: [updatedOldSale, newSale], refunds: [], returns: [] },
      windowDays: 30,
    });

    expect(first.metrics.incrementalDiagnosis.cache.sourceEvents.sales).toHaveLength(1);
    expect(first.metrics.incrementalDiagnosis.cache.sourceEvents.returns).toHaveLength(1);
    expect(context.shopifyCanReuse).toBe(true);
    expect(context.sinceDate).toBe(cutoff.slice(0, 10));
    expect(merged.sales).toHaveLength(2);
    expect(merged.sales.find((item) => item.id === "sale-old").quantity).toBe(2);
    expect(merged.returns).toHaveLength(1);
  });

  it("reuses product content analysis until Shopify product content changes", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = {
      productGid: "gid://shopify/Product/321",
      productTitle: "Compact Desk Lamp",
      handle: "compact-desk-lamp",
      primaryIssue: "Product content",
      metrics: {},
    };
    const product = {
      id: snapshot.productGid,
      numericId: "321",
      title: snapshot.productTitle,
      handle: snapshot.handle,
      updatedAt: daysAgo(12),
      description: "Small lamp.",
      variants: [],
      tags: ["lamp"],
      collections: ["Lighting"],
    };
    const first = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot,
      shopifyData: { product, sales: [], refunds: [], returns: [], orderAccessDenied: false },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });
    const cutoff = daysAgo(3);
    const unchanged = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        ...snapshot,
        metrics: {
          ...first.metrics,
          lastDetailedDiagnosisAt: cutoff,
        },
      },
      shopifyData: { product, sales: [], refunds: [], returns: [], orderAccessDenied: false },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });
    const changed = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        ...snapshot,
        metrics: {
          ...first.metrics,
          lastDetailedDiagnosisAt: cutoff,
        },
      },
      shopifyData: {
        product: {
          ...product,
          updatedAt: daysAgo(1),
          description: "Compact desk lamp with adjustable brightness, USB power, warm light mode, included cable, and clear dimensions for bedside or office use.",
        },
        sales: [],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });

    expect(unchanged.metrics.incrementalDiagnosis.productContent.reused).toBe(true);
    expect(unchanged.metrics.descriptionWordCount).toBe(first.metrics.descriptionWordCount);
    expect(changed.metrics.incrementalDiagnosis.productContent.reused).toBe(false);
    expect(changed.metrics.descriptionWordCount).toBeGreaterThan(first.metrics.descriptionWordCount);
  });

  it("identifies unchanged incremental diagnoses as reusable without AI", () => {
    const fingerprint = __productPulseDiagnosisTestHooks.buildDiagnosisSourceFingerprint({
      productContentSignature: "product-signature-1",
      sales: [{ id: "sale-1", quantity: 2, amount: 80, createdAt: "2026-05-01T12:00:00.000Z" }],
      returns: [{ id: "return-1", quantity: 1, reason: "OTHER", reasonNote: "Too dark", createdAt: "2026-05-03T12:00:00.000Z" }],
      refunds: [],
      judgeMeReviews: [{ id: "review-1", rating: 2, body: "Too dark", createdAt: "2026-05-04T12:00:00.000Z" }],
      csvReviews: [],
      sourceCoverage: ["Shopify product", "Shopify returns", "Judge.me reviews"],
      windowDays: 60,
    });
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      riskScore: 62,
      confidence: 65,
      metrics: {
        latestDiagnosisId: "diagnosis-1",
        lastDetailedDiagnosisAt: "2026-05-10T12:00:00.000Z",
        soldUnits: 2,
        returnUnits: 1,
        refundUnits: 0,
        reviewCount: 1,
        negativeReviewCount: 1,
        signalCount: 3,
        riskScore: 62,
        confidence: 65,
        estimatedImpact: 120,
      },
    };
    const deterministic = {
      riskScore: 62,
      confidence: 65,
      estimatedImpact: { estimatedImpact: 120, revenueAtRisk: 260, marginAtRisk: 120 },
      evidenceSnippets: [],
      metrics: {
        soldUnits: 2,
        returnUnits: 1,
        refundUnits: 0,
        reviewCount: 1,
        negativeReviewCount: 1,
        signalCount: 3,
        riskScore: 62,
        confidence: 65,
        estimatedImpact: 120,
        incrementalDiagnosis: {
          productContent: { reused: true },
          customerText: { mode: "incremental", analyzedItems: 0, reusedItems: 2 },
          refunds: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
          sourceChanges: {
            previousFingerprint: fingerprint,
            currentFingerprint: fingerprint,
            unchanged: true,
          },
          aiEvidenceSnippetCount: 0,
        },
      },
    };

    const decision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({ snapshot, deterministic });

    expect(decision.shouldReuse).toBe(true);
    expect(decision.matchedBy).toBe("source_fingerprint");
  });

  it("does not reuse cached diagnosis when source fingerprints changed", () => {
    const previousFingerprint = __productPulseDiagnosisTestHooks.buildDiagnosisSourceFingerprint({
      productContentSignature: "product-signature-1",
      sales: [{ id: "sale-1", quantity: 2, amount: 80, createdAt: "2026-05-01T12:00:00.000Z" }],
      sourceCoverage: ["Shopify product", "Shopify orders"],
      windowDays: 60,
    });
    const currentFingerprint = __productPulseDiagnosisTestHooks.buildDiagnosisSourceFingerprint({
      productContentSignature: "product-signature-1",
      sales: [{ id: "sale-1", quantity: 3, amount: 120, createdAt: "2026-05-01T12:00:00.000Z" }],
      sourceCoverage: ["Shopify product", "Shopify orders"],
      windowDays: 60,
    });
    const decision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        metrics: {
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: "2026-05-10T12:00:00.000Z",
        },
      },
      deterministic: {
        evidenceSnippets: [],
        metrics: {
          incrementalDiagnosis: {
            productContent: { reused: true },
            customerText: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            refunds: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            sourceChanges: {
              previousFingerprint,
              currentFingerprint,
              unchanged: false,
            },
            aiEvidenceSnippetCount: 0,
          },
        },
      },
    });

    expect(decision.shouldReuse).toBe(false);
    expect(decision.blockers).toContain("source_or_material_metrics_changed");
  });

  it("does not reuse cached diagnosis when incremental Shopify source extraction was incomplete", () => {
    const decision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        metrics: {
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: "2026-05-10T12:00:00.000Z",
        },
      },
      deterministic: {
        evidenceSnippets: [],
        metrics: {
          incrementalDiagnosis: {
            productContent: { reused: true },
            customerText: { mode: "incremental", analyzedItems: 0, reusedItems: 2 },
            refunds: { mode: "incremental", analyzedItems: 0, reusedItems: 1 },
            sourceChanges: {
              previousFingerprint: "fingerprint",
              currentFingerprint: "fingerprint",
              unchanged: true,
              sourceExtractionComplete: false,
            },
            aiEvidenceSnippetCount: 0,
          },
        },
      },
    });

    expect(decision.shouldReuse).toBe(false);
    expect(decision.blockers).toContain("source_extraction_incomplete");
  });

  it("builds monthly Shopify order activity by original order month", () => {
    const activity = __productPulseDiagnosisTestHooks.buildMonthlyOrderActivity({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 120,
      sales: [
        {
          id: "line-1",
          orderId: "order-jan",
          createdAt: "2026-01-20T10:00:00.000Z",
          quantity: 2,
          amount: 200,
        },
        {
          id: "line-2",
          orderId: "order-feb",
          createdAt: "2026-02-15T10:00:00.000Z",
          quantity: 1,
          amount: 120,
        },
      ],
      returns: [
        {
          id: "return-1",
          orderId: "order-jan",
          createdAt: "2026-03-05T10:00:00.000Z",
          quantity: 1,
        },
      ],
      refunds: [
        {
          id: "refund-1",
          orderId: "order-feb",
          createdAt: "2026-04-05T10:00:00.000Z",
          quantity: 1,
          amount: 120,
        },
      ],
    });

    const january = activity.months.find((month) => month.key === "2026-01");
    const february = activity.months.find((month) => month.key === "2026-02");

    expect(january).toMatchObject({
      orders: 1,
      orderUnits: 2,
      returnedOrders: 1,
      returnedUnits: 1,
      returnRate: 50,
    });
    expect(february).toMatchObject({
      orders: 1,
      refundedOrders: 1,
      refundedUnits: 1,
      refundAmount: 120,
      refundRate: 100,
    });
    expect(activity.summary).toMatchObject({
      totalOrders: 2,
      totalReturnedOrders: 1,
      totalRefundedOrders: 1,
      totalRefundAmount: 120,
      returnRate: 33.33,
      refundRate: 33.33,
    });
  });

  it("uses Shopify order date for monthly activity when returns and refunds are captured later", () => {
    const activity = __productPulseDiagnosisTestHooks.buildMonthlyOrderActivity({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 180,
      sales: [],
      returns: [
        {
          id: "return-1",
          orderId: "order-jan",
          orderDate: "2026-01-20T10:00:00.000Z",
          createdAt: "2026-05-05T10:00:00.000Z",
          quantity: 1,
        },
      ],
      refunds: [
        {
          id: "refund-1",
          orderId: "order-feb",
          orderDate: "2026-02-15T10:00:00.000Z",
          processedAt: "2026-05-06T10:00:00.000Z",
          quantity: 1,
          amount: 120,
        },
      ],
    });

    const january = activity.months.find((month) => month.key === "2026-01");
    const february = activity.months.find((month) => month.key === "2026-02");
    const may = activity.months.find((month) => month.key === "2026-05");

    expect(january).toMatchObject({ orders: 1, returnedOrders: 1, returnedUnits: 1 });
    expect(february).toMatchObject({ orders: 1, refundedOrders: 1, refundedUnits: 1, refundAmount: 120 });
    expect(may).toMatchObject({ orders: 0, returnedOrders: 0, refundedOrders: 0 });
  });

  it("counts return-only Shopify events as order activity for rate denominators", () => {
    const activity = __productPulseDiagnosisTestHooks.buildMonthlyOrderActivity({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 60,
      sales: [],
      returns: [
        { id: "return-1", orderId: "order-1", createdAt: "2026-05-01T10:00:00.000Z", quantity: 1 },
        { id: "return-2", orderId: "order-2", createdAt: "2026-05-02T10:00:00.000Z", quantity: 1 },
        { id: "return-3", orderId: "order-3", createdAt: "2026-05-03T10:00:00.000Z", quantity: 1 },
      ],
      refunds: [],
    });

    const may = activity.months.find((month) => month.key === "2026-05");

    expect(may).toMatchObject({
      orders: 3,
      orderUnits: 3,
      returnedOrders: 3,
      returnedUnits: 3,
      returnRate: 100,
    });
    expect(activity.summary).toMatchObject({
      totalOrders: 3,
      totalOrderUnits: 3,
      totalReturnedOrders: 3,
      totalReturnedUnits: 3,
      returnRate: 100,
    });
  });

  it("builds weekly return-rate prediction with a three-month forecast", () => {
    const prediction = __productPulseDiagnosisTestHooks.buildReturnRatePrediction({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 90,
      sales: [
        { id: "line-1", orderId: "order-1", createdAt: "2026-03-03T10:00:00.000Z", quantity: 1, amount: 100 },
        { id: "line-2", orderId: "order-2", createdAt: "2026-03-10T10:00:00.000Z", quantity: 1, amount: 100 },
        { id: "line-3", orderId: "order-3", createdAt: "2026-04-07T10:00:00.000Z", quantity: 1, amount: 100 },
        { id: "line-4", orderId: "order-4", createdAt: "2026-04-14T10:00:00.000Z", quantity: 1, amount: 100 },
        { id: "line-5", orderId: "order-5", createdAt: "2026-05-05T10:00:00.000Z", quantity: 1, amount: 100 },
      ],
      returns: [
        { id: "return-1", orderId: "order-1", createdAt: "2026-04-01T10:00:00.000Z", quantity: 1 },
        { id: "return-2", orderId: "order-4", createdAt: "2026-05-01T10:00:00.000Z", quantity: 1 },
      ],
    });

    expect(prediction.granularity).toBe("weekly");
    expect(prediction.summary.totalOrders).toBe(5);
    expect(prediction.summary.totalReturnedOrders).toBe(2);
    expect(prediction.summary.totalReturnRate).toBe(40);
    expect(prediction.summary.last60DayReturnRate).toBeGreaterThan(0);
    expect(prediction.forecastPoints).toHaveLength(13);
    expect(prediction.forecastPoints[0]).toMatchObject({ kind: "forecast" });
    expect(prediction.forecastPoints.every((point) => point.predictedReturnRate >= 0 && point.predictedReturnRate <= 100)).toBe(true);
  });

  it("uses Shopify order date for return-rate prediction cohorts when return capture is later", () => {
    const prediction = __productPulseDiagnosisTestHooks.buildReturnRatePrediction({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 90,
      sales: [],
      returns: [
        {
          id: "return-1",
          orderId: "order-mar",
          orderDate: "2026-03-03T10:00:00.000Z",
          createdAt: "2026-05-06T10:00:00.000Z",
          quantity: 1,
        },
      ],
    });

    const marchWeek = prediction.observedPoints.find((point) => point.key === "2026-03-02");
    const mayWeek = prediction.observedPoints.find((point) => point.key === "2026-05-04");

    expect(marchWeek).toMatchObject({ orders: 1, returnedOrders: 1, returnedUnits: 1 });
    expect(mayWeek).toMatchObject({ orders: 0, returnedOrders: 0 });
  });

  it("keeps the return-rate forecast stable when recent return behavior is flat", () => {
    const sales = [];
    const returns = [];
    const weekStarts = ["2026-03-30", "2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27", "2026-05-04"];

    weekStarts.forEach((weekStart, weekIndex) => {
      for (let orderIndex = 0; orderIndex < 10; orderIndex += 1) {
        const orderId = `flat-order-${weekIndex}-${orderIndex}`;
        sales.push({
          id: `line-${orderId}`,
          orderId,
          createdAt: `${weekStart}T10:00:00.000Z`,
          quantity: 1,
          amount: 100,
        });
      }
      returns.push({
        id: `return-${weekIndex}`,
        orderId: `flat-order-${weekIndex}-0`,
        createdAt: `${weekStart}T12:00:00.000Z`,
        quantity: 1,
      });
    });

    const prediction = __productPulseDiagnosisTestHooks.buildReturnRatePrediction({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 90,
      sales,
      returns,
    });
    const currentRate = prediction.observedPoints.at(-1).smoothedReturnRate;
    const maxForecastRate = Math.max(...prediction.forecastPoints.map((point) => point.predictedReturnRate));

    expect(prediction.summary.totalReturnRate).toBe(10);
    expect(maxForecastRate).toBeLessThanOrEqual(currentRate + 2);
  });

  it("builds return-rate forecasts when only Shopify returns were captured", () => {
    const prediction = __productPulseDiagnosisTestHooks.buildReturnRatePrediction({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 60,
      sales: [],
      returns: [
        { id: "return-1", orderId: "order-1", createdAt: "2026-05-01T10:00:00.000Z", quantity: 1 },
        { id: "return-2", orderId: "order-2", createdAt: "2026-05-02T10:00:00.000Z", quantity: 1 },
        { id: "return-3", orderId: "order-3", createdAt: "2026-05-03T10:00:00.000Z", quantity: 1 },
      ],
    });

    expect(prediction.summary.totalOrders).toBe(3);
    expect(prediction.summary.totalOrderUnits).toBe(3);
    expect(prediction.summary.totalReturnedOrders).toBe(3);
    expect(prediction.summary.totalReturnedUnits).toBe(3);
    expect(prediction.summary.totalReturnRate).toBe(100);
    expect(prediction.summary.forecastWeeks).toBe(13);
    expect(prediction.forecastPoints).toHaveLength(13);
    expect(prediction.forecastPoints.every((point) => point.predictedReturnRate >= 0 && point.predictedReturnRate <= 100)).toBe(true);
  });

  it("uses refund-only Shopify events as denominator evidence without counting them as returns", () => {
    const prediction = __productPulseDiagnosisTestHooks.buildReturnRatePrediction({
      now: "2026-05-16T12:00:00.000Z",
      windowDays: 60,
      sales: [
        { id: "line-1", orderId: "order-1", createdAt: "2026-05-01T10:00:00.000Z", quantity: 10, amount: 480 },
      ],
      returns: [
        { id: "return-1", orderId: "order-1", createdAt: "2026-05-02T10:00:00.000Z", quantity: 6 },
      ],
      refunds: [
        { id: "refund-1", orderId: "order-3", createdAt: "2026-05-03T10:00:00.000Z", quantity: 1, amount: 48 },
      ],
    });

    expect(prediction.summary.totalOrderUnits).toBe(11);
    expect(prediction.summary.totalReturnedUnits).toBe(6);
    expect(prediction.summary.totalReturnRate).toBeCloseTo(54.55, 2);
    expect(prediction.forecastPoints.every((point) => point.predictedReturnRate >= 0 && point.predictedReturnRate <= 100)).toBe(true);
  });

  it("matches CSV reviews by Shopify numeric ID or product handle", () => {
    const snapshot = {
      productGid: "gid://shopify/Product/98765",
      productTitle: "Numeric ID Match",
      handle: "numeric-id-match",
    };
    const product = {
      id: "gid://shopify/Product/98765",
      numericId: "98765",
      handle: "numeric-id-match",
      title: "Numeric ID Match",
    };

    expect(__productPulseDiagnosisTestHooks.getCsvReviewMatchConfidence({ shopifyProductId: "98765" }, snapshot, product)).toBe(1);
    expect(__productPulseDiagnosisTestHooks.getCsvReviewMatchConfidence({ productHandle: "numeric-id-match" }, snapshot, product)).toBeGreaterThanOrEqual(0.9);
    expect(__productPulseDiagnosisTestHooks.getCsvReviewMatchConfidence({ productHandle: "other-product" }, snapshot, product)).toBe(0);
  });

  it("does not turn normal product metadata coverage gaps into main content issues", () => {
    const analysis = __productPulseDiagnosisTestHooks.analyzeProductContentDeterministically({
      title: "Core Linen Trouser",
      description: "A breathable linen trouser with a relaxed leg, elastic waist, practical side pockets, and a lightweight everyday fit for warm weather travel, weekends, and casual office styling.",
      productType: "Pants",
      tags: ["summer", "linen", "casual", "relaxed"],
      collections: ["Vacation edit"],
    });

    expect(analysis.issues.map((issue) => issue.code)).not.toContain("title_description_mismatch");
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("missing_product_type_context");
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("tag_description_mismatch");
    expect(analysis.riskLift).toBe(0);
    expect(analysis.advisories.length).toBeGreaterThanOrEqual(1);
  });

  it("uses Shopify plain description before HTML and cleans HTML when only descriptionHtml is available", () => {
    expect(__productPulseDiagnosisTestHooks.cleanProductDescription({
      description: "Clean Shopify description text.",
      descriptionHtml: "<p>HTML fallback should not win.</p>",
    })).toBe("Clean Shopify description text.");

    expect(__productPulseDiagnosisTestHooks.cleanProductDescription({
      description: "",
      descriptionHtml: "<section><p>Canvas print&nbsp;with <strong>framed finish</strong>.</p><script>bad()</script></section>",
    })).toBe("Canvas print with framed finish.");
  });

  it("counts product description words from cleaned HTML in content analysis", () => {
    const analysis = __productPulseDiagnosisTestHooks.analyzeProductContentDeterministically({
      title: "Rembrandt Night Watch Canvas Print",
      descriptionHtml: "<p>Museum-inspired wall art printed on canvas with a dark palette and framed finish for home decor.</p><p>Includes hanging hardware and clear sizing details for gallery walls.</p>",
      productType: "Wall art",
      tags: ["canvas", "art", "rembrandt"],
      collections: ["Art prints"],
    });

    expect(analysis.hasDescription).toBe(true);
    expect(analysis.descriptionWordCount).toBeGreaterThan(20);
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("missing_description");
  });

  it("caps content quality for thin descriptions even when AI scoring is optimistic", () => {
    const analysis = __productPulseDiagnosisTestHooks.buildContentAnalysis({
      metrics: {
        contentIssues: [],
        contentAdvisories: [],
        contentQualityScore: 100,
        contentQualityRisk: 0,
        descriptionWordCount: 26,
      },
    }, {
      content_quality_score: 84,
      content_summary: "The description is coherent but compact.",
      content_issues: [],
    });

    expect(analysis.score).toBeLessThanOrEqual(72);
    expect(analysis.riskLift).toBeGreaterThanOrEqual(5);
    expect(analysis.advisories.map((advisory) => advisory.code)).toContain("thin_description");
  });

  it("only recommends a full description rewrite for missing, short or clearly broken descriptions", () => {
    const contentIssues = [{
      code: "missing_specifications",
      label: "Missing product specifications",
      severity: "medium",
      evidence: "Add care and material details.",
    }];
    const goodDescription = "A breathable linen trouser with a relaxed leg, elastic waist, practical side pockets, and a lightweight everyday fit for warm weather travel, weekends, and casual office styling.";

    expect(__productPulseDiagnosisTestHooks.shouldRecommendFullDescriptionRewrite({
      contentIssues,
      currentDescription: goodDescription,
    })).toBe(false);
    expect(__productPulseDiagnosisTestHooks.shouldRecommendFullDescriptionRewrite({
      contentIssues: [{ code: "short_description", severity: "medium" }],
      currentDescription: "Short linen pants.",
    })).toBe(true);
    expect(__productPulseDiagnosisTestHooks.shouldRecommendFullDescriptionRewrite({
      contentIssues: [{ code: "title_description_mismatch", severity: "high", evidence: "Clearly disconnected from the title." }],
      currentDescription: goodDescription,
    })).toBe(true);
    expect(__productPulseDiagnosisTestHooks.shouldRecommendFullDescriptionRewrite({
      contentIssues: [{ code: "title_description_mismatch", severity: "high", evidence: "The title and description may be slightly mismatched." }],
      currentDescription: goodDescription,
    })).toBe(false);
  });

  it("flags variant color contradictions as targeted content corrections, not full rewrites", () => {
    const analysis = __productPulseDiagnosisTestHooks.analyzeProductContentDeterministically({
      title: "Vans SK8-Hi",
      description: "The Vans SK8-Hi in True White delivers a classic high-top look for everyday wear with a padded collar, durable canvas and suede upper, lace-up closure, reinforced toe cap, and signature waffle outsole.",
      productType: "Shoes",
      options: [{ name: "Color", values: ["Black"] }],
      variants: [{
        title: "Black",
        selectedOptions: [{ name: "Color", value: "Black" }],
      }],
    });
    const mismatch = analysis.issues.find((issue) => issue.code === "description_variant_mismatch");

    expect(mismatch).toBeTruthy();
    expect(mismatch.evidence).toContain("True White");
    expect(mismatch.evidence).toContain("Black");
    expect(mismatch.replacements).toEqual([expect.objectContaining({ from: "True White", to: "Black" })]);
    expect(__productPulseDiagnosisTestHooks.shouldRecommendFullDescriptionRewrite({
      contentIssues: analysis.issues,
      currentDescription: "The Vans SK8-Hi in True White delivers a classic high-top look for everyday wear with a padded collar, durable canvas and suede upper, lace-up closure, reinforced toe cap, and signature waffle outsole.",
    })).toBe(false);
  });

  it("surfaces title and description mismatch as a semantic advisory when product categories are clearly disconnected", () => {
    const connected = __productPulseDiagnosisTestHooks.analyzeProductContentDeterministically({
      title: "Rembrandt Night Watch Canvas Print",
      description: "Museum-inspired wall art printed on canvas with a dark palette and framed finish for a living room or gallery wall.",
      productType: "Wall art",
      tags: ["canvas", "art", "rembrandt"],
      collections: ["Art prints"],
    });
    const disconnected = __productPulseDiagnosisTestHooks.analyzeProductContentDeterministically({
      title: "Core Linen Trouser",
      description: "A wireless Bluetooth speaker with long battery life, charging cable, and portable audio controls for outdoor listening.",
      productType: "Pants",
      tags: ["linen", "apparel"],
      collections: ["Clothing"],
    });

    expect(connected.issues.map((issue) => issue.code)).not.toContain("title_description_mismatch");
    expect(disconnected.issues.map((issue) => issue.code)).not.toContain("title_description_mismatch");
    expect(disconnected.advisories.map((advisory) => advisory.code)).toContain("title_description_mismatch");
  });

  it("recommends product FAQs only when buyer uncertainty has enough evidence", () => {
    const supported = __productPulseDiagnosisTestHooks.analyzeFaqOpportunity({
      mainIssue: "compatibility",
      issueSignalCounts: { compatibility: 3 },
      contentAnalysis: { issues: [] },
      textInsights: {
        emotions: [{ code: "confusion", count: 2 }],
        repeatedLanguage: [{ term: "compatible filters", count: 2, sources: ["csv_review"] }],
      },
      topReturnReasons: [],
      affectedVariants: [],
      reviewCount: 5,
      negativeReviewCount: 3,
      returnUnits: 0,
      refundUnits: 0,
    });
    const isolated = __productPulseDiagnosisTestHooks.analyzeFaqOpportunity({
      mainIssue: "compatibility",
      issueSignalCounts: { compatibility: 1 },
      contentAnalysis: { issues: [] },
      textInsights: { emotions: [], repeatedLanguage: [] },
      reviewCount: 1,
      negativeReviewCount: 1,
      returnUnits: 0,
      refundUnits: 0,
    });
    const contentOnly = __productPulseDiagnosisTestHooks.analyzeFaqOpportunity({
      mainIssue: "product_content",
      issueSignalCounts: { product_content: 1 },
      contentAnalysis: { issues: [{ code: "short_description", label: "Short description" }] },
      textInsights: { emotions: [], repeatedLanguage: [] },
      reviewCount: 8,
      negativeReviewCount: 0,
      returnUnits: 0,
      refundUnits: 0,
    });

    expect(supported.shouldRecommend).toBe(true);
    expect(supported.topics).toContain("Compatibility");
    expect(isolated.shouldRecommend).toBe(false);
    expect(contentOnly.shouldRecommend).toBe(false);
  });

  it("builds FAQ recommendations with application options and AI-generated items", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 4 },
      product: {
        title: "Core Linen Trouser",
        description: "A breathable linen trouser for warm weather.",
      },
      metrics: {
        faqNeed: {
          shouldRecommend: true,
          score: 6,
          signals: 4,
          topics: ["Fit and sizing"],
          reasons: ["Fit and sizing signals repeat enough to answer before purchase."],
          sourceTypes: ["Issue signals"],
        },
        topReturnReasons: ["Too small"],
        affectedVariants: [],
        returnUnits: 2,
        refundUnits: 0,
        negativeReviewCount: 2,
        contentIssueCount: 0,
        signalCount: 4,
        customerSignalCount: 4,
        textInsights: {},
        contentAnalysis: { issues: [] },
      },
    };
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/1",
        productTitle: "Core Linen Trouser",
      },
      deterministic,
      mainIssue: "fit_sizing",
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: "Fit note: shoppers should check measurements.",
            faq_items: [{
              question: "How does this trouser fit?",
              answer: "It may feel closer around the waist; check measurements before purchase.",
              reason: "Fit signals repeated.",
            }],
          },
        },
        actionRationales: {
          action_rationales: [{
            action_id: "create-product-faq",
            rationale: "Returns and negative reviews repeat fit uncertainty, so an FAQ gives shoppers a direct answer before checkout.",
          }],
        },
      },
    });

    const faq = recommendations.find((item) => item.id === "create-product-faq");
    expect(faq).toBeTruthy();
    expect(faq.payload.faqItems[0]).toMatchObject({
      question: "How does this trouser fit?",
      answer: "It may feel closer around the waist; check measurements before purchase.",
    });
    expect(faq.payload.applicationOptions.map((item) => item.id)).toEqual([
      "description-section",
      "description-collapsible",
      "description-modal",
      "metafield-html",
    ]);
    expect(faq.payload.metafield).toMatchObject({
      namespace: "productpulse",
      key: "faq_html",
      type: "multi_line_text_field",
    });
    expect(faq.payload.whyThisAction).toBe("Returns and negative reviews repeat fit uncertainty, so an FAQ gives shoppers a direct answer before checkout.");
  });

  it("does not create duplicate description actions from the same cause and copy", () => {
    const repeatedNote = "Please note: This reproduction uses dramatic lighting and a dark visual tone that can feel intense in a room.";
    const deterministic = {
      mainIssue: "subjective_negative_reaction",
      issueSignalCounts: { subjective_negative_reaction: 4 },
      product: {
        title: "The Night Watch",
        description: "Completed in 1642, this famous artwork reproduction depicts a city guard moving out.",
      },
      metrics: {
        customerSignalCount: 4,
        signalCount: 4,
        returnUnits: 3,
        negativeReviewCount: 2,
        topReturnReasons: ["Other"],
        textInsights: {
          subjectiveNegativity: { count: 4, ratio: 0.5 },
        },
        contentIssueCount: 2,
        contentAnalysis: {
          issues: [
            { code: "missing_physical_specs", label: "Missing physical specifications", severity: "medium", evidence: "Dimensions are not clear." },
            { code: "unclear_product_format", label: "Unclear product format", severity: "medium", evidence: "The description does not clarify format." },
          ],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/1",
        productTitle: "The Night Watch",
      },
      deterministic,
      mainIssue: "subjective_negative_reaction",
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: repeatedNote,
            product_description: repeatedNote,
          },
        },
      },
    });

    expect(recommendations.map((item) => item.id)).toContain("draft-subjective-expectation-note");
    expect(recommendations.map((item) => item.id)).not.toContain("add-product-description-guidance");
  });

  it("prioritizes source integrity over customer-facing edits when review evidence is mismatched", () => {
    const deterministic = {
      mainIssue: "review_feed_integrity",
      riskScore: 53,
      confidence: 80,
      evidenceSnippets: [
        { text: "This review seems attached to the wrong product and mentions snowboard bindings." },
        { text: "Feed mismatch: customer talks about boots, not the fan." },
      ],
      issueSignalCounts: { fit_sizing: 12, review_feed_integrity: 12 },
      product: {
        title: "GEN QuietDesk Mini Fan",
        description: "Quiet airflow for desks and bedside tables. Includes USB cable.",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "White", sku: "GEN-FAN-WHT" },
          { id: "gid://shopify/ProductVariant/2", title: "Graphite", sku: "GEN-FAN-GPH" },
        ],
      },
      metrics: {
        customerSignalCount: 30,
        signalCount: 33,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 12,
        faqNeed: {
          shouldRecommend: true,
          topics: ["Fit and sizing"],
          reasons: ["Mismatched snowboard reviews mention bindings and boots."],
        },
        contentIssueCount: 1,
        contentAnalysis: {
          issues: [{ code: "incoherent_copy", label: "Review feed metadata mismatch", severity: "high", evidence: "Reviews mention snowboards and boots for a desk fan." }],
          advisories: [],
        },
        textInsights: {
          repeatedLanguage: [
            { term: "snowboard", count: 6 },
            { term: "boots", count: 4 },
          ],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/1",
        productTitle: "GEN QuietDesk Mini Fan",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: "Add sizing guidance for snowboard boots.",
            product_description: "Rewrite the fan page around snowboard boot sizing.",
          },
        },
      },
    });

    expect(recommendations[0]?.id).toBe("fix-source-review-mismatch");
    expect(recommendations.map((item) => item.id)).not.toContain("create-product-faq");
    expect(recommendations.map((item) => item.id)).not.toContain("rewrite-product-description");
    expect(recommendations.map((item) => item.id)).not.toContain("draft-fit-note");
  });

  it("keeps source mismatch as the visible issue when mismatched reviews contain product-problem language", () => {
    const deterministic = {
      mainIssue: "review_feed_integrity",
      riskScore: 53,
      confidence: 80,
      evidenceSnippets: [
        { text: "Review feed mismatch: customer talks about snowboard bindings, not this desk fan." },
        { text: "Wrong product signal: boots and boards are mentioned for a mini fan." },
      ],
      issueSignalCounts: { fit_sizing: 20, review_feed_integrity: 2 },
      metrics: {
        signalCount: 36,
        negativeReviewCount: 23,
        topReturnReasons: [],
        contentAnalysis: {
          issues: [
            { code: "review_feed_metadata_mismatch", label: "Review feed metadata mismatch", severity: "high", evidence: "Reviews mention snowboards and boots for a desk fan." },
            { code: "short_description", label: "Short product description", severity: "medium", evidence: "Description is too short." },
          ],
        },
        textInsights: { repeatedLanguage: [{ term: "desk", count: 19, sources: ["csv_review"] }] },
      },
    };

    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic,
      mainIssue: "review_feed_integrity",
      recommendations: [{ id: "fix-source-review-mismatch", label: "Fix source/review mismatch" }],
      ai: {
        classification: {
          clusters: [
            { issue_category: "fit_sizing", human_name: "Fit & sizing", signals: 20, source_types: ["reviews"] },
            { issue_category: "negative_sentiment", human_name: "Negative customer sentiment cluster", signals: 23, source_types: ["reviews"] },
          ],
        },
      },
    });

    expect(issues[0]?.issueCode).toBe("review_feed_integrity");
    expect(issues[0]?.action).toBe("Fix source/review mismatch");
    expect(issues.map((issue) => issue.issueCode)).not.toContain("fit_sizing");
    expect(issues.map((issue) => issue.issueCode)).not.toContain("negative_sentiment");
  });

  it("does not turn repeated positive descriptor words into merchant-facing issues", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [],
      reviews: [
        { title: "Broken but beautiful", body: "The glaze is beautiful, but one bowl arrived broken.", rating: 1, sourceType: "csv_review", createdAt: "2026-05-01T00:00:00.000Z" },
        { title: "Beautiful, cracked", body: "Beautiful dinnerware, still cracked in the box.", rating: 1, sourceType: "csv_review", createdAt: "2026-05-02T00:00:00.000Z" },
        { title: "Beautiful but damaged", body: "Beautiful set, but packaging did not protect it.", rating: 1, sourceType: "csv_review", createdAt: "2026-05-03T00:00:00.000Z" },
      ],
    });

    expect(insights.repeatedLanguage.map((item) => item.term)).toContain("beautiful");
    expect(insights.granularIssues.map((issue) => issue.issue)).not.toContain('Repeated customer language: "beautiful"');
  });

  it("keeps positive control-product language out of merchant-facing issues", () => {
    const reviews = Array.from({ length: 6 }, (_, index) => ({
      title: "Clear listing and great gift",
      body: "The finished size matched the page, the 500-piece count was clear, and the included reference poster made it a complete gift.",
      rating: 5,
      sourceType: "csv_review",
      createdAt: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({ returns: [], reviews });

    const issueLabels = insights.granularIssues.map((issue) => issue.issue);
    expect(issueLabels).not.toContain('Repeated customer language: "clear"');
    expect(issueLabels).not.toContain('Repeated customer language: "clear listing"');
    expect(issueLabels).not.toContain('Repeated customer language: "finished size"');

    const cachedItems = __productPulseDiagnosisTestHooks.buildCustomerTextAnalysisItems({ returns: [], reviews });
    const counts = __productPulseDiagnosisTestHooks.buildIssueSignalCountsFromAnalysis({
      customerTextCache: {
        returnItems: cachedItems.returnTexts,
        reviewItems: cachedItems.reviewTexts,
      },
      fallback: { returns: [], refunds: [], reviews: [] },
    });

    expect(counts.fit_sizing || 0).toBe(0);
    expect(counts.quality_defect || 0).toBe(0);
    expect(counts.shipping_delivery || 0).toBe(0);
  });

  it("does not let AI emotion labels contradict positive review sentiment", () => {
    const signals = __productPulseDiagnosisTestHooks.normalizeAiClassifiedSignals([
      {
        source: "csv_review",
        text: "Clear listing and great gift. Everything matched the product page.",
        issue_category: "product_quality",
        sentiment: "positive",
        known_emotion: "anger",
        severity: "low",
      },
    ]);

    expect(signals[0]?.sentiment).toBe("positive");
    expect(["delight", "satisfaction", "trust", "relief"]).toContain(signals[0]?.emotion);
  });

  it("corrects AI-classified positive recovery reviews before counting issue signals", () => {
    const signals = __productPulseDiagnosisTestHooks.normalizeAiClassifiedSignals([
      {
        source: "csv_review",
        text: "Packaging looked much better this time. The plates arrived safely with better separators and no chips. The shipping damage problem is being handled.",
        issue_category: "quality_defect",
        sentiment: "negative",
        known_emotion: "anger",
        severity: "medium",
      },
    ]);
    const counts = __productPulseDiagnosisTestHooks.countAiSignalsByIssue(signals);

    expect(signals[0]?.sentiment).toBe("positive");
    expect(["relief", "trust", "satisfaction"]).toContain(signals[0]?.emotion);
    expect(counts.quality_defect || 0).toBe(0);
  });

  it("keeps positive recovery reviews positive when they mention resolved damage context", () => {
    const cachedItems = __productPulseDiagnosisTestHooks.buildCustomerTextAnalysisItems({
      returns: [],
      reviews: [{
        title: "Packaging improved",
        body: "Packaging looked much better this time. The plates arrived safely with better separators and no chips. The glaze was beautiful, and the shipping damage problem is being handled.",
        rating: 5,
        sourceType: "csv_review",
        createdAt: "2026-05-17T00:00:00.000Z",
      }],
    });

    expect(cachedItems.reviewTexts[0]?.sentiment).toBe("positive");
    expect(["relief", "trust", "satisfaction"]).toContain(cachedItems.reviewTexts[0]?.emotion);
  });

  it("prioritizes monitoring over PDP fixes for low-risk high-momentum control products", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 36,
      confidence: 76,
      issueSignalCounts: {},
      product: {
        title: "GEN Calm Forest Puzzle 500 Pieces",
        description: "Clear, complete puzzle listing. A 500-piece illustrated forest puzzle with a finished size of 18 x 24 inches. Includes reference poster, resealable bag and sturdy storage box.",
        media: [],
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Standard", sku: "GEN-PUZZLE-CALM" }],
      },
      metrics: {
        productMomentumScore: 85,
        customerSignalCount: 0,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 0,
        signalCount: 1,
        mediaCount: 0,
        contentIssueCount: 1,
        faqNeed: {
          shouldRecommend: true,
          topics: ["Puzzle details"],
          reasons: ["A specs FAQ could be added, but customers are not signaling a problem."],
        },
        contentAnalysis: {
          issues: [
            { code: "missing_specifications", label: "Missing product specifications", severity: "medium", evidence: "Optional recommended age and material details could be added." },
          ],
          advisories: [{ code: "missing_media_context", label: "Missing media context", severity: "low" }],
        },
        textInsights: {
          sentiment: { positive: 32, neutral: 2, negative: 0, total: 34, negativeRatio: 0 },
          repeatedLanguage: [
            { term: "clear", count: 34, dominantSentiment: "positive", sentiments: { positive: 34, neutral: 0, negative: 0 }, sources: ["csv_review"] },
          ],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/4",
        productTitle: "GEN Calm Forest Puzzle 500 Pieces",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations[0]?.id).toBe("add-to-watchlist");
    expect(recommendations.map((item) => item.id)).not.toContain("rewrite-product-description");
    expect(recommendations.map((item) => item.id)).not.toContain("add-product-description-guidance");
    expect(recommendations.map((item) => item.id)).not.toContain("create-product-faq");
    expect(recommendations.map((item) => item.id)).not.toContain("improve-product-media");
    expect(recommendations.map((item) => item.id)).not.toContain("recommend-qa-review");
  });

  it("treats low-risk rising mock products with minor PDP gaps as watchlist candidates", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 21,
      confidence: 68,
      issueSignalCounts: { quality_defect: 2, product_content: 4 },
      product: {
        title: "GEN Atlas Pro Mechanical Keyboard",
        description: "Premium mechanical keyboard. Aluminum case, hot-swappable switches, RGB backlight and detachable USB-C cable. Choose tactile or linear switch feel before checkout.",
        media: [],
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Tactile", sku: "GEN-KBD-TAC" },
          { id: "gid://shopify/ProductVariant/2", title: "Linear", sku: "GEN-KBD-LIN" },
        ],
      },
      metrics: {
        productMomentumScore: 76,
        customerSignalCount: 2,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 2,
        signalCount: 6,
        mediaCount: 0,
        contentIssueCount: 4,
        faqNeed: {
          shouldRecommend: true,
          topics: ["Switch guidance"],
          reasons: ["Repeated review language points to a possible expectation gap."],
        },
        contentAnalysis: {
          issues: [
            { code: "short_description", label: "Short product description", severity: "medium", evidence: "The description has 21 words." },
            { code: "missing_specifications", label: "Missing product specifications", severity: "medium", evidence: "No layout, dimensions or compatibility details are provided." },
            { code: "missing_customer_guidance", label: "Missing customer guidance", severity: "medium", evidence: "Switch feel is not explained." },
          ],
          advisories: [{ code: "missing_media_context", label: "Missing media context", severity: "low" }],
        },
        textInsights: {
          sentiment: { positive: 42, neutral: 0, negative: 2, total: 44, negativeRatio: 0.045 },
          repeatedLanguage: [
            { term: "excellent", count: 42, dominantSentiment: "positive", sentiments: { positive: 42, neutral: 0, negative: 0 }, sources: ["csv_review"] },
            { term: "not what i expected", count: 2, dominantSentiment: "negative", sentiments: { positive: 0, neutral: 0, negative: 2 }, sources: ["csv_review"] },
          ],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/5",
        productTitle: "GEN Atlas Pro Mechanical Keyboard",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations[0]?.id).toBe("add-to-watchlist");
    expect(recommendations.map((item) => item.id)).not.toContain("draft-quality-note");
    expect(recommendations.map((item) => item.id)).not.toContain("rewrite-product-description");
    expect(recommendations.map((item) => item.id)).not.toContain("create-product-faq");
    expect(recommendations.map((item) => item.id)).not.toContain("recommend-qa-review");
  });

  it("matches issue rows to issue-relevant actions instead of positional SEO actions", () => {
    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic: {
        mainIssue: "quality_defect",
        riskScore: 60,
        confidence: 90,
        issueSignalCounts: { quality_defect: 10 },
        metrics: {
          signalCount: 10,
          topReturnReasons: [],
          contentAnalysis: { issues: [] },
          textInsights: {},
        },
      },
      mainIssue: "quality_defect",
      recommendations: [
        { id: "rewrite-meta-description", label: "Rewrite meta description" },
        { id: "rewrite-product-description", label: "Update product description" },
      ],
      ai: {
        classification: {
          clusters: [
            { issue_category: "quality_defect", human_name: "Product quality", signals: 10, source_types: ["reviews", "returns"] },
          ],
        },
      },
    });

    expect(issues[0]?.action).toBe("Update product description");
  });

  it("keeps subjective softness feedback out of QA and variant actions without concentration", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 61,
      confidence: 94,
      evidenceSnippets: [
        { text: "Too soft for balance poses, but comfortable for stretching." },
        { text: "The cushion is nice, just not firm enough for standing work." },
      ],
      issueSignalCounts: { quality_defect: 9 },
      product: {
        title: "GEN CloudSoft Yoga Mat 12mm",
        description: "This mat is intentionally soft and cushion-forward. It is best for stretching, pilates and floor workouts.",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Sage", sku: "GEN-MAT-SAGE" },
          { id: "gid://shopify/ProductVariant/2", title: "Charcoal", sku: "GEN-MAT-CHAR" },
        ],
      },
      metrics: {
        customerSignalCount: 15,
        signalCount: 46,
        returnUnits: 4,
        refundUnits: 0,
        returnRate: 28.57,
        negativeReviewCount: 11,
        affectedVariants: ["Sage", "Charcoal"],
        affectedVariantDetails: [{ label: "Sage", count: 1 }, { label: "Charcoal", count: 3 }],
        variantCount: 2,
        faqNeed: {
          shouldRecommend: true,
          topics: ["Product expectations"],
          reasons: ["Softness expectations repeat enough to clarify before purchase."],
        },
        specsBlockRecommended: true,
        contentIssueCount: 2,
        contentAnalysis: {
          issues: [
            { code: "missing_specifications", label: "Missing physical dimensions", severity: "medium", evidence: "The description mentions thickness but omits length and width." },
            { code: "missing_customer_guidance", label: "Missing usage guidance", severity: "medium", evidence: "Clarify that this is softer than firm balance mats." },
          ],
          advisories: [],
        },
        textInsights: {
          repeatedLanguage: [{ term: "soft", count: 44 }, { term: "balance", count: 9 }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/2",
        productTitle: "GEN CloudSoft Yoga Mat 12mm",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: "Clarify the mat is intentionally soft and best for floor workouts." } } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("recommend-qa-review");
    expect(recommendations.map((item) => item.id)).not.toContain("correct-variant-options");
    expect(recommendations.map((item) => item.id)).toContain("add-specs-details-block");
  });

  it("uses reliable purchase context to recommend variant clarity for multi-variant return patterns", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      riskScore: 68,
      confidence: 82,
      evidenceSnippets: [{ text: "Customers bought two sizes and returned the one that did not fit." }],
      issueSignalCounts: { fit_sizing: 5 },
      product: {
        title: "Core Linen Trouser",
        description: "Linen trouser.",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "S", sku: "LIN-S" },
          { id: "gid://shopify/ProductVariant/2", title: "M", sku: "LIN-M" },
          { id: "gid://shopify/ProductVariant/3", title: "L", sku: "LIN-L" },
        ],
      },
      metrics: {
        customerSignalCount: 6,
        signalCount: 8,
        returnUnits: 5,
        refundUnits: 0,
        returnRate: 16,
        negativeReviewCount: 1,
        affectedVariants: [],
        affectedVariantDetails: [],
        variantCount: 3,
        contentIssueCount: 0,
        contentAnalysis: { issues: [], advisories: [] },
        textInsights: {},
        productPurchaseContextSummary: {
          total_orders_containing_product: 24,
          total_units_sold: 58,
          multi_variant_order_count: 6,
          multi_variant_order_rate: 0.25,
          purchase_context_confidence: 84,
        },
        productPurchaseContextFactors: {
          recommendedActionSignals: {
            variantClarity: true,
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/variant-context",
        productTitle: "Core Linen Trouser",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    const variantAction = recommendations.find((item) => item.id === "correct-variant-options");
    expect(variantAction).toBeTruthy();
    expect(variantAction.payload.trigger).toContain("Multi-variant purchases");
  });

  it("creates relationship recommendations only from sufficiently confident actionable patterns", () => {
    const deterministic = {
      mainIssue: "product_quality",
      riskScore: 62,
      confidence: 78,
      evidenceSnippets: [],
      issueSignalCounts: { product_quality: 4 },
      product: {
        title: "Core Product",
        description: "Core product.",
        variants: [],
      },
      metrics: {
        customerSignalCount: 5,
        signalCount: 8,
        returnUnits: 3,
        refundUnits: 2,
        negativeReviewCount: 0,
        contentIssueCount: 0,
        contentAnalysis: { issues: [], advisories: [] },
        textInsights: {},
        affectedVariants: [],
        affectedVariantDetails: [],
        topReturnReasons: [],
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 18 },
          confidence: { score: 82, label: "High" },
        },
        productRelationshipFactors: {
          recommendedActionSignals: {
            bundleOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/care-kit",
              relatedProductTitle: "Care Kit",
              relationshipType: "same_order",
              direction: "together",
              timeWindow: "same_order",
              lift: 2.4,
              confidence: 82,
              sampleSize: 5,
              relationshipStrength: "strong",
            },
            crossSellOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/refill-pack",
              relatedProductTitle: "Refill Pack",
              relationshipType: "next_purchase",
              direction: "after",
              timeWindow: "30d_after",
              lift: 1.8,
              confidence: 76,
              sampleSize: 4,
              relationshipStrength: "moderate",
            },
            compatibilityWarningRelationship: {
              relatedProductId: "gid://shopify/Product/accessory",
              relatedProductTitle: "Accessory Pack",
              relationshipType: "same_order",
              direction: "together",
              timeWindow: "same_order",
              lift: 2.1,
              confidence: 80,
              sampleSize: 6,
              deltaReturnRate: 12,
              deltaRefundRate: 5,
              relationshipStrength: "strong",
            },
            journeyInsightRelationship: {
              relatedProductId: "gid://shopify/Product/starter",
              relatedProductTitle: "Starter Kit",
              relationshipType: "previous_purchase",
              direction: "before",
              timeWindow: "30d_before",
              lift: 1.6,
              confidence: 74,
              sampleSize: 4,
              relationshipStrength: "moderate",
            },
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/relationship",
        productTitle: "Core Product",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).toEqual(expect.arrayContaining([
      "review-product-pairing-expectations",
      "test-product-bundle",
      "create-post-purchase-cross-sell",
      "position-as-upgrade-path",
    ]));
    expect(recommendations.find((item) => item.id === "review-product-pairing-expectations").payload).toMatchObject({
      relatedProductTitle: "Accessory Pack",
      recommendationKind: "compatibility_warning",
      readOnly: true,
    });
    expect(recommendations.find((item) => item.id === "create-post-purchase-cross-sell").payload.relatedProductTitle).toBe("Refill Pack");

    const lowConfidence = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/relationship",
        productTitle: "Core Product",
      },
      deterministic: {
        ...deterministic,
        metrics: {
          ...deterministic.metrics,
          productRelationshipIntelligenceSummary: {
            data_basis: { order_count: 18 },
            confidence: { score: 40, label: "Low" },
          },
        },
      },
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    expect(lowConfidence.map((item) => item.id)).not.toContain("test-product-bundle");
    expect(lowConfidence.map((item) => item.id)).not.toContain("create-post-purchase-cross-sell");
    expect(lowConfidence.map((item) => item.id)).not.toContain("review-product-pairing-expectations");
  });

  it("builds specs details blocks as technical placeholders instead of catalog metadata", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 68,
      confidence: 88,
      evidenceSnippets: [
        { text: "Cream unit brewed before the alarm and left condensation rings on the nightstand." },
        { text: "Graphite worked after a firmware reset, but the timer drifted again later." },
      ],
      issueSignalCounts: { quality_defect: 8 },
      product: {
        title: "GEN WhisperBrew Coffee Alarm Clock",
        description: "Schedules a single-cup brew near wake time with quiet alarm tones and a removable water tank.",
        vendor: "ProductPulse Lab",
        productType: "Small Appliance",
        options: [{ name: "Color", values: ["Cream", "Graphite"] }],
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Cream", sku: "GEN-BREW-CREAM" },
          { id: "gid://shopify/ProductVariant/2", title: "Graphite", sku: "GEN-BREW-GRAPH" },
        ],
      },
      metrics: {
        customerSignalCount: 12,
        signalCount: 20,
        returnUnits: 7,
        refundUnits: 4,
        negativeReviewCount: 10,
        specsBlockRecommended: true,
        contentIssueCount: 2,
        topReturnReasons: ["Other"],
        contentAnalysis: {
          issues: [
            { code: "missing_specifications", label: "Missing product specifications", severity: "medium", evidence: "No voltage, capacity, timing, or surface guidance is provided." },
            { code: "missing_customer_guidance", label: "Missing shopper guidance", severity: "medium", evidence: "Condensation and timer behavior need pre-purchase guidance." },
          ],
          advisories: [],
        },
        textInsights: {
          repeatedLanguage: [{ term: "condensation", count: 4 }, { term: "timer drift", count: 3 }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/3",
        productTitle: "GEN WhisperBrew Coffee Alarm Clock",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    const specs = recommendations.find((item) => item.id === "add-specs-details-block");
    expect(specs?.payload.draftText).toContain("Power input");
    expect(specs?.payload.draftText).toContain("Brew capacity");
    expect(specs?.payload.draftText).toContain("Timer and alarm behavior");
    expect(specs?.payload.draftText).toContain("Water and condensation guidance");
    expect(specs?.payload.draftText).toContain("[confirm");
    expect(specs?.payload.draftText).not.toContain("Product type:");
    expect(specs?.payload.draftText).not.toContain("Brand/vendor:");
    expect(specs?.payload.draftText).not.toContain("Available options:");
    expect(specs?.payload.draftText).not.toContain("Variants/SKUs:");
  });

  it("uses AI-generated specs details block when it is product-specific", () => {
    const deterministic = {
      mainIssue: "compatibility",
      riskScore: 58,
      confidence: 80,
      issueSignalCounts: { compatibility: 5 },
      product: {
        title: "GEN SmartHerb Planter Kit",
        description: "Includes planter base, LED grow light and seed pods.",
        productType: "Home Garden",
      },
      metrics: {
        customerSignalCount: 5,
        signalCount: 10,
        returnUnits: 3,
        refundUnits: 1,
        negativeReviewCount: 3,
        specsBlockRecommended: true,
        contentIssueCount: 1,
        contentAnalysis: {
          issues: [{ code: "missing_specifications", label: "Missing compatibility details", severity: "medium", evidence: "Wi-Fi and app requirements are not clear." }],
          advisories: [],
        },
        textInsights: {},
      },
    };
    const aiBlock = [
      "Technical details to confirm before buying:",
      "- Wi-Fi compatibility: [confirm 2.4 GHz requirement]",
      "- App language: [confirm supported languages]",
      "- Power input: [confirm plug type and voltage]",
    ].join("\n");

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/4",
        productTitle: "GEN SmartHerb Planter Kit",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { specs_details_block: aiBlock } } },
    });

    expect(recommendations.find((item) => item.id === "add-specs-details-block")?.payload.draftText).toBe(aiBlock);
  });

  it("prioritizes QA review for refund-driven damage and does not recommend pricing without value evidence", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 63,
      confidence: 94,
      evidenceSnippets: [
        { text: "Arrived broken despite looking beautiful." },
        { text: "Packaging was not enough and two bowls were cracked." },
      ],
      issueSignalCounts: { quality_defect: 7 },
      product: {
        title: "GEN Aurora Ceramic Dinner Set",
        description: "Includes 4 dinner plates, 4 salad plates and 4 bowls with a hand-glazed finish. Dishwasher safe.",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Aurora Blue", sku: "GEN-DINNER-BLU" },
          { id: "gid://shopify/ProductVariant/2", title: "Warm White", sku: "GEN-DINNER-WHT" },
        ],
      },
      metrics: {
        customerSignalCount: 20,
        signalCount: 52,
        soldUnits: 16,
        returnUnits: 0,
        refundUnits: 7,
        refundRate: 43.75,
        refundAmount: 802,
        negativeReviewCount: 6,
        topReturnReasons: [],
        refundInsights: {
          shouldSurface: true,
          highPressure: true,
          topReasons: [{ label: "Damaged in shipping", count: 7 }],
        },
        contentIssueCount: 2,
        contentAnalysis: {
          issues: [
            { code: "short_description", label: "Short product description", severity: "medium", evidence: "No dimensions or packaging details." },
            { code: "missing_shipping_packaging_reassurance", label: "Missing shipping/packaging reassurance", severity: "medium", evidence: "Refund notes mention cracked bowls." },
          ],
          advisories: [],
        },
        textInsights: {
          repeatedLanguage: [{ term: "broken", count: 8 }, { term: "packaging", count: 7 }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/3",
        productTitle: "GEN Aurora Ceramic Dinner Set",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: "Set expectations about packaging and support for damaged arrivals." } } },
    });

    expect(recommendations[0]?.id).toBe("recommend-qa-review");
    expect(recommendations.map((item) => item.id)).not.toContain("review-product-pricing");
  });

  it("builds actionable recommendation recipes with Shopify fields and risk metadata", () => {
    const deterministic = {
      mainIssue: "safety_concern",
      riskScore: 82,
      confidence: 72,
      evidenceSnippets: [
        { text: "Not worth the price after the scary reaction." },
        { text: "Too expensive for something that scared my kid." },
      ],
      product: {
        title: "Product",
        description: "",
        status: "ACTIVE",
        vendor: "Qorve",
        productType: "Toy",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Blue", price: 29, compareAtPrice: 39, inventoryItemId: "gid://shopify/InventoryItem/1" },
          { id: "gid://shopify/ProductVariant/2", title: "Red", price: 29, compareAtPrice: 39, inventoryItemId: "gid://shopify/InventoryItem/2" },
        ],
        media: [{ id: "gid://shopify/MediaImage/1", alt: "" }],
      },
      issueSignalCounts: { safety_concern: 4 },
      metrics: {
        customerSignalCount: 6,
        signalCount: 6,
        contentIssueCount: 1,
        contentIssues: [{ code: "generic_title", label: "Product title is too generic", severity: "medium", evidence: "Generic title." }],
        contentAnalysis: { issues: [{ code: "generic_title", label: "Product title is too generic", severity: "medium", evidence: "Generic title." }], advisories: [] },
        titleNeedsReview: true,
        mediaCount: 1,
        mediaWithoutAltCount: 1,
        variantCount: 2,
        affectedVariants: ["Blue"],
        affectedVariantDetails: [{ label: "Blue", count: 4 }],
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Blue", price: 29, compareAtPrice: 39, inventoryItemId: "gid://shopify/InventoryItem/1" },
          { id: "gid://shopify/ProductVariant/2", title: "Red", price: 29, compareAtPrice: 39, inventoryItemId: "gid://shopify/InventoryItem/2" },
        ],
        returnUnits: 4,
        refundUnits: 2,
        refundRate: 22,
        returnRate: 40,
        negativeReviewCount: 2,
        topReturnReasons: ["Other"],
        topReturnReasonDetails: [{ label: "Other", count: 4 }],
        refundInsights: { shouldSurface: true, highPressure: true },
        textInsights: { sentiment: { negative: 4 } },
        marginAtRisk: 1200,
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/1",
        productTitle: "Product",
      },
      deterministic,
      mainIssue: "safety_concern",
      ai: {
        report: {
          recommendation_copy: {
            product_title: "Qorve Toy with clear age guidance",
            media_guidance: "Add alt text and visual context.",
            qa_note: "Ask QA to inspect scary packaging feedback.",
          },
        },
      },
    });

    const byId = new Map(recommendations.map((item) => [item.id, item]));
    expect(byId.get("update-product-title")?.payload).toMatchObject({
      shopifyField: "Product.title",
      applicationRisk: "Medium",
      reviewApplyFlow: "Review -> Apply",
      draftTitle: "Qorve Toy with clear age guidance",
    });
    expect(byId.get("set-product-draft")?.payload.shopifyField).toBe("Product.status");
    expect(byId.get("limit-variant-inventory")?.payload.shopifyField).toBe("InventoryLevel quantities");
    expect(byId.get("review-product-pricing")?.payload.shopifyField).toContain("ProductVariant.price");
    expect(byId.get("improve-product-media")?.payload.expectedImpact).toContain("visual expectation");
    expect(byId.get("improve-product-media")?.payload.mediaUpdates?.[0]).toMatchObject({
      id: "gid://shopify/MediaImage/1",
      currentAltText: "",
    });
    expect(byId.get("improve-product-media")?.payload.draftText).toContain("Qorve Toy");
    expect(byId.get("improve-product-media")?.payload.shopifyField).toBe("Product media alt text");
    expect(byId.get("apply-risk-tags")?.payload.tags).toEqual(expect.arrayContaining(["risk-high", "sentiment-negative", "variant-issue"]));
    expect(recommendations.every((item) => item.payload.recipe === true)).toBe(true);
  });

  it("calculates Product Momentum from recent sales velocity, growth and catalog baseline", () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const sales = [
      { orderId: "ord-1", createdAt: "2026-05-15T10:00:00.000Z", quantity: 8, amount: 800 },
      { orderId: "ord-2", createdAt: "2026-05-09T10:00:00.000Z", quantity: 7, amount: 700 },
      { orderId: "ord-3", createdAt: "2026-05-01T10:00:00.000Z", quantity: 6, amount: 600 },
      { orderId: "ord-4", createdAt: "2026-04-22T10:00:00.000Z", quantity: 5, amount: 500 },
      { orderId: "ord-5", createdAt: "2026-04-10T10:00:00.000Z", quantity: 3, amount: 300 },
      { orderId: "ord-6", createdAt: "2026-03-20T10:00:00.000Z", quantity: 4, amount: 400 },
      { orderId: "ord-7", createdAt: "2026-02-20T10:00:00.000Z", quantity: 4, amount: 400 },
    ];
    const catalogBaseline = __productPulseDiagnosisTestHooks.buildProductMomentumCatalogBaseline([
      { productGid: "gid://shopify/Product/a", metrics: { productMomentum: { inputs: { unitsLast30Days: 4, revenueLast30Days: 400, unitsPrevious90Days: 12, revenuePrevious90Days: 1200 } } } },
      { productGid: "gid://shopify/Product/b", metrics: { productMomentum: { inputs: { unitsLast30Days: 12, revenueLast30Days: 1200, unitsPrevious90Days: 24, revenuePrevious90Days: 2400 } } } },
      { productGid: "gid://shopify/Product/c", metrics: { productMomentum: { inputs: { unitsLast30Days: 22, revenueLast30Days: 2200, unitsPrevious90Days: 33, revenuePrevious90Days: 3300 } } } },
      { productGid: "gid://shopify/Product/d", metrics: { productMomentum: { inputs: { unitsLast30Days: 32, revenueLast30Days: 3200, unitsPrevious90Days: 40, revenuePrevious90Days: 4000 } } } },
    ]);

    const momentum = __productPulseDiagnosisTestHooks.buildProductMomentum({
      product: { createdAt: "2026-01-01T00:00:00.000Z", variants: [] },
      sales,
      catalogBaseline,
      now,
      windowDays: 120,
    });

    expect(momentum.score).toBeGreaterThanOrEqual(60);
    expect(["Hot", "Rising", "Stable"]).toContain(momentum.tier);
    expect(momentum.components.currentVelocityScore).toBeGreaterThan(50);
    expect(momentum.components.growthScore).toBeGreaterThan(50);
    expect(momentum.inputs.unitsLast30Days).toBe(26);
    expect(momentum.inputs.ordersLast30Days).toBe(4);
    expect(momentum.inputs.weeklyUnitsLast4Weeks).toHaveLength(4);
    expect(momentum.display.catalogPositionLabel).toMatch(/Top|baseline/);
    expect(momentum.confidence).toBeGreaterThan(50);
  });
});
