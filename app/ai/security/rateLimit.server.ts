import type { AiToolContext } from "../domain/types";
import { isAiDisabledValue } from "./featureFlags.server";

export type AiRateLimitBucket =
  | "chat"
  | "chatkit_message"
  | "chatkit_session"
  | "chatkit_action"
  | "action_propose"
  | "action_confirm"
  | "action_cancel";

export interface AiRateLimitResult {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const buckets = new Map<string, RateWindow>();

export function checkAiRateLimit(input: {
  context: Pick<AiToolContext, "shop" | "userId" | "sessionId">;
  bucket: AiRateLimitBucket;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): AiRateLimitResult {
  const env = input.env || process.env;
  const now = input.now || (() => new Date());
  const limit = getBucketLimit(input.bucket, env);
  const windowMs = integerEnv(env.AI_RATE_LIMIT_WINDOW_MS, 10_000, 10 * 60_000, DEFAULT_WINDOW_MS);
  const identity = [
    input.bucket,
    input.context.shop,
    input.context.userId || input.context.sessionId || "shop",
  ].join(":");

  if (isAiDisabledValue(env.AI_RATE_LIMIT_ENABLED) || limit <= 0) {
    return {
      allowed: true,
      key: identity,
      limit,
      remaining: limit,
      retryAfterSeconds: 0,
      resetAt: new Date(now().getTime() + windowMs),
    };
  }

  const currentTime = now().getTime();
  const existing = buckets.get(identity);
  const current = existing && existing.resetAt > currentTime
    ? existing
    : { count: 0, resetAt: currentTime + windowMs };
  current.count += 1;
  buckets.set(identity, current);

  const remaining = Math.max(0, limit - current.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - currentTime) / 1000));
  return {
    allowed: current.count <= limit,
    key: identity,
    limit,
    remaining,
    retryAfterSeconds: current.count <= limit ? 0 : retryAfterSeconds,
    resetAt: new Date(current.resetAt),
  };
}

export function rateLimitResponse(result: AiRateLimitResult): Response {
  return Response.json(
    {
      status: "rate_limited",
      message: "Too many AI requests. Try again shortly.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

export function resetAiRateLimitForTests(): void {
  buckets.clear();
}

function getBucketLimit(bucket: AiRateLimitBucket, env: NodeJS.ProcessEnv): number {
  const specificName = `AI_${bucket.toUpperCase()}_RATE_LIMIT_PER_MINUTE`;
  const specific = env[specificName];
  if (specific != null) return integerEnv(specific, 1, 600, defaultLimit(bucket));
  if (bucket.startsWith("action")) {
    return integerEnv(env.AI_ACTION_RATE_LIMIT_PER_MINUTE, 1, 600, defaultLimit(bucket));
  }
  if (bucket.startsWith("chatkit") || bucket === "chat") {
    return integerEnv(env.AI_CHAT_RATE_LIMIT_PER_MINUTE, 1, 600, defaultLimit(bucket));
  }
  return defaultLimit(bucket);
}

function defaultLimit(bucket: AiRateLimitBucket): number {
  if (bucket === "chatkit_session") return 60;
  if (bucket === "chatkit_action") return 60;
  if (bucket.startsWith("action")) return 30;
  return 20;
}

function integerEnv(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
