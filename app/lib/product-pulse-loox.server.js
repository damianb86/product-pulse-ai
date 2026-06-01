export const LOOX_MERCHANT_API_BASE_URL = "https://api.loox.io";
export const LOOX_STOREFRONT_API_BASE_URL = "https://storefront-api.loox.io";
export const LOOX_REVIEW_PAGE_SIZE = 100;
export const LOOX_PRODUCT_REVIEW_PAGE_SIZE = 100;

const DEFAULT_TIMEOUT_MS = 12_000;

export class LooxConnectionError extends Error {
  constructor(message, { code = "LOOX_CONNECTION_FAILED", status = null, details = null } = {}) {
    super(message);
    this.name = "LooxConnectionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function testLooxReviewConnection({
  publicStoreId,
  apiSecret,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedPublicStoreId = normalizeLooxCredential(publicStoreId);
  const normalizedApiSecret = normalizeLooxCredential(apiSecret);
  if (!normalizedPublicStoreId || !normalizedApiSecret) {
    throw new LooxConnectionError("Enter the Loox publicStoreId and API secret key before connecting.", {
      code: "LOOX_CREDENTIALS_REQUIRED",
    });
  }

  const sample = await fetchLooxReviewsPage({
    publicStoreId: normalizedPublicStoreId,
    apiSecret: normalizedApiSecret,
    page: 1,
    limit: 1,
    fetchImpl,
    timeoutMs,
  });

  return {
    publicStoreId: normalizedPublicStoreId,
    reviews: sample.reviews,
    reviewSampleCount: sample.reviews.length,
    totalReviews: sample.totalReviews,
    currentPage: sample.currentPage,
    totalPages: sample.totalPages,
    hasMore: sample.hasMore,
  };
}

export async function fetchLooxReviewPages({
  publicStoreId,
  apiSecret,
  productId = "",
  maxPages = 3,
  limit = LOOX_REVIEW_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeMaxPages = Math.max(1, Number(maxPages || 1));
  const safeLimit = Math.max(1, Math.min(250, Number(limit || LOOX_REVIEW_PAGE_SIZE)));
  const reviews = [];
  let latestPage = null;
  let total = null;

  for (let page = 1; page <= safeMaxPages; page += 1) {
    latestPage = await fetchLooxReviewsPage({
      publicStoreId,
      apiSecret,
      productId,
      page,
      limit: safeLimit,
      total,
      fetchImpl,
      timeoutMs,
    });
    reviews.push(...latestPage.reviews);
    total = latestPage.totalReviews ?? total;
    if (latestPage.hasMore === false) break;
    if (latestPage.reviews.length < safeLimit) break;
    if (latestPage.totalPages && page >= latestPage.totalPages) break;
  }

  return {
    reviews,
    totalReviews: latestPage?.totalReviews ?? reviews.length,
    totalPages: latestPage?.totalPages ?? null,
  };
}

export async function fetchLooxReviewsPage({
  publicStoreId,
  apiSecret,
  productId = "",
  page = 1,
  limit = LOOX_REVIEW_PAGE_SIZE,
  total = null,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedPublicStoreId = normalizeLooxCredential(publicStoreId);
  const normalizedApiSecret = normalizeLooxCredential(apiSecret);
  if (!normalizedPublicStoreId || !normalizedApiSecret) {
    throw new LooxConnectionError("Loox publicStoreId and API secret key are required to read reviews.", {
      code: "LOOX_REVIEW_CREDENTIALS_REQUIRED",
    });
  }

  const safeLimit = Math.max(1, Math.min(250, Number(limit || LOOX_REVIEW_PAGE_SIZE)));
  const url = new URL(
    `/api/v1/store/${encodeURIComponent(normalizedPublicStoreId)}/product-reviews`,
    LOOX_MERCHANT_API_BASE_URL,
  );
  const normalizedProductId = normalizeLooxCredential(productId);
  if (normalizedProductId) url.searchParams.set("product_id", normalizedProductId);
  url.searchParams.set("sort", "date");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("page", String(Math.max(1, Number(page || 1))));
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("status", "published");
  if (Number.isFinite(Number(total)) && Number(total) >= 0) url.searchParams.set("total", String(Number(total)));

  const response = await fetchJson(url, {
    fetchImpl,
    timeoutMs,
    method: "GET",
    headers: {
      accept: "application/json",
      "X-Api-Secret-Key": normalizedApiSecret,
    },
  });
  const reviews = extractLooxReviews(response.json);
  const pagination = extractLooxPagination(response.json, reviews.length, safeLimit, Number(page || 1));

  return {
    reviews,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalReviews: pagination.totalReviews,
    hasMore: pagination.hasMore,
  };
}

export async function fetchLooxProductReviewPages({
  publicStoreId,
  productId,
  maxPages = 3,
  limit = LOOX_PRODUCT_REVIEW_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeMaxPages = Math.max(1, Number(maxPages || 1));
  const safeLimit = Math.max(1, Math.min(250, Number(limit || LOOX_PRODUCT_REVIEW_PAGE_SIZE)));
  const reviews = [];
  let latestPage = null;
  let total = null;

  for (let page = 1; page <= safeMaxPages; page += 1) {
    latestPage = await fetchLooxProductReviewsPage({
      publicStoreId,
      productId,
      page,
      limit: safeLimit,
      total,
      fetchImpl,
      timeoutMs,
    });
    reviews.push(...latestPage.reviews);
    total = latestPage.totalReviews ?? total;
    if (latestPage.hasMore === false) break;
    if (latestPage.reviews.length < safeLimit) break;
    if (latestPage.totalPages && page >= latestPage.totalPages) break;
  }

  return {
    productId: normalizeLooxCredential(productId),
    reviews,
    totalReviews: latestPage?.totalReviews ?? reviews.length,
    totalPages: latestPage?.totalPages ?? null,
  };
}

export async function fetchLooxProductReviewsPage({
  publicStoreId,
  productId,
  page = 1,
  limit = LOOX_PRODUCT_REVIEW_PAGE_SIZE,
  total = null,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedPublicStoreId = normalizeLooxCredential(publicStoreId);
  const normalizedProductId = normalizeLooxCredential(productId);
  if (!normalizedPublicStoreId || !normalizedProductId) {
    throw new LooxConnectionError("Loox publicStoreId and product ID are required to read product reviews.", {
      code: "LOOX_PRODUCT_REVIEW_CREDENTIALS_REQUIRED",
    });
  }

  const safeLimit = Math.max(1, Math.min(250, Number(limit || LOOX_PRODUCT_REVIEW_PAGE_SIZE)));
  const url = new URL(
    `/storefront/v1/store/${encodeURIComponent(normalizedPublicStoreId)}/product-reviews`,
    LOOX_STOREFRONT_API_BASE_URL,
  );
  url.searchParams.set("product_id", normalizedProductId);
  url.searchParams.set("sort", "date");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("page", String(Math.max(1, Number(page || 1))));
  url.searchParams.set("limit", String(safeLimit));
  if (Number.isFinite(Number(total)) && Number(total) >= 0) url.searchParams.set("total", String(Number(total)));

  const response = await fetchJson(url, {
    fetchImpl,
    timeoutMs,
    method: "GET",
    headers: { accept: "application/json" },
  });
  const reviews = extractLooxReviews(response.json);
  const pagination = extractLooxPagination(response.json, reviews.length, safeLimit, Number(page || 1));

  return {
    reviews,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalReviews: pagination.totalReviews,
    hasMore: pagination.hasMore,
  };
}

export function extractLooxReviews(json = {}) {
  const data = json?.data;
  const response = json?.response;
  const candidates = [
    json?.reviews,
    data?.reviews,
    response?.reviews,
    json?.review ? [json.review] : null,
    data?.review ? [data.review] : null,
    response?.review ? [response.review] : null,
    Array.isArray(json) ? json : null,
    Array.isArray(data) ? data : null,
    Array.isArray(response) ? response : null,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

export function getSafeLooxConnectionErrorMessage(error) {
  if (error instanceof LooxConnectionError) return error.message;
  if (error?.name === "AbortError") return "Loox did not respond before the connection test timed out.";
  return "ProductPulse could not verify Loox Reviews right now. Check the publicStoreId and API secret key, then try again.";
}

async function fetchJson(url, { fetchImpl, timeoutMs, ...options } = {}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(String(url), {
      ...options,
      signal: controller?.signal,
    });
    const text = await response.text().catch(() => "");
    const json = parseJson(text);

    if (!response.ok) {
      throw new LooxConnectionError(getLooxHttpErrorMessage(response.status, json), {
        code: getLooxErrorCode(response.status),
        status: response.status,
        details: summarizeLooxResponse(json),
      });
    }

    return { status: response.status, json };
  } catch (error) {
    if (error instanceof LooxConnectionError) throw error;
    if (error?.name === "AbortError") throw error;
    throw new LooxConnectionError("ProductPulse could not reach Loox Reviews. Check network access and try again.", {
      code: "LOOX_NETWORK_ERROR",
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getLooxHttpErrorMessage(status, json = {}) {
  const providerMessage = String(json?.error_description || json?.error || json?.message || json?.response?.message || "").trim();
  if (status === 400) return providerMessage || "Loox rejected one or more request parameters.";
  if (status === 401 || status === 403) return providerMessage || "Loox rejected the publicStoreId or API secret key while testing review access.";
  if (status === 404) return providerMessage || "Loox could not find that store or product.";
  if (status === 429) return providerMessage || "Loox rate limited the review API request. Wait a moment, then try again.";
  return providerMessage || `Loox request failed with HTTP ${status}.`;
}

function getLooxErrorCode(status) {
  if (status === 400) return "LOOX_REQUEST_INVALID";
  if (status === 401 || status === 403) return "LOOX_AUTH_FAILED";
  if (status === 404) return "LOOX_NOT_FOUND";
  if (status === 429) return "LOOX_RATE_LIMITED";
  return "LOOX_REQUEST_FAILED";
}

function extractLooxPagination(json = {}, fallbackCount = 0, pageSize = 0, fallbackPage = 1) {
  const pagination = json?.pagination || json?.data?.pagination || json?.response?.pagination || json?.meta?.pagination || {};
  const totalReviews = normalizeNonNegativeNumber(
    pagination.total
      ?? pagination.totalReviews
      ?? pagination.total_reviews
      ?? json.totalReviews
      ?? json.total_reviews
      ?? json.total
      ?? json.count
      ?? fallbackCount,
  );
  const currentPage = normalizePositiveNumber(pagination.page ?? pagination.currentPage ?? pagination.current_page ?? json.page) || fallbackPage;
  const totalPages = normalizePositiveNumber(pagination.totalPages ?? pagination.total_pages)
    || (pageSize > 0 && totalReviews > 0 ? Math.ceil(totalReviews / pageSize) : null);
  const hasMore = typeof pagination.hasMore === "boolean"
    ? pagination.hasMore
    : typeof pagination.has_more === "boolean"
      ? pagination.has_more
      : totalPages
        ? currentPage < totalPages
        : fallbackCount >= pageSize && pageSize > 0;
  return {
    currentPage,
    totalPages,
    totalReviews,
    hasMore,
  };
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeLooxCredential(value) {
  return String(value || "").trim();
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function summarizeLooxResponse(json = {}) {
  const summary = {};
  ["error", "error_description", "message", "status"].forEach((key) => {
    if (json?.[key]) summary[key] = String(json[key]).slice(0, 300);
  });
  if (json?.response?.message) summary.message = String(json.response.message).slice(0, 300);
  return Object.keys(summary).length ? summary : null;
}
