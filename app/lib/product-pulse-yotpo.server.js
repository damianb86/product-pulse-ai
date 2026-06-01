export const YOTPO_AUTH_URL = "https://api.yotpo.com/oauth/token";
export const YOTPO_API_BASE_URL = "https://api.yotpo.com";
export const YOTPO_WIDGET_API_BASE_URL = "https://api-cdn.yotpo.com";
export const YOTPO_REVIEW_PAGE_SIZE = 100;
export const YOTPO_PRODUCT_REVIEW_PAGE_SIZE = 150;

const DEFAULT_TIMEOUT_MS = 12_000;

export class YotpoConnectionError extends Error {
  constructor(message, { code = "YOTPO_CONNECTION_FAILED", status = null, details = null } = {}) {
    super(message);
    this.name = "YotpoConnectionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function authenticateYotpo({ storeId, apiSecret, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalizedStoreId = normalizeYotpoCredential(storeId);
  const normalizedApiSecret = normalizeYotpoCredential(apiSecret);
  if (!normalizedStoreId || !normalizedApiSecret) {
    throw new YotpoConnectionError("Enter the Yotpo Store ID/App Key and API secret before connecting.", {
      code: "YOTPO_CREDENTIALS_REQUIRED",
    });
  }

  const response = await fetchJson(YOTPO_AUTH_URL, {
    fetchImpl,
    timeoutMs,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: normalizedStoreId,
      client_secret: normalizedApiSecret,
      grant_type: "client_credentials",
    }),
  });

  const token = extractYotpoToken(response.json);
  if (!token) {
    throw new YotpoConnectionError("Yotpo authenticated the request but did not return a usable token.", {
      code: "YOTPO_TOKEN_MISSING",
      status: response.status,
      details: summarizeYotpoResponse(response.json),
    });
  }

  return {
    storeId: normalizedStoreId,
    utoken: token,
    tokenType: response.json?.token_type || response.json?.tokenType || "Bearer",
  };
}

export async function testYotpoReviewConnection({
  storeId,
  apiSecret,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const auth = await authenticateYotpo({ storeId, apiSecret, fetchImpl, timeoutMs });
  const sample = await fetchYotpoReviewsPage({
    storeId: auth.storeId,
    utoken: auth.utoken,
    page: 1,
    count: 1,
    fetchImpl,
    timeoutMs,
  });

  return {
    ...auth,
    reviews: sample.reviews,
    reviewSampleCount: sample.reviews.length,
    totalReviews: sample.totalReviews,
    currentPage: sample.currentPage,
    totalPages: sample.totalPages,
  };
}

export async function fetchYotpoReviewPages({
  storeId,
  utoken,
  maxPages = 3,
  count = YOTPO_REVIEW_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeMaxPages = Math.max(1, Number(maxPages || 1));
  const reviews = [];
  let latestPage = null;

  for (let page = 1; page <= safeMaxPages; page += 1) {
    latestPage = await fetchYotpoReviewsPage({ storeId, utoken, page, count, fetchImpl, timeoutMs });
    reviews.push(...latestPage.reviews);
    if (latestPage.reviews.length < Number(count || YOTPO_REVIEW_PAGE_SIZE)) break;
    if (latestPage.totalPages && page >= latestPage.totalPages) break;
  }

  return {
    reviews,
    totalReviews: latestPage?.totalReviews ?? reviews.length,
    totalPages: latestPage?.totalPages ?? null,
  };
}

export async function fetchYotpoProductReviewPages({
  storeId,
  productId,
  maxPages = 3,
  perPage = YOTPO_PRODUCT_REVIEW_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeMaxPages = Math.max(1, Number(maxPages || 1));
  const reviews = [];
  let latestPage = null;

  for (let page = 1; page <= safeMaxPages; page += 1) {
    latestPage = await fetchYotpoProductReviewsPage({
      storeId,
      productId,
      page,
      perPage,
      fetchImpl,
      timeoutMs,
    });
    reviews.push(...latestPage.reviews);
    if (latestPage.reviews.length < Number(perPage || YOTPO_PRODUCT_REVIEW_PAGE_SIZE)) break;
    if (latestPage.totalPages && page >= latestPage.totalPages) break;
  }

  return {
    productId: normalizeYotpoCredential(productId),
    reviews,
    totalReviews: latestPage?.totalReviews ?? reviews.length,
    totalPages: latestPage?.totalPages ?? null,
    bottomline: latestPage?.bottomline || null,
  };
}

export async function fetchYotpoProductReviewsPage({
  storeId,
  productId,
  page = 1,
  perPage = YOTPO_PRODUCT_REVIEW_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedStoreId = normalizeYotpoCredential(storeId);
  const normalizedProductId = normalizeYotpoCredential(productId);
  if (!normalizedStoreId || !normalizedProductId) {
    throw new YotpoConnectionError("Yotpo Store ID/App Key and product ID are required to read product reviews.", {
      code: "YOTPO_PRODUCT_REVIEW_CREDENTIALS_REQUIRED",
    });
  }

  const url = new URL(
    `/v1/widget/${encodeURIComponent(normalizedStoreId)}/products/${encodeURIComponent(normalizedProductId)}/reviews.json`,
    YOTPO_WIDGET_API_BASE_URL,
  );
  url.searchParams.set("per_page", String(Math.max(1, Number(perPage || YOTPO_PRODUCT_REVIEW_PAGE_SIZE))));
  url.searchParams.set("page", String(Math.max(1, Number(page || 1))));
  url.searchParams.set("sort", "date");
  url.searchParams.set("direction", "desc");

  const response = await fetchJson(url, {
    fetchImpl,
    timeoutMs,
    method: "GET",
    headers: { accept: "application/json" },
  });
  const reviews = extractYotpoReviews(response.json);
  const pagination = extractYotpoPagination(response.json, reviews.length, Number(perPage || YOTPO_PRODUCT_REVIEW_PAGE_SIZE));

  return {
    reviews,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalReviews: pagination.totalReviews,
    bottomline: response.json?.response?.bottomline || response.json?.bottomline || null,
  };
}

export async function fetchYotpoReviewsPage({
  storeId,
  utoken,
  page = 1,
  count = YOTPO_REVIEW_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedStoreId = normalizeYotpoCredential(storeId);
  const token = normalizeYotpoCredential(utoken);
  if (!normalizedStoreId || !token) {
    throw new YotpoConnectionError("Yotpo Store ID/App Key and token are required to read reviews.", {
      code: "YOTPO_REVIEW_CREDENTIALS_REQUIRED",
    });
  }

  const url = new URL(`/v1/apps/${encodeURIComponent(normalizedStoreId)}/reviews`, YOTPO_API_BASE_URL);
  url.searchParams.set("page", String(Math.max(1, Number(page || 1))));
  url.searchParams.set("count", String(Math.max(1, Number(count || YOTPO_REVIEW_PAGE_SIZE))));

  const response = await fetchYotpoAuthorizedJson(url, { token, fetchImpl, timeoutMs });
  const reviews = extractYotpoReviews(response.json);
  const pagination = extractYotpoPagination(response.json, reviews.length, Number(count || YOTPO_REVIEW_PAGE_SIZE));

  return {
    reviews,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalReviews: pagination.totalReviews,
  };
}

export function extractYotpoReviews(json = {}) {
  const response = json?.response;
  const data = json?.data;
  const candidates = [
    response?.reviews,
    data?.reviews,
    json?.reviews,
    response?.review ? [response.review] : null,
    data?.review ? [data.review] : null,
    json?.review ? [json.review] : null,
    Array.isArray(response) ? response : null,
    Array.isArray(data) ? data : null,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

export function getSafeYotpoConnectionErrorMessage(error) {
  if (error instanceof YotpoConnectionError) return error.message;
  if (error?.name === "AbortError") return "Yotpo did not respond before the connection test timed out.";
  return "ProductPulse could not verify Yotpo Reviews right now. Check the Store ID/App Key and API secret, then try again.";
}

function extractYotpoToken(json = {}) {
  return normalizeYotpoCredential(
    json.access_token
      || json.accessToken
      || json.utoken
      || json.token
      || json.response?.access_token
      || json.response?.utoken,
  );
}

async function fetchYotpoAuthorizedJson(url, { token, fetchImpl, timeoutMs } = {}) {
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-Yotpo-Token": token,
    },
  };

  try {
    return await fetchJson(url, { ...options, fetchImpl, timeoutMs });
  } catch (error) {
    if (!(error instanceof YotpoConnectionError) || ![401, 403].includes(Number(error.status || 0))) {
      throw error;
    }

    const retryUrl = new URL(String(url));
    retryUrl.searchParams.set("utoken", token);
    return fetchJson(retryUrl, { ...options, fetchImpl, timeoutMs });
  }
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
      throw new YotpoConnectionError(getYotpoHttpErrorMessage(response.status, json), {
        code: getYotpoErrorCode(response.status),
        status: response.status,
        details: summarizeYotpoResponse(json),
      });
    }

    return { status: response.status, json };
  } catch (error) {
    if (error instanceof YotpoConnectionError) throw error;
    if (error?.name === "AbortError") throw error;
    throw new YotpoConnectionError("ProductPulse could not reach Yotpo Reviews. Check network access and try again.", {
      code: "YOTPO_NETWORK_ERROR",
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getYotpoHttpErrorMessage(status, json = {}) {
  const providerMessage = String(json?.error_description || json?.error || json?.message || json?.response?.message || "").trim();
  if (status === 400) return providerMessage || "Yotpo rejected the credentials. Check the API secret and grant type.";
  if (status === 401 || status === 403) return providerMessage || "Yotpo rejected the token while testing review access.";
  if (status === 404) return providerMessage || "Yotpo could not find that Store ID/App Key.";
  return providerMessage || `Yotpo request failed with HTTP ${status}.`;
}

function getYotpoErrorCode(status) {
  if (status === 400) return "YOTPO_AUTH_FAILED";
  if (status === 401 || status === 403) return "YOTPO_REVIEW_AUTH_FAILED";
  if (status === 404) return "YOTPO_STORE_NOT_FOUND";
  return "YOTPO_REQUEST_FAILED";
}

function extractYotpoPagination(json = {}, fallbackCount = 0, pageSize = 0) {
  const response = json?.response || {};
  const pagination = json?.pagination || response?.pagination || {};
  const totalReviews = normalizeNonNegativeNumber(
    response.total_reviews
      ?? response.totalReviews
      ?? response.total
      ?? response.bottomline?.total_review
      ?? response.bottomline?.totalReviews
      ?? response.bottomline?.total
      ?? pagination.total
      ?? json.total_reviews
      ?? json.total
      ?? json.bottomline?.total_review
      ?? fallbackCount,
  );
  const explicitTotalPages = normalizePositiveNumber(response.total_pages ?? response.totalPages ?? pagination.total_pages ?? pagination.totalPages);
  return {
    currentPage: normalizePositiveNumber(response.current_page ?? response.currentPage ?? pagination.current_page ?? pagination.currentPage),
    totalPages: explicitTotalPages || (pageSize > 0 && totalReviews > 0 ? Math.ceil(totalReviews / pageSize) : null),
    totalReviews,
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

function normalizeYotpoCredential(value) {
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

function summarizeYotpoResponse(json = {}) {
  const summary = {};
  ["error", "error_description", "message", "status"].forEach((key) => {
    if (json?.[key]) summary[key] = String(json[key]).slice(0, 300);
  });
  if (json?.response?.message) summary.message = String(json.response.message).slice(0, 300);
  return Object.keys(summary).length ? summary : null;
}
