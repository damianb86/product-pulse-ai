import prisma from "../db.server";
import { getNormalizedCsvReviewRatingsForShop } from "./product-pulse-csv.server";
import { recordJobLog } from "./product-pulse-job-logs.server";
import { recordProductScoreHistoryBatch } from "./product-pulse-history.server";
import {
  getAnalysisLookbackDays,
  getProductPulseSettings,
  getQuickScanMinimumRiskScore,
} from "./product-pulse-settings.server";
import {
  buildDatedSignalTrend,
  buildIssueTrendMap,
  buildRiskTrendFromSignalTrend,
} from "./product-pulse-trends.server";
import { recordWatchlistScanActivities } from "./product-pulse-watchlist.server";
import { calculateProductScoreModel } from "./product-pulse-scoring";

export const QUICK_SCAN_DEFAULT_WINDOW_DAYS = 60;
export const QUICK_SCAN_MINIMUM_DURATION_MS = 15_000;
export const QUICK_SCAN_BULK_GROUP_OBJECTS = false;

const BULK_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;
const BULK_OPERATION_POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 10 : 2_000;
const PAGINATED_PRODUCTS_PAGE_SIZE = 20;
const PAGINATED_PRODUCT_COLLECTIONS_PAGE_SIZE = 5;
const PAGINATED_PRODUCT_VARIANTS_PAGE_SIZE = 20;
const PAGINATED_ORDERS_PAGE_SIZE = 8;
const PAGINATED_ORDER_LINE_ITEMS_PAGE_SIZE = 25;
const PAGINATED_REFUND_LINE_ITEMS_PAGE_SIZE = 20;
const PAGINATED_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE = 25;
const PAGINATED_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE = 5;
const PAGINATED_RETURNS_PAGE_SIZE = 3;
const PAGINATED_RETURN_LINE_ITEMS_PAGE_SIZE = 15;

export function getQuickScanWindowDays(settings = undefined) {
  return getAnalysisLookbackDays(settings);
}

export async function runShopifyQuickScan({ shop, admin, jobId, scopes }) {
  if (!admin?.graphql) {
    throw new Error("A Shopify Admin API context is required to run QuickScan.");
  }

  const startedAt = Date.now();
  const settings = await getProductPulseSettings(shop);
  const windowDays = getQuickScanWindowDays(settings, scopes);
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.started",
    message: "QuickScan started using Shopify-native signals and connected CSV review ratings.",
    data: { windowDays },
  });

  await updateQuickScanJob(jobId, {
    status: "Running",
    progress: 12,
    source: "Reading Shopify catalog",
  });

  const extraction = await extractQuickScanData({ admin, windowDays, shop, jobId });
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.extracted",
    message: "Shopify extraction completed.",
    data: {
      extractionMode: extraction.meta.extractionMode,
      windowDays,
      products: extraction.products.length,
      events: extraction.events.length,
      salesEvents: extraction.events.filter((event) => event.type === "sale").length,
      refundEvents: extraction.events.filter((event) => event.type === "refund").length,
      returnEvents: extraction.events.filter((event) => event.type === "return").length,
      bulkError: extraction.meta.bulkError,
      orderAccessDenied: extraction.meta.orderAccessDenied,
    },
  });

  const csvReviewRatings = await loadCsvReviewRatingsForQuickScan({ shop, jobId, windowDays });

  await updateQuickScanJob(jobId, {
    progress: 72,
    source: "Calculating deterministic product risk",
  });

  const candidates = buildQuickScanCandidates({
    products: extraction.products,
    events: extraction.events,
    csvReviewRatings,
    windowDays,
    extractionMode: extraction.meta.extractionMode,
    settings,
  });
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.scored",
    message: "Deterministic risk scoring completed.",
    data: {
      candidateCount: candidates.length,
      topCandidates: candidates.slice(0, 5).map((candidate) => ({
        productGid: candidate.productGid,
        handle: candidate.handle,
        title: candidate.productTitle,
        riskScore: candidate.riskScore,
        primaryIssue: candidate.primaryIssue,
        returnRate: candidate.metrics.returnRate,
        refundRate: candidate.metrics.refundRate,
        refundAmount: candidate.metrics.refundAmount,
        reviewCount: candidate.metrics.reviewCount,
        avgRating: candidate.metrics.avgRating,
        topReturnReasons: candidate.metrics.topReturnReasons,
      })),
    },
  });

  const persistence = await persistQuickScanCandidates(shop, candidates);
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.persisted",
    message: "QuickScan persisted only products above the risk threshold and skipped products with full diagnoses.",
    data: {
      persistedCandidates: persistence.persistedCandidates,
      ignoredFullDiagnosisProducts: persistence.ignoredFullDiagnosisProducts,
      retainedFullDiagnosisProducts: persistence.retainedFullDiagnosisProducts,
      persistenceRule: `risk_score >= ${getQuickScanMinimumRiskScore(settings)}`,
    },
  });
  await waitForMinimumDuration(startedAt, QUICK_SCAN_MINIMUM_DURATION_MS);

  await updateQuickScanJob(jobId, {
    status: "Completed",
    progress: 100,
    source: extraction.meta.orderAccessDenied
      ? "QuickScan completed with catalog only - Shopify order access unavailable"
      : getQuickScanCompletionSource(persistence),
    finishedAt: new Date(),
  });
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.completed",
    message: "QuickScan completed.",
    data: {
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      csvReviewRatings: csvReviewRatings.length,
      persistedCandidates: persistence.persistedCandidates,
      ignoredFullDiagnosisProducts: persistence.ignoredFullDiagnosisProducts,
      orderAccessDenied: extraction.meta.orderAccessDenied,
    },
  });

  return { candidates, extraction };
}

async function loadCsvReviewRatingsForQuickScan({ shop, jobId, windowDays = QUICK_SCAN_DEFAULT_WINDOW_DAYS }) {
  try {
    const allRatings = await getNormalizedCsvReviewRatingsForShop(shop);
    const ratings = filterRowsByLookbackWindow(allRatings, "reviewDate", windowDays);
    if (ratings.length) {
      await recordJobLog({
        shop,
        jobId,
        event: "quick_scan.csv_reviews_loaded",
        message: "Loaded normalized CSV review ratings for deterministic QuickScan scoring.",
        data: {
          ratingRows: ratings.length,
          ignoredOutsideWindow: Math.max(0, allRatings.length - ratings.length),
          windowDays,
          productsWithRatings: countCsvRatingProductKeys(ratings),
          usage: "rating-only; review text is not read during QuickScan",
        },
      });
    }
    return ratings;
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "quick_scan.csv_reviews_skipped",
      message: "CSV review ratings could not be loaded; QuickScan will continue without CSV rating signals.",
      data: { error: getErrorMessage(error) },
    });
    return [];
  }
}

export function buildQuickScanCandidates({
  products = [],
  events = [],
  csvReviewRatings = [],
  windowDays = QUICK_SCAN_DEFAULT_WINDOW_DAYS,
  extractionMode = "bulk",
  settings = undefined,
}) {
  const productIndex = new Map();
  const variantIndex = new Map();

  products.forEach((product) => {
    if (!product?.id) return;
    const normalized = normalizeProduct(product);
    productIndex.set(normalized.id, normalized);
    normalized.variants.forEach((variant) => {
      if (variant.id) variantIndex.set(variant.id, normalized.id);
    });
  });

  const aggregates = new Map();

  events.forEach((event) => {
    const productId = event.productId || variantIndex.get(event.variantId);
    if (!productId) return;
    const product = productIndex.get(productId) || normalizeProduct({
      id: productId,
      handle: event.handle,
      title: event.title,
      variants: [],
    });
    productIndex.set(productId, product);

    const aggregate = getProductAggregate(aggregates, product);
    applyEventToAggregate(aggregate, event);
  });

  productIndex.forEach((product, productId) => {
    if (!aggregates.has(productId)) {
      getProductAggregate(aggregates, product);
    }
  });

  applyCsvReviewRatingsToAggregates({ aggregates, productIndex, csvReviewRatings });

  const aggregateList = Array.from(aggregates.values());
  const storeTotals = getStoreTotals(aggregateList);

  return aggregateList
    .map((aggregate) => scoreProductAggregate(aggregate, storeTotals, { windowDays, extractionMode }))
    .filter((candidate) => isPersistableCandidate(candidate, settings))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 50);
}

async function extractQuickScanData({ admin, windowDays, shop, jobId }) {
  try {
    const catalogLines = await runBulkQuery(admin, PRODUCT_CATALOG_BULK_QUERY, "catalog", { shop, jobId });
    let orderLines = [];
    let orderAccessDenied = false;

    try {
      orderLines = await runBulkQuery(admin, buildOrdersBulkQuery(windowDays), "orders", { shop, jobId });
    } catch (orderError) {
      if (!isShopifyOrderAccessDeniedError(orderError, "orders")) throw orderError;
      orderAccessDenied = true;
      await recordOrderAccessUnavailableLog({ shop, jobId, mode: "bulk" });
    }

    const bulkData = normalizeBulkQuickScanData(catalogLines, orderLines);
    const refundEvents = orderAccessDenied ? [] : await extractSupplementalRefundEvents({ admin, windowDays, shop, jobId });

    return {
      ...bulkData,
      events: [...bulkData.events, ...refundEvents],
      meta: {
        extractionMode: orderAccessDenied ? "catalog-only" : "bulk",
        windowDays,
        orderAccessDenied,
      },
    };
  } catch (bulkError) {
    if (isShopifyOrderAccessDeniedError(bulkError, "orders")) {
      await recordOrderAccessUnavailableLog({ shop, jobId, mode: "bulk-recovery" });
      const products = await extractProductsWithPaginatedQueries({ admin });
      return {
        products: products.map(normalizeProduct),
        events: [],
        meta: {
          extractionMode: "catalog-only",
          windowDays,
          orderAccessDenied: true,
        },
      };
    }

    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "quick_scan.bulk_fallback",
      message: "Bulk operation extraction failed; falling back to paginated GraphQL queries.",
      data: { error: bulkError instanceof Error ? bulkError.message : String(bulkError) },
    });
    const fallback = await extractQuickScanDataWithPaginatedQueries({ admin, windowDays, shop, jobId });
    return {
      ...fallback,
      meta: {
        extractionMode: "paginated-fallback",
        windowDays,
        bulkError: getErrorMessage(bulkError),
      },
    };
  }
}

async function recordOrderAccessUnavailableLog({ shop, jobId, mode }) {
  await recordJobLog({
    shop,
    jobId,
    level: "warn",
    event: "quick_scan.orders_unavailable",
    message: "Shopify denied access to orders. QuickScan will complete with product catalog data only until Order object access is approved.",
    data: {
      code: "SHOPIFY_ORDER_ACCESS_DENIED",
      mode,
      recovery: "catalog-only",
    },
  });
}

async function runBulkQuery(admin, bulkQuery, label, context) {
  await recordJobLog({
    ...context,
    event: "quick_scan.bulk_started",
    message: `Started Shopify bulk operation for ${label}.`,
  });
  const operation = await createBulkOperation(admin, bulkQuery);
  const completed = await pollBulkOperation(admin, operation.id, label);
  const url = completed.url || completed.partialDataUrl;
  if (!url) {
    await recordJobLog({
      ...context,
      level: "warn",
      event: "quick_scan.bulk_no_url",
      message: `Shopify bulk operation for ${label} completed without a downloadable URL.`,
      data: {
        operationId: operation.id,
        status: completed.status,
        objectCount: completed.objectCount,
        rootObjectCount: completed.rootObjectCount,
      },
    });
    return [];
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download ${label} bulk results (${response.status}).`);
  }

  const lines = parseJsonl(await response.text());
  await recordJobLog({
    ...context,
    event: "quick_scan.bulk_completed",
    message: `Completed Shopify bulk operation for ${label}.`,
    data: {
      operationId: operation.id,
      status: completed.status,
      objectCount: completed.objectCount,
      rootObjectCount: completed.rootObjectCount,
      lineCount: lines.length,
    },
  });
  return lines;
}

async function createBulkOperation(admin, bulkQuery) {
  try {
    return await createBulkOperationModern(admin, bulkQuery);
  } catch (error) {
    if (!/groupObjects|Unknown argument|not defined|not used/i.test(getErrorMessage(error))) {
      throw error;
    }
    return createBulkOperationLegacy(admin, bulkQuery);
  }
}

async function createBulkOperationModern(admin, bulkQuery) {
  const data = await shopifyGraphql(
    admin,
    `#graphql
    mutation ProductPulseBulkQuickScan($query: String!, $groupObjects: Boolean!) {
      bulkOperationRunQuery(query: $query, groupObjects: $groupObjects) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { query: bulkQuery, groupObjects: QUICK_SCAN_BULK_GROUP_OBJECTS },
  );

  return getBulkOperationFromMutation(data);
}

async function createBulkOperationLegacy(admin, bulkQuery) {
  const data = await shopifyGraphql(
    admin,
    `#graphql
    mutation ProductPulseBulkQuickScan($query: String!) {
      bulkOperationRunQuery(query: $query) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { query: bulkQuery },
  );

  return getBulkOperationFromMutation(data);
}

function getBulkOperationFromMutation(data) {
  const payload = data?.bulkOperationRunQuery;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  if (!payload?.bulkOperation?.id) {
    throw new Error("Shopify did not create a bulk operation.");
  }
  return payload.bulkOperation;
}

async function pollBulkOperation(admin, operationId, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < BULK_OPERATION_TIMEOUT_MS) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseCurrentBulkOperation {
        currentBulkOperation {
          id
          status
          errorCode
          objectCount
          rootObjectCount
          url
          partialDataUrl
          createdAt
          completedAt
        }
      }`,
    );
    const operation = data?.currentBulkOperation;

    if (operation?.id === operationId && operation.status === "COMPLETED") return operation;
    if (operation?.id === operationId && ["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`${label} bulk operation ${operation.status.toLowerCase()}${operation.errorCode ? `: ${operation.errorCode}` : ""}.`);
    }

    await sleep(BULK_OPERATION_POLL_INTERVAL_MS);
  }

  throw new Error(`${label} bulk operation timed out.`);
}

async function extractSupplementalRefundEvents({ admin, windowDays, shop, jobId }) {
  try {
    const events = await extractRefundEventsWithPaginatedQueries({ admin, windowDays });
    await recordJobLog({
      shop,
      jobId,
      event: "quick_scan.refunds_extracted",
      message: "Supplemental refund line items extracted with low-cost paginated queries.",
      data: { refundEvents: events.length },
    });
    return events;
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "quick_scan.refunds_skipped",
      message: "Supplemental refund extraction failed; QuickScan will continue with sales and returns.",
      data: { error: getErrorMessage(error) },
    });
    return [];
  }
}

async function extractQuickScanDataWithPaginatedQueries({ admin, windowDays, shop, jobId }) {
  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.paginated_started",
    message: "Started low-cost paginated Shopify extraction.",
    data: {
      productsPageSize: PAGINATED_PRODUCTS_PAGE_SIZE,
      ordersPageSize: PAGINATED_ORDERS_PAGE_SIZE,
    },
  });

  const products = await extractProductsWithPaginatedQueries({ admin });
  const salesEvents = await extractOptionalPaginatedEvents({
    shop,
    jobId,
    label: "sales",
    extractor: () => extractOrderLineItemEventsWithPaginatedQueries({ admin, windowDays }),
  });
  const refundEvents = await extractOptionalPaginatedEvents({
    shop,
    jobId,
    label: "refunds",
    extractor: () => extractRefundEventsWithPaginatedQueries({ admin, windowDays }),
  });
  const returnEvents = await extractOptionalPaginatedEvents({
    shop,
    jobId,
    label: "returns",
    extractor: () => extractReturnEventsWithPaginatedQueries({ admin, windowDays }),
  });

  await recordJobLog({
    shop,
    jobId,
    event: "quick_scan.paginated_completed",
    message: "Low-cost paginated Shopify extraction completed.",
    data: {
      products: products.length,
      salesEvents: salesEvents.length,
      refundEvents: refundEvents.length,
      returnEvents: returnEvents.length,
    },
  });

  return {
    products: products.map(normalizeProduct),
    events: [...salesEvents, ...refundEvents, ...returnEvents].filter(Boolean),
  };
}

async function extractOptionalPaginatedEvents({ shop, jobId, label, extractor }) {
  try {
    return await extractor();
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: `quick_scan.${label}_skipped`,
      message: `Paginated ${label} extraction failed; QuickScan will continue without that signal group.`,
      data: { error: getErrorMessage(error) },
    });
    return [];
  }
}

async function extractProductsWithPaginatedQueries({ admin }) {
  const products = [];
  let productsCursor;
  let hasNextProductsPage = true;

  while (hasNextProductsPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseProductsPage(
        $after: String,
        $productsFirst: Int!,
        $collectionsFirst: Int!,
        $variantsFirst: Int!
      ) {
        products(first: $productsFirst, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            handle
            title
            vendor
            productType
            tags
            status
            options {
              name
              values
            }
            collections(first: $collectionsFirst) {
              nodes {
                id
                handle
                title
              }
            }
            variants(first: $variantsFirst) {
              nodes {
                id
                title
                sku
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
      {
        after: productsCursor || null,
        productsFirst: PAGINATED_PRODUCTS_PAGE_SIZE,
        collectionsFirst: PAGINATED_PRODUCT_COLLECTIONS_PAGE_SIZE,
        variantsFirst: PAGINATED_PRODUCT_VARIANTS_PAGE_SIZE,
      },
    );
    products.push(...(data?.products?.nodes || []));
    hasNextProductsPage = Boolean(data?.products?.pageInfo?.hasNextPage);
    productsCursor = data?.products?.pageInfo?.endCursor;
  }

  return products;
}

async function extractOrderLineItemEventsWithPaginatedQueries({ admin, windowDays }) {
  const events = [];
  let ordersCursor;
  let hasNextOrdersPage = true;
  const orderQuery = `created_at:>=${getSinceDate(windowDays)}`;

  while (hasNextOrdersPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseSalesPage($after: String, $query: String!, $ordersFirst: Int!, $lineItemsFirst: Int!) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            lineItems(first: $lineItemsFirst) {
              nodes {
                id
                quantity
                title
                sku
                product {
                  id
                  handle
                  title
                }
                variant {
                  id
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }`,
      {
        after: ordersCursor || null,
        query: orderQuery,
        ordersFirst: PAGINATED_ORDERS_PAGE_SIZE,
        lineItemsFirst: PAGINATED_ORDER_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      const orderContext = { id: order.id, createdAt: order.createdAt };
      getNodes(order.lineItems).forEach((lineItem) => {
        events.push(normalizeOrderLineItemEvent(lineItem, orderContext));
      });
    });
    hasNextOrdersPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
    ordersCursor = data?.orders?.pageInfo?.endCursor;
  }

  return events.filter(Boolean);
}

async function extractRefundEventsWithPaginatedQueries({ admin, windowDays }) {
  const events = [];
  const seenRefundLineItemIds = new Set();
  const seenOrderLevelRefundLineItemIds = new Set();

  for (const orderQuery of buildRefundOrderQueries(windowDays)) {
    let ordersCursor;
    let hasNextOrdersPage = true;

    while (hasNextOrdersPage) {
      const data = await shopifyGraphql(
        admin,
        buildPaginatedRefundsQuery(),
        {
          after: ordersCursor || null,
          query: orderQuery.query,
          ordersFirst: PAGINATED_ORDERS_PAGE_SIZE,
          refundLineItemsFirst: PAGINATED_REFUND_LINE_ITEMS_PAGE_SIZE,
          fallbackLineItemsFirst: PAGINATED_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE,
          orderAdjustmentsFirst: PAGINATED_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE,
        },
      );

      (data?.orders?.nodes || []).forEach((order) => {
        const refunds = order.refunds || [];
        refunds.forEach((refund) => {
          const adjustmentReasons = getRefundAdjustmentReasons(refund);
          const refundLineItems = getNodes(refund.refundLineItems);
          refundLineItems.forEach((refundLineItem) => {
            if (refundLineItem.id && seenRefundLineItemIds.has(refundLineItem.id)) return;
            if (refundLineItem.id) seenRefundLineItemIds.add(refundLineItem.id);
            const event = normalizeRefundLineItemEvent(refundLineItem, {
              id: refund.id,
              createdAt: refund.processedAt || refund.createdAt || order.createdAt,
              updatedAt: refund.updatedAt || refund.processedAt || refund.createdAt || order.createdAt,
              orderId: order.id,
              orderName: order.name,
              displayFinancialStatus: order.displayFinancialStatus,
              note: refund.note,
              adjustmentReasons,
              totalRefundedAmount: moneyAmount(refund.totalRefundedSet),
            });
            if (event?.productId || event?.variantId) events.push(event);
          });

          if (!refundLineItems.length) {
            events.push(...buildOrderLevelRefundFallbackEvents({
              order,
              refund,
              adjustmentReasons,
              seenOrderLevelRefundLineItemIds,
            }));
          }
        });

        if (!refunds.length) {
          events.push(...buildOrderLevelRefundFallbackEvents({
            order,
            refund: null,
            adjustmentReasons: [],
            seenOrderLevelRefundLineItemIds,
          }));
        }
      });
      hasNextOrdersPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
      ordersCursor = data?.orders?.pageInfo?.endCursor;
    }
  }

  return events.filter(Boolean);
}

function buildPaginatedRefundsQuery() {
  return `#graphql
      query ProductPulseRefundsPage(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $refundLineItemsFirst: Int!,
        $fallbackLineItemsFirst: Int!,
        $orderAdjustmentsFirst: Int!
      ) {
        orders(first: $ordersFirst, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            createdAt
            updatedAt
            displayFinancialStatus
            totalRefundedSet {
              shopMoney {
                amount
              }
            }
            lineItems(first: $fallbackLineItemsFirst) {
              nodes {
                id
                quantity
                title
                sku
                product {
                  id
                  legacyResourceId
                  handle
                  title
                }
                variant {
                  id
                  legacyResourceId
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                  product {
                    id
                    legacyResourceId
                    handle
                    title
                  }
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
            refunds {
              id
              createdAt
              processedAt
              updatedAt
              note
              totalRefundedSet {
                shopMoney {
                  amount
                }
              }
              orderAdjustments(first: $orderAdjustmentsFirst) {
                nodes {
                  id
                  reason
                  amountSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
              refundLineItems(first: $refundLineItemsFirst) {
                nodes {
                  id
                  quantity
                  restockType
                  subtotalSet {
                    shopMoney {
                      amount
                    }
                  }
                  lineItem {
                    id
                    quantity
                    title
                    sku
                    product {
                      id
                      legacyResourceId
                      handle
                      title
                    }
                    variant {
                      id
                      legacyResourceId
                      title
                      sku
                      selectedOptions {
                        name
                        value
                      }
                      product {
                        id
                        legacyResourceId
                        handle
                        title
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`;
}

function buildRefundOrderQueries(windowDays) {
  const since = getSinceDate(windowDays);
  return [
    { mode: "updated_at", query: `updated_at:>=${since}` },
    { mode: "partially_refunded", query: `financial_status:partially_refunded updated_at:>=${since}` },
    { mode: "refunded", query: `financial_status:refunded updated_at:>=${since}` },
  ];
}

async function extractReturnEventsWithPaginatedQueries({ admin, windowDays }) {
  const events = [];
  let ordersCursor;
  let hasNextOrdersPage = true;
  const orderQuery = `updated_at:>=${getSinceDate(windowDays)}`;

  while (hasNextOrdersPage) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseReturnsPage(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $returnsFirst: Int!,
        $returnLineItemsFirst: Int!
      ) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            returns(first: $returnsFirst) {
              nodes {
                id
                createdAt
                status
                returnLineItems(first: $returnLineItemsFirst) {
                  nodes {
                    ... on ReturnLineItem {
                      id
                      quantity
                      processedQuantity
                      refundedQuantity
                      customerNote
                      returnReason
                      returnReasonNote
                      fulfillmentLineItem {
                        lineItem {
                          id
                          title
                          sku
                          product {
                            id
                            handle
                            title
                          }
                          variant {
                            id
                            title
                            sku
                            selectedOptions {
                              name
                              value
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      {
        after: ordersCursor || null,
        query: orderQuery,
        ordersFirst: PAGINATED_ORDERS_PAGE_SIZE,
        returnsFirst: PAGINATED_RETURNS_PAGE_SIZE,
        returnLineItemsFirst: PAGINATED_RETURN_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      getNodes(order.returns).forEach((itemReturn) => {
        getNodes(itemReturn.returnLineItems).forEach((returnLineItem) => {
          events.push(normalizeReturnLineItemEvent(returnLineItem, { id: itemReturn.id, createdAt: itemReturn.createdAt || order.createdAt, orderId: order.id }));
        });
      });
    });
    hasNextOrdersPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
    ordersCursor = data?.orders?.pageInfo?.endCursor;
  }

  return events.filter(Boolean);
}

function normalizeBulkQuickScanData(catalogLines, orderLines) {
  const products = normalizeBulkProducts(catalogLines);
  const events = normalizeBulkOrderEvents(orderLines);
  return { products, events };
}

function normalizeBulkProducts(lines) {
  const products = new Map();

  lines.forEach((line) => {
    if (!line?.id) return;

    if (line.__typename === "Product" || isProductLike(line)) {
      const product = normalizeProduct({
        id: line.id,
        handle: line.handle,
        title: line.title,
        vendor: line.vendor,
        productType: line.productType,
        tags: line.tags,
        status: line.status,
        options: line.options,
        variants: [],
        collections: [],
      });
      getNodes(line.variants).forEach((variant) => product.variants.push(normalizeVariant(variant)));
      getNodes(line.collections).forEach((collection) => {
        product.collections.push({ id: collection.id, handle: collection.handle || "", title: collection.title || "" });
      });
      products.set(line.id, product);
      return;
    }

    const parentId = line.__parentId;
    const product = products.get(parentId);
    if (!product) return;

    if (line.__typename === "ProductVariant" || "selectedOptions" in line || "sku" in line) {
      product.variants.push(normalizeVariant(line));
    } else if (line.__typename === "Collection" || "handle" in line) {
      product.collections.push({ id: line.id, handle: line.handle || "", title: line.title || "" });
    }
  });

  return Array.from(products.values());
}

function normalizeBulkOrderEvents(lines) {
  const orders = new Map();
  const refunds = new Map();
  const returns = new Map();
  const events = [];

  lines.forEach((line) => {
    if (!line?.id) return;

    if (line.__typename === "Order" || ("createdAt" in line && !line.__parentId)) {
      const order = { id: line.id, createdAt: line.createdAt };
      orders.set(line.id, order);
      appendGroupedOrderEvents(line, order, events);
      return;
    }

    if (line.__typename === "Refund") {
      const order = orders.get(line.__parentId);
      refunds.set(line.id, { id: line.id, createdAt: line.createdAt || order?.createdAt, orderId: line.__parentId, note: line.note });
      return;
    }

    if (line.__typename === "Return") {
      const order = orders.get(line.__parentId);
      returns.set(line.id, { id: line.id, createdAt: line.createdAt || order?.createdAt, orderId: line.__parentId });
      return;
    }

    if (line.__typename === "LineItem" || ("quantity" in line && line.__parentId && orders.has(line.__parentId))) {
      const order = orders.get(line.__parentId);
      events.push(normalizeOrderLineItemEvent(line, order));
      return;
    }

    if (line.__typename === "RefundLineItem" || ("restockType" in line && refunds.has(line.__parentId))) {
      const refund = refunds.get(line.__parentId);
      events.push(normalizeRefundLineItemEvent(line, refund));
      return;
    }

    if (line.__typename === "ReturnLineItem" || ("returnReason" in line && returns.has(line.__parentId))) {
      const itemReturn = returns.get(line.__parentId);
      events.push(normalizeReturnLineItemEvent(line, itemReturn));
    }
  });

  return events.filter(Boolean);
}

function appendGroupedOrderEvents(orderLine, order, events) {
  getNodes(orderLine.lineItems).forEach((lineItem) => {
    events.push(normalizeOrderLineItemEvent(lineItem, order));
  });

  (orderLine.refunds || []).forEach((refund) => {
    getNodes(refund.refundLineItems).forEach((refundLineItem) => {
      events.push(normalizeRefundLineItemEvent(refundLineItem, {
        id: refund.id,
        createdAt: refund.createdAt || order.createdAt,
        orderId: order.id,
        note: refund.note,
      }));
    });
  });

  getNodes(orderLine.returns).forEach((itemReturn) => {
    const returnContext = {
      id: itemReturn.id,
      createdAt: itemReturn.createdAt || order.createdAt,
      orderId: order.id,
    };
    getNodes(itemReturn.returnLineItems).forEach((returnLineItem) => {
      events.push(normalizeReturnLineItemEvent(returnLineItem, returnContext));
    });
  });
}

function normalizeOrderLineItemEvent(lineItem, order) {
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};

  return {
    type: "sale",
    occurredAt: order?.createdAt,
    productId: product.id,
    variantId: variant.id,
    handle: product.handle,
    title: product.title || lineItem.title,
    quantity: toNumber(lineItem.quantity),
    amount: moneyAmount(lineItem.originalTotalSet),
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
  };
}

function normalizeRefundLineItemEvent(refundLineItem, refund) {
  const lineItem = refundLineItem.lineItem || {};
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};
  const adjustmentReasons = Array.isArray(refund?.adjustmentReasons) ? refund.adjustmentReasons : [];
  const reason = getRefundReasonText({
    note: refund?.note,
    restockType: refundLineItem.restockType,
    adjustmentReasons,
  });

  return {
    type: "refund",
    occurredAt: refundLineItem.createdAt || refund?.createdAt,
    productId: product.id || variant.product?.id,
    variantId: variant.id,
    handle: product.handle || variant.product?.handle,
    title: product.title || variant.product?.title || lineItem.title,
    quantity: toNumber(refundLineItem.quantity),
    amount: moneyAmount(refundLineItem.subtotalSet),
    totalRefundedAmount: refund?.totalRefundedAmount || 0,
    reason: reason || refundLineItem.restockType || "Refund",
    reasonLabel: reason,
    adjustmentReasons,
    note: refund?.note || "",
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
  };
}

function buildOrderLevelRefundFallbackEvents({
  order,
  refund,
  adjustmentReasons = [],
  seenOrderLevelRefundLineItemIds = new Set(),
}) {
  const lineItems = getNodes(order?.lineItems);
  if (!shouldUseOrderLevelRefundFallback(order, refund, lineItems)) return [];

  const totalRefundedAmount = getOrderLevelRefundAmount(order, refund, lineItems);
  const context = {
    id: refund?.id || `order-refund:${order?.id || ""}`,
    createdAt: refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt,
    updatedAt: refund?.updatedAt || refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt,
    orderId: order?.id,
    orderName: order?.name,
    displayFinancialStatus: order?.displayFinancialStatus,
    note: refund?.note || "",
    adjustmentReasons,
    totalRefundedAmount,
    lineItems,
  };

  return lineItems
    .map((lineItem) => {
      const fallbackKey = [order?.id, refund?.id || "order-level", lineItem?.id].filter(Boolean).join(":");
      if (!fallbackKey || seenOrderLevelRefundLineItemIds.has(fallbackKey)) return null;
      seenOrderLevelRefundLineItemIds.add(fallbackKey);
      return normalizeOrderLevelRefundLineItemEvent(lineItem, context);
    })
    .filter((event) => event?.productId || event?.variantId);
}

function normalizeOrderLevelRefundLineItemEvent(lineItem, refund) {
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};
  const amount = calculateFallbackRefundLineAmount(lineItem, refund);
  const reason = getOrderLevelRefundReasonText(refund);

  return {
    type: "refund",
    occurredAt: refund?.createdAt,
    productId: product.id || variant.product?.id,
    variantId: variant.id,
    handle: product.handle || variant.product?.handle,
    title: product.title || variant.product?.title || lineItem.title,
    quantity: calculateFallbackRefundQuantity(lineItem, amount),
    amount,
    totalRefundedAmount: refund?.totalRefundedAmount || amount,
    reason,
    reasonLabel: reason,
    adjustmentReasons: refund?.adjustmentReasons || [],
    note: refund?.note || "",
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
    fallbackSource: "order_financial_status",
  };
}

function shouldUseOrderLevelRefundFallback(order, refund, lineItems = []) {
  const status = String(order?.displayFinancialStatus || "").toUpperCase();
  const hasRefundSignal = status.includes("REFUND")
    || moneyAmount(order?.totalRefundedSet) > 0
    || moneyAmount(refund?.totalRefundedSet) > 0;
  if (!hasRefundSignal || !lineItems.length) return false;
  if (status === "REFUNDED") return true;
  if (status === "PARTIALLY_REFUNDED") return lineItems.length === 1;
  return lineItems.length === 1;
}

function getOrderLevelRefundAmount(order, refund, lineItems = []) {
  const refundAmount = moneyAmount(refund?.totalRefundedSet);
  if (refundAmount > 0) return refundAmount;
  const orderRefundedAmount = moneyAmount(order?.totalRefundedSet);
  if (orderRefundedAmount > 0) return orderRefundedAmount;
  return lineItems.reduce((total, lineItem) => total + moneyAmount(lineItem.originalTotalSet), 0);
}

function calculateFallbackRefundLineAmount(lineItem, refund) {
  const lineItems = refund?.lineItems || [];
  const totalRefundedAmount = toNumber(refund?.totalRefundedAmount);
  const lineAmount = moneyAmount(lineItem.originalTotalSet);
  if (!totalRefundedAmount) return roundMoney(lineAmount);

  const lineItemsAmount = lineItems.reduce((total, item) => total + moneyAmount(item.originalTotalSet), 0);
  if (lineItemsAmount > 0 && lineAmount > 0) {
    return roundMoney((totalRefundedAmount * lineAmount) / lineItemsAmount);
  }

  const lineItemCount = Math.max(lineItems.length, 1);
  return roundMoney(totalRefundedAmount / lineItemCount);
}

function calculateFallbackRefundQuantity(lineItem, amount) {
  const quantity = Math.max(toNumber(lineItem.quantity), 0);
  if (quantity <= 1) return quantity || 1;
  const lineAmount = moneyAmount(lineItem.originalTotalSet);
  if (!lineAmount || amount >= lineAmount) return quantity;
  return Math.max(1, Math.min(quantity, Math.round(quantity * (amount / lineAmount))));
}

function getOrderLevelRefundReasonText(refund = {}) {
  const reason = getRefundReasonText({
    adjustmentReasons: refund.adjustmentReasons,
  });
  if (reason) return reason;
  const status = normalizeRefundReasonLabel(refund.displayFinancialStatus || "");
  return status || "Order-level refund";
}

function getRefundAdjustmentReasons(refund = {}) {
  return getNodes(refund.orderAdjustments)
    .map((adjustment) => normalizeRefundReasonLabel(adjustment.reason))
    .filter(Boolean);
}

function getRefundReasonText(item = {}) {
  return [
    ...(Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : []),
    normalizeRefundReasonLabel(item.restockType),
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex((nested) => nested.toLowerCase() === value.toLowerCase()) === index)
    .join(" - ");
}

function normalizeRefundReasonLabel(value) {
  const normalized = String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized === "no restock") return "No restock";
  if (normalized === "cancel") return "Canceled before fulfillment";
  if (normalized === "return") return "Returned item restocked";
  if (normalized === "damage") return "Damage";
  if (normalized === "customer") return "Customer request";
  if (normalized === "restock") return "Restock discrepancy";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeReturnLineItemEvent(returnLineItem, itemReturn) {
  const lineItem = returnLineItem.fulfillmentLineItem?.lineItem || {};
  const product = lineItem.product || {};
  const variant = lineItem.variant || {};
  return {
    type: "return",
    occurredAt: returnLineItem.createdAt || itemReturn?.createdAt,
    productId: product.id,
    variantId: variant.id,
    handle: product.handle,
    title: product.title || lineItem.title,
    quantity: toNumber(returnLineItem.quantity || returnLineItem.processedQuantity || returnLineItem.refundedQuantity),
    amount: moneyAmount(returnLineItem.withCodeDiscountedTotalPriceSet),
    reason: returnLineItem.returnReason || "Return",
    reasonHandle: returnLineItem.returnReason,
    note: [returnLineItem.returnReasonNote, returnLineItem.customerNote].filter(Boolean).join(" "),
    variantTitle: variant.title,
    variantSku: variant.sku || lineItem.sku,
    variantOptions: variant.selectedOptions || [],
  };
}

function normalizeProduct(product) {
  return {
    id: product.id,
    handle: product.handle || getHandleFromTitle(product.title),
    title: product.title || "Untitled product",
    vendor: product.vendor || "",
    productType: product.productType || "",
    tags: Array.isArray(product.tags) ? product.tags : [],
    status: product.status || "",
    options: Array.isArray(product.options) ? product.options : [],
    variants: getNodes(product.variants).map(normalizeVariant),
    collections: getNodes(product.collections).map((collection) => ({
      id: collection.id,
      handle: collection.handle || "",
      title: collection.title || "",
    })),
  };
}

function normalizeVariant(variant) {
  return {
    id: variant.id,
    title: variant.title || "",
    sku: variant.sku || "",
    selectedOptions: Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [],
  };
}

function getProductAggregate(aggregates, product) {
  if (!aggregates.has(product.id)) {
    aggregates.set(product.id, {
      product,
      soldUnits: 0,
      salesAmount: 0,
      refundUnits: 0,
      refundAmount: 0,
      returnUnits: 0,
      recentSignalUnits: 0,
      totalSignalUnits: 0,
      returnReasons: new Map(),
      notes: [],
      refundNotes: [],
      affectedVariants: new Map(),
      lastSignalAt: null,
      signalEvents: [],
      csvReviewRatingCount: 0,
      csvReviewRatingSum: 0,
      csvLowRatingCount: 0,
      csvCriticalRatingCount: 0,
      csvNeutralRatingCount: 0,
      csvPositiveRatingCount: 0,
    });
  }

  return aggregates.get(product.id);
}

function applyCsvReviewRatingsToAggregates({ aggregates, productIndex, csvReviewRatings }) {
  if (!csvReviewRatings?.length) return;
  const lookup = buildProductLookup(productIndex);

  csvReviewRatings.forEach((row) => {
    const productId = resolveCsvRatingProductId(row, lookup);
    const aggregate = productId ? aggregates.get(productId) : null;
    if (!aggregate) return;
    applyCsvReviewRatingToAggregate(aggregate, row);
  });
}

function buildProductLookup(productIndex) {
  const byHandle = new Map();
  const byProductId = new Map();

  productIndex.forEach((product, productId) => {
    const handleKey = normalizeLookupKey(product.handle);
    if (handleKey) byHandle.set(handleKey, productId);
    getProductIdLookupKeys(product.id).forEach((key) => byProductId.set(key, productId));
  });

  return { byHandle, byProductId };
}

function resolveCsvRatingProductId(row, lookup) {
  for (const key of getProductIdLookupKeys(row.shopifyProductId)) {
    const productId = lookup.byProductId.get(key);
    if (productId) return productId;
  }

  const handleKey = normalizeLookupKey(row.productHandle);
  return handleKey ? lookup.byHandle.get(handleKey) : null;
}

function applyCsvReviewRatingToAggregate(aggregate, row) {
  const rating = clamp(toNumber(row.rating), 0, 5);
  if (!rating) return;

  aggregate.csvReviewRatingCount += 1;
  aggregate.csvReviewRatingSum += rating;
  if (rating <= 1) aggregate.csvCriticalRatingCount += 1;
  if (rating <= 2) aggregate.csvLowRatingCount += 1;
  if (rating === 3) aggregate.csvNeutralRatingCount += 1;
  if (rating >= 4) aggregate.csvPositiveRatingCount += 1;

  if (rating > 3) return;

  const occurredAt = parseOptionalDate(row.reviewDate);
  aggregate.totalSignalUnits += 1;
  aggregate.signalEvents.push({
    type: "csv_review_rating",
    quantity: 1,
    occurredAt,
    issueCode: rating <= 2 ? "low_review_rating" : "mixed_review_rating",
    reason: `${rating}-star CSV review rating`,
    note: "",
  });
  if (isRecentSignal(occurredAt)) aggregate.recentSignalUnits += 1;
  if (occurredAt && (!aggregate.lastSignalAt || new Date(occurredAt) > new Date(aggregate.lastSignalAt))) {
    aggregate.lastSignalAt = occurredAt;
  }
}

function applyEventToAggregate(aggregate, event) {
  const quantity = Math.max(toNumber(event.quantity), 0);

  if (event.type === "sale") {
    aggregate.soldUnits += quantity;
    aggregate.salesAmount += toNumber(event.amount);
    return;
  }

  if (event.type === "refund") {
    aggregate.refundUnits += quantity;
    aggregate.refundAmount += toNumber(event.amount);
    const refundContext = [event.reason, event.note].filter(Boolean).join(" - ");
    if (refundContext) aggregate.refundNotes.push(refundContext);
  }

  if (event.type === "return") {
    aggregate.returnUnits += quantity;
    addCount(aggregate.returnReasons, normalizeReason(event.reason || event.reasonHandle || "Return"), quantity || 1);
    if (event.note) aggregate.notes.push(event.note);
  }

  aggregate.totalSignalUnits += quantity || 1;
  aggregate.signalEvents.push({
    type: event.type,
    quantity: quantity || 1,
    occurredAt: event.occurredAt || null,
    issueCode: classifyQuickScanIssueEvent(event),
    reason: event.reason || event.reasonHandle || "",
    note: event.note || "",
  });
  if (isRecentSignal(event.occurredAt)) aggregate.recentSignalUnits += quantity || 1;
  if (event.occurredAt && (!aggregate.lastSignalAt || new Date(event.occurredAt) > new Date(aggregate.lastSignalAt))) {
    aggregate.lastSignalAt = event.occurredAt;
  }
  const variantLabel = getVariantLabel(event);
  addCount(aggregate.affectedVariants, variantLabel, quantity || 1);
}

function getStoreTotals(aggregates) {
  const totals = aggregates.reduce((sum, aggregate) => ({
    soldUnits: sum.soldUnits + aggregate.soldUnits,
    refundUnits: sum.refundUnits + aggregate.refundUnits,
    returnUnits: sum.returnUnits + aggregate.returnUnits,
    refundAmount: sum.refundAmount + aggregate.refundAmount,
    productsWithSales: sum.productsWithSales + (aggregate.soldUnits > 0 ? 1 : 0),
    csvReviewRatingCount: sum.csvReviewRatingCount + aggregate.csvReviewRatingCount,
    csvReviewRatingSum: sum.csvReviewRatingSum + aggregate.csvReviewRatingSum,
    csvLowRatingCount: sum.csvLowRatingCount + aggregate.csvLowRatingCount,
    csvNeutralRatingCount: sum.csvNeutralRatingCount + aggregate.csvNeutralRatingCount,
    csvPositiveRatingCount: sum.csvPositiveRatingCount + aggregate.csvPositiveRatingCount,
    productsWithCsvRatings: sum.productsWithCsvRatings + (aggregate.csvReviewRatingCount > 0 ? 1 : 0),
  }), {
    soldUnits: 0,
    refundUnits: 0,
    returnUnits: 0,
    refundAmount: 0,
    productsWithSales: 0,
    csvReviewRatingCount: 0,
    csvReviewRatingSum: 0,
    csvLowRatingCount: 0,
    csvNeutralRatingCount: 0,
    csvPositiveRatingCount: 0,
    productsWithCsvRatings: 0,
  });

  return {
    ...totals,
    avgReturnRate: safeRate(totals.returnUnits, totals.soldUnits),
    avgRefundRate: safeRate(totals.refundUnits, totals.soldUnits),
    avgRefundAmount: totals.refundAmount / Math.max(totals.productsWithSales, 1),
    avgCsvRating: totals.csvReviewRatingCount > 0 ? totals.csvReviewRatingSum / totals.csvReviewRatingCount : 0,
    avgCsvLowRatingRate: safeRate(totals.csvLowRatingCount, totals.csvReviewRatingCount),
  };
}

function scoreProductAggregate(aggregate, storeTotals, { windowDays, extractionMode }) {
  const returnRate = safeRate(aggregate.returnUnits, aggregate.soldUnits);
  const refundRate = safeRate(aggregate.refundUnits, aggregate.soldUnits);
  const returnRatePercent = roundPercent(returnRate);
  const refundRatePercent = roundPercent(refundRate);
  const topReasons = topEntries(aggregate.returnReasons, 4);
  const affectedVariants = topEntries(aggregate.affectedVariants, 4);
  const csvRatingSummary = getCsvRatingSummary(aggregate);
  const csvRatingRisk = getCsvRatingRiskScore({ summary: csvRatingSummary, storeTotals });
  const csvReviewSignalCount = csvRatingSummary.lowRatingCount + csvRatingSummary.neutralRatingCount;
  const lightweightTextSignalCount = getQuickScanLightweightTextSignalCount({ aggregate, topReasons });
  const signalCount = aggregate.returnUnits
    + aggregate.refundUnits
    + topReasons.reduce((sum, reason) => sum + reason.count, 0)
    + csvReviewSignalCount;
  const sourceCoverage = getSourceCoverage(aggregate);
  const hasCrossSourceAgreement = Boolean(
    (aggregate.returnUnits > 0 && aggregate.refundUnits > 0)
    || (csvRatingRisk > 0 && (aggregate.returnUnits > 0 || aggregate.refundUnits > 0)),
  );
  const scoreModel = calculateProductScoreModel({
    soldUnits: aggregate.soldUnits,
    salesAmount: aggregate.salesAmount,
    returnUnits: aggregate.returnUnits,
    refundUnits: aggregate.refundUnits,
    refundAmount: aggregate.refundAmount,
    returnRate,
    refundRate,
    storeReturnBaseline: storeTotals.avgReturnRate,
    storeRefundBaseline: storeTotals.avgRefundRate,
    reviewCount: csvRatingSummary.ratingCount,
    negativeReviewCount: csvRatingSummary.lowRatingCount,
    negativeReviewRate: csvRatingSummary.negativeRatingRate,
    storeNegativeReviewBaseline: storeTotals.avgCsvLowRatingRate,
    avgRating: csvRatingSummary.averageRating,
    sentimentTotal: lightweightTextSignalCount,
    sentimentNegativeCount: lightweightTextSignalCount,
    variantCount: (aggregate.product.variants || []).length,
    affectedVariantCount: affectedVariants.length,
    affectedVariantSignalCount: affectedVariants.reduce((sum, variant) => sum + variant.count, 0),
    strongestVariantSignalCount: affectedVariants[0]?.count || 0,
    recentSignalUnits: aggregate.recentSignalUnits,
    signalEventCount: signalCount,
    effectiveSampleSize: aggregate.returnUnits + aggregate.refundUnits + csvRatingSummary.ratingCount,
    sourceCoverage,
    sourceAgreement: hasCrossSourceAgreement,
    productMatchConfidence: 1,
    dataQualityIncomplete: extractionMode === "catalog-only",
    missingOrders: extractionMode === "catalog-only",
    calculationState: "calculated_from_persisted_components",
    windowDays,
  }, { sentimentSharesReviewSource: true });
  const riskScore = scoreModel.riskScore;
  const riskComponents = {
    ...scoreModel.riskComponents,
    returnRisk: scoreModel.riskComponents.returnsScore,
    refundRisk: scoreModel.riskComponents.refundScore,
    csvRatingRisk: scoreModel.riskComponents.reviewsScore,
    repeatedReasonRisk: scoreModel.riskComponents.sentimentScore,
  };

  const primaryIssue = getPrimaryIssue({
    topReasons,
    notes: [...aggregate.notes, ...aggregate.refundNotes],
    refundRate,
    returnRate,
    csvRatingSummary,
    csvRatingRisk,
  });
  const trendOptions = {
    dateField: "occurredAt",
    startAt: getSinceDate(windowDays),
    endAt: new Date().toISOString(),
  };
  const signalTrendResult = buildDatedSignalTrend(aggregate.signalEvents, trendOptions);
  const signalTrend = signalTrendResult.values;
  const riskTrend = buildRiskTrendFromSignalTrend(signalTrend, riskScore);
  const issueSignalTrends = buildIssueTrendMap(aggregate.signalEvents, trendOptions);
  const confidenceResult = {
    confidence: scoreModel.confidenceScore,
    factors: scoreModel.confidenceFactors,
  };
  const impactFactors = scoreModel.impactFactors;

  return {
    productGid: aggregate.product.id,
    productTitle: aggregate.product.title,
    handle: aggregate.product.handle,
    riskScore,
    impactScore: Math.round(impactFactors.estimatedImpact || 0),
    confidence: confidenceResult.confidence,
    primaryIssue,
    sourceCoverage,
    metrics: {
      windowDays,
      extractionMode,
      soldUnits: aggregate.soldUnits,
      salesAmount: roundMoney(aggregate.salesAmount),
      avgUnitRevenue: roundMoney(aggregate.soldUnits > 0 ? aggregate.salesAmount / aggregate.soldUnits : 0),
      returnUnits: aggregate.returnUnits,
      refundUnits: aggregate.refundUnits,
      returnRate: returnRatePercent,
      refundRate: refundRatePercent,
      storeAvgReturnRate: roundPercent(storeTotals.avgReturnRate),
      storeAvgRefundRate: roundPercent(storeTotals.avgRefundRate),
      refundAmount: roundMoney(aggregate.refundAmount),
      refundNoteCount: aggregate.refundNotes.length,
      refundNotes: aggregate.refundNotes.slice(0, 5),
      refundPressure: getRefundPressureSummary({ aggregate, refundRate: refundRatePercent }),
      revenueAtRisk: roundMoney(impactFactors.revenueAtRisk),
      marginAtRisk: roundMoney(impactFactors.marginAtRisk),
      estimatedImpact: roundMoney(impactFactors.estimatedImpact),
      impactRange: {
        low: roundMoney(impactFactors.impactLow),
        mid: roundMoney(impactFactors.impactMid),
        high: roundMoney(impactFactors.impactHigh),
      },
      impactFactors,
      priorityScore: scoreModel.priorityScore,
      evidenceStrengthScore: scoreModel.evidenceStrengthScore,
      scoreCalculationStatus: "Score calculated from persisted components",
      avgRating: csvRatingSummary.averageRating,
      reviewRating: csvRatingSummary.averageRating,
      reviewCount: csvRatingSummary.ratingCount,
      negativeReviewCount: csvRatingSummary.lowRatingCount,
      negativeReviewRate: csvRatingSummary.negativeRatingRate,
      csvReviewRatingCount: csvRatingSummary.ratingCount,
      csvAverageRating: csvRatingSummary.averageRating,
      csvLowRatingCount: csvRatingSummary.lowRatingCount,
      csvCriticalRatingCount: csvRatingSummary.criticalRatingCount,
      csvNeutralRatingCount: csvRatingSummary.neutralRatingCount,
      csvPositiveRatingCount: csvRatingSummary.positiveRatingCount,
      csvNegativeRatingRate: csvRatingSummary.negativeRatingRate,
      csvRatingRisk: roundScore(csvRatingRisk),
      signalCount,
      topReturnReasons: topReasons.map((reason) => reason.label),
      affectedVariants: affectedVariants.map((variant) => variant.label),
      recentSignalUnits: aggregate.recentSignalUnits,
      lastSignalAt: aggregate.lastSignalAt,
      signalTrend,
      riskTrend,
      trendMeta: signalTrendResult.meta,
      issueSignalTrends,
      riskComponents,
      confidenceFactors: confidenceResult.factors,
      productType: aggregate.product.productType,
      vendor: aggregate.product.vendor,
      tags: aggregate.product.tags,
      collections: aggregate.product.collections.map((collection) => collection.title).filter(Boolean),
      variantCount: aggregate.product.variants.length,
      skuCount: aggregate.product.variants.filter((variant) => variant.sku).length,
      optionNames: aggregate.product.options.map((option) => option.name).filter(Boolean),
      productStatus: aggregate.product.status,
    },
  };
}

function getQuickScanLightweightTextSignalCount({ aggregate, topReasons }) {
  const noteCount = [...aggregate.notes, ...aggregate.refundNotes]
    .filter((note) => String(note || "").trim().length >= 3).length;
  const repeatedReasonCount = (topReasons || [])
    .filter((reason) => reason.count >= 2)
    .reduce((sum, reason) => sum + reason.count, 0);
  return Math.max(noteCount, repeatedReasonCount);
}

async function persistQuickScanCandidates(shop, candidates) {
  const fullDiagnosisProductGids = await getFullDiagnosisProductGids(shop);
  const { persistableCandidates, ignoredFullDiagnosisProducts } = getPersistableQuickScanCandidates(candidates, fullDiagnosisProductGids);
  const productGids = persistableCandidates.map((candidate) => candidate.productGid);
  const retainedProductGids = Array.from(new Set([...productGids, ...fullDiagnosisProductGids]));

  const persistedSnapshots = await prisma.$transaction(async (tx) => {
    if (retainedProductGids.length) {
      await tx.productRiskSnapshot.deleteMany({
        where: {
          shop,
          productGid: { notIn: retainedProductGids },
        },
      });
    } else {
      await tx.productRiskSnapshot.deleteMany({ where: { shop } });
    }

    return Promise.all(persistableCandidates.map((candidate) => tx.productRiskSnapshot.upsert({
      where: {
        shop_productGid: {
          shop,
          productGid: candidate.productGid,
        },
      },
      create: {
        shop,
        productGid: candidate.productGid,
        productTitle: candidate.productTitle,
        handle: candidate.handle,
        riskScore: candidate.riskScore,
        impactScore: candidate.impactScore,
        confidence: candidate.confidence,
        primaryIssue: candidate.primaryIssue,
        sourceCoverage: candidate.sourceCoverage,
        metrics: candidate.metrics,
      },
      update: {
        productTitle: candidate.productTitle,
        handle: candidate.handle,
        riskScore: candidate.riskScore,
        impactScore: candidate.impactScore,
        confidence: candidate.confidence,
        primaryIssue: candidate.primaryIssue,
        sourceCoverage: candidate.sourceCoverage,
        metrics: candidate.metrics,
        calculatedAt: new Date(),
      },
    })));
  });
  await Promise.all([
    recordProductScoreHistoryBatch(shop, persistedSnapshots, { source: "quickscan" }),
    recordWatchlistScanActivities(shop, persistedSnapshots, { source: "quickscan" }),
  ]);

  return {
    persistedCandidates: persistableCandidates.length,
    ignoredFullDiagnosisProducts,
    retainedFullDiagnosisProducts: fullDiagnosisProductGids.length,
  };
}

export function getPersistableQuickScanCandidates(candidates = [], fullDiagnosisProductGids = []) {
  const fullDiagnosisProductGidSet = new Set(fullDiagnosisProductGids.filter(Boolean));
  const persistableCandidates = candidates.filter((candidate) => !fullDiagnosisProductGidSet.has(candidate.productGid));

  return {
    persistableCandidates,
    ignoredFullDiagnosisProducts: candidates.length - persistableCandidates.length,
  };
}

async function getFullDiagnosisProductGids(shop) {
  const diagnoses = await prisma.productDiagnosis.findMany({
    where: {
      shop,
      status: "Completed",
      completedAt: { not: null },
    },
    select: { productGid: true },
  });

  return Array.from(new Set(diagnoses.map((diagnosis) => diagnosis.productGid).filter(Boolean)));
}

function getQuickScanCompletionSource(persistence) {
  const persisted = persistence.persistedCandidates;
  const ignored = persistence.ignoredFullDiagnosisProducts;
  const productLabel = `${persisted} product${persisted === 1 ? "" : "s"} needing attention`;
  if (!ignored) return `QuickScan completed - ${productLabel}`;
  return `QuickScan completed - ${productLabel}; ${ignored} full diagnosis product${ignored === 1 ? "" : "s"} ignored`;
}

async function updateQuickScanJob(jobId, data) {
  await prisma.catalogSignalJob.update({
    where: { id: jobId },
    data,
  });
}

async function shopifyGraphql(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

function isPersistableCandidate(candidate, settings = undefined) {
  const minimumRiskScore = getQuickScanMinimumRiskScore(settings);
  return candidate.riskScore >= minimumRiskScore;
}

function getCsvRatingSummary(aggregate) {
  const ratingCount = aggregate.csvReviewRatingCount || 0;
  const averageRating = ratingCount > 0 ? roundRating(aggregate.csvReviewRatingSum / ratingCount) : 0;
  const lowRatingCount = aggregate.csvLowRatingCount || 0;
  const neutralRatingCount = aggregate.csvNeutralRatingCount || 0;

  return {
    ratingCount,
    averageRating,
    lowRatingCount,
    criticalRatingCount: aggregate.csvCriticalRatingCount || 0,
    neutralRatingCount,
    positiveRatingCount: aggregate.csvPositiveRatingCount || 0,
    negativeRatingRate: roundPercent(safeRate(lowRatingCount, ratingCount)),
    neutralOrNegativeRatingRate: roundPercent(safeRate(lowRatingCount + neutralRatingCount, ratingCount)),
  };
}

function getCsvRatingRiskScore({ summary, storeTotals }) {
  if (!summary.ratingCount) return 0;

  const benchmarkRating = storeTotals.avgCsvRating > 0
    ? clamp(storeTotals.avgCsvRating, 3.8, 4.4)
    : 4.2;
  const averageDeficit = clamp(benchmarkRating - summary.averageRating, 0, 3.2);
  const lowRatingRate = safeRate(summary.lowRatingCount, summary.ratingCount);
  const neutralRatingRate = safeRate(summary.neutralRatingCount, summary.ratingCount);
  const storeLowRatingRate = storeTotals.avgCsvLowRatingRate || 0;
  const averageDeficitRisk = 24 * (1 - Math.exp(-averageDeficit / 1.15));
  const lowShareRisk = 28 * (1 - Math.exp(-lowRatingRate / 0.45));
  const neutralShareRisk = 10 * (1 - Math.exp(-neutralRatingRate / 0.55));
  const anomalyRisk = lowRatingRate > storeLowRatingRate
    ? clamp((lowRatingRate - storeLowRatingRate) * 18, 0, 8)
    : 0;
  const concernRisk = averageDeficitRisk + lowShareRisk + neutralShareRisk + anomalyRisk;
  if (!concernRisk) return 0;
  const sampleSupport = clamp(Math.log2(summary.ratingCount + 1) * 3.1, 0, 12);
  const rawRisk = concernRisk + sampleSupport;
  const supportedRisk = rawRisk * getCsvRatingSampleSupport(summary.ratingCount);
  const sampleCap = summary.ratingCount < 3 ? 16 : summary.ratingCount < 5 ? 32 : 48;

  return clamp(supportedRisk, 0, sampleCap);
}

function getCsvRatingSampleSupport(ratingCount) {
  if (ratingCount < 2) return 0.28;
  if (ratingCount < 3) return 0.42;
  if (ratingCount < 5) return 0.62;
  if (ratingCount < 10) return 0.86;
  return 1;
}

function getRefundPressureSummary({ aggregate, refundRate }) {
  const highPressure = Number(aggregate.soldUnits || 0) > 10 && Number(refundRate || 0) > 20;
  return {
    highPressure,
    level: highPressure ? "high" : aggregate.refundUnits >= 3 && refundRate >= 10 ? "monitor" : "low",
    refundUnits: aggregate.refundUnits,
    soldUnits: aggregate.soldUnits,
    refundRate,
    noteCount: aggregate.refundNotes.length,
  };
}

function getSourceCoverage(aggregate) {
  const sources = ["Shopify products"];
  if (aggregate.soldUnits > 0) sources.push("Shopify orders");
  if (aggregate.refundUnits > 0) sources.push("Shopify refunds");
  if (aggregate.returnUnits > 0) sources.push("Shopify returns");
  if (aggregate.csvReviewRatingCount > 0) sources.push("CSV review ratings");
  return sources;
}

function getPrimaryIssue({ topReasons, notes, refundRate, returnRate, csvRatingSummary, csvRatingRisk }) {
  const text = `${topReasons.map((reason) => reason.label).join(" ")} ${notes.join(" ")}`.toLowerCase();
  if (/too small|too large|size|fit|waist|inseam|tight|loose/.test(text)) return "Fit & sizing";
  if (/scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror/.test(text)) return "Fear or safety concern";
  if (/defect|damaged|broken|quality|faulty|zipper|tear|crack/.test(text)) return "Product defect or durability";
  if (/color|not as described|description|photo|image|style/.test(text)) return "Expectation mismatch";
  if (csvRatingRisk >= 30 && csvRatingSummary.averageRating > 0 && csvRatingSummary.averageRating < 3) return "Low CSV review rating";
  if (csvRatingRisk >= 18) return "Mixed CSV review rating";
  if (returnRate > refundRate && returnRate > 0) return "Return rate anomaly";
  if (refundRate > 0) return "Refund impact";
  return "Product quality signal";
}

function classifyQuickScanIssueEvent(event) {
  if (event.type === "csv_review_rating") return event.issueCode || "low_review_rating";
  const text = `${event.reason || ""} ${event.reasonHandle || ""} ${event.note || ""}`.toLowerCase();
  if (/too small|too large|size|fit|waist|inseam|tight|loose/.test(text)) return "fit_sizing";
  if (/scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror/.test(text)) return "safety_concern";
  if (/defect|damaged|broken|quality|faulty|zipper|tear|crack/.test(text)) return "quality_defect";
  if (/color|not as described|description|photo|image|style/.test(text)) return "color_expectation";
  if (event.type === "refund") return "refund_impact";
  if (event.type === "return") return "return_rate_anomaly";
  return "product_quality";
}

function getVariantLabel(event) {
  if (event.variantOptions?.length) {
    return event.variantOptions.map((option) => option.value).filter(Boolean).join(" / ");
  }
  if (event.variantTitle && event.variantTitle !== "Default Title") return event.variantTitle;
  if (event.variantSku) return event.variantSku;
  return "Default variant";
}

function normalizeReason(reason) {
  return String(reason || "Return")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function moneyAmount(moneyBag) {
  return toNumber(moneyBag?.shopMoney?.amount);
}

function safeRate(numerator, denominator) {
  const denominatorNumber = toNumber(denominator);
  if (!denominatorNumber) return 0;
  return Math.max(0, Math.min(1, toNumber(numerator) / denominatorNumber));
}

function roundPercent(value) {
  return Math.round(value * 1000) / 10;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function roundRating(value) {
  return Math.round(toNumber(value) * 10) / 10;
}

function roundScore(value) {
  return Math.round(toNumber(value) * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, min), max);
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function isRecentSignal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 14 * 24 * 60 * 60 * 1000;
}

function getSinceDate(windowDays) {
  const date = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function filterRowsByLookbackWindow(rows = [], dateKey = "createdAt", windowDays = QUICK_SCAN_DEFAULT_WINDOW_DAYS) {
  const cutoff = Date.now() - Math.max(1, Number(windowDays || QUICK_SCAN_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const value = row?.[dateKey];
    if (!value) return true;
    const time = new Date(value).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getNodes(connection) {
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge.node).filter(Boolean);
  return [];
}

function isProductLike(line) {
  return "handle" in line && "title" in line && !line.__parentId;
}

function getHandleFromTitle(title) {
  return String(title || "untitled-product")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getProductIdLookupKeys(value) {
  const text = normalizeLookupKey(value);
  if (!text) return [];
  const keys = new Set([text]);
  const gidMatch = text.match(/product\/(\d+)/);
  if (gidMatch?.[1]) keys.add(gidMatch[1]);
  if (/^\d+$/.test(text)) keys.add(text);
  return Array.from(keys);
}

function countCsvRatingProductKeys(ratings) {
  return new Set((ratings || []).map((row) => {
    const idKey = getProductIdLookupKeys(row.shopifyProductId)[0];
    return idKey || normalizeLookupKey(row.productHandle);
  }).filter(Boolean)).size;
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function isShopifyOrderAccessDeniedError(error, contextLabel = "") {
  const message = getErrorMessage(error);
  if (!/ACCESS_DENIED|not approved to access/i.test(message)) return false;
  return /orders?/i.test(contextLabel) || /Order object|orders?\b/i.test(message);
}

async function waitForMinimumDuration(startedAt, minimumDurationMs) {
  const remaining = minimumDurationMs - (Date.now() - startedAt);
  if (remaining > 0) await sleep(remaining);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const PRODUCT_CATALOG_BULK_QUERY = `{
  products {
    edges {
      node {
        __typename
        id
        handle
        title
        vendor
        productType
        tags
        status
        options {
          name
          values
        }
        collections {
          edges {
            node {
              __typename
              id
              handle
              title
            }
          }
        }
        variants {
          edges {
            node {
              __typename
              id
              title
              sku
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  }
}`;

export function buildOrdersBulkQuery(windowDays) {
  return `{
    orders(query: "created_at:>=${getSinceDate(windowDays)}") {
      edges {
        node {
          __typename
          id
          createdAt
          lineItems {
            edges {
              node {
                __typename
                id
                quantity
                title
                sku
                product {
                  id
                  handle
                  title
                }
                variant {
                  id
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
          returns {
            edges {
              node {
                __typename
                id
                createdAt
                status
                returnLineItems {
                  edges {
                    node {
                      __typename
                      ... on ReturnLineItem {
                        id
                        quantity
                        processedQuantity
                        refundedQuantity
                        customerNote
                        returnReason
                        returnReasonNote
                        fulfillmentLineItem {
                          lineItem {
                            id
                            title
                            sku
                            product {
                              id
                              handle
                              title
                            }
                            variant {
                              id
                              title
                              sku
                              selectedOptions {
                                name
                                value
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;
}

export const __productPulseQuickScanTestHooks = {
  buildPaginatedRefundsQuery,
  buildRefundOrderQueries,
  buildOrderLevelRefundFallbackEvents,
  normalizeBulkQuickScanData,
  normalizeBulkProducts,
  normalizeBulkOrderEvents,
  quickScanBulkGroupObjects: QUICK_SCAN_BULK_GROUP_OBJECTS,
};
