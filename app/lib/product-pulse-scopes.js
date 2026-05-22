export const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_all_orders",
  "write_orders",
  "read_customers",
  "write_customers",
  "read_returns",
  "write_returns",
  "read_inventory",
  "write_inventory",
  "read_locations",
];

export const REQUIRED_SHOPIFY_SCOPES_STRING = REQUIRED_SHOPIFY_SCOPES.join(",");

export function normalizeShopifyScopes(scopeString) {
  return String(scopeString || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getConfiguredShopifyScopes(scopeString) {
  return [...new Set([
    ...REQUIRED_SHOPIFY_SCOPES,
    ...normalizeShopifyScopes(scopeString),
  ])];
}
