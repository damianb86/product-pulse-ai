import prisma from "../db.server";
import { runProductDiagnosisAiAnalysis } from "./product-pulse-ai.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";
import {
  buildDatedSignalTrend,
  buildIssueTrendMap,
  buildRiskTrendFromSignalTrend,
} from "./product-pulse-trends.server";

const DIAGNOSIS_WINDOW_DAYS = 90;
const MAX_ORDER_PAGES = 5;
const MAX_JUDGEME_REVIEW_PAGES = 3;
const MAX_JUDGEME_SYNC_PAGES = 5;
const JUDGEME_BASE_URLS = ["https://api.judge.me/api/v1", "https://judge.me/api/v1"];
const DIAGNOSIS_ORDERS_PAGE_SIZE = 8;
const DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE = 25;
const DIAGNOSIS_REFUND_LINE_ITEMS_PAGE_SIZE = 20;
const MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE = 2;
const DIAGNOSIS_RETURN_QUERY_PLANS = [
  { label: "balanced", ordersFirst: 8, returnsFirst: 3, returnLineItemsFirst: 15, includeVariantProduct: true },
  { label: "low-cost", ordersFirst: 5, returnsFirst: 2, returnLineItemsFirst: 10, includeVariantProduct: true },
  { label: "minimal", ordersFirst: 4, returnsFirst: 2, returnLineItemsFirst: 8, includeVariantProduct: false },
];

export async function runDetailedProductDiagnosis({ shop, jobId, admin, snapshot }) {
  const shopifyData = await fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot });
  const judgeMeData = await fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product });
  const deterministic = calculateDeterministicDiagnosis({ snapshot, shopifyData, judgeMeData });
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
  const diagnosisPayload = buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, deterministic, ai });
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
    refunds = await fetchShopifyRefundEvents({ admin, product, snapshot });
    returns = await fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot });
  } catch (error) {
    orderAccessDenied = isShopifyOrderAccessDenied(error);
    await recordJobLog({
      shop,
      jobId,
      level: orderAccessDenied ? "warn" : "error",
      event: orderAccessDenied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_orders_failed",
      message: orderAccessDenied
        ? "Shopify denied Order object access; diagnosis will use stored QuickScan metrics and connected review data."
        : "Shopify order, refund or return extraction failed.",
      data: { error: serializeError(error), recovery: orderAccessDenied ? "snapshot-and-reviews" : "partial-shopify-data" },
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

async function fetchShopifyRefundEvents({ admin, product, snapshot }) {
  if (!admin?.graphql) return [];
  const events = [];
  let cursor = null;

  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseDiagnosisRefunds($after: String, $query: String!, $ordersFirst: Int!, $refundLineItemsFirst: Int!) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            refunds {
              id
              createdAt
              note
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
      }`,
      {
        after: cursor,
        query: `updated_at:>=${getSinceDate(DIAGNOSIS_WINDOW_DAYS)}`,
        ordersFirst: DIAGNOSIS_ORDERS_PAGE_SIZE,
        refundLineItemsFirst: DIAGNOSIS_REFUND_LINE_ITEMS_PAGE_SIZE,
      },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      (order.refunds || []).forEach((refund) => {
        getNodes(refund.refundLineItems).forEach((refundLineItem) => {
          const lineItem = refundLineItem.lineItem || {};
          if (!lineItemMatchesProduct(lineItem, product, snapshot)) return;
          events.push({
            id: refundLineItem.id,
            refundId: refund.id,
            orderId: order.id,
            createdAt: toIso(refund.createdAt || order.createdAt),
            quantity: Number(refundLineItem.quantity || 0),
            amount: Number(refundLineItem.subtotalSet?.shopMoney?.amount || 0),
            restockType: refundLineItem.restockType || "",
            note: refund.note || "",
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

  return events;
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

function calculateDeterministicDiagnosis({ snapshot, shopifyData, judgeMeData }) {
  const snapshotMetrics = snapshot.metrics || {};
  const product = shopifyData.product;
  const sales = shopifyData.sales || [];
  const refunds = shopifyData.refunds || [];
  const returns = shopifyData.returns || [];
  const reviews = judgeMeData.reviews || [];
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
  const affectedVariants = countTopValues([...returns, ...refunds].map((item) => item.variantTitle || item.sku).filter(Boolean), 4);
  const deterministicContent = analyzeProductContentDeterministically(product);
  const textInsights = buildCustomerTextInsights({ returns, reviews });
  const refundInsights = buildRefundOperationalInsights({ refunds, refundRate, soldUnits, refundUnits, refundAmount });
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, soldUnits, returnUnits, refundUnits, reviewCount });
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
  const customerSignalCount = Math.max(
    returnUnits + refundUnits + negativeReviewCount,
    Number(snapshotMetrics.signalCount || 0),
    customerIssueSignalTotal,
  );
  const signalCount = customerSignalCount + deterministicContent.issues.length;
  const riskScore = calculateRiskScore({
    snapshot,
    metrics: {
      soldUnits,
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
    },
  });
  const confidence = calculateConfidence({
    signalCount,
    sourceCoverage,
    judgeMeMatchConfidence: judgeMeData.matchConfidence,
    orderAccessDenied: shopifyData.orderAccessDenied,
    sourceAgreement: hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount }),
    recentSignals: countRecentSignalEvents(signalEvents, 30),
    mainIssue,
    textInsights,
    returnUnits,
    refundUnits,
    negativeReviewCount,
    contentIssueCount: deterministicContent.issues.length,
  });
  const estimatedImpact = calculateEstimatedImpact({
    refundAmount,
    salesAmount,
    soldUnits,
    returnUnits,
    refundUnits,
    returnRate,
    refundRate,
    negativeReviewCount,
    negativeReviewRate,
    recentNegativeReviewCount,
    signalCount,
    windowDays: DIAGNOSIS_WINDOW_DAYS,
    snapshotMetrics,
  });
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
      contentQualityScore: deterministicContent.score,
      contentQualityRisk: deterministicContent.riskLift,
      contentIssues: deterministicContent.issues,
      textInsights,
      descriptionLength: deterministicContent.descriptionLength,
      descriptionWordCount: deterministicContent.descriptionWordCount,
      hasDescription: deterministicContent.hasDescription,
      revenueAtRisk: estimatedImpact.revenueAtRisk,
      marginAtRisk: estimatedImpact.marginAtRisk,
      estimatedImpact: estimatedImpact.revenueAtRisk,
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
      topReturnReasons: topReturnReasons.map((item) => item.label),
      topReturnReasonDetails: topReturnReasons,
      affectedVariants: affectedVariants.map((item) => item.label),
      affectedVariantDetails: affectedVariants,
      reviewCount,
      negativeReviewCount,
      negativeReviewRate,
      recentNegativeReviewCount,
      judgeMeInternalProductId: judgeMeData.internalProductId,
      judgeMeMatchConfidence: judgeMeData.matchConfidence,
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
    sourceAgreement: hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount }),
  };
}

function buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, deterministic, ai }) {
  const contentAnalysis = buildContentAnalysis(deterministic, ai.contentGaps);
  const emergentSentiments = normalizeAiEmergentSentiments(ai);
  const knownEmotions = normalizeAiKnownEmotions(ai, deterministic.metrics.textInsights);
  const adjustedRiskScore = clamp(deterministic.riskScore + contentAnalysis.additionalRiskLift, 0, 100);
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
      signalCount: deterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      issueCount: deterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
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
  const issueLabel = ai.classification?.main_issue_label || getHumanIssueLabel(mainIssue);
  const mainFinding = {
    title: ai.report?.main_finding_title || `${issueLabel} signals need review`,
    detail: buildMainFindingDetail(ai.report?.main_finding_detail, scoredDeterministic, contentAnalysis),
    summary: ai.report?.evidence_summary || buildEvidenceSummary(scoredDeterministic),
  };
  const adjustedMainFinding = adjustMainFindingForSignalStrength(mainFinding, scoredDeterministic);
  const recommendations = buildFinalRecommendations({ snapshot, deterministic: scoredDeterministic, ai, mainIssue });
  const issues = buildFinalIssues({ deterministic: scoredDeterministic, ai, mainIssue, recommendations });
  const evidence = buildFinalEvidence({ deterministic: scoredDeterministic, ai, judgeMeData, shopifyData });
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

  await prisma.productRiskSnapshot.update({
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
      selectedOptions: variant.selectedOptions || [],
    })),
    collections: product.collections || [],
    metafields: product.metafields || [],
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
      signalCount: deterministic.metrics.signalCount,
      customerSignalCount: deterministic.metrics.customerSignalCount,
      contentQualityScore: deterministic.metrics.contentQualityScore,
      contentQualityRisk: deterministic.metrics.contentQualityRisk,
      contentIssueCount: deterministic.metrics.contentIssueCount,
      contentIssues: deterministic.metrics.contentIssues,
      textInsights: deterministic.metrics.textInsights,
      refundInsights: deterministic.metrics.refundInsights,
      descriptionWordCount: deterministic.metrics.descriptionWordCount,
      hasDescription: deterministic.metrics.hasDescription,
      topReturnReasons: deterministic.metrics.topReturnReasons,
      affectedVariants: deterministic.metrics.affectedVariants,
      windowDays: deterministic.metrics.windowDays,
      orderAccessDenied: deterministic.metrics.orderAccessDenied,
    },
  };
}

function buildRuleRecommendationCandidates(deterministic) {
  const issue = deterministic.mainIssue;
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, issue);
  const candidates = [];
  if (issue === "fit_sizing" && hasActionableMainIssue) {
    candidates.push({ id: "draft-fit-note", type: "PDP copy", reason: "Fit or size language appears in returns/reviews." });
    candidates.push({ id: "create-fit-faq", type: "FAQ", reason: "Repeated size questions deserve shopper-facing guidance." });
  }
  if (issue === "color_expectation" && hasActionableMainIssue) candidates.push({ id: "draft-color-expectation-note", type: "PDP copy", reason: "Customers mention color expectation mismatch." });
  if (issue === "safety_concern" && hasActionableMainIssue) candidates.push({ id: "draft-safety-expectation-note", type: "PDP copy", reason: "Customer return text expresses fear, safety concern, or discomfort." });
  if (issue === "subjective_negative_reaction" && hasActionableMainIssue) candidates.push({ id: "draft-subjective-expectation-note", type: "PDP copy", reason: "Repeated subjective negative customer language is present." });
  if ((issue === "quality_defect" || issue === "durability") && hasActionableMainIssue) candidates.push({ id: "draft-quality-note", type: "PDP copy", reason: "Quality or durability signals were detected." });
  if (deterministic.metrics.affectedVariants.length && (deterministic.metrics.returnUnits + deterministic.metrics.refundUnits) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-affected-variants", type: "Workflow", reason: "Signals are concentrated in specific variants." });
  if (deterministic.metrics.topReturnReasons.length && deterministic.metrics.returnUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-return-reasons", type: "Workflow", reason: "Return reasons are available and repeated." });
  if (deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-negative-reviews", type: "Workflow", reason: "Judge.me negative review text is available." });
  if (deterministic.metrics.contentIssueCount > 0) {
    candidates.push({ id: "rewrite-product-description", type: "PDP copy", reason: "Product content analysis found missing, short or incoherent product copy." });
    candidates.push({ id: "align-product-metadata", type: "Workflow", reason: "Title, description, tags, collections and product type should tell a consistent story." });
  }
  if (hasActionableMainIssue || deterministic.metrics.contentIssueCount > 0) candidates.push({ id: "copy-support-note", type: "Internal note", reason: "Support can use a concise product-specific note." });
  return candidates;
}

function buildFinalRecommendations({ snapshot, deterministic, ai, mainIssue }) {
  const copy = ai.report?.recommendation_copy || {};
  const recommendations = [];
  const issueLabel = getHumanIssueLabel(mainIssue);
  const topReasons = deterministic.metrics.topReturnReasons || [];
  const affectedVariants = deterministic.metrics.affectedVariants || [];
  const pdpCopy = copy.pdp_copy || buildDefaultPdpCopy(snapshot.productTitle, issueLabel, topReasons);
  const contentAnalysis = deterministic.metrics.contentAnalysis || {};
  const contentIssues = Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues : [];
  const supportNote = copy.support_note || `${snapshot.productTitle}: ${issueLabel}. Review ${topReasons.join(", ") || "stored customer signals"} and watch ${affectedVariants.join(", ") || "all variants"}.`;
  const subjectiveSummary = deterministic.metrics.textInsights?.subjectiveNegativity || {};
  const shouldRecommendSubjectiveAction = mainIssue !== "subjective_negative_reaction" || hasActionableSubjectiveEvidence(subjectiveSummary);
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, mainIssue);

  if (hasActionableMainIssue && pdpCopy && mainIssue !== "product_content" && shouldRecommendSubjectiveAction) {
    recommendations.push({
      id: getPdpActionId(mainIssue),
      label: getPdpActionLabel(mainIssue),
      type: mainIssue === "fit_sizing" && copy.faq_answer ? "PDP copy" : "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: { draftText: pdpCopy, issue: mainIssue },
    });
  }

  if (contentIssues.length > 0) {
    recommendations.push({
      id: "rewrite-product-description",
      label: "Rewrite product description",
      type: "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: copy.product_description || copy.pdp_copy || buildDefaultDescriptionRewrite(snapshot.productTitle, contentAnalysis),
        issue: "product_content",
        contentIssues: contentIssues.map((issue) => issue.label),
      },
    });

    recommendations.push({
      id: "review-product-content-alignment",
      label: "Review title, tags and collection alignment",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        contentQualityScore: contentAnalysis.score,
        contentIssues: contentIssues.map((issue) => ({
          label: issue.label,
          evidence: issue.evidence,
          severity: issue.severity,
        })),
      },
    });
  }

  if (mainIssue === "fit_sizing" && (copy.faq_question || copy.faq_answer)) {
    recommendations.push({
      id: "create-fit-faq",
      label: "Create fit FAQ",
      type: "FAQ",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: `${copy.faq_question || `How does ${snapshot.productTitle} fit?`}\n${copy.faq_answer || pdpCopy}`,
        issue: mainIssue,
      },
    });
  }

  if (topReasons.length && deterministic.metrics.returnUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    recommendations.push({
      id: "review-return-reasons",
      label: "Review return reasons",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { topReturnReasons: topReasons, returnUnits: deterministic.metrics.returnUnits },
    });
  }

  if (affectedVariants.length && (deterministic.metrics.returnUnits + deterministic.metrics.refundUnits) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    recommendations.push({
      id: "review-affected-variants",
      label: "Review affected variants",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { affectedVariants },
    });
  }

  if (deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    recommendations.push({
      id: "review-negative-reviews",
      label: "Review negative Judge.me reviews",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        negativeReviewCount: deterministic.metrics.negativeReviewCount,
        avgRating: deterministic.metrics.avgRating,
      },
    });
  }

  if (deterministic.metrics.refundInsights?.shouldSurface || (deterministic.metrics.refundUnits >= 3 && deterministic.metrics.refundAmount > 0)) {
    recommendations.push({
      id: "review-refund-impact",
      label: "Review refund impact",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        refundAmount: deterministic.metrics.refundAmount,
        refundUnits: deterministic.metrics.refundUnits,
        refundRate: deterministic.metrics.refundRate,
        refundInsights: deterministic.metrics.refundInsights,
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

  const tag = getIssueTag(mainIssue);
  if (tag && deterministic.metrics.signalCount >= 2) {
    recommendations.push({
      id: `apply-tag-${tag}`,
      label: `Apply product tag ${tag}`,
      type: "Product tag",
      effort: "Low",
      status: "Ready",
      payload: { tag, productGid: snapshot.productGid },
    });
  }

  return uniqueBy(recommendations, (item) => item.id).slice(0, 7);
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
  const aiRepeatedLanguage = Array.isArray(ai.classification?.repeated_language) ? ai.classification.repeated_language : [];
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

  (Array.isArray(ai?.classification?.repeated_language) ? ai.classification.repeated_language : []).forEach((item) => {
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

function buildFinalEvidence({ deterministic, ai, judgeMeData, shopifyData }) {
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
        refundInsights.sentiment?.total
          ? `Refund-note tone: ${refundInsights.sentiment.negative} negative, ${refundInsights.sentiment.neutral} neutral, ${refundInsights.sentiment.positive} positive`
          : "",
        ...((refundInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated refund-note language: "${item.term}" (${item.count})`)),
        ...((refundInsights.examples || []).slice(0, 3).map((item) => `Refund note: "${item.text}"`)),
      ].filter(Boolean),
    });
  }

  if (judgeMeData.connected) {
    const reviewInsights = textInsights.reviews || {};
    evidence.push({
      source: "Judge.me reviews",
      quote: `${deterministic.metrics.negativeReviewCount} negative reviews out of ${deterministic.metrics.reviewCount}`,
      weight: `${deterministic.metrics.avgRating || 0} average rating, ${deterministic.metrics.negativeReviewRate}% negative review rate`,
      points: [
        reviewInsights.sentiment?.total
          ? `Review sentiment: ${reviewInsights.sentiment.negative} negative, ${reviewInsights.sentiment.neutral} neutral, ${reviewInsights.sentiment.positive} positive`
          : "",
        reviewInsights.emotions?.length
          ? `Review emotions: ${formatEmotionCounts(reviewInsights.emotions)}`
          : "",
        ...((reviewInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated review language: "${item.term}" (${item.count})`)),
        ...((reviewInsights.examples || []).slice(0, 3).map((item) => `Review text: "${item.text}"`)),
      ].filter(Boolean),
    });
  }

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
        ...((Array.isArray(ai.classification?.repeated_language) ? ai.classification.repeated_language : []).slice(0, 3).map((item) => `AI repeated-language finding: "${item.term}" - ${item.explanation || item.sentiment || "review"}`)),
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
    selectedOptions: variant.selectedOptions || [],
  }));

  return {
    id: product.id || snapshot.productGid,
    numericId: String(product.legacyResourceId || extractNumericShopifyId(product.id) || ""),
    title: product.title || snapshot.productTitle,
    handle: product.handle || snapshot.handle,
    description: stripHtml(product.descriptionHtml || product.description || ""),
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
    vendor: metrics.vendor || "",
    productType: metrics.productType || "",
    status: "Unknown",
    tags: Array.isArray(metrics.tags) ? metrics.tags : [],
    options: [],
    variants: [],
    collections: Array.isArray(metrics.collections) ? metrics.collections : [],
    metafields: [],
  };
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
  const note = String(item?.note || item?.refundNote || "")
    .replace(/\s+/g, " ")
    .trim();
  const restockType = String(item?.restockType || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const reason = isDefaultCustomerLanguageTerm(restockType) ? "" : restockType;
  return [note, reason].filter(Boolean).join(" - ");
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
        source: "reviews",
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
      };
    })
    .filter(Boolean);
  const sentiment = summarizeSentiment(refundTexts);
  const repeatedLanguage = extractRepeatedLanguage(refundTexts).slice(0, 5);
  const issueCounts = countTopValues(refundTexts.map((item) => item.issueCode).filter(Boolean), 5);
  const highPressure = Number(soldUnits || 0) > 10 && Number(refundRate || 0) > 20;
  const monitorPressure = Number(refundUnits || 0) >= 3 && Number(refundRate || 0) >= 10;
  const dominantIssue = issueCounts[0]?.label || "refund_impact";
  const riskLift = calculateRefundOperationalRiskLift({ refundUnits, refundRate, soldUnits, noteCount: refundTexts.length });

  return {
    total: Number(refundUnits || 0),
    noteCount: refundTexts.length,
    refundRate: Number(refundRate || 0),
    refundAmount: Number(refundAmount || 0),
    soldUnits: Number(soldUnits || 0),
    highPressure,
    monitorPressure,
    level: highPressure ? "high" : monitorPressure ? "monitor" : "low",
    shouldSurface: highPressure || (monitorPressure && Number(refundUnits || 0) >= 3) || refundTexts.length >= 2,
    dominantIssueCode: normalizeIssueCode(dominantIssue) || "refund_impact",
    sentiment,
    repeatedLanguage,
    issueCounts,
    riskLift,
    examples: refundTexts.slice(0, 4).map((item) => ({
      text: truncateText(item.text, 180),
      sentiment: item.sentiment,
      emotion: item.emotion,
      issueCode: item.issueCode,
      variant: item.variant || "",
      amount: item.amount,
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
    const tokens = meaningfulTokens(analysisText).filter((token) => token.length > 3);
    const phrases = new Set([
      ...tokens,
      ...tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`),
    ]);
    phrases.forEach((term) => {
      if (term.length < 4 || isDefaultCustomerLanguageTerm(term)) return;
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

function classifyCustomerSentiment(text, rating = 0) {
  const normalized = normalizeText(text);
  const negativeMatches = countRegexMatches(normalized, /(bad|poor|cheap|thin|broken|defect|damaged|disappointed|return|refund|small|large|tight|loose|wrong|issue|problem|unhappy|terrible|awful|not fit|doesn t fit|doesnt fit|not as pictured|late|scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/g);
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

const CUSTOMER_TEXT_STOP_WORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "have",
  "were",
  "they",
  "very",
  "product",
  "return",
  "returns",
  "returned",
  "reason",
  "reasons",
  "refund",
  "refunds",
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
  if (/(break|broken|defect|damaged|quality|thin|poor|cheap|durability|durable|soft|softness|rough|scratchy|stiff|material|fabric|texture)/.test(normalized)) return "quality_defect";
  if (/(compatible|compatibility|fit with|works with)/.test(normalized)) return "compatibility";
  if (/(shipping|delivery|late|arrived)/.test(normalized)) return "shipping_delivery";
  return "product_quality";
}

function analyzeProductContentDeterministically(product) {
  const description = String(product.description || "").replace(/\s+/g, " ").trim();
  const descriptionWordCount = description ? description.split(/\s+/).filter(Boolean).length : 0;
  const normalizedDescription = normalizeText(description);
  const normalizedTitle = normalizeText(product.title);
  const productType = normalizeText(product.productType);
  const tags = Array.isArray(product.tags) ? product.tags.map(String).filter(Boolean) : [];
  const collections = Array.isArray(product.collections) ? product.collections.map(String).filter(Boolean) : [];
  const issues = [];

  if (!description) {
    issues.push(buildContentIssue("missing_description", "Missing product description", "high", "The Shopify product description is empty.", 12));
  } else if (descriptionWordCount < 25) {
    issues.push(buildContentIssue("short_description", "Short product description", "medium", `The description has ${descriptionWordCount} words.`, 7));
  }

  if (description && normalizedTitle && !hasMeaningfulTokenOverlap(normalizedTitle, normalizedDescription)) {
    issues.push(buildContentIssue("title_description_mismatch", "Title and description may be disconnected", "medium", "The description does not share meaningful product terms with the title.", 6));
  }

  if (description && productType && !normalizedDescription.includes(productType) && productType.length > 3) {
    issues.push(buildContentIssue("missing_product_type_context", "Product type is not explained", "low", `Product type "${product.productType}" is not reflected in the description.`, 3));
  }

  const descriptiveTags = tags.filter((tag) => normalizeText(tag).length > 3).slice(0, 8);
  const matchedTags = descriptiveTags.filter((tag) => normalizedDescription.includes(normalizeText(tag)));
  if (description && descriptiveTags.length >= 3 && matchedTags.length === 0) {
    issues.push(buildContentIssue("tag_description_mismatch", "Tags are not reflected in description", "low", "Product tags do not appear to be represented in the description copy.", 4));
  }

  if (description && collections.length && !collections.some((collection) => hasMeaningfulTokenOverlap(collection, description))) {
    issues.push(buildContentIssue("collection_mismatch", "Collection context is missing", "low", "Collections are not clearly reflected in the product description.", 3));
  }

  const score = clamp(100 - issues.reduce((total, issue) => total + issue.riskLift * 3, 0), 0, 100);

  return {
    hasDescription: Boolean(description),
    descriptionLength: description.length,
    descriptionWordCount,
    score,
    riskLift: Math.min(18, issues.reduce((total, issue) => total + issue.riskLift, 0)),
    issues,
  };
}

function buildContentIssue(code, label, severity, evidence, riskLift) {
  return {
    issueCode: "product_content",
    code,
    label,
    severity,
    evidence,
    riskLift,
  };
}

function buildContentAnalysis(deterministic, contentGaps) {
  const deterministicIssues = Array.isArray(deterministic.metrics.contentIssues) ? deterministic.metrics.contentIssues : [];
  const aiIssues = normalizeAiContentIssues(contentGaps);
  const issues = uniqueBy([...deterministicIssues, ...aiIssues], (issue) => `${issue.code}-${issue.label}`);
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
    riskLift,
    additionalRiskLift,
  };
}

function normalizeAiContentIssues(contentGaps) {
  return (Array.isArray(contentGaps?.content_issues) ? contentGaps.content_issues : [])
    .map((issue) => {
      const severity = normalizeSeverity(issue.severity);
      return {
        issueCode: "product_content",
        code: normalizeContentIssueCode(issue.code),
        label: issue.label || getContentIssueLabel(issue.code),
        severity,
        evidence: issue.evidence || issue.why_it_matters || issue.suggested_action || "",
        suggestedAction: issue.suggested_action || "Review product content",
        riskLift: severity === "high" ? 10 : severity === "medium" ? 6 : 3,
      };
    })
    .filter((issue) => issue.label);
}

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
        summary: negativeReviews ? `${negativeReviews} negative Judge.me reviews are available with other supporting signals.` : "No negative review pressure is leading the finding.",
        guidance: "Use reviews alongside stronger return, refund, content, or multi-source evidence.",
      },
    };
  }

  if (negativeReviews <= 2) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "weak",
        summary: `${negativeReviews} negative Judge.me review${negativeReviews === 1 ? "" : "s"} out of ${reviewCount} total reviews is an early signal only.`,
        guidance: `${negativeReviews} negative Judge.me review${negativeReviews === 1 ? "" : "s"} is below the ProductPulse action threshold. Treat it as low-confidence monitoring evidence and do not lead the main finding with review wording.`,
      },
    };
  }

  if (negativeReviews <= 4) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "emerging",
        summary: `${negativeReviews} negative Judge.me reviews out of ${reviewCount} total reviews is an emerging signal.`,
        guidance: `${negativeReviews} negative Judge.me reviews can support a low-to-medium finding, but confidence should start near 50 and increase only if returns, refunds, repeated language, or more reviews agree.`,
      },
    };
  }

  return {
    customerEvidence,
    reviewSignals: {
      level: "normal",
      summary: `${negativeReviews} negative Judge.me reviews out of ${reviewCount} total reviews is enough review volume to support the finding.`,
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
  const storeAvgReturnRate = Number(snapshot.metrics?.storeAvgReturnRate || 0);
  const storeAvgRefundRate = Number(snapshot.metrics?.storeAvgRefundRate || 0);
  const returnSampleSupport = getHardSignalSampleSupport(metrics.returnUnits);
  const refundSampleSupport = getRefundRiskSampleSupport(metrics);
  const supportedSignalCount = getSupportedRiskSignalCount(metrics);
  const returnAnomaly = (storeAvgReturnRate > 0
    ? Math.max(0, Math.min(25, ((metrics.returnRate / storeAvgReturnRate) - 1) * 14))
    : Math.min(22, metrics.returnRate * 1.2)) * returnSampleSupport;
  const refundAnomaly = (storeAvgRefundRate > 0
    ? Math.max(0, Math.min(20, ((metrics.refundRate / storeAvgRefundRate) - 1) * 11))
    : Math.min(18, metrics.refundRate)) * refundSampleSupport;
  const refundImpact = Math.min(15, Math.log10(metrics.refundAmount + 1) * 4) * refundSampleSupport;
  const reviewAnomaly = calculateReviewAnomaly(metrics);
  const signalVolume = Math.min(12, Math.sqrt(supportedSignalCount) * 2.6);
  const sourceAgreement = hasSourceAgreement({
    returnUnits: metrics.returnUnits,
    refundUnits: metrics.refundUnits,
    negativeReviewCount: metrics.negativeReviewCount,
  }) ? 9 : 0;
  const recency = supportedSignalCount
    ? Math.min(9, (countRecentSignalEvents(metrics.signalEvents, 30) / Math.max(1, metrics.signalCount)) * 15) * getHardSignalSampleSupport(supportedSignalCount)
    : 0;
  const variantConcentration = metrics.affectedVariants.length ? 5 : 0;
  const volumeWeight = metrics.soldUnits ? Math.min(7, Math.log10(metrics.soldUnits + 1) * 3) : 0;
  const contentRisk = Math.min(16, Number(metrics.contentQualityRisk || 0));
  const textSentimentRisk = calculateTextSentimentRisk(metrics.textInsights);
  const refundOperationalRisk = Math.min(10, Number(metrics.refundInsights?.riskLift || 0));
  const calculated = Math.round(8 + returnAnomaly + refundAnomaly + refundImpact + refundOperationalRisk + reviewAnomaly + signalVolume + sourceAgreement + recency + variantConcentration + volumeWeight + contentRisk + textSentimentRisk);

  if (!metrics.signalCount && !metrics.contentIssueCount && Number(snapshot.riskScore || 0) > 0) return Number(snapshot.riskScore);
  return clamp(calculated, 0, 100);
}

function calculateTextSentimentRisk(textInsights) {
  const total = Number(textInsights?.sentiment?.total || 0);
  if (!total) return 0;
  const negative = Number(textInsights?.sentiment?.negative || 0);
  const subjective = Number(textInsights?.subjectiveNegativity?.count || 0);
  const subjectiveRatio = Number(textInsights?.subjectiveNegativity?.ratio || 0);
  const objectiveNegative = Math.max(0, negative - subjective);
  const objectiveSampleSupport = getHardSignalSampleSupport(objectiveNegative);
  const objectiveRisk = Math.min(8, (objectiveNegative / total) * 10) * objectiveSampleSupport;
  const subjectiveRisk = calculateSubjectiveTextRisk({ count: subjective, ratio: subjectiveRatio });
  return Math.min(8, objectiveRisk + subjectiveRisk);
}

function getSupportedRiskSignalCount(metrics) {
  const hardSignals = Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0) + Number(metrics.negativeReviewCount || 0);
  const repeatedLanguageSignals = Math.max(...(metrics.textInsights?.repeatedLanguage || []).map((item) => Number(item.count || 0)), 0);
  const subjectiveSignals = hasActionableSubjectiveEvidence(metrics.textInsights?.subjectiveNegativity)
    ? Number(metrics.textInsights?.subjectiveNegativity?.count || 0)
    : 0;
  const contentSignals = Number(metrics.contentIssueCount || 0);
  return Math.max(
    hardSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE ? hardSignals : 0,
    repeatedLanguageSignals,
    subjectiveSignals,
    contentSignals,
  );
}

function getHardSignalSampleSupport(count) {
  const signalCount = Number(count || 0);
  if (signalCount <= 0) return 0;
  if (signalCount === 1) return 0.28;
  if (signalCount === 2) return 0.58;
  if (signalCount === 3) return 0.74;
  if (signalCount === 4) return 0.86;
  return 1;
}

function getRefundRiskSampleSupport(metrics) {
  const refundUnits = Number(metrics.refundUnits || 0);
  if (refundUnits <= 0) return 0;
  const base = getHardSignalSampleSupport(refundUnits);
  const soldUnits = Number(metrics.soldUnits || 0);
  const refundRate = Number(metrics.refundRate || 0);
  if (soldUnits > 10 && refundRate > 20) return 1;
  if (refundUnits <= 2) return base * 0.45;
  if (soldUnits > 0 && soldUnits <= 10) return base * 0.62;
  return Math.min(1, base * 0.85);
}

function calculateSubjectiveTextRisk({ count, ratio }) {
  const subjectiveCount = Number(count || 0);
  const subjectiveRatio = Number(ratio || 0);
  if (!subjectiveCount) return 0;
  if (subjectiveCount <= 1) return Math.min(1.5, subjectiveRatio * 1.5);
  if (!hasActionableSubjectiveEvidence({ count: subjectiveCount, ratio: subjectiveRatio })) {
    return Math.min(3.5, 1.2 + subjectiveRatio * 3 + Math.log2(subjectiveCount + 1) * 0.55);
  }
  return Math.min(8, 2.8 + subjectiveRatio * 6 + Math.log2(subjectiveCount + 1) * 0.9);
}

function calculateReviewAnomaly(metrics) {
  const reviewCount = Number(metrics.reviewCount || 0);
  const negativeReviewCount = Number(metrics.negativeReviewCount || 0);
  if (!reviewCount || !negativeReviewCount) return 0;

  const ratePressure = Number(metrics.negativeReviewRate || 0) * 0.18;
  const ratingPressure = Math.max(0, 4 - Number(metrics.avgRating || 0)) * 2.5;
  const raw = Math.min(20, ratePressure + ratingPressure);
  const sampleSupport = negativeReviewCount <= 1
    ? 0.18
    : negativeReviewCount === 2
      ? 0.32
      : negativeReviewCount <= 4
        ? 0.58
        : Math.min(1, 0.62 + Math.log2(negativeReviewCount) / 5);

  return roundRate(raw * sampleSupport, 2);
}

function calculateConfidence({
  signalCount,
  sourceCoverage,
  judgeMeMatchConfidence,
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
  const match = Math.round((judgeMeMatchConfidence || 0) * 16);
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

function calculateEstimatedImpact({
  refundAmount,
  salesAmount,
  soldUnits,
  returnUnits,
  refundUnits,
  returnRate,
  refundRate,
  negativeReviewCount,
  negativeReviewRate,
  recentNegativeReviewCount,
  signalCount,
  windowDays,
  snapshotMetrics,
}) {
  const knownRefundValue = Number(refundAmount || snapshotMetrics.refundAmount || 0);
  const knownSalesAmount = Number(salesAmount || snapshotMetrics.salesAmount || 0);
  const knownSoldUnits = Number(soldUnits || snapshotMetrics.soldUnits || 0);
  const knownReturnUnits = Number(returnUnits || snapshotMetrics.returnUnits || 0);
  const knownRefundUnits = Number(refundUnits || snapshotMetrics.refundUnits || 0);
  const knownReturnRate = Number(returnRate || snapshotMetrics.returnRate || 0) / 100;
  const knownRefundRate = Number(refundRate || snapshotMetrics.refundRate || 0) / 100;
  const knownNegativeReviewCount = Number(negativeReviewCount || snapshotMetrics.negativeReviewCount || 0);
  const knownNegativeReviewRate = Number(negativeReviewRate || snapshotMetrics.negativeReviewRate || 0) / 100;
  const knownSignalCount = Number(signalCount || snapshotMetrics.signalCount || 0);
  const avgUnitRevenue = roundCurrency(
    knownSoldUnits > 0 && knownSalesAmount > 0
      ? knownSalesAmount / knownSoldUnits
      : knownRefundUnits > 0 && knownRefundValue > 0
        ? knownRefundValue / knownRefundUnits
        : Number(snapshotMetrics.avgUnitRevenue || 0),
  );

  const affectedUnitValue = avgUnitRevenue > 0
    ? avgUnitRevenue * Math.max(knownReturnUnits, knownRefundUnits)
    : 0;
  const returnRateValueAtRisk = knownSalesAmount > 0
    ? knownSalesAmount * Math.max(knownReturnRate, knownRefundRate)
    : affectedUnitValue;
  const reviewSignalPressure = Math.max(knownNegativeReviewRate, knownNegativeReviewCount > 0 ? knownNegativeReviewCount / Math.max(knownSignalCount, knownNegativeReviewCount, 1) : 0);
  const reviewConversionDrag = knownSalesAmount > 0 && reviewSignalPressure > 0
    ? knownSalesAmount * clamp(reviewSignalPressure * 0.35, 0, 0.18)
    : 0;
  const recencyMultiplier = recentNegativeReviewCount || knownSignalCount
    ? 1 + clamp(Number(recentNegativeReviewCount || 0) / Math.max(knownSignalCount, 1), 0, 0.25)
    : 1;

  const projectedFutureRefundLoss = windowDays > 0 ? roundCurrency((knownRefundValue / windowDays) * 30) : 0;
  const projectedFutureReturnLoss = windowDays > 0 ? roundCurrency((returnRateValueAtRisk / windowDays) * 30) : 0;
  const revenueAtRisk = roundCurrency(Math.max(
    Number(snapshotMetrics.revenueAtRisk || 0),
    knownRefundValue + projectedFutureRefundLoss,
    (returnRateValueAtRisk + projectedFutureReturnLoss + reviewConversionDrag) * recencyMultiplier,
  ));
  const marginAtRisk = roundCurrency(Math.max(
    Number(snapshotMetrics.marginAtRisk || 0),
    revenueAtRisk * 0.45,
  ));

  return {
    refundValueAtRisk: knownRefundValue,
    projectedFutureRefundLoss,
    projectedFutureReturnLoss,
    reviewConversionDrag: roundCurrency(reviewConversionDrag),
    revenueAtRisk,
    marginAtRisk,
    avgUnitRevenue,
  };
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
  reviews.slice(0, 40).forEach((review) => {
    snippets.push({
      source: "judgeme_review",
      text: [review.title, review.body].filter(Boolean).join(" - ").slice(0, 900),
      createdAt: review.createdAt,
      rating: review.rating,
      product: product.title,
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
  return snippets.slice(0, 60);
}

function buildSourceCoverage({ shopifyData, judgeMeData, soldUnits, returnUnits, refundUnits, reviewCount }) {
  const sources = ["Shopify product"];
  if (soldUnits > 0 || !shopifyData.orderAccessDenied) sources.push("Shopify orders");
  if (returnUnits > 0) sources.push("Shopify returns");
  if (refundUnits > 0) sources.push("Shopify refunds");
  if (judgeMeData.connected) sources.push("Judge.me reviews");
  if (reviewCount > 0 && !sources.includes("Judge.me reviews")) sources.push("Judge.me reviews");
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
      ? `${metrics.negativeReviewCount} negative Judge.me reviews out of ${metrics.reviewCount}`
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

function hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount }) {
  return [returnUnits > 0, refundUnits > 0, negativeReviewCount > 0].filter(Boolean).length >= 2;
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

function buildDefaultDescriptionRewrite(title, contentAnalysis) {
  const issues = Array.isArray(contentAnalysis?.issues) ? contentAnalysis.issues.map((issue) => issue.label).join(", ") : "product content gaps";
  return `${title}: rewrite the product description so it clearly explains what the product is, who it is for, key specifications, important options, and any expectation-setting details. ProductPulse found ${issues}.`;
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
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
  buildDiagnosisReturnsQuery,
  buildReturnOrderQueries,
  getReturnLineItemNoteText,
  getReturnReasonValue,
  getNodes,
  buildCustomerTextInsights,
  buildRefundOperationalInsights,
  calculateConfidence,
  calculateRiskScore,
  buildSignalRelevanceGuidance,
  buildFinalIssues,
  classifyIssueText,
  isShopifyQueryCostLimitError,
  lineItemMatchesProduct,
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
