const EMBEDDED_APP_ROUTE_PATTERN = /(?:^|\/)app(?:\/|$)/;
const SHOPIFY_EMBEDDED_PARAM_KEYS = ["shop", "host", "embedded", "locale"];

export function getEmbeddedAppBasePath(pathname = "") {
  const normalizedPathname = normalizePathname(pathname);
  const match = normalizedPathname.match(EMBEDDED_APP_ROUTE_PATTERN);
  if (!match || match.index <= 0) return "";
  return normalizedPathname.slice(0, match.index);
}

export function getEmbeddedAppPathname(pathname = "") {
  const normalizedPathname = normalizePathname(pathname);
  const match = normalizedPathname.match(EMBEDDED_APP_ROUTE_PATTERN);
  return match ? normalizedPathname.slice(match.index) : normalizedPathname;
}

export function buildEmbeddedAppPath(currentPathname, targetPath) {
  if (isExternalUrl(targetPath)) return String(targetPath || "");
  return `${getEmbeddedAppBasePath(currentPathname)}${getEmbeddedAppPathname(targetPath)}`;
}

export function buildEmbeddedAppHref(currentPathname, targetPath, { currentSearch = "", shop = "", extraParams = {} } = {}) {
  if (isExternalUrl(targetPath)) return String(targetPath || "");
  const scopedPath = buildEmbeddedAppPath(currentPathname, targetPath);
  return appendEmbeddedAppParams(scopedPath, currentSearch, shop, extraParams);
}

export function buildEmbeddedApiPath(currentPathname, targetPath) {
  if (isExternalUrl(targetPath)) return String(targetPath || "");
  const normalizedTargetPath = normalizePathname(targetPath);
  return `${getEmbeddedAppBasePath(currentPathname)}${normalizedTargetPath}`;
}

function isExternalUrl(value) {
  return /^[a-z][a-z0-9+.-]*:|^\/\//i.test(String(value || ""));
}

function normalizePathname(pathname) {
  const value = String(pathname || "");
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

function appendEmbeddedAppParams(path, currentSearch, shop, extraParams) {
  const { pathname, search, hash } = splitPathSearchHash(path);
  const params = new URLSearchParams(search);
  const embeddedParams = getEmbeddedAppParams(currentSearch, shop);

  SHOPIFY_EMBEDDED_PARAM_KEYS.forEach((key) => {
    const value = embeddedParams.get(key);
    if (value && !params.has(key)) params.set(key, value);
  });

  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  });

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

function getEmbeddedAppParams(search, shop) {
  const currentParams = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const params = new URLSearchParams();

  SHOPIFY_EMBEDDED_PARAM_KEYS.forEach((key) => {
    const value = currentParams.get(key);
    if (value) params.set(key, value);
  });
  if (!params.get("shop") && shop) params.set("shop", shop);

  return params;
}

function splitPathSearchHash(path) {
  const value = String(path || "");
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const searchIndex = beforeHash.indexOf("?");

  if (searchIndex < 0) {
    return { pathname: beforeHash, search: "", hash };
  }

  return {
    pathname: beforeHash.slice(0, searchIndex),
    search: beforeHash.slice(searchIndex + 1),
    hash,
  };
}
