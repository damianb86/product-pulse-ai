/* global BigInt */
import prisma from "../db.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

const PRODUCT_RETENTION_SCHEMA_VERSION = 1;
const PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS = 365;
const PRODUCT_RETENTION_DEFAULT_MAX_COHORT_AGE_DAYS = 180;
const PRODUCT_RETENTION_LOW_SAMPLE_SIZE = 5;
const PRODUCT_RETENTION_MIN_HEALTH_SCORE_SAMPLE = 5;
const PRODUCT_RETENTION_ORDER_PAGE_SIZE = 50;
const PRODUCT_RETENTION_MAX_ORDER_PAGES = 80;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_THRESHOLDS = [7, 14, 30, 60, 90, 180];

export async function calculateProductRetentionMetrics({
  shopId,
  shop,
  productGid,
  diagnosisId,
  admin = null,
  jobId = null,
  asOfDate = new Date(),
  timezone = "",
  windowStartDate = null,
  windowEndDate = null,
  lookbackDays = PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS,
  maxCohortAgeDays = PRODUCT_RETENTION_DEFAULT_MAX_COHORT_AGE_DAYS,
  currency = "",
  orders = null,
  includeTestOrders = false,
  db = prisma,
} = {}) {
  const normalizedShopId = String(shopId || shop || "").trim();
  const normalizedProductGid = String(productGid || "").trim();
  const normalizedDiagnosisId = String(diagnosisId || "").trim();
  if (!normalizedShopId || !normalizedProductGid || !normalizedDiagnosisId) {
    throw new Error("calculateProductRetentionMetrics requires shopId, productGid and diagnosisId.");
  }

  const startedAt = Date.now();
  const asOf = parseDate(asOfDate) || new Date();
  const normalizedLookbackDays = normalizePositiveInteger(lookbackDays, PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS);
  const normalizedMaxCohortAgeDays = normalizePositiveInteger(maxCohortAgeDays, PRODUCT_RETENTION_DEFAULT_MAX_COHORT_AGE_DAYS);
  const endDate = parseDate(windowEndDate) || asOf;
  const startDate = parseDate(windowStartDate) || addDaysUtc(endDate, -normalizedLookbackDays);
  const shouldIncludeTestOrders = Boolean(includeTestOrders);

  let retentionRun = null;
  try {
    retentionRun = await upsertProductRetentionRun(db, {
      shopId: normalizedShopId,
      productGid: normalizedProductGid,
      diagnosisId: normalizedDiagnosisId,
      asOfDate: asOf,
      timezone: timezone || "UTC",
      windowStartDate: startDate,
      windowEndDate: endDate,
      lookbackDays: normalizedLookbackDays,
      maxCohortAgeDays: normalizedMaxCohortAgeDays,
      currency: currency || null,
      status: "partial",
      metadata: { startedAt: new Date(startedAt).toISOString(), includeTestOrders: shouldIncludeTestOrders },
    });

    let effectiveTimezone = timezone || "";
    let effectiveCurrency = currency || "";
    let retentionOrders = Array.isArray(orders) ? orders : null;
    let fetchStats = {
      source: Array.isArray(orders) ? "provided_orders" : "shopify_admin_api",
      ordersScanned: Array.isArray(orders) ? orders.length : 0,
      truncated: false,
    };

    if (!retentionOrders && admin?.graphql) {
      const shopInfo = await fetchShopifyRetentionShopInfo(admin).catch(() => null);
      effectiveTimezone = effectiveTimezone || shopInfo?.timezone || "UTC";
      effectiveCurrency = effectiveCurrency || shopInfo?.currency || "";
      const fetched = await fetchShopifyProductRetentionOrders({
        admin,
        windowStartDate: startDate,
        windowEndDate: endDate,
      });
      retentionOrders = fetched.orders;
      fetchStats = {
        source: "shopify_admin_api",
        ordersScanned: fetched.orders.length,
        pagesScanned: fetched.pagesScanned,
        truncated: fetched.truncated,
      };
    }

    effectiveTimezone = effectiveTimezone || "UTC";
    const rows = calculateProductRetentionMetricRows({
      shopId: normalizedShopId,
      productGid: normalizedProductGid,
      diagnosisId: normalizedDiagnosisId,
      retentionRunId: retentionRun.id,
      asOfDate: asOf,
      timezone: effectiveTimezone,
      windowStartDate: startDate,
      windowEndDate: endDate,
      lookbackDays: normalizedLookbackDays,
      maxCohortAgeDays: normalizedMaxCohortAgeDays,
      currency: effectiveCurrency,
      orders: retentionOrders || [],
      includeTestOrders: shouldIncludeTestOrders,
    });

    const status = getRetentionRunStatus(rows, fetchStats);
    const persistedRun = await persistProductRetentionRows(db, {
      run: {
        id: retentionRun.id,
        shopId: normalizedShopId,
        productGid: normalizedProductGid,
        diagnosisId: normalizedDiagnosisId,
        asOfDate: asOf,
        timezone: effectiveTimezone,
        windowStartDate: startDate,
        windowEndDate: endDate,
        lookbackDays: normalizedLookbackDays,
        maxCohortAgeDays: normalizedMaxCohortAgeDays,
        currency: rows.currency || effectiveCurrency || null,
        status,
        errorMessage: null,
        metadata: {
          ...fetchStats,
          schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
          includeTestOrders: shouldIncludeTestOrders,
          durationMs: Date.now() - startedAt,
          dataQuality: rows.dataQuality,
        },
      },
      rows,
    });
    const payload = buildProductRetentionPayload(rows);

    await safeRecordJobLog({
      shop: normalizedShopId,
      jobId,
      event: "product_retention.calculated",
      message: "Product retention metrics were calculated and persisted.",
      data: {
        productGid: normalizedProductGid,
        diagnosisId: normalizedDiagnosisId,
        retentionRunId: persistedRun.id,
        status,
        ordersScanned: fetchStats.ordersScanned,
        customersAnalyzed: rows.dataQuality.totalCustomersAnalyzed,
        productBuyers: rows.dataQuality.productBuyerCount,
        cohortsGenerated: rows.dailyCohorts.length,
        cohortCellsGenerated: rows.cohortCells.length,
        segmentsGenerated: rows.segmentDaily.length,
        includeTestOrders: shouldIncludeTestOrders,
        durationMs: Date.now() - startedAt,
      },
    });

    return {
      status,
      retentionRunId: persistedRun.id,
      run: persistedRun,
      rows,
      payload,
      dataQuality: rows.dataQuality,
    };
  } catch (error) {
    const safeError = serializeError(error);
    const failedRun = await markProductRetentionRunFailed(db, {
      existingRunId: retentionRun?.id,
      shopId: normalizedShopId,
      productGid: normalizedProductGid,
      diagnosisId: normalizedDiagnosisId,
      asOfDate: asOf,
      timezone: timezone || "UTC",
      windowStartDate: startDate,
      windowEndDate: endDate,
      lookbackDays: normalizedLookbackDays,
      maxCohortAgeDays: normalizedMaxCohortAgeDays,
      currency: currency || null,
      errorMessage: safeError.message || String(error),
      metadata: {
        schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
        includeTestOrders: shouldIncludeTestOrders,
        durationMs: Date.now() - startedAt,
        error: safeError,
      },
    });

    await safeRecordJobLog({
      shop: normalizedShopId,
      jobId,
      level: "warn",
      event: "product_retention.failed",
      message: "Product retention metrics could not be calculated; diagnosis will continue without retention charts.",
      data: {
        productGid: normalizedProductGid,
        diagnosisId: normalizedDiagnosisId,
        retentionRunId: failedRun?.id || null,
        error: safeError,
      },
    });

    return {
      status: "failed",
      retentionRunId: failedRun?.id || null,
      run: failedRun,
      rows: null,
      payload: buildEmptyProductRetentionPayload({
        hasEnoughData: false,
        lowSampleWarning: true,
        errorMessage: safeError.message || "Product retention metrics could not be calculated.",
      }),
      dataQuality: { error: safeError },
    };
  }
}

export function calculateProductRetentionMetricRows({
  shopId,
  productGid,
  diagnosisId,
  retentionRunId = "",
  asOfDate = new Date(),
  timezone = "UTC",
  windowStartDate = null,
  windowEndDate = null,
  lookbackDays = PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS,
  maxCohortAgeDays = PRODUCT_RETENTION_DEFAULT_MAX_COHORT_AGE_DAYS,
  currency = "",
  orders = [],
  includeTestOrders = false,
} = {}) {
  const asOf = parseDate(asOfDate) || new Date();
  const windowEnd = parseDate(windowEndDate) || asOf;
  const windowStart = parseDate(windowStartDate) || addDaysUtc(windowEnd, -normalizePositiveInteger(lookbackDays, PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS));
  const effectiveTimezone = isValidTimeZone(timezone) ? timezone : "UTC";
  const normalizedProductGid = String(productGid || "").trim();
  const normalizedOrders = normalizeRetentionOrders(orders, { timezone: effectiveTimezone });
  const validOrders = normalizedOrders
    .filter((order) => isValidRetentionOrder(order, { includeTestOrders }))
    .sort(compareRetentionOrders);
  const validWindowOrders = validOrders.filter((order) => isDateWithinRange(order.orderDate, windowStart, windowEnd));
  const currencyCode = currency || inferCurrency(validOrders);
  const customerRecords = buildRetentionCustomerRecords(validOrders, normalizedProductGid, asOf, effectiveTimezone, windowStart, windowEnd);
  const cohortFacts = customerRecords
    .filter((record) => isLocalDateKeyWithinRange(record.cohortDate, windowStart, windowEnd, effectiveTimezone))
    .map((record) => buildCustomerRetentionFact(record, normalizedProductGid, asOf, effectiveTimezone, maxCohortAgeDays));
  const dailyCohorts = buildDailyCohortRows({
    shopId,
    productGid: normalizedProductGid,
    diagnosisId,
    retentionRunId,
    facts: cohortFacts,
  });
  const cohortCells = buildCohortCellRows({
    shopId,
    productGid: normalizedProductGid,
    diagnosisId,
    retentionRunId,
    cohorts: dailyCohorts,
    facts: cohortFacts,
    maxCohortAgeDays,
  });
  const dailyActivity = buildDailyActivityRows({
    shopId,
    productGid: normalizedProductGid,
    diagnosisId,
    retentionRunId,
    orders: validWindowOrders,
    customerRecords,
    timezone: effectiveTimezone,
    windowStart,
    windowEnd,
  });
  const segmentDaily = buildSegmentDailyRows({
    shopId,
    productGid: normalizedProductGid,
    diagnosisId,
    retentionRunId,
    facts: cohortFacts,
  });
  const summary = buildRetentionSummaryRow({
    shopId,
    productGid: normalizedProductGid,
    diagnosisId,
    retentionRunId,
    asOfDate: asOf,
    facts: cohortFacts,
    dailyActivity,
    validOrders,
    validWindowOrders,
  });

  return {
    schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
    shopId,
    productGid: normalizedProductGid,
    diagnosisId,
    retentionRunId,
    asOfDate: asOf,
    timezone: effectiveTimezone,
    windowStartDate: windowStart,
    windowEndDate: windowEnd,
    lookbackDays: normalizePositiveInteger(lookbackDays, PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS),
    maxCohortAgeDays: normalizePositiveInteger(maxCohortAgeDays, PRODUCT_RETENTION_DEFAULT_MAX_COHORT_AGE_DAYS),
    currency: currencyCode,
    dailyCohorts,
    cohortCells,
    dailyActivity,
    segmentDaily,
    summary,
    dataQuality: {
      totalOrdersAnalyzed: validWindowOrders.length,
      totalValidOrdersLoaded: validOrders.length,
      totalCustomersAnalyzed: new Set(validOrders.map((order) => order.customerKey)).size,
      productBuyerCount: customerRecords.length,
      cohortCustomerCount: cohortFacts.length,
      totalProductOrdersAnalyzed: new Set(validWindowOrders.filter((order) => orderHasProduct(order, normalizedProductGid)).map((order) => order.id)).size,
      earliestOrderDate: validOrders[0]?.orderDate || null,
      latestOrderDate: validOrders[validOrders.length - 1]?.orderDate || null,
    },
  };
}

export async function getProductRetentionPayloadForDiagnosis({
  shopId,
  shop,
  productGid,
  diagnosisId = "",
  db = prisma,
} = {}) {
  const normalizedShopId = String(shopId || shop || "").trim();
  const normalizedProductGid = String(productGid || "").trim();
  const normalizedDiagnosisId = String(diagnosisId || "").trim();
  if (!normalizedShopId || !normalizedProductGid) return buildEmptyProductRetentionPayload();

  const runWhere = {
    shopId: normalizedShopId,
    productGid: normalizedProductGid,
    ...(normalizedDiagnosisId ? { diagnosisId: normalizedDiagnosisId } : {}),
  };
  const run = await db.productRetentionRun.findFirst({
    where: runWhere,
    orderBy: [{ asOfDate: "desc" }, { updatedAt: "desc" }],
  });
  if (!run) return buildEmptyProductRetentionPayload();

  const where = {
    shopId: normalizedShopId,
    productGid: normalizedProductGid,
    diagnosisId: run.diagnosisId,
  };
  const [summary, dailyCohorts, cohortCells, dailyActivity, segmentDaily] = await Promise.all([
    db.productRetentionSummary.findFirst({ where }),
    db.productRetentionDailyCohort.findMany({ where, orderBy: { cohortDate: "asc" } }),
    db.productRetentionCohortCell.findMany({ where, orderBy: [{ ageDay: "asc" }, { cohortDate: "asc" }] }),
    db.productRetentionDailyActivity.findMany({ where, orderBy: { metricDate: "asc" } }),
    db.productRetentionSegmentDaily.findMany({ where, orderBy: [{ segmentType: "asc" }, { segmentValue: "asc" }, { cohortDate: "asc" }] }),
  ]);

  return buildProductRetentionPayload({
    run,
    summary: normalizeStoredSummary(summary),
    dailyCohorts: dailyCohorts.map(normalizeStoredDailyCohort),
    cohortCells: cohortCells.map(normalizeStoredCohortCell),
    dailyActivity: dailyActivity.map(normalizeStoredDailyActivity),
    segmentDaily: segmentDaily.map(normalizeStoredSegmentDaily),
  });
}

export async function attachProductRetentionPayloadToDiagnosis({
  shopId,
  shop,
  productGid,
  diagnosisId,
  payload,
  db = prisma,
} = {}) {
  const normalizedShopId = String(shopId || shop || "").trim();
  const normalizedProductGid = String(productGid || "").trim();
  const normalizedDiagnosisId = String(diagnosisId || "").trim();
  if (!normalizedShopId || !normalizedProductGid || !normalizedDiagnosisId || !payload) return null;

  const diagnosis = await db.productDiagnosis.findFirst({
    where: {
      shop: normalizedShopId,
      productGid: normalizedProductGid,
      id: normalizedDiagnosisId,
    },
  });
  if (!diagnosis) return null;

  const metrics = {
    ...(diagnosis.metrics || {}),
    productRetention: payload,
    productRetentionSummary: payload.summary || null,
    latestRetentionRunId: payload.run?.id || payload.retentionRunId || null,
  };

  await db.productDiagnosis.update({
    where: { id: diagnosis.id },
    data: { metrics },
  });

  const snapshot = await db.productRiskSnapshot.findUnique({
    where: { shop_productGid: { shop: normalizedShopId, productGid: normalizedProductGid } },
  }).catch(() => null);
  if (!snapshot) return metrics;

  await db.productRiskSnapshot.update({
    where: { shop_productGid: { shop: normalizedShopId, productGid: normalizedProductGid } },
    data: {
      metrics: {
        ...(snapshot.metrics || {}),
        productRetention: payload,
        productRetentionSummary: payload.summary || null,
        latestRetentionRunId: payload.run?.id || payload.retentionRunId || null,
      },
    },
  });

  return metrics;
}

async function persistProductRetentionRows(db, { run, rows }) {
  const now = new Date();
  const runData = {
    shopId: run.shopId,
    productGid: run.productGid,
    diagnosisId: run.diagnosisId,
    asOfDate: run.asOfDate,
    timezone: run.timezone,
    windowStartDate: run.windowStartDate,
    windowEndDate: run.windowEndDate,
    lookbackDays: run.lookbackDays,
    maxCohortAgeDays: run.maxCohortAgeDays,
    currency: run.currency,
    schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
    status: run.status,
    errorMessage: run.errorMessage,
    metadata: run.metadata,
  };

  return db.$transaction(async (tx) => {
    const persistedRun = await tx.productRetentionRun.upsert({
      where: {
        shopId_productGid_diagnosisId: {
          shopId: run.shopId,
          productGid: run.productGid,
          diagnosisId: run.diagnosisId,
        },
      },
      create: {
        id: run.id,
        ...runData,
      },
      update: {
        ...runData,
        updatedAt: now,
      },
    });
    const where = {
      shopId: run.shopId,
      productGid: run.productGid,
      diagnosisId: run.diagnosisId,
    };
    await tx.productRetentionDailyCohort.deleteMany({ where });
    await tx.productRetentionCohortCell.deleteMany({ where });
    await tx.productRetentionDailyActivity.deleteMany({ where });
    await tx.productRetentionSegmentDaily.deleteMany({ where });
    await tx.productRetentionSummary.deleteMany({ where });

    await createManyInBatches(tx.productRetentionDailyCohort, rows.dailyCohorts.map(toDailyCohortDbRow));
    await createManyInBatches(tx.productRetentionCohortCell, rows.cohortCells.map(toCohortCellDbRow));
    await createManyInBatches(tx.productRetentionDailyActivity, rows.dailyActivity.map(toDailyActivityDbRow));
    await createManyInBatches(tx.productRetentionSegmentDaily, rows.segmentDaily.map(toSegmentDailyDbRow));
    if (rows.summary) {
      await tx.productRetentionSummary.create({ data: toSummaryDbRow(rows.summary) });
    }

    return persistedRun;
  });
}

async function upsertProductRetentionRun(db, run) {
  return db.productRetentionRun.upsert({
    where: {
      shopId_productGid_diagnosisId: {
        shopId: run.shopId,
        productGid: run.productGid,
        diagnosisId: run.diagnosisId,
      },
    },
    create: {
      shopId: run.shopId,
      productGid: run.productGid,
      diagnosisId: run.diagnosisId,
      asOfDate: run.asOfDate,
      timezone: run.timezone,
      windowStartDate: run.windowStartDate,
      windowEndDate: run.windowEndDate,
      lookbackDays: run.lookbackDays,
      maxCohortAgeDays: run.maxCohortAgeDays,
      currency: run.currency,
      schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
      status: run.status,
      metadata: run.metadata,
    },
    update: {
      asOfDate: run.asOfDate,
      timezone: run.timezone,
      windowStartDate: run.windowStartDate,
      windowEndDate: run.windowEndDate,
      lookbackDays: run.lookbackDays,
      maxCohortAgeDays: run.maxCohortAgeDays,
      currency: run.currency,
      schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
      status: run.status,
      errorMessage: null,
      metadata: run.metadata,
    },
  });
}

async function markProductRetentionRunFailed(db, {
  existingRunId,
  shopId,
  productGid,
  diagnosisId,
  asOfDate,
  timezone,
  windowStartDate,
  windowEndDate,
  lookbackDays,
  maxCohortAgeDays,
  currency,
  errorMessage,
  metadata,
}) {
  const data = {
    shopId,
    productGid,
    diagnosisId,
    asOfDate,
    timezone,
    windowStartDate,
    windowEndDate,
    lookbackDays,
    maxCohortAgeDays,
    currency,
    schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
    status: "failed",
    errorMessage: truncateText(errorMessage, 1000),
    metadata,
  };
  if (existingRunId) {
    return db.productRetentionRun.update({
      where: { id: existingRunId },
      data,
    }).catch(() => null);
  }
  return db.productRetentionRun.upsert({
    where: {
      shopId_productGid_diagnosisId: { shopId, productGid, diagnosisId },
    },
    create: data,
    update: data,
  }).catch(() => null);
}

async function createManyInBatches(model, data, batchSize = 1000) {
  if (!data.length) return;
  for (let index = 0; index < data.length; index += batchSize) {
    await model.createMany({ data: data.slice(index, index + batchSize) });
  }
}

function getRetentionRunStatus(rows, fetchStats = {}) {
  if (fetchStats.truncated) return "partial";
  if (!rows?.dataQuality?.cohortCustomerCount) return "partial";
  return "completed";
}

function buildDailyCohortRows({ shopId, productGid, diagnosisId, retentionRunId, facts }) {
  const cohorts = new Map();
  facts.forEach((fact) => {
    const row = ensureCohortAggregate(cohorts, {
      shopId,
      productGid,
      diagnosisId,
      retentionRunId,
      cohortDate: fact.cohortDate,
      observedDays: fact.observedDays,
    });
    row.cohortSize += 1;
    RETENTION_THRESHOLDS.forEach((days) => {
      if (fact.anyRepeatWithin[days]) row[`anyRepeatWithin${days}dCount`] += 1;
      if (fact.sameProductRepeatWithin[days]) row[`sameProductRepeatWithin${days}dCount`] += 1;
      if (fact.boughtOtherProductWithin[days]) row[`boughtOtherProductWithin${days}dCount`] += 1;
    });
    if (fact.nextPurchaseOutcome === "same_product_again") row.nextPurchaseSameProductCount += 1;
    if (fact.nextPurchaseOutcome === "bought_other_product") row.nextPurchaseOtherProductCount += 1;
    if (fact.nextPurchaseOutcome === "did_not_return") row.didNotReturnCount += 1;
    row.firstOrderNetRevenueCents += fact.firstOrderNetRevenueCents;
    [30, 60, 90, 180].forEach((days) => {
      row[`totalNetRevenueWithin${days}dCents`] += fact.totalNetRevenueWithin[days] || 0;
    });
    row.sameProductRevenueWithin90dCents += fact.sameProductRevenueWithin90dCents;
    row.otherProductRevenueWithin90dCents += fact.otherProductRevenueWithin90dCents;
    if (fact.daysToNextPurchase != null) row.daysToNextPurchase.push(fact.daysToNextPurchase);
    if (fact.daysToSameProductRepurchase != null) row.daysToSameProductRepurchase.push(fact.daysToSameProductRepurchase);
  });

  return Array.from(cohorts.values())
    .sort((left, right) => left.cohortDate.localeCompare(right.cohortDate))
    .map((row) => {
      [30, 60, 90, 180].forEach((days) => {
        row[`ltv${days}Cents`] = divideCents(row[`totalNetRevenueWithin${days}dCents`], row.cohortSize);
      });
      RETENTION_THRESHOLDS.forEach((days) => {
        row[`isMature${days}d`] = row.observedDays >= days;
      });
      row.avgDaysToNextPurchase = average(row.daysToNextPurchase);
      row.medianDaysToNextPurchase = median(row.daysToNextPurchase);
      row.avgDaysToSameProductRepurchase = average(row.daysToSameProductRepurchase);
      row.medianDaysToSameProductRepurchase = median(row.daysToSameProductRepurchase);
      delete row.daysToNextPurchase;
      delete row.daysToSameProductRepurchase;
      return row;
    });
}

function ensureCohortAggregate(cohorts, { shopId, productGid, diagnosisId, retentionRunId, cohortDate, observedDays }) {
  if (!cohorts.has(cohortDate)) {
    cohorts.set(cohortDate, {
      shopId,
      productGid,
      diagnosisId,
      retentionRunId,
      cohortDate,
      cohortSize: 0,
      anyRepeatWithin7dCount: 0,
      anyRepeatWithin14dCount: 0,
      anyRepeatWithin30dCount: 0,
      anyRepeatWithin60dCount: 0,
      anyRepeatWithin90dCount: 0,
      anyRepeatWithin180dCount: 0,
      sameProductRepeatWithin7dCount: 0,
      sameProductRepeatWithin14dCount: 0,
      sameProductRepeatWithin30dCount: 0,
      sameProductRepeatWithin60dCount: 0,
      sameProductRepeatWithin90dCount: 0,
      sameProductRepeatWithin180dCount: 0,
      boughtOtherProductWithin7dCount: 0,
      boughtOtherProductWithin14dCount: 0,
      boughtOtherProductWithin30dCount: 0,
      boughtOtherProductWithin60dCount: 0,
      boughtOtherProductWithin90dCount: 0,
      boughtOtherProductWithin180dCount: 0,
      nextPurchaseSameProductCount: 0,
      nextPurchaseOtherProductCount: 0,
      didNotReturnCount: 0,
      firstOrderNetRevenueCents: 0,
      totalNetRevenueWithin30dCents: 0,
      totalNetRevenueWithin60dCents: 0,
      totalNetRevenueWithin90dCents: 0,
      totalNetRevenueWithin180dCents: 0,
      sameProductRevenueWithin90dCents: 0,
      otherProductRevenueWithin90dCents: 0,
      ltv30Cents: 0,
      ltv60Cents: 0,
      ltv90Cents: 0,
      ltv180Cents: 0,
      avgDaysToNextPurchase: null,
      medianDaysToNextPurchase: null,
      avgDaysToSameProductRepurchase: null,
      medianDaysToSameProductRepurchase: null,
      isMature7d: false,
      isMature14d: false,
      isMature30d: false,
      isMature60d: false,
      isMature90d: false,
      isMature180d: false,
      observedDays,
      daysToNextPurchase: [],
      daysToSameProductRepurchase: [],
    });
  }
  return cohorts.get(cohortDate);
}

function buildCohortCellRows({ shopId, productGid, diagnosisId, retentionRunId, cohorts, facts, maxCohortAgeDays }) {
  const factsByCohort = groupBy(facts, (fact) => fact.cohortDate);
  const rows = [];
  cohorts.forEach((cohort) => {
    const cohortFacts = factsByCohort.get(cohort.cohortDate) || [];
    for (let ageDay = 0; ageDay <= maxCohortAgeDays; ageDay += 1) {
      const isObserved = cohort.observedDays >= ageDay;
      const row = {
        shopId,
        productGid,
        diagnosisId,
        retentionRunId,
        cohortDate: cohort.cohortDate,
        ageDay,
        cohortSize: cohort.cohortSize,
        anyRepeatCumulativeCount: 0,
        sameProductRepeatCumulativeCount: 0,
        boughtOtherProductCumulativeCount: 0,
        anyRepeatRate: null,
        sameProductRepeatRate: null,
        boughtOtherProductRate: null,
        cumulativeNetRevenueCents: 0,
        cumulativeLtvCents: 0,
        sameProductCumulativeRevenueCents: 0,
        otherProductCumulativeRevenueCents: 0,
        sameProductCumulativeLtvCents: 0,
        otherProductCumulativeLtvCents: 0,
        isObserved,
      };
      if (isObserved) {
        cohortFacts.forEach((fact) => {
          if (fact.anyRepeatAgeDay != null && fact.anyRepeatAgeDay <= ageDay) row.anyRepeatCumulativeCount += 1;
          if (fact.sameProductRepeatAgeDay != null && fact.sameProductRepeatAgeDay <= ageDay) row.sameProductRepeatCumulativeCount += 1;
          if (fact.boughtOtherProductAgeDay != null && fact.boughtOtherProductAgeDay <= ageDay) row.boughtOtherProductCumulativeCount += 1;
          row.cumulativeNetRevenueCents += fact.cumulativeRevenueByAgeDay[ageDay] || 0;
          row.sameProductCumulativeRevenueCents += fact.sameProductRevenueByAgeDay[ageDay] || 0;
          row.otherProductCumulativeRevenueCents += fact.otherProductRevenueByAgeDay[ageDay] || 0;
        });
        row.anyRepeatRate = ratio(row.anyRepeatCumulativeCount, cohort.cohortSize);
        row.sameProductRepeatRate = ratio(row.sameProductRepeatCumulativeCount, cohort.cohortSize);
        row.boughtOtherProductRate = ratio(row.boughtOtherProductCumulativeCount, cohort.cohortSize);
        row.cumulativeLtvCents = divideCents(row.cumulativeNetRevenueCents, cohort.cohortSize);
        row.sameProductCumulativeLtvCents = divideCents(row.sameProductCumulativeRevenueCents, cohort.cohortSize);
        row.otherProductCumulativeLtvCents = divideCents(row.otherProductCumulativeRevenueCents, cohort.cohortSize);
      }
      rows.push(row);
    }
  });
  return rows;
}

function buildDailyActivityRows({ shopId, productGid, diagnosisId, retentionRunId, orders, customerRecords, timezone, windowStart, windowEnd }) {
  const customerByKey = new Map(customerRecords.map((record) => [record.customerKey, record]));
  const rowsByDate = new Map(dateRangeKeys(windowStart, windowEnd, timezone).map((dateKey) => [
    dateKey,
    createDailyActivityAggregate({ shopId, productGid, diagnosisId, retentionRunId, metricDate: dateKey }),
  ]));

  orders.forEach((order) => {
    const row = rowsByDate.get(order.localDateKey);
    if (!row) return;
    const productLines = getOrderProductLines(order, productGid);
    const otherLines = getOrderOtherProductLines(order, productGid);
    const record = customerByKey.get(order.customerKey);
    const isProductBuyer = Boolean(record);
    const isAfterFirstProductPurchase = Boolean(record && order.orderDate.getTime() > record.firstProductOrder.orderDate.getTime());
    const isAtOrAfterFirstProductPurchase = Boolean(record && order.orderDate.getTime() >= record.firstProductOrder.orderDate.getTime());

    if (productLines.length) {
      row.productOrderIds.add(order.id);
      row.uniqueProductBuyerKeys.add(order.customerKey);
      row.productUnitsSold += sum(productLines, "quantity");
      row.productGrossRevenueCents += sum(productLines, "grossRevenueCents");
      row.productNetRevenueCents += sum(productLines, "netRevenueCents");
      if (record?.cohortDate === order.localDateKey && record.firstProductOrder.id === order.id) row.newProductBuyerKeys.add(order.customerKey);
      if (record && record.cohortDate < order.localDateKey) row.returningProductBuyerKeys.add(order.customerKey);
      if (isAfterFirstProductPurchase) {
        row.customersBuyingProductAgainKeys.add(order.customerKey);
        row.sameProductRepeatRevenueCents += sum(productLines, "netRevenueCents");
      }
    }

    if (isProductBuyer && isAtOrAfterFirstProductPurchase) {
      row.postProductCustomerRevenueCents += order.netRevenueCents;
      if (isAfterFirstProductPurchase) {
        row.customersWithAnyRepeatOrderKeys.add(order.customerKey);
        if (otherLines.length) {
          row.customersBuyingOtherProductAfterThisProductKeys.add(order.customerKey);
          row.otherProductRevenueFromProductCustomersCents += sum(otherLines, "netRevenueCents");
        }
      }
    }

    productLines.forEach((line) => {
      if (Array.isArray(line.refunds) && line.refunds.length) {
        line.refunds.forEach((refund) => {
          const refundDateKey = getLocalDateKey(refund.processedAt || refund.createdAt || order.orderDate, timezone);
          const refundRow = rowsByDate.get(refundDateKey);
          if (!refundRow) return;
          refundRow.refundedOrderIds.add(order.id);
          refundRow.refundedRevenueCents += normalizeCents(refund.amountCents ?? refund.refundedRevenueCents ?? refund.amount ?? 0);
        });
      } else if (line.refundedRevenueCents > 0) {
        row.refundedOrderIds.add(order.id);
        row.refundedRevenueCents += line.refundedRevenueCents;
      }
    });
  });

  return Array.from(rowsByDate.values()).map(finalizeDailyActivityAggregate);
}

function createDailyActivityAggregate({ shopId, productGid, diagnosisId, retentionRunId, metricDate }) {
  return {
    shopId,
    productGid,
    diagnosisId,
    retentionRunId,
    metricDate,
    productOrderIds: new Set(),
    uniqueProductBuyerKeys: new Set(),
    newProductBuyerKeys: new Set(),
    returningProductBuyerKeys: new Set(),
    productUnitsSold: 0,
    productGrossRevenueCents: 0,
    productNetRevenueCents: 0,
    sameProductRepeatRevenueCents: 0,
    postProductCustomerRevenueCents: 0,
    otherProductRevenueFromProductCustomersCents: 0,
    customersBuyingProductAgainKeys: new Set(),
    customersBuyingOtherProductAfterThisProductKeys: new Set(),
    customersWithAnyRepeatOrderKeys: new Set(),
    refundedOrderIds: new Set(),
    refundedRevenueCents: 0,
  };
}

function finalizeDailyActivityAggregate(row) {
  const productOrdersCount = row.productOrderIds.size;
  const uniqueProductBuyers = row.uniqueProductBuyerKeys.size;
  const newProductBuyers = row.newProductBuyerKeys.size;
  const returningProductBuyers = row.returningProductBuyerKeys.size;
  const customersBuyingProductAgainCount = row.customersBuyingProductAgainKeys.size;
  const customersBuyingOtherProductAfterThisProductCount = row.customersBuyingOtherProductAfterThisProductKeys.size;
  const customersWithAnyRepeatOrderCount = row.customersWithAnyRepeatOrderKeys.size;
  const returningRevenue = row.sameProductRepeatRevenueCents + row.otherProductRevenueFromProductCustomersCents;
  return {
    shopId: row.shopId,
    productGid: row.productGid,
    diagnosisId: row.diagnosisId,
    retentionRunId: row.retentionRunId,
    metricDate: row.metricDate,
    productOrdersCount,
    productUnitsSold: row.productUnitsSold,
    uniqueProductBuyers,
    newProductBuyers,
    returningProductBuyers,
    productGrossRevenueCents: row.productGrossRevenueCents,
    productNetRevenueCents: row.productNetRevenueCents,
    sameProductRepeatRevenueCents: row.sameProductRepeatRevenueCents,
    postProductCustomerRevenueCents: row.postProductCustomerRevenueCents,
    otherProductRevenueFromProductCustomersCents: row.otherProductRevenueFromProductCustomersCents,
    customersBuyingProductAgainCount,
    customersBuyingOtherProductAfterThisProductCount,
    customersWithAnyRepeatOrderCount,
    returningProductBuyerShare: ratio(returningProductBuyers, uniqueProductBuyers),
    sameProductRepurchaseShare: ratio(customersBuyingProductAgainCount, uniqueProductBuyers),
    crossSellShare: ratio(customersBuyingOtherProductAfterThisProductCount, customersWithAnyRepeatOrderCount || uniqueProductBuyers),
    returningRevenueShare: ratio(returningRevenue, row.postProductCustomerRevenueCents),
    refundedOrdersCount: row.refundedOrderIds.size,
    refundedRevenueCents: row.refundedRevenueCents,
    returnRate: null,
    refundRate: ratio(row.refundedRevenueCents, row.productGrossRevenueCents),
  };
}

function buildSegmentDailyRows({ shopId, productGid, diagnosisId, retentionRunId, facts }) {
  const groups = new Map();
  facts.forEach((fact) => {
    fact.segments.forEach((segment) => {
      const key = `${fact.cohortDate}\u0000${segment.segmentType}\u0000${segment.segmentValue}`;
      if (!groups.has(key)) {
        groups.set(key, {
          shopId,
          productGid,
          diagnosisId,
          retentionRunId,
          cohortDate: fact.cohortDate,
          segmentType: segment.segmentType,
          segmentValue: segment.segmentValue,
          cohortSize: 0,
          anyRepeatWithin30dCount: 0,
          anyRepeatWithin90dCount: 0,
          sameProductRepeatWithin90dCount: 0,
          boughtOtherProductWithin90dCount: 0,
          netRevenueWithin90dCents: 0,
          ltv90Cents: 0,
          daysToNextPurchase: [],
          isMature90d: fact.observedDays >= 90,
          isLowSampleSize: false,
        });
      }
      const row = groups.get(key);
      row.cohortSize += 1;
      if (fact.anyRepeatWithin[30]) row.anyRepeatWithin30dCount += 1;
      if (fact.anyRepeatWithin[90]) row.anyRepeatWithin90dCount += 1;
      if (fact.sameProductRepeatWithin[90]) row.sameProductRepeatWithin90dCount += 1;
      if (fact.boughtOtherProductWithin[90]) row.boughtOtherProductWithin90dCount += 1;
      row.netRevenueWithin90dCents += fact.totalNetRevenueWithin[90] || 0;
      if (fact.daysToNextPurchase != null) row.daysToNextPurchase.push(fact.daysToNextPurchase);
    });
  });

  return Array.from(groups.values())
    .sort((left, right) => (
      left.segmentType.localeCompare(right.segmentType)
      || left.segmentValue.localeCompare(right.segmentValue)
      || left.cohortDate.localeCompare(right.cohortDate)
    ))
    .map((row) => {
      row.ltv90Cents = divideCents(row.netRevenueWithin90dCents, row.cohortSize);
      row.avgDaysToNextPurchase = average(row.daysToNextPurchase);
      row.medianDaysToNextPurchase = median(row.daysToNextPurchase);
      row.isLowSampleSize = row.cohortSize < PRODUCT_RETENTION_LOW_SAMPLE_SIZE;
      delete row.daysToNextPurchase;
      return row;
    });
}

function buildRetentionSummaryRow({
  shopId,
  productGid,
  diagnosisId,
  retentionRunId,
  asOfDate,
  facts,
  dailyActivity,
  validOrders,
  validWindowOrders,
}) {
  const aggregate90 = aggregateFactsForThreshold(facts, 90);
  const aggregate180 = aggregateFactsForThreshold(facts, 180);
  const repeatPurchaseRate90d = aggregate90.repeatRate;
  const repeatPurchaseRate180d = aggregate180.repeatRate;
  const sameProductRepurchaseRate90d = aggregate90.sameProductRate;
  const sameProductRepurchaseRate180d = aggregate180.sameProductRate;
  const crossSellRetentionRate90d = aggregate90.otherProductRate;
  const returningRevenueShare = aggregateDailyReturningRevenueShare(dailyActivity);
  const daysToNextPurchase = facts.map((fact) => fact.daysToNextPurchase).filter(isFiniteNumber);
  const productLtv90Cents = aggregate90.ltvCents;
  const productLtv180Cents = aggregate180.ltvCents;
  const refundRate = aggregateDailyRefundRate(dailyActivity);
  const firstOrderAverageCents = divideCents(sum(facts, "firstOrderNetRevenueCents"), facts.length);
  const hasEnoughData = aggregate90.customerCount >= PRODUCT_RETENTION_MIN_HEALTH_SCORE_SAMPLE;
  const lowSampleWarning = facts.length > 0 && aggregate90.customerCount < 10;
  const periodComparison = buildPreviousPeriodComparison(facts, dailyActivity, asOfDate);
  const retentionHealthScore = calculateRetentionHealthScore({
    hasEnoughData,
    repeatPurchaseRate90d,
    sameProductRepurchaseRate90d,
    crossSellRetentionRate90d,
    productLtv90Cents,
    firstOrderAverageCents,
    medianDaysToSecondPurchase: median(daysToNextPurchase),
    refundRate,
  });

  return {
    shopId,
    productGid,
    diagnosisId,
    retentionRunId,
    asOfDate,
    repeatPurchaseRate90d,
    repeatPurchaseRate180d,
    sameProductRepurchaseRate90d,
    sameProductRepurchaseRate180d,
    crossSellRetentionRate90d,
    returningRevenueShare,
    avgDaysToSecondPurchase: average(daysToNextPurchase),
    medianDaysToSecondPurchase: median(daysToNextPurchase),
    productLtv90Cents,
    productLtv180Cents,
    retentionHealthScore,
    repeatPurchaseRate90dPrevious: periodComparison.repeatPurchaseRate90dPrevious,
    repeatPurchaseRate90dDelta: subtractNullable(repeatPurchaseRate90d, periodComparison.repeatPurchaseRate90dPrevious),
    sameProductRepurchaseRate90dPrevious: periodComparison.sameProductRepurchaseRate90dPrevious,
    sameProductRepurchaseRate90dDelta: subtractNullable(sameProductRepurchaseRate90d, periodComparison.sameProductRepurchaseRate90dPrevious),
    ltv90PreviousCents: periodComparison.ltv90PreviousCents,
    ltv90DeltaCents: periodComparison.ltv90PreviousCents == null ? null : productLtv90Cents - periodComparison.ltv90PreviousCents,
    returningRevenueSharePrevious: periodComparison.returningRevenueSharePrevious,
    returningRevenueShareDelta: subtractNullable(returningRevenueShare, periodComparison.returningRevenueSharePrevious),
    totalCustomersAnalyzed: new Set(validOrders.map((order) => order.customerKey)).size,
    totalOrdersAnalyzed: validWindowOrders.length,
    totalProductOrdersAnalyzed: new Set(validWindowOrders.filter((order) => orderHasProduct(order, productGid)).map((order) => order.id)).size,
    earliestOrderDate: validOrders[0]?.orderDate || null,
    latestOrderDate: validOrders[validOrders.length - 1]?.orderDate || null,
    hasEnoughData,
    lowSampleWarning,
  };
}

function aggregateFactsForThreshold(facts, thresholdDays) {
  const matureFacts = facts.filter((fact) => fact.observedDays >= thresholdDays);
  const customerCount = matureFacts.length;
  return {
    customerCount,
    repeatRate: ratio(matureFacts.filter((fact) => fact.anyRepeatWithin[thresholdDays]).length, customerCount),
    sameProductRate: ratio(matureFacts.filter((fact) => fact.sameProductRepeatWithin[thresholdDays]).length, customerCount),
    otherProductRate: ratio(matureFacts.filter((fact) => fact.boughtOtherProductWithin[thresholdDays]).length, customerCount),
    ltvCents: divideCents(matureFacts.reduce((total, fact) => total + (fact.totalNetRevenueWithin[thresholdDays] || 0), 0), customerCount),
  };
}

function buildPreviousPeriodComparison(facts, dailyActivity, asOfDate) {
  const asOfKey = toDateKey(asOfDate);
  const currentPeriodEnd = addDaysToDateKey(asOfKey, -90);
  const currentPeriodStart = addDaysToDateKey(currentPeriodEnd, -89);
  const previousPeriodEnd = addDaysToDateKey(currentPeriodStart, -1);
  const previousPeriodStart = addDaysToDateKey(previousPeriodEnd, -89);
  const previousFacts = facts.filter((fact) => fact.cohortDate >= previousPeriodStart && fact.cohortDate <= previousPeriodEnd);
  const previousAggregate = aggregateFactsForThreshold(previousFacts, 90);
  const previousDailyRows = dailyActivity.filter((row) => row.metricDate >= previousPeriodStart && row.metricDate <= previousPeriodEnd);
  return {
    repeatPurchaseRate90dPrevious: previousAggregate.repeatRate,
    sameProductRepurchaseRate90dPrevious: previousAggregate.sameProductRate,
    ltv90PreviousCents: previousAggregate.customerCount ? previousAggregate.ltvCents : null,
    returningRevenueSharePrevious: aggregateDailyReturningRevenueShare(previousDailyRows),
    currentPeriodStart,
    currentPeriodEnd,
    previousPeriodStart,
    previousPeriodEnd,
  };
}

function aggregateDailyReturningRevenueShare(rows) {
  const returningRevenue = rows.reduce((total, row) => total + Number(row.sameProductRepeatRevenueCents || 0) + Number(row.otherProductRevenueFromProductCustomersCents || 0), 0);
  const postProductRevenue = rows.reduce((total, row) => total + Number(row.postProductCustomerRevenueCents || 0), 0);
  return ratio(returningRevenue, postProductRevenue);
}

function aggregateDailyRefundRate(rows) {
  const refunded = rows.reduce((total, row) => total + Number(row.refundedRevenueCents || 0), 0);
  const gross = rows.reduce((total, row) => total + Number(row.productGrossRevenueCents || 0), 0);
  return ratio(refunded, gross);
}

function calculateRetentionHealthScore({
  hasEnoughData,
  repeatPurchaseRate90d,
  sameProductRepurchaseRate90d,
  crossSellRetentionRate90d,
  productLtv90Cents,
  firstOrderAverageCents,
  medianDaysToSecondPurchase,
  refundRate,
}) {
  if (!hasEnoughData) return null;

  // Transparent 0-100 score:
  // 35% any 90d repeat rate, 20% same-product 90d repeat, 15% cross-sell retention,
  // 15% LTV90 relative to first-order value when no store-wide average is available,
  // 10% speed to second purchase, 5% refund penalty.
  const repeatScore = clampNumber(Number(repeatPurchaseRate90d || 0) * 100, 0, 100);
  const sameProductScore = clampNumber(Number(sameProductRepurchaseRate90d || 0) * 100, 0, 100);
  const crossSellScore = clampNumber(Number(crossSellRetentionRate90d || 0) * 100, 0, 100);
  const ltvScore = firstOrderAverageCents > 0
    ? clampNumber((Number(productLtv90Cents || 0) / firstOrderAverageCents) * 50, 0, 100)
    : 50;
  const speedScore = medianDaysToSecondPurchase == null
    ? 50
    : clampNumber(100 - (Number(medianDaysToSecondPurchase || 0) / 90) * 100, 0, 100);
  const refundScore = clampNumber(100 - Number(refundRate || 0) * 100, 0, 100);
  return Math.round(
    repeatScore * 0.35
    + sameProductScore * 0.20
    + crossSellScore * 0.15
    + ltvScore * 0.15
    + speedScore * 0.10
    + refundScore * 0.05,
  );
}

function buildRetentionCustomerRecords(validOrders, productGid, asOfDate, timezone) {
  const byCustomer = groupBy(validOrders, (order) => order.customerKey);
  const records = [];
  byCustomer.forEach((orders, customerKey) => {
    const sortedOrders = [...orders].sort(compareRetentionOrders);
    const firstProductOrder = sortedOrders.find((order) => orderHasProduct(order, productGid));
    if (!firstProductOrder) return;
    const priorOrders = sortedOrders.filter((order) => order.orderDate.getTime() < firstProductOrder.orderDate.getTime());
    records.push({
      customerKey,
      orders: sortedOrders,
      firstProductOrder,
      priorOrders,
      cohortDate: getLocalDateKey(firstProductOrder.orderDate, timezone),
      observedDays: Math.max(0, Math.floor((asOfDate.getTime() - firstProductOrder.orderDate.getTime()) / DAY_MS)),
      existingCustomer: priorOrders.length > 0,
    });
  });
  return records;
}

function buildCustomerRetentionFact(record, productGid, asOfDate, timezone, maxCohortAgeDays) {
  const firstOrder = record.firstProductOrder;
  const firstTime = firstOrder.orderDate.getTime();
  const ordersFromFirst = record.orders.filter((order) => order.orderDate.getTime() >= firstTime);
  const subsequentOrders = record.orders.filter((order) => order.orderDate.getTime() > firstTime);
  const firstNextOrder = subsequentOrders[0] || null;
  const firstSameProductOrder = subsequentOrders.find((order) => orderHasProduct(order, productGid)) || null;
  const firstOtherProductOrder = subsequentOrders.find((order) => orderHasOtherProduct(order, productGid)) || null;
  const firstNextHasSameProduct = firstNextOrder ? orderHasProduct(firstNextOrder, productGid) : false;
  const firstNextHasOtherProduct = firstNextOrder ? orderHasOtherProduct(firstNextOrder, productGid) : false;
  const anyRepeatWithin = {};
  const sameProductRepeatWithin = {};
  const boughtOtherProductWithin = {};
  const totalNetRevenueWithin = {};

  RETENTION_THRESHOLDS.forEach((days) => {
    const maxTime = firstTime + days * DAY_MS;
    anyRepeatWithin[days] = subsequentOrders.some((order) => order.orderDate.getTime() <= maxTime);
    sameProductRepeatWithin[days] = subsequentOrders.some((order) => order.orderDate.getTime() <= maxTime && orderHasProduct(order, productGid));
    boughtOtherProductWithin[days] = subsequentOrders.some((order) => order.orderDate.getTime() <= maxTime && orderHasOtherProduct(order, productGid));
  });
  [30, 60, 90, 180].forEach((days) => {
    totalNetRevenueWithin[days] = sumOrdersWithinDays(ordersFromFirst, firstTime, days, (order) => order.netRevenueCents);
  });

  const sameProductRevenueWithin90dCents = sumOrdersWithinDays(ordersFromFirst, firstTime, 90, (order) => sum(getOrderProductLines(order, productGid), "netRevenueCents"));
  const otherProductRevenueWithin90dCents = sumOrdersWithinDays(ordersFromFirst, firstTime, 90, (order) => sum(getOrderOtherProductLines(order, productGid), "netRevenueCents"));
  const firstOrderProductLines = getOrderProductLines(firstOrder, productGid);
  const daysToNextPurchase = firstNextOrder ? ageDayBetweenOrders(firstOrder, firstNextOrder) : null;
  const daysToSameProductRepurchase = firstSameProductOrder ? ageDayBetweenOrders(firstOrder, firstSameProductOrder) : null;
  const revenueCurves = buildCustomerRevenueCurves({ ordersFromFirst, firstDateKey: firstOrder.localDateKey, productGid, maxCohortAgeDays });

  return {
    customerKey: record.customerKey,
    cohortDate: record.cohortDate,
    observedDays: record.observedDays,
    firstProductOrderId: firstOrder.id,
    firstOrderNetRevenueCents: firstOrder.netRevenueCents,
    firstProductQuantity: sum(firstOrderProductLines, "quantity"),
    firstProductUnitPriceCents: getFirstProductUnitPriceCents(firstOrderProductLines),
    existingCustomer: record.existingCustomer,
    anyRepeatWithin,
    sameProductRepeatWithin,
    boughtOtherProductWithin,
    totalNetRevenueWithin,
    sameProductRevenueWithin90dCents,
    otherProductRevenueWithin90dCents,
    daysToNextPurchase,
    daysToSameProductRepurchase,
    anyRepeatAgeDay: firstNextOrder ? ageDayBetweenOrders(firstOrder, firstNextOrder) : null,
    sameProductRepeatAgeDay: firstSameProductOrder ? ageDayBetweenOrders(firstOrder, firstSameProductOrder) : null,
    boughtOtherProductAgeDay: firstOtherProductOrder ? ageDayBetweenOrders(firstOrder, firstOtherProductOrder) : null,
    nextPurchaseOutcome: !firstNextOrder
      ? "did_not_return"
      : firstNextHasSameProduct
        ? "same_product_again"
        : firstNextHasOtherProduct
          ? "bought_other_product"
          : "did_not_return",
    cumulativeRevenueByAgeDay: revenueCurves.total,
    sameProductRevenueByAgeDay: revenueCurves.sameProduct,
    otherProductRevenueByAgeDay: revenueCurves.otherProduct,
    segments: buildCustomerSegments({ record, firstOrder, firstOrderProductLines }),
  };
}

function buildCustomerRevenueCurves({ ordersFromFirst, firstDateKey, productGid, maxCohortAgeDays }) {
  const totalBuckets = Array(maxCohortAgeDays + 1).fill(0);
  const sameProductBuckets = Array(maxCohortAgeDays + 1).fill(0);
  const otherProductBuckets = Array(maxCohortAgeDays + 1).fill(0);
  ordersFromFirst.forEach((order) => {
    const rawDay = Math.max(0, dateKeyDiff(firstDateKey, order.localDateKey));
    if (rawDay > maxCohortAgeDays) return;
    const day = rawDay;
    totalBuckets[day] += order.netRevenueCents;
    sameProductBuckets[day] += sum(getOrderProductLines(order, productGid), "netRevenueCents");
    otherProductBuckets[day] += sum(getOrderOtherProductLines(order, productGid), "netRevenueCents");
  });
  return {
    total: cumulativeArray(totalBuckets),
    sameProduct: cumulativeArray(sameProductBuckets),
    otherProduct: cumulativeArray(otherProductBuckets),
  };
}

function buildCustomerSegments({ record, firstOrder, firstOrderProductLines }) {
  const segments = [];
  const add = (segmentType, value) => {
    const segmentValue = truncateText(String(value || "").trim(), 120);
    if (!segmentType || !segmentValue) return;
    segments.push({ segmentType, segmentValue });
  };
  const variantIds = Array.from(new Set(firstOrderProductLines.map((line) => line.variantGid || line.variantTitle || line.sku).filter(Boolean)));
  variantIds.forEach((variant) => add("variant", variant));
  add("customer_type_at_first_product_purchase", record.existingCustomer ? "existing_customer" : "new_to_store");
  add("acquisition_source", getAcquisitionSource(firstOrder));
  add("discount_used", firstOrder.discountUsed ? "yes" : "no");
  (firstOrder.discountCodes.length ? firstOrder.discountCodes : ["no_discount_code"]).forEach((code) => add("discount_code", code));
  add("country", "unknown");
  add("province", "unknown");
  add("order_channel", firstOrder.sourceName || "unknown");
  (firstOrder.customerTags.length ? firstOrder.customerTags : ["untagged"]).forEach((tag) => add("customer_tag", tag));
  add("quantity_bucket", quantityBucket(sum(firstOrderProductLines, "quantity")));
  add("price_bucket", priceBucket(getFirstProductUnitPriceCents(firstOrderProductLines)));
  add("marketing_consent", "unknown");
  return dedupeSegments(segments);
}

function normalizeRetentionOrders(orders, { timezone }) {
  return (Array.isArray(orders) ? orders : [])
    .map((order, index) => normalizeRetentionOrder(order, { timezone, index }))
    .filter(Boolean);
}

function normalizeRetentionOrder(order, { timezone, index = 0 }) {
  const orderDate = parseDate(order?.processedAt || order?.orderProcessedAt || order?.createdAt || order?.orderDate);
  if (!orderDate) return null;
  const customerKey = getRetentionCustomerKey(order);
  const rawLineItems = getConnectionNodes(order?.lineItems || order?.line_items || order?.lineItemsConnection || []);
  const discountCodes = normalizeDiscountCodes(order?.discountCodes || order?.discount_codes || order?.discountApplications);
  const lineItems = rawLineItems.map((lineItem, lineIndex) => normalizeRetentionLineItem(lineItem, { order, discountCodes, lineIndex })).filter(Boolean);
  const grossRevenueCents = sum(lineItems, "grossRevenueCents");
  const netRevenueCents = sum(lineItems, "netRevenueCents");
  const customer = order?.customer || {};
  return {
    id: String(order?.id || order?.orderId || `order:${index}`),
    name: order?.name || order?.orderName || "",
    customerKey,
    customerGid: order?.customerGid || order?.customerId || customer.id || null,
    orderDate,
    localDateKey: getLocalDateKey(orderDate, timezone),
    processedAt: order?.processedAt || order?.orderProcessedAt || null,
    createdAt: order?.createdAt || order?.orderCreatedAt || null,
    cancelledAt: order?.cancelledAt || order?.canceledAt || order?.cancelled_at || null,
    test: Boolean(order?.test || order?.isTest),
    displayFinancialStatus: order?.displayFinancialStatus || order?.financialStatus || order?.financial_status || "",
    sourceName: order?.sourceName || order?.source_name || order?.channel || "",
    referrerUrl: order?.referrerUrl || order?.referringSite || order?.referring_site || "",
    landingPageUrl: order?.landingPageUrl || order?.landing_page || "",
    customerTags: normalizeStringList(order?.customerTags || customer.tags),
    discountCodes,
    discountUsed: Boolean(discountCodes.length || Number(order?.totalDiscountsCents || 0) > 0 || moneyBagToCents(order?.totalDiscountsSet) > 0),
    lineItems,
    grossRevenueCents,
    netRevenueCents,
    currency: inferCurrencyFromOrder(order, lineItems),
  };
}

function normalizeRetentionLineItem(lineItem, { order, discountCodes, lineIndex }) {
  const productGid = lineItem?.productGid || lineItem?.productId || lineItem?.product?.id || lineItem?.variant?.product?.id || "";
  const variantGid = lineItem?.variantGid || lineItem?.variantId || lineItem?.variant?.id || "";
  const quantity = Math.max(0, Math.round(Number(lineItem?.quantity || 0)));
  const grossRevenueCents = firstFiniteCents(
    lineItem?.grossRevenueCents,
    lineItem?.originalTotalCents,
    lineItem?.originalTotalSet ? moneyBagToCents(lineItem.originalTotalSet) : null,
    lineItem?.originalTotal ? moneyBagToCents(lineItem.originalTotal) : null,
    lineItem?.grossRevenue != null ? moneyToCents(lineItem.grossRevenue) : null,
    lineItem?.amount != null ? moneyToCents(lineItem.amount) : null,
  );
  const discountedRevenueCents = firstFiniteCents(
    lineItem?.discountedRevenueCents,
    lineItem?.netRevenueBeforeRefundCents,
    lineItem?.discountedTotalSet ? moneyBagToCents(lineItem.discountedTotalSet) : null,
    lineItem?.discountedTotal ? moneyBagToCents(lineItem.discountedTotal) : null,
    grossRevenueCents - normalizeCents(lineItem?.discountAmountCents || 0),
  );
  const refunds = normalizeLineRefunds(lineItem, order);
  const refundedRevenueCents = firstFiniteCents(
    lineItem?.refundedRevenueCents,
    refunds.reduce((total, refund) => total + refund.amountCents, 0),
  );
  const netRevenueCents = firstFiniteCents(
    lineItem?.netRevenueCents,
    Math.max(0, discountedRevenueCents - refundedRevenueCents),
  );
  return {
    id: String(lineItem?.id || lineItem?.lineItemGid || lineItem?.lineItemId || `line:${lineIndex}`),
    productGid: String(productGid || ""),
    variantGid: String(variantGid || ""),
    title: lineItem?.title || lineItem?.product?.title || "",
    sku: lineItem?.sku || lineItem?.variant?.sku || "",
    variantTitle: lineItem?.variantTitle || lineItem?.variant?.title || "",
    quantity,
    grossRevenueCents,
    discountedRevenueCents,
    refundedRevenueCents,
    netRevenueCents,
    currency: inferCurrencyFromMoney(lineItem?.discountedTotalSet || lineItem?.originalTotalSet) || order?.currency || "",
    discountCodes: normalizeDiscountCodes(lineItem?.discountCodes || lineItem?.discountAllocations).concat(discountCodes),
    refunds,
  };
}

function normalizeLineRefunds(lineItem, order) {
  const explicit = Array.isArray(lineItem?.refunds) ? lineItem.refunds : [];
  return explicit.map((refund, index) => ({
    id: refund.id || `refund:${lineItem?.id || ""}:${index}`,
    processedAt: refund.processedAt || refund.createdAt || order?.processedAt || order?.createdAt || null,
    amountCents: normalizeCents(refund.amountCents ?? refund.refundedRevenueCents ?? moneyToCents(refund.amount)),
  })).filter((refund) => refund.amountCents > 0);
}

function getRetentionCustomerKey(order) {
  const customer = order?.customer || {};
  const customerGid = String(order?.customerGid || order?.customerId || customer.id || "").trim();
  if (customerGid) return `customer:${customerGid}`;
  return "";
}

function isValidRetentionOrder(order, { includeTestOrders = false } = {}) {
  if (!order?.id || !order?.customerKey || !order?.orderDate) return false;
  if (order.cancelledAt) return false;
  if (order.test && !includeTestOrders) return false;
  const financialStatus = String(order.displayFinancialStatus || "").toUpperCase();
  if (["PENDING", "AUTHORIZED", "VOIDED"].includes(financialStatus)) return false;
  if (!order.lineItems?.length) return false;
  return order.netRevenueCents >= 0;
}

async function fetchShopifyRetentionShopInfo(admin) {
  if (!admin?.graphql) return null;
  const data = await shopifyGraphql(admin, `#graphql
    query ProductPulseRetentionShopInfo {
      shop {
        ianaTimezone
        currencyCode
      }
    }
  `);
  return {
    timezone: data?.shop?.ianaTimezone || "UTC",
    currency: data?.shop?.currencyCode || "",
  };
}

async function fetchShopifyProductRetentionOrders({ admin, windowStartDate, windowEndDate }) {
  if (!admin?.graphql) return { orders: [], pagesScanned: 0, truncated: false };
  const orders = [];
  let cursor = null;
  let pagesScanned = 0;
  const query = [
    `processed_at:>=${toShopifyDateQueryValue(windowStartDate)}`,
    `processed_at:<=${toShopifyDateQueryValue(windowEndDate)}`,
  ].join(" ");

  for (let page = 0; page < PRODUCT_RETENTION_MAX_ORDER_PAGES; page += 1) {
    const data = await shopifyGraphql(admin, buildProductRetentionOrdersQuery(), {
      after: cursor,
      first: PRODUCT_RETENTION_ORDER_PAGE_SIZE,
      lineItemsFirst: 100,
      refundLineItemsFirst: 100,
      query,
    });
    pagesScanned += 1;
    getConnectionNodes(data?.orders).forEach((order) => orders.push(normalizeShopifyRetentionOrder(order)));
    if (!data?.orders?.pageInfo?.hasNextPage) {
      return { orders, pagesScanned, truncated: false };
    }
    cursor = data.orders.pageInfo.endCursor;
  }

  return { orders, pagesScanned, truncated: true };
}

function normalizeShopifyRetentionOrder(order) {
  const rawLineItems = getConnectionNodes(order?.lineItems);
  const totalRefundedCents = moneyBagToCents(order?.totalRefundedSet);
  const refundByLineItemId = new Map();
  const refundEventsByLineItemId = new Map();
  (order?.refunds || []).forEach((refund) => {
    getConnectionNodes(refund.refundLineItems).forEach((refundLineItem) => {
      const lineItemId = refundLineItem?.lineItem?.id || "";
      if (!lineItemId) return;
      const amountCents = moneyBagToCents(refundLineItem.subtotalSet);
      refundByLineItemId.set(lineItemId, (refundByLineItemId.get(lineItemId) || 0) + amountCents);
      const events = refundEventsByLineItemId.get(lineItemId) || [];
      events.push({
        id: refundLineItem.id || refund.id,
        processedAt: refund.processedAt || refund.createdAt || order.processedAt || order.createdAt,
        amountCents,
      });
      refundEventsByLineItemId.set(lineItemId, events);
    });
  });

  const discountedByLine = rawLineItems.map((lineItem) => {
    const originalCents = moneyBagToCents(lineItem.originalTotalSet);
    const discountedCents = moneyBagToCents(lineItem.discountedTotalSet) || Math.max(0, originalCents - sumDiscountAllocations(lineItem.discountAllocations));
    return { lineItem, originalCents, discountedCents };
  });
  const lineRefundTotal = Array.from(refundByLineItemId.values()).reduce((total, value) => total + value, 0);
  const remainingOrderRefundCents = Math.max(0, totalRefundedCents - lineRefundTotal);
  const discountedTotal = discountedByLine.reduce((total, item) => total + item.discountedCents, 0);

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    processedAt: order.processedAt,
    cancelledAt: order.cancelledAt,
    test: order.test,
    displayFinancialStatus: order.displayFinancialStatus,
    sourceName: order.sourceName,
    referrerUrl: order.referrerUrl,
    landingPageUrl: order.landingPageUrl,
    customer: order.customer,
    discountCodes: normalizeDiscountCodes(order.discountApplications),
    totalDiscountsCents: moneyBagToCents(order.totalDiscountsSet),
    lineItems: discountedByLine.map(({ lineItem, originalCents, discountedCents }) => {
      const directRefundCents = refundByLineItemId.get(lineItem.id) || 0;
      const allocatedOrderRefundCents = remainingOrderRefundCents && discountedTotal > 0
        ? Math.round((discountedCents / discountedTotal) * remainingOrderRefundCents)
        : 0;
      const refundedRevenueCents = directRefundCents + allocatedOrderRefundCents;
      return {
        id: lineItem.id,
        productGid: lineItem.product?.id || lineItem.variant?.product?.id || "",
        variantGid: lineItem.variant?.id || "",
        title: lineItem.product?.title || lineItem.title || "",
        sku: lineItem.sku || lineItem.variant?.sku || "",
        variantTitle: lineItem.variant?.title || "",
        quantity: Number(lineItem.quantity || 0),
        grossRevenueCents: originalCents,
        discountedRevenueCents: discountedCents,
        refundedRevenueCents,
        netRevenueCents: Math.max(0, discountedCents - refundedRevenueCents),
        discountCodes: normalizeDiscountCodes(lineItem.discountAllocations),
        refunds: refundEventsByLineItemId.get(lineItem.id) || [],
      };
    }),
  };
}

function buildProductRetentionOrdersQuery() {
  return `#graphql
    query ProductPulseRetentionOrders($after: String, $first: Int!, $query: String!, $lineItemsFirst: Int!, $refundLineItemsFirst: Int!) {
      orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: false) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          createdAt
          processedAt
          cancelledAt
          test
          displayFinancialStatus
          sourceName
          referrerUrl
          landingPageUrl
          customer {
            id
            tags
          }
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          discountApplications(first: 10) {
            nodes {
              ... on DiscountCodeApplication {
                code
              }
            }
          }
          lineItems(first: $lineItemsFirst) {
            nodes {
              id
              quantity
              title
              sku
              product {
                id
                title
                handle
              }
              variant {
                id
                title
                sku
                product {
                  id
                  title
                  handle
                }
              }
              originalTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              discountedTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              discountAllocations {
                allocatedAmountSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                discountApplication {
                  ... on DiscountCodeApplication {
                    code
                  }
                }
              }
            }
          }
          refunds {
            id
            createdAt
            processedAt
            refundLineItems(first: $refundLineItemsFirst) {
              nodes {
                id
                quantity
                subtotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                lineItem {
                  id
                }
              }
            }
          }
        }
      }
    }`;
}

export function buildProductRetentionPayload(rows = {}) {
  if (!rows?.summary) return buildEmptyProductRetentionPayload();
  const summary = serializeSummaryPayload(rows.summary);
  const dailyCohorts = (rows.dailyCohorts || []).map(serializeDailyCohortPayload);
  const cohortCells = (rows.cohortCells || []).map(serializeCohortCellPayload);
  const dailyActivity = (rows.dailyActivity || []).map(serializeDailyActivityPayload);
  const segmentDaily = (rows.segmentDaily || []).map(serializeSegmentDailyPayload);

  return {
    run: rows.run ? serializeRunPayload(rows.run) : {
      id: rows.retentionRunId || null,
      status: rows.summary?.hasEnoughData ? "completed" : "partial",
      schemaVersion: PRODUCT_RETENTION_SCHEMA_VERSION,
      asOfDate: toIso(rows.asOfDate),
      timezone: rows.timezone || "UTC",
      windowStartDate: toIso(rows.windowStartDate),
      windowEndDate: toIso(rows.windowEndDate),
      lookbackDays: rows.lookbackDays || PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS,
      maxCohortAgeDays: rows.maxCohortAgeDays || PRODUCT_RETENTION_DEFAULT_MAX_COHORT_AGE_DAYS,
      currency: rows.currency || null,
    },
    summary,
    dailyRetentionTrend: dailyCohorts.map((row) => ({
      date: row.cohortDate,
      cohortSize: row.cohortSize,
      repeatPurchaseRate90d: row.isMature90d ? ratio(row.anyRepeatWithin90dCount, row.cohortSize) : null,
      sameProductRepurchaseRate90d: row.isMature90d ? ratio(row.sameProductRepeatWithin90dCount, row.cohortSize) : null,
      crossSellRetentionRate90d: row.isMature90d ? ratio(row.boughtOtherProductWithin90dCount, row.cohortSize) : null,
      isMature90d: row.isMature90d,
    })),
    nextPurchaseOutcome: dailyCohorts.map((row) => ({
      date: row.cohortDate,
      sameProductAgainPercent: ratio(row.nextPurchaseSameProductCount, row.cohortSize) || 0,
      boughtAnotherProductPercent: ratio(row.nextPurchaseOtherProductCount, row.cohortSize) || 0,
      didNotReturnPercent: ratio(row.didNotReturnCount, row.cohortSize) || 0,
    })),
    cohortHeatmap: cohortCells.map((row) => ({
      cohortDate: row.cohortDate,
      ageDay: row.ageDay,
      cohortSize: row.cohortSize,
      anyRepeatRate: row.anyRepeatRate,
      sameProductRepeatRate: row.sameProductRepeatRate,
      boughtOtherProductRate: row.boughtOtherProductRate,
      cumulativeLtvCents: row.cumulativeLtvCents,
      isObserved: row.isObserved,
    })),
    timeToRepeatPurchase: aggregateCohortCellsByAge(cohortCells).map((row) => ({
      ageDay: row.ageDay,
      anyRepeatCumulativeRate: row.anyRepeatCumulativeRate,
      sameProductRepeatCumulativeRate: row.sameProductRepeatCumulativeRate,
      boughtOtherProductCumulativeRate: row.boughtOtherProductCumulativeRate,
    })),
    ltvCurve: aggregateCohortCellsByAge(cohortCells).map((row) => ({
      ageDay: row.ageDay,
      cumulativeLtvCents: row.cumulativeLtvCents,
      sameProductLtvCents: row.sameProductLtvCents,
      otherProductLtvCents: row.otherProductLtvCents,
    })),
    segments: aggregateSegmentsForPayload(segmentDaily),
    dailyActivity,
    segmentDaily,
  };
}

function buildEmptyProductRetentionPayload({ hasEnoughData = false, lowSampleWarning = true, errorMessage = "" } = {}) {
  return {
    run: null,
    summary: {
      repeatPurchaseRate90d: null,
      sameProductRepurchaseRate90d: null,
      crossSellRetentionRate90d: null,
      returningRevenueShare: null,
      avgDaysToSecondPurchase: null,
      medianDaysToSecondPurchase: null,
      productLtv90Cents: 0,
      retentionHealthScore: null,
      hasEnoughData,
      lowSampleWarning,
      errorMessage,
    },
    dailyRetentionTrend: [],
    nextPurchaseOutcome: [],
    cohortHeatmap: [],
    timeToRepeatPurchase: [],
    ltvCurve: [],
    segments: [],
    dailyActivity: [],
    segmentDaily: [],
  };
}

function aggregateCohortCellsByAge(cells) {
  const groups = new Map();
  cells.filter((cell) => cell.isObserved).forEach((cell) => {
    const row = groups.get(cell.ageDay) || {
      ageDay: cell.ageDay,
      cohortSize: 0,
      anyRepeatCumulativeCount: 0,
      sameProductRepeatCumulativeCount: 0,
      boughtOtherProductCumulativeCount: 0,
      cumulativeNetRevenueCents: 0,
      sameProductCumulativeRevenueCents: 0,
      otherProductCumulativeRevenueCents: 0,
    };
    row.cohortSize += cell.cohortSize;
    row.anyRepeatCumulativeCount += cell.anyRepeatCumulativeCount;
    row.sameProductRepeatCumulativeCount += cell.sameProductRepeatCumulativeCount;
    row.boughtOtherProductCumulativeCount += cell.boughtOtherProductCumulativeCount;
    row.cumulativeNetRevenueCents += cell.cumulativeNetRevenueCents;
    row.sameProductCumulativeRevenueCents += cell.sameProductCumulativeRevenueCents;
    row.otherProductCumulativeRevenueCents += cell.otherProductCumulativeRevenueCents;
    groups.set(cell.ageDay, row);
  });
  return Array.from(groups.values())
    .sort((left, right) => left.ageDay - right.ageDay)
    .map((row) => ({
      ...row,
      anyRepeatCumulativeRate: ratio(row.anyRepeatCumulativeCount, row.cohortSize) || 0,
      sameProductRepeatCumulativeRate: ratio(row.sameProductRepeatCumulativeCount, row.cohortSize) || 0,
      boughtOtherProductCumulativeRate: ratio(row.boughtOtherProductCumulativeCount, row.cohortSize) || 0,
      cumulativeLtvCents: divideCents(row.cumulativeNetRevenueCents, row.cohortSize),
      sameProductLtvCents: divideCents(row.sameProductCumulativeRevenueCents, row.cohortSize),
      otherProductLtvCents: divideCents(row.otherProductCumulativeRevenueCents, row.cohortSize),
    }));
}

function aggregateSegmentsForPayload(segmentRows) {
  const groups = new Map();
  segmentRows.forEach((row) => {
    const key = `${row.segmentType}\u0000${row.segmentValue}`;
    const aggregate = groups.get(key) || {
      segmentType: row.segmentType,
      segmentValue: row.segmentValue,
      cohortSize: 0,
      anyRepeatWithin90dCount: 0,
      sameProductRepeatWithin90dCount: 0,
      boughtOtherProductWithin90dCount: 0,
      netRevenueWithin90dCents: 0,
      medianValues: [],
      isLowSampleSize: false,
    };
    aggregate.cohortSize += row.cohortSize;
    aggregate.anyRepeatWithin90dCount += row.anyRepeatWithin90dCount;
    aggregate.sameProductRepeatWithin90dCount += row.sameProductRepeatWithin90dCount;
    aggregate.boughtOtherProductWithin90dCount += row.boughtOtherProductWithin90dCount;
    aggregate.netRevenueWithin90dCents += row.netRevenueWithin90dCents;
    if (row.medianDaysToNextPurchase != null) aggregate.medianValues.push(row.medianDaysToNextPurchase);
    aggregate.isLowSampleSize = aggregate.isLowSampleSize || row.isLowSampleSize;
    groups.set(key, aggregate);
  });
  return Array.from(groups.values())
    .sort((left, right) => right.cohortSize - left.cohortSize || left.segmentType.localeCompare(right.segmentType))
    .map((row) => ({
      segmentType: row.segmentType,
      segmentValue: row.segmentValue,
      cohortSize: row.cohortSize,
      repeatPurchaseRate90d: ratio(row.anyRepeatWithin90dCount, row.cohortSize),
      sameProductRepurchaseRate90d: ratio(row.sameProductRepeatWithin90dCount, row.cohortSize),
      crossSellRetentionRate90d: ratio(row.boughtOtherProductWithin90dCount, row.cohortSize),
      ltv90Cents: divideCents(row.netRevenueWithin90dCents, row.cohortSize),
      medianDaysToSecondPurchase: median(row.medianValues),
      isLowSampleSize: row.isLowSampleSize || row.cohortSize < PRODUCT_RETENTION_LOW_SAMPLE_SIZE,
    }));
}

function serializeSummaryPayload(summary) {
  return {
    repeatPurchaseRate90d: numberOrNull(summary.repeatPurchaseRate90d),
    repeatPurchaseRate180d: numberOrNull(summary.repeatPurchaseRate180d),
    sameProductRepurchaseRate90d: numberOrNull(summary.sameProductRepurchaseRate90d),
    sameProductRepurchaseRate180d: numberOrNull(summary.sameProductRepurchaseRate180d),
    crossSellRetentionRate90d: numberOrNull(summary.crossSellRetentionRate90d),
    returningRevenueShare: numberOrNull(summary.returningRevenueShare),
    avgDaysToSecondPurchase: numberOrNull(summary.avgDaysToSecondPurchase),
    medianDaysToSecondPurchase: numberOrNull(summary.medianDaysToSecondPurchase),
    productLtv90Cents: Number(summary.productLtv90Cents || 0),
    productLtv180Cents: Number(summary.productLtv180Cents || 0),
    retentionHealthScore: summary.retentionHealthScore == null ? null : Number(summary.retentionHealthScore),
    repeatPurchaseRate90dPrevious: numberOrNull(summary.repeatPurchaseRate90dPrevious),
    repeatPurchaseRate90dDelta: numberOrNull(summary.repeatPurchaseRate90dDelta),
    sameProductRepurchaseRate90dPrevious: numberOrNull(summary.sameProductRepurchaseRate90dPrevious),
    sameProductRepurchaseRate90dDelta: numberOrNull(summary.sameProductRepurchaseRate90dDelta),
    ltv90PreviousCents: summary.ltv90PreviousCents == null ? null : Number(summary.ltv90PreviousCents),
    ltv90DeltaCents: summary.ltv90DeltaCents == null ? null : Number(summary.ltv90DeltaCents),
    returningRevenueSharePrevious: numberOrNull(summary.returningRevenueSharePrevious),
    returningRevenueShareDelta: numberOrNull(summary.returningRevenueShareDelta),
    totalCustomersAnalyzed: Number(summary.totalCustomersAnalyzed || 0),
    totalOrdersAnalyzed: Number(summary.totalOrdersAnalyzed || 0),
    totalProductOrdersAnalyzed: Number(summary.totalProductOrdersAnalyzed || 0),
    earliestOrderDate: toIso(summary.earliestOrderDate),
    latestOrderDate: toIso(summary.latestOrderDate),
    hasEnoughData: Boolean(summary.hasEnoughData),
    lowSampleWarning: Boolean(summary.lowSampleWarning),
  };
}

function serializeDailyCohortPayload(row) {
  return {
    ...row,
    firstOrderNetRevenueCents: Number(row.firstOrderNetRevenueCents || 0),
    totalNetRevenueWithin30dCents: Number(row.totalNetRevenueWithin30dCents || 0),
    totalNetRevenueWithin60dCents: Number(row.totalNetRevenueWithin60dCents || 0),
    totalNetRevenueWithin90dCents: Number(row.totalNetRevenueWithin90dCents || 0),
    totalNetRevenueWithin180dCents: Number(row.totalNetRevenueWithin180dCents || 0),
    sameProductRevenueWithin90dCents: Number(row.sameProductRevenueWithin90dCents || 0),
    otherProductRevenueWithin90dCents: Number(row.otherProductRevenueWithin90dCents || 0),
    ltv30Cents: Number(row.ltv30Cents || 0),
    ltv60Cents: Number(row.ltv60Cents || 0),
    ltv90Cents: Number(row.ltv90Cents || 0),
    ltv180Cents: Number(row.ltv180Cents || 0),
    avgDaysToNextPurchase: numberOrNull(row.avgDaysToNextPurchase),
    medianDaysToNextPurchase: numberOrNull(row.medianDaysToNextPurchase),
    avgDaysToSameProductRepurchase: numberOrNull(row.avgDaysToSameProductRepurchase),
    medianDaysToSameProductRepurchase: numberOrNull(row.medianDaysToSameProductRepurchase),
  };
}

function serializeCohortCellPayload(row) {
  return {
    ...row,
    anyRepeatRate: numberOrNull(row.anyRepeatRate),
    sameProductRepeatRate: numberOrNull(row.sameProductRepeatRate),
    boughtOtherProductRate: numberOrNull(row.boughtOtherProductRate),
    cumulativeNetRevenueCents: Number(row.cumulativeNetRevenueCents || 0),
    cumulativeLtvCents: Number(row.cumulativeLtvCents || 0),
    sameProductCumulativeRevenueCents: Number(row.sameProductCumulativeRevenueCents || 0),
    otherProductCumulativeRevenueCents: Number(row.otherProductCumulativeRevenueCents || 0),
    sameProductCumulativeLtvCents: Number(row.sameProductCumulativeLtvCents || 0),
    otherProductCumulativeLtvCents: Number(row.otherProductCumulativeLtvCents || 0),
  };
}

function serializeDailyActivityPayload(row) {
  return {
    ...row,
    productGrossRevenueCents: Number(row.productGrossRevenueCents || 0),
    productNetRevenueCents: Number(row.productNetRevenueCents || 0),
    sameProductRepeatRevenueCents: Number(row.sameProductRepeatRevenueCents || 0),
    postProductCustomerRevenueCents: Number(row.postProductCustomerRevenueCents || 0),
    otherProductRevenueFromProductCustomersCents: Number(row.otherProductRevenueFromProductCustomersCents || 0),
    returningProductBuyerShare: numberOrNull(row.returningProductBuyerShare),
    sameProductRepurchaseShare: numberOrNull(row.sameProductRepurchaseShare),
    crossSellShare: numberOrNull(row.crossSellShare),
    returningRevenueShare: numberOrNull(row.returningRevenueShare),
    refundedRevenueCents: Number(row.refundedRevenueCents || 0),
    returnRate: numberOrNull(row.returnRate),
    refundRate: numberOrNull(row.refundRate),
  };
}

function serializeSegmentDailyPayload(row) {
  return {
    ...row,
    netRevenueWithin90dCents: Number(row.netRevenueWithin90dCents || 0),
    ltv90Cents: Number(row.ltv90Cents || 0),
    avgDaysToNextPurchase: numberOrNull(row.avgDaysToNextPurchase),
    medianDaysToNextPurchase: numberOrNull(row.medianDaysToNextPurchase),
  };
}

function serializeRunPayload(run) {
  return {
    id: run.id,
    status: run.status,
    schemaVersion: Number(run.schemaVersion || PRODUCT_RETENTION_SCHEMA_VERSION),
    asOfDate: toIso(run.asOfDate),
    timezone: run.timezone || "UTC",
    windowStartDate: toIso(run.windowStartDate),
    windowEndDate: toIso(run.windowEndDate),
    lookbackDays: Number(run.lookbackDays || 0),
    maxCohortAgeDays: Number(run.maxCohortAgeDays || 0),
    currency: run.currency || null,
    errorMessage: run.errorMessage || null,
  };
}

function toDailyCohortDbRow(row) {
  return {
    ...row,
    firstOrderNetRevenueCents: BigInt(row.firstOrderNetRevenueCents || 0),
    totalNetRevenueWithin30dCents: BigInt(row.totalNetRevenueWithin30dCents || 0),
    totalNetRevenueWithin60dCents: BigInt(row.totalNetRevenueWithin60dCents || 0),
    totalNetRevenueWithin90dCents: BigInt(row.totalNetRevenueWithin90dCents || 0),
    totalNetRevenueWithin180dCents: BigInt(row.totalNetRevenueWithin180dCents || 0),
    sameProductRevenueWithin90dCents: BigInt(row.sameProductRevenueWithin90dCents || 0),
    otherProductRevenueWithin90dCents: BigInt(row.otherProductRevenueWithin90dCents || 0),
    ltv30Cents: BigInt(row.ltv30Cents || 0),
    ltv60Cents: BigInt(row.ltv60Cents || 0),
    ltv90Cents: BigInt(row.ltv90Cents || 0),
    ltv180Cents: BigInt(row.ltv180Cents || 0),
    avgDaysToNextPurchase: decimalOrNull(row.avgDaysToNextPurchase),
    medianDaysToNextPurchase: decimalOrNull(row.medianDaysToNextPurchase),
    avgDaysToSameProductRepurchase: decimalOrNull(row.avgDaysToSameProductRepurchase),
    medianDaysToSameProductRepurchase: decimalOrNull(row.medianDaysToSameProductRepurchase),
  };
}

function toCohortCellDbRow(row) {
  return {
    ...row,
    anyRepeatRate: decimalOrNull(row.anyRepeatRate),
    sameProductRepeatRate: decimalOrNull(row.sameProductRepeatRate),
    boughtOtherProductRate: decimalOrNull(row.boughtOtherProductRate),
    cumulativeNetRevenueCents: BigInt(row.cumulativeNetRevenueCents || 0),
    cumulativeLtvCents: BigInt(row.cumulativeLtvCents || 0),
    sameProductCumulativeRevenueCents: BigInt(row.sameProductCumulativeRevenueCents || 0),
    otherProductCumulativeRevenueCents: BigInt(row.otherProductCumulativeRevenueCents || 0),
    sameProductCumulativeLtvCents: BigInt(row.sameProductCumulativeLtvCents || 0),
    otherProductCumulativeLtvCents: BigInt(row.otherProductCumulativeLtvCents || 0),
  };
}

function toDailyActivityDbRow(row) {
  return {
    ...row,
    productGrossRevenueCents: BigInt(row.productGrossRevenueCents || 0),
    productNetRevenueCents: BigInt(row.productNetRevenueCents || 0),
    sameProductRepeatRevenueCents: BigInt(row.sameProductRepeatRevenueCents || 0),
    postProductCustomerRevenueCents: BigInt(row.postProductCustomerRevenueCents || 0),
    otherProductRevenueFromProductCustomersCents: BigInt(row.otherProductRevenueFromProductCustomersCents || 0),
    returningProductBuyerShare: decimalOrNull(row.returningProductBuyerShare),
    sameProductRepurchaseShare: decimalOrNull(row.sameProductRepurchaseShare),
    crossSellShare: decimalOrNull(row.crossSellShare),
    returningRevenueShare: decimalOrNull(row.returningRevenueShare),
    refundedRevenueCents: BigInt(row.refundedRevenueCents || 0),
    returnRate: decimalOrNull(row.returnRate),
    refundRate: decimalOrNull(row.refundRate),
  };
}

function toSegmentDailyDbRow(row) {
  return {
    ...row,
    netRevenueWithin90dCents: BigInt(row.netRevenueWithin90dCents || 0),
    ltv90Cents: BigInt(row.ltv90Cents || 0),
    avgDaysToNextPurchase: decimalOrNull(row.avgDaysToNextPurchase),
    medianDaysToNextPurchase: decimalOrNull(row.medianDaysToNextPurchase),
  };
}

function toSummaryDbRow(row) {
  return {
    ...row,
    repeatPurchaseRate90d: decimalOrNull(row.repeatPurchaseRate90d),
    repeatPurchaseRate180d: decimalOrNull(row.repeatPurchaseRate180d),
    sameProductRepurchaseRate90d: decimalOrNull(row.sameProductRepurchaseRate90d),
    sameProductRepurchaseRate180d: decimalOrNull(row.sameProductRepurchaseRate180d),
    crossSellRetentionRate90d: decimalOrNull(row.crossSellRetentionRate90d),
    returningRevenueShare: decimalOrNull(row.returningRevenueShare),
    avgDaysToSecondPurchase: decimalOrNull(row.avgDaysToSecondPurchase),
    medianDaysToSecondPurchase: decimalOrNull(row.medianDaysToSecondPurchase),
    productLtv90Cents: BigInt(row.productLtv90Cents || 0),
    productLtv180Cents: BigInt(row.productLtv180Cents || 0),
    repeatPurchaseRate90dPrevious: decimalOrNull(row.repeatPurchaseRate90dPrevious),
    repeatPurchaseRate90dDelta: decimalOrNull(row.repeatPurchaseRate90dDelta),
    sameProductRepurchaseRate90dPrevious: decimalOrNull(row.sameProductRepurchaseRate90dPrevious),
    sameProductRepurchaseRate90dDelta: decimalOrNull(row.sameProductRepurchaseRate90dDelta),
    ltv90PreviousCents: row.ltv90PreviousCents == null ? null : BigInt(row.ltv90PreviousCents),
    ltv90DeltaCents: row.ltv90DeltaCents == null ? null : BigInt(row.ltv90DeltaCents),
    returningRevenueSharePrevious: decimalOrNull(row.returningRevenueSharePrevious),
    returningRevenueShareDelta: decimalOrNull(row.returningRevenueShareDelta),
  };
}

function normalizeStoredSummary(row) {
  return row ? serializeSummaryPayload(row) : null;
}

function normalizeStoredDailyCohort(row) {
  return serializeDailyCohortPayload(row);
}

function normalizeStoredCohortCell(row) {
  return serializeCohortCellPayload(row);
}

function normalizeStoredDailyActivity(row) {
  return serializeDailyActivityPayload(row);
}

function normalizeStoredSegmentDaily(row) {
  return serializeSegmentDailyPayload(row);
}

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    const error = new Error(json.errors.map((item) => item.message).join("; "));
    error.graphqlErrors = json.errors;
    throw error;
  }
  return json.data || {};
}

async function safeRecordJobLog(payload) {
  if (!payload.jobId) return;
  try {
    await recordJobLog(payload);
  } catch {
    // Retention logging is best-effort and must not affect diagnosis persistence.
  }
}

function orderHasProduct(order, productGid) {
  return getOrderProductLines(order, productGid).length > 0;
}

function orderHasOtherProduct(order, productGid) {
  return getOrderOtherProductLines(order, productGid).length > 0;
}

function getOrderProductLines(order, productGid) {
  const normalized = String(productGid || "");
  return (order.lineItems || []).filter((line) => String(line.productGid || "") === normalized);
}

function getOrderOtherProductLines(order, productGid) {
  const normalized = String(productGid || "");
  return (order.lineItems || []).filter((line) => line.productGid && String(line.productGid) !== normalized);
}

function sumOrdersWithinDays(orders, firstTime, days, getValue) {
  const maxTime = firstTime + days * DAY_MS;
  return orders.reduce((total, order) => {
    if (order.orderDate.getTime() > maxTime) return total;
    return total + Number(getValue(order) || 0);
  }, 0);
}

function compareRetentionOrders(left, right) {
  const leftTime = left.orderDate?.getTime?.() || 0;
  const rightTime = right.orderDate?.getTime?.() || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function getConnectionNodes(connection) {
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection?.nodes)) return connection.nodes.filter(Boolean);
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node).filter(Boolean);
  return [];
}

function groupBy(items, getKey) {
  const groups = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

function cumulativeArray(values) {
  let running = 0;
  return values.map((value) => {
    running += Number(value || 0);
    return running;
  });
}

function ratio(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  return roundDecimal(top / bottom, 6);
}

function average(values) {
  const numbers = values.filter(isFiniteNumber);
  if (!numbers.length) return null;
  return roundDecimal(numbers.reduce((total, value) => total + value, 0) / numbers.length, 4);
}

function median(values) {
  const numbers = values.filter(isFiniteNumber).sort((left, right) => left - right);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2) return roundDecimal(numbers[middle], 4);
  return roundDecimal((numbers[middle - 1] + numbers[middle]) / 2, 4);
}

function sum(items, key) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => total + Number(item?.[key] || 0), 0);
}

function divideCents(totalCents, count) {
  const denominator = Number(count || 0);
  if (denominator <= 0) return 0;
  return Math.round(Number(totalCents || 0) / denominator);
}

function ageDayBetweenOrders(firstOrder, laterOrder) {
  return Math.max(0, dateKeyDiff(firstOrder.localDateKey, laterOrder.localDateKey));
}

function dateKeyDiff(startDateKey, endDateKey) {
  const start = dateKeyToUtcDate(startDateKey);
  const end = dateKeyToUtcDate(endDateKey);
  if (!start || !end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS);
}

function dateKeyToUtcDate(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function addDaysUtc(date, days) {
  return new Date(parseDate(date).getTime() + Number(days || 0) * DAY_MS);
}

function getLocalDateKey(value, timezone = "UTC") {
  const date = parseDate(value);
  if (!date) return "";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimeZone(timezone) ? timezone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateRangeKeys(startDate, endDate, timezone = "UTC") {
  const startKey = getLocalDateKey(startDate, timezone);
  const endKey = getLocalDateKey(endDate, timezone);
  if (!startKey || !endKey) return [];
  const keys = [];
  let current = startKey;
  while (current <= endKey) {
    keys.push(current);
    current = addDaysToDateKey(current, 1);
  }
  return keys;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toDateKey(date);
}

function toDateKey(value) {
  const date = parseDate(value);
  if (!date) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isLocalDateKeyWithinRange(dateKey, startDate, endDate, timezone) {
  const startKey = getLocalDateKey(startDate, timezone);
  const endKey = getLocalDateKey(endDate, timezone);
  return Boolean(dateKey && dateKey >= startKey && dateKey <= endKey);
}

function isDateWithinRange(date, startDate, endDate) {
  const time = parseDate(date)?.getTime();
  if (!Number.isFinite(time)) return false;
  return time >= parseDate(startDate).getTime() && time <= parseDate(endDate).getTime();
}

function isValidTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC" });
    return true;
  } catch {
    return false;
  }
}

function moneyBagToCents(value) {
  if (!value) return 0;
  if (value.shopMoney) return moneyToCents(value.shopMoney.amount);
  if (value.presentmentMoney) return moneyToCents(value.presentmentMoney.amount);
  if (value.amount != null) return moneyToCents(value.amount);
  return 0;
}

function moneyToCents(value) {
  if (value == null || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function normalizeCents(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "bigint") return Number(value);
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function firstFiniteCents(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = normalizeCents(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function decimalOrNull(value) {
  if (!isFiniteNumber(value)) return null;
  return String(roundDecimal(value, 6));
}

function numberOrNull(value) {
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number);
}

function roundDecimal(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function subtractNullable(left, right) {
  if (left == null || right == null) return null;
  return roundDecimal(Number(left) - Number(right), 6);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDiscountCodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((item) => typeof item === "string" ? item : [item?.code, item?.discountApplication?.code]).filter(Boolean).map(String)));
  }
  const nodes = getConnectionNodes(value);
  if (nodes.length) {
    return Array.from(new Set(nodes.flatMap((item) => [
      item.code,
      item.discountApplication?.code,
    ]).filter(Boolean).map(String)));
  }
  return [];
}

function sumDiscountAllocations(discountAllocations) {
  return (Array.isArray(discountAllocations) ? discountAllocations : []).reduce((total, allocation) => total + moneyBagToCents(allocation.allocatedAmountSet), 0);
}

function inferCurrency(orders) {
  for (const order of orders) {
    if (order.currency) return order.currency;
    for (const line of order.lineItems || []) {
      if (line.currency) return line.currency;
    }
  }
  return "";
}

function inferCurrencyFromOrder(order, lineItems) {
  return order?.currency
    || inferCurrencyFromMoney(order?.totalDiscountsSet)
    || inferCurrencyFromMoney(order?.totalRefundedSet)
    || lineItems.find((line) => line.currency)?.currency
    || "";
}

function inferCurrencyFromMoney(value) {
  return value?.shopMoney?.currencyCode || value?.presentmentMoney?.currencyCode || value?.currencyCode || "";
}

function getFirstProductUnitPriceCents(lines) {
  const quantity = sum(lines, "quantity");
  if (!quantity) return 0;
  return divideCents(sum(lines, "netRevenueCents"), quantity);
}

function quantityBucket(quantity) {
  const number = Number(quantity || 0);
  if (number <= 1) return "1";
  if (number === 2) return "2";
  return "3_plus";
}

function priceBucket(priceCents) {
  const cents = Number(priceCents || 0);
  if (cents <= 0) return "unknown";
  if (cents < 2500) return "under_25";
  if (cents < 5000) return "25_to_50";
  if (cents < 10000) return "50_to_100";
  return "100_plus";
}

function getAcquisitionSource(order) {
  const utm = getUrlParam(order.landingPageUrl, "utm_source") || getUrlParam(order.referrerUrl, "utm_source");
  return utm || order.sourceName || getHostname(order.referrerUrl) || "unknown";
}

function getUrlParam(rawUrl, key) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    return url.searchParams.get(key) || "";
  } catch {
    return "";
  }
}

function getHostname(rawUrl) {
  if (!rawUrl) return "";
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dedupeSegments(segments) {
  const seen = new Set();
  return segments.filter((segment) => {
    const key = `${segment.segmentType}\u0000${segment.segmentValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePositiveInteger(value, fallback) {
  const number = Math.round(Number(value || 0));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toShopifyDateQueryValue(value) {
  return parseDate(value)?.toISOString() || new Date().toISOString();
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export const __productPulseRetentionTestHooks = {
  calculateProductRetentionMetricRows,
  buildProductRetentionPayload,
  normalizeRetentionOrders,
  normalizeRetentionOrder,
  isValidRetentionOrder,
  buildProductRetentionOrdersQuery,
  calculateRetentionHealthScore,
  getLocalDateKey,
};
