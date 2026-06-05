import prisma from "../db.server";
import { getRiskLabelForScore, getRiskToneForScore } from "./product-pulse-settings.server";

export const PRODUCT_TIMELINE_DEFAULT_LIMIT = 80;
export const PRODUCT_TIMELINE_MIN_MEANINGFUL_IMPORTANCE = 40;

const CATEGORY_LABELS = {
  scan: "Scans",
  diagnosis: "Diagnoses",
  watchlist: "Watchlist",
  risk: "Risk",
  action: "Actions",
  reviews: "Reviews",
  returns: "Returns",
  refunds: "Refunds",
  momentum: "Sales Momentum",
  impact: "Estimated Margin Exposure",
  evidence: "Evidence",
  catalog: "Catalog",
};

const CATEGORY_ICONS = {
  scan: "search",
  diagnosis: "wand",
  watchlist: "binoculars",
  risk: "alert-triangle",
  action: "check-circle",
  reviews: "star",
  returns: "return",
  refunds: "cash-dollar",
  momentum: "chart-line",
  impact: "cash-dollar",
  evidence: "file",
  catalog: "product",
};

const RISK_SCORE_DELTA_THRESHOLD = 5;
const MOMENTUM_SCORE_DELTA_THRESHOLD = 10;
const CONFIDENCE_DELTA_THRESHOLD = 10;
const EVIDENCE_STRENGTH_DELTA_THRESHOLD = 10;
const RETURN_RATE_DELTA_THRESHOLD = 5;
const RETURN_UNITS_DELTA_THRESHOLD = 2;
const REFUND_UNITS_DELTA_THRESHOLD = 1;
const REFUND_AMOUNT_DELTA_THRESHOLD = 50;
const NEGATIVE_REVIEW_DELTA_THRESHOLD = 2;
const REVIEW_RATING_DELTA_THRESHOLD = 0.5;
const FINANCIAL_DELTA_AMOUNT_THRESHOLD = 100;
const FINANCIAL_DELTA_PERCENT_THRESHOLD = 20;
const ACTION_APPLIED_GROUP_WINDOW_DAYS = 7;
const ACTION_APPLIED_GROUP_WINDOW_MS = ACTION_APPLIED_GROUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const SCORE_COMPLETION_EVENT_TYPES = new Set(["quickscan_completed", "watchlist_baseline_captured"]);

export async function getProductTimelineForShop(shop, productRef, options = {}) {
  const db = options.db || prisma;
  const product = await resolveTimelineProduct(shop, productRef, db);
  if (!product) {
    return {
      product: null,
      events: [],
      groupedEvents: [],
      summary: null,
      filters: buildTimelineFilters([]),
      pagination: { limit: normalizeLimit(options.limit), offset: normalizeOffset(options.offset), hasMore: false },
    };
  }

  if (options.backfill !== false) {
    await ensureProductTimelineSeededForProduct({ shop, product, db, force: options.forceBackfill });
  }

  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const where = buildTimelineWhere(shop, product.productGid, options);
  const [rows, total] = await Promise.all([
    db.productTimelineEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: offset,
      take: limit,
    }),
    db.productTimelineEvent.count({ where }),
  ]);
  const events = rows.map((event) => normalizeTimelineEvent(event, product));

  return {
    product: {
      productGid: product.productGid,
      title: product.productTitle,
      handle: product.handle || "",
    },
    events,
    groupedEvents: groupTimelineEventsByDay(events),
    summary: buildTimelineSummary(events),
    filters: buildTimelineFilters(events),
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + rows.length < total,
    },
  };
}

export async function ensureProductTimelineSeededForProduct({ shop, product, db = prisma, force = false } = {}) {
  if (!shop || !product?.productGid || !db.productTimelineEvent) return { count: 0, skipped: true };

  const existingCount = force
    ? 0
    : await db.productTimelineEvent.count({
      where: { shop, productGid: product.productGid },
    });
  if (existingCount > 0 && !force) return { count: 0, skipped: true, reason: "timeline_already_seeded" };

  const [scoreHistory, diagnoses, actions, watchActivities] = await Promise.all([
    db.productScoreHistory.findMany({
      where: { shop, productGid: product.productGid },
      orderBy: { recordedAt: "asc" },
      take: 240,
    }),
    db.productDiagnosis.findMany({
      where: { shop, productGid: product.productGid, status: "Completed" },
      orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }],
      take: 80,
    }),
    db.productAction.findMany({
      where: { shop, productGid: product.productGid },
      orderBy: [{ createdAt: "asc" }],
      take: 160,
    }),
    db.productWatchActivity.findMany({
      where: { shop, productGid: product.productGid },
      orderBy: { createdAt: "asc" },
      take: 160,
    }),
  ]);

  const eventGroups = [
    buildTimelineEventsForScoreHistoryRows(scoreHistory, { shop, product }),
    buildTimelineEventsForDiagnosisRows(diagnoses, { shop, product }),
    buildTimelineEventsForProductActions({ shop, product, actionRecords: actions }),
    watchActivities.flatMap((activity) => buildTimelineEventsForWatchActivity({ shop, product, activity })),
  ];
  return createProductTimelineEvents(eventGroups.flat(), { db });
}

export async function recordTimelineForLatestScoreSnapshots(shop, snapshots = [], options = {}) {
  const db = options.db || prisma;
  const productGids = Array.from(new Set((Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => snapshot?.productGid)
    .filter(Boolean)));
  if (!shop || !productGids.length || !db.productTimelineEvent) return { count: 0 };

  const eventGroups = [];
  for (const productGid of productGids) {
    const productSnapshots = snapshots.filter((snapshot) => snapshot?.productGid === productGid);
    const product = productSnapshots[productSnapshots.length - 1];
    const rows = await db.productScoreHistory.findMany({
      where: { shop, productGid },
      orderBy: { recordedAt: "desc" },
      take: 2,
    });
    const current = rows[0] || buildScoreHistoryRowFromSnapshot(product, options);
    const previous = rows[1] || null;
    eventGroups.push(buildTimelineEventsForScoreHistoryPair({
      shop,
      product,
      current,
      previous,
      scanJobId: options.scanJobId || options.jobId || null,
      sourceOverride: options.source || null,
    }));
  }

  return createProductTimelineEvents(eventGroups.flat(), { db });
}

export async function recordTimelineForDiagnosis({ shop, snapshot, diagnosis, previousDiagnosis = null, jobId = null, db = prisma } = {}) {
  if (!shop || !snapshot?.productGid || !diagnosis || !db.productTimelineEvent) return { count: 0 };
  const previousDiagnoses = await db.productDiagnosis.findMany({
    where: {
      shop,
      productGid: snapshot.productGid,
      status: "Completed",
      id: { not: diagnosis.id },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 80,
    select: {
      id: true,
      productGid: true,
      productTitle: true,
      riskScore: true,
      confidence: true,
      likelyCause: true,
      issues: true,
      createdAt: true,
      completedAt: true,
    },
  });
  const issueHistory = buildDiagnosisIssueHistoryContext(previousDiagnoses);
  const previous = previousDiagnosis || issueHistory.previous || null;
  const events = buildTimelineEventsForDiagnosisRows([diagnosis], {
    shop,
    product: snapshot,
    previousDiagnosisById: new Map([[diagnosis.id, previous]]),
    issueHistoryById: new Map([[diagnosis.id, issueHistory]]),
    scanJobId: jobId,
  });
  return createProductTimelineEvents(events, { db });
}

export async function recordTimelineForNoChangeDiagnosis({ shop, snapshot, diagnosisId = null, jobId = null, db = prisma } = {}) {
  if (!shop || !snapshot?.productGid || !db.productTimelineEvent) return { count: 0 };
  return createProductTimelineEvents([{
    shop,
    productGid: snapshot.productGid,
    productTitle: snapshot.productTitle || "Shopify product",
    handle: optionalString(snapshot.handle),
    eventType: "diagnosis_reused_no_changes",
    category: "diagnosis",
    source: "ProductPulse diagnosis",
    title: "Full diagnosis reused",
    summary: "No product, order, return, refund, review or source changes were detected, so ProductPulse reused the previous diagnosis.",
    occurredAt: new Date(),
    severityTone: "neutral",
    importance: 35,
    confidence: nullableInteger(snapshot.confidence),
    metadata: {
      noChangesDetected: true,
      productSnapshot: buildProductSnapshotSummary(snapshot),
    },
    dedupeKey: `diagnosis-reuse:${jobId || diagnosisId || snapshot.productGid}:${new Date().toISOString().slice(0, 16)}`,
    scanJobId: optionalString(jobId),
    diagnosisId: optionalString(diagnosisId),
  }], { db });
}

export async function recordTimelineForWatchActivities(shop, activities = [], options = {}) {
  const db = options.db || prisma;
  if (!shop || !db.productTimelineEvent) return { count: 0 };
  const rows = Array.isArray(activities) ? activities : [activities];
  const productGids = Array.from(new Set(rows.map((activity) => activity?.productGid).filter(Boolean)));
  const snapshots = productGids.length
    ? await db.productRiskSnapshot.findMany({ where: { shop, productGid: { in: productGids } } })
    : [];
  const productByGid = new Map(snapshots.map((snapshot) => [snapshot.productGid, snapshot]));
  const events = rows.flatMap((activity) => buildTimelineEventsForWatchActivity({
    shop,
    product: productByGid.get(activity?.productGid) || activity,
    activity,
  }));
  return createProductTimelineEvents(events, { db });
}

export async function recordTimelineForProductAction({ shop, snapshot, actionRecord, action = null, db = prisma } = {}) {
  if (!shop || !snapshot?.productGid || !actionRecord || !db.productTimelineEvent) return { count: 0 };
  if (isGroupedAppliedActionStatus(getActionRecordStatus(actionRecord))) {
    const lookupWindow = getActionAppliedLookupWindow(actionRecord.appliedAt || actionRecord.createdAt);
    const groupActions = await getAppliedActionGroupRecords({ shop, productGid: snapshot.productGid, actionRecord, groupWindow: lookupWindow, db });
    const groupEvents = buildTimelineEventsForProductActions({ shop, product: snapshot, actionRecords: groupActions, action });
    const event = groupEvents.find((item) => (item.metadata?.actionIds || []).includes(actionRecord.id)) || groupEvents[groupEvents.length - 1];
    return upsertProductTimelineEvent(event, { db });
  }
  return createProductTimelineEvents(buildTimelineEventsForProductAction({
    shop,
    product: snapshot,
    actionRecord,
    action,
  }), { db });
}

export async function recordShopifyProductTimelineEvent({ shop, product, eventType, title, summary, metadata = {}, occurredAt = new Date(), db = prisma } = {}) {
  if (!shop || !product?.productGid || !eventType || !title || !db.productTimelineEvent) return { count: 0 };
  return createProductTimelineEvents([{
    shop,
    productGid: product.productGid,
    productTitle: product.productTitle || product.title || "Shopify product",
    handle: optionalString(product.handle),
    eventType,
    category: "catalog",
    source: "Shopify",
    title,
    summary: optionalString(summary),
    occurredAt: parseDate(occurredAt) || new Date(),
    severityTone: metadata.severityTone || "neutral",
    importance: nullableInteger(metadata.importance) ?? 55,
    beforeValue: metadata.beforeValue || null,
    afterValue: metadata.afterValue || null,
    metadata: {
      ...metadata,
      integrationPoint: "future_shopify_webhook_or_sync",
      supportedTopics: [
        "products/create",
        "products/update",
        "products/delete",
        "inventory_levels/update",
        "refunds/create",
        "orders/updated",
      ],
    },
    dedupeKey: `shopify:${eventType}:${metadata.shopifyEventId || metadata.webhookId || occurredAt.toISOString?.() || new Date().toISOString()}`,
    shopifyEventId: optionalString(metadata.shopifyEventId || metadata.webhookId),
  }], { db });
}

async function createProductTimelineEvents(events = [], { db = prisma } = {}) {
  if (!db.productTimelineEvent) return { count: 0, skipped: true, reason: "timeline_model_unavailable" };
  const rows = (Array.isArray(events) ? events : [])
    .map(normalizeTimelineEventForCreate)
    .filter(Boolean);
  if (!rows.length) return { count: 0 };
  return db.productTimelineEvent.createMany({ data: rows, skipDuplicates: true });
}

async function upsertProductTimelineEvent(event = {}, { db = prisma } = {}) {
  if (!db.productTimelineEvent) return { count: 0, skipped: true, reason: "timeline_model_unavailable" };
  const row = normalizeTimelineEventForCreate(event);
  if (!row) return { count: 0 };
  if (typeof db.productTimelineEvent.upsert !== "function") {
    return createProductTimelineEvents([row], { db });
  }
  const { shop, productGid, dedupeKey, ...update } = row;
  await db.productTimelineEvent.upsert({
    where: { shop_productGid_dedupeKey: { shop, productGid, dedupeKey } },
    create: row,
    update,
  });
  return { count: 1 };
}

function buildTimelineEventsForScoreHistoryRows(rows = [], context = {}) {
  const sortedRows = [...(Array.isArray(rows) ? rows : [])]
    .filter((row) => row?.productGid)
    .sort((first, second) => getTime(first.recordedAt) - getTime(second.recordedAt));
  return sortedRows.flatMap((row, index) => buildTimelineEventsForScoreHistoryPair({
    ...context,
    current: row,
    previous: index > 0 ? sortedRows[index - 1] : null,
  }));
}

function buildTimelineEventsForScoreHistoryPair({ shop, product, current, previous = null, scanJobId = null, sourceOverride = null } = {}) {
  if (!shop || !current?.productGid) return [];
  const currentPoint = normalizeScorePoint(current, product);
  const previousPoint = previous ? normalizeScorePoint(previous, product) : null;
  const source = sourceOverride || getTimelineSourceLabel(currentPoint.source);
  const base = {
    shop,
    productGid: currentPoint.productGid,
    productTitle: currentPoint.productTitle,
    handle: optionalString(currentPoint.handle || product?.handle),
    source,
    occurredAt: parseDate(currentPoint.recordedAt) || new Date(),
    confidence: nullableInteger(currentPoint.confidence),
    scanJobId: optionalString(scanJobId),
    diagnosisId: optionalString(currentPoint.diagnosisId),
  };
  const eventPrefix = currentPoint.id ? `score:${currentPoint.id}` : `score:${currentPoint.source}:${currentPoint.productGid}:${currentPoint.recordedAt}`;
  const shouldRecordCompletionEvent = currentPoint.source === "quickscan" || currentPoint.source === "watchlist-baseline";
  const events = shouldRecordCompletionEvent ? [{
    ...base,
    eventType: currentPoint.source === "quickscan" ? "quickscan_completed" : "watchlist_baseline_captured",
    category: currentPoint.source === "watchlist-baseline" ? "watchlist" : "scan",
    title: currentPoint.source === "quickscan" ? "Catalog Scan completed" : "Watchlist baseline captured",
    summary: `${source} stored ${currentPoint.riskScore}/100 risk${currentPoint.primaryIssue ? ` for ${currentPoint.primaryIssue}` : ""}.`,
    severityTone: getRiskToneForScore(currentPoint.riskScore),
    importance: currentPoint.source === "quickscan" ? 42 : 34,
    afterValue: { riskScore: currentPoint.riskScore, primaryIssue: currentPoint.primaryIssue || null },
    metadata: {
      productSnapshot: buildProductSnapshotSummary(product || currentPoint),
      sourceKey: currentPoint.source,
      riskLabel: getRiskLabelForScore(currentPoint.riskScore),
    },
    dedupeKey: `${eventPrefix}:recorded`,
  }] : [];

  if (!previousPoint) return events;

  const riskDelta = currentPoint.riskScore - previousPoint.riskScore;
  const previousRiskLabel = getRiskLabelForScore(previousPoint.riskScore);
  const currentRiskLabel = getRiskLabelForScore(currentPoint.riskScore);
  if (Math.abs(riskDelta) >= RISK_SCORE_DELTA_THRESHOLD || previousRiskLabel !== currentRiskLabel) {
    events.push({
      ...base,
      eventType: riskDelta >= 0 ? "risk_score_increased" : "risk_score_decreased",
      category: "risk",
      title: previousRiskLabel !== currentRiskLabel
        ? `Product moved to ${currentRiskLabel}`
        : riskDelta >= 0
          ? "Product risk increased"
          : "Product risk decreased",
      summary: `Risk moved from ${previousPoint.riskScore}/100 to ${currentPoint.riskScore}/100${previousRiskLabel !== currentRiskLabel ? ` (${previousRiskLabel} to ${currentRiskLabel})` : ""}.`,
      severityTone: riskDelta >= 0 ? getRiskToneForScore(currentPoint.riskScore) : "success",
      importance: previousRiskLabel !== currentRiskLabel ? 78 : Math.min(76, 52 + Math.abs(riskDelta)),
      beforeValue: { riskScore: previousPoint.riskScore, riskLabel: previousRiskLabel },
      afterValue: { riskScore: currentPoint.riskScore, riskLabel: currentRiskLabel },
      metadata: { delta: riskDelta, previous: previousPoint, current: currentPoint },
      dedupeKey: `${eventPrefix}:risk-change`,
    });
  }

  if (currentPoint.primaryIssue && previousPoint.primaryIssue && normalizeText(currentPoint.primaryIssue) !== normalizeText(previousPoint.primaryIssue)) {
    events.push({
      ...base,
      eventType: "main_issue_changed",
      category: "risk",
      title: "Main issue changed",
      summary: `Main issue changed from ${previousPoint.primaryIssue} to ${currentPoint.primaryIssue}.`,
      severityTone: getRiskToneForScore(currentPoint.riskScore),
      importance: 68,
      beforeValue: { primaryIssue: previousPoint.primaryIssue },
      afterValue: { primaryIssue: currentPoint.primaryIssue },
      metadata: { previousPrimaryIssue: previousPoint.primaryIssue, currentPrimaryIssue: currentPoint.primaryIssue },
      dedupeKey: `${eventPrefix}:main-issue-change`,
    });
  }

  addMetricDeltaEvent(events, {
    base,
    eventPrefix,
    previousPoint,
    currentPoint,
    key: "productMomentumScore",
    threshold: MOMENTUM_SCORE_DELTA_THRESHOLD,
    category: "momentum",
    eventTypeUp: "momentum_increased",
    eventTypeDown: "momentum_decreased",
    titleUp: "Sales Momentum increased",
    titleDown: "Sales Momentum decreased",
    unit: "points",
    importance: 58,
    positiveUp: true,
  });

  if (currentPoint.productMomentumTier && previousPoint.productMomentumTier && currentPoint.productMomentumTier !== previousPoint.productMomentumTier) {
    events.push({
      ...base,
      eventType: "momentum_tier_changed",
      category: "momentum",
      title: "Sales Momentum tier changed",
      summary: `Sales Momentum moved from ${previousPoint.productMomentumTier} to ${currentPoint.productMomentumTier}.`,
      severityTone: "info",
      importance: 64,
      beforeValue: { tier: previousPoint.productMomentumTier },
      afterValue: { tier: currentPoint.productMomentumTier },
      metadata: { previousTier: previousPoint.productMomentumTier, currentTier: currentPoint.productMomentumTier },
      dedupeKey: `${eventPrefix}:momentum-tier-change`,
    });
  }

  addReturnPressureEvent(events, { base, eventPrefix, previousPoint, currentPoint });
  addRefundExposureEvent(events, { base, eventPrefix, previousPoint, currentPoint });
  addReviewSignalEvents(events, { base, eventPrefix, previousPoint, currentPoint });

  addMetricDeltaEvent(events, {
    base,
    eventPrefix,
    previousPoint,
    currentPoint,
    key: "evidenceStrengthScore",
    threshold: EVIDENCE_STRENGTH_DELTA_THRESHOLD,
    category: "evidence",
    eventTypeUp: "evidence_strength_increased",
    eventTypeDown: "evidence_strength_decreased",
    titleUp: "Evidence support increased",
    titleDown: "Evidence support decreased",
    unit: "points",
    importance: 52,
    positiveUp: true,
  });

  if (Math.abs(numberDelta(previousPoint.confidence, currentPoint.confidence)) >= CONFIDENCE_DELTA_THRESHOLD) {
    const delta = numberDelta(previousPoint.confidence, currentPoint.confidence);
    events.push({
      ...base,
      eventType: delta >= 0 ? "diagnosis_confidence_increased" : "diagnosis_confidence_decreased",
      category: "evidence",
      title: delta >= 0 ? "Diagnosis confidence increased" : "Diagnosis confidence decreased",
      summary: `Confidence moved from ${formatInteger(previousPoint.confidence)}% to ${formatInteger(currentPoint.confidence)}%.`,
      severityTone: delta >= 0 ? "success" : "warning",
      importance: 50,
      beforeValue: { confidence: previousPoint.confidence },
      afterValue: { confidence: currentPoint.confidence },
      metadata: { delta },
      dedupeKey: `${eventPrefix}:confidence-change`,
    });
  }

  if (hasProductContentChanged(previousPoint, currentPoint)) {
    events.push({
      ...base,
      eventType: "product_content_changed",
      category: "catalog",
      source: "Shopify product data",
      title: "Product updated",
      summary: getProductContentChangeSummary(previousPoint, currentPoint),
      severityTone: "info",
      importance: 58,
      beforeValue: { signature: previousPoint.productContentSignature || null, productUpdatedAt: previousPoint.productUpdatedAt || null },
      afterValue: { signature: currentPoint.productContentSignature || null, productUpdatedAt: currentPoint.productUpdatedAt || null },
      metadata: {
        productUpdatedAt: currentPoint.productUpdatedAt || null,
        reason: currentPoint.productContentReason || null,
      },
      dedupeKey: `${eventPrefix}:product-content-change`,
    });
  }

  if (!hasMeaningfulScoreChangeEvents(events)) {
    addFinancialExposureEvent(events, { base, eventPrefix, previousPoint, currentPoint });
  }

  return events;
}

function buildTimelineEventsForDiagnosisRows(diagnoses = [], { shop, product, previousDiagnosisById = new Map(), issueHistoryById = new Map(), scanJobId = null } = {}) {
  const sorted = [...(Array.isArray(diagnoses) ? diagnoses : [])]
    .filter((diagnosis) => diagnosis?.id)
    .sort((first, second) => getTime(first.completedAt || first.createdAt) - getTime(second.completedAt || second.createdAt));
  const events = [];
  let previousInSequence = null;
  const seenIssueKeys = new Set();
  const resolvedIssueKeys = new Set();
  sorted.forEach((diagnosis) => {
    const history = issueHistoryById.get(diagnosis.id) || {
      priorIssueKeys: new Set(seenIssueKeys),
      resolvedIssueKeys: new Set(resolvedIssueKeys),
    };
    const previous = previousDiagnosisById.get(diagnosis.id) || previousInSequence;
    events.push(...buildTimelineEventsForDiagnosis({ shop, product, diagnosis, previous, issueHistory: history, scanJobId }));

    const currentIssueKeys = getDiagnosisIssueKeySet(diagnosis);
    const previousIssueKeys = getDiagnosisIssueKeySet(previousInSequence);
    previousIssueKeys.forEach((key) => {
      if (!currentIssueKeys.has(key)) resolvedIssueKeys.add(key);
    });
    currentIssueKeys.forEach((key) => seenIssueKeys.add(key));
    previousInSequence = diagnosis;
  });
  return events;
}

function buildTimelineEventsForDiagnosis({ shop, product, diagnosis, previous = null, issueHistory = {}, scanJobId = null } = {}) {
  if (!shop || !diagnosis?.id) return [];
  const occurredAt = parseDate(diagnosis.completedAt || diagnosis.createdAt) || new Date();
  const productTitle = diagnosis.productTitle || product?.productTitle || product?.title || "Shopify product";
  const base = {
    shop,
    productGid: diagnosis.productGid || product?.productGid,
    productTitle,
    handle: optionalString(product?.handle),
    source: "ProductPulse diagnosis",
    occurredAt,
    confidence: nullableInteger(diagnosis.confidence),
    scanJobId: optionalString(scanJobId),
    diagnosisId: diagnosis.id,
  };
  const events = [];
  const priorIssueKeys = issueHistory.priorIssueKeys instanceof Set ? issueHistory.priorIssueKeys : new Set();
  const alreadyResolvedIssueKeys = issueHistory.resolvedIssueKeys instanceof Set ? issueHistory.resolvedIssueKeys : new Set();
  const currentIssues = getDiagnosisIssueRows(diagnosis);
  const previousPrimaryIssue = getDiagnosisPrimaryIssue(previous);
  const currentPrimaryIssue = getDiagnosisPrimaryIssue(diagnosis);
  if (previous && previousPrimaryIssue && currentPrimaryIssue && normalizeText(previousPrimaryIssue) !== normalizeText(currentPrimaryIssue)) {
    events.push({
      ...base,
      eventType: "main_issue_changed",
      category: "risk",
      title: "Main issue changed",
      summary: `Main issue changed from ${previousPrimaryIssue} to ${currentPrimaryIssue}.`,
      severityTone: getRiskToneForScore(diagnosis.riskScore),
      importance: 68,
      beforeValue: { primaryIssue: previousPrimaryIssue },
      afterValue: { primaryIssue: currentPrimaryIssue },
      metadata: { previousPrimaryIssue, currentPrimaryIssue },
      dedupeKey: `diagnosis:${diagnosis.id}:main-issue-change`,
    });
  }
  const newIssues = uniqueDiagnosisIssues(currentIssues.filter((issue) => !priorIssueKeys.has(issue.key))).slice(0, 6);
  if (newIssues.length) {
    events.push({
      ...base,
      eventType: previous ? "new_issues_detected" : "issues_detected",
      category: "risk",
      title: previous
        ? `${newIssues.length === 1 ? "New issue detected" : "New issues detected"}`
        : `${newIssues.length === 1 ? "Issue detected" : "Issues detected"}`,
      summary: summarizeIssueList(newIssues, "detected"),
      severityTone: getRiskToneForScore(diagnosis.riskScore),
      importance: previous ? 70 : 56,
      afterValue: { issues: newIssues.map((issue) => issue.label) },
      metadata: {
        issueCount: newIssues.length,
        issues: newIssues,
      },
      dedupeKey: `diagnosis:${diagnosis.id}:issues-detected:${newIssues.map((issue) => issue.key).join(",")}`,
    });
  }

  if (previous) {
    const currentIssueKeys = new Set(currentIssues.map((issue) => issue.key));
    const resolvedIssues = uniqueDiagnosisIssues(getDiagnosisIssueRows(previous)
      .filter((issue) => !currentIssueKeys.has(issue.key) && !alreadyResolvedIssueKeys.has(issue.key)))
      .slice(0, 6);
    if (resolvedIssues.length) {
      events.push({
        ...base,
        eventType: "issues_resolved",
        category: "risk",
        title: resolvedIssues.length === 1 ? "Issue no longer detected" : "Issues no longer detected",
        summary: summarizeIssueList(resolvedIssues, "resolved"),
        severityTone: "success",
        importance: 62,
        beforeValue: { issues: resolvedIssues.map((issue) => issue.label) },
        metadata: {
          issueCount: resolvedIssues.length,
          issues: resolvedIssues,
        },
        dedupeKey: `diagnosis:${diagnosis.id}:issues-resolved:${resolvedIssues.map((issue) => issue.key).join(",")}`,
      });
    }
  }

  return events;
}

function buildTimelineEventsForProductActions({ shop, product, actionRecords = [], action = null } = {}) {
  const records = [...(Array.isArray(actionRecords) ? actionRecords : [])].filter((record) => record?.productGid);
  if (!records.length) return [];
  const appliedRecords = [];
  const events = [];

  records.forEach((record) => {
    if (isGroupedAppliedActionStatus(getActionRecordStatus(record))) {
      appliedRecords.push(record);
      return;
    }
    events.push(...buildTimelineEventsForProductAction({ shop, product, actionRecord: record, action }));
  });

  groupAppliedActionRecords(appliedRecords).forEach((groupRecords) => {
    const event = buildTimelineEventForAppliedActionGroup({ shop, product, actionRecords: groupRecords, action });
    if (event) events.push(event);
  });

  return events.sort((first, second) => getTime(first.occurredAt) - getTime(second.occurredAt));
}

function groupAppliedActionRecords(actionRecords = []) {
  const sorted = [...(Array.isArray(actionRecords) ? actionRecords : [])]
    .filter((record) => record?.productGid)
    .sort((first, second) => getTime(first.appliedAt || first.createdAt) - getTime(second.appliedAt || second.createdAt));
  const groups = [];
  sorted.forEach((record) => {
    const recordTime = getTime(record.appliedAt || record.createdAt);
    const current = groups[groups.length - 1];
    const groupStart = current?.length ? getTime(current[0].appliedAt || current[0].createdAt) : 0;
    if (!current || (recordTime && groupStart && recordTime - groupStart >= ACTION_APPLIED_GROUP_WINDOW_MS)) {
      groups.push([record]);
      return;
    }
    current.push(record);
  });
  return groups;
}

function buildTimelineEventForAppliedActionGroup({ shop, product, actionRecords = [], action = null } = {}) {
  const records = [...(Array.isArray(actionRecords) ? actionRecords : [])]
    .filter((record) => record?.productGid)
    .sort((first, second) => getTime(first.appliedAt || first.createdAt) - getTime(second.appliedAt || second.createdAt));
  if (!shop || !records.length) return null;
  const firstRecord = records[0];
  const lastRecord = records[records.length - 1];
  const occurredAt = parseDate(lastRecord.appliedAt || lastRecord.createdAt) || new Date();
  const labels = records.map((record) => getActionRecordLabel(record, action)).filter(Boolean);
  const visibleLabels = Array.from(new Set(labels)).slice(0, 4);
  const overflow = Math.max(0, labels.length - visibleLabels.length);
  const count = records.length;
  const hasShopifyChange = records.some((record) => Boolean((record.payload || {}).appliedChange));
  const groupWindow = getActionAppliedGroupWindow(firstRecord.appliedAt || firstRecord.createdAt);
  const dateRange = getDateRangeSummary(records.map((record) => record.appliedAt || record.createdAt));
  const status = getActionRecordStatus(lastRecord);
  return {
    shop,
    productGid: firstRecord.productGid,
    productTitle: product?.productTitle || product?.title || firstRecord.payload?.productTitle || "Shopify product",
    handle: optionalString(product?.handle || firstRecord.payload?.handle),
    eventType: count > 1 ? "recommended_actions_applied" : "recommended_action_applied",
    category: "action",
    source: hasShopifyChange ? "Shopify actions" : "ProductPulse actions",
    title: count > 1 ? "Recommended actions applied" : "Recommended action applied",
    summary: `${formatInteger(count)} recommended action${count === 1 ? "" : "s"} applied${dateRange ? ` ${dateRange}` : ""}: ${visibleLabels.join(", ")}${overflow ? ` and ${overflow} more` : ""}.`,
    occurredAt,
    severityTone: getActionTimelineTone(status),
    importance: count > 1 ? 74 : getActionTimelineImportance(status, firstRecord.payload || {}),
    beforeValue: null,
    afterValue: {
      status,
      appliedActionCount: count,
      appliedChanges: records.map((record) => (record.payload || {}).appliedChange).filter(Boolean),
    },
    metadata: {
      actionCount: count,
      labels,
      actionIds: records.map((record) => record.id).filter(Boolean),
      actionTypes: records.map((record) => record.actionType).filter(Boolean),
      groupWindowDays: ACTION_APPLIED_GROUP_WINDOW_DAYS,
      groupWindowStart: groupWindow.start.toISOString(),
      groupWindowEnd: groupWindow.end.toISOString(),
      grouped: count > 1,
    },
    dedupeKey: `action:applied-group:${getActionAppliedGroupKey(firstRecord.appliedAt || firstRecord.createdAt)}`,
    actionId: count === 1 ? firstRecord.id || null : null,
    diagnosisId: count === 1 ? firstRecord.diagnosisId || firstRecord.payload?.diagnosisId || null : null,
  };
}

function buildTimelineEventsForProductAction({ shop, product, actionRecord, action = null } = {}) {
  if (!shop || !actionRecord?.productGid) return [];
  const payload = actionRecord.payload || {};
  const status = getActionRecordStatus(actionRecord);
  const label = getActionRecordLabel(actionRecord, action);
  const occurredAt = parseDate(actionRecord.appliedAt || actionRecord.createdAt) || new Date();
  const eventType = getActionTimelineEventType(status);
  return [{
    shop,
    productGid: actionRecord.productGid,
    productTitle: product?.productTitle || product?.title || payload.productTitle || "Shopify product",
    handle: optionalString(product?.handle || payload.handle),
    eventType,
    category: "action",
    source: payload.shopifyMutationBlocked ? "ProductPulse AI action" : payload.appliedChange ? "Shopify action" : "ProductPulse action",
    title: getActionTimelineTitle(status),
    summary: getActionTimelineSummary(label, status, payload),
    occurredAt,
    severityTone: getActionTimelineTone(status),
    importance: getActionTimelineImportance(status, payload),
    beforeValue: null,
    afterValue: {
      status,
      appliedChange: payload.appliedChange || null,
    },
    metadata: {
      actionType: actionRecord.actionType,
      label,
      sourceActionId: payload.sourceActionId || payload.canonicalActionId || null,
      actionAliases: Array.isArray(payload.actionAliases) ? payload.actionAliases : [],
      shopifyMutationBlocked: Boolean(payload.shopifyMutationBlocked),
      appliedChange: payload.appliedChange || null,
    },
    dedupeKey: `action:${actionRecord.id || actionRecord.actionType}:${status}`,
    actionId: actionRecord.id || null,
    diagnosisId: actionRecord.diagnosisId || payload.diagnosisId || null,
  }];
}

function buildTimelineEventsForWatchActivity({ shop, product, activity } = {}) {
  if (!shop || !activity?.productGid || !activity.eventType) return [];
  const metadata = activity.metadata || {};
  const report = metadata.report || {};
  const occurredAt = parseDate(activity.createdAt) || new Date();
  const productTitle = activity.productTitle || product?.productTitle || product?.title || "Shopify product";
  const base = {
    shop,
    productGid: activity.productGid,
    productTitle,
    handle: optionalString(product?.handle || metadata.handle),
    source: "ProductPulse Watchlist",
    occurredAt,
    watchActivityId: optionalString(activity.id),
  };
  const eventPrefix = activity.id
    ? `watch:${activity.id}`
    : `watch:${activity.eventType}:${activity.productGid}:${occurredAt.toISOString()}:${activity.title}`;
  const events = [];

  if (activity.eventType === "watch_change_report") {
    const changed = report.status === "changed";
    const baseline = report.status === "baseline";
    events.push({
      ...base,
      eventType: baseline ? "watchlist_baseline_captured" : changed ? "watchlist_changes_detected" : "watchlist_no_meaningful_changes",
      category: "watchlist",
      title: report.title || activity.title || (changed ? "Watchlist changes detected" : "No meaningful changes detected"),
      summary: report.summary || activity.detail || "",
      severityTone: changed ? "warning" : baseline ? "info" : "neutral",
      importance: changed ? 68 : baseline ? 48 : 36,
      afterValue: report.current || null,
      metadata: {
        status: report.status || "",
        headline: report.headline || "",
        changeCount: Number(report.changeCount || 0),
        sourceChangeCount: Number(report.sourceChangeCount || 0),
        previousRunAt: report.previousRunAt || null,
        currentRunAt: report.currentRunAt || null,
      },
      dedupeKey: `${eventPrefix}:report`,
    });

    getWatchReportChangeEvents({ base, eventPrefix, report }).forEach((event) => events.push(event));
    return events;
  }

  const spec = getWatchActivityTimelineSpec(activity.eventType, metadata);
  if (!spec) return [];
  events.push({
    ...base,
    eventType: spec.eventType,
    category: spec.category,
    title: activity.title || spec.title,
    summary: activity.detail || spec.summary || "",
    severityTone: spec.tone,
    importance: spec.importance,
    afterValue: {
      riskScore: metadata.riskScore ?? null,
      riskLabel: metadata.riskLabel || null,
    },
    metadata,
    dedupeKey: `${eventPrefix}:activity`,
  });
  return events;
}

function getWatchReportChangeEvents({ base, eventPrefix, report = {} } = {}) {
  const events = [];
  const sourceChanges = Array.isArray(report.sourceChanges) ? report.sourceChanges : [];
  sourceChanges.slice(0, 6).forEach((change) => {
    const spec = getWatchSourceChangeSpec(change);
    if (!spec) return;
    events.push({
      ...base,
      eventType: spec.eventType,
      category: spec.category,
      source: spec.source,
      title: spec.title,
      summary: change.detail || change.delta || change.value || "",
      severityTone: spec.tone,
      importance: spec.importance,
      afterValue: {
        value: change.value || null,
        delta: change.delta || null,
      },
      metadata: { change },
      dedupeKey: `${eventPrefix}:source:${change.id || change.source || spec.eventType}`,
    });
  });

  const calculatedChanges = Array.isArray(report.changes) ? report.changes : [];
  calculatedChanges.slice(0, 8).forEach((change) => {
    const spec = getWatchCalculatedChangeSpec(change);
    if (!spec) return;
    events.push({
      ...base,
      eventType: spec.eventType,
      category: spec.category,
      source: "ProductPulse Watchlist",
      title: spec.title,
      summary: change.detail || `${change.label || "Metric"} changed from ${change.from || "previous"} to ${change.to || "current"}.`,
      severityTone: spec.tone,
      importance: spec.importance,
      beforeValue: { value: change.from || null },
      afterValue: { value: change.to || null },
      metadata: { change },
      dedupeKey: `${eventPrefix}:metric:${change.id || spec.eventType}`,
    });
  });
  return events;
}

function addMetricDeltaEvent(events, { base, eventPrefix, previousPoint, currentPoint, key, threshold, category, eventTypeUp, eventTypeDown, titleUp, titleDown, unit = "points", importance = 50, positiveUp = false }) {
  const previousValue = numberOrNull(previousPoint[key]);
  const currentValue = numberOrNull(currentPoint[key]);
  if (previousValue == null || currentValue == null) return;
  const delta = currentValue - previousValue;
  if (Math.abs(delta) < threshold) return;
  const up = delta >= 0;
  events.push({
    ...base,
    eventType: up ? eventTypeUp : eventTypeDown,
    category,
    title: up ? titleUp : titleDown,
    summary: `${formatMetricLabel(key)} moved from ${formatNumber(previousValue)} to ${formatNumber(currentValue)} (${delta > 0 ? "+" : ""}${formatNumber(delta)} ${unit}).`,
    severityTone: positiveUp ? (up ? "success" : "warning") : (up ? "warning" : "success"),
    importance: Math.min(82, importance + Math.round(Math.abs(delta) / 5)),
    beforeValue: { [key]: previousValue },
    afterValue: { [key]: currentValue },
    metadata: { metric: key, delta },
    dedupeKey: `${eventPrefix}:${key}-change`,
  });
}

function addFinancialExposureEvent(events, { base, eventPrefix, previousPoint, currentPoint }) {
  const previousValue = firstNumberOrNull(previousPoint.financialExposure, previousPoint.revenueAtRisk, previousPoint.marginAtRisk);
  const currentValue = firstNumberOrNull(currentPoint.financialExposure, currentPoint.revenueAtRisk, currentPoint.marginAtRisk);
  if (previousValue == null || currentValue == null) return;
  const delta = currentValue - previousValue;
  const percent = previousValue > 0 ? (delta / previousValue) * 100 : 0;
  if (Math.abs(delta) < FINANCIAL_DELTA_AMOUNT_THRESHOLD && Math.abs(percent) < FINANCIAL_DELTA_PERCENT_THRESHOLD) return;
  events.push({
    ...base,
    eventType: delta >= 0 ? "business_impact_increased" : "business_impact_decreased",
    category: "impact",
    title: "Estimated exposure changed",
    summary: `Estimated Margin Exposure moved from ${formatMoney(previousValue)} to ${formatMoney(currentValue)} (${delta > 0 ? "+" : ""}${formatMoney(delta)}).`,
    severityTone: delta >= 0 ? "warning" : "success",
    importance: Math.min(82, 58 + Math.round(Math.abs(percent) / 5)),
    beforeValue: { financialExposure: previousValue },
    afterValue: { financialExposure: currentValue },
    metadata: { delta, percentDelta: percent },
    dedupeKey: `${eventPrefix}:financial-exposure-change`,
  });
}

function addReturnPressureEvent(events, { base, eventPrefix, previousPoint, currentPoint }) {
  const returnRateDelta = numberDelta(previousPoint.returnRate, currentPoint.returnRate);
  const returnUnitDelta = numberDelta(previousPoint.returnUnits, currentPoint.returnUnits);
  const reasonChanged = currentPoint.topReturnReason && previousPoint.topReturnReason && currentPoint.topReturnReason !== previousPoint.topReturnReason;
  if (Math.abs(returnRateDelta) < RETURN_RATE_DELTA_THRESHOLD && Math.abs(returnUnitDelta) < RETURN_UNITS_DELTA_THRESHOLD && !reasonChanged) return;
  events.push({
    ...base,
    eventType: returnRateDelta >= 0 || returnUnitDelta > 0 ? "return_pressure_increased" : "return_pressure_decreased",
    category: "returns",
    source: "Returns",
    title: reasonChanged ? "Top return reason changed" : returnRateDelta >= 0 || returnUnitDelta > 0 ? "Return pressure increased" : "Return pressure decreased",
    summary: reasonChanged
      ? `Top return reason changed from ${previousPoint.topReturnReason} to ${currentPoint.topReturnReason}.`
      : `Returns moved by ${returnUnitDelta > 0 ? `+${formatInteger(returnUnitDelta)} units` : `${formatNumber(returnRateDelta)} points`} since the previous product state.`,
    severityTone: returnRateDelta >= 0 || returnUnitDelta > 0 ? "warning" : "success",
    importance: reasonChanged ? 64 : 58,
    beforeValue: { returnRate: previousPoint.returnRate, returnUnits: previousPoint.returnUnits, topReturnReason: previousPoint.topReturnReason || null },
    afterValue: { returnRate: currentPoint.returnRate, returnUnits: currentPoint.returnUnits, topReturnReason: currentPoint.topReturnReason || null },
    metadata: { returnRateDelta, returnUnitDelta, reasonChanged },
    dedupeKey: `${eventPrefix}:return-pressure-change`,
  });
}

function addRefundExposureEvent(events, { base, eventPrefix, previousPoint, currentPoint }) {
  const refundUnitDelta = numberDelta(previousPoint.refundUnits, currentPoint.refundUnits);
  const refundAmountDelta = numberDelta(previousPoint.refundAmount, currentPoint.refundAmount);
  const leakageDelta = numberDelta(previousPoint.refundLeakageScore, currentPoint.refundLeakageScore);
  const reasonChanged = currentPoint.topRefundReason && previousPoint.topRefundReason && currentPoint.topRefundReason !== previousPoint.topRefundReason;
  if (Math.abs(refundUnitDelta) < REFUND_UNITS_DELTA_THRESHOLD
    && Math.abs(refundAmountDelta) < REFUND_AMOUNT_DELTA_THRESHOLD
    && Math.abs(leakageDelta) < MOMENTUM_SCORE_DELTA_THRESHOLD
    && !reasonChanged) return;

  events.push({
    ...base,
    eventType: refundAmountDelta >= 0 || refundUnitDelta > 0 || leakageDelta > 0 ? "refund_exposure_increased" : "refund_exposure_decreased",
    category: "refunds",
    source: "Refunds",
    title: reasonChanged ? "Top refund reason changed" : refundAmountDelta >= 0 || refundUnitDelta > 0 || leakageDelta > 0 ? "Refund exposure increased" : "Refund exposure decreased",
    summary: reasonChanged
      ? `Top refund reason changed from ${previousPoint.topRefundReason} to ${currentPoint.topRefundReason}.`
      : `Refund exposure changed by ${refundAmountDelta ? formatMoney(refundAmountDelta) : `${formatInteger(refundUnitDelta)} units`}.`,
    severityTone: refundAmountDelta >= 0 || refundUnitDelta > 0 || leakageDelta > 0 ? "warning" : "success",
    importance: reasonChanged ? 64 : 58,
    beforeValue: { refundAmount: previousPoint.refundAmount, refundUnits: previousPoint.refundUnits, refundLeakageScore: previousPoint.refundLeakageScore, topRefundReason: previousPoint.topRefundReason || null },
    afterValue: { refundAmount: currentPoint.refundAmount, refundUnits: currentPoint.refundUnits, refundLeakageScore: currentPoint.refundLeakageScore, topRefundReason: currentPoint.topRefundReason || null },
    metadata: { refundUnitDelta, refundAmountDelta, leakageDelta, reasonChanged },
    dedupeKey: `${eventPrefix}:refund-exposure-change`,
  });
}

function addReviewSignalEvents(events, { base, eventPrefix, previousPoint, currentPoint }) {
  const negativeDelta = numberDelta(previousPoint.negativeReviewCount, currentPoint.negativeReviewCount);
  const ratingDelta = numberDelta(previousPoint.avgRating, currentPoint.avgRating);
  if (negativeDelta >= NEGATIVE_REVIEW_DELTA_THRESHOLD) {
    events.push({
      ...base,
      eventType: "negative_reviews_detected",
      category: "reviews",
      source: "Reviews",
      title: "New negative reviews detected",
      summary: `${formatInteger(negativeDelta)} more negative review signals were captured.`,
      severityTone: "warning",
      importance: Math.min(80, 58 + negativeDelta),
      beforeValue: { negativeReviewCount: previousPoint.negativeReviewCount },
      afterValue: { negativeReviewCount: currentPoint.negativeReviewCount },
      metadata: { negativeDelta, reviewCount: currentPoint.reviewCount },
      dedupeKey: `${eventPrefix}:negative-review-change`,
    });
  }

  if (Math.abs(ratingDelta) >= REVIEW_RATING_DELTA_THRESHOLD) {
    events.push({
      ...base,
      eventType: ratingDelta >= 0 ? "average_rating_improved" : "average_rating_dropped",
      category: "reviews",
      source: "Reviews",
      title: ratingDelta >= 0 ? "Average rating improved" : "Average rating dropped",
      summary: `Average rating moved from ${formatRating(previousPoint.avgRating)} to ${formatRating(currentPoint.avgRating)}.`,
      severityTone: ratingDelta >= 0 ? "success" : "warning",
      importance: 54,
      beforeValue: { avgRating: previousPoint.avgRating },
      afterValue: { avgRating: currentPoint.avgRating },
      metadata: { ratingDelta },
      dedupeKey: `${eventPrefix}:rating-change`,
    });
  }

  const previousEmotion = previousPoint.dominantEmotion;
  const currentEmotion = currentPoint.dominantEmotion;
  if (currentEmotion && previousEmotion && currentEmotion !== previousEmotion) {
    events.push({
      ...base,
      eventType: "dominant_customer_emotion_changed",
      category: "reviews",
      source: "Customer language",
      title: "Dominant customer emotion changed",
      summary: `Customer language shifted from ${previousEmotion} to ${currentEmotion}.`,
      severityTone: currentEmotion.includes("negative") || currentEmotion.includes("frustr") ? "warning" : "info",
      importance: 55,
      beforeValue: { dominantEmotion: previousEmotion },
      afterValue: { dominantEmotion: currentEmotion },
      metadata: { previousEmotion, currentEmotion },
      dedupeKey: `${eventPrefix}:dominant-emotion-change`,
    });
  }
}

function getWatchActivityTimelineSpec(eventType, metadata = {}) {
  const normalized = String(eventType || "");
  if (normalized === "product_added") {
    return { eventType: "product_added_to_watchlist", category: "watchlist", title: "Product added to Watchlist", tone: "info", importance: 52 };
  }
  if (normalized === "product_removed") {
    return { eventType: "product_removed_from_watchlist", category: "watchlist", title: "Product removed from Watchlist", tone: "neutral", importance: 42 };
  }
  if (normalized === "product_paused" || normalized === "product_resumed") {
    return { eventType: `watchlist_${normalized}`, category: "watchlist", title: normalized === "product_paused" ? "Watch paused" : "Watch resumed", tone: "neutral", importance: 40 };
  }
  if (normalized === "watch_baseline_captured") {
    return { eventType: "watchlist_baseline_captured", category: "watchlist", title: "Watchlist baseline captured", tone: "info", importance: 48 };
  }
  if (normalized === "watch_scan_completed" || normalized === "diagnosis_completed") {
    const riskScore = Number(metadata.riskScore || 0);
    return {
      eventType: normalized,
      category: normalized === "diagnosis_completed" ? "diagnosis" : "watchlist",
      title: normalized === "diagnosis_completed" ? "Product diagnosis completed" : "Watch scan completed",
      tone: getRiskToneForScore(riskScore),
      importance: normalized === "diagnosis_completed" ? 52 : 36,
    };
  }
  return null;
}

function getWatchSourceChangeSpec(change = {}) {
  const id = String(change.id || change.source || "").toLowerCase();
  if (id.includes("review")) {
    return { eventType: "new_reviews_detected", category: "reviews", source: "Reviews", title: "Review activity changed", tone: change.tone === "orange" ? "warning" : "info", importance: 62 };
  }
  if (id.includes("return")) {
    return { eventType: "new_returns_detected", category: "returns", source: "Returns", title: "Return activity changed", tone: "warning", importance: 62 };
  }
  if (id.includes("refund")) {
    return { eventType: "new_refunds_detected", category: "refunds", source: "Refunds", title: "Refund activity changed", tone: "warning", importance: 62 };
  }
  if (id.includes("content")) {
    return { eventType: "product_content_changed", category: "catalog", source: "Shopify product data", title: "Product content changed", tone: "info", importance: 58 };
  }
  if (id.includes("order")) {
    return { eventType: "new_orders_detected", category: "momentum", source: "Orders", title: "Order activity changed", tone: "success", importance: 48 };
  }
  return null;
}

function getWatchCalculatedChangeSpec(change = {}) {
  const id = String(change.id || "").toLowerCase();
  const direction = String(change.direction || "").toLowerCase();
  if (id.includes("risk")) {
    return { eventType: direction === "down" ? "risk_score_decreased" : "risk_score_increased", category: "risk", title: direction === "down" ? "Risk decreased since last Watchlist run" : "Risk increased since last Watchlist run", tone: direction === "down" ? "success" : "warning", importance: 70 };
  }
  if (id.includes("momentum")) {
    return { eventType: "momentum_changed", category: "momentum", title: "Sales Momentum changed", tone: "info", importance: 58 };
  }
  if (id.includes("impact") || id.includes("exposure")) {
    return { eventType: "business_impact_changed", category: "impact", title: "Estimated Margin Exposure changed", tone: direction === "down" ? "success" : "warning", importance: 60 };
  }
  if (id.includes("return")) {
    return { eventType: "return_pressure_changed", category: "returns", title: "Return pressure changed", tone: direction === "down" ? "success" : "warning", importance: 60 };
  }
  if (id.includes("refund")) {
    return { eventType: "refund_pressure_changed", category: "refunds", title: "Refund pressure changed", tone: direction === "down" ? "success" : "warning", importance: 60 };
  }
  if (id.includes("negative-review")) {
    return { eventType: "negative_reviews_changed", category: "reviews", title: "Negative reviews changed", tone: direction === "down" ? "success" : "warning", importance: 60 };
  }
  return null;
}

function buildTimelineWhere(shop, productGid, options = {}) {
  const where = { shop, productGid };
  const categories = normalizeList(options.category || options.categories);
  if (categories.length) where.category = { in: categories };
  const minImportance = nullableInteger(options.minImportance);
  if (minImportance != null) where.importance = { gte: minImportance };
  const dateRange = {};
  const from = parseDate(options.from || options.dateFrom);
  const to = parseDate(options.to || options.dateTo);
  if (from) dateRange.gte = from;
  if (to) dateRange.lte = to;
  if (Object.keys(dateRange).length) where.occurredAt = dateRange;
  return where;
}

async function resolveTimelineProduct(shop, productRef, db) {
  const normalized = String(productRef || "").trim();
  if (!shop || !normalized) return null;
  const values = Array.from(new Set([normalized, safeDecode(normalized)].filter(Boolean)));
  return db.productRiskSnapshot.findFirst({
    where: {
      shop,
      OR: [
        { productGid: { in: values } },
        { handle: { in: values } },
      ],
    },
  });
}

function normalizeTimelineEvent(event = {}, product = {}) {
  const occurredAt = parseDate(event.occurredAt) || new Date();
  const metadata = event.metadata || {};
  const category = event.category || "scan";
  return {
    id: event.id,
    eventType: event.eventType,
    category,
    categoryLabel: CATEGORY_LABELS[category] || humanize(category),
    source: event.source || "ProductPulse",
    title: event.title || humanize(event.eventType),
    summary: event.summary || "",
    occurredAt: occurredAt.toISOString(),
    dayKey: occurredAt.toISOString().slice(0, 10),
    dateLabel: formatTimelineDate(occurredAt),
    timeLabel: formatTimelineTime(occurredAt),
    severityTone: event.severityTone || "neutral",
    tone: mapTimelineTone(event.severityTone || "neutral"),
    importance: Number(event.importance || 0),
    importanceLabel: getTimelineImportanceLabel(event.importance),
    confidence: event.confidence ?? null,
    beforeValue: event.beforeValue || null,
    afterValue: event.afterValue || null,
    metadata,
    icon: getTimelineEventIcon(event),
    related: {
      diagnosisId: event.diagnosisId || null,
      scanJobId: event.scanJobId || null,
      watchActivityId: event.watchActivityId || null,
      actionId: event.actionId || null,
      recommendationId: metadata.recommendationId || metadata.sourceActionId || null,
      reviewId: event.reviewId || null,
      returnId: event.returnId || null,
      refundId: event.refundId || null,
      orderId: event.orderId || null,
      shopifyEventId: event.shopifyEventId || null,
    },
    cta: getTimelineEventCta(event, product),
  };
}

function groupTimelineEventsByDay(events = []) {
  const groups = new Map();
  events.forEach((event) => {
    const key = event.dayKey || "";
    if (!key) return;
    const group = groups.get(key) || {
      key,
      label: event.dateLabel,
      events: [],
    };
    group.events.push(event);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function buildTimelineSummary(events = []) {
  const meaningful = events.filter((event) => Number(event.importance || 0) >= 55);
  if (!events.length) return null;
  const latestWatch = events.find((event) => event.category === "watchlist");
  const important = meaningful
    .filter((event) => event.eventType !== "quickscan_completed")
    .slice(0, 3);
  if (latestWatch && important.length) {
    return `Since the latest Watchlist activity, ${important.map((event) => event.title.toLowerCase()).join(", ")}.`;
  }
  if (important.length) {
    return `${important.map((event) => event.title).join(", ")} ${important.length === 1 ? "is" : "are"} the latest meaningful ProductPulse change${important.length === 1 ? "" : "s"}.`;
  }
  return `ProductPulse has ${events.length} timeline event${events.length === 1 ? "" : "s"} for this product.`;
}

function buildTimelineFilters(events = []) {
  const categoryCounts = new Map();
  events.forEach((event) => {
    const key = event.category || "scan";
    categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
  });
  return {
    categories: Array.from(categoryCounts.entries()).map(([key, count]) => ({
      value: key,
      label: CATEGORY_LABELS[key] || humanize(key),
      count,
    })),
    meaningfulImportance: PRODUCT_TIMELINE_MIN_MEANINGFUL_IMPORTANCE,
  };
}

function normalizeTimelineEventForCreate(event = {}) {
  if (!event.shop || !event.productGid || !event.eventType || !event.category || !event.title || !event.dedupeKey) return null;
  const now = new Date();
  return {
    shop: event.shop,
    productGid: String(event.productGid),
    productTitle: String(event.productTitle || "Shopify product"),
    handle: optionalString(event.handle),
    variantGid: optionalString(event.variantGid),
    eventType: String(event.eventType),
    category: String(event.category),
    source: String(event.source || "ProductPulse"),
    title: String(event.title),
    summary: optionalString(event.summary),
    occurredAt: parseDate(event.occurredAt) || new Date(),
    severityTone: String(event.severityTone || "neutral"),
    importance: Math.max(0, Math.min(100, nullableInteger(event.importance) ?? 50)),
    confidence: nullableInteger(event.confidence),
    beforeValue: jsonCompatible(event.beforeValue),
    afterValue: jsonCompatible(event.afterValue),
    metadata: jsonCompatible(event.metadata),
    dedupeKey: String(event.dedupeKey).slice(0, 500),
    scanJobId: optionalString(event.scanJobId),
    diagnosisId: optionalString(event.diagnosisId),
    watchActivityId: optionalString(event.watchActivityId),
    actionId: optionalString(event.actionId),
    reviewId: optionalString(event.reviewId),
    returnId: optionalString(event.returnId),
    refundId: optionalString(event.refundId),
    orderId: optionalString(event.orderId),
    shopifyEventId: optionalString(event.shopifyEventId),
    updatedAt: now,
  };
}

function normalizeScorePoint(row = {}, product = {}) {
  const metrics = row.metrics || {};
  const relationship = metrics.returnRefundRelationship || {};
  return {
    id: row.id || null,
    productGid: row.productGid || product?.productGid || "",
    productTitle: row.productTitle || product?.productTitle || product?.title || "Shopify product",
    handle: row.handle || product?.handle || "",
    source: row.source || "unknown",
    riskScore: nullableInteger(row.riskScore) ?? 0,
    impactScore: nullableInteger(row.impactScore),
    confidence: nullableInteger(row.confidence),
    primaryIssue: optionalString(row.primaryIssue),
    diagnosisId: optionalString(row.diagnosisId),
    snapshotId: optionalString(row.snapshotId),
    recordedAt: toIso(row.recordedAt),
    returnRate: firstNumberOrNull(metrics.returnRate, metrics.returnPressureRate, relationship.returnPressureRate),
    refundRate: firstNumberOrNull(metrics.refundRate),
    negativeReviewRate: firstNumberOrNull(metrics.negativeReviewRate),
    marginAtRisk: firstNumberOrNull(metrics.marginAtRisk),
    revenueAtRisk: firstNumberOrNull(metrics.revenueAtRisk),
    financialExposure: firstNumberOrNull(metrics.financialExposure, metrics.estimatedImpact),
    salesAmount: firstNumberOrNull(metrics.salesAmount),
    refundAmount: firstNumberOrNull(metrics.refundAmount, relationship.attributedRefundAmount, relationship.unattributedRefundAmount),
    soldUnits: firstNumberOrNull(metrics.soldUnits),
    returnUnits: firstNumberOrNull(metrics.returnUnits, relationship.returnedUnits),
    refundUnits: firstNumberOrNull(metrics.refundUnits, relationship.refundedWithoutReturnUnits),
    reviewCount: firstNumberOrNull(metrics.reviewCount),
    negativeReviewCount: firstNumberOrNull(metrics.negativeReviewCount),
    avgRating: firstNumberOrNull(metrics.avgRating, metrics.reviewRating, metrics.csvAverageRating),
    customerSignalCount: firstNumberOrNull(metrics.customerSignalCount),
    evidenceStrengthScore: firstNumberOrNull(metrics.evidenceStrengthScore),
    sourceCount: firstNumberOrNull(metrics.sourceCount, getHistorySourceCount(metrics.sourceCoverage)),
    retentionHealthScore: firstNumberOrNull(metrics.retentionHealthScore),
    productMomentumScore: firstNumberOrNull(metrics.productMomentumScore),
    productMomentumTier: optionalString(metrics.productMomentumTier),
    momentumDirection: optionalString(metrics.momentumDirection),
    refundLeakageScore: firstNumberOrNull(metrics.refundLeakageScore, relationship.refundLeakageScore),
    returnPressureScore: firstNumberOrNull(metrics.returnPressureScore, relationship.returnPressureScore),
    topReturnReason: optionalString(metrics.topReturnReason),
    topRefundReason: optionalString(metrics.topRefundReason),
    dominantEmotion: optionalString(metrics.dominantEmotion),
    productContentSignature: optionalString(metrics.productContentSignature),
    productContentReason: optionalString(metrics.productContentReason),
    productUpdatedAt: optionalString(metrics.productUpdatedAt),
  };
}

function buildScoreHistoryRowFromSnapshot(snapshot = {}, options = {}) {
  const metrics = snapshot.metrics || {};
  return {
    id: null,
    shop: snapshot.shop,
    productGid: snapshot.productGid,
    productTitle: snapshot.productTitle,
    handle: snapshot.handle,
    source: options.source || "snapshot",
    riskScore: snapshot.riskScore,
    impactScore: snapshot.impactScore,
    confidence: snapshot.confidence,
    primaryIssue: snapshot.primaryIssue,
    metrics: {
      returnRate: metrics.returnRate,
      refundRate: metrics.refundRate,
      negativeReviewRate: metrics.negativeReviewRate,
      marginAtRisk: metrics.marginAtRisk,
      revenueAtRisk: metrics.revenueAtRisk,
      financialExposure: metrics.financialExposure || metrics.estimatedImpact,
      refundAmount: metrics.refundAmount,
      returnUnits: metrics.returnUnits,
      refundUnits: metrics.refundUnits,
      reviewCount: metrics.reviewCount,
      negativeReviewCount: metrics.negativeReviewCount,
      avgRating: metrics.avgRating || metrics.reviewRating,
      evidenceStrengthScore: metrics.evidenceStrengthScore,
      productMomentumScore: metrics.productMomentumScore || metrics.productMomentum?.score,
      productMomentumTier: metrics.productMomentumTier || metrics.productMomentum?.tier,
      topReturnReason: getTopReasonLabel(metrics.topReturnReasonDetails || metrics.topReturnReasons),
      topRefundReason: getTopReasonLabel(metrics.topRefundReasonDetails || metrics.topRefundReasons),
      productContentSignature: metrics.incrementalDiagnosis?.productContent?.signature || metrics.incrementalDiagnosis?.cache?.productContent?.signature,
      productContentReason: metrics.incrementalDiagnosis?.productContent?.reason,
      productUpdatedAt: metrics.incrementalDiagnosis?.productContent?.productUpdatedAt,
      sourceCoverage: snapshot.sourceCoverage,
    },
    recordedAt: new Date(),
  };
}

function buildProductSnapshotSummary(snapshot = {}) {
  const metrics = snapshot.metrics || {};
  return {
    productGid: snapshot.productGid || null,
    productTitle: snapshot.productTitle || snapshot.title || null,
    handle: snapshot.handle || null,
    productStatus: metrics.productStatus || snapshot.status || null,
    vendor: metrics.vendor || null,
    productType: metrics.productType || null,
    variantCount: nullableInteger(metrics.variantCount),
    skuCount: nullableInteger(metrics.skuCount),
    tagsCount: Array.isArray(metrics.tags) ? metrics.tags.length : null,
    collectionsCount: Array.isArray(metrics.collections) ? metrics.collections.length : null,
    productContentSignature: metrics.incrementalDiagnosis?.productContent?.signature || metrics.incrementalDiagnosis?.cache?.productContent?.signature || null,
    productUpdatedAt: metrics.incrementalDiagnosis?.productContent?.productUpdatedAt || metrics.incrementalDiagnosis?.cache?.productContent?.productUpdatedAt || null,
  };
}

function getTimelineEventCta(event = {}, product = {}) {
  const metadata = event.metadata || {};
  if (event.actionId || metadata.recommendationId || metadata.sourceActionId) return { type: "action", label: "Open action" };
  if (["reviews", "returns", "refunds", "evidence"].includes(event.category)) return { type: "evidence", label: "View evidence" };
  if (event.watchActivityId && product.handle) return { type: "link", label: "View Watchlist report", href: `/app/watchlist/${encodeURIComponent(product.handle)}?runId=${encodeURIComponent(event.watchActivityId)}` };
  if (event.diagnosisId || event.scanJobId || ["risk", "momentum", "impact"].includes(event.category)) return { type: "link", label: "View metric timelines", href: getProductMetricTimelineHref(product) };
  if (event.category === "catalog" && product.handle) return { type: "product_change", label: "View product change" };
  return null;
}

function getProductMetricTimelineHref(product = {}) {
  const id = product.handle || product.productGid || "";
  return id ? `/app/products/${encodeURIComponent(id)}/metric-timelines` : "/app/products";
}

function getTimelineEventIcon(event = {}) {
  const type = String(event.eventType || "");
  if (type.includes("review")) return "star";
  if (type.includes("return")) return "return";
  if (type.includes("refund")) return "cash-dollar";
  if (type.includes("risk")) return "alert-triangle";
  if (type.includes("momentum")) return "chart-line";
  if (type.includes("content") || type.includes("catalog")) return "product";
  if (type.includes("action")) return "check-circle";
  if (type.includes("watch")) return "binoculars";
  if (type.includes("diagnosis")) return "wand";
  return CATEGORY_ICONS[event.category] || "chart-line";
}

function getActionRecordStatus(actionRecord = {}) {
  const payload = actionRecord.payload || {};
  return String(actionRecord.status || payload.status || "draft").toLowerCase();
}

function getActionRecordLabel(actionRecord = {}, action = null) {
  return actionRecord.label || action?.label || action?.title || "Recommended action";
}

function isGroupedAppliedActionStatus(status = "") {
  const normalized = String(status || "").toLowerCase();
  return normalized === "applied" || normalized === "completed";
}

async function getAppliedActionGroupRecords({ shop, productGid, actionRecord, groupWindow, db = prisma } = {}) {
  const fallback = actionRecord ? [actionRecord] : [];
  if (!shop || !productGid || !groupWindow?.start || !groupWindow?.end || typeof db.productAction?.findMany !== "function") return fallback;
  const rows = await db.productAction.findMany({
    where: {
      shop,
      productGid,
      status: { in: ["applied", "completed"] },
      OR: [
        { appliedAt: { gte: groupWindow.start, lt: groupWindow.end } },
        { appliedAt: null, createdAt: { gte: groupWindow.start, lt: groupWindow.end } },
      ],
    },
    orderBy: [{ appliedAt: "asc" }, { createdAt: "asc" }],
    take: 80,
  });
  const byId = new Map((rows || []).map((row) => [row.id || `${row.actionType}:${row.createdAt}`, row]));
  if (actionRecord) byId.set(actionRecord.id || `${actionRecord.actionType}:${actionRecord.createdAt}`, actionRecord);
  return Array.from(byId.values());
}

function getActionAppliedGroupKey(value) {
  const time = getTime(value) || Date.now();
  return Math.floor(time / ACTION_APPLIED_GROUP_WINDOW_MS);
}

function getActionAppliedGroupWindow(value) {
  const key = getActionAppliedGroupKey(value);
  const start = new Date(key * ACTION_APPLIED_GROUP_WINDOW_MS);
  return {
    key,
    start,
    end: new Date(start.getTime() + ACTION_APPLIED_GROUP_WINDOW_MS),
  };
}

function getActionAppliedLookupWindow(value) {
  const center = parseDate(value) || new Date();
  return {
    start: new Date(center.getTime() - ACTION_APPLIED_GROUP_WINDOW_MS + 1),
    end: new Date(center.getTime() + ACTION_APPLIED_GROUP_WINDOW_MS),
  };
}

function getActionTimelineEventType(status) {
  if (status === "applied" || status === "completed") return "recommended_action_applied";
  if (status === "dismissed") return "recommended_action_dismissed";
  if (status === "reviewed") return "recommended_action_reviewed";
  if (status === "ignored") return "issue_ignored";
  if (status === "active") return "recommended_action_restored";
  return "recommended_action_saved";
}

function getActionTimelineTitle(status) {
  if (status === "applied" || status === "completed") return "Recommended action applied";
  if (status === "dismissed") return "Recommended action dismissed";
  if (status === "reviewed") return "Recommended action reviewed";
  if (status === "ignored") return "Issue ignored";
  if (status === "active") return "Recommended action restored";
  return "Recommended action saved";
}

function getActionTimelineSummary(label, status, payload = {}) {
  if (payload.appliedChange?.target) {
    return `${label} changed ${payload.appliedChange.target}.`;
  }
  if (status === "dismissed") return `${label} was dismissed for this product.`;
  if (status === "reviewed") return `${label} was marked as reviewed.`;
  if (status === "ignored") return `${payload.issue || label} was ignored for this product.`;
  if (status === "active") return `${label} was restored.`;
  if (status === "applied" || status === "completed") return `${label} was applied.`;
  return `${label} was saved as a ProductPulse action.`;
}

function getActionTimelineTone(status) {
  if (status === "applied" || status === "completed" || status === "reviewed") return "success";
  if (status === "dismissed" || status === "ignored") return "neutral";
  return "info";
}

function getActionTimelineImportance(status, payload = {}) {
  if (payload.appliedChange) return 76;
  if (status === "applied" || status === "completed") return 70;
  if (status === "reviewed") return 62;
  if (status === "dismissed" || status === "ignored") return 54;
  return 46;
}

function getDiagnosisPrimaryIssue(diagnosis = null) {
  if (!diagnosis) return "";
  return optionalString(diagnosis.primaryIssue || diagnosis.likelyCause || diagnosis.mainFinding || getDiagnosisIssueRows(diagnosis)[0]?.label) || "";
}

function getDiagnosisIssueRows(diagnosis = {}) {
  return (Array.isArray(diagnosis.issues) ? diagnosis.issues : [])
    .map((issue, index) => {
      const label = String(issue.issue || issue.label || issue.title || issue.issueCode || "").trim();
      if (!label) return null;
      return {
        key: normalizeText(issue.issueCode || issue.key || label),
        label,
        action: String(issue.suggestedAction || issue.action || "").trim(),
        severity: issue.severity || null,
        confidence: issue.confidence || null,
        index,
      };
    })
    .filter(Boolean);
}

function getDiagnosisIssueKeySet(diagnosis = null) {
  return new Set(getDiagnosisIssueRows(diagnosis || {}).map((issue) => issue.key));
}

function buildDiagnosisIssueHistoryContext(previousDiagnoses = []) {
  const sorted = [...(Array.isArray(previousDiagnoses) ? previousDiagnoses : [])]
    .filter((diagnosis) => diagnosis?.id)
    .sort((first, second) => getTime(first.completedAt || first.createdAt) - getTime(second.completedAt || second.createdAt));
  const priorIssueKeys = new Set();
  const resolvedIssueKeys = new Set();
  let previousIssueKeys = new Set();
  let previous = null;

  sorted.forEach((diagnosis) => {
    const currentIssueKeys = getDiagnosisIssueKeySet(diagnosis);
    previousIssueKeys.forEach((key) => {
      if (!currentIssueKeys.has(key)) resolvedIssueKeys.add(key);
    });
    currentIssueKeys.forEach((key) => priorIssueKeys.add(key));
    previousIssueKeys = currentIssueKeys;
    previous = diagnosis;
  });

  return { previous, priorIssueKeys, resolvedIssueKeys };
}

function uniqueDiagnosisIssues(issues = []) {
  const seen = new Set();
  return (Array.isArray(issues) ? issues : []).filter((issue) => {
    if (!issue?.key || seen.has(issue.key)) return false;
    seen.add(issue.key);
    return true;
  });
}

function summarizeIssueList(issues = [], mode = "detected") {
  const labels = uniqueDiagnosisIssues(issues).map((issue) => issue.label).filter(Boolean);
  if (!labels.length) return mode === "resolved" ? "Previously detected issues are no longer present." : "New issues were detected.";
  const prefix = mode === "resolved"
    ? labels.length === 1 ? "No longer detected" : "No longer detected"
    : labels.length === 1 ? "Detected" : "Detected";
  const visibleLabels = labels.slice(0, 5);
  const overflow = Math.max(0, labels.length - visibleLabels.length);
  return `${prefix}: ${visibleLabels.join(", ")}${overflow ? ` and ${overflow} more` : ""}.`;
}

function getTimelineSourceLabel(source = "") {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "quickscan") return "Shopify Catalog Scan";
  if (normalized === "full-diagnosis") return "ProductPulse diagnosis";
  if (normalized === "full-diagnosis-reconstructed") return "ProductPulse reconstructed history";
  if (normalized === "watchlist-baseline") return "ProductPulse Watchlist";
  return humanize(source || "ProductPulse");
}

function hasProductContentChanged(previousPoint = {}, currentPoint = {}) {
  const previousSignature = String(previousPoint.productContentSignature || "").trim();
  const currentSignature = String(currentPoint.productContentSignature || "").trim();
  if (previousSignature && currentSignature && previousSignature !== currentSignature) return true;
  const previousUpdatedAt = getTime(previousPoint.productUpdatedAt);
  const currentUpdatedAt = getTime(currentPoint.productUpdatedAt);
  if (previousUpdatedAt && currentUpdatedAt && previousUpdatedAt !== currentUpdatedAt) return true;
  const reason = String(currentPoint.productContentReason || "").toLowerCase();
  return reason.includes("signature_changed") || reason.includes("content_changed");
}

function getProductContentChangeSummary(previousPoint = {}, currentPoint = {}) {
  const previousUpdatedAt = parseDate(previousPoint.productUpdatedAt);
  const currentUpdatedAt = parseDate(currentPoint.productUpdatedAt);
  if (previousUpdatedAt && currentUpdatedAt && previousUpdatedAt.getTime() !== currentUpdatedAt.getTime()) {
    return `Shopify product data was updated from ${formatTimelineDate(previousUpdatedAt)} to ${formatTimelineDate(currentUpdatedAt)}. This can include title, description, SEO, media, tags, collections or variants.`;
  }
  if (currentPoint.productContentReason) return humanize(currentPoint.productContentReason);
  return "Shopify product title, description, SEO, media, tags, collections or variants changed.";
}

function hasMeaningfulScoreChangeEvents(events = []) {
  return (Array.isArray(events) ? events : []).some((event) => event?.eventType && !SCORE_COMPLETION_EVENT_TYPES.has(event.eventType));
}

function getTopReasonLabel(value = []) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return "";
  if (typeof first === "string") return first;
  return first.label || first.reason || first.value || first.name || "";
}

function getHistorySourceCount(sourceCoverage) {
  if (Array.isArray(sourceCoverage)) return sourceCoverage.length;
  if (sourceCoverage && typeof sourceCoverage === "object") return Object.keys(sourceCoverage).length;
  return null;
}

function mapTimelineTone(tone = "") {
  const normalized = String(tone || "").toLowerCase();
  if (normalized === "critical") return "red";
  if (normalized === "warning") return "orange";
  if (normalized === "success") return "green";
  if (normalized === "info") return "blue";
  return "slate";
}

function getTimelineImportanceLabel(value) {
  const importance = Number(value || 0);
  if (importance >= 75) return "High";
  if (importance >= PRODUCT_TIMELINE_MIN_MEANINGFUL_IMPORTANCE) return "Meaningful";
  return "Low";
}

function formatTimelineDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTimelineTime(date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function getDateRangeSummary(values = []) {
  const dates = values.map(parseDate).filter(Boolean).sort((first, second) => first.getTime() - second.getTime());
  if (!dates.length) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first.toISOString().slice(0, 10) === last.toISOString().slice(0, 10)) return `on ${formatTimelineDate(last)}`;
  return `from ${formatTimelineDate(first)} to ${formatTimelineDate(last)}`;
}

function normalizeList(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeLimit(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return PRODUCT_TIMELINE_DEFAULT_LIMIT;
  return Math.min(200, number);
}

function normalizeOffset(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatMetricLabel(key = "") {
  return humanize(key.replace(/Score$/, " score"));
}

function formatInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("en-US") : "0";
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  if (Math.abs(number) >= 10) return Math.round(number).toLocaleString("en-US");
  return (Math.round(number * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatRating(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.0";
  return (Math.round(number * 10) / 10).toFixed(1);
}

function formatMoney(value) {
  const number = Number(value || 0);
  const sign = number < 0 ? "-" : "";
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(number) < 100 ? 2 : 0 }).format(Math.abs(number))}`;
}

function firstNumberOrNull(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberDelta(previous, current) {
  const previousNumber = numberOrNull(previous);
  const currentNumber = numberOrNull(current);
  if (previousNumber == null || currentNumber == null) return 0;
  return currentNumber - previousNumber;
}

function nullableInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getTime(value) {
  return parseDate(value)?.getTime() || 0;
}

function toIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function humanize(value = "") {
  const text = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function safeDecode(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function jsonCompatible(value) {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, jsonCompatible(entryValue)]),
  );
}

export const __productPulseTimelineTestHooks = {
  buildTimelineEventsForDiagnosisRows,
  buildTimelineEventsForProductActions,
  buildTimelineEventsForScoreHistoryPair,
  buildTimelineEventsForWatchActivity,
  normalizeTimelineEvent,
  groupTimelineEventsByDay,
  buildTimelineSummary,
  PRODUCT_TIMELINE_MIN_MEANINGFUL_IMPORTANCE,
};
