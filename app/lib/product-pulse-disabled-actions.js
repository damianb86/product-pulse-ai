export const DISABLED_PRODUCT_ACTION_IDS = new Set([
  "add-structured-metafields",
  "review-product-evidence",
  "switch-product-template",
]);

function normalizeProductActionIdentity(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductActionIdentityTokens(action = {}) {
  if (typeof action === "string") {
    const token = normalizeProductActionIdentity(action);
    return token ? [token] : [];
  }

  const payload = action?.payload || action?.payloadSummary || {};
  const aliases = [
    action.id,
    action.actionId,
    action.actionType,
    action.label,
    action.title,
    payload.id,
    payload.actionId,
    payload.sourceActionId,
    payload.canonicalActionId,
    payload.actionType,
    payload.label,
    payload.title,
    ...(Array.isArray(action.actionAliases) ? action.actionAliases : []),
    ...(Array.isArray(payload.actionAliases) ? payload.actionAliases : []),
  ];

  return aliases.map(normalizeProductActionIdentity).filter(Boolean);
}

export function isDisabledProductAction(action = {}) {
  return getProductActionIdentityTokens(action).some((token) => DISABLED_PRODUCT_ACTION_IDS.has(token));
}

export function filterDisabledProductActions(actions = []) {
  return (Array.isArray(actions) ? actions : []).filter((action) => !isDisabledProductAction(action));
}
