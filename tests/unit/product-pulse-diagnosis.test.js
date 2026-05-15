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
    expect(query).toContain("refundLineItems(first: $refundLineItemsFirst");
    expect(query).toMatch(/variant\s*{[\s\S]*?product\s*{/);
    expect(fallbackQuery).not.toContain("orderAdjustments");
    expect(fallbackQuery).not.toMatch(/variant\s*{[\s\S]*?product\s*{/);
    expect(queryModes).toEqual(["updated_at", "partially_refunded", "refunded"]);
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
  });

  it("only flags title and description mismatch when product categories are clearly disconnected", () => {
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
    expect(disconnected.issues.map((issue) => issue.code)).toContain("title_description_mismatch");
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

    expect(supported.shouldRecommend).toBe(true);
    expect(supported.topics).toContain("Compatibility");
    expect(isolated.shouldRecommend).toBe(false);
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
      "metafield-json",
    ]);
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
    expect(byId.get("apply-risk-tags")?.payload.tags).toEqual(expect.arrayContaining(["risk-high", "sentiment-negative", "variant-issue"]));
    expect(recommendations.every((item) => item.payload.recipe === true)).toBe(true);
  });
});
