import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { serializeError } from "./product-pulse-job-logs.server";
import { runSelectedProductDiagnosesForShop } from "./product-pulse-jobs.server";
import { getStorePointBalanceForShop } from "./product-pulse-points.server";
import {
  maybeSendWatchlistRunAlertForQueuedActivity,
  sendWatchlistCreditExhaustedEmailForShop,
} from "./product-pulse-watchlist-alerts.server";
import { enforceWatchlistPlanLimitForShop, getWatchSettingsForShop, recordWatchActivityForShop } from "./product-pulse-watchlist.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CRON_TIME = "03:00";
const DEFAULT_CRON_TIMEZONE = "UTC";
const DEFAULT_CRON_WINDOW_MINUTES = 120;
const DEFAULT_CRON_LOCK_TTL_MINUTES = 120;
const WATCH_RUN_EVENT_TYPES = ["watch_scan_queued", "watch_cron_credit_exhausted"];
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
  const lockTtlMinutes = normalizeLockTtlMinutes(
    env.PRODUCT_PULSE_WATCHLIST_CRON_LOCK_TTL_MINUTES
      || env.WATCHLIST_CRON_LOCK_TTL_MINUTES,
  );

  return {
    scheduleTime,
    timezone,
    windowMinutes,
    lockTtlMinutes,
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
  const runKey = `watchlist-cron:${config.timezone}:${config.scheduleTime}`;

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
  let lock;

  try {
    lock = await acquireSchedulerLock(runKey, {
      now,
      ttlMinutes: config.lockTtlMinutes,
    });
  } catch (error) {
    activeWatchlistCronRuns.delete(runKey);
    throw error;
  }

  if (!lock.acquired) {
    activeWatchlistCronRuns.delete(runKey);
    return {
      status: "skipped",
      reason: "distributed_lock_active",
      ranAt: now.toISOString(),
      config,
      lock: {
        key: runKey,
        expiresAt: lock.expiresAt,
      },
      results: [],
    };
  }

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
    await releaseSchedulerLock(lock).catch(() => {});
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

    const productItems = items.filter((item) => item.productGid);
    if (!productItems.length) {
      return { shop, status: "skipped", reason: "no_active_products", watchedCount: 0, cadenceDays };
    }

    const pointBalance = await getStorePointBalanceForShop(shop);
    const creditPlan = splitWatchlistItemsByAvailableCredits(productItems, pointBalance?.available);
    if (!creditPlan.queueItems.length) {
      await recordWatchActivityForShop(shop, {
        eventType: "watch_cron_credit_exhausted",
        title: "Scheduled Watchlist Product Diagnosis skipped",
        detail: "Watchlist cron found active watched products, but the shop has no available credits.",
        metadata: {
          triggeredBy: "watchlist-cron",
          scheduleTime: config.scheduleTime,
          timezone: config.timezone,
          cadenceDays,
          availableCredits: creditPlan.availableCredits,
          watchedCount: productItems.length,
          skippedForCredits: creditPlan.skippedForCredits.map(formatCreditSkippedItem),
        },
      });
      await sendWatchlistCreditExhaustedEmailForShop({
        shop,
        settings,
        items: creditPlan.skippedForCredits,
        pointBalance,
        now,
        cadenceDays,
      });
      return {
        shop,
        status: "skipped",
        reason: "insufficient_credits",
        watchedCount: items.length,
        cadenceDays,
        queuedCount: 0,
        skippedForCredits: creditPlan.skippedForCredits.length,
        availableCredits: creditPlan.availableCredits,
      };
    }

    const productIds = creditPlan.queueItems.map((item) => item.productGid).filter(Boolean);
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

    const queuedActivity = await recordWatchActivityForShop(shop, {
      eventType: "watch_scan_queued",
      title: "Scheduled Watchlist Product Diagnosis queued",
      detail: `${result.queuedCount || productIds.length} deep product diagnostic${(result.queuedCount || productIds.length) === 1 ? "" : "s"} queued by Watchlist cron.`,
      metadata: {
        triggeredBy: "watchlist-cron",
        scheduleTime: config.scheduleTime,
        timezone: config.timezone,
        cadenceDays,
        queuedCount: result.queuedCount || productIds.length,
        productGids: productIds,
        productTitles: creditPlan.queueItems.map((item) => item.productTitle).filter(Boolean),
        jobIds: Array.isArray(result.jobs) ? result.jobs.map((job) => job.id).filter(Boolean) : [],
        availableCreditsAtQueue: creditPlan.availableCredits,
        availableCredits: Math.max(0, creditPlan.availableCredits - productIds.length),
        skippedForCredits: creditPlan.skippedForCredits.map(formatCreditSkippedItem),
        creditExhausted: creditPlan.skippedForCredits.length > 0,
      },
    });
    await maybeSendWatchlistRunAlertForQueuedActivity(shop, queuedActivity);

    return {
      shop,
      status: "queued",
      watchedCount: items.length,
      cadenceDays,
      queuedCount: result.queuedCount || productIds.length,
      jobIds: Array.isArray(result.jobs) ? result.jobs.map((job) => job.id).filter(Boolean) : [],
      skippedForCredits: creditPlan.skippedForCredits.length,
      availableCredits: creditPlan.availableCredits,
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

export function splitWatchlistItemsByAvailableCredits(items = [], availableCredits = 0) {
  const creditLimit = Math.max(0, Math.floor(Number(availableCredits || 0)));
  const normalizedItems = Array.isArray(items) ? items.filter((item) => item?.productGid) : [];
  return {
    availableCredits: creditLimit,
    queueItems: normalizedItems.slice(0, creditLimit),
    skippedForCredits: normalizedItems.slice(creditLimit),
  };
}

export function formatCreditSkippedItem(item = {}) {
  return {
    productGid: item.productGid || "",
    productTitle: item.productTitle || "",
    handle: item.handle || "",
    sku: item.sku || "",
  };
}

async function getActiveWatchlistItemsByShop() {
  const watchedShops = await prisma.productWatchlistItem.findMany({
    select: {
      shop: true,
    },
  });

  const shops = [...new Set(watchedShops.map((item) => item.shop).filter(Boolean))];
  const groups = new Map();
  for (const shop of shops) {
    const limitContext = await enforceWatchlistPlanLimitForShop(shop);
    const activeItems = limitContext.items
      .filter((item) => item.status !== "Paused")
      .map((item) => ({
        id: item.id,
        shop: item.shop,
        productGid: item.productGid,
        productTitle: item.productTitle,
        handle: item.handle,
        sku: item.sku,
      }));
    if (activeItems.length) groups.set(shop, activeItems);
  }
  return groups;
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
    detail: error?.message || String(error || "Watchlist cron could not queue Product Diagnosis."),
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

function normalizeLockTtlMinutes(value) {
  const number = Number(value || DEFAULT_CRON_LOCK_TTL_MINUTES);
  if (!Number.isFinite(number)) return DEFAULT_CRON_LOCK_TTL_MINUTES;
  return Math.min(1440, Math.max(5, Math.round(number)));
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

async function acquireSchedulerLock(key, { now = new Date(), ttlMinutes = DEFAULT_CRON_LOCK_TTL_MINUTES, owner = randomUUID() } = {}) {
  const expiresAt = new Date(now.getTime() + normalizeLockTtlMinutes(ttlMinutes) * 60 * 1000);

  try {
    await prisma.productPulseSchedulerLock.create({
      data: {
        key,
        owner,
        acquiredAt: now,
        expiresAt,
      },
    });
    return { acquired: true, key, owner, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const updated = await prisma.productPulseSchedulerLock.updateMany({
    where: {
      key,
      expiresAt: { lte: now },
    },
    data: {
      owner,
      acquiredAt: now,
      expiresAt,
    },
  });

  if (updated.count > 0) return { acquired: true, key, owner, expiresAt: expiresAt.toISOString() };

  const existing = await prisma.productPulseSchedulerLock.findUnique({
    where: { key },
    select: { expiresAt: true },
  });
  return {
    acquired: false,
    key,
    owner,
    expiresAt: existing?.expiresAt?.toISOString?.() || null,
  };
}

async function releaseSchedulerLock(lock) {
  if (!lock?.acquired || !lock.key || !lock.owner) return;
  await prisma.productPulseSchedulerLock.deleteMany({
    where: {
      key: lock.key,
      owner: lock.owner,
    },
  });
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

export const __productPulseWatchlistCronTestHooks = {
  splitWatchlistItemsByAvailableCredits,
  formatCreditSkippedItem,
};
