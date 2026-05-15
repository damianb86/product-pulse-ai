import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { serializeError } from "./product-pulse-job-logs.server";
import { runSelectedProductDiagnosesForShop } from "./product-pulse-jobs.server";
import { getWatchSettingsForShop, recordWatchActivityForShop } from "./product-pulse-watchlist.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CRON_TIME = "03:00";
const DEFAULT_CRON_TIMEZONE = "UTC";
const DEFAULT_CRON_WINDOW_MINUTES = 120;
const WATCH_RUN_EVENT_TYPES = ["watch_scan_queued"];
const activeWatchlistCronRuns = global.productPulseWatchlistCronRuns || new Set();

if (!global.productPulseWatchlistCronRuns) {
  global.productPulseWatchlistCronRuns = activeWatchlistCronRuns;
}

export function getWatchlistCronConfig(env = process.env) {
  const scheduleTime = normalizeCronTime(
    env.PRODUCT_PULSE_WATCHLIST_CRON_TIME
      || env.WATCHLIST_CRON_TIME
      || DEFAULT_CRON_TIME,
  );
  const timezone = normalizeTimezone(
    env.PRODUCT_PULSE_WATCHLIST_CRON_TIMEZONE
      || env.WATCHLIST_CRON_TIMEZONE
      || DEFAULT_CRON_TIMEZONE,
  );
  const windowMinutes = normalizeWindowMinutes(
    env.PRODUCT_PULSE_WATCHLIST_CRON_WINDOW_MINUTES
      || env.WATCHLIST_CRON_WINDOW_MINUTES,
  );

  return {
    scheduleTime,
    timezone,
    windowMinutes,
    secretConfigured: Boolean(getWatchlistCronSecret(env)),
  };
}

export function isWatchlistCronRequestAuthorized(request, env = process.env) {
  const secret = getWatchlistCronSecret(env);
  if (!secret) return env.NODE_ENV !== "production";

  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = request.headers.get("x-productpulse-cron-secret") || "";
  const querySecret = url.searchParams.get("secret") || "";
  return [bearer, headerSecret, querySecret].some((candidate) => safeEqual(candidate, secret));
}

export function isWithinWatchlistCronWindow(now = new Date(), config = getWatchlistCronConfig()) {
  const targetMinutes = parseCronTimeToMinutes(config.scheduleTime);
  const currentMinutes = getMinutesInTimezone(now, config.timezone);
  const elapsedMinutes = (currentMinutes - targetMinutes + 1440) % 1440;
  return elapsedMinutes >= 0 && elapsedMinutes < config.windowMinutes;
}

export function shouldRunWatchlistForShop({ lastRunAt = null, cadenceDays = 1, now = new Date() } = {}) {
  const cadenceMs = Math.max(1, Number(cadenceDays || 1)) * DAY_MS;
  const lastRunDate = lastRunAt ? new Date(lastRunAt) : null;
  if (!lastRunDate || Number.isNaN(lastRunDate.getTime())) return true;
  return now.getTime() - lastRunDate.getTime() >= cadenceMs;
}

export async function runWatchlistCron(options = {}) {
  const now = options.now || new Date();
  const config = options.config || getWatchlistCronConfig(options.env || process.env);
  const forceSchedule = Boolean(options.forceSchedule);
  const forceCadence = Boolean(options.forceCadence);
  const runKey = `${config.timezone}:${config.scheduleTime}`;

  if (!forceSchedule && !isWithinWatchlistCronWindow(now, config)) {
    return {
      status: "skipped",
      reason: "outside_schedule_window",
      ranAt: now.toISOString(),
      config,
      results: [],
    };
  }

  if (activeWatchlistCronRuns.has(runKey)) {
    return {
      status: "skipped",
      reason: "already_running",
      ranAt: now.toISOString(),
      config,
      results: [],
    };
  }

  activeWatchlistCronRuns.add(runKey);
  try {
    const itemsByShop = await getActiveWatchlistItemsByShop();
    const results = [];

    for (const [shop, items] of itemsByShop.entries()) {
      results.push(await runWatchlistCronForShop(shop, items, { now, config, forceCadence }));
    }

    const queuedJobs = results.reduce((sum, result) => sum + Number(result.queuedCount || 0), 0);
    return {
      status: "success",
      ranAt: now.toISOString(),
      config,
      shopsFound: itemsByShop.size,
      shopsQueued: results.filter((result) => result.status === "queued").length,
      queuedJobs,
      results,
    };
  } finally {
    activeWatchlistCronRuns.delete(runKey);
  }
}

async function runWatchlistCronForShop(shop, items = [], { now, config, forceCadence = false }) {
  try {
    const settings = await getWatchSettingsForShop(shop);
    const lastRun = await getLatestWatchlistRunForShop(shop);
    const cadenceDays = Number(settings.scanCadenceDays || settings.scanCadenceValue || 1);
    const due = forceCadence || shouldRunWatchlistForShop({
      lastRunAt: lastRun?.createdAt,
      cadenceDays,
      now,
    });

    if (!due) {
      return {
        shop,
        status: "skipped",
        reason: "cadence_not_due",
        watchedCount: items.length,
        cadenceDays,
        lastRunAt: lastRun?.createdAt?.toISOString?.() || lastRun?.createdAt || null,
        nextRunAt: getNextRunAt(lastRun?.createdAt, cadenceDays),
      };
    }

    const productIds = items.map((item) => item.productGid).filter(Boolean);
    if (!productIds.length) {
      return { shop, status: "skipped", reason: "no_active_products", watchedCount: 0, cadenceDays };
    }

    const { admin } = await unauthenticated.admin(shop);
    const result = await runSelectedProductDiagnosesForShop(shop, productIds, { admin });
    if (result?.status !== "success") {
      await recordWatchCronFailure(shop, {
        now,
        cadenceDays,
        error: result?.message || "Product diagnosis jobs could not be queued.",
      });
      return {
        shop,
        status: "failed",
        reason: "queue_failed",
        watchedCount: items.length,
        cadenceDays,
        message: result?.message || "Product diagnosis jobs could not be queued.",
      };
    }

    await recordWatchActivityForShop(shop, {
      eventType: "watch_scan_queued",
      title: "Scheduled watch diagnostics queued",
      detail: `${result.queuedCount || productIds.length} deep product diagnostic${(result.queuedCount || productIds.length) === 1 ? "" : "s"} queued by Watchlist cron.`,
      metadata: {
        triggeredBy: "watchlist-cron",
        scheduleTime: config.scheduleTime,
        timezone: config.timezone,
        cadenceDays,
        queuedCount: result.queuedCount || productIds.length,
        productGids: productIds,
        productTitles: items.map((item) => item.productTitle).filter(Boolean),
        jobIds: Array.isArray(result.jobs) ? result.jobs.map((job) => job.id).filter(Boolean) : [],
      },
    });

    return {
      shop,
      status: "queued",
      watchedCount: items.length,
      cadenceDays,
      queuedCount: result.queuedCount || productIds.length,
      jobIds: Array.isArray(result.jobs) ? result.jobs.map((job) => job.id).filter(Boolean) : [],
    };
  } catch (error) {
    await recordWatchCronFailure(shop, {
      now,
      error,
    });
    return {
      shop,
      status: "failed",
      reason: "exception",
      watchedCount: items.length,
      message: error?.message || "Watchlist cron failed for this shop.",
      error: serializeError(error),
    };
  }
}

async function getActiveWatchlistItemsByShop() {
  const items = await prisma.productWatchlistItem.findMany({
    where: { status: { not: "Paused" } },
    orderBy: [{ shop: "asc" }, { addedAt: "asc" }],
    select: {
      id: true,
      shop: true,
      productGid: true,
      productTitle: true,
      handle: true,
      sku: true,
    },
  });

  return items.reduce((groups, item) => {
    if (!groups.has(item.shop)) groups.set(item.shop, []);
    groups.get(item.shop).push(item);
    return groups;
  }, new Map());
}

async function getLatestWatchlistRunForShop(shop) {
  return prisma.productWatchActivity.findFirst({
    where: {
      shop,
      eventType: { in: WATCH_RUN_EVENT_TYPES },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function recordWatchCronFailure(shop, { now = new Date(), cadenceDays = null, error } = {}) {
  return recordWatchActivityForShop(shop, {
    eventType: "watch_cron_failed",
    title: "Watchlist cron failed",
    detail: error?.message || String(error || "Watchlist cron could not queue diagnostics."),
    metadata: {
      triggeredBy: "watchlist-cron",
      cadenceDays,
      ranAt: now.toISOString(),
      error: typeof error === "string" ? { message: error } : serializeError(error),
    },
  });
}

function getNextRunAt(lastRunAt, cadenceDays) {
  const lastRunDate = lastRunAt ? new Date(lastRunAt) : null;
  if (!lastRunDate || Number.isNaN(lastRunDate.getTime())) return null;
  return new Date(lastRunDate.getTime() + Math.max(1, Number(cadenceDays || 1)) * DAY_MS).toISOString();
}

function getWatchlistCronSecret(env = process.env) {
  return String(env.PRODUCT_PULSE_WATCHLIST_CRON_SECRET || env.WATCHLIST_CRON_SECRET || "").trim();
}

function normalizeCronTime(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_CRON_TIME;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return DEFAULT_CRON_TIME;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeTimezone(value) {
  const timezone = String(value || "").trim() || DEFAULT_CRON_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_CRON_TIMEZONE;
  }
}

function normalizeWindowMinutes(value) {
  const number = Number(value || DEFAULT_CRON_WINDOW_MINUTES);
  if (!Number.isFinite(number)) return DEFAULT_CRON_WINDOW_MINUTES;
  return Math.min(1440, Math.max(1, Math.round(number)));
}

function parseCronTimeToMinutes(value) {
  const [hours, minutes] = normalizeCronTime(value).split(":").map(Number);
  return (hours * 60) + minutes;
}

function getMinutesInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimezone(timezone),
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hours = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minutes = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return (hours * 60) + minutes;
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
