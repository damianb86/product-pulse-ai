/* eslint-env node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordJobLog: vi.fn(),
  providerFindUnique: vi.fn(),
  providerUpsert: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    productPulseAiProviderState: {
      findUnique: mocks.providerFindUnique,
      upsert: mocks.providerUpsert,
    },
  },
}));

vi.mock("../../app/lib/product-pulse-dev.server", () => ({
  isProductPulseDevelopment: () => true,
}));

vi.mock("../../app/lib/product-pulse-job-logs.server", () => ({
  recordJobLog: mocks.recordJobLog,
  serializeError: (error) => ({
    name: error?.name,
    message: error?.message || String(error),
    status: error?.status,
    code: error?.code,
  }),
}));

const {
  __productPulseAiTestHooks,
  buildCompactProductChartInterpretationInput,
  buildCompactProductRelationshipAiInput,
  generateProductDiagnosisTestText,
  normalizeProductRelationshipAiInsights,
  runProductDiagnosisAiAnalysis,
} = await import("../../app/lib/product-pulse-ai.server.js");

describe("ProductPulse AI provider fallback", () => {
  beforeEach(() => {
    mocks.recordJobLog.mockClear();
    mocks.providerFindUnique.mockReset().mockResolvedValue(null);
    mocks.providerUpsert.mockReset().mockResolvedValue({});
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.GEMINI_MODEL = "gemini-a";
    process.env.GEMINI_MODEL_FALLBACK_POOL = "gemini-b";
    process.env.OPENAI_API_KEY = "openai-test-key";
    process.env.OPENAI_BASIC_MODEL = "gpt-5.4-nano";
    process.env.OPENAI_PRO_MODEL = "gpt-5.4-mini";
    process.env.OPENAI_PREMIUM_MODEL = "gpt-5.4";
    delete process.env.PRODUCT_PULSE_AI_LEVEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses OpenAI nano when all Gemini models hit quota", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("generativelanguage")) {
        return new Response(JSON.stringify({
          error: { message: "Quota exceeded for this Gemini model.", status: "RESOURCE_EXHAUSTED" },
        }), { status: 429, headers: { "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ output_text: "OpenAI nano fallback response." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-1",
      product: { title: "Linen Shirt", handle: "linen-shirt", metrics: {} },
    });

    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-nano",
      text: "OpenAI nano fallback response.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.recordJobLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "product_diagnosis.gemini_pool_exhausted_openai_fallback",
    }));
    const recoveryLogs = mocks.recordJobLog.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.event === "product_diagnosis.gemini_model_recovery");
    expect(recoveryLogs).toHaveLength(2);
    expect(recoveryLogs[0].data).toMatchObject({
      recovery: "next_gemini_model",
      providerError: expect.objectContaining({ status: 429 }),
    });
    expect(recoveryLogs[0].data.error).toBeUndefined();
    expect(recoveryLogs[1].data).toMatchObject({
      recovery: "openai_nano",
      providerError: expect.objectContaining({ status: 429 }),
    });
    expect(recoveryLogs[1].data.error).toBeUndefined();
  });

  it("uses tiered OpenAI models when AI level 3 is configured", async () => {
    process.env.PRODUCT_PULSE_AI_LEVEL = "3";
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("generativelanguage")) {
        throw new Error("Gemini should not be called when AI level 3 is configured.");
      }

      return new Response(JSON.stringify({ output_text: "OpenAI production response." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-openai-env",
      product: { title: "Linen Shirt", handle: "linen-shirt", metrics: {} },
    });

    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-nano",
      text: "OpenAI production response.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.openai.com");
    expect(mocks.recordJobLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "product_diagnosis.ai_provider_selected",
      data: expect.objectContaining({
        provider: "openai",
        aiLevel: 3,
        aiLevelLabel: "production_tiered_openai",
        modelMode: "openai_tiered",
        configuredBy: "PRODUCT_PULSE_AI_LEVEL",
      }),
    }));
  });

  it("builds Watchlist narrative prompts from concrete changes instead of historical aggregates", () => {
    const prompt = __productPulseAiTestHooks.buildWatchChangeReportNarrativePrompt({
      productTitle: "GEN EchoLock Voice Safe",
      report: {
        status: "changed",
        headline: "New orders increased.",
        sourceChanges: [{
          id: "new-orders",
          source: "orders",
          label: "New orders",
          value: "1 order",
          delta: "+4 units",
          detail: "New activity by variant/SKU: Matte Black.",
          items: [{ variant: "Matte Black", quantity: 4, amount: 384, createdAt: "2026-05-24T03:43:48.000Z" }],
        }],
        sourceInsights: [{
          id: "return-evidence",
          title: "Return evidence changed",
          metric: "7 returned units",
          summary: "Return pressure moved from 50% to 39%.",
        }],
        changes: [
          { label: "Return rate", from: "50%", to: "39%", delta: "-11%" },
          { label: "Refund rate", from: "29%", to: "22%", delta: "-6.4%" },
        ],
        previous: {
          returnUnits: 7,
          refundUnits: 4,
          reviewCount: 52,
          evidenceDetails: {
            returns: { items: [{ text: "Historical return note that must not be sent." }] },
          },
        },
        current: {
          returnUnits: 7,
          refundUnits: 4,
          reviewCount: 52,
          evidenceDetails: {
            returns: { items: [{ text: "Historical current return note that must not be sent." }] },
          },
        },
      },
    });
    const payload = JSON.parse(prompt.slice(prompt.indexOf("{")));

    expect(payload.concreteSourceTypes).toEqual(["orders"]);
    expect(payload.notNewSourceTypes).toEqual(expect.arrayContaining(["returns", "refunds", "reviews", "content"]));
    expect(payload.concreteSourceChanges[0]).toMatchObject({
      source: "orders",
      value: "1 order",
      delta: "+4 units",
    });
    expect(JSON.stringify(payload)).not.toContain("Historical return note");
    expect(prompt).toContain("Only say there were new returns, refunds, reviews");
    expect(prompt).toContain("notNewSourceTypes");
  });

  it("uses OpenAI basic for every task when AI level 2 is configured", async () => {
    process.env.PRODUCT_PULSE_AI_LEVEL = "2";
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("generativelanguage")) {
        throw new Error("Gemini should not be called when AI level 2 is configured.");
      }

      return new Response(JSON.stringify({ output_text: "OpenAI basic response." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-basic-env",
      product: { title: "Linen Shirt", handle: "linen-shirt", metrics: {} },
    });

    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-nano",
      text: "OpenAI basic response.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.openai.com");
    expect(mocks.recordJobLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "product_diagnosis.ai_provider_selected",
      data: expect.objectContaining({
        provider: "openai",
        aiLevel: 2,
        aiLevelLabel: "development_openai_basic",
        modelMode: "openai_basic_only",
        configuredBy: "PRODUCT_PULSE_AI_LEVEL",
      }),
    }));
  });

  it("uses Gemini when AI level 1 is configured", async () => {
    process.env.PRODUCT_PULSE_AI_LEVEL = "1";
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("api.openai.com")) {
        throw new Error("OpenAI should not be called when AI level 1 is configured.");
      }

      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Gemini development response." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-gemini-env",
      product: { title: "Linen Shirt", handle: "linen-shirt", metrics: {} },
    });

    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-a",
      text: "Gemini development response.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage");
  });

  it("fails with Gemini and OpenAI details when nano fallback fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("generativelanguage")) {
        return new Response(JSON.stringify({
          error: { message: "Model is overloaded due to high demand.", status: "UNAVAILABLE" },
        }), { status: 503, headers: { "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        error: { message: "OpenAI nano rate limit reached.", code: "rate_limit_exceeded" },
      }), { status: 429, headers: { "Content-Type": "application/json" } });
    }));

    await expect(generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-2",
      product: { title: "Canvas Tote", handle: "canvas-tote", metrics: {} },
    })).rejects.toThrow(/Gemini.*OpenAI nano.*rate limit reached/);
  });

  it("uses the next Gemini model after an internal provider error", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("gemini-a")) {
        return new Response(JSON.stringify({
          error: { message: "Internal error encountered.", status: "INTERNAL", code: 500 },
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Gemini fallback model response." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-internal",
      product: { title: "Peacat Egg", handle: "peacat-egg", metrics: {} },
    });

    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-b",
      text: "Gemini fallback model response.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const recoveryLog = mocks.recordJobLog.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload.event === "product_diagnosis.gemini_model_recovery");
    expect(recoveryLog).toMatchObject({
      level: "warn",
      data: expect.objectContaining({
        model: "gemini-a",
        nextModel: "gemini-b",
        retryReason: "transient",
        recovery: "next_gemini_model",
        providerError: expect.objectContaining({ status: 500 }),
      }),
    });
    expect(recoveryLog.data.error).toBeUndefined();
  });

  it("uses OpenAI nano when all Gemini models hit transient fetch failures", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("generativelanguage")) {
        const error = new TypeError("fetch failed");
        error.cause = {
          name: "HeadersTimeoutError",
          code: "UND_ERR_HEADERS_TIMEOUT",
          message: "Headers Timeout Error",
        };
        throw error;
      }

      return new Response(JSON.stringify({ output_text: "OpenAI nano recovered from Gemini timeout." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProductDiagnosisTestText({
      shop: "test-shop.myshopify.com",
      jobId: "job-timeout",
      product: { title: "Bakery Chef Doll", handle: "bakery-chef-doll", metrics: {} },
    });

    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-nano",
      text: "OpenAI nano recovered from Gemini timeout.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.recordJobLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "product_diagnosis.gemini_pool_exhausted_openai_fallback",
    }));
  });

  it("clusters AI-suggested emergent sentiments after signal classification", async () => {
    const prompts = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      prompts.push(body.contents[0].parts[0].text);
      const responseText = [
        JSON.stringify({
          classified_signals: [{
            source: "shopify_return_note",
            text: "It feels cursed and makes me uneasy.",
            issue_category: "other",
            issue_detail: "unusual_emotional_reaction",
            sentiment: "negative",
            known_emotion: "none",
            suggested_emotion: "superstitious_discomfort",
            suggested_emotion_reason: "The reaction is not simple fear or frustration.",
            severity: "medium",
            product_related: true,
            recommended_action_type: "description_update",
          }],
          clusters: [],
          granular_findings: [],
          repeated_language: [],
          sentiment_summary: { dominant_sentiment: "negative", negative_count: 1, neutral_count: 0, positive_count: 0 },
          main_issue: "other",
          issue_summary: "Unusual emotional language appears in return notes.",
          source_agreement: "single_source",
        }),
        JSON.stringify({
          emergent_sentiments: [{
            label: "Superstitious discomfort",
            normalized_label: "superstitious_discomfort",
            polarity: "negative",
            signals: 2,
            confidence: "medium",
            has_sufficient_evidence: true,
            merged_from: ["superstitious_discomfort", "uneasy"],
            source_types: ["shopify_return_note"],
            issue_category: "other",
            merchant_summary: "Customers describe a superstitious discomfort not covered by the base taxonomy.",
            evidence: ["It feels cursed", "Makes me uneasy"],
            suggested_action: "Review emotional positioning in product copy",
          }],
          discarded_suggestions: [],
          summary: "One emergent sentiment deserves review.",
        }),
        JSON.stringify({ missing: [], present: [], notes: "No content gaps." }),
        JSON.stringify({
          main_finding_title: "Unusual customer sentiment needs review",
          main_finding_detail: "Return notes include unusual emotional language.",
          evidence_summary: "Shopify return notes contain repeated emotional language.",
          basket_context_interpretation: "Purchase context should be read as a qualitative modifier alongside the final report, not as a separate numeric recap.",
          recommendation_copy: {},
          action_rationales: [],
        }),
      ][prompts.length - 1];

      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: responseText }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await runProductDiagnosisAiAnalysis({
      shop: "test-shop.myshopify.com",
      jobId: "job-3",
      input: {
        product: { title: "Antique Figure" },
        deterministic: { mainIssue: "product_quality", mainIssueLabel: "Product quality", metrics: {} },
        evidenceSnippets: [{
          source: "shopify_return_note",
          text: "It feels cursed and makes me uneasy.",
        }],
        recommendationCandidates: [],
      },
    });

    expect(prompts).toHaveLength(4);
    expect(prompts[0]).toContain("Predefined sentiment taxonomy");
    expect(prompts[1]).toContain("clustering customer emotions");
    expect(prompts[3]).toContain("Write main_finding_detail as exactly five merchant-facing text blocks");
    expect(prompts[3]).toContain("What is wrong? Why do we believe that? What should we do now? How much does it matter?");
    expect(prompts[3]).toContain("Do not let reviews consume the whole main finding");
    expect(prompts[3]).toContain("basket_context_interpretation");
    expect(prompts[3]).toContain("as few numeric values as possible");
    expect(prompts[3]).toContain("Why this action");
    expect(result.report.basket_context_interpretation).toContain("qualitative modifier");
    expect(result.emergentSentiments.emergent_sentiments[0]).toMatchObject({
      normalized_label: "superstitious_discomfort",
      has_sufficient_evidence: true,
    });
    expect(result.modelsUsed.emergentSentiment).toMatchObject({
      provider: "gemini",
      model: "gemini-a",
      task: "emergent_sentiment",
    });
  });

  it("generates all chart business interpretations in one intermediate-cost diagnosis call", async () => {
    process.env.PRODUCT_PULSE_AI_LEVEL = "3";
    const requests = [];
    const responses = [
      {
        classified_signals: [],
        clusters: [],
        granular_findings: [],
        repeated_language: [],
        sentiment_summary: {},
        main_issue: "product_quality",
        issue_summary: "Deterministic issue signals were used.",
        source_agreement: "single_source",
      },
      { emergent_sentiments: [], discarded_suggestions: [], summary: "No emergent sentiment." },
      { missing: [], present: [], notes: "No content gaps." },
      {
        main_finding_title: "Order activity needs review",
        main_finding_detail: "Order and return activity changed recently.",
        evidence_summary: "The chart data shows a recent change.",
        basket_context_interpretation: "",
        recommendation_copy: {},
        action_rationales: [],
      },
      {
        chart_interpretations: {
          monthly_order_activity: "Orders rose in May while returns and refunds also appeared, so the product has demand but operational outcomes should be watched closely.",
          return_rate_prediction: "The forecast stays elevated after recent returns, which suggests the next cohorts may continue to carry return pressure.",
          product_retention_metrics: "Retention is limited, so repeat demand is not yet offsetting the cost of post-purchase issues.",
          product_risk_over_time: "Risk moved upward across the saved history, making the recent order activity more important to review.",
          product_momentum: "Sales Momentum is concentrated in the latest week, which points to fresh activity rather than a long stable sales pattern.",
        },
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const responseText = JSON.stringify(responses[requests.length - 1] || {});
      return new Response(JSON.stringify({ output_text: responseText }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const result = await runProductDiagnosisAiAnalysis({
      shop: "test-shop.myshopify.com",
      jobId: "job-chart-interpretations",
      input: {
        product: { title: "Yoga Mat", handle: "yoga-mat" },
        deterministic: {
          riskScore: 72,
          confidence: 81,
          mainIssue: "product_quality",
          mainIssueLabel: "Product quality",
          metrics: {
            monthlyOrderActivity: {
              windowDays: 365,
              months: [
                { key: "2026-04", label: "Apr 2026", orders: 1, orderUnits: 1, returnedUnits: 0, refundedUnits: 0, revenue: 48, refundAmount: 0 },
                { key: "2026-05", label: "May 2026", orders: 3, orderUnits: 4, returnedUnits: 2, refundedUnits: 1, revenue: 192, refundAmount: 42 },
              ],
              summary: { totalOrders: 4, totalOrderUnits: 5, totalReturnedUnits: 2, totalRefundedUnits: 1, totalRevenue: 240, totalRefundAmount: 42, returnRate: 40, refundRate: 20 },
            },
            returnRatePrediction: {
              observedPoints: [
                { key: "2026-W18", label: "W18", orders: 1, orderUnits: 1, returnedUnits: 0, smoothedReturnRate: 4 },
                { key: "2026-W19", label: "W19", orders: 3, orderUnits: 4, returnedUnits: 2, smoothedReturnRate: 28 },
              ],
              forecastPoints: [
                { key: "2026-W20", label: "W20", predictedReturnRate: 31, basePredictedReturnRate: 35, baselineReturnRate: 30, seasonalReturnRate: 32 },
              ],
              summary: { totalOrderUnits: 5, totalReturnedUnits: 2, totalReturnRate: 40, last30DayReturnRate: 40, last60DayReturnRate: 40, forecastNext90ReturnRate: 31, confidence: "Medium" },
              actionAdjustment: { adjustmentPoints: -4, uncertaintyLift: 1.1, applied: 1, reviewed: 1, dismissed: 0, pending: 2, total: 4 },
            },
            productRetention: {
              summary: { totalCustomersAnalyzed: 6, repeatPurchaseRate90d: 16.7, productLtv90Cents: 4800, retentionHealthScore: 42, hasEnoughData: true, earliestOrderDate: "2026-01-01", latestOrderDate: "2026-05-01" },
              retentionHealthTrend: [{ date: "2026-05-01", retentionHealthScore: 42, repeatPurchaseRate90d: 16.7, productLtv90Cents: 4800 }],
              ltvCurve: [{ ageDay: 90, cumulativeLtvCents: 4800, sameProductLtvCents: 4800, otherProductLtvCents: 0 }],
            },
            riskHistory: [
              { label: "Apr 2026", riskScore: 48, confidence: 70, returnRate: 0, refundRate: 0 },
              { label: "May 2026", riskScore: 72, confidence: 81, returnRate: 40, refundRate: 20 },
            ],
            productMomentum: {
              score: 85,
              tier: "Hot",
              direction: "rising",
              confidence: 74,
              confidenceLabel: "Medium",
              components: { currentVelocityScore: 91, growthScore: 100, catalogShareScore: 78, trendConsistencyScore: 58, recencyScore: 100 },
              inputs: { unitsLast7Days: 4, unitsLast30Days: 4, unitsPrevious30Days: 0, revenueLast30Days: 192, weeklyUnitsLast4Weeks: [0, 0, 0, 4], lastSaleAt: "2026-05-20T12:00:00.000Z" },
              display: { trendLabel: "New activity", growthLabel: "+100%", growthPercent: 100, catalogPositionLabel: "Top 20%" },
            },
          },
        },
        evidenceSnippets: [],
        recommendationCandidates: [],
      },
    });

    expect(requests).toHaveLength(5);
    expect(requests[0].model).toBe("gpt-5.4-mini");
    expect(requests[1].model).toBe("gpt-5.4-nano");
    expect(requests[2].model).toBe("gpt-5.4-mini");
    expect(requests[3].model).toBe("gpt-5.4");
    const chartRequests = requests.filter((request) => String(request.input).includes("chart_interpretations"));
    expect(chartRequests).toHaveLength(1);
    expect(chartRequests[0].model).toBe("gpt-5.4-mini");
    expect(chartRequests[0].input).toContain("Interpret the actual business story");
    expect(chartRequests[0].input).toContain("monthly_order_activity");
    expect(chartRequests[0].input).toContain("return_rate_prediction");
    expect(result.modelsUsed.chartInterpretations).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      task: "chart_interpretations",
    });
    expect(result.chartInterpretations.interpretations.monthlyOrderActivity.text).toContain("Orders rose in May");
    expect(result.chartInterpretations.interpretations.productMomentum.text).toContain("latest week");
  });

  it("marks diagnosis-compacted chart inputs available for all product detail chart interpretations", () => {
    const compact = buildCompactProductChartInterpretationInput({
      product: { title: "Cooling Pillow", handle: "gen-cooling-pillow-26a108d0" },
      deterministic: {
        riskScore: 84,
        confidence: 90,
        metrics: {
          monthlyOrderActivity: {
            months: [
              { key: "2026-04", label: "Apr 2026", orders: 4, orderUnits: 4, returnedUnits: 2, refundedUnits: 1, revenue: 120, refundAmount: 48 },
              { key: "2026-05", label: "May 2026", orders: 7, orderUnits: 8, returnedUnits: 5, refundedUnits: 2, revenue: 246, refundAmount: 68 },
            ],
            summary: { totalOrders: 11, totalOrderUnits: 12, totalReturnedUnits: 7, totalRefundedUnits: 3, totalRevenue: 366, totalRefundAmount: 116, returnRate: 58.33, refundRate: 25 },
          },
          returnRatePrediction: {
            observedPoints: [
              { key: "2026-W18", label: "W18", orders: 2, orderUnits: 2, returnedUnits: 1, smoothedReturnRate: 25 },
              { key: "2026-W19", label: "W19", orders: 5, orderUnits: 6, returnedUnits: 4, smoothedReturnRate: 48 },
            ],
            forecastPoints: [
              { key: "2026-W20", label: "W20", predictedReturnRate: 42, basePredictedReturnRate: 45 },
            ],
            summary: { totalOrderUnits: 12, totalReturnedUnits: 7, totalReturnRate: 58.33, forecastNext90ReturnRate: 41.86, confidence: "Low" },
          },
          productRetention: {
            available: true,
            hasEnoughData: true,
            totalProductCohortCustomers: 7,
            totalProductOrdersAnalyzed: 14,
            retentionHealthScore: 93,
            repeatPurchaseRate90d: 1,
            sameProductRepurchaseRate90d: 0.857143,
            crossSellRetentionRate90d: 0.142857,
            productLtv90Cents: 10200,
            trend: [{ date: "2026-05-01", retentionHealthScore: 93, repeatPurchaseRate90d: 1, productLtv90Cents: 10200 }],
          },
          riskHistory: [
            { label: "Apr 2026", riskScore: 71, confidence: 88, returnRate: 35, refundRate: 10 },
            { label: "May 2026", riskScore: 84, confidence: 90, returnRate: 58.33, refundRate: 25 },
          ],
          productMomentum: {
            score: 77,
            tier: "Active",
            direction: "rising",
            confidence: 82,
            confidenceLabel: "High",
            components: { currentVelocityScore: 74, growthScore: 80, catalogShareScore: 70, trendConsistencyScore: 68, recencyScore: 95 },
            inputs: { unitsLast7Days: 2, unitsLast30Days: 8, unitsPrevious30Days: 4, revenueLast30Days: 246, weeklyUnitsLast4Weeks: [1, 1, 2, 4], lastSaleAt: "2026-05-20T12:00:00.000Z" },
            display: { trendLabel: "Sales activity rising", growthLabel: "+100%", growthPercent: 100, catalogPositionLabel: "Top 30%" },
          },
        },
      },
    });

    expect(compact.available).toBe(true);
    expect(compact.charts.monthly_order_activity.available).toBe(true);
    expect(compact.charts.return_rate_prediction.available).toBe(true);
    expect(compact.charts.product_retention_metrics.available).toBe(true);
    expect(compact.charts.product_risk_over_time.available).toBe(true);
    expect(compact.charts.product_momentum.available).toBe(true);
    expect(compact.charts.product_retention_metrics.summary).toMatchObject({
      totalCustomersAnalyzed: 7,
      retentionHealthScore: 93,
    });
  });

  it("builds sanitized compact relationship insight input without raw customer or order payloads", () => {
    const compact = buildCompactProductRelationshipAiInput({
      product: { title: "Main product", handle: "main-product" },
      deterministic: {
        metrics: {
          productRelationshipFactors: {
            aiInsightInput: {
              confidence: { score: 82, label: "High" },
              topRelationships: [{
                relatedProductId: "gid://shopify/Product/care-kit",
                relatedProductTitle: "Care Kit",
                relationshipType: "same_order",
                direction: "together",
                timeWindow: "same_order",
                relationshipRate: 42,
                lift: 2.4,
                confidence: 82,
                sampleSize: 5,
                relationshipStrength: "strong",
                rawCustomerEmail: "owner@example.com",
                orderIds: ["gid://shopify/Order/1"],
              }],
            },
          },
        },
      },
    });

    expect(compact.available).toBe(true);
    expect(compact.relationships[0]).toMatchObject({
      sourceRelationshipId: "gid://shopify/Product/care-kit:together:same_order",
      relatedProductTitle: "Care Kit",
      lift: 2.4,
      sampleSize: 5,
    });
    expect(JSON.stringify(compact)).not.toContain("owner@example.com");
    expect(JSON.stringify(compact)).not.toContain("gid://shopify/Order/1");
    expect(JSON.stringify(compact)).not.toContain("rawCustomerEmail");
  });

  it("normalizes relationship AI insights without invented source IDs, PII, causal language, or direct Shopify mutation claims", () => {
    const compact = {
      available: true,
      confidence: { score: 42, label: "Low" },
      warnings: [],
      relationships: [{
        sourceRelationshipId: "gid://shopify/Product/care-kit:together:same_order",
        relatedProductTitle: "Care Kit",
        relationshipType: "same_order",
        direction: "together",
        timeWindow: "same_order",
        lift: 2.4,
        confidence: 42,
        sampleSize: 2,
        relationshipStrength: "weak",
        trend: "stable",
        deltaReturnRate: 8,
        deltaRefundRate: 2,
      }],
    };

    const normalized = normalizeProductRelationshipAiInsights({
      insights: [
        {
          source_relationship_id: "gid://shopify/Product/care-kit:together:same_order",
          type: "compatibility_context",
          summary: "Care Kit causes 8% more returns for owner@example.com.",
          recommendation: "Apply it directly to Shopify after 2 orders.",
          caveat: "",
        },
        {
          source_relationship_id: "invented:after:30d",
          type: "cross_sell_opportunity",
          summary: "Invented relation.",
        },
      ],
    }, compact, { model: "gpt-5.4-mini" });

    expect(normalized.insights).toHaveLength(1);
    expect(normalized.insights[0].summary).not.toContain("owner@example.com");
    expect(normalized.insights[0].summary).not.toMatch(/\bcauses\b/i);
    expect(normalized.insights[0].summary).not.toContain("8%");
    expect(normalized.insights[0].recommendation).not.toMatch(/directly to Shopify/i);
    expect(normalized.insights[0].caveat).toContain("Low confidence");
    expect(normalized.model).toBe("gpt-5.4-mini");
  });
});
