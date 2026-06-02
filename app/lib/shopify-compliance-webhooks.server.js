import db from "../db.server";

const COMPLIANCE_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

const SHOP_REDACTION_DELETE_OPERATIONS = [
  ["aiConversationToolCall", "shop"],
  ["aiConversationMessage", "shop"],
  ["aiConversation", "shop"],
  ["aiUsageEvent", "shop"],
  ["aiActionAuditLog", "shop"],
  ["aiActionProposal", "shop"],
  ["aiAppDraftAuditLog", "shop"],
  ["aiAppDraftProposal", "shop"],
  ["productAction", "shop"],
  ["productDiagnosis", "shop"],
  ["productTimelineEvent", "shop"],
  ["productWatchActivity", "shop"],
  ["productWatchSettings", "shop"],
  ["productWatchlistItem", "shop"],
  ["productScoreHistory", "shop"],
  ["productRiskSnapshot", "shop"],
  ["productPulseJobLog", "shop"],
  ["catalogSignalJob", "shop"],
  ["productPulseSource", "shop"],
  ["contactRequest", "shop"],
  ["betaFeedbackPanelPreference", "shop"],
  ["betaFeedbackReport", "shop"],
  ["creditLedgerEntry", "shop"],
  ["creditPurchase", "shop"],
  ["productRetentionSummary", "shopId"],
  ["productRetentionSegmentDaily", "shopId"],
  ["productRetentionDailyActivity", "shopId"],
  ["productRetentionCohortCell", "shopId"],
  ["productRetentionDailyCohort", "shopId"],
  ["productRetentionRun", "shopId"],
  ["session", "shop"],
];

export function normalizeComplianceTopic(topic) {
  if (!topic) return "";
  const normalizedTopic = String(topic).toLowerCase();

  if (normalizedTopic === "customers_data_request") return "customers/data_request";
  if (normalizedTopic === "customers_redact") return "customers/redact";
  if (normalizedTopic === "shop_redact") return "shop/redact";

  return normalizedTopic.replace("_", "/");
}

export function isComplianceTopic(topic) {
  return COMPLIANCE_TOPICS.has(normalizeComplianceTopic(topic));
}

export function buildShopifyIdVariants(ids = [], resourceName) {
  const variants = new Set();

  ids.forEach((id) => {
    if (id === null || id === undefined || id === "") return;
    const value = String(id);
    variants.add(value);

    if (!value.startsWith("gid://")) {
      variants.add(`gid://shopify/${resourceName}/${value}`);
    }
  });

  return Array.from(variants);
}

export function getComplianceWebhookSummary({ topic, shop, payload = {} }) {
  return {
    topic: normalizeComplianceTopic(topic),
    shop,
    ordersRequestedCount: Array.isArray(payload.orders_requested) ? payload.orders_requested.length : 0,
    ordersToRedactCount: Array.isArray(payload.orders_to_redact) ? payload.orders_to_redact.length : 0,
    dataRequestId: payload.data_request?.id ? String(payload.data_request.id) : null,
  };
}

export async function redactCustomerData({ prisma = db, shop, payload = {} }) {
  const orderIds = buildShopifyIdVariants(payload.orders_to_redact, "Order");

  if (!orderIds.length) {
    return { productTimelineEventsUpdated: 0 };
  }

  const result = await prisma.productTimelineEvent.updateMany({
    where: {
      shop,
      orderId: { in: orderIds },
    },
    data: {
      orderId: null,
    },
  });

  return { productTimelineEventsUpdated: result.count || 0 };
}

export async function redactShopData({ prisma = db, shop }) {
  return prisma.$transaction(async (tx) => {
    const results = [];

    for (const [modelName, shopField] of SHOP_REDACTION_DELETE_OPERATIONS) {
      results.push(await deleteShopRows(tx, modelName, shopField, shop));
    }

    return results;
  });
}

async function deleteShopRows(prisma, modelName, shopField, shop) {
  const model = prisma[modelName];

  if (!model?.deleteMany) {
    return { model: modelName, count: 0, skipped: true };
  }

  const result = await model.deleteMany({
    where: {
      [shopField]: shop,
    },
  });

  return { model: modelName, count: result.count || 0 };
}
