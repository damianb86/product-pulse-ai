import { useLoaderData } from "react-router";
import { Buffer } from "node:buffer";
import process from "node:process";
import { authenticate } from "../shopify.server";
import { PlansCreditsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  getProductPulseBillingView,
  cancelProductPulseStarterSubscription,
  createProductPulseStarterSubscription,
  createProductPulseCreditPurchase,
  finalizeProductPulseCreditPurchase,
  resolveProductPulseBillingPlan,
  restoreProductPulseStarterSubscription,
  serializeProductPulseBillingError,
} from "../lib/product-pulse-billing.server";
import {
  getStorePointSummaryForShop,
  recordPlanMonthlyPointGrantForShop,
} from "../lib/product-pulse-points.server";

export const loader = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const billingReturn = url.searchParams.get("billing") === "approved";
  const billingPlan = await resolveProductPulseBillingPlan({
    admin,
    billing,
    session,
    settleBillingApproval: billingReturn && !url.pathname.endsWith(".data"),
  });
  const creditPurchaseId = url.searchParams.get("credit_purchase");
  const creditPurchaseResult = creditPurchaseId
    ? await finalizeCreditPurchaseForLoader(session.shop, creditPurchaseId, admin, url)
    : null;

  if (billingPlan.planKey === "starter" && billingPlan.grantEligible) {
    await recordPlanMonthlyPointGrantForShop(session.shop, {
      amount: billingPlan.monthlyCredits,
      planKey: billingPlan.planKey,
      planName: billingPlan.planName,
      subscriptionId: billingPlan.subscriptionId,
      periodKey: billingPlan.periodKey,
      periodStart: billingPlan.currentPeriodStart,
      periodEnd: billingPlan.currentPeriodEnd,
    });
  }

  const [data, pointSummary] = await Promise.all([
    getAppViewData(),
    getStorePointSummaryForShop(session.shop, {
      limit: 10,
      planKey: billingPlan.planKey,
      planName: billingPlan.planName,
      planAllowance: billingPlan.monthlyCredits,
      planRenewalLabel: getPlanRenewalLabel(billingPlan),
    }),
  ]);
  return {
    ...data,
    pointSummary,
    billing: {
      ...(data.billing || {}),
      ...getProductPulseBillingView(),
      billingEnabled: true,
      currentPlanKey: billingPlan.planKey,
      planKey: billingPlan.planKey,
      planName: billingPlan.planName,
      monthlyCredits: billingPlan.monthlyCredits,
      subscriptionId: billingPlan.subscriptionId,
      subscriptionStatus: billingPlan.subscriptionStatus,
      cancellationKeepsAccess: billingPlan.cancellationKeepsAccess,
      cancelledAt: billingPlan.cancelledAt,
      accessEndsAt: billingPlan.accessEndsAt,
      currentPeriodEnd: billingPlan.currentPeriodEnd,
      billingReturnStatus: !billingReturn ? "none" : billingPlan.planKey === "starter" ? "confirmed" : "pending",
      billingReturnChargeId: url.searchParams.get("charge_id"),
      creditPurchaseResult,
      creditsAvailable: pointSummary.balance.available,
      creditsUsed: pointSummary.usage.used,
      pointBalance: pointSummary.balance,
      pointSummary,
    },
  };
};

export const action = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "subscribe-starter") {
    try {
      const subscription = await createProductPulseStarterSubscription(
        session.shop,
        admin,
        billingReturnUrl(request, session.shop),
      );
      return {
        ok: true,
        intent,
        message: "Opening Shopify billing approval...",
        confirmationUrl: subscription.confirmationUrl,
      };
    } catch (error) {
      const serialized = serializeProductPulseBillingError(error);
      return {
        ok: false,
        intent,
        billingUnavailable: isDevelopmentBillingError(error),
        message: serialized.message,
        error: serialized,
      };
    }
  }

  if (intent === "cancel-starter") {
    const subscriptionId = String(formData.get("subscriptionId") || "");
    if (!subscriptionId) {
      return { ok: false, intent, message: "No active Starter subscription was found." };
    }
    try {
      const cancellation = await cancelProductPulseStarterSubscription({
        shop: session.shop,
        admin,
        billing,
        subscriptionId,
        refund: formData.get("refund") === "true",
      });
      return {
        ok: true,
        intent,
        message: cancellation.message,
      };
    } catch (error) {
      if (error instanceof Response) throw error;
      const serialized = serializeProductPulseBillingError(error);
      return {
        ok: false,
        intent,
        message: serialized.message || "Could not cancel the Starter subscription.",
        error: serialized,
      };
    }
  }

  if (intent === "restore-starter") {
    try {
      const restoration = await restoreProductPulseStarterSubscription({
        shop: session.shop,
        admin,
        billing,
        returnUrl: billingReturnUrl(request, session.shop),
      });
      return {
        ok: true,
        intent,
        message: restoration.message,
        confirmationUrl: restoration.confirmationUrl,
      };
    } catch (error) {
      if (error instanceof Response) throw error;
      const serialized = serializeProductPulseBillingError(error);
      return {
        ok: false,
        intent,
        message: serialized.message || "Could not restore the Starter subscription.",
        error: serialized,
      };
    }
  }

  if (intent === "buy-credit-pack") {
    const packageId = String(formData.get("packageId") || "");
    try {
      const purchase = await createProductPulseCreditPurchase(
        session.shop,
        packageId,
        admin,
        billingReturnUrl(request, session.shop),
      );
      return {
        ok: true,
        intent,
        message: "Opening Shopify billing approval...",
        confirmationUrl: purchase.confirmationUrl,
      };
    } catch (error) {
      const serialized = serializeProductPulseBillingError(error);
      return {
        ok: false,
        intent,
        message: serialized.message,
        error: serialized,
      };
    }
  }

  return { ok: false, intent, message: "Unknown billing action." };
};

export default function PlansAndCredits() {
  const data = useLoaderData();
  return <PlansCreditsScreen data={data} />;
}

async function finalizeCreditPurchaseForLoader(shop, creditPurchaseId, admin, url) {
  try {
    return await finalizeProductPulseCreditPurchase(shop, creditPurchaseId, admin, {
      chargeId: url.searchParams.get("charge_id"),
      settleApproval: !url.pathname.endsWith(".data"),
    });
  } catch (error) {
    const serialized = serializeProductPulseBillingError(error);
    return { ok: false, message: serialized.message };
  }
}

function billingReturnUrl(request, shop) {
  const url = new URL(request.url);
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (apiKey && shop) {
    const returnUrl = new URL(`https://admin.shopify.com/store/${shopAdminHandle(shop)}/apps/${apiKey}/app/plans-and-credits`);
    returnUrl.searchParams.set("billing", "approved");
    return returnUrl.toString();
  }

  const returnUrl = new URL("/app/plans-and-credits", requestOrigin(request));
  returnUrl.searchParams.set("billing", "approved");
  for (const key of ["embedded", "host", "shop"]) {
    const value = url.searchParams.get(key);
    if (value) returnUrl.searchParams.set(key, value);
  }
  if (shop && !returnUrl.searchParams.get("shop")) returnUrl.searchParams.set("shop", shop);
  if (shop && !returnUrl.searchParams.get("host")) {
    returnUrl.searchParams.set(
      "host",
      Buffer.from(`admin.shopify.com/store/${shopAdminHandle(shop)}`).toString("base64"),
    );
  }
  return returnUrl.toString();
}

function requestOrigin(request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost || url.host}`;
}

function shopAdminHandle(shop) {
  return String(shop || "").replace(/\.myshopify\.com$/i, "");
}

function isDevelopmentBillingError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /billing|cannot be charged|development|test/i.test(message);
}

function getPlanRenewalLabel(billingPlan = {}) {
  if (billingPlan.planKey !== "starter") return "Does not renew";
  const accessEndsAt = formatBillingDate(billingPlan.accessEndsAt || billingPlan.currentPeriodEnd);
  if (billingPlan.cancellationKeepsAccess && accessEndsAt) return `Active until ${accessEndsAt}`;
  return accessEndsAt ? `Renews ${accessEndsAt}` : "Renews every 30 days";
}

function formatBillingDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
