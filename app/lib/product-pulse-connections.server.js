import prisma from "../db.server";
import {
  buildConnectViewData,
  connectSourceDefinitions,
  getConnectCategoryDefinition,
  getConnectSourceDefinition,
} from "./product-pulse-connect";

export async function getConnectViewDataForShop(shop) {
  await ensureSourceRows(shop);
  const records = await prisma.productPulseSource.findMany({
    where: { shop },
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

export async function uploadCsvReviews(shop, file) {
  const fileName = typeof file?.name === "string" && file.name ? file.name : "reviews.csv";
  const now = new Date();
  await upsertSource(shop, "csvReviews", {
    connected: true,
    active: true,
    ignored: false,
    available: true,
    health: "connected",
    config: {
      fileName,
      uploadedAt: now.toISOString(),
    },
    connectedAt: now,
    disabledAt: null,
    lastSyncedAt: now,
  });

  return { status: "success", message: `${fileName} is ready for review analysis.`, providerKey: "csvReviews" };
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
    health: active ? "connected" : "paused",
    disabledAt: active ? null : new Date(),
  });

  return {
    status: "success",
    message: `${definition.name} is now ${active ? "active" : "paused"}.`,
    providerKey: sourceKey,
  };
}

export async function setCategoryIgnored(shop, categoryId, ignored) {
  const category = getConnectCategoryDefinition(categoryId);
  if (!category) {
    return { status: "validation_error", message: "Unknown source category." };
  }

  await ensureSourceRows(shop);
  const sourceKeys = connectSourceDefinitions
    .filter((source) => source.categoryId === categoryId && !source.locked)
    .map((source) => source.key);

  await prisma.productPulseSource.updateMany({
    where: { shop, sourceKey: { in: sourceKeys } },
    data: { ignored },
  });

  return {
    status: "success",
    message: ignored
      ? `${category.title} will be ignored in coverage scoring.`
      : `${category.title} is back in coverage scoring.`,
    categoryId,
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
    ignored: record.ignored,
    available: record.available,
    health: record.health,
    coverageWeight: record.coverageWeight,
    config: record.config,
    connectedAt: record.connectedAt,
    disabledAt: record.disabledAt,
    lastSyncedAt: record.lastSyncedAt,
  };
}
