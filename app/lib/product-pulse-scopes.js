/* global process */

export const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_all_orders",
  "read_customers",
  "read_returns",
  "read_inventory",
  "read_locations",
];

export const DEVELOPMENT_SHOPIFY_SCOPES = [
  "write_orders",
  "write_customers",
  "write_returns",
  "write_inventory",
];

export const REQUIRED_SHOPIFY_SCOPES_STRING = REQUIRED_SHOPIFY_SCOPES.join(",");

export function normalizeShopifyScopes(scopeString) {
  return String(scopeString || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getConfiguredShopifyScopes(scopeString, options = {}) {
  const includeDevelopmentScopes = options.includeDevelopmentScopes ?? isDevelopmentScopeMode();
  return [...new Set([
    ...REQUIRED_SHOPIFY_SCOPES,
    ...(includeDevelopmentScopes ? DEVELOPMENT_SHOPIFY_SCOPES : []),
    ...normalizeShopifyScopes(scopeString),
  ])];
}

function isDevelopmentScopeMode() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PLAYWRIGHT_PREVIEW === "true" ||
    process.env.PRODUCT_PULSE_DEV_PANEL === "true" ||
    process.env.SHOPIFY_APP_ENV === "development"
  );
}
