import prisma from "../db.server";
import { PRODUCT_PULSE_STARTER_PLAN } from "./product-pulse-billing-config";
import {
  debitStorePointsForShop,
  formatPointAmount,
  normalizePointAmount,
  recordExtraCreditPackForShop,
  recordPlanMonthlyPointGrantForShop,
  recordPlanMonthlyPointReversalForShop,
} from "./product-pulse-points.server";

const SHOP_PLAN_QUERY = `#graphql
  query ProductPulseShopBillingMode {
    shop {
      plan {
        partnerDevelopment
        publicDisplayName
      }
    }
  }
`;

const APP_PURCHASE_CREATE = `#graphql
  mutation ProductPulseCreditPurchaseCreate($name: String!, $returnUrl: URL!, $price: MoneyInput!, $test: Boolean) {
    appPurchaseOneTimeCreate(name: $name, returnUrl: $returnUrl, price: $price, test: $test) {
      confirmationUrl
      userErrors {
        field
        message
      }
      appPurchaseOneTime {
        id
        status
      }
    }
  }
`;

const APP_PURCHASE_STATUS = `#graphql
  query ProductPulseCreditPurchaseStatus($id: ID!) {
    node(id: $id) {
      ... on AppPurchaseOneTime {
        id
        status
      }
    }
  }
`;

const APP_INSTALLATION_BILLING_QUERY = `#graphql
  query ProductPulseCurrentAppInstallationBilling {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        createdAt
        currentPeriodEnd
      }
    }
  }
`;

const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation ProductPulseStarterSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      confirmationUrl
      userErrors {
        field
        message
      }
      appSubscription {
        id
        name
        status
      }
    }
  }
`;

const STARTER_BILLING_INTERVAL_DAYS = 30;
const BILLING_PERIOD_MS = STARTER_BILLING_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export const PRODUCT_PULSE_FREE_PLAN = {
  key: "free",
  name: "Free",
  monthlyCredits: 10,
  priceCents: 0,
  compareAtPriceCents: 0,
  currencyCode: "USD",
};

export const PRODUCT_PULSE_STARTER_PLAN_CONFIG = {
  key: "starter",
  name: "Starter",
  shopifyPlanName: PRODUCT_PULSE_STARTER_PLAN,
  monthlyCredits: 50,
  priceCents: configuredCents("PRODUCT_PULSE_STARTER_PLAN_PRICE_CENTS", 900),
  compareAtPriceCents: configuredCents("PRODUCT_PULSE_STARTER_PLAN_COMPARE_AT_PRICE_CENTS", 1800),
  currencyCode: "USD",
};

export const PRODUCT_PULSE_CREDIT_PACKAGES = [
  buildCreditPackage("pack_10", 10, "Small top-up", "PRODUCT_PULSE_CREDIT_PACK_10_PRICE_CENTS", 300, "PRODUCT_PULSE_CREDIT_PACK_10_COMPARE_AT_PRICE_CENTS", 600),
  buildCreditPackage("pack_25", 25, "Most common setup pack", "PRODUCT_PULSE_CREDIT_PACK_25_PRICE_CENTS", 650, "PRODUCT_PULSE_CREDIT_PACK_25_COMPARE_AT_PRICE_CENTS", 1300),
  buildCreditPackage("pack_50", 50, "Monthly working buffer", "PRODUCT_PULSE_CREDIT_PACK_50_PRICE_CENTS", 1100, "PRODUCT_PULSE_CREDIT_PACK_50_COMPARE_AT_PRICE_CENTS", 2200),
  buildCreditPackage("pack_100", 100, "Frequent diagnosis pack", "PRODUCT_PULSE_CREDIT_PACK_100_PRICE_CENTS", 2100, "PRODUCT_PULSE_CREDIT_PACK_100_COMPARE_AT_PRICE_CENTS", 4200),
  buildCreditPackage("pack_250", 250, "High-volume diagnosis pack", "PRODUCT_PULSE_CREDIT_PACK_250_PRICE_CENTS", 5000, "PRODUCT_PULSE_CREDIT_PACK_250_COMPARE_AT_PRICE_CENTS", 10000),
];

export class ProductPulseBillingError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductPulseBillingError";
  }
}

export async function shouldUseProductPulseTestBilling(admin, shop = "") {
  const override = envBillingTestOverride();
  if (override !== null) {
    console.info("[product-pulse-billing] test mode resolved from SHOPIFY_BILLING_TEST", {
      shop,
      isTest: override,
    });
    return override;
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[product-pulse-billing] test mode enabled outside production", { shop });
    return true;
  }

  try {
    const response = await admin.graphql(SHOP_PLAN_QUERY);
    const json = await response.json();
    const errors = Array.isArray(json?.errors) ? json.errors : [];
    if (errors.length) {
      throw new Error(errors.map((error) => error?.message).filter(Boolean).join("; "));
    }

    const plan = json?.data?.shop?.plan;
    const isTest = Boolean(plan?.partnerDevelopment);
    console.info("[product-pulse-billing] test mode resolved from Shopify shop plan", {
      shop,
      isTest,
      partnerDevelopment: plan?.partnerDevelopment ?? null,
      plan: plan?.publicDisplayName ?? null,
    });
    return isTest;
  } catch (error) {
    console.warn("[product-pulse-billing] could not resolve Shopify shop plan; using live billing mode", {
      shop,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function resolveProductPulseBillingPlan({ admin, billing, session, settleBillingApproval = false }) {
  const shop = session?.shop || "";
  const isTest = await shouldUseProductPulseTestBilling(admin, shop);
  let snapshot = await resolveBillingSnapshot(billing, isTest, admin);
  let attempts = 1;

  if (settleBillingApproval && !snapshot.activeSubscription) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      await sleep(1500);
      attempts += 1;
      snapshot = await resolveBillingSnapshot(billing, isTest, admin);
      if (snapshot.activeSubscription) break;
    }
  }

  const now = new Date();
  const localState = await getBillingSubscriptionStateForShop(shop);
  const activeSubscription = snapshot.activeSubscription;
  const activePeriod = getSubscriptionBillingPeriod(activeSubscription, now);
  const deferredGrantUntil = activeSubscription
    ? getDeferredStarterGrantUntil(activeSubscription, localState, now)
    : null;
  if (activeSubscription) {
    await upsertBillingSubscriptionStateForShop(shop, {
      subscriptionId: activeSubscription.id,
      planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
      planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
      status: "active",
      currentPeriodStart: activePeriod.periodStart,
      currentPeriodEnd: activePeriod.periodEnd,
      accessEndsAt: activePeriod.periodEnd,
      cancelledAt: null,
      metadata: {
        source: snapshot.source,
        shopifyStatus: activeSubscription.status || null,
        test: activeSubscription.test ?? null,
        deferredGrantUntil: toIso(deferredGrantUntil),
      },
    });
  }

  const paidCancelledAccess = !activeSubscription && isBillingSubscriptionStateAccessible(localState, now);
  const hasStarter = Boolean(activeSubscription || paidCancelledAccess);
  const plan = hasStarter ? PRODUCT_PULSE_STARTER_PLAN_CONFIG : PRODUCT_PULSE_FREE_PLAN;
  const subscriptionId = activeSubscription?.id ?? (paidCancelledAccess ? localState.subscriptionId : null);
  const periodStart = activeSubscription ? activePeriod.periodStart : coerceDate(localState?.currentPeriodStart);
  const periodEnd = activeSubscription ? activePeriod.periodEnd : coerceDate(localState?.accessEndsAt || localState?.currentPeriodEnd);
  const periodKey = activeSubscription
    ? activePeriod.periodKey
    : buildSubscriptionPeriodKey({
      subscriptionId,
      periodStart,
      periodEnd,
      now,
    });
  return {
    isTest,
    attempts,
    source: activeSubscription ? snapshot.source : paidCancelledAccess ? "local-cancelled-access" : snapshot.source,
    planKey: plan.key,
    planName: plan.name,
    shopifyPlanName: hasStarter ? PRODUCT_PULSE_STARTER_PLAN : null,
    monthlyCredits: plan.monthlyCredits,
    priceCents: plan.priceCents,
    currencyCode: plan.currencyCode,
    subscriptionId,
    subscriptionStatus: activeSubscription?.status || (paidCancelledAccess ? localState.status : null),
    cancelledAt: !activeSubscription && paidCancelledAccess ? toIso(localState.cancelledAt) : null,
    currentPeriodStart: toIso(periodStart),
    currentPeriodEnd: toIso(periodEnd),
    periodKey,
    grantEligible: Boolean(activeSubscription && !deferredGrantUntil),
    accessEndsAt: toIso(periodEnd),
    cancellationKeepsAccess: Boolean(paidCancelledAccess),
    subscriptions: snapshot.appSubscriptions,
  };
}

export async function createProductPulseStarterSubscription(shop, admin, returnUrl, options = {}) {
  const isTestBilling = await shouldUseProductPulseTestBilling(admin, shop);
  const trialDays = normalizeTrialDays(options.trialDays);
  const variables = {
    name: PRODUCT_PULSE_STARTER_PLAN,
    returnUrl,
    test: isTestBilling,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            interval: "EVERY_30_DAYS",
            price: {
              amount: PRODUCT_PULSE_STARTER_PLAN_CONFIG.priceCents / 100,
              currencyCode: PRODUCT_PULSE_STARTER_PLAN_CONFIG.currencyCode,
            },
          },
        },
      },
    ],
  };
  if (trialDays > 0) variables.trialDays = trialDays;

  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
    variables,
  });
  const body = await readGraphql(response);
  const payload = readObject(readObject(body.data).appSubscriptionCreate);
  const userErrors = Array.isArray(payload.userErrors) ? payload.userErrors : [];
  if (userErrors.length) {
    const message = userErrors
      .map((error) => readObject(error).message)
      .filter(Boolean)
      .join(", ");
    throw new ProductPulseBillingError(message || "Shopify could not create the Starter subscription.");
  }

  const appSubscription = readObject(payload.appSubscription);
  const confirmationUrl = String(payload.confirmationUrl || "");
  if (!confirmationUrl) {
    throw new ProductPulseBillingError("Shopify did not return a confirmation URL for the Starter subscription.");
  }

  return {
    confirmationUrl,
    subscriptionId: String(appSubscription.id || ""),
    status: String(appSubscription.status || "").toLowerCase(),
    trialDays,
  };
}

export async function restoreProductPulseStarterSubscription({ shop, admin, billing, returnUrl }) {
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop) {
    throw new ProductPulseBillingError("No shop was found for this Starter subscription.");
  }

  const currentPlan = await resolveProductPulseBillingPlan({
    admin,
    billing,
    session: { shop: normalizedShop },
  });
  if (currentPlan.planKey === PRODUCT_PULSE_STARTER_PLAN_CONFIG.key && !currentPlan.cancellationKeepsAccess) {
    return {
      ok: true,
      alreadyActive: true,
      message: "Starter subscription is already active.",
    };
  }

  const localState = await getBillingSubscriptionStateForShop(normalizedShop);
  const accessEndsAt = coerceDate(currentPlan.accessEndsAt || localState?.accessEndsAt || localState?.currentPeriodEnd);
  const now = new Date();
  const trialDays = accessEndsAt && accessEndsAt.getTime() > now.getTime()
    ? Math.ceil((accessEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const subscription = await createProductPulseStarterSubscription(normalizedShop, admin, returnUrl, { trialDays });

  await upsertBillingSubscriptionStateForShop(normalizedShop, {
    subscriptionId: localState?.subscriptionId || currentPlan.subscriptionId,
    planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
    planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
    status: "restore_pending",
    currentPeriodStart: currentPlan.currentPeriodStart || localState?.currentPeriodStart,
    currentPeriodEnd: currentPlan.currentPeriodEnd || localState?.currentPeriodEnd,
    accessEndsAt,
    cancelledAt: currentPlan.cancelledAt || localState?.cancelledAt,
    metadata: {
      source: "merchant_restore",
      pendingSubscriptionId: subscription.subscriptionId,
      deferredGrantUntil: toIso(accessEndsAt),
      trialDays,
    },
  });

  return {
    ok: true,
    confirmationUrl: subscription.confirmationUrl,
    subscriptionId: subscription.subscriptionId,
    trialDays,
    message: trialDays > 0
      ? "Opening Shopify approval. Renewal is scheduled after the already-paid Starter period ends."
      : "Opening Shopify billing approval...",
  };
}

export async function createProductPulseCreditPurchase(shop, packageId, admin, returnUrl) {
  const pkg = readCreditPackage(packageId);
  const billingName = `ProductPulse ${formatWholeNumber(pkg.credits)} credits`;
  const isTestBilling = await shouldUseProductPulseTestBilling(admin, shop);
  const purchase = await prisma.creditPurchase.create({
    data: {
      shop,
      packageId: pkg.id,
      credits: pkg.credits,
      amountCents: pkg.amountCents,
      currencyCode: pkg.currencyCode,
      billingName,
      status: "pending",
    },
  });
  const callbackUrl = new URL(returnUrl);
  callbackUrl.searchParams.set("credit_purchase", purchase.id);

  try {
    const response = await admin.graphql(APP_PURCHASE_CREATE, {
      variables: {
        name: billingName,
        returnUrl: callbackUrl.toString(),
        price: {
          amount: pkg.amountCents / 100,
          currencyCode: pkg.currencyCode,
        },
        test: isTestBilling,
      },
    });
    const body = await readGraphql(response);
    const payload = readObject(readObject(body.data).appPurchaseOneTimeCreate);
    const userErrors = Array.isArray(payload.userErrors) ? payload.userErrors : [];
    if (userErrors.length) {
      const message = userErrors
        .map((error) => readObject(error).message)
        .filter(Boolean)
        .join(", ");
      throw new ProductPulseBillingError(message || "Shopify could not create the credit purchase.");
    }

    const appPurchase = readObject(payload.appPurchaseOneTime);
    const confirmationUrl = String(payload.confirmationUrl || "");
    const shopifyPurchaseId = String(appPurchase.id || "");
    if (!confirmationUrl || !shopifyPurchaseId) {
      throw new ProductPulseBillingError("Shopify did not return a confirmation URL for this credit purchase.");
    }

    await prisma.creditPurchase.update({
      where: { id: purchase.id },
      data: {
        shopifyPurchaseId,
        confirmationUrl,
        status: String(appPurchase.status || "pending").toLowerCase(),
      },
    });

    return { confirmationUrl, purchaseId: purchase.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create credit purchase.";
    await prisma.creditPurchase.update({
      where: { id: purchase.id },
      data: { status: "failed", lastError: message },
    });
    throw error;
  }
}

export async function finalizeProductPulseCreditPurchase(shop, purchaseId, admin, options = {}) {
  const purchase = await prisma.creditPurchase.findFirst({ where: { id: purchaseId, shop } });
  if (!purchase) {
    return { ok: false, message: "Credit purchase was not found." };
  }
  if (purchase.status === "credited") {
    return { ok: true, message: `${formatWholeNumber(purchase.credits)} credits were already added.` };
  }
  if (!purchase.shopifyPurchaseId) {
    return { ok: false, message: "Credit purchase is missing Shopify confirmation data." };
  }

  let status = "";
  const maxAttempts = options.settleApproval ? 4 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    status = await readShopifyPurchaseStatus(admin, purchase.shopifyPurchaseId);
    if (status === "active" || status !== "pending" || attempt === maxAttempts) break;
    await sleep(1500);
  }

  if (status === "active") {
    const result = await recordExtraCreditPackForShop(shop, {
      amount: purchase.credits,
      packLabel: `${formatWholeNumber(purchase.credits)} credits`,
      purchaseId: purchase.id,
      orderId: purchase.shopifyPurchaseId,
      priceCents: purchase.amountCents,
      idempotencyKey: `credit-purchase:${purchase.id}`,
    });
    await prisma.creditPurchase.update({
      where: { id: purchase.id },
      data: { status: "credited", lastError: null },
    });
    return {
      ok: true,
      credited: result.credited,
      message: `${formatPointAmount(purchase.credits)} credits added to your shop.`,
    };
  }

  await prisma.creditPurchase.update({
    where: { id: purchase.id },
    data: {
      status: status || "pending",
      lastError: status && status !== "pending" ? `Shopify purchase status: ${status}` : null,
    },
  });

  return {
    ok: false,
    pending: !status || status === "pending",
    message: !status || status === "pending"
      ? "Shopify is still confirming this credit purchase. Keep this page open and refresh in a few seconds."
      : "Credit purchase was not approved.",
  };
}

export async function applyProductPulseCreditPurchaseStatus(shop, shopifyPurchaseId, status, options = {}) {
  const normalizedShop = normalizeShop(shop);
  const normalizedPurchaseId = String(shopifyPurchaseId || "").trim();
  const normalizedStatus = normalizeBillingStatus(status);
  if (!normalizedShop || !normalizedPurchaseId) {
    return { ok: false, message: "A shop and Shopify purchase id are required." };
  }

  const purchase = await prisma.creditPurchase.findFirst({
    where: { shop: normalizedShop, shopifyPurchaseId: normalizedPurchaseId },
  });
  if (!purchase) {
    return { ok: false, message: "Credit purchase was not found." };
  }
  if (purchase.status === "credited" && !isRefundedPurchaseStatus(normalizedStatus)) {
    return { ok: true, credited: false, message: `${formatWholeNumber(purchase.credits)} credits were already added.` };
  }

  if (normalizedStatus === "active") {
    const result = await recordExtraCreditPackForShop(normalizedShop, {
      amount: purchase.credits,
      packLabel: `${formatWholeNumber(purchase.credits)} credits`,
      purchaseId: purchase.id,
      orderId: purchase.shopifyPurchaseId,
      priceCents: purchase.amountCents,
      idempotencyKey: `credit-purchase:${purchase.id}`,
      metadata: {
        sourceEvent: options.sourceEvent || "shopify_purchase_status",
      },
    });
    await prisma.creditPurchase.update({
      where: { id: purchase.id },
      data: { status: "credited", lastError: null },
    });
    return {
      ok: true,
      credited: result.credited,
      message: `${formatPointAmount(purchase.credits)} credits added to your shop.`,
    };
  }

  if (isRefundedPurchaseStatus(normalizedStatus)) {
    const result = await debitStorePointsForShop(normalizedShop, {
      amount: purchase.credits,
      allowNegativeBalance: true,
      reason: `Reversed extra credit pack ${formatWholeNumber(purchase.credits)} credits`,
      idempotencyKey: `credit-purchase-refund:${purchase.id}`,
      metadata: {
        source: "extra_credit_pack_refund",
        purchaseId: purchase.id,
        orderId: purchase.shopifyPurchaseId,
        status: normalizedStatus,
        sourceEvent: options.sourceEvent || "shopify_purchase_status",
      },
    });
    await prisma.creditPurchase.update({
      where: { id: purchase.id },
      data: { status: normalizedStatus || "refunded", lastError: null },
    });
    return {
      ok: true,
      reversed: result.charged || result.status === "already_recorded",
      message: `${formatPointAmount(purchase.credits)} purchased credits were reversed.`,
    };
  }

  await prisma.creditPurchase.update({
    where: { id: purchase.id },
    data: {
      status: normalizedStatus || purchase.status,
      lastError: normalizedStatus && normalizedStatus !== "pending" ? `Shopify purchase status: ${normalizedStatus}` : null,
    },
  });
  return {
    ok: false,
    pending: !normalizedStatus || normalizedStatus === "pending",
    message: normalizedStatus ? `Shopify purchase status: ${normalizedStatus}` : "Shopify purchase status is pending.",
  };
}

export async function handleProductPulseAppPurchaseOneTimeUpdate(shop, payload = {}) {
  const purchase = readWebhookPurchase(payload);
  return applyProductPulseCreditPurchaseStatus(shop, purchase.id, purchase.status, {
    sourceEvent: "APP_PURCHASES_ONE_TIME_UPDATE",
  });
}

export async function cancelProductPulseStarterSubscription({ shop, admin, billing, subscriptionId, refund = false }) {
  const normalizedShop = normalizeShop(shop);
  const normalizedSubscriptionId = String(subscriptionId || "").trim();
  if (!normalizedShop || !normalizedSubscriptionId) {
    throw new ProductPulseBillingError("No active Starter subscription was found.");
  }

  const isTest = await shouldUseProductPulseTestBilling(admin, normalizedShop);
  const planBeforeCancel = await resolveProductPulseBillingPlan({
    admin,
    billing,
    session: { shop: normalizedShop },
  });
  const now = new Date();
  const periodStart = coerceDate(planBeforeCancel.currentPeriodStart) || now;
  const periodEnd = coerceDate(planBeforeCancel.currentPeriodEnd) || new Date(now.getTime() + BILLING_PERIOD_MS);
  const periodKey = planBeforeCancel.periodKey || buildSubscriptionPeriodKey({
    subscriptionId: normalizedSubscriptionId,
    periodStart,
    periodEnd,
    now,
  });

  await billing.cancel({
    subscriptionId: normalizedSubscriptionId,
    isTest,
    prorate: Boolean(refund),
  });

  if (refund) {
    await recordPlanMonthlyPointReversalForShop(normalizedShop, {
      amount: PRODUCT_PULSE_STARTER_PLAN_CONFIG.monthlyCredits,
      planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
      planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
      subscriptionId: normalizedSubscriptionId,
      periodKey,
      periodStart,
      periodEnd,
      metadata: {
        sourceEvent: "starter_subscription_refund",
      },
    });
  }

  await upsertBillingSubscriptionStateForShop(normalizedShop, {
    subscriptionId: normalizedSubscriptionId,
    planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
    planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
    status: refund ? "refunded" : "cancelled",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    accessEndsAt: refund ? now : periodEnd,
    cancelledAt: now,
    metadata: {
      refund: Boolean(refund),
      source: "merchant_cancel",
    },
  });

  return {
    ok: true,
    refund: Boolean(refund),
    accessEndsAt: refund ? now.toISOString() : periodEnd.toISOString(),
    message: refund
      ? "Starter subscription cancelled and current-period credits were reversed."
      : "Starter subscription cancelled. Starter benefits remain active until the paid period ends.",
  };
}

export async function handleProductPulseAppSubscriptionUpdate(shop, payload = {}) {
  const subscription = readWebhookSubscription(payload);
  if (subscription.name && subscription.name !== PRODUCT_PULSE_STARTER_PLAN) {
    return { ok: true, ignored: true, message: "Subscription update ignored for a different plan." };
  }
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop || !subscription.id) {
    return { ok: false, message: "Subscription update is missing shop or subscription id." };
  }

  const now = new Date();
  const period = getSubscriptionBillingPeriod(subscription, now);
  const status = normalizeBillingStatus(subscription.status);
  const active = status === "active";
  const refunded = isRefundedSubscriptionStatus(status) || (!active && !period.periodEnd);
  const accessEndsAt = active ? period.periodEnd : refunded ? now : period.periodEnd || now;

  await upsertBillingSubscriptionStateForShop(normalizedShop, {
    subscriptionId: subscription.id,
    planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
    planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
    status: active ? "active" : refunded ? "refunded" : status || "cancelled",
    currentPeriodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
    accessEndsAt,
    cancelledAt: active ? null : now,
    metadata: {
      source: "APP_SUBSCRIPTIONS_UPDATE",
      shopifyStatus: subscription.status || null,
      test: subscription.test ?? null,
    },
  });

  if (active) {
    await recordPlanMonthlyPointGrantForShop(normalizedShop, {
      amount: PRODUCT_PULSE_STARTER_PLAN_CONFIG.monthlyCredits,
      planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
      planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
      subscriptionId: subscription.id,
      periodKey: period.periodKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      metadata: {
        sourceEvent: "APP_SUBSCRIPTIONS_UPDATE",
      },
    });
  } else if (refunded) {
    await recordPlanMonthlyPointReversalForShop(normalizedShop, {
      amount: PRODUCT_PULSE_STARTER_PLAN_CONFIG.monthlyCredits,
      planKey: PRODUCT_PULSE_STARTER_PLAN_CONFIG.key,
      planName: PRODUCT_PULSE_STARTER_PLAN_CONFIG.name,
      subscriptionId: subscription.id,
      periodKey: period.periodKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      metadata: {
        sourceEvent: "APP_SUBSCRIPTIONS_UPDATE",
      },
    });
  }

  return { ok: true, status: active ? "active" : refunded ? "refunded" : status || "cancelled" };
}

export function getProductPulseBillingView() {
  return {
    shopifyBillingEnabled: true,
    plans: [
      planView(PRODUCT_PULSE_FREE_PLAN),
      planView(PRODUCT_PULSE_STARTER_PLAN_CONFIG),
    ],
    starterPlan: planView(PRODUCT_PULSE_STARTER_PLAN_CONFIG),
    creditPacks: PRODUCT_PULSE_CREDIT_PACKAGES.map(creditPackageView),
  };
}

export function serializeProductPulseBillingError(error) {
  return {
    name: error instanceof Error ? error.name : "ProductPulseBillingError",
    message: error instanceof Error ? error.message : "Could not complete the Shopify Billing action.",
  };
}

async function resolveBillingSnapshot(billing, isTest, admin = null) {
  const filtered = await billing.check({
    plans: [PRODUCT_PULSE_STARTER_PLAN],
    isTest,
  });
  const filteredSubscriptions = await enrichSubscriptionsWithCurrentInstallation(
    normalizeSubscriptions(filtered?.appSubscriptions),
    admin,
  );
  const filteredStarter = starterSubscription(filteredSubscriptions);
  if (filteredStarter) {
    return {
      appSubscriptions: filteredSubscriptions,
      activeSubscription: filteredStarter,
      source: "filtered",
    };
  }

  const unfiltered = await billing.check();
  const unfilteredSubscriptions = await enrichSubscriptionsWithCurrentInstallation(
    normalizeSubscriptions(unfiltered?.appSubscriptions),
    admin,
  );
  const unfilteredStarter = starterSubscription(unfilteredSubscriptions);
  return {
    appSubscriptions: unfilteredStarter ? unfilteredSubscriptions : filteredSubscriptions,
    activeSubscription: unfilteredStarter,
    source: unfilteredStarter ? "unfiltered" : "filtered",
  };
}

function starterSubscription(subscriptions) {
  return subscriptions.find((subscription) => subscription.name === PRODUCT_PULSE_STARTER_PLAN);
}

function normalizeSubscriptions(value) {
  return Array.isArray(value) ? value : [];
}

async function enrichSubscriptionsWithCurrentInstallation(subscriptions, admin) {
  if (!subscriptions.length || subscriptions.some((subscription) => subscription.currentPeriodEnd)) return subscriptions;
  if (!admin || typeof admin.graphql !== "function") return subscriptions;

  const installationSubscriptions = await readCurrentInstallationSubscriptions(admin).catch(() => []);
  if (!installationSubscriptions.length) return subscriptions;
  return subscriptions.map((subscription) => {
    const match = installationSubscriptions.find((candidate) => candidate.id === subscription.id);
    return match ? { ...subscription, ...match } : subscription;
  });
}

async function readCurrentInstallationSubscriptions(admin) {
  const response = await admin.graphql(APP_INSTALLATION_BILLING_QUERY);
  const body = await readGraphql(response);
  return normalizeSubscriptions(readObject(readObject(body.data).currentAppInstallation).activeSubscriptions);
}

function buildCreditPackage(id, credits, description, envKey, fallbackCents, compareAtEnvKey, fallbackCompareAtCents) {
  return {
    id,
    credits,
    amountCents: configuredCents(envKey, fallbackCents),
    compareAtPriceCents: configuredCents(compareAtEnvKey, fallbackCompareAtCents),
    currencyCode: "USD",
    description,
  };
}

function creditPackageView(pkg) {
  return {
    ...pkg,
    price: pkg.amountCents / 100,
    priceLabel: formatCurrency(pkg.amountCents, pkg.currencyCode),
    compareAtPriceLabel: pkg.compareAtPriceCents > pkg.amountCents
      ? formatCurrency(pkg.compareAtPriceCents, pkg.currencyCode)
      : "",
    creditsLabel: `${formatWholeNumber(pkg.credits)} credits`,
  };
}

function planView(plan) {
  return {
    ...plan,
    price: plan.priceCents / 100,
    priceLabel: formatCurrency(plan.priceCents, plan.currencyCode),
    compareAtPriceLabel: plan.compareAtPriceCents > plan.priceCents
      ? formatCurrency(plan.compareAtPriceCents, plan.currencyCode)
      : "",
  };
}

function readCreditPackage(packageId) {
  const pkg = PRODUCT_PULSE_CREDIT_PACKAGES.find((candidate) => candidate.id === packageId);
  if (!pkg) throw new ProductPulseBillingError("Select a valid credit package.");
  return pkg;
}

function configuredCents(envKey, fallbackCents) {
  const value = Number(process.env[envKey]);
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  return fallbackCents;
}

function envBillingTestOverride() {
  const value = process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

async function getBillingSubscriptionStateForShop(shop) {
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop || typeof prisma.billingSubscriptionState?.findUnique !== "function") return null;
  return prisma.billingSubscriptionState.findUnique({ where: { shop: normalizedShop } }).catch(() => null);
}

async function upsertBillingSubscriptionStateForShop(shop, input = {}) {
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop || typeof prisma.billingSubscriptionState?.upsert !== "function") return null;
  const now = new Date();
  const data = {
    subscriptionId: input.subscriptionId || null,
    planKey: input.planKey || "free",
    planName: input.planName || null,
    status: input.status || "free",
    currentPeriodStart: coerceDate(input.currentPeriodStart),
    currentPeriodEnd: coerceDate(input.currentPeriodEnd),
    accessEndsAt: coerceDate(input.accessEndsAt),
    cancelledAt: coerceDate(input.cancelledAt),
    lastSyncedAt: now,
    metadata: normalizeMetadata(input.metadata),
  };
  return prisma.billingSubscriptionState.upsert({
    where: { shop: normalizedShop },
    create: {
      shop: normalizedShop,
      ...data,
    },
    update: data,
  }).catch((error) => {
    if (isMissingPrismaTableError(error)) return null;
    throw error;
  });
}

function isBillingSubscriptionStateAccessible(state, now = new Date()) {
  if (!state || state.planKey !== PRODUCT_PULSE_STARTER_PLAN_CONFIG.key) return false;
  if (state.status === "refunded" || state.status === "free" || state.status === "frozen") return false;
  const accessEndsAt = coerceDate(state.accessEndsAt || state.currentPeriodEnd);
  return Boolean(accessEndsAt && accessEndsAt.getTime() > now.getTime());
}

function getDeferredStarterGrantUntil(activeSubscription = {}, localState = null, now = new Date()) {
  const subscriptionId = String(activeSubscription?.id || "");
  const metadataDeferredUntil = coerceDate(localState?.metadata?.deferredGrantUntil);
  if (metadataDeferredUntil && metadataDeferredUntil.getTime() > now.getTime()) return metadataDeferredUntil;
  const localAccessEndsAt = coerceDate(localState?.accessEndsAt || localState?.currentPeriodEnd);
  const restoredDuringPaidAccess = localState
    && localState.planKey === PRODUCT_PULSE_STARTER_PLAN_CONFIG.key
    && ["cancelled", "restore_pending"].includes(String(localState.status || ""))
    && localAccessEndsAt
    && localAccessEndsAt.getTime() > now.getTime()
    && String(localState.subscriptionId || "") !== subscriptionId;
  return restoredDuringPaidAccess ? localAccessEndsAt : null;
}

function normalizeTrialDays(value) {
  const days = Number(value || 0);
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.max(0, Math.ceil(days));
}

function getSubscriptionBillingPeriod(subscription = {}, now = new Date()) {
  const subscriptionId = String(subscription?.id || "").trim();
  const periodEnd = coerceDate(subscription?.currentPeriodEnd || subscription?.current_period_end);
  const createdAt = coerceDate(subscription?.createdAt || subscription?.created_at);
  const periodStart = periodEnd
    ? new Date(periodEnd.getTime() - BILLING_PERIOD_MS)
    : getFallbackBillingPeriodStart(createdAt || now, now);
  const normalizedPeriodEnd = periodEnd || new Date(periodStart.getTime() + BILLING_PERIOD_MS);
  return {
    periodStart,
    periodEnd: normalizedPeriodEnd,
    periodKey: buildSubscriptionPeriodKey({
      subscriptionId,
      periodStart,
      periodEnd: normalizedPeriodEnd,
      now,
    }),
  };
}

function getFallbackBillingPeriodStart(anchor, now = new Date()) {
  const anchorTime = anchor.getTime();
  const elapsed = Math.max(0, now.getTime() - anchorTime);
  const periodIndex = Math.floor(elapsed / BILLING_PERIOD_MS);
  return new Date(anchorTime + periodIndex * BILLING_PERIOD_MS);
}

function buildSubscriptionPeriodKey({ periodStart = null, periodEnd = null, now = new Date() } = {}) {
  const end = coerceDate(periodEnd);
  const start = coerceDate(periodStart);
  if (end) return `ends-${formatDateKey(end)}`;
  if (start) return `starts-${formatDateKey(start)}`;
  return `fallback-${Math.floor(now.getTime() / BILLING_PERIOD_MS)}`;
}

function readWebhookPurchase(payload = {}) {
  const node = readObject(payload.app_purchase_one_time || payload.appPurchaseOneTime || payload);
  return {
    id: String(node.admin_graphql_api_id || node.adminGraphqlApiId || node.id || ""),
    status: node.status,
  };
}

function readWebhookSubscription(payload = {}) {
  const node = readObject(payload.app_subscription || payload.appSubscription || payload);
  return {
    id: String(node.admin_graphql_api_id || node.adminGraphqlApiId || node.id || ""),
    name: String(node.name || ""),
    status: node.status,
    test: node.test,
    createdAt: node.created_at || node.createdAt,
    currentPeriodEnd: node.current_period_end || node.currentPeriodEnd,
  };
}

function normalizeBillingStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isRefundedPurchaseStatus(status) {
  return ["refunded", "cancelled", "canceled", "revoked"].includes(normalizeBillingStatus(status));
}

function isRefundedSubscriptionStatus(status) {
  return normalizeBillingStatus(status) === "refunded";
}

function isMissingPrismaTableError(error) {
  return error?.code === "P2021";
}

function normalizeShop(shop) {
  return String(shop || "").trim();
}

function normalizeMetadata(metadata = {}) {
  const normalized = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
  return Object.keys(normalized).length ? normalized : undefined;
}

function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(value) {
  const date = coerceDate(value);
  if (!date) return "unknown";
  return date.toISOString().slice(0, 10);
}

function toIso(value) {
  const date = coerceDate(value);
  return date ? date.toISOString() : null;
}

async function readGraphql(response) {
  return response.json();
}

async function readShopifyPurchaseStatus(admin, shopifyPurchaseId) {
  const response = await admin.graphql(APP_PURCHASE_STATUS, {
    variables: { id: shopifyPurchaseId },
  });
  const body = await readGraphql(response);
  const node = readObject(readObject(body.data).node);
  return String(node.status || "").toLowerCase();
}

function readObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function formatCurrency(amountCents, currencyCode) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: Number.isInteger(amountCents / 100) ? 0 : 2,
  }).format(amountCents / 100);
}

function formatWholeNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(normalizePointAmount(value));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
