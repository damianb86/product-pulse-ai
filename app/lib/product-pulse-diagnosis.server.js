import prisma from "../db.server";
import { runProductDiagnosisAiAnalysis } from "./product-pulse-ai.server";
import { getNormalizedCsvReviewsForShop } from "./product-pulse-csv.server";
import { recordProductScoreHistory } from "./product-pulse-history.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";
import {
  buildDatedSignalTrend,
  buildIssueTrendMap,
  buildRiskTrendFromSignalTrend,
} from "./product-pulse-trends.server";
import { recordWatchlistScanActivities } from "./product-pulse-watchlist.server";
import { calculateProductScoreModel } from "./product-pulse-scoring";

const DIAGNOSIS_WINDOW_DAYS = 90;
const MAX_ORDER_PAGES = 5;
const MAX_JUDGEME_REVIEW_PAGES = 3;
const MAX_JUDGEME_SYNC_PAGES = 5;
const JUDGEME_BASE_URLS = ["https://api.judge.me/api/v1", "https://judge.me/api/v1"];
const DIAGNOSIS_ORDERS_PAGE_SIZE = 8;
const DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE = 25;
const DIAGNOSIS_REFUND_LINE_ITEMS_PAGE_SIZE = 20;
const DIAGNOSIS_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE = 25;
const DIAGNOSIS_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE = 5;
const MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE = 2;
const DIAGNOSIS_REFUND_QUERY_PLANS = [
  { label: "balanced", ordersFirst: 8, refundLineItemsFirst: DIAGNOSIS_REFUND_LINE_ITEMS_PAGE_SIZE, fallbackLineItemsFirst: DIAGNOSIS_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE, orderAdjustmentsFirst: DIAGNOSIS_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE, includeVariantProduct: true, includeAdjustments: true },
  { label: "low-cost", ordersFirst: 5, refundLineItemsFirst: 10, fallbackLineItemsFirst: 18, orderAdjustmentsFirst: 3, includeVariantProduct: true, includeAdjustments: true },
  { label: "minimal", ordersFirst: 4, refundLineItemsFirst: 8, fallbackLineItemsFirst: 12, orderAdjustmentsFirst: 0, includeVariantProduct: false, includeAdjustments: false },
];
const DIAGNOSIS_RETURN_QUERY_PLANS = [
  { label: "balanced", ordersFirst: 8, returnsFirst: 3, returnLineItemsFirst: 15, includeVariantProduct: true },
  { label: "low-cost", ordersFirst: 5, returnsFirst: 2, returnLineItemsFirst: 10, includeVariantProduct: true },
  { label: "minimal", ordersFirst: 4, returnsFirst: 2, returnLineItemsFirst: 8, includeVariantProduct: false },
];

export async function runDetailedProductDiagnosis({ shop, jobId, admin, snapshot }) {
  const shopifyData = await fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot });
  const judgeMeData = await fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product });
  const csvReviewData = await fetchCsvReviewDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product });
  const deterministic = calculateDeterministicDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData });
  const recommendationCandidates = buildRuleRecommendationCandidates(deterministic);
  const aiInput = {
    product: buildAiProductInput(shopifyData.product, snapshot),
    deterministic: buildAiDeterministicInput(deterministic),
    evidenceSnippets: deterministic.evidenceSnippets,
    recommendationCandidates,
  };

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.metrics_calculated",
    message: "Deterministic product diagnosis metrics were calculated before AI.",
    data: {
      productGid: snapshot.productGid,
      soldUnits: deterministic.metrics.soldUnits,
      returnUnits: deterministic.metrics.returnUnits,
      refundUnits: deterministic.metrics.refundUnits,
      refundAmount: deterministic.metrics.refundAmount,
      reviewCount: deterministic.metrics.reviewCount,
      negativeReviewCount: deterministic.metrics.negativeReviewCount,
      customerTextSignals: deterministic.metrics.textInsights?.sentiment?.total || 0,
      negativeTextSignals: deterministic.metrics.textInsights?.sentiment?.negative || 0,
      subjectiveNegativeSignals: deterministic.metrics.textInsights?.subjectiveNegativity?.count || 0,
      deterministicEmotionCounts: deterministic.metrics.textInsights?.emotions || [],
      otherReturnClassifications: deterministic.metrics.textInsights?.otherReturnClassifications || [],
      riskScore: deterministic.riskScore,
      confidence: deterministic.confidence,
      estimatedImpact: deterministic.estimatedImpact,
      mainIssue: deterministic.mainIssue,
      sourceCoverage: deterministic.sourceCoverage,
    },
  });

  const ai = await runProductDiagnosisAiAnalysis({ shop, jobId, input: aiInput });
  const emergentSentiments = normalizeAiEmergentSentiments(ai);
  const knownEmotions = normalizeAiKnownEmotions(ai, deterministic.metrics.textInsights);
  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.emergent_sentiments_clustered",
    message: emergentSentiments.length
      ? "AI clustered emergent customer sentiments with enough evidence."
      : "AI did not find emergent customer sentiments with enough evidence.",
    data: {
      productGid: snapshot.productGid,
      knownEmotions,
      emergentSentiments,
      discardedSuggestions: ai.emergentSentiments?.discarded_suggestions || [],
    },
  });
  const diagnosisPayload = buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData, deterministic, ai });
  const diagnosis = await persistDetailedDiagnosis({ shop, snapshot, payload: diagnosisPayload });

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.persisted",
    message: "Detailed product diagnosis was persisted and product signals were updated.",
    data: {
      diagnosisId: diagnosis.id,
      productGid: snapshot.productGid,
      riskScore: diagnosisPayload.riskScore,
      confidence: diagnosisPayload.confidence,
      estimatedImpact: diagnosisPayload.metrics.estimatedImpact,
      issues: diagnosisPayload.issues.map((issue) => issue.issue),
      recommendations: diagnosisPayload.recommendations.map((action) => action.label),
      modelsUsed: ai.modelsUsed,
    },
  });

  return {
    status: "success",
    diagnosisId: diagnosis.id,
    riskScore: diagnosisPayload.riskScore,
    confidence: diagnosisPayload.confidence,
    estimatedImpact: diagnosisPayload.metrics.estimatedImpact,
    provider: ai.provider,
    model: ai.model,
    modelsUsed: ai.modelsUsed,
  };
}

async function fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot }) {
  const product = await fetchShopifyProduct({ admin, snapshot }).catch(async (error) => {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_diagnosis.shopify_product_failed",
      message: "Shopify product detail fetch failed; using the stored ProductPulse snapshot.",
      data: { error: serializeError(error), productGid: snapshot.productGid, handle: snapshot.handle },
    });
    return normalizeSnapshotProduct(snapshot);
  });

  let sales = [];
  let refunds = [];
  let returns = [];
  let orderAccessDenied = false;

  try {
    sales = await fetchShopifySalesEvents({ admin, product, snapshot });
  } catch (error) {
    const denied = isShopifyOrderAccessDenied(error);
    orderAccessDenied = orderAccessDenied || denied;
    await recordJobLog({
      shop,
      jobId,
      level: denied ? "warn" : "error",
      event: denied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_sales_failed",
      message: denied
        ? "Shopify denied Order object access while reading sales; diagnosis will use stored QuickScan metrics and connected review data where needed."
        : "Shopify sales extraction failed; diagnosis will continue with refunds, returns and review evidence where available.",
      data: { error: serializeError(error), recovery: denied ? "snapshot-and-reviews" : "partial-shopify-data" },
    });
  }

  try {
    refunds = await fetchShopifyRefundEvents({ shop, jobId, admin, product, snapshot });
  } catch (error) {
    const denied = isShopifyOrderAccessDenied(error);
    orderAccessDenied = orderAccessDenied || denied;
    await recordJobLog({
      shop,
      jobId,
      level: denied ? "warn" : "error",
      event: denied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_refunds_failed",
      message: denied
        ? "Shopify denied Order object access while reading refunds; refund evidence will fall back to stored QuickScan metrics."
        : "Shopify refund extraction failed; diagnosis will continue with other evidence.",
      data: { error: serializeError(error), recovery: denied ? "snapshot-and-reviews" : "partial-shopify-data" },
    });
  }

  try {
    returns = await fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot });
  } catch (error) {
    const denied = isShopifyOrderAccessDenied(error);
    orderAccessDenied = orderAccessDenied || denied;
    await recordJobLog({
      shop,
      jobId,
      level: denied ? "warn" : "error",
      event: denied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_returns_failed",
      message: denied
        ? "Shopify denied Order object access while reading returns; return evidence will fall back to stored QuickScan metrics."
        : "Shopify return extraction failed; diagnosis will continue with other evidence.",
      data: { error: serializeError(error), recovery: denied ? "snapshot-and-reviews" : "partial-shopify-data" },
    });
  }

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_extracted",
    message: "Shopify product diagnosis data extraction finished.",
    data: {
      productGid: product.id,
      salesEvents: sales.length,
      refundEvents: refunds.length,
      returnEvents: returns.length,
      orderAccessDenied,
    },
  });

  return { product, sales, refunds, returns, orderAccessDenied };
}

async function fetchShopifyProduct({ admin, snapshot }) {
  if (!admin?.graphql) return normalizeSnapshotProduct(snapshot);

  if (snapshot.productGid) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseDiagnosisProduct($id: ID!) {
        product: node(id: $id) {
          ... on Product {
            id
            legacyResourceId
            title
            handle
            description
            descriptionHtml
            vendor
            productType
            status
            tags
            options {
              name
              values
            }
            variants(first: 100) {
              nodes {
                id
                legacyResourceId
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                inventoryItem {
                  id
                  tracked
                }
                selectedOptions {
                  name
                  value
                }
              }
            }
            collections(first: 20) {
              nodes {
                title
                handle
              }
            }
            metafields(first: 20) {
              nodes {
                namespace
                key
                type
                value
              }
            }
            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType
                status
                preview {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
                ... on MediaImage {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
              }
            }
          }
        }
      }`,
      { id: snapshot.productGid },
    );
    if (data?.product?.id) return normalizeShopifyProduct(data.product, snapshot);
  }

  const data = await shopifyGraphql(
    admin,
    `#graphql
    query ProductPulseDiagnosisProductByHandle($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          legacyResourceId
          title
          handle
          description
          descriptionHtml
          vendor
          productType
          status
          tags
          options {
            name
            values
          }
          variants(first: 100) {
            nodes {
              id
              legacyResourceId
              title
              sku
              price
              compareAtPrice
              inventoryQuantity
              inventoryPolicy
              inventoryItem {
                id
                tracked
              }
              selectedOptions {
                name
                value
              }
            }
          }
          collections(first: 20) {
            nodes {
              title
              handle
            }
          }
          metafields(first: 20) {
            nodes {
              namespace
              key
              type
              value
            }
          }
          media(first: 20) {
            nodes {
              id
              alt
              mediaContentType
              status
              preview {
                image {
                  url
                  altText
                  width
                  height
                }
              }
              ... on MediaImage {
                image {
                  url
                  altText
                  width
                  height
                }
              }
            }
          }
        }
      }
    }`,
    { query: `handle:${escapeShopifyQueryValue(snapshot.handle)}` },
  );

  return normalizeShopifyProduct(data?.products?.nodes?.[0], snapshot);
}

async function fetchShopifySalesEvents({ admin, product, snapshot }) {
  if (!admin?.graphql) return [];
  const events = [];
  let cursor = null;

  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseDiagnosisSales($after: String, $query: String!, $ordersFirst: Int!, $lineItemsFirst: Int!) {
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
        after: cursor,
        query: `created_at:>=${getSinceDate(DIAGNOSIS_WINDOW_DAYS)}`,
        ordersFirst: DIAGNOSIS_ORDERS_PAGE_SIZE,
        lineItemsFirst: DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      getNodes(order.lineItems).forEach((lineItem) => {
        if (!lineItemMatchesProduct(lineItem, product, snapshot)) return;
        events.push({
          id: lineItem.id,
          orderId: order.id,
          createdAt: toIso(order.createdAt),
          quantity: Number(lineItem.quantity || 0),
          amount: Number(lineItem.originalTotalSet?.shopMoney?.amount || 0),
          title: lineItem.title || product.title,
          sku: lineItem.sku || lineItem.variant?.sku || "",
          variantId: lineItem.variant?.id || null,
          variantTitle: lineItem.variant?.title || "",
          selectedOptions: lineItem.variant?.selectedOptions || [],
        });
      });
    });

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return events;
}

async function fetchShopifyRefundEvents({ shop, jobId, admin, product, snapshot }) {
  for (const [index, queryPlan] of DIAGNOSIS_REFUND_QUERY_PLANS.entries()) {
    try {
      return await fetchShopifyRefundEventsWithPlan({ shop, jobId, admin, product, snapshot, queryPlan });
    } catch (error) {
      const nextPlan = DIAGNOSIS_REFUND_QUERY_PLANS[index + 1];
      if (!isShopifyQueryCostLimitError(error) || !nextPlan) throw error;
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.shopify_refund_query_cost_retried",
        message: `Shopify rejected the ${queryPlan.label} refund query cost; retrying with ${nextPlan.label} limits.`,
        data: {
          productGid: snapshot.productGid,
          failedPlan: queryPlan,
          nextPlan,
          error: serializeError(error),
        },
      });
    }
  }

  return [];
}

async function fetchShopifyRefundEventsWithPlan({ shop, jobId, admin, product, snapshot, queryPlan }) {
  if (!admin?.graphql) return [];
  const events = [];
  const seenRefundLineItemIds = new Set();
  const seenOrderLevelRefundLineItemIds = new Set();
  let cursor = null;
  const stats = {
    scannedRefunds: 0,
    scannedRefundLineItems: 0,
    matchedRefundLineItems: 0,
    scannedOrderLevelRefundLineItems: 0,
    matchedOrderLevelRefundLineItems: 0,
    matchedRefundLineItemsWithNotes: 0,
    matchedRefundLineItemsWithReasons: 0,
    matchedReasonSamples: [],
    matchedNoteSamples: [],
    unmatchedSamples: [],
    queryModes: [],
    queryPlan: queryPlan.label,
    queryLimits: {
      ordersFirst: queryPlan.ordersFirst,
      refundLineItemsFirst: queryPlan.refundLineItemsFirst,
      fallbackLineItemsFirst: queryPlan.fallbackLineItemsFirst,
      orderAdjustmentsFirst: queryPlan.orderAdjustmentsFirst,
      includeVariantProduct: queryPlan.includeVariantProduct,
      includeAdjustments: queryPlan.includeAdjustments,
    },
  };
  const orderQueries = buildRefundOrderQueries(DIAGNOSIS_WINDOW_DAYS);

  for (const orderQuery of orderQueries) {
    cursor = null;
    stats.queryModes.push(orderQuery.mode);

    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const variables = {
        after: cursor,
        query: orderQuery.query,
        ordersFirst: queryPlan.ordersFirst,
        refundLineItemsFirst: queryPlan.refundLineItemsFirst,
        fallbackLineItemsFirst: queryPlan.fallbackLineItemsFirst || DIAGNOSIS_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE,
      };
      if (queryPlan.includeAdjustments) variables.orderAdjustmentsFirst = queryPlan.orderAdjustmentsFirst || DIAGNOSIS_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE;

      const data = await shopifyGraphql(
        admin,
        buildDiagnosisRefundsQuery({
          includeVariantProduct: queryPlan.includeVariantProduct,
          includeAdjustments: queryPlan.includeAdjustments,
        }),
        variables,
      );

      getNodes(data?.orders).forEach((order) => {
        const refunds = order.refunds || [];
        refunds.forEach((refund) => {
          stats.scannedRefunds += 1;
          const adjustmentReasons = getRefundAdjustmentReasons(refund);
          const refundLineItems = getNodes(refund.refundLineItems);
          refundLineItems.forEach((refundLineItem) => {
            if (refundLineItem.id && seenRefundLineItemIds.has(refundLineItem.id)) return;
            if (refundLineItem.id) seenRefundLineItemIds.add(refundLineItem.id);
            stats.scannedRefundLineItems += 1;
            const lineItem = refundLineItem.lineItem || {};
            if (!lineItemMatchesProduct(lineItem, product, snapshot)) {
              if (stats.unmatchedSamples.length < 4) {
                stats.unmatchedSamples.push({
                  title: lineItem.title || "",
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  productId: lineItem.product?.id || lineItem.variant?.product?.id || "",
                  handle: lineItem.product?.handle || lineItem.variant?.product?.handle || "",
                  restockType: refundLineItem.restockType || "",
                  notePreview: truncateText(refund.note || "", 120),
                  queryMode: orderQuery.mode,
                });
              }
              return;
            }

            const noteText = getRefundNoteText({ note: refund.note });
            const reasonText = getRefundReasonText({
              note: refund.note,
              restockType: refundLineItem.restockType,
              adjustmentReasons,
            });
            if (noteText) {
              stats.matchedRefundLineItemsWithNotes += 1;
              if (stats.matchedNoteSamples.length < 5) {
                stats.matchedNoteSamples.push({
                  title: lineItem.title || product.title,
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  notePreview: truncateText(noteText, 180),
                  queryMode: orderQuery.mode,
                });
              }
            }
            if (reasonText) {
              stats.matchedRefundLineItemsWithReasons += 1;
              if (stats.matchedReasonSamples.length < 5) {
                stats.matchedReasonSamples.push({
                  title: lineItem.title || product.title,
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  reasonPreview: truncateText(reasonText, 180),
                  adjustmentReasons,
                  restockType: refundLineItem.restockType || "",
                  queryMode: orderQuery.mode,
                });
              }
            }

            stats.matchedRefundLineItems += 1;
            events.push({
              id: refundLineItem.id,
              refundId: refund.id,
              orderId: order.id,
              createdAt: toIso(refund.processedAt || refund.createdAt || order.createdAt),
              processedAt: toIso(refund.processedAt || refund.createdAt || order.createdAt),
              updatedAt: toIso(refund.updatedAt || refund.processedAt || refund.createdAt || order.createdAt),
              quantity: Number(refundLineItem.quantity || 0),
              amount: Number(refundLineItem.subtotalSet?.shopMoney?.amount || 0),
              totalRefundedAmount: Number(refund.totalRefundedSet?.shopMoney?.amount || 0),
              restockType: refundLineItem.restockType || "",
              adjustmentReasons,
              reason: reasonText,
              reasonLabel: reasonText || normalizeRefundReasonLabel(refundLineItem.restockType || ""),
              note: noteText,
              title: lineItem.title || product.title,
              sku: lineItem.sku || lineItem.variant?.sku || "",
              variantId: lineItem.variant?.id || null,
              variantTitle: lineItem.variant?.title || "",
              selectedOptions: lineItem.variant?.selectedOptions || [],
            });
          });

          if (!refundLineItems.length) {
            addDiagnosisOrderLevelRefundFallbackEvents({
              order,
              refund,
              adjustmentReasons,
              product,
              snapshot,
              orderQuery,
              seenOrderLevelRefundLineItemIds,
              stats,
              events,
            });
          }
        });

        if (!refunds.length) {
          addDiagnosisOrderLevelRefundFallbackEvents({
            order,
            refund: null,
            adjustmentReasons: [],
            product,
            snapshot,
            orderQuery,
            seenOrderLevelRefundLineItemIds,
            stats,
            events,
          });
        }
      });

      if (!data?.orders?.pageInfo?.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
  }

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_refunds_extracted",
    message: "Shopify refund line items were extracted for product diagnosis.",
    data: {
      productGid: snapshot.productGid,
      ...stats,
      refundEvents: events.length,
    },
  });

  return events;
}

function addDiagnosisOrderLevelRefundFallbackEvents({
  order,
  refund,
  adjustmentReasons = [],
  product,
  snapshot,
  orderQuery,
  seenOrderLevelRefundLineItemIds,
  stats,
  events,
}) {
  const lineItems = getNodes(order?.lineItems);
  if (!shouldUseDiagnosisOrderLevelRefundFallback(order, refund, lineItems)) return;

  const totalRefundedAmount = getDiagnosisOrderLevelRefundAmount(order, refund, lineItems);
  const context = {
    id: refund?.id || `order-refund:${order?.id || ""}`,
    createdAt: toIso(refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt),
    processedAt: toIso(refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt),
    updatedAt: toIso(refund?.updatedAt || refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt),
    orderId: order?.id,
    orderName: order?.name,
    displayFinancialStatus: order?.displayFinancialStatus,
    note: refund?.note || "",
    adjustmentReasons,
    totalRefundedAmount,
    lineItems,
  };

  lineItems.forEach((lineItem) => {
    stats.scannedOrderLevelRefundLineItems += 1;
    const fallbackKey = [order?.id, refund?.id || "order-level", lineItem?.id].filter(Boolean).join(":");
    if (!fallbackKey || seenOrderLevelRefundLineItemIds.has(fallbackKey)) return;

    if (!lineItemMatchesProduct(lineItem, product, snapshot)) {
      if (stats.unmatchedSamples.length < 4) {
        stats.unmatchedSamples.push({
          title: lineItem.title || "",
          sku: lineItem.sku || lineItem.variant?.sku || "",
          productId: lineItem.product?.id || lineItem.variant?.product?.id || "",
          handle: lineItem.product?.handle || lineItem.variant?.product?.handle || "",
          restockType: "order-level-refund",
          notePreview: truncateText(refund?.note || order?.displayFinancialStatus || "", 120),
          queryMode: orderQuery.mode,
        });
      }
      return;
    }

    seenOrderLevelRefundLineItemIds.add(fallbackKey);
    const event = normalizeDiagnosisOrderLevelRefundLineItemEvent(lineItem, context, product);
    const noteText = getRefundNoteText(event);
    const reasonText = getRefundReasonText(event);
    stats.matchedOrderLevelRefundLineItems += 1;
    if (noteText) {
      stats.matchedRefundLineItemsWithNotes += 1;
      if (stats.matchedNoteSamples.length < 5) {
        stats.matchedNoteSamples.push({
          title: lineItem.title || product.title,
          sku: lineItem.sku || lineItem.variant?.sku || "",
          notePreview: truncateText(noteText, 180),
          queryMode: orderQuery.mode,
          fallbackSource: event.fallbackSource,
        });
      }
    }
    if (reasonText) {
      stats.matchedRefundLineItemsWithReasons += 1;
      if (stats.matchedReasonSamples.length < 5) {
        stats.matchedReasonSamples.push({
          title: lineItem.title || product.title,
          sku: lineItem.sku || lineItem.variant?.sku || "",
          reasonPreview: truncateText(reasonText, 180),
          adjustmentReasons,
          restockType: event.restockType || "",
          queryMode: orderQuery.mode,
          fallbackSource: event.fallbackSource,
        });
      }
    }
    events.push(event);
  });
}

function normalizeDiagnosisOrderLevelRefundLineItemEvent(lineItem, refund, product) {
  const amount = calculateDiagnosisFallbackRefundLineAmount(lineItem, refund);
  const reason = getDiagnosisOrderLevelRefundReasonText(refund);

  return {
    id: `order-level-refund:${refund?.orderId || ""}:${refund?.id || ""}:${lineItem?.id || ""}`,
    refundId: refund?.id || null,
    orderId: refund?.orderId || null,
    orderName: refund?.orderName || "",
    createdAt: refund?.createdAt,
    processedAt: refund?.processedAt || refund?.createdAt,
    updatedAt: refund?.updatedAt || refund?.createdAt,
    quantity: calculateDiagnosisFallbackRefundQuantity(lineItem, amount),
    amount,
    totalRefundedAmount: refund?.totalRefundedAmount || amount,
    restockType: "ORDER_LEVEL_REFUND",
    adjustmentReasons: refund?.adjustmentReasons || [],
    reason,
    reasonLabel: reason,
    note: getRefundNoteText(refund),
    title: lineItem.title || product?.title || "",
    sku: lineItem.sku || lineItem.variant?.sku || "",
    variantId: lineItem.variant?.id || null,
    variantTitle: lineItem.variant?.title || "",
    selectedOptions: lineItem.variant?.selectedOptions || [],
    fallbackSource: "order_financial_status",
  };
}

function shouldUseDiagnosisOrderLevelRefundFallback(order, refund, lineItems = []) {
  const status = String(order?.displayFinancialStatus || "").toUpperCase();
  const hasRefundSignal = status.includes("REFUND")
    || getShopMoneyAmount(order?.totalRefundedSet) > 0
    || getShopMoneyAmount(refund?.totalRefundedSet) > 0;
  if (!hasRefundSignal || !lineItems.length) return false;
  if (status === "REFUNDED") return true;
  if (status === "PARTIALLY_REFUNDED") return lineItems.length === 1;
  return lineItems.length === 1;
}

function getDiagnosisOrderLevelRefundAmount(order, refund, lineItems = []) {
  const refundAmount = getShopMoneyAmount(refund?.totalRefundedSet);
  if (refundAmount > 0) return refundAmount;
  const orderRefundedAmount = getShopMoneyAmount(order?.totalRefundedSet);
  if (orderRefundedAmount > 0) return orderRefundedAmount;
  return lineItems.reduce((total, lineItem) => total + getShopMoneyAmount(lineItem.originalTotalSet), 0);
}

function calculateDiagnosisFallbackRefundLineAmount(lineItem, refund) {
  const lineItems = refund?.lineItems || [];
  const totalRefundedAmount = Number(refund?.totalRefundedAmount || 0);
  const lineAmount = getShopMoneyAmount(lineItem.originalTotalSet);
  if (!totalRefundedAmount) return roundCurrency(lineAmount);

  const lineItemsAmount = lineItems.reduce((total, item) => total + getShopMoneyAmount(item.originalTotalSet), 0);
  if (lineItemsAmount > 0 && lineAmount > 0) {
    return roundCurrency((totalRefundedAmount * lineAmount) / lineItemsAmount);
  }

  const lineItemCount = Math.max(lineItems.length, 1);
  return roundCurrency(totalRefundedAmount / lineItemCount);
}

function calculateDiagnosisFallbackRefundQuantity(lineItem, amount) {
  const quantity = Math.max(Number(lineItem.quantity || 0), 0);
  if (quantity <= 1) return quantity || 1;
  const lineAmount = getShopMoneyAmount(lineItem.originalTotalSet);
  if (!lineAmount || amount >= lineAmount) return quantity;
  return Math.max(1, Math.min(quantity, Math.round(quantity * (amount / lineAmount))));
}

function getDiagnosisOrderLevelRefundReasonText(refund = {}) {
  const reason = getRefundReasonText({
    adjustmentReasons: refund.adjustmentReasons,
  });
  if (reason) return reason;
  const status = normalizeRefundReasonLabel(refund.displayFinancialStatus || "");
  return status || "Order-level refund";
}

function getShopMoneyAmount(moneyBag) {
  return Number(moneyBag?.shopMoney?.amount || 0) || 0;
}

function buildDiagnosisRefundsQuery({ includeVariantProduct = true, includeAdjustments = true } = {}) {
  return `#graphql
      query ProductPulseDiagnosisRefunds(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $fallbackLineItemsFirst: Int!,
        $refundLineItemsFirst: Int!${includeAdjustments ? `,
        $orderAdjustmentsFirst: Int!` : ""}
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
                  ${includeVariantProduct ? `
                  product {
                    id
                    legacyResourceId
                    handle
                    title
                  }` : ""}
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
              ${includeAdjustments ? `
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
              }` : ""}
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
                      ${includeVariantProduct ? `
                      product {
                        id
                        legacyResourceId
                        handle
                        title
                      }` : ""}
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

async function fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot }) {
  try {
    return await fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition: true });
  } catch (error) {
    if (!isMissingReturnReasonDefinitionError(error)) throw error;
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_diagnosis.return_reason_definition_unavailable",
      message: "Shopify API version did not expose returnReasonDefinition; retrying return extraction with legacy returnReason fields.",
      data: { error: serializeError(error), productGid: snapshot.productGid },
    });
    return fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition: false });
  }
}

async function fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition }) {
  for (const [index, queryPlan] of DIAGNOSIS_RETURN_QUERY_PLANS.entries()) {
    try {
      return await fetchShopifyReturnEventsWithPlan({ shop, jobId, admin, product, snapshot, includeReasonDefinition, queryPlan });
    } catch (error) {
      const nextPlan = DIAGNOSIS_RETURN_QUERY_PLANS[index + 1];
      if (!isShopifyQueryCostLimitError(error) || !nextPlan) throw error;
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.shopify_return_query_cost_retried",
        message: `Shopify rejected the ${queryPlan.label} return query cost; retrying with ${nextPlan.label} limits.`,
        data: {
          productGid: snapshot.productGid,
          failedPlan: queryPlan,
          nextPlan,
          error: serializeError(error),
        },
      });
    }
  }

  return [];
}

async function fetchShopifyReturnEventsWithPlan({ shop, jobId, admin, product, snapshot, includeReasonDefinition, queryPlan }) {
  if (!admin?.graphql) return [];
  const events = [];
  let cursor = null;
  const stats = {
    scannedReturnLineItems: 0,
    matchedReturnLineItems: 0,
    matchedReturnLineItemsWithNotes: 0,
    matchedNoteSamples: [],
    queryModes: [],
    unmatchedSamples: [],
    includeReasonDefinition,
    queryPlan: queryPlan.label,
    queryLimits: {
      ordersFirst: queryPlan.ordersFirst,
      returnsFirst: queryPlan.returnsFirst,
      returnLineItemsFirst: queryPlan.returnLineItemsFirst,
      includeVariantProduct: queryPlan.includeVariantProduct,
    },
  };
  const seenReturnLineItemIds = new Set();
  const orderQueries = buildReturnOrderQueries(DIAGNOSIS_WINDOW_DAYS);

  for (const orderQuery of orderQueries) {
    cursor = null;
    stats.queryModes.push(orderQuery.mode);

    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const data = await shopifyGraphql(
        admin,
        buildDiagnosisReturnsQuery({ includeReasonDefinition, includeVariantProduct: queryPlan.includeVariantProduct }),
        {
          after: cursor,
          query: orderQuery.query,
          ordersFirst: queryPlan.ordersFirst,
          returnsFirst: queryPlan.returnsFirst,
          returnLineItemsFirst: queryPlan.returnLineItemsFirst,
        },
      );

      getNodes(data?.orders).forEach((order) => {
        getNodes(order.returns).forEach((itemReturn) => {
          getNodes(itemReturn.returnLineItems).forEach((returnLineItem) => {
            if (returnLineItem.id && seenReturnLineItemIds.has(returnLineItem.id)) return;
            if (returnLineItem.id) seenReturnLineItemIds.add(returnLineItem.id);
            stats.scannedReturnLineItems += 1;
            const lineItem = returnLineItem.fulfillmentLineItem?.lineItem || {};
            if (!lineItemMatchesProduct(lineItem, product, snapshot)) {
              if (stats.unmatchedSamples.length < 4) {
                stats.unmatchedSamples.push({
                  title: lineItem.title || "",
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  productId: lineItem.product?.id || "",
                  handle: lineItem.product?.handle || "",
                  reason: getReturnReasonValue(returnLineItem),
                  notePreview: truncateText(getReturnLineItemNoteText(returnLineItem), 120),
                  queryMode: orderQuery.mode,
                });
              }
              return;
            }

            stats.matchedReturnLineItems += 1;
            const reasonNote = getReturnLineItemReasonNote(returnLineItem);
            const customerNote = getReturnLineItemCustomerNote(returnLineItem);
            if (reasonNote || customerNote) {
              stats.matchedReturnLineItemsWithNotes += 1;
              if (stats.matchedNoteSamples.length < 5) {
                stats.matchedNoteSamples.push({
                  title: lineItem.title || product.title,
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  reason: getReturnReasonValue(returnLineItem),
                  reasonLabel: getReturnReasonLabel(returnLineItem),
                  reasonNote: truncateText(reasonNote, 160),
                  customerNote: truncateText(customerNote, 160),
                  notePreview: truncateText(getReturnLineItemNoteText(returnLineItem), 220),
                  queryMode: orderQuery.mode,
                });
              }
            }

            events.push({
              id: returnLineItem.id,
              returnId: itemReturn.id,
              orderId: order.id,
              createdAt: toIso(itemReturn.createdAt || order.createdAt),
              status: itemReturn.status || "",
              quantity: Number(returnLineItem.quantity || returnLineItem.processedQuantity || returnLineItem.refundedQuantity || 0),
              processedQuantity: Number(returnLineItem.processedQuantity || 0),
              refundedQuantity: Number(returnLineItem.refundedQuantity || 0),
              reason: getReturnReasonValue(returnLineItem),
              reasonLabel: getReturnReasonLabel(returnLineItem),
              reasonNote,
              customerNote,
              title: lineItem.title || product.title,
              sku: lineItem.sku || lineItem.variant?.sku || "",
              variantId: lineItem.variant?.id || null,
              variantTitle: lineItem.variant?.title || "",
              selectedOptions: lineItem.variant?.selectedOptions || [],
            });
          });
        });
      });

      if (!data?.orders?.pageInfo?.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
  }

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_returns_extracted",
    message: "Shopify return line items were extracted for product diagnosis.",
    data: {
      productGid: snapshot.productGid,
      ...stats,
      returnEvents: events.length,
    },
  });

  return events;
}

function buildDiagnosisReturnsQuery({ includeReasonDefinition = true, includeVariantProduct = true } = {}) {
  return `#graphql
      query ProductPulseDiagnosisReturns(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $returnsFirst: Int!,
        $returnLineItemsFirst: Int!
      ) {
        orders(first: $ordersFirst, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
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
                      ${includeReasonDefinition ? `
                      returnReasonDefinition {
                        handle
                        name
                      }` : ""}
                      fulfillmentLineItem {
                        lineItem {
                          id
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
                            ${includeVariantProduct ? `
                            product {
                              id
                              legacyResourceId
                              handle
                              title
                            }` : ""}
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

function buildReturnOrderQueries(windowDays) {
  return [
    { mode: "updated_at", query: `updated_at:>=${getSinceDate(windowDays)}` },
    { mode: "return_requested", query: "return_status:return_requested" },
    { mode: "in_progress", query: "return_status:in_progress" },
    { mode: "inspection_complete", query: "return_status:inspection_complete" },
    { mode: "returned", query: "return_status:returned" },
  ];
}

async function fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "judgemeReviews" } },
  }).catch(() => null);

  const token = String(source?.credentials?.privateApiToken || "").trim();
  if (!source?.connected || !source.active || !token) {
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.judgeme_skipped",
      message: "Judge.me is not connected or active; diagnosis will continue without review evidence.",
      data: { connected: Boolean(source?.connected), active: Boolean(source?.active) },
    });
    return { connected: false, internalProductId: null, reviews: [], matchConfidence: 0, errors: [] };
  }

  const errors = [];
  const internalProduct = await resolveJudgeMeProduct({ shop, token, snapshot, shopifyProduct }).catch((error) => {
    errors.push(serializeError(error));
    return null;
  });
  let reviews = [];
  let matchConfidence = internalProduct?.matchConfidence || 0;

  if (internalProduct?.id) {
    reviews = await fetchJudgeMeReviewsByProductId({ shop, token, productId: internalProduct.id }).catch((error) => {
      errors.push(serializeError(error));
      return [];
    });
  }

  if (!reviews.length) {
    const fallback = await fetchAndMatchJudgeMeReviews({ shop, token, snapshot, shopifyProduct }).catch((error) => {
      errors.push(serializeError(error));
      return { reviews: [], matchConfidence: 0 };
    });
    reviews = fallback.reviews;
    matchConfidence = Math.max(matchConfidence, fallback.matchConfidence);
  }

  const normalizedReviews = reviews.map((review) => normalizeJudgeMeReview(review, snapshot, shopifyProduct)).filter(Boolean);
  if (normalizedReviews.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "judgemeReviews" } },
      data: { health: "connected", lastSyncedAt: new Date() },
    }).catch(() => {});
  } else if (errors.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "judgemeReviews" } },
      data: { health: "error" },
    }).catch(() => {});
  }

  await recordJobLog({
    shop,
    jobId,
    level: errors.length && !normalizedReviews.length ? "warn" : "info",
    event: "product_diagnosis.judgeme_extracted",
    message: "Judge.me product review extraction finished.",
    data: {
      internalProductId: internalProduct?.id || null,
      reviews: normalizedReviews.length,
      matchConfidence,
      errors,
    },
  });

  return {
    connected: true,
    internalProductId: internalProduct?.id || null,
    reviews: normalizedReviews,
    matchConfidence,
    errors,
  };
}

async function fetchCsvReviewDiagnosisData({ shop, jobId, snapshot, shopifyProduct }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  }).catch(() => null);

  if (!source?.connected || !source.active || !source.config?.normalizedFilePath) {
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.csv_reviews_skipped",
      message: "CSV reviews are not connected or active; diagnosis will continue without imported review evidence.",
      data: { connected: Boolean(source?.connected), active: Boolean(source?.active) },
    });
    return { connected: false, reviews: [], matchConfidence: 0, errors: [] };
  }

  const errors = [];
  const rows = await getNormalizedCsvReviewsForShop(shop).catch((error) => {
    errors.push(serializeError(error));
    return [];
  });
  const matched = rows
    .map((row) => ({
      row,
      confidence: getCsvReviewMatchConfidence(row, snapshot, shopifyProduct),
    }))
    .filter((item) => item.confidence >= 0.75);
  const reviews = matched
    .map((item) => normalizeCsvDiagnosisReview(item.row, snapshot, shopifyProduct, item.confidence))
    .filter(Boolean);
  const matchConfidence = matched.length ? Math.max(...matched.map((item) => item.confidence)) : 0;

  if (reviews.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
      data: { health: "connected", lastSyncedAt: new Date() },
    }).catch(() => {});
  } else if (errors.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
      data: { health: "error" },
    }).catch(() => {});
  }

  await recordJobLog({
    shop,
    jobId,
    level: errors.length && !reviews.length ? "warn" : "info",
    event: "product_diagnosis.csv_reviews_extracted",
    message: "CSV review extraction finished for this product.",
    data: {
      rows: rows.length,
      matchedReviews: reviews.length,
      matchConfidence,
      usage: "ratings, text and dates are included as imported review evidence",
      errors,
    },
  });

  return {
    connected: true,
    reviews,
    matchConfidence,
    errors,
  };
}

async function resolveJudgeMeProduct({ shop, token, snapshot, shopifyProduct }) {
  const numericProductId = shopifyProduct.numericId || extractNumericShopifyId(snapshot.productGid);
  const attempts = [
    numericProductId ? { external_id: numericProductId } : null,
    snapshot.handle ? { handle: snapshot.handle } : null,
    shopifyProduct.handle && shopifyProduct.handle !== snapshot.handle ? { handle: shopifyProduct.handle } : null,
  ].filter(Boolean);

  for (const params of attempts) {
    for (const baseUrl of JUDGEME_BASE_URLS) {
      const json = await judgeMeGet({ baseUrl, path: "/products/-1", shop, token, params }).catch(() => null);
      const product = extractJudgeMeProduct(json);
      if (product?.id) {
        return {
          id: product.id,
          raw: product,
          matchConfidence: params.external_id ? 1 : 0.85,
        };
      }
    }
  }

  return null;
}

async function fetchJudgeMeReviewsByProductId({ shop, token, productId }) {
  const reviews = [];

  for (let page = 1; page <= MAX_JUDGEME_REVIEW_PAGES; page += 1) {
    let pageReviews = [];
    for (const baseUrl of JUDGEME_BASE_URLS) {
      const json = await judgeMeGet({
        baseUrl,
        path: "/reviews",
        shop,
        token,
        params: { product_id: productId, published: true, page, per_page: 100 },
      }).catch(() => null);
      pageReviews = extractJudgeMeReviews(json);
      if (pageReviews.length) break;
    }
    reviews.push(...pageReviews);
    if (pageReviews.length < 100) break;
  }

  return reviews;
}

async function fetchAndMatchJudgeMeReviews({ shop, token, snapshot, shopifyProduct }) {
  const allReviews = [];

  for (let page = 1; page <= MAX_JUDGEME_SYNC_PAGES; page += 1) {
    let pageReviews = [];
    for (const baseUrl of JUDGEME_BASE_URLS) {
      const json = await judgeMeGet({
        baseUrl,
        path: "/reviews",
        shop,
        token,
        params: { published: true, page, per_page: 100 },
      }).catch(() => null);
      pageReviews = extractJudgeMeReviews(json);
      if (pageReviews.length) break;
    }
    allReviews.push(...pageReviews);
    if (pageReviews.length < 100) break;
  }

  const matched = allReviews
    .map((review) => ({ review, confidence: getJudgeMeReviewMatchConfidence(review, snapshot, shopifyProduct) }))
    .filter((item) => item.confidence >= 0.75);

  return {
    reviews: matched.map((item) => item.review),
    matchConfidence: matched.length ? Math.max(...matched.map((item) => item.confidence)) : 0,
  };
}

function calculateDeterministicDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData = { connected: false, reviews: [], matchConfidence: 0 } }) {
  const snapshotMetrics = snapshot.metrics || {};
  const product = shopifyData.product;
  const sales = shopifyData.sales || [];
  const refunds = shopifyData.refunds || [];
  const returns = shopifyData.returns || [];
  const judgeMeReviews = (judgeMeData.reviews || []).map((review) => normalizeReviewSource(review, "judgeme_review", "Judge.me reviews"));
  const csvReviews = (csvReviewData.reviews || []).map((review) => normalizeReviewSource(review, "csv_review", "CSV reviews"));
  const reviews = [...judgeMeReviews, ...csvReviews];
  const soldUnits = preferFreshNumber(sumBy(sales, "quantity"), snapshotMetrics.soldUnits);
  const salesAmount = roundCurrency(preferFreshNumber(sumBy(sales, "amount"), snapshotMetrics.salesAmount));
  const returnUnits = preferFreshNumber(sumBy(returns, "quantity"), snapshotMetrics.returnUnits);
  const refundUnits = preferFreshNumber(sumBy(refunds, "quantity"), snapshotMetrics.refundUnits);
  const refundAmount = roundCurrency(preferFreshNumber(sumBy(refunds, "amount"), snapshotMetrics.refundAmount));
  const returnRate = roundRate(soldUnits > 0 ? (returnUnits / soldUnits) * 100 : snapshotMetrics.returnRate);
  const refundRate = roundRate(soldUnits > 0 ? (refundUnits / soldUnits) * 100 : snapshotMetrics.refundRate);
  const reviewCount = reviews.length;
  const avgRating = roundRate(reviewCount ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviewCount : 0, 1);
  const negativeReviews = reviews.filter((review) => Number(review.rating || 0) <= 2 || containsIssueLanguage(review.body));
  const negativeReviewCount = negativeReviews.length;
  const negativeReviewRate = roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0);
  const recentNegativeReviewCount = negativeReviews.filter((review) => isRecentDate(review.createdAt, 30)).length;
  const topReturnReasons = countTopValues(returns.flatMap((item) => [item.reason, item.reasonNote, item.customerNote]).filter(Boolean), 4);
  const topRefundReasons = countTopValues(refunds.flatMap((item) => [
    item.reason,
    item.reasonLabel,
    ...(Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : []),
    normalizeRefundReasonLabel(item.restockType),
  ]).filter((value) => value && !isDefaultCustomerLanguageTerm(value)), 4);
  const affectedVariants = countTopValues([...returns, ...refunds].map((item) => item.variantTitle || item.sku).filter(Boolean), 4);
  const deterministicContent = analyzeProductContentDeterministically(product);
  const textInsights = buildCustomerTextInsights({ returns, reviews });
  const refundInsights = buildRefundOperationalInsights({ refunds, refundRate, soldUnits, refundUnits, refundAmount });
  const reviewSourceStats = buildReviewSourceStats(reviews);
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount });
  const signalEvents = buildSignalEvents({ returns, refunds, negativeReviews });
  const trendOptions = {
    startAt: getSinceDate(DIAGNOSIS_WINDOW_DAYS),
    endAt: new Date().toISOString(),
  };
  const signalTrendResult = buildDatedSignalTrend(signalEvents, trendOptions);
  const signalTrend = signalTrendResult.values;
  const issueSignalTrends = buildIssueTrendMap(signalEvents, trendOptions);
  const issueSignalCounts = buildIssueSignalCounts({ returns, refunds, reviews: negativeReviews });
  applyRefundInsightsToIssueCounts(issueSignalCounts, refundInsights);
  const customerIssueSignalTotal = Object.values(issueSignalCounts).reduce((total, count) => total + count, 0);
  deterministicContent.issues.forEach((issue) => {
    issueSignalCounts[issue.issueCode] = (issueSignalCounts[issue.issueCode] || 0) + 1;
  });
  const mainIssue = getMainIssueFromCounts(issueSignalCounts, snapshot.primaryIssue);
  const faqNeed = analyzeFaqOpportunity({
    mainIssue,
    issueSignalCounts,
    product,
    contentAnalysis: deterministicContent,
    textInsights,
    topReturnReasons,
    affectedVariants,
    reviewCount,
    negativeReviewCount,
    returnUnits,
    refundUnits,
  });
  const customerSignalCount = Math.max(
    returnUnits + refundUnits + negativeReviewCount,
    Number(snapshotMetrics.signalCount || 0),
    customerIssueSignalTotal,
  );
  const signalCount = customerSignalCount + deterministicContent.issues.length;
  const scoringMetrics = {
    soldUnits,
    salesAmount,
    returnUnits,
    refundUnits,
    refundAmount,
    returnRate,
    refundRate,
    reviewCount,
    avgRating,
    negativeReviewCount,
    negativeReviewRate,
    recentNegativeReviewCount,
    signalCount,
    customerSignalCount,
    contentIssueCount: deterministicContent.issues.length,
    contentQualityRisk: deterministicContent.riskLift,
    textInsights,
    refundInsights,
    sourceCoverage,
    signalEvents,
    affectedVariants,
    reviewSourceStats,
  };
  const sourceAgreement = hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount, reviewSourceStats });
  const scoreModel = calculateProductScoreModel({
    ...scoringMetrics,
    salesAmount,
    storeReturnBaseline: snapshotMetrics.storeAvgReturnRate,
    storeRefundBaseline: snapshotMetrics.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshotMetrics.storeAvgNegativeReviewRate || snapshotMetrics.csvNegativeRatingRate,
    sentimentTotal: textInsights?.sentiment?.total || 0,
    sentimentNegativeCount: textInsights?.sentiment?.negative || 0,
    subjectiveNegativeCount: textInsights?.subjectiveNegativity?.count || 0,
    subjectiveNegativeRatio: textInsights?.subjectiveNegativity?.ratio || 0,
    variantCount: product.variants?.length || Number(snapshotMetrics.variantCount || 0),
    affectedVariantCount: affectedVariants.length,
    affectedVariantSignalCount: affectedVariants.reduce((sum, variant) => sum + Number(variant.count || 0), 0),
    strongestVariantSignalCount: affectedVariants[0]?.count || 0,
    recentSignalUnits: countRecentSignalEvents(signalEvents, 30),
    signalEventCount: customerSignalCount,
    effectiveSampleSize: returnUnits + refundUnits + reviewCount + deterministicContent.issues.length,
    sourceCoverage,
    sourceAgreement,
    productMatchConfidence: Math.max(judgeMeData.matchConfidence || 0, csvReviewData.matchConfidence || 0, reviews.length ? 0 : 1),
    orderAccessDenied: shopifyData.orderAccessDenied,
    missingOrders: shopifyData.orderAccessDenied,
    dataQualityIncomplete: shopifyData.orderAccessDenied,
    subjectiveOnlyIssue: mainIssue === "subjective_negative_reaction" && !returnUnits && !refundUnits && negativeReviewCount <= 2,
    calculationState: "calculated_from_persisted_components",
    windowDays: DIAGNOSIS_WINDOW_DAYS,
  }, { sentimentSharesReviewSource: !(returnUnits || refundUnits) });
  const riskComponents = scoreModel.riskComponents;
  const riskScore = scoreModel.riskScore;
  const confidence = scoreModel.confidenceScore;
  const estimatedImpact = scoreModel.impactFactors;
  const riskTrend = buildRiskTrendFromSignalTrend(signalTrend, riskScore, snapshotMetrics.riskTrend);
  const evidenceSnippets = buildEvidenceSnippets({ returns, refunds, reviews: negativeReviews, product });

  return {
    product,
    metrics: {
      returnRate,
      refundRate,
      reviewRating: avgRating,
      avgRating,
      issueCount: signalCount,
      customerSignalCount,
      contentIssueCount: deterministicContent.issues.length,
      contentAdvisoryCount: deterministicContent.advisories.length,
      contentQualityScore: deterministicContent.score,
      contentQualityRisk: deterministicContent.riskLift,
      riskComponents,
      confidenceFactors: scoreModel.confidenceFactors,
      contentIssues: deterministicContent.issues,
      contentAdvisories: deterministicContent.advisories,
      faqNeed,
      textInsights,
      descriptionLength: deterministicContent.descriptionLength,
      descriptionWordCount: deterministicContent.descriptionWordCount,
      hasDescription: deterministicContent.hasDescription,
      titleNeedsReview: deterministicContent.titleNeedsReview,
      variantNamingAdvisory: deterministicContent.variantNamingAdvisory,
      mediaCount: deterministicContent.mediaCount,
      mediaWithoutAltCount: deterministicContent.mediaWithoutAltCount,
      revenueAtRisk: estimatedImpact.revenueAtRisk,
      marginAtRisk: estimatedImpact.marginAtRisk,
      estimatedImpact: estimatedImpact.estimatedImpact,
      impactRange: {
        low: estimatedImpact.impactLow,
        mid: estimatedImpact.impactMid,
        high: estimatedImpact.impactHigh,
      },
      impactFactors: estimatedImpact,
      priorityScore: scoreModel.priorityScore,
      evidenceStrengthScore: scoreModel.evidenceStrengthScore,
      scoreCalculationStatus: "Score calculated from persisted components",
      signalCount,
      salesAmount,
      avgUnitRevenue: estimatedImpact.avgUnitRevenue,
      refundAmount,
      refundInsights,
      returnUnits,
      refundUnits,
      soldUnits,
      recentSignalUnits: countRecentSignalEvents(signalEvents, 30),
      windowDays: DIAGNOSIS_WINDOW_DAYS,
      storeAvgReturnRate: Number(snapshotMetrics.storeAvgReturnRate || 0),
      storeAvgRefundRate: Number(snapshotMetrics.storeAvgRefundRate || 0),
      lastSignalAt: getLatestEventDate(signalEvents),
      signalTrend,
      riskTrend,
      trendMeta: signalTrendResult.meta,
      issueSignalTrends,
      productType: product.productType || snapshotMetrics.productType || "",
      vendor: product.vendor || snapshotMetrics.vendor || "",
      tags: product.tags || [],
      collections: product.collections || [],
      variantCount: product.variants?.length || Number(snapshotMetrics.variantCount || 0),
      skuCount: (product.variants || []).filter((variant) => variant.sku).length,
      optionNames: (product.options || []).map((option) => option.name).filter(Boolean),
      variants: (product.variants || []).map((variant) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        inventoryQuantity: variant.inventoryQuantity,
        inventoryPolicy: variant.inventoryPolicy,
        inventoryItemId: variant.inventoryItemId,
        inventoryTracked: variant.inventoryTracked,
        selectedOptions: variant.selectedOptions,
      })),
      media: (product.media || []).map((media) => ({
        id: media.id,
        alt: media.alt,
        mediaContentType: media.mediaContentType,
        status: media.status,
        width: media.width,
        height: media.height,
      })),
      topReturnReasons: topReturnReasons.map((item) => item.label),
      topReturnReasonDetails: topReturnReasons,
      topRefundReasons: topRefundReasons.map((item) => item.label),
      topRefundReasonDetails: topRefundReasons,
      affectedVariants: affectedVariants.map((item) => item.label),
      affectedVariantDetails: affectedVariants,
      reviewCount,
      negativeReviewCount,
      negativeReviewRate,
      recentNegativeReviewCount,
      judgeMeReviewCount: reviewSourceStats.judgeMe.reviewCount,
      judgeMeNegativeReviewCount: reviewSourceStats.judgeMe.negativeReviewCount,
      judgeMeAverageRating: reviewSourceStats.judgeMe.avgRating,
      csvReviewCount: reviewSourceStats.csv.reviewCount,
      csvNegativeReviewCount: reviewSourceStats.csv.negativeReviewCount,
      csvAverageRating: reviewSourceStats.csv.avgRating,
      reviewSourceStats,
      judgeMeInternalProductId: judgeMeData.internalProductId,
      judgeMeMatchConfidence: judgeMeData.matchConfidence,
      csvReviewMatchConfidence: csvReviewData.matchConfidence,
      orderAccessDenied: shopifyData.orderAccessDenied,
      sourceCoverage,
    },
    issueSignalCounts,
    evidenceSnippets,
    sourceCoverage,
    mainIssue,
    mainIssueLabel: getHumanIssueLabel(mainIssue),
    riskScore,
    confidence,
    estimatedImpact,
    sourceAgreement: hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount, reviewSourceStats }),
  };
}

function buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData, deterministic, ai }) {
  const contentAnalysis = buildContentAnalysis(deterministic, ai.contentGaps);
  const emergentSentiments = normalizeAiEmergentSentiments(ai);
  const knownEmotions = normalizeAiKnownEmotions(ai, deterministic.metrics.textInsights);
  const adjustedRiskComponents = adjustRiskComponentsForContentAnalysis(deterministic.metrics.riskComponents, contentAnalysis);
  const adjustedRiskScore = adjustedRiskComponents.riskScore;
  const scoredDeterministic = {
    ...deterministic,
    riskScore: adjustedRiskScore,
    metrics: {
      ...deterministic.metrics,
      textInsights: {
        ...(deterministic.metrics.textInsights || {}),
        aiKnownEmotions: knownEmotions,
        aiEmergentSentiments: emergentSentiments,
      },
      contentAnalysis,
      contentQualityScore: contentAnalysis.score,
      contentQualityRisk: contentAnalysis.riskLift,
      contentIssueCount: contentAnalysis.issues.length,
      contentIssues: contentAnalysis.issues,
      contentAdvisoryCount: contentAnalysis.advisories.length,
      contentAdvisories: contentAnalysis.advisories,
      signalCount: deterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      issueCount: deterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      riskComponents: adjustedRiskComponents,
      riskTrend: buildRiskTrendFromSignalTrend(deterministic.metrics.signalTrend, adjustedRiskScore, deterministic.metrics.riskTrend),
    },
  };
  contentAnalysis.issues.forEach((issue) => {
    scoredDeterministic.issueSignalCounts[issue.issueCode] = Math.max(scoredDeterministic.issueSignalCounts[issue.issueCode] || 0, 1);
  });

  const aiMainIssue = normalizeIssueCode(ai.classification?.main_issue) || scoredDeterministic.mainIssue;
  const contentShouldLead = contentAnalysis.issues.some((issue) => issue.severity === "high") && scoredDeterministic.metrics.customerSignalCount <= 1;
  const mainIssue = contentShouldLead
    ? "product_content"
    : scoredDeterministic.issueSignalCounts[aiMainIssue] ? aiMainIssue : scoredDeterministic.mainIssue;
  scoredDeterministic.metrics.faqNeed = analyzeFaqOpportunity({
    mainIssue,
    issueSignalCounts: scoredDeterministic.issueSignalCounts,
    product: scoredDeterministic.product,
    contentAnalysis,
    textInsights: scoredDeterministic.metrics.textInsights,
    topReturnReasons: scoredDeterministic.metrics.topReturnReasonDetails,
    affectedVariants: scoredDeterministic.metrics.affectedVariantDetails,
    reviewCount: scoredDeterministic.metrics.reviewCount,
    negativeReviewCount: scoredDeterministic.metrics.negativeReviewCount,
    returnUnits: scoredDeterministic.metrics.returnUnits,
    refundUnits: scoredDeterministic.metrics.refundUnits,
  });
  const issueLabel = ai.classification?.main_issue_label || getHumanIssueLabel(mainIssue);
  const mainFinding = {
    title: ai.report?.main_finding_title || `${issueLabel} signals need review`,
    detail: buildMainFindingDetail(ai.report?.main_finding_detail, scoredDeterministic, contentAnalysis),
    summary: ai.report?.evidence_summary || buildEvidenceSummary(scoredDeterministic),
  };
  const adjustedMainFinding = adjustMainFindingForSignalStrength(mainFinding, scoredDeterministic);
  const recommendations = buildFinalRecommendations({ snapshot, deterministic: scoredDeterministic, ai, mainIssue });
  const issues = buildFinalIssues({ deterministic: scoredDeterministic, ai, mainIssue, recommendations });
  const evidence = buildFinalEvidence({ deterministic: scoredDeterministic, ai, judgeMeData, csvReviewData, shopifyData });
  const metrics = {
    ...scoredDeterministic.metrics,
    diagnosisReport: {
      mainFinding: adjustedMainFinding,
      evidenceSummary: adjustedMainFinding.summary,
      issueNames: Array.isArray(ai.report?.issue_names) ? ai.report.issue_names.slice(0, 8) : [],
      aiModels: ai.modelsUsed,
      knownEmotions,
      emergentSentiments,
      checkedSources: buildCheckedSources(deterministic),
    },
  };

  return jsonSafe({
    productGid: snapshot.productGid,
    productTitle: snapshot.productTitle,
    riskScore: scoredDeterministic.riskScore,
    impactScore: Math.min(100, Math.round((scoredDeterministic.estimatedImpact.revenueAtRisk || 0) / 100)),
    confidence: scoredDeterministic.confidence,
    likelyCause: issueLabel,
    mainIssue,
    issues,
    evidence,
    recommendations,
    sourceCoverage: scoredDeterministic.sourceCoverage,
    metrics,
    mainFinding: adjustedMainFinding,
  });
}

async function persistDetailedDiagnosis({ shop, snapshot, payload }) {
  const diagnosis = await prisma.productDiagnosis.create({
    data: {
      shop,
      productGid: snapshot.productGid,
      productTitle: snapshot.productTitle,
      status: "Completed",
      riskScore: payload.riskScore,
      confidence: payload.confidence,
      likelyCause: payload.likelyCause,
      issues: payload.issues,
      evidence: payload.evidence,
      recommendations: payload.recommendations,
      creditsConsumed: 1,
      completedAt: new Date(),
    },
  });

  const updatedSnapshot = await prisma.productRiskSnapshot.update({
    where: { shop_productGid: { shop, productGid: snapshot.productGid } },
    data: {
      riskScore: payload.riskScore,
      impactScore: payload.impactScore,
      confidence: payload.confidence,
      primaryIssue: payload.likelyCause,
      sourceCoverage: payload.sourceCoverage,
      metrics: {
        ...payload.metrics,
        latestDiagnosisId: diagnosis.id,
        lastDetailedDiagnosisAt: new Date().toISOString(),
      },
      calculatedAt: new Date(),
    },
  });
  await Promise.all([
    recordProductScoreHistory({ shop, snapshot: updatedSnapshot, source: "full-diagnosis", diagnosisId: diagnosis.id }),
    recordWatchlistScanActivities(shop, [updatedSnapshot], { source: "full-diagnosis" }),
  ]);

  await prisma.productAction.create({
    data: {
      shop,
      diagnosisId: diagnosis.id,
      productGid: snapshot.productGid,
      actionType: "run-ai-diagnosis",
      label: "Run AI Product Diagnosis",
      status: "applied",
      payload: {
        diagnosisId: diagnosis.id,
        riskScore: payload.riskScore,
        confidence: payload.confidence,
        estimatedImpact: payload.metrics.estimatedImpact,
        mainFinding: payload.mainFinding,
      },
      appliedAt: new Date(),
    },
  });

  return diagnosis;
}

function buildAiProductInput(product, snapshot) {
  return {
    id: product.id || snapshot.productGid,
    numericId: product.numericId || extractNumericShopifyId(snapshot.productGid),
    handle: product.handle || snapshot.handle,
    title: product.title || snapshot.productTitle,
    description: product.description || "",
    vendor: product.vendor || "",
    productType: product.productType || "",
    tags: product.tags || [],
    options: product.options || [],
    variants: (product.variants || []).slice(0, 100).map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      inventoryQuantity: variant.inventoryQuantity,
      inventoryPolicy: variant.inventoryPolicy,
      selectedOptions: variant.selectedOptions || [],
    })),
    collections: product.collections || [],
    metafields: product.metafields || [],
    media: (product.media || []).slice(0, 20).map((media) => ({
      id: media.id,
      type: media.mediaContentType,
      alt: media.alt,
      status: media.status,
      width: media.width,
      height: media.height,
    })),
  };
}

function buildAiDeterministicInput(deterministic) {
  const signalRelevance = buildSignalRelevanceGuidance(deterministic);
  return {
    riskScore: deterministic.riskScore,
    confidence: deterministic.confidence,
    mainIssue: deterministic.mainIssue,
    mainIssueLabel: deterministic.mainIssueLabel,
    estimatedImpact: deterministic.estimatedImpact,
    sourceAgreement: deterministic.sourceAgreement,
    evidenceSummary: buildEvidenceSummary(deterministic),
    signalRelevance,
    metrics: {
      soldUnits: deterministic.metrics.soldUnits,
      returnUnits: deterministic.metrics.returnUnits,
      returnRate: deterministic.metrics.returnRate,
      refundUnits: deterministic.metrics.refundUnits,
      refundRate: deterministic.metrics.refundRate,
      refundAmount: deterministic.metrics.refundAmount,
      reviewCount: deterministic.metrics.reviewCount,
      avgRating: deterministic.metrics.avgRating,
      negativeReviewCount: deterministic.metrics.negativeReviewCount,
      negativeReviewRate: deterministic.metrics.negativeReviewRate,
      recentNegativeReviewCount: deterministic.metrics.recentNegativeReviewCount,
      judgeMeReviewCount: deterministic.metrics.judgeMeReviewCount,
      judgeMeAverageRating: deterministic.metrics.judgeMeAverageRating,
      judgeMeNegativeReviewCount: deterministic.metrics.judgeMeNegativeReviewCount,
      csvReviewCount: deterministic.metrics.csvReviewCount,
      csvAverageRating: deterministic.metrics.csvAverageRating,
      csvNegativeReviewCount: deterministic.metrics.csvNegativeReviewCount,
      reviewSourceStats: deterministic.metrics.reviewSourceStats,
      signalCount: deterministic.metrics.signalCount,
      customerSignalCount: deterministic.metrics.customerSignalCount,
      contentQualityScore: deterministic.metrics.contentQualityScore,
      contentQualityRisk: deterministic.metrics.contentQualityRisk,
      contentIssueCount: deterministic.metrics.contentIssueCount,
      contentIssues: deterministic.metrics.contentIssues,
      contentAdvisoryCount: deterministic.metrics.contentAdvisoryCount,
      contentAdvisories: deterministic.metrics.contentAdvisories,
      faqNeed: deterministic.metrics.faqNeed,
      titleNeedsReview: deterministic.metrics.titleNeedsReview,
      variantNamingAdvisory: deterministic.metrics.variantNamingAdvisory,
      mediaCount: deterministic.metrics.mediaCount,
      mediaWithoutAltCount: deterministic.metrics.mediaWithoutAltCount,
      textInsights: deterministic.metrics.textInsights,
      refundInsights: deterministic.metrics.refundInsights,
      descriptionWordCount: deterministic.metrics.descriptionWordCount,
      hasDescription: deterministic.metrics.hasDescription,
      topReturnReasons: deterministic.metrics.topReturnReasons,
      topRefundReasons: deterministic.metrics.topRefundReasons,
      affectedVariants: deterministic.metrics.affectedVariants,
      windowDays: deterministic.metrics.windowDays,
      orderAccessDenied: deterministic.metrics.orderAccessDenied,
    },
  };
}

function buildRuleRecommendationCandidates(deterministic) {
  const issue = deterministic.mainIssue;
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, issue);
  const faqNeed = deterministic.metrics?.faqNeed || {};
  const recipeSignals = getRecommendationRecipeSignals(deterministic);
  const candidates = [];
  if (issue === "fit_sizing" && hasActionableMainIssue) {
    candidates.push({ id: "draft-fit-note", type: "PDP copy", reason: "Fit or size language appears in returns/reviews." });
  }
  if (faqNeed.shouldRecommend) {
    candidates.push({
      id: "create-product-faq",
      type: "FAQ",
      reason: faqNeed.reasons?.[0] || "Repeated buyer uncertainty deserves a shopper-facing FAQ.",
      topics: faqNeed.topics || [],
      score: faqNeed.score,
    });
  }
  if (issue === "color_expectation" && hasActionableMainIssue) candidates.push({ id: "draft-color-expectation-note", type: "PDP copy", reason: "Customers mention color expectation mismatch." });
  if (issue === "safety_concern" && hasActionableMainIssue) candidates.push({ id: "draft-safety-expectation-note", type: "PDP copy", reason: "Customer return text expresses fear, safety concern, or discomfort." });
  if (issue === "subjective_negative_reaction" && hasActionableMainIssue) candidates.push({ id: "draft-subjective-expectation-note", type: "PDP copy", reason: "Repeated subjective negative customer language is present." });
  if ((issue === "quality_defect" || issue === "durability") && hasActionableMainIssue) candidates.push({ id: "draft-quality-note", type: "PDP copy", reason: "Quality or durability signals were detected." });
  if (deterministic.metrics.affectedVariants.length && (deterministic.metrics.returnUnits + deterministic.metrics.refundUnits) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-affected-variants", type: "Workflow", reason: "Signals are concentrated in specific variants." });
  if (deterministic.metrics.topReturnReasons.length && deterministic.metrics.returnUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-return-reasons", type: "Workflow", reason: "Return reasons are available and repeated." });
  if (deterministic.metrics.refundInsights?.shouldSurface) candidates.push({ id: "review-refund-impact", type: "Workflow", reason: "Refund rate, refund value or refund notes indicate operational refund pressure." });
  if (deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-negative-reviews", type: "Workflow", reason: "Connected negative review text is available." });
  if (deterministic.metrics.contentIssueCount > 0) {
    const contentIssues = Array.isArray(deterministic.metrics.contentIssues) ? deterministic.metrics.contentIssues : [];
    const currentDescription = deterministic.product?.description || "";
    if (shouldRecommendFullDescriptionRewrite({ contentIssues, currentDescription })) {
      candidates.push({ id: "rewrite-product-description", type: "PDP copy", reason: "Product content analysis found missing, short or incoherent product copy." });
    } else if (getDescriptionReplacementsFromContentIssues(contentIssues).length) {
      candidates.push({ id: "correct-product-description", type: "PDP copy", reason: "Product content analysis found a specific contradiction that can be corrected without rewriting the full description." });
    } else {
      candidates.push({ id: "add-product-description-guidance", type: "PDP copy", reason: "Product content analysis found a specific shopper guidance gap that can be added without rewriting the full description." });
    }
    candidates.push({ id: "align-product-metadata", type: "Workflow", reason: "Title, description, tags, collections and product type should tell a consistent story." });
  }
  if (recipeSignals.title.shouldRecommend) candidates.push({ id: "update-product-title", type: "Product title", reason: recipeSignals.title.reason });
  if (recipeSignals.variants.shouldRecommend) candidates.push({ id: "correct-variant-options", type: "Variant options", reason: recipeSignals.variants.reason });
  if (recipeSignals.pricing.shouldRecommend) candidates.push({ id: "review-product-pricing", type: "Commercial review", reason: recipeSignals.pricing.reason });
  if (recipeSignals.status.shouldRecommend) candidates.push({ id: "set-product-draft", type: "High-risk action", reason: recipeSignals.status.reason });
  if (recipeSignals.inventory.shouldRecommend) candidates.push({ id: "limit-variant-inventory", type: "Inventory hold", reason: recipeSignals.inventory.reason });
  if (recipeSignals.collection.shouldRecommend) candidates.push({ id: "move-to-review-collection", type: "Collection workflow", reason: recipeSignals.collection.reason });
  if (recipeSignals.media.shouldRecommend) candidates.push({ id: "improve-product-media", type: "Media guidance", reason: recipeSignals.media.reason });
  if (recipeSignals.qa.shouldRecommend) candidates.push({ id: "recommend-qa-review", type: "Operational QA", reason: recipeSignals.qa.reason });
  if (hasActionableMainIssue || deterministic.metrics.contentIssueCount > 0) candidates.push({ id: "copy-support-note", type: "Internal note", reason: "Support can use a concise product-specific note." });
  return candidates;
}

function analyzeFaqOpportunity({
  mainIssue,
  issueSignalCounts = {},
  contentAnalysis = {},
  textInsights = {},
  topReturnReasons = [],
  affectedVariants = [],
  reviewCount = 0,
  negativeReviewCount = 0,
  returnUnits = 0,
  refundUnits = 0,
} = {}) {
  const reasons = [];
  const topics = new Set();
  const sources = new Set();
  let score = 0;
  let signals = 0;

  const add = ({ topic, reason, weight = 1, signalCount = 0, source = "" }) => {
    if (topic) topics.add(topic);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    if (source) sources.add(source);
    score += weight;
    signals += Number(signalCount || 0);
  };

  const normalizedIssue = normalizeIssueCode(mainIssue);
  const issueSignals = Number(issueSignalCounts[normalizedIssue] || 0);
  const customerSignals = Number(returnUnits || 0) + Number(refundUnits || 0) + Number(negativeReviewCount || 0);
  const contentIssues = Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues : [];
  const contentAdvisories = Array.isArray(contentAnalysis.advisories) ? contentAnalysis.advisories : [];
  const guidanceIssues = [...contentIssues, ...contentAdvisories].filter(isFaqRelevantContentGap);
  const emotions = Array.isArray(textInsights.emotions) ? textInsights.emotions : [];
  const repeatedLanguage = Array.isArray(textInsights.repeatedLanguage) ? textInsights.repeatedLanguage : [];
  const confusionSignals = emotions
    .filter((item) => ["confusion", "uncertainty", "distrust"].includes(normalizeEmotionCode(item.code)))
    .reduce((total, item) => total + Number(item.count || 0), 0);
  const repeatedFaqLanguage = repeatedLanguage.filter((item) => isFaqRelevantText(item.term));
  const returnReasonQuestions = (Array.isArray(topReturnReasons) ? topReturnReasons : [])
    .filter((item) => isFaqRelevantText(item.label || item));

  if (["fit_sizing", "compatibility", "color_expectation"].includes(normalizedIssue) && issueSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: getFaqTopicForIssue(normalizedIssue),
      reason: `${getHumanIssueLabel(normalizedIssue)} signals repeat enough to answer before purchase.`,
      weight: 3,
      signalCount: issueSignals,
      source: "Issue signals",
    });
  }

  if (normalizedIssue === "quality_defect" && issueSignals >= 3 && guidanceIssues.length) {
    add({
      topic: "Product expectations",
      reason: "Quality signals and product-content gaps indicate shoppers need clearer expectations.",
      weight: 2,
      signalCount: issueSignals,
      source: "Quality evidence",
    });
  }

  if (guidanceIssues.length) {
    add({
      topic: "Product information",
      reason: `${guidanceIssues.length} product-content gap${guidanceIssues.length === 1 ? "" : "s"} can be answered as FAQ guidance.`,
      weight: Math.min(3, guidanceIssues.length + 1),
      signalCount: guidanceIssues.length,
      source: "Product content",
    });
  }

  if (confusionSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: "Buyer uncertainty",
      reason: `${confusionSignals} customer text signal${confusionSignals === 1 ? "" : "s"} show confusion, uncertainty or distrust.`,
      weight: 3,
      signalCount: confusionSignals,
      source: "Customer language",
    });
  }

  if (repeatedFaqLanguage.length) {
    const topTerm = repeatedFaqLanguage[0];
    add({
      topic: getFaqTopicForText(topTerm.term),
      reason: `Repeated customer language points to FAQ-worthy guidance: "${topTerm.term}".`,
      weight: Math.min(3, 1 + repeatedFaqLanguage.length),
      signalCount: repeatedFaqLanguage.reduce((total, item) => total + Number(item.count || 0), 0),
      source: "Repeated language",
    });
  }

  if (returnReasonQuestions.length && Number(returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: getFaqTopicForText(returnReasonQuestions[0].label || returnReasonQuestions[0]),
      reason: "Return reasons contain details that can be clarified before checkout.",
      weight: 2,
      signalCount: Number(returnUnits || 0),
      source: "Returns",
    });
  }

  if (affectedVariants.length && normalizedIssue === "fit_sizing" && customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: "Variant guidance",
      reason: "Affected variants suggest shoppers may need size, option or variant guidance.",
      weight: 1,
      signalCount: affectedVariants.length,
      source: "Variants",
    });
  }

  const hasEvidenceThreshold = customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || guidanceIssues.length > 0
    || Number(reviewCount || 0) >= 4;
  const shouldRecommend = score >= 3 && hasEvidenceThreshold;

  return {
    shouldRecommend,
    score,
    signals,
    topics: Array.from(topics).slice(0, 5),
    reasons: reasons.slice(0, 5),
    sourceTypes: Array.from(sources),
    evidenceThreshold: hasEvidenceThreshold ? "met" : "not_met",
  };
}

function isFaqRelevantContentGap(issue = {}) {
  const code = normalizeContentIssueCode(issue.code);
  const text = normalizeText(`${issue.label || ""} ${issue.evidence || ""} ${issue.suggested_action || ""}`);
  if (["missing_customer_guidance", "missing_specifications", "short_description", "missing_description"].includes(code)) return true;
  return /(faq|question|guidance|how to|how does|compatible|compatibility|fit|size|sizing|care|material|dimension|included|instruction|unclear|confus)/.test(text);
}

function isFaqRelevantText(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /(fit|size|sizing|compatible|compatibility|work with|works with|filter|color|material|care|wash|dimension|included|how|what|which|does|can|confus|unclear|instruction|setup|install|use)/.test(text);
}

function getFaqTopicForIssue(issueCode) {
  if (issueCode === "fit_sizing") return "Fit and sizing";
  if (issueCode === "compatibility") return "Compatibility";
  if (issueCode === "color_expectation") return "Color expectations";
  if (issueCode === "quality_defect") return "Product quality";
  return "Product guidance";
}

function getFaqTopicForText(value) {
  const text = normalizeText(value);
  if (/(fit|size|sizing)/.test(text)) return "Fit and sizing";
  if (/(compatible|compatibility|work with|works with|filter)/.test(text)) return "Compatibility";
  if (/(care|wash|material|fabric)/.test(text)) return "Materials and care";
  if (/(dimension|measure|width|height|length)/.test(text)) return "Dimensions";
  if (/(color|pictured|photo|image)/.test(text)) return "Color expectations";
  return "Product guidance";
}

function buildFinalRecommendations({ snapshot, deterministic, ai, mainIssue }) {
  const copy = ai.report?.recommendation_copy || {};
  const recommendations = [];
  const issueLabel = getHumanIssueLabel(mainIssue);
  const topReasons = deterministic.metrics.topReturnReasons || [];
  const affectedVariants = deterministic.metrics.affectedVariants || [];
  const recipeSignals = getRecommendationRecipeSignals(deterministic);
  const pdpCopy = copy.pdp_copy || buildDefaultPdpCopy(snapshot.productTitle, issueLabel, topReasons);
  const contentAnalysis = deterministic.metrics.contentAnalysis || {};
  const contentIssues = Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues : [];
  const currentDescriptionText = deterministic.product?.description || "";
  const descriptionReplacements = getDescriptionReplacementsFromContentIssues(contentIssues);
  const correctedDescriptionDraft = buildCorrectedDescriptionDraft({
    currentDescription: currentDescriptionText,
    replacements: descriptionReplacements,
  });
  const shouldRewriteDescription = shouldRecommendFullDescriptionRewrite({
    contentIssues,
    currentDescription: currentDescriptionText,
  });
  const shouldCorrectDescription = !shouldRewriteDescription
    && descriptionReplacements.length > 0
    && isMeaningfullyDifferentDescription(currentDescriptionText, correctedDescriptionDraft);
  const reviewSections = [];
  const supportNote = copy.support_note || `${snapshot.productTitle}: ${issueLabel}. Review ${topReasons.join(", ") || "stored customer signals"} and watch ${affectedVariants.join(", ") || "all variants"}.`;
  const subjectiveSummary = deterministic.metrics.textInsights?.subjectiveNegativity || {};
  const shouldRecommendSubjectiveAction = mainIssue !== "subjective_negative_reaction" || hasActionableSubjectiveEvidence(subjectiveSummary);
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, mainIssue);
  const pdpActionId = getPdpActionId(mainIssue);
  const pdpActionLabel = getPdpActionLabel(mainIssue);
  const faqNeed = deterministic.metrics.faqNeed || {};
  const faqItems = buildRecommendedFaqItems({
    copy,
    snapshot,
    mainIssue,
    pdpCopy,
    faqNeed,
  });

  if (hasActionableMainIssue && pdpCopy && mainIssue !== "product_content" && shouldRecommendSubjectiveAction) {
    recommendations.push({
      id: pdpActionId,
      label: pdpActionLabel,
      type: mainIssue === "fit_sizing" && copy.faq_answer ? "PDP copy" : "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: pdpCopy,
        issue: mainIssue,
        placement: getPdpCopyPlacement(mainIssue),
        relatedActionIds: shouldRewriteDescription ? ["rewrite-product-description"] : shouldCorrectDescription ? ["correct-product-description"] : [],
        relatedActionLabels: shouldRewriteDescription ? ["Rewrite product description"] : shouldCorrectDescription ? ["Correct product description"] : [],
      },
    });
  }

  if (contentIssues.length > 0) {
    if (shouldRewriteDescription) {
      const descriptionDraft = buildEnhancedDescriptionDraft({
        title: snapshot.productTitle,
        currentDescription: currentDescriptionText,
        suggestedDescription: copy.product_description || "",
        shopperGuidance: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? pdpCopy : "",
        contentAnalysis,
      });

      recommendations.push({
        id: "rewrite-product-description",
        label: "Rewrite product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: descriptionDraft,
          issue: "product_content",
          currentDescriptionText,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          changeStrategy: currentDescriptionText ? "preserve-and-expand" : "write-from-scratch",
          operation: "replace",
          relatedActionIds: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? [pdpActionId] : [],
          relatedActionLabels: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? [pdpActionLabel] : [],
        },
      });
    } else if (shouldCorrectDescription) {
      recommendations.push({
        id: "correct-product-description",
        label: "Correct product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: correctedDescriptionDraft,
          issue: "product_content",
          currentDescriptionText,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          descriptionReplacements,
          changeStrategy: "targeted-correction",
          operation: "replace",
          preserveHtml: true,
          relatedActionIds: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? [pdpActionId] : [],
          relatedActionLabels: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? [pdpActionLabel] : [],
        },
      });
    } else {
      recommendations.push({
        id: "add-product-description-guidance",
        label: "Add product description guidance",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: buildDescriptionGuidanceAddendum({
            title: snapshot.productTitle,
            contentIssues,
            suggestedDescription: copy.product_description || "",
            shopperGuidance: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? pdpCopy : "",
          }),
          issue: "product_content",
          currentDescriptionText,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          changeStrategy: "add-guidance",
          operation: "append",
          placement: "append",
          relatedActionIds: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? [pdpActionId] : [],
          relatedActionLabels: hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction ? [pdpActionLabel] : [],
        },
      });
    }

    reviewSections.push({
      key: "content",
      label: "Title, tags and collection alignment",
      source: "Product content",
      count: contentIssues.length,
      items: contentIssues.map((issue) => ({
        label: issue.label,
        evidence: issue.evidence,
        severity: issue.severity,
      })),
    });
  }

  if (faqNeed.shouldRecommend && faqItems.length) {
    recommendations.push({
      id: "create-product-faq",
      label: getFaqActionLabel(mainIssue),
      type: "FAQ",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: formatFaqItemsAsText(faqItems),
        faqItems,
        faqNeed,
        issue: mainIssue,
        operation: "append",
        placement: "append",
        defaultApplyMode: "description-collapsible",
        applicationOptions: getFaqApplicationOptions(),
        metafield: {
          namespace: "productpulse",
          key: "faq_items",
          type: "json",
        },
      },
    });
  }

  if (recipeSignals.title.shouldRecommend) {
    recommendations.push({
      id: "update-product-title",
      label: "Clarify product title",
      type: "Product title",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "title",
        draftTitle: normalizeSuggestedTitle(copy.product_title || buildSuggestedProductTitle(deterministic.product, mainIssue)),
        currentTitle: deterministic.product?.title || snapshot.productTitle,
        issue: "product_content",
        trigger: recipeSignals.title.reason,
      },
    });
  }

  if (recipeSignals.media.shouldRecommend) {
    recommendations.push({
      id: "improve-product-media",
      label: "Improve images and alt text",
      type: "Media guidance",
      effort: "Medium",
      status: "Ready",
      payload: {
        mediaGuidance: copy.media_guidance || buildMediaGuidance(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        mediaWithoutAltCount: deterministic.metrics.mediaWithoutAltCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.media.reason,
      },
    });
  }

  if (topReasons.length && deterministic.metrics.returnUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    reviewSections.push({
      key: "returns",
      label: "Return reasons",
      source: "Shopify returns",
      count: deterministic.metrics.returnUnits,
      items: topReasons.map((reason) => ({ label: reason, evidence: `${deterministic.metrics.returnUnits} returned unit${deterministic.metrics.returnUnits === 1 ? "" : "s"}` })),
    });
  }

  if (affectedVariants.length && (deterministic.metrics.returnUnits + deterministic.metrics.refundUnits) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    reviewSections.push({
      key: "variants",
      label: "Affected variants",
      source: "Shopify variants",
      count: affectedVariants.length,
      items: affectedVariants.map((variant) => ({ label: variant, evidence: "Variant concentration found in stored return/refund signals" })),
    });
  }

  if (deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    const reviewLabel = getReviewEvidenceLabel(deterministic.metrics);
    reviewSections.push({
      key: "reviews",
      label: `Negative ${reviewLabel.toLowerCase()}`,
      source: reviewLabel,
      count: deterministic.metrics.negativeReviewCount,
      items: [{
        label: `${deterministic.metrics.negativeReviewCount} negative review${deterministic.metrics.negativeReviewCount === 1 ? "" : "s"}`,
        evidence: `${deterministic.metrics.avgRating || 0} average rating`,
      }],
    });
  }

  if (deterministic.metrics.refundInsights?.shouldSurface || (deterministic.metrics.refundUnits >= 3 && deterministic.metrics.refundAmount > 0)) {
    const refundReasons = deterministic.metrics.refundInsights?.topReasons?.length
      ? deterministic.metrics.refundInsights.topReasons
      : deterministic.metrics.topRefundReasonDetails || [];
    reviewSections.push({
      key: "refunds",
      label: "Refund impact",
      source: "Shopify refunds",
      count: deterministic.metrics.refundUnits,
      items: [
        {
          label: `${deterministic.metrics.refundUnits} refunded unit${deterministic.metrics.refundUnits === 1 ? "" : "s"}`,
          evidence: `${deterministic.metrics.refundRate || 0}% refund rate, ${deterministic.metrics.refundAmount || 0} refund amount`,
        },
        ...refundReasons.slice(0, 3).map((reason) => ({
          label: `Refund context: ${reason.label}`,
          evidence: `${reason.count} refund signal${reason.count === 1 ? "" : "s"}`,
        })),
      ],
    });
  }

  if (reviewSections.length > 0) {
    recommendations.push({
      id: "review-product-evidence",
      label: "Review product evidence",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        reviewSections,
        focusSources: reviewSections.map((section) => section.source),
        contentQualityScore: contentAnalysis.score,
        topReturnReasons: topReasons,
        affectedVariants,
        negativeReviewCount: deterministic.metrics.negativeReviewCount,
        avgRating: deterministic.metrics.avgRating,
        refundAmount: deterministic.metrics.refundAmount,
        refundUnits: deterministic.metrics.refundUnits,
        refundRate: deterministic.metrics.refundRate,
        refundInsights: deterministic.metrics.refundInsights,
      },
    });
  }

  if (recipeSignals.variants.shouldRecommend) {
    recommendations.push({
      id: "correct-variant-options",
      label: "Review variant and option clarity",
      type: "Variant options",
      effort: "Medium",
      status: "Ready",
      payload: {
        affectedVariants,
        variantCount: deterministic.metrics.variantCount || 0,
        variantDetails: deterministic.metrics.affectedVariantDetails || [],
        issue: mainIssue,
        trigger: recipeSignals.variants.reason,
      },
    });
  }

  if (recipeSignals.pricing.shouldRecommend) {
    recommendations.push({
      id: "review-product-pricing",
      label: "Review price and value perception",
      type: "Commercial review",
      effort: "Medium",
      status: "Ready",
      payload: {
        variants: (deterministic.metrics.variants || []).map((variant) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
        })),
        refundRate: deterministic.metrics.refundRate,
        returnRate: deterministic.metrics.returnRate,
        marginAtRisk: deterministic.metrics.marginAtRisk,
        issue: mainIssue,
        trigger: recipeSignals.pricing.reason,
      },
    });
  }

  if (recipeSignals.collection.shouldRecommend) {
    recommendations.push({
      id: "move-to-review-collection",
      label: "Move product to review collection",
      type: "Collection workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        collectionName: getReviewCollectionName(deterministic),
        issue: mainIssue,
        trigger: recipeSignals.collection.reason,
      },
    });
  }

  if (supportNote && (hasActionableMainIssue || contentIssues.length > 0)) {
    recommendations.push({
      id: "copy-support-note",
      label: "Share internal note with support team",
      type: "Internal note",
      effort: "Low",
      status: "Ready",
      payload: { note: supportNote },
    });
  }

  const tags = getRecommendedRiskTags({ mainIssue, deterministic });
  if (tags.length && deterministic.metrics.signalCount >= 2) {
    recommendations.push({
      id: "apply-risk-tags",
      label: "Add internal risk tags",
      type: "Product tag",
      effort: "Low",
      status: "Ready",
      payload: { tags, productGid: snapshot.productGid, issue: mainIssue },
    });
  }

  if (recipeSignals.qa.shouldRecommend) {
    recommendations.push({
      id: "recommend-qa-review",
      label: "Recommend supplier or QA review",
      type: "Operational QA",
      effort: "Medium",
      status: "Ready",
      payload: {
        qaNote: copy.qa_note || buildQaReviewNote({ snapshot, deterministic, issueLabel }),
        issue: mainIssue,
        refundInsights: deterministic.metrics.refundInsights,
        topReturnReasons: deterministic.metrics.topReturnReasons,
        trigger: recipeSignals.qa.reason,
      },
    });
  }

  if (recipeSignals.inventory.shouldRecommend) {
    recommendations.push({
      id: "limit-variant-inventory",
      label: "Review inventory hold for affected variant",
      type: "Inventory hold",
      effort: "High",
      status: "Manual approval required",
      payload: {
        affectedVariants,
        variants: deterministic.metrics.variants || [],
        issue: mainIssue,
        trigger: recipeSignals.inventory.reason,
      },
    });
  }

  if (recipeSignals.status.shouldRecommend) {
    recommendations.push({
      id: "set-product-draft",
      label: "Set product to draft while reviewing",
      type: "High-risk action",
      effort: "High",
      status: "Manual approval required",
      payload: {
        field: "status",
        productStatus: "DRAFT",
        currentStatus: deterministic.product?.status || "Unknown",
        issue: mainIssue,
        trigger: recipeSignals.status.reason,
      },
    });
  }

  return uniqueBy(recommendations, (item) => item.id)
    .map((item, index) => decorateRecommendationRecipe(item, { deterministic, mainIssue, index }));
}

function getRecommendationRecipeSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const product = deterministic.product || {};
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  const contentIssues = getActionableContentIssues(metrics);
  const contentAdvisories = Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : metrics.contentAdvisories || [];
  const hasCustomerEvidence = Number(metrics.customerSignalCount || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || Number(metrics.returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || Number(metrics.refundUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || Number(metrics.negativeReviewCount || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE;
  const hasActionableEvidence = hasCustomerEvidence || contentIssues.length > 0;
  const variantCount = Number(metrics.variantCount || product.variants?.length || 0);
  const affectedVariantCount = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : 0;
  const valueSignals = getValuePerceptionSignals(deterministic);
  const mediaIssue = Number(metrics.mediaWithoutAltCount || 0) > 0
    || Number(metrics.mediaCount || 0) === 0
    || mainIssue === "color_expectation"
    || contentAdvisories.some((item) => ["missing_media_context", "missing_media_alt_text"].includes(normalizeContentIssueCode(item.code)));
  const highRiskOperationalIssue = ["safety_concern", "quality_defect", "durability", "refund_impact"].includes(mainIssue);
  const refundInsights = metrics.refundInsights || {};

  return {
    title: {
      shouldRecommend: Boolean(metrics.titleNeedsReview || contentIssues.some((item) => ["generic_title", "title_description_mismatch"].includes(normalizeContentIssueCode(item.code)))),
      reason: "The product title is generic, misleading, or clearly disconnected from the product content.",
    },
    variants: {
      shouldRecommend: variantCount > 1 && (
        affectedVariantCount > 0
        || Boolean(metrics.variantNamingAdvisory)
        || contentAdvisories.some((item) => normalizeContentIssueCode(item.code) === "unclear_variant_names")
      ) && (hasCustomerEvidence || Boolean(metrics.variantNamingAdvisory)),
      reason: affectedVariantCount
        ? "Signals are concentrated in specific variants, SKUs or options."
        : "Variant names or option labels are unclear enough to review.",
    },
    pricing: {
      shouldRecommend: valueSignals.length >= 2 || (Number(metrics.refundRate || 0) > 20 && Number(metrics.soldUnits || 0) > 10 && Number(metrics.refundUnits || 0) >= 3),
      reason: valueSignals.length
        ? `Customer language points to value or price perception: ${valueSignals.slice(0, 3).join(", ")}.`
        : "Refund pressure is high enough to review price and value expectations manually.",
    },
    status: {
      shouldRecommend: Boolean(hasActionableEvidence && highRiskOperationalIssue && Number(deterministic.riskScore || 0) >= 75 && Number(deterministic.confidence || 0) >= 65),
      reason: "Risk and confidence are both high for a potentially serious product-quality issue.",
    },
    inventory: {
      shouldRecommend: Boolean(variantCount > 1 && affectedVariantCount > 0 && Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0) >= 4 && Number(deterministic.riskScore || 0) >= 65),
      reason: "The problem appears concentrated enough to consider holding a specific affected variant.",
    },
    collection: {
      shouldRecommend: Boolean(hasActionableEvidence && Number(deterministic.riskScore || 0) >= 55),
      reason: "The product should be grouped for internal review or quality workflow tracking.",
    },
    media: {
      shouldRecommend: Boolean(mediaIssue && (hasActionableEvidence || mainIssue === "color_expectation")),
      reason: Number(metrics.mediaWithoutAltCount || 0) > 0
        ? `${metrics.mediaWithoutAltCount} product media item${Number(metrics.mediaWithoutAltCount) === 1 ? "" : "s"} need clearer alt text.`
        : "Customer expectations may depend on images, scale, color, material or visual context.",
    },
    qa: {
      shouldRecommend: Boolean(hasActionableEvidence && (highRiskOperationalIssue || refundInsights.shouldSurface || Number(metrics.returnRate || 0) >= 15)),
      reason: refundInsights.shouldSurface
        ? "Refund pressure or refund notes point to an operational quality review."
        : "Returns, reviews or language suggest a possible supplier, QA, durability or safety concern.",
    },
  };
}

function getActionableContentIssues(metrics = {}) {
  const issues = Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : metrics.contentIssues || [];
  return issues.filter((issue) => issue && typeof issue === "object");
}

function getValuePerceptionSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const textInsights = metrics.textInsights || {};
  const repeated = [
    ...(Array.isArray(textInsights.repeatedLanguage) ? textInsights.repeatedLanguage : []),
    ...(Array.isArray(textInsights.reviews?.repeatedLanguage) ? textInsights.reviews.repeatedLanguage : []),
    ...(Array.isArray(textInsights.returns?.repeatedLanguage) ? textInsights.returns.repeatedLanguage : []),
  ];
  const snippets = Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : [];
  const values = [
    ...repeated.map((item) => item.term || item.label || ""),
    ...snippets.map((item) => item.text || item.body || item.summary || ""),
  ].map(String);

  return uniqueBy(values.filter((value) => /\b(expensive|price|priced|cost|costly|cheap|not worth|worth it|value|overpriced|quality for the price)\b/i.test(value)), (value) => normalizeText(value))
    .slice(0, 5);
}

function decorateRecommendationRecipe(action, { deterministic, mainIssue, index }) {
  const recipe = getRecommendationRecipeMetadata(action, { deterministic, mainIssue, index });
  return {
    ...action,
    priorityGroup: recipe.priorityGroup,
    payload: {
      ...(action.payload || {}),
      recipe: true,
      recipeState: "Suggested",
      trigger: action.payload?.trigger || recipe.trigger,
      proposedChange: recipe.proposedChange,
      shopifyField: recipe.shopifyField,
      expectedImpact: recipe.expectedImpact,
      applicationRisk: recipe.applicationRisk,
      approval: recipe.approval,
      reviewApplyFlow: "Review -> Apply",
      priorityGroup: recipe.priorityGroup,
    },
  };
}

function getRecommendationRecipeMetadata(action, { deterministic, mainIssue, index }) {
  const id = String(action.id || "");
  const payload = action.payload || {};
  const metrics = deterministic.metrics || {};
  const primary = index === 0 ? "Primary customer-facing fix" : "Suggested action";
  const trigger = payload.trigger || action.reason || `ProductPulse found ${getHumanIssueLabel(mainIssue)} evidence.`;
  const common = {
    trigger,
    proposedChange: action.label || "Review recommended action",
    shopifyField: "ProductPulse workflow",
    expectedImpact: "Improve operational follow-through from the current diagnosis.",
    applicationRisk: "Low",
    approval: "Review required before applying",
    priorityGroup: primary,
  };

  if (id === "correct-product-description") {
    return {
      ...common,
      proposedChange: "Correct specific contradictory text in the Shopify product description while preserving the existing description structure.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Remove a buyer-facing content contradiction without rewriting the full PDP copy.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
    };
  }
  if (id.includes("description") || id.includes("fit-note") || id.includes("expectation") || id.includes("quality-note") || id.includes("subjective")) {
    return {
      ...common,
      proposedChange: payload.operation === "replace" ? "Rewrite the Shopify product description while preserving useful existing copy." : "Insert shopper-facing expectation guidance into the product description.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Reduce avoidable buyer confusion before checkout.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
    };
  }
  if (id === "create-product-faq") {
    return {
      ...common,
      proposedChange: "Create generated FAQ content and apply it as description HTML or a product metafield.",
      shopifyField: "Product.descriptionHtml or productpulse.faq_items metafield",
      expectedImpact: "Answer repeated buyer uncertainty before purchase.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
    };
  }
  if (id === "update-product-title") {
    return {
      ...common,
      proposedChange: `Change the title from "${payload.currentTitle || "current title"}" to "${payload.draftTitle || "a clearer title"}".`,
      shopifyField: "Product.title",
      expectedImpact: "Make the product easier to identify and reduce expectation mismatch.",
      applicationRisk: "Medium",
      priorityGroup: "Customer-facing fix",
    };
  }
  if (id === "correct-variant-options") {
    return {
      ...common,
      proposedChange: "Review and correct unclear option names, variant labels, or affected SKU presentation.",
      shopifyField: "Product options and ProductVariant option values",
      expectedImpact: "Reduce wrong variant selection and focus remediation on the affected scope.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Catalog fix",
    };
  }
  if (id === "review-product-pricing") {
    return {
      ...common,
      proposedChange: "Review variant prices and compare-at prices against value-perception evidence.",
      shopifyField: "ProductVariant.price and ProductVariant.compareAtPrice",
      expectedImpact: `Reduce value mismatch risk while protecting ${formatMoney(metrics.marginAtRisk || 0)} margin exposure.`,
      applicationRisk: "High",
      approval: "Manual approval required",
      priorityGroup: "Commercial fix",
    };
  }
  if (id === "set-product-draft") {
    return {
      ...common,
      proposedChange: "Set the Shopify product status to DRAFT while the team reviews the issue.",
      shopifyField: "Product.status",
      expectedImpact: "Temporarily stop the product from continuing to create customer-facing risk.",
      applicationRisk: "High",
      approval: "Manual approval required",
      priorityGroup: "Operational control",
    };
  }
  if (id === "limit-variant-inventory") {
    return {
      ...common,
      proposedChange: "Review inventory availability for the affected variant before holding or reducing sellable stock.",
      shopifyField: "InventoryLevel quantities",
      expectedImpact: "Limit exposure while preserving unaffected variants.",
      applicationRisk: "High",
      approval: "Manual approval required",
      priorityGroup: "Operational control",
    };
  }
  if (id === "apply-risk-tags") {
    return {
      ...common,
      proposedChange: `Add internal Shopify tags: ${(payload.tags || []).join(", ")}.`,
      shopifyField: "Product.tags",
      expectedImpact: "Make the product discoverable in internal workflows and automated collections.",
      applicationRisk: "Low",
      priorityGroup: "Catalog fix",
    };
  }
  if (id === "move-to-review-collection") {
    return {
      ...common,
      proposedChange: `Move or add this product to "${payload.collectionName || "ProductPulse Needs Review"}".`,
      shopifyField: "Collection membership",
      expectedImpact: "Group risky products for quality, merchandising or operations review.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Catalog fix",
    };
  }
  if (id === "improve-product-media") {
    return {
      ...common,
      proposedChange: "Add image guidance, improve alt text, or review media order for clearer shopper expectations.",
      shopifyField: "Product media and alt text",
      expectedImpact: "Reduce visual expectation mismatch and improve PDP clarity.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Customer-facing fix",
    };
  }
  if (id === "copy-support-note") {
    return {
      ...common,
      proposedChange: "Create an internal support note or macro.",
      shopifyField: "Internal support workflow",
      expectedImpact: "Help support answer repeated product questions consistently.",
      applicationRisk: "Low",
      priorityGroup: "Operational follow-up",
    };
  }
  if (id === "recommend-qa-review") {
    return {
      ...common,
      proposedChange: "Send this product to supplier, QA or merchandising review with the captured evidence.",
      shopifyField: "Operational QA workflow",
      expectedImpact: "Address potential physical, supplier or durability issues outside the PDP.",
      applicationRisk: "Low",
      approval: "Manual approval required",
      priorityGroup: "Operational follow-up",
    };
  }
  return common;
}

function buildSuggestedProductTitle(product = {}, mainIssue = "") {
  const current = String(product.title || "").trim();
  if (current && !isGenericProductTitle(current)) return current;
  const parts = [
    product.vendor,
    product.productType,
    getHumanIssueLabel(mainIssue) !== "Product quality" ? getHumanIssueLabel(mainIssue) : "",
  ].filter(Boolean);
  return parts.length ? uniqueBy(parts, normalizeText).join(" ") : current || "Clarified product title";
}

function normalizeSuggestedTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function buildMediaGuidance(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  if (Number(metrics.mediaCount || 0) === 0) return "Add product media that clearly shows scale, material, color and what the shopper receives.";
  if (Number(metrics.mediaWithoutAltCount || 0) > 0) return "Review product media and add descriptive alt text that explains the visible product, variant, color, material or scale.";
  if (deterministic.mainIssue === "color_expectation") return "Review image order and add visual context so color, lighting and material expectations are clearer before purchase.";
  return "Review product media for scale, material, color and format clarity.";
}

function getReviewCollectionName(deterministic = {}) {
  if (Number(deterministic.riskScore || 0) >= 75) return "ProductPulse High Return Risk";
  if (deterministic.mainIssue === "product_content") return "ProductPulse Content Fix Needed";
  return "ProductPulse Needs Review";
}

function buildQaReviewNote({ snapshot, deterministic, issueLabel }) {
  const metrics = deterministic.metrics || {};
  const parts = [
    `${snapshot.productTitle} should be reviewed for ${issueLabel}.`,
    metrics.returnUnits ? `${metrics.returnUnits} return unit${metrics.returnUnits === 1 ? "" : "s"} were analyzed.` : "",
    metrics.refundUnits ? `${metrics.refundUnits} refund unit${metrics.refundUnits === 1 ? "" : "s"} were analyzed.` : "",
    metrics.topReturnReasons?.length ? `Top return reasons: ${metrics.topReturnReasons.slice(0, 3).join(", ")}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function getRecommendedRiskTags({ mainIssue, deterministic }) {
  const metrics = deterministic.metrics || {};
  const tags = [];
  if (Number(deterministic.riskScore || 0) >= 75) tags.push("risk-high");
  else if (Number(deterministic.riskScore || 0) >= 55) tags.push("risk-medium");
  else tags.push("risk-low");
  const issueTag = getIssueTag(mainIssue);
  if (issueTag) tags.push(issueTag);
  if (Number(metrics.contentIssueCount || 0) > 0) tags.push("needs-description-review");
  if (Number(metrics.returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) tags.push("return-anomaly");
  if (metrics.refundInsights?.shouldSurface) tags.push("refund-pressure");
  if (Number(metrics.textInsights?.sentiment?.negative || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) tags.push("sentiment-negative");
  if (Array.isArray(metrics.affectedVariants) && metrics.affectedVariants.length) tags.push("variant-issue");
  return uniqueBy(tags, normalizeText).slice(0, 10);
}

function buildRecommendedFaqItems({ copy = {}, snapshot, mainIssue, pdpCopy = "", faqNeed = {} }) {
  const aiItems = normalizeFaqItems(copy.faq_items);
  const legacyItem = normalizeFaqItems([{
    question: copy.faq_question,
    answer: copy.faq_answer,
    reason: "AI generated from product diagnosis signals.",
  }]);
  const fallbackItems = buildDefaultFaqItems({ snapshot, mainIssue, pdpCopy, faqNeed });
  return uniqueBy([...aiItems, ...legacyItem, ...fallbackItems], (item) => normalizeText(item.question))
    .slice(0, 4);
}

function normalizeFaqItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const question = String(item?.question || "").replace(/\s+/g, " ").trim();
      const answer = String(item?.answer || "").replace(/\s+/g, " ").trim();
      if (!question || !answer) return null;
      return {
        question: question.endsWith("?") ? question : `${question}?`,
        answer,
        reason: String(item?.reason || "").replace(/\s+/g, " ").trim(),
      };
    })
    .filter(Boolean);
}

function buildDefaultFaqItems({ snapshot, mainIssue, pdpCopy = "", faqNeed = {} }) {
  const title = snapshot.productTitle || "this product";
  const topics = Array.isArray(faqNeed.topics) ? faqNeed.topics : [];
  const items = [];
  const add = (question, answer, reason) => {
    items.push({ question, answer, reason });
  };

  if (mainIssue === "fit_sizing" || topics.includes("Fit and sizing")) {
    add(
      `How does ${title} fit?`,
      "Customer signals suggest shoppers may need clearer sizing guidance before purchase. Review the selected size and fit notes, and consider sizing up or checking measurements if you are between sizes.",
      "Fit or size language repeated in product signals.",
    );
  }

  if (mainIssue === "compatibility" || topics.includes("Compatibility")) {
    add(
      `What is ${title} compatible with?`,
      "Check the selected variant, product options and any compatibility notes before purchase. ProductPulse detected buyer uncertainty around whether this product works with a specific setup or related item.",
      "Compatibility or usage uncertainty appeared in product evidence.",
    );
  }

  if (mainIssue === "color_expectation" || topics.includes("Color expectations")) {
    add(
      `Will the color look exactly like the product photos?`,
      "Color can vary by screen, lighting and production batch. Review the product images and any color notes before purchase.",
      "Customer signals suggest expectation-setting around color may reduce avoidable confusion.",
    );
  }

  if (topics.includes("Materials and care")) {
    add(
      `What should shoppers know about materials or care for ${title}?`,
      "Use the product description, tags and variant details to confirm material and care expectations before purchase.",
      "Product content gaps or customer language point to material or care questions.",
    );
  }

  if (!items.length) {
    add(
      `What should shoppers know before buying ${title}?`,
      pdpCopy || "ProductPulse detected product signals that would benefit from clearer pre-purchase guidance. Review the description, options and evidence before buying.",
      "ProductPulse found FAQ-worthy buyer uncertainty in the diagnosis.",
    );
  }

  return normalizeFaqItems(items);
}

function formatFaqItemsAsText(items = []) {
  return normalizeFaqItems(items)
    .map((item) => `${item.question}\n${item.answer}`)
    .join("\n\n");
}

function getFaqActionLabel(mainIssue) {
  if (mainIssue === "fit_sizing") return "Create fit FAQ";
  if (mainIssue === "compatibility") return "Create compatibility FAQ";
  if (mainIssue === "color_expectation") return "Create color expectations FAQ";
  return "Create product FAQ";
}

function getFaqApplicationOptions() {
  return [
    {
      id: "description-section",
      label: "Full FAQ in description",
      target: "Product description",
      operation: "Append FAQ section",
    },
    {
      id: "description-collapsible",
      label: "Collapsible FAQ in description",
      target: "Product description",
      operation: "Append collapsible FAQ",
    },
    {
      id: "description-modal",
      label: "Modal-style FAQ in description",
      target: "Product description",
      operation: "Append modal-style FAQ",
    },
    {
      id: "metafield-json",
      label: "Save FAQ metafield",
      target: "Product metafield",
      operation: "Save JSON metafield",
    },
  ];
}

function buildFinalIssues({ deterministic, ai, mainIssue, recommendations }) {
  const clusters = Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length
    ? ai.classification.clusters
    : buildFallbackClusters(deterministic, mainIssue);
  const firstAction = recommendations[0]?.label || "Review product signals";
  const contentIssues = deterministic.metrics.contentAnalysis?.issues || [];
  const granularTextIssues = buildGranularTextIssues({ deterministic, ai, recommendations });
  const mappedIssues = clusters.slice(0, 5).map((cluster, index) => {
    const issueCode = normalizeIssueCode(cluster.issue_category || cluster.issue || mainIssue) || mainIssue;
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = cluster.severity || getSeverityLabel(deterministic.riskScore);
    const signals = Number(cluster.signals || deterministic.issueSignalCounts[issueCode] || Math.max(1, Math.round(deterministic.metrics.signalCount / (index + 1))));

    return {
      issue: cluster.human_name || cluster.label || getHumanIssueLabel(issueCode),
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: Math.max(35, Math.min(99, deterministic.confidence - index * 7)),
      signals,
      sourceTypes: normalizeSourceTypes(cluster.source_types || cluster.sources),
      evidence: [
        cluster.summary,
        ...(Array.isArray(cluster.evidence) ? cluster.evidence : []),
      ].filter(Boolean).length ? [
        cluster.summary,
        ...(Array.isArray(cluster.evidence) ? cluster.evidence : []),
      ].filter(Boolean).slice(0, 4) : deterministic.metrics.topReturnReasons,
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: recommendations[index]?.label || firstAction,
    };
  });

  granularTextIssues.forEach((issue) => {
    if (mappedIssues.some((item) => item.issue === issue.issue)) return;
    mappedIssues.push(issue);
  });

  if (contentIssues.length > 0 && !mappedIssues.some((issue) => issue.issueCode === "product_content")) {
    const primaryContentIssue = contentIssues[0];
    mappedIssues.push({
      issue: primaryContentIssue.label || "Product content needs review",
      issueCode: "product_content",
      severity: capitalize(primaryContentIssue.severity || "Medium"),
      tone: getRiskToneFromSeverity(primaryContentIssue.severity || "medium", deterministic.riskScore),
      confidence: Math.max(45, Math.min(92, deterministic.confidence - 4)),
      signals: contentIssues.length,
      evidence: contentIssues.map((issue) => issue.evidence || issue.detail || issue.label).filter(Boolean).slice(0, 4),
      trend: [],
      trendTone: "orange",
      action: "Rewrite product description",
    });
  }

  const refundIssue = buildRefundOperationalIssue(deterministic, recommendations);
  if (refundIssue && !mappedIssues.some((issue) => issue.issueCode === refundIssue.issueCode)) {
    mappedIssues.push(refundIssue);
  }

  return mappedIssues
    .map((issue) => scaleSubjectiveIssueForEvidence(issue, deterministic))
    .map((issue) => scaleWeakReviewIssueForEvidence(issue, deterministic))
    .filter((issue) => isMerchantFacingIssueSupported(issue, deterministic))
    .reduce(mergeRelatedMerchantIssues, [])
    .slice(0, 10);
}

function buildRefundOperationalIssue(deterministic, recommendations) {
  const refundInsights = deterministic.metrics.refundInsights || {};
  if (!refundInsights.shouldSurface) return null;
  const issueCode = refundInsights.dominantIssueCode && refundInsights.dominantIssueCode !== "product_quality"
    ? refundInsights.dominantIssueCode
    : "refund_impact";
  const trend = getIssueTrend(deterministic, issueCode);
  const severity = refundInsights.highPressure ? "medium" : "low";
  const signals = Math.max(Number(refundInsights.total || 0), Number(refundInsights.noteCount || 0));
  return {
    issue: refundInsights.highPressure ? "High refund pressure" : "Refund pattern needs review",
    issueCode,
    severity: capitalize(severity),
    tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
    confidence: Math.max(40, Math.min(86, deterministic.confidence - (refundInsights.highPressure ? 8 : 16))),
    signals,
    sourceTypes: ["shopify_refund_note", "shopify_refunds"],
    evidence: [
      `${refundInsights.total} refunded unit${refundInsights.total === 1 ? "" : "s"} across ${refundInsights.soldUnits} sold unit${refundInsights.soldUnits === 1 ? "" : "s"} (${refundInsights.refundRate}% refund rate).`,
      refundInsights.highPressure ? "Refund pressure is above the high-signal threshold: refund rate >20% and sold units >10." : "",
      refundInsights.noteCount ? `${refundInsights.noteCount} refund note${refundInsights.noteCount === 1 ? "" : "s"} available for operational pattern review.` : "",
      refundInsights.reasonCount ? `${refundInsights.reasonCount} refund reason/restock context signal${refundInsights.reasonCount === 1 ? "" : "s"} available for operational pattern review.` : "",
      ...((refundInsights.topReasons || []).slice(0, 3).map((item) => `Refund reason/context: "${item.label}" (${item.count})`)),
      ...((refundInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated refund-note language: "${item.term}" (${item.count})`)),
      ...((refundInsights.examples || []).slice(0, 2).map((item) => `Refund note: "${item.text}"`)),
    ].filter(Boolean),
    trend,
    trendTone: getTrendTone(trend, deterministic.riskScore),
    action: recommendations.find((item) => item.id === "review-refund-impact")?.label || "Review refund impact",
  };
}

function buildGranularTextIssues({ deterministic, ai, recommendations }) {
  const textInsights = deterministic.metrics.textInsights || {};
  const aiFindings = Array.isArray(ai.classification?.granular_findings) ? ai.classification.granular_findings : [];
  const aiRepeatedLanguage = getFilteredAiRepeatedLanguage(ai);
  const aiEmergentSentiments = normalizeAiEmergentSentiments(ai);
  const deterministicIssues = Array.isArray(textInsights.granularIssues) ? textInsights.granularIssues : [];
  const issues = [];

  aiFindings.slice(0, 5).forEach((finding, index) => {
    const issueCode = normalizeIssueCode(finding.issue_category || finding.issue_detail || "product_quality") || "product_quality";
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = normalizeSeverity(finding.severity || "medium");
    issues.push({
      issue: finding.finding || finding.label || getHumanIssueLabel(issueCode),
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: Math.max(42, Math.min(94, deterministic.confidence - 5 - index * 3)),
      signals: Number(finding.signals || 1),
      sourceTypes: normalizeSourceTypes(finding.source_types || finding.sources),
      evidence: Array.isArray(finding.evidence) ? finding.evidence.slice(0, 4) : [finding.summary || finding.explanation].filter(Boolean),
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: finding.suggested_action || recommendations[index]?.label || "Review text evidence",
    });
  });

  deterministicIssues.slice(0, 5).forEach((issue, index) => {
    const issueCode = normalizeIssueCode(issue.issueCode || issue.issue) || "product_quality";
    const trend = getIssueTrend(deterministic, issueCode);
    issues.push({
      issue: issue.issue,
      issueCode,
      severity: capitalize(issue.severity || "Low"),
      tone: getRiskToneFromSeverity(issue.severity || "low", deterministic.riskScore),
      confidence: Math.max(38, Math.min(90, deterministic.confidence - 8 - index * 3)),
      signals: Number(issue.signals || 1),
      sourceTypes: normalizeSourceTypes(issue.sourceTypes || issue.sources),
      evidence: Array.isArray(issue.evidence) ? issue.evidence.slice(0, 4) : [],
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: issue.action || "Review text evidence",
    });
  });

  aiRepeatedLanguage.slice(0, 4).forEach((item, index) => {
    const term = String(item.term || "").trim();
    if (!term) return;
    const issueCode = normalizeIssueCode(item.issue_category || term) || "repeated_language";
    const trend = getIssueTrend(deterministic, issueCode);
    issues.push({
      issue: `Repeated customer language: "${term}"`,
      issueCode,
      severity: capitalize(normalizeSeverity(item.severity || (Number(item.count || 0) >= 4 ? "medium" : "low"))),
      tone: getRiskToneFromSeverity(item.severity || "low", deterministic.riskScore),
      confidence: Math.max(38, Math.min(88, deterministic.confidence - 12 - index * 2)),
      signals: Number(item.count || 1),
      sourceTypes: normalizeSourceTypes(item.source_types || item.sources),
      evidence: [item.explanation, `${term} appears ${item.count || 1} times.`].filter(Boolean),
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: "Review repeated language",
    });
  });

  aiEmergentSentiments.slice(0, 4).forEach((item, index) => {
    const issueCode = normalizeIssueCode(item.issueCategory || `emergent_sentiment_${item.normalizedLabel}`) || `emergent_sentiment_${item.normalizedLabel}`;
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = normalizeEmergentSentimentSeverity(item);
    issues.push({
      issue: `Emergent customer sentiment: ${item.label}`,
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: getEmergentSentimentConfidenceScore(item, deterministic.confidence, index),
      signals: item.signals,
      sourceTypes: normalizeSourceTypes(item.sourceTypes || item.source_types),
      evidence: [
        item.merchantSummary,
        item.mergedFrom.length ? `Merged similar reactions: ${item.mergedFrom.join(", ")}.` : "",
        ...item.evidence,
      ].filter(Boolean).slice(0, 5),
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: item.suggestedAction || "Review emergent customer sentiment",
    });
  });

  return uniqueBy(issues.filter((issue) => issue.issue), (issue) => `${issue.issueCode}-${issue.issue}`);
}

function getFilteredAiRepeatedLanguage(ai) {
  return (Array.isArray(ai?.classification?.repeated_language) ? ai.classification.repeated_language : [])
    .filter((item) => isUsefulRepeatedLanguageTerm(item?.term));
}

function isMerchantFacingIssueSupported(issue, deterministic) {
  const issueCode = normalizeIssueCode(issue.issueCode);
  if (issueCode === "product_content") return true;

  const support = getMerchantIssueSupport(issue, deterministic);
  if (support.sources >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE && support.signals >= 1) return true;
  if (support.signals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return true;

  return false;
}

function hasActionableIssueEvidence(deterministic, issueCode) {
  const normalizedIssueCode = normalizeIssueCode(issueCode);
  if (normalizedIssueCode === "product_content") return Number(deterministic.metrics?.contentIssueCount || 0) > 0;
  return isMerchantFacingIssueSupported({
    issueCode: normalizedIssueCode,
    signals: deterministic.issueSignalCounts?.[normalizedIssueCode] || 0,
  }, deterministic);
}

function getMerchantIssueSupport(issue, deterministic) {
  const issueCode = normalizeIssueCode(issue.issueCode);
  const metrics = deterministic.metrics || {};
  const sourceTypes = normalizeSourceTypes(issue.sourceTypes || issue.source_types || issue.sources);
  const explicitSignals = Number(issue.signals || 0);
  const issueSignals = Number(deterministic.issueSignalCounts?.[issueCode] || 0);
  const fallbackSignals = getDeterministicIssueSupport(issueCode, metrics);

  return {
    signals: Math.max(explicitSignals, issueSignals, fallbackSignals),
    sources: sourceTypes.length,
  };
}

function getDeterministicIssueSupport(issueCode, metrics) {
  if (issueCode === "refund_impact") return Number(metrics.refundUnits || 0);
  if (issueCode === "negative_sentiment") return Number(metrics.textInsights?.sentiment?.negative || 0);
  if (issueCode === "subjective_negative_reaction") return Number(metrics.textInsights?.subjectiveNegativity?.count || 0);
  if (issueCode === "repeated_language") {
    return Math.max(...(metrics.textInsights?.repeatedLanguage || []).map((item) => Number(item.count || 0)), 0);
  }
  return 0;
}

function mergeRelatedMerchantIssues(mergedIssues, issue) {
  const existingIndex = mergedIssues.findIndex((candidate) => getIssueMergeKey(candidate) === getIssueMergeKey(issue));
  if (existingIndex === -1) return [...mergedIssues, issue];

  const existing = mergedIssues[existingIndex];
  const preferred = compareIssueStrength(issue, existing) > 0 ? issue : existing;
  const secondary = preferred === issue ? existing : issue;
  const combined = {
    ...preferred,
    signals: Math.max(Number(preferred.signals || 0), Number(secondary.signals || 0)),
    confidence: Math.max(Number(preferred.confidence || 0), Number(secondary.confidence || 0)),
    evidence: uniqueBy([
      ...(Array.isArray(preferred.evidence) ? preferred.evidence : []),
      ...(Array.isArray(secondary.evidence) ? secondary.evidence : []),
    ].filter(Boolean), (item) => normalizeText(item)).slice(0, 5),
    sourceTypes: uniqueBy([
      ...normalizeSourceTypes(preferred.sourceTypes),
      ...normalizeSourceTypes(secondary.sourceTypes),
    ], (item) => item),
  };

  return [
    ...mergedIssues.slice(0, existingIndex),
    combined,
    ...mergedIssues.slice(existingIndex + 1),
  ];
}

function compareIssueStrength(first, second) {
  const firstScore = getSeverityRank(first.severity) * 100 + Number(first.signals || 0) * 10 + Number(first.confidence || 0);
  const secondScore = getSeverityRank(second.severity) * 100 + Number(second.signals || 0) * 10 + Number(second.confidence || 0);
  return firstScore - secondScore;
}

function getIssueMergeKey(issue) {
  const issueCode = normalizeIssueCode(issue.issueCode);
  if (issueCode === "product_content") return `${issueCode}-${normalizeText(issue.issue)}`;
  return issueCode || normalizeText(issue.issue);
}

function getSeverityRank(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return 3;
  if (normalized.includes("medium") || normalized.includes("moderate")) return 2;
  return 1;
}

function normalizeSourceTypes(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return uniqueBy(
    values
      .map((item) => String(item || "").trim().toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean),
    (item) => item,
  );
}

function scaleSubjectiveIssueForEvidence(issue, deterministic) {
  if (issue.issueCode !== "subjective_negative_reaction") return issue;
  const summary = deterministic.metrics.textInsights?.subjectiveNegativity || {};
  const severity = getSubjectiveIssueSeverity(summary);
  const evidence = Array.isArray(issue.evidence) ? issue.evidence.filter(Boolean) : [];
  const policyText = getSubjectiveEvidencePolicyText(summary);
  return {
    ...issue,
    severity: capitalize(severity),
    tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
    confidence: Math.min(Number(issue.confidence || deterministic.confidence || 0), getSubjectiveConfidenceCap(summary)),
    signals: Math.max(Number(issue.signals || 0), Number(summary.count || 0), 1),
    evidence: evidence.includes(policyText) ? evidence : [policyText, ...evidence].filter(Boolean).slice(0, 5),
  };
}

function getSubjectiveConfidenceCap(summary) {
  const count = Number(summary?.count || 0);
  const ratio = Number(summary?.ratio || 0);
  if (count <= 1) return 45;
  if (!hasActionableSubjectiveEvidence(summary)) return 62;
  if (count < 5 && ratio < 0.5) return 76;
  return 88;
}

function scaleWeakReviewIssueForEvidence(issue, deterministic) {
  const relevance = buildSignalRelevanceGuidance(deterministic);
  if (relevance.reviewSignals.level === "normal") return issue;
  if (issue.issueCode === "product_content") return issue;
  const negativeReviews = Number(deterministic.metrics.negativeReviewCount || 0);
  const severity = negativeReviews >= 3 ? "Medium" : "Low";
  const confidenceCap = negativeReviews >= 3 ? 64 : 49;
  const policyText = relevance.reviewSignals.guidance;
  const evidence = Array.isArray(issue.evidence) ? issue.evidence.filter(Boolean) : [];
  return {
    ...issue,
    severity,
    tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
    confidence: Math.min(Number(issue.confidence || deterministic.confidence || 0), confidenceCap),
    evidence: evidence.includes(policyText) ? evidence : [policyText, ...evidence].filter(Boolean).slice(0, 5),
  };
}

const KNOWN_CUSTOMER_SENTIMENT_CODES = new Set([
  "frustration",
  "disappointment",
  "anger",
  "fear",
  "confusion",
  "distrust",
  "regret",
  "uncertainty",
  "indifference",
  "satisfaction",
  "trust",
  "relief",
  "delight",
  "none",
]);

function normalizeAiKnownEmotions(ai, textInsights = {}) {
  const grouped = new Map();
  let aiEmotionCount = 0;

  const addEmotion = ({ code, count = 1, source = "", evidence = "" }) => {
    const normalizedCode = normalizeEmotionCode(code);
    if (!normalizedCode || normalizedCode === "none" || !KNOWN_CUSTOMER_SENTIMENT_CODES.has(normalizedCode)) return;
    const current = grouped.get(normalizedCode) || {
      code: normalizedCode,
      label: getEmotionLabel(normalizedCode),
      polarity: getEmotionPolarity(normalizedCode),
      count: 0,
      sources: new Set(),
      examples: [],
    };
    current.count += Math.max(1, Number(count || 1));
    if (source) current.sources.add(source);
    if (evidence && current.examples.length < 3) current.examples.push(truncateText(evidence, 140));
    grouped.set(normalizedCode, current);
  };

  (Array.isArray(ai?.classification?.classified_signals) ? ai.classification.classified_signals : []).forEach((signal) => {
    if (normalizeEmotionCode(signal.known_emotion) && normalizeEmotionCode(signal.known_emotion) !== "none") aiEmotionCount += 1;
    addEmotion({
      code: signal.known_emotion,
      source: signal.source,
      evidence: signal.text,
    });
  });

  (Array.isArray(ai?.classification?.granular_findings) ? ai.classification.granular_findings : []).forEach((finding) => {
    if (normalizeEmotionCode(finding.known_emotion) && normalizeEmotionCode(finding.known_emotion) !== "none") aiEmotionCount += 1;
    addEmotion({
      code: finding.known_emotion,
      count: finding.signals,
      source: Array.isArray(finding.source_types) ? finding.source_types.join(", ") : "",
      evidence: Array.isArray(finding.evidence) ? finding.evidence[0] : finding.finding,
    });
  });

  getFilteredAiRepeatedLanguage(ai).forEach((item) => {
    if (normalizeEmotionCode(item.known_emotion) && normalizeEmotionCode(item.known_emotion) !== "none") aiEmotionCount += 1;
    addEmotion({
      code: item.known_emotion,
      count: item.count,
      source: Array.isArray(item.source_types) ? item.source_types.join(", ") : "",
      evidence: item.term,
    });
  });

  if (!aiEmotionCount) {
    (Array.isArray(textInsights.emotions) ? textInsights.emotions : []).forEach((item) => {
      addEmotion({
        code: item.code,
        count: item.count,
        source: Array.isArray(item.sources) ? item.sources.join(", ") : "",
        evidence: Array.isArray(item.examples) ? item.examples[0] : "",
      });
    });
  }

  return Array.from(grouped.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => ({
      ...item,
      sources: Array.from(item.sources),
    }))
    .slice(0, 8);
}

function normalizeAiEmergentSentiments(ai) {
  const items = Array.isArray(ai?.emergentSentiments?.emergent_sentiments)
    ? ai.emergentSentiments.emergent_sentiments
    : [];

  return uniqueBy(
    items
      .map(normalizeAiEmergentSentiment)
      .filter(Boolean),
    (item) => item.normalizedLabel,
  ).slice(0, 6);
}

function normalizeAiEmergentSentiment(item) {
  const label = String(item?.label || item?.normalized_label || "").replace(/\s+/g, " ").trim();
  const normalizedLabel = normalizeText(item?.normalized_label || label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!label || !normalizedLabel || KNOWN_CUSTOMER_SENTIMENT_CODES.has(normalizedLabel)) return null;

  const evidence = Array.isArray(item.evidence)
    ? item.evidence.map((value) => truncateText(value, 180)).filter(Boolean).slice(0, 4)
    : [];
  const mergedFrom = Array.isArray(item.merged_from)
    ? item.merged_from.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const signals = Math.max(0, Math.round(Number(item.signals || 0)), evidence.length);
  const hasSufficientEvidence = item.has_sufficient_evidence === true || signals >= 2;
  if (!hasSufficientEvidence || signals < 2) return null;

  return {
    label,
    normalizedLabel,
    polarity: normalizePolarity(item.polarity),
    signals,
    confidence: normalizeEmergentConfidence(item.confidence),
    mergedFrom,
    sourceTypes: Array.isArray(item.source_types)
      ? item.source_types.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 5)
      : [],
    issueCategory: normalizeIssueCode(item.issue_category || `emergent_sentiment_${normalizedLabel}`),
    merchantSummary: truncateText(item.merchant_summary || item.summary || `${label} appeared in repeated customer language.`, 220),
    evidence,
    suggestedAction: item.suggested_action || "Review emergent customer sentiment",
  };
}

function normalizeEmotionCode(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function getEmotionLabel(code) {
  const labels = {
    frustration: "Frustration",
    disappointment: "Disappointment",
    anger: "Anger",
    fear: "Fear",
    confusion: "Confusion",
    distrust: "Distrust",
    regret: "Regret",
    uncertainty: "Uncertainty",
    indifference: "Indifference",
    satisfaction: "Satisfaction",
    trust: "Trust",
    relief: "Relief",
    delight: "Delight",
  };
  return labels[code] || capitalize(String(code || "Emotion").replace(/_/g, " "));
}

function getEmotionPolarity(code) {
  if (["satisfaction", "trust", "relief", "delight"].includes(code)) return "positive";
  if (["uncertainty", "indifference"].includes(code)) return "neutral";
  return "negative";
}

function formatEmotionCounts(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.label && Number(item.count || item.signals || 0) > 0)
    .map((item) => `${item.label} ${Number(item.count || item.signals || 0)}`)
    .join(", ");
}

function normalizePolarity(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("positive")) return "positive";
  if (normalized.includes("mixed")) return "mixed";
  if (normalized.includes("neutral")) return "neutral";
  return "negative";
}

function normalizeEmergentConfidence(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("low")) return "low";
  return "medium";
}

function normalizeEmergentSentimentSeverity(item) {
  if (item.polarity === "positive") return "low";
  if (item.confidence === "high" && item.signals >= 4) return "high";
  if (item.polarity === "negative" && item.signals >= 2) return "medium";
  return "low";
}

function getEmergentSentimentConfidenceScore(item, baseConfidence, index) {
  const confidenceLift = item.confidence === "high" ? 8 : item.confidence === "low" ? -8 : 0;
  const signalLift = Math.min(8, item.signals * 2);
  return Math.max(38, Math.min(92, baseConfidence - 12 - index * 3 + confidenceLift + signalLift));
}

function getIssueTrend(deterministic, issueCode) {
  const issueSignalTrends = deterministic.metrics.issueSignalTrends || {};
  const directTrend = issueSignalTrends[issueCode]?.trend || issueSignalTrends[issueCode];

  if (Array.isArray(directTrend) && directTrend.length) return directTrend;
  if (issueCode === deterministic.mainIssue && Array.isArray(deterministic.metrics.signalTrend)) {
    return deterministic.metrics.signalTrend;
  }
  return [];
}

function buildFinalEvidence({ deterministic, ai, judgeMeData, csvReviewData, shopifyData }) {
  const textInsights = deterministic.metrics.textInsights || {};
  const aiKnownEmotions = normalizeAiKnownEmotions(ai, textInsights);
  const aiEmergentSentiments = normalizeAiEmergentSentiments(ai);
  const evidence = [{
    source: "Shopify product",
    quote: `${deterministic.metrics.productType || "Product"}${deterministic.metrics.vendor ? ` by ${deterministic.metrics.vendor}` : ""}`,
    weight: `${deterministic.metrics.variantCount || 0} variants, ${deterministic.metrics.skuCount || 0} SKUs`,
  }];

  if (deterministic.metrics.soldUnits > 0) {
    evidence.push({
      source: "Shopify orders",
      quote: `${deterministic.metrics.soldUnits} units sold in the scan window`,
      weight: `${DIAGNOSIS_WINDOW_DAYS}-day order window`,
    });
  }

  if (deterministic.metrics.returnUnits > 0 || deterministic.metrics.topReturnReasons.length) {
    const returnInsights = textInsights.returns || {};
    const otherClassifications = Array.isArray(textInsights.otherReturnClassifications) ? textInsights.otherReturnClassifications : [];
    evidence.push({
      source: "Shopify returns",
      quote: deterministic.metrics.topReturnReasons.length ? deterministic.metrics.topReturnReasons.join(", ") : "Return units detected",
      weight: `${deterministic.metrics.returnUnits} return units, ${deterministic.metrics.returnRate}% return rate`,
      points: [
        returnInsights.sentiment?.total
          ? `Return-note sentiment: ${returnInsights.sentiment.negative} negative, ${returnInsights.sentiment.neutral} neutral, ${returnInsights.sentiment.positive} positive`
          : "",
        returnInsights.emotions?.length
          ? `Return-note emotions: ${formatEmotionCounts(returnInsights.emotions)}`
          : "",
        returnInsights.subjectiveNegativity?.count
          ? `Subjective return-note reactions: ${returnInsights.subjectiveNegativity.count} of ${returnInsights.subjectiveNegativity.total}`
          : "",
        ...otherClassifications.map((item) => `"Other" notes classified as ${item.label} ${item.count} time${item.count === 1 ? "" : "s"}`),
        ...((returnInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated return language: "${item.term}" (${item.count})`)),
        ...((returnInsights.examples || []).slice(0, 3).map((item) => `Return text: "${item.text}"`)),
      ].filter(Boolean),
    });
  }

  if (deterministic.metrics.refundUnits > 0 || deterministic.metrics.refundAmount > 0) {
    const refundInsights = deterministic.metrics.refundInsights || {};
    evidence.push({
      source: "Shopify refunds",
      quote: `${formatMoney(deterministic.metrics.refundAmount)} refunded`,
      weight: `${deterministic.metrics.refundUnits} refunded units, ${deterministic.metrics.refundRate}% refund rate`,
      points: [
        refundInsights.highPressure
          ? `High refund pressure: ${refundInsights.refundRate}% refund rate across ${refundInsights.soldUnits} sold units`
          : "",
        refundInsights.noteCount
          ? `Operational refund notes: ${refundInsights.noteCount} analyzed`
          : "",
        refundInsights.reasonCount
          ? `Refund reasons/restock context: ${refundInsights.reasonCount} signal${refundInsights.reasonCount === 1 ? "" : "s"} analyzed`
          : "",
        refundInsights.sentiment?.total
          ? `Refund-note tone: ${refundInsights.sentiment.negative} negative, ${refundInsights.sentiment.neutral} neutral, ${refundInsights.sentiment.positive} positive`
          : "",
        ...((refundInsights.topReasons || []).slice(0, 3).map((item) => `Refund reason/context: "${item.label}" (${item.count})`)),
        ...((refundInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated refund-note language: "${item.term}" (${item.count})`)),
        ...((refundInsights.examples || []).slice(0, 3).map((item) => `Refund note: "${item.text}"`)),
      ].filter(Boolean),
    });
  }

  buildReviewEvidenceEntries({ deterministic, textInsights, judgeMeData, csvReviewData }).forEach((entry) => evidence.push(entry));

  if (textInsights.sentiment?.total || textInsights.repeatedLanguage?.length || ai.classification?.sentiment_summary?.summary) {
    evidence.push({
      source: "Customer language analysis",
      quote: ai.classification?.sentiment_summary?.summary || `Dominant sentiment: ${textInsights.sentiment?.dominant || "neutral"}`,
      weight: `${textInsights.sentiment?.total || 0} customer text signal${textInsights.sentiment?.total === 1 ? "" : "s"} analyzed`,
      points: [
        textInsights.sentiment?.total
          ? `${textInsights.sentiment.negative} negative, ${textInsights.sentiment.neutral} neutral, ${textInsights.sentiment.positive} positive text signals`
          : "",
        textInsights.returns?.sentiment?.total
          ? `Returns sentiment: ${textInsights.returns.sentiment.negative} negative, ${textInsights.returns.sentiment.neutral} neutral, ${textInsights.returns.sentiment.positive} positive`
          : "",
        textInsights.reviews?.sentiment?.total
          ? `Reviews sentiment: ${textInsights.reviews.sentiment.negative} negative, ${textInsights.reviews.sentiment.neutral} neutral, ${textInsights.reviews.sentiment.positive} positive`
          : "",
        deterministic.metrics.refundInsights?.noteCount
          ? `Refund-note patterns: ${deterministic.metrics.refundInsights.noteCount} operational note${deterministic.metrics.refundInsights.noteCount === 1 ? "" : "s"} analyzed separately from customer sentiment`
          : "",
        deterministic.metrics.refundInsights?.reasonCount
          ? `Refund reason/context patterns: ${deterministic.metrics.refundInsights.reasonCount} operational signal${deterministic.metrics.refundInsights.reasonCount === 1 ? "" : "s"} analyzed separately from customer sentiment`
          : "",
        textInsights.emotions?.length
          ? `Known emotion taxonomy: ${formatEmotionCounts(textInsights.emotions)}`
          : "",
        textInsights.subjectiveNegativity?.count
          ? `Subjective negative reactions: ${textInsights.subjectiveNegativity.count} of ${textInsights.subjectiveNegativity.total} customer text signals`
          : "",
        aiKnownEmotions.length
          ? `AI emotion taxonomy: ${formatEmotionCounts(aiKnownEmotions)}`
          : "",
        ...((Array.isArray(textInsights.otherReturnClassifications) ? textInsights.otherReturnClassifications : []).slice(0, 5).map((item) => `"Other" return notes classified as ${item.label} ${item.count} time${item.count === 1 ? "" : "s"}`)),
        ...((textInsights.repeatedLanguage || []).slice(0, 5).map((item) => `"${item.term}" repeated ${item.count} time${item.count === 1 ? "" : "s"} across ${item.sources.join(" and ")}`)),
        ...getFilteredAiRepeatedLanguage(ai).slice(0, 3).map((item) => `AI repeated-language finding: "${item.term}" - ${item.explanation || item.sentiment || "review"}`),
        ...aiEmergentSentiments.slice(0, 4).map((item) => `Emergent sentiment: ${item.label} (${item.signals} signal${item.signals === 1 ? "" : "s"}) - ${item.merchantSummary}`),
      ].filter(Boolean),
    });
  }

  if (deterministic.metrics.affectedVariants.length) {
    evidence.push({
      source: "Variants",
      quote: deterministic.metrics.affectedVariants.join(", "),
      weight: "Signals are concentrated by variant/SKU.",
    });
  }

  if (deterministic.metrics.contentAnalysis?.issues?.length) {
    const contentAnalysis = deterministic.metrics.contentAnalysis;
    evidence.push({
      source: "Product content",
      quote: contentAnalysis.summary || contentAnalysis.issues.map((issue) => issue.label).join(", "),
      weight: `${deterministic.metrics.descriptionWordCount || 0} description words, content score ${contentAnalysis.score}/100`,
    });
  }

  if (shopifyData.orderAccessDenied) {
    evidence.push({
      source: "Shopify order access",
      quote: "Order access was denied by Shopify for this app installation.",
      weight: "ProductPulse reused stored QuickScan metrics where available.",
    });
  }

  if (ai.report?.evidence_summary) {
    evidence.push({
      source: "AI evidence synthesis",
      quote: ai.report.evidence_summary,
      weight: "Generated from deterministic metrics and stored snippets.",
    });
  }

  return evidence.slice(0, 8);
}

function buildReviewEvidenceEntries({ deterministic, textInsights, judgeMeData, csvReviewData }) {
  const stats = deterministic.metrics.reviewSourceStats || {};
  const reviewInsights = textInsights.reviews || {};
  const entries = [];
  const sources = [
    { key: "judgeMe", label: "Judge.me reviews", connected: Boolean(judgeMeData?.connected) },
    { key: "csv", label: "CSV reviews", connected: Boolean(csvReviewData?.connected) },
  ];

  sources.forEach((source) => {
    const sourceStats = stats[source.key] || {};
    if (!sourceStats.reviewCount) return;

    entries.push({
      source: source.label,
      quote: `${sourceStats.negativeReviewCount || 0} negative reviews out of ${sourceStats.reviewCount || 0}`,
      weight: `${sourceStats.avgRating || 0} average rating, ${sourceStats.negativeReviewRate || 0}% negative review rate`,
      points: [
        sourceStats.recentNegativeReviewCount
          ? `${sourceStats.recentNegativeReviewCount} recent negative review${sourceStats.recentNegativeReviewCount === 1 ? "" : "s"}`
          : "",
        source.key === "csv" && sourceStats.reviewCount
          ? "CSV review text, rating and review date were included in AI classification."
          : "",
        source.key === "judgeMe" && sourceStats.reviewCount
          ? "Judge.me review text, rating and review date were included in AI classification."
          : "",
        ...getReviewExamplesForSource(reviewInsights, source.key),
      ].filter(Boolean),
    });
  });

  if (!entries.length && deterministic.metrics.reviewCount > 0) {
    entries.push({
      source: "Reviews",
      quote: `${deterministic.metrics.negativeReviewCount} negative reviews out of ${deterministic.metrics.reviewCount}`,
      weight: `${deterministic.metrics.avgRating || 0} average rating, ${deterministic.metrics.negativeReviewRate}% negative review rate`,
    });
  }

  if (entries.length && reviewInsights.sentiment?.total) {
    entries[0].points = [
      `Review sentiment: ${reviewInsights.sentiment.negative} negative, ${reviewInsights.sentiment.neutral} neutral, ${reviewInsights.sentiment.positive} positive`,
      reviewInsights.emotions?.length ? `Review emotions: ${formatEmotionCounts(reviewInsights.emotions)}` : "",
      ...((reviewInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated review language: "${item.term}" (${item.count})`)),
      ...(entries[0].points || []),
    ].filter(Boolean);
  }

  return entries;
}

function getReviewEvidenceLabel(metrics = {}) {
  const hasJudgeMe = Number(metrics.judgeMeReviewCount || 0) > 0;
  const hasCsv = Number(metrics.csvReviewCount || 0) > 0;
  if (hasJudgeMe && hasCsv) return "Connected reviews";
  if (hasCsv) return "CSV reviews";
  if (hasJudgeMe) return "Judge.me reviews";
  return "Reviews";
}

function getReviewExamplesForSource(reviewInsights, sourceKey) {
  const sourceType = sourceKey === "csv" ? "csv_review" : "judgeme_review";
  return (Array.isArray(reviewInsights.examples) ? reviewInsights.examples : [])
    .filter((item) => !item.source || item.source === sourceType)
    .slice(0, 3)
    .map((item) => `Review text: "${item.text}"`);
}

function buildCheckedSources(deterministic) {
  return deterministic.sourceCoverage.map((source) => ({
    source,
    checked: true,
    windowDays: source.toLowerCase().includes("order") || source.toLowerCase().includes("return") || source.toLowerCase().includes("refund")
      ? DIAGNOSIS_WINDOW_DAYS
      : null,
  }));
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

async function judgeMeGet({ baseUrl, path, shop, token, params = {} }) {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("shop_domain", shop);
  url.searchParams.set("api_token", token);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });

  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || json.message || `Judge.me request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return json;
}

function normalizeShopifyProduct(product, snapshot) {
  if (!product) return normalizeSnapshotProduct(snapshot);
  const variants = getNodes(product.variants).map((variant) => ({
    id: variant.id,
    numericId: String(variant.legacyResourceId || extractNumericShopifyId(variant.id) || ""),
    title: variant.title || "",
    sku: variant.sku || "",
    price: normalizeMoneyValue(variant.price),
    compareAtPrice: normalizeMoneyValue(variant.compareAtPrice),
    inventoryQuantity: Number.isFinite(Number(variant.inventoryQuantity)) ? Number(variant.inventoryQuantity) : null,
    inventoryPolicy: variant.inventoryPolicy || "",
    inventoryItemId: variant.inventoryItem?.id || "",
    inventoryTracked: Boolean(variant.inventoryItem?.tracked),
    selectedOptions: variant.selectedOptions || [],
  }));
  const media = getNodes(product.media).map((item) => {
    const image = item.image || item.preview?.image || {};
    return {
      id: item.id || "",
      alt: item.alt || image.altText || "",
      mediaContentType: item.mediaContentType || "",
      status: item.status || "",
      url: image.url || "",
      width: Number(image.width || 0),
      height: Number(image.height || 0),
    };
  });

  return {
    id: product.id || snapshot.productGid,
    numericId: String(product.legacyResourceId || extractNumericShopifyId(product.id) || ""),
    title: product.title || snapshot.productTitle,
    handle: product.handle || snapshot.handle,
    description: cleanProductDescription(product),
    descriptionHtml: String(product.descriptionHtml || ""),
    vendor: product.vendor || "",
    productType: product.productType || "",
    status: product.status || "Unknown",
    tags: Array.isArray(product.tags) ? product.tags : [],
    options: Array.isArray(product.options) ? product.options : [],
    variants,
    collections: getNodes(product.collections).map((collection) => collection.title).filter(Boolean),
    metafields: getNodes(product.metafields).map((metafield) => ({
      namespace: metafield.namespace,
      key: metafield.key,
      type: metafield.type,
      value: String(metafield.value || "").slice(0, 500),
    })),
    media,
  };
}

function normalizeSnapshotProduct(snapshot) {
  const metrics = snapshot.metrics || {};
  return {
    id: snapshot.productGid,
    numericId: extractNumericShopifyId(snapshot.productGid),
    title: snapshot.productTitle,
    handle: snapshot.handle,
    description: "",
    descriptionHtml: "",
    vendor: metrics.vendor || "",
    productType: metrics.productType || "",
    status: "Unknown",
    tags: Array.isArray(metrics.tags) ? metrics.tags : [],
    options: [],
    variants: [],
    collections: Array.isArray(metrics.collections) ? metrics.collections : [],
    metafields: [],
    media: [],
  };
}

function cleanProductDescription(product = {}) {
  const plainDescription = String(product.description || "").trim();
  if (plainDescription) return stripHtml(plainDescription);
  return stripHtml(product.descriptionHtml || "");
}

function normalizeMoneyValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return Number(value.amount || value.value || 0);
  const amount = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function lineItemMatchesProduct(lineItem, product, snapshot) {
  const lineProduct = lineItem?.product || {};
  const variantProduct = lineItem?.variant?.product || {};
  if (lineProduct.id && (lineProduct.id === product.id || lineProduct.id === snapshot.productGid)) return true;
  if (variantProduct.id && (variantProduct.id === product.id || variantProduct.id === snapshot.productGid)) return true;
  if (lineProduct.handle && (lineProduct.handle === product.handle || lineProduct.handle === snapshot.handle)) return true;
  if (variantProduct.handle && (variantProduct.handle === product.handle || variantProduct.handle === snapshot.handle)) return true;
  const numericProductId = product.numericId || extractNumericShopifyId(snapshot.productGid);
  if (numericProductId && String(lineProduct.id || "").endsWith(`/${numericProductId}`)) return true;
  if (numericProductId && String(lineProduct.legacyResourceId || "") === String(numericProductId)) return true;
  if (numericProductId && String(variantProduct.id || "").endsWith(`/${numericProductId}`)) return true;
  if (numericProductId && String(variantProduct.legacyResourceId || "") === String(numericProductId)) return true;

  const lineSku = normalizeText(lineItem?.sku || lineItem?.variant?.sku || "");
  const productSkus = new Set((product.variants || []).map((variant) => normalizeText(variant.sku)).filter(Boolean));
  if (lineSku && productSkus.has(lineSku)) return true;

  const lineVariantId = extractNumericShopifyId(lineItem?.variant?.id);
  const productVariantIds = new Set((product.variants || []).flatMap((variant) => [
    String(variant.id || ""),
    String(variant.numericId || ""),
    extractNumericShopifyId(variant.id),
  ]).filter(Boolean));
  if (lineVariantId && productVariantIds.has(lineVariantId)) return true;

  const lineTitle = normalizeText(lineItem?.title);
  const productTitle = normalizeText(product.title || snapshot.productTitle);
  if (lineTitle && productTitle && (lineTitle === productTitle || lineTitle.includes(productTitle) || productTitle.includes(lineTitle))) return true;
  if (hasStrongTextOverlap(lineTitle, productTitle)) return true;

  const handleAsTitle = normalizeText(product.handle || snapshot.handle).replace(/-/g, " ");
  return hasStrongTextOverlap(lineTitle, handleAsTitle);
}

function getReturnReasonValue(returnLineItem) {
  const definition = returnLineItem?.returnReasonDefinition || {};
  return String(definition.handle || returnLineItem?.returnReason || definition.name || "").trim();
}

function getReturnReasonLabel(returnLineItem) {
  const definition = returnLineItem?.returnReasonDefinition || {};
  return String(definition.name || definition.handle || returnLineItem?.returnReason || "").trim();
}

function getReturnLineItemReasonNote(returnLineItem) {
  return String(returnLineItem?.returnReasonNote || "").replace(/\s+/g, " ").trim();
}

function getReturnLineItemCustomerNote(returnLineItem) {
  return String(returnLineItem?.customerNote || "").replace(/\s+/g, " ").trim();
}

function getReturnLineItemNoteText(returnLineItem) {
  return [getReturnLineItemReasonNote(returnLineItem), getReturnLineItemCustomerNote(returnLineItem)].filter(Boolean).join(" ");
}

function getRefundAdjustmentReasons(refund = {}) {
  return getNodes(refund.orderAdjustments)
    .map((adjustment) => normalizeRefundReasonLabel(adjustment.reason))
    .filter((reason) => reason && !isDefaultCustomerLanguageTerm(reason));
}

function getRefundNoteText(item = {}) {
  return String(item.note || item.refundNote || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getRefundReasonText(item = {}) {
  const reasons = [
    ...(Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : []),
    item.reasonLabel,
    item.reason,
    normalizeRefundReasonLabel(item.restockType),
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value));

  return uniqueBy(reasons, (value) => normalizeText(value)).join(" - ");
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

function extractJudgeMeProduct(json) {
  return json?.product || json?.data?.product || json?.data || json || null;
}

function extractJudgeMeReviews(json) {
  const candidates = [
    json?.reviews,
    json?.data?.reviews,
    json?.product_reviews,
    json?.data?.product_reviews,
    json?.review ? [json.review] : null,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function normalizeJudgeMeReview(review, snapshot, product) {
  if (!review) return null;
  const body = stripHtml(review.body || review.review || review.content || review.text || "");
  const title = review.title || review.review_title || "";
  return {
    id: String(review.id || review.review_id || `${snapshot.productGid}-${title}-${body}`),
    rating: Number(review.rating || review.score || 0),
    title,
    body,
    createdAt: toIso(review.created_at || review.createdAt || review.date),
    published: review.published ?? review.published_at ?? true,
    productId: String(review.product_id || review.product?.id || ""),
    externalProductId: String(review.external_product_id || review.product_external_id || review.product?.external_id || product.numericId || ""),
    handle: review.product_handle || review.handle || review.product?.handle || snapshot.handle,
    photos: review.pictures || review.photos || review.images || [],
    sourceType: "judgeme_review",
    sourceLabel: "Judge.me reviews",
  };
}

function normalizeCsvDiagnosisReview(row, snapshot, product, matchConfidence = 0) {
  if (!row) return null;
  const body = stripHtml(row.reviewBody || "");
  const title = stripHtml(row.reviewTitle || "");
  const rating = Number(row.rating || 0);
  if (!rating || (!body && !title)) return null;

  return {
    id: String(row.id || `csv-${snapshot.productGid}-${row.sourceRow || title}-${body}`),
    rating,
    title,
    body,
    createdAt: toIso(row.reviewDate),
    published: true,
    productId: String(row.sourceProductId || ""),
    externalProductId: String(row.shopifyProductId || product.numericId || ""),
    handle: row.productHandle || snapshot.handle,
    reviewerName: row.reviewerName || "",
    reviewStatus: row.reviewStatus || "",
    sourceProductId: row.sourceProductId || "",
    sourceRow: row.sourceRow || null,
    sourceType: "csv_review",
    sourceLabel: "CSV reviews",
    matchConfidence,
    photos: [],
  };
}

function normalizeReviewSource(review, sourceType, sourceLabel) {
  return {
    ...review,
    sourceType: review.sourceType || sourceType,
    sourceLabel: review.sourceLabel || sourceLabel,
  };
}

function getReturnCustomerLanguageText(item) {
  const rawReason = String(item?.reason || item?.reasonLabel || "").replace(/\s+/g, " ").trim();
  const reason = isGenericOtherReason(rawReason) || isDefaultCustomerLanguageTerm(rawReason)
    ? ""
    : rawReason;
  const noteText = [item?.reasonNote, item?.customerNote]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return [reason, noteText].filter(Boolean).join(" - ");
}

function getRefundOperationalText(item) {
  return [getRefundNoteText(item), getRefundReasonText(item)].filter(Boolean).join(" - ");
}

function getCustomerAnalysisText(item) {
  return String(item?.analysisText || item?.noteText || item?.text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getJudgeMeReviewMatchConfidence(review, snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "");
  const identifiers = [
    review.external_product_id,
    review.product_external_id,
    review.external_id,
    review.product?.external_id,
    review.product?.id,
  ].map((value) => String(value || ""));
  if (numericId && identifiers.includes(numericId)) return 1;

  const handle = String(snapshot.handle || product.handle || "").toLowerCase();
  const reviewHandle = String(review.product_handle || review.handle || review.product?.handle || "").toLowerCase();
  if (handle && reviewHandle === handle) return 0.9;

  const reviewUrl = String(review.product_url || review.url || "").toLowerCase();
  if (handle && reviewUrl.includes(`/${handle}`)) return 0.86;

  const title = normalizeText(snapshot.productTitle || product.title);
  const reviewTitle = normalizeText(review.product_title || review.product?.title || "");
  if (title && reviewTitle && title === reviewTitle) return 0.82;
  if (title && reviewTitle && (title.includes(reviewTitle) || reviewTitle.includes(title))) return 0.76;
  return 0;
}

function getCsvReviewMatchConfidence(row, snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "");
  const productGid = String(product.id || snapshot.productGid || "").toLowerCase();
  const csvProductId = String(row.shopifyProductId || "").trim().toLowerCase();
  const csvProductNumericId = extractNumericShopifyId(csvProductId) || csvProductId;
  if (csvProductId && (csvProductId === productGid || csvProductId === String(snapshot.productGid || "").toLowerCase())) return 1;
  if (numericId && csvProductNumericId && csvProductNumericId === numericId) return 1;

  const handle = String(snapshot.handle || product.handle || "").trim().toLowerCase();
  const csvHandle = String(row.productHandle || "").trim().toLowerCase();
  if (handle && csvHandle === handle) return 0.94;
  if (handle && csvHandle && normalizeText(csvHandle).replace(/\s+/g, "-") === handle) return 0.9;
  return 0;
}

function buildReviewSourceStats(reviews = []) {
  const empty = { reviewCount: 0, negativeReviewCount: 0, avgRating: 0, negativeReviewRate: 0, recentNegativeReviewCount: 0 };
  const stats = {
    judgeMe: { ...empty },
    csv: { ...empty },
    total: { ...empty },
  };

  reviews.forEach((review) => {
    const key = review.sourceType === "csv_review" ? "csv" : "judgeMe";
    addReviewToStats(stats[key], review);
    addReviewToStats(stats.total, review);
  });

  Object.keys(stats).forEach((key) => finalizeReviewStats(stats[key]));
  return stats;
}

function addReviewToStats(stats, review) {
  stats.reviewCount += 1;
  stats.ratingSum = Number(stats.ratingSum || 0) + Number(review.rating || 0);
  const negative = Number(review.rating || 0) <= 2 || containsIssueLanguage(review.body);
  if (negative) stats.negativeReviewCount += 1;
  if (negative && isRecentDate(review.createdAt, 30)) stats.recentNegativeReviewCount += 1;
}

function finalizeReviewStats(stats) {
  stats.avgRating = roundRate(stats.reviewCount ? Number(stats.ratingSum || 0) / stats.reviewCount : 0, 1);
  stats.negativeReviewRate = roundRate(stats.reviewCount ? (stats.negativeReviewCount / stats.reviewCount) * 100 : 0);
  delete stats.ratingSum;
  return stats;
}

function buildSignalEvents({ returns, refunds, negativeReviews }) {
  return [
    ...returns.map((item) => {
      const text = getReturnCustomerLanguageText(item);
      return {
        type: "return",
        createdAt: item.createdAt,
        value: Number(item.quantity || 1),
        text,
        issueCode: classifyIssueText(text),
      };
    }),
    ...refunds.map((item) => {
      const text = getRefundOperationalText(item) || "Refund impact";
      const issueCode = classifyIssueText(text);
      return {
        type: "refund",
        createdAt: item.createdAt,
        value: Number(item.quantity || 1),
        text,
        issueCode: issueCode === "product_quality" ? "refund_impact" : issueCode,
      };
    }),
    ...negativeReviews.map((item) => {
      const text = [item.title, item.body].filter(Boolean).join(" ");
      return {
        type: "review",
        createdAt: item.createdAt,
        value: 1,
        text,
        issueCode: classifyIssueText(text),
      };
    }),
  ].filter((item) => item.createdAt && String(item.text || "").trim());
}

function buildIssueSignalCounts({ returns, refunds, reviews }) {
  const counts = {};
  [...returns, ...reviews].forEach((item) => {
    const text = item.source === "returns" || item.reason || item.reasonNote || item.customerNote
      ? getReturnCustomerLanguageText(item)
      : [item.title, item.body].filter(Boolean).join(" ");
    if (!text.trim()) return;
    const issue = classifyIssueText(text);
    counts[issue] = (counts[issue] || 0) + 1;
  });
  refunds.forEach((item) => {
    const text = getRefundOperationalText(item) || "Refund impact";
    const issue = classifyIssueText(text);
    const issueCode = issue === "product_quality" ? "refund_impact" : issue;
    counts[issueCode] = (counts[issueCode] || 0) + Number(item.quantity || 1);
  });
  return counts;
}

function buildCustomerTextInsights({ returns = [], reviews = [] }) {
  const returnTexts = returns
    .map((item) => {
      const reason = String(item.reason || "").trim();
      const noteText = [item.reasonNote, item.customerNote].filter(Boolean).join(" ");
      const isOther = isGenericOtherReason(reason);
      const analysisText = getReturnCustomerLanguageText(item);
      const text = analysisText || noteText;
      if (!analysisText.trim()) return null;
      const issueCode = classifyIssueText(analysisText);
      return {
        source: "returns",
        text,
        analysisText,
        reason,
        noteText,
        issueCode,
        sentiment: classifyCustomerSentiment(analysisText),
        emotion: classifyCustomerEmotion(analysisText),
        subjectiveNegative: isSubjectiveNegativeText(analysisText),
        createdAt: item.createdAt,
        variant: item.variantTitle || item.sku || "",
        isOther,
      };
    })
    .filter(Boolean);
  const reviewTexts = reviews
    .map((review) => {
      const text = [review.title, review.body].filter(Boolean).join(" - ");
      if (!text.trim()) return null;
      return {
        source: review.sourceType || "reviews",
        sourceLabel: review.sourceLabel || "Reviews",
        text,
        analysisText: text,
        rating: Number(review.rating || 0),
        issueCode: classifyIssueText(text),
        sentiment: classifyCustomerSentiment(text, Number(review.rating || 0)),
        emotion: classifyCustomerEmotion(text, Number(review.rating || 0)),
        subjectiveNegative: isSubjectiveNegativeText(text),
        createdAt: review.createdAt,
      };
    })
    .filter(Boolean);
  const allTexts = [...returnTexts, ...reviewTexts];
  const sentiment = summarizeSentiment(allTexts);
  const emotions = summarizeEmotionCounts(allTexts);
  const returnsSummary = summarizeTextSource(returnTexts);
  const reviewsSummary = summarizeTextSource(reviewTexts);
  const subjectiveNegativity = summarizeSubjectiveNegativity(allTexts);
  const otherReturnClassifications = summarizeOtherReturnClassifications(returnTexts);
  const repeatedLanguage = extractRepeatedLanguage(allTexts);
  const granularIssues = buildDeterministicTextIssues({
    sentiment,
    returnsSummary,
    reviewsSummary,
    subjectiveNegativity,
    otherReturnClassifications,
    repeatedLanguage,
  });

  return {
    sentiment,
    emotions,
    returns: returnsSummary,
    reviews: reviewsSummary,
    subjectiveNegativity,
    otherReturnClassifications,
    repeatedLanguage,
    granularIssues,
  };
}

function buildRefundOperationalInsights({ refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0 }) {
  const refundTexts = refunds
    .map((item) => {
      const text = getRefundOperationalText(item);
      if (!text.trim()) return null;
      const noteText = getRefundNoteText(item);
      const reasonText = getRefundReasonText(item);
      return {
        source: "refunds",
        text,
        analysisText: text,
        issueCode: classifyIssueText(text),
        sentiment: classifyCustomerSentiment(text),
        emotion: classifyCustomerEmotion(text),
        createdAt: item.createdAt,
        variant: item.variantTitle || item.sku || "",
        amount: Number(item.amount || 0),
        restockType: item.restockType || "",
        noteText,
        reasonText,
        adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : [],
      };
    })
    .filter(Boolean);
  const refundReasons = countTopValues(refunds.flatMap((item) => [
    getRefundReasonText(item),
    ...(Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : []),
    normalizeRefundReasonLabel(item.restockType),
  ]).filter((value) => value && !isDefaultCustomerLanguageTerm(value)), 5);
  const sentiment = summarizeSentiment(refundTexts);
  const repeatedLanguage = extractRepeatedLanguage(refundTexts).slice(0, 5);
  const issueCounts = countTopValues(refundTexts.map((item) => item.issueCode).filter(Boolean), 5);
  const highPressure = Number(soldUnits || 0) > 10 && Number(refundRate || 0) > 20;
  const monitorPressure = Number(refundUnits || 0) >= 3 && Number(refundRate || 0) >= 10;
  const dominantIssue = issueCounts[0]?.label || "refund_impact";
  const noteCount = refundTexts.filter((item) => item.noteText).length;
  const reasonCount = refundReasons.reduce((total, item) => total + Number(item.count || 0), 0);
  const riskLift = calculateRefundOperationalRiskLift({ refundUnits, refundRate, soldUnits, noteCount: Math.max(noteCount, reasonCount) });

  return {
    total: Number(refundUnits || 0),
    noteCount,
    reasonCount,
    textSignalCount: refundTexts.length,
    refundRate: Number(refundRate || 0),
    refundAmount: Number(refundAmount || 0),
    soldUnits: Number(soldUnits || 0),
    highPressure,
    monitorPressure,
    level: highPressure ? "high" : monitorPressure ? "monitor" : "low",
    shouldSurface: highPressure || (monitorPressure && Number(refundUnits || 0) >= 3) || refundTexts.length >= 2 || Number(refundUnits || 0) >= 3,
    dominantIssueCode: normalizeIssueCode(dominantIssue) || "refund_impact",
    sentiment,
    repeatedLanguage,
    issueCounts,
    topReasons: refundReasons,
    riskLift,
    examples: refundTexts.slice(0, 4).map((item) => ({
      text: truncateText(item.text, 180),
      noteText: truncateText(item.noteText, 180),
      reasonText: truncateText(item.reasonText, 180),
      sentiment: item.sentiment,
      emotion: item.emotion,
      issueCode: item.issueCode,
      variant: item.variant || "",
      amount: item.amount,
      adjustmentReasons: item.adjustmentReasons,
    })),
  };
}

function calculateRefundOperationalRiskLift({ refundUnits = 0, refundRate = 0, soldUnits = 0, noteCount = 0 }) {
  const units = Number(refundUnits || 0);
  const rate = Number(refundRate || 0);
  if (units < 3) return 0;
  const noteSupport = noteCount >= 2 ? 1.2 : noteCount === 1 ? 0.5 : 0;
  if (Number(soldUnits || 0) > 10 && rate > 20) {
    return Math.min(10, 3.5 + (rate - 20) * 0.22 + Math.log2(units + 1) * 0.8 + noteSupport);
  }
  if (rate >= 10) {
    return Math.min(4, 1 + rate * 0.08 + Math.log2(units + 1) * 0.35 + noteSupport);
  }
  return 0;
}

function applyRefundInsightsToIssueCounts(issueSignalCounts, refundInsights) {
  if (!refundInsights?.shouldSurface) return;
  issueSignalCounts.refund_impact = Math.max(
    Number(issueSignalCounts.refund_impact || 0),
    Number(refundInsights.total || 0),
  );
  const dominantIssue = normalizeIssueCode(refundInsights.dominantIssueCode);
  if (dominantIssue && dominantIssue !== "product_quality" && dominantIssue !== "refund_impact") {
    issueSignalCounts[dominantIssue] = Math.max(
      Number(issueSignalCounts[dominantIssue] || 0),
      Math.max(2, Number(refundInsights.noteCount || 0)),
    );
  }
}

function summarizeTextSource(items) {
  const sentiment = summarizeSentiment(items);
  const emotions = summarizeEmotionCounts(items);
  return {
    total: items.length,
    sentiment,
    emotions,
    subjectiveNegativity: summarizeSubjectiveNegativity(items),
    repeatedLanguage: extractRepeatedLanguage(items).slice(0, 5),
    examples: items
      .filter((item) => item.sentiment === "negative" || item.isOther)
      .slice(0, 4)
      .map((item) => ({
        text: truncateText(item.text, 180),
        sentiment: item.sentiment,
        emotion: item.emotion,
        issueCode: item.issueCode,
        reason: item.reason || "",
        variant: item.variant || "",
        source: item.source || "",
        sourceLabel: item.sourceLabel || "",
      })),
  };
}

function summarizeEmotionCounts(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const code = normalizeEmotionCode(item.emotion);
    if (!code || code === "none") return;
    const current = grouped.get(code) || {
      code,
      label: getEmotionLabel(code),
      polarity: getEmotionPolarity(code),
      count: 0,
      sources: new Set(),
      examples: [],
    };
    current.count += 1;
    if (item.source) current.sources.add(item.source);
    if (current.examples.length < 3 && item.text) current.examples.push(truncateText(item.text, 140));
    grouped.set(code, current);
  });

  return Array.from(grouped.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => ({
      ...item,
      sources: Array.from(item.sources),
    }));
}

function summarizeSentiment(items) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  items.forEach((item) => {
    const sentiment = ["positive", "neutral", "negative"].includes(item.sentiment) ? item.sentiment : "neutral";
    counts[sentiment] += 1;
  });
  const total = items.length;
  const dominant = total
    ? Object.entries(counts).sort((first, second) => second[1] - first[1])[0][0]
    : "neutral";
  return {
    ...counts,
    total,
    dominant: counts.negative > 0 && counts.negative === counts.positive ? "mixed" : dominant,
    negativeRatio: total ? roundRate(counts.negative / total, 2) : 0,
  };
}

function summarizeSubjectiveNegativity(items) {
  const sourceCounts = {};
  const subjectiveItems = (Array.isArray(items) ? items : []).filter((item) => item?.subjectiveNegative);
  subjectiveItems.forEach((item) => {
    const source = item.source || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });
  const total = Array.isArray(items) ? items.length : 0;
  return {
    count: subjectiveItems.length,
    total,
    ratio: total ? roundRate(subjectiveItems.length / total, 2) : 0,
    sourceCounts,
    examples: subjectiveItems.slice(0, 4).map((item) => truncateText(item.noteText || item.text, 180)),
  };
}

function summarizeOtherReturnClassifications(returnTexts) {
  const otherItems = returnTexts.filter((item) => item.isOther && item.noteText);
  const grouped = new Map();
  otherItems.forEach((item) => {
    const key = item.issueCode || "product_quality";
    const current = grouped.get(key) || {
      issueCode: key,
      label: getHumanIssueLabel(key),
      count: 0,
      sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
      examples: [],
    };
    current.count += 1;
    current.sentimentCounts[item.sentiment] = (current.sentimentCounts[item.sentiment] || 0) + 1;
    if (current.examples.length < 3) current.examples.push(truncateText(item.noteText || item.text, 160));
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((first, second) => second.count - first.count).slice(0, 5);
}

function buildDeterministicTextIssues({ sentiment, returnsSummary, reviewsSummary, subjectiveNegativity, otherReturnClassifications, repeatedLanguage }) {
  const issues = [];

  if (otherReturnClassifications.length) {
    otherReturnClassifications.forEach((item) => {
      if (Number(item.count || 0) < MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return;
      const isSubjective = item.issueCode === "subjective_negative_reaction";
      const severity = isSubjective
        ? getSubjectiveIssueSeverity(subjectiveNegativity)
        : item.sentimentCounts.negative >= 2 || item.count >= 3 ? "medium" : "low";
      issues.push({
        issueCode: item.issueCode,
        issue: `"Other" returns indicate ${item.label}`,
        severity,
        signals: item.count,
        evidence: [
          `${item.count} generic return reason${item.count === 1 ? "" : "s"} reclassified from customer text as ${item.label}.`,
          isSubjective ? getSubjectiveEvidencePolicyText(subjectiveNegativity) : "",
          ...item.examples.map((example) => `Example: "${example}"`),
        ].filter(Boolean),
        action: "Review Other return notes",
        sourceTypes: ["shopify_return_note"],
      });
    });
  }

  if (hasActionableSubjectiveEvidence(subjectiveNegativity) && !otherReturnClassifications.some((item) => item.issueCode === "subjective_negative_reaction" && item.count >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE)) {
    issues.push({
      issueCode: "subjective_negative_reaction",
      issue: "Subjective negative customer reaction",
      severity: getSubjectiveIssueSeverity(subjectiveNegativity),
      signals: subjectiveNegativity.count,
      evidence: [
        `${subjectiveNegativity.count} of ${subjectiveNegativity.total} customer text signals are subjective negative reactions.`,
        getSubjectiveEvidencePolicyText(subjectiveNegativity),
        ...subjectiveNegativity.examples.map((example) => `Example: "${example}"`),
      ].filter(Boolean),
      action: hasActionableSubjectiveEvidence(subjectiveNegativity)
        ? "Review expectation-setting copy"
        : "Monitor for repeated subjective reactions",
      sourceTypes: Object.keys(subjectiveNegativity.sourceCounts || {}),
    });
  }

  if (sentiment.negative >= 2 && sentiment.negativeRatio >= 0.35) {
    const subjectiveOnly = subjectiveNegativity?.count >= sentiment.negative;
    if (!subjectiveOnly) {
      issues.push({
        issueCode: "negative_sentiment",
        issue: "Negative customer sentiment cluster",
        severity: sentiment.negativeRatio >= 0.6 ? "high" : "medium",
        signals: sentiment.negative,
        evidence: [
          `${sentiment.negative} of ${sentiment.total} customer text signals read as negative.`,
          `Returns: ${returnsSummary.sentiment.negative} negative. Reviews: ${reviewsSummary.sentiment.negative} negative.`,
        ].filter(Boolean),
        action: "Review customer sentiment evidence",
        sourceTypes: uniqueBy([
          returnsSummary.sentiment.negative > 0 ? "returns" : "",
          reviewsSummary.sentiment.negative > 0 ? "reviews" : "",
        ].filter(Boolean), (item) => item),
      });
    }
  }

  repeatedLanguage.slice(0, 3).forEach((item) => {
    if (item.count < 2) return;
    issues.push({
      issueCode: item.issueCode || "repeated_language",
      issue: `Repeated customer language: "${item.term}"`,
      severity: item.count >= 4 ? "medium" : "low",
      signals: item.count,
      evidence: [
        `"${item.term}" appears ${item.count} times across ${item.sources.join(" and ")}.`,
        item.example ? `Example context: "${item.example}"` : "",
      ].filter(Boolean),
      action: "Review repeated language",
      sourceTypes: item.sources,
    });
  });

  return issues;
}

function hasActionableSubjectiveEvidence(summary) {
  const count = Number(summary?.count || 0);
  const ratio = Number(summary?.ratio || 0);
  return count >= 4 || (count >= 2 && ratio >= 0.35);
}

function getSubjectiveIssueSeverity(summary) {
  const count = Number(summary?.count || 0);
  const ratio = Number(summary?.ratio || 0);
  if (count >= 8 && ratio >= 0.45) return "high";
  if (count >= 4 || (count >= 2 && ratio >= 0.35)) return "medium";
  return "low";
}

function getSubjectiveEvidencePolicyText(summary) {
  const count = Number(summary?.count || 0);
  if (count <= 1) {
    return "Subjective reactions are kept low-confidence until repeated by more customers.";
  }
  if (!hasActionableSubjectiveEvidence(summary)) {
    return "Subjective reactions are still below the action threshold and should be monitored.";
  }
  return "Subjective reactions are repeated enough to become merchant-facing evidence.";
}

function extractRepeatedLanguage(items) {
  const counts = new Map();
  items.forEach((item) => {
    const analysisText = getCustomerAnalysisText(item);
    if (!analysisText) return;
    const tokens = customerLanguageTokens(analysisText);
    const phrases = new Set([
      ...tokens.filter((token) => isUsefulRepeatedLanguageTerm(token)),
      ...tokens.slice(0, -1)
        .map((token, index) => `${token} ${tokens[index + 1]}`)
        .filter((term) => isUsefulRepeatedLanguageTerm(term)),
    ]);
    phrases.forEach((term) => {
      const current = counts.get(term) || {
        term,
        count: 0,
        sources: new Set(),
        issueCode: classifyIssueText(term),
        sentiments: { positive: 0, neutral: 0, negative: 0 },
        example: "",
      };
      current.count += 1;
      current.sources.add(item.source);
      current.sentiments[item.sentiment] = (current.sentiments[item.sentiment] || 0) + 1;
      if (!current.example) current.example = truncateText(analysisText, 140);
      counts.set(term, current);
    });
  });
  return Array.from(counts.values())
    .filter((item) => item.count >= 2)
    .sort((first, second) => second.count - first.count || second.sources.size - first.sources.size)
    .slice(0, 10)
    .map((item) => ({
      ...item,
      sources: Array.from(item.sources),
      dominantSentiment: Object.entries(item.sentiments).sort((first, second) => second[1] - first[1])[0]?.[0] || "neutral",
    }));
}

function customerLanguageTokens(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !CUSTOMER_TEXT_STOP_WORDS.has(token));
}

function classifyCustomerSentiment(text, rating = 0) {
  const normalized = normalizeText(text);
  const negativeMatches = countRegexMatches(normalized, /(bad|poor|cheap|thin|broken|defect|damage|damaged|disappointed|return|refund|small|large|tight|loose|wrong|issue|problem|unhappy|terrible|awful|not fit|doesn t fit|doesnt fit|not as pictured|late|scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/g);
  const positiveMatches = countRegexMatches(normalized, /(great|good|love|loved|perfect|excellent|happy|quality|comfortable|recommend|works well|beautiful)/g);
  if (rating > 0 && rating <= 2) return "negative";
  if (negativeMatches > positiveMatches) return "negative";
  if (rating >= 4 && positiveMatches >= negativeMatches) return "positive";
  if (positiveMatches > negativeMatches) return "positive";
  return "neutral";
}

function classifyCustomerEmotion(text, rating = 0) {
  const normalized = normalizeText(text);
  if (/(scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/.test(normalized)) return "fear";
  if (/(angry|mad|furious|rage|annoyed|irritated|enojado|enojo|furioso|bronca)/.test(normalized)) return "anger";
  if (/(confusing|confused|unclear|don t understand|doesnt understand|hard to use|no entiendo|confuso|confundido)/.test(normalized)) return "confusion";
  if (/(disappointed|let down|not as expected|expected better|decepcion|decepcionado)/.test(normalized)) return "disappointment";
  if (/(regret|waste|wish i hadn|shouldn t have|arrepent|arrepentido)/.test(normalized)) return "regret";
  if (/(trust|fake|misleading|dishonest|not real|engaño|enganoso|desconf)/.test(normalized)) return "distrust";
  if (/(frustrated|frustrating|problem|issue|return|refund|doesn t work|doesnt work|frustra|frustrante)/.test(normalized)) return "frustration";
  if (/(not sure|maybe|uncertain|unsure|doubt|duda|incierto)/.test(normalized)) return "uncertainty";
  if (rating >= 4 && /(love|great|excellent|perfect|beautiful|happy|encanta|excelente|perfecto)/.test(normalized)) return "delight";
  if (rating >= 4 && /(works|good|satisfied|quality|recom|bien|satisfecho)/.test(normalized)) return "satisfaction";
  if (rating >= 4 && /(relief|solved|easy|finally|alivio|resolvio|facil)/.test(normalized)) return "relief";
  if (rating >= 4) return "satisfaction";
  return "none";
}

function isObjectiveSafetyText(text) {
  const normalized = normalizeText(text);
  return /(unsafe|danger|dangerous|hazard|hazardous|injury|injured|sharp|toxic|poison|burn|choking|fire|electrical|peligro|peligroso|lastim|herid|toxico|quemad)/.test(normalized);
}

function isSubjectiveNegativeText(text) {
  const normalized = normalizeText(text);
  if (!normalized || isObjectiveSafetyText(normalized)) return false;
  return /(scare|scary|scared|fear|afraid|fright|creepy|creeped|unsettling|disturbing|weird|ugly|gross|hate|dislike|don t like|doesn t like|dont like|doesnt like|not my style|asusta|asustado|miedo|temor|terror|feo|horrible|raro|perturb|inquieta|no me gusta|me da miedo)/.test(normalized);
}

function countRegexMatches(value, regex) {
  return (String(value || "").match(regex) || []).length;
}

function isGenericOtherReason(value) {
  return /(^|\s)(other|unknown|not listed|uncategorized|misc|miscellaneous)(\s|$)/i.test(String(value || ""));
}

function isDefaultCustomerLanguageTerm(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (CUSTOMER_TEXT_STOP_WORDS.has(normalized)) return true;
  if (DEFAULT_CUSTOMER_LANGUAGE_PHRASES.has(normalized)) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => CUSTOMER_TEXT_STOP_WORDS.has(token));
}

function isUsefulRepeatedLanguageTerm(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 4 || isDefaultCustomerLanguageTerm(normalized)) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length === 1 && tokens[0] === "not") return false;
  return tokens.some((token) => !CUSTOMER_TEXT_STOP_WORDS.has(token) && (token.length >= 4 || CUSTOMER_TEXT_SHORT_SIGNAL_WORDS.has(token)));
}

const CUSTOMER_TEXT_STOP_WORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "also",
  "although",
  "always",
  "among",
  "and",
  "are",
  "but",
  "did",
  "does",
  "doing",
  "done",
  "get",
  "gets",
  "got",
  "had",
  "has",
  "having",
  "into",
  "its",
  "just",
  "many",
  "may",
  "might",
  "more",
  "most",
  "much",
  "must",
  "only",
  "onto",
  "our",
  "out",
  "own",
  "same",
  "shall",
  "some",
  "still",
  "such",
  "than",
  "their",
  "them",
  "then",
  "there",
  "these",
  "thing",
  "things",
  "those",
  "through",
  "took",
  "take",
  "taken",
  "taking",
  "under",
  "want",
  "wanted",
  "was",
  "way",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "would",
  "with",
  "within",
  "without",
  "from",
  "that",
  "this",
  "been",
  "being",
  "have",
  "they",
  "very",
  "anything",
  "because",
  "before",
  "between",
  "could",
  "during",
  "even",
  "nothing",
  "over",
  "should",
  "something",
  "away",
  "back",
  "really",
  "product",
  "products",
  "return",
  "returns",
  "returned",
  "reason",
  "reasons",
  "refund",
  "refunds",
  "refunded",
  "order",
  "item",
  "customer",
  "review",
  "selected",
  "select",
  "default",
  "other",
  "unknown",
  "misc",
  "miscellaneous",
  "uncategorized",
]);

const CUSTOMER_TEXT_SHORT_SIGNAL_WORDS = new Set([
  "bad",
  "fit",
  "red",
]);

const DEFAULT_CUSTOMER_LANGUAGE_PHRASES = new Set([
  "other reason",
  "other reasons",
  "return reason",
  "return reasons",
  "refund reason",
  "refund reasons",
  "reason selected",
  "selected reason",
  "default reason",
  "customer reason",
  "customer note",
  "reason note",
  "not listed",
  "unknown reason",
  "misc reason",
  "miscellaneous reason",
  "uncategorized reason",
]);

function getMainIssueFromCounts(counts, fallback) {
  const sorted = Object.entries(counts).sort((first, second) => second[1] - first[1]);
  if (sorted[0]?.[0]) return sorted[0][0];
  return normalizeIssueCode(fallback) || "product_quality";
}

function classifyIssueText(text) {
  const normalized = normalizeText(text);
  if (/(fit|size|sizing|small|large|tight|loose|waist|chest|shoulder|length)/.test(normalized)) return "fit_sizing";
  if (isObjectiveSafetyText(normalized)) return "safety_concern";
  if (isSubjectiveNegativeText(normalized)) return "subjective_negative_reaction";
  if (/(color|colour|pictured|photo|image|shade|looks different)/.test(normalized)) return "color_expectation";
  if (/(break|broken|defect|damage|damaged|quality|thin|poor|cheap|durability|durable|soft|softness|rough|scratchy|stiff|material|fabric|texture)/.test(normalized)) return "quality_defect";
  if (/(compatible|compatibility|fit with|works with)/.test(normalized)) return "compatibility";
  if (/(shipping|delivery|late|arrived)/.test(normalized)) return "shipping_delivery";
  return "product_quality";
}

function analyzeProductContentDeterministically(product) {
  const description = stripHtml(product.description || product.descriptionHtml || "").replace(/\s+/g, " ").trim();
  const descriptionWordCount = description ? description.split(/\s+/).filter(Boolean).length : 0;
  const normalizedDescription = normalizeText(description);
  const normalizedTitle = normalizeText(product.title);
  const productType = normalizeText(product.productType);
  const tags = Array.isArray(product.tags) ? product.tags.map(String).filter(Boolean) : [];
  const collections = Array.isArray(product.collections) ? product.collections.map(String).filter(Boolean) : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const media = Array.isArray(product.media) ? product.media : [];
  const issues = [];
  const advisories = [];

  if (isGenericProductTitle(product.title)) {
    issues.push(buildContentIssue("generic_title", "Product title is too generic", "medium", "The Shopify title does not clearly identify the product.", 6));
  }

  if (!description) {
    issues.push(buildContentIssue("missing_description", "Missing product description", "high", "The Shopify product description is empty.", 12));
  } else if (descriptionWordCount < 25) {
    issues.push(buildContentIssue("short_description", "Short product description", "medium", `The description has ${descriptionWordCount} words.`, 7));
  }

  if (description && normalizedTitle && isClearlyDisconnectedTitleDescription(product, description)) {
    issues.push(buildContentIssue("title_description_mismatch", "Title and description are clearly disconnected", "high", "The title and description appear to describe different product categories.", 10));
  }

  const variantMismatchIssue = buildDescriptionVariantMismatchIssue(product, description);
  if (variantMismatchIssue) issues.push(variantMismatchIssue);

  if (description && productType && !normalizedDescription.includes(productType) && productType.length > 3) {
    advisories.push(buildContentAdvisory("missing_product_type_context", "Product type could be clearer", `Product type "${product.productType}" is not reflected in the description.`));
  }

  const descriptiveTags = tags.filter((tag) => normalizeText(tag).length > 3).slice(0, 8);
  const matchedTags = descriptiveTags.filter((tag) => normalizedDescription.includes(normalizeText(tag)));
  if (description && descriptiveTags.length >= 3 && matchedTags.length === 0) {
    advisories.push(buildContentAdvisory("tag_description_mismatch", "Tags could be reflected in description", "Product tags do not appear to be represented in the description copy."));
  }

  if (description && collections.length && !collections.some((collection) => hasMeaningfulTokenOverlap(collection, description))) {
    advisories.push(buildContentAdvisory("collection_mismatch", "Collection context could be clearer", "Collections are not clearly reflected in the product description."));
  }

  if (variants.length > 1 && variants.some((variant) => isDefaultVariantTitle(variant.title))) {
    advisories.push(buildContentAdvisory("unclear_variant_names", "Variant names could be clearer", "At least one variant uses a default or unclear option name."));
  }

  if (!media.length) {
    advisories.push(buildContentAdvisory("missing_media_context", "Product media needs review", "No product media was available in Shopify product data."));
  } else if (media.some((item) => !String(item.alt || "").trim())) {
    advisories.push(buildContentAdvisory("missing_media_alt_text", "Media alt text could be improved", "One or more product media items have no alt text."));
  }

  const score = clamp(100 - issues.reduce((total, issue) => total + issue.riskLift * 3, 0), 0, 100);

  return {
    hasDescription: Boolean(description),
    descriptionLength: description.length,
    descriptionWordCount,
    titleNeedsReview: issues.some((issue) => issue.code === "generic_title"),
    variantNamingAdvisory: advisories.some((issue) => issue.code === "unclear_variant_names"),
    mediaCount: media.length,
    mediaWithoutAltCount: media.filter((item) => !String(item.alt || "").trim()).length,
    score,
    riskLift: Math.min(18, issues.reduce((total, issue) => total + issue.riskLift, 0)),
    issues,
    advisories,
  };
}

function isGenericProductTitle(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return true;
  if (["product", "untitled product", "sample product", "default title", "new product", "test product"].includes(normalized)) return true;
  const tokens = meaningfulTokens(normalized);
  return normalized.length < 8 && tokens.length <= 1;
}

function isDefaultVariantTitle(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  return !normalized || normalized === "default title" || normalized === "default";
}

function buildContentIssue(code, label, severity, evidence, riskLift) {
  return {
    issueCode: "product_content",
    code,
    label,
    severity,
    evidence,
    riskLift,
    findingType: "issue",
  };
}

function buildContentAdvisory(code, label, evidence) {
  return {
    issueCode: "product_content",
    code,
    label,
    severity: "low",
    evidence,
    riskLift: 0,
    findingType: "advisory",
  };
}

function buildDescriptionVariantMismatchIssue(product = {}, description = "") {
  const expectedColor = getSingleExpectedProductColor(product);
  if (!expectedColor) return null;

  const conflictingColor = findColorTermInText(description, new Set([expectedColor.canonical]));
  if (!conflictingColor) return null;

  return {
    ...buildContentIssue(
      "description_variant_mismatch",
      "Description and variant color conflict",
      "high",
      `The description mentions "${conflictingColor.label}", but the only color option found in Shopify is "${expectedColor.label}".`,
      8,
    ),
    replacements: [{
      from: conflictingColor.label,
      to: expectedColor.label,
      reason: "Align product description color copy with the only available Shopify variant.",
    }],
  };
}

function getSingleExpectedProductColor(product = {}) {
  const colors = [];
  const options = Array.isArray(product.options) ? product.options : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const colorOptionPattern = /\b(colou?r|shade)\b/i;

  options.forEach((option) => {
    if (!colorOptionPattern.test(String(option.name || ""))) return;
    (Array.isArray(option.values) ? option.values : []).forEach((value) => {
      const color = findColorTermInText(value);
      if (color) colors.push(color);
    });
  });

  variants.forEach((variant) => {
    (Array.isArray(variant.selectedOptions) ? variant.selectedOptions : []).forEach((option) => {
      if (!colorOptionPattern.test(String(option.name || ""))) return;
      const color = findColorTermInText(option.value);
      if (color) colors.push(color);
    });
  });

  if (!colors.length && variants.length === 1) {
    const color = findColorTermInText(variants[0]?.title);
    if (color) colors.push(color);
  }

  const uniqueByCanonical = uniqueBy(colors, (color) => color.canonical);
  return uniqueByCanonical.length === 1 ? uniqueByCanonical[0] : null;
}

function findColorTermInText(value, excludedCanonicals = new Set()) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const terms = PRODUCT_COLOR_TERMS
    .flatMap((color) => color.terms.map((term) => ({ canonical: color.canonical, label: term.label, normalized: normalizeText(term.label) })))
    .sort((first, second) => second.normalized.length - first.normalized.length);
  return terms.find((term) => (
    term.normalized
    && !excludedCanonicals.has(term.canonical)
    && containsNormalizedPhrase(normalized, term.normalized)
  )) || null;
}

function containsNormalizedPhrase(normalizedText, normalizedPhrase) {
  return new RegExp(`(^|\\s)${escapeRegExp(normalizedPhrase)}(\\s|$)`).test(normalizedText);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PRODUCT_COLOR_TERMS = [
  { canonical: "black", terms: [{ label: "Jet Black" }, { label: "Black" }] },
  { canonical: "white", terms: [{ label: "True White" }, { label: "Off White" }, { label: "White" }, { label: "Ivory" }, { label: "Cream" }] },
  { canonical: "gray", terms: [{ label: "Charcoal" }, { label: "Grey" }, { label: "Gray" }, { label: "Silver" }] },
  { canonical: "blue", terms: [{ label: "Navy" }, { label: "Blue" }] },
  { canonical: "red", terms: [{ label: "Burgundy" }, { label: "Red" }] },
  { canonical: "green", terms: [{ label: "Olive" }, { label: "Green" }] },
  { canonical: "yellow", terms: [{ label: "Yellow" }] },
  { canonical: "orange", terms: [{ label: "Orange" }] },
  { canonical: "purple", terms: [{ label: "Purple" }, { label: "Violet" }] },
  { canonical: "pink", terms: [{ label: "Pink" }] },
  { canonical: "brown", terms: [{ label: "Brown" }, { label: "Tan" }, { label: "Beige" }] },
  { canonical: "gold", terms: [{ label: "Gold" }] },
];

function buildContentAnalysis(deterministic, contentGaps) {
  const deterministicIssues = Array.isArray(deterministic.metrics.contentIssues) ? deterministic.metrics.contentIssues : [];
  const deterministicAdvisories = Array.isArray(deterministic.metrics.contentAdvisories) ? deterministic.metrics.contentAdvisories : [];
  const aiFindings = normalizeAiContentFindings(contentGaps);
  const aiIssues = aiFindings.issues;
  const aiAdvisories = aiFindings.advisories;
  const issues = uniqueBy([...deterministicIssues, ...aiIssues], (issue) => `${issue.code}-${issue.label}`);
  const advisories = uniqueBy([...deterministicAdvisories, ...aiAdvisories], (issue) => `${issue.code}-${issue.label}`);
  const aiRiskLift = Math.min(18, aiIssues.reduce((total, issue) => total + issue.riskLift, 0));
  const deterministicRiskLift = Number(deterministic.metrics.contentQualityRisk || 0);
  const riskLift = Math.min(18, Math.max(deterministicRiskLift, aiRiskLift));
  const additionalRiskLift = Math.min(10, Math.max(0, riskLift - deterministicRiskLift));
  const aiScore = Number(contentGaps?.content_quality_score);
  const score = Number.isFinite(aiScore)
    ? clamp(Math.round(aiScore), 0, 100)
    : Number(deterministic.metrics.contentQualityScore || 100);

  return {
    score,
    summary: contentGaps?.content_summary || contentGaps?.notes || summarizeContentIssues(issues),
    present: Array.isArray(contentGaps?.present) ? contentGaps.present : [],
    missing: Array.isArray(contentGaps?.missing) ? contentGaps.missing : [],
    issueSpecificGaps: Array.isArray(contentGaps?.issue_specific_gaps) ? contentGaps.issue_specific_gaps : [],
    issues,
    advisories,
    riskLift,
    additionalRiskLift,
  };
}

function adjustRiskComponentsForContentAnalysis(riskComponents = {}, contentAnalysis = {}) {
  const next = { ...riskComponents };
  const existingContentScore = Number(next.contentGapScore ?? next.contentRisk ?? 0);
  const contentGapScore = clamp(Math.max(existingContentScore, Number(contentAnalysis.riskLift || 0)), 0, 15);
  const rawScore = Number(next.rawScore ?? next.calculated ?? next.riskScore ?? 0) - existingContentScore + contentGapScore;
  const riskScore = Math.round(clamp(rawScore, 0, 100));

  return {
    ...next,
    contentGapScore: roundRate(contentGapScore, 2),
    contentRisk: roundRate(contentGapScore, 2),
    rawScore: roundRate(rawScore, 2),
    calculated: riskScore,
    riskScore,
    calculationState: next.calculationState || "calculated_from_persisted_components",
  };
}

function normalizeAiContentFindings(contentGaps) {
  const findings = (Array.isArray(contentGaps?.content_issues) ? contentGaps.content_issues : [])
    .map((issue) => {
      const severity = normalizeSeverity(issue.severity);
      const code = normalizeContentIssueCode(issue.code);
      const label = issue.label || getContentIssueLabel(code);
      const evidence = issue.evidence || issue.why_it_matters || issue.suggested_action || "";
      const advisory = isAdvisoryContentIssue(code, severity, evidence);
      return {
        issueCode: "product_content",
        code,
        label: advisory ? getContentAdvisoryLabel(code, label) : label,
        severity: advisory ? "low" : severity,
        evidence,
        suggestedAction: issue.suggested_action || "Review product content",
        riskLift: advisory ? 0 : severity === "high" ? 10 : severity === "medium" ? 6 : 3,
        findingType: advisory ? "advisory" : "issue",
      };
    })
    .filter((issue) => issue.label);
  return {
    issues: findings.filter((issue) => issue.findingType !== "advisory"),
    advisories: findings.filter((issue) => issue.findingType === "advisory"),
  };
}

function isAdvisoryContentIssue(code, severity, evidence) {
  if (CONTENT_ADVISORY_CODES.has(code)) return true;
  if (code === "title_description_mismatch") {
    const normalizedEvidence = normalizeText(evidence);
    return severity !== "high" || !/(wrong product|different product|unrelated product|about another product|contradict|clearly disconnect|clearly different)/.test(normalizedEvidence);
  }
  return false;
}

function getContentAdvisoryLabel(code, fallback) {
  if (code === "missing_product_type_context") return "Product type could be clearer";
  if (code === "tag_description_mismatch") return "Tags could be reflected in description";
  if (code === "collection_mismatch") return "Collection context could be clearer";
  if (code === "title_description_mismatch") return "Title and description alignment could be reviewed";
  return fallback;
}

const CONTENT_ADVISORY_CODES = new Set([
  "missing_product_type_context",
  "tag_description_mismatch",
  "collection_mismatch",
]);

function summarizeContentIssues(issues) {
  if (!issues.length) return "Product content appears coherent from the stored Shopify metadata.";
  return issues.slice(0, 3).map((issue) => issue.label).join(", ");
}

function normalizeContentIssueCode(value) {
  return String(value || "product_content_issue").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function getContentIssueLabel(code) {
  const normalized = normalizeContentIssueCode(code);
  if (normalized === "missing_description") return "Missing product description";
  if (normalized === "short_description") return "Short product description";
  if (normalized === "title_description_mismatch") return "Title and description mismatch";
  if (normalized === "description_variant_mismatch") return "Description and variant mismatch";
  if (normalized === "missing_product_type_context") return "Product type could be clearer";
  if (normalized === "tag_description_mismatch") return "Tags and description mismatch";
  if (normalized === "collection_mismatch") return "Collection context mismatch";
  if (normalized === "missing_specifications") return "Missing product specifications";
  if (normalized === "contradiction") return "Contradictory product content";
  return "Product content needs review";
}

function normalizeSeverity(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("low")) return "low";
  return "medium";
}

function buildMainFindingDetail(aiDetail, deterministic, contentAnalysis) {
  const base = normalizeMainFindingDetail(aiDetail || buildEvidenceSummary(deterministic));
  if (!contentAnalysis?.issues?.length) return base;
  const contentLabels = contentAnalysis.issues
    .slice(0, 3)
    .map((issue) => issue.label || getContentIssueLabel(issue.code))
    .filter(Boolean);
  const contentSentence = `Product content analysis also found: ${contentLabels.join(", ") || "product content needs review"}.`;
  return String(base || "").toLowerCase().includes("product content") ? base : appendMainFindingParagraph(base, contentSentence);
}

function normalizeMainFindingDetail(value) {
  const paragraphs = splitMainFindingParagraphs(value);
  if (!paragraphs.length) return "";
  return paragraphs.slice(0, 3).join("\n\n");
}

function appendMainFindingParagraph(value, paragraph) {
  const paragraphs = splitMainFindingParagraphs(value);
  const nextParagraph = String(paragraph || "").replace(/\s+/g, " ").trim();
  if (!nextParagraph) return normalizeMainFindingDetail(value);
  if (paragraphs.length >= 3) return [...paragraphs.slice(0, 2), nextParagraph].join("\n\n");
  return [...paragraphs, nextParagraph].slice(0, 3).join("\n\n");
}

function splitMainFindingParagraphs(value) {
  const raw = String(value || "").replace(/\r/g, "\n").trim();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  return [raw.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()].filter(Boolean);
}

function adjustMainFindingForSignalStrength(mainFinding, deterministic) {
  const relevance = buildSignalRelevanceGuidance(deterministic);
  const hasContentIssues = Number(deterministic.metrics.contentIssueCount || 0) > 0;
  if (relevance.customerEvidence?.level === "isolated" && !hasContentIssues) {
    return {
      title: "Customer signal needs monitoring",
      detail: normalizeMainFindingDetail(relevance.customerEvidence.guidance),
      summary: relevance.customerEvidence.summary,
    };
  }

  if (relevance.reviewSignals.level === "normal") return mainFinding;

  if (hasContentIssues) {
    return {
      ...mainFinding,
      detail: appendMainFindingParagraph(mainFinding.detail, relevance.reviewSignals.guidance),
      summary: `${mainFinding.summary} ${relevance.reviewSignals.guidance}`,
    };
  }

  return {
    title: relevance.reviewSignals.level === "emerging"
      ? "Review signal is emerging, not confirmed"
      : "Review signal is still early",
    detail: normalizeMainFindingDetail(relevance.reviewSignals.guidance),
    summary: relevance.reviewSignals.summary,
  };
}

function buildSignalRelevanceGuidance(deterministic) {
  const metrics = deterministic.metrics || {};
  const negativeReviews = Number(metrics.negativeReviewCount || 0);
  const reviewCount = Number(metrics.reviewCount || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const contentIssues = Number(metrics.contentIssueCount || 0);
  const customerEvidence = buildCustomerEvidenceRelevanceGuidance({ negativeReviews, returnUnits, refundUnits, contentIssues });
  const reviewOnly = negativeReviews > 0 && returnUnits === 0 && refundUnits === 0 && contentIssues === 0;

  if (!reviewOnly) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "normal",
        summary: negativeReviews ? `${negativeReviews} negative connected reviews are available with other supporting signals.` : "No negative review pressure is leading the finding.",
        guidance: "Use reviews alongside stronger return, refund, content, or multi-source evidence.",
      },
    };
  }

  if (negativeReviews <= 2) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "weak",
        summary: `${negativeReviews} negative connected review${negativeReviews === 1 ? "" : "s"} out of ${reviewCount} total reviews is an early signal only.`,
        guidance: `${negativeReviews} negative connected review${negativeReviews === 1 ? "" : "s"} is below the ProductPulse action threshold. Treat it as low-confidence monitoring evidence and do not lead the main finding with review wording.`,
      },
    };
  }

  if (negativeReviews <= 4) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "emerging",
        summary: `${negativeReviews} negative connected reviews out of ${reviewCount} total reviews is an emerging signal.`,
        guidance: `${negativeReviews} negative connected reviews can support a low-to-medium finding, but confidence should start near 50 and increase only if returns, refunds, repeated language, or more reviews agree.`,
      },
    };
  }

  return {
    customerEvidence,
    reviewSignals: {
      level: "normal",
      summary: `${negativeReviews} negative connected reviews out of ${reviewCount} total reviews is enough review volume to support the finding.`,
      guidance: "Reviews have enough volume to inform the main finding when they are consistent.",
    },
  };
}

function buildCustomerEvidenceRelevanceGuidance({ negativeReviews, returnUnits, refundUnits, contentIssues }) {
  const customerSignalCount = Number(negativeReviews || 0) + Number(returnUnits || 0) + Number(refundUnits || 0);
  if (Number(contentIssues || 0) > 0) {
    return {
      level: "supported",
      summary: "Product content findings are deterministic and can be discussed independently from customer-signal volume.",
      guidance: "Use content issues when they are present, even if customer text volume is low.",
    };
  }
  if (customerSignalCount <= 1) {
    return {
      level: "isolated",
      summary: `${customerSignalCount} customer signal is isolated and should not become a confirmed issue by itself.`,
      guidance: "Keep isolated customer language in evidence, but do not turn one customer opinion into multiple issues, a strong recommendation, or a high-risk finding.",
    };
  }
  if (customerSignalCount < 4) {
    return {
      level: "emerging",
      summary: `${customerSignalCount} customer signals can support a low-confidence finding when they point to the same issue.`,
      guidance: "Treat two or three aligned customer signals as emerging evidence; severity should stay low or medium unless hard metrics agree.",
    };
  }
  return {
    level: "supported",
    summary: `${customerSignalCount} customer signals provide enough sample support for merchant-facing analysis.`,
    guidance: "Repeated customer evidence can support issues and recommendations when it is grouped by the same underlying problem.",
  };
}

function hasMeaningfulTokenOverlap(first, second) {
  const firstTokens = meaningfulTokens(first);
  const secondTokens = new Set(meaningfulTokens(second));
  return firstTokens.some((token) => secondTokens.has(token));
}

function isClearlyDisconnectedTitleDescription(product, description) {
  const title = String(product.title || "");
  const titleTokens = meaningfulTokens(title);
  const descriptionTokens = meaningfulTokens(description);
  if (titleTokens.length < 2 || descriptionTokens.length < 12) return false;
  if (hasStrongTextOverlap(title, description)) return false;
  if (hasProductIdentityOverlap(product, description)) return false;

  const titleCategories = detectProductCategoryGroups([
    title,
    product.productType,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
  ].join(" "));
  const descriptionCategories = detectProductCategoryGroups(description);

  if (!titleCategories.size || !descriptionCategories.size) return false;
  return [...titleCategories].every((category) => !descriptionCategories.has(category));
}

function hasProductIdentityOverlap(product, description) {
  const identityParts = [
    product.title,
    product.vendor,
    product.productType,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
  ].filter(Boolean);
  const descriptionTokens = new Set(meaningfulTokens(description));
  return identityParts.some((part) => meaningfulTokens(part).some((token) => descriptionTokens.has(token)));
}

function detectProductCategoryGroups(value) {
  const normalized = normalizeText(value);
  const groups = new Set();
  PRODUCT_CATEGORY_GROUPS.forEach(({ group, pattern }) => {
    if (pattern.test(normalized)) groups.add(group);
  });
  return groups;
}

const PRODUCT_CATEGORY_GROUPS = [
  { group: "apparel", pattern: /\b(shirt|tee|tshirt|t-shirt|trouser|pants|jeans|dress|skirt|jacket|hoodie|sweater|shorts|leggings|shoe|shoes|sneaker|boot|coat|top|blouse|linen|cotton|fit|waist|inseam|sleeve)\b/ },
  { group: "toy", pattern: /\b(toy|doll|figure|playset|lego|blocks|puzzle|game|kids|children|hatchimals|barbie|pony|playmobil|transformers)\b/ },
  { group: "art", pattern: /\b(art|print|poster|painting|canvas|rembrandt|wall decor|frame|framed|illustration|portrait)\b/ },
  { group: "electronics", pattern: /\b(phone|charger|cable|adapter|battery|speaker|headphone|earbuds|camera|laptop|tablet|device|electronic)\b/ },
  { group: "beauty", pattern: /\b(cream|serum|lotion|makeup|cosmetic|shampoo|conditioner|skincare|fragrance|perfume)\b/ },
  { group: "home", pattern: /\b(furniture|chair|table|lamp|rug|bedding|sheet|pillow|kitchen|mug|bottle|decor|home)\b/ },
  { group: "food", pattern: /\b(food|snack|coffee|tea|chocolate|candy|drink|beverage|sauce|spice)\b/ },
];

function hasStrongTextOverlap(first, second) {
  const firstTokens = meaningfulTokens(first);
  const secondTokens = meaningfulTokens(second);
  if (!firstTokens.length || !secondTokens.length) return false;
  const secondSet = new Set(secondTokens);
  const sharedCount = firstTokens.filter((token) => secondSet.has(token)).length;
  const smallerSize = Math.min(firstTokens.length, secondTokens.length);
  if (sharedCount >= Math.min(3, smallerSize)) return true;
  return sharedCount >= 2 && sharedCount / smallerSize >= 0.55;
}

function meaningfulTokens(value) {
  const stopWords = new Set(["and", "the", "for", "with", "from", "this", "that", "product", "products", "shopify", "new"]);
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !stopWords.has(token));
}

function calculateRiskScore({ snapshot, metrics }) {
  return calculateRiskScoreBreakdown({ snapshot, metrics }).riskScore;
}

function calculateRiskScoreBreakdown({ snapshot, metrics }) {
  if (!metrics.signalCount && !metrics.contentIssueCount && Number(snapshot.riskScore || 0) > 0) {
    return {
      base: 0,
      returnsScore: 0,
      reviewsScore: 0,
      sentimentScore: 0,
      contentGapScore: 0,
      refundScore: 0,
      variantScore: 0,
      agreementBonus: 0,
      recencyBonus: 0,
      rawScore: Number(snapshot.riskScore),
      calculated: Number(snapshot.riskScore),
      riskScore: Number(snapshot.riskScore),
      recovery: "snapshot-fallback",
      calculationState: "score_breakdown_reconstructed",
    };
  }

  return calculateProductScoreModel({
    ...metrics,
    storeReturnBaseline: snapshot.metrics?.storeAvgReturnRate,
    storeRefundBaseline: snapshot.metrics?.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshot.metrics?.storeAvgNegativeReviewRate || snapshot.metrics?.csvNegativeRatingRate,
    sentimentTotal: metrics.textInsights?.sentiment?.total || 0,
    sentimentNegativeCount: metrics.textInsights?.sentiment?.negative || 0,
    subjectiveNegativeCount: metrics.textInsights?.subjectiveNegativity?.count || 0,
    subjectiveNegativeRatio: metrics.textInsights?.subjectiveNegativity?.ratio || 0,
    affectedVariantCount: metrics.affectedVariants?.length || 0,
    sourceAgreement: hasSourceAgreement({
      returnUnits: metrics.returnUnits,
      refundUnits: metrics.refundUnits,
      negativeReviewCount: metrics.negativeReviewCount,
      reviewSourceStats: metrics.reviewSourceStats,
    }),
    recentSignalUnits: countRecentSignalEvents(metrics.signalEvents, 30),
    effectiveSampleSize: Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0) + Number(metrics.reviewCount || 0) + Number(metrics.contentIssueCount || 0),
    calculationState: "calculated_from_persisted_components",
  }, { sentimentSharesReviewSource: !(metrics.returnUnits || metrics.refundUnits) }).riskComponents;
}

function calculateConfidence({
  signalCount,
  sourceCoverage,
  judgeMeMatchConfidence,
  csvReviewMatchConfidence,
  orderAccessDenied,
  sourceAgreement,
  recentSignals,
  mainIssue = "",
  textInsights = null,
  returnUnits = 0,
  refundUnits = 0,
  negativeReviewCount = 0,
  contentIssueCount = 0,
}) {
  const sample = Math.min(26, Math.log2(signalCount + 1) * 8);
  const coverage = Math.min(28, sourceCoverage.length * 7);
  const match = Math.round(Math.max(judgeMeMatchConfidence || 0, csvReviewMatchConfidence || 0) * 16);
  const agreement = sourceAgreement ? 18 : 5;
  const recency = recentSignals ? 10 : 0;
  const penalty = orderAccessDenied ? 16 : 0;
  const baseConfidence = clamp(Math.round(18 + sample + coverage + match + agreement + recency - penalty), 0, 99);
  const sparseAdjustedConfidence = adjustSparseCustomerSignalConfidence(baseConfidence, {
    signalCount,
    sourceAgreement,
    returnUnits,
    refundUnits,
    negativeReviewCount,
    contentIssueCount,
  });
  const reviewAdjustedConfidence = adjustWeakReviewConfidence(sparseAdjustedConfidence, { returnUnits, refundUnits, negativeReviewCount });
  return adjustSubjectiveConfidence(reviewAdjustedConfidence, mainIssue, textInsights);
}

function adjustSparseCustomerSignalConfidence(confidence, { signalCount, sourceAgreement, returnUnits, refundUnits, negativeReviewCount, contentIssueCount }) {
  if (sourceAgreement || Number(contentIssueCount || 0) > 0) return confidence;
  const customerSignals = Number(returnUnits || 0) + Number(refundUnits || 0) + Number(negativeReviewCount || 0);
  const knownSignals = Math.max(Number(signalCount || 0), customerSignals);
  if (knownSignals <= 1) return Math.min(confidence, 45);
  if (knownSignals < MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return Math.min(confidence, 49);
  return confidence;
}

function adjustWeakReviewConfidence(confidence, { returnUnits, refundUnits, negativeReviewCount }) {
  const reviewOnly = Number(negativeReviewCount || 0) > 0 && Number(returnUnits || 0) === 0 && Number(refundUnits || 0) === 0;
  if (!reviewOnly) return confidence;
  if (negativeReviewCount <= 2) return Math.min(confidence, 49);
  if (negativeReviewCount <= 4) return Math.min(Math.max(confidence, 52), 64);
  return confidence;
}

function adjustSubjectiveConfidence(confidence, mainIssue, textInsights) {
  if (mainIssue !== "subjective_negative_reaction") return confidence;
  const summary = textInsights?.subjectiveNegativity || {};
  const count = Number(summary.count || 0);
  const ratio = Number(summary.ratio || 0);
  if (count <= 1) return Math.min(confidence, 45);
  if (!hasActionableSubjectiveEvidence(summary)) return Math.min(confidence, 62);
  if (count < 5 && ratio < 0.5) return Math.min(confidence, 76);
  return confidence;
}

function buildEvidenceSnippets({ returns, refunds, reviews, product }) {
  const snippets = [];
  returns.slice(0, 30).forEach((item) => {
    const text = getReturnCustomerLanguageText(item);
    if (!text) return;
    snippets.push({
      source: "shopify_return_note",
      text: text.slice(0, 700),
      createdAt: item.createdAt,
      variant: item.variantTitle || item.sku || "",
      quantity: item.quantity,
    });
  });
  refunds.slice(0, 20).forEach((item) => {
    const operationalText = getRefundOperationalText(item);
    snippets.push({
      source: operationalText ? "shopify_refund_note" : "shopify_refund",
      text: operationalText
        ? `${item.quantity} unit refund: ${operationalText}`
        : `${item.quantity} unit refund${item.restockType ? `, restock ${item.restockType}` : ""}`,
      createdAt: item.createdAt,
      variant: item.variantTitle || item.sku || "",
      amount: item.amount,
    });
  });
  reviews.slice(0, 40).forEach((review) => {
    snippets.push({
      source: review.sourceType || "judgeme_review",
      text: [review.title, review.body].filter(Boolean).join(" - ").slice(0, 900),
      createdAt: review.createdAt,
      rating: review.rating,
      reviewSource: review.sourceLabel || "Judge.me reviews",
      product: product.title,
    });
  });
  return snippets.slice(0, 60);
}

function buildSourceCoverage({ shopifyData, judgeMeData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount }) {
  const sources = ["Shopify product"];
  if (soldUnits > 0 || !shopifyData.orderAccessDenied) sources.push("Shopify orders");
  if (returnUnits > 0) sources.push("Shopify returns");
  if (refundUnits > 0) sources.push("Shopify refunds");
  if (judgeMeData.connected) sources.push("Judge.me reviews");
  if (csvReviewData?.connected) sources.push("CSV reviews");
  if (reviewCount > 0 && !sources.includes("Judge.me reviews") && !sources.includes("CSV reviews")) sources.push("Reviews");
  return sources;
}

function buildEvidenceSummary(deterministic) {
  const metrics = deterministic.metrics;
  const relevance = buildSignalRelevanceGuidance(deterministic);
  const contentIssues = Array.isArray(metrics.contentIssues) ? metrics.contentIssues : [];
  const contentAnalysisIssues = Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : [];
  const productContentIssues = contentIssues.length ? contentIssues : contentAnalysisIssues;
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const pieces = [];
  if (metrics.returnUnits > 0) pieces.push(`${metrics.returnUnits} return units (${metrics.returnRate}% return rate)`);
  if (metrics.refundUnits > 0 || metrics.refundAmount > 0) pieces.push(`${metrics.refundUnits} refunds worth ${formatMoney(metrics.refundAmount)}`);
  if (metrics.reviewCount > 0 && metrics.negativeReviewCount > 0) {
    pieces.push(relevance.reviewSignals.level === "normal"
      ? `${metrics.negativeReviewCount} negative connected reviews out of ${metrics.reviewCount}`
      : relevance.reviewSignals.summary);
  }
  if (productContentIssues.length > 0) {
    pieces.push(`product content issues: ${productContentIssues.slice(0, 3).map((issue) => issue.label || getContentIssueLabel(issue.code)).filter(Boolean).join(", ")}`);
  } else if (Number(metrics.contentIssueCount || 0) > 0) {
    pieces.push(`${metrics.contentIssueCount} product content issue${Number(metrics.contentIssueCount) === 1 ? "" : "s"}`);
  }
  if (affectedVariants.length) pieces.push(`affected variants: ${affectedVariants.join(", ")}`);
  if (!pieces.length) return "The diagnosis has product metadata but no strong product-specific customer signal yet.";
  return pieces.join("; ");
}

function buildFallbackClusters(deterministic, mainIssue) {
  return Object.entries(deterministic.issueSignalCounts).map(([issue, signals]) => ({
    issue_category: issue,
    human_name: getHumanIssueLabel(issue),
    summary: `${signals} deterministic signal${signals === 1 ? "" : "s"} detected.`,
    signals,
    severity: getSeverityLabel(deterministic.riskScore).toLowerCase(),
  })).concat([{
    issue_category: mainIssue,
    human_name: getHumanIssueLabel(mainIssue),
    summary: buildEvidenceSummary(deterministic),
    signals: Math.max(1, deterministic.metrics.signalCount),
    severity: getSeverityLabel(deterministic.riskScore).toLowerCase(),
  }]).filter((item, index, list) => list.findIndex((candidate) => candidate.issue_category === item.issue_category) === index);
}

function hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount, reviewSourceStats = null }) {
  const reviewSourceSignals = reviewSourceStats
    ? [reviewSourceStats.judgeMe?.negativeReviewCount > 0, reviewSourceStats.csv?.negativeReviewCount > 0].filter(Boolean).length
    : (negativeReviewCount > 0 ? 1 : 0);
  const reviewSignalWeight = reviewSourceSignals >= 2 ? 2 : negativeReviewCount > 0 ? 1 : 0;
  const sourceSignalWeight = [returnUnits > 0, refundUnits > 0].filter(Boolean).length + reviewSignalWeight;
  return sourceSignalWeight >= 2;
}

function countRecentSignalEvents(events, days) {
  return events.filter((event) => isRecentDate(event.createdAt, days)).reduce((total, event) => total + Number(event.value || 1), 0);
}

function isRecentDate(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function getLatestEventDate(events) {
  const latest = events
    .map((event) => new Date(event.createdAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((first, second) => second - first)[0];
  return latest ? new Date(latest).toISOString() : null;
}

function countTopValues(values, limit) {
  const counts = new Map();
  values.map((value) => String(value || "").trim()).filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function preferFreshNumber(fresh, fallback) {
  const number = Number(fresh || 0);
  if (number > 0) return number;
  return Number(fallback || 0);
}

function sumBy(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function roundRate(value, decimals = 2) {
  const number = Number(value || 0);
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function truncateText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizeIssueCode(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("size")) return "fit_sizing";
  if (normalized.includes("color")) return "color_expectation";
  if (normalized.includes("safety") || normalized.includes("unsafe") || normalized.includes("danger") || normalized.includes("hazard") || normalized.includes("peligro")) return "safety_concern";
  if (normalized.includes("subjective") || normalized.includes("preference") || normalized.includes("dislike") || normalized.includes("fear") || normalized.includes("scare") || normalized.includes("creepy") || normalized.includes("miedo") || normalized.includes("asusta") || normalized.includes("terror")) return "subjective_negative_reaction";
  if (normalized.includes("durability")) return "durability";
  if (normalized.includes("defect") || normalized.includes("quality") || normalized.includes("soft") || normalized.includes("rough") || normalized.includes("scratchy") || normalized.includes("stiff") || normalized.includes("material") || normalized.includes("fabric") || normalized.includes("texture")) return "quality_defect";
  if (normalized.includes("compat")) return "compatibility";
  if (normalized.includes("shipping")) return "shipping_delivery";
  if (normalized.includes("refund")) return "refund_impact";
  if (normalized.includes("content") || normalized.includes("description") || normalized.includes("metadata")) return "product_content";
  if (normalized.includes("product_quality")) return "product_quality";
  return normalized;
}

function getHumanIssueLabel(issue) {
  const labels = {
    fit_sizing: "Fit & sizing",
    color_expectation: "Color expectations",
    durability: "Durability",
    quality_defect: "Product quality",
    compatibility: "Compatibility",
    shipping_delivery: "Shipping or delivery",
    product_content: "Product content",
    product_quality: "Product quality",
    safety_concern: "Safety concern",
    subjective_negative_reaction: "Subjective negative reaction",
    negative_sentiment: "Negative customer sentiment",
    repeated_language: "Repeated customer language",
    return_rate_anomaly: "Return rate anomaly",
    refund_impact: "Refund impact",
  };
  return labels[issue] || capitalize(String(issue || "Product quality").replace(/_/g, " "));
}

function getPdpActionId(issue) {
  if (issue === "fit_sizing") return "draft-fit-note";
  if (issue === "color_expectation") return "draft-color-expectation-note";
  if (issue === "safety_concern") return "draft-safety-expectation-note";
  if (issue === "subjective_negative_reaction") return "draft-subjective-expectation-note";
  if (issue === "compatibility") return "draft-compatibility-faq";
  if (issue === "product_content") return "rewrite-product-description";
  return "draft-pdp-copy";
}

function getPdpActionLabel(issue) {
  if (issue === "fit_sizing") return "Draft fit note for product description";
  if (issue === "color_expectation") return "Draft color expectation note";
  if (issue === "safety_concern") return "Draft safety expectation note";
  if (issue === "subjective_negative_reaction") return "Draft expectation-setting note";
  if (issue === "compatibility") return "Draft compatibility FAQ";
  if (issue === "durability") return "Draft durability expectation note";
  if (issue === "product_content") return "Rewrite product description";
  return "Draft product quality note";
}

function getPdpCopyPlacement(issue) {
  if (issue === "compatibility") return "append";
  return "prepend";
}

function getIssueTag(issue) {
  if (issue === "fit_sizing") return "fit_issue";
  if (issue === "color_expectation") return "color_expectation_issue";
  if (issue === "durability") return "durability_issue";
  if (issue === "quality_defect") return "quality_issue";
  if (issue === "safety_concern") return "safety_concern";
  if (issue === "subjective_negative_reaction") return "";
  if (issue === "product_content") return "content_issue";
  return "";
}

function buildDefaultPdpCopy(title, issueLabel, topReasons) {
  const reason = topReasons.length ? ` Customer signals mention ${topReasons.join(", ")}.` : "";
  return `${title}: ProductPulse detected ${issueLabel.toLowerCase()} signals.${reason} Add clear shopper-facing guidance before purchase to reduce avoidable returns and support questions.`;
}

function shouldRecommendFullDescriptionRewrite({ contentIssues = [], currentDescription = "" }) {
  const description = normalizeDraftParagraph(currentDescription);
  const wordCount = description ? description.split(/\s+/).filter(Boolean).length : 0;
  if (!description || wordCount < 25) return true;
  const hasTargetedCorrection = getDescriptionReplacementsFromContentIssues(contentIssues).length > 0;

  return (Array.isArray(contentIssues) ? contentIssues : []).some((issue) => {
    const code = normalizeContentIssueCode(issue.code);
    const label = normalizeText(`${issue.label || ""} ${issue.evidence || ""}`);
    const severity = normalizeSeverity(issue.severity);
    if (hasTargetedCorrection && TARGETED_DESCRIPTION_CORRECTION_CODES.has(code)) return false;
    if (FULL_DESCRIPTION_REWRITE_CODES.has(code)) return true;
    if (severity !== "high") return false;
    if (code === "title_description_mismatch") {
      return /(wrong product|different product|unrelated product|about another product|clearly disconnected|clearly different)/.test(label);
    }
    return /(wrong product|different product|unrelated product|about another product|clearly disconnected|clearly different|incoherent)/.test(label);
  });
}

const FULL_DESCRIPTION_REWRITE_CODES = new Set([
  "missing_description",
  "short_description",
  "incoherent_description",
  "wrong_product_description",
]);

const TARGETED_DESCRIPTION_CORRECTION_CODES = new Set([
  "description_variant_mismatch",
  "title_description_mismatch",
  "contradiction",
]);

function getDescriptionReplacementsFromContentIssues(contentIssues = []) {
  return (Array.isArray(contentIssues) ? contentIssues : [])
    .flatMap((issue) => {
      let replacements = [];
      if (Array.isArray(issue.replacements)) replacements = issue.replacements;
      else if (issue.replacement) replacements = [issue.replacement];
      return replacements.map((replacement) => ({
        from: String(replacement.from || "").trim(),
        to: String(replacement.to || "").trim(),
        reason: replacement.reason || issue.evidence || "",
      }));
    })
    .filter((replacement) => replacement.from && replacement.to && normalizeText(replacement.from) !== normalizeText(replacement.to));
}

function buildCorrectedDescriptionDraft({ currentDescription = "", replacements = [] } = {}) {
  return applyTextReplacements(normalizeDraftParagraph(currentDescription), replacements);
}

function applyTextReplacements(value, replacements = []) {
  return (Array.isArray(replacements) ? replacements : []).reduce((text, replacement) => {
    if (!replacement?.from || !replacement?.to) return text;
    return replaceTextCaseInsensitive(text, replacement.from, replacement.to);
  }, String(value || ""));
}

function replaceTextCaseInsensitive(value, from, to) {
  const escaped = escapeRegExp(String(from || "").trim());
  if (!escaped) return value;
  return String(value || "").replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
}

function isMeaningfullyDifferentDescription(currentDescription = "", nextDescription = "") {
  return Boolean(normalizeDraftParagraph(nextDescription))
    && normalizeText(currentDescription) !== normalizeText(nextDescription);
}

function buildDescriptionGuidanceAddendum({ title, contentIssues = [], suggestedDescription = "", shopperGuidance = "" }) {
  const focusedGuidance = normalizeDraftParagraph(shopperGuidance);
  if (focusedGuidance) return focusedGuidance;

  const suggested = normalizeDraftParagraph(suggestedDescription);
  if (suggested && !looksLikeFullDescriptionRewrite(suggested, title)) return suggested;

  const issueLabels = (Array.isArray(contentIssues) ? contentIssues : [])
    .map((issue) => issue.label || getContentIssueLabel(issue.code))
    .filter(Boolean);
  const evidence = (Array.isArray(contentIssues) ? contentIssues : [])
    .map((issue) => issue.evidence)
    .filter(Boolean);
  const focus = issueLabels.length ? issueLabels.slice(0, 3).join(", ").toLowerCase() : "product expectations";
  const detail = evidence.length ? ` This note is based on: ${evidence.slice(0, 2).join(" ")}` : "";
  return `${title}: add a short shopper-facing note that clarifies ${focus}.${detail}`;
}

function looksLikeFullDescriptionRewrite(value, title) {
  const text = normalizeDraftParagraph(value);
  if (!text) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 45) return true;
  const titleTokens = meaningfulTokens(title);
  const textTokens = new Set(meaningfulTokens(text));
  return wordCount >= 30 && titleTokens.filter((token) => textTokens.has(token)).length >= Math.min(2, titleTokens.length);
}

function buildDefaultDescriptionRewrite(title, contentAnalysis) {
  const findings = [
    ...(Array.isArray(contentAnalysis?.issues) ? contentAnalysis.issues : []),
    ...(Array.isArray(contentAnalysis?.advisories) ? contentAnalysis.advisories : []),
  ];
  const issues = findings.length ? findings.map((issue) => issue.label).join(", ") : "product content gaps";
  return `${title}: rewrite the product description so it clearly explains what the product is, who it is for, key specifications, important options, and any expectation-setting details. ProductPulse found ${issues}.`;
}

function buildEnhancedDescriptionDraft({ title, currentDescription, suggestedDescription, shopperGuidance, contentAnalysis }) {
  const current = normalizeDraftParagraph(currentDescription);
  const suggested = normalizeDraftParagraph(suggestedDescription);
  const guidance = normalizeDraftParagraph(shopperGuidance);
  const fallback = normalizeDraftParagraph(buildDefaultDescriptionRewrite(title, contentAnalysis));
  const usableSuggested = suggested && (!current || !hasSubstantialOverlap(current, suggested)) ? suggested : "";
  const additions = [guidance, usableSuggested || fallback].filter(Boolean);
  const uniqueAdditions = [];

  additions.forEach((addition) => {
    if (!addition) return;
    const alreadyInCurrent = current && hasSubstantialOverlap(current, addition);
    const alreadyQueued = uniqueAdditions.some((existing) => hasSubstantialOverlap(existing, addition));
    if (!alreadyInCurrent && !alreadyQueued) uniqueAdditions.push(addition);
  });

  if (!current) return uniqueAdditions.join("\n\n") || fallback;
  if (!uniqueAdditions.length) return current;
  return [current, ...uniqueAdditions].join("\n\n");
}

function normalizeDraftParagraph(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasSubstantialOverlap(firstValue, secondValue) {
  const first = normalizeText(firstValue);
  const second = normalizeText(secondValue);
  if (!first || !second) return false;
  if (first.includes(second) || second.includes(first)) return true;
  const firstTokens = new Set(first.split(/\s+/).filter((token) => token.length > 4));
  const secondTokens = second.split(/\s+/).filter((token) => token.length > 4);
  if (!firstTokens.size || !secondTokens.length) return false;
  const shared = secondTokens.filter((token) => firstTokens.has(token)).length;
  return shared / Math.max(secondTokens.length, 1) >= 0.72;
}

function getSeverityLabel(score) {
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function getRiskToneFromSeverity(severity, score) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized.includes("high") || normalized.includes("critical")) return "critical";
  if (normalized.includes("medium") || normalized.includes("moderate")) return "warning";
  if (normalized.includes("low")) return "success";
  if (score >= 75) return "critical";
  if (score >= 55) return "warning";
  return "success";
}

function getTrendTone(values, fallbackScore = 0) {
  const trendValues = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (trendValues.length >= 2) {
    const first = trendValues[0];
    const last = trendValues[trendValues.length - 1];
    if (last > first) return "red";
    if (last < first) return "green";
  }
  if (fallbackScore >= 75) return "red";
  if (fallbackScore >= 55) return "orange";
  return "green";
}

function containsIssueLanguage(text) {
  return /(too small|too large|doesn.?t fit|broken|poor quality|defect|thin|softness|not soft|rough|scratchy|stiff|color|not as pictured|disappointed|return)/i.test(String(text || ""));
}

function getNodes(connection) {
  if (Array.isArray(connection?.nodes)) return connection.nodes.filter(Boolean);
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node).filter(Boolean);
  if (Array.isArray(connection)) return connection.filter(Boolean);
  return [];
}

function getSinceDate(windowDays) {
  const date = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function isShopifyOrderAccessDenied(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return message.includes("access_denied") || message.includes("not approved to access the order object") || message.includes("order object");
}

function isMissingReturnReasonDefinitionError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return message.includes("returnreasondefinition") && message.includes("doesn") && message.includes("returnlineitem");
}

function isShopifyQueryCostLimitError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return message.includes("query cost") && message.includes("exceeds") && message.includes("max cost");
}

function extractNumericShopifyId(gid) {
  return String(gid || "").split("/").pop() || "";
}

function escapeShopifyQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|blockquote|tr|td|th)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : " ";
    })
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const __productPulseDiagnosisTestHooks = {
  buildDiagnosisRefundsQuery,
  buildDiagnosisReturnsQuery,
  buildRefundOrderQueries,
  buildReturnOrderQueries,
  normalizeDiagnosisOrderLevelRefundLineItemEvent,
  shouldUseDiagnosisOrderLevelRefundFallback,
  getRefundOperationalText,
  getRefundReasonText,
  getRefundAdjustmentReasons,
  getReturnLineItemNoteText,
  getReturnReasonValue,
  getNodes,
  buildCustomerTextInsights,
  calculateDeterministicDiagnosis,
  buildRefundOperationalInsights,
  calculateConfidence,
  calculateRiskScore,
  calculateRiskScoreBreakdown,
  buildSignalRelevanceGuidance,
  buildFinalIssues,
  buildFinalRecommendations,
  analyzeFaqOpportunity,
  buildRecommendedFaqItems,
  analyzeProductContentDeterministically,
  buildContentAnalysis,
  shouldRecommendFullDescriptionRewrite,
  classifyIssueText,
  getCsvReviewMatchConfidence,
  isShopifyQueryCostLimitError,
  lineItemMatchesProduct,
  cleanProductDescription,
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function jsonSafe(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, jsonSafe(nestedValue)]),
  );
}
