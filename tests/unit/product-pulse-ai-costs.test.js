/* eslint-env node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usageCreate: vi.fn(),
  usageFindMany: vi.fn(),
  messageFindMany: vi.fn(),
  jobLogFindMany: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    aiUsageEvent: {
      create: mocks.usageCreate,
      findMany: mocks.usageFindMany,
    },
    aiConversationMessage: {
      findMany: mocks.messageFindMany,
    },
    productPulseJobLog: {
      findMany: mocks.jobLogFindMany,
    },
  },
}));

const {
  getAiUsageDashboardForShop,
  isAiCostDashboardEnabled,
  recordAiUsageEvent,
} = await import("../../app/ai/observability/usageEvents.server");

describe("ProductPulse AI cost dashboard", () => {
  beforeEach(() => {
    mocks.usageCreate.mockReset().mockResolvedValue({});
    mocks.usageFindMany.mockReset().mockResolvedValue([]);
    mocks.messageFindMany.mockReset().mockResolvedValue([]);
    mocks.jobLogFindMany.mockReset().mockResolvedValue([]);
  });

  it("is shown only when the environment flag is enabled", () => {
    expect(isAiCostDashboardEnabled({ AI_COST_DASHBOARD_ENABLED: "false" })).toBe(false);
    expect(isAiCostDashboardEnabled({ AI_COST_DASHBOARD_ENABLED: "true" })).toBe(true);
  });

  it("records compact usage events with estimated cost", async () => {
    await recordAiUsageEvent({
      shop: "shop-a.myshopify.com",
      userId: 42,
      source: "chat",
      operation: "chat_turn",
      provider: "openai",
      model: "gpt-5.4-mini",
      task: "chat_turn",
      conversationId: "conv-1",
      messageId: "msg-1",
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 200,
        totalTokens: 1500,
      },
    });

    expect(mocks.usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shop: "shop-a.myshopify.com",
        userId: "42",
        source: "chat",
        operation: "chat_turn",
        provider: "openai",
        model: "gpt-5.4-mini",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        estimatedTotalUsd: expect.any(Number),
      }),
    });
  });

  it("aggregates persistent usage events and legacy traces without double-counting message IDs", async () => {
    mocks.usageFindMany.mockResolvedValue([{
      id: "event-1",
      shop: "shop-a.myshopify.com",
      source: "chat",
      operation: "chat_turn",
      provider: "openai",
      model: "gpt-5.4-mini",
      task: "chat_turn",
      conversationId: "conv-1",
      messageId: "msg-1",
      status: "success",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      createdAt: new Date("2026-05-20T12:00:00.000Z"),
    }]);
    mocks.messageFindMany.mockResolvedValue([
      {
        id: "msg-1",
        conversationId: "conv-1",
        createdAt: new Date("2026-05-20T12:00:00.000Z"),
        structuredContent: {
          trace: {
            model: "gpt-5.4-mini",
            tokenUsage: { inputTokens: 9999, outputTokens: 9999, totalTokens: 19998 },
            estimatedCost: { estimated: true, currency: "USD", totalUsd: 99 },
          },
        },
      },
      {
        id: "msg-2",
        conversationId: "conv-2",
        createdAt: new Date("2026-05-19T12:00:00.000Z"),
        structuredContent: {
          trace: {
            model: "gpt-5.4-mini",
            tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            estimatedCost: { estimated: true, currency: "USD", totalUsd: 0.001 },
          },
        },
      },
    ]);
    mocks.jobLogFindMany.mockResolvedValue([{
      id: "log-1",
      shop: "shop-a.myshopify.com",
      jobId: "job-1",
      level: "info",
      event: "product_diagnosis.ai_token_usage",
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      data: {
        productGid: "gid://shopify/Product/1",
        aiUsage: {
          operation: "product_diagnosis",
          calls: [
            {
              provider: "openai",
              model: "gpt-5.4-mini",
              task: "final_report",
              inputTokens: 200,
              outputTokens: 100,
              totalTokens: 300,
            },
            {
              provider: "gemini",
              model: "gemini-unknown",
              task: "signal_classification",
              inputTokens: 300,
              outputTokens: 120,
              totalTokens: 420,
            },
          ],
        },
      },
    }]);

    const dashboard = await getAiUsageDashboardForShop("shop-a.myshopify.com", {
      now: new Date("2026-05-20T12:30:00.000Z"),
    });

    expect(dashboard.totals.eventCount).toBe(4);
    expect(dashboard.totals.totalTokens).toBe(2370);
    expect(dashboard.totals.unknownCostEvents).toBe(1);
    expect(dashboard.recentEvents.map((event) => event.id)).not.toContain("legacy-chat:msg-1");
    expect(dashboard.bySource.map((group) => group.label)).toContain("AI chat");
    expect(dashboard.bySource.map((group) => group.label)).toContain("Product diagnosis");
  });
});
