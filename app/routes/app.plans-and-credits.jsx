import { useLoaderData } from "react-router";
import { Buffer } from "node:buffer";
import process from "node:process";
import { authenticate } from "../shopify.server";
import { PlansCreditsScreen } from "../components/ProductPulseScreens";
import { PRODUCT_PULSE_STARTER_PLAN } from "../lib/product-pulse-billing-config";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  getProductPulseBillingView,
  createProductPulseCreditPurchase,
  finalizeProductPulseCreditPurchase,
  resolveProductPulseBillingPlan,
  serializeProductPulseBillingError,
  shouldUseProductPulseTestBilling,
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

  if (billingPlan.planKey === "starter") {
    await recordPlanMonthlyPointGrantForShop(session.shop, {
      amount: billingPlan.monthlyCredits,
      planKey: billingPlan.planKey,
      planName: billingPlan.planName,
      subscriptionId: billingPlan.subscriptionId,
    });
  }

  const [data, pointSummary] = await Promise.all([
    getAppViewData(),
    getStorePointSummaryForShop(session.shop, {
      limit: 10,
      planKey: billingPlan.planKey,
      planName: billingPlan.planName,
      planAllowance: billingPlan.monthlyCredits,
      planRenewalLabel: billingPlan.planKey === "starter" ? "Renews every 30 days" : "Does not renew",
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
    const isTest = await shouldUseProductPulseTestBilling(admin, session.shop);
    try {
      const billingRequestResult = await billing.request({
        plan: PRODUCT_PULSE_STARTER_PLAN,
        isTest,
        returnUrl: billingReturnUrl(request, session.shop),
      });
      const confirmationUrl = typeof billingRequestResult === "string"
        ? billingRequestResult
        : billingRequestResult?.confirmationUrl;
      if (confirmationUrl) {
        return {
          ok: true,
          intent,
          message: "Opening Shopify billing approval...",
          confirmationUrl,
        };
      }
      return {
        ok: true,
        intent,
        message: "Opening Shopify billing approval...",
      };
    } catch (error) {
      if (error instanceof Response) throw error;
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
    const isTest = await shouldUseProductPulseTestBilling(admin, session.shop);
    try {
      await billing.cancel({
        subscriptionId,
        isTest,
        prorate: true,
      });
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
    return {
      ok: true,
      intent,
      message: "Starter subscription cancelled. You are now on the Free plan.",
    };
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
