export function normalizeProductPulseShopCacheKey(shop) {
  return String(shop || "").trim().toLowerCase();
}

export function invalidateProductPulseDashboardAndAnalyticsCache(shop) {
  const key = normalizeProductPulseShopCacheKey(shop);
  if (!key) return;
  global.productPulseDashboardCache?.delete?.(key);
  global.productPulseAnalyticsCache?.delete?.(key);
}

export function invalidateProductPulseJobMonitorCache(shop) {
  const key = normalizeProductPulseShopCacheKey(shop);
  if (!key) return;
  deleteCacheEntriesForShop(global.productPulseJobMonitorCache, key);
  invalidateProductPulseBackgroundProcessCache(shop);
}

export function invalidateProductPulseBackgroundProcessCache(shop) {
  const key = normalizeProductPulseShopCacheKey(shop);
  if (!key) return;
  deleteCacheEntriesForShop(global.productPulseBackgroundProcessCache, key);
}

function deleteCacheEntriesForShop(cache, key) {
  if (!cache?.keys || !cache?.delete) return;
  [...cache.keys()].forEach((cacheKey) => {
    if (cacheKey === key || String(cacheKey).startsWith(`${key}:`)) cache.delete(cacheKey);
  });
}
