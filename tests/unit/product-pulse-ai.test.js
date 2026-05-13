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
  generateProductDiagnosisTestText,
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
});
