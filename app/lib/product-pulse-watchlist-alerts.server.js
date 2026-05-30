import prisma from "../db.server";
import { sendProductPulseEmail } from "../email.server";
import { serializeError } from "./product-pulse-job-logs.server";
import { getWatchSettingsForShop, recordWatchActivityForShop } from "./product-pulse-watchlist.server";

const PRODUCT_DIAGNOSIS_KIND = "product-diagnosis";
const WATCH_SCAN_QUEUED_EVENT = "watch_scan_queued";
const WATCH_MANUAL_SCAN_QUEUED_EVENT = "watch_manual_scan_queued";
const WATCH_CHANGE_REPORT_EVENT = "watch_change_report";
const WATCH_ALERT_SENT_EVENT = "watch_alert_sent";
const WATCH_ALERT_SKIPPED_EVENT = "watch_alert_skipped";
const WATCH_ALERT_FAILED_EVENT = "watch_alert_failed";
const ACTIVE_JOB_STATUSES = new Set(["Queued", "Running"]);
const ALERT_LOOKBACK_DAYS = 7;
const REPORT_LOOKBACK_MINUTES = 30;
const EMAIL_MAX_DETAIL_PRODUCTS = 6;
const EMAIL_PRODUCT_IMAGE_SIZE = 72;
const PRODUCT_PULSE_EMAIL_APP_NAME = "ProductPulse AI";
const CALCULATED_CHANGE_PRIORITY = [
  "primary-issue",
  "risk-score",
  "risk-label",
  "diagnosis-confidence",
  "momentum-score",
  "momentum-tier",
  "momentum-direction",
  "return-rate",
  "returned-units",
  "refund-rate",
  "negative-reviews",
  "signal-count",
  "estimated-impact",
  "margin-at-risk",
  "revenue-at-risk",
  "top-return-reason",
  "top-refund-reason",
];

export async function maybeSendWatchlistRunAlertForJob(job = {}) {
  if (!job?.id || job.kind !== PRODUCT_DIAGNOSIS_KIND) {
    return { status: "ignored", reason: "not_product_diagnosis_job" };
  }

  const queuedActivities = await findQueuedWatchRunsForJob(job.shop, job.id);
  if (!queuedActivities.length) {
    return { status: "ignored", reason: "job_not_from_watchlist_cron" };
  }

  const results = [];
  for (const activity of queuedActivities) {
    results.push(await maybeSendWatchlistRunAlertForQueuedActivity(job.shop, activity));
  }
  return results.length === 1 ? results[0] : { status: "checked", results };
}

export async function maybeSendWatchlistRunAlertForQueuedActivity(shop, queuedActivity = {}) {
  if (!shop || !queuedActivity?.id) return { status: "ignored", reason: "missing_queued_activity" };

  const metadata = normalizeObject(queuedActivity.metadata);
  const jobIds = uniqueStrings(metadata.jobIds);
  if (!jobIds.length) return { status: "ignored", reason: "queued_activity_has_no_jobs" };

  const alreadyResolved = await findExistingAlertResolution(shop, queuedActivity);
  if (alreadyResolved) {
    return { status: "skipped", reason: "alert_already_resolved", activityId: alreadyResolved.id };
  }

  const jobs = await prisma.catalogSignalJob.findMany({
    where: {
      shop,
      id: { in: jobIds },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (!jobs.length || jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) {
    return { status: "pending", reason: "watchlist_jobs_still_running" };
  }

  const settings = await getWatchSettingsForShop(shop);
  const reports = await getLatestWatchReportsForQueuedRun(shop, queuedActivity, { jobIds, jobs });
  const decision = buildWatchlistAlertDecision({
    settings,
    reports,
    jobs,
    metadata,
  });

  if (!decision.shouldSend) {
    const skipped = await recordWatchActivityForShop(shop, {
      eventType: WATCH_ALERT_SKIPPED_EVENT,
      title: "Watchlist email skipped",
      detail: decision.reason,
      metadata: {
        queuedActivityId: queuedActivity.id,
        triggerRule: settings.triggerRule,
        reason: decision.reason,
        reportCount: reports.length,
      },
    });
    return { status: "skipped", reason: decision.reason, activityId: skipped?.id || null };
  }

  const email = buildWatchlistRunEmail({
    shop,
    settings,
    queuedActivity,
    reports,
    jobs,
    decision,
    metadata,
  });

  try {
    const result = await sendProductPulseEmail({
      type: "watchlist_alert",
      shop,
      to: settings.alertRecipients,
      subject: email.subject,
      message: email.text,
      html: email.html,
      requiredRecipientEnv: "Watchlist alert recipient",
    });
    const sent = await recordWatchActivityForShop(shop, {
      eventType: WATCH_ALERT_SENT_EVENT,
      title: "Watchlist email sent",
      detail: decision.label,
      metadata: {
        queuedActivityId: queuedActivity.id,
        triggerRule: settings.triggerRule,
        decision,
        recipientCount: settings.alertRecipients.length,
        reportCount: reports.length,
        jobIds,
        emailPayload: {
          subject: email.subject,
          recipientCount: result?.recipients?.length || settings.alertRecipients.length,
        },
      },
    });
    return { status: "sent", activityId: sent?.id || null, decision };
  } catch (error) {
    const failed = await recordWatchActivityForShop(shop, {
      eventType: WATCH_ALERT_FAILED_EVENT,
      title: "Watchlist email failed",
      detail: error?.message || "Watchlist email could not be sent.",
      metadata: {
        queuedActivityId: queuedActivity.id,
        triggerRule: settings.triggerRule,
        error: serializeError(error),
      },
    });
    return { status: "failed", activityId: failed?.id || null, error: serializeError(error) };
  }
}

export async function sendWatchlistCreditExhaustedEmailForShop({
  shop,
  settings,
  items = [],
  pointBalance = null,
  now = new Date(),
  cadenceDays = null,
  forceEmail = false,
  triggeredBy = "",
} = {}) {
  const normalizedSettings = settings || await getWatchSettingsForShop(shop);
  const decision = buildWatchlistAlertDecision({
    settings: normalizedSettings,
    reports: [],
    jobs: [],
    metadata: { creditExhausted: true, forceEmail, triggeredBy },
  });
  if (!decision.shouldSend) return { status: "skipped", reason: decision.reason };

  const metadata = {
    creditExhausted: true,
    forceEmail,
    triggeredBy,
    skippedForCredits: items.map((item) => ({
      productGid: item.productGid,
      productTitle: item.productTitle,
      handle: item.handle || "",
      sku: item.sku || "",
      imageUrl: item.imageUrl || "",
      imageAlt: item.imageAlt || item.productTitle || "",
    })),
    availableCredits: Number(pointBalance?.available || 0),
    cadenceDays,
    ranAt: now.toISOString(),
  };
  const email = buildWatchlistRunEmail({
    shop,
    settings: normalizedSettings,
    queuedActivity: { id: null, createdAt: now, metadata },
    reports: [],
    jobs: [],
    decision,
    metadata,
  });

  try {
    const result = await sendProductPulseEmail({
      type: "watchlist_alert",
      shop,
      to: normalizedSettings.alertRecipients,
      subject: email.subject,
      message: email.text,
      html: email.html,
      requiredRecipientEnv: "Watchlist alert recipient",
    });
    const manualRun = triggeredBy === "watchlist-manual-run" || forceEmail;
    const sent = await recordWatchActivityForShop(shop, {
      eventType: WATCH_ALERT_SENT_EVENT,
      title: manualRun ? "Manual Watchlist credit email sent" : "Watchlist credit alert sent",
      detail: manualRun
        ? "The manual Watchlist run could not queue diagnostics because the shop has no available credits."
        : "The scheduled Watchlist run could not continue because the shop has no available credits.",
      metadata: {
        triggerRule: normalizedSettings.triggerRule,
        decision,
        recipientCount: result?.recipients?.length || normalizedSettings.alertRecipients.length,
        ...metadata,
      },
    });
    return { status: "sent", activityId: sent?.id || null, decision };
  } catch (error) {
    await recordWatchActivityForShop(shop, {
      eventType: WATCH_ALERT_FAILED_EVENT,
      title: "Watchlist credit alert failed",
      detail: error?.message || "Watchlist credit alert could not be sent.",
      metadata: {
        triggerRule: normalizedSettings.triggerRule,
        error: serializeError(error),
        ...metadata,
      },
    });
    return { status: "failed", error: serializeError(error) };
  }
}

async function findQueuedWatchRunsForJob(shop, jobId) {
  if (!shop || !jobId) return [];
  const cutoff = new Date(Date.now() - ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const activities = await prisma.productWatchActivity.findMany({
    where: {
      shop,
      eventType: { in: [WATCH_SCAN_QUEUED_EVENT, WATCH_MANUAL_SCAN_QUEUED_EVENT] },
      createdAt: { gte: cutoff },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 60,
  });
  return activities.filter((activity) => uniqueStrings(activity.metadata?.jobIds).includes(String(jobId)));
}

async function findExistingAlertResolution(shop, queuedActivity = {}) {
  const since = queuedActivity.createdAt ? new Date(queuedActivity.createdAt) : new Date(Date.now() - ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const activities = await prisma.productWatchActivity.findMany({
    where: {
      shop,
      eventType: { in: [WATCH_ALERT_SENT_EVENT, WATCH_ALERT_SKIPPED_EVENT] },
      createdAt: { gte: since },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 80,
  });
  return activities.find((activity) => activity.metadata?.queuedActivityId === queuedActivity.id) || null;
}

async function getLatestWatchReportsForQueuedRun(shop, queuedActivity = {}, { jobIds = [], jobs = [] } = {}) {
  const metadata = normalizeObject(queuedActivity.metadata);
  const productGids = uniqueStrings(metadata.productGids);
  if (!productGids.length) return [];

  const queuedAt = queuedActivity.createdAt ? new Date(queuedActivity.createdAt) : new Date();
  const lowerBound = new Date(queuedAt.getTime() - REPORT_LOOKBACK_MINUTES * 60 * 1000);
  const activities = await prisma.productWatchActivity.findMany({
    where: {
      shop,
      eventType: WATCH_CHANGE_REPORT_EVENT,
      productGid: { in: productGids },
      createdAt: { gte: lowerBound },
    },
    orderBy: [{ createdAt: "desc" }],
    take: productGids.length * 8,
  });

  const jobIdSet = new Set(uniqueStrings(jobIds));
  const productContextByGid = await getWatchEmailProductContextByGid(shop, productGids, { jobs, metadata });
  const byProduct = new Map();
  for (const activity of activities) {
    const report = formatWatchReportActivity(activity, productContextByGid.get(activity.productGid));
    const reportJobId = String(activity.metadata?.jobId || "");
    const exactJobMatch = reportJobId && jobIdSet.has(reportJobId);
    const inRunWindow = new Date(activity.createdAt).getTime() >= queuedAt.getTime();
    if (!exactJobMatch && !inRunWindow) continue;
    if (!byProduct.has(report.productGid) || exactJobMatch) {
      byProduct.set(report.productGid, report);
    }
  }

  return productGids.map((productGid) => {
    const report = byProduct.get(productGid);
    if (report) return report;
    return buildMissingWatchReport(productGid, productContextByGid.get(productGid), queuedActivity);
  });
}

function buildWatchlistAlertDecision({ settings = {}, reports = [], jobs = [], metadata = {} } = {}) {
  if (settings.alertsEnabled === false) {
    return { shouldSend: false, reason: "watchlist_alerts_disabled", label: "Watchlist alerts are disabled" };
  }
  if (!Array.isArray(settings.alertRecipients) || !settings.alertRecipients.length) {
    return { shouldSend: false, reason: "no_watchlist_alert_recipients", label: "No Watchlist alert recipients configured" };
  }
  if (metadata.forceEmail) {
    return {
      shouldSend: true,
      reason: metadata.creditExhausted ? "manual_watchlist_credit_exhausted" : "manual_watchlist_run",
      label: metadata.creditExhausted ? "Manual Watchlist run blocked by credits" : "Manual Watchlist run completed",
    };
  }

  if (metadata.creditExhausted || uniqueStrings(metadata.skippedForCredits).length) {
    return { shouldSend: true, reason: "credit_exhausted", label: "Watchlist credits exhausted" };
  }

  const triggerRule = String(settings.triggerRule || "new_or_rising_risk");
  const failedJobs = jobs.filter((job) => job.status === "Failed");
  if (failedJobs.length) {
    return { shouldSend: true, reason: "watchlist_job_failed", label: "Watchlist job failed" };
  }

  const changedReports = reports.filter(reportHasAnyChange);
  const matchers = {
    any_watch_change: () => changedReports.length > 0,
    new_issue_only: () => reports.some(reportHasNewIssue),
    risk_score_increase: () => reports.some(reportHasRiskIncrease),
    medium_or_high_risk: () => reports.some((report) => (report.status === "baseline" || reportHasAnyChange(report)) && reportHasMediumOrHighRisk(report)),
    new_or_rising_risk: () => reports.some((report) => reportHasNewIssue(report) || reportHasRiskIncrease(report)),
  };
  const matched = (matchers[triggerRule] || matchers.new_or_rising_risk)();
  return {
    shouldSend: matched,
    reason: matched ? triggerRule : `trigger_rule_not_met:${triggerRule}`,
    label: matched ? getTriggerRuleEmailLabel(triggerRule) : "Watchlist trigger rule not met",
  };
}

function buildWatchlistRunEmail({
  shop,
  settings = {},
  queuedActivity = {},
  reports = [],
  jobs = [],
  decision = {},
  metadata = {},
} = {}) {
  const productCount = uniqueStrings(metadata.productGids).length || reports.length;
  const skippedForCredits = Array.isArray(metadata.skippedForCredits) ? metadata.skippedForCredits : [];
  const completedJobs = jobs.filter((job) => job.status === "Completed");
  const failedJobs = jobs.filter((job) => job.status === "Failed");
  const pointsConsumed = jobs.reduce((sum, job) => sum + safeNumber(job.payload?.pointsConsumed ?? job.payload?.creditsConsumed), 0);
  const creditExhausted = Boolean(metadata.creditExhausted || String(decision.reason || "").includes("credit_exhausted"));
  const subject = creditExhausted && !reports.length
    ? `Watchlist paused: credits exhausted for ${shop}`
    : `Watchlist report for ${shop}`;
  const reportProducts = buildWatchEmailProducts({ reports, jobs, metadata, skippedForCredits });
  const headerLines = [
    `Watchlist report for ${shop}`,
    `Trigger: ${decision.label || getTriggerRuleEmailLabel(settings.triggerRule)}`,
    productCount ? `Products queued: ${productCount}` : "",
    completedJobs.length ? `Completed: ${completedJobs.length}` : "",
    failedJobs.length ? `Failed: ${failedJobs.length}` : "",
    pointsConsumed ? `Credits consumed by completed jobs: ${pointsConsumed}` : "",
    skippedForCredits.length ? `Skipped for credits: ${skippedForCredits.length}` : "",
  ].filter(Boolean);

  const reportLines = reportProducts.length
    ? reportProducts.flatMap((product) => formatReportTextBlock(product))
    : ["No completed product change reports were available for this email."];
  const creditLines = skippedForCredits.length || metadata.creditExhausted
    ? [
      "",
      "Credit notice:",
      `Available credits: ${safeNumber(metadata.availableCredits)}`,
      skippedForCredits.length
        ? `The following products were not queued because the shop ran out of credits: ${skippedForCredits.map((item) => item.productTitle || item.productGid).filter(Boolean).join(", ")}.`
        : "No products were queued because the shop has no available credits.",
    ]
    : [];
  const failedLines = failedJobs.length
    ? [
      "",
      "Failed jobs:",
      ...failedJobs.map((job) => `- ${job.payload?.productTitle || job.id}: ${job.errorMessage || "Diagnosis failed."}`),
    ]
    : [];
  const text = [
    ...headerLines,
    "",
    "Product changes:",
    ...reportLines,
    ...creditLines,
    ...failedLines,
  ].join("\n");

  const html = buildWatchlistReportHtmlEmail({
    shop,
    subject,
    decision,
    settings,
    queuedActivity,
    reports: reportProducts,
    jobs,
    metadata,
    headerLines,
    skippedForCredits,
    failedJobs,
    pointsConsumed,
  });

  return {
    subject,
    text,
    html,
    queuedActivityId: queuedActivity.id || null,
  };
}

async function getWatchEmailProductContextByGid(shop, productGids = [], { jobs = [], metadata = {} } = {}) {
  const contextByGid = new Map();
  uniqueStrings(productGids).forEach((productGid, index) => {
    contextByGid.set(productGid, {
      productGid,
      productTitle: Array.isArray(metadata.productTitles) ? metadata.productTitles[index] || "" : "",
      handle: "",
      imageUrl: "",
      imageAlt: "",
    });
  });

  jobs.forEach((job) => {
    const payload = normalizeObject(job.payload);
    const productGid = String(payload.productGid || payload.productId || "").trim();
    if (!productGid || !contextByGid.has(productGid)) return;
    const current = contextByGid.get(productGid);
    contextByGid.set(productGid, {
      ...current,
      productTitle: current.productTitle || payload.productTitle || "",
      handle: current.handle || payload.handle || "",
      imageUrl: current.imageUrl || payload.productImageUrl || payload.imageUrl || "",
      imageAlt: current.imageAlt || payload.productImageAlt || payload.imageAlt || payload.productTitle || "",
    });
  });

  if (shop && productGids.length) {
    const items = await prisma.productWatchlistItem.findMany({
      where: { shop, productGid: { in: productGids } },
      select: {
        productGid: true,
        productTitle: true,
        handle: true,
        imageUrl: true,
        imageAlt: true,
      },
    });
    items.forEach((item) => {
      const current = contextByGid.get(item.productGid) || { productGid: item.productGid };
      contextByGid.set(item.productGid, {
        ...current,
        productTitle: item.productTitle || current.productTitle || "",
        handle: item.handle || current.handle || "",
        imageUrl: item.imageUrl || current.imageUrl || "",
        imageAlt: item.imageAlt || current.imageAlt || item.productTitle || current.productTitle || "",
      });
    });
  }

  return contextByGid;
}

function buildMissingWatchReport(productGid, context = {}, queuedActivity = {}) {
  return {
    id: `missing-watch-report-${productGid}`,
    productGid,
    productTitle: context?.productTitle || "Watched product",
    handle: context?.handle || "",
    imageUrl: context?.imageUrl || "",
    imageAlt: context?.imageAlt || context?.productTitle || "Watched product",
    status: "unchanged",
    headline: "No completed Watchlist report",
    summary: "No completed product change report was available for this product in the current Watchlist run.",
    narrative: "No completed product change report was available for this product in the current Watchlist run.",
    changeCount: 0,
    sourceChangeCount: 0,
    sourceChanges: [],
    sourceInsights: [],
    changes: [],
    current: {},
    previous: {},
    createdAt: queuedActivity.createdAt?.toISOString?.() || queuedActivity.createdAt || null,
    missingReport: true,
  };
}

function formatWatchReportActivity(activity = {}, context = {}) {
  const metadata = normalizeObject(activity.metadata);
  const report = normalizeObject(metadata.report);
  return {
    id: activity.id,
    productGid: activity.productGid || "",
    productTitle: activity.productTitle || context?.productTitle || report.current?.productTitle || "Watched product",
    handle: context?.handle || "",
    imageUrl: context?.imageUrl || "",
    imageAlt: context?.imageAlt || activity.productTitle || context?.productTitle || "Watched product",
    status: report.status || "changed",
    headline: report.headline || "",
    summary: report.summary || activity.detail || "",
    narrative: report.narrative || activity.detail || "",
    changeCount: safeNumber(report.changeCount),
    sourceChangeCount: safeNumber(report.sourceChangeCount),
    sourceChanges: Array.isArray(report.sourceChanges) ? report.sourceChanges : [],
    sourceInsights: Array.isArray(report.sourceInsights) ? report.sourceInsights : [],
    changes: Array.isArray(report.changes) ? report.changes : [],
    current: normalizeObject(report.current),
    previous: normalizeObject(report.previous),
    createdAt: activity.createdAt?.toISOString?.() || activity.createdAt || null,
  };
}

function buildWatchEmailProducts({ reports = [], jobs = [], metadata = {}, skippedForCredits = [] } = {}) {
  const products = reports.map((report) => normalizeWatchEmailProduct(report, { jobs }));
  const seen = new Set(products.map((product) => product.productGid).filter(Boolean));
  skippedForCredits.forEach((item) => {
    const productGid = String(item.productGid || "").trim();
    if (productGid && seen.has(productGid)) return;
    if (productGid) seen.add(productGid);
    products.push(normalizeWatchEmailProduct({
      productGid,
      productTitle: item.productTitle || "Watched product",
      handle: item.handle || "",
      imageUrl: item.imageUrl || "",
      imageAlt: item.productTitle || "Watched product",
      status: "skipped",
      headline: "Skipped for credits",
      narrative: "This product was not queued because the shop ran out of available credits before the manual or scheduled Watchlist run reached it.",
      sourceChanges: [],
      sourceInsights: [],
      changes: [],
      current: {},
      previous: {},
      skippedForCredits: true,
    }, { jobs }));
  });

  if (!products.length && metadata.creditExhausted) {
    return [{
      productGid: "",
      productTitle: "Watchlist products",
      status: "skipped",
      statusLabel: "Skipped",
      statusTone: "warning",
      headline: "Skipped for credits",
      narrative: "No products were queued because the shop has no available credits.",
      sourceChanges: [],
      sourceInsights: [],
      changes: [],
      current: {},
      previous: {},
      metrics: buildEmptyWatchEmailMetrics(),
    }];
  }

  return products;
}

function normalizeWatchEmailProduct(report = {}, { jobs = [] } = {}) {
  const productGid = String(report.productGid || "").trim();
  const job = jobs.find((candidate) => String(candidate.payload?.productGid || "") === productGid) || null;
  const imageUrl = report.imageUrl || job?.payload?.productImageUrl || job?.payload?.imageUrl || "";
  const handle = report.handle || job?.payload?.handle || "";
  const productTitle = report.productTitle || job?.payload?.productTitle || "Watched product";
  const sourceChanges = Array.isArray(report.sourceChanges) ? report.sourceChanges : [];
  const changes = Array.isArray(report.changes) ? report.changes : [];
  return {
    ...report,
    productGid,
    productTitle,
    handle,
    imageUrl,
    imageAlt: report.imageAlt || job?.payload?.productImageAlt || job?.payload?.imageAlt || productTitle,
    statusLabel: getEmailStatusLabel(report),
    statusTone: getEmailStatusTone(report),
    sourceChanges,
    sourceInsights: Array.isArray(report.sourceInsights) ? report.sourceInsights : [],
    changes,
    current: normalizeObject(report.current),
    previous: normalizeObject(report.previous),
    metrics: buildWatchEmailMetrics(report),
  };
}

function buildWatchEmailMetrics(report = {}) {
  return {
    orders: buildSourceMetric(report, "new-orders", { label: "New orders", emptyValue: "0" }),
    returns: buildSourceMetric(report, "new-returns", { label: "Returns", emptyValue: "0" }),
    refunds: buildSourceMetric(report, "new-refunds", { label: "Refunds", emptyValue: "0" }),
    reviews: buildSourceMetric(report, "new-reviews", { label: "Reviews", emptyValue: "0" }),
  };
}

function buildEmptyWatchEmailMetrics() {
  return {
    orders: { label: "New orders", value: "0", delta: "", detail: "", tone: "neutral", items: [] },
    returns: { label: "Returns", value: "0", delta: "", detail: "", tone: "neutral", items: [] },
    refunds: { label: "Refunds", value: "0", delta: "", detail: "", tone: "neutral", items: [] },
    reviews: { label: "Reviews", value: "0", delta: "", detail: "", tone: "neutral", items: [] },
  };
}

function buildSourceMetric(report = {}, id, { label, emptyValue = "0" } = {}) {
  const change = (Array.isArray(report.sourceChanges) ? report.sourceChanges : []).find((item) => item.id === id);
  return {
    label,
    value: change?.value || emptyValue,
    delta: change?.delta || "",
    detail: change?.detail || "",
    tone: change?.tone || "neutral",
    items: Array.isArray(change?.items) ? change.items : [],
  };
}

function formatReportTextBlock(report = {}) {
  const sourceChanges = (report.sourceChanges || []).slice(0, 5).map((change) => {
    const metric = [change.value, change.delta].filter(Boolean).join(" | ");
    return `  - ${change.label || change.id}: ${metric || "changed"}${change.detail ? ` - ${change.detail}` : ""}`;
  });
  const calculatedChanges = getSortedCalculatedChanges(report.changes).map((change) => {
    const transition = formatChangeTransitionText(change);
    return `  - ${change.label || change.id}: ${transition || "changed"}`;
  });
  return [
    "",
    `- ${report.productTitle}`,
    `  Status: ${report.statusLabel || report.status}${report.headline ? ` - ${report.headline}` : ""}`,
    report.narrative ? `  Summary: ${report.narrative}` : "",
    sourceChanges.length ? "  Concrete changes:" : "",
    ...sourceChanges,
    calculatedChanges.length ? "  Secondary calculated context:" : "",
    ...calculatedChanges,
  ].filter(Boolean);
}

function buildWatchlistReportHtmlEmail({
  shop,
  subject,
  decision = {},
  reports = [],
  metadata = {},
  skippedForCredits = [],
  failedJobs = [],
  pointsConsumed = 0,
} = {}) {
  const appBaseUrl = getEmailAppBaseUrl();
  const generatedAt = formatEmailDate(new Date());
  const completedCount = reports.filter((report) => !["failed", "skipped"].includes(report.status)).length;
  const changedCount = reports.filter((report) => reportHasAnyChange(report)).length;
  const unchangedCount = reports.filter((report) => report.status === "unchanged" || (!reportHasAnyChange(report) && !["failed", "skipped"].includes(report.status))).length;
  const emailContext = { shop, appBaseUrl };
  const detailReports = reports.filter((report) => reportHasAnyChange(report) || report.status === "failed").slice(0, EMAIL_MAX_DETAIL_PRODUCTS);
  const showNoChangePanel = !detailReports.length && reports.length && !metadata.creditExhausted;
  const noChangePanel = showNoChangePanel ? buildNoChangeHtmlPanel({ reports, emailContext }) : "";
  const creditNotice = skippedForCredits.length || metadata.creditExhausted
    ? buildCreditNoticeHtml({ skippedForCredits, metadata })
    : "";
  const failedNotice = failedJobs.length ? buildFailedJobsHtml(failedJobs) : "";

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(subject)}</title>
    <style>
      @media only screen and (max-width: 640px) {
        .gw-container { width: 100% !important; }
        .gw-pad { padding-left: 12px !important; padding-right: 12px !important; }
        .gw-header-cell { display: block !important; width: 100% !important; text-align: left !important; padding-bottom: 4px !important; }
        .gw-hide-mobile { display: none !important; }
        .gw-summary-table th, .gw-summary-table td { font-size: 10px !important; padding: 8px 5px !important; }
        .gw-product-title { font-size: 12px !important; line-height: 16px !important; }
        .gw-product-image { width: 46px !important; height: 46px !important; }
        .gw-detail-image-cell { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
        .gw-detail-copy-cell { display: block !important; width: 100% !important; }
        .gw-metric-cell { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 8px !important; }
        .gw-context-cell { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 8px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-text-size-adjust:100%;text-size-adjust:100%;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7fb;border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" class="gw-container" width="860" cellspacing="0" cellpadding="0" border="0" style="width:860px;max-width:860px;background:#ffffff;border-collapse:collapse;">
            ${buildEmailTopBarHtml({ generatedAt, appBaseUrl })}
            <tr>
              <td class="gw-pad" style="padding:20px 26px 10px 26px;">
                <h1 style="margin:0;font-size:28px;line-height:32px;font-weight:800;color:#050816;">Watchlist Report</h1>
                <p style="margin:3px 0 12px 0;font-size:17px;line-height:21px;font-weight:700;color:#2563eb;">${buildShopLinkHtml(shop, appBaseUrl)}</p>
                <p style="margin:0;font-size:12px;line-height:18px;color:#172554;">
                  <span style="font-weight:700;">Trigger:</span> ${escapeHtml(decision.label || "Watchlist run completed")}
                  <span style="color:#94a3b8;padding:0 8px;">|</span>
                  <span style="font-weight:700;">Completed products:</span> ${escapeHtml(completedCount)}
                  <span style="color:#94a3b8;padding:0 8px;">|</span>
                  <span style="font-weight:700;">Changed:</span> ${escapeHtml(changedCount)}
                  <span style="color:#94a3b8;padding:0 8px;">|</span>
                  <span style="font-weight:700;">No changes:</span> ${escapeHtml(unchangedCount)}
                  <span style="color:#94a3b8;padding:0 8px;">|</span>
                  <span style="font-weight:700;">Credits consumed:</span> ${escapeHtml(pointsConsumed)}
                </p>
              </td>
            </tr>
            <tr>
              <td class="gw-pad" style="padding:8px 26px 12px 26px;">
                ${buildSummaryTableHtml(reports, emailContext)}
              </td>
            </tr>
            ${detailReports.map((report) => buildProductDetailHtml(report, emailContext)).join("")}
            ${noChangePanel}
            ${creditNotice}
            ${failedNotice}
            <tr>
              <td class="gw-pad" style="padding:8px 26px 22px 26px;">
                <p style="margin:0;font-size:10px;line-height:15px;color:#64748b;">This report reflects data captured since the previous Watchlist run. Product links open ProductPulse in your Shopify app context.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildEmailTopBarHtml({ generatedAt } = {}) {
  const iconHtml = buildEmailAssistantIconHtml();
  return `<tr>
    <td style="padding:0;background:#07162e;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#07162e;">
        <tr>
          <td class="gw-header-cell" style="padding:14px 26px;width:50%;font-size:15px;line-height:18px;font-weight:800;letter-spacing:.04em;color:#ffffff;">
            ${iconHtml}${escapeHtml(PRODUCT_PULSE_EMAIL_APP_NAME)}
          </td>
          <td class="gw-header-cell" style="padding:14px 26px;width:50%;text-align:right;font-size:12px;line-height:18px;color:#e5e7eb;">
            ${escapeHtml(generatedAt)}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildEmailAssistantIconHtml() {
  return `<span class="gw-watchlist-brand-icon" role="img" aria-label="Watchlist" style="display:inline-block;width:22px;height:22px;margin-right:8px;border-radius:7px;background:#eef2ff;border:1px solid #a5b4fc;box-sizing:border-box;vertical-align:-6px;">
    <span style="display:block;width:3px;height:3px;margin:5px 0 0 5px;border-radius:50%;background:#4f46e5;"></span>
    <span style="display:block;width:8px;height:2px;margin:-2px 0 0 10px;border-radius:999px;background:#2563eb;"></span>
    <span style="display:block;width:3px;height:3px;margin:4px 0 0 5px;border-radius:50%;background:#4f46e5;"></span>
    <span style="display:block;width:8px;height:2px;margin:-2px 0 0 10px;border-radius:999px;background:#2563eb;"></span>
  </span>`;
}

function buildSummaryTableHtml(reports = [], context = {}) {
  const rows = reports.length
    ? reports.map((report) => buildSummaryRowHtml(report, context)).join("")
    : `<tr><td colspan="7" style="padding:14px 12px;font-size:12px;line-height:18px;color:#475569;">No watched products were included in this report.</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-radius:6px;background:#ffffff;">
    <tr>
      <td style="padding:13px 14px 9px 14px;font-size:12px;line-height:16px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#0f172a;border-bottom:1px solid #cbd5e1;">Product change summary</td>
    </tr>
    <tr>
      <td style="padding:0 10px 8px 10px;">
        <table class="gw-summary-table" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
          <tr>
            <th align="left" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Product</th>
            <th align="left" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Status</th>
            <th align="center" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Orders<br><span style="font-weight:400;">New</span></th>
            <th align="center" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Returns<br><span style="font-weight:400;">Units</span></th>
            <th align="center" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Refunds<br><span style="font-weight:400;">Units</span></th>
            <th align="center" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Reviews<br><span style="font-weight:400;">New</span></th>
            <th align="left" style="padding:10px 8px;border-bottom:1px solid #cbd5e1;font-size:11px;line-height:14px;color:#0f172a;">Main theme</th>
          </tr>
          ${rows}
        </table>
      </td>
    </tr>
  </table>`;
}

function buildSummaryRowHtml(report = {}, context = {}) {
  const href = buildProductReportHref(report, context);
  const image = buildProductImageHtml(report, href, { size: 48 });
  const metrics = report.metrics || buildWatchEmailMetrics(report);
  const status = buildStatusBadgeHtml(report.statusLabel || getEmailStatusLabel(report), report.statusTone || getEmailStatusTone(report));
  const title = `<a href="${escapeAttribute(href)}" style="color:#050816;text-decoration:none;font-weight:800;">${escapeHtml(report.productTitle)}</a>`;
  return `<tr>
    <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="width:54px;padding-right:10px;vertical-align:middle;">${image}</td>
          <td class="gw-product-title" style="font-size:12px;line-height:16px;color:#050816;vertical-align:middle;">${title}</td>
        </tr>
      </table>
    </td>
    <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">${status}</td>
    ${buildSummaryMetricCell(metrics.orders)}
    ${buildSummaryMetricCell(metrics.returns)}
    ${buildSummaryMetricCell(metrics.refunds)}
    ${buildSummaryMetricCell(metrics.reviews)}
    <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;line-height:16px;color:#0f172a;vertical-align:middle;">${escapeHtml(getMainTheme(report))}</td>
  </tr>`;
}

function buildSummaryMetricCell(metric = {}) {
  return `<td align="center" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">
    <div style="font-size:15px;line-height:18px;font-weight:800;color:#020617;">${escapeHtml(compactMetricValue(metric.value))}</div>
    ${metric.delta ? `<div style="font-size:10px;line-height:14px;font-weight:700;color:${getMetricToneColor(metric.tone)};">${escapeHtml(compactMetricValue(metric.delta))}</div>` : `<div style="font-size:10px;line-height:14px;color:#94a3b8;">-</div>`}
  </td>`;
}

function buildProductDetailHtml(report = {}, context = {}) {
  const href = buildProductReportHref(report, context);
  return `<tr>
    <td class="gw-pad" style="padding:8px 26px 12px 26px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-left:4px solid #2563eb;border-radius:6px;background:#ffffff;">
        <tr>
          <td style="padding:16px 16px 10px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="gw-detail-image-cell" style="width:132px;padding-right:18px;vertical-align:top;">${buildProductImageHtml(report, href, { size: 112 })}</td>
                <td class="gw-detail-copy-cell" style="vertical-align:top;">
                  <h2 style="margin:0 0 6px 0;font-size:20px;line-height:24px;color:#050816;font-weight:800;">
                    <a href="${escapeAttribute(href)}" style="color:#050816;text-decoration:none;">${escapeHtml(report.productTitle)}</a>
                    <span style="display:inline-block;margin-left:8px;vertical-align:2px;">${buildStatusBadgeHtml(report.statusLabel || getEmailStatusLabel(report), report.statusTone || getEmailStatusTone(report))}</span>
                  </h2>
                  <p style="margin:0;font-size:11px;line-height:17px;color:#172033;">${escapeHtml(truncateText(report.narrative || report.summary || report.headline || "No narrative was available for this product.", 560))}</p>
                </td>
              </tr>
            </table>
            ${buildConcreteChangesHtml(report)}
            ${buildCalculatedContextHtml(report)}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildConcreteChangesHtml(report = {}) {
  const metrics = report.metrics || buildWatchEmailMetrics(report);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;border-collapse:collapse;">
    <tr>
      <td style="padding:0 0 7px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="font-size:11px;line-height:14px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#172554;white-space:nowrap;">Concrete changes</td>
            <td style="width:100%;padding-left:10px;"><div style="height:1px;background:#cbd5e1;line-height:1px;">&nbsp;</div></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      ${buildMetricCardCell(metrics.orders, { icon: "O", tone: "blue" })}
      ${buildMetricCardCell(metrics.returns, { icon: "R", tone: "orange" })}
      ${buildMetricCardCell(metrics.refunds, { icon: "$", tone: "red" })}
      ${buildMetricCardCell(metrics.reviews, { icon: "*", tone: "purple" })}
      <td class="gw-metric-cell" style="width:32%;padding:0 0 8px 8px;vertical-align:top;">${buildEvidenceQuoteBoxHtml(report)}</td>
    </tr>
  </table>`;
}

function buildMetricCardCell(metric = {}, { icon = "", tone = "blue" } = {}) {
  return `<td class="gw-metric-cell" style="width:17%;padding:0 8px 8px 0;vertical-align:top;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #d6deea;border-radius:6px;background:#ffffff;">
      <tr>
        <td style="padding:10px 9px;">
          <div style="width:28px;height:28px;border-radius:5px;background:${getMetricIconBg(tone)};color:${getMetricToneColor(tone)};font-size:13px;line-height:28px;text-align:center;font-weight:800;">${escapeHtml(icon)}</div>
          <div style="margin-top:7px;font-size:11px;line-height:14px;font-weight:800;color:#172033;">${escapeHtml(metric.label || "Metric")}</div>
          <div style="margin-top:5px;font-size:21px;line-height:24px;font-weight:800;color:#020617;">${escapeHtml(compactMetricValue(metric.value))}</div>
          ${metric.delta ? `<div style="margin-top:2px;font-size:11px;line-height:15px;font-weight:700;color:${getMetricToneColor(metric.tone || tone)};">${escapeHtml(compactMetricValue(metric.delta))}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>`;
}

function buildEvidenceQuoteBoxHtml(report = {}) {
  const bullets = getEvidenceBullets(report).slice(0, 3);
  if (!bullets.length) {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #d6deea;border-radius:6px;background:#ffffff;"><tr><td style="padding:12px;font-size:11px;line-height:16px;color:#475569;"><strong style="color:#172554;">Evidence</strong><br>No new customer-language evidence was isolated for this product.</td></tr></table>`;
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #d6deea;border-radius:6px;background:#ffffff;">
    <tr>
      <td style="padding:11px 12px;font-size:11px;line-height:16px;color:#172033;">
        <div style="font-weight:800;color:#172554;margin-bottom:4px;">Top evidence</div>
        ${bullets.map((item) => `<div style="margin:0 0 4px 0;">&bull; ${escapeHtml(truncateText(item, 130))}</div>`).join("")}
      </td>
    </tr>
  </table>`;
}

function buildCalculatedContextHtml(report = {}) {
  const changes = getSortedCalculatedChanges(report.changes);
  if (!changes.length) {
    if (reportHasAnyChange(report)) return "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:4px;border-collapse:collapse;">
      <tr><td style="font-size:11px;line-height:16px;color:#475569;">No calculated product-state movement was detected.</td></tr>
    </table>`;
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:4px;border-collapse:collapse;">
    <tr>
      <td style="padding:0 0 7px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="font-size:11px;line-height:14px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#172554;white-space:nowrap;">Calculated context</td>
            <td style="width:100%;padding-left:10px;"><div style="height:1px;background:#cbd5e1;line-height:1px;">&nbsp;</div></td>
          </tr>
        </table>
      </td>
    </tr>
    ${buildCalculatedContextRows(changes)}
  </table>`;
}

function buildCalculatedContextRows(changes = []) {
  const rows = [];
  for (let index = 0; index < changes.length; index += 3) {
    const row = changes.slice(index, index + 3);
    rows.push(`<tr>${row.map((change) => buildCalculatedContextCell(change, { width: `${100 / row.length}%` })).join("")}</tr>`);
  }
  return rows.join("");
}

function buildCalculatedContextCell(change = {}, { width = "33.333%" } = {}) {
  const tone = getCalculatedChangeTone(change);
  return `<td class="gw-context-cell" style="width:${escapeAttribute(width)};padding:0 8px 8px 0;vertical-align:top;min-width:200px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #d6deea;border-radius:6px;background:#ffffff;">
      <tr>
        <td style="padding:9px 10px;">
          <div style="font-size:10px;line-height:13px;color:#172033;font-weight:800;">${escapeHtml(change.label || change.id || "Metric")}</div>
          ${buildChangeTransitionHtml(change, tone)}
          ${change.detail ? `<div style="margin-top:4px;font-size:10px;line-height:14px;color:#64748b;">${escapeHtml(truncateText(change.detail, 120))}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>`;
}

function buildChangeTransitionHtml(change = {}, tone = "blue") {
  const from = formatChangeEndpoint(change.from);
  const to = formatChangeEndpoint(change.to);
  const delta = formatChangeEndpoint(change.delta);
  if (from && to) {
    return `<div style="margin-top:5px;font-size:10px;line-height:14px;color:#64748b;font-weight:700;">Previous &rarr; New</div>
      <div style="margin-top:2px;font-size:12px;line-height:16px;color:#0f172a;font-weight:700;">
        <span style="color:#64748b;">${escapeHtml(from)}</span>
        <span style="color:#94a3b8;padding:0 4px;">&rarr;</span>
        <span style="color:${getMetricToneColor(tone)};">${escapeHtml(to)}</span>
      </div>
      ${delta && delta !== "Changed" ? `<div style="margin-top:2px;font-size:10px;line-height:13px;color:${getMetricToneColor(tone)};font-weight:800;">${escapeHtml(delta)}</div>` : ""}`;
  }
  return `<div style="margin-top:5px;font-size:14px;line-height:17px;color:${getMetricToneColor(tone)};font-weight:800;">${escapeHtml(delta || to || from || "Changed")}</div>`;
}

function buildNoChangeHtmlPanel({ reports = [], emailContext = {} } = {}) {
  const sampleProducts = reports.slice(0, 5).map((report) => report.productTitle).filter(Boolean).join(", ");
  const href = buildWatchlistEmailAppHref("/app/watchlist", emailContext);
  return `<tr>
    <td class="gw-pad" style="padding:8px 26px 12px 26px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-left:4px solid #16a34a;border-radius:6px;background:#ffffff;">
        <tr>
          <td style="padding:14px 16px;font-size:12px;line-height:18px;color:#172033;">
            <strong style="font-size:14px;color:#050816;">No meaningful Watchlist changes detected</strong><br>
            ProductPulse completed this Watchlist run and did not isolate new orders, returns, refunds, reviews, or calculated movement that changed the product state${sampleProducts ? ` for ${escapeHtml(sampleProducts)}` : ""}.
            ${href ? `<br><a href="${escapeAttribute(href)}" style="color:#2563eb;text-decoration:none;font-weight:700;">Open Watchlist</a>` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildCreditNoticeHtml({ skippedForCredits = [], metadata = {} } = {}) {
  const skippedNames = skippedForCredits.map((item) => item.productTitle || item.productGid).filter(Boolean).join(", ");
  return `<tr>
    <td class="gw-pad" style="padding:8px 26px 12px 26px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:6px;background:#fff7ed;">
        <tr>
          <td style="padding:12px 14px;font-size:12px;line-height:18px;color:#7c2d12;">
            <strong style="color:#9a3412;">Credit notice</strong><br>
            Available credits after queueing: ${escapeHtml(safeNumber(metadata.availableCredits))}.
            ${skippedNames ? ` Products not queued: ${escapeHtml(skippedNames)}.` : " No products were queued because the shop has no available credits."}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildFailedJobsHtml(failedJobs = []) {
  return `<tr>
    <td class="gw-pad" style="padding:8px 26px 12px 26px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:6px;background:#fff1f2;">
        <tr>
          <td style="padding:12px 14px;font-size:12px;line-height:18px;color:#7f1d1d;">
            <strong style="color:#991b1b;">Failed jobs</strong><br>
            ${failedJobs.map((job) => `${escapeHtml(job.payload?.productTitle || job.id)}: ${escapeHtml(job.errorMessage || "Diagnosis failed.")}`).join("<br>")}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildProductImageHtml(report = {}, href = "", { size = EMAIL_PRODUCT_IMAGE_SIZE } = {}) {
  const imageUrl = String(report.imageUrl || "").trim();
  const alt = escapeAttribute(report.imageAlt || report.productTitle || "Product image");
  const image = imageUrl
    ? `<img class="gw-product-image" src="${escapeAttribute(imageUrl)}" width="${size}" height="${size}" alt="${alt}" style="display:block;width:${size}px;height:${size}px;object-fit:cover;border:0;border-radius:4px;background:#f1f5f9;">`
    : `<span class="gw-product-image" style="display:block;width:${size}px;height:${size}px;border-radius:4px;background:#eef2f7;color:#64748b;font-size:10px;line-height:${size}px;text-align:center;font-weight:700;">No image</span>`;
  return href ? `<a href="${escapeAttribute(href)}" style="text-decoration:none;border:0;">${image}</a>` : image;
}

function buildStatusBadgeHtml(label, tone = "neutral") {
  const colors = {
    changed: { color: "#92400e", bg: "#fef3c7" },
    success: { color: "#166534", bg: "#dcfce7" },
    warning: { color: "#9a3412", bg: "#ffedd5" },
    danger: { color: "#991b1b", bg: "#fee2e2" },
    neutral: { color: "#334155", bg: "#e2e8f0" },
  };
  const selected = colors[tone] || colors.neutral;
  return `<span style="display:inline-block;border-radius:5px;background:${selected.bg};color:${selected.color};padding:4px 8px;font-size:10px;line-height:12px;font-weight:800;">${escapeHtml(label)}</span>`;
}

function buildShopLinkHtml(shop, appBaseUrl) {
  const href = buildWatchlistEmailAppHref("/app/watchlist", { shop, appBaseUrl });
  if (!href) return escapeHtml(shop);
  return `<a href="${escapeAttribute(href)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(shop)}</a>`;
}

function buildProductReportHref(report = {}, { shop = "", appBaseUrl = "" } = {}) {
  const productKey = report.handle || report.productGid || "";
  if (!productKey) return buildWatchlistEmailAppHref("/app/watchlist", { shop, appBaseUrl });
  const encodedProduct = encodeURIComponent(productKey);
  const runId = report.id && !report.missingReport && !report.skippedForCredits
    ? `?runId=${encodeURIComponent(report.id)}`
    : "";
  return buildWatchlistEmailAppHref(`/app/watchlist/${encodedProduct}${runId}`, { shop, appBaseUrl });
}

function buildWatchlistEmailAppHref(path = "/app/watchlist", { shop = "", appBaseUrl = "" } = {}) {
  const adminHref = buildShopifyAdminEmbeddedAppUrl(path, { shop });
  if (adminHref) return adminHref;
  const fallbackHref = buildAbsoluteAppUrl(path, appBaseUrl);
  return appendQueryParams(fallbackHref, { shop });
}

function buildShopifyAdminEmbeddedAppUrl(path = "/app/watchlist", { shop = "", env = process.env } = {}) {
  const storeHandle = getShopifyAdminStoreHandle(shop);
  const appHandle = getEmailShopifyAdminAppHandle(env);
  if (!storeHandle || !appHandle) return "";
  const normalizedPath = normalizeUrlPath(path);
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/apps/${encodeURIComponent(appHandle)}${normalizedPath}`;
}

function buildAbsoluteAppUrl(path, appBaseUrl = getEmailAppBaseUrl()) {
  const base = String(appBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const normalizedPath = normalizeUrlPath(path);
  return `${base}${normalizedPath}`;
}

function getEmailAppBaseUrl(env = process.env) {
  return String(env.PRODUCT_PULSE_APP_URL || env.PRODUCT_PULSE_CRON_APP_URL || env.SHOPIFY_APP_URL || env.APP_URL || "").trim();
}

function getEmailShopifyAdminAppHandle(env = process.env) {
  return String(env.PRODUCT_PULSE_SHOPIFY_APP_HANDLE || env.SHOPIFY_ADMIN_APP_HANDLE || env.SHOPIFY_APP_HANDLE || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function getShopifyAdminStoreHandle(shop = "") {
  const raw = String(shop || "").trim().toLowerCase();
  if (!raw) return "";
  const adminMatch = raw.match(/admin\.shopify\.com\/store\/([^/?#]+)/);
  if (adminMatch?.[1]) return adminMatch[1];
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeUrlPath(path = "/") {
  const value = String(path || "/");
  return value.startsWith("/") ? value : `/${value}`;
}

function appendQueryParams(url, params = {}) {
  const text = String(url || "").trim();
  if (!text) return "";
  const [baseWithQuery, hash = ""] = text.split("#");
  const query = Object.entries(params)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  if (!query) return text;
  const separator = baseWithQuery.includes("?") ? "&" : "?";
  return `${baseWithQuery}${separator}${query}${hash ? `#${hash}` : ""}`;
}

function getEmailStatusLabel(report = {}) {
  if (report.skippedForCredits || report.status === "skipped") return "Skipped";
  if (report.status === "failed") return "Failed";
  if (report.status === "baseline") return "Baseline";
  if (reportHasAnyChange(report)) return "Changed";
  return "No changes";
}

function getEmailStatusTone(report = {}) {
  if (report.skippedForCredits || report.status === "skipped") return "warning";
  if (report.status === "failed") return "danger";
  if (report.status === "baseline") return "neutral";
  if (reportHasAnyChange(report)) return "changed";
  return "success";
}

function getMainTheme(report = {}) {
  if (report.skippedForCredits) return "Skipped because available credits were exhausted.";
  if (report.status === "failed") return report.errorMessage || "Diagnosis failed.";
  const preferredInsight = (report.sourceInsights || []).find((insight) => insight?.summary)?.summary;
  const preferredChange = (report.sourceChanges || []).find((change) => change?.detail)?.detail;
  const calculatedSummary = formatCalculatedChangesSummary(report.changes, { limit: preferredInsight || preferredChange ? 2 : 3 });
  const sourceSummary = preferredInsight || preferredChange || "";
  if (sourceSummary && calculatedSummary) {
    return truncateText(`${sourceSummary} ${calculatedSummary}`, 150);
  }
  return truncateText(
    sourceSummary
      || calculatedSummary
      || report.current?.primaryIssue
      || report.headline
      || (reportHasAnyChange(report) ? "Watchlist changes detected." : "No meaningful changes detected."),
    110,
  );
}

function getSortedCalculatedChanges(changes = []) {
  const items = Array.isArray(changes) ? changes.filter(Boolean) : [];
  return [...items].sort((left, right) => {
    const leftIndex = getCalculatedChangePriority(left);
    const rightIndex = getCalculatedChangePriority(right);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left.label || left.id || "").localeCompare(String(right.label || right.id || ""));
  });
}

function getCalculatedChangePriority(change = {}) {
  const id = String(change.id || "").trim();
  const index = CALCULATED_CHANGE_PRIORITY.indexOf(id);
  return index >= 0 ? index : CALCULATED_CHANGE_PRIORITY.length;
}

function formatCalculatedChangesSummary(changes = [], { limit = 3 } = {}) {
  return getSortedCalculatedChanges(changes)
    .slice(0, limit)
    .map((change) => `${change.label || change.id || "Metric"}: ${formatChangeTransitionText(change)}`)
    .filter((value) => value.trim() && !value.endsWith(":"))
    .join("; ");
}

function formatChangeTransitionText(change = {}) {
  const from = formatChangeEndpoint(change.from, { maxLength: 80 });
  const to = formatChangeEndpoint(change.to, { maxLength: 80 });
  const delta = formatChangeEndpoint(change.delta, { maxLength: 80 });
  if (from && to) {
    return `${from} -> ${to}${delta && delta !== "Changed" ? ` (${delta})` : ""}`;
  }
  return delta || to || from || "changed";
}

function formatChangeEndpoint(value, { maxLength = 54 } = {}) {
  return truncateText(String(value ?? "").replace(/\s+/g, " ").trim(), maxLength);
}

function getCalculatedChangeTone(change = {}) {
  const id = String(change.id || "").toLowerCase();
  const direction = String(change.direction || "").toLowerCase();
  if (!direction || direction === "neutral") return "blue";
  if (id.includes("momentum") || id.includes("confidence")) {
    return direction === "up" ? "green" : "orange";
  }
  if (id.includes("risk") || id.includes("return") || id.includes("refund") || id.includes("negative") || id.includes("impact") || id.includes("revenue") || id.includes("margin") || id.includes("signal")) {
    return direction === "up" ? "red" : "green";
  }
  return direction === "up" ? "blue" : "green";
}

function getEvidenceBullets(report = {}) {
  const insightBullets = (report.sourceInsights || [])
    .flatMap((insight) => Array.isArray(insight.bullets) ? insight.bullets : [])
    .filter(Boolean);
  const itemTexts = (report.sourceChanges || [])
    .flatMap((change) => Array.isArray(change.items) ? change.items : [])
    .map((item) => item.text || item.analysisText || item.reason || item.reasonText || "")
    .filter(Boolean);
  return [...insightBullets, ...itemTexts];
}

function getMetricToneColor(tone = "neutral") {
  if (tone === "green") return "#166534";
  if (tone === "orange") return "#c2410c";
  if (tone === "red") return "#b91c1c";
  if (tone === "purple") return "#6d28d9";
  if (tone === "blue") return "#2563eb";
  return "#475569";
}

function getMetricIconBg(tone = "neutral") {
  if (tone === "green") return "#dcfce7";
  if (tone === "orange") return "#ffedd5";
  if (tone === "red") return "#fee2e2";
  if (tone === "purple") return "#ede9fe";
  if (tone === "blue") return "#dbeafe";
  return "#e2e8f0";
}

function compactMetricValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "0";
  return text
    .replace(/\border(s)?\b/gi, "")
    .replace(/\breturned unit(s)?\b/gi, "")
    .replace(/\brefunded unit(s)?\b/gi, "")
    .replace(/\breview(s)?\b/gi, "")
    .replace(/\bunit(s)?\b/gi, "units")
    .replace(/\s+/g, " ")
    .trim();
}

function formatEmailDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(safeDate);
}

function truncateText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function reportHasAnyChange(report = {}) {
  return safeNumber(report.changeCount) > 0
    || safeNumber(report.sourceChangeCount) > 0
    || (Array.isArray(report.sourceChanges) && report.sourceChanges.length > 0)
    || (Array.isArray(report.changes) && report.changes.length > 0);
}

function reportHasNewIssue(report = {}) {
  if (!reportHasAnyChange(report)) return false;
  const issueSources = new Set(["new-returns", "new-refunds", "new-reviews", "product-content-updated"]);
  if ((report.sourceChanges || []).some((change) => issueSources.has(change.id) && change.tone !== "green")) return true;
  const previousIssue = normalizeIssue(report.previous?.primaryIssue);
  const currentIssue = normalizeIssue(report.current?.primaryIssue);
  return Boolean(currentIssue && currentIssue !== "no primary issue" && currentIssue !== previousIssue);
}

function reportHasRiskIncrease(report = {}) {
  if ((report.changes || []).some((change) => change.id === "risk-score" && change.direction === "up")) return true;
  const previousRisk = safeNumber(report.previous?.riskScore);
  const currentRisk = safeNumber(report.current?.riskScore);
  return currentRisk > previousRisk;
}

function reportHasMediumOrHighRisk(report = {}) {
  const label = String(report.current?.riskLabel || "").toLowerCase();
  return label.includes("medium") || label.includes("high") || safeNumber(report.current?.riskScore) >= 50;
}

function getTriggerRuleEmailLabel(value) {
  const rule = String(value || "new_or_rising_risk");
  if (rule === "new_issue_only") return "New issue detected";
  if (rule === "risk_score_increase") return "Risk score increased";
  if (rule === "medium_or_high_risk") return "Medium or high risk detected";
  if (rule === "any_watch_change") return "Any watched product change";
  return "New issue or rising risk";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => {
      if (typeof value === "string") return value;
      if (value?.productGid) return value.productGid;
      if (value?.id) return value.id;
      return "";
    })
    .filter(Boolean)
    .map(String))];
}

function normalizeIssue(value) {
  return String(value || "").trim().toLowerCase();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

export const __productPulseWatchlistAlertsTestHooks = {
  buildWatchlistAlertDecision,
  buildWatchlistRunEmail,
  buildWatchlistReportHtmlEmail,
  formatWatchReportActivity,
  reportHasNewIssue,
  reportHasRiskIncrease,
};
