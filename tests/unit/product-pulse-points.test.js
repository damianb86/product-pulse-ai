import { describe, expect, it } from "vitest";
import {
  debitStorePointsForShop,
  getStorePointBalanceForShop,
  getStorePointSummaryForShop,
  recordChatMessagePointDebitForShop,
} from "../../app/lib/product-pulse-points.server";

describe("ProductPulse store points", () => {
  it("creates an initial decimal balance from environment config", async () => {
    const db = createPointTestDb();

    const balance = await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "125.55" },
    });

    expect(balance).toMatchObject({
      shop: "test-shop.myshopify.com",
      available: 125.6,
      label: "125.6",
    });
    expect(db.state.entries).toHaveLength(1);
    expect(db.state.entries[0]).toMatchObject({
      direction: "credit",
      amount: 125.6,
      balanceAfter: 125.6,
    });
  });

  it("debits points once for an idempotency key", async () => {
    const db = createPointTestDb();
    await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "10" },
    });

    const firstDebit = await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 1.26,
      reason: "Product diagnosis point debit product-diagnosis:job-1",
      idempotencyKey: "product-diagnosis:job-1",
    });
    const secondDebit = await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 1.26,
      reason: "Product diagnosis point debit product-diagnosis:job-1",
      idempotencyKey: "product-diagnosis:job-1",
    });

    expect(firstDebit).toMatchObject({
      status: "success",
      charged: true,
      amount: 1.3,
      balance: { available: 8.7 },
    });
    expect(secondDebit).toMatchObject({
      status: "already_recorded",
      charged: false,
      balance: { available: 8.7 },
    });
    expect(db.state.entries.filter((entry) => entry.direction === "debit")).toHaveLength(1);
  });

  it("charges chat points only after full ten-message batches", async () => {
    const db = createPointTestDb({
      messages: buildUserMessages(9),
    });
    await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "5" },
    });

    expect(await recordChatMessagePointDebitForShop("test-shop.myshopify.com", { db })).toMatchObject({
      status: "no_charge",
      charged: false,
    });

    db.state.messages = buildUserMessages(10);
    expect(await recordChatMessagePointDebitForShop("test-shop.myshopify.com", { db })).toMatchObject({
      status: "success",
      charged: true,
      amount: 1,
      balance: { available: 4 },
    });

    db.state.messages = buildUserMessages(19);
    expect(await recordChatMessagePointDebitForShop("test-shop.myshopify.com", { db })).toMatchObject({
      status: "no_charge",
      charged: false,
    });

    db.state.messages = buildUserMessages(20);
    expect(await recordChatMessagePointDebitForShop("test-shop.myshopify.com", { db })).toMatchObject({
      status: "success",
      charged: true,
      amount: 1,
      balance: { available: 3 },
    });
  });

  it("summarizes real usage across the full ledger with recent activity only", async () => {
    const db = createPointTestDb();
    await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "100" },
    });
    await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 1,
      reason: "QuickScan point debit quick-scan:job-1",
      idempotencyKey: "quick-scan:job-1",
      metadata: { source: "quick_scan", windowDays: 60 },
    });
    await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 2,
      reason: "Product diagnosis point debit product-diagnosis:job-2",
      idempotencyKey: "product-diagnosis:job-2",
      metadata: { source: "product_diagnosis", productTitle: "Core Linen Trouser" },
    });
    await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 1,
      reason: "Chat messages point debit chat-messages:test-shop.myshopify.com:1",
      idempotencyKey: "chat-messages:test-shop.myshopify.com:1",
      metadata: { source: "chat", userMessageCount: 10 },
    });

    const summary = await getStorePointSummaryForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "100" },
      limit: 2,
    });

    expect(summary.balance).toMatchObject({ available: 96, label: "96.0" });
    expect(summary.plan).toMatchObject({
      name: "Free plan",
      renewalLabel: "Does not renew",
      allowance: 100,
      allowanceLabel: "100",
    });
    expect(summary.usage).toMatchObject({
      used: 4,
      total: 100,
      usedLabel: "4",
      totalLabel: "100",
      percent: 4,
      percentLabel: "4% used",
      progressPercent: 4,
    });
    expect(summary.activity).toHaveLength(2);
    expect(summary.activity[0]).toMatchObject({
      title: "AI chat messages",
      detail: "10 messages",
      amountLabel: "-1 credit",
    });
    expect(summary.activity[1]).toMatchObject({
      title: "Deep diagnosis",
      detail: "Core Linen Trouser",
      amountLabel: "-2 credits",
    });
  });
});

function createPointTestDb({ entries = [], messages = [] } = {}) {
  const state = {
    entries: entries.slice(),
    messages: messages.slice(),
    nextEntry: entries.length + 1,
  };

  return {
    state,
    creditLedgerEntry: {
      async findFirst(query = {}) {
        const rows = filterLedgerEntries(state.entries, query.where || {});
        return sortLedgerEntries(rows)[0] || null;
      },
      async create({ data }) {
        const entry = {
          id: `ledger-${state.nextEntry++}`,
          createdAt: new Date(Date.UTC(2026, 4, 27, 12, 0, state.nextEntry)),
          ...data,
        };
        state.entries.push(entry);
        return entry;
      },
      async findMany(query = {}) {
        const rows = filterLedgerEntries(state.entries, query.where || {});
        if (!query.select) return sortLedgerEntries(rows);
        return sortLedgerEntries(rows).map((entry) => Object.fromEntries(
          Object.keys(query.select).filter((key) => query.select[key]).map((key) => [key, entry[key]]),
        ));
      },
    },
    aiConversationMessage: {
      async count(query = {}) {
        const where = query.where || {};
        return state.messages.filter((message) => (
          (!where.shop || message.shop === where.shop)
          && (!where.role || message.role === where.role)
        )).length;
      },
    },
  };
}

function filterLedgerEntries(entries, where) {
  return entries.filter((entry) => {
    if (where.shop && entry.shop !== where.shop) return false;
    if (where.direction && entry.direction !== where.direction) return false;
    if (where.reason?.startsWith && !String(entry.reason || "").startsWith(where.reason.startsWith)) return false;
    if (where.reason?.contains && !String(entry.reason || "").includes(where.reason.contains)) return false;
    if (where.metadata?.path?.[0] === "idempotencyKey") {
      return entry.metadata?.idempotencyKey === where.metadata.equals;
    }
    return true;
  });
}

function sortLedgerEntries(entries) {
  return entries.slice().sort((a, b) => {
    const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (byDate) return byDate;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

function buildUserMessages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    shop: "test-shop.myshopify.com",
    role: "user",
  }));
}
