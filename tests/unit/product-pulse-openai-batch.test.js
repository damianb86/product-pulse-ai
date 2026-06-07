/* eslint-env node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batchState: {
    id: "local-batch-1",
    groupId: "group-1",
    shop: "test-shop.myshopify.com",
    jobId: "job-1",
    productGid: "gid://shopify/Product/1",
    model: "gpt-5.4-nano",
    status: "submitted",
    openAiBatchId: "batch_123",
    outputFileId: null,
    errorFileId: null,
    requestCount: 1,
    completedRequestCount: 0,
    failedRequestCount: 0,
    metadata: {},
    processedAt: null,
  },
  requestState: {
    id: "request-1",
    batchId: "local-batch-1",
    customId: "custom_1",
    task: "content_coverage_validation",
    model: "gpt-5.4-nano",
    status: "queued",
    outputText: null,
    usage: null,
  },
  webhookEvents: new Map(),
  webhookCreate: vi.fn(),
  webhookFindUnique: vi.fn(),
  webhookUpdate: vi.fn(),
  batchFindUnique: vi.fn(),
  batchUpdate: vi.fn(),
  batchGroupFindUnique: vi.fn(),
  batchGroupUpdate: vi.fn(),
  requestUpdateMany: vi.fn(),
  requestGroupBy: vi.fn(),
  recordJobLog: vi.fn(),
}));

function buildGroupState(overrides = {}) {
  return {
    id: "group-1",
    shop: "test-shop.myshopify.com",
    jobId: "job-1",
    status: "submitted",
    requestCount: 1,
    completedRequestCount: mocks.requestState.status === "completed" ? 1 : 0,
    failedRequestCount: mocks.requestState.status === "failed" ? 1 : 0,
    processedAt: null,
    batches: [{
      ...mocks.batchState,
      status: mocks.batchState.status,
      processedAt: mocks.batchState.processedAt,
      completedRequestCount: mocks.requestState.status === "completed" ? 1 : 0,
      failedRequestCount: mocks.requestState.status === "failed" ? 1 : 0,
      requests: [{ ...mocks.requestState }],
    }],
    ...overrides,
  };
}

vi.mock("../../app/db.server", () => ({
  default: {
    productPulseOpenAiWebhookEvent: {
      create: mocks.webhookCreate,
      findUnique: mocks.webhookFindUnique,
      update: mocks.webhookUpdate,
    },
    productPulseOpenAiBatch: {
      findUnique: mocks.batchFindUnique,
      update: mocks.batchUpdate,
    },
    productPulseOpenAiBatchGroup: {
      findUnique: mocks.batchGroupFindUnique,
      update: mocks.batchGroupUpdate,
    },
    productPulseOpenAiBatchRequest: {
      updateMany: mocks.requestUpdateMany,
      groupBy: mocks.requestGroupBy,
    },
  },
}));

vi.mock("../../app/lib/product-pulse-job-logs.server", () => ({
  recordJobLog: mocks.recordJobLog,
  serializeError: (error) => ({ message: error?.message || String(error) }),
}));

const {
  extractOpenAiBatchIdFromEvent,
  extractOpenAiBatchResponseText,
  processOpenAiBatchWebhookEvent,
} = await import("../../app/lib/product-pulse-openai-batch.server.js");

describe("ProductPulse OpenAI Batch processing", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    mocks.webhookEvents.clear();
    mocks.batchState = {
      ...mocks.batchState,
      status: "submitted",
      outputFileId: null,
      errorFileId: null,
      completedRequestCount: 0,
      failedRequestCount: 0,
      processedAt: null,
    };
    mocks.requestState = {
      ...mocks.requestState,
      status: "queued",
      outputText: null,
      usage: null,
    };

    vi.clearAllMocks();

    mocks.webhookCreate.mockImplementation(async ({ data }) => {
      if (mocks.webhookEvents.has(data.id)) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      }
      const row = { status: "received", ...data };
      mocks.webhookEvents.set(data.id, row);
      return row;
    });
    mocks.webhookFindUnique.mockImplementation(async ({ where }) => mocks.webhookEvents.get(where.id) || null);
    mocks.webhookUpdate.mockImplementation(async ({ where, data }) => {
      const row = { ...(mocks.webhookEvents.get(where.id) || { id: where.id }), ...data };
      mocks.webhookEvents.set(where.id, row);
      return row;
    });
    mocks.batchFindUnique.mockResolvedValue({ ...mocks.batchState });
    mocks.batchUpdate.mockImplementation(async ({ data }) => {
      mocks.batchState = {
        ...mocks.batchState,
        ...data,
      };
      return { ...mocks.batchState };
    });
    mocks.requestUpdateMany.mockImplementation(async ({ data }) => {
      mocks.requestState = {
        ...mocks.requestState,
        ...data,
      };
      return { count: 1 };
    });
    mocks.requestGroupBy.mockImplementation(async () => [{
      status: mocks.requestState.status,
      _count: { _all: 1 },
    }]);
    mocks.batchGroupFindUnique.mockImplementation(async () => buildGroupState());
    mocks.batchGroupUpdate.mockImplementation(async ({ data }) => buildGroupState(data));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("processes a completed batch webhook and marks the group ready", async () => {
    const outputJsonl = `${JSON.stringify({
      custom_id: "custom_1",
      response: {
        status_code: 200,
        body: {
          output_text: "{\"coverage\":[],\"summary\":\"Validated\"}",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    })}\n`;
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/batches/batch_123")) {
        return new Response(JSON.stringify({
          id: "batch_123",
          status: "completed",
          output_file_id: "file_output_1",
          error_file_id: null,
          completed_at: 1810000000,
          request_counts: { total: 1, completed: 1, failed: 0 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.endsWith("/files/file_output_1/content")) {
        return new Response(outputJsonl, { status: 200, headers: { "Content-Type": "application/jsonl" } });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await processOpenAiBatchWebhookEvent({
      id: "evt_1",
      type: "batch.completed",
      data: { id: "batch_123" },
    });

    expect(result).toMatchObject({
      status: "completed",
      openAiBatchId: "batch_123",
      groupReady: true,
      group: {
        id: "group-1",
        status: "completed",
      },
    });
    expect(mocks.requestState).toMatchObject({
      status: "completed",
      outputText: "{\"coverage\":[],\"summary\":\"Validated\"}",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    expect(mocks.webhookEvents.get("evt_1")).toMatchObject({ status: "processed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("extracts batch IDs and response text from OpenAI webhook/output shapes", () => {
    expect(extractOpenAiBatchIdFromEvent({
      type: "batch.failed",
      data: { id: "batch_failed_123" },
    })).toBe("batch_failed_123");
    expect(extractOpenAiBatchResponseText({
      output: [{
        content: [{ type: "output_text", text: "Nested response text" }],
      }],
    })).toBe("Nested response text");
  });
});
