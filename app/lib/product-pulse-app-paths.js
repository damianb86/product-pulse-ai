const EMBEDDED_APP_ROUTE_PATTERN = /(?:^|\/)app(?:\/|$)/;

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
