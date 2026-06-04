import prisma from "../db.server";

export const PRODUCT_PULSE_INITIAL_STORE_POINTS_ENV = "PRODUCT_PULSE_INITIAL_STORE_POINTS";
export const PRODUCT_PULSE_LEGACY_INITIAL_POINTS_ENV = "PRODUCT_PULSE_INITIAL_POINTS";
export const PRODUCT_PULSE_DEFAULT_INITIAL_STORE_POINTS = 10;

const POINT_DECIMAL_PLACES = 1;
const POINT_ROUND_FACTOR = 10 ** POINT_DECIMAL_PLACES;
const POINT_EPSILON = 0.000_001;
const INITIAL_POINTS_REASON = "Initial store credits";

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

  if (typeof db.creditLedgerEntry?.findFirst === "function") {
    const existingEntry = await getLatestLedgerEntry(db, normalizedShop);
    if (existingEntry) return buildPointBalance(normalizedShop, existingEntry.balanceAfter, existingEntry);
  }

  return withPointTransaction(db, async (tx) => {
    await lockStorePointLedgerForShop(tx, normalizedShop);
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

  const recentEntries = await db.creditLedgerEntry.findMany({
    where: { shop: normalizedShop },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(10, Number(options.limit || 3))),
  });
  const debitTotal = await getStorePointDebitTotalForShop(db, normalizedShop);
  return buildPointSummary(balance, recentEntries, { ...options, debitTotal });
}

export async function validateStorePointsForShop(shop, amount, options = {}) {
  const requestedAmount = normalizePointAmount(amount);
  if (requestedAmount <= 0) {
    return { valid: false, message: "Choose a positive credit amount.", requestedAmount };
  }
  const balance = await getStorePointBalanceForShop(shop, options);
  if (balance.available + POINT_EPSILON < requestedAmount) {
    return {
      valid: false,
      message: `This action needs ${formatPointAmount(requestedAmount)} credit${requestedAmount === 1 ? "" : "s"}, but only ${balance.label} are available.`,
      requestedAmount,
      balance,
    };
  }
  return {
    valid: true,
    message: "Credits available.",
    requestedAmount,
    balance,
  };
}

export async function debitStorePointsForShop(shop, input = {}) {
  const db = input.db || prisma;
  const normalizedShop = normalizeShop(shop);
  const amount = normalizePointAmount(input.amount);
  const reason = String(input.reason || "ProductPulse credit debit").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!normalizedShop || amount <= 0) {
    return {
      status: "validation_error",
      message: "A valid shop and positive credit amount are required.",
      charged: false,
    };
  }

  return withPointTransaction(db, async (tx) => {
    await lockStorePointLedgerForShop(tx, normalizedShop);

    if (idempotencyKey) {
      const existing = await findLedgerEntryByIdempotencyKey(tx, normalizedShop, idempotencyKey);
      if (existing) {
        return {
          status: "already_recorded",
          message: "Credit debit was already recorded.",
          charged: false,
          ledgerEntry: existing,
          balance: buildPointBalance(normalizedShop, existing.balanceAfter, existing),
        };
      }
    }

    const currentBalance = await ensureStorePointBalanceForShopInTransaction(tx, normalizedShop, input.env || process.env);
    if (!input.allowNegativeBalance && currentBalance.available + POINT_EPSILON < amount) {
      return {
        status: "validation_error",
        message: `This action needs ${formatPointAmount(amount)} credit${amount === 1 ? "" : "s"}, but only ${currentBalance.label} are available.`,
        charged: false,
        balance: currentBalance,
      };
    }

    const nextBalance = roundPointAmount(currentBalance.available - amount);
    const data = {
      shop: normalizedShop,
      direction: "debit",
      amount,
      reason,
      balanceAfter: nextBalance,
      metadata: normalizeLedgerMetadata({
        ...(input.metadata || {}),
        idempotencyKey: idempotencyKey || undefined,
      }),
    };
    if (idempotencyKey) data.idempotencyKey = idempotencyKey;

    const created = await tx.creditLedgerEntry.create({
      data,
    });
    return {
      status: "success",
      message: `${formatPointAmount(amount)} credit${amount === 1 ? "" : "s"} consumed.`,
      charged: true,
      amount,
      ledgerEntry: created,
      balance: buildPointBalance(normalizedShop, created.balanceAfter, created),
    };
  });
}

export async function creditStorePointsForShop(shop, input = {}) {
  const db = input.db || prisma;
  const normalizedShop = normalizeShop(shop);
  const amount = normalizePointAmount(input.amount);
  const reason = String(input.reason || "ProductPulse credit").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!normalizedShop || amount <= 0) {
    return {
      status: "validation_error",
      message: "A valid shop and positive credit amount are required.",
      credited: false,
    };
  }

  return withPointTransaction(db, async (tx) => {
    await lockStorePointLedgerForShop(tx, normalizedShop);

    if (idempotencyKey) {
      const existing = await findLedgerEntryByIdempotencyKey(tx, normalizedShop, idempotencyKey);
      if (existing) {
        return {
          status: "already_recorded",
          message: "Credit was already recorded.",
          credited: false,
          ledgerEntry: existing,
          balance: buildPointBalance(normalizedShop, existing.balanceAfter, existing),
        };
      }
    }

    const currentBalance = await ensureStorePointBalanceForShopInTransaction(tx, normalizedShop, input.env || process.env);
    const nextBalance = roundPointAmount(currentBalance.available + amount);
    const data = {
      shop: normalizedShop,
      direction: "credit",
      amount,
      reason,
      balanceAfter: nextBalance,
      metadata: normalizeLedgerMetadata({
        ...(input.metadata || {}),
        idempotencyKey: idempotencyKey || undefined,
      }),
    };
    if (idempotencyKey) data.idempotencyKey = idempotencyKey;

    const created = await tx.creditLedgerEntry.create({
      data,
    });
    return {
      status: "success",
      message: `${formatPointAmount(amount)} credit${amount === 1 ? "" : "s"} added.`,
      credited: true,
      amount,
      ledgerEntry: created,
      balance: buildPointBalance(normalizedShop, created.balanceAfter, created),
    };
  });
}

export async function recordPlanMonthlyPointGrantForShop(shop, input = {}) {
  const normalizedShop = normalizeShop(shop);
  const amount = normalizePointAmount(input.amount);
  const planKey = String(input.planKey || "free").trim();
  const planName = String(input.planName || "Free plan").trim();
  const periodStart = input.periodStart || new Date();
  const periodStartKey = String(input.periodKey || formatPointPeriodKey(periodStart)).trim();
  const subscriptionKey = String(input.subscriptionId || "no-subscription").trim();
  return creditStorePointsForShop(normalizedShop, {
    ...input,
    amount,
    reason: `Monthly plan credits ${planName} ${periodStartKey}`,
    idempotencyKey: input.idempotencyKey || `plan-monthly:${normalizedShop}:${planKey}:${subscriptionKey}:${periodStartKey}`,
    metadata: {
      ...(input.metadata || {}),
      source: "plan_monthly_allowance",
      planKey,
      planName,
      periodStart: toIso(periodStart),
      periodEnd: toIso(input.periodEnd),
      subscriptionId: input.subscriptionId || null,
    },
  });
}

export async function recordPlanMonthlyPointReversalForShop(shop, input = {}) {
  const normalizedShop = normalizeShop(shop);
  const amount = normalizePointAmount(input.amount);
  const planKey = String(input.planKey || "starter").trim();
  const planName = String(input.planName || "Starter").trim();
  const periodKey = String(input.periodKey || formatPointPeriodKey(input.periodStart || new Date())).trim();
  const subscriptionKey = String(input.subscriptionId || "no-subscription").trim();
  return debitStorePointsForShop(normalizedShop, {
    ...input,
    amount,
    allowNegativeBalance: true,
    reason: `Reversed monthly plan credits ${planName} ${periodKey}`,
    idempotencyKey: input.idempotencyKey || `plan-monthly-refund:${normalizedShop}:${planKey}:${subscriptionKey}:${periodKey}`,
    metadata: {
      ...(input.metadata || {}),
      source: "plan_monthly_allowance_refund",
      planKey,
      planName,
      periodKey,
      periodStart: toIso(input.periodStart),
      periodEnd: toIso(input.periodEnd),
      subscriptionId: input.subscriptionId || null,
    },
  });
}

export async function recordExtraCreditPackForShop(shop, input = {}) {
  const normalizedShop = normalizeShop(shop);
  const amount = normalizePointAmount(input.amount ?? input.credits);
  const packLabel = input.packLabel || `${formatCompactPointAmount(amount)} credit pack`;
  return creditStorePointsForShop(normalizedShop, {
    ...input,
    amount,
    reason: `Extra credit pack ${packLabel}`,
    idempotencyKey: input.idempotencyKey || input.orderId || input.purchaseId || "",
    metadata: {
      ...(input.metadata || {}),
      source: "extra_credit_pack",
      packCredits: amount,
      packLabel,
      orderId: input.orderId || null,
      purchaseId: input.purchaseId || null,
      priceCents: input.priceCents ?? null,
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
  const columnMatch = await db.creditLedgerEntry.findFirst({
    where: {
      shop,
      idempotencyKey,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  }).catch(() => null);
  if (columnMatch) return columnMatch;

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

async function getStorePointDebitTotalForShop(db, shop) {
  if (typeof db.creditLedgerEntry?.aggregate === "function") {
    const aggregate = await db.creditLedgerEntry.aggregate({
      where: {
        shop,
        direction: "debit",
      },
      _sum: { amount: true },
    });
    return normalizePointAmount(aggregate?._sum?.amount || 0);
  }

  const debitEntries = await db.creditLedgerEntry.findMany({
    where: {
      shop,
      direction: "debit",
    },
    select: { amount: true },
  });
  return roundPointAmount(
    debitEntries.reduce((total, entry) => total + normalizePointAmount(entry.amount), 0),
  );
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
  const allowance = normalizePointAmount(options.planAllowance ?? getConfiguredInitialStorePoints(env));
  const planName = String(options.planName || "Free plan").trim();
  const planRenewalLabel = String(options.planRenewalLabel || (options.planKey === "starter" ? "Renews every 30 days" : "Does not renew")).trim();
  const allEntries = Array.isArray(entries) ? entries : [];
  const debitTotal = Number.isFinite(Number(options.debitTotal))
    ? normalizePointAmount(options.debitTotal)
    : null;
  const visibleEntries = allEntries.slice(0, Math.max(1, Math.min(10, Number(options.limit || 3))));
  const used = debitTotal ?? roundPointAmount(
    allEntries
      .filter((entry) => entry.direction === "debit")
      .reduce((total, entry) => total + normalizePointAmount(entry.amount), 0),
  );
  const percent = allowance > 0 ? Math.round((used / allowance) * 100) : 0;

  return {
    balance,
    plan: {
      key: options.planKey || "free",
      name: planName,
      renewalLabel: planRenewalLabel,
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
  const balanceAfter = normalizePointAmount(entry?.balanceAfter);
  const spec = getPointActivitySpec(entry, metadata);
  return {
    id: entry?.id || `${spec.title}-${entry?.createdAt || ""}`,
    icon: spec.icon,
    title: spec.title,
    detail: spec.detail,
    amount: signedAmount,
    amountLabel: formatSignedCreditAmount(signedAmount),
    balanceAfter,
    balanceAfterLabel: formatCompactPointAmount(balanceAfter),
    timeLabel: formatRelativePointTime(entry?.createdAt),
    createdAtIso: toIso(entry?.createdAt),
    reason: String(entry?.reason || ""),
    direction: entry?.direction || "credit",
  };
}

function getPointActivitySpec(entry, metadata = {}) {
  const source = String(metadata.source || "").trim();
  if (source === "quick_scan") {
    return {
      icon: "search",
      title: "Catalog Scan",
      detail: metadata.windowDays ? `${metadata.windowDays}-day scan window` : "Catalog scan",
    };
  }
  if (source === "product_diagnosis") {
    return {
      icon: "wand",
      title: "Product diagnosis",
      detail: String(metadata.productTitle || "Product diagnosis"),
    };
  }
  if (source === "product_diagnosis_refund") {
    return {
      icon: "wand",
      title: "Product diagnosis refund",
      detail: String(metadata.productTitle || "Product diagnosis"),
    };
  }
  if (source === "chat") {
    const messageCount = metadata.successfulAssistantMessageCount || metadata.chatMessageCount || metadata.userMessageCount;
    return {
      icon: "clock",
      title: "AI chat messages",
      detail: messageCount ? `${messageCount} messages` : "Chat usage",
    };
  }
  if (source === "environment" || entry?.reason === INITIAL_POINTS_REASON) {
    return {
      icon: "product",
      title: "Free plan credits",
      detail: "Initial balance",
    };
  }
  if (source === "plan_monthly_allowance") {
    return {
      icon: "product",
      title: "Monthly plan credits",
      detail: metadata.planName || "Plan allowance",
    };
  }
  if (source === "plan_monthly_allowance_refund") {
    return {
      icon: "clock",
      title: "Plan credit reversal",
      detail: metadata.planName || "Refunded plan allowance",
    };
  }
  if (source === "extra_credit_pack") {
    return {
      icon: "product",
      title: "Extra credit pack",
      detail: metadata.packLabel || "Purchased credits",
    };
  }
  if (source === "extra_credit_pack_refund") {
    return {
      icon: "clock",
      title: "Credit pack reversal",
      detail: metadata.purchaseId || "Refunded purchase",
    };
  }
  return {
    icon: entry?.direction === "debit" ? "clock" : "product",
    title: entry?.direction === "debit" ? "Credit usage" : "Credit added",
    detail: String(entry?.reason || "Credits"),
  };
}

function formatSignedCreditAmount(value) {
  const amount = normalizePointAmount(Math.abs(value));
  const sign = value < 0 ? "-" : "+";
  return `${sign}${formatCompactPointAmount(amount)} credit${amount === 1 ? "" : "s"}`;
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

function formatPointPeriodKey(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  if (Number.isNaN(date.getTime())) return "unknown-period";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
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

export async function lockStorePointLedgerForShop(db, shop) {
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop || typeof db?.$executeRawUnsafe !== "function") return false;
  await db.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))",
    normalizedShop,
  );
  return true;
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
