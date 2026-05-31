/* eslint-env node */
import { describe, expect, it } from "vitest";
import {
  AI_CHAT_CHEAP_REQUEST_CONTEXT,
  AI_CHAT_STANDARD_REQUEST_CONTEXT,
  getAiChatBillingMonth,
  getAiChatMonthlyQuotaForShop,
  getConfiguredAiChatCheapMonthlyMessageLimit,
  getConfiguredAiChatStandardMonthlyMessageLimit,
} from "../../app/ai/chat/quota.server";

describe("ProductPulse AI chat monthly quota", () => {
  it("uses the standard chat model until the monthly standard limit is reached", async () => {
    const db = createQuotaTestDb({
      events: buildChatUsageEvents(29, { requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT }),
    });

    const quota = await getAiChatMonthlyQuotaForShop("test-shop.myshopify.com", {
      db,
      userId: "user-1",
      now: "2026-05-27T12:00:00.000Z",
      defaultModel: "gpt-standard",
      cheapModel: "gpt-cheap",
      standardMonthlyMessageLimit: 30,
      cheapMonthlyMessageLimit: 100,
    });

    expect(quota).toMatchObject({
      allowed: true,
      model: "gpt-standard",
      tier: "standard",
      requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT,
      usage: {
        totalMessageCount: 29,
        cheapMessageCount: 0,
      },
    });
  });

  it("switches to the cheap model after the monthly standard limit", async () => {
    const db = createQuotaTestDb({
      events: buildChatUsageEvents(30, { requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT }),
    });

    const quota = await getAiChatMonthlyQuotaForShop("test-shop.myshopify.com", {
      db,
      userId: "user-1",
      now: "2026-05-27T12:00:00.000Z",
      defaultModel: "gpt-standard",
      cheapModel: "gpt-cheap",
      standardMonthlyMessageLimit: 30,
      cheapMonthlyMessageLimit: 100,
    });

    expect(quota).toMatchObject({
      allowed: true,
      model: "gpt-cheap",
      tier: "cheap",
      requestContext: AI_CHAT_CHEAP_REQUEST_CONTEXT,
      usage: {
        totalMessageCount: 30,
        cheapMessageCount: 0,
      },
    });
  });

  it("blocks chat after the monthly cheap-model quota is exhausted", async () => {
    const events = [
      ...buildChatUsageEvents(30, { requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT }),
      ...buildChatUsageEvents(100, { requestContext: AI_CHAT_CHEAP_REQUEST_CONTEXT, startIndex: 30 }),
    ];
    const db = createQuotaTestDb({ events });

    const quota = await getAiChatMonthlyQuotaForShop("test-shop.myshopify.com", {
      db,
      userId: "user-1",
      now: "2026-05-27T12:00:00.000Z",
      defaultModel: "gpt-standard",
      cheapModel: "gpt-cheap",
      standardMonthlyMessageLimit: 30,
      cheapMonthlyMessageLimit: 100,
    });

    expect(quota).toMatchObject({
      allowed: false,
      status: "monthly_quota_exceeded",
      model: "gpt-cheap",
      tier: "cheap",
      usage: {
        totalMessageCount: 130,
        cheapMessageCount: 100,
      },
    });
    expect(quota.message).toContain("superaste la cuota mensual de chat");
  });

  it("counts only the current billing month and the current user when userId is available", async () => {
    const db = createQuotaTestDb({
      events: [
        ...buildChatUsageEvents(30, { requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT, userId: "user-1" }),
        ...buildChatUsageEvents(90, { requestContext: AI_CHAT_CHEAP_REQUEST_CONTEXT, startIndex: 30, userId: "user-2" }),
        ...buildChatUsageEvents(100, { requestContext: AI_CHAT_CHEAP_REQUEST_CONTEXT, startIndex: 120, userId: "user-1", createdAt: "2026-04-27T12:00:00.000Z" }),
      ],
    });

    const quota = await getAiChatMonthlyQuotaForShop("test-shop.myshopify.com", {
      db,
      userId: "user-1",
      now: "2026-05-27T12:00:00.000Z",
      defaultModel: "gpt-standard",
      cheapModel: "gpt-cheap",
      standardMonthlyMessageLimit: 30,
      cheapMonthlyMessageLimit: 100,
    });

    expect(quota).toMatchObject({
      allowed: true,
      model: "gpt-cheap",
      usage: {
        totalMessageCount: 30,
        cheapMessageCount: 0,
      },
    });
  });

  it("reads monthly quota limits from environment", () => {
    const env = {
      AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT: "12",
      AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT: "44",
    };

    expect(getConfiguredAiChatStandardMonthlyMessageLimit(env)).toBe(12);
    expect(getConfiguredAiChatCheapMonthlyMessageLimit(env)).toBe(44);
  });

  it("uses UTC calendar month boundaries for the current billing month", () => {
    const period = getAiChatBillingMonth("2026-05-27T12:00:00.000Z");

    expect(period.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});

function createQuotaTestDb({ events = [] } = {}) {
  return {
    aiUsageEvent: {
      async count(query = {}) {
        return filterUsageEvents(events, query.where || {}).length;
      },
      async findMany(query = {}) {
        return filterUsageEvents(events, query.where || {});
      },
    },
  };
}

function filterUsageEvents(events, where = {}) {
  return events.filter((event) => {
    if (where.shop && event.shop !== where.shop) return false;
    if (where.userId && event.userId !== where.userId) return false;
    if (where.source && event.source !== where.source) return false;
    if (where.operation && event.operation !== where.operation) return false;
    if (where.status && event.status !== where.status) return false;
    if (where.requestContext && event.requestContext !== where.requestContext) return false;
    const createdAt = new Date(event.createdAt).getTime();
    if (where.createdAt?.gte && createdAt < where.createdAt.gte.getTime()) return false;
    if (where.createdAt?.lt && createdAt >= where.createdAt.lt.getTime()) return false;
    return true;
  });
}

function buildChatUsageEvents(count, options = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `usage-${(options.startIndex || 0) + index + 1}`,
    shop: options.shop || "test-shop.myshopify.com",
    userId: options.userId || "user-1",
    source: "chat",
    operation: "chat_turn",
    status: "success",
    requestContext: options.requestContext,
    model: options.requestContext === AI_CHAT_CHEAP_REQUEST_CONTEXT ? "gpt-cheap" : "gpt-standard",
    createdAt: options.createdAt || "2026-05-27T12:00:00.000Z",
  }));
}
