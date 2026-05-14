import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../db.server";

const REQUIRED_MAPPING_FIELDS = ["review_body", "rating"];
const PRODUCT_RELATION_FIELDS = ["product_handle", "shopify_product_id"];
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

export async function processCsvReviewUpload({ shop, file }) {
  const fileName = typeof file?.name === "string" && file.name ? file.name : "reviews.csv";
  if (!file || typeof file.text !== "function") {
    throw new CsvReviewImportError("No se pudo cargar el CSV porque no se recibió ningún archivo.", "CSV_FILE_MISSING");
  }

  const csvText = await file.text();
  const checksum = createHash("sha256").update(csvText).digest("hex");
  const parsed = parseCsvText(csvText);
  const mapping = await inferCsvReviewColumnMapping(parsed.headers);
  const validation = validateCsvReviewColumnMapping(mapping, parsed.headers);
  if (!validation.valid) {
    throw new CsvReviewImportError(
      `No se pudo procesar el CSV: ${validation.message}`,
      "CSV_REQUIRED_COLUMNS_MISSING",
      { missing: validation.missing, mapping },
    );
  }

  const normalized = normalizeCsvReviewRows({
    rows: parsed.rows,
    mapping: validation.mapping,
  });

  if (!normalized.rows.length) {
    throw new CsvReviewImportError(
      "No se pudo procesar el CSV: no se encontró ninguna review con texto, rating y relación válida con un producto de Shopify.",
      "CSV_NO_VALID_REVIEW_ROWS",
      { totalRows: parsed.rows.length, rejectedRows: normalized.rejectedRows },
    );
  }

  const saved = await saveNormalizedCsvReviews({ shop, rows: normalized.rows });

  return {
    fileName,
    checksum,
    headers: parsed.headers,
    mapping: validation.mapping,
    totalRows: parsed.rows.length,
    normalizedRowCount: normalized.rows.length,
    rejectedRows: normalized.rejectedRows,
    normalizedFilePath: saved.filePath,
    storageKey: saved.storageKey,
  };
}

export async function getNormalizedCsvReviewRatingsForShop(shop) {
  if (!shop) return [];
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  }).catch(() => null);

  const filePath = source?.config?.normalizedFilePath;
  if (!source?.connected || !source.active || !filePath) return [];

  const csvText = await readFile(filePath, "utf8");
  const parsed = parseCsvText(csvText);
  return parsed.rows.map((row) => ({
    productHandle: cleanScalar(row.values.product_handle),
    shopifyProductId: cleanScalar(row.values.shopify_product_id),
    rating: Number(normalizeRating(row.values.rating)),
    reviewDate: cleanScalar(row.values.review_date),
  })).filter((row) => Number.isFinite(row.rating) && row.rating > 0 && (row.productHandle || row.shopifyProductId));
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

export async function inferCsvReviewColumnMapping(headers) {
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
      const text = await requestOpenAiCsvMapping({ apiKey, model, prompt });
      return parseJsonObject(text);
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
  return text;
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

function normalizeRating(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return "";
  const rating = Number(match[0].replace(",", "."));
  if (!Number.isFinite(rating) || rating <= 0) return "";
  return String(Math.min(5, rating));
}

async function saveNormalizedCsvReviews({ shop, rows }) {
  const storageRoot = process.env.PRODUCT_PULSE_CSV_STORAGE_DIR
    || path.join(process.cwd(), ".cache", "product-pulse", "csv-reviews");
  const storageKey = sanitizeStorageSegment(shop || "unknown-shop");
  const shopDir = path.join(storageRoot, storageKey);
  const filePath = path.join(shopDir, "reviews.normalized.csv");
  const tmpPath = `${filePath}.${Date.now()}.tmp`;

  await mkdir(shopDir, { recursive: true });
  await writeFile(tmpPath, serializeCsvRows(rows), "utf8");
  await rename(tmpPath, filePath);

  return { filePath, storageKey };
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
