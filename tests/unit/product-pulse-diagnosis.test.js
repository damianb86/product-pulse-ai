/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/lib/product-pulse-ai.server.js", () => ({
  runProductDiagnosisAiAnalysis: vi.fn(),
  resumeProductDiagnosisAiAnalysisFromBatch: vi.fn(),
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

  it("matches cached source events by SKU or title when Shopify omits product ids", () => {
    const product = {
      id: "gid://shopify/Product/123",
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
      variants: [{ id: "gid://shopify/ProductVariant/456", sku: "NIGHT-WATCH-XL" }],
    };
    const snapshot = {
      productGid: product.id,
      productTitle: product.title,
      handle: product.handle,
    };

    const matched = __productPulseDiagnosisTestHooks.filterDiagnosisEventsForProduct([
      { id: "sku-event", sku: "NIGHT-WATCH-XL", title: "Different title", createdAt: "2026-06-01T10:00:00.000Z" },
      { id: "title-event", title: "The Night Watch", createdAt: "2026-06-01T11:00:00.000Z" },
      { id: "other-event", sku: "OTHER-SKU", title: "Other Product", createdAt: "2026-06-01T12:00:00.000Z" },
      { id: "title-only-other-event", title: "Other Product", createdAt: "2026-06-01T13:00:00.000Z" },
    ], product, snapshot);

    expect(matched.map((event) => event.id)).toEqual(["sku-event", "title-event"]);
  });

  it("builds compact shared shop source event rows from normalized events", () => {
    const row = __productPulseDiagnosisTestHooks.buildShopSourceEventRow({
      shop: "example.myshopify.com",
      sourceType: "sales",
      event: {
        id: "line-1",
        orderId: "order-1",
        lineItemId: "line-1",
        productId: "gid://shopify/Product/123",
        variantId: "gid://shopify/ProductVariant/456",
        createdAt: "2026-06-01T10:00:00.000Z",
        quantity: 2,
        amount: 42.5,
        title: "The Night Watch",
      },
      now: new Date("2026-06-02T10:00:00.000Z"),
    });

    expect(row).toMatchObject({
      shop: "example.myshopify.com",
      sourceType: "sales",
      productGid: "gid://shopify/Product/123",
      variantGid: "gid://shopify/ProductVariant/456",
      orderGid: "order-1",
      quantity: 2,
      amount: 42.5,
    });
    expect(row.cacheKey).toContain("sale");
    expect(row.payload).toMatchObject({ productId: "gid://shopify/Product/123", title: "The Night Watch" });
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

  it("does not request protected customer fields for sales extraction", () => {
    const query = __productPulseDiagnosisTestHooks.buildDiagnosisSalesQuery();

    expect(query).toContain("sortKey: PROCESSED_AT");
    expect(query).toContain("reverse: true");
    expect(query).toContain("customer");
    expect(query).toMatch(/customer\s*{\s*id\s*}/);
    expect(query).not.toMatch(/\b(email|phone|firstName|lastName|displayName|shippingAddress|billingAddress|address1|address2|city|province|country|zip)\b/i);
    expect(query).toContain("featuredMedia");
    expect(query).toContain("media(first: 1)");
    expect(query).toContain("image");
    expect(query).toContain("altText");
  });

  it("builds product-targeted sales queries with processed date and SKU filters", () => {
    expect(__productPulseDiagnosisTestHooks.buildDiagnosisSalesOrderQuery({
      sinceDate: "2026-03-12",
      sku: `AIR "LUXE"`,
    })).toBe(`processed_at:>=2026-03-12 sku:"AIR \\"LUXE\\""`);
  });

  it("finds product sales through targeted SKU queries when the limited global order scan misses them", async () => {
    const product = {
      id: "gid://shopify/Product/8443102757120",
      title: "AIRELUXE",
      handle: "t3-aireluxe-professional-hair-dryer-new",
      variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "AIR-LUXE" }],
    };
    const snapshot = {
      productGid: product.id,
      productTitle: product.title,
      handle: product.handle,
    };
    const graphqlCalls = [];
    const admin = {
      graphql: vi.fn(async (_query, { variables }) => {
        graphqlCalls.push(variables);
        const isTargetedSkuQuery = String(variables.query || "").includes('sku:"AIR-LUXE"');
        const lineItems = isTargetedSkuQuery
          ? [
            {
              id: "gid://shopify/LineItem/target-product",
              quantity: 482,
              title: "AIRELUXE",
              sku: "AIR-LUXE",
              product: { id: product.id, handle: product.handle, title: product.title, featuredMedia: null, media: { nodes: [] } },
              variant: { id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "AIR-LUXE", selectedOptions: [] },
              originalTotalSet: { shopMoney: { amount: "76394.69" } },
            },
            {
              id: "gid://shopify/LineItem/co-product",
              quantity: 2,
              title: "Diffuser Attachment",
              sku: "AIR-DIFFUSER",
              product: { id: "gid://shopify/Product/related", handle: "air-diffuser", title: "Diffuser Attachment", featuredMedia: null, media: { nodes: [] } },
              variant: { id: "gid://shopify/ProductVariant/related", title: "Default Title", sku: "AIR-DIFFUSER", selectedOptions: [] },
              originalTotalSet: { shopMoney: { amount: "58.00" } },
            },
          ]
          : [{
            id: "gid://shopify/LineItem/unrelated",
            quantity: 1,
            title: "Other product",
            sku: "OTHER-SKU",
            product: { id: "gid://shopify/Product/999", handle: "other-product", title: "Other product", featuredMedia: null, media: { nodes: [] } },
            variant: { id: "gid://shopify/ProductVariant/999", title: "Default Title", sku: "OTHER-SKU", selectedOptions: [] },
            originalTotalSet: { shopMoney: { amount: "19.00" } },
          }];

        return new Response(JSON.stringify({
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{
                id: isTargetedSkuQuery ? "gid://shopify/Order/target" : "gid://shopify/Order/unrelated",
                createdAt: "2026-06-01T10:00:00.000Z",
                processedAt: "2026-06-01T10:00:00.000Z",
                customer: { id: "gid://shopify/Customer/1" },
                lineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: lineItems },
              }],
            },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    };

    const result = await __productPulseDiagnosisTestHooks.fetchShopifySalesEventBundle({
      shop: "test-shop.myshopify.com",
      jobId: "job-targeted-sales",
      admin,
      product,
      snapshot,
      windowDays: 90,
      sinceDate: "2026-03-12",
      includeAllProductCandidates: true,
    });

    expect(graphqlCalls.map((call) => call.query)).toEqual([
      'processed_at:>=2026-03-12 sku:"AIR-LUXE"',
      "processed_at:>=2026-03-12",
    ]);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({
      productId: product.id,
      variantId: "gid://shopify/ProductVariant/1",
      sku: "AIR-LUXE",
      quantity: 482,
      amount: 76394.69,
    });
    expect(result.relationshipSales).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: product.id, sku: "AIR-LUXE" }),
      expect.objectContaining({ productId: "gid://shopify/Product/related", sku: "AIR-DIFFUSER", quantity: 2 }),
    ]));
    expect(result.fetchComplete).toBe(true);
    expect(result.extraction).toMatchObject({
      productSalesComplete: true,
      targeted: {
        scannedOrders: 1,
        matchedLineItems: 1,
        relationshipLineItems: 2,
      },
    });
  });

  it("marks product sales extraction incomplete when targeted order pagination cannot finish safely", () => {
    const completeness = __productPulseDiagnosisTestHooks.getSalesExtractionCompleteness({
      targeted: {
        skipped: false,
        hitPageLimit: true,
        paginationStalled: false,
        possibleLineItemMisses: 1,
      },
      global: {
        hitPageLimit: false,
        paginationStalled: false,
      },
    });

    expect(completeness).toMatchObject({
      fetchComplete: false,
      productSalesComplete: false,
      shopSourceSalesComplete: true,
      incompletenessReason: "targeted_order_page_limit_reached",
      incompletenessReasons: [
        "targeted_order_page_limit_reached",
        "targeted_order_line_items_capped_before_product_line",
      ],
    });
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
    expect(text).not.toContain("No restock");
  });

  it("suppresses low-information Shopify refund defaults when refund notes explain the issue", () => {
    const text = __productPulseDiagnosisTestHooks.getRefundOperationalText({
      note: "Goodwill refund after discovering the ring case is outside supported compatibility.",
      restockType: "NO_RESTOCK",
      adjustmentReasons: ["Refund Discrepancy"],
    });

    expect(text).toBe("Goodwill refund after discovering the ring case is outside supported compatibility.");
    expect(__productPulseDiagnosisTestHooks.getRefundReasonText({
      note: "Goodwill refund after discovering the ring case is outside supported compatibility.",
      restockType: "NO_RESTOCK",
      adjustmentReasons: ["Refund Discrepancy"],
    })).toBe("");
    expect(__productPulseDiagnosisTestHooks.classifyIssueText(text)).toBe("compatibility");
    expect(__productPulseDiagnosisTestHooks.classifyIssueText(
      "Customer used a pop-grip case, then learned that accessory sits outside the CaseFit compatibility boundary.",
    )).toBe("compatibility");
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

  it("reconstructs rolling-window product risk history during deterministic diagnosis", () => {
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
    expect(Math.max(...history.map((point) => point.metrics.rawReturnUnits))).toBe(3);
    expect(Math.max(...history.map((point) => point.metrics.returnUnits))).toBeGreaterThan(2.9);
    expect(history.find((point) => point.metrics.returnUnits === 0).riskScore).toBeLessThan(history.at(-1).riskScore);
  });

  it("rebuilds product risk history from source events instead of preserving stale stored points", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = {
      productGid: "gid://shopify/Product/history-stale",
      productTitle: "Stable Product",
      handle: "stable-product",
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
      description: "Stable product with clear specs, setup guidance, included parts, compatibility limits, dimensions, care, and warranty details.",
      descriptionHtml: "<p>Stable product with clear specs, setup guidance, included parts, compatibility limits, dimensions, care, and warranty details.</p>",
      variants: [{ id: "gid://shopify/ProductVariant/history-stale", title: "Default Title", sku: "STABLE", selectedOptions: [] }],
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
          { id: "sale-stable-1", orderId: "order-stable-1", quantity: 3, amount: 300, createdAt: daysAgo(25) },
          { id: "sale-stable-2", orderId: "order-stable-2", quantity: 3, amount: 300, createdAt: daysAgo(12) },
        ],
        returns: [],
        refunds: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      storedReconstructedRiskHistory: [
        {
          recordedAt: daysAgo(14),
          periodEnd: daysAgo(14),
          riskScore: 100,
          confidence: 95,
          metrics: { reconstructedHistory: true, returnUnits: 20 },
        },
      ],
      windowDays: 60,
    });

    const history = deterministic.metrics.riskHistory;

    expect(history.some((point) => point.riskScore === 100)).toBe(false);
    expect(history.at(-1).isCurrent).toBe(true);
    expect(history.at(-1).riskScore).toBe(deterministic.riskScore);
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
    expect(blue.timeline.reduce((sum, point) => sum + point.salesUnits, 0)).toBe(5);
    expect(blue.timeline.reduce((sum, point) => sum + point.returnUnits, 0)).toBe(1);
    expect(blue.timeline.reduce((sum, point) => sum + point.refundUnits, 0)).toBe(2);
    expect(blue.timeline.reduce((sum, point) => sum + point.reviewCount, 0)).toBe(1);
    expect(blue.timeline.reduce((sum, point) => sum + point.negativeReviewCount, 0)).toBe(1);
    expect(blue.reviews.examples[0]?.text).toContain("Aurora Blue");
    expect(white).toMatchObject({
      sku: "GEN-WHITE",
      sales: { units: 8, amount: 896 },
      returns: { units: 0 },
      refunds: { units: 0, amount: 0 },
      reviews: { count: 1, negativeCount: 0 },
      signalCount: 0,
    });
    expect(white.timeline.reduce((sum, point) => sum + point.salesUnits, 0)).toBe(8);
    expect(white.timeline.reduce((sum, point) => sum + point.reviewCount, 0)).toBe(1);
    expect(white.timeline.reduce((sum, point) => sum + point.positiveReviewCount, 0)).toBe(1);
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

  it("does not promote weak fit or usage expectation text into final report issues", () => {
    const deterministic = {
      riskScore: 52,
      confidence: 68,
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 2 },
      metrics: {
        signalCount: 2,
        customerSignalCount: 2,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 2,
        reviewCount: 24,
        negativeReviewRate: 8.3,
        textInsights: {
          sentiment: { negative: 2, negativeRatio: 0.08 },
          repeatedLanguage: [{ term: "fit", count: 2, issueCode: "fit_sizing" }],
        },
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        topReturnReasons: [],
        affectedVariants: [],
        issueSignalTrends: {},
        signalTrend: [],
      },
    };

    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic,
      recommendations: [{ label: "Draft fit note for product description" }],
      mainIssue: "fit_sizing",
      ai: {
        classification: {
          clusters: [{
            issue_category: "fit_sizing",
            human_name: "Fit & sizing",
            summary: "Two connected reviews mention fit expectations.",
            signals: 2,
            source_types: ["reviews"],
            severity: "medium",
          }],
        },
        emergentSentiments: { emergent_sentiments: [] },
      },
    });

    expect(__productPulseDiagnosisTestHooks.hasStrongExpectationIssueEvidence(deterministic, "fit_sizing")).toBe(false);
    expect(issues.map((issue) => issue.issueCode)).not.toContain("fit_sizing");
  });

  it("allows expectation issues when aligned with stronger return or refund metrics", () => {
    const deterministic = {
      riskScore: 72,
      confidence: 78,
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 3 },
      metrics: {
        signalCount: 5,
        customerSignalCount: 5,
        returnUnits: 2,
        refundUnits: 0,
        negativeReviewCount: 3,
        reviewCount: 16,
        negativeReviewRate: 18.75,
        textInsights: {
          sentiment: { negative: 3, negativeRatio: 0.38 },
          repeatedLanguage: [{ term: "runs small", count: 3, issueCode: "fit_sizing" }],
        },
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        topReturnReasons: ["Size too small"],
        affectedVariants: [],
        issueSignalTrends: {},
        signalTrend: [],
      },
    };

    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic,
      recommendations: [{ label: "Draft fit note for product description" }],
      mainIssue: "fit_sizing",
      ai: {
        classification: {
          clusters: [{
            issue_category: "fit_sizing",
            human_name: "Fit & sizing",
            summary: "Returns and repeated reviews point to fit expectations.",
            signals: 3,
            source_types: ["shopify_returns", "reviews"],
            severity: "medium",
          }],
        },
        emergentSentiments: { emergent_sentiments: [] },
      },
    });

    expect(__productPulseDiagnosisTestHooks.hasStrongExpectationIssueEvidence(deterministic, "fit_sizing")).toBe(true);
    expect(issues.map((issue) => issue.issueCode)).toContain("fit_sizing");
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
    expect(deterministic.metrics.rawReviewSourceStats.csv.negativeReviewCount).toBe(2);
    expect(deterministic.metrics.csvNegativeReviewCount).toBeGreaterThan(0);
    expect(deterministic.metrics.csvNegativeReviewCount).toBeLessThan(2);
    expect(deterministic.metrics.csvAverageRating).toBe(2.7);
    expect(deterministic.sourceCoverage).toContain("CSV reviews");
    expect(deterministic.evidenceSnippets.filter((snippet) => snippet.source === "csv_review")).toHaveLength(2);
    expect(deterministic.metrics.rawTextInsights.reviews.sentiment.negative).toBe(2);
    expect(deterministic.metrics.textInsights.reviews.sentiment.negative).toBe(deterministic.metrics.csvNegativeReviewCount);
    expect(deterministic.metrics.textInsights.reviews.examples[0]).toMatchObject({
      source: "csv_review",
      sourceLabel: "CSV reviews",
    });
  });

  it("uses Yotpo reviews as deep-diagnosis review evidence", () => {
    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        productGid: "gid://shopify/Product/987654321",
        productTitle: "Cloud Runner Tee",
        handle: "cloud-runner-tee",
        primaryIssue: "Product quality",
        metrics: {},
      },
      shopifyData: {
        product: {
          id: "gid://shopify/Product/987654321",
          numericId: "987654321",
          title: "Cloud Runner Tee",
          handle: "cloud-runner-tee",
          description: "Lightweight running tee with quick-dry fabric and a relaxed fit.",
          variants: [],
          tags: ["apparel", "running"],
          collections: ["Activewear"],
        },
        sales: [],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      yotpoData: {
        connected: true,
        matchConfidence: 1,
        reviews: [
          {
            title: "Runs small",
            body: "The tee runs small and shrank after the first wash.",
            rating: 2,
            createdAt: "2026-05-10T12:00:00Z",
            sourceType: "yotpo_review",
            sourceLabel: "Yotpo reviews",
          },
          {
            title: "Fabric issue",
            body: "The fabric feels thin and scratchy during long runs.",
            rating: 2,
            createdAt: "2026-05-11T12:00:00Z",
            sourceType: "yotpo_review",
            sourceLabel: "Yotpo reviews",
          },
          {
            title: "Good color",
            body: "The color is nice and shipping was quick.",
            rating: 5,
            createdAt: "2026-05-12T12:00:00Z",
            sourceType: "yotpo_review",
            sourceLabel: "Yotpo reviews",
          },
        ],
      },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
    });
    const aiInput = __productPulseDiagnosisTestHooks.buildAiDeterministicInput(deterministic);
    const confidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 3,
      sourceCoverage: ["Yotpo reviews"],
      yotpoReviewMatchConfidence: 1,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 3,
      negativeReviewCount: 2,
      returnUnits: 0,
      refundUnits: 0,
    });

    expect(deterministic.metrics.reviewCount).toBe(3);
    expect(deterministic.metrics.yotpoReviewCount).toBe(3);
    expect(deterministic.metrics.rawReviewSourceStats.yotpo.negativeReviewCount).toBe(2);
    expect(deterministic.metrics.yotpoNegativeReviewCount).toBeGreaterThan(0);
    expect(deterministic.metrics.yotpoNegativeReviewCount).toBeLessThan(2);
    expect(deterministic.metrics.yotpoAverageRating).toBe(3);
    expect(deterministic.sourceCoverage).toContain("Yotpo reviews");
    expect(deterministic.evidenceSnippets.filter((snippet) => snippet.source === "yotpo_review")).toHaveLength(2);
    expect(deterministic.metrics.reviewSourceStats.yotpo).toMatchObject({
      reviewCount: 3,
      negativeReviewCount: deterministic.metrics.yotpoNegativeReviewCount,
      avgRating: 3,
    });
    expect(aiInput.metrics.yotpoReviewCount).toBe(3);
    expect(aiInput.metrics.yotpoNegativeReviewCount).toBe(deterministic.metrics.yotpoNegativeReviewCount);
    expect(confidence).toBeGreaterThan(0);
  });

  it("does not mark Yotpo as diagnosis source coverage when the API returns no reviews", () => {
    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        productGid: "gid://shopify/Product/987654321",
        productTitle: "Cloud Runner Tee",
        handle: "cloud-runner-tee",
        primaryIssue: "Product quality",
        metrics: {},
      },
      shopifyData: {
        product: {
          id: "gid://shopify/Product/987654321",
          numericId: "987654321",
          title: "Cloud Runner Tee",
          handle: "cloud-runner-tee",
          description: "Lightweight running tee with quick-dry fabric and a relaxed fit.",
          variants: [],
          tags: ["apparel", "running"],
          collections: ["Activewear"],
        },
        sales: [],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      yotpoData: { connected: true, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
    });

    expect(deterministic.metrics.yotpoReviewCount).toBe(0);
    expect(deterministic.sourceCoverage).not.toContain("Yotpo reviews");
  });

  it("uses Loox reviews as deep-diagnosis review evidence", () => {
    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        productGid: "gid://shopify/Product/987654321",
        productTitle: "Cloud Runner Tee",
        handle: "cloud-runner-tee",
        primaryIssue: "Product quality",
        metrics: {},
      },
      shopifyData: {
        product: {
          id: "gid://shopify/Product/987654321",
          numericId: "987654321",
          title: "Cloud Runner Tee",
          handle: "cloud-runner-tee",
          description: "Lightweight running tee with quick-dry fabric and a relaxed fit.",
          variants: [],
          tags: ["apparel", "running"],
          collections: ["Activewear"],
        },
        sales: [],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      yotpoData: { connected: false, reviews: [], matchConfidence: 0 },
      looxData: {
        connected: true,
        matchConfidence: 1,
        reviews: [
          {
            title: "Photo looked different",
            body: "The material looked thicker in the photos and felt thin in person.",
            rating: 2,
            createdAt: "2026-05-10T12:00:00Z",
            sourceType: "loox_review",
            sourceLabel: "Loox reviews",
          },
          {
            title: "Nice color",
            body: "The color is nice and the photo reviews helped me choose.",
            rating: 5,
            createdAt: "2026-05-12T12:00:00Z",
            sourceType: "loox_review",
            sourceLabel: "Loox reviews",
          },
        ],
      },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
    });
    const aiInput = __productPulseDiagnosisTestHooks.buildAiDeterministicInput(deterministic);
    const confidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 2,
      sourceCoverage: ["Loox reviews"],
      looxReviewMatchConfidence: 1,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 2,
      negativeReviewCount: 1,
      returnUnits: 0,
      refundUnits: 0,
    });

    expect(deterministic.metrics.reviewCount).toBe(2);
    expect(deterministic.metrics.looxReviewCount).toBe(2);
    expect(deterministic.metrics.rawReviewSourceStats.loox.negativeReviewCount).toBe(1);
    expect(deterministic.metrics.looxNegativeReviewCount).toBeGreaterThan(0);
    expect(deterministic.metrics.looxNegativeReviewCount).toBeLessThan(1);
    expect(deterministic.metrics.looxAverageRating).toBe(3.5);
    expect(deterministic.sourceCoverage).toContain("Loox reviews");
    expect(deterministic.evidenceSnippets.filter((snippet) => snippet.source === "loox_review")).toHaveLength(1);
    expect(deterministic.metrics.reviewSourceStats.loox).toMatchObject({
      reviewCount: 2,
      negativeReviewCount: deterministic.metrics.looxNegativeReviewCount,
      avgRating: 3.5,
    });
    expect(aiInput.metrics.looxReviewCount).toBe(2);
    expect(aiInput.metrics.looxNegativeReviewCount).toBe(deterministic.metrics.looxNegativeReviewCount);
    expect(confidence).toBeGreaterThan(0);
  });

  it("does not mark Loox as diagnosis source coverage when the API returns no reviews", () => {
    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        productGid: "gid://shopify/Product/987654321",
        productTitle: "Cloud Runner Tee",
        handle: "cloud-runner-tee",
        primaryIssue: "Product quality",
        metrics: {},
      },
      shopifyData: {
        product: {
          id: "gid://shopify/Product/987654321",
          numericId: "987654321",
          title: "Cloud Runner Tee",
          handle: "cloud-runner-tee",
          description: "Lightweight running tee with quick-dry fabric and a relaxed fit.",
          variants: [],
          tags: ["apparel", "running"],
          collections: ["Activewear"],
        },
        sales: [],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      yotpoData: { connected: false, reviews: [], matchConfidence: 0 },
      looxData: { connected: true, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
    });

    expect(deterministic.metrics.looxReviewCount).toBe(0);
    expect(deterministic.sourceCoverage).not.toContain("Loox reviews");
  });

  it("keeps complete zero Shopify refund extraction from falling back to stale snapshot refunds", () => {
    const deterministic = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        productGid: "gid://shopify/Product/8781291651160",
        productTitle: "GEN Aurora Ceramic Dinner Set",
        handle: "gen-ceramic-dinner-set-26a108d0",
        primaryIssue: "Product defect or durability",
        metrics: {
          soldUnits: 20,
          refundUnits: 7,
          refundAmount: 802,
          refundRate: 35,
        },
      },
      shopifyData: {
        product: {
          id: "gid://shopify/Product/8781291651160",
          numericId: "8781291651160",
          title: "GEN Aurora Ceramic Dinner Set",
          handle: "gen-ceramic-dinner-set-26a108d0",
          updatedAt: "2026-05-24T12:00:00.000Z",
          description: "Twelve-piece glazed ceramic dinnerware set with four dinner plates, four salad plates, and four bowls. Includes clear dimensions, dishwasher guidance, microwave guidance, protective packaging, and replacement instructions for transit damage.",
          variants: [],
          tags: ["dinnerware"],
          collections: ["Kitchen"],
        },
        sales: [
          { id: "order-1", orderId: "order-1", quantity: 3, amount: 180, createdAt: "2026-05-25T12:00:00.000Z" },
          { id: "order-2", orderId: "order-2", quantity: 4, amount: 240, createdAt: "2026-05-26T12:00:00.000Z" },
        ],
        refunds: [],
        returns: [],
        orderAccessDenied: false,
        sourceFetchComplete: {
          sales: true,
          refunds: true,
          returns: true,
        },
      },
      judgeMeData: { connected: false, reviews: [], matchConfidence: 0 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 60,
    });

    expect(deterministic.metrics.soldUnits).toBe(7);
    expect(deterministic.metrics.refundUnits).toBe(0);
    expect(deterministic.metrics.refundAmount).toBe(0);
    expect(deterministic.metrics.refundRate).toBe(0);
    expect(deterministic.metrics.refundInsights.shouldSurface).toBe(false);
    expect(deterministic.sourceCoverage).not.toContain("Shopify refunds");
    expect(deterministic.mainIssue).not.toBe("refund_impact");
  });

  it("reuses cached customer text analysis and only analyzes new text on incremental product diagnosis", () => {
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
          chartInterpretations: {
            insightVersion: "product_chart_interpretations_v1",
            status: "available",
            interpretations: {
              productRiskOverTime: { text: "Risk stayed stable across the stored evidence window." },
            },
          },
        },
      },
      deterministic: second,
    });

    expect(second.metrics.incrementalDiagnosis.customerText.mode).toBe("incremental");
    expect(second.metrics.incrementalDiagnosis.customerText.analyzedItems).toBe(0);
    expect(second.metrics.incrementalDiagnosis.aiEvidenceSnippetCount).toBe(0);
    expect(reuseDecision.shouldReuse).toBe(true);
  });

  it("blocks no-change reuse when a merchant-facing action was handled since the previous diagnosis", () => {
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
    const previousCompletedAt = daysAgo(3);
    const second = __productPulseDiagnosisTestHooks.calculateDeterministicDiagnosis({
      snapshot: {
        ...snapshot,
        riskScore: first.riskScore,
        confidence: first.confidence,
        metrics: {
          ...first.metrics,
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: previousCompletedAt,
        },
      },
      shopifyData: { product, sales: [], refunds: [], returns: [], orderAccessDenied: false },
      judgeMeData: { connected: true, reviews: [oldReview], matchConfidence: 1 },
      csvReviewData: { connected: false, reviews: [], matchConfidence: 0 },
      windowDays: 30,
    });
    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot,
      deterministic: second,
      previousDiagnosis: {
        id: "diagnosis-1",
        productGid: snapshot.productGid,
        riskScore: first.riskScore,
        confidence: first.confidence,
        likelyCause: "Product quality",
        recommendations: [{ id: "rewrite-product-description", label: "Rewrite product description" }],
        metrics: first.metrics,
        completedAt: previousCompletedAt,
      },
      actionRecords: [{
        id: "action-1",
        diagnosisId: "diagnosis-1",
        productGid: snapshot.productGid,
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { canonicalActionId: "rewrite-product-description" },
        createdAt: daysAgo(1),
        appliedAt: daysAgo(1),
      }],
      recommendationCandidates: [{ id: "rewrite-product-description", type: "PDP copy" }],
    });
    const secondWithEvolution = __productPulseDiagnosisTestHooks.attachProductEvolutionToDeterministic(second, productEvolution);
    const reuseDecision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        ...snapshot,
        riskScore: first.riskScore,
        confidence: first.confidence,
        metrics: {
          ...first.metrics,
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: previousCompletedAt,
          chartInterpretations: {
            insightVersion: "product_chart_interpretations_v1",
            status: "available",
            interpretations: {
              productRiskOverTime: { text: "Risk stayed stable across the stored evidence window." },
            },
          },
        },
      },
      deterministic: secondWithEvolution,
    });

    expect(productEvolution.transitionKind).toBe("actions_changed");
    expect(productEvolution.handledActionsSincePreviousDiagnosis).toHaveLength(1);
    expect(productEvolution.previousRecommendationLifecycle[0]).toMatchObject({
      actionId: "rewrite-product-description",
      lifecycleState: "monitoring",
      actionStatus: "applied",
    });
    expect(productEvolution.postActionStatus).toMatchObject({
      status: "monitoring",
      tone: "info",
    });
    expect(secondWithEvolution.metrics.productEvolution.summary).toContain("Handled actions since then");
    expect(reuseDecision.shouldReuse).toBe(false);
    expect(reuseDecision.blockers).toContain("product_actions_changed_since_previous_diagnosis");
    expect(reuseDecision.recommendationReevaluation.reason).toBe("handled_actions_may_affect_recommendations");
  });

  it("refreshes a fresh shared Shopify source cache when it lags behind the diagnosis start", () => {
    const behind = __productPulseDiagnosisTestHooks.getShopSourceEventCacheFreshness(
      "2026-06-08T03:34:13.994Z",
      { referenceAt: "2026-06-08T03:39:09.611Z" },
    );
    const caughtUp = __productPulseDiagnosisTestHooks.getShopSourceEventCacheFreshness(
      "2026-06-08T03:39:00.000Z",
      { referenceAt: "2026-06-08T03:39:09.611Z" },
    );

    expect(behind).toMatchObject({
      usable: false,
      stale: true,
      reason: "shop_source_event_cache_behind_diagnosis",
    });
    expect(caughtUp).toMatchObject({
      usable: true,
      stale: false,
      reason: "shop_source_event_cache_hit",
    });
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

  it("uses merged full-window source sales for product relationship timelines after cache refresh", () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sourceProductId = "gid://shopify/Product/cache-rel-source";
    const beforeProductId = "gid://shopify/Product/cache-rel-before";
    const afterProductId = "gid://shopify/Product/cache-rel-after";
    const snapshot = {
      shop: "relationship-cache-test.myshopify.com",
      productGid: sourceProductId,
      productTitle: "Cache REL Source Product",
      handle: "cache-rel-source-product",
      metrics: {},
    };
    const product = {
      id: sourceProductId,
      title: "Cache REL Source Product",
      handle: "cache-rel-source-product",
      description: "Relationship cache test source product.",
      descriptionHtml: "<p>Relationship cache test source product.</p>",
      variants: [{ id: "gid://shopify/ProductVariant/cache-rel-source", title: "Default Title", sku: "CACHE-REL-SOURCE", selectedOptions: [] }],
      options: [],
      tags: [],
      collections: [],
      media: [],
    };
    const previousCachedSales = [
      { type: "sale", id: "before-sale-c1", orderId: "before-order-c1", lineItemId: "before-line-c1", productId: beforeProductId, title: "Bought Before Cache", handle: "bought-before-cache", customerKey: "customer-1", quantity: 1, amount: 35, orderDate: daysAgo(35), createdAt: daysAgo(35) },
      { type: "sale", id: "source-sale-c1", orderId: "source-order-c1", lineItemId: "source-line-c1", productId: sourceProductId, title: "Cache REL Source Product", handle: "cache-rel-source-product", customerKey: "customer-1", quantity: 1, amount: 50, orderDate: daysAgo(20), createdAt: daysAgo(20) },
      { type: "sale", id: "before-sale-c2", orderId: "before-order-c2", lineItemId: "before-line-c2", productId: beforeProductId, title: "Bought Before Cache", handle: "bought-before-cache", customerKey: "customer-2", quantity: 1, amount: 35, orderDate: daysAgo(34), createdAt: daysAgo(34) },
      { type: "sale", id: "source-sale-c2", orderId: "source-order-c2", lineItemId: "source-line-c2", productId: sourceProductId, title: "Cache REL Source Product", handle: "cache-rel-source-product", customerKey: "customer-2", quantity: 1, amount: 50, orderDate: daysAgo(19), createdAt: daysAgo(19) },
    ];
    const incrementalRelationshipSales = [
      { type: "sale", id: "after-sale-c1", orderId: "after-order-c1", lineItemId: "after-line-c1", productId: afterProductId, title: "Bought After Cache", handle: "bought-after-cache", customerKey: "customer-1", quantity: 1, amount: 42, orderDate: daysAgo(6), createdAt: daysAgo(6) },
      { type: "sale", id: "after-sale-c2", orderId: "after-order-c2", lineItemId: "after-line-c2", productId: afterProductId, title: "Bought After Cache", handle: "bought-after-cache", customerKey: "customer-2", quantity: 1, amount: 42, orderDate: daysAgo(5), createdAt: daysAgo(5) },
    ];

    const merged = __productPulseDiagnosisTestHooks.mergeIncrementalSourceEvents({
      previous: { sales: previousCachedSales, refunds: [], returns: [] },
      current: { sales: incrementalRelationshipSales, refunds: [], returns: [] },
      windowDays: 60,
    });
    const relationshipSales = __productPulseDiagnosisTestHooks.selectDiagnosisRelationshipSalesForSummary({
      sourceSalesEvents: merged.sales,
      relationshipSales: incrementalRelationshipSales,
      backfilledSales: previousCachedSales.filter((saleEvent) => saleEvent.productId === sourceProductId),
    });

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

    expect(relationshipSales.map((event) => event.id)).toEqual([
      "before-sale-c1",
      "before-sale-c2",
      "source-sale-c1",
      "source-sale-c2",
      "after-sale-c1",
      "after-sale-c2",
    ]);
    expect(deterministic.metrics.productRelationshipIntelligenceSummary.top_bought_before[0]).toMatchObject({
      related_product_id: beforeProductId,
      relationship_direction: "before",
      customer_count: 2,
    });
    expect(deterministic.metrics.productRelationshipIntelligenceSummary.top_bought_after[0]).toMatchObject({
      related_product_id: afterProductId,
      relationship_direction: "after",
      customer_count: 2,
    });
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
        chartInterpretations: {
          insightVersion: "product_chart_interpretations_v1",
          status: "available",
          interpretations: {
            productRiskOverTime: { text: "Risk stayed stable across the stored evidence window." },
          },
        },
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
    expect(decision.recommendationReevaluation).toMatchObject({
      required: false,
      reason: "current_recommendations_remain_current",
      sufficientToSkip: true,
    });
  });

  it("reports cached model summaries with the reused model name and zero token usage", () => {
    const summary = __productPulseDiagnosisTestHooks.buildCachedAiModelSummary("content_gap", "previous-product-content-analysis");

    expect(summary).toMatchObject({
      task: "content_gap",
      model: "previous-product-content-analysis",
      provider: "cache",
      usage: {
        provider: "cache",
        model: "previous-product-content-analysis",
        task: "content_gap",
        requestContext: "cache",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        usageSource: "cache",
      },
    });
  });

  it("refreshes date-derived deterministic metrics without replacing cached Product Diagnosis data", () => {
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      riskScore: 48,
      impactScore: 2,
      confidence: 70,
      primaryIssue: "Product quality",
      sourceCoverage: ["Shopify orders"],
      metrics: {
        latestDiagnosisId: "diagnosis-1",
        lastDetailedDiagnosisAt: "2026-05-10T12:00:00.000Z",
        productMomentumScore: 68,
        productMomentumTier: "Warm",
        momentumDirection: "Stable",
        contentQualityRisk: 9,
        contentAnalysis: {
          issues: [{ code: "missing_fit_guidance", label: "Missing fit guidance" }],
        },
        diagnosisReport: {
          mainFinding: { title: "Previous AI finding" },
          chartInterpretations: { insightVersion: "product_chart_interpretations_v1" },
        },
        chartInterpretations: {
          insightVersion: "product_chart_interpretations_v1",
          interpretations: {
            productMomentum: { text: "Previous momentum interpretation." },
          },
        },
        incrementalDiagnosis: {
          cache: {
            sourceFingerprint: "fingerprint-1",
            productContent: { signature: "content-1" },
          },
        },
      },
    };
    const deterministic = {
      riskScore: 51,
      confidence: 72,
      mainIssueLabel: "Product quality",
      estimatedImpact: { estimatedImpact: 160, revenueAtRisk: 340, marginAtRisk: 90 },
      sourceCoverage: ["Shopify orders"],
      metrics: {
        productMomentum: { score: 74, tier: "Hot", direction: "Accelerating" },
        productMomentumScore: 74,
        productMomentumTier: "Hot",
        momentumDirection: "Accelerating",
        monthlyOrderActivity: { summary: { totalOrders: 3 } },
        estimatedImpact: 160,
        revenueAtRisk: 340,
        marginAtRisk: 90,
        contentQualityRisk: 2,
        incrementalDiagnosis: {
          productContent: { reused: true },
          customerText: { mode: "incremental", analyzedItems: 0 },
          refunds: { mode: "incremental", analyzedItems: 0 },
          cache: {
            sourceFingerprint: "fingerprint-1",
            sourceEvents: { sales: [] },
          },
        },
      },
    };

    const data = __productPulseDiagnosisTestHooks.buildNoChangeDiagnosisRefreshData({
      snapshot,
      deterministic,
      reuseDecision: { reason: "no_changes_since_previous_diagnosis", matchedBy: "source_fingerprint" },
    });

    expect(data.riskScore).toBe(48);
    expect(data.confidence).toBe(72);
    expect(data.impactScore).toBe(3);
    expect(data.metrics.productMomentumScore).toBe(74);
    expect(data.metrics.productMomentumTier).toBe("Hot");
    expect(data.metrics.momentumDirection).toBe("Accelerating");
    expect(data.metrics.contentQualityRisk).toBe(9);
    expect(data.metrics.contentAnalysis.issues[0].code).toBe("missing_fit_guidance");
    expect(data.metrics.latestDiagnosisId).toBe("diagnosis-1");
    expect(data.metrics.lastDetailedDiagnosisAt).toBe("2026-05-10T12:00:00.000Z");
    expect(data.metrics.diagnosisReport.mainFinding.title).toBe("Previous AI finding");
    expect(data.metrics.chartInterpretations.insightVersion).toBe("product_chart_interpretations_v1");
    expect(data.metrics.noChangeRefresh).toMatchObject({
      creditsConsumed: 0,
      aiCallsSkipped: true,
      dateDerivedMetricsRefreshed: true,
    });
  });

  it("reuses cached diagnosis when only date-window metrics changed and no source events were fetched", () => {
    const decision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        productGid: "gid://shopify/Product/123",
        riskScore: 48,
        confidence: 70,
        metrics: {
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: "2026-05-10T12:00:00.000Z",
          soldUnits: 8,
          returnUnits: 2,
          productMomentumScore: 68,
          chartInterpretations: {
            insightVersion: "product_chart_interpretations_v1",
            interpretations: {
              productMomentum: { text: "Momentum was warm on the previous run." },
            },
          },
        },
      },
      deterministic: {
        riskScore: 45,
        confidence: 71,
        estimatedImpact: { estimatedImpact: 100, revenueAtRisk: 220, marginAtRisk: 70 },
        evidenceSnippets: [],
        metrics: {
          soldUnits: 8,
          returnUnits: 1,
          productMomentum: { score: 74, tier: "Hot", direction: "Accelerating" },
          productMomentumScore: 74,
          productMomentumTier: "Hot",
          momentumDirection: "Accelerating",
          incrementalDiagnosis: {
            productContent: { reused: true },
            customerText: { mode: "incremental", analyzedItems: 0, reusedItems: 1 },
            refunds: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            sourceChanges: {
              previousFingerprint: "previous-window-fingerprint",
              currentFingerprint: "current-window-fingerprint",
              unchanged: false,
              sourceExtractionComplete: true,
              sourceEventFetch: {
                mode: "incremental_fetch",
                fetchComplete: true,
                rawFetchedCounts: {
                  salesEvents: 0,
                  refundEvents: 0,
                  returnEvents: 0,
                },
              },
            },
            aiEvidenceSnippetCount: 0,
          },
        },
      },
    });

    expect(decision.shouldReuse).toBe(true);
    expect(decision.matchedBy).toBe("date_derived_metrics");
    expect(decision.dateOnlyRefresh).toBe(true);
    expect(decision.blockers).not.toContain("source_or_material_metrics_changed");
    expect(decision.recommendationReevaluation).toMatchObject({
      required: false,
      sufficientToSkip: true,
      sourceFingerprintChanged: true,
    });
  });

  it("does not reuse cached diagnosis when stored refund metrics are unsupported by current source events", () => {
    const decision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        productGid: "gid://shopify/Product/8781291651160",
        primaryIssue: "Refund impact",
        metrics: {
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: "2026-05-30T12:00:00.000Z",
          soldUnits: 20,
          refundUnits: 7,
          refundAmount: 802,
          refundRate: 35,
          incrementalDiagnosis: {
            cache: {
              sourceFingerprint: "stale-refund-fingerprint",
              sourceEvents: {
                sales: [{ id: "sale-1", quantity: 7, amount: 342, createdAt: "2026-05-28T12:00:00.000Z" }],
                refunds: [],
                returns: [],
              },
            },
          },
        },
      },
      deterministic: {
        riskScore: 32,
        confidence: 66,
        estimatedImpact: { estimatedImpact: 0, revenueAtRisk: 0, marginAtRisk: 0 },
        evidenceSnippets: [],
        metrics: {
          soldUnits: 7,
          refundUnits: 0,
          refundAmount: 0,
          refundRate: 0,
          incrementalDiagnosis: {
            productContent: { reused: true },
            customerText: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            refunds: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            sourceChanges: {
              previousFingerprint: "stale-refund-fingerprint",
              currentFingerprint: "corrected-no-refund-fingerprint",
              unchanged: false,
              sourceExtractionComplete: true,
              sourceFetchComplete: { sales: true, refunds: true, returns: true },
              sourceEventFetch: {
                mode: "incremental_fetch",
                fetchComplete: true,
                rawFetchedCounts: { salesEvents: 0, refundEvents: 0, returnEvents: 0 },
                mergedCounts: { salesEvents: 1, refundEvents: 0, returnEvents: 0 },
              },
            },
            aiEvidenceSnippetCount: 0,
          },
        },
      },
    });

    expect(decision.shouldReuse).toBe(false);
    expect(decision.sourceMetricCorrection).toBe(true);
    expect(decision.dateOnlyRefresh).toBe(false);
    expect(decision.blockers).toContain("stored_source_metrics_not_supported_by_current_source_events");
  });

  it("does not reuse cached diagnosis when stored chart interpretations are missing", () => {
    const fingerprint = __productPulseDiagnosisTestHooks.buildDiagnosisSourceFingerprint({
      productContentSignature: "product-signature-1",
      sales: [{ id: "sale-1", quantity: 2, amount: 80, createdAt: "2026-05-01T12:00:00.000Z" }],
      returns: [],
      refunds: [],
      judgeMeReviews: [],
      csvReviews: [],
      sourceCoverage: ["Shopify product", "Shopify orders"],
      windowDays: 60,
    });
    const decision = __productPulseDiagnosisTestHooks.getNoChangeDiagnosisReuseDecision({
      snapshot: {
        productGid: "gid://shopify/Product/123",
        riskScore: 62,
        confidence: 65,
        metrics: {
          latestDiagnosisId: "diagnosis-1",
          lastDetailedDiagnosisAt: "2026-05-10T12:00:00.000Z",
          soldUnits: 2,
          riskScore: 62,
          confidence: 65,
        },
      },
      deterministic: {
        riskScore: 62,
        confidence: 65,
        estimatedImpact: { estimatedImpact: 120, revenueAtRisk: 260, marginAtRisk: 120 },
        evidenceSnippets: [],
        metrics: {
          soldUnits: 2,
          riskScore: 62,
          confidence: 65,
          monthlyOrderActivity: {
            months: [{ key: "2026-05", orders: 1, orderUnits: 2, revenue: 80 }],
            summary: { totalOrders: 1, totalOrderUnits: 2, totalRevenue: 80 },
          },
          incrementalDiagnosis: {
            productContent: { reused: true },
            customerText: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            refunds: { mode: "incremental", analyzedItems: 0, reusedItems: 0 },
            sourceChanges: {
              previousFingerprint: fingerprint,
              currentFingerprint: fingerprint,
              unchanged: true,
            },
            aiEvidenceSnippetCount: 0,
          },
        },
      },
    });

    expect(decision.shouldReuse).toBe(false);
    expect(decision.blockers).toContain("missing_chart_interpretations");
    expect(decision.chartInterpretationReuse).toMatchObject({
      required: true,
      available: false,
      textCount: 0,
    });
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
    expect(decision.recommendationReevaluation).toMatchObject({
      required: true,
      reason: "changes_may_affect_recommendations",
      sourceFingerprintChanged: true,
    });
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

  it("keeps product-detail chart data in the compact deterministic AI input", () => {
    const aiInput = __productPulseDiagnosisTestHooks.buildAiDeterministicInput({
      riskScore: 84,
      confidence: 90,
      mainIssue: "product_quality",
      mainIssueLabel: "Product quality",
      metrics: {
        soldUnits: 12,
        returnUnits: 7,
        returnRate: 58.33,
        refundUnits: 3,
        refundRate: 25,
        refundAmount: 116,
        reviewCount: 0,
        negativeReviewCount: 0,
        signalCount: 10,
        monthlyOrderActivity: {
          months: [
            { key: "2026-04", label: "Apr 2026", orders: 4, orderUnits: 4, returnedUnits: 2, refundedUnits: 1, revenue: 120, refundAmount: 48 },
            { key: "2026-05", label: "May 2026", orders: 7, orderUnits: 8, returnedUnits: 5, refundedUnits: 2, revenue: 246, refundAmount: 68 },
          ],
          summary: { totalOrders: 11, totalOrderUnits: 12, totalReturnedUnits: 7, totalRefundedUnits: 3, totalRevenue: 366, totalRefundAmount: 116, returnRate: 58.33, refundRate: 25 },
        },
        returnRatePrediction: {
          observedPoints: [{ key: "2026-W19", label: "W19", orders: 5, orderUnits: 6, returnedUnits: 4, smoothedReturnRate: 48 }],
          forecastPoints: [{ key: "2026-W20", label: "W20", predictedReturnRate: 42, basePredictedReturnRate: 45 }],
          summary: { totalOrderUnits: 12, totalReturnedUnits: 7, totalReturnRate: 58.33, forecastNext90ReturnRate: 41.86, confidence: "Low" },
        },
        productRetention: {
          summary: { totalCustomersAnalyzed: 7, totalOrdersAnalyzed: 14, retentionHealthScore: 93, repeatPurchaseRate90d: 1, sameProductRepurchaseRate90d: 0.857143, hasEnoughData: true },
          retentionHealthTrend: [{ date: "2026-05-01", retentionHealthScore: 93, repeatPurchaseRate90d: 1 }],
        },
        productMomentum: {
          score: 77,
          tier: "Active",
          direction: "rising",
          confidence: 82,
          inputs: { unitsLast7Days: 2, unitsLast30Days: 8, unitsPrevious30Days: 4, revenueLast30Days: 246, weeklyUnitsLast4Weeks: [1, 1, 2, 4] },
          components: { currentVelocityScore: 74, growthScore: 80, catalogShareScore: 70, trendConsistencyScore: 68, recencyScore: 95 },
          display: { trendLabel: "Sales activity rising" },
        },
        reconstructedRiskHistory: [
          { label: "Apr 2026", riskScore: 71, confidence: 88, returnRate: 35, refundRate: 10 },
          { label: "May 2026", riskScore: 84, confidence: 90, returnRate: 58.33, refundRate: 25 },
        ],
      },
    });

    expect(aiInput.metrics.monthlyOrderActivity).toMatchObject({ available: true });
    expect(aiInput.metrics.monthlyOrderActivity.months).toHaveLength(2);
    expect(aiInput.metrics.returnRatePrediction).toMatchObject({ available: true });
    expect(aiInput.metrics.returnRatePrediction.forecastPoints).toHaveLength(1);
    expect(aiInput.metrics.productRetention).toMatchObject({ available: true, retentionHealthScore: 93 });
    expect(aiInput.metrics.productMomentum).toMatchObject({ available: true, score: 77 });
    expect(aiInput.metrics.riskHistory).toHaveLength(2);
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

  it("suppresses exact handled recommendations during action-only reanalysis", () => {
    const deterministic = {
      mainIssue: "product_content",
      mainIssueLabel: "Product content",
      riskScore: 68,
      confidence: 82,
      issueSignalCounts: { product_content: 1 },
      product: {
        id: "gid://shopify/Product/handled-description",
        title: "Handled Description Product",
        handle: "handled-description-product",
        description: "",
        variants: [],
        media: [],
      },
      metrics: {
        customerSignalCount: 0,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 0,
        signalCount: 1,
        topReturnReasons: [],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 1,
        contentAnalysis: {
          issues: [{
            code: "missing_description",
            label: "Missing product description",
            severity: "high",
            evidence: "The product description is missing.",
          }],
          advisories: [],
        },
        textInsights: { sentiment: { total: 0, negative: 0, negativeRatio: 0 }, repeatedLanguage: [] },
        refundInsights: {},
        mediaCount: 1,
        mediaWithoutAltCount: 0,
      },
    };
    const previousCompletedAt = "2026-05-10T00:00:00.000Z";
    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot: {
        productGid: deterministic.product.id,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      previousDiagnosis: {
        id: "diagnosis-previous",
        productGid: deterministic.product.id,
        riskScore: 68,
        confidence: 82,
        likelyCause: "Product content",
        recommendations: [{ id: "rewrite-product-description", label: "Rewrite product description" }],
        metrics: { contentIssueCount: 1 },
        completedAt: previousCompletedAt,
      },
      actionRecords: [{
        id: "action-previous",
        diagnosisId: "diagnosis-previous",
        productGid: deterministic.product.id,
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { canonicalActionId: "rewrite-product-description" },
        createdAt: "2026-05-11T00:00:00.000Z",
        appliedAt: "2026-05-11T00:00:00.000Z",
      }],
      recommendationCandidates: [{ id: "rewrite-product-description", type: "PDP copy" }],
    });
    const deterministicWithEvolution = __productPulseDiagnosisTestHooks.attachProductEvolutionToDeterministic(deterministic, productEvolution);

    const filteredCandidates = __productPulseDiagnosisTestHooks.applyProductEvolutionToRecommendationCandidates(
      [{ id: "rewrite-product-description", type: "PDP copy" }, { id: "add-to-watchlist", type: "Watchlist" }],
      productEvolution,
    );
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: deterministic.product.id,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic: deterministicWithEvolution,
      ai: {
        report: {
          recommendation_copy: {
            product_description: "A clear replacement description for shoppers.",
          },
        },
      },
      mainIssue: "product_content",
    });

    expect(productEvolution.transitionKind).toBe("actions_changed");
    expect(productEvolution.previousRecommendationLifecycle[0]).toMatchObject({
      actionId: "rewrite-product-description",
      lifecycleState: "monitoring",
      actionStatus: "applied",
    });
    expect(productEvolution.postActionStatus.nextBestStep).toContain("Watchlist");
    expect(filteredCandidates.map((candidate) => candidate.id)).not.toContain("rewrite-product-description");
    expect(recommendations.map((item) => item.id)).not.toContain("rewrite-product-description");
  });

  it("marks a handled recommendation as reopened when new post-action evidence still supports the issue", () => {
    const deterministic = {
      mainIssue: "product_content",
      mainIssueLabel: "Product content",
      riskScore: 72,
      confidence: 80,
      issueSignalCounts: { product_content: 1 },
      sourceCoverage: ["Shopify products", "Reviews"],
      estimatedImpact: { revenueAtRisk: 0 },
      product: {
        id: "gid://shopify/Product/reopened",
        title: "Reopened Content Product",
        handle: "reopened-content-product",
        description: "",
        descriptionHtml: "",
        variants: [],
        media: [],
      },
      metrics: {
        customerSignalCount: 1,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 1,
        signalCount: 2,
        topReturnReasons: [],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 1,
        incrementalDiagnosis: {
          mode: "incremental",
          customerText: { analyzedItems: 1, reason: "new review text" },
          cache: {
            customerText: {
              returnItems: [],
              reviewItems: [{
                key: "review-after-action",
                source: "reviews",
                text: "The description is still missing the important detail.",
                issueCode: "product_content",
                createdAt: "2026-05-12T00:00:00.000Z",
                updatedAt: "2026-05-12T00:00:00.000Z",
              }],
            },
            refunds: { items: [] },
            sourceEvents: {
              sales: [],
              returns: [],
              refunds: [],
            },
          },
        },
        contentAnalysis: {
          issues: [{
            code: "missing_description",
            issueCode: "product_content",
            label: "Missing product description",
            severity: "high",
            evidence: "The product description is still missing after the prior action.",
          }],
          advisories: [],
        },
        textInsights: { sentiment: { total: 1, negative: 1, negativeRatio: 1 }, repeatedLanguage: [] },
        refundInsights: {},
        mediaCount: 1,
        mediaWithoutAltCount: 0,
      },
      evidenceSnippets: [{
        source: "review",
        text: "The description is still missing the important detail.",
        createdAt: "2026-05-12T00:00:00.000Z",
      }],
    };
    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot: {
        productGid: deterministic.product.id,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      previousDiagnosis: {
        id: "diagnosis-previous-reopened",
        productGid: deterministic.product.id,
        riskScore: 70,
        confidence: 78,
        likelyCause: "Product content",
        issues: [{ issue: "Product content", issueCode: "product_content" }],
        recommendations: [{ id: "rewrite-product-description", label: "Rewrite product description" }],
        metrics: { contentIssueCount: 1, signalCount: 1 },
        completedAt: "2026-05-10T00:00:00.000Z",
      },
      actionRecords: [{
        id: "action-reopened",
        diagnosisId: "diagnosis-previous-reopened",
        productGid: deterministic.product.id,
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { canonicalActionId: "rewrite-product-description" },
        createdAt: "2026-05-11T00:00:00.000Z",
        appliedAt: "2026-05-11T00:00:00.000Z",
      }],
      recommendationCandidates: [{ id: "rewrite-product-description", type: "PDP copy" }],
    });
    const filteredCandidates = __productPulseDiagnosisTestHooks.applyProductEvolutionToRecommendationCandidates(
      [{ id: "rewrite-product-description", type: "PDP copy" }],
      productEvolution,
    );
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: deterministic.product.id,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic: __productPulseDiagnosisTestHooks.attachProductEvolutionToDeterministic(deterministic, productEvolution),
      ai: {
        report: {
          recommendation_copy: {
            product_description: "A clear replacement description for shoppers.",
          },
        },
      },
      mainIssue: "product_content",
    });

    expect(productEvolution.previousRecommendationLifecycle[0].lifecycleState).toBe("reopened/persistent");
    expect(productEvolution.postActionStatus.status).toBe("reopened_persistent");
    expect(filteredCandidates.map((candidate) => candidate.id)).toContain("rewrite-product-description");
    expect(recommendations.find((item) => item.id === "rewrite-product-description")?.payload).toMatchObject({
      lifecycleState: "reopened/persistent",
      recommendedTreatment: "escalate_persistent_issue",
    });
  });

  it("does not reopen a handled fit recommendation when post-action evidence points to quality instead", () => {
    const productId = "gid://shopify/Product/gen-linen-shirt-fit-26a108d0";
    const oldFitReturn = {
      id: "return-old-fit",
      orderId: "order-old-fit",
      lineItemId: "line-old-fit",
      returnLineItemId: "return-line-old-fit",
      productId,
      quantity: 7,
      reasonLabel: "Too small",
      issueCode: "fit_sizing",
      createdAt: "2026-06-08T04:02:00.000Z",
      updatedAt: "2026-06-08T04:02:00.000Z",
    };
    const newQualityReturn = {
      id: "return-new-quality",
      orderId: "order-new-quality",
      lineItemId: "line-new-quality",
      returnLineItemId: "return-line-new-quality",
      productId,
      quantity: 4,
      reasonLabel: "Damaged or defective",
      issueCode: "quality_defect",
      createdAt: "2026-06-08T04:11:07.000Z",
      updatedAt: "2026-06-08T04:11:07.000Z",
    };
    const newQualityRefund = {
      id: "refund-new-quality",
      refundId: "refund-new-quality",
      refundLineItemId: "refund-line-new-quality",
      orderId: "order-new-quality",
      lineItemId: "line-new-quality",
      productId,
      quantity: 4,
      amount: 192,
      reasonLabel: "Damaged or defective",
      issueCode: "quality_defect",
      createdAt: "2026-06-08T04:11:18.000Z",
      processedAt: "2026-06-08T04:11:18.000Z",
      updatedAt: "2026-06-08T04:11:18.000Z",
    };
    const deterministic = {
      mainIssue: "quality_defect",
      mainIssueLabel: "Product quality",
      riskScore: 64,
      confidence: 88,
      issueSignalCounts: { fit_sizing: 7, quality_defect: 2 },
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      estimatedImpact: { revenueAtRisk: 192 },
      product: {
        id: productId,
        title: "Generic Linen Shirt",
        handle: "gen-linen-shirt-fit-26a108d0",
        description: "Linen shirt with fit note already applied.",
        descriptionHtml: "<p>Linen shirt with fit note already applied.</p>",
        variants: [],
        media: [],
      },
      metrics: {
        soldUnits: 45,
        returnUnits: 12,
        refundUnits: 8,
        returnRate: 26.67,
        refundRate: 17.78,
        signalCount: 9,
        contentIssueCount: 0,
        topReturnReasons: [{ reason: "damaged-or-defective", count: 4 }],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        incrementalDiagnosis: {
          mode: "incremental",
          customerText: { analyzedItems: 1, reason: "new return text" },
          refunds: { analyzedItems: 1, reason: "new refund context" },
          cache: {
            customerText: {
              returnItems: [{
                key: "return-text-new-quality",
                source: "returns",
                text: "Damaged or defective item returned.",
                issueCode: "quality_defect",
                createdAt: "2026-06-08T04:11:07.000Z",
                updatedAt: "2026-06-08T04:11:07.000Z",
              }],
              reviewItems: [],
            },
            refunds: {
              items: [{
                key: "refund-text-new-quality",
                source: "refunds",
                text: "Refunded four damaged or defective units.",
                issueCode: "quality_defect",
                createdAt: "2026-06-08T04:11:18.000Z",
                updatedAt: "2026-06-08T04:11:18.000Z",
              }],
            },
            sourceEvents: {
              sales: [],
              returns: [oldFitReturn, newQualityReturn],
              refunds: [newQualityRefund],
            },
          },
        },
        contentAnalysis: { issues: [], advisories: [] },
        textInsights: { sentiment: { total: 1, negative: 1, negativeRatio: 1 }, repeatedLanguage: [] },
        refundInsights: { dominantIssueCode: "quality_defect" },
      },
      evidenceSnippets: [{
        source: "refund",
        text: "Refunded four damaged or defective units.",
        issueCode: "quality_defect",
        createdAt: "2026-06-08T04:11:18.000Z",
      }],
    };

    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot: {
        productGid: productId,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      previousDiagnosis: {
        id: "diagnosis-previous-fit",
        productGid: productId,
        riskScore: 85,
        confidence: 80,
        likelyCause: "Fit & sizing",
        issues: [{ issue: "Fit & sizing", issueCode: "fit_sizing" }],
        recommendations: [{ id: "draft-fit-note", label: "Draft fit note for product description" }],
        metrics: {
          soldUnits: 16,
          returnUnits: 8,
          refundUnits: 4,
          returnRate: 50,
          refundRate: 25,
          signalCount: 7,
          incrementalDiagnosis: {
            cache: {
              sourceEvents: {
                sales: [],
                returns: [oldFitReturn],
                refunds: [],
              },
            },
          },
        },
        completedAt: "2026-06-08T04:10:07.000Z",
      },
      actionRecords: [{
        id: "action-fit-note",
        diagnosisId: "diagnosis-previous-fit",
        productGid: productId,
        actionType: "draft-fit-note",
        label: "Draft fit note for product description",
        status: "applied",
        payload: { canonicalActionId: "draft-fit-note", issue: "fit_sizing" },
        createdAt: "2026-06-08T04:10:30.000Z",
        appliedAt: "2026-06-08T04:10:30.000Z",
      }],
      recommendationCandidates: [
        { id: "draft-fit-note", type: "PDP copy" },
        { id: "recommend-qa-review", type: "Operational QA" },
      ],
    });
    const filteredCandidates = __productPulseDiagnosisTestHooks.applyProductEvolutionToRecommendationCandidates(
      [{ id: "draft-fit-note", type: "PDP copy" }, { id: "recommend-qa-review", type: "Operational QA" }],
      productEvolution,
    );
    const fitLifecycle = productEvolution.previousRecommendationLifecycle.find((entry) => entry.actionId === "draft-fit-note");

    expect(productEvolution.sourceSummary.hasNewEvidence).toBe(true);
    expect(productEvolution.sourceSummary.postActionIssueKeys).toContain("quality_defect");
    expect(productEvolution.sourceSummary.postActionIssueKeys).not.toContain("fit_sizing");
    expect(fitLifecycle).toMatchObject({
      lifecycleState: "applied",
      actionStatus: "applied",
      subjectIssueKeys: ["fit_sizing"],
    });
    expect(fitLifecycle.postActionEvidence.issueChanges.persisting.map((issue) => issue.key)).not.toContain("fit_sizing");
    expect(fitLifecycle.reason).not.toContain("still shows Fit & sizing");
    expect(productEvolution.postActionStatus.status).toBe("changed");
    expect(productEvolution.postActionStatus.summary).not.toContain("same issue");
    expect(filteredCandidates.map((candidate) => candidate.id)).not.toContain("draft-fit-note");
    expect(filteredCandidates.map((candidate) => candidate.id)).toContain("recommend-qa-review");
  });

  it("keeps handled recommendations in monitoring when only historical evidence still matches the issue", () => {
    const deterministic = {
      mainIssue: "product_content",
      mainIssueLabel: "Product content",
      riskScore: 72,
      confidence: 80,
      issueSignalCounts: { product_content: 1 },
      sourceCoverage: ["Shopify products", "Reviews"],
      estimatedImpact: { revenueAtRisk: 0 },
      product: {
        id: "gid://shopify/Product/no-new-post-action",
        title: "No New Evidence Product",
        handle: "no-new-evidence-product",
        description: "",
        descriptionHtml: "",
        variants: [],
        media: [],
      },
      metrics: {
        customerSignalCount: 1,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 1,
        signalCount: 2,
        topReturnReasons: [],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 1,
        incrementalDiagnosis: {
          mode: "incremental",
          aiEvidenceSnippetCount: 1,
          customerText: { analyzedItems: 0, reason: "previous_cache_reused" },
          cache: {
            customerText: {
              returnItems: [],
              reviewItems: [{
                key: "review-before-action",
                source: "reviews",
                text: "The description is missing the important detail.",
                issueCode: "product_content",
                createdAt: "2026-05-09T00:00:00.000Z",
                updatedAt: "2026-05-09T00:00:00.000Z",
              }],
            },
            refunds: { items: [] },
            sourceEvents: {
              sales: [],
              returns: [],
              refunds: [],
            },
          },
        },
        contentAnalysis: {
          issues: [{
            code: "missing_description",
            issueCode: "product_content",
            label: "Missing product description",
            severity: "high",
            evidence: "The product description is still missing, but the only customer evidence predates the action.",
          }],
          advisories: [],
        },
        textInsights: { sentiment: { total: 1, negative: 1, negativeRatio: 1 }, repeatedLanguage: [] },
        refundInsights: {},
        mediaCount: 1,
        mediaWithoutAltCount: 0,
      },
      evidenceSnippets: [{
        source: "review",
        text: "The description is missing the important detail.",
        createdAt: "2026-05-09T00:00:00.000Z",
      }],
    };
    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot: {
        productGid: deterministic.product.id,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      previousDiagnosis: {
        id: "diagnosis-previous-no-new-evidence",
        productGid: deterministic.product.id,
        riskScore: 70,
        confidence: 78,
        likelyCause: "Product content",
        issues: [{ issue: "Product content", issueCode: "product_content" }],
        recommendations: [{ id: "rewrite-product-description", label: "Rewrite product description" }],
        metrics: { contentIssueCount: 1, signalCount: 1 },
        completedAt: "2026-05-10T00:00:00.000Z",
      },
      actionRecords: [{
        id: "action-no-new-evidence",
        diagnosisId: "diagnosis-previous-no-new-evidence",
        productGid: deterministic.product.id,
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { canonicalActionId: "rewrite-product-description" },
        createdAt: "2026-05-11T00:00:00.000Z",
        appliedAt: "2026-05-11T00:00:00.000Z",
      }],
      recommendationCandidates: [{ id: "rewrite-product-description", type: "PDP copy" }],
    });
    const filteredCandidates = __productPulseDiagnosisTestHooks.applyProductEvolutionToRecommendationCandidates(
      [{ id: "rewrite-product-description", type: "PDP copy" }, { id: "add-to-watchlist", type: "Watchlist" }],
      productEvolution,
    );

    expect(productEvolution.sourceSummary.hasNewEvidence).toBe(false);
    expect(productEvolution.previousRecommendationLifecycle[0].lifecycleState).toBe("monitoring");
    expect(productEvolution.previousRecommendationLifecycle[0].postActionEvidence.hasPostActionEvidence).toBe(false);
    expect(productEvolution.postActionStatus.status).toBe("monitoring");
    expect(productEvolution.postActionStatus.summary).toContain("not enough post-action evidence");
    expect(filteredCandidates.map((candidate) => candidate.id)).not.toContain("rewrite-product-description");
  });

  it("treats newly cached historical Shopify source events as evolution evidence", () => {
    const productId = "gid://shopify/Product/newly-cached-historical-order";
    const knownSale = {
      id: "known-sale",
      orderId: "known-order",
      lineItemId: "known-line",
      productId,
      quantity: 1,
      amount: 40,
      orderDate: "2026-05-08T00:00:00.000Z",
      orderProcessedAt: "2026-05-08T00:00:00.000Z",
      orderCreatedAt: "2026-05-08T00:00:00.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    };
    const newlyCachedSale = {
      id: "newly-cached-historical-sale",
      orderId: "newly-cached-order",
      lineItemId: "newly-cached-line",
      productId,
      quantity: 1,
      amount: 48,
      orderDate: "2026-05-09T00:00:00.000Z",
      orderProcessedAt: "2026-05-09T00:00:00.000Z",
      orderCreatedAt: "2026-05-09T00:00:00.000Z",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };
    const deterministic = {
      riskScore: 70,
      confidence: 78,
      mainIssue: "product_content",
      mainIssueLabel: "Product content",
      product: {
        id: productId,
        title: "Newly Cached Historical Product",
        handle: "newly-cached-historical-product",
        description: "",
        descriptionHtml: "",
        variants: [],
        media: [],
      },
      metrics: {
        signalCount: 1,
        contentIssueCount: 1,
        incrementalDiagnosis: {
          mode: "incremental",
          aiEvidenceSnippetCount: 0,
          customerText: { analyzedItems: 0, reason: "previous_cache_reused" },
          cache: {
            customerText: { returnItems: [], reviewItems: [] },
            refunds: { items: [] },
            sourceEvents: {
              sales: [knownSale, newlyCachedSale],
              returns: [],
              refunds: [],
            },
          },
        },
        contentAnalysis: {
          issues: [{
            code: "missing_description",
            issueCode: "product_content",
            label: "Missing product description",
            severity: "high",
          }],
          advisories: [],
        },
        textInsights: { sentiment: { total: 0, negative: 0, negativeRatio: 0 }, repeatedLanguage: [] },
        refundInsights: {},
      },
      evidenceSnippets: [],
    };

    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot: {
        productGid: productId,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      previousDiagnosis: {
        id: "diagnosis-previous-newly-cached",
        productGid: productId,
        riskScore: 70,
        confidence: 78,
        likelyCause: "Product content",
        issues: [{ issue: "Product content", issueCode: "product_content" }],
        recommendations: [{ id: "rewrite-product-description", label: "Rewrite product description" }],
        metrics: {
          contentIssueCount: 1,
          signalCount: 1,
          incrementalDiagnosis: {
            cache: {
              sourceEvents: {
                sales: [knownSale],
                returns: [],
                refunds: [],
              },
            },
          },
        },
        completedAt: "2026-05-10T00:00:00.000Z",
      },
      actionRecords: [{
        id: "action-newly-cached",
        diagnosisId: "diagnosis-previous-newly-cached",
        productGid: productId,
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { canonicalActionId: "rewrite-product-description" },
        createdAt: "2026-05-11T00:00:00.000Z",
        appliedAt: "2026-05-11T00:00:00.000Z",
      }],
      recommendationCandidates: [{ id: "rewrite-product-description", type: "PDP copy" }],
    });

    expect(productEvolution.transitionKind).toBe("actions_and_evidence_changed");
    expect(productEvolution.sourceSummary.hasNewEvidence).toBe(true);
    expect(productEvolution.sourceSummary.eventCounts.salesEvents).toBe(1);
    expect(productEvolution.sourceSummary.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "orders", label: "New/current orders", count: 1 }),
    ]));
  });

  it("uses Shopify occurrence dates before cache update dates for post-action evidence", () => {
    const deterministic = {
      mainIssue: "product_content",
      mainIssueLabel: "Product content",
      riskScore: 72,
      confidence: 80,
      issueSignalCounts: { product_content: 1 },
      sourceCoverage: ["Shopify products", "Shopify orders"],
      estimatedImpact: { revenueAtRisk: 0 },
      product: {
        id: "gid://shopify/Product/historical-order-update",
        title: "Historical Order Update Product",
        handle: "historical-order-update-product",
        description: "",
        descriptionHtml: "",
        variants: [],
        media: [],
      },
      metrics: {
        customerSignalCount: 0,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 0,
        signalCount: 1,
        topReturnReasons: [],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 1,
        incrementalDiagnosis: {
          mode: "incremental",
          aiEvidenceSnippetCount: 0,
          customerText: { analyzedItems: 0, reason: "previous_cache_reused" },
          cache: {
            customerText: { returnItems: [], reviewItems: [] },
            refunds: { items: [] },
            sourceEvents: {
              sales: [{
                id: "historical-sale-updated-after-action",
                orderId: "historical-order",
                lineItemId: "historical-line",
                productId: "gid://shopify/Product/historical-order-update",
                quantity: 1,
                amount: 40,
                orderDate: "2026-05-09T00:00:00.000Z",
                orderProcessedAt: "2026-05-09T00:00:00.000Z",
                orderCreatedAt: "2026-05-09T00:00:00.000Z",
                createdAt: "2026-05-12T00:00:00.000Z",
                updatedAt: "2026-05-12T00:00:00.000Z",
              }],
              returns: [],
              refunds: [],
            },
          },
        },
        contentAnalysis: {
          issues: [{
            code: "missing_description",
            issueCode: "product_content",
            label: "Missing product description",
            severity: "high",
            evidence: "The only Shopify order evidence occurred before the action.",
          }],
          advisories: [],
        },
        textInsights: { sentiment: { total: 0, negative: 0, negativeRatio: 0 }, repeatedLanguage: [] },
        refundInsights: {},
        mediaCount: 1,
        mediaWithoutAltCount: 0,
      },
      evidenceSnippets: [],
    };
    const productEvolution = __productPulseDiagnosisTestHooks.buildProductDiagnosisEvolutionContextFromRecords({
      snapshot: {
        productGid: deterministic.product.id,
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      previousDiagnosis: {
        id: "diagnosis-previous-historical-order-update",
        productGid: deterministic.product.id,
        riskScore: 70,
        confidence: 78,
        likelyCause: "Product content",
        issues: [{ issue: "Product content", issueCode: "product_content" }],
        recommendations: [{ id: "rewrite-product-description", label: "Rewrite product description" }],
        metrics: { contentIssueCount: 1, signalCount: 1 },
        completedAt: "2026-05-10T00:00:00.000Z",
      },
      actionRecords: [{
        id: "action-historical-order-update",
        diagnosisId: "diagnosis-previous-historical-order-update",
        productGid: deterministic.product.id,
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "applied",
        payload: { canonicalActionId: "rewrite-product-description" },
        createdAt: "2026-05-11T00:00:00.000Z",
        appliedAt: "2026-05-11T00:00:00.000Z",
      }],
      recommendationCandidates: [{ id: "rewrite-product-description", type: "PDP copy" }],
    });

    expect(productEvolution.sourceSummary.hasNewEvidence).toBe(false);
    expect(productEvolution.sourceSummary.eventCounts.salesEvents).toBe(0);
    expect(productEvolution.sourceSummary.postBaseline.latestEvidenceAt).toBeNull();
    expect(productEvolution.postActionStatus.status).toBe("monitoring");
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

  it("structures legacy FAQ answers as compatibility questions instead of answer-only drafts", () => {
    const answer = [
      "Cases with wallet flaps, card sleeves, ring holders, pop-grips, metal plates, thick bumpers, or raised case lips may prevent proper alignment and charging.",
      "If you use one of these case styles every day, please confirm compatibility before ordering or plan to use the stand with a bare phone or a verified magnetic-compatible case.",
    ].join(" ");

    const legacyItems = __productPulseDiagnosisTestHooks.buildRecommendedFaqItems({
      copy: { faq_answer: answer },
      snapshot: { productTitle: "GEN Magnetic Charging Stand" },
      mainIssue: "compatibility",
      faqNeed: { topics: ["Compatibility"] },
      currentDescriptionText: "",
    });
    const malformedAiItems = __productPulseDiagnosisTestHooks.buildRecommendedFaqItems({
      copy: { faq_items: [{ answer, reason: "Compatibility answer was generated without a question." }] },
      snapshot: { productTitle: "GEN Magnetic Charging Stand" },
      mainIssue: "compatibility",
      faqNeed: { topics: ["Compatibility"] },
      currentDescriptionText: "",
    });

    expect(legacyItems[0]).toMatchObject({
      question: "Which phone cases may prevent proper alignment or charging?",
      answer,
    });
    expect(malformedAiItems[0]).toMatchObject({
      question: "Which phone cases may prevent proper alignment or charging?",
      answer,
    });
  });

  it("keeps the product template switch action disabled even when template signals qualify", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 78,
      confidence: 88,
      evidenceSnippets: [
        { text: "Customers repeatedly ask for setup steps, specifications and product expectations." },
      ],
      issueSignalCounts: { product_content: 5 },
      product: {
        title: "GEN Guided Setup Kit",
        description: "Short setup kit description.",
        templateSuffix: "",
      },
      metrics: {
        customerSignalCount: 5,
        signalCount: 9,
        returnUnits: 2,
        refundUnits: 1,
        negativeReviewCount: 3,
        contentIssueCount: 2,
        specsBlockRecommended: true,
        templateNeedsReview: true,
        faqNeed: {
          shouldRecommend: true,
          score: 7,
          signals: 5,
          topics: ["Setup expectations"],
          reasons: ["Setup and specs questions repeat across customer signals."],
          sourceTypes: ["Issue signals"],
        },
        contentAnalysis: {
          issues: [
            { code: "short_description", label: "Short description", severity: "medium", evidence: "The product page has little setup guidance." },
            { code: "missing_specifications", label: "Missing specifications", severity: "medium", evidence: "Specs are not listed clearly." },
          ],
          advisories: [{ code: "template_may_need_special_layout", label: "Template could support richer guidance", severity: "low" }],
        },
        textInsights: {
          repeatedLanguage: [{ term: "how to set it up", count: 3, dominantSentiment: "negative" }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/template-test",
        productTitle: "GEN Guided Setup Kit",
      },
      deterministic,
      mainIssue: "product_content",
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: "Clarify setup steps, specs and expected product behavior before checkout.",
            faq_items: [{
              question: "What should I know before setup?",
              answer: "Review setup steps and specifications before purchase.",
            }],
          },
        },
      },
    });
    const ids = recommendations.map((item) => item.id);

    expect(ids).toContain("create-product-faq");
    expect(ids).toContain("add-specs-details-block");
    expect(ids).not.toContain("switch-product-template");
  });

  it("does not recommend a FAQ when current product content already covers the AI question", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 4 },
      product: {
        title: "Core Linen Trouser",
        description: [
          "A breathable linen trouser for warm weather.",
          "FAQ",
          "How does this trouser fit?",
          "It may feel closer around the waist; check measurements before purchase.",
        ].join("\n"),
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
            faq_items: [{
              question: "How does this trouser fit?",
              answer: "It may feel closer around the waist; check measurements before purchase.",
              reason: "Fit signals repeated.",
            }],
          },
        },
      },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("create-product-faq");
  });

  it("keeps only missing FAQ items when an existing FAQ covers part of the recommendation", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 5 },
      product: {
        title: "Core Linen Trouser",
        description: [
          "A breathable linen trouser for warm weather.",
          "Frequently asked questions",
          "How does this trouser fit?",
          "It has a relaxed leg and may feel closer around the waist.",
        ].join("\n"),
      },
      metrics: {
        faqNeed: {
          shouldRecommend: true,
          score: 7,
          signals: 5,
          topics: ["Fit and sizing"],
          reasons: ["Fit and sizing signals repeat enough to answer before purchase."],
          sourceTypes: ["Issue signals"],
        },
        topReturnReasons: ["Too small"],
        affectedVariants: [],
        returnUnits: 3,
        refundUnits: 0,
        negativeReviewCount: 3,
        contentIssueCount: 0,
        signalCount: 5,
        customerSignalCount: 5,
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
            faq_items: [
              {
                question: "How does this trouser fit?",
                answer: "It has a relaxed leg and may feel closer around the waist.",
                reason: "Fit signals repeated.",
              },
              {
                question: "Should shoppers check measurements before buying?",
                answer: "Yes. Review the waist and inseam measurements before checkout if you are between sizes.",
                reason: "Returns mention fit uncertainty.",
              },
            ],
          },
        },
      },
    });

    const faq = recommendations.find((item) => item.id === "create-product-faq");
    expect(faq).toBeTruthy();
    expect(faq.label).toBe("Add missing fit FAQ");
    expect(faq.payload.existingFaqDetected).toBe(true);
    expect(faq.payload.faqItems.map((item) => item.question)).toEqual([
      "Should shoppers check measurements before buying?",
    ]);
    expect(faq.payload.skippedExistingFaqItems[0]).toMatchObject({
      question: "How does this trouser fit?",
    });
  });

  it("does not recommend shopper-facing description copy when the current description already covers it", () => {
    const coveredCopy = "This mat is intentionally soft and cushion-forward. It is best for stretching, pilates and floor workouts.";
    const deterministic = {
      mainIssue: "quality_defect",
      issueSignalCounts: { quality_defect: 5 },
      product: {
        title: "GEN CloudSoft Yoga Mat 12mm",
        description: coveredCopy,
      },
      metrics: {
        customerSignalCount: 5,
        signalCount: 5,
        returnUnits: 3,
        refundUnits: 0,
        negativeReviewCount: 2,
        topReturnReasons: ["Too soft"],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        textInsights: {},
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/yoga",
        productTitle: "GEN CloudSoft Yoga Mat 12mm",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: coveredCopy } } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("draft-quality-note");
  });

  it("reduces partially covered description copy to only the missing sentence", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      issueSignalCounts: { quality_defect: 5 },
      product: {
        title: "GEN CloudSoft Yoga Mat 12mm",
        description: "This mat is intentionally soft and cushion-forward. It is best for stretching, pilates and floor workouts.",
      },
      metrics: {
        customerSignalCount: 5,
        signalCount: 5,
        returnUnits: 3,
        refundUnits: 0,
        negativeReviewCount: 2,
        topReturnReasons: ["Too soft"],
        affectedVariants: [],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        textInsights: {},
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/yoga",
        productTitle: "GEN CloudSoft Yoga Mat 12mm",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: "This mat is intentionally soft and cushion-forward. It is best for stretching, pilates and floor workouts. It is not designed for fast balance transitions.",
          },
        },
      },
    });

    const descriptionAction = recommendations.find((item) => item.id === "draft-quality-note");
    expect(descriptionAction).toBeTruthy();
    expect(descriptionAction.payload.draftText).toBe("It is not designed for fast balance transitions.");
    expect(descriptionAction.payload.contentCoverage).toMatchObject({
      currentCoverage: "partial",
      extractedMissingOnly: true,
    });
  });

  it("keeps only genuinely new fit details when the PDP already has fit and washing FAQs", () => {
    const existingDescription = [
      "PRODUCT NOTE",
      "Note: This shirt features a tailored, slim-cut design. If you prefer a truly relaxed fit or are between sizes, we recommend sizing up. Please follow care instructions carefully to maintain the garment's shape.",
      "Lightweight linen shirt",
      "Relaxed warm-weather shirt made from breathable linen blend.",
      "Care: machine wash cold, hang dry.",
      "How does this shirt fit?",
      "This shirt has a tailored, slim-cut fit. It is designed to sit closer through the chest, shoulders, and sleeves than a loose relaxed-fit shirt. If you prefer a roomier feel or are between sizes, choose one size up and review the size chart before ordering.",
      "Should I size up?",
      "If you are between sizes, prefer a looser warm-weather fit, or want extra room through the upper body, sizing up is the safer choice. Checking the selected size against the garment measurements is especially important for this style.",
      "Does the fit change after washing?",
      "Some customers have reported a tighter feel after washing, so it is important to follow the care instructions closely. Wash cold and hang dry, and consider this when choosing between sizes if you prefer a less fitted result.",
      "Are all color and size options expected to fit the same way?",
      "Fit feedback has not been identical across all options, so we recommend checking the selected variant carefully before purchase. If you are deciding between variants and want the safest fit choice, compare the size chart and choose the option that gives you enough room through the chest and shoulders.",
    ].join("\n\n");
    const deterministic = {
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 9 },
      product: {
        title: "GEN Linen Breeze Shirt",
        description: existingDescription,
      },
      metrics: {
        customerSignalCount: 9,
        signalCount: 12,
        returnUnits: 4,
        refundUnits: 0,
        negativeReviewCount: 3,
        topReturnReasons: ["Too small"],
        affectedVariants: ["White / Medium"],
        faqNeed: {
          shouldRecommend: true,
          topics: ["Fit and sizing"],
          reasons: ["Fit feedback repeats across returns and reviews."],
        },
        contentIssueCount: 3,
        contentAnalysis: {
          issues: [
            { code: "missing_specifications", label: "Missing material composition details", severity: "medium", evidence: "Description says breathable linen blend but does not specify the actual fiber composition." },
            { code: "missing_customer_guidance", label: "Missing size chart/measurement guidance", severity: "medium", evidence: "Copy advises reviewing the size chart but does not provide measurement points." },
            { code: "missing_specifications", label: "Missing expectation on included items", severity: "low", evidence: "Included items are not specified." },
          ],
        },
        textInsights: {},
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/shirt",
        productTitle: "GEN Linen Breeze Shirt",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: [
              "Fit note (please add near the size/fit section):",
              "Important: White (especially Medium) has the strongest runs small/tight feedback. If you’re between sizes or prefer extra room in the upper body, choose the next size up and compare your favorite shirt’s chest/shoulder fit to the size chart before ordering.",
              "After washing: some customers report the fit feels tighter after washing (even with cold wash). For the most comfortable, less-fitted result, follow the care instructions and consider sizing up if you’re sensitive to a snug feel.",
            ].join("\n"),
            faq_items: [{
              question: "Does the fit vary by color?",
              answer: "Fit feedback isn’t identical across all options. The strongest “runs small/tight” feedback is for White (especially Medium). If you’re choosing White, double-check the size chart and consider sizing up for a roomier feel.",
              reason: "Variant fit feedback is concentrated in White Medium.",
            }],
          },
        },
      },
    });

    const fitNote = recommendations.find((item) => item.id === "draft-fit-note");
    expect(fitNote).toBeTruthy();
    expect(fitNote.payload.draftText).toContain("White");
    expect(fitNote.payload.draftText).toContain("Medium");
    expect(fitNote.payload.draftText).not.toMatch(/After washing/i);
    expect(fitNote.payload.draftText).not.toMatch(/between sizes/i);

    expect(recommendations.map((item) => item.id)).not.toContain("create-product-faq");
    const guidance = recommendations.find((item) => item.id === "add-product-description-guidance");
    expect(guidance?.payload.draftText || "").not.toMatch(/add a short shopper-facing note/i);
  });

  it("uses AI content coverage validation to skip semantically covered FAQ proposals", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 8 },
      product: {
        title: "GEN Linen Breeze Shirt",
        description: [
          "How does this shirt fit?",
          "This shirt has a tailored, slim-cut fit through the chest, shoulders, and sleeves. If you prefer a roomier feel or are between sizes, choose one size up and review the size chart before ordering.",
          "Are all color and size options expected to fit the same way?",
          "Fit feedback has not been identical across all options, so we recommend checking the selected variant carefully before purchase.",
        ].join("\n"),
      },
      metrics: {
        customerSignalCount: 8,
        signalCount: 8,
        returnUnits: 3,
        refundUnits: 0,
        negativeReviewCount: 3,
        topReturnReasons: ["Too small"],
        affectedVariants: [],
        faqNeed: {
          shouldRecommend: true,
          topics: ["Fit and sizing"],
          reasons: ["Fit and sizing signals repeat enough to answer before purchase."],
        },
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        textInsights: {},
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/shirt",
        productTitle: "GEN Linen Breeze Shirt",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: {
        contentCoverageValidation: {
          coverage: [
            {
              id: "faq_item_1",
              status: "already_covered",
              confidence: "high",
              recommended_application: "skip",
              matched_existing_text: "How does this shirt fit?",
            },
            {
              id: "faq_item_2",
              status: "already_covered",
              confidence: "medium",
              recommended_application: "skip",
              matched_existing_text: "Are all color and size options expected to fit the same way?",
            },
          ],
        },
        report: {
          recommendation_copy: {
            faq_items: [
              {
                question: "How does this product fit?",
                answer: "This shirt has a tailored, slim cut through the chest, shoulders, and sleeves. If you want a more relaxed fit, size up.",
                reason: "Fit feedback repeats.",
              },
              {
                question: "Do White and Navy fit the same way?",
                answer: "Fit feedback is not identical across variants, so check the selected variant before purchase.",
                reason: "Variant fit feedback repeats.",
              },
            ],
          },
        },
      },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("create-product-faq");
  });

  it("uses AI content coverage validation to reduce description notes to the missing delta", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      issueSignalCounts: { fit_sizing: 8 },
      product: {
        title: "GEN Linen Breeze Shirt",
        description: "This shirt has a tailored, slim-cut fit. If you are between sizes, size up.",
      },
      metrics: {
        customerSignalCount: 8,
        signalCount: 8,
        returnUnits: 3,
        refundUnits: 0,
        negativeReviewCount: 3,
        topReturnReasons: ["Too small"],
        affectedVariants: ["White / Medium"],
        faqNeed: { shouldRecommend: false },
        contentIssueCount: 0,
        contentAnalysis: { issues: [] },
        textInsights: {},
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/shirt",
        productTitle: "GEN Linen Breeze Shirt",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: {
        contentCoverageValidation: {
          coverage: [{
            id: "pdp_copy",
            status: "partially_covered",
            confidence: "high",
            recommended_application: "description_note",
            remaining_text: "White Medium has the strongest tight-fit feedback in the shoulders and chest.",
          }],
        },
        report: {
          recommendation_copy: {
            pdp_copy: "If you are between sizes, size up. White Medium has the strongest tight-fit feedback in the shoulders and chest.",
          },
        },
      },
    });

    const fitNote = recommendations.find((item) => item.id === "draft-fit-note");
    expect(fitNote).toBeTruthy();
    expect(fitNote.payload.draftText).toBe("White Medium has the strongest tight-fit feedback in the shoulders and chest.");
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

  it("keeps signals inside the latest 30 days at full age strength", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const weighting = __productPulseDiagnosisTestHooks.buildTemporalSignalWeighting({
      now,
      sales: [],
      signalEvents: [
        { type: "return", createdAt: "2026-06-01T00:00:00.000Z", value: 1, text: "Too small", issueCode: "fit_sizing" },
        { type: "return", createdAt: "2026-05-12T00:00:00.000Z", value: 1, text: "Too small", issueCode: "fit_sizing" },
      ],
    });

    expect(weighting.events.map((event) => event.ageWeight)).toEqual([1, 1]);
    expect(weighting.byType.return.effectiveValue).toBe(2);
  });

  it("decays older signals non-linearly across 30-day buckets", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const weighting = __productPulseDiagnosisTestHooks.buildTemporalSignalWeighting({
      now,
      sales: [],
      signalEvents: [
        { type: "return", createdAt: "2026-05-01T00:00:00.000Z", value: 1, text: "Too small", issueCode: "fit_sizing" },
        { type: "return", createdAt: "2026-03-01T00:00:00.000Z", value: 1, text: "Too small", issueCode: "fit_sizing" },
        { type: "return", createdAt: "2025-12-01T00:00:00.000Z", value: 1, text: "Too small", issueCode: "fit_sizing" },
      ],
    });
    const weights = weighting.events.map((event) => event.weight);

    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    expect(weights[2]).toBeLessThan(0.2);
  });

  it("reduces old signal importance when later orders did not repeat the problem", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const sales = Array.from({ length: 70 }, (_, index) => ({
      id: `order-${index}`,
      orderId: `order-${index}`,
      quantity: 1,
      createdAt: new Date(Date.UTC(2026, 4, 1 + index % 31)).toISOString(),
    }));
    const weighting = __productPulseDiagnosisTestHooks.buildTemporalSignalWeighting({
      now,
      sales,
      signalEvents: [
        { type: "return", createdAt: "2026-04-01T00:00:00.000Z", value: 1, text: "Too small", issueCode: "fit_sizing" },
      ],
    });

    expect(weighting.events[0].ordersAfterSignal).toBe(70);
    expect(weighting.events[0].orderContinuityWeight).toBeLessThan(0.6);
    expect(weighting.byType.return.effectiveValue).toBeLessThan(0.5);
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

  it("keeps generated SEO title and meta description within clean character limits", () => {
    const seoTitle = __productPulseDiagnosisTestHooks.buildSuggestedSeoTitle({
      product: { vendor: "HydroFlow" },
      snapshot: { productTitle: "HydroFlow insulated water bottle with leak proof travel lid and stainless steel thermal body for long commutes" },
      aiTitle: "HydroFlow insulated water bottle with leak proof travel lid and stainless steel thermal body for long commutes...",
    });
    const metaDescription = __productPulseDiagnosisTestHooks.buildSuggestedMetaDescription({
      product: {
        title: "HydroFlow Insulated Water Bottle",
        description: "HydroFlow Insulated Water Bottle keeps drinks cold for long commutes, gym bags, and daily travel with a leak proof lid, stainless steel body, and clear care guidance for shoppers who compare bottle size, lid fit, and thermal performance before buying.",
      },
      mainIssue: "setup_expectation",
      aiDescription: "HydroFlow Insulated Water Bottle keeps drinks cold for long commutes, gym bags, and daily travel with a leak proof lid, stainless steel body, and clear care guidance...",
    });

    expect(seoTitle.length).toBeLessThanOrEqual(70);
    expect(seoTitle).not.toMatch(/(?:\.\.\.|…)$/);
    expect(metaDescription.length).toBeLessThanOrEqual(160);
    expect(metaDescription).not.toMatch(/(?:\.\.\.|…)$/);
    expect(metaDescription).toMatch(/[.!?]$/);
  });

  it("does not recommend Shopify text updates when the draft matches the current value", () => {
    const currentMetaDescription = "GEN Linen Breeze Shirt: Lightweight linen shirt for warm-weather layering.";
    const deterministic = {
      mainIssue: "product_quality",
      riskScore: 60,
      confidence: 82,
      issueSignalCounts: {},
      product: {
        title: "GEN Linen Breeze Shirt",
        vendor: "ProductPulse Lab",
        handle: "gen-linen-breeze-shirt",
        seoTitle: "GEN Linen Breeze Shirt | ProductPulse Lab",
        seoDescription: currentMetaDescription,
        description: "Lightweight linen shirt for warm-weather layering.",
        variants: [],
        media: [],
      },
      metrics: {
        productMomentumScore: 80,
        titleNeedsReview: true,
        seoTitleNeedsReview: true,
        metaDescriptionNeedsReview: true,
        handleNeedsReview: true,
        topReturnReasons: [],
        affectedVariants: [],
        contentAnalysis: { issues: [], advisories: [] },
        textInsights: {},
        faqNeed: { shouldRecommend: false },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/no-op-seo",
        productTitle: deterministic.product.title,
        handle: deterministic.product.handle,
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { meta_description: currentMetaDescription } } },
    });

    const ids = recommendations.map((item) => item.id);
    expect(ids).not.toContain("update-product-title");
    expect(ids).not.toContain("rewrite-seo-title");
    expect(ids).not.toContain("rewrite-meta-description");
    expect(ids).not.toContain("improve-url-handle");
  });

  it("folds monitoring coverage into the Connect source coverage action", () => {
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/missing-coverage",
        productTitle: "GEN Momentum Product",
        handle: "gen-momentum-product",
      },
      deterministic: {
        mainIssue: "product_quality",
        riskScore: 55,
        confidence: 70,
        issueSignalCounts: {},
        sourceCoverage: ["Shopify products"],
        product: {
          title: "GEN Momentum Product",
          handle: "gen-momentum-product",
          description: "A product with enough sales momentum to justify stronger source coverage.",
          variants: [],
          media: [],
        },
        metrics: {
          productMomentumScore: 82,
          orderAccessDenied: true,
          reviewCount: 0,
          topReturnReasons: [],
          affectedVariants: [],
          contentAnalysis: { issues: [], advisories: [] },
          textInsights: {},
          faqNeed: { shouldRecommend: false },
        },
      },
      mainIssue: "product_quality",
      ai: { report: { recommendation_copy: {} } },
    });

    const ids = recommendations.map((item) => item.id);
    const connectAction = recommendations.find((item) => item.id === "connect-missing-source");
    expect(ids).toContain("connect-missing-source");
    expect(ids).not.toContain("improve-monitoring-coverage");
    expect(connectAction?.payload.productMomentumScore).toBe(82);
    expect(connectAction?.payload.trigger).toContain("Sales Momentum");
    expect(connectAction?.payload.nextSteps).toContain("Keep the product on Watchlist if periodic monitoring still matters");
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

  it("uses AI action guidance to keep subjective expectation issues out of QA even when text mentions defect", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 74,
      confidence: 99,
      evidenceSnippets: [
        { text: "The cushion is thick but unstable for transitions. This is a personal preference issue, not necessarily a defect." },
        { text: "Too soft for balance poses; expected a firmer yoga surface." },
      ],
      issueSignalCounts: { quality_defect: 9, product_content: 4 },
      product: {
        title: "GEN CloudSoft Yoga Mat 12mm",
        description: "This mat is intentionally soft and cushion-forward. It is best for stretching, pilates and floor workouts.",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Sage", sku: "GEN-MAT-SAGE" },
          { id: "gid://shopify/ProductVariant/2", title: "Charcoal", sku: "GEN-MAT-CHAR" },
        ],
      },
      metrics: {
        customerSignalCount: 16,
        signalCount: 48,
        returnUnits: 4,
        refundUnits: 0,
        returnRate: 50,
        negativeReviewCount: 12,
        mediaCount: 0,
        specsBlockRecommended: true,
        templateNeedsReview: true,
        semanticClassification: {
          actionGuidance: {
            issueNature: "subjective_expectation",
            subjectivityLevel: "high",
            operationalQualityConfidence: "low",
            shopperExpectationConfidence: "high",
            shouldEscalateQa: false,
            primaryActionFamily: "description_update",
            recommendedActionFamilies: ["description_update", "faq", "specs_block", "media_context"],
            blockedActionFamilies: ["qa_review", "inventory_hold", "status_change"],
          },
        },
        faqNeed: {
          shouldRecommend: true,
          topics: ["Firmness expectations"],
          reasons: ["AI classified the repeated softness complaints as an expectation mismatch."],
        },
        contentIssueCount: 3,
        contentAnalysis: {
          issues: [
            { code: "missing_customer_guidance", label: "Missing stability guidance", severity: "high", evidence: "The page should explain best-for and not-for use cases." },
            { code: "missing_specifications", label: "Missing mat specifications", severity: "medium", evidence: "Dimensions, materials and grip are absent." },
          ],
          advisories: [{ code: "template_may_need_special_layout", label: "Template could support richer guidance", severity: "low" }],
        },
        textInsights: {
          repeatedLanguage: [
            { term: "too soft", count: 4, dominantSentiment: "negative" },
            { term: "balance", count: 6, dominantSentiment: "mixed" },
          ],
        },
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 4, customer_count: 3 },
          confidence: { score: 89, label: "High" },
        },
        productRelationshipFactors: {
          recommendedActionSignals: {
            crossSellOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/wall-print",
              relatedProductTitle: "GEN Night Watch Dramatic Wall Print",
              relationshipType: "next_purchase",
              direction: "after",
              timeWindow: "90d_after",
              lift: 4.8,
              confidence: 67,
              sampleSize: 3,
              relationshipStrength: "very_strong",
            },
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/yoga",
        productTitle: "GEN CloudSoft Yoga Mat 12mm",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: "Clarify that this mat is cushion-forward and not the best choice for fast balance transitions." } } },
    });
    const ids = recommendations.map((item) => item.id);

    expect(ids).toContain("draft-quality-note");
    expect(ids).toContain("create-product-faq");
    expect(ids).toContain("add-specs-details-block");
    expect(ids).not.toContain("recommend-qa-review");
    expect(ids).not.toContain("limit-variant-inventory");
    expect(ids).not.toContain("set-product-draft");
    expect(ids).not.toContain("create-post-purchase-cross-sell");
    expect(ids).not.toContain("move-to-review-collection");
    expect(ids).not.toContain("switch-product-template");
    expect(ids).not.toContain("add-structured-metafields");
    expect(ids).not.toContain("apply-risk-tags");
    expect(ids).not.toContain("add-workflow-tags");
  });

  it("lets AI action guidance escalate QA for semantic operational quality issues", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 66,
      confidence: 88,
      evidenceSnippets: [
        { text: "Multiple customers say the surface separates after normal use." },
        { text: "Support notes say the same failure repeats after replacement." },
      ],
      issueSignalCounts: { quality_defect: 5 },
      product: {
        title: "GEN Layered Fitness Mat",
        description: "Layered mat for daily workouts.",
        variants: [{ id: "gid://shopify/ProductVariant/1", title: "Standard", sku: "GEN-MAT-STD" }],
      },
      metrics: {
        customerSignalCount: 5,
        signalCount: 7,
        returnUnits: 3,
        refundUnits: 0,
        returnRate: 30,
        negativeReviewCount: 2,
        semanticClassification: {
          actionGuidance: {
            issueNature: "operational_quality",
            subjectivityLevel: "low",
            operationalQualityConfidence: "high",
            shopperExpectationConfidence: "low",
            shouldEscalateQa: true,
            qaReason: "AI classified the repeated separation after normal use as an operational product-quality issue.",
            primaryActionFamily: "qa_review",
            recommendedActionFamilies: ["qa_review", "description_update"],
            blockedActionFamilies: [],
          },
        },
        contentIssueCount: 1,
        contentAnalysis: {
          issues: [{ code: "short_description", label: "Short product description", severity: "medium", evidence: "Limited product detail." }],
          advisories: [],
        },
        textInsights: {
          repeatedLanguage: [{ term: "surface separates", count: 3, dominantSentiment: "negative" }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/semantic-qa",
        productTitle: "GEN Layered Fitness Mat",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: "Clarify normal-use limits and care while the product is reviewed." } } },
    });
    const qa = recommendations.find((item) => item.id === "recommend-qa-review");

    expect(qa).toBeTruthy();
    expect(qa.payload.trigger).toBe("AI classified the repeated separation after normal use as an operational product-quality issue.");
  });

  it("keeps merchandising and workflow metadata out of high-risk AI QA diagnoses", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 100,
      confidence: 99,
      evidenceSnippets: [
        { text: "The desk loses air during normal typing and the laptop starts sliding." },
        { text: "Returned because the tall kit deflates after a few hours and feels unsafe for a laptop." },
      ],
      issueSignalCounts: { quality_defect: 14, product_content: 4, safety_concern: 3 },
      product: {
        title: "GEN LiftAir Inflatable Standing Desk",
        description: "Inflatable desk riser for travel work setups.",
        variants: [
          { id: "gid://shopify/ProductVariant/tall", title: "Tall Kit", sku: "GEN-LIFTAIR-TALL" },
          { id: "gid://shopify/ProductVariant/starter", title: "Starter", sku: "GEN-LIFTAIR-STARTER" },
        ],
      },
      metrics: {
        customerSignalCount: 16,
        signalCount: 52,
        returnUnits: 8,
        returnRate: 50,
        refundUnits: 5,
        refundRate: 31.25,
        refundAmount: 412,
        negativeReviewCount: 27,
        reviewCount: 50,
        negativeReviewRate: 54,
        topReturnReasons: ["Air leak/deflation", "Laptop sliding"],
        affectedVariants: ["Tall Kit"],
        variantCount: 2,
        mediaCount: 1,
        mediaWithoutAltCount: 0,
        refundInsights: {
          shouldSurface: true,
          highPressure: true,
          topReasons: [{ label: "Air leak/deflation", count: 5 }],
        },
        semanticClassification: {
          actionGuidance: {
            issueNature: "operational_quality",
            subjectivityLevel: "low",
            operationalQualityConfidence: "high",
            shopperExpectationConfidence: "medium",
            shouldEscalateQa: true,
            qaReason: "Repeated return, refund and review text describes air leaks, deflation and instability during normal use.",
            primaryActionFamily: "qa_review",
            recommendedActionFamilies: ["qa_review", "description_update", "faq"],
            blockedActionFamilies: ["inventory_hold", "status_change"],
          },
        },
        faqNeed: {
          shouldRecommend: true,
          topics: ["Inflation and stability"],
          reasons: ["Customers repeatedly mention deflation and laptop stability."],
        },
        contentIssueCount: 2,
        contentAnalysis: {
          issues: [
            { code: "short_description", label: "Short product description", severity: "medium", evidence: "The PDP does not explain stability limits." },
            { code: "missing_specifications", label: "Missing load and height specs", severity: "medium", evidence: "Weight limit and height ranges are absent." },
          ],
          advisories: [],
        },
        textInsights: {
          sentiment: { negative: 14, negativeRatio: 0.72 },
          repeatedLanguage: [
            { term: "deflates", count: 7, dominantSentiment: "negative" },
            { term: "unsafe for a laptop", count: 3, dominantSentiment: "negative" },
          ],
        },
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 8, customer_count: 6 },
          confidence: { score: 88, label: "High" },
        },
        productRelationshipFactors: {
          recommendedActionSignals: {
            bundleOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/laptop-stand",
              relatedProductTitle: "GEN Cable Dock Organizer",
              relationshipType: "same_order",
              lift: 3.2,
              confidence: 76,
              sampleSize: 4,
              relationshipStrength: "strong",
            },
            crossSellOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/wall-print",
              relatedProductTitle: "GEN Night Watch Dramatic Wall Print",
              relationshipType: "next_purchase",
              direction: "after",
              timeWindow: "90d_after",
              lift: 4.1,
              confidence: 72,
              sampleSize: 4,
              relationshipStrength: "strong",
            },
            journeyInsightRelationship: {
              relatedProductId: "gid://shopify/Product/travel-desk",
              relatedProductTitle: "GEN Portable Work Tray",
              relationshipType: "previous_purchase",
              direction: "before",
              timeWindow: "90d_before",
              lift: 3.8,
              confidence: 70,
              sampleSize: 4,
              relationshipStrength: "strong",
            },
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/liftair",
        productTitle: "GEN LiftAir Inflatable Standing Desk",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: "Warn shoppers about load limits and inflation checks while QA reviews the leak pattern." } } },
    });
    const ids = recommendations.map((item) => item.id);

    expect(ids).toContain("recommend-qa-review");
    expect(ids).toContain("create-product-faq");
    expect(ids).not.toContain("test-product-bundle");
    expect(ids).not.toContain("create-post-purchase-cross-sell");
    expect(ids).not.toContain("position-as-upgrade-path");
    expect(ids).not.toContain("add-structured-metafields");
    expect(ids).not.toContain("add-workflow-tags");
  });

  it("keeps secondary merchandising actions out of high-risk remediation even without AI action guidance", () => {
    const deterministic = {
      mainIssue: "shipping_delivery",
      riskScore: 100,
      confidence: 92,
      evidenceSnippets: [
        { text: "Tall Kit slowly lost air during a call and the laptop started sliding toward the edge." },
        { text: "Refund issued after the air chamber leak made the desk unsafe for a laptop." },
      ],
      issueSignalCounts: { shipping_delivery: 24, refund_impact: 5, safety_concern: 2 },
      product: {
        title: "GEN LiftAir Inflatable Standing Desk",
        description: "Inflatable desk riser for travel work setups.",
        variants: [{ id: "gid://shopify/ProductVariant/tall", title: "Tall Kit", sku: "GEN-LIFTAIR-TALL" }],
      },
      metrics: {
        customerSignalCount: 40,
        signalCount: 52,
        returnUnits: 8,
        returnRate: 50,
        refundUnits: 5,
        refundRate: 31.25,
        negativeReviewCount: 27,
        reviewCount: 50,
        topReturnReasons: [
          "Item Not As Described",
          "Other: Air chamber would not hold pressure and the surface tilted toward the keyboard.",
        ],
        contentIssueCount: 1,
        contentAnalysis: {
          issues: [{ code: "short_description", label: "Short product description", severity: "medium", evidence: "The PDP does not explain stability limits." }],
          advisories: [],
        },
        refundInsights: {
          shouldSurface: true,
          highPressure: true,
          dominantIssueCode: "quality_defect",
          topReasons: [{ label: "Refund discrepancy", count: 5 }],
        },
        textInsights: {
          repeatedLanguage: [
            { term: "lost air", count: 6, dominantSentiment: "negative" },
            { term: "laptop sliding", count: 4, dominantSentiment: "negative" },
          ],
        },
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 8, customer_count: 6 },
          confidence: { score: 88, label: "High" },
        },
        productRelationshipFactors: {
          recommendedActionSignals: {
            crossSellOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/wall-print",
              relatedProductTitle: "GEN Night Watch Dramatic Wall Print",
              relationshipType: "next_purchase",
              direction: "after",
              timeWindow: "30d_after",
              lift: 2.9,
              confidence: 70,
              sampleSize: 3,
              relationshipStrength: "very_strong",
            },
            journeyInsightRelationship: {
              relatedProductId: "gid://shopify/Product/mug",
              relatedProductTitle: "GEN TrailSeal Travel Mug",
              relationshipType: "previous_purchase",
              direction: "before",
              timeWindow: "30d_before",
              lift: 3.6,
              confidence: 67,
              sampleSize: 3,
              relationshipStrength: "very_strong",
            },
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/liftair-no-ai-guidance",
        productTitle: "GEN LiftAir Inflatable Standing Desk",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: { pdp_copy: "Clarify pressure retention checks and load limits while QA reviews the leak reports." } } },
    });
    const ids = recommendations.map((item) => item.id);

    expect(ids).toContain("recommend-qa-review");
    expect(ids).not.toContain("create-post-purchase-cross-sell");
    expect(ids).not.toContain("position-as-upgrade-path");
    expect(ids).not.toContain("add-structured-metafields");
    expect(ids).not.toContain("add-workflow-tags");
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

  it("stores the AI basket context interpretation on the purchase context summary", () => {
    const summary = {
      total_orders_containing_product: 18,
      solo_product_order_count: 12,
      multi_product_order_count: 6,
    };
    const enriched = __productPulseDiagnosisTestHooks.withAiPurchaseContextInterpretation(summary, {
      report: {
        basket_context_interpretation: "Basket behavior is mostly standalone, but the final report and companion-item evidence suggest reading downstream friction with some order-context caution.",
      },
    });

    expect(enriched).toMatchObject({
      ...summary,
      interpretation: "Basket behavior is mostly standalone, but the final report and companion-item evidence suggest reading downstream friction with some order-context caution.",
      backend_interpretation: "Basket behavior is mostly standalone, but the final report and companion-item evidence suggest reading downstream friction with some order-context caution.",
      ai_interpretation: "Basket behavior is mostly standalone, but the final report and companion-item evidence suggest reading downstream friction with some order-context caution.",
      interpretation_source: "deep_diagnosis_final_report",
    });
    expect(summary.interpretation).toBeUndefined();
  });

  it("normalizes main finding detail into the required question blocks when AI omits them", () => {
    const detail = __productPulseDiagnosisTestHooks.buildMainFindingDetail(
      "Returns and refunds point to a quality concern for this charging stand, and merchants should review the affected post-purchase signals before changing the product page.",
      {
        mainIssue: "quality_defect",
        mainIssueLabel: "Product quality",
        riskScore: 84,
        confidence: 80,
        sourceCoverage: ["Shopify products", "Shopify orders", "Shopify refunds", "Shopify returns"],
        estimatedImpact: { estimatedImpact: 187 },
        metrics: {
          returnUnits: 3,
          returnRate: 50,
          refundUnits: 3,
          refundAmount: 117,
          reviewCount: 0,
          negativeReviewCount: 0,
          contentIssueCount: 0,
          sourceCount: 4,
        },
      },
      { issues: [] },
    );

    const paragraphs = detail.split(/\n{2,}/);
    expect(paragraphs).toHaveLength(5);
    expect(paragraphs[0]).toContain("Returns and refunds point to a quality concern");
    expect(paragraphs[1]).toContain("What is wrong?");
    expect(paragraphs[2]).toContain("Why do we believe that?");
    expect(paragraphs[3]).toContain("What should we do now?");
    expect(paragraphs[4]).toContain("How much does it matter?");
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

  it("creates conservative retention recommendations from strong cohort signals", () => {
    const baseDeterministic = {
      mainIssue: "product_quality",
      riskScore: 38,
      confidence: 82,
      evidenceSnippets: [],
      issueSignalCounts: {},
      product: {
        title: "Retention Product",
        description: "Retention product.",
        variants: [],
      },
      metrics: {
        customerSignalCount: 0,
        signalCount: 0,
        returnUnits: 0,
        refundUnits: 0,
        returnRate: 0,
        refundRate: 0,
        negativeReviewCount: 0,
        contentIssueCount: 0,
        contentAnalysis: { issues: [], advisories: [] },
        textInsights: {},
        affectedVariants: [],
        affectedVariantDetails: [],
        topReturnReasons: [],
        productRetention: {
          summary: {
            hasEnoughData: true,
            totalCustomersAnalyzed: 72,
            totalProductOrdersAnalyzed: 96,
            retentionHealthScore: 78,
            repeatPurchaseRate90d: 0.31,
            sameProductRepurchaseRate90d: 0.22,
            crossSellRetentionRate90d: 0.1,
            productLtv90Cents: 9200,
            medianDaysToSecondPurchase: 34,
          },
        },
      },
    };

    const repurchaseRecommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/retention",
        productTitle: "Retention Product",
      },
      deterministic: baseDeterministic,
      mainIssue: baseDeterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    const repurchase = repurchaseRecommendations.find((item) => item.id === "create-repurchase-campaign");
    expect(repurchase).toBeTruthy();
    expect(repurchase.payload).toMatchObject({
      source: "product_retention",
      recommendationKind: "repurchase_campaign",
      retentionMetrics: {
        totalProductCohortCustomers: 72,
        sameProductRepurchaseRate90d: 0.22,
      },
      campaignPlan: {
        audience: expect.stringContaining("Customers who bought this product"),
      },
    });
    expect(repurchaseRecommendations.map((item) => item.id)).not.toContain("review-retention-drop");

    const lowSampleRecommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/retention",
        productTitle: "Retention Product",
      },
      deterministic: {
        ...baseDeterministic,
        metrics: {
          ...baseDeterministic.metrics,
          productRetention: {
            summary: {
              ...baseDeterministic.metrics.productRetention.summary,
              totalCustomersAnalyzed: 4,
              totalProductOrdersAnalyzed: 4,
              hasEnoughData: false,
            },
          },
        },
      },
      mainIssue: baseDeterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });
    expect(lowSampleRecommendations.map((item) => item.id)).not.toContain("create-repurchase-campaign");
  });

  it("creates retention cross-sell or drop review actions only when the signal is specific", () => {
    const deterministic = {
      mainIssue: "product_quality",
      riskScore: 42,
      confidence: 80,
      evidenceSnippets: [],
      issueSignalCounts: {},
      product: {
        title: "Lifecycle Product",
        description: "Lifecycle product.",
        variants: [],
      },
      metrics: {
        customerSignalCount: 0,
        signalCount: 0,
        returnUnits: 0,
        refundUnits: 0,
        returnRate: 0,
        refundRate: 0,
        negativeReviewCount: 0,
        contentIssueCount: 0,
        contentAnalysis: { issues: [], advisories: [] },
        textInsights: {},
        affectedVariants: [],
        affectedVariantDetails: [],
        topReturnReasons: [],
        productRetention: {
          summary: {
            hasEnoughData: true,
            totalCustomersAnalyzed: 80,
            totalProductOrdersAnalyzed: 105,
            retentionHealthScore: 74,
            repeatPurchaseRate90d: 0.29,
            sameProductRepurchaseRate90d: 0.08,
            crossSellRetentionRate90d: 0.32,
            productLtv90Cents: 11800,
            medianDaysToSecondPurchase: 28,
          },
        },
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 24 },
          confidence: { score: 84, label: "High" },
        },
        productRelationshipFactors: {
          recommendedActionSignals: {
            crossSellOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/refill",
              relatedProductTitle: "Refill Kit",
              relationshipType: "next_purchase",
              direction: "after",
              lift: 2.2,
              confidence: 84,
              sampleSize: 7,
            },
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/lifecycle",
        productTitle: "Lifecycle Product",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });
    expect(recommendations.map((item) => item.id)).toContain("create-retention-cross-sell-campaign");
    expect(recommendations.map((item) => item.id)).not.toContain("create-post-purchase-cross-sell");
    expect(recommendations.find((item) => item.id === "create-retention-cross-sell-campaign")?.payload.relatedProductTitle).toBe("Refill Kit");

    const dropRecommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/lifecycle",
        productTitle: "Lifecycle Product",
      },
      deterministic: {
        ...deterministic,
        metrics: {
          ...deterministic.metrics,
          productRelationshipFactors: { recommendedActionSignals: {} },
          productRetention: {
            summary: {
              hasEnoughData: true,
              totalCustomersAnalyzed: 64,
              totalProductOrdersAnalyzed: 84,
              retentionHealthScore: 38,
              repeatPurchaseRate90d: 0.04,
              sameProductRepurchaseRate90d: 0.01,
              crossSellRetentionRate90d: 0.02,
              productLtv90Cents: 5100,
              ltv90DeltaCents: -900,
            },
          },
        },
      },
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });
    expect(dropRecommendations.map((item) => item.id)).toContain("review-retention-drop");
    expect(dropRecommendations.map((item) => item.id)).not.toContain("create-retention-cross-sell-campaign");
  });

  it("keeps relationship expectation fixes ahead of catalog hygiene and stop-sale actions", () => {
    const deterministic = {
      mainIssue: "quality_defect",
      riskScore: 100,
      confidence: 88,
      evidenceSnippets: [
        { text: "Not as described: bought-together bundle context made the source product look like a different kit." },
        { text: "The source page did not explain what belonged together in the companion-product order." },
      ],
      issueSignalCounts: { quality_defect: 8, product_content: 6 },
      product: {
        title: "GEN RELTEST Source Product",
        description: "RELTEST source product used to test bought-together relationships.",
        status: "ACTIVE",
        templateSuffix: "",
        media: [{ id: "gid://shopify/MediaImage/source", alt: "" }],
        variants: [
          { id: "gid://shopify/ProductVariant/std", title: "Standard", sku: "GEN-RELTEST-SRC-STD" },
          { id: "gid://shopify/ProductVariant/ext", title: "Extended", sku: "GEN-RELTEST-SRC-EXT" },
        ],
      },
      metrics: {
        customerSignalCount: 19,
        signalCount: 25,
        returnUnits: 3,
        refundUnits: 2,
        returnRate: 15.79,
        refundRate: 10.53,
        negativeReviewCount: 12,
        reviewCount: 12,
        avgRating: 3.7,
        contentIssueCount: 6,
        specsBlockRecommended: true,
        templateNeedsReview: true,
        mediaCount: 1,
        mediaWithoutAltCount: 1,
        topReturnReasons: ["Item Not As Described"],
        affectedVariants: ["Standard", "Extended"],
        refundInsights: { shouldSurface: true, highPressure: false },
        faqNeed: {
          shouldRecommend: true,
          score: 8,
          signals: 6,
          topics: ["Bundle expectations"],
          reasons: ["Bundle and bought-together expectations repeat across returns and reviews."],
        },
        contentAnalysis: {
          issues: [
            { code: "short_description", label: "Short product description", severity: "high", evidence: "The description is testing copy, not shopper guidance." },
            { code: "missing_customer_guidance", label: "Missing shopper guidance for bundle/bought-together expectations", severity: "high", evidence: "The page does not explain what belongs together." },
            { code: "missing_specifications", label: "Missing specifications", severity: "high", evidence: "Pack differences are not explained." },
          ],
          advisories: [{ code: "missing_media_alt_text", label: "Media alt text could be improved", severity: "low" }],
        },
        textInsights: {
          repeatedLanguage: [
            { term: "bundle", count: 8 },
            { term: "bought together", count: 6 },
            { term: "unclear", count: 5 },
          ],
        },
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 14 },
          confidence: { score: 89.5, label: "High" },
        },
        productRelationshipFactors: {
          recommendedActionSignals: {
            compatibilityWarningRelationship: {
              relatedProductId: "gid://shopify/Product/together",
              relatedProductTitle: "GEN RELTEST Bought Together Product",
              relationshipType: "same_order",
              direction: "together",
              timeWindow: "same_order",
              lift: 6.86,
              confidence: 69,
              sampleSize: 6,
              deltaReturnRate: 37.5,
              deltaRefundRate: 25,
              relationshipStrength: "very_strong",
            },
            crossSellOpportunityRelationship: {
              relatedProductId: "gid://shopify/Product/after",
              relatedProductTitle: "GEN RELTEST Bought After Product",
              relationshipType: "next_purchase",
              direction: "after",
              timeWindow: "30d_after",
              lift: 1.7,
              confidence: 70,
              sampleSize: 4,
              relationshipStrength: "moderate",
            },
            journeyInsightRelationship: {
              relatedProductId: "gid://shopify/Product/before",
              relatedProductTitle: "GEN RELTEST Bought Before Product",
              relationshipType: "previous_purchase",
              direction: "before",
              timeWindow: "30d_before",
              lift: 1.7,
              confidence: 70,
              sampleSize: 4,
              relationshipStrength: "moderate",
            },
          },
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/reltest-source",
        productTitle: "GEN RELTEST Source Product",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: "Clarify bought-together expectations and Pack differences before checkout.",
            faq_items: [{
              question: "What should I expect when buying this with the companion product?",
              answer: "Check what belongs to the source product, what belongs to the companion item, and which Pack was selected before purchase.",
            }],
          },
        },
      },
    });
    const ids = recommendations.map((item) => item.id);
    const byId = new Map(recommendations.map((item) => [item.id, item]));

    expect(ids).toEqual(expect.arrayContaining([
      "draft-quality-note",
      "review-product-pairing-expectations",
      "create-post-purchase-cross-sell",
      "position-as-upgrade-path",
    ]));
    expect(ids).not.toContain("set-product-draft");
    expect(ids).not.toContain("improve-product-media");
    expect(ids).not.toContain("switch-product-template");
    expect(ids).not.toContain("add-structured-metafields");
    expect(ids).not.toContain("move-to-review-collection");
    expect(ids).not.toContain("add-workflow-tags");
    expect(byId.get("review-product-pairing-expectations")?.payload).toMatchObject({
      actionTier: 1,
      priorityGroup: "Customer-facing fix",
      relatedProductTitle: "GEN RELTEST Bought Together Product",
      deltaReturnRate: 37.5,
      deltaRefundRate: 25,
    });
    expect(byId.get("create-post-purchase-cross-sell")?.payload).toMatchObject({
      actionTier: 3,
      impactLevel: "Optional",
      priorityGroup: "Merchandising insight",
    });
    expect(byId.get("position-as-upgrade-path")?.payload).toMatchObject({
      actionTier: 3,
      impactLevel: "Optional",
      priorityGroup: "Merchandising insight",
    });
  });

  it("recommends adding an uncollected product to an existing related-product collection", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 28,
      confidence: 76,
      evidenceSnippets: [],
      issueSignalCounts: {},
      product: {
        title: "GEN Gallery Wall Print",
        description: "Decorative wall print.",
        collections: [],
        collectionRecords: [],
        variants: [],
      },
      metrics: {
        signalCount: 0,
        customerSignalCount: 0,
        contentIssueCount: 0,
        topReturnReasons: [],
        affectedVariants: [],
        productMomentumScore: 0,
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 11 },
          confidence: { score: 82, label: "High" },
        },
        relationshipCollectionSuggestions: [{
          collectionId: "gid://shopify/Collection/987",
          collectionName: "Wall Art",
          collectionHandle: "wall-art",
          score: 91,
          relatedProducts: [{
            productGid: "gid://shopify/Product/related-print",
            title: "GEN Related Print",
            relationshipType: "same_order",
            relationshipDirection: "together",
            sampleSize: 5,
            confidence: 78,
            lift: 3.2,
          }],
          evidence: ["GEN Related Print is bought together, 3.2x lift across 5 matched orders and belongs to Wall Art."],
        }],
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/source-print",
        productTitle: "GEN Gallery Wall Print",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });
    const collectionAction = recommendations.find((item) => item.id === "add-to-related-product-collection");

    expect(collectionAction).toMatchObject({
      label: "Add to Wall Art",
      type: "Collection merchandising",
      payload: {
        collectionId: "gid://shopify/Collection/987",
        collectionName: "Wall Art",
        collectionHandle: "wall-art",
        recommendationKind: "collection_placement",
        actionTier: 2,
        priorityGroup: "Merchandising insight",
      },
    });
  });

  it("does not recommend related-product collection placement when the product already belongs to a collection", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 28,
      confidence: 76,
      evidenceSnippets: [],
      issueSignalCounts: {},
      product: {
        title: "GEN Gallery Wall Print",
        description: "Decorative wall print.",
        collections: ["Existing Collection"],
        collectionRecords: [{ id: "gid://shopify/Collection/current", title: "Existing Collection", handle: "existing-collection" }],
        variants: [],
      },
      metrics: {
        signalCount: 0,
        customerSignalCount: 0,
        contentIssueCount: 0,
        topReturnReasons: [],
        affectedVariants: [],
        productMomentumScore: 0,
        productRelationshipIntelligenceSummary: {
          data_basis: { order_count: 11 },
          confidence: { score: 82, label: "High" },
        },
        relationshipCollectionSuggestions: [{
          collectionId: "gid://shopify/Collection/987",
          collectionName: "Wall Art",
          collectionHandle: "wall-art",
          score: 91,
          relatedProducts: [{ productGid: "gid://shopify/Product/related-print", title: "GEN Related Print" }],
          evidence: ["GEN Related Print belongs to Wall Art."],
        }],
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/source-print",
        productTitle: "GEN Gallery Wall Print",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("add-to-related-product-collection");
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

  it("does not use appliance specs for apparel fit issues with heat-care language", () => {
    const deterministic = {
      mainIssue: "fit_sizing",
      riskScore: 74,
      confidence: 80,
      issueSignalCounts: { fit_sizing: 6 },
      product: {
        title: "GEN DriftWeave Packable Overshirt",
        description: "Packable overshirt with finished garment checkpoints. Hang dry only; dryer heat can make the sleeve and upper-arm feel tighter.",
        productType: "Apparel",
        variants: [
          { id: "gid://shopify/ProductVariant/1", title: "Pine / M", sku: "GEN-DRIFT-PINE-M" },
          { id: "gid://shopify/ProductVariant/2", title: "Stone / L", sku: "GEN-DRIFT-STONE-L" },
        ],
      },
      metrics: {
        customerSignalCount: 8,
        signalCount: 12,
        returnUnits: 3,
        refundUnits: 3,
        negativeReviewCount: 0,
        specsBlockRecommended: true,
        contentIssueCount: 1,
        topReturnReasons: ["Too Small"],
        contentAnalysis: {
          issues: [
            { code: "missing_customer_guidance", label: "Packable feature expectation not fully scannable", severity: "low", evidence: "Title says packable but pocket behavior is not scannable." },
          ],
          advisories: [],
        },
        textInsights: {
          repeatedLanguage: [{ term: "shoulder tight over sweatshirt", count: 3 }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/5",
        productTitle: "GEN DriftWeave Packable Overshirt",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    const specs = recommendations.find((item) => item.id === "add-specs-details-block");
    expect(specs?.payload.draftText).toContain("Fit measurements");
    expect(specs?.payload.draftText).toContain("Layering fit check");
    expect(specs?.payload.draftText).toContain("Packability details");
    expect(specs?.payload.draftText).not.toContain("Power input");
    expect(specs?.payload.draftText).not.toContain("Brew capacity");
    expect(specs?.payload.draftText).not.toContain("Timer and alarm behavior");
    expect(specs?.payload.draftText).not.toContain("capacity, care, or limitations");
  });

  it("derives report issue names from final issues instead of stale auxiliary AI labels", () => {
    const issueNames = __productPulseDiagnosisTestHooks.buildDiagnosisReportIssueNames({
      mainIssue: "setup_expectation",
      issues: [
        { issue: "MIN fill limit not obvious (auto shutoff misread as defect)", severity: "High" },
        { issue: "Missing specifications", severity: "High" },
      ],
    });

    expect(issueNames).toEqual([
      { code: "setup_expectation", label: "MIN fill limit not obvious (auto shutoff misread as defect)" },
      { code: "product_content", label: "Missing specifications" },
    ]);
    expect(issueNames.map((item) => item.label)).not.toContain("Runs small");
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
        vendor: "Zuam",
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
            product_title: "Zuam Toy with clear age guidance",
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
      draftTitle: "Zuam Toy with clear age guidance",
    });
    expect(byId.get("set-product-draft")?.payload.shopifyField).toBe("Product.status");
    expect(byId.get("limit-variant-inventory")?.payload.shopifyField).toBe("InventoryLevel quantities");
    expect(byId.get("review-product-pricing")?.payload.shopifyField).toContain("ProductVariant.price");
    expect(byId.get("improve-product-media")?.payload.expectedImpact).toContain("visual expectation");
    expect(byId.get("improve-product-media")?.payload.mediaUpdates?.[0]).toMatchObject({
      id: "gid://shopify/MediaImage/1",
      currentAltText: "",
    });
    expect(byId.get("improve-product-media")?.payload.draftText).toContain("Zuam Toy");
    expect(byId.get("improve-product-media")?.payload.shopifyField).toBe("Product media alt text");
    expect(byId.get("apply-risk-tags")?.payload.tags).toEqual(expect.arrayContaining(["risk-high", "sentiment-negative", "variant-issue"]));
    expect(recommendations.every((item) => item.payload.recipe === true)).toBe(true);
  });

  it("does not propose a vendor classification change when the vendor already exists", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 62,
      confidence: 71,
      product: {
        title: "Example Art Print",
        description: "Decorative wall art print for home display.",
        vendor: "damian",
        productType: "",
        tags: ["art"],
        collections: ["Wall Art"],
      },
      issueSignalCounts: { product_content: 1 },
      metrics: {
        classificationNeedsReview: true,
        catalogProductTypes: ["Art print", "Game console", "Puzzle"],
        productMomentumScore: 84,
        customerSignalCount: 0,
        signalCount: 1,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 0,
        contentIssueCount: 0,
        contentIssues: [],
        contentAnalysis: { issues: [], advisories: [] },
        faqNeed: { shouldRecommend: false },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/classification-vendor",
        productTitle: "Example Art Print",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    const classification = recommendations.find((item) => item.id === "update-product-classification");
    expect(classification).toBeTruthy();
    expect(classification.payload).toMatchObject({
      currentVendor: "damian",
      currentProductType: "",
      draftVendor: "",
      draftProductType: "Art print",
      classificationSource: "store_existing_product_type",
    });
  });

  it("proposes a Shopify taxonomy category when the product has no category and a category suggestion is available", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 62,
      confidence: 71,
      product: {
        title: "Example Art Print",
        description: "Decorative wall art print for home display.",
        vendor: "damian",
        productType: "Art print",
        category: null,
        tags: ["art"],
        collections: ["Wall Art"],
      },
      issueSignalCounts: { product_content: 1 },
      metrics: {
        classificationNeedsReview: true,
        catalogProductTypes: ["Art print", "Game console", "Puzzle"],
        taxonomyCategorySuggestions: [{
          id: "gid://shopify/TaxonomyCategory/aa-1",
          name: "Posters, Prints & Visual Artwork",
          fullName: "Arts & Entertainment > Artwork > Posters, Prints & Visual Artwork",
          isLeaf: true,
          level: 3,
          source: "shopify_taxonomy_search",
        }],
        productMomentumScore: 84,
        customerSignalCount: 0,
        signalCount: 1,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 0,
        contentIssueCount: 0,
        contentIssues: [],
        contentAnalysis: { issues: [], advisories: [] },
        faqNeed: { shouldRecommend: false },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/classification-category",
        productTitle: "Example Art Print",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    const classification = recommendations.find((item) => item.id === "update-product-classification");
    expect(classification).toBeTruthy();
    expect(classification.payload).toMatchObject({
      currentVendor: "damian",
      currentProductType: "Art print",
      draftVendor: "",
      draftProductType: "",
      draftCategoryId: "gid://shopify/TaxonomyCategory/aa-1",
      draftCategoryFullName: "Arts & Entertainment > Artwork > Posters, Prints & Visual Artwork",
      categorySource: "shopify_taxonomy_search",
    });
    expect(classification.payload.shopifyField).toContain("Product.category");
  });

  it("skips product classification recommendations when no real field change is available", () => {
    const deterministic = {
      mainIssue: "product_content",
      riskScore: 62,
      confidence: 71,
      product: {
        title: "Example Art Print",
        description: "Decorative wall art print for home display.",
        vendor: "damian",
        productType: "Art print",
        tags: ["art"],
        collections: ["Wall Art"],
      },
      issueSignalCounts: { product_content: 1 },
      metrics: {
        classificationNeedsReview: true,
        catalogProductTypes: ["Art print", "Game console", "Puzzle"],
        productMomentumScore: 84,
        customerSignalCount: 0,
        signalCount: 1,
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 0,
        contentIssueCount: 0,
        contentIssues: [],
        contentAnalysis: { issues: [], advisories: [] },
        faqNeed: { shouldRecommend: false },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/classification-noop",
        productTitle: "Example Art Print",
      },
      deterministic,
      mainIssue: deterministic.mainIssue,
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("update-product-classification");
  });

  it("treats covered setup guidance as description coverage and uses targeted description edits for remaining gaps", () => {
    const currentDescription = [
      "GEN LumaSpan Modular Desk Rail Light mounts under a shelf or monitor riser with adhesive pads or optional clamp feet.",
      "Use adhesive only on smooth sealed surfaces, not oiled, porous, dusty, textured, or warm undersides; let the adhesive cure before routing the cable.",
      "The USB-C cable exits on the right side by default, and the rail can be flipped only if the control button and cable route still remain reachable.",
      "A USB-C cable is included in the box, but a wall adapter or wall brick is not included.",
      "For webcam or camera use, test shutter settings first because some cameras can show flicker or banding. Glossy desks, glass, and monitors can reflect glare.",
      "Choose the short or long length based on your desk width and preferred light spread.",
    ].join(" ");
    const contentIssues = [
      { code: "missing_specs", label: "Missing lighting specification values", severity: "medium", evidence: "The copy says color temperatures and brightness levels exist, but does not list color-temperature values, lumens, CRI, or beam angle." },
      { code: "missing_dimensions", label: "Missing rail dimensions", severity: "medium", evidence: "The description does not give rail width, height, diffuser dimensions, or coverage by length." },
      { code: "missing_care", label: "Missing cleaning guidance", severity: "medium", evidence: "The description does not explain how to clean the diffuser or what cleaners to avoid." },
    ];
    const deterministic = {
      mainIssue: "setup_expectation",
      riskScore: 86,
      issueSignalCounts: { setup_expectation: 5, quality_defect: 2 },
      evidenceSnippets: [
        { text: "The page technically explains adhesive surfaces and the no-adapter box contents, but I missed the checklist before checkout." },
      ],
      product: {
        title: "GEN LumaSpan Modular Desk Rail Light",
        description: currentDescription,
        descriptionHtml: `<p>${currentDescription}</p>`,
        status: "ACTIVE",
        vendor: "GEN",
        productType: "Desk Lighting",
        variants: [],
        media: [],
      },
      metrics: {
        customerSignalCount: 8,
        signalCount: 11,
        contentIssueCount: contentIssues.length,
        contentIssues,
        contentAnalysis: { issues: contentIssues, advisories: [] },
        faqNeed: {
          shouldRecommend: true,
          score: 8,
          topics: ["Setup guidance"],
          reasons: ["Setup questions repeat across returns and reviews."],
        },
        returnUnits: 3,
        refundUnits: 2,
        negativeReviewCount: 4,
        reviewCount: 13,
        topReturnReasons: ["Setup checklist missed"],
        topReturnReasonDetails: [{ label: "Setup checklist missed", count: 3 }],
        affectedVariants: [],
        affectedVariantDetails: [],
        variants: [],
        refundInsights: { shouldSurface: false },
        textInsights: {
          sentiment: { total: 8, negative: 6, negativeRatio: 0.75 },
          repeatedLanguage: [{ term: "setup checklist missed", count: 4 }],
        },
      },
    };

    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/8786190729304",
        productTitle: "GEN LumaSpan Modular Desk Rail Light",
      },
      deterministic,
      mainIssue: "setup_expectation",
      ai: {
        report: {
          recommendation_copy: {
            pdp_copy: "Before checkout, confirm the mounting surface is sealed, the USB-C cable route works on the right side or flipped setup, no wall adapter is included, and webcam use may show camera banding.",
            faq_items: [{
              question: "What setup details should shoppers confirm before buying GEN LumaSpan Modular Desk Rail Light?",
              answer: "Confirm the mounting surface, cable route, included USB-C cable, missing wall adapter, and camera flicker limits before checkout.",
              reason: "Setup uncertainty repeated.",
            }],
          },
        },
      },
    });

    const byId = new Map(recommendations.map((item) => [item.id, item]));
    expect(byId.has("draft-quality-note")).toBe(false);
    expect(byId.has("improve-setup-guidance")).toBe(false);
    expect(byId.has("add-product-description-guidance")).toBe(false);
    expect(byId.has("create-product-faq")).toBe(false);

    const descriptionUpdate = byId.get("correct-product-description");
    expect(descriptionUpdate).toBeTruthy();
    expect(descriptionUpdate.label).toBe("Update product description details");
    expect(descriptionUpdate.payload).toMatchObject({
      changeStrategy: "targeted-enhancement",
      operation: "replace",
      preserveHtml: true,
    });
    expect(descriptionUpdate.payload.descriptionReplacements.length).toBeGreaterThan(0);
    expect(descriptionUpdate.payload.draftText).toContain("color-temperature values");
    expect(descriptionUpdate.payload.draftText).toContain("rail width and height");
  });

  it("classifies setup expectation language separately from product quality", () => {
    expect(__productPulseDiagnosisTestHooks.classifyIssueText(
      "The page technically explains the flip option, but I missed the control-button tradeoff until install; not broken, just an expectation mismatch.",
    )).toBe("setup_expectation");
    expect(__productPulseDiagnosisTestHooks.classifyIssueText(
      "Auto shutoff looked defective because I boiled below the MIN line; support pointed to the minimum-fill setup rule.",
    )).toBe("setup_expectation");
  });

  it("keeps targeted description edits product-specific for appliance setup gaps", () => {
    const currentDescription = [
      "GEN VoltNest is a compact electric kettle with a folding silicone body, stainless heated base, and locking travel lid.",
      "This model is 120 V only for North American outlets.",
      "Fill above the MIN line before boiling and keep the steam vent facing into open space.",
    ].join(" ");
    const contentIssues = [
      { code: "missing_specifications", label: "Missing capacity and wattage", severity: "high", evidence: "The description explains minimum-fill behavior but does not state capacity, wattage, cord length, or counter clearance." },
      { code: "missing_care", label: "Missing descaling guidance", severity: "medium", evidence: "The description does not explain how to descale mineral buildup or clean the silicone body, lid, and steam vent." },
    ];
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/voltnest",
        productTitle: "GEN VoltNest Foldaway Steam Kettle",
      },
      deterministic: {
        mainIssue: "setup_expectation",
        riskScore: 88,
        confidence: 82,
        issueSignalCounts: { setup_expectation: 5 },
        evidenceSnippets: [
          { text: "Auto shutoff looked defective because the buyer boiled below the MIN line; support pointed to setup guidance." },
        ],
        product: {
          title: "GEN VoltNest Foldaway Steam Kettle",
          description: currentDescription,
          descriptionHtml: `<p>${currentDescription}</p>`,
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Kitchen Appliances",
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 5,
          signalCount: 7,
          contentIssueCount: contentIssues.length,
          contentIssues,
          contentAnalysis: { issues: contentIssues, advisories: [] },
          faqNeed: { shouldRecommend: false },
          returnUnits: 3,
          refundUnits: 2,
          negativeReviewCount: 3,
          reviewCount: 8,
          topReturnReasons: ["Minimum-fill setup missed"],
          topReturnReasonDetails: [{ label: "Minimum-fill setup missed", count: 3 }],
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: {
            sentiment: { total: 5, negative: 4, negativeRatio: 0.8 },
            repeatedLanguage: [{ term: "MIN line setup missed", count: 3 }],
          },
        },
      },
      mainIssue: "setup_expectation",
      ai: { report: { recommendation_copy: {} } },
    });

    const descriptionUpdate = recommendations.find((item) => item.id === "correct-product-description");
    expect(descriptionUpdate).toBeTruthy();
    expect(descriptionUpdate.payload.changeStrategy).toBe("targeted-enhancement");
    expect(descriptionUpdate.payload.draftText).toContain("kettle capacity");
    expect(descriptionUpdate.payload.draftText).toContain("MIN fill line");
    expect(descriptionUpdate.payload.draftText).toContain("descale");
    expect(descriptionUpdate.payload.draftText).not.toContain("rail and diffuser");
    expect(recommendations.map((item) => item.id)).not.toContain("set-product-draft");
  });

  it("does not reuse kettle care language for photo panel power/spec gaps", () => {
    const currentDescription = [
      "GEN PrismHue is a low-profile wall or shelf panel that holds one 5 x 7 in print behind a magnetic clear face.",
      "The box includes the panel, magnetic face, USB-C cable, adhesive wall tabs, and a tabletop foot.",
      "Printed photos and art cards are not included.",
    ].join(" ");
    const contentIssues = [
      { code: "missing_specifications", label: "Missing panel and power specifications", severity: "high", evidence: "The description does not state panel dimensions, card thickness, USB power adapter needs, voltage/wattage, or surface compatibility for adhesive tabs." },
    ];
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/prismhue",
        productTitle: "GEN PrismHue Magnetic Photo Light Panel",
      },
      deterministic: {
        mainIssue: "product_content",
        riskScore: 82,
        confidence: 78,
        issueSignalCounts: { product_content: 4 },
        evidenceSnippets: [
          { text: "The light panel needs clearer media/spec context before purchase." },
        ],
        product: {
          title: "GEN PrismHue Magnetic Photo Light Panel",
          description: currentDescription,
          descriptionHtml: `<p>${currentDescription}</p>`,
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Home Decor",
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 5,
          signalCount: 6,
          contentIssueCount: contentIssues.length,
          contentIssues,
          contentAnalysis: { issues: contentIssues, advisories: [] },
          faqNeed: { shouldRecommend: false },
          returnUnits: 2,
          refundUnits: 2,
          negativeReviewCount: 3,
          reviewCount: 8,
          topReturnReasons: ["Missing panel and power specifications"],
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: { sentiment: { total: 5, negative: 4, negativeRatio: 0.8 } },
        },
      },
      mainIssue: "product_content",
      ai: { report: { recommendation_copy: {} } },
    });

    const serialized = JSON.stringify(recommendations);
    expect(serialized).not.toContain("powered base");
    expect(serialized).not.toContain("descale");
    expect(serialized).not.toContain("silicone body");
    expect(serialized).not.toContain("rail and diffuser");
    expect(serialized).not.toContain("garment measurements");
    expect(serialized).not.toContain("cold wash");
  });

  it("does not treat apparel steam-care wording as kettle context", () => {
    const currentDescription = [
      "GEN DriftWeave is a packable overshirt with finished garment checkpoints.",
      "Use the body-size chart first, then compare shoulder, chest, sleeve, and upper-arm measurements.",
      "Machine wash cold, close the snaps, hang dry, and steam lightly if the pocket fold leaves a crease.",
    ].join(" ");
    const contentIssues = [
      { code: "incoherent_copy", label: "Variant coverage does not match Size option list", severity: "high", evidence: "Options list S, M, L, XL, but some color/size combinations are unavailable." },
    ];
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/driftweave",
        productTitle: "GEN DriftWeave Packable Overshirt",
      },
      deterministic: {
        mainIssue: "fit_sizing",
        riskScore: 88,
        confidence: 82,
        issueSignalCounts: { fit_sizing: 6 },
        evidenceSnippets: [
          { text: "Upper-arm and sweatshirt layering decisions repeat in returns and reviews." },
        ],
        product: {
          title: "GEN DriftWeave Packable Overshirt",
          description: currentDescription,
          descriptionHtml: `<p>${currentDescription}</p>`,
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Apparel",
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 6,
          signalCount: 8,
          contentIssueCount: contentIssues.length,
          contentIssues,
          contentAnalysis: { issues: contentIssues, advisories: [] },
          faqNeed: { shouldRecommend: false },
          returnUnits: 3,
          refundUnits: 2,
          negativeReviewCount: 4,
          reviewCount: 9,
          topReturnReasons: ["Too Small"],
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: {
            sentiment: { total: 6, negative: 5, negativeRatio: 0.83 },
            repeatedLanguage: [{ term: "upper arm", count: 3, issueCode: "fit_sizing" }],
          },
        },
      },
      mainIssue: "fit_sizing",
      ai: { report: { recommendation_copy: {} } },
    });

    const serialized = JSON.stringify(recommendations);
    expect(serialized).not.toContain("capacity, wattage");
    expect(serialized).not.toContain("cord length");
    expect(serialized).not.toContain("safety markings");
    expect(serialized).toContain("color and size combinations");
  });

  it("prefers fit sizing over product quality when apparel evidence is dominated by fit language", () => {
    const issue = __productPulseDiagnosisTestHooks.getEvidencePreferredMainIssue({
      mainIssue: "quality_defect",
      riskScore: 92,
      issueSignalCounts: { quality_defect: 2 },
      product: {
        title: "GEN DriftWeave Packable Overshirt",
        productType: "Apparel",
        tags: ["overshirt", "fit-sizing"],
      },
      metrics: {
        returnUnits: 2,
        refundUnits: 0,
        negativeReviewCount: 3,
        customerSignalCount: 5,
        refundInsights: {
          issueCounts: [{ label: "fit_sizing", count: 3 }],
          examples: [{ text: "Customer says the upper arm felt tight after warm drying.", issueCode: "fit_sizing" }],
        },
        textInsights: {
          repeatedLanguage: [
            { term: "shoulder", count: 7, issueCode: "fit_sizing" },
            { term: "upper arm", count: 4, issueCode: "fit_sizing" },
          ],
        },
        topReturnReasonDetails: [{
          label: "Too Small",
          subReasons: [{ label: "Body fits, shoulder is tolerable, upper arm is the blocker." }],
        }],
      },
    }, "quality_defect");

    expect(issue).toBe("fit_sizing");
  });

  it("does not prefer fit sizing as the main issue when expectation evidence lacks hard metrics", () => {
    const issue = __productPulseDiagnosisTestHooks.getEvidencePreferredMainIssue({
      mainIssue: "fit_sizing",
      riskScore: 76,
      issueSignalCounts: { fit_sizing: 2, quality_defect: 2 },
      product: {
        title: "GEN DriftWeave Packable Overshirt",
        productType: "Apparel",
        tags: ["overshirt", "fit-sizing"],
      },
      metrics: {
        returnUnits: 0,
        refundUnits: 0,
        negativeReviewCount: 2,
        reviewCount: 30,
        customerSignalCount: 2,
        textInsights: {
          sentiment: { negative: 2, negativeRatio: 0.07 },
          repeatedLanguage: [
            { term: "fit", count: 2, issueCode: "fit_sizing" },
          ],
        },
      },
    }, "fit_sizing");

    expect(issue).toBe("quality_defect");
  });

  it("does not propose unrelated taxonomy categories without product-specific token overlap", () => {
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/driftweave",
        productTitle: "GEN DriftWeave Packable Overshirt",
      },
      deterministic: {
        mainIssue: "fit_sizing",
        riskScore: 84,
        issueSignalCounts: { fit_sizing: 5 },
        product: {
          title: "GEN DriftWeave Packable Overshirt",
          description: "Packable overshirt for travel layers.",
          descriptionHtml: "<p>Packable overshirt for travel layers.</p>",
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Apparel",
          category: null,
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 5,
          signalCount: 6,
          contentIssues: [],
          contentAnalysis: { issues: [], advisories: [] },
          taxonomyCategorySuggestions: [{
            id: "gid://shopify/TaxonomyCategory/ap-1",
            name: "Pet Shoes",
            fullName: "Animals & Pet Supplies > Pet Supplies > Pet Apparel > Pet Shoes",
            level: 4,
            isLeaf: true,
            source: "shopify_taxonomy_search",
          }],
          catalogProductTypes: ["Apparel"],
          faqNeed: { shouldRecommend: false },
          returnUnits: 3,
          refundUnits: 0,
          negativeReviewCount: 3,
          reviewCount: 8,
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: { sentiment: { total: 5, negative: 4, negativeRatio: 0.8 } },
        },
      },
      mainIssue: "fit_sizing",
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("update-product-classification");
  });

  it("does not treat generic kitchen taxonomy overlap as a product-specific kettle category", () => {
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/voltnest",
        productTitle: "GEN VoltNest Foldaway Steam Kettle",
      },
      deterministic: {
        mainIssue: "setup_expectation",
        riskScore: 88,
        issueSignalCounts: { setup_expectation: 5 },
        product: {
          title: "GEN VoltNest Foldaway Steam Kettle",
          description: "Compact electric kettle for small kitchens with a MIN fill line and steam vent.",
          descriptionHtml: "<p>Compact electric kettle for small kitchens with a MIN fill line and steam vent.</p>",
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Kitchen Appliances",
          category: null,
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 5,
          signalCount: 6,
          contentIssues: [],
          contentAnalysis: { issues: [], advisories: [] },
          taxonomyCategorySuggestions: [{
            id: "gid://shopify/TaxonomyCategory/hg-11-8-41-5-2",
            name: "Kitchen Utensil Racks",
            fullName: "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Kitchen Organizers > Kitchen Utensil Holders & Racks > Kitchen Utensil Racks",
            level: 6,
            isLeaf: true,
            source: "shopify_taxonomy_search",
          }],
          catalogProductTypes: ["Kitchen Appliances"],
          faqNeed: { shouldRecommend: false },
          returnUnits: 3,
          refundUnits: 2,
          negativeReviewCount: 3,
          reviewCount: 8,
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: { sentiment: { total: 5, negative: 4, negativeRatio: 0.8 } },
        },
      },
      mainIssue: "setup_expectation",
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("update-product-classification");
  });

  it("does not classify a kettle as furniture from incidental cabinet wording", () => {
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/voltnest",
        productTitle: "GEN VoltNest Foldaway Steam Kettle",
      },
      deterministic: {
        mainIssue: "setup_expectation",
        riskScore: 88,
        issueSignalCounts: { setup_expectation: 5 },
        product: {
          title: "GEN VoltNest Foldaway Steam Kettle",
          description: "Compact electric kettle for small kitchens. Keep the steam vent clear of upper cabinets.",
          descriptionHtml: "<p>Compact electric kettle for small kitchens. Keep the steam vent clear of upper cabinets.</p>",
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Kitchen Appliances",
          category: null,
          tags: ["travel-kettle", "kitchen-appliance", "steam-safety"],
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 5,
          signalCount: 6,
          contentIssues: [],
          contentAnalysis: { issues: [], advisories: [] },
          taxonomyCategorySuggestions: [{
            id: "gid://shopify/TaxonomyCategory/fr-4-3-9",
            name: "Kitchen Hutches",
            fullName: "Furniture > Cabinets & Storage > China Cabinets & Hutches > Kitchen Hutches",
            level: 4,
            isLeaf: true,
            source: "shopify_taxonomy_search",
          }],
          catalogProductTypes: ["Kitchen Appliances"],
          faqNeed: { shouldRecommend: false },
          returnUnits: 3,
          refundUnits: 2,
          negativeReviewCount: 3,
          reviewCount: 8,
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: { sentiment: { total: 5, negative: 4, negativeRatio: 0.8 } },
        },
      },
      mainIssue: "setup_expectation",
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("update-product-classification");
  });

  it("does not classify a photo light panel as posters from description-only print wording", () => {
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/prismhue",
        productTitle: "GEN PrismHue Magnetic Photo Light Panel",
      },
      deterministic: {
        mainIssue: "setup_expectation",
        riskScore: 88,
        issueSignalCounts: { setup_expectation: 5 },
        product: {
          title: "GEN PrismHue Magnetic Photo Light Panel",
          description: "Magnetic panel for displaying your own 5x7 prints. Printed photos are not included.",
          descriptionHtml: "<p>Magnetic panel for displaying your own 5x7 prints. Printed photos are not included.</p>",
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Home Decor",
          category: null,
          tags: ["photo-panel", "magnetic-frame", "mounting-surface"],
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 5,
          signalCount: 6,
          contentIssues: [],
          contentAnalysis: { issues: [], advisories: [] },
          taxonomyCategorySuggestions: [{
            id: "gid://shopify/TaxonomyCategory/hg-3-4-2-1",
            name: "Posters",
            fullName: "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork > Posters",
            level: 5,
            isLeaf: true,
            source: "shopify_taxonomy_search",
          }],
          catalogProductTypes: ["Home Decor"],
          faqNeed: { shouldRecommend: false },
          returnUnits: 3,
          refundUnits: 2,
          negativeReviewCount: 3,
          reviewCount: 8,
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: { sentiment: { total: 5, negative: 4, negativeRatio: 0.8 } },
        },
      },
      mainIssue: "setup_expectation",
      ai: { report: { recommendation_copy: {} } },
    });

    expect(recommendations.map((item) => item.id)).not.toContain("update-product-classification");
  });

  it("keeps CSV review cache keys stable when row numbers change", () => {
    const baseReview = {
      sourceType: "csv_review",
      productId: "judge-me-product-123",
      sourceProductId: "source-product-abc",
      handle: "gen-voltnest-foldaway-steam-kettle",
      rating: 2,
      title: "Graphite needs a MIN line closeup",
      body: "The fill mark still disappears in my kitchenette light.",
      createdAt: "2026-05-29T20:30:00.000Z",
      reviewerName: "Mock Reviewer Volt",
    };

    const firstKey = __productPulseDiagnosisTestHooks.getReviewTextCacheKey({ ...baseReview, sourceRow: 40 });
    const secondKey = __productPulseDiagnosisTestHooks.getReviewTextCacheKey({ ...baseReview, sourceRow: 56 });
    const sameDayDifferentTimeKey = __productPulseDiagnosisTestHooks.getReviewTextCacheKey({
      ...baseReview,
      sourceRow: 57,
      createdAt: "2026-05-29T22:30:00.000Z",
    });
    const differentKey = __productPulseDiagnosisTestHooks.getReviewTextCacheKey({ ...baseReview, body: "A different review body.", sourceRow: 56 });

    expect(firstKey).toBe(secondKey);
    expect(sameDayDifferentTimeKey).toBe(firstKey);
    expect(differentKey).not.toBe(firstKey);
  });

  it("does not use apparel measurement guidance for photo panel description gaps", () => {
    const guidance = __productPulseDiagnosisTestHooks.buildCustomerFacingDescriptionAddendum({
      title: "GEN PrismHue Magnetic Photo Light Panel",
      contentIssues: [
        {
          label: "Missing setup and fit dimensions",
          evidence: "Customers need mounting surface fit, visible print area, and room-light context before purchase.",
          code: "missing_specs",
        },
      ],
    });

    expect(guidance).toContain("panel outer dimensions");
    expect(guidance).toContain("mounting surface compatibility");
    expect(guidance).not.toContain("garment measurements");
    expect(guidance).not.toContain("selected size");
  });

  it("prefers photo panel description enhancements over incidental rail language", () => {
    const sentences = __productPulseDiagnosisTestHooks.buildTargetedDescriptionEnhancementSentences({
      product: {
        title: "GEN PrismHue Magnetic Photo Light Panel",
        productType: "Home Decor",
      },
      currentDescription: "Backlit magnetic panel for 5 x 7 prints with adhesive wall tabs and a tabletop foot.",
      contentIssues: [
        {
          label: "Missing dimensions and diffuser context",
          evidence: "Customers need panel dimensions, visible print area, and surface compatibility; avoid rail-style guidance.",
        },
      ],
    });

    const joined = sentences.join(" ");
    expect(joined).toContain("panel outer dimensions");
    expect(joined).toContain("visible 5 x 7 print area");
    expect(joined).not.toContain("rail width");
    expect(joined).not.toContain("diffuser dimensions");
  });

  it("keeps repeated setup language out of product-quality issue buckets", () => {
    const issues = __productPulseDiagnosisTestHooks.buildFinalIssues({
      deterministic: {
        mainIssue: "setup_expectation",
        riskScore: 84,
        confidence: 86,
        issueSignalCounts: { setup_expectation: 5 },
        metrics: {
          signalCount: 5,
          customerSignalCount: 5,
          returnUnits: 2,
          refundUnits: 0,
          negativeReviewCount: 3,
          contentAnalysis: { issues: [] },
          textInsights: {
            sentiment: { negative: 5, total: 5, negativeRatio: 1 },
            repeatedLanguage: [{ term: "cable", count: 5, issueCode: "setup_expectation" }],
          },
        },
      },
      ai: {
        classification: {
          clusters: [],
          repeated_language: [{
            term: "cable",
            count: 5,
            severity: "medium",
            issue_category: "quality_defect",
            explanation: "Customers describe a cable routing mismatch after setup and say the listing made the side exit easy to miss.",
            source_types: ["returns", "reviews"],
            dominantSentiment: "negative",
            sentiments: { negative: 5 },
          }],
        },
      },
      mainIssue: "setup_expectation",
      recommendations: [],
    });

    expect(issues.some((issue) => issue.issueCode === "setup_expectation")).toBe(true);
    expect(issues.some((issue) => issue.issueCode === "quality_defect")).toBe(false);
  });

  it("does not generate apparel measurement guidance for non-apparel dimension gaps", () => {
    const currentDescription = "GEN Arc Desk Lamp is a compact adjustable task lamp for work tables, reading corners, and shelving. It includes a weighted base, tilting head, warm and cool light modes, touch controls, and a braided USB-C cable for desk routing.";
    const contentIssues = [{
      code: "missing_dimensions",
      label: "Missing product measurements",
      severity: "medium",
      evidence: "The description does not list width, height, depth, or footprint measurements for shoppers comparing desk space.",
    }];
    const recommendations = __productPulseDiagnosisTestHooks.buildFinalRecommendations({
      snapshot: {
        productGid: "gid://shopify/Product/2",
        productTitle: "GEN Arc Desk Lamp",
      },
      deterministic: {
        mainIssue: "product_content",
        riskScore: 72,
        issueSignalCounts: { product_content: 1 },
        product: {
          title: "GEN Arc Desk Lamp",
          description: currentDescription,
          descriptionHtml: `<p>${currentDescription}</p>`,
          status: "ACTIVE",
          vendor: "GEN",
          productType: "Desk Lighting",
          variants: [],
          media: [],
        },
        metrics: {
          customerSignalCount: 2,
          signalCount: 3,
          contentIssueCount: 1,
          contentIssues,
          contentAnalysis: { issues: contentIssues, advisories: [] },
          faqNeed: { shouldRecommend: false },
          returnUnits: 2,
          refundUnits: 0,
          negativeReviewCount: 0,
          reviewCount: 2,
          topReturnReasons: [],
          affectedVariants: [],
          affectedVariantDetails: [],
          variants: [],
          refundInsights: { shouldSurface: false },
          textInsights: { sentiment: { total: 2, negative: 1, negativeRatio: 0.5 } },
        },
      },
      mainIssue: "product_content",
      ai: { report: { recommendation_copy: {} } },
    });

    const serialized = JSON.stringify(recommendations);
    expect(serialized).not.toContain("garment measurements");
    expect(serialized).toContain("product dimensions");
  });

  it("calculates Sales Momentum from recent sales velocity, growth and catalog baseline", () => {
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
    expect(momentum.inputs.weeklyUnitsLast8Weeks).toHaveLength(8);
    expect(momentum.inputs.weeklyRevenueLast8Weeks).toHaveLength(8);
    expect(momentum.inputs.weeklyUnitsLast8Weeks.slice(-4)).toEqual(momentum.inputs.weeklyUnitsLast4Weeks);
    expect(momentum.display.catalogPositionLabel).toMatch(/Top|baseline/);
    expect(momentum.confidence).toBeGreaterThan(50);
  });
});
