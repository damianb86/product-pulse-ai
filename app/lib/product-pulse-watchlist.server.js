import prisma from "../db.server";
import { generateWatchChangeReportNarrative } from "./product-pulse-ai.server";
import { getProductScoreHistoryForProductsForShop, recordProductScoreHistoryBatch } from "./product-pulse-history.server";
import { getProductPulseSettings, getRiskLabelForScore, getRiskToneForScore } from "./product-pulse-settings.server";
import { recordTimelineForWatchActivities } from "./product-pulse-timeline.server";

export const WATCHLIST_MAX_PRODUCTS = 99;
export const PRODUCT_PULSE_BETA_ACTIVE_ENV = "PRODUCT_PULSE_BETA_ACTIVE";
export const PRODUCT_PULSE_PLAN_KEY_ENV = "PRODUCT_PULSE_PLAN_KEY";
export const WATCHLIST_PLAN_PRODUCT_LIMITS = Object.freeze({
  free: { base: 1, beta: 5, name: "Free" },
  starter: { base: 5, beta: 10, name: "Starter" },
  growth: { base: 25, beta: 25, name: "Growth" },
  pro: { base: 50, beta: 50, name: "Pro" },
  premium: { base: 99, beta: 99, name: "Premium" },
});
export const WATCH_SCAN_CADENCE_OPTIONS = [
  { value: "1", label: "Every day" },
  { value: "2", label: "Every 2 days" },
  { value: "3", label: "Every 3 days" },
  { value: "7", label: "Weekly" },
  { value: "14", label: "Every 2 weeks" },
];
export const WATCH_TRIGGER_RULE_OPTIONS = [
  { value: "new_or_rising_risk", label: "Notify on new issues or rising risk" },
  { value: "new_issue_only", label: "Only new issue detected" },
  { value: "risk_score_increase", label: "Risk score increases" },
  { value: "medium_or_high_risk", label: "Medium or high risk detected" },
  { value: "any_watch_change", label: "Any watched product change" },
];
export const WATCH_SUMMARY_OPTIONS = [
  { value: "daily_digest_8am", label: "Daily digest at 8:00 AM" },
  { value: "weekly_monday_8am", label: "Weekly summary Monday at 8:00 AM" },
  { value: "immediate_only", label: "Immediate alerts only" },
  { value: "none", label: "No summary email" },
];

const DEFAULT_WATCH_SETTINGS = {
  scanCadenceDays: 3,
  alertRecipients: [],
  triggerRule: "new_or_rising_risk",
  summarySchedule: "daily_digest_8am",
  alertsEnabled: true,
};
const WATCH_TREND_COLORS = ["#3A6BFF", "#7C3AED", "#14B8A6", "#F59E0B", "#EF4444"];
const WATCH_CHANGE_REPORT_EVENT = "watch_change_report";
const PRODUCT_DIAGNOSIS_KIND = "product-diagnosis";
const WATCHLIST_BASELINE_SOURCE = "watchlist-baseline";
const FULL_DIAGNOSIS_SOURCE = "full-diagnosis";
const WATCHLIST_ELIGIBLE_SEARCH_LIMIT = 10;
const WATCHLIST_REQUIRES_COMPLETED_DIAGNOSIS_MESSAGE = "Only products with a completed Product Diagnosis can be added to the Watchlist. Run Product Diagnosis first, then add the product.";

export function isProductPulseBetaActive(env = process.env) {
  const raw = env?.[PRODUCT_PULSE_BETA_ACTIVE_ENV] ?? env?.PRODUCT_PULSE_BETA ?? "true";
  return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
}

export function normalizeProductPulsePlanKey(planKey = "") {
  const normalized = String(planKey || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return WATCHLIST_PLAN_PRODUCT_LIMITS[normalized] ? normalized : "free";
}

export function getWatchlistProductLimitForPlan(planKey = "free", options = {}) {
  const normalizedPlanKey = normalizeProductPulsePlanKey(planKey);
  const betaActive = typeof options.betaActive === "boolean"
    ? options.betaActive
    : isProductPulseBetaActive(options.env || process.env);
  const planLimit = WATCHLIST_PLAN_PRODUCT_LIMITS[normalizedPlanKey] || WATCHLIST_PLAN_PRODUCT_LIMITS.free;
  return Math.max(0, Number(betaActive ? planLimit.beta : planLimit.base) || 0);
}

export function getWatchlistLimitContext(options = {}) {
  const env = options.env || process.env;
  const planKey = normalizeProductPulsePlanKey(
    options.planKey
      || env?.[PRODUCT_PULSE_PLAN_KEY_ENV]
      || env?.PRODUCT_PULSE_CURRENT_PLAN_KEY
      || "free",
  );
  const betaActive = typeof options.betaActive === "boolean" ? options.betaActive : isProductPulseBetaActive(env);
  const maxProducts = getWatchlistProductLimitForPlan(planKey, { betaActive, env });
  const plan = WATCHLIST_PLAN_PRODUCT_LIMITS[planKey] || WATCHLIST_PLAN_PRODUCT_LIMITS.free;
  return {
    planKey,
    planName: plan.name,
    betaActive,
    maxProducts,
  };
}

export async function enforceWatchlistPlanLimitForShop(shop, options = {}) {
  const db = options.db || prisma;
  const limitContext = getWatchlistLimitContext(options);
  if (!shop) return { ...limitContext, items: [], removedItems: [], removedCount: 0 };

  const items = await db.productWatchlistItem.findMany({
    where: { shop },
    orderBy: [{ addedAt: "asc" }, { id: "asc" }],
  });
  const keptItems = items.slice(0, limitContext.maxProducts);
  const removedItems = items.slice(limitContext.maxProducts);
  if (!removedItems.length) {
    return { ...limitContext, items: keptItems, removedItems: [], removedCount: 0 };
  }

  const removedIds = removedItems.map((item) => item.id).filter(Boolean);
  if (removedIds.length) {
    await db.productWatchlistItem.deleteMany({
      where: { shop, id: { in: removedIds } },
    });
  }

  if (options.recordActivity !== false) {
    for (const item of removedItems) {
      await recordWatchActivityForShop(shop, {
        eventType: "product_removed_plan_limit",
        title: "Product removed by plan limit",
        detail: `${item.productTitle} was removed because the ${limitContext.planName} plan allows ${limitContext.maxProducts} watched product${limitContext.maxProducts === 1 ? "" : "s"}.`,
        productGid: item.productGid,
        productTitle: item.productTitle,
        watchlistItemId: item.id,
        metadata: {
          reason: "watchlist_plan_limit",
          planKey: limitContext.planKey,
          planName: limitContext.planName,
          betaActive: limitContext.betaActive,
          maxProducts: limitContext.maxProducts,
        },
      });
    }
  }

  return {
    ...limitContext,
    items: keptItems,
    removedItems,
    removedCount: removedItems.length,
  };
}

export async function getWatchlistForShop(shop, options = {}) {
  const limitContext = await enforceWatchlistPlanLimitForShop(shop, options);
  const items = limitContext.items;
  const productGids = items.map((item) => item.productGid).filter(Boolean);
  const [snapshots, latestChangeReports, activeDiagnosisJobs] = productGids.length
    ? await Promise.all([
      prisma.productRiskSnapshot.findMany({
        where: { shop, productGid: { in: productGids } },
      }),
      getLatestWatchChangeReportsForProducts(shop, productGids),
      getActiveWatchlistDiagnosisJobsForShop(shop),
    ])
    : [[], new Map(), []];
  const snapshotByProductGid = new Map(snapshots.map((snapshot) => [snapshot.productGid, snapshot]));
  const productPulseSettings = await getProductPulseSettings(shop);
  const rows = items.map((item) => formatWatchlistRow(
    item,
    snapshotByProductGid.get(item.productGid),
    productPulseSettings,
    latestChangeReports.get(item.productGid),
    findActiveWatchlistDiagnosisJobForItem(item, activeDiagnosisJobs),
  ));
  const watchedCount = rows.length;
  const [activities, runActivities, trendHistoryByProductGid, activityStats, settings] = await Promise.all([
    getWatchActivityRowsForShop(shop, { take: 5 }),
    getWatchActivityRowsForShop(shop, { take: 120, eventTypes: ["watch_scan_queued", "watch_manual_scan_queued"] }),
    productGids.length ? getProductScoreHistoryForProductsForShop(shop, productGids, { take: 0 }) : new Map(),
    getWatchActivityStatsForShop(shop, productPulseSettings),
    getWatchSettingsForShop(shop, options),
  ]);

  return {
    maxProducts: limitContext.maxProducts,
    planKey: limitContext.planKey,
    planName: limitContext.planName,
    betaActive: limitContext.betaActive,
    removedForPlanLimit: limitContext.removedCount,
    watchedCount,
    slotsAvailable: Math.max(0, limitContext.maxProducts - watchedCount),
    rows,
    activities,
    runActivities,
    selectedRunId: optionalString(options.selectedRunId || options.runId),
    trend: buildWatchlistTrend(rows, trendHistoryByProductGid, productPulseSettings),
    settings,
    mock: getWatchlistOverviewSections({ rows, activities, activityStats, settings }),
  };
}

export async function getWatchlistProductForShop(shop, productId, { runId = "" } = {}) {
  const lookupValues = getWatchlistProductLookupValues(productId);
  if (!shop || !lookupValues.length) return null;

  const watchlist = await getWatchlistForShop(shop);
  const product = (watchlist.rows || []).find((row) => {
    const rowValues = getWatchlistProductLookupValues([
      row.id,
      row.productGid,
      row.handle,
    ]);
    return rowValues.some((value) => lookupValues.includes(value));
  }) || null;
  if (!product || !runId) return product;

  const run = await prisma.productWatchActivity.findFirst({
    where: {
      shop,
      id: String(runId),
      productGid: product.productGid,
      eventType: WATCH_CHANGE_REPORT_EVENT,
    },
  });
  if (!run) return product;
  return {
    ...product,
    latestChangeReport: {
      ...formatWatchChangeReportActivity(run),
      history: Array.isArray(product.latestChangeReport?.history) ? product.latestChangeReport.history : [],
    },
  };
}

export async function getDefaultWatchAlertRecipientsForShop(shop, options = {}) {
  const explicitRecipients = normalizeDefaultAlertRecipients(options.defaultAlertRecipients);
  if (explicitRecipients.length) return explicitRecipients.slice(0, 1);

  const db = options.db || prisma;
  if (!shop || typeof db?.session?.findMany !== "function") return [];

  try {
    const sessions = await db.session.findMany({
      where: { shop },
      select: { email: true, accountOwner: true, isOnline: true },
      take: 20,
    });
    const sortedSessions = [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
      const ownerDelta = Number(Boolean(right.accountOwner)) - Number(Boolean(left.accountOwner));
      if (ownerDelta) return ownerDelta;
      return Number(Boolean(right.isOnline)) - Number(Boolean(left.isOnline));
    });
    return normalizeDefaultAlertRecipients(sortedSessions.map((session) => session.email)).slice(0, 1);
  } catch {
    return [];
  }
}

export async function getWatchSettingsForShop(shop, options = {}) {
  const defaultAlertRecipients = await getDefaultWatchAlertRecipientsForShop(shop, options);
  const settings = await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays: DEFAULT_WATCH_SETTINGS.scanCadenceDays,
      alertRecipients: defaultAlertRecipients.length ? defaultAlertRecipients : DEFAULT_WATCH_SETTINGS.alertRecipients,
      triggerRule: DEFAULT_WATCH_SETTINGS.triggerRule,
      summarySchedule: DEFAULT_WATCH_SETTINGS.summarySchedule,
      alertsEnabled: DEFAULT_WATCH_SETTINGS.alertsEnabled,
    },
    update: {},
  });
  if (!normalizeRecipientList(settings.alertRecipients).length && defaultAlertRecipients.length) {
    const updatedSettings = await prisma.productWatchSettings.update({
      where: { shop },
      data: { alertRecipients: defaultAlertRecipients },
    });
    return formatWatchSettings(updatedSettings);
  }
  return formatWatchSettings(settings);
}

export async function updateWatchSettingsForShop(shop, formData, options = {}) {
  const scanCadenceDays = normalizeCadenceDays(formData.get("scanCadenceDays"));
  const triggerRule = normalizeOptionValue(formData.get("triggerRule"), WATCH_TRIGGER_RULE_OPTIONS, DEFAULT_WATCH_SETTINGS.triggerRule);
  const summarySchedule = DEFAULT_WATCH_SETTINGS.summarySchedule;
  const alertsEnabled = String(formData.get("alertsEnabled") || "") === "on";
  const recipients = parseAlertRecipients(String(formData.get("alertRecipients") || ""));
  if (recipients.invalid.length) {
    return {
      status: "validation_error",
      message: `Invalid alert recipient${recipients.invalid.length === 1 ? "" : "s"}: ${recipients.invalid.join(", ")}`,
    };
  }
  const defaultAlertRecipients = await getDefaultWatchAlertRecipientsForShop(shop, options);
  const alertRecipients = recipients.valid.length ? recipients.valid : defaultAlertRecipients;

  const settings = await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays,
      alertRecipients,
      triggerRule,
      summarySchedule,
      alertsEnabled,
    },
    update: {
      scanCadenceDays,
      alertRecipients,
      triggerRule,
      summarySchedule,
      alertsEnabled,
    },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "settings_changed",
    title: "Watch settings updated",
    detail: `${getCadenceLabel(scanCadenceDays)} · ${getTriggerRuleLabel(triggerRule)}`,
    metadata: { scanCadenceDays, triggerRule, alertsEnabled, recipients: alertRecipients.length },
  });

  return {
    status: "success",
    message: "Watch settings updated.",
    action: { id: "update-watch-settings" },
    settings: formatWatchSettings(settings),
  };
}

export async function toggleWatchAlertsForShop(shop, options = {}) {
  const defaultAlertRecipients = await getDefaultWatchAlertRecipientsForShop(shop, options);
  const current = await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays: DEFAULT_WATCH_SETTINGS.scanCadenceDays,
      alertRecipients: defaultAlertRecipients.length ? defaultAlertRecipients : DEFAULT_WATCH_SETTINGS.alertRecipients,
      triggerRule: DEFAULT_WATCH_SETTINGS.triggerRule,
      summarySchedule: DEFAULT_WATCH_SETTINGS.summarySchedule,
      alertsEnabled: DEFAULT_WATCH_SETTINGS.alertsEnabled,
    },
    update: {},
  });
  const nextAlertsEnabled = !current.alertsEnabled;
  const updateData = { alertsEnabled: nextAlertsEnabled };
  if (nextAlertsEnabled && !normalizeRecipientList(current.alertRecipients).length && defaultAlertRecipients.length) {
    updateData.alertRecipients = defaultAlertRecipients;
  }
  const settings = await prisma.productWatchSettings.update({
    where: { shop },
    data: updateData,
  });
  await recordWatchActivityForShop(shop, {
    eventType: "settings_changed",
    title: settings.alertsEnabled ? "Watch alerts enabled" : "Watch alerts disabled",
    detail: settings.alertsEnabled ? "Email alerts are active for watched products." : "Email alerts are paused.",
    metadata: { alertsEnabled: settings.alertsEnabled },
  });

  return {
    status: "success",
    message: settings.alertsEnabled ? "Watch alerts enabled." : "Watch alerts disabled.",
    action: { id: "toggle-watch-alerts" },
    settings: formatWatchSettings(settings),
    suppressBanner: true,
  };
}

export async function searchWatchlistEligibleProductsForShop(shop, rawQuery = "", options = {}) {
  const query = String(rawQuery || "").trim();
  const limit = Math.max(1, Math.min(50, Number(options.limit || WATCHLIST_ELIGIBLE_SEARCH_LIMIT) || WATCHLIST_ELIGIBLE_SEARCH_LIMIT));
  if (!shop) {
    return { status: "validation_error", query, message: "Shop context is required to search Watchlist products.", products: [] };
  }

  const productGids = await findWatchlistEligibleSearchProductGids(shop, query);
  const eligibleByProductGid = await getWatchlistEligibleProductsByGid(shop, productGids);
  const products = productGids
    .map((productGid) => eligibleByProductGid.get(productGid))
    .filter((product) => product && productMatchesWatchlistEligibleSearch(product, query))
    .sort(compareWatchlistEligibleProducts)
    .slice(0, limit);

  return {
    status: "success",
    query,
    products,
    message: products.length
      ? `${products.length} eligible product${products.length === 1 ? "" : "s"} with completed Product Diagnosis found.`
      : query
        ? "No products with completed Product Diagnosis matched that search."
        : "No products with completed Product Diagnosis are available to add yet.",
  };
}

export async function addWatchedProductForShop(shop, product = {}) {
  const productGid = String(product.productGid || product.id || "").trim();
  if (!productGid) {
    return { status: "validation_error", message: "Select a Shopify product to add to the watchlist." };
  }

  const limitContext = await enforceWatchlistPlanLimitForShop(shop);
  const existing = await prisma.productWatchlistItem.findUnique({
    where: { shop_productGid: { shop, productGid } },
  });
  if (existing) {
    const baseline = await captureInitialWatchlistSnapshotForItems(shop, [existing]);
    return {
      status: "success",
      message: `${existing.productTitle} is already on the watchlist.`,
      action: { id: "add-watched-product" },
      baseline,
      suppressBanner: true,
    };
  }

  const eligibility = await getWatchlistEligibleProductForShop(shop, productGid);
  if (!eligibility.eligible) {
    return {
      status: "validation_error",
      message: WATCHLIST_REQUIRES_COMPLETED_DIAGNOSIS_MESSAGE,
      action: { id: "add-watched-product", productGid },
      reason: eligibility.reason,
    };
  }

  const watchedCount = limitContext.items.length;
  if (watchedCount >= limitContext.maxProducts) {
    return {
      status: "validation_error",
      message: `Watchlist is full for the ${limitContext.planName} plan (${limitContext.maxProducts} product${limitContext.maxProducts === 1 ? "" : "s"}). Remove a watched product before adding another one.`,
    };
  }

  const eligibleProduct = eligibility.product;
  const item = await prisma.productWatchlistItem.create({
    data: {
      shop,
      productGid,
      productTitle: eligibleProduct.title,
      handle: optionalString(eligibleProduct.handle),
      sku: optionalString(eligibleProduct.sku),
      status: "Watching",
      imageUrl: optionalString(eligibleProduct.imageUrl),
      imageAlt: optionalString(eligibleProduct.imageAlt),
    },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_added",
    title: "Product added to watchlist",
    detail: item.productTitle,
    productGid: item.productGid,
    productTitle: item.productTitle,
    watchlistItemId: item.id,
    metadata: { handle: item.handle, sku: item.sku },
  });
  const baseline = await captureInitialWatchlistSnapshotForItems(shop, [item]);

  return {
    status: "success",
    message: `${item.productTitle} added to the watchlist.`,
    action: { id: "add-watched-product", productGid: item.productGid },
    baseline,
    watchedCount: watchedCount + 1,
  };
}

export async function addWatchedProductsForShop(shop, products = []) {
  const normalizedProducts = normalizeBulkWatchlistProducts(products);
  if (!normalizedProducts.length) {
    return { status: "validation_error", message: "Select at least one product to add to the watchlist." };
  }

  const limitContext = await enforceWatchlistPlanLimitForShop(shop);
  const productGids = normalizedProducts.map((product) => product.productGid);
  const existingItems = await prisma.productWatchlistItem.findMany({
    where: { shop, productGid: { in: productGids } },
    select: { productGid: true, productTitle: true },
  });
  const watchedCount = limitContext.items.length;
  const existingProductGids = new Set(existingItems.map((item) => item.productGid));
  const candidates = normalizedProducts.filter((product) => !existingProductGids.has(product.productGid));
  const existingCount = normalizedProducts.length - candidates.length;
  const slotsAvailable = Math.max(0, limitContext.maxProducts - watchedCount);

  if (!candidates.length) {
    return {
      status: "success",
      message: existingCount === 1
        ? "The selected product is already on the watchlist."
        : "All selected products are already on the watchlist.",
      action: { id: "add-watched-products" },
      suppressBanner: true,
    };
  }

  const eligibleByProductGid = await getWatchlistEligibleProductsByGid(shop, candidates.map((product) => product.productGid));
  const eligibleCandidates = candidates
    .map((product) => eligibleByProductGid.get(product.productGid))
    .filter(Boolean);
  const skippedForEligibility = Math.max(0, candidates.length - eligibleCandidates.length);

  if (!eligibleCandidates.length) {
    return {
      status: "validation_error",
      message: WATCHLIST_REQUIRES_COMPLETED_DIAGNOSIS_MESSAGE,
      action: { id: "add-watched-products", addedCount: 0, skippedForEligibility },
    };
  }

  if (slotsAvailable <= 0) {
    return {
      status: "validation_error",
      message: `Watchlist is full for the ${limitContext.planName} plan (${limitContext.maxProducts} product${limitContext.maxProducts === 1 ? "" : "s"}). Remove a watched product before adding selected products.`,
      action: { id: "add-watched-products" },
    };
  }

  const productsToCreate = eligibleCandidates.slice(0, slotsAvailable);
  const skippedForCapacity = Math.max(0, eligibleCandidates.length - productsToCreate.length);
  const createdItems = [];

  for (const product of productsToCreate) {
    try {
      const item = await prisma.productWatchlistItem.create({
        data: {
          shop,
          productGid: product.productGid,
          productTitle: product.title,
          handle: optionalString(product.handle),
          sku: optionalString(product.sku),
          status: "Watching",
          imageUrl: optionalString(product.imageUrl),
          imageAlt: optionalString(product.imageAlt),
        },
      });
      createdItems.push(item);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  if (createdItems.length) {
    const activityRows = createdItems.map((item) => ({
      shop,
      productGid: item.productGid,
      productTitle: item.productTitle,
      watchlistItemId: item.id,
      eventType: "product_added",
      title: "Product added to watchlist",
      detail: item.productTitle,
      metadata: { handle: item.handle, sku: item.sku, bulk: true },
    }));
    await prisma.productWatchActivity.createMany({ data: activityRows });
    await recordTimelineForWatchActivities(shop, activityRows);
    await captureInitialWatchlistSnapshotForItems(shop, createdItems);
  }

  const messageParts = [];
  if (createdItems.length) {
    messageParts.push(`${createdItems.length} product${createdItems.length === 1 ? "" : "s"} added to the watchlist`);
  }
  if (existingCount) {
    messageParts.push(`${existingCount} already watching`);
  }
  if (skippedForCapacity) {
    messageParts.push(`${skippedForCapacity} skipped because the watchlist is full`);
  }
  if (skippedForEligibility) {
    messageParts.push(`${skippedForEligibility} skipped because Product Diagnosis is not completed`);
  }

  return {
    status: createdItems.length ? "success" : "validation_error",
    message: `${messageParts.join(" · ")}.`,
    action: { id: "add-watched-products", addedCount: createdItems.length },
    watchedCount: watchedCount + createdItems.length,
  };
}

export async function pauseWatchedProductForShop(shop, productGid) {
  const item = await findWatchedProduct(shop, productGid);
  if (!item) return { status: "validation_error", message: "Watched product was not found." };
  if (item.status === "Paused") {
    return { status: "success", message: `${item.productTitle} is already paused.`, suppressBanner: true };
  }

  const updated = await prisma.productWatchlistItem.update({
    where: { shop_productGid: { shop, productGid: item.productGid } },
    data: { status: "Paused" },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_paused",
    title: "Product paused",
    detail: updated.productTitle,
    productGid: updated.productGid,
    productTitle: updated.productTitle,
    watchlistItemId: updated.id,
  });

  return { status: "success", message: `${updated.productTitle} paused on the watchlist.`, action: { id: "pause-watched-product" }, suppressBanner: true };
}

export async function resumeWatchedProductForShop(shop, productGid) {
  const item = await findWatchedProduct(shop, productGid);
  if (!item) return { status: "validation_error", message: "Watched product was not found." };
  if (item.status !== "Paused") {
    return { status: "success", message: `${item.productTitle} is already being watched.`, suppressBanner: true };
  }

  const updated = await prisma.productWatchlistItem.update({
    where: { shop_productGid: { shop, productGid: item.productGid } },
    data: { status: "Watching" },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_resumed",
    title: "Product resumed",
    detail: updated.productTitle,
    productGid: updated.productGid,
    productTitle: updated.productTitle,
    watchlistItemId: updated.id,
  });

  return { status: "success", message: `${updated.productTitle} resumed on the watchlist.`, action: { id: "resume-watched-product" }, suppressBanner: true };
}

export async function removeWatchedProductForShop(shop, productGid) {
  const item = await findWatchedProduct(shop, productGid);
  if (!item) return { status: "validation_error", message: "Watched product was not found." };

  await prisma.productWatchlistItem.delete({
    where: { shop_productGid: { shop, productGid: item.productGid } },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "product_removed",
    title: "Product removed from watchlist",
    detail: item.productTitle,
    productGid: item.productGid,
    productTitle: item.productTitle,
    watchlistItemId: item.id,
  });

  return { status: "success", message: `${item.productTitle} removed from the watchlist.`, action: { id: "remove-watched-product" }, suppressBanner: true };
}

export async function pauseAllWatchesForShop(shop) {
  const activeItems = await prisma.productWatchlistItem.findMany({
    where: { shop, status: { not: "Paused" } },
    select: { id: true, productGid: true, productTitle: true },
  });
  if (!activeItems.length) {
    return { status: "success", message: "All watched products are already paused.", action: { id: "pause-all-watches" }, suppressBanner: true };
  }

  await prisma.productWatchlistItem.updateMany({
    where: { shop, status: { not: "Paused" } },
    data: { status: "Paused" },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "all_watches_paused",
    title: "All watches paused",
    detail: `${activeItems.length} active product${activeItems.length === 1 ? "" : "s"} paused`,
    metadata: { pausedProductGids: activeItems.map((item) => item.productGid), count: activeItems.length },
  });

  return { status: "success", message: `${activeItems.length} watched product${activeItems.length === 1 ? "" : "s"} paused.`, action: { id: "pause-all-watches" }, suppressBanner: true };
}

export async function resumeAllWatchesForShop(shop) {
  const pausedItems = await prisma.productWatchlistItem.findMany({
    where: { shop, status: "Paused" },
    select: { id: true, productGid: true, productTitle: true },
  });
  if (!pausedItems.length) {
    return { status: "success", message: "All watched products are already active.", action: { id: "resume-all-watches" }, suppressBanner: true };
  }

  await prisma.productWatchlistItem.updateMany({
    where: { shop, status: "Paused" },
    data: { status: "Watching" },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "all_watches_resumed",
    title: "All watches resumed",
    detail: `${pausedItems.length} paused product${pausedItems.length === 1 ? "" : "s"} resumed`,
    metadata: { resumedProductGids: pausedItems.map((item) => item.productGid), count: pausedItems.length },
  });

  return { status: "success", message: `${pausedItems.length} watched product${pausedItems.length === 1 ? "" : "s"} resumed.`, action: { id: "resume-all-watches" }, suppressBanner: true };
}

export async function getActiveWatchedProductsForShop(shop) {
  if (!shop) return [];
  const limitContext = await enforceWatchlistPlanLimitForShop(shop);
  return limitContext.items
    .filter((item) => item.status !== "Paused")
    .map((item) => ({
      id: item.id,
      productGid: item.productGid,
      productTitle: item.productTitle,
      handle: item.handle,
      sku: item.sku,
    }));
}

export async function getWatchlistActivityForShop(shop, { take = 100 } = {}) {
  const [watchlist, activities] = await Promise.all([
    getWatchlistForShop(shop),
    getWatchActivityRowsForShop(shop, { take }),
  ]);
  return {
    ...watchlist,
    activities,
    groupedActivities: groupActivitiesByDay(activities),
  };
}

export async function recordWatchActivityForShop(shop, activity = {}) {
  if (!shop || !activity.eventType || !activity.title) return null;
  const created = await prisma.productWatchActivity.create({
    data: {
      shop,
      productGid: optionalString(activity.productGid),
      productTitle: optionalString(activity.productTitle),
      watchlistItemId: optionalString(activity.watchlistItemId),
      eventType: activity.eventType,
      title: activity.title,
      detail: optionalString(activity.detail),
      metadata: activity.metadata || undefined,
      createdAt: activity.createdAt || new Date(),
    },
  });
  if (created.productGid) await recordTimelineForWatchActivities(shop, [created]);
  return created;
}

export async function captureInitialWatchlistSnapshotForItems(shop, items = [], { createdAt = new Date() } = {}) {
  const normalizedItems = Array.isArray(items) ? items.filter((item) => item?.productGid) : [];
  const productGids = [...new Set(normalizedItems.map((item) => item.productGid).filter(Boolean))];
  if (!shop || !productGids.length) return { count: 0, reportCount: 0, historyCount: 0, skipped: productGids.length };

  const existingReports = await prisma.productWatchActivity.findMany({
    where: {
      shop,
      productGid: { in: productGids },
      eventType: WATCH_CHANGE_REPORT_EVENT,
    },
    select: { productGid: true },
  });
  const productsWithReports = new Set(existingReports.map((activity) => activity.productGid).filter(Boolean));
  const productsNeedingBaseline = productGids.filter((productGid) => !productsWithReports.has(productGid));
  if (!productsNeedingBaseline.length) {
    return { count: 0, reportCount: 0, historyCount: 0, skipped: productGids.length };
  }

  const snapshots = await prisma.productRiskSnapshot.findMany({
    where: { shop, productGid: { in: productsNeedingBaseline } },
  });
  if (!snapshots.length) {
    return { count: 0, reportCount: 0, historyCount: 0, skipped: productsNeedingBaseline.length, missingSnapshotCount: productsNeedingBaseline.length };
  }

  const [activityResult, historyResult] = await Promise.all([
    recordWatchlistScanActivities(shop, snapshots, {
      source: WATCHLIST_BASELINE_SOURCE,
      createdAt,
    }),
    recordProductScoreHistoryBatch(shop, snapshots, {
      source: WATCHLIST_BASELINE_SOURCE,
      recordedAt: createdAt,
    }),
  ]);

  return {
    count: Number(activityResult?.count || 0),
    reportCount: snapshots.length,
    historyCount: Number(historyResult?.count || 0),
    skipped: Math.max(0, productGids.length - snapshots.length),
    productGids: snapshots.map((snapshot) => snapshot.productGid),
  };
}

export async function recordWatchlistScanActivities(shop, snapshots = [], { source = "quickscan", noChangesReused = false, jobId = null, createdAt = new Date() } = {}) {
  const productGids = Array.from(new Set(snapshots.map((snapshot) => snapshot?.productGid).filter(Boolean)));
  if (!shop || !productGids.length) return { count: 0 };
  const shouldCreateChangeReport = isWatchChangeReportSource(source);
  const [watchedItems, productPulseSettings, previousReports] = await Promise.all([
    prisma.productWatchlistItem.findMany({
      where: { shop, productGid: { in: productGids }, status: { not: "Paused" } },
    }),
    getProductPulseSettings(shop),
    shouldCreateChangeReport
      ? prisma.productWatchActivity.findMany({
        where: { shop, productGid: { in: productGids }, eventType: WATCH_CHANGE_REPORT_EVENT },
        orderBy: { createdAt: "desc" },
        take: productGids.length * 8,
      })
      : [],
  ]);
  const itemByProductGid = new Map(watchedItems.map((item) => [item.productGid, item]));
  const previousReportByProductGid = new Map();
  previousReports.forEach((activity) => {
    if (activity.productGid && !previousReportByProductGid.has(activity.productGid)) {
      previousReportByProductGid.set(activity.productGid, activity);
    }
  });
  const now = createdAt;
  const reportRows = [];
  if (shouldCreateChangeReport) {
    for (const snapshot of snapshots.filter((item) => itemByProductGid.has(item.productGid))) {
      const item = itemByProductGid.get(snapshot.productGid);
      const previousActivity = previousReportByProductGid.get(snapshot.productGid);
      const baseReport = buildWatchChangeReport({
        snapshot,
        productPulseSettings,
        previousReport: previousActivity?.metadata?.report || null,
        previousSummary: previousActivity?.metadata?.snapshotSummary || previousActivity?.metadata?.report?.current || null,
        source,
        noChangesReused,
        createdAt: now,
      });
      const report = await enrichWatchChangeReportWithAiNarrative({
        shop,
        jobId,
        productTitle: snapshot.productTitle || item.productTitle,
        report: baseReport,
        noChangesReused,
      });
      reportRows.push({
        shop,
        productGid: snapshot.productGid,
        productTitle: snapshot.productTitle || item.productTitle,
        watchlistItemId: item.id,
        eventType: WATCH_CHANGE_REPORT_EVENT,
        title: report.title,
        detail: report.narrative || report.summary,
        metadata: {
          source,
          noChangesReused,
          jobId,
          riskScore: report.current.riskScore,
          riskLabel: report.current.riskLabel,
          confidence: report.current.confidence,
          impactScore: report.current.impactScore,
          primaryIssue: report.current.primaryIssue,
          report,
          snapshotSummary: report.current,
        },
        createdAt: now,
      });
    }
  }
  const rows = snapshots
    .filter((snapshot) => itemByProductGid.has(snapshot.productGid))
    .map((snapshot) => {
      const item = itemByProductGid.get(snapshot.productGid);
      const riskScore = Number(snapshot.riskScore || 0);
      const riskLabel = getRiskLabelForScore(riskScore, productPulseSettings);
      const eventSpec = getWatchScanActivityEventSpec(source, noChangesReused);
      return {
        shop,
        productGid: snapshot.productGid,
        productTitle: snapshot.productTitle || item.productTitle,
        watchlistItemId: item.id,
        eventType: eventSpec.eventType,
        title: eventSpec.title,
        detail: noChangesReused
          ? `No source changes detected · ${riskLabel} risk (${riskScore}/100)`
          : source === WATCHLIST_BASELINE_SOURCE
          ? `Baseline captured · ${riskLabel} risk (${riskScore}/100) · ${snapshot.primaryIssue || "No primary issue"}`
          : `${riskLabel} risk (${riskScore}/100) · ${snapshot.primaryIssue || "No primary issue"}`,
        metadata: {
          source,
          noChangesReused,
          jobId,
          riskScore,
          riskLabel,
          confidence: snapshot.confidence,
          impactScore: snapshot.impactScore,
          primaryIssue: snapshot.primaryIssue,
        },
      };
    });
  const activityRows = [...reportRows, ...rows];
  if (!activityRows.length) return { count: 0 };
  const result = await prisma.productWatchActivity.createMany({ data: activityRows });
  await recordTimelineForWatchActivities(shop, activityRows);
  return result;
}

function isWatchChangeReportSource(source) {
  return source === FULL_DIAGNOSIS_SOURCE || source === WATCHLIST_BASELINE_SOURCE;
}

function getWatchScanActivityEventSpec(source, noChangesReused = false) {
  if (source === WATCHLIST_BASELINE_SOURCE) {
    return {
      eventType: "watch_baseline_captured",
      title: "Watchlist baseline captured",
    };
  }
  if (source === FULL_DIAGNOSIS_SOURCE) {
    return {
      eventType: "diagnosis_completed",
      title: noChangesReused ? "Product diagnosis reused" : "Product diagnosis completed",
    };
  }
  return {
    eventType: "watch_scan_completed",
    title: "Watch scan updated product risk",
  };
}

async function findWatchedProduct(shop, productGid) {
  const normalizedProductGid = String(productGid || "").trim();
  if (!shop || !normalizedProductGid) return null;
  return prisma.productWatchlistItem.findUnique({
    where: { shop_productGid: { shop, productGid: normalizedProductGid } },
  });
}

function formatWatchlistRow(item, snapshot, productPulseSettings = undefined, latestChangeReport = null, activeDiagnosisJob = null) {
  const riskScore = snapshot ? Number(snapshot.riskScore || 0) : null;
  const metrics = snapshot?.metrics || {};
  const riskTone = snapshot ? getRiskToneForScore(riskScore, productPulseSettings) : "subdued";
  const riskLabel = snapshot ? getRiskLabelForScore(riskScore, productPulseSettings) : "Pending";
  const status = item.status || "Watching";
  const hasSnapshot = Boolean(snapshot);
  const updatedAt = snapshot?.updatedAt || item.updatedAt || item.addedAt;

  return {
    id: item.id,
    productGid: item.productGid,
    title: item.productTitle,
    handle: item.handle || "",
    sku: item.sku || metrics.sku || "",
    status,
    statusTone: status === "Paused" ? "subdued" : "success",
    imageUrl: item.imageUrl || null,
    imageAlt: item.imageAlt || item.productTitle,
    href: item.handle ? `/app/products/${item.handle}` : `/app/products/${encodeURIComponent(item.productGid)}`,
    watchlistHref: item.handle ? `/app/watchlist/${item.handle}` : `/app/watchlist/${encodeURIComponent(item.productGid)}`,
    riskScore,
    riskLabel,
    riskTone,
    latestChange: hasSnapshot ? snapshot.primaryIssue || "New issue" : "Awaiting first scan",
    latestChangeDetail: hasSnapshot ? "" : `Added ${formatWatchDate(item.addedAt)} · ${status}`,
    latestChangeTone: hasSnapshot ? (riskTone === "critical" ? "red" : riskTone === "warning" ? "orange" : "green") : "slate",
    lastIssue: hasSnapshot ? `Updated ${formatWatchDate(updatedAt)}` : "Not scanned yet",
    lastIssueDetail: hasSnapshot ? formatWatchTimestamp(updatedAt) : "Waiting for automatic watch cadence",
    addedAt: formatWatchDate(item.addedAt),
    addedAtIso: toWatchIso(item.addedAt),
    updatedAtIso: toWatchIso(updatedAt),
    latestChangeReport,
    diagnosisJob: activeDiagnosisJob ? formatWatchlistDiagnosisJob(activeDiagnosisJob) : null,
  };
}

function getWatchlistProductLookupValues(input) {
  const rawValues = Array.isArray(input) ? input : [input];
  const values = new Set();
  rawValues.forEach((rawValue) => {
    const raw = String(rawValue || "").trim();
    if (!raw) return;
    [raw, safeDecodeWatchlistLookupValue(raw)].forEach((value) => {
      const normalized = String(value || "").trim();
      if (!normalized) return;
      values.add(normalized);
      values.add(normalized.toLowerCase());
    });
  });
  return Array.from(values);
}

function safeDecodeWatchlistLookupValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getActiveWatchlistDiagnosisJobsForShop(shop) {
  return prisma.catalogSignalJob.findMany({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: { in: ["Queued", "Running"] },
    },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
  });
}

function findActiveWatchlistDiagnosisJobForItem(item, jobs = []) {
  const keys = new Set([
    item?.productGid,
    item?.handle,
  ].filter(Boolean).map(String));
  if (!keys.size) return null;

  return jobs.find((job) => getWatchlistDiagnosisJobKeys(job).some((key) => keys.has(key))) || null;
}

function getWatchlistDiagnosisJobKeys(job) {
  return [
    job.payload?.productGid,
    job.payload?.handle,
    job.payload?.productId,
  ].filter(Boolean).map(String);
}

function formatWatchlistDiagnosisJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    source: job.errorMessage || job.source,
    errorMessage: job.errorMessage || null,
    updatedAtIso: toWatchIso(job.updatedAt),
    startedAtIso: toWatchIso(job.startedAt),
    finishedAtIso: job.finishedAt ? toWatchIso(job.finishedAt) : null,
  };
}

function getWatchlistOverviewSections({ rows = [], activities = [], activityStats = {}, settings = formatWatchSettings(DEFAULT_WATCH_SETTINGS) } = {}) {
  const latestScanActivity = activityStats.latestScan || activities.find((activity) => ["watch_scan_completed", "diagnosis_completed"].includes(activity.eventType));
  const newIssuesThisWeek = Number(activityStats.newIssuesThisWeek || 0);
  const activeRows = rows.filter((row) => row.status !== "Paused");

  return {
    scanCadence: settings.scanCadenceLabel || "Every 3 days",
    scanCadenceDetail: "Automatic rescans",
    lastRun: latestScanActivity?.time || "Not run yet",
    lastRunDetail: activeRows.length ? `${activeRows.length} active product${activeRows.length === 1 ? "" : "s"} watched` : "No active watches",
    nextRun: "In 2d 18h",
    nextRunDetail: "May 21, 9:00 AM",
    newIssues: `${newIssuesThisWeek} this week`,
    newIssuesDetail: newIssuesThisWeek ? "From stored watch activity" : "No new watched issues",
    alertStatus: settings.alertsEnabled ? "Email alerts on" : "Email alerts off",
    alertStatusDetail: `${settings.alertRecipientCount} recipient${settings.alertRecipientCount === 1 ? "" : "s"}`,
  };
}

async function getWatchActivityRowsForShop(shop, { take = 5, eventTypes = null } = {}) {
  const where = { shop, eventType: { not: "watch_order_changed" } };
  if (Array.isArray(eventTypes) && eventTypes.length) {
    where.eventType = { in: eventTypes.map(String).filter(Boolean) };
  }
  const activities = await prisma.productWatchActivity.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });
  return activities.map(formatWatchActivity);
}

async function getLatestWatchChangeReportsForProducts(shop, productGids = []) {
  if (!shop || !productGids.length) return new Map();
  const reports = await prisma.productWatchActivity.findMany({
    where: { shop, productGid: { in: productGids }, eventType: WATCH_CHANGE_REPORT_EVENT },
    orderBy: { createdAt: "desc" },
    take: productGids.length * 50,
  });
  const groupedReports = new Map();
  reports.forEach((activity) => {
    if (!activity.productGid) return;
    const group = groupedReports.get(activity.productGid) || [];
    group.push(activity);
    groupedReports.set(activity.productGid, group);
  });
  const byProductGid = new Map();
  groupedReports.forEach((activities, productGid) => {
    const latest = formatWatchChangeReportActivity(activities[0]);
    latest.runReports = activities
      .slice()
      .reverse()
      .map(formatWatchChangeReportActivity)
      .filter(Boolean);
    latest.history = activities
      .slice()
      .reverse()
      .map(formatWatchRunHistoryPoint)
      .filter(Boolean);
    byProductGid.set(productGid, latest);
  });
  return byProductGid;
}

async function getWatchActivityStatsForShop(shop, productPulseSettings = undefined) {
  const weekAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const [latestScan, recentRiskActivities] = await Promise.all([
    prisma.productWatchActivity.findFirst({
      where: { shop, eventType: { in: ["watch_scan_completed", "diagnosis_completed"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.productWatchActivity.findMany({
      where: {
        shop,
        eventType: { in: ["watch_scan_completed", "diagnosis_completed"] },
        createdAt: { gte: weekAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  return {
    latestScan: latestScan ? formatWatchActivity(latestScan) : null,
    newIssuesThisWeek: recentRiskActivities.filter((activity) => getRiskLabelForScore(Number(activity.metadata?.riskScore || 0), productPulseSettings) !== "Low").length,
  };
}

function formatWatchActivity(activity) {
  const metadata = activity.metadata || {};
  return {
    id: activity.id,
    eventType: activity.eventType,
    productGid: activity.productGid || "",
    productTitle: activity.productTitle || "",
    title: activity.title,
    detail: activity.detail || activity.productTitle || "",
    time: formatWatchDate(activity.createdAt),
    timestamp: formatWatchTimestamp(activity.createdAt),
    createdAt: activity.createdAt?.toISOString?.() || activity.createdAt,
    icon: getActivityIcon(activity.eventType),
    tone: getActivityTone(activity.eventType, metadata),
    riskScore: metadata.riskScore ?? null,
    riskLabel: metadata.riskLabel || "",
    metadata,
  };
}

function formatWatchChangeReportActivity(activity = {}) {
  const metadata = activity.metadata || {};
  const report = normalizeStoredWatchChangeReport(metadata.report || {}, { productTitle: activity.productTitle || "" });
  return {
    id: activity.id,
    productGid: activity.productGid || "",
    productTitle: activity.productTitle || "",
    jobId: metadata.jobId || report.jobId || "",
    source: metadata.source || report.source || "",
    title: report.title || activity.title || "Watchlist change report",
    summary: report.summary || activity.detail || "",
    status: report.status || "changed",
    headline: report.headline || "",
    changeCount: Number(report.changeCount || 0),
    previousRunAt: report.previousRunAt || null,
    currentRunAt: report.currentRunAt || activity.createdAt?.toISOString?.() || activity.createdAt || null,
    createdAt: activity.createdAt?.toISOString?.() || activity.createdAt || null,
    timestamp: formatWatchTimestamp(activity.createdAt),
    previous: report.previous || null,
    current: report.current || null,
    narrative: report.narrative || "",
    sourceChangeCount: Number(report.sourceChangeCount || 0),
    sourceChanges: Array.isArray(report.sourceChanges) ? report.sourceChanges : [],
    sourceInsights: Array.isArray(report.sourceInsights) ? report.sourceInsights : [],
    sections: Array.isArray(report.sections) ? report.sections : [],
    changes: Array.isArray(report.changes) ? report.changes : [],
  };
}

function formatWatchRunHistoryPoint(activity = {}) {
  const metadata = activity.metadata || {};
  const report = normalizeStoredWatchChangeReport(metadata.report || {}, { productTitle: activity.productTitle || "" });
  const current = report.current || metadata.snapshotSummary || {};
  if (!current || typeof current !== "object") return null;
  const timestamp = report.currentRunAt || current.capturedAt || activity.createdAt?.toISOString?.() || activity.createdAt || null;
  const sourceChanges = Array.isArray(report.sourceChanges) ? report.sourceChanges : [];
  return {
    id: activity.id,
    jobId: metadata.jobId || report.jobId || "",
    source: metadata.source || report.source || "",
    status: report.status || "",
    changeCount: Number(report.changeCount || 0),
    actionCount: findWatchNumber(current.actionCount, current.actionsCount, current.openActionCount, current.recommendedActionCount, current.recommendationCount),
    currentRunAt: timestamp,
    capturedAt: current.capturedAt || timestamp,
    riskScore: findWatchNumber(current.riskScore),
    returnRatePercent: findWatchNumber(current.returnRatePercent),
    refundRatePercent: findWatchNumber(current.refundRatePercent),
    productMomentumScore: findWatchNumber(current.productMomentumScore),
    orderCount: findWatchNumber(current.orderCount),
    soldUnits: findWatchNumber(current.soldUnits),
    returnUnits: findWatchNumber(current.returnUnits),
    refundUnits: findWatchNumber(current.refundUnits),
    salesAmount: findWatchNumber(current.salesAmount),
    marginAtRisk: findWatchNumber(current.marginAtRisk),
    refundAmount: findWatchNumber(current.refundAmount, current.evidenceDetails?.refunds?.amount),
    signalCount: findWatchNumber(current.signalCount),
    contentUpdated: sourceChanges.some((change) => String(change?.source || change?.id || "").toLowerCase().includes("content")),
  };
}

async function enrichWatchChangeReportWithAiNarrative({ shop, jobId, productTitle, report, noChangesReused = false } = {}) {
  const deterministicNarrative = buildWatchChangeDeterministicNarrative({ productTitle, report, noChangesReused });
  const baseReport = {
    ...report,
    narrative: deterministicNarrative,
    aiNarrativeStatus: "deterministic",
  };
  if (!report || report.status === "unchanged" || report.status === "baseline" || noChangesReused) return baseReport;
  try {
    const narrative = await generateWatchChangeReportNarrative({ shop, jobId, productTitle, report: baseReport });
    if (!narrative) return baseReport;
    return {
      ...baseReport,
      narrative,
      aiNarrativeStatus: "generated",
    };
  } catch (error) {
    return {
      ...baseReport,
      aiNarrativeStatus: "failed",
      aiNarrativeError: error?.message || String(error || "AI narrative unavailable"),
    };
  }
}

function buildWatchChangeReport({
  snapshot = {},
  productPulseSettings = undefined,
  previousReport = null,
  previousSummary = null,
  source = "full-diagnosis",
  noChangesReused = false,
  createdAt = new Date(),
} = {}) {
  const rawCurrent = buildWatchSnapshotSummary(snapshot, productPulseSettings, createdAt);
  const previous = previousSummary || previousReport?.current || null;
  const current = previous ? alignEquivalentWatchPrimaryIssue(rawCurrent, previous) : rawCurrent;
  const previousRunAt = previous?.capturedAt || previousReport?.currentRunAt || previousReport?.createdAt || null;

  if (!previous) {
    return {
      id: `watch-report-${snapshot.productGid || "product"}-${createdAt.getTime()}`,
      status: "baseline",
      title: "Watch baseline captured",
      headline: "No previous Watchlist data",
      summary: "This is the first Watchlist run for this product. ProductPulse saved the current diagnosis as the baseline for future comparisons.",
      source,
      noChangesReused,
      changeCount: 0,
      sourceChangeCount: 0,
      previousRunAt: null,
      currentRunAt: current.capturedAt,
      previous: null,
      current,
      narrative: "No previous Watchlist data existed for this product. ProductPulse captured the current diagnosis as the baseline; future Watchlist runs will compare new returns, refunds, reviews, product risk, Sales Momentum and evidence against this stored point.",
      sourceChanges: [],
      sourceInsights: [],
      sections: [],
      changes: [],
    };
  }

  const sourceChanges = noChangesReused ? [] : buildWatchSourceChangeCards(previous, current);
  const sourceInsights = buildWatchEvidenceChangeInsights(previous, current);
  const hasConcreteEvidenceChanges = sourceChanges.some((change) => ["orders", "returns", "refunds", "reviews"].includes(change.source));
  const sections = [
    buildRiskChangeSection(previous, current),
    buildEvidenceChangeSection(previous, current, { hasConcreteEvidenceChanges }),
    buildImpactChangeSection(previous, current),
    buildMomentumChangeSection(previous, current),
  ].filter((section) => section.changes.length);
  const changes = sections.flatMap((section) => section.changes.map((change) => ({ ...change, sectionId: section.id, sectionTitle: section.title })));
  const totalChangeCount = sourceChanges.length + changes.length;
  const status = totalChangeCount ? "changed" : "unchanged";
  const headline = totalChangeCount ? getWatchReportHeadline(changes, sourceChanges) : "No meaningful changes detected";
  const summary = totalChangeCount
    ? `${sourceChanges.length} concrete source change${sourceChanges.length === 1 ? "" : "s"} and ${changes.length} calculated product-state change${changes.length === 1 ? "" : "s"} since the previous Watchlist run. ${headline}`
    : "No new orders, returns, refunds, reviews or meaningful calculated product-state movement were detected since the previous Watchlist run.";

  return {
    id: `watch-report-${snapshot.productGid || "product"}-${createdAt.getTime()}`,
    status,
    title: status === "changed" ? "Watchlist changes detected" : "No Watchlist changes detected",
    headline,
    summary,
    source,
    noChangesReused,
    changeCount: totalChangeCount,
    sourceChangeCount: sourceChanges.length,
    previousRunAt,
    currentRunAt: current.capturedAt,
    previous,
    current,
    narrative: buildWatchChangeDeterministicNarrative({ report: { status, headline, sourceChanges, sourceInsights, changes, current, previous }, noChangesReused }),
    sourceChanges,
    sourceInsights,
    sections: status === "unchanged" ? [] : sections,
    changes,
  };
}

function normalizeStoredWatchChangeReport(report = {}, { productTitle = "This product" } = {}) {
  if (!report || typeof report !== "object") return report || {};
  const previous = report.previous || null;
  if (!previous || !report.current) return report;
  const current = previous ? alignEquivalentWatchPrimaryIssue(report.current || {}, previous) : report.current || null;
  const sourceChanges = Array.isArray(report.sourceChanges) ? report.sourceChanges : [];
  const hasConcreteEvidenceChanges = sourceChanges.some((change) => ["orders", "returns", "refunds", "reviews"].includes(change.source));
  const filterChange = (change = {}) => {
    if (change.id === "primary-issue" && areWatchPrimaryIssuesEquivalent(previous?.primaryIssue, report.current?.primaryIssue)) return false;
    if (change.id === "signal-count" && !hasConcreteEvidenceChanges) return false;
    return true;
  };
  const originalChanges = Array.isArray(report.changes) ? report.changes : [];
  const changes = originalChanges.filter(filterChange);
  const sections = (Array.isArray(report.sections) ? report.sections : [])
    .map((section) => ({
      ...section,
      changes: (Array.isArray(section.changes) ? section.changes : []).filter(filterChange),
    }))
    .filter((section) => section.changes.length);
  const currentChanged = current !== report.current;
  const changesChanged = changes.length !== originalChanges.length;
  if (!currentChanged && !changesChanged) return report;

  const totalChangeCount = sourceChanges.length + changes.length;
  const status = totalChangeCount ? "changed" : "unchanged";
  const headline = totalChangeCount ? getWatchReportHeadline(changes, sourceChanges) : "No meaningful changes detected";
  const normalized = {
    ...report,
    status,
    headline,
    title: status === "changed" ? "Watchlist changes detected" : "No Watchlist changes detected",
    summary: totalChangeCount
      ? `${sourceChanges.length} concrete source change${sourceChanges.length === 1 ? "" : "s"} and ${changes.length} calculated product-state change${changes.length === 1 ? "" : "s"} since the previous Watchlist run. ${headline}`
      : "No new orders, returns, refunds, reviews or meaningful calculated product-state movement were detected since the previous Watchlist run.",
    changeCount: totalChangeCount,
    sourceChangeCount: sourceChanges.length,
    current,
    changes,
    sections: status === "unchanged" ? [] : sections,
  };
  return {
    ...normalized,
    narrative: buildWatchChangeDeterministicNarrative({ productTitle, report: normalized, noChangesReused: normalized.noChangesReused }),
    aiNarrativeStatus: report.aiNarrativeStatus === "generated" ? "normalized" : report.aiNarrativeStatus,
  };
}

function buildWatchSnapshotSummary(snapshot = {}, productPulseSettings = undefined, capturedAt = new Date()) {
  const metrics = snapshot.metrics || {};
  const evidenceDetails = buildWatchEvidenceDetails(metrics);
  const riskScore = clampRoundNumber(snapshot.riskScore);
  const returnRatePercent = normalizeRatePercent(firstNumber(
    metrics.returnRatePercent,
    metrics.returnRate,
    metrics.returns?.returnRate,
    metrics.monthlyOrderActivity?.summary?.returnRate,
    metrics.returnRatePrediction?.summary?.totalReturnRate,
  ));
  const refundRatePercent = normalizeRatePercent(firstNumber(
    metrics.refundRatePercent,
    metrics.refundRate,
    metrics.refunds?.refundRate,
    metrics.monthlyOrderActivity?.summary?.refundRate,
  ));
  const productMomentum = metrics.productMomentum || {};
  return {
    capturedAt: toWatchIso(capturedAt),
    riskScore,
    riskLabel: getRiskLabelForScore(riskScore, productPulseSettings),
    confidence: clampRoundNumber(snapshot.confidence ?? metrics.confidence),
    impactScore: clampRoundNumber(snapshot.impactScore ?? metrics.impactScore),
    estimatedImpact: roundMoney(firstNumber(metrics.estimatedImpact, metrics.impactRange?.mid, metrics.financialExposure?.estimatedImpact)),
    marginAtRisk: roundMoney(firstNumber(metrics.marginAtRisk, metrics.financialExposure?.marginAtRisk, metrics.impactFactors?.marginAtRisk)),
    revenueAtRisk: roundMoney(firstNumber(metrics.revenueAtRisk, metrics.financialExposure?.revenueAtRisk, metrics.impactFactors?.revenueAtRisk)),
    primaryIssue: String(snapshot.primaryIssue || metrics.primaryIssue || metrics.mainIssue || "No primary issue"),
    orderCount: clampRoundNumber(firstNumber(metrics.orderCount, metrics.monthlyOrderActivity?.summary?.totalOrders, evidenceDetails.orders?.totalOrders)),
    soldUnits: clampRoundNumber(firstNumber(metrics.soldUnits, metrics.monthlyOrderActivity?.summary?.totalOrderUnits, evidenceDetails.orders?.totalUnits)),
    salesAmount: roundMoney(firstNumber(metrics.salesAmount, metrics.monthlyOrderActivity?.summary?.totalRevenue, evidenceDetails.orders?.totalRevenue)),
    refundAmount: roundMoney(firstNumber(metrics.refundAmount, metrics.refunds?.amount, evidenceDetails.refunds?.amount)),
    returnRatePercent,
    refundRatePercent,
    returnUnits: clampRoundNumber(firstNumber(metrics.returnUnits, metrics.returns?.units, metrics.monthlyOrderActivity?.summary?.totalReturnedUnits, metrics.monthlyOrderActivity?.summary?.returnedOrders)),
    refundUnits: clampRoundNumber(firstNumber(metrics.refundUnits, metrics.refunds?.units, metrics.monthlyOrderActivity?.summary?.totalRefundedUnits, metrics.monthlyOrderActivity?.summary?.refundedOrders)),
    negativeReviewCount: clampRoundNumber(firstNumber(metrics.negativeReviewCount, metrics.reviews?.negativeReviews)),
    reviewCount: clampRoundNumber(firstNumber(metrics.reviewCount, metrics.reviews?.totalReviews)),
    signalCount: clampRoundNumber(firstNumber(metrics.signalCount, metrics.signalsCount, metrics.totalSignals, metrics.evidenceSignalCount)),
    topReturnReason: firstString(
      metrics.topReturnReason,
      metrics.topReturnReasonDetails?.[0]?.label,
      metrics.returnReasons?.[0]?.label,
    ),
    topRefundReason: firstString(
      metrics.topRefundReason,
      metrics.topRefundReasonDetails?.[0]?.label,
      metrics.refundReasons?.[0]?.label,
    ),
    productMomentumScore: clampRoundNumber(firstNumber(metrics.productMomentumScore, productMomentum.score)),
    productMomentumTier: firstString(metrics.productMomentumTier, productMomentum.tier, "No momentum"),
    productMomentumDirection: firstString(metrics.momentumDirection, productMomentum.direction),
    evidenceDetails,
    sourceFingerprint: metrics.incrementalDiagnosis?.cache?.sourceFingerprint || null,
  };
}

function buildWatchEvidenceDetails(metrics = {}) {
  const cache = metrics.incrementalDiagnosis?.cache || {};
  const sourceEvents = cache.sourceEvents || {};
  const customerText = cache.customerText || {};
  const refundCache = cache.refunds || {};
  const orderItems = normalizeWatchSourceEvents(sourceEvents.sales, "orders").slice(-80);
  const returnSourceItems = normalizeWatchSourceEvents(sourceEvents.returns, "returns").slice(-60);
  const refundSourceItems = normalizeWatchSourceEvents(sourceEvents.refunds, "refunds").slice(-50);
  const returnItems = normalizeWatchAnalysisItems(customerText.returnItems).slice(-60);
  const reviewItems = normalizeWatchAnalysisItems(customerText.reviewItems).slice(-80);
  const refundItems = normalizeWatchAnalysisItems(refundCache.items).slice(-40);
  const textInsights = metrics.textInsights || {};
  const refundInsights = metrics.refundInsights || {};
  const monthlySummary = metrics.monthlyOrderActivity?.summary || {};
  return {
    orders: {
      totalOrders: clampRoundNumber(firstNumber(metrics.orderCount, monthlySummary.totalOrders, countWatchUniqueOrders(orderItems))),
      totalUnits: clampRoundNumber(firstNumber(metrics.soldUnits, monthlySummary.totalOrderUnits, sumWatchItemNumbers(orderItems, "quantity"))),
      totalRevenue: roundMoney(firstNumber(metrics.salesAmount, monthlySummary.totalRevenue, sumWatchItemNumbers(orderItems, "amount"))),
      items: orderItems.map(trimWatchSourceEventItem),
    },
    returns: {
      totalUnits: clampRoundNumber(firstNumber(metrics.returnUnits, metrics.monthlyOrderActivity?.summary?.totalReturnedUnits, metrics.monthlyOrderActivity?.summary?.returnedOrders)),
      rate: normalizeRatePercent(firstNumber(metrics.returnRate, metrics.monthlyOrderActivity?.summary?.returnRate)),
      topReasons: normalizeWatchCountRows(metrics.topReturnReasonDetails),
      sentiment: normalizeWatchSentiment(textInsights.returns?.sentiment),
      repeatedLanguage: normalizeWatchCountRows(textInsights.returns?.repeatedLanguage),
      sourceItems: returnSourceItems.map(trimWatchSourceEventItem),
      items: returnItems.map(trimWatchEvidenceItem),
    },
    reviews: {
      total: clampRoundNumber(firstNumber(metrics.reviewCount)),
      negative: clampRoundNumber(firstNumber(metrics.negativeReviewCount)),
      positive: Math.max(0, reviewItems.filter((item) => item.sentiment === "positive").length),
      neutral: Math.max(0, reviewItems.filter((item) => item.sentiment === "neutral").length),
      averageRating: Number(metrics.avgRating || metrics.reviewRating || 0),
      sentiment: normalizeWatchSentiment(textInsights.reviews?.sentiment),
      repeatedLanguage: normalizeWatchCountRows(textInsights.reviews?.repeatedLanguage),
      items: reviewItems.map(trimWatchEvidenceItem),
    },
    refunds: {
      totalUnits: clampRoundNumber(firstNumber(metrics.refundUnits, metrics.monthlyOrderActivity?.summary?.totalRefundedUnits, metrics.monthlyOrderActivity?.summary?.refundedOrders)),
      amount: roundMoney(firstNumber(metrics.refundAmount)),
      rate: normalizeRatePercent(firstNumber(metrics.refundRate)),
      topReasons: normalizeWatchCountRows(metrics.topRefundReasonDetails || refundInsights.topReasons),
      sentiment: normalizeWatchSentiment(refundInsights.sentiment),
      repeatedLanguage: normalizeWatchCountRows(refundInsights.repeatedLanguage),
      sourceItems: refundSourceItems.map(trimWatchSourceEventItem),
      items: refundItems.map(trimWatchEvidenceItem),
    },
    content: {
      changed: Boolean(metrics.incrementalDiagnosis?.productContent?.changed),
      mode: metrics.incrementalDiagnosis?.productContent?.mode || "",
      reason: metrics.incrementalDiagnosis?.productContent?.reason || "",
      signature: metrics.incrementalDiagnosis?.productContent?.signature || cache.productContent?.signature || "",
      productUpdatedAt: metrics.incrementalDiagnosis?.productContent?.productUpdatedAt || cache.productContent?.productUpdatedAt || "",
      descriptionWordCount: clampRoundNumber(firstNumber(metrics.descriptionWordCount)),
      contentQualityScore: clampRoundNumber(firstNumber(metrics.contentQualityScore), 0, 100),
      contentIssues: normalizeWatchCountRows((Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []).map((item) => ({
        label: item.label || item.issue || item.title || item.issueCode,
        count: 1,
      }))).slice(0, 8),
    },
  };
}

function buildWatchSourceChangeCards(previous, current) {
  const previousDetails = previous?.evidenceDetails || {};
  const currentDetails = current?.evidenceDetails || {};
  return [
    buildWatchOrderSourceChange(previous, current, previousDetails.orders, currentDetails.orders),
    buildWatchReturnSourceChange(previous, current, previousDetails.returns, currentDetails.returns),
    buildWatchRefundSourceChange(previous, current, previousDetails.refunds, currentDetails.refunds),
    buildWatchReviewSourceChange(previous, current, previousDetails.reviews, currentDetails.reviews),
    buildWatchContentSourceChange(previousDetails.content, currentDetails.content),
  ].filter(Boolean);
}

function hasWatchSourceBaseline(previous = {}, previousSource = {}, itemFields = ["items"]) {
  if (previous?.sourceFingerprint) return true;
  return itemFields.some((field) => {
    const items = Array.isArray(previousSource?.[field]) ? previousSource[field] : [];
    return items.some((item) => item?.key);
  });
}

function buildWatchOrderSourceChange(previous, current, previousOrders = {}, currentOrders = {}) {
  let newItems = getNewWatchEvidenceItems(previousOrders.items, currentOrders.items, { sinceAt: previous?.capturedAt });
  const orderDelta = watchNumberDelta(findWatchNumber(previous?.orderCount, previousOrders.totalOrders), findWatchNumber(current?.orderCount, currentOrders.totalOrders));
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.soldUnits, previousOrders.totalUnits), findWatchNumber(current?.soldUnits, currentOrders.totalUnits));
  const revenueDelta = watchNumberDelta(findWatchNumber(previous?.salesAmount, previousOrders.totalRevenue), findWatchNumber(current?.salesAmount, currentOrders.totalRevenue));
  newItems = reconcileNewWatchOrderItemsWithAggregateDelta(newItems, { previous, orderDelta });
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousOrders, ["items"]);
  const newOrderCount = countWatchUniqueOrders(newItems) || (allowAggregateFallback ? Math.max(0, Math.round(orderDelta)) : 0);
  const newUnits = sumWatchItemNumbers(newItems, "quantity") || (allowAggregateFallback ? Math.max(0, Math.round(unitDelta)) : 0);
  const newRevenue = roundMoney(sumWatchItemNumbers(newItems, "amount") || (allowAggregateFallback ? Math.max(0, revenueDelta) : 0));
  if (!newOrderCount && !newUnits && newRevenue < 1) return null;
  return {
    id: "new-orders",
    source: "orders",
    label: "New orders",
    value: `${formatNumberWithSuffix(newOrderCount)} order${newOrderCount === 1 ? "" : "s"}`,
    delta: newUnits ? `+${formatNumberWithSuffix(newUnits)} unit${newUnits === 1 ? "" : "s"}` : newRevenue ? `+${formatMoney(newRevenue)}` : "New activity",
    direction: "up",
    tone: "green",
    icon: "shopify-orders",
    detail: [
      newRevenue ? `${formatMoney(newRevenue)} order revenue captured since the previous Watchlist run.` : "",
      newItems.length ? summarizeWatchVariants(newItems) : "",
    ].filter(Boolean).join(" "),
    items: newItems.slice(-6),
  };
}

function reconcileNewWatchOrderItemsWithAggregateDelta(items = [], { previous = {}, orderDelta = 0 } = {}) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const maxNewOrders = Math.max(0, Math.round(Number(orderDelta || 0)));
  if (!maxNewOrders || countWatchUniqueOrders(normalizedItems) <= maxNewOrders) return normalizedItems;

  const withoutStaleDerivedItems = normalizedItems.filter((item) => !isStaleDerivedWatchSaleItem(item, previous?.capturedAt));
  if (countWatchUniqueOrders(withoutStaleDerivedItems) <= maxNewOrders) return withoutStaleDerivedItems;

  return keepMostRecentWatchOrderItems(withoutStaleDerivedItems, maxNewOrders);
}

function isStaleDerivedWatchSaleItem(item = {}, cutoffValue = null) {
  const id = String(item?.id || item?.key || "").toLowerCase();
  if (!id.includes("derived-sale")) return false;
  if (Number(item?.amount || 0) > 0) return false;
  const cutoff = parseWatchDate(cutoffValue);
  const itemDate = parseWatchDate(item.createdAt || item.updatedAt || item.processedAt || item.date);
  return Boolean(cutoff && itemDate && itemDate.getTime() <= cutoff.getTime());
}

function keepMostRecentWatchOrderItems(items = [], maxNewOrders = 0) {
  const sorted = [...items].sort((left, right) => {
    const leftTime = parseWatchDate(left.createdAt || left.updatedAt || left.processedAt || left.date)?.getTime() || 0;
    const rightTime = parseWatchDate(right.createdAt || right.updatedAt || right.processedAt || right.date)?.getTime() || 0;
    return rightTime - leftTime;
  });
  const keptOrderIds = new Set();
  const kept = [];
  for (const item of sorted) {
    const orderId = String(item?.orderId || item?.key || item?.id || "").trim();
    if (orderId && keptOrderIds.has(orderId)) {
      kept.push(item);
      continue;
    }
    if (keptOrderIds.size >= maxNewOrders) continue;
    if (orderId) keptOrderIds.add(orderId);
    kept.push(item);
  }
  const keptKeys = new Set(kept.map((item) => item?.key || item?.id).filter(Boolean));
  return items.filter((item) => keptKeys.has(item?.key || item?.id));
}

function buildWatchReturnSourceChange(previous, current, previousReturns = {}, currentReturns = {}) {
  const newSourceItems = getNewWatchEvidenceItems(previousReturns.sourceItems, currentReturns.sourceItems, { sinceAt: previous?.capturedAt });
  const newTextItems = getNewWatchEvidenceItems(previousReturns.items, currentReturns.items, { sinceAt: previous?.capturedAt });
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.returnUnits, previousReturns.totalUnits), findWatchNumber(current?.returnUnits, currentReturns.totalUnits));
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousReturns, ["sourceItems", "items"]);
  const newUnits = sumWatchItemNumbers(newSourceItems, "quantity") || sumWatchItemNumbers(newTextItems, "quantity") || (allowAggregateFallback ? Math.max(0, Math.round(unitDelta)) : 0);
  const newCount = newSourceItems.length || newTextItems.length || (allowAggregateFallback && newUnits ? 1 : 0);
  if (!newCount && !newUnits) return null;
  const sentiment = summarizeWatchEvidenceItems(newTextItems);
  const reasons = countWatchTerms([
    ...newSourceItems.map((item) => item.reason || item.reasonText),
    ...newTextItems.map((item) => item.reason || item.issueCode),
  ].filter(Boolean));
  return {
    id: "new-returns",
    source: "returns",
    label: "New returns",
    value: `${formatNumberWithSuffix(newUnits || newCount)} returned unit${(newUnits || newCount) === 1 ? "" : "s"}`,
    delta: `+${formatNumberWithSuffix(newCount)} return signal${newCount === 1 ? "" : "s"}`,
    direction: "up",
    tone: "orange",
    icon: "shopify-returns",
    detail: [
      reasons.length ? `New return reason language: ${formatWatchCountList(reasons, 3)}.` : "",
      sentiment.total ? `New return text sentiment: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      newTextItems[0]?.text ? `Latest note: "${truncateWatchText(newTextItems[0].text, 110)}"` : "",
    ].filter(Boolean).join(" "),
    items: [...newSourceItems, ...newTextItems].slice(-6),
  };
}

function buildWatchRefundSourceChange(previous, current, previousRefunds = {}, currentRefunds = {}) {
  const newSourceItems = getNewWatchEvidenceItems(previousRefunds.sourceItems, currentRefunds.sourceItems, { sinceAt: previous?.capturedAt });
  const newTextItems = getNewWatchEvidenceItems(previousRefunds.items, currentRefunds.items, { sinceAt: previous?.capturedAt });
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.refundUnits, previousRefunds.totalUnits), findWatchNumber(current?.refundUnits, currentRefunds.totalUnits));
  const amountDelta = watchNumberDelta(findWatchNumber(previousRefunds.amount), findWatchNumber(currentRefunds.amount));
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousRefunds, ["sourceItems", "items"]);
  const newUnits = sumWatchItemNumbers(newSourceItems, "quantity") || sumWatchItemNumbers(newTextItems, "quantity") || (allowAggregateFallback ? Math.max(0, Math.round(unitDelta)) : 0);
  const newAmount = roundMoney(sumWatchItemNumbers(newSourceItems, "amount") || (allowAggregateFallback ? Math.max(0, amountDelta) : 0));
  const newCount = newSourceItems.length || newTextItems.length || (allowAggregateFallback && newUnits ? 1 : 0);
  if (!newCount && !newUnits && newAmount < 1) return null;
  const sentiment = summarizeWatchEvidenceItems(newTextItems);
  const reasons = countWatchTerms(getWatchRefundReasonTerms({ textItems: newTextItems, sourceItems: newSourceItems }));
  return {
    id: "new-refunds",
    source: "refunds",
    label: "New refunds",
    value: `${formatNumberWithSuffix(newUnits || newCount)} refunded unit${(newUnits || newCount) === 1 ? "" : "s"}`,
    delta: newAmount ? `+${formatMoney(newAmount)}` : `+${formatNumberWithSuffix(newCount)} refund signal${newCount === 1 ? "" : "s"}`,
    direction: "up",
    tone: "orange",
    icon: "shopify-refunds",
    detail: [
      reasons.length ? `New refund reason language: ${formatWatchCountList(reasons, 3)}.` : "",
      sentiment.total ? `New refund-note sentiment: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      newTextItems[0]?.text ? `Latest note: "${truncateWatchText(newTextItems[0].text, 110)}"` : "",
    ].filter(Boolean).join(" "),
    items: [...newSourceItems, ...newTextItems].slice(-6),
  };
}

function buildWatchReviewSourceChange(previous, current, previousReviews = {}, currentReviews = {}) {
  const newItems = getNewWatchEvidenceItems(previousReviews.items, currentReviews.items, { sinceAt: previous?.capturedAt });
  const reviewDelta = watchNumberDelta(findWatchNumber(previous?.reviewCount, previousReviews.total), findWatchNumber(current?.reviewCount, currentReviews.total));
  const negativeDelta = watchNumberDelta(findWatchNumber(previous?.negativeReviewCount, previousReviews.negative), findWatchNumber(current?.negativeReviewCount, currentReviews.negative));
  const ratingDelta = watchNumberDelta(findWatchNumber(previousReviews.averageRating), findWatchNumber(currentReviews.averageRating));
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousReviews, ["items"]);
  const safeNegativeDelta = allowAggregateFallback || newItems.length ? negativeDelta : 0;
  const safeRatingDelta = allowAggregateFallback || newItems.length ? ratingDelta : 0;
  const newCount = newItems.length || (allowAggregateFallback ? Math.max(0, Math.round(reviewDelta)) : 0);
  if (!newCount && Math.abs(safeRatingDelta) < 0.1 && !safeNegativeDelta) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems);
  const repeated = extractWatchRepeatedLanguage(newItems);
  const ratingDirection = safeRatingDelta > 0 ? "up" : safeRatingDelta < 0 ? "down" : "neutral";
  return {
    id: "new-reviews",
    source: "reviews",
    label: newCount ? "New reviews" : "Review rating changed",
    value: newCount ? `${formatNumberWithSuffix(newCount)} review${newCount === 1 ? "" : "s"}` : `${formatNumberWithSuffix(previousReviews.averageRating || 0)} to ${formatNumberWithSuffix(currentReviews.averageRating || 0)}`,
    delta: Math.abs(safeRatingDelta) >= 0.1
      ? `${safeRatingDelta > 0 ? "+" : ""}${formatNumberWithSuffix(safeRatingDelta)} rating`
      : `${safeNegativeDelta > 0 ? "+" : ""}${formatNumberWithSuffix(safeNegativeDelta)} negative`,
    direction: ratingDirection === "neutral" ? (safeNegativeDelta > 0 ? "up" : safeNegativeDelta < 0 ? "down" : "neutral") : ratingDirection,
    tone: safeNegativeDelta > 0 || sentiment.negative > sentiment.positive || safeRatingDelta < -0.1 ? "orange" : "blue",
    icon: "star",
    detail: [
      sentiment.total ? `New review sentiment: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      Math.abs(safeRatingDelta) >= 0.1 ? `Average rating moved from ${formatNumberWithSuffix(previousReviews.averageRating || 0)} to ${formatNumberWithSuffix(currentReviews.averageRating || 0)}.` : "",
      repeated.length ? `Repeated new review language: ${formatWatchCountList(repeated, 4)}.` : "",
      newItems[0]?.text ? `Latest review: "${truncateWatchText(newItems[0].text, 110)}"` : "",
    ].filter(Boolean).join(" "),
    items: newItems.slice(-6),
  };
}

function buildWatchContentSourceChange(previousContent = {}, currentContent = {}) {
  if (!currentContent?.changed) return null;
  if (!isConcreteWatchContentChange(previousContent, currentContent)) return null;
  return {
    id: "product-content-updated",
    source: "content",
    label: "Product content",
    value: "Updated",
    delta: "Changed",
    direction: "neutral",
    tone: "blue",
    icon: "shopify-product",
    detail: currentContent.reason || "Product title, description, variant, SEO, tag, collection or media content changed since the previous Product Diagnosis.",
    items: [],
  };
}

function isConcreteWatchContentChange(previousContent = {}, currentContent = {}) {
  const reason = String(currentContent.reason || "").toLowerCase();
  if (!reason || reason.includes("cache_missing") || reason.includes("signature_missing") || reason === "no_previous_cutoff") {
    return false;
  }
  const previousSignature = String(previousContent.signature || "").trim();
  const currentSignature = String(currentContent.signature || "").trim();
  if (previousSignature && currentSignature) return previousSignature !== currentSignature;
  return reason.includes("signature_changed") || reason.includes("content_changed");
}

function buildWatchEvidenceChangeInsights(previous, current) {
  const previousDetails = previous?.evidenceDetails || {};
  const currentDetails = current?.evidenceDetails || {};
  return [
    buildWatchOrderInsight(previous, current, previousDetails.orders, currentDetails.orders),
    buildWatchReturnInsight(previous, current, previousDetails.returns, currentDetails.returns),
    buildWatchReviewInsight(previous, current, previousDetails.reviews, currentDetails.reviews),
    buildWatchRefundInsight(previous, current, previousDetails.refunds, currentDetails.refunds),
    buildWatchContentInsight(previousDetails.content, currentDetails.content),
  ].filter(Boolean);
}

function buildWatchOrderInsight(previous, current, previousOrders = {}, currentOrders = {}) {
  let newItems = getNewWatchEvidenceItems(previousOrders.items, currentOrders.items, { sinceAt: previous?.capturedAt });
  const orderDelta = watchNumberDelta(findWatchNumber(previous?.orderCount, previousOrders.totalOrders), findWatchNumber(current?.orderCount, currentOrders.totalOrders));
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.soldUnits, previousOrders.totalUnits), findWatchNumber(current?.soldUnits, currentOrders.totalUnits));
  const revenueDelta = watchNumberDelta(findWatchNumber(previous?.salesAmount, previousOrders.totalRevenue), findWatchNumber(current?.salesAmount, currentOrders.totalRevenue));
  newItems = reconcileNewWatchOrderItemsWithAggregateDelta(newItems, { previous, orderDelta });
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousOrders, ["items"]);
  const newOrderCount = countWatchUniqueOrders(newItems) || (allowAggregateFallback ? Math.max(0, Math.round(orderDelta)) : 0);
  const newUnits = sumWatchItemNumbers(newItems, "quantity") || (allowAggregateFallback ? Math.max(0, Math.round(unitDelta)) : 0);
  const newRevenue = roundMoney(sumWatchItemNumbers(newItems, "amount") || (allowAggregateFallback ? Math.max(0, revenueDelta) : 0));
  if (!newOrderCount && !newUnits && newRevenue < 1) return null;
  return {
    id: "order-evidence",
    title: "Order activity changed",
    tone: "green",
    metric: `${formatNumberWithSuffix(newOrderCount)} new order${newOrderCount === 1 ? "" : "s"}`,
    summary: `${formatNumberWithSuffix(newUnits || newOrderCount)} sold unit${(newUnits || newOrderCount) === 1 ? "" : "s"} were captured since the previous Watchlist report.`,
    bullets: [
      newRevenue ? `New order revenue: ${formatMoney(newRevenue)}.` : "",
      summarizeWatchVariants(newItems),
      summarizeWatchGeography(newItems),
    ].filter(Boolean),
  };
}

function buildWatchReturnInsight(previous, current, previousReturns = {}, currentReturns = {}) {
  const newItems = getNewWatchEvidenceItems(previousReturns.items, currentReturns.items, { sinceAt: previous?.capturedAt });
  const newSourceItems = getNewWatchEvidenceItems(previousReturns.sourceItems, currentReturns.sourceItems, { sinceAt: previous?.capturedAt });
  const unitDelta = Number(current?.returnUnits || currentReturns.totalUnits || 0) - Number(previous?.returnUnits || previousReturns.totalUnits || 0);
  const rateDelta = Number(current?.returnRatePercent || currentReturns.rate || 0) - Number(previous?.returnRatePercent || previousReturns.rate || 0);
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousReturns, ["sourceItems", "items"]);
  const safeUnitDelta = allowAggregateFallback || newItems.length || newSourceItems.length ? unitDelta : 0;
  const safeRateDelta = allowAggregateFallback || newItems.length || newSourceItems.length ? rateDelta : 0;
  if (!newItems.length && !newSourceItems.length && Math.abs(safeUnitDelta) < 1 && Math.abs(safeRateDelta) < 0.2) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems.length ? newItems : currentReturns.items);
  const sentimentLabel = newItems.length ? "New return sentiment" : "Current return sentiment";
  const reasons = countWatchTerms([
    ...newItems.map((item) => item.reason || item.issueCode),
    ...newSourceItems.map((item) => item.reason || item.reasonText),
  ].filter(Boolean));
  const repeated = extractWatchRepeatedLanguage(newItems);
  return {
    id: "return-evidence",
    title: "Return evidence changed",
    tone: safeUnitDelta > 0 || safeRateDelta > 0 ? "orange" : "green",
    metric: safeUnitDelta > 0 ? `+${formatNumberWithSuffix(safeUnitDelta)} returned unit${safeUnitDelta === 1 ? "" : "s"}` : `${formatNumberWithSuffix(currentReturns.totalUnits || current?.returnUnits || 0)} returned units`,
    summary: newItems.length
      ? `${newItems.length} new return text signal${newItems.length === 1 ? "" : "s"} were captured since the previous Watchlist report.`
      : `Return pressure moved from ${formatNumberWithSuffix(previous?.returnRatePercent || previousReturns.rate || 0, "%")} to ${formatNumberWithSuffix(current?.returnRatePercent || currentReturns.rate || 0, "%")}.`,
    bullets: [
      reasons.length ? `Top new return reason language: ${formatWatchCountList(reasons, 3)}.` : "",
      sentiment.total ? `${sentimentLabel}: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      repeated.length ? `Repeated new return language: ${formatWatchCountList(repeated, 4)}.` : "",
      newItems[0]?.text ? `Representative note: "${truncateWatchText(newItems[0].text, 150)}"` : "",
    ].filter(Boolean),
  };
}

function buildWatchReviewInsight(previous, current, previousReviews = {}, currentReviews = {}) {
  const newItems = getNewWatchEvidenceItems(previousReviews.items, currentReviews.items, { sinceAt: previous?.capturedAt });
  const negativeDelta = Number(current?.negativeReviewCount || currentReviews.negative || 0) - Number(previous?.negativeReviewCount || previousReviews.negative || 0);
  const reviewDelta = Number(current?.reviewCount || currentReviews.total || 0) - Number(previous?.reviewCount || previousReviews.total || 0);
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousReviews, ["items"]);
  const safeNegativeDelta = allowAggregateFallback || newItems.length ? negativeDelta : 0;
  const safeReviewDelta = allowAggregateFallback || newItems.length ? reviewDelta : 0;
  if (!newItems.length && Math.abs(safeNegativeDelta) < 1 && Math.abs(safeReviewDelta) < 1) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems.length ? newItems : currentReviews.items);
  const sentimentLabel = newItems.length ? "New review sentiment" : "Current review sentiment";
  const repeated = extractWatchRepeatedLanguage(newItems);
  const ratings = countWatchTerms(newItems.map((item) => Number(item.rating || 0) ? `${Number(item.rating)} star` : "").filter(Boolean));
  return {
    id: "review-evidence",
    title: "Review evidence changed",
    tone: safeNegativeDelta > 0 || sentiment.negative > sentiment.positive ? "orange" : "blue",
    metric: newItems.length ? `${newItems.length} new review${newItems.length === 1 ? "" : "s"}` : `${safeNegativeDelta > 0 ? "+" : ""}${safeNegativeDelta} negative reviews`,
    summary: newItems.length
      ? `${newItems.length} new review text signal${newItems.length === 1 ? "" : "s"} were added to the watched product evidence.`
      : `Stored review volume changed from ${previous?.reviewCount || previousReviews.total || 0} to ${current?.reviewCount || currentReviews.total || 0}.`,
    bullets: [
      sentiment.total ? `${sentimentLabel}: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      ratings.length ? `New review ratings: ${formatWatchCountList(ratings, 4)}.` : "",
      repeated.length ? `Repeated new review language: ${formatWatchCountList(repeated, 4)}.` : "",
      newItems[0]?.text ? `Representative review: "${truncateWatchText(newItems[0].text, 150)}"` : "",
    ].filter(Boolean),
  };
}

function buildWatchRefundInsight(previous, current, previousRefunds = {}, currentRefunds = {}) {
  const newItems = getNewWatchEvidenceItems(previousRefunds.items, currentRefunds.items, { sinceAt: previous?.capturedAt });
  const newSourceItems = getNewWatchEvidenceItems(previousRefunds.sourceItems, currentRefunds.sourceItems, { sinceAt: previous?.capturedAt });
  const unitDelta = Number(current?.refundUnits || currentRefunds.totalUnits || 0) - Number(previous?.refundUnits || previousRefunds.totalUnits || 0);
  const allowAggregateFallback = hasWatchSourceBaseline(previous, previousRefunds, ["sourceItems", "items"]);
  const safeUnitDelta = allowAggregateFallback || newItems.length || newSourceItems.length ? unitDelta : 0;
  if (!newItems.length && !newSourceItems.length && Math.abs(safeUnitDelta) < 1) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems.length ? newItems : currentRefunds.items);
  const sentimentLabel = newItems.length ? "New refund-note sentiment" : "Current refund-note sentiment";
  const reasons = countWatchTerms(getWatchRefundReasonTerms({ textItems: newItems, sourceItems: newSourceItems }));
  const repeated = extractWatchRepeatedLanguage(newItems);
  return {
    id: "refund-evidence",
    title: "Refund evidence changed",
    tone: safeUnitDelta > 0 ? "orange" : "green",
    metric: safeUnitDelta > 0 ? `+${formatNumberWithSuffix(safeUnitDelta)} refunded unit${safeUnitDelta === 1 ? "" : "s"}` : `${formatNumberWithSuffix(currentRefunds.totalUnits || current?.refundUnits || 0)} refunded units`,
    summary: newItems.length
      ? `${newItems.length} new refund note signal${newItems.length === 1 ? "" : "s"} were captured.`
      : `Refunded units changed from ${previous?.refundUnits || previousRefunds.totalUnits || 0} to ${current?.refundUnits || currentRefunds.totalUnits || 0}.`,
    bullets: [
      reasons.length ? `Top new refund reason language: ${formatWatchCountList(reasons, 3)}.` : "",
      sentiment.total ? `${sentimentLabel}: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      repeated.length ? `Repeated new refund-note language: ${formatWatchCountList(repeated, 4)}.` : "",
      newItems[0]?.text ? `Representative refund note: "${truncateWatchText(newItems[0].text, 150)}"` : "",
    ].filter(Boolean),
  };
}

function buildWatchContentInsight(previousContent = {}, currentContent = {}) {
  if (!currentContent?.changed) return null;
  if (!isConcreteWatchContentChange(previousContent, currentContent)) return null;
  return {
    id: "product-content",
    title: "Product content changed",
    tone: "blue",
    metric: "PDP content updated",
    summary: currentContent.reason || "Product title, description, variant, SEO, tag, collection or media content changed since the previous Product Diagnosis.",
    bullets: [
      Number(currentContent.descriptionWordCount || 0) ? `Description now has ${currentContent.descriptionWordCount} words.` : "",
      Number(currentContent.contentQualityScore || 0) ? `Current content quality score: ${currentContent.contentQualityScore}.` : "",
      currentContent.contentIssues?.length ? `Detected content issues: ${formatWatchCountList(currentContent.contentIssues, 4)}.` : "",
      previousContent?.mode ? `Previous product-content mode: ${previousContent.mode}.` : "",
    ].filter(Boolean),
  };
}

function buildRiskChangeSection(previous, current) {
  const changes = [
    numericWatchChange({
      id: "risk-score",
      label: "Product risk",
      previous: previous.riskScore,
      current: current.riskScore,
      threshold: 1,
      detail: "Product risk changed based on the latest stored evidence and score model.",
    }),
    textWatchChange({
      id: "risk-label",
      label: "Risk tier",
      previous: previous.riskLabel,
      current: current.riskLabel,
      detail: "The risk category changed according to the current shop thresholds.",
    }),
    numericWatchChange({
      id: "diagnosis-confidence",
      label: "Diagnosis confidence",
      previous: previous.confidence,
      current: current.confidence,
      suffix: "%",
      threshold: 1,
      detail: "Confidence changed because source coverage, sample size or agreement changed.",
    }),
    textWatchChange({
      id: "primary-issue",
      label: "Primary issue",
      previous: previous.primaryIssue,
      current: current.primaryIssue,
      detail: "The top diagnosis focus changed since the previous Watchlist run.",
    }),
  ].filter(Boolean);
  return { id: "risk", title: "Risk and diagnosis", tone: "purple", changes };
}

function buildEvidenceChangeSection(previous, current, { hasConcreteEvidenceChanges = false } = {}) {
  const changes = [
    numericWatchChange({
      id: "return-rate",
      label: "Return rate",
      previous: previous.returnRatePercent,
      current: current.returnRatePercent,
      suffix: "%",
      threshold: 0.2,
      detail: "Return pressure changed in the product evidence window.",
    }),
    numericWatchChange({
      id: "returned-units",
      label: "Returned units",
      previous: previous.returnUnits,
      current: current.returnUnits,
      threshold: 1,
      detail: "Returned product units changed since the last Watchlist report.",
    }),
    numericWatchChange({
      id: "refund-rate",
      label: "Refund rate",
      previous: previous.refundRatePercent,
      current: current.refundRatePercent,
      suffix: "%",
      threshold: 0.2,
      detail: "Refund pressure changed in the product evidence window.",
    }),
    numericWatchChange({
      id: "negative-reviews",
      label: "Negative reviews",
      previous: previous.negativeReviewCount,
      current: current.negativeReviewCount,
      threshold: 1,
      detail: "Negative review volume changed for this watched product.",
    }),
    shouldReportWatchSignalCountChange(previous, current, { hasConcreteEvidenceChanges }) ? numericWatchChange({
      id: "signal-count",
      label: "Evidence signals",
      previous: previous.signalCount,
      current: current.signalCount,
      threshold: 1,
      detail: "The amount of stored diagnostic evidence changed.",
    }) : null,
    textWatchChange({
      id: "top-return-reason",
      label: "Top return reason",
      previous: previous.topReturnReason,
      current: current.topReturnReason,
      detail: "The leading return reason changed.",
    }),
    textWatchChange({
      id: "top-refund-reason",
      label: "Top refund reason",
      previous: previous.topRefundReason,
      current: current.topRefundReason,
      detail: "The leading refund reason changed.",
    }),
  ].filter(Boolean);
  return { id: "evidence", title: "Evidence movement", tone: "blue", changes };
}

function buildImpactChangeSection(previous, current) {
  const changes = [
    moneyWatchChange({
      id: "estimated-impact",
      label: "Estimated Margin Exposure",
      previous: previous.estimatedImpact,
      current: current.estimatedImpact,
      threshold: 1,
      detail: "Estimated Margin Exposure changed since the previous run.",
    }),
    moneyWatchChange({
      id: "margin-at-risk",
      label: "Estimated Margin Exposure",
      previous: previous.marginAtRisk,
      current: current.marginAtRisk,
      threshold: 1,
      detail: "Estimated margin exposure changed for this watched product.",
    }),
    moneyWatchChange({
      id: "revenue-at-risk",
      label: "Revenue at risk",
      previous: previous.revenueAtRisk,
      current: current.revenueAtRisk,
      threshold: 1,
      detail: "Estimated revenue exposure changed for this watched product.",
    }),
  ].filter(Boolean);
  return { id: "impact", title: "Estimated Margin Exposure", tone: "orange", changes };
}

function buildMomentumChangeSection(previous, current) {
  const changes = [
    numericWatchChange({
      id: "momentum-score",
      label: "Sales Momentum",
      previous: previous.productMomentumScore,
      current: current.productMomentumScore,
      suffix: "/100",
      threshold: 1,
      detail: "Sales Momentum changed based on recent sales velocity and catalog position.",
    }),
    textWatchChange({
      id: "momentum-tier",
      label: "Sales Momentum tier",
      previous: previous.productMomentumTier,
      current: current.productMomentumTier,
      detail: "The commercial attention category changed.",
    }),
    textWatchChange({
      id: "momentum-direction",
      label: "Sales Momentum direction",
      previous: previous.productMomentumDirection,
      current: current.productMomentumDirection,
      detail: "The product's sales movement label changed.",
    }),
  ].filter(Boolean);
  return { id: "momentum", title: "Sales Momentum", tone: "green", changes };
}

function numericWatchChange({ id, label, previous, current, suffix = "", threshold = 1, detail }) {
  if (!Number.isFinite(Number(previous)) || !Number.isFinite(Number(current))) return null;
  const previousNumber = Number(previous);
  const currentNumber = Number(current);
  const delta = currentNumber - previousNumber;
  if (Math.abs(delta) < threshold) return null;
  return {
    id,
    label,
    from: formatNumberWithSuffix(previousNumber, suffix),
    to: formatNumberWithSuffix(currentNumber, suffix),
    delta: `${delta > 0 ? "+" : ""}${formatNumberWithSuffix(delta, suffix)}`,
    direction: delta > 0 ? "up" : "down",
    detail,
  };
}

function moneyWatchChange({ id, label, previous, current, threshold = 1, detail }) {
  const previousNumber = Number(previous);
  const currentNumber = Number(current);
  if (!Number.isFinite(previousNumber) || !Number.isFinite(currentNumber)) return null;
  const dynamicThreshold = Math.max(Number(threshold || 0), 5, Math.abs(previousNumber) * 0.01);
  const change = numericWatchChange({ id, label, previous: previousNumber, current: currentNumber, threshold: dynamicThreshold, detail });
  if (!change) return null;
  return {
    ...change,
    from: formatMoney(previousNumber),
    to: formatMoney(currentNumber),
    delta: `${currentNumber - previousNumber > 0 ? "+" : ""}${formatMoney(currentNumber - previousNumber)}`,
  };
}

function textWatchChange({ id, label, previous, current, detail }) {
  const previousText = String(previous || "").trim();
  const currentText = String(current || "").trim();
  if (!previousText || !currentText || previousText === currentText) return null;
  return {
    id,
    label,
    from: previousText,
    to: currentText,
    delta: "Changed",
    direction: "neutral",
    detail,
  };
}

function alignEquivalentWatchPrimaryIssue(current = {}, previous = {}) {
  if (!areWatchPrimaryIssuesEquivalent(previous?.primaryIssue, current?.primaryIssue)) return current;
  if (String(previous?.primaryIssue || "").trim() === String(current?.primaryIssue || "").trim()) return current;
  return {
    ...current,
    primaryIssue: previous.primaryIssue,
  };
}

function shouldReportWatchSignalCountChange(previous = {}, current = {}, { hasConcreteEvidenceChanges = false } = {}) {
  const signalChange = numericWatchChange({
    id: "signal-count-check",
    label: "Evidence signals",
    previous: previous.signalCount,
    current: current.signalCount,
    threshold: 1,
  });
  if (!signalChange) return false;
  return Boolean(hasConcreteEvidenceChanges);
}

function areWatchPrimaryIssuesEquivalent(previousIssue, currentIssue) {
  const previousText = String(previousIssue || "").trim();
  const currentText = String(currentIssue || "").trim();
  if (!previousText || !currentText) return false;
  if (previousText === currentText) return true;
  const previousNormalized = normalizeWatchIssueText(previousText);
  const currentNormalized = normalizeWatchIssueText(currentText);
  if (!previousNormalized || !currentNormalized) return false;
  if (previousNormalized === currentNormalized) return true;

  const previousTokens = getWatchIssueSemanticTokens(previousText);
  const currentTokens = getWatchIssueSemanticTokens(currentText);
  if (previousTokens.size === 1 && currentTokens.size === 1) {
    return [...previousTokens][0] === [...currentTokens][0];
  }
  if (previousTokens.size < 2 || currentTokens.size < 2) return false;
  const overlap = countWatchSetOverlap(previousTokens, currentTokens);
  const smallerSetCoverage = overlap / Math.min(previousTokens.size, currentTokens.size);
  const unionSize = new Set([...previousTokens, ...currentTokens]).size || 1;
  const jaccard = overlap / unionSize;
  const sameFamily = getWatchIssueSemanticFamily(previousTokens) === getWatchIssueSemanticFamily(currentTokens);

  return sameFamily
    ? smallerSetCoverage >= 0.6 || jaccard >= 0.45
    : smallerSetCoverage >= 0.8 && jaccard >= 0.55;
}

function normalizeWatchIssueText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWatchIssueSemanticTokens(value = "") {
  const stopWords = new Set([
    "a", "an", "and", "or", "the", "to", "of", "for", "with", "without", "from", "in", "on", "at", "by",
    "issue", "issues", "problem", "problems", "concern", "concerns", "product", "customer", "customers",
    "impact", "pressure", "main", "primary", "top", "other", "general",
  ]);
  const synonyms = {
    leaks: "leak",
    leaking: "leak",
    leakage: "leak",
    leaky: "leak",
    spilled: "spill",
    spilling: "spill",
    spills: "spill",
    sealant: "seal",
    sealed: "seal",
    sealing: "seal",
    gaskets: "seal",
    gasket: "seal",
    lids: "lid",
    caps: "lid",
    cap: "lid",
    defect: "quality",
    defects: "quality",
    defective: "quality",
    failure: "quality",
    failures: "quality",
    failing: "quality",
    faulty: "quality",
    broke: "durability",
    broken: "durability",
    breaking: "durability",
    durable: "durability",
    sizing: "fit",
    size: "fit",
    sizes: "fit",
    small: "fit",
    tight: "fit",
    large: "fit",
    color: "color",
    colour: "color",
    colors: "color",
    colours: "color",
    setup: "setup",
    install: "setup",
    installation: "setup",
    assembly: "setup",
    refund: "refund",
    refunds: "refund",
    refunded: "refund",
    return: "return",
    returns: "return",
    returned: "return",
  };
  return new Set(normalizeWatchIssueText(value)
    .split(" ")
    .map((token) => synonyms[token] || token.replace(/s$/, ""))
    .filter((token) => token.length > 2 && !stopWords.has(token)));
}

function countWatchSetOverlap(leftSet = new Set(), rightSet = new Set()) {
  let count = 0;
  leftSet.forEach((value) => {
    if (rightSet.has(value)) count += 1;
  });
  return count;
}

function getWatchIssueSemanticFamily(tokens = new Set()) {
  if (tokens.has("leak") && (tokens.has("seal") || tokens.has("lid") || tokens.has("spill"))) return "leak_seal";
  if (tokens.has("fit")) return "fit_sizing";
  if (tokens.has("refund")) return "refund";
  if (tokens.has("return")) return "return";
  if (tokens.has("color")) return "color";
  if (tokens.has("setup")) return "setup";
  if (tokens.has("durability")) return "durability";
  if (tokens.has("quality")) return "quality";
  return [...tokens].sort().slice(0, 2).join("|");
}

function getWatchRefundReasonTerms({ textItems = [], sourceItems = [] } = {}) {
  const terms = [];
  (Array.isArray(textItems) ? textItems : []).forEach((item) => {
    [item.reasonText, item.reason].forEach((value) => {
      if (isMeaningfulWatchRefundTerm(value)) terms.push(value);
    });
    const issueCode = normalizeWatchRefundIssueCode(item.issueCode, item);
    if (issueCode) terms.push(issueCode);
    if (!issueCode && isMeaningfulWatchRefundTerm(item.restockType)) terms.push(item.restockType);
  });
  (Array.isArray(sourceItems) ? sourceItems : []).forEach((item) => {
    [item.reasonText, item.reason].forEach((value) => {
      if (isMeaningfulWatchRefundTerm(value)) terms.push(value);
    });
    if (!terms.length && isMeaningfulWatchRefundTerm(item.restockType)) terms.push(item.restockType);
  });
  return terms;
}

function normalizeWatchRefundIssueCode(issueCode, item = {}) {
  const normalized = String(issueCode || "").trim().toLowerCase();
  if (!normalized || ["product_quality", "refund_impact", "shipping_delivery"].includes(normalized)) return "";
  if (normalized === "fit_sizing" && hasWatchCompatibilityContext(item)) return "compatibility";
  return normalized;
}

function hasWatchCompatibilityContext(item = {}) {
  const text = normalizeWatchTermForComparison([
    item.text,
    item.analysisText,
    item.noteText,
    item.reasonText,
  ].filter(Boolean).join(" "));
  return /\b(compatibility|compatible|case|ring|wallet|pop grip|popgrip|casefit)\b/.test(text)
    && /\b(boundary|outside|unsupported|supported|mismatch|gap|does not work|doesnt work|won t work|wont work)\b/.test(text);
}

function isMeaningfulWatchRefundTerm(value) {
  const normalized = normalizeWatchTermForComparison(value);
  if (!normalized) return false;
  return ![
    "refund discrepancy",
    "no restock",
    "no_restock",
    "refund impact",
    "product quality",
    "shipping delivery",
    "order level refund",
  ].includes(normalized);
}

function normalizeWatchTermForComparison(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getWatchReportHeadline(changes = [], sourceChanges = []) {
  const preferredSource = sourceChanges.find((change) => ["new-returns", "new-refunds", "new-reviews", "new-orders"].includes(change.id))
    || sourceChanges[0];
  if (preferredSource) {
    const value = [preferredSource.value, preferredSource.delta].filter(Boolean).join(" · ");
    return `${preferredSource.label}: ${value}.`;
  }
  const preferred = changes.find((change) => ["risk-score", "return-rate", "negative-reviews", "estimated-impact", "momentum-score"].includes(change.id))
    || changes[0];
  if (!preferred) return "No meaningful changes detected";
  const direction = preferred.direction === "up" ? "increased" : preferred.direction === "down" ? "decreased" : "changed";
  return `${preferred.label} ${direction} from ${preferred.from} to ${preferred.to}.`;
}

function buildWatchChangeDeterministicNarrative({ productTitle = "This product", report = {}, noChangesReused = false } = {}) {
  const hasReportedMovement = (Array.isArray(report.sourceChanges) && report.sourceChanges.length)
    || (Array.isArray(report.changes) && report.changes.length);
  if (report.status === "unchanged" || (noChangesReused && !hasReportedMovement)) {
    return `${productTitle} did not show new orders, returns, refunds, reviews or meaningful calculated Watchlist movement since the previous run. Product risk, source evidence, Estimated Margin Exposure and Sales Momentum stayed close to the last stored report.`;
  }
  if (report.status === "baseline") {
    return `${productTitle} now has a Watchlist baseline. Future runs will compare new returns, refunds, reviews, source language, product risk and Sales Momentum against this stored point.`;
  }
  const sourceChangeText = (report.sourceChanges || [])
    .slice(0, 4)
    .map((change) => `${change.label}: ${[change.value, change.delta].filter(Boolean).join(" · ")}${change.detail ? ` (${change.detail})` : ""}`)
    .join(" ");
  const calculatedContextText = (report.changes || [])
    .slice(0, 4)
    .map((change) => `${change.label} ${change.delta || "changed"}${change.from && change.to ? ` (${change.from} to ${change.to})` : ""}`)
    .join("; ");
  return [
    sourceChangeText
      ? `Since the previous Watchlist run, ${productTitle} had these concrete source changes: ${sourceChangeText}`
      : `${productTitle} had no concrete new orders, returns, refunds, reviews or product-content updates isolated since the previous Watchlist run.`,
    calculatedContextText ? `Secondary calculated context: ${calculatedContextText}.` : "",
    report.headline && !sourceChangeText ? report.headline : "",
  ].filter(Boolean).join(" ");
}

function buildWatchlistTrend(products = [], historyByProductGid = new Map(), productPulseSettings = undefined) {
  const watchedProducts = Array.isArray(products) ? products : [products].filter(Boolean);
  if (!watchedProducts.length) {
    return {
      productTitle: "No watched products",
      riskLabel: "No data",
      riskScore: null,
      series: [],
      calloutTitle: "Add a product to start watch trend tracking",
      calloutDetail: "Product risk history is stored every time ProductPulse updates a watched product.",
    };
  }

  const series = watchedProducts.map((product, index) => {
    const history = historyByProductGid instanceof Map ? historyByProductGid.get(product.productGid) || [] : [];
    const values = history
      .map((row) => ({
        riskScore: Number(row.riskScore || 0),
        recordedAt: row.recordedAt?.toISOString?.() || row.recordedAt,
        source: row.source,
        primaryIssue: row.primaryIssue || "",
      }))
      .filter((row) => Number.isFinite(row.riskScore));
    if (!values.length && Number.isFinite(Number(product.riskScore))) {
      values.push({
        riskScore: Number(product.riskScore),
        recordedAt: new Date().toISOString(),
        source: "current-snapshot",
        primaryIssue: product.latestChangeDetail || "",
      });
    }

    const latest = values[values.length - 1] || null;
    const previous = values.length > 1 ? values[values.length - 2] : null;
    const score = latest ? latest.riskScore : product.riskScore;
    const points = normalizeTrendPoints(values.map((row) => row.riskScore));
    const direction = latest && previous ? latest.riskScore - previous.riskScore : 0;
    const directionWord = direction > 0 ? "increased" : direction < 0 ? "decreased" : "stayed stable";
    return {
      productGid: product.productGid,
      productTitle: product.title,
      href: product.href,
      color: WATCH_TREND_COLORS[index % WATCH_TREND_COLORS.length],
      riskScore: Number.isFinite(Number(score)) ? Math.round(Number(score)) : null,
      riskLabel: Number.isFinite(Number(score)) ? getRiskLabelForScore(score, productPulseSettings) : "Pending",
      values,
      points,
      path: points.map((point) => `${point.x},${point.y}`).join(" "),
      latestChange: previous && latest
        ? `Risk ${directionWord} from ${previous.riskScore} to ${latest.riskScore}`
        : latest ? "Waiting for another scan to show movement" : "No score history yet",
      latestDetail: latest?.primaryIssue || product.latestChangeDetail || "Product risk history will appear as rescans run.",
    };
  });
  const scoredSeries = series.filter((item) => Number.isFinite(Number(item.riskScore)));
  const averageScore = scoredSeries.length
    ? Math.round(scoredSeries.reduce((sum, item) => sum + Number(item.riskScore || 0), 0) / scoredSeries.length)
    : null;
  const highestSeries = scoredSeries.reduce((highest, item) => (
    !highest || Number(item.riskScore || 0) > Number(highest.riskScore || 0) ? item : highest
  ), null);

  return {
    productTitle: `${watchedProducts.length} watched product${watchedProducts.length === 1 ? "" : "s"}`,
    riskScore: averageScore,
    riskLabel: Number.isFinite(Number(averageScore)) ? getRiskLabelForScore(averageScore, productPulseSettings) : "No data",
    series,
    calloutTitle: highestSeries
      ? `${highestSeries.productTitle} is currently highest at ${highestSeries.riskScore}/100`
      : "Waiting for score history",
    calloutDetail: "Each line shows saved risk score movement for one watched product after Catalog Scan or Product Diagnosis.",
  };
}

function normalizeTrendPoints(values = []) {
  if (!values.length) return [];
  if (values.length === 1) {
    const y = 100 - Math.max(0, Math.min(100, Number(values[0] || 0)));
    return [{ x: 0, y }, { x: 100, y }];
  }
  return values.map((value, index) => ({
    x: (index / (values.length - 1)) * 100,
    y: 100 - Math.max(0, Math.min(100, Number(value || 0))),
  }));
}

function groupActivitiesByDay(activities = []) {
  return activities.reduce((groups, activity) => {
    const day = formatActivityDay(activity.createdAt);
    const existing = groups.find((group) => group.day === day);
    if (existing) existing.items.push(activity);
    else groups.push({ day, items: [activity] });
    return groups;
  }, []);
}

function formatActivityDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent activity";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function getActivityIcon(eventType) {
  if (eventType === "product_added") return "plus";
  if (eventType === "product_removed") return "x";
  if (eventType === "product_paused") return "pause";
  if (eventType === "product_resumed") return "play";
  if (eventType === "all_watches_paused") return "pause";
  if (eventType === "all_watches_resumed") return "play";
  if (eventType === "diagnosis_completed") return "wand";
  if (eventType === WATCH_CHANGE_REPORT_EVENT) return "chart-line";
  if (eventType === "watch_baseline_captured") return "flag";
  if (eventType === "watch_scan_completed") return "refresh";
  if (eventType === "watch_scan_queued") return "play";
  if (eventType === "watch_manual_scan_queued") return "play";
  if (eventType === "watch_cron_credit_exhausted" || eventType === "watch_manual_scan_credit_exhausted") return "alert-triangle";
  if (eventType === "settings_changed") return "settings";
  if (eventType === "alert_sent" || eventType === "watch_alert_sent") return "email";
  if (eventType === "watch_alert_skipped") return "info";
  if (eventType === "watch_alert_failed") return "alert-triangle";
  return "info";
}

function getActivityTone(eventType, metadata = {}) {
  if (eventType === "product_removed") return "slate";
  if (eventType === "product_paused") return "purple";
  if (eventType === "product_resumed") return "green";
  if (eventType === "all_watches_paused") return "purple";
  if (eventType === "all_watches_resumed") return "green";
  if (eventType === "product_added") return "blue";
  if (eventType === "diagnosis_completed") return "purple";
  if (eventType === "watch_baseline_captured") return "blue";
  if (eventType === WATCH_CHANGE_REPORT_EVENT) {
    const status = metadata.report?.status || "";
    if (status === "unchanged") return "green";
    if (status === "baseline") return "blue";
    return "orange";
  }
  if (eventType === "watch_scan_queued") return "blue";
  if (eventType === "watch_manual_scan_queued") return "purple";
  if (eventType === "watch_cron_credit_exhausted" || eventType === "watch_manual_scan_credit_exhausted") return "orange";
  if (eventType === "watch_alert_sent") return "green";
  if (eventType === "watch_alert_skipped") return "blue";
  if (eventType === "watch_alert_failed") return "red";
  if (eventType === "watch_scan_completed") {
    const riskScore = Number(metadata.riskScore || 0);
    if (riskScore >= 75) return "red";
    if (riskScore >= 55) return "orange";
    return "green";
  }
  return "blue";
}

function formatWatchSettings(settings = {}) {
  const scanCadenceDays = normalizeCadenceDays(settings.scanCadenceDays);
  const triggerRule = normalizeOptionValue(settings.triggerRule, WATCH_TRIGGER_RULE_OPTIONS, DEFAULT_WATCH_SETTINGS.triggerRule);
  const summarySchedule = normalizeOptionValue(settings.summarySchedule, WATCH_SUMMARY_OPTIONS, DEFAULT_WATCH_SETTINGS.summarySchedule);
  const alertRecipients = normalizeRecipientList(settings.alertRecipients);
  return {
    scanCadenceDays,
    scanCadenceValue: String(scanCadenceDays),
    scanCadenceLabel: getCadenceLabel(scanCadenceDays),
    alertRecipients,
    alertRecipientsText: alertRecipients.join(", "),
    alertRecipientCount: alertRecipients.length,
    triggerRule,
    triggerRuleLabel: getTriggerRuleLabel(triggerRule),
    summarySchedule,
    summaryScheduleLabel: getSummaryLabel(summarySchedule),
    alertsEnabled: settings.alertsEnabled !== false,
    options: {
      cadence: WATCH_SCAN_CADENCE_OPTIONS,
      triggerRules: WATCH_TRIGGER_RULE_OPTIONS,
      summaries: WATCH_SUMMARY_OPTIONS,
    },
  };
}

function normalizeCadenceDays(value) {
  const number = Number(value || DEFAULT_WATCH_SETTINGS.scanCadenceDays);
  const optionValues = new Set(WATCH_SCAN_CADENCE_OPTIONS.map((option) => Number(option.value)));
  return optionValues.has(number) ? number : DEFAULT_WATCH_SETTINGS.scanCadenceDays;
}

function normalizeOptionValue(value, options, fallback) {
  const normalized = String(value || "").trim();
  return options.some((option) => option.value === normalized) ? normalized : fallback;
}

function normalizeRecipientList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return [];
}

function normalizeDefaultAlertRecipients(value) {
  const rawRecipients = Array.isArray(value) ? value.join(",") : String(value || "");
  return parseAlertRecipients(rawRecipients).valid;
}

function parseAlertRecipients(value) {
  const parts = String(value || "")
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  parts.forEach((email) => {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) valid.push(email);
    else invalid.push(email);
  });
  return {
    valid: Array.from(new Set(valid)),
    invalid,
  };
}

function getCadenceLabel(days) {
  return WATCH_SCAN_CADENCE_OPTIONS.find((option) => Number(option.value) === Number(days))?.label || "Every 3 days";
}

function getTriggerRuleLabel(value) {
  return WATCH_TRIGGER_RULE_OPTIONS.find((option) => option.value === value)?.label || "Notify on new issues or rising risk";
}

function getSummaryLabel(value) {
  return WATCH_SUMMARY_OPTIONS.find((option) => option.value === value)?.label || "Daily digest at 8:00 AM";
}

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

async function findWatchlistEligibleSearchProductGids(shop, query = "") {
  const normalizedQuery = String(query || "").trim();
  const productSearchWhere = normalizedQuery
    ? {
        OR: [
          { productTitle: { contains: normalizedQuery, mode: "insensitive" } },
          { handle: { contains: normalizedQuery, mode: "insensitive" } },
          { productGid: { contains: normalizedQuery } },
        ],
      }
    : {};
  const diagnosisSearchWhere = normalizedQuery
    ? {
        OR: [
          { productTitle: { contains: normalizedQuery, mode: "insensitive" } },
          { productGid: { contains: normalizedQuery } },
        ],
      }
    : {};

  const [snapshots, diagnoses] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop, ...productSearchWhere },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
      select: { productGid: true },
      take: normalizedQuery ? 200 : 300,
    }),
    prisma.productDiagnosis.findMany({
      where: { shop, status: "Completed", ...diagnosisSearchWhere },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: { productGid: true },
      take: normalizedQuery ? 200 : 300,
    }),
  ]);

  return Array.from(new Set([
    ...snapshots.map((snapshot) => snapshot.productGid),
    ...diagnoses.map((diagnosis) => diagnosis.productGid),
  ].filter(Boolean)));
}

async function getWatchlistEligibleProductForShop(shop, productGid) {
  const normalizedProductGid = String(productGid || "").trim();
  if (!shop || !normalizedProductGid) {
    return { eligible: false, reason: "missing_product_gid", product: null };
  }

  const eligibleByProductGid = await getWatchlistEligibleProductsByGid(shop, [normalizedProductGid]);
  const product = eligibleByProductGid.get(normalizedProductGid) || null;
  if (product) return { eligible: true, reason: "completed_product_diagnosis", product };

  const [snapshot, diagnosis] = await Promise.all([
    prisma.productRiskSnapshot.findUnique({
      where: { shop_productGid: { shop, productGid: normalizedProductGid } },
      select: { id: true },
    }),
    prisma.productDiagnosis.findFirst({
      where: { shop, productGid: normalizedProductGid, status: "Completed" },
      select: { id: true },
    }),
  ]);

  return {
    eligible: false,
    reason: !diagnosis ? "missing_completed_product_diagnosis" : !snapshot ? "missing_product_risk_snapshot" : "unknown",
    product: null,
  };
}

async function getWatchlistEligibleProductsByGid(shop, productGids = []) {
  const uniqueProductGids = Array.from(new Set((Array.isArray(productGids) ? productGids : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!shop || !uniqueProductGids.length) return new Map();

  const [snapshots, diagnoses] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop, productGid: { in: uniqueProductGids } },
    }),
    prisma.productDiagnosis.findMany({
      where: { shop, productGid: { in: uniqueProductGids }, status: "Completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const latestDiagnosisByProductGid = new Map();
  diagnoses.forEach((diagnosis) => {
    if (diagnosis.productGid && !latestDiagnosisByProductGid.has(diagnosis.productGid)) {
      latestDiagnosisByProductGid.set(diagnosis.productGid, diagnosis);
    }
  });

  const snapshotByProductGid = new Map(snapshots.map((snapshot) => [snapshot.productGid, snapshot]));

  return new Map(uniqueProductGids
    .map((productGid) => {
      const diagnosis = latestDiagnosisByProductGid.get(productGid);
      if (!diagnosis) return null;
      return [productGid, formatWatchlistEligibleProductSearchResult(snapshotByProductGid.get(productGid), diagnosis)];
    })
    .filter(Boolean));
}

function formatWatchlistEligibleProductSearchResult(snapshot = {}, diagnosis = {}) {
  const metrics = snapshot?.metrics || diagnosis?.metrics || {};
  const productMomentum = metrics.productMomentum || {};
  const imageUrl = firstString(metrics.productImageUrl, metrics.imageUrl, metrics.featuredImageUrl);
  const productTitle = snapshot?.productTitle || diagnosis?.productTitle || "Shopify product";
  const productGid = snapshot?.productGid || diagnosis?.productGid || "";
  const imageAlt = firstString(metrics.productImageAlt, metrics.imageAlt, productTitle);
  const sku = firstString(
    metrics.sku,
    Array.isArray(metrics.variants) ? metrics.variants.find((variant) => variant?.sku)?.sku : "",
    Array.isArray(metrics.affectedVariantDetails) ? metrics.affectedVariantDetails.find((variant) => variant?.sku)?.sku : "",
  );
  return {
    id: productGid,
    productGid,
    title: productTitle,
    handle: snapshot?.handle || metrics.handle || metrics.productHandle || "",
    status: "Product Diagnosis completed",
    vendor: metrics.vendor || "",
    productType: metrics.productType || metrics.categoryName || "",
    sku,
    collection: Array.isArray(metrics.collections) ? metrics.collections[0] || "" : "",
    detail: [
      `Risk ${clampRoundNumber(snapshot?.riskScore ?? diagnosis?.riskScore, 0, 100)}`,
      Number.isFinite(Number(productMomentum.score)) ? `Momentum ${Math.round(Number(productMomentum.score))}` : "",
      diagnosis.completedAt ? `Completed ${formatWatchDate(diagnosis.completedAt)}` : "",
    ].filter(Boolean).join(" - "),
    imageUrl: imageUrl || null,
    imageAlt: imageAlt || null,
    variant: "default",
    existingSnapshot: Boolean(snapshot?.id),
    productPulseStatus: "full",
    productPulseStatusLabel: "Product Diagnosis completed",
    productPulseStatusDetail: "This product has a completed Product Diagnosis and can be added to Watchlist.",
    href: snapshot?.handle ? `/app/products/${snapshot.handle}` : `/app/products/${encodeURIComponent(productGid || "")}`,
    riskScore: clampRoundNumber(snapshot?.riskScore ?? diagnosis?.riskScore, 0, 100),
    productMomentumScore: Number(productMomentum.score || metrics.productMomentumScore || 0),
    latestDiagnosisId: diagnosis.id || metrics.latestDiagnosisId || "",
    analysisDepth: "full",
  };
}

function productMatchesWatchlistEligibleSearch(product = {}, query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    product.title,
    product.handle,
    product.productGid,
    product.id,
    product.sku,
    product.vendor,
    product.productType,
  ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function compareWatchlistEligibleProducts(first = {}, second = {}) {
  const firstPriority = Math.max(Number(first.riskScore || 0), Number(first.productMomentumScore || 0));
  const secondPriority = Math.max(Number(second.riskScore || 0), Number(second.productMomentumScore || 0));
  if (secondPriority !== firstPriority) return secondPriority - firstPriority;
  return String(first.title || "").localeCompare(String(second.title || ""));
}

function normalizeBulkWatchlistProducts(products = []) {
  const byProductGid = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const productGid = String(product?.productGid || product?.id || "").trim();
    if (!productGid || byProductGid.has(productGid)) return;
    byProductGid.set(productGid, {
      productGid,
      title: String(product?.title || "Shopify product").trim() || "Shopify product",
      handle: String(product?.handle || "").trim(),
      sku: String(product?.sku || "").trim(),
      imageUrl: String(product?.imageUrl || "").trim(),
      imageAlt: String(product?.imageAlt || product?.title || "").trim(),
    });
  });
  return Array.from(byProductGid.values());
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

function normalizeWatchAnalysisItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object" && String(item.key || "").trim())
    .map((item) => ({
      key: String(item.key),
      source: String(item.source || ""),
      sourceLabel: String(item.sourceLabel || ""),
      text: String(item.text || item.analysisText || "").trim(),
      analysisText: String(item.analysisText || item.text || "").trim(),
      reason: String(item.reason || "").trim(),
      reasonText: String(item.reasonText || "").trim(),
      noteText: String(item.noteText || "").trim(),
      restockType: String(item.restockType || "").trim(),
      issueCode: String(item.issueCode || "").trim(),
      sentiment: ["positive", "neutral", "negative"].includes(item.sentiment) ? item.sentiment : "neutral",
      emotion: String(item.emotion || "none"),
      rating: Number(item.rating || 0),
      quantity: Number(item.quantity || 1),
      amount: Number(item.amount || 0),
      variant: String(item.variant || "").trim(),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || item.createdAt || null,
    }))
    .sort((a, b) => new Date(a.createdAt || a.updatedAt || 0).getTime() - new Date(b.createdAt || b.updatedAt || 0).getTime());
}

function normalizeWatchSourceEvents(items = [], type = "source") {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const key = String(item.key || item.cacheKey || item.id || item.returnId || item.refundId || item.orderId || "").trim();
      if (!key) return null;
      return {
        key,
        source: type,
        id: item.id || null,
        orderId: item.orderId || null,
        returnId: item.returnId || null,
        refundId: item.refundId || null,
        title: String(item.title || "").trim(),
        sku: String(item.sku || "").trim(),
        variant: String(item.variant || item.variantTitle || "").trim(),
        quantity: Number(item.quantity || item.processedQuantity || item.refundedQuantity || 0),
        amount: Number(item.amount || item.totalRefundedAmount || 0),
        reason: String(item.reasonLabel || item.reason || item.restockType || "").trim(),
        reasonText: String(item.reasonNote || item.customerNote || item.note || item.reasonLabel || item.reason || "").trim(),
        noteText: String(item.note || item.reasonNote || item.customerNote || "").trim(),
        restockType: String(item.restockType || "").trim(),
        country: String(item.country || "").trim(),
        province: String(item.province || "").trim(),
        city: String(item.city || "").trim(),
        createdAt: item.createdAt || item.processedAt || item.orderDate || item.orderProcessedAt || item.updatedAt || null,
        updatedAt: item.updatedAt || item.processedAt || item.createdAt || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.createdAt || a.updatedAt || 0).getTime() - new Date(b.createdAt || b.updatedAt || 0).getTime());
}

function trimWatchEvidenceItem(item = {}) {
  return {
    key: item.key,
    source: item.source,
    sourceLabel: item.sourceLabel,
    text: truncateWatchText(item.text || item.analysisText || "", 240),
    reason: item.reason,
    reasonText: item.reasonText,
    noteText: truncateWatchText(item.noteText || "", 180),
    restockType: item.restockType,
    issueCode: item.issueCode,
    sentiment: item.sentiment,
    emotion: item.emotion,
    rating: item.rating,
    quantity: item.quantity,
    amount: item.amount,
    variant: item.variant,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function trimWatchSourceEventItem(item = {}) {
  return {
    key: item.key,
    source: item.source,
    id: item.id,
    orderId: item.orderId,
    returnId: item.returnId,
    refundId: item.refundId,
    title: truncateWatchText(item.title || "", 140),
    sku: item.sku,
    variant: truncateWatchText(item.variant || "", 120),
    quantity: Number(item.quantity || 0),
    amount: roundMoney(item.amount),
    reason: truncateWatchText(item.reason || "", 140),
    reasonText: truncateWatchText(item.reasonText || "", 220),
    noteText: truncateWatchText(item.noteText || "", 220),
    restockType: item.restockType,
    country: item.country,
    province: item.province,
    city: item.city,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeWatchCountRows(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (typeof item === "string") return { label: item, count: 1 };
      return {
        label: String(item?.label || item?.term || item?.reason || item?.issue || item?.issueCode || "").trim(),
        count: Number(item?.count || item?.value || 1),
      };
    })
    .filter((item) => item.label)
    .slice(0, 12);
}

function normalizeWatchSentiment(sentiment = {}) {
  return {
    total: clampRoundNumber(firstNumber(sentiment.total)),
    negative: clampRoundNumber(firstNumber(sentiment.negative)),
    neutral: clampRoundNumber(firstNumber(sentiment.neutral)),
    positive: clampRoundNumber(firstNumber(sentiment.positive)),
    dominant: firstString(sentiment.dominant),
  };
}

function getNewWatchEvidenceItems(previousItems = [], currentItems = [], { sinceAt = null } = {}) {
  const previousList = Array.isArray(previousItems) ? previousItems : [];
  const previousKeys = new Set(previousList.map((item) => item?.key).filter(Boolean));
  const previousFingerprints = new Set(previousList.map(getWatchEvidenceStableFingerprint).filter(Boolean));
  const hasPreviousItemBaseline = previousKeys.size > 0 || previousFingerprints.size > 0;
  const cutoff = parseWatchDate(sinceAt);

  return (Array.isArray(currentItems) ? currentItems : []).filter((item) => {
    if (!item?.key || previousKeys.has(item.key)) return false;
    const fingerprint = getWatchEvidenceStableFingerprint(item);
    if (fingerprint && previousFingerprints.has(fingerprint)) return false;
    if (hasPreviousItemBaseline) return true;

    const itemDate = parseWatchDate(item.createdAt || item.updatedAt || item.processedAt || item.date);
    if (cutoff) {
      if (!itemDate) return false;
      return itemDate.getTime() > cutoff.getTime();
    }

    return hasPreviousItemBaseline;
  });
}

function getWatchEvidenceStableFingerprint(item = {}) {
  if (!item || typeof item !== "object") return "";
  const source = normalizeWatchFingerprintText(item.source || item.sourceLabel);
  const text = normalizeWatchFingerprintText(item.text || item.analysisText || item.noteText || item.reasonText);
  const reason = normalizeWatchFingerprintText(item.reason || item.issueCode || item.restockType);
  if (!text && !reason) return "";
  const reviewLike = source.includes("review") || Number(item.rating || 0) > 0;
  return [
    source,
    text,
    reason,
    Number(item.rating || 0) || "",
    reviewLike && text ? "" : normalizeWatchFingerprintDate(item.createdAt || item.updatedAt || item.processedAt || item.date),
  ].join("|");
}

function normalizeWatchFingerprintText(value = "") {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeWatchFingerprintDate(value = "") {
  const date = parseWatchDate(value);
  return date ? date.toISOString() : "";
}

function summarizeWatchEvidenceItems(items = []) {
  const summary = { total: 0, negative: 0, neutral: 0, positive: 0 };
  (Array.isArray(items) ? items : []).forEach((item) => {
    const sentiment = ["positive", "negative", "neutral"].includes(item?.sentiment) ? item.sentiment : "neutral";
    summary.total += 1;
    summary[sentiment] += 1;
  });
  return summary;
}

function countWatchTerms(values = []) {
  const counts = new Map();
  values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .forEach((value) => {
      const label = humanizeWatchLabel(value);
      if (!label) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function extractWatchRepeatedLanguage(items = []) {
  const stopWords = new Set(["the", "and", "for", "that", "this", "with", "from", "was", "were", "are", "but", "not", "you", "your", "they", "them", "have", "has", "had", "other", "reason", "return", "refund", "product"]);
  const counts = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    String(item?.analysisText || item?.text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 3 && !stopWords.has(word))
      .forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  });
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6);
}

function formatWatchCountList(items = [], limit = 4) {
  return (Array.isArray(items) ? items : [])
    .slice(0, limit)
    .map((item) => `${item.label}${Number(item.count || 0) > 1 ? ` (${item.count})` : ""}`)
    .join(", ");
}

function summarizeWatchVariants(items = []) {
  const variants = countWatchTerms((Array.isArray(items) ? items : [])
    .map((item) => item?.variant || item?.sku || item?.title)
    .filter(Boolean));
  return variants.length ? `New activity by variant/SKU: ${formatWatchCountList(variants, 3)}.` : "";
}

function summarizeWatchGeography(items = []) {
  const places = countWatchTerms(getWatchUniqueOrderItems(items)
    .map((item) => [item?.city, item?.province, item?.country].filter(Boolean).join(", "))
    .filter(Boolean));
  return places.length ? `New order geography: ${formatWatchCountList(places, 3)}.` : "";
}

function sumWatchItemNumbers(items = [], key) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => total + Number(item?.[key] || 0), 0);
}

function countWatchUniqueOrders(items = []) {
  return getWatchUniqueOrderItems(items).length;
}

function getWatchUniqueOrderItems(items = []) {
  const orderIds = new Set();
  const uniqueItems = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const orderId = String(item?.orderId || "").trim();
    if (orderId) {
      if (orderIds.has(orderId)) return;
      orderIds.add(orderId);
      uniqueItems.push(item);
    } else if (item?.key || item?.id) {
      uniqueItems.push(item);
    }
  });
  return uniqueItems;
}

function humanizeWatchLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function truncateWatchText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function findWatchNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function watchNumberDelta(previous, current) {
  return Number.isFinite(previous) && Number.isFinite(current) ? current - previous : 0;
}

function firstString(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function clampRoundNumber(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.max(min, Math.min(max, number)));
}

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeRatePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const percent = Math.abs(number) <= 1 && number !== 0 ? number * 100 : number;
  return Math.round(percent * 10) / 10;
}

function formatNumberWithSuffix(value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return suffix ? `0${suffix}` : "0";
  const rounded = Math.abs(number) >= 10 ? Math.round(number) : Math.round(number * 10) / 10;
  return `${rounded}${suffix}`;
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$0";
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  const formatted = absolute >= 1000
    ? Math.round(absolute).toLocaleString("en-US")
    : (Math.round(absolute * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${sign}$${formatted}`;
}

function toWatchIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function parseWatchDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWatchDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatWatchTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export const __productPulseWatchlistTestHooks = {
  buildWatchChangeReport,
  buildWatchlistTrend,
  formatWatchlistRow,
  getWatchScanActivityEventSpec,
  getNewWatchEvidenceItems,
  normalizeStoredWatchChangeReport,
};
