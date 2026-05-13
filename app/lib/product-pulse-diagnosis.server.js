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
      riskScore: deterministic.riskScore,
      confidence: deterministic.confidence,
      estimatedImpact: deterministic.estimatedImpact,
      mainIssue: deterministic.mainIssue,
      sourceCoverage: deterministic.sourceCoverage,
    },
  });

  const ai = await runProductDiagnosisAiAnalysis({ shop, jobId, input: aiInput });
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
    returns = await fetchShopifyReturnEvents({ admin, product, snapshot });
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
      query ProductPulseDiagnosisSales($after: String, $query: String!) {
        orders(first: 20, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            lineItems(first: 50) {
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
      { after: cursor, query: `created_at:>=${getSinceDate(DIAGNOSIS_WINDOW_DAYS)}` },
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
      query ProductPulseDiagnosisRefunds($after: String, $query: String!) {
        orders(first: 20, after: $after, query: $query) {
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
              refundLineItems(first: 25) {
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
      { after: cursor, query: `created_at:>=${getSinceDate(DIAGNOSIS_WINDOW_DAYS)}` },
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

async function fetchShopifyReturnEvents({ admin, product, snapshot }) {
  if (!admin?.graphql) return [];
  const events = [];
  let cursor = null;

  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseDiagnosisReturns($after: String, $query: String!) {
        orders(first: 15, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            returns(first: 5) {
              nodes {
                id
                createdAt
                status
                returnLineItems(first: 20) {
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
      { after: cursor, query: `created_at:>=${getSinceDate(DIAGNOSIS_WINDOW_DAYS)}` },
    );

    (data?.orders?.nodes || []).forEach((order) => {
      getNodes(order.returns).forEach((itemReturn) => {
        getNodes(itemReturn.returnLineItems).forEach((returnLineItem) => {
          const lineItem = returnLineItem.fulfillmentLineItem?.lineItem || {};
          if (!lineItemMatchesProduct(lineItem, product, snapshot)) return;
          events.push({
            id: returnLineItem.id,
            returnId: itemReturn.id,
            orderId: order.id,
            createdAt: toIso(itemReturn.createdAt || order.createdAt),
            status: itemReturn.status || "",
            quantity: Number(returnLineItem.quantity || returnLineItem.processedQuantity || returnLineItem.refundedQuantity || 0),
            processedQuantity: Number(returnLineItem.processedQuantity || 0),
            refundedQuantity: Number(returnLineItem.refundedQuantity || 0),
            reason: returnLineItem.returnReason || "",
            reasonNote: returnLineItem.returnReasonNote || "",
            customerNote: returnLineItem.customerNote || "",
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
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, soldUnits, returnUnits, refundUnits, reviewCount });
  const signalEvents = buildSignalEvents({ returns, refunds, negativeReviews });
  const signalTrendResult = buildDatedSignalTrend(signalEvents);
  const signalTrend = signalTrendResult.values;
  const issueSignalTrends = buildIssueTrendMap(signalEvents);
  const issueSignalCounts = buildIssueSignalCounts({ returns, refunds, reviews: negativeReviews });
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
  const adjustedRiskScore = clamp(deterministic.riskScore + contentAnalysis.additionalRiskLift, 0, 100);
  const scoredDeterministic = {
    ...deterministic,
    riskScore: adjustedRiskScore,
    metrics: {
      ...deterministic.metrics,
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
  const recommendations = buildFinalRecommendations({ snapshot, deterministic: scoredDeterministic, ai, mainIssue });
  const issues = buildFinalIssues({ deterministic: scoredDeterministic, ai, mainIssue, recommendations });
  const evidence = buildFinalEvidence({ deterministic: scoredDeterministic, ai, judgeMeData, shopifyData });
  const metrics = {
    ...scoredDeterministic.metrics,
    diagnosisReport: {
      mainFinding,
      evidenceSummary: mainFinding.summary,
      issueNames: Array.isArray(ai.report?.issue_names) ? ai.report.issue_names.slice(0, 8) : [],
      aiModels: ai.modelsUsed,
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
    mainFinding,
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
  return {
    riskScore: deterministic.riskScore,
    confidence: deterministic.confidence,
    mainIssue: deterministic.mainIssue,
    mainIssueLabel: deterministic.mainIssueLabel,
    estimatedImpact: deterministic.estimatedImpact,
    sourceAgreement: deterministic.sourceAgreement,
    evidenceSummary: buildEvidenceSummary(deterministic),
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
  const candidates = [];
  if (issue === "fit_sizing" && deterministic.metrics.signalCount > 0) {
    candidates.push({ id: "draft-fit-note", type: "PDP copy", reason: "Fit or size language appears in returns/reviews." });
    candidates.push({ id: "create-fit-faq", type: "FAQ", reason: "Repeated size questions deserve shopper-facing guidance." });
  }
  if (issue === "color_expectation") candidates.push({ id: "draft-color-expectation-note", type: "PDP copy", reason: "Customers mention color expectation mismatch." });
  if (issue === "quality_defect" || issue === "durability") candidates.push({ id: "draft-quality-note", type: "PDP copy", reason: "Quality or durability signals were detected." });
  if (deterministic.metrics.affectedVariants.length) candidates.push({ id: "review-affected-variants", type: "Workflow", reason: "Signals are concentrated in specific variants." });
  if (deterministic.metrics.topReturnReasons.length) candidates.push({ id: "review-return-reasons", type: "Workflow", reason: "Return reasons are available and repeated." });
  if (deterministic.metrics.negativeReviewCount > 0) candidates.push({ id: "review-negative-reviews", type: "Workflow", reason: "Judge.me negative review text is available." });
  if (deterministic.metrics.contentIssueCount > 0) {
    candidates.push({ id: "rewrite-product-description", type: "PDP copy", reason: "Product content analysis found missing, short or incoherent product copy." });
    candidates.push({ id: "align-product-metadata", type: "Workflow", reason: "Title, description, tags, collections and product type should tell a consistent story." });
  }
  if (deterministic.metrics.signalCount > 0) candidates.push({ id: "copy-support-note", type: "Internal note", reason: "Support can use a concise product-specific note." });
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

  if (deterministic.metrics.signalCount > 0 && pdpCopy && mainIssue !== "product_content") {
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

  if (topReasons.length) {
    recommendations.push({
      id: "review-return-reasons",
      label: "Review return reasons",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { topReturnReasons: topReasons, returnUnits: deterministic.metrics.returnUnits },
    });
  }

  if (affectedVariants.length) {
    recommendations.push({
      id: "review-affected-variants",
      label: "Review affected variants",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { affectedVariants },
    });
  }

  if (deterministic.metrics.negativeReviewCount > 0) {
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

  if (deterministic.metrics.refundAmount > 0) {
    recommendations.push({
      id: "review-refund-impact",
      label: "Review refund impact",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { refundAmount: deterministic.metrics.refundAmount, refundUnits: deterministic.metrics.refundUnits },
    });
  }

  if (supportNote) {
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
  const mappedIssues = clusters.slice(0, 5).map((cluster, index) => {
    const issueCode = normalizeIssueCode(cluster.issue_category || cluster.issue || mainIssue) || mainIssue;
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = cluster.severity || getSeverityLabel(deterministic.riskScore);

    return {
      issue: cluster.human_name || cluster.label || getHumanIssueLabel(issueCode),
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: Math.max(35, Math.min(99, deterministic.confidence - index * 7)),
      signals: Number(cluster.signals || deterministic.issueSignalCounts[issueCode] || Math.max(1, Math.round(deterministic.metrics.signalCount / (index + 1)))),
      evidence: cluster.summary ? [cluster.summary] : deterministic.metrics.topReturnReasons,
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: recommendations[index]?.label || firstAction,
    };
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

  return mappedIssues.slice(0, 6);
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
    evidence.push({
      source: "Shopify returns",
      quote: deterministic.metrics.topReturnReasons.length ? deterministic.metrics.topReturnReasons.join(", ") : "Return units detected",
      weight: `${deterministic.metrics.returnUnits} return units, ${deterministic.metrics.returnRate}% return rate`,
    });
  }

  if (deterministic.metrics.refundUnits > 0 || deterministic.metrics.refundAmount > 0) {
    evidence.push({
      source: "Shopify refunds",
      quote: `${formatMoney(deterministic.metrics.refundAmount)} refunded`,
      weight: `${deterministic.metrics.refundUnits} refunded units, ${deterministic.metrics.refundRate}% refund rate`,
    });
  }

  if (judgeMeData.connected) {
    evidence.push({
      source: "Judge.me reviews",
      quote: `${deterministic.metrics.negativeReviewCount} negative reviews out of ${deterministic.metrics.reviewCount}`,
      weight: `${deterministic.metrics.avgRating || 0} average rating, ${deterministic.metrics.negativeReviewRate}% negative review rate`,
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
  if (lineProduct.id && (lineProduct.id === product.id || lineProduct.id === snapshot.productGid)) return true;
  if (lineProduct.handle && (lineProduct.handle === product.handle || lineProduct.handle === snapshot.handle)) return true;
  const numericProductId = product.numericId || extractNumericShopifyId(snapshot.productGid);
  return numericProductId && String(lineProduct.id || "").endsWith(`/${numericProductId}`);
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
      const text = [item.reason, item.reasonNote, item.customerNote].filter(Boolean).join(" ");
      return {
        type: "return",
        createdAt: item.createdAt,
        value: Number(item.quantity || 1),
        text,
        issueCode: classifyIssueText(text),
      };
    }),
    ...refunds.map((item) => {
      const text = item.restockType || "Refund impact";
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
  ].filter((item) => item.createdAt);
}

function buildIssueSignalCounts({ returns, refunds, reviews }) {
  const counts = {};
  [...returns, ...reviews].forEach((item) => {
    const text = [
      item.reason,
      item.reasonNote,
      item.customerNote,
      item.title,
      item.body,
    ].filter(Boolean).join(" ");
    const issue = classifyIssueText(text);
    counts[issue] = (counts[issue] || 0) + 1;
  });
  refunds.forEach((item) => {
    const text = item.restockType || "Refund impact";
    const issue = classifyIssueText(text);
    const issueCode = issue === "product_quality" ? "refund_impact" : issue;
    counts[issueCode] = (counts[issueCode] || 0) + Number(item.quantity || 1);
  });
  return counts;
}

function getMainIssueFromCounts(counts, fallback) {
  const sorted = Object.entries(counts).sort((first, second) => second[1] - first[1]);
  if (sorted[0]?.[0]) return sorted[0][0];
  return normalizeIssueCode(fallback) || "product_quality";
}

function classifyIssueText(text) {
  const normalized = normalizeText(text);
  if (/(fit|size|sizing|small|large|tight|loose|waist|chest|shoulder|length)/.test(normalized)) return "fit_sizing";
  if (/(color|colour|pictured|photo|image|shade|looks different)/.test(normalized)) return "color_expectation";
  if (/(break|broken|defect|damaged|quality|thin|poor|cheap|durability|durable)/.test(normalized)) return "quality_defect";
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
  const base = aiDetail || buildEvidenceSummary(deterministic);
  if (!contentAnalysis?.issues?.length) return base;
  const contentSentence = ` Product content analysis also found: ${contentAnalysis.issues.slice(0, 2).map((issue) => issue.label).join(", ")}.`;
  return String(base || "").includes("Product content") ? base : `${base}${contentSentence}`;
}

function hasMeaningfulTokenOverlap(first, second) {
  const firstTokens = meaningfulTokens(first);
  const secondTokens = new Set(meaningfulTokens(second));
  return firstTokens.some((token) => secondTokens.has(token));
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
  const returnAnomaly = storeAvgReturnRate > 0
    ? Math.max(0, Math.min(25, ((metrics.returnRate / storeAvgReturnRate) - 1) * 14))
    : Math.min(22, metrics.returnRate * 1.2);
  const refundAnomaly = storeAvgRefundRate > 0
    ? Math.max(0, Math.min(20, ((metrics.refundRate / storeAvgRefundRate) - 1) * 11))
    : Math.min(18, metrics.refundRate);
  const refundImpact = Math.min(15, Math.log10(metrics.refundAmount + 1) * 4);
  const reviewAnomaly = metrics.reviewCount
    ? Math.min(20, metrics.negativeReviewRate * 0.24 + Math.max(0, 4 - metrics.avgRating) * 3)
    : 0;
  const signalVolume = Math.min(12, Math.sqrt(metrics.signalCount) * 2.6);
  const sourceAgreement = hasSourceAgreement({
    returnUnits: metrics.returnUnits,
    refundUnits: metrics.refundUnits,
    negativeReviewCount: metrics.negativeReviewCount,
  }) ? 9 : 0;
  const recency = metrics.signalCount ? Math.min(9, (countRecentSignalEvents(metrics.signalEvents, 30) / metrics.signalCount) * 15) : 0;
  const variantConcentration = metrics.affectedVariants.length ? 5 : 0;
  const volumeWeight = metrics.soldUnits ? Math.min(7, Math.log10(metrics.soldUnits + 1) * 3) : 0;
  const contentRisk = Math.min(16, Number(metrics.contentQualityRisk || 0));
  const calculated = Math.round(8 + returnAnomaly + refundAnomaly + refundImpact + reviewAnomaly + signalVolume + sourceAgreement + recency + variantConcentration + volumeWeight + contentRisk);

  if (!metrics.signalCount && !metrics.contentIssueCount && Number(snapshot.riskScore || 0) > 0) return Number(snapshot.riskScore);
  return clamp(calculated, 0, 100);
}

function calculateConfidence({ signalCount, sourceCoverage, judgeMeMatchConfidence, orderAccessDenied, sourceAgreement, recentSignals }) {
  const sample = Math.min(26, Math.log2(signalCount + 1) * 8);
  const coverage = Math.min(28, sourceCoverage.length * 7);
  const match = Math.round((judgeMeMatchConfidence || 0) * 16);
  const agreement = sourceAgreement ? 18 : 5;
  const recency = recentSignals ? 10 : 0;
  const penalty = orderAccessDenied ? 16 : 0;
  return clamp(Math.round(18 + sample + coverage + match + agreement + recency - penalty), 0, 99);
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
    const text = [item.reason, item.reasonNote, item.customerNote].filter(Boolean).join(" - ");
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
    snippets.push({
      source: "shopify_refund",
      text: `${item.quantity} unit refund${item.restockType ? `, restock ${item.restockType}` : ""}`,
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
  const pieces = [];
  if (metrics.returnUnits > 0) pieces.push(`${metrics.returnUnits} return units (${metrics.returnRate}% return rate)`);
  if (metrics.refundUnits > 0 || metrics.refundAmount > 0) pieces.push(`${metrics.refundUnits} refunds worth ${formatMoney(metrics.refundAmount)}`);
  if (metrics.reviewCount > 0) pieces.push(`${metrics.negativeReviewCount} negative Judge.me reviews out of ${metrics.reviewCount}`);
  if (metrics.affectedVariants.length) pieces.push(`affected variants: ${metrics.affectedVariants.join(", ")}`);
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

function normalizeIssueCode(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("size")) return "fit_sizing";
  if (normalized.includes("color")) return "color_expectation";
  if (normalized.includes("durability")) return "durability";
  if (normalized.includes("defect") || normalized.includes("quality")) return "quality_defect";
  if (normalized.includes("compat")) return "compatibility";
  if (normalized.includes("shipping")) return "shipping_delivery";
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
    return_rate_anomaly: "Return rate anomaly",
    refund_impact: "Refund impact",
  };
  return labels[issue] || capitalize(String(issue || "Product quality").replace(/_/g, " "));
}

function getPdpActionId(issue) {
  if (issue === "fit_sizing") return "draft-fit-note";
  if (issue === "color_expectation") return "draft-color-expectation-note";
  if (issue === "compatibility") return "draft-compatibility-faq";
  if (issue === "product_content") return "rewrite-product-description";
  return "draft-pdp-copy";
}

function getPdpActionLabel(issue) {
  if (issue === "fit_sizing") return "Draft fit note for product description";
  if (issue === "color_expectation") return "Draft color expectation note";
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
  if (normalized.includes("high") || score >= 75) return "critical";
  if (normalized.includes("medium") || score >= 55) return "warning";
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
  return /(too small|too large|doesn.?t fit|broken|poor quality|defect|thin|color|not as pictured|disappointed|return)/i.test(String(text || ""));
}

function getNodes(connection) {
  if (Array.isArray(connection?.nodes)) return connection.nodes.filter(Boolean);
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
