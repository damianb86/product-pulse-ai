/* global globalThis */
import { authenticate } from "../shopify.server";
import { getStorePointBalanceForShop, getStorePointSummaryForShop } from "../lib/product-pulse-points.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";

const CREDIT_SUMMARY_CACHE_TTL_MS = 30_000;
const CREDIT_SUMMARY_CACHE_MAX_SHOPS = 50;
const creditSummaryCache = globalThis.productPulseCreditSummaryCache || new Map();

if (!globalThis.productPulseCreditSummaryCache) {
  globalThis.productPulseCreditSummaryCache = creditSummaryCache;
}

export const shouldRevalidate = () => false;

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.credits-summary", { route: "/app/credits-summary" });
  const { session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });

  try {
    const cachedSummary = getCachedCreditSummary(session.shop);
    if (cachedSummary) {
      perf.mark("creditsSummary.cache.hit");
      perf.done({ shop: session.shop, cached: true });
      return buildCreditSummaryResponse(cachedSummary);
    }

    perf.mark("creditsSummary.cache.miss");
    const pointSummary = await measureProductPulseStep(
      perf,
      "getStorePointSummaryForShop",
      () => getStorePointSummaryForShop(session.shop, { limit: 3 }),
    );
    setCachedCreditSummary(session.shop, pointSummary);
    perf.done({ shop: session.shop, cached: false });
    return buildCreditSummaryResponse(pointSummary);
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    const fallbackBalance = await getCreditSummaryFallbackBalance(session.shop);
    return Response.json({
      status: "error",
      message: "Credit activity could not be loaded.",
      pointSummary: null,
      pointBalance: fallbackBalance,
    }, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
};

async function getCreditSummaryFallbackBalance(shop) {
  try {
    return await getStorePointBalanceForShop(shop);
  } catch {
    return null;
  }
}

function buildCreditSummaryResponse(pointSummary) {
  return Response.json({
    pointSummary,
    pointBalance: pointSummary?.balance || null,
  }, {
    headers: {
      "Cache-Control": "private, max-age=30",
    },
  });
}

function getCachedCreditSummary(shop) {
  const key = normalizeCreditSummaryCacheKey(shop);
  if (!key) return null;
  const entry = creditSummaryCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    creditSummaryCache.delete(key);
    return null;
  }
  return entry.pointSummary;
}

function setCachedCreditSummary(shop, pointSummary) {
  if (!pointSummary) return;
  const key = normalizeCreditSummaryCacheKey(shop);
  if (!key) return;
  while (creditSummaryCache.size >= CREDIT_SUMMARY_CACHE_MAX_SHOPS) {
    const oldestKey = creditSummaryCache.keys().next().value;
    if (!oldestKey) break;
    creditSummaryCache.delete(oldestKey);
  }
  creditSummaryCache.set(key, {
    pointSummary,
    expiresAt: Date.now() + CREDIT_SUMMARY_CACHE_TTL_MS,
  });
}

function normalizeCreditSummaryCacheKey(shop) {
  return String(shop || "").trim().toLowerCase();
}
