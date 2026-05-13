import { inspect } from "node:util";
import prisma from "../db.server";
import { isProductPulseDevelopment } from "./product-pulse-dev.server";

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|secret|token|accessToken|refreshToken|apiKey|apiSecret|hmac|signature|session|credentials)/i;

export async function recordJobLog({ shop, jobId, level = "info", event, message, data }) {
  if (!isProductPulseDevelopment() || !shop || !jobId) return;

  await prisma.productPulseJobLog.create({
    data: {
      shop,
      jobId,
      level,
      event,
      message,
      data: redact(data),
    },
  });
}

export async function getJobLogsForShop(shop, limit = 80) {
  if (!isProductPulseDevelopment()) return [];

  return prisma.productPulseJobLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? redact(error.cause) : undefined,
    };
  }

  return {
    message: typeof error === "string" ? error : inspect(error, { depth: 4, breakLength: 140 }),
  };
}

function redact(value, depth = 0) {
  if (depth > 6) return "[Truncated]";
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const safe = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[Redacted]"
      : redact(nestedValue, depth + 1);
  }
  return safe;
}
