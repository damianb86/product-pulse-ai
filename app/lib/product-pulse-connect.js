export const CSV_REVIEW_IMPORT_DISPLAY_NAME = "CSV import";

export const chatMeConnectionLinks = {
  app: "https://apps.shopify.com/what-is-chatme-app-button",
  docs: "https://chatme.ai/docs/api-token",
};

export const judgeMeConnectionLinks = {
  app: "https://judge.me/settings?jump_to=judge.me+api",
  docs: "https://judge.me/help/en/articles/8409180-judge-me-api",
};

export const connectCategoryDefinitions = [
  {
    id: "reviews",
    title: "Reviews",
    tag: "Surface sentiment & feedback",
    icon: "star",
    tone: "purple",
    weight: 60,
    coverageNote: "Primary feedback signal. Reviews carry the largest coverage weight.",
    sources: [
      {
        key: "judgemeReviews",
        name: "Judge.me Reviews",
        logoUrl: "https://www.google.com/s2/favicons?domain=judge.me&sz=64",
        tone: "teal",
        source: "Product & store reviews, ratings, photos",
        provides: "Sentiment, topics, pros & cons",
        available: true,
        actionKind: "judgeme",
      },
      {
        key: "yotpoReviews",
        name: "Yotpo Reviews",
        logoUrl: "https://www.google.com/s2/favicons?domain=yotpo.com&sz=64",
        tone: "blue",
        source: "Reviews, Q&A and UGC content",
        provides: "Sentiment, topics, photos, Q&A",
        available: false,
        comingSoonMessage: "Yotpo import is coming soon.",
      },
      {
        key: "chatmeReviews",
        name: "ChatMe Reviews",
        logoUrl: "https://www.google.com/s2/favicons?domain=chatme.ai&sz=64",
        tone: "cyan",
        source: "Product reviews & Q&A",
        provides: "Sentiment, topics, pros & cons",
        available: false,
        actionKind: "chatme",
        comingSoonMessage: "ChatMe Reviews connector is coming soon.",
      },
      {
        key: "csvReviews",
        name: "CSV Upload",
        logoUrl: "https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/file-type-csv.svg",
        tone: "green",
        source: "Import reviews from any source",
        provides: "Sentiment, topics, ratings",
        available: true,
        actionKind: "csv",
      },
    ],
  },
  {
    id: "returns",
    title: "Returns & Refunds",
    tag: "Understand return reasons",
    icon: "return",
    tone: "red",
    weight: 25,
    coverageNote: "Counts specialized return-reason systems. Shopify returns are baseline data and stay visible below.",
    sources: [
      {
        key: "shopifyReturns",
        name: "Shopify Returns & Refunds",
        logoUrl: "https://www.google.com/s2/favicons?domain=shopify.com&sz=64",
        tone: "green",
        source: "Default Shopify return events",
        provides: "Items, outcomes, baseline reasons",
        available: true,
        defaultConnected: true,
        locked: true,
        countForCoverage: false,
      },
      {
        key: "returnPrime",
        name: "Return Prime",
        logoUrl: "https://www.google.com/s2/favicons?domain=returnprime.com&sz=64",
        tone: "black",
        source: "Third-party return data & reasons",
        provides: "Reasons, frequency, impact",
        available: false,
        comingSoonMessage: "Return Prime connector is coming soon.",
      },
      {
        key: "loopReturns",
        name: "Loop Returns",
        logoUrl: "https://www.google.com/s2/favicons?domain=loopreturns.com&sz=64",
        tone: "purple",
        source: "Return reasons & insights",
        provides: "Reasons, frequency, impact",
        available: false,
        comingSoonMessage: "Loop Returns connector is coming soon.",
      },
    ],
  },
  {
    id: "support",
    title: "Chat & Support",
    tag: "Capture support conversations",
    icon: "chat",
    tone: "blue",
    weight: 15,
    coverageNote: "Adds buyer intent, friction themes and support sentiment.",
    sources: [
      {
        key: "gorgias",
        name: "Gorgias",
        logoUrl: "https://www.google.com/s2/favicons?domain=gorgias.com&sz=64",
        tone: "black",
        source: "Support tickets & conversation transcripts",
        provides: "Topics, issues, sentiment",
        available: false,
        comingSoonMessage: "Gorgias connector is coming soon.",
      },
      {
        key: "zendesk",
        name: "Zendesk",
        logoUrl: "https://www.google.com/s2/favicons?domain=zendesk.com&sz=64",
        tone: "green",
        source: "Support tickets & conversation transcripts",
        provides: "Topics, issues, sentiment",
        available: false,
        comingSoonMessage: "Zendesk connector is coming soon.",
      },
    ],
  },
];

export const shopifyProductDataCategoryDefinition = {
  id: "product-data",
  title: "Product data",
  tag: "Power enrichment & context",
  icon: "product",
  tone: "green",
  coverageNote: "Shopify product data is enabled by default and excluded from the customer-signal percentage.",
  sources: [
    {
      key: "shopifyProducts",
      name: "Shopify data",
      logoUrl: "https://www.google.com/s2/favicons?domain=shopify.com&sz=64",
      tone: "green",
      source: "Products, variants, collections, tags",
      provides: "Specs, attributes, taxonomy",
      available: true,
      defaultConnected: true,
      locked: true,
      countForCoverage: false,
    },
  ],
};

export const connectSourceDefinitions = [
  ...connectCategoryDefinitions.flatMap((category) =>
    category.sources.map((source) => ({ ...source, categoryId: category.id, categoryTitle: category.title, categoryWeight: category.weight })),
  ),
  ...shopifyProductDataCategoryDefinition.sources.map((source) => ({
    ...source,
    categoryId: shopifyProductDataCategoryDefinition.id,
    categoryTitle: shopifyProductDataCategoryDefinition.title,
    categoryWeight: 0,
  })),
];

export function buildConnectViewData(records = []) {
  const recordMap = new Map(records.map((record) => [record.sourceKey, record]));
  const signalCategories = connectCategoryDefinitions.map((category) => buildCategory(category, recordMap));
  const productDataCategory = buildCategory(shopifyProductDataCategoryDefinition, recordMap, true);
  const coverage = signalCategories.reduce((total, category) => (
    category.connected ? total + category.weight : total
  ), 0);
  const activeWeight = signalCategories.reduce((total, category) => (
    category.connected ? total + category.weight : total
  ), 0);

  return {
    records,
    signalCategories,
    productDataCategory,
    coverage,
    activeWeight,
  };
}

export function buildConnectionRecord(sourceKey, overrides = {}) {
  const definition = getConnectSourceDefinition(sourceKey);
  return {
    sourceKey,
    category: definition?.categoryId || "reviews",
    name: definition?.name || sourceKey,
    connected: Boolean(definition?.defaultConnected),
    active: definition?.defaultActive ?? true,
    ignored: false,
    available: Boolean(definition?.available),
    health: definition?.defaultConnected ? "connected" : "not_connected",
    coverageWeight: definition?.categoryWeight || 0,
    lastSyncedAt: null,
    connectedAt: null,
    disabledAt: null,
    config: null,
    ...overrides,
  };
}

export function upsertLocalConnectionRecord(records, sourceKey, overrides) {
  const defaultRecord = buildConnectionRecord(sourceKey);
  const replaced = records.some((record) => record.sourceKey === sourceKey);
  if (!replaced) return [...records, { ...defaultRecord, ...overrides }];
  return records.map((record) => (record.sourceKey === sourceKey ? { ...defaultRecord, ...record, ...overrides } : record));
}

export function getConnectSourceDefinition(sourceKey) {
  return connectSourceDefinitions.find((source) => source.key === sourceKey);
}

function buildCategory(category, recordMap, lockedCategory = false) {
  const sources = category.sources.map((source) => buildSource(source, category, recordMap));
  const countedSources = sources.filter((source) => source.countForCoverage);
  const connected = countedSources.some((source) => source.connected && source.active);

  return {
    ...category,
    locked: lockedCategory,
    ignored: false,
    connected,
    sources,
  };
}

function buildSource(source, category, recordMap) {
  const record = recordMap.get(source.key);
  const locked = Boolean(source.locked);
  const available = locked || Boolean(source.available);
  const connected = locked || Boolean(record?.connected ?? source.defaultConnected);
  const active = locked || Boolean(record?.active ?? source.defaultActive ?? true);
  const ignored = false;
  const health = record?.health || (connected ? "connected" : "not_connected");
  const detail = getSourceDetail({ source, record, available, connected, active, locked });

  return {
    ...source,
    categoryId: category.id,
    connected,
    active,
    ignored,
    available,
    locked,
    health,
    config: record?.config || null,
    lastSyncedAt: record?.lastSyncedAt || null,
    connectedAt: record?.connectedAt || null,
    disabledAt: record?.disabledAt || null,
    countForCoverage: source.countForCoverage !== false && available,
    status: getSourceStatus({ available, connected, active, locked }),
    detail,
    action: getSourceAction({ source, available, connected, active, locked }),
  };
}

function getSourceStatus({ available, connected, active, locked }) {
  if (locked) return "Always on";
  if (!available) return "Coming soon";
  if (connected && !active) return "Disabled";
  if (connected) return "Connected";
  return "Not connected";
}

function getSourceAction({ source, available, connected, active, locked }) {
  if (locked) return "Included";
  if (!available) return "Coming soon";
  if (source.actionKind === "csv") return connected ? "Replace CSV" : "Upload CSV";
  if (source.actionKind === "judgeme" || source.actionKind === "chatme") return active || !connected ? "Manage" : "Resume";
  return connected ? "Manage" : "Connect";
}

function getSourceDetail({ source, record, available, connected, active, locked }) {
  if (locked) return "Real-time sync";
  if (!available) return source.comingSoonMessage || "This connector is coming soon.";
  if (connected && !active) {
    if (source.actionKind === "csv") {
      const displayFileName = getCsvImportDisplayFileName(record?.config);
      return `${displayFileName} disabled; ignored by scans and diagnostics.`;
    }
    return "Disabled; ignored by scans and diagnostics.";
  }
  if (connected) {
    if (source.actionKind === "csv" && (record?.config?.fileName || record?.config?.displayFileName || record?.config?.normalizedFileName)) {
      const displayFileName = getCsvImportDisplayFileName(record.config);
      const rows = Number(record.config.normalizedRowCount || 0);
      if (rows > 0) return `${displayFileName} processed (${rows} review${rows === 1 ? "" : "s"})`;
      return `${displayFileName} uploaded`;
    }
    if (record?.config?.fileName) return `${record.config.fileName} uploaded`;
    if (record?.config?.tokenLast4) return `Token ending in ${record.config.tokenLast4}`;
    return record?.lastSyncedAt ? `Last synced ${formatConnectionDate(record.lastSyncedAt)}` : "Ready for sync";
  }
  return source.actionKind === "judgeme" ? "Add a private API token to connect." : "Ready to configure.";
}

function getCsvImportDisplayFileName(config = {}) {
  const displayName = cleanCsvFileName(config.displayFileName || config.fileName);
  if (!displayName || isLongImportedCsvName(displayName)) return CSV_REVIEW_IMPORT_DISPLAY_NAME;
  return displayName;
}

function cleanCsvFileName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    decoded = text.replace(/%2F/gi, "/").replace(/%20/g, " ");
  }
  return decoded.split(/[\\/]/).filter(Boolean).pop()?.trim() || decoded.trim();
}

function isLongImportedCsvName(value) {
  const text = String(value || "");
  return text.length > 32 || /%2f/i.test(text) || /review-export/i.test(text);
}

function formatConnectionDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
