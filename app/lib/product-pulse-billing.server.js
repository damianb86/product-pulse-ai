import prisma from "../db.server";
import { PRODUCT_PULSE_STARTER_PLAN } from "./product-pulse-billing-config";
import {
  formatPointAmount,
  normalizePointAmount,
  recordExtraCreditPackForShop,
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

export const PRODUCT_PULSE_FREE_PLAN = {
  key: "free",
  name: "Free",
  monthlyCredits: 10,
  priceCents: 0,
  currencyCode: "USD",
};

export const PRODUCT_PULSE_STARTER_PLAN_CONFIG = {
  key: "starter",
  name: "Starter",
  shopifyPlanName: PRODUCT_PULSE_STARTER_PLAN,
  monthlyCredits: 50,
  priceCents: configuredCents("PRODUCT_PULSE_STARTER_PLAN_PRICE_CENTS", 1900),
  currencyCode: "USD",
};

export const PRODUCT_PULSE_CREDIT_PACKAGES = [
  buildCreditPackage("pack_10", 10, "Small top-up", "PRODUCT_PULSE_CREDIT_PACK_10_PRICE_CENTS", 400),
  buildCreditPackage("pack_25", 25, "Most common setup pack", "PRODUCT_PULSE_CREDIT_PACK_25_PRICE_CENTS", 750),
  buildCreditPackage("pack_50", 50, "Monthly working buffer", "PRODUCT_PULSE_CREDIT_PACK_50_PRICE_CENTS", 1400),
  buildCreditPackage("pack_100", 100, "Frequent diagnosis pack", "PRODUCT_PULSE_CREDIT_PACK_100_PRICE_CENTS", 2500),
  buildCreditPackage("pack_250", 250, "High-volume diagnosis pack", "PRODUCT_PULSE_CREDIT_PACK_250_PRICE_CENTS", 5500),
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
  let snapshot = await resolveBillingSnapshot(billing, isTest);
  let attempts = 1;

  if (settleBillingApproval && !snapshot.activeSubscription) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      await sleep(1500);
      attempts += 1;
      snapshot = await resolveBillingSnapshot(billing, isTest);
      if (snapshot.activeSubscription) break;
    }
  }

  const hasStarter = Boolean(snapshot.activeSubscription);
  const plan = hasStarter ? PRODUCT_PULSE_STARTER_PLAN_CONFIG : PRODUCT_PULSE_FREE_PLAN;
  return {
    isTest,
    attempts,
    source: snapshot.source,
    planKey: plan.key,
    planName: plan.name,
    shopifyPlanName: hasStarter ? PRODUCT_PULSE_STARTER_PLAN : null,
    monthlyCredits: plan.monthlyCredits,
    priceCents: plan.priceCents,
    currencyCode: plan.currencyCode,
    subscriptionId: snapshot.activeSubscription?.id ?? null,
    subscriptions: snapshot.appSubscriptions,
  };
}

export async function createProductPulseCreditPurchase(shop, packageId, admin, returnUrl) {
  const pkg = readCreditPackage(packageId);
  const billingName = `ProductPulse ${formatWholeNumber(pkg.credits)} diagnosis credits`;
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
      throw new ProductPulseBillingError(message || "Shopify could not create the diagnosis credit purchase.");
    }

    const appPurchase = readObject(payload.appPurchaseOneTime);
    const confirmationUrl = String(payload.confirmationUrl || "");
    const shopifyPurchaseId = String(appPurchase.id || "");
    if (!confirmationUrl || !shopifyPurchaseId) {
      throw new ProductPulseBillingError("Shopify did not return a confirmation URL for this diagnosis credit purchase.");
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
    const message = error instanceof Error ? error.message : "Could not create diagnosis credit purchase.";
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
    return { ok: false, message: "Diagnosis credit purchase was not found." };
  }
  if (purchase.status === "credited") {
    return { ok: true, message: `${formatWholeNumber(purchase.credits)} diagnosis credits were already added.` };
  }
  if (!purchase.shopifyPurchaseId) {
    return { ok: false, message: "Diagnosis credit purchase is missing Shopify confirmation data." };
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
      packLabel: `${formatWholeNumber(purchase.credits)} diagnosis credits`,
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
      message: `${formatPointAmount(purchase.credits)} diagnosis credits added to your shop.`,
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
      ? "Shopify is still confirming this diagnosis credit purchase. Keep this page open and refresh in a few seconds."
      : "Diagnosis credit purchase was not approved.",
  };
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

async function resolveBillingSnapshot(billing, isTest) {
  const filtered = await billing.check({
    plans: [PRODUCT_PULSE_STARTER_PLAN],
    isTest,
  });
  const filteredSubscriptions = normalizeSubscriptions(filtered?.appSubscriptions);
  const filteredStarter = starterSubscription(filteredSubscriptions);
  if (filteredStarter) {
    return {
      appSubscriptions: filteredSubscriptions,
      activeSubscription: filteredStarter,
      source: "filtered",
    };
  }

  const unfiltered = await billing.check();
  const unfilteredSubscriptions = normalizeSubscriptions(unfiltered?.appSubscriptions);
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

function buildCreditPackage(id, credits, description, envKey, fallbackCents) {
  return {
    id,
    credits,
    amountCents: configuredCents(envKey, fallbackCents),
    currencyCode: "USD",
    description,
  };
}

function creditPackageView(pkg) {
  return {
    ...pkg,
    price: pkg.amountCents / 100,
    priceLabel: formatCurrency(pkg.amountCents, pkg.currencyCode),
    creditsLabel: `${formatWholeNumber(pkg.credits)} credits`,
  };
}

function planView(plan) {
  return {
    ...plan,
    price: plan.priceCents / 100,
    priceLabel: formatCurrency(plan.priceCents, plan.currencyCode),
  };
}

function readCreditPackage(packageId) {
  const pkg = PRODUCT_PULSE_CREDIT_PACKAGES.find((candidate) => candidate.id === packageId);
  if (!pkg) throw new ProductPulseBillingError("Select a valid diagnosis credit package.");
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
