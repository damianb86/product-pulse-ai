import prisma from "../db.server";

export const PRODUCT_PULSE_INITIAL_STORE_POINTS_ENV = "PRODUCT_PULSE_INITIAL_STORE_POINTS";
export const PRODUCT_PULSE_LEGACY_INITIAL_POINTS_ENV = "PRODUCT_PULSE_INITIAL_POINTS";
export const PRODUCT_PULSE_DEFAULT_INITIAL_STORE_POINTS = 100;
export const PRODUCT_PULSE_CHAT_MESSAGES_PER_POINT = 10;
export const PRODUCT_PULSE_CHAT_POINT_REASON_PREFIX = "Chat messages point debit";

const POINT_DECIMAL_PLACES = 1;
const POINT_ROUND_FACTOR = 10 ** POINT_DECIMAL_PLACES;
const POINT_EPSILON = 0.000_001;
const INITIAL_POINTS_REASON = "Initial store points";

export function getConfiguredInitialStorePoints(env = process.env) {
  return normalizePointAmount(
    env?.[PRODUCT_PULSE_INITIAL_STORE_POINTS_ENV] ?? env?.[PRODUCT_PULSE_LEGACY_INITIAL_POINTS_ENV],
    PRODUCT_PULSE_DEFAULT_INITIAL_STORE_POINTS,
  );
}

export function normalizePointAmount(value, fallback = 0) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : Number(fallback);
  return roundPointAmount(Math.max(0, Number.isFinite(normalized) ? normalized : 0));
}

export function roundPointAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * POINT_ROUND_FACTOR) / POINT_ROUND_FACTOR;
}

export function formatPointAmount(value) {
  return roundPointAmount(value).toLocaleString("en-US", {
    minimumFractionDigits: POINT_DECIMAL_PLACES,
    maximumFractionDigits: POINT_DECIMAL_PLACES,
  });
}

export async function getStorePointBalanceForShop(shop, options = {}) {
  const db = options.db || prisma;
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop) return buildPointBalance("", 0, null);

  return withPointTransaction(db, async (tx) => {
    const entry = await getLatestLedgerEntry(tx, normalizedShop);
    if (entry) return buildPointBalance(normalizedShop, entry.balanceAfter, entry);

    const initialBalance = getConfiguredInitialStorePoints(options.env || process.env);
    const created = await tx.creditLedgerEntry.create({
      data: {
        shop: normalizedShop,
        direction: "credit",
        amount: initialBalance,
        reason: INITIAL_POINTS_REASON,
        balanceAfter: initialBalance,
        metadata: {
          source: "environment",
          env: PRODUCT_PULSE_INITIAL_STORE_POINTS_ENV,
        },
      },
    });
    return buildPointBalance(normalizedShop, created.balanceAfter, created);
  });
}

export async function getStorePointSummaryForShop(shop, options = {}) {
  const db = options.db || prisma;
  const normalizedShop = normalizeShop(shop);
  const balance = await getStorePointBalanceForShop(normalizedShop, options);
  if (!normalizedShop || typeof db.creditLedgerEntry?.findMany !== "function") {
    return buildPointSummary(balance, [], options);
  }

  const [recentEntries, debitEntries] = await Promise.all([
    db.creditLedgerEntry.findMany({
      where: { shop: normalizedShop },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(10, Number(options.limit || 3))),
    }),
    db.creditLedgerEntry.findMany({
      where: {
        shop: normalizedShop,
        direction: "debit",
      },
      select: { amount: true },
    }),
  ]);
  return buildPointSummary(balance, recentEntries, { ...options, debitEntries });
}

export async function validateStorePointsForShop(shop, amount, options = {}) {
  const requestedAmount = normalizePointAmount(amount);
  if (requestedAmount <= 0) {
    return { valid: false, message: "Choose a positive point amount.", requestedAmount };
  }
  const balance = await getStorePointBalanceForShop(shop, options);
  if (balance.available + POINT_EPSILON < requestedAmount) {
    return {
      valid: false,
      message: `This action needs ${formatPointAmount(requestedAmount)} point${requestedAmount === 1 ? "" : "s"}, but only ${balance.label} are available.`,
      requestedAmount,
      balance,
    };
  }
  return {
    valid: true,
    message: "Points available.",
    requestedAmount,
    balance,
  };
}

export async function debitStorePointsForShop(shop, input = {}) {
  const db = input.db || prisma;
  const normalizedShop = normalizeShop(shop);
  const amount = normalizePointAmount(input.amount);
  const reason = String(input.reason || "ProductPulse points debit").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!normalizedShop || amount <= 0) {
    return {
      status: "validation_error",
      message: "A valid shop and positive point amount are required.",
      charged: false,
    };
  }

  return withPointTransaction(db, async (tx) => {
    if (idempotencyKey) {
      const existing = await findLedgerEntryByIdempotencyKey(tx, normalizedShop, idempotencyKey);
      if (existing) {
        return {
          status: "already_recorded",
          message: "Point debit was already recorded.",
          charged: false,
          ledgerEntry: existing,
          balance: buildPointBalance(normalizedShop, existing.balanceAfter, existing),
        };
      }
    }

    const currentBalance = await ensureStorePointBalanceForShopInTransaction(tx, normalizedShop, input.env || process.env);
    if (currentBalance.available + POINT_EPSILON < amount) {
      return {
        status: "validation_error",
        message: `This action needs ${formatPointAmount(amount)} point${amount === 1 ? "" : "s"}, but only ${currentBalance.label} are available.`,
        charged: false,
        balance: currentBalance,
      };
    }

    const nextBalance = roundPointAmount(currentBalance.available - amount);
    const created = await tx.creditLedgerEntry.create({
      data: {
        shop: normalizedShop,
        direction: "debit",
        amount,
        reason,
        balanceAfter: nextBalance,
        metadata: normalizeLedgerMetadata({
          ...(input.metadata || {}),
          idempotencyKey: idempotencyKey || undefined,
        }),
      },
    });
    return {
      status: "success",
      message: `${formatPointAmount(amount)} point${amount === 1 ? "" : "s"} consumed.`,
      charged: true,
      amount,
      ledgerEntry: created,
      balance: buildPointBalance(normalizedShop, created.balanceAfter, created),
    };
  });
}

export async function recordChatMessagePointDebitForShop(shop, input = {}) {
  const db = input.db || prisma;
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop) {
    return { status: "validation_error", charged: false, message: "A valid shop is required." };
  }
  if (
    typeof db.aiConversationMessage?.count !== "function"
    || typeof db.creditLedgerEntry?.findMany !== "function"
  ) {
    return {
      status: "no_charge",
      charged: false,
      message: "Point ledger is not available in this runtime.",
    };
  }

  const [userMessageCount, chatPointDebits] = await Promise.all([
    db.aiConversationMessage.count({
      where: {
        shop: normalizedShop,
        role: "user",
      },
    }),
    db.creditLedgerEntry.findMany({
      where: {
        shop: normalizedShop,
        direction: "debit",
        reason: { startsWith: PRODUCT_PULSE_CHAT_POINT_REASON_PREFIX },
      },
      select: { amount: true },
    }),
  ]);
  const duePoints = Math.floor(Number(userMessageCount || 0) / PRODUCT_PULSE_CHAT_MESSAGES_PER_POINT);
  const chargedPoints = roundPointAmount(
    chatPointDebits.reduce((total, entry) => total + normalizePointAmount(entry.amount), 0),
  );
  const amountToCharge = roundPointAmount(duePoints - chargedPoints);

  if (amountToCharge <= 0) {
    return {
      status: "no_charge",
      charged: false,
      userMessageCount,
      duePoints,
      chargedPoints,
    };
  }

  return debitStorePointsForShop(normalizedShop, {
    db,
    env: input.env,
    amount: amountToCharge,
    reason: `${PRODUCT_PULSE_CHAT_POINT_REASON_PREFIX} chat-messages:${normalizedShop}:${duePoints} - ${duePoints} point${duePoints === 1 ? "" : "s"} due after ${userMessageCount} user messages`,
    idempotencyKey: `chat-messages:${normalizedShop}:${duePoints}`,
    metadata: {
      source: "chat",
      userMessageCount,
      duePoints,
      chargedPoints,
      messageId: input.messageId || null,
      conversationId: input.conversationId || null,
    },
  });
}

async function ensureStorePointBalanceForShopInTransaction(tx, shop, env) {
  const latest = await getLatestLedgerEntry(tx, shop);
  if (latest) return buildPointBalance(shop, latest.balanceAfter, latest);

  const initialBalance = getConfiguredInitialStorePoints(env || process.env);
  const created = await tx.creditLedgerEntry.create({
    data: {
      shop,
      direction: "credit",
      amount: initialBalance,
      reason: INITIAL_POINTS_REASON,
      balanceAfter: initialBalance,
      metadata: {
        source: "environment",
        env: PRODUCT_PULSE_INITIAL_STORE_POINTS_ENV,
      },
    },
  });
  return buildPointBalance(shop, created.balanceAfter, created);
}

async function getLatestLedgerEntry(db, shop) {
  return db.creditLedgerEntry.findFirst({
    where: { shop },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

async function findLedgerEntryByIdempotencyKey(db, shop, idempotencyKey) {
  const metadataMatch = await db.creditLedgerEntry.findFirst({
    where: {
      shop,
      metadata: {
        path: ["idempotencyKey"],
        equals: idempotencyKey,
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  }).catch(() => null);
  if (metadataMatch) return metadataMatch;

  return db.creditLedgerEntry.findFirst({
    where: {
      shop,
      reason: { contains: idempotencyKey },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

function buildPointBalance(shop, value, entry) {
  const available = roundPointAmount(value);
  return {
    shop,
    available,
    label: formatPointAmount(available),
    lastLedgerEntryId: entry?.id || null,
    updatedAt: entry?.createdAt ? toIso(entry.createdAt) : null,
  };
}

function buildPointSummary(balance, entries = [], options = {}) {
  const env = options.env || process.env;
  const allowance = getConfiguredInitialStorePoints(env);
  const allEntries = Array.isArray(entries) ? entries : [];
  const debits = Array.isArray(options.debitEntries)
    ? options.debitEntries
    : allEntries.filter((entry) => entry.direction === "debit");
  const visibleEntries = allEntries.slice(0, Math.max(1, Math.min(10, Number(options.limit || 3))));
  const used = roundPointAmount(
    debits.reduce((total, entry) => total + normalizePointAmount(entry.amount), 0),
  );
  const percent = allowance > 0 ? Math.round((used / allowance) * 100) : 0;

  return {
    balance,
    plan: {
      name: "Free plan",
      renewalLabel: "Does not renew",
      allowance,
      allowanceLabel: formatCompactPointAmount(allowance),
    },
    usage: {
      used,
      total: allowance,
      usedLabel: formatCompactPointAmount(used),
      totalLabel: formatCompactPointAmount(allowance),
      percent,
      percentLabel: `${percent}% used`,
      progressPercent: Math.max(0, Math.min(100, percent)),
    },
    activity: visibleEntries.map(formatPointActivityEntry),
  };
}

function formatPointActivityEntry(entry) {
  const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const amount = normalizePointAmount(entry?.amount);
  const signedAmount = entry?.direction === "debit" ? -amount : amount;
  const spec = getPointActivitySpec(entry, metadata);
  return {
    id: entry?.id || `${spec.title}-${entry?.createdAt || ""}`,
    icon: spec.icon,
    title: spec.title,
    detail: spec.detail,
    amount: signedAmount,
    amountLabel: formatSignedCreditAmount(signedAmount),
    timeLabel: formatRelativePointTime(entry?.createdAt),
    direction: entry?.direction || "credit",
  };
}

function getPointActivitySpec(entry, metadata = {}) {
  const source = String(metadata.source || "").trim();
  if (source === "quick_scan") {
    return {
      icon: "search",
      title: "QuickScan",
      detail: metadata.windowDays ? `${metadata.windowDays}-day scan window` : "Catalog scan",
    };
  }
  if (source === "product_diagnosis") {
    return {
      icon: "wand",
      title: "Deep diagnosis",
      detail: String(metadata.productTitle || "Product diagnosis"),
    };
  }
  if (source === "chat") {
    return {
      icon: "clock",
      title: "AI chat messages",
      detail: metadata.userMessageCount ? `${metadata.userMessageCount} messages` : "Chat usage",
    };
  }
  if (source === "environment" || entry?.reason === INITIAL_POINTS_REASON) {
    return {
      icon: "product",
      title: "Free plan credits",
      detail: "Initial balance",
    };
  }
  return {
    icon: entry?.direction === "debit" ? "clock" : "product",
    title: entry?.direction === "debit" ? "Credit usage" : "Credit added",
    detail: String(entry?.reason || "ProductPulse credits"),
  };
}

function formatSignedCreditAmount(value) {
  const amount = normalizePointAmount(Math.abs(value));
  const sign = value < 0 ? "-" : "+";
  return `${sign}${formatCompactPointAmount(amount)} ${amount === 1 ? "credit" : "credits"}`;
}

function formatCompactPointAmount(value) {
  const rounded = roundPointAmount(value);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatRelativePointTime(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const elapsedSeconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function normalizeLedgerMetadata(metadata = {}) {
  const normalized = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeShop(shop) {
  return String(shop || "").trim();
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function withPointTransaction(db, callback) {
  if (typeof db.$transaction === "function") {
    return db.$transaction((tx) => callback(tx));
  }
  return callback(db);
}
