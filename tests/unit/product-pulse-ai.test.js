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
    process.env.OPENAI_PREMIUM_MODEL = "gpt-5.4";
    delete process.env.PRODUCT_PULSE_USE_PRODUCTION_AI;
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

  it("uses OpenAI when production AI is enabled by environment", async () => {
    process.env.PRODUCT_PULSE_USE_PRODUCTION_AI = "true";
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("generativelanguage")) {
        throw new Error("Gemini should not be called when production AI is enabled.");
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
      model: "gpt-5.4",
      text: "OpenAI production response.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.openai.com");
    expect(mocks.recordJobLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "product_diagnosis.ai_provider_selected",
      data: expect.objectContaining({
        provider: "openai",
        productionAiEnabled: true,
        configuredBy: "PRODUCT_PULSE_USE_PRODUCTION_AI",
      }),
    }));
  });

  it("uses Gemini when production AI is disabled by environment", async () => {
    process.env.PRODUCT_PULSE_USE_PRODUCTION_AI = "false";
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("api.openai.com")) {
        throw new Error("OpenAI should not be called when production AI is disabled.");
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
          recommendation_copy: {},
        }),
        JSON.stringify({
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

    expect(prompts).toHaveLength(5);
    expect(prompts[0]).toContain("Predefined sentiment taxonomy");
    expect(prompts[1]).toContain("clustering customer emotions");
    expect(prompts[3]).toContain("Write main_finding_detail as 1 to 3 merchant-facing paragraphs");
    expect(prompts[3]).toContain("Do not let reviews consume the whole main finding");
    expect(prompts[4]).toContain("Why this action");
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
