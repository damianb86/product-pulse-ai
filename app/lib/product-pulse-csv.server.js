import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../db.server";
import { recordAiUsageEvent } from "../ai/observability/usageEvents.server";

const REQUIRED_MAPPING_FIELDS = ["review_body", "rating"];
const PRODUCT_RELATION_FIELDS = ["product_handle", "shopify_product_id"];
export const CSV_REVIEW_IMPORT_DISPLAY_NAME = "CSV import";
const NORMALIZED_COLUMNS = [
  "source_row",
  "product_handle",
  "shopify_product_id",
  "rating",
  "review_title",
  "review_body",
  "review_date",
  "reviewer_name",
  "review_status",
  "source_product_id",
];

export class CsvReviewImportError extends Error {
  constructor(message, code = "CSV_IMPORT_FAILED", details = {}) {
    super(message);
    this.name = "CsvReviewImportError";
    this.code = code;
    this.details = details;
  }
}

export async function processCsvReviewUpload({ shop, file, admin } = {}) {
  return analyzeCsvReviewUpload({ shop, file, admin });
}

export async function analyzeCsvReviewUpload({ shop, file, admin } = {}) {
  const fileName = normalizeUploadedCsvFileName(typeof file?.name === "string" && file.name ? file.name : "reviews.csv");
  if (!file || typeof file.text !== "function") {
    throw new CsvReviewImportError("No se pudo cargar el CSV porque no se recibió ningún archivo.", "CSV_FILE_MISSING");
  }

  const csvText = await file.text();
  const checksum = createHash("sha256").update(csvText).digest("hex");
  const parsed = parseCsvText(csvText);
  const mapping = await inferCsvReviewColumnMapping(parsed.headers, { shop });
  const validation = validateCsvReviewColumnMapping(mapping, parsed.headers);
  if (!validation.valid) {
    throw new CsvReviewImportError(
      `No se pudo procesar el CSV: ${validation.message}`,
      "CSV_REQUIRED_COLUMNS_MISSING",
      { missing: validation.missing, mapping },
    );
  }

  const productRelation = await resolveCsvProductRelationMapping({
    admin,
    headers: parsed.headers,
    rows: parsed.rows,
    mapping: validation.mapping,
  });
  if (!productRelation.valid) {
    throw new CsvReviewImportError(
      productRelation.message || "No se pudo confirmar ninguna columna que conecte las reviews con productos de Shopify.",
      "CSV_PRODUCT_RELATION_NOT_FOUND",
      { mapping: validation.mapping, candidates: productRelation.candidates },
    );
  }

  const normalized = normalizeCsvReviewRows({
    rows: parsed.rows,
    mapping: productRelation.mapping,
  });

  if (!normalized.rows.length) {
    throw new CsvReviewImportError(
      "No se pudo procesar el CSV: no se encontró ninguna review con texto, rating y relación válida con un producto de Shopify.",
      "CSV_NO_VALID_REVIEW_ROWS",
      { totalRows: parsed.rows.length, rejectedRows: normalized.rejectedRows },
    );
  }

  const saved = await saveNormalizedCsvReviews({ shop, rows: normalized.rows, checksum });

  return {
    fileName,
    displayFileName: CSV_REVIEW_IMPORT_DISPLAY_NAME,
    checksum,
    headers: parsed.headers,
    mapping: productRelation.mapping,
    productRelation: productRelation.summary,
    totalRows: parsed.rows.length,
    normalizedRowCount: normalized.rows.length,
    rejectedRows: normalized.rejectedRows,
    previewRows: buildCsvReviewPreviewRows(normalized.rows),
    normalizedFilePath: saved.filePath,
    normalizedFileName: saved.fileName,
    importId: saved.importId,
    storageKey: saved.storageKey,
  };
}

export async function finalizeCsvReviewUpload({ shop, preview }) {
  const pending = parseCsvImportPreviewPayload(preview);
  const expectedStorageKey = sanitizeStorageSegment(shop || "unknown-shop");
  const storageKey = sanitizeStorageSegment(pending.storageKey || expectedStorageKey);
  if (storageKey !== expectedStorageKey) {
    throw new CsvReviewImportError("No se pudo confirmar el CSV porque la previsualización no corresponde a esta tienda.", "CSV_PREVIEW_INVALID");
  }
  const fileName = String(pending.normalizedFileName || "").trim();
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new CsvReviewImportError("No se pudo confirmar el CSV porque falta el archivo normalizado.", "CSV_PREVIEW_INVALID");
  }

  const filePath = getNormalizedCsvStoragePath({ shop, storageKey, fileName });
  const csvText = await readFile(filePath, "utf8").catch(() => {
    throw new CsvReviewImportError("No se pudo confirmar el CSV porque el análisis expiró o no está disponible. Volvé a subir el archivo.", "CSV_PREVIEW_EXPIRED");
  });
  const parsed = parseCsvText(csvText);
  const normalizedRowCount = parsed.rows.length;
  if (!normalizedRowCount) {
    throw new CsvReviewImportError("No se pudo confirmar el CSV porque no hay reviews normalizadas.", "CSV_PREVIEW_EMPTY");
  }

  return {
    fileName: pending.fileName || CSV_REVIEW_IMPORT_DISPLAY_NAME,
    displayFileName: pending.displayFileName || CSV_REVIEW_IMPORT_DISPLAY_NAME,
    checksum: pending.checksum || "",
    headers: Array.isArray(pending.headers) ? pending.headers : [],
    mapping: pending.mapping || {},
    productRelation: pending.productRelation || null,
    totalRows: Number(pending.totalRows || normalizedRowCount),
    normalizedRowCount,
    rejectedRowCount: Number(pending.rejectedRowCount || 0),
    rejectedRows: Array.isArray(pending.rejectedRows) ? pending.rejectedRows : [],
    previewRows: Array.isArray(pending.previewRows) ? pending.previewRows : [],
    normalizedFilePath: filePath,
    normalizedFileName: fileName,
    importId: pending.importId || fileName.replace(/\.normalized\.csv$/i, ""),
    storageKey,
  };
}

export async function getNormalizedCsvReviewRatingsForShop(shop) {
  const rows = await getNormalizedCsvReviewsForShop(shop);
  return rows.map((row) => ({
    productHandle: row.productHandle,
    shopifyProductId: row.shopifyProductId,
    rating: row.rating,
    reviewDate: row.reviewDate,
  }));
}

export async function getCsvReviewSourceStatusForShop(shop) {
  if (!shop) return { available: false, connected: false, active: false, rowCount: 0 };
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  }).catch(() => null);
  const config = source?.config || {};
  const rowCount = Number(config.normalizedRowCount || 0);
  const filePath = String(config.normalizedFilePath || "").trim();

  return {
    available: Boolean(source?.connected && source.active && filePath && rowCount > 0),
    connected: Boolean(source?.connected),
    active: Boolean(source?.active),
    rowCount,
    fileName: config.displayFileName || config.fileName || CSV_REVIEW_IMPORT_DISPLAY_NAME,
    uploadedAt: config.uploadedAt || source?.lastSyncedAt || null,
  };
}

export async function getNormalizedCsvReviewsForShop(shop) {
  if (!shop) return [];
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  }).catch(() => null);

  const filePath = source?.config?.normalizedFilePath;
  if (!source?.connected || !source.active || !filePath) return [];

  const csvText = await readFile(filePath, "utf8");
  const parsed = parseCsvText(csvText);
  return parsed.rows.map((row) => ({
    id: `csv-review-${row.sourceRow}`,
    sourceRow: row.sourceRow,
    productHandle: cleanScalar(row.values.product_handle),
    shopifyProductId: cleanScalar(row.values.shopify_product_id),
    rating: Number(normalizeRating(row.values.rating)),
    reviewTitle: cleanText(row.values.review_title),
    reviewBody: cleanText(row.values.review_body),
    reviewDate: cleanScalar(row.values.review_date),
    reviewerName: cleanScalar(row.values.reviewer_name),
    reviewStatus: cleanScalar(row.values.review_status),
    sourceProductId: cleanScalar(row.values.source_product_id),
  })).filter((row) => (
    Number.isFinite(row.rating)
      && row.rating > 0
      && (row.productHandle || row.shopifyProductId)
      && (row.reviewBody || row.reviewTitle)
  ));
}

export function parseCsvText(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text.trim()) {
    throw new CsvReviewImportError("El CSV está vacío.", "CSV_EMPTY");
  }

  const records = parseCsvRecords(text);
  if (records.length < 2) {
    throw new CsvReviewImportError("El CSV debe incluir headers y al menos una fila de reviews.", "CSV_NO_ROWS");
  }

  const headers = records[0].map((header, index) => normalizeHeaderName(header) || `column_${index + 1}`);
  const rows = records.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row, rowIndex) => ({
      sourceRow: rowIndex + 2,
      values: headers.reduce((values, header, index) => {
        values[header] = row[index] == null ? "" : String(row[index]);
        return values;
      }, {}),
    }));

  if (!headers.some(Boolean)) {
    throw new CsvReviewImportError("El CSV no tiene nombres de columnas legibles.", "CSV_HEADERS_MISSING");
  }
  if (!rows.length) {
    throw new CsvReviewImportError("El CSV no contiene filas de reviews.", "CSV_NO_ROWS");
  }

  return { headers, rows };
}

function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      records.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.replace(/\r$/, ""));
  if (row.length > 1 || row[0].trim()) records.push(row);
  return records;
}

export async function inferCsvReviewColumnMapping(headers, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new CsvReviewImportError("No se pudo analizar el CSV porque OPENAI_API_KEY no está configurada.", "OPENAI_API_KEY_MISSING");
  }

  const prompt = buildCsvReviewColumnMappingPrompt(headers);
  const models = [
    String(process.env.OPENAI_PRO_MODEL || "").trim() || "gpt-5.4-mini",
    String(process.env.OPENAI_PREMIUM_MODEL || "").trim() || "gpt-5.4",
  ].filter((model, index, modelsList) => model && modelsList.indexOf(model) === index);

  let lastError = null;
  for (const model of models) {
    try {
      const result = await requestOpenAiCsvMapping({ apiKey, model, prompt });
      await recordAiUsageEvent({
        shop: options.shop,
        source: "csv_import",
        operation: "csv_column_mapping",
        provider: "openai",
        model,
        task: "csv_column_mapping",
        usage: result.usage,
      });
      return parseJsonObject(result.text);
    } catch (error) {
      lastError = error;
    }
  }

  throw new CsvReviewImportError(
    `No se pudo analizar el CSV con IA. ${lastError?.message || "Intentalo de nuevo más tarde."}`,
    "CSV_AI_MAPPING_FAILED",
    { error: lastError?.message },
  );
}

export function buildCsvReviewColumnMappingPrompt(headers) {
  return [
    "You are mapping CSV column headers for a Shopify product review import.",
    "Only column names are provided. Do not infer from row data because row data is intentionally not included.",
    "Choose columns that can normalize reviews and connect each review to a Shopify product.",
    "",
    "Required output JSON shape:",
    JSON.stringify({
      product_handle: "exact header name or null",
      shopify_product_id: "exact header name or null",
      rating: "exact header name or null",
      review_body: "exact header name or null",
      review_title: "exact header name or null",
      review_date: "exact header name or null",
      reviewer_name: "exact header name or null",
      review_status: "exact header name or null",
      source_product_id: "exact header name or null",
      confidence: 0.0,
      notes: "short explanation",
    }, null, 2),
    "",
    "Rules:",
    "- product_handle is preferred when a header clearly means Shopify product handle, product slug, product URL handle, or handle.",
    "- shopify_product_id is acceptable when a header clearly means Shopify product ID, external product ID, external_id, platform_product_id, product_gid, or Shopify GID.",
    "- Do not use a review-platform internal product id as shopify_product_id. Put that in source_product_id.",
    "- review_body must be the customer review text/body/content/comment/message.",
    "- rating must be the review rating/stars/score.",
    "- If a required meaning is not present, return null for that field.",
    "- Return only JSON. No markdown.",
    "",
    "CSV headers:",
    JSON.stringify(headers),
  ].join("\n");
}

async function requestOpenAiCsvMapping({ apiKey, model, prompt }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 900,
      temperature: 0,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error?.message || `OpenAI request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = json.error?.code || json.error?.type || null;
    error.details = json.error || null;
    throw error;
  }

  const text = extractOpenAiText(json);
  if (!text) throw new Error("OpenAI returned an empty CSV column mapping.");
  return {
    text,
    usage: json.usage || null,
  };
}

function extractOpenAiText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    objectStart >= 0 && objectEnd > objectStart ? raw.slice(objectStart, objectEnd + 1) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next JSON shape.
    }
  }

  throw new CsvReviewImportError("La IA no devolvió un mapeo de columnas válido.", "CSV_AI_MAPPING_INVALID", { raw: raw.slice(0, 1000) });
}

export function validateCsvReviewColumnMapping(mapping, headers) {
  const normalizedMapping = normalizeMappingToHeaders(mapping, headers);
  const missing = [];

  for (const field of REQUIRED_MAPPING_FIELDS) {
    if (!normalizedMapping[field]) missing.push(getColumnRequirementLabel(field));
  }

  if (!PRODUCT_RELATION_FIELDS.some((field) => normalizedMapping[field])) {
    missing.push("product handle o Shopify product ID");
  }

  const confidence = Number(mapping?.confidence ?? 1);
  if (Number.isFinite(confidence) && confidence < 0.45) {
    missing.push("mapeo con confianza suficiente");
  }

  return {
    valid: missing.length === 0,
    missing,
    mapping: normalizedMapping,
    message: missing.length ? `faltan columnas requeridas (${missing.join(", ")}).` : "Column mapping is valid.",
  };
}

function normalizeMappingToHeaders(mapping, headers) {
  const headerMap = new Map(headers.map((header) => [normalizeHeaderLookup(header), header]));
  const fields = [
    "product_handle",
    "shopify_product_id",
    "rating",
    "review_body",
    "review_title",
    "review_date",
    "reviewer_name",
    "review_status",
    "source_product_id",
  ];

  return fields.reduce((normalized, field) => {
    normalized[field] = resolveHeaderName(mapping?.[field], headerMap);
    return normalized;
  }, {});
}

function resolveHeaderName(value, headerMap) {
  if (!value) return null;
  const direct = headerMap.get(normalizeHeaderLookup(value));
  return direct || null;
}

function getColumnRequirementLabel(field) {
  if (field === "review_body") return "texto de la review";
  if (field === "rating") return "rating";
  return field;
}

export function normalizeCsvReviewRows({ rows, mapping }) {
  const normalizedRows = [];
  const rejectedRows = [];

  for (const row of rows) {
    const productHandle = cleanScalar(getMappedValue(row, mapping.product_handle));
    const shopifyProductId = cleanScalar(getMappedValue(row, mapping.shopify_product_id));
    const reviewBody = cleanText(getMappedValue(row, mapping.review_body));
    const rating = normalizeRating(getMappedValue(row, mapping.rating));

    if ((!productHandle && !shopifyProductId) || !reviewBody || !rating) {
      rejectedRows.push({
        sourceRow: row.sourceRow,
        reason: !productHandle && !shopifyProductId
          ? "missing_product_relation"
          : !reviewBody
            ? "missing_review_text"
            : "missing_rating",
      });
      continue;
    }

    normalizedRows.push({
      source_row: String(row.sourceRow),
      product_handle: productHandle,
      shopify_product_id: shopifyProductId,
      rating,
      review_title: cleanText(getMappedValue(row, mapping.review_title)),
      review_body: reviewBody,
      review_date: cleanScalar(getMappedValue(row, mapping.review_date)),
      reviewer_name: cleanScalar(getMappedValue(row, mapping.reviewer_name)),
      review_status: cleanScalar(getMappedValue(row, mapping.review_status)),
      source_product_id: cleanScalar(getMappedValue(row, mapping.source_product_id)),
    });
  }

  return { rows: normalizedRows, rejectedRows };
}

async function resolveCsvProductRelationMapping({ admin, headers = [], rows = [], mapping = {} } = {}) {
  if (!admin?.graphql) {
    return {
      valid: true,
      mapping,
      summary: {
        status: "not_checked",
        label: "Product relation not verified",
        detail: "Shopify product matching was skipped because no Admin API client was available.",
      },
    };
  }

  const candidates = buildCsvProductRelationCandidates({ headers, mapping });
  const candidateSummaries = [];
  for (const candidate of candidates) {
    const values = collectRecentCsvColumnValues(rows, candidate.header, 10, candidate.type);
    if (!values.length) {
      candidateSummaries.push({ ...candidate, tested: 0, matched: 0 });
      continue;
    }

    let matchedProduct = null;
    let tested = 0;
    for (const value of values) {
      tested += 1;
      matchedProduct = candidate.type === "product_handle"
        ? await fetchShopifyProductByHandle(admin, value)
        : await fetchShopifyProductById(admin, value);
      if (matchedProduct) break;
    }

    candidateSummaries.push({
      ...candidate,
      tested,
      matched: matchedProduct ? 1 : 0,
      matchedValue: matchedProduct ? values[tested - 1] : "",
      matchedProduct,
    });

    if (matchedProduct) {
      const resolvedMapping = {
        ...mapping,
        product_handle: candidate.type === "product_handle" ? candidate.header : null,
        shopify_product_id: candidate.type === "shopify_product_id" ? candidate.header : null,
      };
      return {
        valid: true,
        mapping: resolvedMapping,
        candidates: candidateSummaries,
        summary: {
          status: "confirmed",
          field: candidate.type,
          header: candidate.header,
          tested,
          sampleValue: values[tested - 1],
          matchedProduct,
          label: candidate.type === "product_handle" ? "Shopify product handle confirmed" : "Shopify product ID confirmed",
          detail: `Matched ${candidate.header} to ${matchedProduct.title || matchedProduct.handle || matchedProduct.id}.`,
        },
      };
    }
  }

  return {
    valid: false,
    mapping,
    candidates: candidateSummaries,
    message: "No se pudo confirmar una columna de producto en Shopify. Probá incluir una columna product_handle con el handle de Shopify o shopify_product_id con el ID/GID del producto.",
  };
}

function buildCsvProductRelationCandidates({ headers = [], mapping = {} } = {}) {
  const candidates = [];
  const addCandidate = (type, header, priority) => {
    const normalizedHeader = normalizeHeaderLookup(header);
    if (!normalizedHeader) return;
    if (!headers.some((item) => normalizeHeaderLookup(item) === normalizedHeader)) return;
    if (candidates.some((candidate) => candidate.type === type && normalizeHeaderLookup(candidate.header) === normalizedHeader)) return;
    candidates.push({ type, header, priority });
  };

  addCandidate("product_handle", mapping.product_handle, 0);
  headers.forEach((header, index) => {
    if (isProductHandleHeaderCandidate(header)) addCandidate("product_handle", header, 10 + index);
  });

  addCandidate("shopify_product_id", mapping.shopify_product_id, 100);
  headers.forEach((header, index) => {
    if (isShopifyProductIdHeaderCandidate(header)) addCandidate("shopify_product_id", header, 110 + index);
  });
  addCandidate("shopify_product_id", mapping.source_product_id, 190);

  return candidates.sort((a, b) => a.priority - b.priority);
}

function isProductHandleHeaderCandidate(header) {
  const normalized = normalizeHeaderLookup(header).replace(/[_-]+/g, " ");
  if (!normalized) return false;
  if (/\b(review|customer|user|author|source|internal)\b/.test(normalized)) return false;
  return /\b(product\s*)?(handle|slug)\b/.test(normalized) || /\burl handle\b/.test(normalized);
}

function isShopifyProductIdHeaderCandidate(header) {
  const normalized = normalizeHeaderLookup(header).replace(/[_-]+/g, " ");
  if (!normalized) return false;
  if (/\b(review|customer|user|author|order|variant)\b/.test(normalized)) return false;
  if (/\b(source|internal)\b/.test(normalized) && !/\bexternal\b/.test(normalized)) return false;
  return /\bshopify\b.*\bproduct\b.*\bid\b/.test(normalized)
    || /\bproduct\b.*\bgid\b/.test(normalized)
    || /\bplatform\b.*\bproduct\b.*\bid\b/.test(normalized)
    || /\bexternal\b.*\bproduct\b.*\bid\b/.test(normalized)
    || /^product id$/.test(normalized)
    || /^productid$/.test(normalized)
    || /^id$/.test(normalized);
}

function collectRecentCsvColumnValues(rows = [], header, limit = 10, type = "product_handle") {
  const seen = new Set();
  const values = [];
  for (let index = rows.length - 1; index >= 0 && values.length < limit; index -= 1) {
    const rawValue = cleanScalar(getMappedValue(rows[index], header));
    const value = type === "product_handle"
      ? normalizePotentialShopifyHandle(rawValue)
      : normalizePotentialShopifyProductId(rawValue);
    const key = normalizeHeaderLookup(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

function normalizePotentialShopifyHandle(value) {
  const text = cleanScalar(value);
  if (!text || /^gid:\/\/shopify\/Product\//i.test(text)) return "";
  try {
    const url = new URL(text);
    const segments = url.pathname.split("/").filter(Boolean);
    const productIndex = segments.findIndex((segment) => segment.toLowerCase() === "products");
    if (productIndex >= 0 && segments[productIndex + 1]) return cleanScalar(decodeURIComponent(segments[productIndex + 1]));
  } catch {
    // Keep non-URL values as possible handles.
  }
  return text.replace(/^\/+|\/+$/g, "");
}

function normalizePotentialShopifyProductId(value) {
  const text = cleanScalar(value);
  if (!text) return "";
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(text)) return text.replace(/^gid:\/\/shopify\/product\//i, "gid://shopify/Product/");
  const numeric = text.match(/\b\d{4,}\b/);
  if (numeric) return `gid://shopify/Product/${numeric[0]}`;
  return "";
}

async function fetchShopifyProductByHandle(admin, handle) {
  if (!handle) return null;
  const data = await csvShopifyGraphql(admin, `#graphql
    query ProductPulseCsvProductByHandle($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          handle
          title
        }
      }
    }`,
    { query: `handle:${escapeShopifyQueryValue(handle)}` },
  ).catch(() => null);
  return data?.products?.nodes?.[0] || null;
}

async function fetchShopifyProductById(admin, productId) {
  const gid = normalizePotentialShopifyProductId(productId);
  if (!gid) return null;
  const data = await csvShopifyGraphql(admin, `#graphql
    query ProductPulseCsvProductById($id: ID!) {
      product(id: $id) {
        id
        handle
        title
      }
    }`,
    { id: gid },
  ).catch(() => null);
  return data?.product || null;
}

async function csvShopifyGraphql(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

function escapeShopifyQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildCsvReviewPreviewRows(rows = []) {
  return rows.slice(0, 5).map((row) => ({
    sourceRow: row.source_row,
    productHandle: row.product_handle,
    shopifyProductId: row.shopify_product_id,
    rating: row.rating,
    reviewTitle: row.review_title,
    reviewBody: row.review_body,
    reviewDate: row.review_date,
    reviewerName: row.reviewer_name,
    reviewStatus: row.review_status,
    sourceProductId: row.source_product_id,
  }));
}

function parseCsvImportPreviewPayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Throw a normalized import error below.
  }
  throw new CsvReviewImportError("No se pudo confirmar el CSV porque la previsualización no es válida.", "CSV_PREVIEW_INVALID");
}

function getMappedValue(row, header) {
  if (!header) return "";
  return row.values?.[header] ?? "";
}

function cleanScalar(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function normalizeUploadedCsvFileName(value) {
  const text = String(value || "reviews.csv").trim() || "reviews.csv";
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    decoded = text.replace(/%2F/gi, "/").replace(/%20/g, " ");
  }
  return decoded.split(/[\\/]/).filter(Boolean).pop()?.trim() || "reviews.csv";
}

function normalizeRating(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return "";
  const rating = Number(match[0].replace(",", "."));
  if (!Number.isFinite(rating) || rating <= 0) return "";
  return String(Math.min(5, rating));
}

async function saveNormalizedCsvReviews({ shop, rows, checksum }) {
  const storageKey = sanitizeStorageSegment(shop || "unknown-shop");
  const importId = buildNormalizedCsvImportId(checksum);
  const fileName = `${importId}.normalized.csv`;
  const filePath = getNormalizedCsvStoragePath({ shop, storageKey, fileName });
  const shopDir = path.dirname(filePath);
  const tmpPath = `${filePath}.${Date.now()}.tmp`;

  await mkdir(shopDir, { recursive: true });
  await writeFile(tmpPath, serializeCsvRows(rows), "utf8");
  await rename(tmpPath, filePath);

  return { filePath, fileName, importId, storageKey };
}

function getNormalizedCsvStoragePath({ shop, storageKey, fileName }) {
  const storageRoot = process.env.PRODUCT_PULSE_CSV_STORAGE_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "csv-reviews");
  return path.join(storageRoot, sanitizeStorageSegment(storageKey || shop || "unknown-shop"), fileName);
}

function buildNormalizedCsvImportId(checksum) {
  const timestamp = new Date().toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[^0-9TZ]+/g, "")
    .replace("T", "-")
    .replace("Z", "");
  const hash = String(checksum || "").replace(/[^a-f0-9]+/gi, "").slice(0, 12).toLowerCase() || "nohash";
  return `csv-review-import-${timestamp}-${hash}`;
}

export function serializeCsvRows(rows) {
  return [
    NORMALIZED_COLUMNS.join(","),
    ...rows.map((row) => NORMALIZED_COLUMNS.map((column) => escapeCsvCell(row[column])).join(",")),
  ].join("\n");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function sanitizeStorageSegment(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "unknown";
}

function normalizeHeaderName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeHeaderLookup(value) {
  return normalizeHeaderName(value).toLowerCase();
}
