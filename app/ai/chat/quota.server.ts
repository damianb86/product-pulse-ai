import prisma from "../../db.server";

export const AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT_ENV = "AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT";
export const AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT_ENV = "AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT";
export const AI_CHAT_DEFAULT_STANDARD_MONTHLY_MESSAGE_LIMIT = 30;
export const AI_CHAT_DEFAULT_CHEAP_MONTHLY_MESSAGE_LIMIT = 100;
export const AI_CHAT_STANDARD_REQUEST_CONTEXT = "chat_quota_standard";
export const AI_CHAT_CHEAP_REQUEST_CONTEXT = "chat_quota_cheap";

type ChatQuotaDbClient = {
  aiUsageEvent?: {
    count?: (input: Record<string, unknown>) => Promise<number>;
    findMany?: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
};

export interface AiChatMonthlyQuotaInput {
  db?: ChatQuotaDbClient;
  env?: NodeJS.ProcessEnv;
  userId?: string | number | null;
  now?: Date | string | number | null;
  defaultModel: string;
  cheapModel: string;
  standardMonthlyMessageLimit?: number;
  cheapMonthlyMessageLimit?: number;
}

export interface AiChatMonthlyQuota {
  allowed: boolean;
  status: "allowed" | "monthly_quota_exceeded" | "no_usage_store" | "validation_error";
  message: string;
  model: string;
  tier: "standard" | "cheap";
  requestContext: typeof AI_CHAT_STANDARD_REQUEST_CONTEXT | typeof AI_CHAT_CHEAP_REQUEST_CONTEXT;
  usage: {
    shop: string;
    userId: string | null;
    totalMessageCount: number;
    cheapMessageCount: number;
    standardMonthlyMessageLimit: number;
    cheapMonthlyMessageLimit: number;
    periodStart: string;
    periodEnd: string;
  };
}

export function getConfiguredAiChatStandardMonthlyMessageLimit(env: NodeJS.ProcessEnv = process.env): number {
  return integerEnv(
    env.AI_CHAT_STANDARD_MONTHLY_MESSAGE_LIMIT,
    0,
    100_000,
    AI_CHAT_DEFAULT_STANDARD_MONTHLY_MESSAGE_LIMIT,
  );
}

export function getConfiguredAiChatCheapMonthlyMessageLimit(env: NodeJS.ProcessEnv = process.env): number {
  return integerEnv(
    env.AI_CHAT_CHEAP_MONTHLY_MESSAGE_LIMIT,
    0,
    100_000,
    AI_CHAT_DEFAULT_CHEAP_MONTHLY_MESSAGE_LIMIT,
  );
}

export async function getAiChatMonthlyQuotaForShop(shop: string, input: AiChatMonthlyQuotaInput): Promise<AiChatMonthlyQuota> {
  const normalizedShop = String(shop || "").trim();
  const env = input.env || process.env;
  const defaultModel = String(input.defaultModel || "").trim();
  const cheapModel = String(input.cheapModel || "").trim() || defaultModel;
  const standardMonthlyMessageLimit = normalizeLimit(
    input.standardMonthlyMessageLimit,
    getConfiguredAiChatStandardMonthlyMessageLimit(env),
  );
  const cheapMonthlyMessageLimit = normalizeLimit(
    input.cheapMonthlyMessageLimit,
    getConfiguredAiChatCheapMonthlyMessageLimit(env),
  );
  const billingPeriod = getAiChatBillingMonth(input.now);
  const baseUsage = {
    shop: normalizedShop,
    userId: normalizeUserId(input.userId),
    totalMessageCount: 0,
    cheapMessageCount: 0,
    standardMonthlyMessageLimit,
    cheapMonthlyMessageLimit,
    periodStart: billingPeriod.start.toISOString(),
    periodEnd: billingPeriod.end.toISOString(),
  };

  if (!normalizedShop) {
    return {
      allowed: false,
      status: "validation_error",
      message: "A valid shop is required to use chat.",
      model: defaultModel,
      tier: "standard",
      requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT,
      usage: baseUsage,
    };
  }

  const db = input.db || (prisma as unknown as ChatQuotaDbClient);
  if (!db.aiUsageEvent?.count && !db.aiUsageEvent?.findMany) {
    return {
      allowed: true,
      status: "no_usage_store",
      message: "Chat usage tracking is not available in this runtime.",
      model: defaultModel,
      tier: "standard",
      requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT,
      usage: baseUsage,
    };
  }

  let totalMessageCount = 0;
  let cheapMessageCount = 0;
  try {
    totalMessageCount = await countChatUsageEvents(db, baseUsage, {});
    cheapMessageCount = await countChatUsageEvents(db, baseUsage, { requestContext: AI_CHAT_CHEAP_REQUEST_CONTEXT });
  } catch (error) {
    console.warn("[ProductPulse AI] Could not resolve monthly chat quota.", {
      shop: normalizedShop,
      userId: baseUsage.userId,
      error: error instanceof Error ? error.message : String(error || "unknown_error"),
    });
    return {
      allowed: true,
      status: "no_usage_store",
      message: "Chat usage tracking is not available in this runtime.",
      model: defaultModel,
      tier: "standard",
      requestContext: AI_CHAT_STANDARD_REQUEST_CONTEXT,
      usage: baseUsage,
    };
  }
  const tier = totalMessageCount >= standardMonthlyMessageLimit ? "cheap" : "standard";
  const requestContext = tier === "cheap" ? AI_CHAT_CHEAP_REQUEST_CONTEXT : AI_CHAT_STANDARD_REQUEST_CONTEXT;
  const model = tier === "cheap" ? cheapModel : defaultModel;
  const usage = {
    ...baseUsage,
    totalMessageCount,
    cheapMessageCount,
  };
  const allowed = tier === "standard" || cheapMessageCount < cheapMonthlyMessageLimit;

  return {
    allowed,
    status: allowed ? "allowed" : "monthly_quota_exceeded",
    message: allowed ? "Chat quota available." : buildAiChatMonthlyQuotaExceededMessage(usage),
    model,
    tier,
    requestContext,
    usage,
  };
}

export function buildAiChatMonthlyQuotaExceededMessage(usage: AiChatMonthlyQuota["usage"]): string {
  return `No podés usar más el chat este mes porque superaste la cuota mensual de chat. Ya usaste ${usage.cheapMessageCount} mensajes con el modelo barato este mes; la cuota se renueva en el próximo mes de facturación.`;
}

export function getAiChatBillingMonth(value: Date | string | number | null | undefined = new Date()): { start: Date; end: Date } {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const start = new Date(Date.UTC(safeDate.getUTCFullYear(), safeDate.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

async function countChatUsageEvents(
  db: ChatQuotaDbClient,
  usage: AiChatMonthlyQuota["usage"],
  filters: { requestContext?: string },
): Promise<number> {
  const where = {
    shop: usage.shop,
    source: "chat",
    operation: "chat_turn",
    status: "success",
    ...(usage.userId ? { userId: usage.userId } : {}),
    ...(filters.requestContext ? { requestContext: filters.requestContext } : {}),
    createdAt: {
      gte: new Date(usage.periodStart),
      lt: new Date(usage.periodEnd),
    },
  };
  if (db.aiUsageEvent?.count) {
    return db.aiUsageEvent.count({ where });
  }
  const rows = await db.aiUsageEvent?.findMany?.({
    where,
    select: { id: true },
  });
  return Array.isArray(rows) ? rows.length : 0;
}

function normalizeLimit(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(number));
}

function normalizeUserId(value: string | number | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function integerEnv(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
