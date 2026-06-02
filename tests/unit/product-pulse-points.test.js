import { describe, expect, it } from "vitest";
import {
  creditStorePointsForShop,
  debitStorePointsForShop,
  getStorePointBalanceForShop,
  getStorePointSummaryForShop,
  recordExtraCreditPackForShop,
  recordPlanMonthlyPointGrantForShop,
} from "../../app/lib/product-pulse-points.server";

describe("Credits", () => {
  it("creates the default welcome balance once with 10 credits", async () => {
    const db = createPointTestDb();

    const firstBalance = await getStorePointBalanceForShop("welcome-shop.myshopify.com", { db, env: {} });
    const secondBalance = await getStorePointBalanceForShop("welcome-shop.myshopify.com", { db, env: {} });

    expect(firstBalance).toMatchObject({
      shop: "welcome-shop.myshopify.com",
      available: 10,
      label: "10.0",
    });
    expect(secondBalance).toMatchObject({
      shop: "welcome-shop.myshopify.com",
      available: 10,
      label: "10.0",
    });
    expect(db.state.entries).toHaveLength(1);
    expect(db.state.entries[0]).toMatchObject({
      direction: "credit",
      amount: 10,
      balanceAfter: 10,
      reason: "Initial store credits",
    });
  });

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

  it("debits credits once for an idempotency key", async () => {
    const db = createPointTestDb();
    await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "10" },
    });

    const firstDebit = await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 1.26,
      reason: "Product credit debit product-diagnosis:job-1",
      idempotencyKey: "product-diagnosis:job-1",
    });
    const secondDebit = await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 1.26,
      reason: "Product credit debit product-diagnosis:job-1",
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
    const debits = db.state.entries.filter((entry) => entry.direction === "debit");
    expect(debits).toHaveLength(1);
    expect(debits[0].idempotencyKey).toBe("product-diagnosis:job-1");
  });

  it("credits monthly plan grants and extra packs with idempotent ledger entries", async () => {
    const db = createPointTestDb();
    await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "10" },
    });

    const monthlyGrant = await recordPlanMonthlyPointGrantForShop("test-shop.myshopify.com", {
      db,
      amount: 50,
      planKey: "starter",
      planName: "Starter",
      periodStart: new Date(Date.UTC(2026, 4, 1)),
    });
    const duplicateMonthlyGrant = await recordPlanMonthlyPointGrantForShop("test-shop.myshopify.com", {
      db,
      amount: 50,
      planKey: "starter",
      planName: "Starter",
      periodStart: new Date(Date.UTC(2026, 4, 1)),
    });
    const packGrant = await recordExtraCreditPackForShop("test-shop.myshopify.com", {
      db,
      credits: 25,
      packLabel: "25 beta credits",
      orderId: "order-1",
      priceCents: 750,
    });

    expect(monthlyGrant).toMatchObject({
      status: "success",
      credited: true,
      amount: 50,
      balance: { available: 60 },
    });
    expect(duplicateMonthlyGrant).toMatchObject({
      status: "already_recorded",
      credited: false,
      balance: { available: 60 },
    });
    expect(packGrant).toMatchObject({
      status: "success",
      credited: true,
      amount: 25,
      balance: { available: 85 },
    });
    expect(db.state.entries.filter((entry) => entry.direction === "credit")).toHaveLength(3);

    const summary = await getStorePointSummaryForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "10" },
      limit: 3,
    });
    expect(summary.activity[0]).toMatchObject({
      title: "Extra credit pack",
      detail: "25 beta credits",
      amountLabel: "+25 credits",
      balanceAfterLabel: "85",
    });
    expect(summary.activity[1]).toMatchObject({
      title: "Monthly plan credits",
      detail: "Starter",
      amountLabel: "+50 credits",
      balanceAfterLabel: "60",
    });
  });

  it("credits arbitrary credit events once for an idempotency key", async () => {
    const db = createPointTestDb();
    await getStorePointBalanceForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "5" },
    });

    const firstCredit = await creditStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 2.24,
      reason: "Manual adjustment adjustment-1",
      idempotencyKey: "adjustment-1",
    });
    const secondCredit = await creditStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 2.24,
      reason: "Manual adjustment adjustment-1",
      idempotencyKey: "adjustment-1",
    });

    expect(firstCredit).toMatchObject({
      status: "success",
      credited: true,
      amount: 2.2,
      balance: { available: 7.2 },
    });
    expect(secondCredit).toMatchObject({
      status: "already_recorded",
      credited: false,
      balance: { available: 7.2 },
    });
    expect(db.state.entries.filter((entry) => entry.reason.includes("Manual adjustment"))).toHaveLength(1);
    expect(db.state.entries.find((entry) => entry.reason.includes("Manual adjustment")).idempotencyKey).toBe("adjustment-1");
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
      reason: "Catalog Scan credit debit quick-scan:job-1",
      idempotencyKey: "quick-scan:job-1",
      metadata: { source: "quick_scan", windowDays: 60 },
    });
    await debitStorePointsForShop("test-shop.myshopify.com", {
      db,
      amount: 2,
      reason: "Product credit debit product-diagnosis:job-2",
      idempotencyKey: "product-diagnosis:job-2",
      metadata: { source: "product_diagnosis", productTitle: "Core Linen Trouser" },
    });
    const summary = await getStorePointSummaryForShop("test-shop.myshopify.com", {
      db,
      env: { PRODUCT_PULSE_INITIAL_STORE_POINTS: "100" },
      limit: 2,
    });

    expect(summary.balance).toMatchObject({ available: 97, label: "97.0" });
    expect(summary.plan).toMatchObject({
      name: "Free plan",
      renewalLabel: "Does not renew",
      allowance: 100,
      allowanceLabel: "100",
    });
    expect(summary.usage).toMatchObject({
      used: 3,
      total: 100,
      usedLabel: "3",
      totalLabel: "100",
      percent: 3,
      percentLabel: "3% used",
      progressPercent: 3,
    });
    expect(summary.activity).toHaveLength(2);
    expect(summary.activity[0]).toMatchObject({
      title: "Product diagnosis",
      detail: "Core Linen Trouser",
      amountLabel: "-2 credits",
    });
    expect(summary.activity[1]).toMatchObject({
      title: "Catalog Scan",
      detail: "60-day scan window",
      amountLabel: "-1 credit",
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
          && (
            !where.openAiResponseId
            || !Object.prototype.hasOwnProperty.call(where.openAiResponseId, "not")
            || message.openAiResponseId !== where.openAiResponseId.not
          )
        )).length;
      },
    },
  };
}

function filterLedgerEntries(entries, where) {
  return entries.filter((entry) => {
    if (where.shop && entry.shop !== where.shop) return false;
    if (where.direction && entry.direction !== where.direction) return false;
    if (where.idempotencyKey && entry.idempotencyKey !== where.idempotencyKey) return false;
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
