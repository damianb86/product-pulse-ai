import prisma from "../db.server";
import { runProductDiagnosisAiAnalysis } from "./product-pulse-ai.server";
import { summarizeAiUsage } from "./product-pulse-ai-usage.server";
import { getNormalizedCsvReviewsForShop } from "./product-pulse-csv.server";
import { recordProductScoreHistory, recordReconstructedProductScoreHistory } from "./product-pulse-history.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";
import { getAnalysisLookbackDays, getProductPulseSettings } from "./product-pulse-settings.server";
import {
  buildDatedSignalTrend,
  buildIssueTrendMap,
  buildRiskTrendFromSignalTrend,
} from "./product-pulse-trends.server";
import { recordWatchlistScanActivities } from "./product-pulse-watchlist.server";
import { calculateProductScoreModel } from "./product-pulse-scoring";

const DIAGNOSIS_DEFAULT_WINDOW_DAYS = 60;
const MAX_ORDER_PAGES = 12;
const MAX_JUDGEME_REVIEW_PAGES = 3;
const MAX_JUDGEME_SYNC_PAGES = 5;
const MONTHLY_ORDER_ACTIVITY_MAX_MONTHS = 12;
const RETURN_RATE_PREDICTION_MAX_WEEKS = 52;
const RETURN_RATE_PREDICTION_FORECAST_WEEKS = 13;
const RECONSTRUCTED_RISK_HISTORY_MAX_WEEKLY_POINTS = 58;
const RECONSTRUCTED_RISK_HISTORY_MAX_MONTHLY_POINTS = 24;
const RECONSTRUCTED_RISK_HISTORY_MONTHLY_THRESHOLD_DAYS = 370;
const PRODUCT_MOMENTUM_BASELINE_DAYS = 90;
const SOURCE_EVENT_CACHE_SCHEMA_VERSION = 2;
const MAX_SOURCE_EVENT_CACHE_ITEMS = 2500;
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
const US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

export async function runDetailedProductDiagnosis({ shop, jobId, admin, snapshot }) {
  const settings = await getProductPulseSettings(shop);
  const windowDays = getAnalysisLookbackDays(settings);
  const shopifyData = await fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot, windowDays });
  const judgeMeData = await fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product, windowDays });
  const csvReviewData = await fetchCsvReviewDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product, windowDays });
  const momentumCatalogBaseline = await fetchProductMomentumCatalogBaseline({ shop, currentProductGid: snapshot.productGid });
  const deterministic = calculateDeterministicDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData, windowDays, momentumCatalogBaseline });
  const recommendationCandidates = buildRuleRecommendationCandidates(deterministic);
  const aiInput = {
    product: buildAiProductInput(shopifyData.product, snapshot),
    deterministic: buildAiDeterministicInput(deterministic),
    evidenceSnippets: deterministic.evidenceSnippets,
    recommendationCandidates,
    incremental: buildAiIncrementalDiagnosisInput(deterministic),
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
      monthlyOrderActivity: deterministic.metrics.monthlyOrderActivity?.summary || null,
      returnRatePrediction: deterministic.metrics.returnRatePrediction?.summary || null,
      productMomentum: deterministic.metrics.productMomentum ? {
        score: deterministic.metrics.productMomentum.score,
        tier: deterministic.metrics.productMomentum.tier,
        direction: deterministic.metrics.productMomentum.direction,
        confidence: deterministic.metrics.productMomentum.confidence,
      } : null,
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
      incrementalDiagnosis: {
        mode: deterministic.metrics.incrementalDiagnosis?.mode || "full",
        previousCompletedAt: deterministic.metrics.incrementalDiagnosis?.previousCompletedAt || null,
        productContent: deterministic.metrics.incrementalDiagnosis?.productContent || null,
        customerText: deterministic.metrics.incrementalDiagnosis?.customerText || null,
        refunds: deterministic.metrics.incrementalDiagnosis?.refunds || null,
        sourceChanges: deterministic.metrics.incrementalDiagnosis?.sourceChanges || null,
        aiEvidenceSnippetCount: deterministic.metrics.incrementalDiagnosis?.aiEvidenceSnippetCount || deterministic.evidenceSnippets.length,
      },
    },
  });

  const reuseDecision = getNoChangeDiagnosisReuseDecision({ snapshot, deterministic });
  if (reuseDecision.shouldReuse) {
    const reusedDiagnosis = await buildNoChangeDiagnosisReuseResult({
      shop,
      jobId,
      snapshot,
      deterministic,
      reuseDecision,
    });
    if (reusedDiagnosis) return reusedDiagnosis;
  }

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
  const diagnosis = await persistDetailedDiagnosis({ shop, jobId, snapshot, payload: diagnosisPayload });

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
      aiUsage: ai.aiUsage,
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
    aiUsage: ai.aiUsage,
  };
}

async function fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const incrementalSource = getIncrementalSourceFetchContext({ snapshot, windowDays });
  const fetchStartedAt = new Date().toISOString();
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
  let salesFetchComplete = true;
  let refundFetchComplete = true;
  let returnFetchComplete = true;

  try {
    sales = await fetchShopifySalesEvents({ admin, product, snapshot, windowDays, sinceDate: incrementalSource.shopifyCanReuse ? incrementalSource.sinceDate : null });
  } catch (error) {
    salesFetchComplete = false;
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
    refunds = await fetchShopifyRefundEvents({ shop, jobId, admin, product, snapshot, windowDays, sinceDate: incrementalSource.shopifyCanReuse ? incrementalSource.sinceDate : null });
  } catch (error) {
    refundFetchComplete = false;
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
    returns = await fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot, windowDays, sinceDate: incrementalSource.shopifyCanReuse ? incrementalSource.sinceDate : null });
  } catch (error) {
    returnFetchComplete = false;
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

  const mergedSourceEvents = incrementalSource.shopifyCanReuse
    ? mergeIncrementalSourceEvents({
      previous: incrementalSource.previousSourceEvents,
      current: { sales, refunds, returns },
      windowDays,
    })
    : { sales, refunds, returns };
  const rawFetchedCounts = {
    salesEvents: sales.length,
    refundEvents: refunds.length,
    returnEvents: returns.length,
  };
  sales = mergedSourceEvents.sales;
  refunds = mergedSourceEvents.refunds;
  returns = mergedSourceEvents.returns;

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
      windowDays,
      orderAccessDenied,
      incrementalSource: {
        mode: incrementalSource.shopifyCanReuse ? "incremental_fetch" : "full_window_fetch",
        sinceDate: incrementalSource.shopifyCanReuse ? incrementalSource.sinceDate : getSinceDate(windowDays),
        previousCompletedAt: incrementalSource.previousCompletedAt,
        previousWindowDays: incrementalSource.previousWindowDays,
        fetchedThroughAt: fetchStartedAt,
        rawFetchedCounts,
        mergedCounts: {
          salesEvents: sales.length,
          refundEvents: refunds.length,
          returnEvents: returns.length,
        },
        fetchComplete: salesFetchComplete && refundFetchComplete && returnFetchComplete,
      },
    },
  });

  return {
    product,
    sales,
    refunds,
    returns,
    orderAccessDenied,
    incrementalSource: {
      ...incrementalSource,
      mode: incrementalSource.shopifyCanReuse ? "incremental_fetch" : "full_window_fetch",
      fetchedThroughAt: fetchStartedAt,
      rawFetchedCounts,
      mergedCounts: {
        salesEvents: sales.length,
        refundEvents: refunds.length,
        returnEvents: returns.length,
      },
      fetchComplete: salesFetchComplete && refundFetchComplete && returnFetchComplete,
    },
  };
}

async function fetchProductMomentumCatalogBaseline({ shop, currentProductGid }) {
  if (!shop) return null;
  const snapshots = await prisma.productRiskSnapshot.findMany({
    where: { shop },
    select: { productGid: true, metrics: true },
    orderBy: [{ updatedAt: "desc" }],
    take: 1000,
  });

  return buildProductMomentumCatalogBaseline(snapshots, currentProductGid);
}

export function buildProductMomentumCatalogBaseline(snapshots = [], currentProductGid = "") {
  const rows = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => {
      const metrics = snapshot?.metrics || {};
      const momentum = metrics.productMomentum || {};
      const inputs = momentum.inputs || {};
      return {
        productGid: snapshot?.productGid || "",
        unitsLast30: Number(inputs.unitsLast30Days ?? metrics.soldUnits ?? 0),
        unitsPrevious90: Number(inputs.unitsPrevious90Days ?? 0),
        revenueLast30: Number(inputs.revenueLast30Days ?? metrics.salesAmount ?? 0),
        revenuePrevious90: Number(inputs.revenuePrevious90Days ?? 0),
      };
    })
    .filter((row) => Number.isFinite(row.unitsLast30) || Number.isFinite(row.revenueLast30));

  const comparableRows = rows.filter((row) => row.productGid !== currentProductGid);
  const distributionRows = comparableRows.length >= 3 ? comparableRows : rows;
  const unitsLast30Distribution = distributionRows.map((row) => Math.max(0, Number(row.unitsLast30 || 0)));
  const revenueLast30Distribution = distributionRows.map((row) => Math.max(0, Number(row.revenueLast30 || 0)));
  const storeUnitsLast30 = rows.reduce((total, row) => total + Math.max(0, Number(row.unitsLast30 || 0)), 0);
  const storeUnitsPrevious90 = rows.reduce((total, row) => total + Math.max(0, Number(row.unitsPrevious90 || 0)), 0);
  const storeRevenueLast30 = rows.reduce((total, row) => total + Math.max(0, Number(row.revenueLast30 || 0)), 0);
  const storeRevenuePrevious90 = rows.reduce((total, row) => total + Math.max(0, Number(row.revenuePrevious90 || 0)), 0);

  return {
    productCount: rows.length,
    comparableProductCount: distributionRows.length,
    unitsLast30Distribution,
    revenueLast30Distribution,
    medianUnitsLast30: median(unitsLast30Distribution),
    medianRevenueLast30: median(revenueLast30Distribution),
    storeUnitsLast30,
    storeUnitsPrevious90,
    storeRevenueLast30,
    storeRevenuePrevious90,
    hasCatalogBaseline: distributionRows.length >= 3,
  };
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
            createdAt
            updatedAt
            description
            descriptionHtml
            vendor
            productType
            status
            seo {
              title
              description
            }
            templateSuffix
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
          createdAt
          updatedAt
          description
          descriptionHtml
          vendor
          productType
          status
          seo {
            title
            description
          }
          templateSuffix
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

async function fetchShopifySalesEvents({ admin, product, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null }) {
  if (!admin?.graphql) return [];
  const events = [];
  let cursor = null;
  let includeGeography = true;
  const querySinceDate = normalizeShopifySinceDate(sinceDate, windowDays);

  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    let data = null;
    try {
      data = await shopifyGraphql(
        admin,
        buildDiagnosisSalesQuery({ includeGeography }),
        {
          after: cursor,
          query: `created_at:>=${querySinceDate}`,
          ordersFirst: DIAGNOSIS_ORDERS_PAGE_SIZE,
          lineItemsFirst: DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE,
        },
      );
    } catch (error) {
      if (includeGeography && isShopifyOrderGeographyAccessError(error)) {
        includeGeography = false;
        cursor = null;
        events.length = 0;
        page = -1;
        continue;
      }
      throw error;
    }

    (data?.orders?.nodes || []).forEach((order) => {
      const geography = getOrderAddressGeography(order);
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
          geography,
          country: geography?.country || "",
          countryCode: geography?.countryCode || "",
          province: geography?.province || "",
          provinceCode: geography?.provinceCode || "",
          city: geography?.city || "",
        });
      });
    });

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return events;
}

function buildDiagnosisSalesQuery({ includeGeography = true } = {}) {
  return `#graphql
      query ProductPulseDiagnosisSales($after: String, $query: String!, $ordersFirst: Int!, $lineItemsFirst: Int!) {
        orders(first: $ordersFirst, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            ${includeGeography ? `
            shippingAddress {
              country
              countryCodeV2
              province
              provinceCode
              city
            }
            billingAddress {
              country
              countryCodeV2
              province
              provinceCode
              city
            }
            ` : ""}
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
      }`;
}

function getOrderAddressGeography(order = {}) {
  return normalizeOrderAddressGeography(order.shippingAddress)
    || normalizeOrderAddressGeography(order.billingAddress)
    || null;
}

function normalizeOrderAddressGeography(address = {}) {
  if (!address || typeof address !== "object") return null;
  const countryCode = normalizeGeographyCode(address.countryCodeV2 || address.countryCode || address.country_code);
  const provinceCode = normalizeGeographyCode(address.provinceCode || address.province_code || address.stateCode || address.state_code);
  const country = truncateText(address.country || address.countryName || "", 80);
  const province = truncateText(address.province || address.state || address.region || "", 80);
  const city = truncateText(address.city || "", 80);
  if (!countryCode && !country && !provinceCode && !province && !city) return null;
  return {
    country,
    countryCode,
    province,
    provinceCode,
    city,
  };
}

function normalizeGeographyCode(value = "") {
  return String(value || "").trim().toUpperCase();
}

async function fetchShopifyRefundEvents({ shop, jobId, admin, product, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null }) {
  for (const [index, queryPlan] of DIAGNOSIS_REFUND_QUERY_PLANS.entries()) {
    try {
      return await fetchShopifyRefundEventsWithPlan({ shop, jobId, admin, product, snapshot, queryPlan, windowDays, sinceDate });
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

async function fetchShopifyRefundEventsWithPlan({ shop, jobId, admin, product, snapshot, queryPlan, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null }) {
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
  const orderQueries = buildRefundOrderQueries(windowDays, sinceDate);

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
      windowDays,
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

function buildRefundOrderQueries(windowDays, sinceDate = null) {
  const since = normalizeShopifySinceDate(sinceDate, windowDays);
  return [
    { mode: "updated_at", query: `updated_at:>=${since}` },
    { mode: "partially_refunded", query: `financial_status:partially_refunded updated_at:>=${since}` },
    { mode: "refunded", query: `financial_status:refunded updated_at:>=${since}` },
  ];
}

async function fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null }) {
  try {
    return await fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition: true, windowDays, sinceDate });
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
    return fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition: false, windowDays, sinceDate });
  }
}

async function fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null }) {
  for (const [index, queryPlan] of DIAGNOSIS_RETURN_QUERY_PLANS.entries()) {
    try {
      return await fetchShopifyReturnEventsWithPlan({ shop, jobId, admin, product, snapshot, includeReasonDefinition, queryPlan, windowDays, sinceDate });
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

async function fetchShopifyReturnEventsWithPlan({ shop, jobId, admin, product, snapshot, includeReasonDefinition, queryPlan, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null }) {
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
  const orderQueries = buildReturnOrderQueries(windowDays, sinceDate);

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
      windowDays,
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

function buildReturnOrderQueries(windowDays, sinceDate = null) {
  const since = normalizeShopifySinceDate(sinceDate, windowDays);
  return [
    { mode: "updated_at", query: `updated_at:>=${since}` },
    { mode: "return_requested", query: `return_status:return_requested updated_at:>=${since}` },
    { mode: "in_progress", query: `return_status:in_progress updated_at:>=${since}` },
    { mode: "inspection_complete", query: `return_status:inspection_complete updated_at:>=${since}` },
    { mode: "returned", query: `return_status:returned updated_at:>=${since}` },
  ];
}

async function fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
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

  const normalizedReviews = filterReviewsByLookbackWindow(
    reviews.map((review) => normalizeJudgeMeReview(review, snapshot, shopifyProduct)).filter(Boolean),
    windowDays,
  );
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
      ignoredOutsideWindow: Math.max(0, reviews.length - normalizedReviews.length),
      windowDays,
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

async function fetchCsvReviewDiagnosisData({ shop, jobId, snapshot, shopifyProduct, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
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
  const allMatchedReviews = matched
    .map((item) => normalizeCsvDiagnosisReview(item.row, snapshot, shopifyProduct, item.confidence))
    .filter(Boolean);
  const reviews = filterReviewsByLookbackWindow(allMatchedReviews, windowDays);
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
      ignoredOutsideWindow: Math.max(0, allMatchedReviews.length - reviews.length),
      windowDays,
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

function calculateDeterministicDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData = { connected: false, reviews: [], matchConfidence: 0 }, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, momentumCatalogBaseline = null }) {
  const snapshotMetrics = snapshot.metrics || {};
  const previousIncrementalCache = snapshotMetrics.incrementalDiagnosis?.cache || {};
  const previousDetailedDiagnosisAt = snapshotMetrics.lastDetailedDiagnosisAt || snapshotMetrics.latestDiagnosisAt || null;
  const product = shopifyData.product;
  const sales = shopifyData.sales || [];
  const refunds = shopifyData.refunds || [];
  const returns = shopifyData.returns || [];
  const judgeMeReviews = (judgeMeData.reviews || []).map((review) => normalizeReviewSource(review, "judgeme_review", "Judge.me reviews"));
  const csvReviews = (csvReviewData.reviews || []).map((review) => normalizeReviewSource(review, "csv_review", "CSV reviews"));
  const reviews = [...judgeMeReviews, ...csvReviews];
  const rawSoldUnits = preferFreshNumber(sumBy(sales, "quantity"), snapshotMetrics.soldUnits);
  const salesAmount = roundCurrency(preferFreshNumber(sumBy(sales, "amount"), snapshotMetrics.salesAmount));
  const returnUnits = preferFreshNumber(sumBy(returns, "quantity"), snapshotMetrics.returnUnits);
  const refundUnits = preferFreshNumber(sumBy(refunds, "quantity"), snapshotMetrics.refundUnits);
  const refundAmount = roundCurrency(preferFreshNumber(sumBy(refunds, "amount"), snapshotMetrics.refundAmount));
  const monthlyOrderActivity = buildMonthlyOrderActivity({ sales, returns, refunds, windowDays });
  const orderGeography = buildOrderGeographyRows(sales);
  const monthlyOrderUnits = Number(monthlyOrderActivity?.summary?.totalOrderUnits || 0);
  const soldUnits = Math.max(rawSoldUnits, monthlyOrderUnits, returnUnits, refundUnits);
  const returnRate = calculateUnitRatePercent(returnUnits, soldUnits, snapshotMetrics.returnRate);
  const refundRate = calculateUnitRatePercent(refundUnits, soldUnits, snapshotMetrics.refundRate);
  const reviewCount = reviews.length;
  const avgRating = roundRate(reviewCount ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviewCount : 0, 1);
  const negativeReviews = reviews.filter(isNegativeReviewSignal);
  const negativeReviewCount = negativeReviews.length;
  const negativeReviewRate = roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0);
  const recentNegativeReviewCount = negativeReviews.filter((review) => isRecentDate(review.createdAt, 30)).length;
  const topReturnReasons = buildTopReturnReasonDetails(returns, 4);
  const topRefundReasons = countTopValues(refunds
    .map(getRefundReasonText)
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value)), 4);
  const variantInsights = buildDiagnosisVariantInsights({ product, sales, returns, refunds, reviews });
  const affectedVariants = buildAffectedVariantDetailsFromInsights(variantInsights)
    || countTopValues([...returns, ...refunds].map((item) => item.variantTitle || item.sku).filter(Boolean), 4);
  const productContentState = resolveProductContentAnalysisState({
    product,
    previousCache: previousIncrementalCache.productContent,
    cutoffAt: previousDetailedDiagnosisAt,
  });
  const deterministicContent = productContentState.deterministicContent;
  const customerTextState = buildIncrementalCustomerTextInsights({
    returns,
    reviews,
    previousCache: previousIncrementalCache.customerText,
    cutoffAt: previousDetailedDiagnosisAt,
    windowDays,
  });
  const textInsights = customerTextState.textInsights;
  const refundTextState = buildIncrementalRefundOperationalInsights({
    refunds,
    refundRate,
    soldUnits,
    refundUnits,
    refundAmount,
    previousCache: previousIncrementalCache.refunds,
    cutoffAt: previousDetailedDiagnosisAt,
    windowDays,
  });
  const refundInsights = refundTextState.refundInsights;
  const returnRatePrediction = buildReturnRatePrediction({ sales, returns, refunds, windowDays });
  const productMomentum = buildProductMomentum({ product, sales, windowDays, catalogBaseline: momentumCatalogBaseline });
  const reviewSourceStats = buildReviewSourceStats(reviews);
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount });
  const sourceFingerprint = buildDiagnosisSourceFingerprint({
    productContentSignature: productContentState.signature,
    sales,
    returns,
    refunds,
    judgeMeReviews,
    csvReviews,
    orderAccessDenied: shopifyData.orderAccessDenied,
    sourceCoverage,
    windowDays,
  });
  const previousSourceFingerprint = previousIncrementalCache.sourceFingerprint || null;
  const sourceEventFetch = buildIncrementalSourceFetchSummary(shopifyData.incrementalSource);
  const sourceExtractionComplete = sourceEventFetch.fetchComplete !== false;
  const sourceChanges = {
    mode: previousSourceFingerprint ? "compared" : "baseline_missing",
    previousFingerprint: previousSourceFingerprint,
    currentFingerprint: sourceFingerprint,
    unchanged: Boolean(previousSourceFingerprint && previousSourceFingerprint === sourceFingerprint),
    reason: previousSourceFingerprint
      ? previousSourceFingerprint === sourceFingerprint
        ? "all_source_fingerprints_match_previous_diagnosis"
        : "source_fingerprint_changed_since_previous_diagnosis"
      : "previous_source_fingerprint_missing",
    sourceExtractionComplete,
    sourceEventFetch,
  };
  const signalEvents = buildSignalEvents({ returns, refunds, negativeReviews });
  const trendOptions = {
    startAt: getSinceDate(windowDays),
    endAt: new Date().toISOString(),
  };
  const signalTrendResult = buildDatedSignalTrend(signalEvents, trendOptions);
  const signalTrend = signalTrendResult.values;
  const issueSignalTrends = buildIssueTrendMap(signalEvents, trendOptions);
  const issueSignalCounts = buildIssueSignalCountsFromAnalysis({
    customerTextCache: customerTextState.cache,
    refundTextCache: refundTextState.cache,
    fallback: { returns, refunds, reviews: negativeReviews },
  });
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
  const scoreSentiment = getScoreSentimentInputs(textInsights, refundInsights);
  const scoreModel = calculateProductScoreModel({
    ...scoringMetrics,
    salesAmount,
    storeReturnBaseline: snapshotMetrics.storeAvgReturnRate,
    storeRefundBaseline: snapshotMetrics.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshotMetrics.storeAvgNegativeReviewRate,
    sentimentTotal: scoreSentiment.total,
    sentimentNegativeCount: scoreSentiment.negative,
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
    windowDays,
  }, { sentimentSharesReviewSource: !(returnUnits || refundUnits) });
  const riskComponents = scoreModel.riskComponents;
  const riskScore = scoreModel.riskScore;
  const confidence = scoreModel.confidenceScore;
  const estimatedImpact = scoreModel.impactFactors;
  const riskTrend = buildRiskTrendFromSignalTrend(signalTrend, riskScore, snapshotMetrics.riskTrend);
  const reconstructedRiskHistory = buildReconstructedRiskHistory({
    snapshot,
    shopifyData,
    judgeMeData,
    csvReviewData,
    product,
    sales,
    returns,
    refunds,
    reviews,
    deterministicContent,
    windowDays,
    currentRiskScore: riskScore,
    currentConfidence: confidence,
    currentImpactFactors: estimatedImpact,
    currentMainIssue: mainIssue,
  });
  const evidenceSnippetInputs = buildIncrementalEvidenceSnippetInputs({
    returns,
    refunds,
    negativeReviews,
    productContentState,
    customerTextState,
    refundTextState,
  });
  const evidenceSnippets = buildEvidenceSnippets({
    returns: evidenceSnippetInputs.returns,
    refunds: evidenceSnippetInputs.refunds,
    reviews: evidenceSnippetInputs.reviews,
    product,
  });

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
      seoTitleNeedsReview: deterministicContent.seoTitleNeedsReview,
      metaDescriptionNeedsReview: deterministicContent.metaDescriptionNeedsReview,
      handleNeedsReview: deterministicContent.handleNeedsReview,
      specsBlockRecommended: deterministicContent.specsBlockRecommended,
      classificationNeedsReview: deterministicContent.classificationNeedsReview,
      templateNeedsReview: deterministicContent.templateNeedsReview,
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
      monthlyOrderActivity,
      orderGeography,
      returnRatePrediction,
      productMomentum,
      productMomentumScore: productMomentum.score,
      productMomentumTier: productMomentum.tier,
      momentumDirection: productMomentum.direction,
      momentumConfidence: productMomentum.confidence,
      momentumConfidenceLabel: productMomentum.confidenceLabel,
      returnUnits,
      refundUnits,
      soldUnits,
      recentSignalUnits: countRecentSignalEvents(signalEvents, 30),
      windowDays,
      storeAvgReturnRate: Number(snapshotMetrics.storeAvgReturnRate || 0),
      storeAvgRefundRate: Number(snapshotMetrics.storeAvgRefundRate || 0),
      lastSignalAt: getLatestEventDate(signalEvents),
      signalTrend,
      riskTrend,
      riskHistory: reconstructedRiskHistory,
      reconstructedRiskHistory,
      trendMeta: signalTrendResult.meta,
      issueSignalTrends,
      handle: product.handle || snapshot.handle,
      productType: product.productType || snapshotMetrics.productType || "",
      vendor: product.vendor || snapshotMetrics.vendor || "",
      seoTitle: product.seoTitle || snapshotMetrics.seoTitle || "",
      seoDescription: product.seoDescription || snapshotMetrics.seoDescription || "",
      templateSuffix: product.templateSuffix || snapshotMetrics.templateSuffix || "",
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
      variantInsights,
      reviewCount,
      negativeReviewCount,
      negativeReviewRate,
      recentNegativeReviewCount,
      recentNegativeReviewWindowDays: 30,
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
      incrementalDiagnosis: {
        schemaVersion: 1,
        mode: getOverallIncrementalMode({ productContentState, customerTextState, refundTextState, previousDetailedDiagnosisAt }),
        previousCompletedAt: toIso(previousDetailedDiagnosisAt),
        cutoffAt: toIso(previousDetailedDiagnosisAt),
        productContent: {
          mode: productContentState.reused ? "reused" : "analyzed",
          reused: productContentState.reused,
          changed: productContentState.changed,
          signature: productContentState.signature,
          productUpdatedAt: productContentState.productUpdatedAt,
          reason: productContentState.reason,
          canReuseContentGaps: productContentState.reused && Boolean(productContentState.cachedContentGaps),
        },
        customerText: {
          mode: customerTextState.mode,
          analyzedItems: customerTextState.analyzedItems,
          reusedItems: customerTextState.reusedItems,
          totalItems: (customerTextState.cache.returnItems || []).length + (customerTextState.cache.reviewItems || []).length,
          reason: customerTextState.reason,
        },
        refunds: {
          mode: refundTextState.mode,
          analyzedItems: refundTextState.analyzedItems,
          reusedItems: refundTextState.reusedItems,
          totalItems: (refundTextState.cache.items || []).length,
          reason: refundTextState.reason,
        },
        sourceEvents: sourceEventFetch,
        sourceChanges,
        aiEvidenceSnippetCount: evidenceSnippets.length,
        cache: {
          sourceFingerprint,
          sourceEvents: buildSourceEventCache({ sales, refunds, returns, windowDays, sourceEventFetch }),
          productContent: {
            signature: productContentState.signature,
            productUpdatedAt: productContentState.productUpdatedAt,
            deterministicContent: productContentState.deterministicContent,
            contentGaps: productContentState.cachedContentGaps || null,
          },
          customerText: customerTextState.cache,
          refunds: refundTextState.cache,
        },
      },
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

function buildReconstructedRiskHistory({
  snapshot,
  shopifyData,
  judgeMeData,
  csvReviewData,
  product,
  sales = [],
  returns = [],
  refunds = [],
  reviews = [],
  deterministicContent,
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  currentRiskScore,
  currentConfidence,
  currentImpactFactors,
  currentMainIssue,
} = {}) {
  const now = new Date();
  const datedEvents = [...sales, ...returns, ...refunds, ...reviews]
    .map((event) => getRiskHistoryEventDate(event))
    .filter(Boolean)
    .sort((first, second) => first.getTime() - second.getTime());
  if (!datedEvents.length) {
    return [buildCurrentRiskHistoryFallbackPoint({
      snapshot,
      product,
      currentRiskScore,
      currentConfidence,
      currentImpactFactors,
      currentMainIssue,
      windowDays,
      now,
    })];
  }
  const earliest = datedEvents[0] || new Date(now.getTime() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000);
  const granularity = chooseReconstructedRiskHistoryGranularity(earliest, now);
  const periodEnds = buildReconstructedRiskHistoryPeriodEnds({ earliest, now, granularity });
  const history = periodEnds
    .map((periodEnd, index) => buildReconstructedRiskHistoryPoint({
      snapshot,
      shopifyData,
      judgeMeData,
      csvReviewData,
      product,
      sales: filterEventsUpTo(sales, periodEnd, { includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      returns: filterEventsUpTo(returns, periodEnd, { includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      refunds: filterEventsUpTo(refunds, periodEnd, { includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      reviews: filterEventsUpTo(reviews, periodEnd, { includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      deterministicContent,
      periodEnd,
      granularity,
      sequence: index + 1,
      windowDays,
      now,
    }))
    .filter(Boolean);

  const currentPoint = history[history.length - 1] || buildCurrentRiskHistoryFallbackPoint({
    snapshot,
    product,
    currentRiskScore,
    currentConfidence,
    currentImpactFactors,
    currentMainIssue,
    windowDays,
    now,
  });

  if (currentPoint) {
    currentPoint.isCurrent = true;
    currentPoint.recordedAt = toIso(now);
    currentPoint.periodEnd = toIso(now);
    currentPoint.riskScore = Math.round(Number(currentRiskScore ?? currentPoint.riskScore ?? 0));
    currentPoint.confidence = Math.round(Number(currentConfidence ?? currentPoint.confidence ?? 0));
    currentPoint.primaryIssue = getHumanIssueLabel(currentMainIssue || currentPoint.primaryIssue || "product_content");
    currentPoint.metrics = {
      ...(currentPoint.metrics || {}),
      calculationState: "current_deep_diagnosis",
      reconstructedHistory: true,
    };
    if (currentImpactFactors) {
      currentPoint.impactScore = calculateHistoryImpactScore(currentImpactFactors);
      currentPoint.metrics.marginAtRisk = currentImpactFactors.marginAtRisk || currentPoint.metrics.marginAtRisk || 0;
      currentPoint.metrics.revenueAtRisk = currentImpactFactors.revenueAtRisk || currentPoint.metrics.revenueAtRisk || 0;
      currentPoint.metrics.estimatedImpact = currentImpactFactors.estimatedImpact || currentPoint.metrics.estimatedImpact || 0;
    }
  }

  return dedupeRiskHistoryPointsByRecordedAt(history.length ? history : [currentPoint].filter(Boolean));
}

function buildReconstructedRiskHistoryPoint({
  snapshot,
  shopifyData,
  judgeMeData,
  csvReviewData,
  product,
  sales,
  returns,
  refunds,
  reviews,
  deterministicContent,
  periodEnd,
  granularity,
  sequence,
  windowDays,
  now,
}) {
  const snapshotMetrics = snapshot.metrics || {};
  const soldUnits = sumBy(sales, "quantity");
  const salesAmount = roundCurrency(sumBy(sales, "amount"));
  const returnUnits = sumBy(returns, "quantity");
  const refundUnits = sumBy(refunds, "quantity");
  const refundAmount = roundCurrency(sumBy(refunds, "amount"));
  const returnRate = calculateUnitRatePercent(returnUnits, soldUnits);
  const refundRate = calculateUnitRatePercent(refundUnits, soldUnits);
  const negativeReviews = reviews.filter(isNegativeReviewSignal);
  const reviewCount = reviews.length;
  const avgRating = roundRate(reviewCount ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviewCount : 0, 1);
  const negativeReviewCount = negativeReviews.length;
  const negativeReviewRate = roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0);
  const recentNegativeReviewCount = negativeReviews.filter((review) => isRecentDateFrom(review.createdAt, 30, periodEnd)).length;
  const variantInsights = buildDiagnosisVariantInsights({ product, sales, returns, refunds, reviews });
  const affectedVariants = buildAffectedVariantDetailsFromInsights(variantInsights)
    || countTopValues([...returns, ...refunds].map((item) => item.variantTitle || item.sku).filter(Boolean), 4);
  const textInsights = buildCustomerTextInsights({ returns, reviews });
  const refundInsights = buildRefundOperationalInsights({ refunds, refundRate, soldUnits, refundUnits, refundAmount });
  const reviewSourceStats = buildReviewSourceStats(reviews);
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount });
  const signalEvents = buildSignalEvents({ returns, refunds, negativeReviews });
  const issueSignalCounts = buildIssueSignalCounts({ returns, refunds, reviews: negativeReviews });
  applyRefundInsightsToIssueCounts(issueSignalCounts, refundInsights);
  const customerIssueSignalTotal = Object.values(issueSignalCounts).reduce((total, count) => total + count, 0);

  (deterministicContent?.issues || []).forEach((issue) => {
    issueSignalCounts[issue.issueCode] = (issueSignalCounts[issue.issueCode] || 0) + 1;
  });

  const mainIssue = getMainIssueFromCounts(issueSignalCounts, snapshot.primaryIssue);
  const customerSignalCount = Math.max(returnUnits + refundUnits + negativeReviewCount, customerIssueSignalTotal);
  const contentIssueCount = deterministicContent?.issues?.length || 0;
  const signalCount = customerSignalCount + contentIssueCount;
  const sourceAgreement = hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount, reviewSourceStats });
  const recentSignalUnits = countRecentSignalEventsFrom(signalEvents, 30, periodEnd);
  const scoreSentiment = getScoreSentimentInputs(textInsights, refundInsights);
  const scoreModel = calculateProductScoreModel({
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
    contentIssueCount,
    contentQualityRisk: deterministicContent?.riskLift || 0,
    textInsights,
    refundInsights,
    sourceCoverage,
    signalEvents,
    affectedVariants,
    variantInsights,
    reviewSourceStats,
    storeReturnBaseline: snapshotMetrics.storeAvgReturnRate,
    storeRefundBaseline: snapshotMetrics.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshotMetrics.storeAvgNegativeReviewRate,
    sentimentTotal: scoreSentiment.total,
    sentimentNegativeCount: scoreSentiment.negative,
    subjectiveNegativeCount: textInsights?.subjectiveNegativity?.count || 0,
    subjectiveNegativeRatio: textInsights?.subjectiveNegativity?.ratio || 0,
    variantCount: product?.variants?.length || Number(snapshotMetrics.variantCount || 0),
    affectedVariantCount: affectedVariants.length,
    affectedVariantSignalCount: affectedVariants.reduce((sum, variant) => sum + Number(variant.count || 0), 0),
    strongestVariantSignalCount: affectedVariants[0]?.count || 0,
    recentSignalUnits,
    signalEventCount: customerSignalCount,
    effectiveSampleSize: returnUnits + refundUnits + reviewCount + contentIssueCount,
    sourceAgreement,
    productMatchConfidence: Math.max(judgeMeData?.matchConfidence || 0, csvReviewData?.matchConfidence || 0, reviews.length ? 0 : 1),
    orderAccessDenied: shopifyData?.orderAccessDenied,
    missingOrders: shopifyData?.orderAccessDenied,
    dataQualityIncomplete: shopifyData?.orderAccessDenied,
    subjectiveOnlyIssue: mainIssue === "subjective_negative_reaction" && !returnUnits && !refundUnits && negativeReviewCount <= 2,
    scoreBreakdownReconstructed: !isCurrentRiskHistoryPoint(periodEnd, now),
    calculationState: isCurrentRiskHistoryPoint(periodEnd, now) ? "current_deep_diagnosis" : "reconstructed_from_deep_diagnosis_events",
    windowDays,
  }, { sentimentSharesReviewSource: !(returnUnits || refundUnits) });

  return {
    source: "full-diagnosis-reconstructed",
    granularity,
    sequence,
    periodEnd: toIso(periodEnd),
    recordedAt: toIso(periodEnd),
    isCurrent: isCurrentRiskHistoryPoint(periodEnd, now),
    riskScore: scoreModel.riskScore,
    confidence: scoreModel.confidenceScore,
    impactScore: calculateHistoryImpactScore(scoreModel.impactFactors),
    primaryIssue: getHumanIssueLabel(mainIssue),
    metrics: {
      reconstructedHistory: true,
      calculationState: scoreModel.riskComponents.calculationState,
      granularity,
      windowDays,
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
      recentNegativeReviewWindowDays: 30,
      signalCount,
      customerSignalCount,
      contentIssueCount,
      recentSignalUnits,
      affectedVariants: affectedVariants.map((item) => item.label),
      affectedVariantDetails: affectedVariants,
      variantInsights,
      marginAtRisk: scoreModel.impactFactors.marginAtRisk,
      revenueAtRisk: scoreModel.impactFactors.revenueAtRisk,
      estimatedImpact: scoreModel.impactFactors.estimatedImpact,
      sourceCoverage,
      sourceAgreement,
      riskComponents: scoreModel.riskComponents,
      confidenceFactors: scoreModel.confidenceFactors,
    },
  };
}

function buildCurrentRiskHistoryFallbackPoint({
  snapshot,
  product,
  currentRiskScore,
  currentConfidence,
  currentImpactFactors,
  currentMainIssue,
  windowDays,
  now,
}) {
  const snapshotMetrics = snapshot?.metrics || {};
  const riskScore = Math.round(Number(currentRiskScore ?? snapshot?.riskScore ?? 0));
  return {
    source: "full-diagnosis-reconstructed",
    granularity: "current",
    sequence: 1,
    periodEnd: toIso(now),
    recordedAt: toIso(now),
    isCurrent: true,
    riskScore,
    confidence: Math.round(Number(currentConfidence ?? snapshot?.confidence ?? 0)),
    impactScore: calculateHistoryImpactScore(currentImpactFactors || { revenueAtRisk: snapshotMetrics.revenueAtRisk }),
    primaryIssue: getHumanIssueLabel(currentMainIssue || snapshot?.primaryIssue || "product_content"),
    metrics: {
      reconstructedHistory: true,
      calculationState: "current_deep_diagnosis",
      granularity: "current",
      windowDays,
      soldUnits: Number(snapshotMetrics.soldUnits || 0),
      salesAmount: Number(snapshotMetrics.salesAmount || 0),
      returnUnits: Number(snapshotMetrics.returnUnits || 0),
      refundUnits: Number(snapshotMetrics.refundUnits || 0),
      refundAmount: Number(snapshotMetrics.refundAmount || 0),
      returnRate: Number(snapshotMetrics.returnRate || 0),
      refundRate: Number(snapshotMetrics.refundRate || 0),
      reviewCount: Number(snapshotMetrics.reviewCount || 0),
      negativeReviewCount: Number(snapshotMetrics.negativeReviewCount || 0),
      negativeReviewRate: Number(snapshotMetrics.negativeReviewRate || 0),
      marginAtRisk: Number(currentImpactFactors?.marginAtRisk || snapshotMetrics.marginAtRisk || 0),
      revenueAtRisk: Number(currentImpactFactors?.revenueAtRisk || snapshotMetrics.revenueAtRisk || 0),
      estimatedImpact: Number(currentImpactFactors?.estimatedImpact || snapshotMetrics.estimatedImpact || 0),
      productTitle: product?.title || snapshot?.productTitle || "",
    },
  };
}

function chooseReconstructedRiskHistoryGranularity(earliest, now) {
  const spanDays = Math.max(1, Math.ceil((now.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000)));
  return spanDays > RECONSTRUCTED_RISK_HISTORY_MONTHLY_THRESHOLD_DAYS ? "monthly" : "weekly";
}

function buildReconstructedRiskHistoryPeriodEnds({ earliest, now, granularity }) {
  const starts = granularity === "monthly"
    ? getMonthStartsBetween(startOfUtcMonth(earliest), startOfUtcMonth(now)).slice(-RECONSTRUCTED_RISK_HISTORY_MAX_MONTHLY_POINTS)
    : getWeekStartsBetween(startOfUtcWeek(earliest), startOfUtcWeek(now)).slice(-RECONSTRUCTED_RISK_HISTORY_MAX_WEEKLY_POINTS);
  const periodEnds = starts.map((start) => {
    const nextStart = granularity === "monthly" ? addUtcMonths(start, 1) : addUtcDays(start, 7);
    return new Date(Math.min(nextStart.getTime() - 1, now.getTime()));
  });
  const last = periodEnds[periodEnds.length - 1];
  if (!last || Math.abs(last.getTime() - now.getTime()) > 1000) {
    periodEnds.push(now);
  }
  return periodEnds;
}

function filterEventsUpTo(events = [], periodEnd, { includeUndated = false } = {}) {
  const endTime = periodEnd.getTime();
  return events.filter((event) => {
    const date = getRiskHistoryEventDate(event);
    if (!date) return includeUndated;
    return date.getTime() <= endTime;
  });
}

function getRiskHistoryEventDate(event = {}) {
  return parseValidDate(event.createdAt || event.processedAt || event.updatedAt || event.reviewDate || event.date);
}

function isCurrentRiskHistoryPoint(periodEnd, now) {
  return Math.abs(periodEnd.getTime() - now.getTime()) <= 1000;
}

function countRecentSignalEventsFrom(events, days, now) {
  return events
    .filter((event) => isRecentDateFrom(event.createdAt, days, now))
    .reduce((total, event) => total + Number(event.value || 1), 0);
}

function isRecentDateFrom(value, days, now) {
  const date = parseValidDate(value);
  const currentDate = parseValidDate(now);
  if (!date || !currentDate) return false;
  return currentDate.getTime() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function calculateHistoryImpactScore(impactFactors = {}) {
  return Math.min(100, Math.round(Number(impactFactors.revenueAtRisk || impactFactors.estimatedImpact || 0) / 100));
}

function dedupeRiskHistoryPointsByRecordedAt(history = []) {
  const byTimestamp = new Map();
  history.filter(Boolean).forEach((point) => {
    const key = point.recordedAt || point.periodEnd;
    if (!key) return;
    byTimestamp.set(key, point);
  });
  return [...byTimestamp.values()].sort((first, second) => new Date(first.recordedAt).getTime() - new Date(second.recordedAt).getTime());
}

function buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, csvReviewData, deterministic, ai }) {
  const contentAnalysis = buildContentAnalysis(deterministic, ai.contentGaps);
  const semanticDeterministic = applyAiSemanticClassificationToDeterministic(deterministic, ai);
  const emergentSentiments = normalizeAiEmergentSentiments(ai);
  const knownEmotions = normalizeAiKnownEmotions(ai, semanticDeterministic.metrics.textInsights);
  const adjustedRiskComponents = adjustRiskComponentsForContentAnalysis(semanticDeterministic.metrics.riskComponents, contentAnalysis);
  const adjustedRiskScore = adjustedRiskComponents.riskScore;
  const adjustedRiskHistory = adjustReconstructedRiskHistoryForContentAnalysis(
    semanticDeterministic.metrics.reconstructedRiskHistory || semanticDeterministic.metrics.riskHistory,
    contentAnalysis,
    adjustedRiskScore,
  );
  const scoredDeterministic = {
    ...semanticDeterministic,
    riskScore: adjustedRiskScore,
    metrics: {
      ...semanticDeterministic.metrics,
      textInsights: {
        ...(semanticDeterministic.metrics.textInsights || {}),
        emotions: knownEmotions.length ? knownEmotions : semanticDeterministic.metrics.textInsights?.emotions || [],
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
      signalCount: semanticDeterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      issueCount: semanticDeterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      riskComponents: adjustedRiskComponents,
      riskTrend: buildRiskTrendFromSignalTrend(semanticDeterministic.metrics.signalTrend, adjustedRiskScore, semanticDeterministic.metrics.riskTrend),
      riskHistory: adjustedRiskHistory,
      reconstructedRiskHistory: adjustedRiskHistory,
    },
  };
  contentAnalysis.issues.forEach((issue) => {
    scoredDeterministic.issueSignalCounts[issue.issueCode] = Math.max(scoredDeterministic.issueSignalCounts[issue.issueCode] || 0, 1);
  });

  const sourceIntegritySignals = getSourceMismatchSignals(scoredDeterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(scoredDeterministic, sourceIntegritySignals);
  const aiMainIssue = normalizeIssueCode(ai.classification?.main_issue) || scoredDeterministic.mainIssue;
  const contentShouldLead = contentAnalysis.issues.some((issue) => issue.severity === "high") && scoredDeterministic.metrics.customerSignalCount <= 1;
  const monitoringContentOnly = isLowRiskMonitoringOnlyDiagnosis(scoredDeterministic) && contentAnalysis.issues.length > 0;
  const mainIssue = sourceIntegrityMode
    ? "review_feed_integrity"
    : monitoringContentOnly
    ? "product_content"
    : contentShouldLead
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
  const aiEvidenceSynthesisSections = normalizeAiEvidenceSynthesisSections(ai.report?.evidence_synthesis_sections);
  const mainFinding = {
    title: ai.report?.main_finding_title || `${issueLabel} signals need review`,
    detail: buildMainFindingDetail(ai.report?.main_finding_detail, scoredDeterministic, contentAnalysis),
    summary: ai.report?.evidence_summary || buildEvidenceSummary(scoredDeterministic),
  };
  const adjustedMainFinding = adjustMainFindingForSignalStrength(mainFinding, scoredDeterministic);
  const recommendations = buildFinalRecommendations({ snapshot, deterministic: scoredDeterministic, ai, mainIssue });
  const issues = buildFinalIssues({ deterministic: scoredDeterministic, ai, mainIssue, recommendations });
  const evidence = buildFinalEvidence({ deterministic: scoredDeterministic, ai, aiEvidenceSynthesisSections, judgeMeData, csvReviewData, shopifyData });
  const incrementalDiagnosis = buildPersistedIncrementalDiagnosisState({
    runtimeState: scoredDeterministic.metrics.incrementalDiagnosis,
    aiContentGaps: ai.contentGaps,
  });
  const metrics = {
    ...scoredDeterministic.metrics,
    incrementalDiagnosis,
    aiUsage: ai.aiUsage,
    diagnosisReport: {
      mainFinding: adjustedMainFinding,
      evidenceSummary: adjustedMainFinding.summary,
      evidenceSynthesisSections: aiEvidenceSynthesisSections,
      issueNames: Array.isArray(ai.report?.issue_names) ? ai.report.issue_names.slice(0, 8) : [],
      aiModels: ai.modelsUsed,
      aiUsage: ai.aiUsage,
      knownEmotions,
      emergentSentiments,
      checkedSources: buildCheckedSources(semanticDeterministic),
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

async function persistDetailedDiagnosis({ shop, jobId, snapshot, payload }) {
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
    recordReconstructedProductScoreHistory({
      shop,
      snapshot: updatedSnapshot,
      history: payload.metrics.reconstructedRiskHistory || payload.metrics.riskHistory,
      source: "full-diagnosis-reconstructed",
      diagnosisId: diagnosis.id,
    }),
    recordProductScoreHistory({ shop, snapshot: updatedSnapshot, source: "full-diagnosis", diagnosisId: diagnosis.id }),
    recordWatchlistScanActivities(shop, [updatedSnapshot], { source: "full-diagnosis", jobId }),
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

async function buildNoChangeDiagnosisReuseResult({ shop, jobId, snapshot, deterministic, reuseDecision }) {
  const reusableDiagnosis = await findReusableCompletedDiagnosis({ shop, snapshot });
  if (!reusableDiagnosis) return null;

  await persistNoChangeDiagnosisCache({ shop, snapshot, deterministic, reuseDecision });

  const estimatedImpact = Number(snapshot.metrics?.estimatedImpact ?? snapshot.metrics?.impactRange?.mid ?? 0);
  const modelsUsed = {
    classification: buildCachedAiModelSummary("signal_classification"),
    emergentSentiment: buildCachedAiModelSummary("emergent_sentiment"),
    contentGap: {
      task: "content_gap",
      model: "previous-product-content-analysis",
      provider: "cache",
    },
    actionRationale: buildCachedAiModelSummary("action_rationale"),
    finalReport: buildCachedAiModelSummary("final_report"),
  };
  const aiUsage = summarizeAiUsage([], {
    productGid: snapshot.productGid,
    productHandle: snapshot.handle || null,
    diagnosisMode: "no_change_reuse",
    creditsConsumed: 0,
  });

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.no_changes_reused",
    message: "No product, order, return, refund, review, or source changes were detected. ProductPulse reused the previous deep diagnosis without AI calls or credit consumption.",
    data: {
      productGid: snapshot.productGid,
      previousDiagnosisId: reusableDiagnosis.id,
      previousCompletedAt: toIso(reusableDiagnosis.completedAt),
      creditsConsumed: 0,
      aiUsage,
      reuseDecision,
      incrementalDiagnosis: {
        mode: deterministic.metrics.incrementalDiagnosis?.mode || "incremental",
        productContent: deterministic.metrics.incrementalDiagnosis?.productContent || null,
        customerText: deterministic.metrics.incrementalDiagnosis?.customerText || null,
        refunds: deterministic.metrics.incrementalDiagnosis?.refunds || null,
        sourceEvents: deterministic.metrics.incrementalDiagnosis?.sourceEvents || null,
        sourceChanges: deterministic.metrics.incrementalDiagnosis?.sourceChanges || null,
      },
    },
  });

  await recordWatchlistScanActivities(shop, [snapshot], { source: "full-diagnosis", noChangesReused: true, jobId });

  return {
    status: "skipped",
    skipped: true,
    skipReason: "no_changes_since_previous_diagnosis",
    message: "No product, order, return, refund, review, or source changes were detected. The previous deep diagnosis was reused and no diagnostic credit was consumed.",
    diagnosisId: reusableDiagnosis.id,
    riskScore: snapshot.riskScore,
    confidence: snapshot.confidence,
    estimatedImpact,
    provider: "cache",
    model: "previous-detailed-diagnosis",
    modelsUsed,
    aiUsage,
    creditsConsumed: 0,
  };
}

async function findReusableCompletedDiagnosis({ shop, snapshot }) {
  const latestDiagnosisId = snapshot.metrics?.latestDiagnosisId;
  if (latestDiagnosisId) {
    const byId = await prisma.productDiagnosis.findFirst({
      where: {
        id: latestDiagnosisId,
        shop,
        productGid: snapshot.productGid,
        status: "Completed",
      },
    });
    if (byId) return byId;
  }

  return prisma.productDiagnosis.findFirst({
    where: {
      shop,
      productGid: snapshot.productGid,
      status: "Completed",
    },
    orderBy: [
      { completedAt: "desc" },
      { createdAt: "desc" },
    ],
  });
}

async function persistNoChangeDiagnosisCache({ shop, snapshot, deterministic, reuseDecision }) {
  const currentMetrics = deterministic.metrics || {};
  const previousMetrics = snapshot.metrics || {};
  const previousIncremental = previousMetrics.incrementalDiagnosis || {};
  const currentIncremental = currentMetrics.incrementalDiagnosis || {};
  const mergedIncremental = {
    ...previousIncremental,
    ...currentIncremental,
    cache: {
      ...(previousIncremental.cache || {}),
      ...(currentIncremental.cache || {}),
    },
    noChangeReuse: {
      checkedAt: new Date().toISOString(),
      reason: reuseDecision.reason,
      matchedBy: reuseDecision.matchedBy,
    },
  };

  await prisma.productRiskSnapshot.update({
    where: { shop_productGid: { shop, productGid: snapshot.productGid } },
    data: {
      metrics: {
        ...previousMetrics,
        incrementalDiagnosis: mergedIncremental,
        lastNoChangeDiagnosisAt: new Date().toISOString(),
      },
    },
  });
}

function buildCachedAiModelSummary(task) {
  return {
    task,
    model: "previous-detailed-diagnosis",
    provider: "cache",
    usage: {
      provider: "cache",
      model: "previous-detailed-diagnosis",
      task,
      requestContext: "cache",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      usageSource: "cache",
    },
  };
}

function getNoChangeDiagnosisReuseDecision({ snapshot = {}, deterministic = {} } = {}) {
  const previousMetrics = snapshot.metrics || {};
  const metrics = deterministic.metrics || {};
  const incremental = metrics.incrementalDiagnosis || {};
  const hasPreviousCompletedDiagnosis = Boolean(
    previousMetrics.latestDiagnosisId
      || previousMetrics.lastDetailedDiagnosisAt
      || previousMetrics.latestDiagnosisAt,
  );
  const productContentReused = incremental.productContent?.reused === true;
  const customerTextUnchanged = isIncrementalAnalysisUnchanged(incremental.customerText);
  const refundsUnchanged = isIncrementalAnalysisUnchanged(incremental.refunds);
  const aiEvidenceSnippetCount = Number(incremental.aiEvidenceSnippetCount ?? deterministic.evidenceSnippets?.length ?? 0);
  const noNewAiEvidence = aiEvidenceSnippetCount === 0;
  const sourceChanges = incremental.sourceChanges || {};
  const sourceExtractionComplete = sourceChanges.sourceExtractionComplete !== false;
  const sourceFingerprintCompared = Boolean(sourceChanges.previousFingerprint && sourceChanges.currentFingerprint);
  const sourceFingerprintUnchanged = sourceChanges.unchanged === true;
  const materialComparison = compareMaterialDiagnosisMetrics(previousMetrics, {
    ...metrics,
    riskScore: deterministic.riskScore,
    confidence: deterministic.confidence,
    estimatedImpact: deterministic.estimatedImpact?.estimatedImpact ?? metrics.estimatedImpact,
    revenueAtRisk: deterministic.estimatedImpact?.revenueAtRisk ?? metrics.revenueAtRisk,
    marginAtRisk: deterministic.estimatedImpact?.marginAtRisk ?? metrics.marginAtRisk,
  });
  const materialUnchanged = !sourceFingerprintCompared && materialComparison.unchanged;
  const matchedBy = sourceFingerprintUnchanged ? "source_fingerprint" : materialUnchanged ? "material_metrics" : null;
  const blockers = [
    !hasPreviousCompletedDiagnosis ? "missing_previous_completed_diagnosis" : null,
    !productContentReused ? "product_content_changed_or_not_cached" : null,
    !customerTextUnchanged ? "customer_text_changed_or_not_incremental" : null,
    !refundsUnchanged ? "refunds_changed_or_not_incremental" : null,
    !sourceExtractionComplete ? "source_extraction_incomplete" : null,
    !noNewAiEvidence ? "new_ai_evidence_snippets_detected" : null,
    !matchedBy ? "source_or_material_metrics_changed" : null,
  ].filter(Boolean);
  const shouldReuse = blockers.length === 0;

  return {
    shouldReuse,
    reason: shouldReuse ? "no_changes_since_previous_diagnosis" : "changes_or_missing_cache_detected",
    matchedBy,
    blockers,
    hasPreviousCompletedDiagnosis,
    productContentReused,
    customerTextUnchanged,
    refundsUnchanged,
    sourceExtractionComplete,
    noNewAiEvidence,
    sourceFingerprintCompared,
    sourceFingerprintUnchanged,
    sourceChanges,
    materialComparison,
  };
}

function isIncrementalAnalysisUnchanged(state = {}) {
  return state?.mode === "incremental" && Number(state.analyzedItems || 0) === 0;
}

function compareMaterialDiagnosisMetrics(previousMetrics = {}, currentMetrics = {}) {
  const numericKeys = [
    "soldUnits",
    "salesAmount",
    "returnUnits",
    "returnRate",
    "refundUnits",
    "refundRate",
    "refundAmount",
    "reviewCount",
    "avgRating",
    "negativeReviewCount",
    "negativeReviewRate",
    "recentNegativeReviewCount",
    "customerSignalCount",
    "contentIssueCount",
    "descriptionWordCount",
    "contentQualityScore",
    "contentQualityRisk",
    "mediaCount",
    "mediaWithoutAltCount",
    "signalCount",
    "riskScore",
    "confidence",
    "estimatedImpact",
    "revenueAtRisk",
    "marginAtRisk",
    "productMomentumScore",
  ];
  const changed = [];
  let compared = 0;

  numericKeys.forEach((key) => {
    const previousValue = Number(previousMetrics[key]);
    const currentValue = Number(currentMetrics[key]);
    if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) return;
    compared += 1;
    const tolerance = key.toLowerCase().includes("rate") || key.toLowerCase().includes("rating") ? 0.05 : 0.5;
    if (Math.abs(previousValue - currentValue) > tolerance) {
      changed.push({ key, previousValue, currentValue });
    }
  });

  [
    "topReturnReasonDetails",
    "topRefundReasonDetails",
    "affectedVariantDetails",
    "orderGeography",
    "sourceCoverage",
    "reviewSourceStats",
  ].forEach((key) => {
    if (previousMetrics[key] === undefined || currentMetrics[key] === undefined) return;
    compared += 1;
    if (stableSignature(previousMetrics[key]) !== stableSignature(currentMetrics[key])) {
      changed.push({ key });
    }
  });

  return {
    unchanged: compared >= 8 && changed.length === 0,
    compared,
    changed: changed.slice(0, 12),
  };
}

function buildAiProductInput(product, snapshot) {
  return {
    id: product.id || snapshot.productGid,
    numericId: product.numericId || extractNumericShopifyId(snapshot.productGid),
    handle: product.handle || snapshot.handle,
    title: product.title || snapshot.productTitle,
    description: product.description || "",
    seoTitle: product.seoTitle || "",
    seoDescription: product.seoDescription || "",
    templateSuffix: product.templateSuffix || "",
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
      seoTitleNeedsReview: deterministic.metrics.seoTitleNeedsReview,
      metaDescriptionNeedsReview: deterministic.metrics.metaDescriptionNeedsReview,
      handleNeedsReview: deterministic.metrics.handleNeedsReview,
      specsBlockRecommended: deterministic.metrics.specsBlockRecommended,
      classificationNeedsReview: deterministic.metrics.classificationNeedsReview,
      templateNeedsReview: deterministic.metrics.templateNeedsReview,
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
      variantInsights: deterministic.metrics.variantInsights,
      orderGeography: deterministic.metrics.orderGeography,
      windowDays: deterministic.metrics.windowDays,
      orderAccessDenied: deterministic.metrics.orderAccessDenied,
      incrementalDiagnosis: sanitizeIncrementalDiagnosisForAi(deterministic.metrics.incrementalDiagnosis),
    },
  };
}

function buildAiIncrementalDiagnosisInput(deterministic = {}) {
  const incremental = deterministic.metrics?.incrementalDiagnosis || null;
  if (!incremental) return null;
  return {
    ...sanitizeIncrementalDiagnosisForAi(incremental),
    productContent: {
      ...(incremental.productContent || {}),
      cachedContentGaps: incremental.productContent?.canReuseContentGaps
        ? incremental.cache?.productContent?.contentGaps || null
        : null,
    },
  };
}

function sanitizeIncrementalDiagnosisForAi(incremental = null) {
  if (!incremental) return null;
  return {
    schemaVersion: incremental.schemaVersion || 1,
    mode: incremental.mode || "full",
    previousCompletedAt: incremental.previousCompletedAt || null,
    cutoffAt: incremental.cutoffAt || null,
    productContent: incremental.productContent || null,
    customerText: incremental.customerText || null,
    refunds: incremental.refunds || null,
    sourceEvents: incremental.sourceEvents || null,
    aiEvidenceSnippetCount: incremental.aiEvidenceSnippetCount || 0,
    note: incremental.mode === "incremental"
      ? "Evidence snippets contain only newly changed evidence since the previous deep diagnosis. Aggregated deterministic metrics include reused prior analysis plus new analysis."
      : "This diagnosis analyzed the available product data for the configured window.",
  };
}

function buildPersistedIncrementalDiagnosisState({ runtimeState = {}, aiContentGaps = null } = {}) {
  const cache = runtimeState.cache || {};
  const productContentCache = cache.productContent || {};
  return {
    ...runtimeState,
    cache: {
      ...cache,
      productContent: {
        ...productContentCache,
        contentGaps: aiContentGaps || productContentCache.contentGaps || null,
      },
    },
  };
}

function applyAiSemanticClassificationToDeterministic(deterministic = {}, ai = {}) {
  const semantic = buildAiSemanticClassificationSummary(ai);
  if (!semantic.hasSignals) return deterministic;

  const fallbackTextInsights = deterministic.metrics?.textInsights || {};
  const aiAggregateReady = shouldUseAiAggregateTextInsights(deterministic, semantic);
  const nextTextInsights = mergeAiSemanticTextInsights(fallbackTextInsights, semantic, { replaceAggregate: aiAggregateReady });
  const nextIssueSignalCounts = mergeAiIssueSignalCounts(deterministic.issueSignalCounts || {}, semantic.issueSignalCounts);
  const customerSemanticSignalCount = Object.values(semantic.customerIssueSignalCounts).reduce((total, count) => total + Number(count || 0), 0);
  const customerSignalCount = Math.max(
    Number(deterministic.metrics?.customerSignalCount || 0),
    customerSemanticSignalCount,
  );
  const signalCount = Math.max(
    Number(deterministic.metrics?.signalCount || 0),
    customerSignalCount + Number(deterministic.metrics?.contentIssueCount || 0),
  );
  const mainIssue = getMainIssueFromCounts(nextIssueSignalCounts, ai.classification?.main_issue || deterministic.mainIssue);

  return {
    ...deterministic,
    mainIssue,
    mainIssueLabel: getHumanIssueLabel(mainIssue),
    issueSignalCounts: nextIssueSignalCounts,
    metrics: {
      ...(deterministic.metrics || {}),
      textInsights: nextTextInsights,
      semanticClassification: {
        source: "ai_signal_classification",
        aggregateMode: aiAggregateReady ? "ai_primary" : "ai_delta_overlay",
        classifiedSignalCount: semantic.classifiedSignals.length,
        customerClassifiedSignalCount: semantic.customerSignals.length,
        issueSignalCounts: semantic.issueSignalCounts,
        customerIssueSignalCounts: semantic.customerIssueSignalCounts,
        dominantIssue: mainIssue,
      },
      customerSignalCount,
      signalCount,
      issueCount: signalCount,
    },
  };
}

function shouldUseAiAggregateTextInsights(deterministic = {}, semantic = {}) {
  const mode = deterministic.metrics?.incrementalDiagnosis?.mode || "full";
  const fallbackTotal = Number(deterministic.metrics?.textInsights?.sentiment?.total || 0);
  if (!fallbackTotal) return semantic.customerSignals.length > 0;
  if (mode === "full") return semantic.customerSignals.length >= Math.max(1, Math.ceil(fallbackTotal * 0.7));
  return semantic.customerSignals.length >= Math.max(4, Math.ceil(fallbackTotal * 0.85));
}

function buildAiSemanticClassificationSummary(ai = {}) {
  const classifiedSignals = normalizeAiClassifiedSignals(ai.classification?.classified_signals);
  const customerSignals = classifiedSignals.filter((signal) => !isOperationalRefundSignalSource(signal.source));
  const issueSignalCounts = countAiSignalsByIssue(classifiedSignals);
  const customerIssueSignalCounts = countAiSignalsByIssue(customerSignals);
  const sentiment = summarizeAiClassifiedSignalSentiment(customerSignals);
  const returns = summarizeAiClassifiedSignalSource(customerSignals, "returns");
  const reviews = summarizeAiClassifiedSignalSource(customerSignals, "reviews");
  const repeatedLanguage = getFilteredAiRepeatedLanguage(ai)
    .map(normalizeAiRepeatedLanguageItem)
    .filter(Boolean);
  const subjectiveSignals = customerSignals.filter((signal) => signal.issueCode === "subjective_negative_reaction" && signal.sentiment === "negative");
  const otherReturnClassifications = summarizeAiOtherReturnClassifications(customerSignals);

  return {
    hasSignals: Boolean(classifiedSignals.length || repeatedLanguage.length || Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length),
    classifiedSignals,
    customerSignals,
    issueSignalCounts,
    customerIssueSignalCounts,
    sentiment,
    returns,
    reviews,
    repeatedLanguage,
    subjectiveNegativity: {
      count: subjectiveSignals.length,
      total: customerSignals.length,
      ratio: customerSignals.length ? roundRate(subjectiveSignals.length / customerSignals.length, 2) : 0,
      sourceCounts: countBy(subjectiveSignals.map((signal) => signal.sourceGroup)),
      examples: subjectiveSignals.slice(0, 4).map((signal) => truncateText(signal.text, 180)),
    },
    otherReturnClassifications,
    summary: ai.classification?.sentiment_summary || {},
  };
}

function normalizeAiClassifiedSignals(signals = []) {
  return (Array.isArray(signals) ? signals : [])
    .map((signal) => {
      const issueCode = normalizeAiSignalIssueCode(signal.issue_category || signal.issue || signal.issue_detail);
      const source = String(signal.source || "").trim().toLowerCase();
      const sourceGroup = getAiSignalSourceGroup(source);
      const text = String(signal.text || signal.evidence || "").replace(/\s+/g, " ").trim();
      const sentiment = normalizeSentimentForPositiveRecovery(normalizeAiSentiment(signal.sentiment), text);
      const rawEmotion = normalizeEmotionCode(signal.known_emotion) || "none";
      return {
        source,
        sourceGroup,
        text,
        issueCode,
        issueDetail: signal.issue_detail || "",
        sentiment,
        emotion: normalizeAiEmotionForSentiment(rawEmotion, sentiment, text),
        severity: normalizeSeverity(signal.severity || "medium"),
        productRelated: signal.product_related !== false,
      };
    })
    .filter((signal) => signal.productRelated && signal.issueCode && signal.text);
}

function normalizeAiEmotionForSentiment(emotionCode = "none", sentiment = "neutral", text = "") {
  const code = normalizeEmotionCode(emotionCode) || "none";
  if (code === "none") return code;
  const polarity = getEmotionPolarity(code);
  if (sentiment === "positive" && polarity === "negative") {
    const recoveredEmotion = classifyCustomerEmotion(text, 5);
    return recoveredEmotion && getEmotionPolarity(recoveredEmotion) === "positive" ? recoveredEmotion : "satisfaction";
  }
  if (sentiment === "negative" && polarity === "positive") return "frustration";
  return code;
}

function normalizeAiSignalIssueCode(value) {
  const issueCode = normalizeIssueCode(value);
  if (!issueCode || issueCode === "other") return "product_quality";
  return issueCode;
}

function normalizeAiSentiment(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "positive" || normalized === "negative" || normalized === "neutral") return normalized;
  return "neutral";
}

function getAiSignalSourceGroup(source = "") {
  const value = String(source || "").toLowerCase();
  if (value.includes("refund")) return "refunds";
  if (value.includes("return")) return "returns";
  if (value.includes("review") || value.includes("judgeme") || value.includes("csv")) return "reviews";
  return "customer_language";
}

function isOperationalRefundSignalSource(source = "") {
  return String(source || "").toLowerCase().includes("refund");
}

function countAiSignalsByIssue(signals = []) {
  return signals.reduce((counts, signal) => {
    if (String(signal.sentiment || "").toLowerCase() === "positive") return counts;
    const issue = normalizeIssueCode(signal.issueCode);
    if (!issue) return counts;
    counts[issue] = (counts[issue] || 0) + 1;
    return counts;
  }, {});
}

function summarizeAiClassifiedSignalSentiment(signals = []) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  signals.forEach((signal) => {
    counts[normalizeAiSentiment(signal.sentiment)] += 1;
  });
  const total = signals.length;
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

function summarizeAiClassifiedSignalSource(signals = [], sourceGroup) {
  const scoped = signals.filter((signal) => signal.sourceGroup === sourceGroup);
  return {
    total: scoped.length,
    sentiment: summarizeAiClassifiedSignalSentiment(scoped),
    emotions: summarizeAiSignalEmotions(scoped),
    subjectiveNegativity: {
      count: scoped.filter((signal) => signal.issueCode === "subjective_negative_reaction" && signal.sentiment === "negative").length,
      total: scoped.length,
      ratio: scoped.length ? roundRate(scoped.filter((signal) => signal.issueCode === "subjective_negative_reaction" && signal.sentiment === "negative").length / scoped.length, 2) : 0,
      sourceCounts: countBy(scoped.map((signal) => signal.sourceGroup)),
      examples: scoped
        .filter((signal) => signal.issueCode === "subjective_negative_reaction")
        .slice(0, 4)
        .map((signal) => truncateText(signal.text, 180)),
    },
    repeatedLanguage: [],
    examples: scoped
      .filter((signal) => signal.sentiment === "negative")
      .slice(0, 4)
      .map((signal) => ({
        text: truncateText(signal.text, 180),
        sentiment: signal.sentiment,
        emotion: signal.emotion,
        issueCode: signal.issueCode,
        source: signal.source,
        sourceLabel: sourceGroup === "returns" ? "Returns" : "Reviews",
      })),
  };
}

function summarizeAiSignalEmotions(signals = []) {
  const grouped = new Map();
  signals.forEach((signal) => {
    const code = normalizeEmotionCode(signal.emotion);
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
    if (signal.sourceGroup) current.sources.add(signal.sourceGroup);
    if (signal.text && current.examples.length < 3) current.examples.push(truncateText(signal.text, 140));
    grouped.set(code, current);
  });
  return Array.from(grouped.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => ({ ...item, sources: Array.from(item.sources) }));
}

function normalizeAiRepeatedLanguageItem(item = {}) {
  const term = String(item.term || item.label || item.phrase || "").replace(/\s+/g, " ").trim();
  if (!term) return null;
  const sourceTypes = normalizeSourceTypes(item.source_types || item.sources);
  const sentiment = normalizeAiSentiment(item.sentiment || item.dominantSentiment);
  return {
    term,
    count: Math.max(1, Number(item.count || 1)),
    sources: sourceTypes.length ? sourceTypes : ["ai_signal_classification"],
    sourceTypes,
    issueCode: normalizeIssueCode(item.issue_category || item.issueCode || "repeated_language") || "repeated_language",
    dominantSentiment: sentiment,
    sentiment,
    sentiments: {
      positive: sentiment === "positive" ? Math.max(1, Number(item.count || 1)) : 0,
      neutral: sentiment === "neutral" ? Math.max(1, Number(item.count || 1)) : 0,
      negative: sentiment === "negative" ? Math.max(1, Number(item.count || 1)) : 0,
    },
    emotion: normalizeEmotionCode(item.known_emotion) || "none",
    explanation: item.explanation || "",
    example: item.explanation || term,
    source: "ai_signal_classification",
  };
}

function summarizeAiOtherReturnClassifications(signals = []) {
  const grouped = new Map();
  signals
    .filter((signal) => signal.sourceGroup === "returns" && signal.issueCode && signal.issueCode !== "product_quality")
    .forEach((signal) => {
      const key = signal.issueCode;
      const current = grouped.get(key) || {
        issueCode: key,
        label: getHumanIssueLabel(key),
        count: 0,
        sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
        examples: [],
      };
      current.count += 1;
      current.sentimentCounts[signal.sentiment] = (current.sentimentCounts[signal.sentiment] || 0) + 1;
      if (current.examples.length < 3) current.examples.push(truncateText(signal.text, 160));
      grouped.set(key, current);
    });
  return Array.from(grouped.values()).sort((first, second) => second.count - first.count).slice(0, 5);
}

function mergeAiSemanticTextInsights(fallback = {}, semantic = {}, { replaceAggregate = false } = {}) {
  const repeatedLanguage = mergeSemanticRepeatedLanguage(semantic.repeatedLanguage, fallback.repeatedLanguage);
  const textInsights = {
    ...fallback,
    repeatedLanguage,
    aiRepeatedLanguage: semantic.repeatedLanguage,
    aiSemanticSummary: semantic.summary,
  };

  if (replaceAggregate) {
    return {
      ...textInsights,
      sentiment: semantic.sentiment,
      returns: {
        ...(fallback.returns || {}),
        ...semantic.returns,
        repeatedLanguage: mergeSemanticRepeatedLanguage(
          semantic.repeatedLanguage.filter((item) => item.sources.some((source) => String(source).includes("return"))),
          fallback.returns?.repeatedLanguage,
        ),
      },
      reviews: {
        ...(fallback.reviews || {}),
        ...semantic.reviews,
        repeatedLanguage: mergeSemanticRepeatedLanguage(
          semantic.repeatedLanguage.filter((item) => item.sources.some((source) => String(source).includes("review") || String(source).includes("csv") || String(source).includes("judgeme"))),
          fallback.reviews?.repeatedLanguage,
        ),
      },
      subjectiveNegativity: semantic.subjectiveNegativity,
      otherReturnClassifications: semantic.otherReturnClassifications.length ? semantic.otherReturnClassifications : fallback.otherReturnClassifications || [],
    };
  }

  return {
    ...textInsights,
    subjectiveNegativity: {
      ...(fallback.subjectiveNegativity || {}),
      count: Math.max(Number(fallback.subjectiveNegativity?.count || 0), Number(semantic.subjectiveNegativity?.count || 0)),
      total: Math.max(Number(fallback.subjectiveNegativity?.total || 0), Number(semantic.subjectiveNegativity?.total || 0)),
      ratio: Math.max(Number(fallback.subjectiveNegativity?.ratio || 0), Number(semantic.subjectiveNegativity?.ratio || 0)),
      sourceCounts: {
        ...(fallback.subjectiveNegativity?.sourceCounts || {}),
        ...(semantic.subjectiveNegativity?.sourceCounts || {}),
      },
      examples: uniqueBy([
        ...(semantic.subjectiveNegativity?.examples || []),
        ...(fallback.subjectiveNegativity?.examples || []),
      ], normalizeText).slice(0, 4),
    },
    otherReturnClassifications: uniqueBy([
      ...(semantic.otherReturnClassifications || []),
      ...(fallback.otherReturnClassifications || []),
    ], (item) => item.issueCode || item.label).slice(0, 5),
  };
}

function mergeSemanticRepeatedLanguage(primary = [], fallback = []) {
  return uniqueBy([
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(fallback) ? fallback : []),
  ].filter(isActionableRepeatedLanguageIssue), (item) => normalizeText(item.term || item.label || item.phrase))
    .sort((first, second) => Number(second.count || 0) - Number(first.count || 0))
    .slice(0, 10);
}

function mergeAiIssueSignalCounts(fallback = {}, aiCounts = {}) {
  const next = { ...(fallback || {}) };
  Object.entries(aiCounts || {}).forEach(([issueCode, count]) => {
    const normalized = normalizeIssueCode(issueCode);
    if (!normalized) return;
    next[normalized] = Math.max(Number(next[normalized] || 0), Number(count || 0));
  });
  return next;
}

function countBy(values = []) {
  return (Array.isArray(values) ? values : []).reduce((counts, value) => {
    const key = String(value || "").trim();
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildRuleRecommendationCandidates(deterministic) {
  const issue = deterministic.mainIssue;
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, issue);
  const faqNeed = deterministic.metrics?.faqNeed || {};
  const recipeSignals = getRecommendationRecipeSignals(deterministic);
  const contentIssues = getActionableContentIssues(deterministic.metrics || {});
  const lowRiskMonitoringOnly = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const canSurfaceCustomerFacingCandidate = !lowRiskMonitoringOnly
    || hasMaterialCustomerProblemEvidence(deterministic)
    || hasCriticalContentIssue(contentIssues);
  const candidates = [];
  if (issue === "fit_sizing" && hasActionableMainIssue) {
    candidates.push({ id: "draft-fit-note", type: "PDP copy", reason: "Fit or size language appears in returns/reviews." });
  }
  if (faqNeed.shouldRecommend && canSurfaceCustomerFacingCandidate) {
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
  if (deterministic.metrics.contentIssueCount > 0 && canSurfaceCustomerFacingCandidate) {
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
  if (recipeSignals.seoTitle.shouldRecommend) candidates.push({ id: "rewrite-seo-title", type: "SEO title", reason: recipeSignals.seoTitle.reason });
  if (recipeSignals.metaDescription.shouldRecommend) candidates.push({ id: "rewrite-meta-description", type: "SEO meta description", reason: recipeSignals.metaDescription.reason });
  if (recipeSignals.handle.shouldRecommend) candidates.push({ id: "improve-url-handle", type: "URL handle", reason: recipeSignals.handle.reason });
  if (recipeSignals.specs.shouldRecommend) candidates.push({ id: "add-specs-details-block", type: "PDP copy", reason: recipeSignals.specs.reason });
  if (recipeSignals.variants.shouldRecommend) candidates.push({ id: "correct-variant-options", type: "Variant options", reason: recipeSignals.variants.reason });
  if (recipeSignals.pricing.shouldRecommend) candidates.push({ id: "review-product-pricing", type: "Commercial review", reason: recipeSignals.pricing.reason });
  if (recipeSignals.status.shouldRecommend) candidates.push({ id: "set-product-draft", type: "High-risk action", reason: recipeSignals.status.reason });
  if (recipeSignals.inventory.shouldRecommend) candidates.push({ id: "limit-variant-inventory", type: "Inventory hold", reason: recipeSignals.inventory.reason });
  if (recipeSignals.collection.shouldRecommend) candidates.push({ id: "move-to-review-collection", type: "Collection workflow", reason: recipeSignals.collection.reason });
  if (recipeSignals.media.shouldRecommend) candidates.push({ id: "improve-product-media", type: "Media guidance", reason: recipeSignals.media.reason });
  if (recipeSignals.mediaOrder.shouldRecommend) candidates.push({ id: "reorder-product-media", type: "Media order", reason: recipeSignals.mediaOrder.reason });
  if (recipeSignals.contextualMedia.shouldRecommend) candidates.push({ id: "add-contextual-media-recommendation", type: "Media guidance", reason: recipeSignals.contextualMedia.reason });
  if (recipeSignals.classification.shouldRecommend) candidates.push({ id: "update-product-classification", type: "Product classification", reason: recipeSignals.classification.reason });
  if (recipeSignals.structuredMetafields.shouldRecommend) candidates.push({ id: "add-structured-metafields", type: "Product metafield", reason: recipeSignals.structuredMetafields.reason });
  if (recipeSignals.template.shouldRecommend) candidates.push({ id: "switch-product-template", type: "Product template", reason: recipeSignals.template.reason });
  if (recipeSignals.sourceMismatch.shouldRecommend) candidates.push({ id: "fix-source-review-mismatch", type: "Source integrity", reason: recipeSignals.sourceMismatch.reason });
  if (recipeSignals.missingSource.shouldRecommend) candidates.push({ id: "connect-missing-source", type: "Source connection", reason: recipeSignals.missingSource.reason });
  if (recipeSignals.monitoringCoverage.shouldRecommend) candidates.push({ id: "improve-monitoring-coverage", type: "Monitoring coverage", reason: recipeSignals.monitoringCoverage.reason });
  if (recipeSignals.baselineScan.shouldRecommend) candidates.push({ id: "create-baseline-scan", type: "Baseline scan", reason: recipeSignals.baselineScan.reason });
  if (recipeSignals.watchlist.shouldRecommend) candidates.push({ id: "add-to-watchlist", type: "Watchlist", reason: recipeSignals.watchlist.reason });
  if (recipeSignals.fullDiagnosis.shouldRecommend) candidates.push({ id: "run-full-diagnosis", type: "Diagnosis", reason: recipeSignals.fullDiagnosis.reason });
  if (recipeSignals.qa.shouldRecommend) candidates.push({ id: "recommend-qa-review", type: "Operational QA", reason: recipeSignals.qa.reason });
  if (!lowRiskMonitoringOnly && (hasActionableMainIssue || deterministic.metrics.contentIssueCount > 0)) candidates.push({ id: "copy-support-note", type: "Internal note", reason: "Support can use a concise product-specific note." });
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
  const repeatedFaqLanguage = repeatedLanguage
    .filter((item) => isFaqRelevantText(item.term) && Number(item.count || 0) >= 2);
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

  if (guidanceIssues.length >= 2 || (guidanceIssues.length && customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE)) {
    add({
      topic: "Product information",
      reason: `${guidanceIssues.length} product-content gap${guidanceIssues.length === 1 ? "" : "s"} can be answered as FAQ guidance.`,
      weight: Math.min(3, guidanceIssues.length),
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

  if (repeatedFaqLanguage.length >= 2 || (repeatedFaqLanguage.length && customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE)) {
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

  const topicCount = topics.size;
  const sourceCount = sources.size;
  const hasCustomerEvidence = customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || confusionSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || issueSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || repeatedFaqLanguage.reduce((total, item) => total + Number(item.count || 0), 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE;
  const hasMultiAspectQuestion = topicCount >= 2
    || sourceCount >= 2
    || guidanceIssues.length >= 2
    || repeatedFaqLanguage.length >= 2
    || returnReasonQuestions.length >= 2;
  const hasBroadReviewContext = Number(reviewCount || 0) >= 4 && Number(negativeReviewCount || 0) >= 2;
  const hasEvidenceThreshold = hasCustomerEvidence && (hasMultiAspectQuestion || hasBroadReviewContext);
  const shouldRecommend = score >= 4 && hasEvidenceThreshold;

  return {
    shouldRecommend,
    score,
    signals,
    topics: Array.from(topics).slice(0, 5),
    reasons: reasons.slice(0, 5),
    sourceTypes: Array.from(sources),
    evidenceThreshold: hasEvidenceThreshold ? "met" : "not_met",
    topicCount,
    sourceCount,
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
  const actionRationales = getAiActionRationaleMap(ai);
  const recommendations = [];
  const issueLabel = getHumanIssueLabel(mainIssue);
  const topReasons = deterministic.metrics.topReturnReasons || [];
  const affectedVariants = deterministic.metrics.affectedVariants || [];
  const recipeSignals = getRecommendationRecipeSignals(deterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, recipeSignals.sourceMismatch?.signals);
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
  const canRecommendCustomerFacingCopy = !sourceIntegrityMode;
  const lowRiskMonitoringOnly = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const materialCustomerProblemEvidence = hasMaterialCustomerProblemEvidence(deterministic);
  const criticalContentIssue = hasCriticalContentIssue(contentIssues);
  const canRecommendCustomerFacingFix = canRecommendCustomerFacingCopy
    && (!lowRiskMonitoringOnly || materialCustomerProblemEvidence || criticalContentIssue);
  const primaryPdpDescriptionAction = Boolean(canRecommendCustomerFacingFix && hasActionableMainIssue && mainIssue !== "product_content" && shouldRecommendSubjectiveAction && pdpCopy);
  const shopperGuidanceForDescription = primaryPdpDescriptionAction ? pdpCopy : "";
  const descriptionDraftForRewrite = shouldRewriteDescription ? buildEnhancedDescriptionDraft({
    title: snapshot.productTitle,
    currentDescription: currentDescriptionText,
    suggestedDescription: copy.product_description || "",
    shopperGuidance: shopperGuidanceForDescription,
    contentAnalysis,
  }) : "";
  const appendedDescriptionGuidance = getAppendedDescriptionText(currentDescriptionText, descriptionDraftForRewrite);
  const rewriteDescriptionOperation = shouldRewriteDescription && appendedDescriptionGuidance ? "append" : "replace";
  const rewriteDescriptionLabel = rewriteDescriptionOperation === "append" ? "Add text to end of description" : "Rewrite product description";
  const faqNeed = deterministic.metrics.faqNeed || {};
  const faqItems = buildRecommendedFaqItems({
    copy,
    snapshot,
    mainIssue,
    pdpCopy,
    faqNeed,
  });

  if (primaryPdpDescriptionAction) {
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
        causeKey: getRecommendationCauseKey({ issue: mainIssue, text: pdpCopy, deterministic }),
        relatedActionIds: shouldRewriteDescription ? ["rewrite-product-description"] : shouldCorrectDescription ? ["correct-product-description"] : [],
        relatedActionLabels: shouldRewriteDescription ? [rewriteDescriptionLabel] : shouldCorrectDescription ? ["Correct product description"] : [],
      },
    });
  }

  if (contentIssues.length > 0 && canRecommendCustomerFacingFix) {
    if (shouldRewriteDescription) {
      const descriptionDraft = buildEnhancedDescriptionDraft({
        title: snapshot.productTitle,
        currentDescription: currentDescriptionText,
        suggestedDescription: copy.product_description || "",
        shopperGuidance: primaryPdpDescriptionAction ? pdpCopy : "",
        contentAnalysis,
      });

      recommendations.push({
        id: "rewrite-product-description",
        label: rewriteDescriptionOperation === "append" ? "Add text to end of description" : "Rewrite product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: rewriteDescriptionOperation === "append" ? (getAppendedDescriptionText(currentDescriptionText, descriptionDraft) || appendedDescriptionGuidance || descriptionDraft) : descriptionDraft,
          issue: "product_content",
          currentDescriptionText,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          changeStrategy: rewriteDescriptionOperation === "append" ? "add-guidance" : currentDescriptionText ? "preserve-and-expand" : "write-from-scratch",
          operation: rewriteDescriptionOperation,
          placement: rewriteDescriptionOperation === "append" ? "append" : undefined,
          causeKey: getRecommendationCauseKey({ issue: "product_content", text: descriptionDraft, deterministic }),
          relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
          relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
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
          causeKey: getRecommendationCauseKey({ issue: "product_content", text: correctedDescriptionDraft, deterministic }),
          relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
          relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
        },
      });
    } else {
      const descriptionGuidanceDraft = buildDescriptionGuidanceAddendum({
        title: snapshot.productTitle,
        contentIssues,
        suggestedDescription: copy.product_description || "",
        shopperGuidance: primaryPdpDescriptionAction ? "" : pdpCopy,
      });
      const duplicatesPrimaryPdpAction = primaryPdpDescriptionAction && hasSubstantialOverlap(descriptionGuidanceDraft, pdpCopy);
      if (descriptionGuidanceDraft && !duplicatesPrimaryPdpAction) {
        recommendations.push({
          id: "add-product-description-guidance",
          label: "Add product description guidance",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: descriptionGuidanceDraft,
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
            causeKey: getRecommendationCauseKey({ issue: "product_content", text: descriptionGuidanceDraft, deterministic }),
            relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
            relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
          },
        });
      }
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

  if (canRecommendCustomerFacingFix && faqNeed.shouldRecommend && faqItems.length) {
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
          key: "faq_html",
          type: "multi_line_text_field",
        },
      },
    });
  }

  if (recipeSignals.title.shouldRecommend) {
    recommendations.push({
      id: "update-product-title",
      label: "Improve product title",
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

  if (recipeSignals.seoTitle.shouldRecommend) {
    recommendations.push({
      id: "rewrite-seo-title",
      label: "Rewrite SEO title",
      type: "SEO title",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "seo.title",
        draftText: buildSuggestedSeoTitle({ product: deterministic.product, snapshot, mainIssue, aiTitle: copy.seo_title || copy.product_title }),
        currentValue: deterministic.product?.seoTitle || "",
        issue: "seo_content",
        trigger: recipeSignals.seoTitle.reason,
      },
    });
  }

  if (recipeSignals.metaDescription.shouldRecommend) {
    recommendations.push({
      id: "rewrite-meta-description",
      label: "Rewrite meta description",
      type: "SEO meta description",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "seo.description",
        draftText: buildSuggestedMetaDescription({ product: deterministic.product, snapshot, mainIssue, aiDescription: copy.meta_description || "" }),
        currentValue: deterministic.product?.seoDescription || "",
        issue: "seo_content",
        trigger: recipeSignals.metaDescription.reason,
      },
    });
  }

  if (recipeSignals.handle.shouldRecommend) {
    recommendations.push({
      id: "improve-url-handle",
      label: "Improve URL handle",
      type: "URL handle",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "handle",
        draftHandle: buildSuggestedProductHandle({ product: deterministic.product, snapshot }),
        currentValue: deterministic.product?.handle || snapshot.handle,
        redirectNewHandle: true,
        issue: "seo_content",
        trigger: recipeSignals.handle.reason,
      },
    });
  }

  if (recipeSignals.specs.shouldRecommend) {
    const specsBlock = buildSpecsDetailsBlock({
      product: deterministic.product,
      contentIssues,
      mainIssue,
      deterministic,
      aiSpecsBlock: copy.specs_details_block || copy.specs_block || "",
    });
    recommendations.push({
      id: "add-specs-details-block",
      label: "Add specs/details block",
      type: "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: specsBlock,
        issue: "product_content",
        currentDescriptionText,
        contentIssues: contentIssues.map((issue) => ({
          label: issue.label,
          evidence: issue.evidence,
          severity: issue.severity,
          code: issue.code,
        })),
        operation: "append",
        placement: "append",
        changeStrategy: "add-specs-block",
        causeKey: getRecommendationCauseKey({ issue: "specs_block", text: specsBlock, deterministic }),
        trigger: recipeSignals.specs.reason,
      },
    });
  }

  if (recipeSignals.media.shouldRecommend) {
    const mediaUpdates = buildMediaAltTextUpdates({
      deterministic,
      snapshot,
      mediaGuidance: copy.media_guidance,
      suggestedTitle: copy.product_title,
    });
    const mediaGuidance = copy.media_guidance || buildMediaGuidance(deterministic);
    recommendations.push({
      id: "improve-product-media",
      label: mediaUpdates.length ? "Add / update image alt text" : "Improve product media",
      type: mediaUpdates.length ? "Media alt text" : "Media guidance",
      effort: mediaUpdates.length ? "Low" : "Medium",
      status: mediaUpdates.length ? "Draft" : "Ready",
      payload: {
        draftText: mediaUpdates[0]?.suggestedAltText || "",
        mediaGuidance,
        mediaUpdates,
        imageBrief: buildRecommendedImageBrief(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        mediaWithoutAltCount: deterministic.metrics.mediaWithoutAltCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.media.reason,
        causeKey: getRecommendationCauseKey({ issue: "media", text: recipeSignals.media.reason, deterministic }),
      },
    });
  }

  if (recipeSignals.mediaOrder.shouldRecommend) {
    recommendations.push({
      id: "reorder-product-media",
      label: "Reorder product media",
      type: "Media order",
      effort: "Medium",
      status: "Manual approval required",
      payload: {
        mediaGuidance: buildMediaGuidance(deterministic),
        imageBrief: buildRecommendedImageBrief(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.mediaOrder.reason,
      },
    });
  }

  if (recipeSignals.contextualMedia.shouldRecommend) {
    recommendations.push({
      id: "add-contextual-media-recommendation",
      label: "Add contextual media recommendation",
      type: "Media guidance",
      effort: "Medium",
      status: "Ready",
      payload: {
        mediaGuidance: buildMediaGuidance(deterministic),
        imageBrief: buildRecommendedImageBrief(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.contextualMedia.reason,
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

  if (!lowRiskMonitoringOnly && deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
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

  if (recipeSignals.sourceMismatch.shouldRecommend) {
    recommendations.push({
      id: "fix-source-review-mismatch",
      label: "Fix source/review mismatch",
      type: "Source integrity",
      effort: "Medium",
      status: "Manual verification required",
      payload: {
        mismatchSignals: recipeSignals.sourceMismatch.signals || [],
        reviewSections,
        issue: "source_integrity",
        trigger: recipeSignals.sourceMismatch.reason,
      },
    });
  }

  if (recipeSignals.variants.shouldRecommend) {
    const variantUpdates = buildVariantOptionUpdateSuggestions({
      product: deterministic.product,
      affectedVariants,
      variantDetails: deterministic.metrics.affectedVariantDetails || [],
    });
    recommendations.push({
      id: "correct-variant-options",
      label: "Fix variant names/options",
      type: "Variant options",
      effort: "Medium",
      status: "Ready",
      payload: {
        affectedVariants,
        variantCount: deterministic.metrics.variantCount || 0,
        variantDetails: deterministic.metrics.affectedVariantDetails || [],
        optionNames: deterministic.metrics.optionNames || [],
        variantUpdates,
        issue: mainIssue,
        trigger: recipeSignals.variants.reason,
      },
    });
  }

  if (recipeSignals.pricing.shouldRecommend) {
    recommendations.push({
      id: "review-product-pricing",
      label: "Adjust price / compare-at price",
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

  if (recipeSignals.classification.shouldRecommend) {
    const classificationDraft = buildProductClassificationDraft({ product: deterministic.product, mainIssue });
    recommendations.push({
      id: "update-product-classification",
      label: "Update product classification",
      type: "Product classification",
      effort: "Medium",
      status: classificationDraft.draftVendor || classificationDraft.draftProductType ? "Draft" : "Manual approval required",
      payload: {
        field: "classification",
        currentVendor: deterministic.product?.vendor || "",
        currentProductType: deterministic.product?.productType || "",
        ...classificationDraft,
        issue: "product_content",
        trigger: recipeSignals.classification.reason,
      },
    });
  }

  if (recipeSignals.structuredMetafields.shouldRecommend) {
    recommendations.push({
      id: "add-structured-metafields",
      label: "Add structured metafields",
      type: "Product metafield",
      effort: "Medium",
      status: "Draft",
      payload: {
        metafields: buildStructuredMetafieldRecommendations({ deterministic, mainIssue }),
        issue: mainIssue,
        trigger: recipeSignals.structuredMetafields.reason,
      },
    });
  }

  if (recipeSignals.template.shouldRecommend) {
    recommendations.push({
      id: "switch-product-template",
      label: "Switch product template",
      type: "Product template",
      effort: "Medium",
      status: "Manual approval required",
      payload: {
        field: "templateSuffix",
        templateSuffix: "productpulse-guidance",
        currentTemplateSuffix: deterministic.product?.templateSuffix || "default",
        issue: mainIssue,
        trigger: recipeSignals.template.reason,
      },
    });
  }

  if (recipeSignals.collection.shouldRecommend) {
    recommendations.push({
      id: "move-to-review-collection",
      label: "Add to review collection",
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

  if (supportNote && !lowRiskMonitoringOnly && (hasActionableMainIssue || contentIssues.length > 0)) {
    recommendations.push({
      id: "copy-support-note",
      label: "Create internal note",
      type: "Internal note",
      effort: "Low",
      status: "Ready",
      payload: { note: supportNote },
    });
  }

  const tags = getRecommendedRiskTags({ mainIssue, deterministic });
  if (tags.length && deterministic.metrics.signalCount >= 2 && !lowRiskMonitoringOnly) {
    recommendations.push({
      id: "apply-risk-tags",
      label: "Add internal risk tags",
      type: "Product tag",
      effort: "Low",
      status: "Ready",
      payload: { tags, productGid: snapshot.productGid, issue: mainIssue },
    });
  }

  const workflowTags = getRecommendedWorkflowTags({ mainIssue, deterministic });
  if (workflowTags.length && deterministic.metrics.signalCount >= 2 && !lowRiskMonitoringOnly) {
    recommendations.push({
      id: "add-workflow-tags",
      label: "Add workflow tags",
      type: "Product tag",
      effort: "Low",
      status: "Ready",
      payload: { tags: workflowTags, productGid: snapshot.productGid, issue: mainIssue },
    });
  }

  if (recipeSignals.missingSource.shouldRecommend) {
    recommendations.push({
      id: "connect-missing-source",
      label: "Connect missing source",
      type: "Source connection",
      effort: "Medium",
      status: "Manual setup required",
      payload: {
        missingSources: recipeSignals.missingSource.sources || [],
        issue: "coverage",
        trigger: recipeSignals.missingSource.reason,
      },
    });
  }

  if (recipeSignals.monitoringCoverage.shouldRecommend) {
    recommendations.push({
      id: "improve-monitoring-coverage",
      label: "Improve monitoring coverage",
      type: "Monitoring coverage",
      effort: "Medium",
      status: "Manual setup required",
      payload: {
        missingSources: recipeSignals.missingSource.sources || [],
        productMomentumScore: deterministic.metrics.productMomentumScore,
        issue: "coverage",
        trigger: recipeSignals.monitoringCoverage.reason,
      },
    });
  }

  if (recipeSignals.baselineScan.shouldRecommend) {
    recommendations.push({
      id: "create-baseline-scan",
      label: "Create baseline scan",
      type: "Baseline scan",
      effort: "Low",
      status: "Ready",
      payload: {
        productMomentumScore: deterministic.metrics.productMomentumScore,
        issue: "baseline",
        trigger: recipeSignals.baselineScan.reason,
      },
    });
  }

  if (recipeSignals.watchlist.shouldRecommend) {
    recommendations.push({
      id: "add-to-watchlist",
      label: "Add to Watchlist",
      type: "Watchlist",
      effort: "Low",
      status: "Ready",
      payload: {
        productMomentumScore: deterministic.metrics.productMomentumScore,
        productRiskScore: deterministic.riskScore,
        issue: "monitoring",
        trigger: recipeSignals.watchlist.reason,
      },
    });
  }

  if (recipeSignals.fullDiagnosis.shouldRecommend) {
    recommendations.push({
      id: "run-full-diagnosis",
      label: "Run full diagnosis",
      type: "Diagnosis",
      effort: "Medium",
      status: "Ready",
      payload: {
        productMomentumScore: deterministic.metrics.productMomentumScore,
        issue: "diagnosis",
        trigger: recipeSignals.fullDiagnosis.reason,
      },
    });
  }

  if (recipeSignals.qa.shouldRecommend) {
    recommendations.push({
      id: "recommend-qa-review",
      label: "Supplier / QA review",
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
      label: "Pause affected variant / reduce availability",
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
      label: "Change product status",
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

  return prioritizeRecommendationActions(
    deduplicateRecommendationActions(uniqueBy(recommendations, (item) => item.id)),
    { deterministic, mainIssue, recipeSignals },
  )
    .map((item) => attachAiActionRationale(item, actionRationales))
    .map((item, index) => decorateRecommendationRecipe(item, { deterministic, mainIssue, index }));
}

function getAiActionRationaleMap(ai = {}) {
  const entries = Array.isArray(ai.actionRationales?.action_rationales)
    ? ai.actionRationales.action_rationales
    : [];
  return new Map(entries
    .map((item) => [
      normalizeRecommendationRationaleKey(item?.action_id || item?.id || item?.actionId),
      normalizeRecommendationRationaleText(item?.rationale || item?.why_this_action || item?.why || ""),
    ])
    .filter(([key, value]) => key && value));
}

function attachAiActionRationale(action = {}, rationaleMap = new Map()) {
  const key = normalizeRecommendationRationaleKey(action.id);
  const rationale = rationaleMap.get(key);
  if (!rationale) return action;
  return {
    ...action,
    payload: {
      ...(action.payload || {}),
      whyThisAction: rationale,
      rationaleSource: "ai_action_rationale",
    },
  };
}

function normalizeRecommendationRationaleKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeRecommendationRationaleText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 700);
}

function deduplicateRecommendationActions(actions = []) {
  return actions.reduce((kept, action) => {
    if (!isDescriptionRecommendation(action)) {
      kept.push(action);
      return kept;
    }

    const duplicateIndex = kept.findIndex((existing) => isDuplicateDescriptionRecommendation(existing, action));
    if (duplicateIndex < 0) {
      kept.push(action);
      return kept;
    }

    const existing = kept[duplicateIndex];
    const preferred = choosePreferredDescriptionRecommendation(existing, action);
    const skipped = preferred === existing ? action : existing;
    kept[duplicateIndex] = mergeRecommendationRelationship(preferred, skipped);
    return kept;
  }, []);
}

function isDescriptionRecommendation(action = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  return Boolean(payload.draftText && (
    normalized.includes("description")
    || normalized.includes("pdp")
    || normalized.includes("note")
    || normalized.includes("expectation")
    || normalized.includes("specs")
    || ["prepend", "append", "replace"].includes(payload.operation)
  ));
}

function isDuplicateDescriptionRecommendation(first = {}, second = {}) {
  if (!isDescriptionRecommendation(first) || !isDescriptionRecommendation(second)) return false;
  const firstCause = String(first.payload?.causeKey || "").trim();
  const secondCause = String(second.payload?.causeKey || "").trim();
  if (firstCause && secondCause && firstCause === secondCause) return true;
  return hasSubstantialOverlap(first.payload?.draftText || "", second.payload?.draftText || "");
}

function choosePreferredDescriptionRecommendation(first = {}, second = {}) {
  const score = (action) => {
    const normalized = `${action.id || ""} ${action.label || ""}`.toLowerCase();
    const operation = action.payload?.operation || action.payload?.placement || "";
    let total = 0;
    if (operation === "replace") total += 30;
    if (operation === "prepend") total += 22;
    if (operation === "append") total += 12;
    if (normalized.includes("expectation") || normalized.includes("fit-note") || normalized.includes("quality-note") || normalized.includes("subjective")) total += 8;
    if (normalized.includes("guidance")) total += 2;
    return total;
  };
  return score(second) > score(first) ? second : first;
}

function mergeRecommendationRelationship(preferred = {}, skipped = {}) {
  const payload = preferred.payload || {};
  return {
    ...preferred,
    payload: {
      ...payload,
      relatedActionIds: uniqueBy([...(payload.relatedActionIds || []), skipped.id].filter(Boolean), String),
      relatedActionLabels: uniqueBy([...(payload.relatedActionLabels || []), skipped.label].filter(Boolean), String),
    },
  };
}

function prioritizeRecommendationActions(actions = [], { deterministic = {}, mainIssue = "", recipeSignals = {} } = {}) {
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, recipeSignals.sourceMismatch?.signals);
  const refundOperationalMode = isRefundDrivenOperationalDiagnosis(deterministic);
  const monitoringOnlyMode = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  return [...actions]
    .map((action, index) => ({
      action,
      index,
      score: getServerRecommendationPriorityScore(action, { sourceIntegrityMode, refundOperationalMode, monitoringOnlyMode, mainIssue }),
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map((item) => item.action);
}

function getServerRecommendationPriorityScore(action = {}, { sourceIntegrityMode = false, refundOperationalMode = false, monitoringOnlyMode = false, mainIssue = "" } = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  const normalizedMainIssue = normalizeIssueCode(mainIssue);
  let score = 0;
  if (/description|pdp|expectation|faq|spec/.test(normalized)) score += 60;
  if (/source.*mismatch|source integrity/.test(normalized)) score += 55;
  if (/supplier|qa/.test(normalized)) score += 50;
  if (/seo|meta|handle|media|image|alt text/.test(normalized)) score += 30;
  if (/tag|collection|workflow|internal|evidence/.test(normalized)) score -= 10;
  if (normalizedMainIssue === "color_expectation") {
    if (/media|image|alt text|contextual/.test(normalized)) score += 70;
    if (/expectation|faq|description|pdp/.test(normalized)) score += 20;
    if (/supplier|qa|variant|inventory|status/.test(normalized)) score -= 45;
  }
  if (sourceIntegrityMode) {
    if (/source.*mismatch|source integrity/.test(normalized)) score += 220;
    if (/description|pdp|expectation|faq|spec|variant|pricing|price|compare-at/.test(normalized)) score -= 120;
  }
  if (refundOperationalMode) {
    if (/supplier|qa/.test(normalized)) score += 120;
    if (/pricing|price|compare-at/.test(normalized)) score -= 80;
  }
  if (monitoringOnlyMode) {
    if (/watchlist|baseline/.test(normalized)) score += 160;
    if (/description|pdp|expectation|faq|spec|supplier|qa|variant|pricing|price|compare-at|media|image|alt text|template/.test(normalized)) score -= 120;
    if (/seo|meta|handle|classification|metafield|tag|collection|workflow|internal|evidence/.test(normalized)) score -= 30;
  }
  return score;
}

function isLowRiskMonitoringOnlyDiagnosis(deterministic = {}) {
  const contentIssues = getActionableContentIssues(deterministic.metrics || {});
  const riskScore = Number(deterministic.riskScore || 0);
  return riskScore < 50
    && !hasMaterialCustomerProblemEvidence(deterministic)
    && !hasCriticalContentIssue(contentIssues);
}

function hasMaterialCustomerProblemEvidence(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const textSentiment = metrics.textInsights?.sentiment || {};
  const negativeTextSignals = Number(textSentiment.negative || 0);
  const negativeTextRatio = Number(textSentiment.negativeRatio || 0);
  const negativeReviewCount = Number(metrics.negativeReviewCount || 0);
  const reviewCount = Number(metrics.reviewCount || 0);
  const negativeReviewRate = Number.isFinite(Number(metrics.negativeReviewRate))
    ? Number(metrics.negativeReviewRate)
    : reviewCount > 0 ? (negativeReviewCount / reviewCount) * 100 : 0;
  const materialNegativeReviewPressure = negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    && (
      negativeReviewCount >= 4
      || negativeReviewRate >= 20
      || (reviewCount > 0 && reviewCount <= 5 && negativeReviewRate >= 40)
    );
  return Number(metrics.returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || Number(metrics.refundUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || materialNegativeReviewPressure
    || (negativeTextSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE && negativeTextRatio >= 0.35);
}

function hasCriticalContentIssue(contentIssues = []) {
  return (Array.isArray(contentIssues) ? contentIssues : []).some((issue) => {
    const code = normalizeContentIssueCode(issue?.code);
    const severity = String(issue?.severity || "").toLowerCase();
    return severity === "high" || [
      "missing_description",
      "title_description_mismatch",
      "description_variant_mismatch",
      "wrong_product_description",
      "incoherent_description",
      "generic_title",
    ].includes(code);
  });
}

function getRecommendationRecipeSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const product = deterministic.product || {};
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  const contentIssues = getActionableContentIssues(metrics);
  const contentAdvisories = Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : metrics.contentAdvisories || [];
  const hasCustomerEvidence = hasMaterialCustomerProblemEvidence(deterministic);
  const hasActionableEvidence = hasCustomerEvidence || contentIssues.length > 0;
  const lowRiskMonitoringOnly = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const variantCount = Number(metrics.variantCount || product.variants?.length || 0);
  const affectedVariantCount = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : 0;
  const hasVariantConcentration = hasAffectedVariantConcentration(metrics);
  const valueSignals = getValuePerceptionSignals(deterministic);
  const mediaIssue = Number(metrics.mediaWithoutAltCount || 0) > 0
    || Number(metrics.mediaCount || 0) === 0
    || mainIssue === "color_expectation"
    || contentAdvisories.some((item) => ["missing_media_context", "missing_media_alt_text"].includes(normalizeContentIssueCode(item.code)));
  const highRiskOperationalIssue = ["safety_concern", "quality_defect", "durability", "refund_impact"].includes(mainIssue);
  const operationalQualityTextSignals = hasOperationalQualityTextSignals(deterministic);
  const refundInsights = metrics.refundInsights || {};
  const sourceMismatchSignals = getSourceMismatchSignals(deterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, sourceMismatchSignals);
  const subjectiveExpectationOnly = isSubjectiveExpectationOnlyDiagnosis(deterministic);
  const missingSourceSignals = getMissingSourceSignals(deterministic);
  const productMomentumScore = Number(metrics.productMomentumScore || metrics.productMomentum?.score || 0);
  const staleAnalysis = isStaleDiagnosis(metrics.lastAnalyzedAt || metrics.lastDiagnosisAt || metrics.latestDiagnosisAt);
  const hasVariantNamingProblem = Boolean(metrics.variantNamingAdvisory)
    || contentAdvisories.some((item) => normalizeContentIssueCode(item.code) === "unclear_variant_names");
  const variantConcentrationNeedsOptionFix = hasVariantConcentration
    && affectedVariantCount > 0
    && ["fit_sizing", "quality_defect", "durability", "safety_concern"].includes(mainIssue);
  const hasPricingContext = valueSignals.length >= 2;

  return {
    title: {
      shouldRecommend: Boolean(metrics.titleNeedsReview || contentIssues.some((item) => ["generic_title", "title_description_mismatch"].includes(normalizeContentIssueCode(item.code)))),
      reason: "The product title is generic, misleading, or clearly disconnected from the product content.",
    },
    seoTitle: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.seoTitleNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "The SEO title is missing, duplicated, too long, too generic or weak for the product keywords.",
    },
    metaDescription: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.metaDescriptionNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "The meta description is missing, too short, too long or unclear for search-result shoppers.",
    },
    handle: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.handleNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "The product URL handle is confusing, inconsistent with the title, or missing useful product keywords.",
    },
    specs: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && !sourceIntegrityMode && metrics.specsBlockRecommended && (hasActionableEvidence || contentIssues.length || ["fit_sizing", "compatibility", "color_expectation"].includes(mainIssue))),
      reason: "A compact specs/details block would clarify dimensions, compatibility, materials, care, included items or product limits.",
    },
    variants: {
      shouldRecommend: Boolean(!sourceIntegrityMode && variantCount > 1 && (
        variantConcentrationNeedsOptionFix
        || (hasVariantNamingProblem && !subjectiveExpectationOnly)
      ) && (hasCustomerEvidence || hasVariantNamingProblem)),
      reason: hasVariantConcentration && affectedVariantCount
        ? "Signals are concentrated in specific variants, SKUs or options."
        : "Variant names or option labels are unclear enough to review.",
    },
    pricing: {
      shouldRecommend: Boolean(!sourceIntegrityMode && hasPricingContext),
      reason: hasPricingContext
        ? `Customer language points to value or price perception: ${valueSignals.slice(0, 3).join(", ")}.`
        : "Price review requires explicit value or price perception evidence.",
    },
    status: {
      shouldRecommend: Boolean(hasActionableEvidence && highRiskOperationalIssue && Number(deterministic.riskScore || 0) >= 75 && Number(deterministic.confidence || 0) >= 65),
      reason: "Risk and confidence are both high for a potentially serious product-quality issue.",
    },
    inventory: {
      shouldRecommend: Boolean(!sourceIntegrityMode && variantCount > 1 && hasVariantConcentration && affectedVariantCount > 0 && Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0) >= 4 && Number(deterministic.riskScore || 0) >= 65),
      reason: "The problem appears concentrated enough to consider holding a specific affected variant.",
    },
    collection: {
      shouldRecommend: Boolean(hasActionableEvidence && Number(deterministic.riskScore || 0) >= 55),
      reason: "The product should be grouped for internal review or quality workflow tracking.",
    },
    media: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && mediaIssue && (hasActionableEvidence || mainIssue === "color_expectation")),
      reason: Number(metrics.mediaWithoutAltCount || 0) > 0
        ? `${metrics.mediaWithoutAltCount} product media item${Number(metrics.mediaWithoutAltCount) === 1 ? "" : "s"} need clearer alt text.`
        : "Customer expectations may depend on images, scale, color, material or visual context.",
    },
    mediaOrder: {
      shouldRecommend: Boolean(Number(metrics.mediaCount || 0) > 1 && (mainIssue === "color_expectation" || contentAdvisories.some((item) => normalizeContentIssueCode(item.code) === "missing_media_context"))),
      reason: "The current media sequence may not put the clearest context, scale, color or format image first.",
    },
    contextualMedia: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && (Number(metrics.mediaCount || 0) === 0 || ["color_expectation", "subjective_negative_reaction"].includes(mainIssue)) && (hasActionableEvidence || mainIssue === "color_expectation")),
      reason: "Customers may need an additional contextual image showing scale, packaging, color, material or real use.",
    },
    classification: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.classificationNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "Vendor, product type or category data is incomplete enough to weaken catalog workflows and reporting.",
    },
    structuredMetafields: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && hasActionableEvidence && (contentIssues.length || highRiskOperationalIssue || productMomentumScore >= 70)),
      reason: "Structured product metadata can preserve warnings, QA status, SEO notes or risk flags for themes and reporting.",
    },
    template: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.templateNeedsReview && (metrics.faqNeed?.shouldRecommend || metrics.specsBlockRecommended || hasActionableEvidence)),
      reason: "The product may need a richer template to display FAQ, specs or warning content beyond plain description text.",
    },
    sourceMismatch: {
      shouldRecommend: Boolean(sourceIntegrityMode),
      reason: "Reviews, returns or text appear to reference another product, SKU, feed item or variant.",
      signals: sourceMismatchSignals,
    },
    missingSource: {
      shouldRecommend: Boolean(missingSourceSignals.length && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: `Diagnosis coverage is limited by missing sources: ${missingSourceSignals.join(", ")}.`,
      sources: missingSourceSignals,
    },
    monitoringCoverage: {
      shouldRecommend: Boolean(productMomentumScore >= 70 && missingSourceSignals.length),
      reason: "This product has enough commercial momentum to deserve stronger monitoring coverage before issues become expensive.",
    },
    baselineScan: {
      shouldRecommend: Boolean(productMomentumScore >= 75 && Number(deterministic.riskScore || 0) < 50 && !hasActionableEvidence),
      reason: "The product is commercially important but currently has limited problem evidence, so a baseline can help monitor future changes.",
    },
    watchlist: {
      shouldRecommend: Boolean(productMomentumScore >= 75 && Number(deterministic.riskScore || 0) < 70),
      reason: "Momentum is high enough that this product should be watched periodically even if risk is not currently high.",
    },
    fullDiagnosis: {
      shouldRecommend: Boolean(productMomentumScore >= 70 && staleAnalysis),
      reason: "This product has enough momentum and the current diagnosis is old enough to justify a fresh full diagnosis.",
    },
    qa: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && !sourceIntegrityMode && hasActionableEvidence && !subjectiveExpectationOnly && (
        ["safety_concern", "durability", "refund_impact"].includes(mainIssue)
        || (highRiskOperationalIssue && operationalQualityTextSignals)
        || (refundInsights.shouldSurface && operationalQualityTextSignals)
      )),
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

function isSourceIntegrityDiagnosis(deterministic = {}, sourceMismatchSignals = null) {
  const metrics = deterministic.metrics || {};
  const signals = Array.isArray(sourceMismatchSignals) ? sourceMismatchSignals : getSourceMismatchSignals(deterministic);
  if (signals.length >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return true;
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const issueText = [
    deterministic.mainIssue,
    metrics.primaryIssue,
    metrics.mainIssue,
    ...contentIssues.map((issue) => `${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`),
  ].map(String).join(" ");
  return /\b(source integrity|review feed|feed integrity|feed mismatch|metadata mismatch|review mismatch|wrong product|wrong sku)\b/i.test(issueText);
}

function isSubjectiveExpectationOnlyDiagnosis(deterministic = {}) {
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  const textValues = getOperationalSignalTextValues(deterministic);
  const text = textValues.join(" ");
  const subjectiveIssue = ["fit_sizing", "compatibility", "color_expectation", "subjective_negative_reaction"].includes(mainIssue);
  const subjectiveLanguage = /\b(too soft|too firm|softness|soft|cushion|cushioned|balance|pose|comfort|comfortable|preference|expected|expectation|subjective|fit|sizing|size|color|appearance)\b/i.test(text);
  if (!subjectiveIssue && !subjectiveLanguage) return false;
  return !hasOperationalQualityTextSignals(deterministic);
}

function isRefundDrivenOperationalDiagnosis(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  return Boolean(
    Number(metrics.refundUnits || 0) >= 3
    && Number(metrics.refundRate || 0) >= 20
    && hasOperationalQualityTextSignals(deterministic)
  );
}

function hasAffectedVariantConcentration(metrics = {}) {
  const variants = Array.isArray(metrics.affectedVariantDetails)
    ? metrics.affectedVariantDetails
    : Array.isArray(metrics.affectedVariants)
      ? metrics.affectedVariants.map((label) => ({ label, count: 1 }))
      : [];
  if (variants.length < 1) return false;
  const counts = variants.map((variant) => Number(variant.count || 0)).filter((count) => count > 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const strongest = Math.max(0, ...counts);
  if (strongest < 3 || total < 4) return false;
  const strongestRatio = strongest / Math.max(total, 1);
  const variantCount = Number(metrics.variantCount || 0);
  const affectedCount = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : variants.length;
  if (variantCount > 1 && affectedCount >= variantCount && strongestRatio < 0.85) return false;
  return strongestRatio >= 0.65;
}

function hasOperationalQualityTextSignals(deterministic = {}) {
  return getOperationalSignalTextValues(deterministic)
    .some((value) => /\b(leak|leaking|spill|spilled|broken|break|broke|crack|cracked|chip|chipped|defect|defective|damaged|damage|unsafe|safety|hazard|durability|malfunction|failed|failure|lid|seal|tear|ripped|stain|mold|battery|burn|sharp|packaging|package|shipping|arrived damaged)\b/i.test(value));
}

function getOperationalSignalTextValues(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const repeated = [
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []),
    ...(Array.isArray(metrics.textInsights?.reviews?.repeatedLanguage) ? metrics.textInsights.reviews.repeatedLanguage : []),
    ...(Array.isArray(metrics.textInsights?.returns?.repeatedLanguage) ? metrics.textInsights.returns.repeatedLanguage : []),
  ];
  const topReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const snippets = Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : [];
  const values = [
    ...contentIssues.map((issue) => `${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`),
    ...repeated.map((item) => `${item.term || item.label || item.phrase || ""}`),
    ...topReasons.map((item) => `${item.label || item}`),
    ...snippets.map((item) => `${item.text || item.body || item.quote || item.summary || ""}`),
  ].map(String);
  return values;
}

function getSourceMismatchSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const textValues = [
    ...(Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : []).map((item) => item.text || item.body || item.quote || item.summary || ""),
    ...contentIssues.map((item) => `${item.code || ""} ${item.label || ""} ${item.evidence || ""}`),
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []).map((item) => item.term || item.label || item.phrase || ""),
  ].map(String);
  return uniqueBy(
    textValues.filter((value) => /\b(wrong product|different product|another product|not this product|wrong sku|sku mismatch|review mismatch|feed mismatch|wrong variant|not the item|different item)\b/i.test(value)),
    (value) => normalizeText(value),
  ).slice(0, 5);
}

function getMissingSourceSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const sourceCoverage = new Set((deterministic.sourceCoverage || metrics.sourceCoverage || []).map((source) => normalizeText(source)));
  const missing = [];
  if (metrics.orderAccessDenied) missing.push("Shopify orders");
  if (!sourceCoverageHas(sourceCoverage, "csv") && !sourceCoverageHas(sourceCoverage, "judge") && !Number(metrics.reviewCount || 0)) missing.push("external reviews");
  return uniqueBy(missing, normalizeText).slice(0, 4);
}

function sourceCoverageHas(sourceCoverage, needle) {
  const normalizedNeedle = normalizeText(needle);
  return [...sourceCoverage].some((source) => source.includes(normalizedNeedle));
}

function isStaleDiagnosis(value, staleDays = 14) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > staleDays * 24 * 60 * 60 * 1000;
}

function decorateRecommendationRecipe(action, { deterministic, mainIssue, index }) {
  const recipe = getRecommendationRecipeMetadata(action, { deterministic, mainIssue, index });
  const compact = getRecommendationCompactMetadata(action, { deterministic, mainIssue, recipe });
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
      impactLevel: recipe.impactLevel,
      impact: compact.impact,
      actionTier: recipe.actionTier,
      visibility: compact.visibility,
      confidence: compact.confidence,
      evidenceStrength: compact.evidenceStrength,
      reversibility: compact.reversibility,
      approvalLevel: compact.approvalLevel,
      reasonCategory: compact.reasonCategory,
      expectedBenefit: compact.expectedBenefit,
    },
  };
}

function getRecommendationCompactMetadata(action, { deterministic, mainIssue, recipe }) {
  return {
    impact: getCompactImpactLabel(recipe.impact || recipe.impactLevel),
    visibility: getRecommendationVisibility(action),
    confidence: getRecommendationConfidenceLabel(deterministic.confidence),
    evidenceStrength: getRecommendationEvidenceStrengthLabel(deterministic, action),
    reversibility: getRecommendationReversibility(action),
    approvalLevel: getRecommendationApprovalLevel(action, recipe),
    reasonCategory: getRecommendationReasonCategory(action, mainIssue),
    expectedBenefit: getRecommendationExpectedBenefit(action, recipe),
  };
}

function getCompactImpactLabel(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "High";
  if (normalized.includes("medium")) return "Medium";
  return "Optional";
}

function getRecommendationConfidenceLabel(confidence) {
  const score = Number(confidence || 0);
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function getRecommendationEvidenceStrengthLabel(deterministic = {}, action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("mismatch") || normalized.includes("conflict")) return "Conflicting";
  const metrics = deterministic.metrics || {};
  const sourceCount = Array.isArray(deterministic.sourceCoverage) ? deterministic.sourceCoverage.length : Array.isArray(metrics.sourceCoverage) ? metrics.sourceCoverage.length : 0;
  const signalCount = Number(metrics.customerSignalCount || metrics.signalCount || 0);
  if (signalCount >= 10 && sourceCount >= 3) return "Strong";
  if (signalCount >= 5 || sourceCount >= 2) return "Moderate";
  return "Weak";
}

function getRecommendationVisibility(action = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.shopifyField || ""}`.toLowerCase();
  if (/\b(description|pdp|faq|title|seo|meta|handle|media|image|alt text|specs|details)\b/.test(value)) return "Customer-facing";
  if (/\b(status|price|compare-at|inventory|variant|supplier|qa|fulfillment|safety)\b/.test(value)) return "Operational";
  return "Internal";
}

function getRecommendationReversibility(action = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.shopifyField || ""}`.toLowerCase();
  if (/\b(status|archive|draft|inventory|price|compare-at|variant)\b/.test(value)) return "Hard";
  if (/\b(description|pdp|title|seo|meta|handle|template|media|collection|classification)\b/.test(value)) return "Moderate";
  return "Easy";
}

function getRecommendationApprovalLevel(action = {}, recipe = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${recipe.applicationRisk || ""} ${recipe.approval || ""}`.toLowerCase();
  if (/\b(high|status|archive|draft|inventory|price|compare-at|strong|manual approval)\b/.test(value)) return "Strong confirmation required";
  if (/\b(tag|metafield|watchlist|baseline|internal note|copy-support|connect-missing-source|monitoring)\b/.test(value)) return "Auto-safe";
  return "Review required";
}

function getRecommendationReasonCategory(action = {}, mainIssue = "") {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.trigger || ""} ${mainIssue || ""}`.toLowerCase();
  if (/\b(momentum|watchlist|baseline)\b/.test(value)) return "Momentum";
  if (/\b(seo|meta|handle)\b/.test(value)) return "SEO";
  if (/\b(variant|sku|option)\b/.test(value)) return "Variant issue";
  if (/\b(sentiment|subjective|fear|safety|emotion)\b/.test(value)) return "Sentiment";
  if (/\b(review|rating|judge|csv)\b/.test(value)) return "Reviews";
  if (/\b(refund|price|margin|value)\b/.test(value)) return "Refunds";
  if (/\b(return)\b/.test(value)) return "Returns";
  if (/\b(description|content|pdp|faq|spec|title|media|image)\b/.test(value)) return "Content gap";
  return "Content gap";
}

function getRecommendationExpectedBenefit(action = {}, recipe = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${recipe.expectedImpact || ""}`.toLowerCase();
  if (/\b(seo|meta|handle)\b/.test(value)) return "Improve SEO";
  if (/\b(tag|collection|metafield|workflow|support|note|coverage|watchlist|baseline)\b/.test(value)) return "Improve workflow";
  if (/\b(status|inventory|draft|archive|safety|qa|supplier|bad purchase)\b/.test(value)) return "Prevent bad purchases";
  if (/\b(return|refund|variant|fit|size|quality|durability)\b/.test(value)) return "Reduce returns";
  return "Reduce confusion";
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
    impactLevel: "Optional",
    actionTier: 3,
  };

  if (id === "correct-product-description") {
    return {
      ...common,
      proposedChange: "Correct specific contradictory text in the Shopify product description while preserving the existing description structure.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Remove a buyer-facing content contradiction without rewriting the full PDP copy.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if ((id.includes("description") && id !== "rewrite-meta-description") || id.includes("fit-note") || id.includes("expectation") || id.includes("quality-note") || id.includes("subjective")) {
    return {
      ...common,
      proposedChange: payload.operation === "replace" ? "Rewrite the Shopify product description while preserving useful existing copy." : "Insert shopper-facing expectation guidance into the product description.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Reduce avoidable buyer confusion before checkout.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "create-product-faq") {
    return {
      ...common,
      proposedChange: "Create generated FAQ content and apply it as description HTML or a product metafield.",
      shopifyField: "Product.descriptionHtml or productpulse.faq_html metafield",
      expectedImpact: "Answer repeated buyer uncertainty before purchase.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "update-product-title") {
    return {
      ...common,
      proposedChange: `Change the title from "${payload.currentTitle || "current title"}" to "${payload.draftTitle || "a clearer title"}".`,
      shopifyField: "Product.title",
      expectedImpact: "Make the product easier to identify and reduce expectation mismatch.",
      applicationRisk: "Medium",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "rewrite-seo-title") {
    return {
      ...common,
      proposedChange: `Change the SEO title to "${payload.draftText || payload.draftTitle || "a clearer search title"}".`,
      shopifyField: "Product.seo.title",
      expectedImpact: "Improve search-result clarity without changing the visible PDP title.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "rewrite-meta-description") {
    return {
      ...common,
      proposedChange: "Rewrite the Shopify meta description for clearer search-result copy.",
      shopifyField: "Product.seo.description",
      expectedImpact: "Clarify search-result expectations and reduce low-intent clicks.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "improve-url-handle") {
    return {
      ...common,
      proposedChange: `Change the product URL handle to "${payload.draftHandle || payload.draftText || "a clearer handle"}" and create a redirect when Shopify supports it.`,
      shopifyField: "Product.handle",
      expectedImpact: "Make the URL easier to read, share and match to product keywords.",
      applicationRisk: "Medium",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-specs-details-block") {
    return {
      ...common,
      proposedChange: "Add a compact specs/details block to the Shopify product description.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Reduce confusion around dimensions, compatibility, materials, care, included items or product limits.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
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
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
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
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
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
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
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
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "apply-risk-tags") {
    return {
      ...common,
      proposedChange: `Add internal Shopify tags: ${(payload.tags || []).join(", ")}.`,
      shopifyField: "Product.tags",
      expectedImpact: "Make the product discoverable in internal workflows and automated collections.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
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
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "improve-product-media") {
    const updates = Array.isArray(payload.mediaUpdates) ? payload.mediaUpdates : [];
    const proposedChange = updates.length
      ? `Update alt text for ${updates.length === 1 ? updates[0]?.targetLabel || "one product media item" : `${updates.length} product media items`}. Recommended image brief: ${payload.imageBrief || "make scale, material, color and format clear."}`
      : "Add image guidance, improve alt text, or review media order for clearer shopper expectations.";
    return {
      ...common,
      proposedChange,
      shopifyField: updates.length ? "Product media alt text" : "Product media and alt text",
      expectedImpact: "Reduce visual expectation mismatch and improve PDP clarity.",
      applicationRisk: updates.length ? "Low" : "Medium",
      approval: updates.length ? "Review required before applying" : "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "reorder-product-media") {
    return {
      ...common,
      proposedChange: "Move the clearest scale, format, color or context media earlier in the product gallery.",
      shopifyField: "Product media order",
      expectedImpact: "Help shoppers understand the product visually before they read detailed copy.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-contextual-media-recommendation") {
    return {
      ...common,
      proposedChange: payload.imageBrief || "Add a contextual product image that shows scale, material, packaging, color or real use.",
      shopifyField: "Product media",
      expectedImpact: "Reduce visual surprise and expectation mismatch before purchase.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "update-product-classification") {
    return {
      ...common,
      proposedChange: "Review and update product type, vendor or Shopify category classification.",
      shopifyField: "Product.productType, Product.vendor or category",
      expectedImpact: "Improve catalog reporting, filters, automatic collections and operational routing.",
      applicationRisk: "Medium",
      approval: payload.draftVendor || payload.draftProductType ? "Review required before applying" : "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-structured-metafields") {
    return {
      ...common,
      proposedChange: "Save ProductPulse risk, QA or content notes as structured product metafields.",
      shopifyField: "Product metafields",
      expectedImpact: "Make diagnosis context reusable in themes, workflows and reporting.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "switch-product-template") {
    return {
      ...common,
      proposedChange: `Switch this product to the "${payload.templateSuffix || "productpulse-guidance"}" product template after theme review.`,
      shopifyField: "Product.templateSuffix",
      expectedImpact: "Give this product a layout that can display FAQ, specs or warnings more clearly.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "copy-support-note") {
    return {
      ...common,
      proposedChange: "Create an internal support note or macro.",
      shopifyField: "Internal support workflow",
      expectedImpact: "Help support answer repeated product questions consistently.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
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
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "fix-source-review-mismatch") {
    return {
      ...common,
      proposedChange: "Verify whether reviews, returns, CSV rows or feed data are attached to the wrong product, SKU or variant.",
      shopifyField: "Evidence source integrity",
      expectedImpact: "Prevent the merchant from changing the wrong product based on mismatched evidence.",
      applicationRisk: "Low",
      approval: "Manual verification required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "add-workflow-tags") {
    return {
      ...common,
      proposedChange: `Add workflow tags: ${(payload.tags || []).join(", ")}.`,
      shopifyField: "Product.tags",
      expectedImpact: "Route the product into team workflows without changing customer-facing copy.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "connect-missing-source") {
    return {
      ...common,
      proposedChange: `Connect or enable missing source coverage: ${(payload.missingSources || []).join(", ") || "missing sources"}.`,
      shopifyField: "ProductPulse source connections",
      expectedImpact: "Increase diagnosis confidence before taking bigger product changes.",
      applicationRisk: "Low",
      approval: "Manual setup required",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "improve-monitoring-coverage") {
    return {
      ...common,
      proposedChange: "Improve monitoring coverage for a commercially important product.",
      shopifyField: "ProductPulse monitoring workflow",
      expectedImpact: "Catch risk changes earlier for products that matter commercially.",
      applicationRisk: "Low",
      approval: "Manual setup required",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "create-baseline-scan") {
    return {
      ...common,
      proposedChange: "Create a baseline scan so future changes can be compared against a clean starting point.",
      shopifyField: "ProductPulse diagnosis history",
      expectedImpact: "Make future risk and momentum changes easier to detect.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "add-to-watchlist") {
    return {
      ...common,
      proposedChange: "Add this product to the Watchlist for periodic deep diagnostics.",
      shopifyField: "ProductPulse Watchlist",
      expectedImpact: "Monitor commercially important products before small issues grow.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "run-full-diagnosis") {
    return {
      ...common,
      proposedChange: "Run or re-run the full product diagnosis.",
      shopifyField: "ProductPulse diagnosis job",
      expectedImpact: "Refresh diagnosis confidence for important or stale products.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
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

function buildSuggestedSeoTitle({ product = {}, snapshot = {}, mainIssue = "", aiTitle = "" } = {}) {
  const base = normalizeSuggestedTitle(aiTitle || product.title || snapshot.productTitle || buildSuggestedProductTitle(product, mainIssue));
  const vendor = String(product.vendor || "").trim();
  const withVendor = vendor && !normalizeText(base).includes(normalizeText(vendor)) ? `${base} | ${vendor}` : base;
  return normalizeSuggestedTitle(withVendor).slice(0, 70).replace(/\s+[|-]?\s*$/, "");
}

function buildSuggestedMetaDescription({ product = {}, snapshot = {}, mainIssue = "", aiDescription = "" } = {}) {
  const title = String(product.title || snapshot.productTitle || "This product").trim();
  const description = stripHtml(product.description || product.descriptionHtml || "").replace(/\s+/g, " ").trim();
  const issueLabel = getHumanIssueLabel(mainIssue).toLowerCase();
  const base = aiDescription || description || `${title} with clear product details, specifications, included items and expectation-setting guidance for shoppers.`;
  const prefix = base.toLowerCase().startsWith(title.toLowerCase()) ? base : `${title}: ${base}`;
  const suffix = issueLabel && !["product quality", "no issue"].includes(issueLabel) ? ` Includes guidance around ${issueLabel}.` : "";
  return truncateSentence(`${prefix}${suffix}`, 155);
}

function buildSuggestedProductHandle({ product = {}, snapshot = {} } = {}) {
  const source = String(product.title || snapshot.productTitle || product.handle || snapshot.handle || "product").trim();
  const handle = normalizeText(source)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
  return handle || String(product.handle || snapshot.handle || "product").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

function buildVariantOptionUpdateSuggestions({ product = {}, affectedVariants = [], variantDetails = [] } = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) return [];

  const affectedLabels = uniqueBy([
    ...affectedVariants,
    ...variantDetails.map((item) => item.label || item.title || item.sku || ""),
  ].map((value) => String(value || "").trim()).filter(Boolean), normalizeText);
  const affectedSet = new Set(affectedLabels.map(normalizeText));
  const targetVariants = variants
    .filter((variant) => {
      if (!affectedSet.size) return isGenericVariantTitle(variant.title);
      return affectedSet.has(normalizeText(variant.title))
        || affectedSet.has(normalizeText(variant.sku))
        || (Array.isArray(variant.selectedOptions) && variant.selectedOptions.some((option) => affectedSet.has(normalizeText(option.value))));
    })
    .slice(0, 4);

  return targetVariants
    .map((variant) => buildVariantOptionUpdateSuggestion(variant, { product }))
    .filter(Boolean);
}

function buildVariantOptionUpdateSuggestion(variant = {}, { product = {} } = {}) {
  const selectedOptions = Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [];
  const optionValues = selectedOptions
    .map((option) => {
      const optionName = String(option.name || "").trim();
      const currentValue = String(option.value || "").trim();
      const suggestedValue = buildSuggestedVariantOptionValue({ optionName, currentValue, variant, product });
      if (!optionName || !suggestedValue || suggestedValue === currentValue) return null;
      return { optionName, currentValue, suggestedValue };
    })
    .filter(Boolean);
  const suggestedLabel = optionValues.length
    ? optionValues.map((option) => option.suggestedValue).join(" / ")
    : buildSuggestedVariantLabel({ variant, product });
  if (!variant.id || (!optionValues.length && suggestedLabel === variant.title)) return null;
  return {
    variantId: variant.id,
    variantTitle: variant.title || "",
    sku: variant.sku || "",
    currentLabel: variant.title || variant.sku || "Variant",
    suggestedLabel,
    optionValues,
  };
}

function buildSuggestedVariantOptionValue({ optionName = "", currentValue = "", variant = {}, product = {} } = {}) {
  const normalizedValue = String(currentValue || "").trim();
  const normalizedOption = String(optionName || "").trim();
  if (!normalizedValue || /^default title$/i.test(normalizedValue)) {
    return buildSuggestedVariantLabel({ variant, product });
  }
  if (/^(one size|default)$/i.test(normalizedValue) && product.productType) {
    return `${normalizedValue} ${product.productType}`.replace(/\s+/g, " ").trim();
  }
  if (/^(color|colour)$/i.test(normalizedOption) && product.title && !normalizeText(product.title).includes(normalizeText(normalizedValue))) {
    return normalizedValue;
  }
  return normalizedValue;
}

function buildSuggestedVariantLabel({ variant = {}, product = {} } = {}) {
  const selectedOptions = Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [];
  const currentValues = selectedOptions.map((option) => option.value).filter((value) => value && !/^default title$/i.test(value));
  if (currentValues.length) return currentValues.join(" / ");
  const firstOptionName = String(selectedOptions[0]?.name || product.options?.[0]?.name || "").toLowerCase();
  if (firstOptionName.includes("size")) return "One size";
  if (firstOptionName.includes("color") || firstOptionName.includes("colour")) return "Standard color";
  return "Standard";
}

function isGenericVariantTitle(value = "") {
  return /^default title$/i.test(String(value || "").trim());
}

function buildSpecsDetailsBlock({ product = {}, contentIssues = [], mainIssue = "", deterministic = {}, aiSpecsBlock = "" } = {}) {
  const normalizedAiBlock = normalizeSpecsDetailsBlock(aiSpecsBlock);
  if (normalizedAiBlock) return normalizedAiBlock;

  const context = buildSpecsDetailsContext({ product, contentIssues, mainIssue, deterministic });
  const items = buildTechnicalSpecItems(context);
  return [
    "Technical details to confirm before buying:",
    ...items.map((item) => `- ${item.label}: ${item.detail}`),
  ].join("\n");
}

function normalizeSpecsDetailsBlock(value = "") {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const normalized = normalizeText(text);
  const metadataOnly = [
    "product type",
    "brand vendor",
    "available options",
    "variants skus",
  ].filter((needle) => normalized.includes(needle)).length >= 3;
  const hasTechnicalDetail = /\b(voltage|capacity|dimension|height|width|length|weight|temperature|timer|alarm|power|battery|material|care|compatib|clean|water|humidity|condensation|range|included|limit|setup|firmware|connectivity|size chart|loft|seal|leak|heat|brew)\b/i.test(text);
  if (metadataOnly && !hasTechnicalDetail) return "";
  return text;
}

function buildSpecsDetailsContext({ product = {}, contentIssues = [], mainIssue = "", deterministic = {} } = {}) {
  const metrics = deterministic.metrics || {};
  const sourceText = [
    product.title,
    product.productType,
    product.description,
    stripHtml(product.descriptionHtml || ""),
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
    getHumanIssueLabel(mainIssue),
    ...contentIssues.flatMap((issue) => [issue.code, issue.label, issue.evidence]),
    ...(Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : []).map((item) => item.text || item.body || item.quote || item.summary || ""),
    ...(Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails : []).map((item) => `${item.label || ""} ${item.detail || ""}`),
    ...(Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : []),
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []).map((item) => `${item.term || item.label || item.phrase || ""}`),
  ].filter(Boolean).join(" ");
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return {
    product,
    mainIssue: normalizeIssueCode(mainIssue),
    text: sourceText,
    normalizedText: normalizeText(sourceText),
    variantLabels: uniqueBy(
      variants.map((variant) => String(variant.title || variant.sku || "").trim()).filter(Boolean),
      normalizeText,
    ).slice(0, 4),
  };
}

function buildTechnicalSpecItems(context = {}) {
  const text = context.normalizedText || "";
  const issue = context.mainIssue || "";
  let items = [];

  if (/\b(coffee|brew|brewer|alarm clock|small appliance|appliance|kettle|heater|heat)\b/.test(text)) {
    items = [
      ["Power input", "[confirm voltage, plug type, and whether an adapter is required]"],
      ["Brew capacity", "[confirm water tank capacity and maximum cup size]"],
      ["Brew temperature range", "[confirm target brew temperature or safe operating range]"],
      ["Timer and alarm behavior", "[confirm scheduling accuracy, alarm volume, backup behavior, and what happens after power loss]"],
      ["Water and condensation guidance", "[confirm required surface, clearance, and expected condensation or humidity]"],
      ["Cleaning and removable parts", "[confirm which tank, tray, filter, or cup components are washable]"],
    ];
  } else if (/\b(pillow|bedding|cooling|loft|sleep|insert)\b/.test(text)) {
    items = [
      ["Dimensions and loft", "[confirm length, width, height/loft, and whether loft varies by option]"],
      ["Cooling insert details", "[confirm insert material, expected cooling duration, and whether it should be aired out before use]"],
      ["Cover material and care", "[confirm cover fabric, wash instructions, and insert cleaning limits]"],
      ["Comfort guidance", "[confirm which sleep positions each loft is intended for]"],
      ["Odor or airing guidance", "[confirm any first-use airing instructions]"],
    ];
  } else if (/\b(inflatable|standing desk|desk|furniture|riser|pump)\b/.test(text)) {
    items = [
      ["Inflated dimensions", "[confirm height, width, depth, and usable work surface]"],
      ["Maximum supported weight", "[confirm safe laptop/monitor weight limit]"],
      ["Inflation and deflation", "[confirm pump type, inflation time, and pressure guidance]"],
      ["Stability limits", "[confirm approved surfaces, typing limits, and items not recommended for use]"],
      ["Packed size and included items", "[confirm packed dimensions and whether pump/patch kit are included]"],
    ];
  } else if (/\b(safe|lock|security|voice|keypad)\b/.test(text)) {
    items = [
      ["Unlock methods", "[confirm voice, keypad, key, app, or backup access methods]"],
      ["Voice setup requirements", "[confirm training steps, quiet-room requirement, and supported languages/phrases]"],
      ["Power and battery", "[confirm battery type, expected battery life, and low-battery behavior]"],
      ["Interior dimensions", "[confirm usable internal height, width, depth, and shelf layout]"],
      ["Security limits", "[confirm false-open protections, reset process, and emergency access]"],
    ];
  } else if (/\b(luggage|tag|tracking|qr|bluetooth|gps|travel)\b/.test(text)) {
    items = [
      ["Tracking method", "[confirm whether updates are GPS, Bluetooth, QR scan-based, or network-assisted]"],
      ["Compatibility", "[confirm supported phones, operating systems, and app/account requirements]"],
      ["Battery", "[confirm battery type, battery life, and replacement or charging steps]"],
      ["QR privacy controls", "[confirm which owner details are visible after scan and how to edit them]"],
      ["Range and limitations", "[confirm Bluetooth range, delayed-update behavior, and travel limitations]"],
    ];
  } else if (/\b(shirt|apparel|linen|fit|size|sizing|sleeve|shoulder)\b/.test(text) || issue === "fit_sizing") {
    items = [
      ["Fit measurements", "[confirm chest, shoulder, sleeve, body length, and garment measurements by size]"],
      ["Fit guidance", "[confirm whether the style runs relaxed, fitted, small, or oversized]"],
      ["Material composition", "[confirm fabric blend and whether it may shrink]"],
      ["Care instructions", "[confirm wash, dry, ironing, and shrinkage guidance]"],
      ["Variant-specific notes", "[confirm whether color or size variants fit differently]"],
    ];
  } else if (/\b(mat|yoga|fitness|cushion|balance|thick|firm)\b/.test(text)) {
    items = [
      ["Dimensions", "[confirm length, width, thickness, and weight]"],
      ["Firmness level", "[confirm cushion/firmness rating and intended workout style]"],
      ["Material and grip", "[confirm surface material, underside grip, and floor compatibility]"],
      ["Care", "[confirm cleaning method and drying guidance]"],
      ["Use limits", "[confirm whether this is recommended for balance poses or floor work only]"],
    ];
  } else if (/\b(mug|drinkware|lid|leak|seal|insulated|bottle)\b/.test(text)) {
    items = [
      ["Capacity", "[confirm fluid capacity]"],
      ["Lid and seal limits", "[confirm whether the lid is leakproof, splash-resistant, or upright-only]"],
      ["Temperature retention", "[confirm hot/cold retention window]"],
      ["Cleaning", "[confirm dishwasher safety and removable seal care]"],
      ["Bag-use guidance", "[confirm whether it is safe for bags or near electronics]"],
    ];
  } else if (/\b(earbud|bluetooth|electronics|battery|charging|case)\b/.test(text)) {
    items = [
      ["Battery life", "[confirm earbud and case battery life]"],
      ["Charging", "[confirm cable type, charge time, and included accessories]"],
      ["Connectivity", "[confirm Bluetooth version and supported devices]"],
      ["Fit and included tips", "[confirm included tip sizes or fit accessories]"],
      ["Variant appearance", "[confirm real-life color/material differences by variant]"],
    ];
  } else if (/\b(ceramic|dinner|plate|bowl|kitchen|dishwasher|fragile)\b/.test(text)) {
    items = [
      ["Pieces included", "[confirm exact plate, bowl, and serving-piece count]"],
      ["Dimensions", "[confirm plate and bowl diameters/capacity]"],
      ["Material and finish", "[confirm ceramic type, glaze variation, and finish notes]"],
      ["Care", "[confirm dishwasher, microwave, and oven safety]"],
      ["Packaging and arrival check", "[confirm protective packaging and what to do if an item arrives damaged]"],
    ];
  } else if (/\b(planter|wifi|wi-fi|app|garden|seed|led)\b/.test(text)) {
    items = [
      ["Compatibility", "[confirm Wi-Fi band, app language, phone OS, and account requirements]"],
      ["Power", "[confirm plug type, voltage, and cord length]"],
      ["Dimensions", "[confirm counter footprint and grow-light height]"],
      ["Included items", "[confirm seed pods, accessories, and replacement parts]"],
      ["Setup guidance", "[confirm router/app setup steps before first use]"],
    ];
  } else if (/\b(print|art|wall|frame|poster|canvas)\b/.test(text)) {
    items = [
      ["Dimensions", "[confirm print size and visible image area]"],
      ["Material and finish", "[confirm paper/canvas material, matte/gloss finish, and color tone]"],
      ["Frame", "[confirm whether a frame, hanger, or mounting hardware is included]"],
      ["Room context", "[confirm lighting, scale, and visual mood guidance]"],
      ["Shipping format", "[confirm rolled, flat, or framed shipping format]"],
    ];
  } else {
    items = [
      ["Dimensions or size", "[confirm product dimensions, weight, and size guidance]"],
      ["Materials or components", "[confirm materials, included parts, and replacement components]"],
      ["Compatibility or setup", "[confirm requirements, supported use cases, and setup steps]"],
      ["Care or maintenance", "[confirm cleaning, storage, and maintenance guidance]"],
      ["Use limits", "[confirm safety limits, product boundaries, and expectation-setting details]"],
    ];
  }

  const issueItem = buildIssueSpecificSpecItem(context);
  if (issueItem) items.splice(Math.min(3, items.length), 0, issueItem);
  const variantItem = buildVariantSpecificSpecItem(context);
  if (variantItem) items.push(variantItem);
  return dedupeSpecItems(items).slice(0, 8).map(([label, detail]) => ({ label, detail }));
}

function buildIssueSpecificSpecItem(context = {}) {
  const text = context.normalizedText || "";
  if (/\b(condensation|humidity|wet|water ring|nightstand|surface)\b/.test(text)) {
    return ["Moisture guidance", "[confirm expected condensation, clearance, and safe surface requirements]"];
  }
  if (/\b(clock|timer|alarm|schedule|early|late|drift|firmware)\b/.test(text)) {
    return ["Timing accuracy", "[confirm timer tolerance, firmware/reset steps, and alarm fallback behavior]"];
  }
  if (/\b(leak|seal|drip|spill)\b/.test(text)) {
    return ["Leak or seal limit", "[confirm exact leakproof/splash-resistant claim and testing conditions]"];
  }
  if (/\b(odor|smell|chemical|air out|airing)\b/.test(text)) {
    return ["First-use airing", "[confirm expected odor, airing time, and when a customer should contact support]"];
  }
  if (/\b(wobble|unstable|tilt|sliding|deflat|air loss)\b/.test(text)) {
    return ["Stability test", "[confirm stability standard, safe weight, and pressure-loss tolerance]"];
  }
  if (/\b(privacy|qr|location|gps|tracking)\b/.test(text)) {
    return ["Privacy and tracking limits", "[confirm visible profile fields, update source, and non-GPS limitations]"];
  }
  if (/\b(voice|false open|lockout|battery drain)\b/.test(text)) {
    return ["Voice-lock safeguards", "[confirm false-open protections, lockout/reset flow, and battery-drain expectations]"];
  }
  return null;
}

function buildVariantSpecificSpecItem(context = {}) {
  if (!context.variantLabels?.length) return null;
  return [
    "Variant-specific details",
    `[confirm whether ${context.variantLabels.join(", ")} differ in specs, setup, finish, capacity, care, or limitations]`,
  ];
}

function dedupeSpecItems(items = []) {
  return uniqueBy(
    items.filter((item) => Array.isArray(item) && item[0] && item[1]),
    (item) => normalizeText(item[0]),
  );
}

function buildProductClassificationDraft({ product = {}, mainIssue = "" } = {}) {
  const title = String(product.title || "").trim();
  const categories = detectProductCategoryGroups([
    title,
    product.description,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
  ].join(" "));
  const [category] = [...categories];
  const draftProductType = product.productType || getProductTypeFromCategory(category, mainIssue);
  return {
    draftVendor: product.vendor || "",
    draftProductType: draftProductType || "",
    draftCategory: category || "",
  };
}

function getProductTypeFromCategory(category = "", mainIssue = "") {
  if (category === "apparel") return "Apparel";
  if (category === "toy") return "Toys & Games";
  if (category === "art") return "Art & Decor";
  if (category === "electronics") return "Electronics";
  if (category === "beauty") return "Beauty";
  if (category === "home") return "Home";
  if (category === "food") return "Food & Beverage";
  const issue = normalizeIssueCode(mainIssue);
  if (issue === "fit_sizing") return "Apparel";
  if (issue === "compatibility") return "Electronics";
  return "";
}

function buildStructuredMetafieldRecommendations({ deterministic = {}, mainIssue = "" } = {}) {
  const metrics = deterministic.metrics || {};
  const issue = normalizeIssueCode(mainIssue || deterministic.mainIssue);
  const riskLevel = Number(deterministic.riskScore || 0) >= 75 ? "high" : Number(deterministic.riskScore || 0) >= 55 ? "medium" : "low";
  return [
    {
      namespace: "productpulse",
      key: "risk_level",
      type: "single_line_text_field",
      value: riskLevel,
    },
    {
      namespace: "productpulse",
      key: "main_issue",
      type: "single_line_text_field",
      value: issue || "none",
    },
    {
      namespace: "productpulse",
      key: "diagnosis_summary",
      type: "json",
      value: JSON.stringify({
        riskScore: deterministic.riskScore || 0,
        confidence: deterministic.confidence || 0,
        returnRate: metrics.returnRate || 0,
        refundRate: metrics.refundRate || 0,
        issue,
      }),
    },
  ];
}

function getRecommendedWorkflowTags({ mainIssue, deterministic = {} } = {}) {
  const issue = normalizeIssueCode(mainIssue);
  const metrics = deterministic.metrics || {};
  const tags = [];
  if (issue === "quality_defect" || issue === "durability") tags.push("qa-review-needed");
  if (issue === "safety_concern") tags.push("safety-review-needed");
  if (metrics.seoTitleNeedsReview || metrics.metaDescriptionNeedsReview || metrics.handleNeedsReview) tags.push("seo-fix-needed");
  if (Number(metrics.productMomentumScore || metrics.productMomentum?.score || 0) >= 70) tags.push("watchlist-candidate");
  if (metrics.classificationNeedsReview) tags.push("catalog-classification-review");
  return uniqueBy(tags, normalizeText);
}

function truncateSentence(value = "", maxLength = 155) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength + 1);
  const sentence = clipped.replace(/\s+\S*$/, "").replace(/[,:;.-]+$/, "");
  return `${sentence || clipped.slice(0, maxLength).trim()}...`;
}

function normalizeSuggestedTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function getRecommendationCauseKey({ issue = "", text = "", deterministic = {} }) {
  const metrics = deterministic.metrics || {};
  const reasons = [
    ...(Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : []),
    ...(Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails.map((item) => item.label || item.reason || "") : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues.map((item) => item.code || item.label || "") : []),
  ];
  const base = [
    issue,
    reasons.slice(0, 3).join(" "),
    text,
  ].join(" ");
  return normalizeText(base).split(/\s+/).slice(0, 18).join("-");
}

function buildMediaAltTextUpdates({ deterministic = {}, snapshot = {}, mediaGuidance = "", suggestedTitle = "" }) {
  const media = Array.isArray(deterministic.product?.media) ? deterministic.product.media : [];
  const missingAltMedia = media
    .filter((item) => item?.id && !String(item.alt || "").trim())
    .slice(0, 4);
  if (!missingAltMedia.length) return [];

  return missingAltMedia.map((item, index) => ({
    id: item.id,
    targetLabel: index === 0 ? "Primary product media" : `Product media ${index + 1}`,
    currentAltText: String(item.alt || ""),
    suggestedAltText: buildSuggestedMediaAltText({
      title: getBestMediaAltTitle({ deterministic, snapshot, suggestedTitle }),
      issue: deterministic.mainIssue,
      guidance: mediaGuidance || buildMediaGuidance(deterministic),
      media: item,
    }),
    mediaContentType: item.mediaContentType || item.type || "IMAGE",
    width: item.width || null,
    height: item.height || null,
  }));
}

function getBestMediaAltTitle({ deterministic = {}, snapshot = {}, suggestedTitle = "" }) {
  const currentTitle = String(deterministic.product?.title || snapshot.productTitle || snapshot.title || "").replace(/\s+/g, " ").trim();
  const aiTitle = String(suggestedTitle || "").replace(/\s+/g, " ").trim();
  if (aiTitle && (!currentTitle || isGenericProductTitle(currentTitle))) return aiTitle;
  return currentTitle || aiTitle || "Product";
}

function buildSuggestedMediaAltText({ title = "", issue = "", guidance = "", media = {} }) {
  const productTitle = String(title || "Product").replace(/\s+/g, " ").trim();
  const issueLabel = getHumanIssueLabel(issue).toLowerCase();
  const dimensions = media.width && media.height ? ` (${media.width}x${media.height})` : "";
  const focus = normalizeDraftParagraph(guidance)
    .replace(/^review product media and\s*/i, "")
    .replace(/^add product media that\s*/i, "")
    .replace(/\.$/, "");
  const suffix = focus && focus.length < 120
    ? `, highlighting ${focus.toLowerCase()}`
    : `, with visual context for ${issueLabel || "buyer expectations"}`;
  return `${productTitle} product image${dimensions}${suffix}.`.replace(/\s+/g, " ").slice(0, 250);
}

function buildRecommendedImageBrief(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  if (Number(metrics.mediaCount || 0) === 0) {
    return "Add at least one clear product image that shows the product, scale, material, color and what is included in the purchase.";
  }
  if (deterministic.mainIssue === "color_expectation") {
    return "Add or move forward an image that shows the product color in neutral lighting, including a close-up material or finish view if available.";
  }
  if (Number(metrics.mediaWithoutAltCount || 0) > 0) {
    return "Keep the current image order, but add descriptive alt text to media without alt text so product context is explicit.";
  }
  return "Review whether the first product image clearly shows scale, format, material and what the shopper receives.";
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
      id: "metafield-html",
      label: "Save FAQ metafield",
      target: "Product metafield",
      operation: "Save HTML metafield",
    },
  ];
}

function buildFinalIssues({ deterministic, ai, mainIssue, recommendations }) {
  const clusters = Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length
    ? ai.classification.clusters
    : buildFallbackClusters(deterministic, mainIssue);
  const firstAction = recommendations[0]?.label || "Review product signals";
  const contentIssues = deterministic.metrics.contentAnalysis?.issues || [];
  const sourceMismatchSignals = getSourceMismatchSignals(deterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, sourceMismatchSignals);
  const granularTextIssues = buildGranularTextIssues({ deterministic, ai, recommendations });
  let mappedIssues = clusters.slice(0, 5).map((cluster, index) => {
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
      action: getIssueSuggestedActionLabel(issueCode, recommendations, recommendations[index]?.label || firstAction),
    };
  });

  if (sourceIntegrityMode) {
    mappedIssues = mappedIssues.filter((issue) => isSourceIntegrityIssueCode(issue.issueCode) || normalizeIssueCode(issue.issueCode) === "product_content");
    if (!mappedIssues.some((issue) => isSourceIntegrityIssueCode(issue.issueCode))) {
      mappedIssues.unshift(buildSourceIntegrityIssue(deterministic, recommendations, sourceMismatchSignals));
    }
  }

  granularTextIssues.forEach((issue) => {
    if (sourceIntegrityMode && !isSourceIntegrityIssueCode(issue.issueCode) && normalizeIssueCode(issue.issueCode) !== "product_content") return;
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
      action: getIssueSuggestedActionLabel("product_content", recommendations, "Update product description"),
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

function isSourceIntegrityIssueCode(value) {
  const issueCode = normalizeIssueCode(value);
  return issueCode === "review_feed_integrity" || issueCode === "source_integrity";
}

function buildSourceIntegrityIssue(deterministic, recommendations, sourceMismatchSignals = []) {
  const metrics = deterministic.metrics || {};
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ].filter((issue) => /\b(source integrity|review feed|feed mismatch|metadata mismatch|review mismatch|wrong product|wrong sku)\b/i.test(`${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`));
  const issueCode = "review_feed_integrity";
  const trend = getIssueTrend(deterministic, issueCode);
  const signals = Math.max(
    Number(metrics.negativeReviewCount || 0),
    sourceMismatchSignals.length,
    contentIssues.length,
    Number(deterministic.issueSignalCounts?.[issueCode] || 0),
    MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE,
  );

  return {
    issue: "Review feed mismatch",
    issueCode,
    severity: signals >= 6 ? "High" : "Medium",
    tone: signals >= 6 ? "red" : "orange",
    confidence: Math.max(50, Math.min(92, Number(deterministic.confidence || 70))),
    signals,
    sourceTypes: ["reviews", "source_integrity", "product_content"],
    evidence: [
      "Customer evidence appears to reference a different product, SKU, variant or feed item.",
      ...sourceMismatchSignals.slice(0, 3).map((value) => `Mismatch signal: "${truncateText(value, 160)}"`),
      ...contentIssues.slice(0, 2).map((issue) => issue.evidence || issue.detail || issue.label).filter(Boolean),
    ].filter(Boolean).slice(0, 5),
    trend,
    trendTone: "orange",
    action: getIssueSuggestedActionLabel(issueCode, recommendations, "Fix source/review mismatch"),
  };
}

function getIssueSuggestedActionLabel(issueCode, recommendations = [], fallback = "Review product signals") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  const preferredPatterns = getIssueActionPreferredPatterns(normalizedIssue);
  const avoidPatterns = [/seo|meta|handle|workflow tag|risk tag|watchlist|collection|monitoring|baseline|internal note/i];
  const preferred = findRecommendedActionLabel(recommendations, preferredPatterns, avoidPatterns);
  if (preferred) return preferred;

  if (["quality_defect", "product_quality", "product_content", "fit_sizing", "compatibility", "color_expectation", "subjective_negative_reaction"].includes(normalizedIssue)) {
    const customerFacing = findRecommendedActionLabel(
      recommendations,
      [/description|pdp|expectation|quality note|fit note|faq|spec|details/i],
      avoidPatterns,
    );
    if (customerFacing) return customerFacing;
  }

  return fallback;
}

function getIssueActionPreferredPatterns(issueCode) {
  if (isSourceIntegrityIssueCode(issueCode)) return [/source.*mismatch|source integrity|review feed integrity|feed mismatch/i];
  if (issueCode === "refund_impact" || issueCode === "shipping_delivery") return [/supplier|qa|refund impact|description|quality note|packaging|shipping/i];
  if (issueCode === "fit_sizing") return [/fit note|fit faq|faq|description|spec/i];
  if (issueCode === "product_content") return [/description|spec|details|faq/i];
  if (issueCode === "quality_defect" || issueCode === "product_quality" || issueCode === "durability" || issueCode === "safety_concern") return [/supplier|qa|description|quality note|expectation|faq|spec/i];
  if (issueCode === "negative_sentiment") return [/sentiment evidence|description|quality note|expectation/i];
  if (issueCode === "repeated_language") return [/repeated language|description|quality note|expectation/i];
  return [/description|pdp|evidence/i];
}

function findRecommendedActionLabel(recommendations = [], preferredPatterns = [], avoidPatterns = []) {
  const candidates = (Array.isArray(recommendations) ? recommendations : []).filter((action) => {
    const text = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.shopifyField || ""}`.toLowerCase();
    if (!preferredPatterns.some((pattern) => pattern.test(text))) return false;
    return !avoidPatterns.some((pattern) => pattern.test(text));
  });
  return candidates[0]?.label || "";
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
  const aiHasMerchantFacingTextFindings = Boolean(
    aiFindings.length
    || aiRepeatedLanguage.length
    || aiEmergentSentiments.length
    || (Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length),
  );
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

  deterministicIssues.slice(0, aiHasMerchantFacingTextFindings ? 0 : 5).forEach((issue, index) => {
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
    .filter((item) => isActionableRepeatedLanguageIssue(item));
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

function buildFinalEvidence({ deterministic, ai, aiEvidenceSynthesisSections = [], judgeMeData, csvReviewData, shopifyData }) {
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
      weight: `${deterministic.metrics.windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS}-day order window`,
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
    const refundInsights = deterministic.metrics.refundInsights || {};
    const customerLanguageTotal = Number(textInsights.sentiment?.total || 0) + Number(refundInsights.sentiment?.total || 0);
    const customerLanguageNegative = Number(textInsights.sentiment?.negative || 0) + Number(refundInsights.sentiment?.negative || 0);
    const customerLanguageNeutral = Number(textInsights.sentiment?.neutral || 0) + Number(refundInsights.sentiment?.neutral || 0);
    const customerLanguagePositive = Number(textInsights.sentiment?.positive || 0) + Number(refundInsights.sentiment?.positive || 0);
    evidence.push({
      source: "Customer language analysis",
      quote: ai.classification?.sentiment_summary?.summary || `Dominant sentiment: ${textInsights.sentiment?.dominant || "neutral"}`,
      weight: `${customerLanguageTotal || 0} customer text signal${customerLanguageTotal === 1 ? "" : "s"} analyzed across reviews, returns and refund notes`,
      points: [
        customerLanguageTotal
          ? `${customerLanguageNegative} negative, ${customerLanguageNeutral} neutral, ${customerLanguagePositive} positive customer-language signals`
          : "",
        textInsights.returns?.sentiment?.total
          ? `Returns sentiment: ${textInsights.returns.sentiment.negative} negative, ${textInsights.returns.sentiment.neutral} neutral, ${textInsights.returns.sentiment.positive} positive`
          : "",
        textInsights.reviews?.sentiment?.total
          ? `Reviews sentiment: ${textInsights.reviews.sentiment.negative} negative, ${textInsights.reviews.sentiment.neutral} neutral, ${textInsights.reviews.sentiment.positive} positive`
          : "",
        refundInsights.sentiment?.total
          ? `Refund-note sentiment: ${refundInsights.sentiment.negative} negative, ${refundInsights.sentiment.neutral} neutral, ${refundInsights.sentiment.positive} positive`
          : "",
        refundInsights.noteCount
          ? `Refund-note patterns: ${refundInsights.noteCount} operational note${refundInsights.noteCount === 1 ? "" : "s"} analyzed as customer language`
          : "",
        refundInsights.reasonCount
          ? `Refund reason/context patterns: ${refundInsights.reasonCount} operational signal${refundInsights.reasonCount === 1 ? "" : "s"} analyzed as customer language`
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
        ...((refundInsights.repeatedLanguage || []).slice(0, 4).map((item) => `Refund-note language: "${item.term}" repeated ${item.count} time${item.count === 1 ? "" : "s"}`)),
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

  const aiEvidence = buildAiEvidenceSynthesisEntry(ai, aiEvidenceSynthesisSections);
  if (aiEvidence) {
    evidence.unshift(aiEvidence);
  }

  return evidence.slice(0, 8);
}

function buildAiEvidenceSynthesisEntry(ai = {}, sections = []) {
  const summary = String(ai.report?.evidence_summary || "").trim();
  if (!summary && !sections.length) return null;
  return {
    source: "AI evidence synthesis",
    quote: summary,
    weight: "Generated from deterministic metrics and stored snippets.",
    points: sections.map((section) => ({
      section_key: section.sectionKey,
      source_key: section.sourceKey,
      source_title: section.sourceTitle,
      title: section.title,
      body: section.body,
    })),
  };
}

function normalizeAiEvidenceSynthesisSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((section, index) => normalizeAiEvidenceSynthesisSection(section, index))
    .filter(Boolean)
    .filter((section, index, allSections) => allSections.findIndex((item) => item.sectionKey === section.sectionKey && item.body === section.body) === index)
    .slice(0, 8);
}

function normalizeAiEvidenceSynthesisSection(section, index = 0) {
  if (typeof section === "string") {
    const [rawLabel, ...rest] = section.split(":");
    const body = (rest.length ? rest.join(":") : section).trim();
    if (!body) return null;
    const sectionKey = normalizeAiEvidenceSynthesisSectionKey(rest.length ? rawLabel : "");
    return {
      sectionKey,
      title: getAiEvidenceSynthesisSectionTitle(sectionKey, rest.length ? rawLabel : "", index),
      body,
    };
  }
  if (!section || typeof section !== "object") return null;
  const body = String(section.body || section.text || section.summary || section.detail || "").replace(/\s+/g, " ").trim();
  if (!body) return null;
  const rawKey = section.section_key || section.sectionKey || section.key || section.section || section.title || section.label || "";
  const sourceTitle = String(section.source_title || section.sourceTitle || section.provider_title || section.providerTitle || "").replace(/\s+/g, " ").trim();
  const sourceKey = normalizeAiEvidenceProviderKey(section.source_key || section.sourceKey || section.provider_key || section.providerKey || sourceTitle);
  const sectionKey = normalizeAiEvidenceSynthesisSectionKey(rawKey);
  return {
    sectionKey,
    sourceKey,
    sourceTitle,
    title: getAiEvidenceSynthesisSectionTitle(sectionKey, section.title || section.label || "", index),
    body,
  };
}

function normalizeAiEvidenceSynthesisSectionKey(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (normalized.includes("customer") || normalized.includes("language") || normalized.includes("review") || normalized.includes("sentiment")) return "customer_language";
  if (normalized.includes("refund") || normalized.includes("return") || normalized.includes("post_purchase") || normalized.includes("postpurchase")) return "post_purchase";
  if (normalized.includes("variant") || normalized.includes("sku") || normalized.includes("option")) return "variant_scope";
  if (normalized.includes("pdp") || normalized.includes("catalog") || normalized.includes("content") || normalized.includes("description") || normalized.includes("shopify_product")) return "pdp_catalog";
  if (normalized.includes("operational") || normalized.includes("risk") || normalized.includes("confidence") || normalized.includes("impact") || normalized.includes("exposure")) return "operational_interpretation";
  if (normalized.includes("cross") || normalized.includes("source")) return "cross_source";
  return "stored_synthesis";
}

function getAiEvidenceSynthesisSectionTitle(sectionKey = "", fallback = "", index = 0) {
  if (sectionKey === "cross_source") return "Cross-source reading";
  if (sectionKey === "customer_language") return "Customer language";
  if (sectionKey === "post_purchase") return "Refund and return evidence";
  if (sectionKey === "pdp_catalog") return "PDP and catalog context";
  if (sectionKey === "variant_scope") return "Variant scope";
  if (sectionKey === "operational_interpretation") return "Operational interpretation";
  const fallbackTitle = String(fallback || "").trim();
  return fallbackTitle || (index === 0 ? "Stored synthesis" : "Additional synthesis");
}

function normalizeAiEvidenceProviderKey(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("csv")) return "csv_reviews";
  if (normalized.includes("judge") || normalized.includes("judgeme")) return "judgeme_reviews";
  if (normalized.includes("chatme") || normalized.includes("chat_me")) return "chatme_reviews";
  if (normalized.includes("review")) return normalized;
  return normalized;
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
    const reviewEmotionText = formatReviewEvidenceEmotionCounts(textInsights, reviewInsights);
    entries[0].points = [
      `Review sentiment: ${reviewInsights.sentiment.negative} negative, ${reviewInsights.sentiment.neutral} neutral, ${reviewInsights.sentiment.positive} positive`,
      reviewEmotionText ? `Review emotions: ${reviewEmotionText}` : "",
      ...((reviewInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated review language: "${item.term}" (${item.count})`)),
      ...(entries[0].points || []),
    ].filter(Boolean);
  }

  return entries;
}

function formatReviewEvidenceEmotionCounts(textInsights = {}, reviewInsights = {}) {
  const sentiment = reviewInsights.sentiment || {};
  const sourceEmotions = Array.isArray(reviewInsights.emotions) ? reviewInsights.emotions : [];
  const aiKnownEmotions = Array.isArray(textInsights.aiKnownEmotions) ? textInsights.aiKnownEmotions : [];
  let rows = sourceEmotions;
  if (Number(sentiment.total || 0) && Number(sentiment.negative || 0) === 0 && Number(sentiment.positive || 0) > 0) {
    const positiveAiRows = aiKnownEmotions.filter((item) => getEmotionPolarity(normalizeEmotionCode(item.code || item.label)) === "positive");
    const nonNegativeRows = sourceEmotions.filter((item) => getEmotionPolarity(normalizeEmotionCode(item.code || item.label)) !== "negative");
    rows = positiveAiRows.length ? positiveAiRows : nonNegativeRows;
  }
  return formatEmotionCounts(rows);
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
      ? deterministic.metrics.windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS
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
    createdAt: toIso(product.createdAt),
    updatedAt: toIso(product.updatedAt || product.createdAt),
    description: cleanProductDescription(product),
    descriptionHtml: String(product.descriptionHtml || ""),
    seoTitle: String(product.seo?.title || ""),
    seoDescription: String(product.seo?.description || ""),
    templateSuffix: String(product.templateSuffix || ""),
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
    createdAt: null,
    updatedAt: null,
    description: "",
    descriptionHtml: "",
    seoTitle: metrics.seoTitle || "",
    seoDescription: metrics.seoDescription || "",
    templateSuffix: metrics.templateSuffix || "",
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
  const primaryReasons = [
    ...(Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : []),
    item.reasonLabel,
    item.reason,
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value));
  const restockReason = normalizeRefundReasonLabel(item.restockType);
  const reasons = primaryReasons.length
    ? primaryReasons
    : [restockReason].filter((value) => value && !isDefaultCustomerLanguageTerm(value));

  const uniqueReasons = uniqueBy(reasons, (value) => normalizeText(value));
  const compactReasons = uniqueReasons.filter((reason, index) => {
    const normalized = normalizeText(reason);
    return !uniqueReasons.some((otherReason, otherIndex) => {
      if (otherIndex === index) return false;
      const otherNormalized = normalizeText(otherReason);
      return otherNormalized.length > normalized.length && otherNormalized.includes(normalized);
    });
  });

  return compactReasons.join(" - ");
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

function filterReviewsByLookbackWindow(reviews = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const cutoff = Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return reviews.filter((review) => {
    if (!review?.createdAt) return true;
    const time = new Date(review.createdAt).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
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
  const reasonText = getRefundReasonText(item);
  const restockText = normalizeRefundReasonLabel(item?.restockType);
  const includeRestock = restockText && !normalizeText(reasonText).includes(normalizeText(restockText));
  return [
    getRefundNoteText(item),
    reasonText,
    includeRestock ? restockText : "",
  ].filter(Boolean).join(" - ");
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
  const empty = { reviewCount: 0, negativeReviewCount: 0, avgRating: 0, negativeReviewRate: 0, recentNegativeReviewCount: 0, recentNegativeReviewWindowDays: 30 };
  const stats = {
    judgeMe: { ...empty },
    csv: { ...empty },
    chatMe: { ...empty },
    total: { ...empty },
  };

  reviews.forEach((review) => {
    const sourceType = String(review.sourceType || "").toLowerCase();
    const key = sourceType.includes("csv") ? "csv" : sourceType.includes("chatme") || sourceType.includes("chat_me") ? "chatMe" : "judgeMe";
    addReviewToStats(stats[key], review);
    addReviewToStats(stats.total, review);
  });

  Object.keys(stats).forEach((key) => finalizeReviewStats(stats[key]));
  return stats;
}

function addReviewToStats(stats, review) {
  stats.reviewCount += 1;
  stats.ratingSum = Number(stats.ratingSum || 0) + Number(review.rating || 0);
  const negative = isNegativeReviewSignal(review);
  if (negative) stats.negativeReviewCount += 1;
  if (negative && isRecentDate(review.createdAt, 30)) stats.recentNegativeReviewCount += 1;
}

function finalizeReviewStats(stats) {
  stats.avgRating = roundRate(stats.reviewCount ? Number(stats.ratingSum || 0) / stats.reviewCount : 0, 1);
  stats.negativeReviewRate = roundRate(stats.reviewCount ? (stats.negativeReviewCount / stats.reviewCount) * 100 : 0);
  delete stats.ratingSum;
  return stats;
}

function buildDiagnosisVariantInsights({ product = {}, sales = [], returns = [], refunds = [], reviews = [] } = {}) {
  const rows = new Map();
  const order = [];
  const productVariants = Array.isArray(product.variants) ? product.variants : [];

  const ensureRow = (variant = {}, source = "shopify") => {
    const normalized = normalizeDiagnosisVariantInsightIdentity(variant);
    if (!normalized.key) return null;
    if (!rows.has(normalized.key)) {
      rows.set(normalized.key, {
        key: normalized.key,
        variantId: normalized.id,
        variantTitle: normalized.title,
        sku: normalized.sku,
        price: normalized.price,
        selectedOptions: normalized.selectedOptions,
        source,
        sales: { units: 0, amount: 0, examples: [] },
        returns: { units: 0, reasons: [], examples: [] },
        refunds: { units: 0, amount: 0, reasons: [], examples: [] },
        reviews: { count: 0, negativeCount: 0, positiveCount: 0, neutralCount: 0, averageRating: 0, ratingSum: 0, sources: {}, examples: [] },
      });
      order.push(normalized.key);
    }
    const row = rows.get(normalized.key);
    row.variantId ||= normalized.id;
    row.variantTitle ||= normalized.title;
    row.sku ||= normalized.sku;
    row.price ||= normalized.price;
    if (!row.selectedOptions?.length && normalized.selectedOptions.length) row.selectedOptions = normalized.selectedOptions;
    return row;
  };

  productVariants.forEach((variant) => ensureRow(variant, "shopify"));

  sales.forEach((event) => {
    const row = ensureRow(event, "sales");
    if (!row) return;
    const quantity = Number(event.quantity || 0);
    const amount = Number(event.amount || 0);
    row.sales.units += quantity;
    row.sales.amount += amount;
    if (row.sales.examples.length < 3) {
      row.sales.examples.push({
        quantity,
        amount: roundCurrency(amount),
        createdAt: event.createdAt || null,
      });
    }
  });

  returns.forEach((event) => {
    const row = ensureRow(event, "returns");
    if (!row) return;
    const quantity = Math.max(1, Number(event.quantity || 1));
    const reason = [event.reason, event.reasonNote, event.customerNote].filter(Boolean).join(" - ");
    row.returns.units += quantity;
    if (reason) row.returns.reasons.push(reason);
    if (row.returns.examples.length < 3) {
      row.returns.examples.push({
        quantity,
        reason: event.reason || "",
        reasonText: getReturnCustomerLanguageText(event) || reason,
        text: getReturnCustomerLanguageText(event) || reason,
        sentiment: classifyCustomerSentiment(getReturnCustomerLanguageText(event) || reason),
        createdAt: event.createdAt || null,
        variant: row.variantTitle,
        variantId: row.variantId,
        sku: row.sku,
      });
    }
  });

  refunds.forEach((event) => {
    const row = ensureRow(event, "refunds");
    if (!row) return;
    const quantity = Math.max(1, Number(event.quantity || 1));
    const amount = Number(event.amount || 0);
    const reason = getRefundOperationalText(event) || getRefundReasonText(event) || event.reasonLabel || event.reason || "";
    row.refunds.units += quantity;
    row.refunds.amount += amount;
    if (reason) row.refunds.reasons.push(reason);
    if (row.refunds.examples.length < 3) {
      row.refunds.examples.push({
        quantity,
        amount: roundCurrency(amount),
        reason: event.reasonLabel || event.reason || event.restockType || "",
        reasonText: reason,
        text: getRefundOperationalText(event) || event.note || reason,
        noteText: event.note || "",
        sentiment: classifyCustomerSentiment(getRefundOperationalText(event) || event.note || reason),
        createdAt: event.createdAt || event.processedAt || null,
        variant: row.variantTitle,
        variantId: row.variantId,
        sku: row.sku,
      });
    }
  });

  reviews.forEach((review) => {
    const row = matchReviewToDiagnosisVariantInsight(review, rows, productVariants);
    if (!row) return;
    const rating = Number(review.rating || 0);
    const text = [review.title, review.body].filter(Boolean).join(" - ");
    const sentiment = classifyCustomerSentiment(text, rating);
    const negative = isNegativeReviewSignal(review);
    const positive = !negative && (sentiment === "positive" || rating >= 4);
    row.reviews.count += 1;
    row.reviews.ratingSum += rating;
    if (negative) row.reviews.negativeCount += 1;
    else if (positive) row.reviews.positiveCount += 1;
    else row.reviews.neutralCount += 1;
    const sourceLabel = review.sourceLabel || "Reviews";
    row.reviews.sources[sourceLabel] = (row.reviews.sources[sourceLabel] || 0) + 1;
    const storedNegativeExamples = row.reviews.examples.filter((example) => example.sentiment === "negative").length;
    const storedPositiveExamples = row.reviews.examples.filter((example) => example.sentiment === "positive").length;
    const storedNeutralExamples = row.reviews.examples.filter((example) => example.sentiment === "neutral").length;
    const shouldStoreExample = row.reviews.examples.length < 4 && (
      (negative && storedNegativeExamples < 2)
      || (positive && storedPositiveExamples < 2)
      || (!negative && !positive && storedNeutralExamples < 1)
      || row.reviews.examples.length < 1
    );
    if (shouldStoreExample) {
      row.reviews.examples.push({
        title: review.title || "",
        text: truncateText(text || review.body || "", 180),
        rating,
        sentiment,
        source: review.sourceType || "",
        sourceLabel,
        createdAt: review.createdAt || null,
        variant: row.variantTitle,
        variantId: row.variantId,
        sku: row.sku,
      });
    }
  });

  return order
    .map((key) => finalizeDiagnosisVariantInsight(rows.get(key)))
    .filter((row) => row.variantTitle || row.sku || row.variantId)
    .slice(0, 80);
}

function finalizeDiagnosisVariantInsight(row = {}) {
  const soldUnits = Number(row.sales?.units || 0);
  const returnUnits = Number(row.returns?.units || 0);
  const refundUnits = Number(row.refunds?.units || 0);
  const reviewCount = Number(row.reviews?.count || 0);
  const negativeReviewCount = Number(row.reviews?.negativeCount || 0);
  const signalCount = returnUnits + refundUnits + negativeReviewCount;
  const reviewSources = Object.entries(row.reviews?.sources || {}).map(([label, count]) => ({ label, count }));
  return {
    key: row.key,
    variantId: row.variantId || null,
    variantTitle: row.variantTitle || row.sku || "Variant",
    sku: row.sku || "",
    price: row.price || null,
    selectedOptions: row.selectedOptions || [],
    sales: {
      units: soldUnits,
      amount: roundCurrency(row.sales?.amount || 0),
      examples: row.sales?.examples || [],
    },
    returns: {
      units: returnUnits,
      rate: calculateUnitRatePercent(returnUnits, soldUnits),
      topReasons: countTopValues(row.returns?.reasons || [], 3),
      examples: row.returns?.examples || [],
    },
    refunds: {
      units: refundUnits,
      amount: roundCurrency(row.refunds?.amount || 0),
      rate: calculateUnitRatePercent(refundUnits, soldUnits),
      topReasons: countTopValues(row.refunds?.reasons || [], 3),
      examples: row.refunds?.examples || [],
    },
    reviews: {
      count: reviewCount,
      negativeCount: negativeReviewCount,
      positiveCount: Number(row.reviews?.positiveCount || 0),
      neutralCount: Number(row.reviews?.neutralCount || 0),
      negativeRate: roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0),
      averageRating: roundRate(reviewCount ? Number(row.reviews?.ratingSum || 0) / reviewCount : 0, 1),
      sources: reviewSources,
      examples: row.reviews?.examples || [],
    },
    signalCount,
    hasVariantEvidence: Boolean(soldUnits || signalCount || reviewCount),
  };
}

function buildAffectedVariantDetailsFromInsights(variantInsights = []) {
  const rows = (Array.isArray(variantInsights) ? variantInsights : [])
    .map((item) => ({
      label: item.variantTitle || item.sku || "",
      count: Number(item.signalCount || 0),
      returnUnits: Number(item.returns?.units || 0),
      refundUnits: Number(item.refunds?.units || 0),
      negativeReviewCount: Number(item.reviews?.negativeCount || 0),
      detail: [
        Number(item.returns?.units || 0) ? `${item.returns.units} return unit${Number(item.returns.units) === 1 ? "" : "s"}` : "",
        Number(item.refunds?.units || 0) ? `${item.refunds.units} refunded unit${Number(item.refunds.units) === 1 ? "" : "s"}` : "",
        Number(item.reviews?.negativeCount || 0) ? `${item.reviews.negativeCount} negative review${Number(item.reviews.negativeCount) === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · "),
    }))
    .filter((item) => item.label && item.count > 0)
    .sort((first, second) => second.count - first.count)
    .slice(0, 4);
  return rows.length ? rows : null;
}

function normalizeDiagnosisVariantInsightIdentity(value = {}) {
  const selectedOptions = normalizeDiagnosisVariantSelectedOptions(value.selectedOptions || value.options);
  const optionLabel = selectedOptions.map((option) => option.value || option.name).filter(Boolean).join(" / ");
  const rawTitle = value.title || value.variantTitle || value.variant || value.variantName || value.label || "";
  const title = isGenericVariantTitle(rawTitle) ? optionLabel || rawTitle : rawTitle || optionLabel;
  const sku = String(value.sku || value.variantSku || "").trim();
  const id = value.variantId || value.id || null;
  const keyId = value.variantId || (/productvariant/i.test(String(value.id || "")) ? value.id : "");
  const key = normalizeDiagnosisVariantKey(keyId)
    || normalizeDiagnosisVariantKey(sku)
    || normalizeDiagnosisVariantKey(title)
    || normalizeDiagnosisVariantKey(optionLabel);
  return {
    key,
    id,
    title: title || sku || "Variant",
    sku,
    price: value.price || value.unitPrice || value.amount || null,
    selectedOptions,
  };
}

function normalizeDiagnosisVariantSelectedOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions.map((option) => (
      typeof option === "string"
        ? { name: "", value: option }
        : { name: option.name || option.label || "", value: option.value || option.name || option.label || "" }
    )).filter((option) => option.value || option.name);
  }
  if (rawOptions && typeof rawOptions === "object") {
    return Object.entries(rawOptions).map(([name, value]) => ({ name, value: String(value || "") })).filter((option) => option.value);
  }
  return [];
}

function normalizeDiagnosisVariantKey(value = "") {
  return normalizeText(String(value || "").replace(/^gid:\/\/shopify\/productvariant\//i, "")).trim();
}

function matchReviewToDiagnosisVariantInsight(review = {}, rows = new Map(), productVariants = []) {
  const direct = normalizeDiagnosisVariantInsightIdentity(review);
  if (direct.key && rows.has(direct.key) && (review.variantId || review.variantTitle || review.variant || review.sku)) return rows.get(direct.key);
  const text = normalizeText([review.title, review.body].filter(Boolean).join(" "));
  if (!text) return null;
  const candidates = Array.from(rows.values());
  const matched = candidates.find((row) => diagnosisReviewMentionsVariant(text, row))
    || productVariants.map((variant) => normalizeDiagnosisVariantInsightIdentity(variant)).find((variant) => diagnosisReviewMentionsVariant(text, variant));
  if (!matched) return null;
  return rows.get(matched.key) || null;
}

function diagnosisReviewMentionsVariant(normalizedText, variant = {}) {
  return getDiagnosisVariantReviewTerms(variant).some((term) => containsNormalizedPhrase(normalizedText, term));
}

function getDiagnosisVariantReviewTerms(variant = {}) {
  const selectedOptions = normalizeDiagnosisVariantSelectedOptions(variant.selectedOptions);
  const values = [
    variant.sku,
    variant.variantTitle,
    variant.title,
    variant.variant,
    variant.variantName,
    ...(selectedOptions || []).map((option) => option.value),
  ];
  return [...new Set(values
    .map((value) => normalizeText(value))
    .filter((value) => value && value !== "default title" && value !== "default variant" && value.length >= 3))];
}

function isNegativeReviewSignal(review = {}) {
  const rating = Number(review.rating || 0);
  const text = [review.title, review.body].filter(Boolean).join(" ");
  return isNegativeReviewTextSignal({
    rating,
    sentiment: classifyCustomerSentiment(text, rating),
    subjectiveNegative: isSubjectiveNegativeText(text),
    text,
  });
}

function isNegativeReviewTextSignal({ rating = 0, sentiment = "", subjectiveNegative = false, text = "" } = {}) {
  const normalizedSentiment = String(sentiment || "").toLowerCase();
  if (Number(rating || 0) > 0 && Number(rating || 0) <= 2) return true;
  if (Number(rating || 0) >= 4) {
    return normalizedSentiment === "negative" && containsExplicitCustomerProblemLanguage(text);
  }
  return Boolean(
    normalizedSentiment === "negative"
    || subjectiveNegative
    || containsExplicitCustomerProblemLanguage(text)
  );
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
  return summarizeCustomerTextAnalysisItems(buildCustomerTextAnalysisItems({ returns, reviews }));
}

function buildCustomerTextAnalysisItems({ returns = [], reviews = [] }) {
  return {
    returnTexts: returns.map(buildReturnTextAnalysisItem).filter(Boolean),
    reviewTexts: reviews.map(buildReviewTextAnalysisItem).filter(Boolean),
  };
}

function buildReturnTextAnalysisItem(item = {}) {
  const reason = String(item.reason || "").trim();
  const noteText = [item.reasonNote, item.customerNote].filter(Boolean).join(" ");
  const isOther = isGenericOtherReason(reason);
  const analysisText = getReturnCustomerLanguageText(item);
  const text = analysisText || noteText;
  if (!analysisText.trim()) return null;
  const issueCode = classifyIssueText(analysisText);
  return {
    key: getReturnTextCacheKey(item),
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
    updatedAt: item.updatedAt || item.processedAt || item.createdAt,
    variant: item.variantTitle || item.sku || "",
    quantity: Number(item.quantity || 1),
    isOther,
  };
}

function buildReviewTextAnalysisItem(review = {}) {
  const text = [review.title, review.body].filter(Boolean).join(" - ");
  if (!text.trim()) return null;
  const rating = Number(review.rating || 0);
  const sentiment = classifyCustomerSentiment(text, rating);
  return {
    key: getReviewTextCacheKey(review),
    source: review.sourceType || "reviews",
    sourceLabel: review.sourceLabel || "Reviews",
    text,
    analysisText: text,
    rating,
    issueCode: classifyIssueText(text, { sentiment, rating }),
    sentiment,
    emotion: classifyCustomerEmotion(text, rating),
    subjectiveNegative: isSubjectiveNegativeText(text),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt || review.createdAt,
  };
}

function summarizeCustomerTextAnalysisItems({ returnTexts = [], reviewTexts = [] } = {}) {
  const allTexts = [...returnTexts, ...reviewTexts];
  const sentiment = summarizeSentiment(allTexts);
  const emotions = summarizeEmotionCounts(allTexts);
  const returnsSummary = summarizeTextSource(returnTexts);
  const reviewsSummary = {
    ...summarizeTextSource(reviewTexts),
    bySource: summarizeReviewTextSources(reviewTexts),
  };
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

function summarizeReviewTextSources(reviewTexts = []) {
  const groups = new Map();
  reviewTexts.forEach((item) => {
    const key = getReviewSourceGroupKey(item.source, item.sourceLabel);
    if (!key) return;
    const current = groups.get(key) || {
      key,
      source: item.source || "",
      sourceLabel: item.sourceLabel || getReviewSourceLabelForKey(key),
      items: [],
    };
    current.items.push(item);
    if (item.sourceLabel) current.sourceLabel = item.sourceLabel;
    groups.set(key, current);
  });

  return Array.from(groups.values()).reduce((acc, group) => {
    acc[group.key] = {
      ...summarizeTextSource(group.items),
      source: group.source,
      sourceLabel: group.sourceLabel,
    };
    return acc;
  }, {});
}

function getReviewSourceGroupKey(source = "", sourceLabel = "") {
  const normalized = `${source} ${sourceLabel}`.toLowerCase();
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("judge") || normalized.includes("judgeme")) return "judgeMe";
  if (normalized.includes("chatme") || normalized.includes("chat_me")) return "chatMe";
  if (normalized.includes("review")) return normalizeText(sourceLabel || source).replace(/[^a-z0-9]+/g, "_") || "reviews";
  return "";
}

function getReviewSourceLabelForKey(key = "") {
  if (key === "csv") return "CSV reviews";
  if (key === "judgeMe") return "Judge.me reviews";
  if (key === "chatMe") return "ChatMe reviews";
  return "Reviews";
}

function buildIncrementalCustomerTextInsights({ returns = [], reviews = [], previousCache = {}, cutoffAt = null, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const cutoff = parseValidDate(cutoffAt);
  const previousReturnItems = normalizeCachedAnalysisItems(previousCache.returnItems);
  const previousReviewItems = normalizeCachedAnalysisItems(previousCache.reviewItems);
  const returnCandidates = returns.map((item) => ({
    key: getReturnTextCacheKey(item),
    item,
    changedAt: item.updatedAt || item.processedAt || item.createdAt,
    hasText: Boolean(getReturnCustomerLanguageText(item).trim()),
  })).filter((candidate) => candidate.hasText);
  const reviewCandidates = reviews.map((item) => ({
    key: getReviewTextCacheKey(item),
    item,
    changedAt: item.updatedAt || item.createdAt,
    hasText: Boolean([item.title, item.body].filter(Boolean).join(" - ").trim()),
  })).filter((candidate) => candidate.hasText);
  if (cutoff && !returnCandidates.length && !reviewCandidates.length) {
    return {
      textInsights: summarizeCustomerTextAnalysisItems({ returnTexts: [], reviewTexts: [] }),
      cache: { returnItems: [], reviewItems: [] },
      mode: "incremental",
      analyzedItems: 0,
      reusedItems: 0,
      newReturnEvents: [],
      newReviewEvents: [],
      reason: "no_customer_text_in_window",
    };
  }
  const canUseIncremental = Boolean(cutoff && previousReturnItems.length + previousReviewItems.length > 0)
    && hasCachedCoverageForOldItems(returnCandidates, previousReturnItems, cutoff)
    && hasCachedCoverageForOldItems(reviewCandidates, previousReviewItems, cutoff);

  if (!canUseIncremental) {
    const fullItems = buildCustomerTextAnalysisItems({ returns, reviews });
    return {
      textInsights: summarizeCustomerTextAnalysisItems(fullItems),
      cache: {
        returnItems: trimAnalysisItemsForCache(filterAnalysisItemsByLookback(fullItems.returnTexts, windowDays)),
        reviewItems: trimAnalysisItemsForCache(filterAnalysisItemsByLookback(fullItems.reviewTexts, windowDays)),
      },
      mode: "full",
      analyzedItems: fullItems.returnTexts.length + fullItems.reviewTexts.length,
      reusedItems: 0,
      newReturnEvents: returns,
      newReviewEvents: reviews,
      reason: cutoff ? "previous_cache_missing_or_incomplete" : "no_previous_cutoff",
    };
  }

  const returnItemMap = new Map();
  filterAnalysisItemsByLookback(previousReturnItems, windowDays)
    .filter((item) => returnCandidates.some((candidate) => candidate.key === item.key))
    .forEach((item) => returnItemMap.set(item.key, item));
  const reviewItemMap = new Map();
  filterAnalysisItemsByLookback(previousReviewItems, windowDays)
    .filter((item) => reviewCandidates.some((candidate) => candidate.key === item.key))
    .forEach((item) => reviewItemMap.set(item.key, item));

  const newReturnEvents = returnCandidates
    .filter((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || !returnItemMap.has(candidate.key))
    .map((candidate) => candidate.item);
  const newReviewEvents = reviewCandidates
    .filter((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || !reviewItemMap.has(candidate.key))
    .map((candidate) => candidate.item);

  newReturnEvents.map(buildReturnTextAnalysisItem).filter(Boolean).forEach((item) => returnItemMap.set(item.key, item));
  newReviewEvents.map(buildReviewTextAnalysisItem).filter(Boolean).forEach((item) => reviewItemMap.set(item.key, item));

  const returnItems = Array.from(returnItemMap.values());
  const reviewItems = Array.from(reviewItemMap.values());
  return {
    textInsights: summarizeCustomerTextAnalysisItems({ returnTexts: returnItems, reviewTexts: reviewItems }),
    cache: {
      returnItems: trimAnalysisItemsForCache(returnItems),
      reviewItems: trimAnalysisItemsForCache(reviewItems),
    },
    mode: "incremental",
    analyzedItems: newReturnEvents.length + newReviewEvents.length,
    reusedItems: returnItems.length + reviewItems.length - newReturnEvents.length - newReviewEvents.length,
    newReturnEvents,
    newReviewEvents,
    reason: "previous_cache_reused",
  };
}

function buildRefundOperationalInsights({ refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0 }) {
  const refundTexts = refunds.map(buildRefundTextAnalysisItem).filter(Boolean);
  return summarizeRefundOperationalAnalysisItems({ refundTexts, refunds, refundRate, soldUnits, refundUnits, refundAmount });
}

function buildRefundTextAnalysisItem(item = {}) {
  const text = getRefundOperationalText(item);
  if (!text.trim()) return null;
  const noteText = getRefundNoteText(item);
  const reasonText = getRefundReasonText(item);
  return {
    key: getRefundTextCacheKey(item),
    source: "refunds",
    text,
    analysisText: text,
    issueCode: classifyIssueText(text),
    sentiment: classifyCustomerSentiment(text),
    emotion: classifyCustomerEmotion(text),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.processedAt || item.createdAt,
    variant: item.variantTitle || item.sku || "",
    quantity: Number(item.quantity || 1),
    amount: Number(item.amount || 0),
    restockType: item.restockType || "",
    noteText,
    reasonText,
    adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : [],
  };
}

function summarizeRefundOperationalAnalysisItems({ refundTexts = [], refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0 }) {
  const refundReasons = countTopValues(refunds
    .map(getRefundReasonText)
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value)), 5);
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

function buildIncrementalRefundOperationalInsights({ refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0, previousCache = {}, cutoffAt = null, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const cutoff = parseValidDate(cutoffAt);
  const previousItems = normalizeCachedAnalysisItems(previousCache.items);
  const candidates = refunds.map((item) => ({
    key: getRefundTextCacheKey(item),
    item,
    changedAt: item.updatedAt || item.processedAt || item.createdAt,
    hasText: Boolean(getRefundOperationalText(item).trim()),
  })).filter((candidate) => candidate.hasText);
  if (cutoff && !candidates.length) {
    return {
      refundInsights: summarizeRefundOperationalAnalysisItems({ refundTexts: [], refunds, refundRate, soldUnits, refundUnits, refundAmount }),
      cache: { items: [] },
      mode: "incremental",
      analyzedItems: 0,
      reusedItems: 0,
      newRefundEvents: [],
      reason: "no_refund_text_in_window",
    };
  }
  const canUseIncremental = Boolean(cutoff && previousItems.length)
    && hasCachedCoverageForOldItems(candidates, previousItems, cutoff);

  if (!canUseIncremental) {
    const items = refunds.map(buildRefundTextAnalysisItem).filter(Boolean);
    return {
      refundInsights: summarizeRefundOperationalAnalysisItems({ refundTexts: items, refunds, refundRate, soldUnits, refundUnits, refundAmount }),
      cache: { items: trimAnalysisItemsForCache(filterAnalysisItemsByLookback(items, windowDays)) },
      mode: "full",
      analyzedItems: items.length,
      reusedItems: 0,
      newRefundEvents: refunds,
      reason: cutoff ? "previous_cache_missing_or_incomplete" : "no_previous_cutoff",
    };
  }

  const itemMap = new Map();
  filterAnalysisItemsByLookback(previousItems, windowDays)
    .filter((item) => candidates.some((candidate) => candidate.key === item.key))
    .forEach((item) => itemMap.set(item.key, item));
  const newRefundEvents = candidates
    .filter((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || !itemMap.has(candidate.key))
    .map((candidate) => candidate.item);
  newRefundEvents.map(buildRefundTextAnalysisItem).filter(Boolean).forEach((item) => itemMap.set(item.key, item));
  const items = Array.from(itemMap.values());

  return {
    refundInsights: summarizeRefundOperationalAnalysisItems({ refundTexts: items, refunds, refundRate, soldUnits, refundUnits, refundAmount }),
    cache: { items: trimAnalysisItemsForCache(items) },
    mode: "incremental",
    analyzedItems: newRefundEvents.length,
    reusedItems: items.length - newRefundEvents.length,
    newRefundEvents,
    reason: "previous_cache_reused",
  };
}

function resolveProductContentAnalysisState({ product = {}, previousCache = {}, cutoffAt = null }) {
  const cutoff = parseValidDate(cutoffAt);
  const signature = buildProductContentSignature(product);
  const productUpdatedAt = toIso(product.updatedAt || product.createdAt);
  const cachedContent = previousCache?.deterministicContent;
  const cachedSignature = String(previousCache?.signature || "");
  const changed = Boolean(
    !cutoff
    || !cachedContent
    || cachedSignature !== signature
    || isChangedAfterCutoff(productUpdatedAt, cutoff),
  );

  if (!changed && cachedContent) {
    return {
      deterministicContent: cachedContent,
      signature,
      productUpdatedAt,
      cachedContentGaps: previousCache.contentGaps || null,
      reused: true,
      changed: false,
      reason: "product_content_unchanged_since_previous_diagnosis",
    };
  }

  return {
    deterministicContent: analyzeProductContentDeterministically(product),
    signature,
    productUpdatedAt,
    cachedContentGaps: null,
    reused: false,
    changed: true,
    reason: cutoff ? "product_content_changed_or_cache_missing" : "no_previous_cutoff",
  };
}

function buildProductContentSignature(product = {}) {
  const normalized = {
    title: normalizeText(product.title),
    handle: normalizeText(product.handle),
    description: normalizeText(stripHtml(product.description || product.descriptionHtml || "")),
    seoTitle: normalizeText(product.seoTitle),
    seoDescription: normalizeText(product.seoDescription),
    templateSuffix: normalizeText(product.templateSuffix),
    vendor: normalizeText(product.vendor),
    productType: normalizeText(product.productType),
    tags: (Array.isArray(product.tags) ? product.tags : []).map(normalizeText).sort(),
    collections: (Array.isArray(product.collections) ? product.collections : []).map(normalizeText).sort(),
    options: (Array.isArray(product.options) ? product.options : []).map((option) => ({
      name: normalizeText(option.name),
      values: (Array.isArray(option.values) ? option.values : []).map(normalizeText).sort(),
    })),
    variants: (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
      id: String(variant.id || ""),
      title: normalizeText(variant.title),
      sku: normalizeText(variant.sku),
      price: normalizeMoneyValue(variant.price),
      compareAtPrice: normalizeMoneyValue(variant.compareAtPrice),
      selectedOptions: (Array.isArray(variant.selectedOptions) ? variant.selectedOptions : []).map((option) => ({
        name: normalizeText(option.name),
        value: normalizeText(option.value),
      })),
    })),
    media: (Array.isArray(product.media) ? product.media : []).map((item) => ({
      id: String(item.id || ""),
      alt: normalizeText(item.alt),
      type: normalizeText(item.mediaContentType),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
    })),
  };
  return stableSignature(normalized);
}

function getOverallIncrementalMode({ productContentState, customerTextState, refundTextState, previousDetailedDiagnosisAt }) {
  if (!previousDetailedDiagnosisAt) return "full";
  const modes = [
    productContentState?.reused ? "incremental" : "full",
    customerTextState?.mode,
    refundTextState?.mode,
  ];
  return modes.every((mode) => mode === "incremental") ? "incremental" : "mixed";
}

function getIncrementalSourceFetchContext({ snapshot = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  const metrics = snapshot.metrics || {};
  const previousIncrementalCache = metrics.incrementalDiagnosis?.cache || {};
  const sourceEvents = previousIncrementalCache.sourceEvents || null;
  const normalizedWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const sourceEventFetchComplete = sourceEvents?.fetchComplete !== false;
  const cachedSourceThroughAt = sourceEvents?.fetchedThroughAt || (sourceEventFetchComplete ? sourceEvents?.cachedAt : null);
  const fallbackThroughAt = !sourceEvents || sourceEventFetchComplete
    ? metrics.lastNoChangeDiagnosisAt || metrics.lastDetailedDiagnosisAt || metrics.latestDiagnosisAt || null
    : null;
  const previousCompletedAt = cachedSourceThroughAt || fallbackThroughAt;
  const previousWindowDays = Number(sourceEvents?.windowDays || 0);
  const previousSourceEvents = normalizeSourceEventsCache(sourceEvents, normalizedWindowDays);
  const base = {
    shopifyCanReuse: false,
    reason: "source_event_cache_missing",
    previousCompletedAt: toIso(previousCompletedAt),
    previousWindowDays: previousWindowDays || null,
    sinceDate: getSinceDate(normalizedWindowDays),
    previousSourceEvents,
  };

  if (!previousCompletedAt) {
    return { ...base, reason: "previous_source_fetch_cutoff_missing" };
  }
  if (!sourceEvents || typeof sourceEvents !== "object") {
    return base;
  }
  if (Number(sourceEvents.schemaVersion || 0) !== SOURCE_EVENT_CACHE_SCHEMA_VERSION) {
    return { ...base, reason: "source_event_cache_schema_mismatch" };
  }
  if (!previousWindowDays || previousWindowDays < normalizedWindowDays) {
    return { ...base, reason: "source_event_cache_window_too_short" };
  }

  return {
    ...base,
    shopifyCanReuse: true,
    reason: "source_event_cache_available",
    sinceDate: buildIncrementalSinceDate(previousCompletedAt, normalizedWindowDays),
    previousSourceEvents,
  };
}

function buildIncrementalSinceDate(previousCompletedAt, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const lookbackStart = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000);
  const previousDate = parseValidDate(previousCompletedAt);
  const since = previousDate && previousDate.getTime() > lookbackStart.getTime() ? previousDate : lookbackStart;
  return since.toISOString().slice(0, 10);
}

function normalizeShopifySinceDate(sinceDate, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const parsed = parseValidDate(sinceDate);
  return parsed ? parsed.toISOString().slice(0, 10) : getSinceDate(windowDays);
}

function mergeIncrementalSourceEvents({ previous = {}, current = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  return {
    sales: mergeSourceEventList({ type: "sales", previous: previous.sales, current: current.sales, windowDays }),
    refunds: mergeSourceEventList({ type: "refunds", previous: previous.refunds, current: current.refunds, windowDays }),
    returns: mergeSourceEventList({ type: "returns", previous: previous.returns, current: current.returns, windowDays }),
  };
}

function mergeSourceEventList({ type, previous = [], current = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  const map = new Map();
  normalizeSourceEventList(previous, type, windowDays).forEach((item) => {
    map.set(getSourceEventCacheKey(type, item), item);
  });
  normalizeSourceEventList(current, type, windowDays).forEach((item) => {
    map.set(getSourceEventCacheKey(type, item), item);
  });
  return limitSourceEventCacheItems(sortSourceEvents(Array.from(map.values())));
}

function buildSourceEventCache({ sales = [], refunds = [], returns = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sourceEventFetch = null } = {}) {
  const cachedAt = new Date().toISOString();
  const fetchComplete = sourceEventFetch?.fetchComplete !== false;
  return {
    schemaVersion: SOURCE_EVENT_CACHE_SCHEMA_VERSION,
    windowDays: Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)),
    cachedAt,
    fetchedThroughAt: fetchComplete ? sourceEventFetch?.fetchedThroughAt || cachedAt : sourceEventFetch?.previousCompletedAt || null,
    fetchComplete,
    sales: normalizeSourceEventList(sales, "sales", windowDays),
    refunds: normalizeSourceEventList(refunds, "refunds", windowDays),
    returns: normalizeSourceEventList(returns, "returns", windowDays),
  };
}

function normalizeSourceEventsCache(cache = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  return {
    sales: normalizeSourceEventList(cache?.sales, "sales", windowDays),
    refunds: normalizeSourceEventList(cache?.refunds, "refunds", windowDays),
    returns: normalizeSourceEventList(cache?.returns, "returns", windowDays),
  };
}

function normalizeSourceEventList(items = [], type, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  return limitSourceEventCacheItems(sortSourceEvents(
    (Array.isArray(items) ? items : [])
      .map((item) => trimSourceEventForCache(item, type))
      .filter(Boolean)
      .filter((item) => isSourceEventInsideLookback(item, windowDays)),
  ));
}

function trimSourceEventForCache(item = {}, type) {
  if (!item || typeof item !== "object") return null;
  const cacheKey = getSourceEventCacheKey(type, item);
  if (!cacheKey) return null;
  const base = {
    cacheKey,
    id: item.id || null,
    orderId: item.orderId || null,
    createdAt: toIso(item.createdAt || item.processedAt || item.updatedAt),
    updatedAt: toIso(item.updatedAt || item.processedAt || item.createdAt),
    quantity: Number(item.quantity || 0),
    amount: Number(item.amount || 0),
    title: truncateText(item.title || "", 180),
    sku: String(item.sku || ""),
    variantId: item.variantId || null,
    variantTitle: truncateText(item.variantTitle || "", 160),
    selectedOptions: Array.isArray(item.selectedOptions) ? item.selectedOptions.slice(0, 12).map((option) => ({
      name: truncateText(option?.name || "", 80),
      value: truncateText(option?.value || "", 120),
    })) : [],
    geography: normalizeSalesEventGeography(item),
    country: item.country || item.geography?.country || "",
    countryCode: normalizeGeographyCode(item.countryCode || item.geography?.countryCode),
    province: item.province || item.geography?.province || "",
    provinceCode: normalizeGeographyCode(item.provinceCode || item.geography?.provinceCode),
    city: item.city || item.geography?.city || "",
  };

  if (type === "sales") return base;
  if (type === "returns") {
    return {
      ...base,
      returnId: item.returnId || null,
      status: item.status || "",
      processedQuantity: Number(item.processedQuantity || 0),
      refundedQuantity: Number(item.refundedQuantity || 0),
      reason: truncateText(item.reason || "", 180),
      reasonLabel: truncateText(item.reasonLabel || "", 180),
      reasonNote: truncateText(item.reasonNote || "", 600),
      customerNote: truncateText(item.customerNote || "", 600),
    };
  }
  if (type === "refunds") {
    return {
      ...base,
      refundId: item.refundId || null,
      processedAt: toIso(item.processedAt || item.createdAt),
      totalRefundedAmount: Number(item.totalRefundedAmount || 0),
      restockType: item.restockType || "",
      adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons.slice(0, 12).map(String) : [],
      reason: truncateText(item.reason || "", 220),
      reasonLabel: truncateText(item.reasonLabel || "", 220),
      note: truncateText(item.note || "", 800),
      fallbackSource: item.fallbackSource || "",
    };
  }
  return base;
}

function getSourceEventCacheKey(type, item = {}) {
  if (item.cacheKey) return String(item.cacheKey);
  if (type === "sales") {
    return stableEventCacheKey("sale", item, [item.id, item.orderId, item.variantId, item.sku, item.quantity, item.amount, item.createdAt]);
  }
  if (type === "returns") {
    return stableEventCacheKey("return-source", item, [item.id, item.returnId, item.orderId, item.variantId, item.sku, item.reason, item.reasonNote, item.customerNote, item.createdAt]);
  }
  if (type === "refunds") {
    return stableEventCacheKey("refund-source", item, [item.id, item.refundId, item.orderId, item.variantId, item.sku, item.reason, item.reasonLabel, item.note, item.restockType, item.createdAt]);
  }
  return stableEventCacheKey(String(type || "source"), item, [item.id, item.orderId, item.createdAt]);
}

function isSourceEventInsideLookback(item = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const date = getSourceEventDate(item);
  if (!date) return true;
  const cutoff = Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return date.getTime() >= cutoff;
}

function getSourceEventDate(item = {}) {
  return parseValidDate(item.createdAt || item.processedAt || item.updatedAt || item.date);
}

function sortSourceEvents(items = []) {
  return (Array.isArray(items) ? items : []).sort((left, right) => {
    const leftDate = getSourceEventDate(left)?.getTime() || 0;
    const rightDate = getSourceEventDate(right)?.getTime() || 0;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return getSourceEventCacheKey("source", left).localeCompare(getSourceEventCacheKey("source", right));
  });
}

function limitSourceEventCacheItems(items = []) {
  const normalized = Array.isArray(items) ? items : [];
  return normalized.length > MAX_SOURCE_EVENT_CACHE_ITEMS
    ? normalized.slice(normalized.length - MAX_SOURCE_EVENT_CACHE_ITEMS)
    : normalized;
}

function buildIncrementalSourceFetchSummary(source = null) {
  if (!source || typeof source !== "object") {
    return {
      mode: "full_window_fetch",
      reason: "source_fetch_state_missing",
      fetchComplete: true,
    };
  }
  return {
    mode: source.mode || (source.shopifyCanReuse ? "incremental_fetch" : "full_window_fetch"),
    reason: source.reason || null,
    sinceDate: source.sinceDate || null,
    previousCompletedAt: source.previousCompletedAt || null,
    previousWindowDays: source.previousWindowDays || null,
    fetchedThroughAt: source.fetchedThroughAt || null,
    rawFetchedCounts: source.rawFetchedCounts || null,
    mergedCounts: source.mergedCounts || null,
    fetchComplete: source.fetchComplete !== false,
  };
}

function buildIncrementalEvidenceSnippetInputs({ returns = [], refunds = [], negativeReviews = [], productContentState = {}, customerTextState = {}, refundTextState = {} }) {
  const incremental = customerTextState.mode === "incremental" || refundTextState.mode === "incremental" || productContentState.reused;
  if (!incremental) return { returns, refunds, reviews: negativeReviews };
  return {
    returns: customerTextState.newReturnEvents || [],
    refunds: refundTextState.newRefundEvents || [],
    reviews: customerTextState.newReviewEvents?.filter((review) => Number(review.rating || 0) <= 2 || containsIssueLanguage(review.body)) || [],
  };
}

function buildIssueSignalCountsFromAnalysis({ customerTextCache = {}, refundTextCache = {}, fallback = {} } = {}) {
  const counts = {};
  const customerItems = [
    ...(Array.isArray(customerTextCache.returnItems) ? customerTextCache.returnItems : []),
    ...(Array.isArray(customerTextCache.reviewItems) ? customerTextCache.reviewItems : []),
  ];
  customerItems.forEach((item) => {
    if (!shouldCountTextAnalysisItemAsIssueSignal(item)) return;
    const issue = normalizeIssueCode(item.issueCode) || classifyIssueText(item.analysisText || item.text || "");
    if (!issue) return;
    counts[issue] = (counts[issue] || 0) + Math.max(1, Number(item.quantity || 1));
  });
  const refundItems = Array.isArray(refundTextCache.items) ? refundTextCache.items : [];
  refundItems.forEach((item) => {
    const issue = normalizeIssueCode(item.issueCode) || classifyIssueText(item.analysisText || item.text || "");
    const issueCode = issue === "product_quality" ? "refund_impact" : issue;
    if (!issueCode) return;
    counts[issueCode] = (counts[issueCode] || 0) + Math.max(1, Number(item.quantity || 1));
  });
  if (Object.keys(counts).length) return counts;
  return buildIssueSignalCounts(fallback);
}

function shouldCountTextAnalysisItemAsIssueSignal(item = {}) {
  const source = String(item.source || "").toLowerCase();
  if (source === "returns" || source === "shopify_return_note") return true;
  const rating = Number(item.rating || 0);
  const sentiment = String(item.sentiment || "").toLowerCase();
  const text = item.analysisText || item.text || "";
  return isNegativeReviewTextSignal({
    rating,
    sentiment,
    subjectiveNegative: item.subjectiveNegative,
    text,
  });
}

function normalizeCachedAnalysisItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === "object" && item.key)
    .map((item) => {
      const text = String(item.text || "");
      const analysisText = String(item.analysisText || item.text || "");
      const rating = Number(item.rating || 0);
      const currentSentiment = ["positive", "neutral", "negative"].includes(item.sentiment)
        ? item.sentiment
        : classifyCustomerSentiment(analysisText || text, rating);
      const sentiment = normalizeSentimentForPositiveRecovery(currentSentiment, analysisText || text, rating);
      const rawEmotion = normalizeEmotionCode(item.emotion) || classifyCustomerEmotion(analysisText || text, rating);
      const emotion = sentiment === "positive" && getEmotionPolarity(rawEmotion) === "negative"
        ? classifyCustomerEmotion(analysisText || text, Math.max(rating, 5))
        : rawEmotion;
      return {
        ...item,
        key: String(item.key),
        text,
        analysisText,
        issueCode: normalizeIssueCode(item.issueCode) || classifyIssueText(analysisText || text, { sentiment, rating }),
        sentiment,
        emotion: normalizeEmotionCode(emotion) || "none",
        subjectiveNegative: sentiment === "positive" ? false : Boolean(item.subjectiveNegative),
        createdAt: toIso(item.createdAt),
        updatedAt: toIso(item.updatedAt || item.createdAt),
      };
    });
}

function trimAnalysisItemsForCache(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    key: item.key,
    source: item.source,
    sourceLabel: item.sourceLabel,
    text: truncateText(item.text || item.analysisText || "", 900),
    analysisText: truncateText(item.analysisText || item.text || "", 900),
    reason: item.reason || "",
    noteText: truncateText(item.noteText || "", 500),
    reasonText: truncateText(item.reasonText || "", 500),
    rating: item.rating,
    issueCode: item.issueCode,
    sentiment: item.sentiment,
    emotion: item.emotion,
    subjectiveNegative: Boolean(item.subjectiveNegative),
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt || item.createdAt),
    variant: item.variant || "",
    quantity: Number(item.quantity || 1),
    amount: Number(item.amount || 0),
    restockType: item.restockType || "",
    adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons.slice(0, 8) : [],
    isOther: Boolean(item.isOther),
  }));
}

function filterAnalysisItemsByLookback(items = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const cutoff = Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const date = parseValidDate(item.createdAt || item.updatedAt);
    return !date || date.getTime() >= cutoff;
  });
}

function hasCachedCoverageForOldItems(candidates = [], cachedItems = [], cutoff) {
  const cachedKeys = new Set(cachedItems.map((item) => item.key).filter(Boolean));
  return candidates.every((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || cachedKeys.has(candidate.key));
}

function isChangedAfterCutoff(value, cutoff) {
  const date = parseValidDate(value);
  const cutoffDate = parseValidDate(cutoff);
  if (!date || !cutoffDate) return false;
  return date.getTime() > cutoffDate.getTime();
}

function getReturnTextCacheKey(item = {}) {
  return stableEventCacheKey("return", item, [item.id, item.returnId, item.orderId, item.variantId, item.reason, item.reasonNote, item.customerNote, item.createdAt]);
}

function getReviewTextCacheKey(review = {}) {
  return stableEventCacheKey(review.sourceType || "review", review, [review.id, review.sourceRow, review.productId, review.handle, review.rating, review.title, review.body, review.createdAt]);
}

function getRefundTextCacheKey(item = {}) {
  return stableEventCacheKey("refund", item, [item.id, item.refundId, item.orderId, item.variantId, item.reason, item.reasonLabel, item.note, item.restockType, item.createdAt]);
}

function buildDiagnosisSourceFingerprint({
  productContentSignature = "",
  sales = [],
  returns = [],
  refunds = [],
  judgeMeReviews = [],
  csvReviews = [],
  orderAccessDenied = false,
  sourceCoverage = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
} = {}) {
  return stableSignature({
    schemaVersion: 1,
    windowDays: Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS),
    orderAccessDenied: Boolean(orderAccessDenied),
    productContentSignature: String(productContentSignature || ""),
    sourceCoverage: (Array.isArray(sourceCoverage) ? sourceCoverage : []).map(String).sort(),
    sales: buildFingerprintEvents(sales, [
      "id",
      "orderId",
      "lineItemId",
      "variantId",
      "sku",
      "quantity",
      "amount",
      "countryCode",
      "provinceCode",
      "country",
      "province",
      "createdAt",
      "updatedAt",
    ]),
    returns: buildFingerprintEvents(returns, [
      "id",
      "returnId",
      "orderId",
      "lineItemId",
      "variantId",
      "sku",
      "reason",
      "reasonNote",
      "customerNote",
      "quantity",
      "amount",
      "createdAt",
      "updatedAt",
      "processedAt",
    ]),
    refunds: buildFingerprintEvents(refunds, [
      "id",
      "refundId",
      "orderId",
      "lineItemId",
      "variantId",
      "sku",
      "reason",
      "reasonLabel",
      "note",
      "restockType",
      "quantity",
      "amount",
      "createdAt",
      "updatedAt",
      "processedAt",
      "adjustmentReasons",
    ]),
    judgeMeReviews: buildFingerprintEvents(judgeMeReviews, [
      "id",
      "sourceRow",
      "productId",
      "handle",
      "rating",
      "title",
      "body",
      "createdAt",
      "updatedAt",
    ]),
    csvReviews: buildFingerprintEvents(csvReviews, [
      "id",
      "sourceRow",
      "productId",
      "handle",
      "rating",
      "title",
      "body",
      "createdAt",
      "updatedAt",
    ]),
  });
}

function buildFingerprintEvents(items = [], keys = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeFingerprintEvent(item, keys))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeFingerprintEvent(item = {}, keys = []) {
  const normalized = {};
  keys.forEach((key) => {
    const value = item[key];
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      normalized[key] = value.map((entry) => String(entry || "").trim()).filter(Boolean).sort();
    } else if (typeof value === "number") {
      normalized[key] = roundCurrency(value);
    } else {
      normalized[key] = String(value).trim();
    }
  });
  const key = stableSignature(normalized);
  return { key, ...normalized };
}

function stableEventCacheKey(prefix, item = {}, parts = []) {
  const explicit = parts.find((part) => part !== undefined && part !== null && String(part).trim());
  if (explicit && (String(explicit).startsWith("gid://") || String(explicit).includes(":") || String(explicit).length >= 8)) {
    return `${prefix}:${String(explicit)}`;
  }
  return `${prefix}:${stableSignature(parts.map((part) => String(part || "")).join("|") || JSON.stringify(item || {}))}`;
}

function stableSignature(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
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
    sentimentTrend: buildSentimentTrend(items),
    emotions,
    subjectiveNegativity: summarizeSubjectiveNegativity(items),
    repeatedLanguage: extractRepeatedLanguage(items).slice(0, 5),
    examples: uniqueBy(
      items
        .filter((item) => item.sentiment === "negative" || item.isOther)
        .filter((item) => item.text),
      (item) => normalizeText(item.text || item.noteText || ""),
    )
      .slice(0, 4)
      .map((item) => ({
        text: truncateText(item.text, 180),
        sentiment: item.sentiment,
        emotion: item.emotion,
        rating: item.rating,
        issueCode: item.issueCode,
        reason: item.reason || "",
        variant: item.variant || "",
        source: item.source || "",
        sourceLabel: item.sourceLabel || "",
        createdAt: toIso(item.createdAt),
      })),
  };
}

function buildSentimentTrend(items = []) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = parseValidDate(item.createdAt || item.updatedAt);
      const sentiment = ["positive", "neutral", "negative"].includes(item.sentiment) ? item.sentiment : "neutral";
      return date ? { date, sentiment } : null;
    })
    .filter(Boolean)
    .sort((first, second) => first.date.getTime() - second.date.getTime());
  if (!rows.length) return [];

  const firstDate = rows[0].date;
  const lastDate = rows[rows.length - 1].date;
  const spanDays = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));
  const bucketMode = spanDays > 120 ? "month" : spanDays > 28 ? "week" : "day";
  const buckets = new Map();

  rows.forEach((row) => {
    const key = getSentimentTrendBucketKey(row.date, bucketMode);
    const current = buckets.get(key) || {
      key,
      label: getSentimentTrendBucketLabel(row.date, bucketMode),
      date: row.date.toISOString(),
      positive: 0,
      neutral: 0,
      negative: 0,
      total: 0,
    };
    current[row.sentiment] += 1;
    current.total += 1;
    buckets.set(key, current);
  });

  return Array.from(buckets.values()).sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime());
}

function getSentimentTrendBucketKey(date, bucketMode = "month") {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (bucketMode === "day") return `${year}-${month}-${day}`;
  if (bucketMode === "week") {
    const weekStart = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    return `${weekStart.getUTCFullYear()}-${String(weekStart.getUTCMonth() + 1).padStart(2, "0")}-${String(weekStart.getUTCDate()).padStart(2, "0")}`;
  }
  return `${year}-${month}`;
}

function getSentimentTrendBucketLabel(date, bucketMode = "month") {
  if (bucketMode === "day") return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (bucketMode === "week") return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
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

function getScoreSentimentInputs(textInsights = {}, refundInsights = {}) {
  const customerSentiment = textInsights?.sentiment || {};
  const refundSentiment = refundInsights?.sentiment || {};
  return {
    total: Number(customerSentiment.total || 0) + Number(refundSentiment.total || 0),
    negative: Number(customerSentiment.negative || 0) + Number(refundSentiment.negative || 0),
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

  repeatedLanguage.filter(isActionableRepeatedLanguageIssue).slice(0, 3).forEach((item) => {
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

function maskResolvedNegativeCustomerLanguage(normalized) {
  return String(normalized || "")
    .replace(/\b(no|without|free from)\s+(chips?|damage|damaged|cracks?|cracked|breakage|broken|defects?|issues?|problems?)\b/g, " ")
    .replace(/\b(arrived safely|arrived intact|better packaging|better separators|packaging looked much better|problem is being handled|issue is being handled|handled well|resolved|fixed|improved|more confident)\b/g, " ");
}

function hasPositiveRecoveryCustomerLanguage(normalized) {
  return /\b(arrived safely|arrived intact|better packaging|better separators|packaging looked much better|no chips?|no damage|no cracks?|problem is being handled|issue is being handled|resolved|fixed|improved|more confident)\b/.test(normalized);
}

function hasUnresolvedNegativeCustomerLanguage(normalized) {
  return /\b(still broken|still cracked|still damaged|still missing|still a problem|still an issue|arrived broken|arrived damaged|arrived cracked|not fixed|not resolved|not improved|no improvement|continues? to|keeps? (breaking|leaking|failing)|doesn t work|doesnt work|not working|unusable|unsafe|dangerous|failed|leaks?|leaking)\b/.test(normalized);
}

function normalizeSentimentForPositiveRecovery(sentiment = "neutral", text = "", rating = 0) {
  const normalizedSentiment = normalizeAiSentiment(sentiment);
  const normalized = normalizeText(text);
  if (
    normalizedSentiment === "negative"
    && Number(rating || 0) >= 4
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
  ) return "positive";
  if (
    normalizedSentiment === "negative"
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
    && /\b(arrived safely|arrived intact|no chips?|no damage|no cracks?|more confident|reliable|handled)\b/.test(normalized)
  ) return "positive";
  return normalizedSentiment;
}

function classifyCustomerSentiment(text, rating = 0) {
  const normalized = normalizeText(text);
  const sentimentText = maskResolvedNegativeCustomerLanguage(normalized);
  const negativeMatches = countRegexMatches(sentimentText, /(bad|poor|cheap|thin|broken|defect|damage|damaged|disappointed|return|refund|small|large|tight|loose|wrong|issue|problem|unhappy|terrible|awful|not fit|doesn t fit|doesnt fit|not as pictured|late|scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/g);
  const positiveMatches = countRegexMatches(normalized, /(great|good|love|loved|perfect|excellent|happy|quality|comfortable|recommend|works well|beautiful)/g);
  const ratingNumber = Number(rating || 0);
  if (ratingNumber > 0 && ratingNumber <= 2) return "negative";
  if (ratingNumber === 3 && Math.abs(negativeMatches - positiveMatches) <= 1) return "neutral";
  if (
    ratingNumber >= 4
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
  ) return "positive";
  if (negativeMatches > positiveMatches) return "negative";
  if (ratingNumber >= 4 && positiveMatches >= negativeMatches) return "positive";
  if (positiveMatches > negativeMatches) return "positive";
  return "neutral";
}

function classifyCustomerEmotion(text, rating = 0) {
  const normalized = normalizeText(text);
  const ratingNumber = Number(rating || 0);
  if (
    ratingNumber >= 4
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
  ) {
    if (/\b(confident|confidence|reliable|trust|handled|being handled|resolved|fixed)\b/.test(normalized)) return "trust";
    return "relief";
  }
  const emotionText = maskResolvedNegativeCustomerLanguage(normalized);
  if (/(scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/.test(emotionText)) return "fear";
  if (/(angry|mad|furious|rage|annoyed|irritated|enojado|enojo|furioso|bronca)/.test(emotionText)) return "anger";
  if (/(confusing|confused|unclear|don t understand|doesnt understand|hard to use|no entiendo|confuso|confundido)/.test(emotionText)) return "confusion";
  if (/(disappointed|let down|not as expected|expected better|decepcion|decepcionado)/.test(emotionText)) return "disappointment";
  if (/(regret|waste|wish i hadn|shouldn t have|arrepent|arrepentido)/.test(emotionText)) return "regret";
  if (/(trust|fake|misleading|dishonest|not real|engaño|enganoso|desconf)/.test(emotionText)) return "distrust";
  if (/(frustrated|frustrating|problem|issue|return|refund|doesn t work|doesnt work|frustra|frustrante)/.test(emotionText)) return "frustration";
  if (/(not sure|maybe|uncertain|unsure|doubt|duda|incierto)/.test(emotionText)) return "uncertainty";
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

function isActionableRepeatedLanguageIssue(item = {}) {
  const normalized = normalizeText(item.term || item.label || item.phrase).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (!isUsefulRepeatedLanguageTerm(normalized)) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.every((token) => CUSTOMER_TEXT_POSITIVE_DESCRIPTOR_WORDS.has(token))) return false;
  const dominantSentiment = String(item.dominantSentiment || "").toLowerCase();
  const negativeCount = Number(item.sentiments?.negative || 0);
  if (dominantSentiment === "positive" && negativeCount === 0) return false;
  if (!hasRepeatedLanguageProblemCue(normalized) && negativeCount === 0) return false;
  return true;
}

function hasRepeatedLanguageProblemCue(value = "") {
  return /\b(too|not|missing|wrong|different|small|large|tight|loose|runs|leak|leaking|broken|break|broke|damaged|damage|cracked|chip|chipped|confusing|confusion|unclear|failed|failure|unsafe|scary|fear|frightening|creepy|heavy|wobbly|unstable|refund|returned|disappointed|poor|cheap|doesn|doesnt|didn|didnt|mismatch|mismatched|compatibility|incompatible|delayed|late|lost)\b/i.test(String(value || ""));
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

const CUSTOMER_TEXT_POSITIVE_DESCRIPTOR_WORDS = new Set([
  "accurate",
  "beautiful",
  "build",
  "clear",
  "complete",
  "comfortable",
  "cute",
  "excellent",
  "fast",
  "finished",
  "gift",
  "good",
  "great",
  "happy",
  "included",
  "includes",
  "listing",
  "love",
  "loved",
  "lovely",
  "matched",
  "matches",
  "matching",
  "nice",
  "perfect",
  "premium",
  "pretty",
  "quality",
  "recommend",
  "shipping",
  "solid",
  "satisfied",
  "satisfaction",
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

function classifyIssueText(text, context = {}) {
  const normalized = normalizeText(text);
  const sentiment = String(context.sentiment || "").toLowerCase();
  const rating = Number(context.rating || 0);
  const positiveContext = sentiment === "positive" || rating >= 4;
  const explicitIssue = containsIssueLanguage(normalized) || isObjectiveSafetyText(normalized) || isSubjectiveNegativeText(normalized);
  if (positiveContext && !explicitIssue) return "product_quality";
  if (/(too small|too large|doesn t fit|doesnt fit|does not fit|didn t fit|didnt fit|not fit|wrong size|runs small|runs large|fit issue|fit problem|sizing issue|tight|loose|waist|chest|shoulder|sleeve|length)/.test(normalized)
    || (!positiveContext && /(fit|size|sizing|small|large)/.test(normalized) && explicitIssue)) return "fit_sizing";
  if (isObjectiveSafetyText(normalized)) return "safety_concern";
  if (isSubjectiveNegativeText(normalized)) return "subjective_negative_reaction";
  if (/(wrong color|different color|not as pictured|not pictured|picture|pictured|photo|image|shade|looks different|looked different|color mismatch|colour mismatch)/.test(normalized)
    || (!positiveContext && /(color|colour)/.test(normalized) && explicitIssue)) return "color_expectation";
  if (/(break|broken|defect|defective|damage|damaged|poor quality|cheap|durability|leak|leaking|spill|spilled|crack|cracked|chip|chipped|tear|ripped|malfunction|failed|failure|rough|scratchy|stiff|thin material|bad material|bad fabric)/.test(normalized)
    || (!positiveContext && /(quality|soft|softness|material|fabric|texture|build)/.test(normalized) && explicitIssue)) return "quality_defect";
  if (/(not compatible|incompatible|compatibility issue|doesn t work with|doesnt work with|won t work with|wont work with|does not work with|fit with)/.test(normalized)) return "compatibility";
  if (/(late|delayed|lost package|lost shipment|shipping problem|delivery problem|arrived damaged|damaged in transit)/.test(normalized)
    || (!positiveContext && /(shipping|delivery|arrived)/.test(normalized) && explicitIssue)) return "shipping_delivery";
  return "product_quality";
}

function analyzeProductContentDeterministically(product) {
  const description = stripHtml(product.description || product.descriptionHtml || "").replace(/\s+/g, " ").trim();
  const descriptionWordCount = description ? description.split(/\s+/).filter(Boolean).length : 0;
  const normalizedDescription = normalizeText(description);
  const normalizedTitle = normalizeText(product.title);
  const productType = normalizeText(product.productType);
  const seoTitle = String(product.seoTitle || "").replace(/\s+/g, " ").trim();
  const seoDescription = String(product.seoDescription || "").replace(/\s+/g, " ").trim();
  const handle = String(product.handle || "").trim();
  const templateSuffix = String(product.templateSuffix || "").trim();
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
    advisories.push(buildContentAdvisory("title_description_mismatch", "Title and description need semantic review", "The local content check found weak title/description overlap. ProductPulse AI must confirm a clear mismatch before this becomes a product issue."));
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

  if (!seoTitle) {
    advisories.push(buildContentAdvisory("missing_seo_title", "SEO title is missing", "The product has no explicit Shopify SEO title."));
  } else if (seoTitle.length > 70 || isGenericProductTitle(seoTitle)) {
    advisories.push(buildContentAdvisory("weak_seo_title", "SEO title could be stronger", `The SEO title is ${seoTitle.length > 70 ? "too long" : "too generic"} for search results.`));
  }

  if (!seoDescription) {
    advisories.push(buildContentAdvisory("missing_meta_description", "Meta description is missing", "The product has no explicit Shopify meta description."));
  } else if (seoDescription.length < 70 || seoDescription.length > 165) {
    advisories.push(buildContentAdvisory("weak_meta_description", "Meta description could be clearer", `The meta description is ${seoDescription.length < 70 ? "too short" : "too long"} for search results.`));
  }

  if (handle && shouldReviewProductHandle(handle, product.title)) {
    advisories.push(buildContentAdvisory("weak_product_handle", "URL handle could be clearer", "The product URL handle is hard to read, inconsistent with the title, or missing useful product keywords."));
  }

  const hasSpecsLanguage = /(dimension|dimensions|size|sizing|material|materials|compatible|compatibility|includes|included|care|weight|height|width|length|capacity|model|specification|specifications)/i.test(description);
  const specsBlockRecommended = Boolean(description && !hasSpecsLanguage && (descriptionWordCount < 80 || productType || variants.length > 1));
  if (specsBlockRecommended) {
    advisories.push(buildContentAdvisory("missing_specs_block", "Specs/details block could improve clarity", "The description does not clearly separate specifications, compatibility, included items, materials, care or limits."));
  }

  if (!String(product.vendor || "").trim() || !String(product.productType || "").trim()) {
    advisories.push(buildContentAdvisory("classification_incomplete", "Product classification needs review", "Vendor or product type is missing, which can weaken catalog workflows and reporting."));
  }

  const templateNeedsReview = Boolean(!templateSuffix && (specsBlockRecommended || issues.some((issue) => ["missing_description", "short_description", "description_variant_mismatch"].includes(issue.code))));
  if (templateNeedsReview) {
    advisories.push(buildContentAdvisory("template_may_need_special_layout", "Product template could support richer guidance", "This product may need a template that can show FAQ, specs or warning content more clearly than plain description text."));
  }

  const score = clamp(100 - issues.reduce((total, issue) => total + issue.riskLift * 3, 0), 0, 100);

  return {
    hasDescription: Boolean(description),
    descriptionLength: description.length,
    descriptionWordCount,
    titleNeedsReview: issues.some((issue) => issue.code === "generic_title"),
    seoTitleNeedsReview: advisories.some((issue) => ["missing_seo_title", "weak_seo_title"].includes(issue.code)),
    metaDescriptionNeedsReview: advisories.some((issue) => ["missing_meta_description", "weak_meta_description"].includes(issue.code)),
    handleNeedsReview: advisories.some((issue) => issue.code === "weak_product_handle"),
    specsBlockRecommended,
    classificationNeedsReview: advisories.some((issue) => issue.code === "classification_incomplete"),
    templateNeedsReview,
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

function shouldReviewProductHandle(handle = "", title = "") {
  const normalizedHandle = String(handle || "").trim().toLowerCase();
  if (!normalizedHandle) return false;
  if (normalizedHandle.length < 6 || /[_%]|-{2,}/.test(normalizedHandle)) return true;
  if (/^\d+$/.test(normalizedHandle) || /^product-\d+$/.test(normalizedHandle)) return true;
  const handleTokens = new Set(meaningfulTokens(normalizedHandle.replace(/-/g, " ")));
  const titleTokens = meaningfulTokens(title);
  if (titleTokens.length < 2 || !handleTokens.size) return false;
  const shared = titleTokens.filter((token) => handleTokens.has(token)).length;
  return shared === 0;
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
  const descriptionDepthAdvisory = buildDescriptionDepthAdvisory(deterministic.metrics);
  const advisories = uniqueBy([
    ...deterministicAdvisories,
    ...aiAdvisories,
    ...(descriptionDepthAdvisory ? [descriptionDepthAdvisory] : []),
  ], (issue) => `${issue.code}-${issue.label}`);
  const aiRiskLift = Math.min(18, aiIssues.reduce((total, issue) => total + issue.riskLift, 0));
  const deterministicRiskLift = Number(deterministic.metrics.contentQualityRisk || 0);
  const score = calculateContentQualityScore(deterministic.metrics, contentGaps, issues);
  const scoreRiskLift = getContentQualityScoreRiskLift(score);
  const riskLift = Math.min(18, Math.max(deterministicRiskLift, aiRiskLift, scoreRiskLift));
  const additionalRiskLift = Math.min(10, Math.max(0, riskLift - deterministicRiskLift));

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

function calculateContentQualityScore(metrics = {}, contentGaps = {}, issues = []) {
  const deterministicScore = clamp(Number(metrics.contentQualityScore || 100), 0, 100);
  const aiScore = Number(contentGaps?.content_quality_score);
  const normalizedAiScore = Number.isFinite(aiScore) ? clamp(Math.round(aiScore), 0, 100) : null;
  const blendedScore = normalizedAiScore == null
    ? deterministicScore
    : Math.min(
      Math.round((deterministicScore * 0.35) + (normalizedAiScore * 0.65)),
      normalizedAiScore + 8,
    );
  const descriptionCap = getDescriptionDepthContentQualityCap(metrics, issues);
  return clamp(Math.min(blendedScore, descriptionCap), 0, 100);
}

function getDescriptionDepthContentQualityCap(metrics = {}, issues = []) {
  const wordCount = Number(metrics.descriptionWordCount || 0);
  const issueCodes = new Set((Array.isArray(issues) ? issues : []).map((issue) => normalizeContentIssueCode(issue.code)));

  if (issueCodes.has("missing_description") || wordCount <= 0) return 30;
  if (wordCount < 15) return 50;
  if (wordCount < 25) return 62;
  if (wordCount < 35) return 72;
  if (wordCount < 50) return 80;
  if (wordCount < 80) return issueCodes.has("missing_specifications") || issueCodes.has("missing_customer_guidance") ? 84 : 88;
  return 100;
}

function buildDescriptionDepthAdvisory(metrics = {}) {
  const wordCount = Number(metrics.descriptionWordCount || 0);
  if (wordCount <= 0 || wordCount >= 50) return null;
  return buildContentAdvisory(
    "thin_description",
    "Description depth is limited",
    `The description has ${wordCount} words, so ProductPulse caps content quality even when the copy is coherent.`,
  );
}

function getContentQualityScoreRiskLift(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return 0;
  if (numericScore < 45) return 12;
  if (numericScore < 60) return 8;
  if (numericScore < 75) return 5;
  if (numericScore < 85) return 2;
  return 0;
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

function adjustReconstructedRiskHistoryForContentAnalysis(history = [], contentAnalysis = {}, currentRiskScore = null) {
  const points = (Array.isArray(history) ? history : []).filter(Boolean);
  if (!points.length) return [];

  return points.map((point, index) => {
    const isLast = index === points.length - 1 || point.isCurrent;
    const currentComponents = point.metrics?.riskComponents || {};
    const adjustedComponents = adjustRiskComponentsForContentAnalysis(currentComponents, contentAnalysis);
    const riskScore = isLast && Number.isFinite(Number(currentRiskScore))
      ? Math.round(Number(currentRiskScore))
      : adjustedComponents.riskScore;

    return {
      ...point,
      riskScore,
      metrics: {
        ...(point.metrics || {}),
        contentQualityScore: contentAnalysis.score ?? point.metrics?.contentQualityScore ?? null,
        contentQualityRisk: contentAnalysis.riskLift ?? point.metrics?.contentQualityRisk ?? 0,
        contentIssueCount: Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues.length : point.metrics?.contentIssueCount || 0,
        contentAdvisoryCount: Array.isArray(contentAnalysis.advisories) ? contentAnalysis.advisories.length : point.metrics?.contentAdvisoryCount || 0,
        riskComponents: {
          ...adjustedComponents,
          riskScore,
          calculated: riskScore,
        },
      },
    };
  });
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
  if (code === "thin_description") return "Description depth is limited";
  return fallback;
}

const CONTENT_ADVISORY_CODES = new Set([
  "missing_product_type_context",
  "tag_description_mismatch",
  "collection_mismatch",
  "thin_description",
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

  const scoreSentiment = getScoreSentimentInputs(metrics.textInsights, metrics.refundInsights);
  return calculateProductScoreModel({
    ...metrics,
    storeReturnBaseline: snapshot.metrics?.storeAvgReturnRate,
    storeRefundBaseline: snapshot.metrics?.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshot.metrics?.storeAvgNegativeReviewRate,
    sentimentTotal: scoreSentiment.total,
    sentimentNegativeCount: scoreSentiment.negative,
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

function buildTopReturnReasonDetails(returns = [], limit = 4) {
  const groups = new Map();

  (Array.isArray(returns) ? returns : []).forEach((item) => {
    const category = normalizeReturnReasonLabel(item.reasonLabel || item.reason || "Return");
    if (!category) return;

    const key = normalizeReturnReasonKey(category);
    const quantity = Math.max(1, Number(item.quantity || item.processedQuantity || item.refundedQuantity || 1));
    const note = getReturnReasonNoteSummary(item);
    const group = groups.get(key) || {
      key,
      label: category,
      count: 0,
      subReasonMap: new Map(),
    };

    group.count += quantity;

    if (note && !isDefaultCustomerLanguageTerm(note)) {
      const noteKey = normalizeReturnReasonKey(note);
      const subReason = group.subReasonMap.get(noteKey) || {
        key: noteKey,
        label: note,
        count: 0,
      };
      subReason.count += quantity;
      group.subReasonMap.set(noteKey, subReason);
    }

    groups.set(key, group);
  });

  return [...groups.values()]
    .map((group) => {
      const subReasons = [...group.subReasonMap.values()]
        .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));
      const dominantSubReason = subReasons[0] || null;
      const isOther = group.key === "other";
      const label = isOther && dominantSubReason
        ? `Other: ${dominantSubReason.label}`
        : group.label;

      return {
        key: group.key,
        label,
        category: group.label,
        count: group.count,
        detail: dominantSubReason
          ? `${group.label} · ${dominantSubReason.count} unit${dominantSubReason.count === 1 ? "" : "s"}`
          : `${group.count} unit${group.count === 1 ? "" : "s"}`,
        subReasons: subReasons.slice(0, 4),
      };
    })
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .slice(0, limit);
}

function getReturnReasonNoteSummary(item = {}) {
  const notes = [item.reasonNote, item.customerNote]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const first = notes[0] || "";
  return first
    .replace(/^other\s*(reason)?\s*[:/-]\s*/i, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function normalizeReturnReasonKey(value) {
  const normalized = normalizeText(value)
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (isGenericOtherReason(normalized) || ["other reason", "other reasons"].includes(normalized)) return "other";
  if (["not as described", "not described"].includes(normalized)) return "not_as_described";
  if (["quality issue", "quality"].includes(normalized)) return "quality_issue";
  if (["wrong item", "wrong product"].includes(normalized)) return "wrong_item";
  if (["color", "colour"].includes(normalized)) return "color";
  return normalized;
}

function normalizeReturnReasonLabel(value) {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  const key = normalizeReturnReasonKey(normalized);
  if (key === "other") return "Other";
  if (key === "not_as_described") return "Not as described";
  if (key === "quality_issue") return "Quality issue";
  if (key === "wrong_item") return "Wrong item";
  if (key === "color") return "Color";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildOrderGeographyRows(sales = []) {
  const orders = new Map();

  (Array.isArray(sales) ? sales : []).forEach((event, index) => {
    const orderKey = event.orderId || event.id || `sale:${index}`;
    const geography = normalizeSalesEventGeography(event);
    const current = orders.get(orderKey) || { geography: null, units: 0, amount: 0 };
    current.units += Number(event.quantity || 0);
    current.amount += Number(event.amount || 0);
    if (!current.geography || isMoreSpecificGeography(geography, current.geography)) {
      current.geography = geography;
    }
    orders.set(orderKey, current);
  });

  const totalOrders = orders.size;
  if (!totalOrders) return [];

  const groups = new Map();
  orders.forEach((order) => {
    const region = getOrderGeographyRegion(order.geography);
    const current = groups.get(region.key) || {
      key: region.key,
      label: region.label,
      country: region.country,
      countryCode: region.countryCode,
      province: region.province,
      provinceCode: region.provinceCode,
      cityCounts: new Map(),
      orders: 0,
      units: 0,
      amount: 0,
    };
    current.orders += 1;
    current.units += Number(order.units || 0);
    current.amount += Number(order.amount || 0);
    if (order.geography?.city) {
      current.cityCounts.set(order.geography.city, (current.cityCounts.get(order.geography.city) || 0) + 1);
    }
    groups.set(region.key, current);
  });

  return [...groups.values()]
    .map((group) => {
      const share = roundRate((group.orders / totalOrders) * 100, 1);
      const topCities = [...group.cityCounts.entries()]
        .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
        .slice(0, 2)
        .map(([city, count]) => `${city}${count > 1 ? ` (${count})` : ""}`);
      return {
        key: group.key,
        label: group.label,
        count: group.orders,
        orders: group.orders,
        units: group.units,
        amount: roundCurrency(group.amount),
        share,
        percent: share,
        detail: [
          `${group.orders} order${group.orders === 1 ? "" : "s"}`,
          `${share}%`,
          topCities.length ? topCities.join(", ") : "",
        ].filter(Boolean).join(" · "),
        country: group.country,
        countryCode: group.countryCode,
        province: group.province,
        provinceCode: group.provinceCode,
      };
    })
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .slice(0, 12);
}

function normalizeSalesEventGeography(event = {}) {
  return normalizeOrderAddressGeography(event.geography)
    || normalizeOrderAddressGeography(event.shippingAddress)
    || normalizeOrderAddressGeography(event.billingAddress)
    || normalizeOrderAddressGeography(event)
    || null;
}

function isMoreSpecificGeography(candidate = null, current = null) {
  if (!candidate) return false;
  if (!current) return true;
  const score = (item) => ["countryCode", "country", "provinceCode", "province", "city"]
    .reduce((total, key) => total + (item?.[key] ? 1 : 0), 0);
  return score(candidate) > score(current);
}

function getOrderGeographyRegion(geography = null) {
  if (!geography) {
    return {
      key: "unknown",
      label: "Unknown location",
      country: "",
      countryCode: "",
      province: "",
      provinceCode: "",
    };
  }
  const countryCode = normalizeGeographyCode(geography.countryCode);
  const provinceCode = normalizeGeographyCode(geography.provinceCode);
  const country = geography.country || getCountryLabel(countryCode);
  const isUnitedStates = countryCode === "US" || normalizeText(country) === "united states" || normalizeText(country) === "united states of america";
  if (isUnitedStates && (provinceCode || geography.province)) {
    const stateLabel = US_STATE_NAMES[provinceCode] || geography.province || provinceCode;
    return {
      key: `US-${provinceCode || normalizeText(stateLabel)}`,
      label: `${stateLabel}, United States`,
      country: "United States",
      countryCode: "US",
      province: stateLabel,
      provinceCode,
    };
  }
  const countryLabel = country || countryCode || "Unknown location";
  return {
    key: `COUNTRY-${countryCode || normalizeText(countryLabel)}`,
    label: countryLabel,
    country: countryLabel === "Unknown location" ? "" : countryLabel,
    countryCode,
    province: "",
    provinceCode: "",
  };
}

function getCountryLabel(countryCode = "") {
  if (countryCode === "US") return "United States";
  if (countryCode && Intl?.DisplayNames) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) || countryCode;
    } catch {
      return countryCode;
    }
  }
  return countryCode || "";
}

function buildMonthlyOrderActivity({
  sales = [],
  returns = [],
  refunds = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const currentDate = parseValidDate(now) || new Date();
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const sinceDate = new Date(currentDate.getTime() - safeWindowDays * 24 * 60 * 60 * 1000);
  const monthStarts = getMonthStartsBetween(startOfUtcMonth(sinceDate), startOfUtcMonth(currentDate))
    .slice(-MONTHLY_ORDER_ACTIVITY_MAX_MONTHS);
  const buckets = new Map(monthStarts.map((date) => [formatUtcMonthKey(date), createMonthlyOrderActivityBucket(date)]));
  const orderMonthById = new Map();

  sales.forEach((event, index) => {
    const monthKey = getEventMonthKey(event.createdAt);
    if (!buckets.has(monthKey)) return;
    if (event.orderId) orderMonthById.set(event.orderId, monthKey);
    const bucket = buckets.get(monthKey);
    const orderKey = event.orderId || event.id || `sale:${index}:${monthKey}`;
    bucket.orderIds.add(orderKey);
    bucket.orderUnits += Number(event.quantity || 0);
    bucket.revenue += Number(event.amount || 0);
  });

  returns.forEach((event, index) => {
    const monthKey = getOperationalEventMonthKey(event, orderMonthById);
    const bucket = buckets.get(monthKey);
    if (!bucket) return;
    const orderKey = event.orderId || event.id || `return:${index}:${monthKey}`;
    bucket.orderIds.add(orderKey);
    bucket.returnOrderIds.add(orderKey);
    bucket.returnedUnits += getOperationalEventQuantity(event);
  });

  refunds.forEach((event, index) => {
    const monthKey = getOperationalEventMonthKey(event, orderMonthById);
    const bucket = buckets.get(monthKey);
    if (!bucket) return;
    const orderKey = event.orderId || event.id || `refund:${index}:${monthKey}`;
    bucket.orderIds.add(orderKey);
    bucket.refundOrderIds.add(orderKey);
    bucket.refundedUnits += getOperationalEventQuantity(event);
    bucket.refundAmount += Number(event.amount || event.totalRefundedAmount || 0);
  });

  const months = [...buckets.values()].map(normalizeMonthlyOrderActivityBucket);
  const summary = months.reduce((totals, month) => ({
    totalOrders: totals.totalOrders + month.orders,
    totalOrderUnits: totals.totalOrderUnits + month.orderUnits,
    totalRevenue: totals.totalRevenue + month.revenue,
    totalReturnedOrders: totals.totalReturnedOrders + month.returnedOrders,
    totalReturnedUnits: totals.totalReturnedUnits + month.returnedUnits,
    totalRefundedOrders: totals.totalRefundedOrders + month.refundedOrders,
    totalRefundedUnits: totals.totalRefundedUnits + month.refundedUnits,
    totalRefundAmount: totals.totalRefundAmount + month.refundAmount,
    maxOrders: Math.max(totals.maxOrders, month.orders, month.returnedOrders, month.refundedOrders),
  }), {
    totalOrders: 0,
    totalOrderUnits: 0,
    totalRevenue: 0,
    totalReturnedOrders: 0,
    totalReturnedUnits: 0,
    totalRefundedOrders: 0,
    totalRefundedUnits: 0,
    totalRefundAmount: 0,
    maxOrders: 0,
  });

  return {
    source: "shopify_orders_deep_diagnosis",
    windowDays: safeWindowDays,
    generatedAt: toIso(currentDate),
    months,
    summary: {
      ...summary,
      totalRevenue: roundCurrency(summary.totalRevenue),
      totalRefundAmount: roundCurrency(summary.totalRefundAmount),
      returnRate: calculateUnitRatePercent(
        summary.totalReturnedUnits,
        summary.totalOrderUnits,
        summary.totalOrders ? (summary.totalReturnedOrders / summary.totalOrders) * 100 : 0,
      ),
      refundRate: calculateUnitRatePercent(
        summary.totalRefundedUnits,
        summary.totalOrderUnits,
        summary.totalOrders ? (summary.totalRefundedOrders / summary.totalOrders) * 100 : 0,
      ),
      maxOrders: Math.max(summary.maxOrders, 1),
    },
  };
}

function buildReturnRatePrediction({
  sales = [],
  returns = [],
  refunds = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const currentDate = parseValidDate(now) || new Date();
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const sinceDate = new Date(currentDate.getTime() - safeWindowDays * 24 * 60 * 60 * 1000);
  const weekStarts = getWeekStartsBetween(startOfUtcWeek(sinceDate), startOfUtcWeek(currentDate))
    .slice(-RETURN_RATE_PREDICTION_MAX_WEEKS);
  const buckets = new Map(weekStarts.map((date) => [formatUtcDateKey(date), createReturnRateWeekBucket(date)]));
  const orderWeekById = new Map();

  sales.forEach((event, index) => {
    const weekKey = getEventWeekKey(event.createdAt);
    if (!buckets.has(weekKey)) return;
    if (event.orderId) orderWeekById.set(event.orderId, weekKey);
    const bucket = buckets.get(weekKey);
    const orderKey = event.orderId || event.id || `sale:${index}:${weekKey}`;
    bucket.orderIds.add(orderKey);
    bucket.orderUnits += Number(event.quantity || 0);
  });

  returns.forEach((event, index) => {
    const weekKey = getOperationalEventWeekKey(event, orderWeekById);
    const bucket = buckets.get(weekKey);
    if (!bucket) return;
    const orderKey = event.orderId || event.id || `return:${index}:${weekKey}`;
    bucket.orderIds.add(orderKey);
    bucket.returnOrderIds.add(orderKey);
    bucket.returnedUnits += getOperationalEventQuantity(event);
  });

  refunds.forEach((event, index) => {
    const weekKey = getOperationalEventWeekKey(event, orderWeekById);
    const bucket = buckets.get(weekKey);
    if (!bucket) return;
    const orderKey = event.orderId || event.id || `refund:${index}:${weekKey}`;
    if (!bucket.orderIds.has(orderKey)) {
      bucket.orderIds.add(orderKey);
      bucket.orderUnits += Math.max(getOperationalEventQuantity(event), 1);
    }
  });

  const rawPoints = [...buckets.values()].map(normalizeReturnRateWeekBucket);
  const totalOrders = rawPoints.reduce((total, point) => total + point.orders, 0);
  const totalReturnedOrders = rawPoints.reduce((total, point) => total + point.returnedOrders, 0);
  const totalOrderUnits = rawPoints.reduce((total, point) => total + point.orderUnits, 0);
  const totalReturnedUnits = rawPoints.reduce((total, point) => total + point.returnedUnits, 0);
  const totalReturnRate = calculateUnitRatePercent(
    totalReturnedUnits,
    totalOrderUnits,
    totalOrders ? (totalReturnedOrders / totalOrders) * 100 : 0,
  );
  const observedPoints = buildSmoothedReturnRatePoints(rawPoints, totalReturnRate);
  const forecastPoints = totalOrders ? buildReturnRateForecastPoints({
    observedPoints,
    totalReturnRate,
    currentDate,
  }) : [];
  const forecastNext90ReturnRate = roundRate(average(forecastPoints.map((point) => point.predictedReturnRate)));
  const last30DayReturnRate = calculateReturnRateForRecentDays(rawPoints, currentDate, 30);
  const last60DayReturnRate = calculateReturnRateForRecentDays(rawPoints, currentDate, 60);

  return {
    source: "shopify_returns_deep_diagnosis",
    granularity: "weekly",
    windowDays: safeWindowDays,
    generatedAt: toIso(currentDate),
    observedPoints,
    forecastPoints,
    summary: {
      totalOrders,
      totalReturnedOrders,
      totalOrderUnits,
      totalReturnedUnits,
      totalReturnRate,
      last30DayReturnRate,
      last60DayReturnRate,
      forecastNext90ReturnRate,
      forecastWeeks: forecastPoints.length,
      predictionHorizonDays: 91,
      confidence: getReturnRatePredictionConfidence({ totalOrders, observedPoints }),
    },
    model: {
      method: "weekly_bayesian_rolling_trend_with_seasonality",
      forecastWeeks: RETURN_RATE_PREDICTION_FORECAST_WEEKS,
      usesSeasonality: hasReturnRateSeasonalitySignal(observedPoints),
      notes: [
        "Observed points are weekly order cohorts smoothed with a Bayesian prior.",
        "Returns are assigned to the original order week when the Shopify order ID is present.",
        "Future points blend recent trend, full-window baseline and same-month historical behavior when available.",
      ],
    },
  };
}

export function buildProductMomentum({
  product = {},
  sales = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  catalogBaseline = null,
  now = new Date(),
} = {}) {
  const currentDate = parseValidDate(now) || new Date();
  const productCreatedAt = parseValidDate(product.createdAt);
  const productAgeDays = productCreatedAt
    ? Math.max(0, Math.floor((currentDate.getTime() - productCreatedAt.getTime()) / (24 * 60 * 60 * 1000)))
    : null;
  const safeSales = (Array.isArray(sales) ? sales : [])
    .map((event, index) => ({
      id: event.id || event.orderId || `sale:${index}`,
      orderId: event.orderId || event.id || `sale:${index}`,
      createdAt: parseValidDate(event.createdAt),
      quantity: Math.max(0, Number(event.quantity || 0)),
      amount: Math.max(0, Number(event.amount || 0)),
    }))
    .filter((event) => event.createdAt);

  const last7 = sumSalesInWindow(safeSales, currentDate, 7);
  const last14 = sumSalesInWindow(safeSales, currentDate, 14);
  const last30 = sumSalesInWindow(safeSales, currentDate, 30);
  const previous30 = sumSalesBetween(safeSales, addUtcDays(currentDate, -60), addUtcDays(currentDate, -30));
  const previous90 = sumSalesBetween(safeSales, addUtcDays(currentDate, -120), addUtcDays(currentDate, -30));
  const weeklyBuckets = buildProductMomentumWeeklyBuckets(safeSales, currentDate);
  const weeklyUnits = weeklyBuckets.map((bucket) => bucket.units);
  const weeklyRevenue = weeklyBuckets.map((bucket) => roundCurrency(bucket.revenue));
  const catalog = catalogBaseline || {};
  const unitsDistribution = Array.isArray(catalog.unitsLast30Distribution) ? catalog.unitsLast30Distribution : [];
  const revenueDistribution = Array.isArray(catalog.revenueLast30Distribution) ? catalog.revenueLast30Distribution : [];
  const unitsVelocityScore = percentileRank(last30.units, unitsDistribution);
  const revenueVelocityScore = percentileRank(last30.revenue, revenueDistribution);
  const currentVelocityScore = clamp((0.65 * unitsVelocityScore) + (0.35 * revenueVelocityScore), 0, 96);
  const smoothingUnits = Math.max(3, Number(catalog.medianUnitsLast30 || 0) * 0.10);
  const smoothingRevenue = Math.max(10, Number(catalog.medianRevenueLast30 || 0) * 0.10);
  const unitsGrowthRatio = (last30.units + smoothingUnits) / (previous30.units + smoothingUnits);
  const revenueGrowthRatio = (last30.revenue + smoothingRevenue) / (previous30.revenue + smoothingRevenue);
  const combinedGrowthRatio = (0.65 * unitsGrowthRatio) + (0.35 * revenueGrowthRatio);
  const growthScore = getValidatedMomentumGrowthScore({
    unitsLast30: last30.units,
    unitsPrevious30: previous30.units,
    revenueLast30: last30.revenue,
    revenuePrevious30: previous30.revenue,
  });
  const storeUnitsLast30 = Math.max(0, Number(catalog.storeUnitsLast30 || 0)) || last30.units;
  const storeUnitsPrevious90 = Math.max(0, Number(catalog.storeUnitsPrevious90 || 0)) || previous90.units;
  const productShareLast30 = last30.units / Math.max(storeUnitsLast30, 1);
  const productShareBaseline = previous90.units / Math.max(storeUnitsPrevious90, 1);
  const shareLiftRatio = (productShareLast30 + 0.0001) / (productShareBaseline + 0.0001);
  const topCatalogPercent = unitsDistribution.length
    ? Math.max(1, Math.round(100 - unitsVelocityScore))
    : null;
  const catalogShareScore = getValidatedMomentumCatalogShareScore({
    storedScore: 0,
    currentVelocityScore,
    topCatalogPercent,
    productShareBaseline: productShareBaseline * 100,
    shareLiftRatio,
    hasCatalogBaseline: catalog.hasCatalogBaseline,
    unitsLast30: last30.units,
  });
  const activeWeekRatio = weeklyUnits.filter((value) => Number(value || 0) > 0).length / 4;
  const weeklySlope = linearRegressionSlope(weeklyUnits);
  const averageWeeklyUnits = average(weeklyUnits);
  const normalizedSlope = weeklySlope / Math.max(averageWeeklyUnits, 1);
  const trendDirectionScore = clamp(50 + (70 * normalizedSlope), 0, 100);
  const trendConsistencyScore = clamp((0.58 * trendDirectionScore) + (0.42 * activeWeekRatio * 100), 0, 100);
  const recencyScore = getValidatedMomentumRecencyScore({
    weeklyUnits,
    unitsLast30: last30.units,
    unitsLast7Days: last7.units,
    unitsLast14Days: last14.units,
    lastSaleAt: getLatestEventDate(safeSales),
    now: currentDate,
  });
  const rawScore = (0.35 * currentVelocityScore)
    + (0.25 * growthScore)
    + (0.20 * catalogShareScore)
    + (0.15 * trendConsistencyScore)
    + (0.05 * recencyScore);
  let score = Math.round(clamp(rawScore, 0, 100));

  if (last30.units === 0 && last30.revenue === 0) score = 0;
  if (last30.units < 2 && revenueVelocityScore < 80) score = Math.min(score, 40);
  if (last30.units < 5 && currentVelocityScore < 80) score = Math.min(score, 65);
  if (previous30.units === 0 && previous30.revenue === 0 && last30.units > 0) {
    score = Math.min(score, Math.round(78 + Math.min(9, Math.log1p(last30.units) * 2.6)));
  }
  if (productAgeDays !== null && productAgeDays < 30) score = Math.min(score, 85);

  const historyConfidence = previous90.units > 0 || previous90.revenue > 0
    ? 100
    : previous30.units > 0 || previous30.revenue > 0
      ? 70
      : last30.units > 0 || last30.revenue > 0
        ? 40
        : 0;
  const coverageConfidence = getProductMomentumCoverageConfidence({ sales: safeSales, catalogBaseline: catalog, last30 });
  const sampleConfidence = clamp(100 * Math.log1p(last30.units + last30.orders) / Math.log1p(30), 0, 100);
  const trendConfidence = clamp(activeWeekRatio * 100, 0, 100);
  let confidence = Math.round(clamp(
    (0.35 * sampleConfidence)
      + (0.25 * historyConfidence)
      + (0.25 * coverageConfidence)
      + (0.15 * trendConfidence),
    0,
    100,
  ));
  const inventoryState = getProductMomentumInventoryState(product);
  if (inventoryState.inventoryConstraint) confidence = Math.min(confidence, 70);

  const tier = getProductMomentumTier(score);
  const direction = getProductMomentumDirection({
    score,
    productAgeDays,
    growthScore,
    trendConsistencyScore,
    currentVelocityScore,
    recencyScore,
    unitsPrevious30Days: previous30.units,
    unitsLast30Days: last30.units,
    smoothingUnits,
    inventoryConstraint: inventoryState.inventoryConstraint,
  });
  const growthPercent = previous30.units || previous30.revenue
    ? roundRate((combinedGrowthRatio - 1) * 100, 1)
    : last30.units > 0
      ? 100
      : 0;

  return {
    source: "shopify_orders_deep_diagnosis",
    score,
    tier,
    direction,
    confidence,
    confidenceLabel: getProductMomentumConfidenceLabel(confidence),
    calculatedAt: toIso(currentDate),
    windowDays: Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS),
    baselineDays: PRODUCT_MOMENTUM_BASELINE_DAYS,
    components: {
      currentVelocityScore: Math.round(currentVelocityScore),
      growthScore: Math.round(growthScore),
      catalogShareScore: Math.round(catalogShareScore),
      trendConsistencyScore: Math.round(trendConsistencyScore),
      recencyScore: Math.round(recencyScore),
    },
    inputs: {
      productCreatedAt: product.createdAt || null,
      productAgeDays,
      unitsLast7Days: last7.units,
      unitsLast14Days: last14.units,
      unitsLast30Days: last30.units,
      unitsPrevious30Days: previous30.units,
      unitsPrevious90Days: previous90.units,
      revenueLast30Days: roundCurrency(last30.revenue),
      revenuePrevious30Days: roundCurrency(previous30.revenue),
      revenuePrevious90Days: roundCurrency(previous90.revenue),
      ordersLast30Days: last30.orders,
      uniqueCustomersLast30Days: null,
      weeklyUnitsLast4Weeks: weeklyUnits,
      weeklyRevenueLast4Weeks: weeklyRevenue,
      lastSaleAt: getLatestEventDate(safeSales),
    },
    catalog: {
      unitsVelocityScore: Math.round(unitsVelocityScore),
      revenueVelocityScore: Math.round(revenueVelocityScore),
      storeUnitsLast30Days: Math.round(storeUnitsLast30),
      storeUnitsPrevious90Days: Math.round(storeUnitsPrevious90),
      storeRevenueLast30Days: roundCurrency(Number(catalog.storeRevenueLast30 || 0) || last30.revenue),
      storeRevenuePrevious90Days: roundCurrency(Number(catalog.storeRevenuePrevious90 || 0) || previous90.revenue),
      medianUnitsLast30Days: roundRate(Number(catalog.medianUnitsLast30 || 0), 1),
      medianRevenueLast30Days: roundCurrency(Number(catalog.medianRevenueLast30 || 0)),
      productShareLast30: roundRate(productShareLast30 * 100, 3),
      productShareBaseline: roundRate(productShareBaseline * 100, 3),
      shareLiftRatio: roundRate(shareLiftRatio, 3),
      topCatalogPercent,
      catalogProductCount: Number(catalog.productCount || 0),
      hasCatalogBaseline: Boolean(catalog.hasCatalogBaseline),
    },
    display: {
      growthPercent,
      growthLabel: formatSignedPercent(growthPercent),
      catalogPositionLabel: topCatalogPercent ? `Top ${topCatalogPercent}%` : "Catalog baseline pending",
      trendLabel: getProductMomentumTrendLabel(weeklyUnits),
      recommendedUse: score >= 70 ? "Add to Watchlist" : score >= 50 ? "Monitor if risk rises" : "No commercial follow-up needed",
    },
    flags: {
      inventoryConstraint: inventoryState.inventoryConstraint,
      availableDaysLast30Days: inventoryState.availableDaysLast30Days,
      missingCatalogBaseline: !catalog.hasCatalogBaseline,
      missingCustomerData: true,
      missingInventoryHistory: inventoryState.availableDaysLast30Days === null,
    },
  };
}

function getValidatedMomentumGrowthScore({ unitsLast30 = 0, unitsPrevious30 = 0, revenueLast30 = 0, revenuePrevious30 = 0 } = {}) {
  const currentUnits = Math.max(0, Number(unitsLast30 || 0));
  const previousUnits = Math.max(0, Number(unitsPrevious30 || 0));
  const currentRevenue = Math.max(0, Number(revenueLast30 || 0));
  const previousRevenue = Math.max(0, Number(revenuePrevious30 || 0));
  if (!currentUnits && !currentRevenue) return 0;
  if (!previousUnits && !previousRevenue) {
    const volumeConfidence = Math.log1p(currentUnits) / Math.log1p(Math.max(40, currentUnits));
    return clamp(66 + (22 * volumeConfidence), 0, 88);
  }
  const ratios = [];
  if (previousUnits > 0 || currentUnits > 0) {
    ratios.push({ ratio: (currentUnits + 3) / (previousUnits + 3), weight: previousUnits > 0 ? 0.72 : 0.35 });
  }
  if (previousRevenue > 0) {
    ratios.push({ ratio: (currentRevenue + 25) / (previousRevenue + 25), weight: 0.28 });
  }
  const totalWeight = ratios.reduce((total, item) => total + item.weight, 0);
  const combinedRatio = totalWeight
    ? ratios.reduce((total, item) => total + (item.ratio * item.weight), 0) / totalWeight
    : 1;
  return clamp(50 + (28 * safeLog2(combinedRatio)), 0, 96);
}

function getValidatedMomentumCatalogShareScore({
  storedScore = 0,
  currentVelocityScore = 0,
  topCatalogPercent = 0,
  productShareBaseline = 0,
  shareLiftRatio = 0,
  hasCatalogBaseline = false,
  unitsLast30 = 0,
} = {}) {
  const stored = clamp(Number(storedScore || 0), 0, 100);
  const velocity = clamp(Number(currentVelocityScore || 0), 0, 96);
  const baseline = Number(productShareBaseline || 0);
  const lift = Number(shareLiftRatio || 0);
  const topPercent = Number(topCatalogPercent || 0);
  if (hasCatalogBaseline && baseline > 0 && lift > 0) {
    const liftScore = clamp(50 + (26 * safeLog2(lift)), 0, 96);
    return clamp((0.55 * liftScore) + (0.45 * velocity), 0, 96);
  }
  if (topPercent > 0) {
    const positionScore = clamp(98 - (topPercent * 1.55), 42, 94);
    return clamp((0.65 * positionScore) + (0.35 * Math.min(stored || positionScore, 92)), 0, 94);
  }
  const volumeScore = clamp(42 + ((Math.log1p(Math.max(0, unitsLast30)) / Math.log1p(Math.max(40, unitsLast30))) * 36), 0, 82);
  return clamp(stored ? Math.min(stored, volumeScore) : volumeScore, 0, 86);
}

function getValidatedMomentumRecencyScore({ weeklyUnits = [], unitsLast30 = 0, unitsLast7Days = 0, unitsLast14Days = 0, lastSaleAt = null, now = new Date() } = {}) {
  const latestWeekUnits = Array.isArray(weeklyUnits) && weeklyUnits.length ? Number(weeklyUnits[weeklyUnits.length - 1] || 0) : 0;
  const recent7 = Math.max(0, Number(unitsLast7Days || 0) || latestWeekUnits);
  const recent14 = Math.max(0, Number(unitsLast14Days || 0));
  const currentUnits = Math.max(0, Number(unitsLast30 || 0));
  const currentDate = parseValidDate(now) || new Date();
  const lastSaleDate = parseValidDate(lastSaleAt);
  const daysSinceLastSale = lastSaleDate
    ? Math.max(0, Math.floor((currentDate.getTime() - lastSaleDate.getTime()) / (24 * 60 * 60 * 1000)))
    : null;
  let base = recent7 > 0 ? 82 : recent14 > 0 ? 64 : currentUnits > 0 ? 42 : 0;
  if (daysSinceLastSale !== null) {
    base = daysSinceLastSale <= 2 ? 86 : daysSinceLastSale <= 7 ? 78 : daysSinceLastSale <= 14 ? 60 : daysSinceLastSale <= 30 ? 38 : 0;
  }
  const recentShare = currentUnits ? clamp(recent7 / currentUnits, 0, 1) : 0;
  return clamp(base + (recentShare * 10) + (recent7 >= 5 ? 4 : 0), 0, 96);
}

function sumSalesInWindow(sales, currentDate, days) {
  return sumSalesBetween(sales, addUtcDays(currentDate, -days), currentDate);
}

function sumSalesBetween(sales = [], startDate, endDate) {
  const orderIds = new Set();
  let units = 0;
  let revenue = 0;
  sales.forEach((event) => {
    if (!event.createdAt || event.createdAt.getTime() < startDate.getTime() || event.createdAt.getTime() >= endDate.getTime()) return;
    units += Number(event.quantity || 0);
    revenue += Number(event.amount || 0);
    orderIds.add(event.orderId || event.id);
  });

  return {
    units: Math.round(units),
    revenue: roundCurrency(revenue),
    orders: orderIds.size,
  };
}

function buildProductMomentumWeeklyBuckets(sales = [], currentDate = new Date()) {
  const startDate = addUtcDays(startOfUtcWeek(currentDate), -21);
  const buckets = new Map(Array.from({ length: 4 }, (_, index) => {
    const date = addUtcDays(startDate, index * 7);
    return [formatUtcDateKey(date), { key: formatUtcDateKey(date), units: 0, revenue: 0 }];
  }));

  sales.forEach((event) => {
    const weekKey = getEventWeekKey(event.createdAt);
    const bucket = buckets.get(weekKey);
    if (!bucket) return;
    bucket.units += Number(event.quantity || 0);
    bucket.revenue += Number(event.amount || 0);
  });

  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    units: Math.round(bucket.units),
    revenue: roundCurrency(bucket.revenue),
  }));
}

function percentileRank(value, distribution = []) {
  const number = Math.max(0, Number(value || 0));
  const values = (Array.isArray(distribution) ? distribution : [])
    .map((item) => Math.max(0, Number(item || 0)))
    .filter((item) => Number.isFinite(item));
  if (!values.length) {
    if (number <= 0) return 0;
    return clamp(25 + (Math.log1p(number) / Math.log1p(Math.max(number, 30))) * 55, 0, 80);
  }

  const less = values.filter((item) => item < number).length;
  const equal = values.filter((item) => item === number).length;
  return clamp(((less + equal * 0.5) / values.length) * 100, 0, 100);
}

function linearRegressionSlope(values = []) {
  const points = (Array.isArray(values) ? values : []).map((value, index) => ({ x: index + 1, y: Number(value || 0) }));
  if (points.length < 2) return 0;
  const meanX = average(points.map((point) => point.x));
  const meanY = average(points.map((point) => point.y));
  const denominator = points.reduce((total, point) => total + ((point.x - meanX) ** 2), 0);
  if (!denominator) return 0;
  return points.reduce((total, point) => total + ((point.x - meanX) * (point.y - meanY)), 0) / denominator;
}

function safeLog2(value) {
  return Math.log2(Math.max(Number(value || 0), 0.0001));
}

function getProductMomentumCoverageConfidence({ sales = [], catalogBaseline = {}, last30 = {} }) {
  if (!sales.length) return 30;
  const hasRevenue = Number(last30.revenue || 0) > 0 || sales.some((event) => Number(event.amount || 0) > 0);
  const hasCatalogBaseline = Boolean(catalogBaseline?.hasCatalogBaseline);
  if (hasRevenue && hasCatalogBaseline) return 100;
  if (hasRevenue) return 70;
  if (hasCatalogBaseline) return 60;
  return 50;
}

function getProductMomentumInventoryState(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) {
    return { inventoryConstraint: false, availableDaysLast30Days: null };
  }
  const trackedVariants = variants.filter((variant) => variant.inventoryTracked);
  if (!trackedVariants.length) {
    return { inventoryConstraint: false, availableDaysLast30Days: null };
  }
  const currentlyAvailable = trackedVariants.some((variant) => Number(variant.inventoryQuantity || 0) > 0 || variant.inventoryPolicy === "CONTINUE");
  return {
    inventoryConstraint: !currentlyAvailable,
    availableDaysLast30Days: currentlyAvailable ? 30 : 0,
  };
}

function getProductMomentumTier(score) {
  const value = Number(score || 0);
  if (value >= 80) return "Hot";
  if (value >= 60) return "Rising";
  if (value >= 40) return "Stable";
  if (value >= 20) return "Cooling";
  return "Low activity";
}

function getProductMomentumConfidenceLabel(confidence) {
  const value = Number(confidence || 0);
  if (value >= 80) return "High confidence";
  if (value >= 60) return "Medium confidence";
  if (value >= 40) return "Low confidence";
  return "Very low confidence";
}

function getProductMomentumDirection({
  growthScore = 0,
  trendConsistencyScore = 0,
  currentVelocityScore = 0,
  recencyScore = 0,
  unitsPrevious30Days = 0,
  unitsLast30Days = 0,
  smoothingUnits = 3,
  productAgeDays = null,
  inventoryConstraint = false,
} = {}) {
  if (inventoryConstraint) return "Inventory constrained";
  if (unitsLast30Days === 0) return "Dormant";
  if (productAgeDays !== null && productAgeDays < 30) return "New activity";
  if (unitsPrevious30Days <= smoothingUnits && unitsLast30Days >= 5 && growthScore >= 75) return "New spike";
  if (growthScore >= 70 && trendConsistencyScore >= 65) return "Accelerating";
  if (currentVelocityScore >= 80 && growthScore >= 40 && growthScore <= 65) return "High-volume stable";
  if (growthScore >= 75 && currentVelocityScore >= 45 && (productAgeDays === null || productAgeDays >= 14)) return "Emerging";
  if (growthScore < 40 && recencyScore < 70) return "Cooling";
  return getProductMomentumTrendLabelFromScores({ growthScore, trendConsistencyScore });
}

function getProductMomentumTrendLabelFromScores({ growthScore = 0, trendConsistencyScore = 0 } = {}) {
  if (growthScore >= 60 && trendConsistencyScore >= 55) return "Gaining traction";
  if (growthScore < 45) return "Softening";
  return "Steady";
}

function getProductMomentumTrendLabel(weeklyUnits = []) {
  const first = Number(weeklyUnits[0] || 0);
  const last = Number(weeklyUnits[weeklyUnits.length - 1] || 0);
  if (weeklyUnits.every((value) => Number(value || 0) === 0)) return "No recent sales activity";
  if (last > first) return "Sales increasing over the last 4 weeks";
  if (last < first) return "Sales decreasing over the last 4 weeks";
  return "Sales activity is stable over the last 4 weeks";
}

function formatSignedPercent(value) {
  const number = Number(value || 0);
  const rounded = roundRate(Math.abs(number), 1);
  if (number > 0) return `+${rounded}%`;
  if (number < 0) return `-${rounded}%`;
  return "0%";
}

function createReturnRateWeekBucket(date) {
  return {
    key: formatUtcDateKey(date),
    label: formatWeekLabel(date),
    startAt: toIso(date),
    orderIds: new Set(),
    returnOrderIds: new Set(),
    orderUnits: 0,
    returnedUnits: 0,
  };
}

function normalizeReturnRateWeekBucket(bucket) {
  const orders = bucket.orderIds.size;
  const returnedOrders = bucket.returnOrderIds.size;
  const returnedUnits = Math.max(Number(bucket.returnedUnits || 0), returnedOrders);
  const orderUnits = Math.max(Number(bucket.orderUnits || 0), returnedUnits, orders);
  return {
    key: bucket.key,
    label: bucket.label,
    startAt: bucket.startAt,
    orders,
    orderUnits,
    returnedOrders,
    returnedUnits,
    rawReturnRate: orders || orderUnits
      ? calculateUnitRatePercent(returnedUnits, orderUnits, orders ? (returnedOrders / orders) * 100 : 0)
      : null,
  };
}

function buildSmoothedReturnRatePoints(rawPoints = [], totalReturnRate = 0) {
  const priorRate = clamp(totalReturnRate / 100, 0, 1);
  const priorStrength = 4;
  let previousRate = 0;

  return rawPoints.map((point, index) => {
    const rolling = rawPoints.slice(Math.max(0, index - 2), index + 1);
    const rollingOrders = rolling.reduce((total, item) => total + item.orders, 0);
    const rollingReturns = rolling.reduce((total, item) => total + item.returnedOrders, 0);
    const rollingOrderUnits = rolling.reduce((total, item) => total + Number(item.orderUnits || 0), 0);
    const rollingReturnedUnits = rolling.reduce((total, item) => total + Number(item.returnedUnits || 0), 0);
    const smoothedRate = rollingOrders || rollingOrderUnits
      ? calculateUnitRatePercent(
        rollingReturnedUnits + priorStrength * priorRate,
        rollingOrderUnits + priorStrength,
        rollingOrders ? ((rollingReturns + priorStrength * priorRate) / (rollingOrders + priorStrength)) * 100 : previousRate,
      )
      : roundRate(previousRate);
    previousRate = smoothedRate;
    return {
      ...point,
      kind: "observed",
      rollingOrders,
      rollingReturnedOrders: rollingReturns,
      rollingOrderUnits,
      rollingReturnedUnits,
      smoothedReturnRate: smoothedRate,
    };
  });
}

function buildReturnRateForecastPoints({ observedPoints = [], totalReturnRate = 0, currentDate = new Date() } = {}) {
  const values = observedPoints.map((point) => Number(point.smoothedReturnRate)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return [];

  const currentRate = values[values.length - 1];
  const recentValues = values.slice(-Math.min(values.length, 6));
  const recentDelta = recentValues.length > 1 ? recentValues[recentValues.length - 1] - recentValues[0] : 0;
  const recentSlope = linearRegressionSlope(recentValues);
  const flatThreshold = Math.max(0.5, Math.min(2.5, Math.abs(totalReturnRate) * 0.06));
  const trendDirection = Math.abs(recentDelta) <= flatThreshold && Math.abs(recentSlope) <= 0.35
    ? "flat"
    : recentDelta > 0 && recentSlope > 0
      ? "rising"
      : recentDelta < 0 && recentSlope < 0
        ? "falling"
        : "mixed";
  const recentOrderAvg = average(observedPoints.slice(-4).map((point) => Number(point.orders || point.orderUnits || 0)));
  const sampleWeight = clamp(recentOrderAvg / 8, 0.2, 1);
  const weeklySlope = trendDirection === "flat"
    ? 0
    : clamp(recentSlope * sampleWeight, -2.5, 2.5);
  const seasonalRates = buildReturnRateSeasonalityRates(observedPoints);
  const startDate = addUtcDays(startOfUtcWeek(currentDate), 7);
  const forecastPoints = [];
  let previousPrediction = currentRate;

  for (let index = 0; index < RETURN_RATE_PREDICTION_FORECAST_WEEKS; index += 1) {
    const date = addUtcDays(startDate, index * 7);
    const horizon = (index + 1) / RETURN_RATE_PREDICTION_FORECAST_WEEKS;
    const dampedTrend = currentRate + weeklySlope * (index + 1) * (1 - horizon * 0.62);
    const seasonalRate = seasonalRates.get(date.getUTCMonth()) ?? totalReturnRate;
    const anchorRate = trendDirection === "flat"
      ? currentRate
      : trendDirection === "falling"
        ? Math.min(currentRate, totalReturnRate)
        : totalReturnRate;
    const trendWeight = trendDirection === "flat" ? 0.72 : 0.66;
    const seasonalWeight = seasonalRates.has(date.getUTCMonth()) ? 0.12 : 0.06;
    const anchorWeight = 1 - trendWeight - seasonalWeight;
    const target = (dampedTrend * trendWeight) + (seasonalRate * seasonalWeight) + (anchorRate * anchorWeight);
    const easing = trendDirection === "flat" ? 0.22 : 0.30 + horizon * 0.14;
    const predictedReturnRate = clamp(previousPrediction + (target - previousPrediction) * easing, 0, 100);
    previousPrediction = predictedReturnRate;
    forecastPoints.push({
      kind: "forecast",
      key: formatUtcDateKey(date),
      label: formatWeekLabel(date),
      startAt: toIso(date),
      predictedReturnRate: roundRate(predictedReturnRate),
      baselineReturnRate: roundRate(totalReturnRate),
      seasonalReturnRate: roundRate(seasonalRate),
      trendSlope: roundRate(weeklySlope, 3),
      trendDirection,
    });
  }

  return forecastPoints;
}

function buildReturnRateSeasonalityRates(observedPoints = []) {
  const byMonth = new Map();
  observedPoints.forEach((point) => {
    const date = parseValidDate(point.startAt);
    const orders = Number(point.orders || 0);
    const orderUnits = Number(point.orderUnits || 0);
    if (!date || (!orders && !orderUnits)) return;
    const month = date.getUTCMonth();
    const current = byMonth.get(month) || { orders: 0, orderUnits: 0, returns: 0, returnedUnits: 0 };
    current.orders += orders;
    current.orderUnits += orderUnits;
    current.returns += Number(point.returnedOrders || 0);
    current.returnedUnits += Number(point.returnedUnits || 0);
    byMonth.set(month, current);
  });

  return new Map([...byMonth.entries()]
    .filter(([, value]) => value.orders > 0 || value.orderUnits > 0)
    .map(([month, value]) => [month, calculateUnitRatePercent(
      value.returnedUnits,
      value.orderUnits,
      value.orders ? (value.returns / value.orders) * 100 : 0,
    )]));
}

function hasReturnRateSeasonalitySignal(observedPoints = []) {
  const monthSet = new Set(observedPoints
    .map((point) => parseValidDate(point.startAt))
    .filter(Boolean)
    .map((date) => date.getUTCMonth()));
  return monthSet.size >= 6;
}

function calculateReturnRateForRecentDays(points = [], currentDate = new Date(), days = 30) {
  const since = new Date(currentDate.getTime() - days * 24 * 60 * 60 * 1000);
  const recent = points.filter((point) => {
    const date = parseValidDate(point.startAt);
    return date && date.getTime() >= since.getTime() && date.getTime() <= currentDate.getTime();
  });
  const orders = recent.reduce((total, point) => total + Number(point.orders || 0), 0);
  const returns = recent.reduce((total, point) => total + Number(point.returnedOrders || 0), 0);
  const orderUnits = recent.reduce((total, point) => total + Number(point.orderUnits || 0), 0);
  const returnedUnits = recent.reduce((total, point) => total + Number(point.returnedUnits || 0), 0);
  return calculateUnitRatePercent(returnedUnits, orderUnits, orders ? (returns / orders) * 100 : 0);
}

function getReturnRatePredictionConfidence({ totalOrders = 0, observedPoints = [] } = {}) {
  const activeWeeks = observedPoints.filter((point) => point.orders > 0).length;
  if (totalOrders >= 80 && activeWeeks >= 12) return "High";
  if (totalOrders >= 25 && activeWeeks >= 6) return "Medium";
  if (totalOrders > 0) return "Low";
  return "Unavailable";
}

function createMonthlyOrderActivityBucket(date) {
  return {
    key: formatUtcMonthKey(date),
    label: formatUtcMonthLabel(date),
    shortLabel: formatUtcMonthShortLabel(date),
    startAt: toIso(date),
    orderIds: new Set(),
    returnOrderIds: new Set(),
    refundOrderIds: new Set(),
    orderUnits: 0,
    revenue: 0,
    returnedUnits: 0,
    refundedUnits: 0,
    refundAmount: 0,
  };
}

function normalizeMonthlyOrderActivityBucket(bucket) {
  const orders = bucket.orderIds.size;
  const returnedOrders = bucket.returnOrderIds.size;
  const refundedOrders = bucket.refundOrderIds.size;
  const returnedUnits = Math.max(Number(bucket.returnedUnits || 0), returnedOrders);
  const refundedUnits = Math.max(Number(bucket.refundedUnits || 0), refundedOrders);
  const orderUnits = Math.max(Number(bucket.orderUnits || 0), returnedUnits, refundedUnits, orders);
  return {
    key: bucket.key,
    label: bucket.label,
    shortLabel: bucket.shortLabel,
    startAt: bucket.startAt,
    orders,
    orderUnits,
    revenue: roundCurrency(bucket.revenue),
    returnedOrders,
    returnedUnits,
    refundedOrders,
    refundedUnits,
    refundAmount: roundCurrency(bucket.refundAmount),
    returnRate: calculateUnitRatePercent(returnedUnits, orderUnits, orders ? (returnedOrders / orders) * 100 : 0),
    refundRate: calculateUnitRatePercent(refundedUnits, orderUnits, orders ? (refundedOrders / orders) * 100 : 0),
  };
}

function getOperationalEventQuantity(event = {}) {
  return Math.max(0, Number(event.quantity || event.processedQuantity || event.refundedQuantity || 0));
}

function getOperationalEventMonthKey(event, orderMonthById) {
  if (event?.orderId && orderMonthById.has(event.orderId)) return orderMonthById.get(event.orderId);
  return getEventMonthKey(event?.createdAt || event?.processedAt || event?.updatedAt);
}

function getOperationalEventWeekKey(event, orderWeekById) {
  if (event?.orderId && orderWeekById.has(event.orderId)) return orderWeekById.get(event.orderId);
  return getEventWeekKey(event?.createdAt || event?.processedAt || event?.updatedAt);
}

function getEventMonthKey(value) {
  const date = parseValidDate(value);
  return date ? formatUtcMonthKey(date) : "";
}

function getEventWeekKey(value) {
  const date = parseValidDate(value);
  return date ? formatUtcDateKey(startOfUtcWeek(date)) : "";
}

function getMonthStartsBetween(startDate, endDate) {
  const months = [];
  let cursor = startOfUtcMonth(startDate);
  const end = startOfUtcMonth(endDate);
  while (cursor.getTime() <= end.getTime()) {
    months.push(cursor);
    cursor = addUtcMonths(cursor, 1);
  }
  return months;
}

function getWeekStartsBetween(startDate, endDate) {
  const weeks = [];
  let cursor = startOfUtcWeek(startDate);
  const end = startOfUtcWeek(endDate);
  while (cursor.getTime() <= end.getTime()) {
    weeks.push(cursor);
    cursor = addUtcDays(cursor, 7);
  }
  return weeks;
}

function startOfUtcMonth(value) {
  const date = parseValidDate(value) || new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcWeek(value) {
  const date = parseValidDate(value) || new Date();
  const day = date.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
}

function addUtcMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function addUtcDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function formatUtcMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatUtcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatUtcMonthLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatUtcMonthShortLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
}

function formatWeekLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function parseValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function preferFreshNumber(fresh, fallback) {
  const number = Number(fresh || 0);
  if (number > 0) return number;
  return Number(fallback || 0);
}

function sumBy(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function average(values) {
  const numbers = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function median(values) {
  const numbers = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value)).sort((first, second) => first - second);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2) return numbers[middle];
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function roundRate(value, decimals = 2) {
  const number = Number(value || 0);
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function clampPercentRate(value) {
  return clamp(Number(value || 0), 0, 100);
}

function calculateUnitRatePercent(numeratorUnits, denominatorUnits, fallbackPercent = 0, decimals = 2) {
  const numerator = Number(numeratorUnits || 0);
  const denominator = Number(denominatorUnits || 0);
  const rawRate = denominator > 0 ? (numerator / denominator) * 100 : fallbackPercent;
  return roundRate(clampPercentRate(rawRate), decimals);
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
  if (normalized.includes("source_integrity")
    || normalized.includes("source_mismatch")
    || normalized.includes("review_feed")
    || normalized.includes("feed_integrity")
    || normalized.includes("feed_mismatch")
    || normalized.includes("review_mismatch")
    || normalized.includes("wrong_product")
    || normalized.includes("wrong_sku")
  ) return "review_feed_integrity";
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
    review_feed_integrity: "Review feed mismatch",
    source_integrity: "Source integrity",
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
  if (issue === "quality_defect" || issue === "durability") return "draft-quality-note";
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

function getAppendedDescriptionText(currentDescription = "", proposedDescription = "") {
  const current = normalizeDraftParagraph(currentDescription);
  const proposed = normalizeDraftParagraph(proposedDescription);
  if (!current || !proposed || proposed.length <= current.length) return "";
  if (!proposed.toLowerCase().startsWith(current.toLowerCase())) return "";
  return proposed
    .slice(current.length)
    .replace(/^[\s:;,.-]+/, "")
    .trim();
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
  const normalized = maskResolvedNegativeCustomerLanguage(normalizeText(text));
  return /(too small|too large|doesn.?t fit|does not fit|didn.?t fit|not fit|wrong size|runs small|runs large|broken|break|broke|poor quality|defect|defective|thin|softness|not soft|rough|scratchy|stiff|wrong color|different color|color mismatch|not as pictured|looks different|leak|leaking|spill|spilled|crack|cracked|chip|chipped|damaged|damage|unsafe|danger|hazard|not compatible|incompatible|late|delayed|lost|disappointed|return|refund|not worth|wobbly|unstable|confusing|unclear|missing)/i.test(normalized);
}

function containsExplicitCustomerProblemLanguage(text) {
  const normalized = maskResolvedNegativeCustomerLanguage(normalizeText(text));
  return /(too small|too large|doesn.?t fit|does not fit|didn.?t fit|not fit|wrong size|runs small|runs large|broken|break|broke|poor quality|defect|defective|not soft|rough|scratchy|stiff|wrong color|different color|color mismatch|not as pictured|looks different|leak|leaking|spill|spilled|crack|cracked|chip|chipped|damaged|damage|unsafe|danger|hazard|not compatible|incompatible|late|delayed|lost|disappointed|not worth|wobbly|unstable|confusing|unclear|misleading|doesn.?t work|does not work|failed|failure)/i.test(normalized);
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

function isShopifyOrderGeographyAccessError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return (message.includes("shippingaddress") || message.includes("billingaddress") || message.includes("countrycodev2") || message.includes("provincecode"))
    && (message.includes("access") || message.includes("protected customer data") || message.includes("denied") || message.includes("not approved") || message.includes("doesn") || message.includes("undefinedfield"));
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
  buildDiagnosisSalesQuery,
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
  buildTopReturnReasonDetails,
  getNodes,
  buildCustomerTextInsights,
  buildCustomerTextAnalysisItems,
  buildDiagnosisVariantInsights,
  buildOrderGeographyRows,
  buildIssueSignalCountsFromAnalysis,
  calculateDeterministicDiagnosis,
  buildMonthlyOrderActivity,
  buildReturnRatePrediction,
  buildProductMomentum,
  buildProductMomentumCatalogBaseline,
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
  getNoChangeDiagnosisReuseDecision,
  getIncrementalSourceFetchContext,
  mergeIncrementalSourceEvents,
  buildSourceEventCache,
  buildIncrementalSinceDate,
  buildDiagnosisSourceFingerprint,
  normalizeAiClassifiedSignals,
  countAiSignalsByIssue,
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
