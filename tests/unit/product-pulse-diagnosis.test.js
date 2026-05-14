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
    expect(insights.riskLift).toBeGreaterThan(0);
    expect(insights.repeatedLanguage.map((item) => item.term)).toContain("refunded");
    expect(insights.examples[0].text).toContain("arrived broken");
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
});
