import prisma from "../db.server";
import { generateWatchChangeReportNarrative } from "./product-pulse-ai.server";
import { getProductScoreHistoryForProductsForShop } from "./product-pulse-history.server";
import { getProductPulseSettings, getRiskLabelForScore, getRiskToneForScore } from "./product-pulse-settings.server";

export const WATCHLIST_MAX_PRODUCTS = 50;
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

export async function getWatchlistForShop(shop) {
  const items = await prisma.productWatchlistItem.findMany({
    where: { shop },
    orderBy: { addedAt: "asc" },
  });
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
  const [activities, trendHistoryByProductGid, activityStats, settings] = await Promise.all([
    getWatchActivityRowsForShop(shop, { take: 5 }),
    productGids.length ? getProductScoreHistoryForProductsForShop(shop, productGids, { take: 80 }) : new Map(),
    getWatchActivityStatsForShop(shop, productPulseSettings),
    getWatchSettingsForShop(shop),
  ]);

  return {
    maxProducts: WATCHLIST_MAX_PRODUCTS,
    watchedCount,
    slotsAvailable: Math.max(0, WATCHLIST_MAX_PRODUCTS - watchedCount),
    rows,
    activities,
    trend: buildWatchlistTrend(rows, trendHistoryByProductGid, productPulseSettings),
    settings,
    mock: getWatchlistOverviewSections({ rows, activities, activityStats, settings }),
  };
}

export async function getWatchSettingsForShop(shop) {
  const settings = await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays: DEFAULT_WATCH_SETTINGS.scanCadenceDays,
      alertRecipients: DEFAULT_WATCH_SETTINGS.alertRecipients,
      triggerRule: DEFAULT_WATCH_SETTINGS.triggerRule,
      summarySchedule: DEFAULT_WATCH_SETTINGS.summarySchedule,
      alertsEnabled: DEFAULT_WATCH_SETTINGS.alertsEnabled,
    },
    update: {},
  });
  return formatWatchSettings(settings);
}

export async function updateWatchSettingsForShop(shop, formData) {
  const scanCadenceDays = normalizeCadenceDays(formData.get("scanCadenceDays"));
  const triggerRule = normalizeOptionValue(formData.get("triggerRule"), WATCH_TRIGGER_RULE_OPTIONS, DEFAULT_WATCH_SETTINGS.triggerRule);
  const summarySchedule = normalizeOptionValue(formData.get("summarySchedule"), WATCH_SUMMARY_OPTIONS, DEFAULT_WATCH_SETTINGS.summarySchedule);
  const alertsEnabled = String(formData.get("alertsEnabled") || "") === "on";
  const recipients = parseAlertRecipients(String(formData.get("alertRecipients") || ""));
  if (recipients.invalid.length) {
    return {
      status: "validation_error",
      message: `Invalid alert recipient${recipients.invalid.length === 1 ? "" : "s"}: ${recipients.invalid.join(", ")}`,
    };
  }

  const settings = await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays,
      alertRecipients: recipients.valid,
      triggerRule,
      summarySchedule,
      alertsEnabled,
    },
    update: {
      scanCadenceDays,
      alertRecipients: recipients.valid,
      triggerRule,
      summarySchedule,
      alertsEnabled,
    },
  });
  await recordWatchActivityForShop(shop, {
    eventType: "settings_changed",
    title: "Watch settings updated",
    detail: `${getCadenceLabel(scanCadenceDays)} · ${getTriggerRuleLabel(triggerRule)}`,
    metadata: { scanCadenceDays, triggerRule, summarySchedule, alertsEnabled, recipients: recipients.valid.length },
  });

  return {
    status: "success",
    message: "Watch settings updated.",
    action: { id: "update-watch-settings" },
    settings: formatWatchSettings(settings),
  };
}

export async function toggleWatchAlertsForShop(shop) {
  const current = await prisma.productWatchSettings.upsert({
    where: { shop },
    create: {
      shop,
      scanCadenceDays: DEFAULT_WATCH_SETTINGS.scanCadenceDays,
      alertRecipients: DEFAULT_WATCH_SETTINGS.alertRecipients,
      triggerRule: DEFAULT_WATCH_SETTINGS.triggerRule,
      summarySchedule: DEFAULT_WATCH_SETTINGS.summarySchedule,
      alertsEnabled: DEFAULT_WATCH_SETTINGS.alertsEnabled,
    },
    update: {},
  });
  const settings = await prisma.productWatchSettings.update({
    where: { shop },
    data: { alertsEnabled: !current.alertsEnabled },
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

export async function addWatchedProductForShop(shop, product = {}) {
  const productGid = String(product.productGid || product.id || "").trim();
  if (!productGid) {
    return { status: "validation_error", message: "Select a Shopify product to add to the watchlist." };
  }

  const existing = await prisma.productWatchlistItem.findUnique({
    where: { shop_productGid: { shop, productGid } },
  });
  if (existing) {
    return {
      status: "success",
      message: `${existing.productTitle} is already on the watchlist.`,
      action: { id: "add-watched-product" },
      suppressBanner: true,
    };
  }

  const watchedCount = await prisma.productWatchlistItem.count({ where: { shop } });
  if (watchedCount >= WATCHLIST_MAX_PRODUCTS) {
    return {
      status: "validation_error",
      message: `Watchlist is full. Remove a watched product before adding another one.`,
    };
  }

  const item = await prisma.productWatchlistItem.create({
    data: {
      shop,
      productGid,
      productTitle: String(product.title || "Shopify product").trim() || "Shopify product",
      handle: optionalString(product.handle),
      sku: optionalString(product.sku),
      status: "Watching",
      imageUrl: optionalString(product.imageUrl),
      imageAlt: optionalString(product.imageAlt),
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

  return {
    status: "success",
    message: `${item.productTitle} added to the watchlist.`,
    action: { id: "add-watched-product", productGid: item.productGid },
    watchedCount: watchedCount + 1,
  };
}

export async function addWatchedProductsForShop(shop, products = []) {
  const normalizedProducts = normalizeBulkWatchlistProducts(products);
  if (!normalizedProducts.length) {
    return { status: "validation_error", message: "Select at least one product to add to the watchlist." };
  }

  const productGids = normalizedProducts.map((product) => product.productGid);
  const [existingItems, watchedCount] = await Promise.all([
    prisma.productWatchlistItem.findMany({
      where: { shop, productGid: { in: productGids } },
      select: { productGid: true, productTitle: true },
    }),
    prisma.productWatchlistItem.count({ where: { shop } }),
  ]);
  const existingProductGids = new Set(existingItems.map((item) => item.productGid));
  const candidates = normalizedProducts.filter((product) => !existingProductGids.has(product.productGid));
  const existingCount = normalizedProducts.length - candidates.length;
  const slotsAvailable = Math.max(0, WATCHLIST_MAX_PRODUCTS - watchedCount);

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

  if (slotsAvailable <= 0) {
    return {
      status: "validation_error",
      message: "Watchlist is full. Remove a watched product before adding selected products.",
      action: { id: "add-watched-products" },
    };
  }

  const productsToCreate = candidates.slice(0, slotsAvailable);
  const skippedForCapacity = Math.max(0, candidates.length - productsToCreate.length);
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
    await prisma.productWatchActivity.createMany({
      data: createdItems.map((item) => ({
        shop,
        productGid: item.productGid,
        productTitle: item.productTitle,
        watchlistItemId: item.id,
        eventType: "product_added",
        title: "Product added to watchlist",
        detail: item.productTitle,
        metadata: { handle: item.handle, sku: item.sku, bulk: true },
      })),
    });
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

export async function getActiveWatchedProductsForShop(shop) {
  if (!shop) return [];
  return prisma.productWatchlistItem.findMany({
    where: { shop, status: { not: "Paused" } },
    orderBy: { addedAt: "asc" },
    select: {
      id: true,
      productGid: true,
      productTitle: true,
      handle: true,
      sku: true,
    },
  });
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
  return prisma.productWatchActivity.create({
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
}

export async function recordWatchlistScanActivities(shop, snapshots = [], { source = "quickscan", noChangesReused = false, jobId = null } = {}) {
  const productGids = Array.from(new Set(snapshots.map((snapshot) => snapshot?.productGid).filter(Boolean)));
  if (!shop || !productGids.length) return { count: 0 };
  const [watchedItems, productPulseSettings, previousReports] = await Promise.all([
    prisma.productWatchlistItem.findMany({
      where: { shop, productGid: { in: productGids }, status: { not: "Paused" } },
    }),
    getProductPulseSettings(shop),
    source === "full-diagnosis"
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
  const now = new Date();
  const reportRows = [];
  if (source === "full-diagnosis") {
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
      return {
        shop,
        productGid: snapshot.productGid,
        productTitle: snapshot.productTitle || item.productTitle,
        watchlistItemId: item.id,
        eventType: source === "full-diagnosis" ? "diagnosis_completed" : "watch_scan_completed",
        title: source === "full-diagnosis"
          ? noChangesReused ? "Product diagnosis reused" : "Product diagnosis completed"
          : "Watch scan updated product risk",
        detail: noChangesReused
          ? `No source changes detected · ${riskLabel} risk (${riskScore}/100)`
          : `${riskLabel} risk (${riskScore}/100) · ${snapshot.primaryIssue || "No primary issue"}`,
        metadata: {
          source,
          noChangesReused,
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
  return prisma.productWatchActivity.createMany({ data: activityRows });
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
    riskScore,
    riskLabel,
    riskTone,
    latestChange: hasSnapshot ? "Watch signal captured" : "Awaiting first scan",
    latestChangeDetail: hasSnapshot ? snapshot.primaryIssue || "Product quality signal detected" : "This product will be scanned on the next watch run.",
    latestChangeTone: hasSnapshot ? (riskTone === "critical" ? "red" : riskTone === "warning" ? "orange" : "green") : "slate",
    lastIssue: hasSnapshot ? `Updated ${formatWatchDate(updatedAt)}` : "Not scanned yet",
    lastIssueDetail: hasSnapshot ? formatWatchTimestamp(updatedAt) : "Waiting for automatic watch cadence",
    addedAt: formatWatchDate(item.addedAt),
    latestChangeReport,
    diagnosisJob: activeDiagnosisJob ? formatWatchlistDiagnosisJob(activeDiagnosisJob) : null,
  };
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

async function getWatchActivityRowsForShop(shop, { take = 5 } = {}) {
  const activities = await prisma.productWatchActivity.findMany({
    where: { shop, eventType: { not: "watch_order_changed" } },
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
    take: productGids.length * 8,
  });
  const byProductGid = new Map();
  reports.forEach((activity) => {
    if (activity.productGid && !byProductGid.has(activity.productGid)) {
      byProductGid.set(activity.productGid, formatWatchChangeReportActivity(activity));
    }
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
  const report = metadata.report || {};
  return {
    id: activity.id,
    productGid: activity.productGid || "",
    productTitle: activity.productTitle || "",
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
  const current = buildWatchSnapshotSummary(snapshot, productPulseSettings, createdAt);
  const previous = previousSummary || previousReport?.current || null;
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
      narrative: "No previous Watchlist data existed for this product. ProductPulse captured the current diagnosis as the baseline; future Watchlist runs will compare new returns, refunds, reviews, product risk, momentum and evidence against this stored point.",
      sourceChanges: [],
      sourceInsights: [],
      sections: [],
      changes: [],
    };
  }

  const sourceChanges = buildWatchSourceChangeCards(previous, current);
  const sourceInsights = buildWatchEvidenceChangeInsights(previous, current);
  const sections = [
    buildRiskChangeSection(previous, current),
    buildEvidenceChangeSection(previous, current),
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
    narrative: buildWatchChangeDeterministicNarrative({ report: { status, headline, sourceChanges, sourceInsights, changes, current, previous } }),
    sourceChanges,
    sourceInsights,
    sections: status === "unchanged" ? [] : sections,
    changes,
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
      totalOrders: clampRoundNumber(firstNumber(metrics.orderCount, monthlySummary.totalOrders, orderItems.length)),
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

function buildWatchOrderSourceChange(previous, current, previousOrders = {}, currentOrders = {}) {
  const newItems = getNewWatchEvidenceItems(previousOrders.items, currentOrders.items, { sinceAt: previous?.capturedAt });
  const orderDelta = watchNumberDelta(findWatchNumber(previous?.orderCount, previousOrders.totalOrders), findWatchNumber(current?.orderCount, currentOrders.totalOrders));
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.soldUnits, previousOrders.totalUnits), findWatchNumber(current?.soldUnits, currentOrders.totalUnits));
  const revenueDelta = watchNumberDelta(findWatchNumber(previous?.salesAmount, previousOrders.totalRevenue), findWatchNumber(current?.salesAmount, currentOrders.totalRevenue));
  const newOrderCount = newItems.length || Math.max(0, Math.round(orderDelta));
  const newUnits = sumWatchItemNumbers(newItems, "quantity") || Math.max(0, Math.round(unitDelta));
  const newRevenue = roundMoney(sumWatchItemNumbers(newItems, "amount") || Math.max(0, revenueDelta));
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

function buildWatchReturnSourceChange(previous, current, previousReturns = {}, currentReturns = {}) {
  const newSourceItems = getNewWatchEvidenceItems(previousReturns.sourceItems, currentReturns.sourceItems, { sinceAt: previous?.capturedAt });
  const newTextItems = getNewWatchEvidenceItems(previousReturns.items, currentReturns.items, { sinceAt: previous?.capturedAt });
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.returnUnits, previousReturns.totalUnits), findWatchNumber(current?.returnUnits, currentReturns.totalUnits));
  const newUnits = sumWatchItemNumbers(newSourceItems, "quantity") || sumWatchItemNumbers(newTextItems, "quantity") || Math.max(0, Math.round(unitDelta));
  const newCount = newSourceItems.length || newTextItems.length || (newUnits ? 1 : 0);
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
  const newUnits = sumWatchItemNumbers(newSourceItems, "quantity") || sumWatchItemNumbers(newTextItems, "quantity") || Math.max(0, Math.round(unitDelta));
  const newAmount = roundMoney(sumWatchItemNumbers(newSourceItems, "amount") || Math.max(0, amountDelta));
  const newCount = newSourceItems.length || newTextItems.length || (newUnits ? 1 : 0);
  if (!newCount && !newUnits && newAmount < 1) return null;
  const sentiment = summarizeWatchEvidenceItems(newTextItems);
  const reasons = countWatchTerms([
    ...newSourceItems.flatMap((item) => [item.reasonText, item.reason, item.restockType]),
    ...newTextItems.flatMap((item) => [item.reasonText, item.reason, item.restockType, item.issueCode]),
  ].filter(Boolean));
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
  const newCount = newItems.length || Math.max(0, Math.round(reviewDelta));
  if (!newCount && Math.abs(ratingDelta) < 0.1 && !negativeDelta) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems);
  const repeated = extractWatchRepeatedLanguage(newItems);
  const ratingDirection = ratingDelta > 0 ? "up" : ratingDelta < 0 ? "down" : "neutral";
  return {
    id: "new-reviews",
    source: "reviews",
    label: newCount ? "New reviews" : "Review rating changed",
    value: newCount ? `${formatNumberWithSuffix(newCount)} review${newCount === 1 ? "" : "s"}` : `${formatNumberWithSuffix(previousReviews.averageRating || 0)} to ${formatNumberWithSuffix(currentReviews.averageRating || 0)}`,
    delta: Math.abs(ratingDelta) >= 0.1
      ? `${ratingDelta > 0 ? "+" : ""}${formatNumberWithSuffix(ratingDelta)} rating`
      : `${negativeDelta > 0 ? "+" : ""}${formatNumberWithSuffix(negativeDelta)} negative`,
    direction: ratingDirection === "neutral" ? (negativeDelta > 0 ? "up" : negativeDelta < 0 ? "down" : "neutral") : ratingDirection,
    tone: negativeDelta > 0 || sentiment.negative > sentiment.positive || ratingDelta < -0.1 ? "orange" : "blue",
    icon: "star",
    detail: [
      sentiment.total ? `New review sentiment: ${sentiment.negative} negative, ${sentiment.neutral} neutral, ${sentiment.positive} positive.` : "",
      Math.abs(ratingDelta) >= 0.1 ? `Average rating moved from ${formatNumberWithSuffix(previousReviews.averageRating || 0)} to ${formatNumberWithSuffix(currentReviews.averageRating || 0)}.` : "",
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
    detail: currentContent.reason || "Product title, description, variant, SEO, tag, collection or media content changed since the previous deep diagnosis.",
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
  const newItems = getNewWatchEvidenceItems(previousOrders.items, currentOrders.items, { sinceAt: previous?.capturedAt });
  const orderDelta = watchNumberDelta(findWatchNumber(previous?.orderCount, previousOrders.totalOrders), findWatchNumber(current?.orderCount, currentOrders.totalOrders));
  const unitDelta = watchNumberDelta(findWatchNumber(previous?.soldUnits, previousOrders.totalUnits), findWatchNumber(current?.soldUnits, currentOrders.totalUnits));
  const revenueDelta = watchNumberDelta(findWatchNumber(previous?.salesAmount, previousOrders.totalRevenue), findWatchNumber(current?.salesAmount, currentOrders.totalRevenue));
  const newOrderCount = newItems.length || Math.max(0, Math.round(orderDelta));
  const newUnits = sumWatchItemNumbers(newItems, "quantity") || Math.max(0, Math.round(unitDelta));
  const newRevenue = roundMoney(sumWatchItemNumbers(newItems, "amount") || Math.max(0, revenueDelta));
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
  if (!newItems.length && !newSourceItems.length && Math.abs(unitDelta) < 1 && Math.abs(rateDelta) < 0.2) return null;
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
    tone: unitDelta > 0 || rateDelta > 0 ? "orange" : "green",
    metric: unitDelta > 0 ? `+${formatNumberWithSuffix(unitDelta)} returned unit${unitDelta === 1 ? "" : "s"}` : `${formatNumberWithSuffix(currentReturns.totalUnits || current?.returnUnits || 0)} returned units`,
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
  if (!newItems.length && Math.abs(negativeDelta) < 1 && Math.abs(reviewDelta) < 1) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems.length ? newItems : currentReviews.items);
  const sentimentLabel = newItems.length ? "New review sentiment" : "Current review sentiment";
  const repeated = extractWatchRepeatedLanguage(newItems);
  const ratings = countWatchTerms(newItems.map((item) => Number(item.rating || 0) ? `${Number(item.rating)} star` : "").filter(Boolean));
  return {
    id: "review-evidence",
    title: "Review evidence changed",
    tone: negativeDelta > 0 || sentiment.negative > sentiment.positive ? "orange" : "blue",
    metric: newItems.length ? `${newItems.length} new review${newItems.length === 1 ? "" : "s"}` : `${negativeDelta > 0 ? "+" : ""}${negativeDelta} negative reviews`,
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
  if (!newItems.length && !newSourceItems.length && Math.abs(unitDelta) < 1) return null;
  const sentiment = summarizeWatchEvidenceItems(newItems.length ? newItems : currentRefunds.items);
  const sentimentLabel = newItems.length ? "New refund-note sentiment" : "Current refund-note sentiment";
  const reasons = countWatchTerms([
    ...newItems.flatMap((item) => [item.reasonText, item.reason, item.restockType, item.issueCode]),
    ...newSourceItems.flatMap((item) => [item.reasonText, item.reason, item.restockType]),
  ].filter(Boolean));
  const repeated = extractWatchRepeatedLanguage(newItems);
  return {
    id: "refund-evidence",
    title: "Refund evidence changed",
    tone: unitDelta > 0 ? "orange" : "green",
    metric: unitDelta > 0 ? `+${formatNumberWithSuffix(unitDelta)} refunded unit${unitDelta === 1 ? "" : "s"}` : `${formatNumberWithSuffix(currentRefunds.totalUnits || current?.refundUnits || 0)} refunded units`,
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
    summary: currentContent.reason || "Product title, description, variant, SEO, tag, collection or media content changed since the previous deep diagnosis.",
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

function buildEvidenceChangeSection(previous, current) {
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
    numericWatchChange({
      id: "signal-count",
      label: "Evidence signals",
      previous: previous.signalCount,
      current: current.signalCount,
      threshold: 1,
      detail: "The amount of stored diagnostic evidence changed.",
    }),
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
      label: "Estimated impact",
      previous: previous.estimatedImpact,
      current: current.estimatedImpact,
      threshold: 1,
      detail: "Estimated business exposure changed since the previous run.",
    }),
    moneyWatchChange({
      id: "margin-at-risk",
      label: "Margin at risk",
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
  return { id: "impact", title: "Financial exposure", tone: "orange", changes };
}

function buildMomentumChangeSection(previous, current) {
  const changes = [
    numericWatchChange({
      id: "momentum-score",
      label: "Product Momentum",
      previous: previous.productMomentumScore,
      current: current.productMomentumScore,
      suffix: "/100",
      threshold: 1,
      detail: "Commercial momentum changed based on recent sales velocity and catalog position.",
    }),
    textWatchChange({
      id: "momentum-tier",
      label: "Momentum tier",
      previous: previous.productMomentumTier,
      current: current.productMomentumTier,
      detail: "The commercial attention category changed.",
    }),
    textWatchChange({
      id: "momentum-direction",
      label: "Momentum direction",
      previous: previous.productMomentumDirection,
      current: current.productMomentumDirection,
      detail: "The product's sales movement label changed.",
    }),
  ].filter(Boolean);
  return { id: "momentum", title: "Commercial momentum", tone: "green", changes };
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
  if (noChangesReused || report.status === "unchanged") {
    return `${productTitle} did not show new orders, returns, refunds, reviews or meaningful calculated Watchlist movement since the previous run. Product risk, source evidence, financial exposure and commercial momentum stayed close to the last stored report.`;
  }
  if (report.status === "baseline") {
    return `${productTitle} now has a Watchlist baseline. Future runs will compare new returns, refunds, reviews, source language, product risk and momentum against this stored point.`;
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
    calloutDetail: "Each line shows saved risk score movement for one watched product after scans or diagnostics.",
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
  if (eventType === "diagnosis_completed") return "wand";
  if (eventType === WATCH_CHANGE_REPORT_EVENT) return "chart-line";
  if (eventType === "watch_scan_completed") return "refresh";
  if (eventType === "watch_scan_queued") return "play";
  if (eventType === "settings_changed") return "settings";
  if (eventType === "alert_sent") return "email";
  return "info";
}

function getActivityTone(eventType, metadata = {}) {
  if (eventType === "product_removed") return "slate";
  if (eventType === "product_paused") return "purple";
  if (eventType === "product_resumed") return "green";
  if (eventType === "all_watches_paused") return "purple";
  if (eventType === "product_added") return "blue";
  if (eventType === "diagnosis_completed") return "purple";
  if (eventType === WATCH_CHANGE_REPORT_EVENT) {
    const status = metadata.report?.status || "";
    if (status === "unchanged") return "green";
    if (status === "baseline") return "blue";
    return "orange";
  }
  if (eventType === "watch_scan_queued") return "blue";
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
  const hasPreviousItemBaseline = previousKeys.size > 0;
  const cutoff = parseWatchDate(sinceAt);

  return (Array.isArray(currentItems) ? currentItems : []).filter((item) => {
    if (!item?.key || previousKeys.has(item.key)) return false;
    if (hasPreviousItemBaseline) return true;

    const itemDate = parseWatchDate(item.createdAt || item.updatedAt || item.processedAt || item.date);
    if (cutoff) {
      if (!itemDate) return false;
      return itemDate.getTime() > cutoff.getTime();
    }

    return hasPreviousItemBaseline;
  });
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
  const places = countWatchTerms((Array.isArray(items) ? items : [])
    .map((item) => [item?.city, item?.province, item?.country].filter(Boolean).join(", "))
    .filter(Boolean));
  return places.length ? `New order geography: ${formatWatchCountList(places, 3)}.` : "";
}

function sumWatchItemNumbers(items = [], key) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => total + Number(item?.[key] || 0), 0);
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
  getNewWatchEvidenceItems,
};
