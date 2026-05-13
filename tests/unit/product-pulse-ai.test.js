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

const { generateProductDiagnosisTestText } = await import("../../app/lib/product-pulse-ai.server.js");

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
});
