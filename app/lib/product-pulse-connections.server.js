import prisma from "../db.server";
import {
  buildConnectViewData,
  connectSourceDefinitions,
  getConnectSourceDefinition,
} from "./product-pulse-connect";
import {
  CSV_REVIEW_IMPORT_DISPLAY_NAME,
  CsvReviewImportError,
  analyzeCsvReviewUpload,
  finalizeCsvReviewUpload,
  processCsvReviewUpload,
} from "./product-pulse-csv.server";
import { PRODUCT_PULSE_SETTINGS_SOURCE_KEY } from "./product-pulse-settings.server";

export async function getConnectViewDataForShop(shop) {
  await ensureSourceRows(shop);
  const records = await prisma.productPulseSource.findMany({
    where: { shop, sourceKey: { not: PRODUCT_PULSE_SETTINGS_SOURCE_KEY } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return buildConnectViewData(records.map(toClientRecord));
}

export async function connectJudgeMeReviews(shop, privateApiToken) {
  const token = String(privateApiToken || "").trim();
  if (!token) {
    return { status: "validation_error", message: "Enter the Judge.me private API token before connecting." };
  }
  if (token.length < 8) {
    return { status: "validation_error", message: "The Judge.me private API token looks too short." };
  }

  const now = new Date();
  await upsertSource(shop, "judgemeReviews", {
    connected: true,
    active: true,
    ignored: false,
    available: true,
    health: "connected",
    credentials: { privateApiToken: token },
    config: {
      tokenLast4: token.slice(-4),
      connectedBy: "manual",
      provider: "Judge.me Reviews",
    },
    connectedAt: now,
    disabledAt: null,
    lastSyncedAt: now,
  });

  return { status: "success", message: "Connected to Judge.me.", providerKey: "judgemeReviews" };
}

export async function connectChatMeReviews(shop, privateApiToken) {
  const token = String(privateApiToken || "").trim();
  if (!token) {
    return { status: "validation_error", message: "Enter the ChatMe private API token before connecting." };
  }
  if (token.length < 8) {
    return { status: "validation_error", message: "The ChatMe private API token looks too short." };
  }

  const now = new Date();
  await upsertSource(shop, "chatmeReviews", {
    connected: true,
    active: true,
    ignored: false,
    available: true,
    health: "connected",
    credentials: { privateApiToken: token },
    config: {
      tokenLast4: token.slice(-4),
      connectedBy: "manual",
      provider: "ChatMe Reviews",
    },
    connectedAt: now,
    disabledAt: null,
    lastSyncedAt: now,
  });

  return { status: "success", message: "Connected to ChatMe.", providerKey: "chatmeReviews" };
}

export async function previewCsvReviews(shop, file, { admin } = {}) {
  const fileName = CSV_REVIEW_IMPORT_DISPLAY_NAME;
  try {
    const result = await analyzeCsvReviewUpload({ shop, file, admin });
    const displayFileName = result.displayFileName || CSV_REVIEW_IMPORT_DISPLAY_NAME;
    return {
      status: "csv_preview",
      message: `${displayFileName} was analyzed. Review the preview before saving it.`,
      providerKey: "csvReviews",
      csvPreview: buildCsvPreviewActionPayload(result),
    };
  } catch (error) {
    return {
      status: error instanceof CsvReviewImportError ? "validation_error" : "error",
      message: error instanceof CsvReviewImportError
        ? error.message
        : `No se pudo procesar ${fileName}. ${error?.message || "Intentalo de nuevo más tarde."}`,
      providerKey: "csvReviews",
      errorCode: error?.code || "CSV_IMPORT_FAILED",
      errorDetails: error?.details || null,
    };
  }
}

export async function confirmCsvReviews(shop, preview) {
  const fileName = CSV_REVIEW_IMPORT_DISPLAY_NAME;
  try {
    const result = await finalizeCsvReviewUpload({ shop, preview });
    return saveCsvReviewSource(shop, result);
  } catch (error) {
    return {
      status: error instanceof CsvReviewImportError ? "validation_error" : "error",
      message: error instanceof CsvReviewImportError
        ? error.message
        : `No se pudo guardar ${fileName}. ${error?.message || "Intentalo de nuevo más tarde."}`,
      providerKey: "csvReviews",
      errorCode: error?.code || "CSV_CONFIRM_FAILED",
      errorDetails: error?.details || null,
    };
  }
}

export async function uploadCsvReviews(shop, file, { admin } = {}) {
  const fileName = CSV_REVIEW_IMPORT_DISPLAY_NAME;
  try {
    const result = await processCsvReviewUpload({ shop, file, admin });
    return saveCsvReviewSource(shop, result);
  } catch (error) {
    return {
      status: error instanceof CsvReviewImportError ? "validation_error" : "error",
      message: error instanceof CsvReviewImportError
        ? error.message
        : `No se pudo procesar ${fileName}. ${error?.message || "Intentalo de nuevo más tarde."}`,
      providerKey: "csvReviews",
      errorCode: error?.code || "CSV_IMPORT_FAILED",
    };
  }
}

async function saveCsvReviewSource(shop, result) {
    const displayFileName = result.displayFileName || CSV_REVIEW_IMPORT_DISPLAY_NAME;
    const now = new Date();
    await upsertSource(shop, "csvReviews", {
      connected: true,
      active: true,
      ignored: false,
      available: true,
      health: "connected",
      config: {
        fileName: displayFileName,
        displayFileName,
        originalFileName: result.fileName,
        uploadedAt: now.toISOString(),
        checksum: result.checksum,
        normalizedFilePath: result.normalizedFilePath,
        normalizedFileName: result.normalizedFileName,
        importId: result.importId,
        storageKey: result.storageKey,
        normalizedRowCount: result.normalizedRowCount,
        totalRowCount: result.totalRows,
        rejectedRowCount: getCsvRejectedRowCount(result),
        mappedColumns: result.mapping,
        originalHeaders: result.headers,
        productRelation: result.productRelation || null,
      },
      connectedAt: now,
      disabledAt: null,
      lastSyncedAt: now,
    });

    return {
      status: "success",
      message: `${displayFileName} was processed and ${result.normalizedRowCount} review row${result.normalizedRowCount === 1 ? "" : "s"} were normalized.`,
      providerKey: "csvReviews",
      csvImport: {
        rows: result.normalizedRowCount,
        rejectedRows: getCsvRejectedRowCount(result),
        normalizedFilePath: result.normalizedFilePath,
      },
    };
}

function getCsvRejectedRowCount(result = {}) {
  const explicit = Number(result.rejectedRowCount);
  if (Number.isFinite(explicit)) return explicit;
  return Array.isArray(result.rejectedRows) ? result.rejectedRows.length : 0;
}

function buildCsvPreviewActionPayload(result) {
  return {
    fileName: result.fileName,
    displayFileName: result.displayFileName,
    checksum: result.checksum,
    headers: result.headers,
    mapping: result.mapping,
    productRelation: result.productRelation || null,
    totalRows: result.totalRows,
    normalizedRowCount: result.normalizedRowCount,
    rejectedRowCount: result.rejectedRows.length,
    rejectedRows: result.rejectedRows.slice(0, 10),
    previewRows: result.previewRows,
    normalizedFileName: result.normalizedFileName,
    importId: result.importId,
    storageKey: result.storageKey,
  };
}

export async function setSourceActive(shop, sourceKey, active) {
  const definition = getConnectSourceDefinition(sourceKey);
  if (!definition || definition.locked) {
    return { status: "validation_error", message: "This source cannot be changed." };
  }

  const existing = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey } },
  });
  if (!existing?.connected) {
    return { status: "validation_error", message: "Connect this source before changing its active state." };
  }

  await upsertSource(shop, sourceKey, {
    active,
    health: active ? "connected" : "disabled",
    disabledAt: active ? null : new Date(),
  });

  return {
    status: "success",
    message: `${definition.name} is now ${active ? "active" : "disabled"}.`,
    providerKey: sourceKey,
  };
}

async function ensureSourceRows(shop) {
  await prisma.$transaction(
    connectSourceDefinitions.map((definition) =>
      prisma.productPulseSource.upsert({
        where: { shop_sourceKey: { shop, sourceKey: definition.key } },
        create: {
          shop,
          sourceKey: definition.key,
          category: definition.categoryId,
          name: definition.name,
          connected: Boolean(definition.defaultConnected),
          active: definition.defaultActive ?? true,
          ignored: false,
          available: Boolean(definition.available),
          health: definition.defaultConnected ? "connected" : "not_connected",
          coverageWeight: definition.categoryWeight || 0,
          connectedAt: definition.defaultConnected ? new Date() : null,
          lastSyncedAt: definition.defaultConnected ? new Date() : null,
        },
        update: {
          category: definition.categoryId,
          name: definition.name,
          available: Boolean(definition.available),
          coverageWeight: definition.categoryWeight || 0,
        },
      }),
    ),
  );

  await prisma.productPulseSource.updateMany({
    where: { shop, ignored: true },
    data: { ignored: false },
  });
}

async function upsertSource(shop, sourceKey, data) {
  const definition = getConnectSourceDefinition(sourceKey);
  if (!definition) throw new Error(`Unknown source key: ${sourceKey}`);

  return prisma.productPulseSource.upsert({
    where: { shop_sourceKey: { shop, sourceKey } },
    create: {
      shop,
      sourceKey,
      category: definition.categoryId,
      name: definition.name,
      connected: Boolean(definition.defaultConnected),
      active: definition.defaultActive ?? true,
      ignored: false,
      available: Boolean(definition.available),
      health: definition.defaultConnected ? "connected" : "not_connected",
      coverageWeight: definition.categoryWeight || 0,
      ...data,
    },
    update: {
      category: definition.categoryId,
      name: definition.name,
      available: Boolean(definition.available),
      coverageWeight: definition.categoryWeight || 0,
      ...data,
    },
  });
}

function toClientRecord(record) {
  return {
    sourceKey: record.sourceKey,
    category: record.category,
    name: record.name,
    connected: record.connected,
    active: record.active,
    ignored: false,
    available: record.available,
    health: record.health,
    coverageWeight: record.coverageWeight,
    config: record.config,
    connectedAt: record.connectedAt,
    disabledAt: record.disabledAt,
    lastSyncedAt: record.lastSyncedAt,
  };
}
