import { useEffect } from "react";
import * as Sentry from "@sentry/react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAiChatConfig } from "../ai/chat/config.server";
import { getAiChatMonthlyQuotaForShop } from "../ai/chat/quota.server";
import { getAiChatKitClientConfig } from "../ai/chatkit/config.server";
import { isAiCostDashboardEnabled } from "../ai/observability/usageEvents.server";
import { BetaFeedbackProvider } from "../components/beta-feedback/BetaFeedbackLayer";
import { ProductPulseChatKitAssistant } from "../components/ProductPulseChatKitAssistant";
import { ProductPulseJobMonitor } from "../components/ProductPulseJobMonitor";
import { ProductPulseWatchlistWizard } from "../components/ProductPulseWatchlistWizard";
import { ProductPulseWizard } from "../components/ProductPulseWizard";
import { getBetaFeedbackClientConfig } from "../lib/beta-feedback-config.server";
import { buildEmbeddedAppPath, getEmbeddedAppPathname } from "../lib/product-pulse-app-paths";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.app", { route: "/app" });
  const { session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });
  setSentrySessionContext(session);
  const developmentMode = isProductPulseDevelopment();
  const aiChatConfig = getAiChatConfig();
  const chatQuota = await measureProductPulseStep(perf, "getAiChatMonthlyQuotaForShop", () => getAiChatMonthlyQuotaForShop(session.shop, {
    userId: session.userId,
    defaultModel: aiChatConfig.defaultModel,
    cheapModel: aiChatConfig.cheapModel,
    standardMonthlyMessageLimit: aiChatConfig.standardMonthlyMessageLimit,
    cheapMonthlyMessageLimit: aiChatConfig.cheapMonthlyMessageLimit,
  }));
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  // eslint-disable-next-line no-undef
  const env = process.env;

  perf.done({ shop: session.shop });
  return {
    apiKey,
    shop: session.shop,
    developmentMode,
    aiCostDashboardEnabled: isAiCostDashboardEnabled(),
    chatKit: getAiChatKitClientConfig(),
    chatQuota: serializeChatQuotaForClient(chatQuota),
    jobMonitor: null,
    betaFeedback: getBetaFeedbackClientConfig({ session }),
    observability: {
      sentry: getSentryClientRuntimeConfig(session, env),
    },
  };
};

export default function App() {
  const { apiKey, shop, developmentMode, aiCostDashboardEnabled, chatKit, chatQuota, jobMonitor, betaFeedback, observability } = useLoaderData();
  const location = useLocation();
  const appPathname = getEmbeddedAppPathname(location.pathname);
  const activeSection = getActiveNavSection(appPathname);
  const aiPageContext = getAiPageContext(location);
  const buildHref = (pathname, extraParams = {}) => buildEmbeddedAppHref(location, pathname, { shop, extraParams });
  const dashboardHref = activeSection === "dashboard" ? buildHref(appPathname) : buildHref("/app/dashboard");

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ProductPulseSentryContext config={observability?.sentry} activeSection={activeSection} />
      <BetaFeedbackProvider config={betaFeedback}>
        <ProductPulseJobMonitor initialMonitor={jobMonitor} developmentMode={developmentMode} shop={shop} />
        <s-app-nav>
          <s-link href={dashboardHref} data-active={activeSection === "dashboard" ? "true" : undefined}>Dashboard</s-link>
          <s-link href={buildHref("/app/products")} data-active={activeSection === "products" ? "true" : undefined}>Products</s-link>
          <s-link href={buildHref("/app/watchlist")} data-active={activeSection === "watchlist" ? "true" : undefined}>Watchlist</s-link>
          <s-link href={buildHref("/app/analytics")} data-active={activeSection === "analytics" ? "true" : undefined}>Analytics</s-link>
          <s-link href={buildHref("/app/plans-and-credits")} data-active={activeSection === "plans-and-credits" ? "true" : undefined}>Plan &amp; Credits</s-link>
          {aiCostDashboardEnabled ? (
            <s-link href={buildHref("/app/ai-costs")} data-active={activeSection === "ai-costs" ? "true" : undefined}>AI Costs</s-link>
          ) : null}
          <s-link href={buildHref("/app/connect")} data-active={activeSection === "connect" ? "true" : undefined}>Connect</s-link>
          <s-link href={buildHref("/app/settings")} data-active={activeSection === "settings" ? "true" : undefined}>Settings</s-link>
          <s-link href={buildHref("/app/help")} data-active={activeSection === "help" ? "true" : undefined}>Help & Contact</s-link>
        </s-app-nav>
        <Outlet />
        <ProductPulseChatKitAssistant config={chatKit} quota={chatQuota} pageContext={aiPageContext} />
        <ProductPulseWizard />
        <ProductPulseWatchlistWizard />
      </BetaFeedbackProvider>
    </AppProvider>
  );
}

function ProductPulseSentryContext({ config, activeSection }) {
  const location = useLocation();
  const pathname = location.pathname || "/";

  useEffect(() => {
    if (!config?.enabled) return;

    const shop = String(config.shop || "").trim();
    const userId = String(config.userId || "").trim();
    const userKey = buildSentryUserKey(shop, userId);

    Sentry.setUser(userKey ? { id: userKey } : null);
    if (shop) Sentry.setTag("shop", shop);
    if (config.environment) Sentry.setTag("app.environment", config.environment);
    if (config.appVersion) Sentry.setTag("app.version", config.appVersion);
    Sentry.setTag("product_pulse.embedded", "true");

    return () => {
      Sentry.setUser(null);
    };
  }, [config]);

  useEffect(() => {
    if (!config?.enabled) return;

    Sentry.setTag("product_pulse.section", activeSection || "unknown");
    Sentry.setContext("product_pulse.route", {
      pathname,
      section: activeSection || "unknown",
    });
    Sentry.addBreadcrumb({
      category: "navigation",
      type: "navigation",
      level: "info",
      message: pathname,
      data: {
        section: activeSection || "unknown",
      },
    });
  }, [activeSection, config?.enabled, pathname]);

  return null;
}

function serializeChatQuotaForClient(quota) {
  return {
    allowed: Boolean(quota?.allowed),
    message: quota?.message || "",
    tier: quota?.tier || "standard",
    totalMessageCount: quota?.usage?.totalMessageCount || 0,
    cheapMessageCount: quota?.usage?.cheapMessageCount || 0,
    standardMonthlyMessageLimit: quota?.usage?.standardMonthlyMessageLimit || 30,
    cheapMonthlyMessageLimit: quota?.usage?.cheapMonthlyMessageLimit || 100,
    periodEnd: quota?.usage?.periodEnd || null,
  };
}

function buildEmbeddedAppHref(location, pathname, { shop = "", extraParams = {} } = {}) {
  const params = getShopifyNavigationParams(location.search, shop);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  const scopedPathname = buildEmbeddedAppPath(location.pathname, pathname);
  return query ? `${scopedPathname}?${query}` : scopedPathname;
}

function getShopifyNavigationParams(search, shop) {
  const currentParams = new URLSearchParams(search);
  const params = new URLSearchParams();
  ["shop", "host", "embedded", "locale"].forEach((key) => {
    const value = currentParams.get(key);
    if (value) params.set(key, value);
  });
  if (!params.get("shop") && shop) params.set("shop", shop);
  return params;
}

function getActiveNavSection(pathname) {
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/dashboard")) return "dashboard";
  if (pathname.startsWith("/app/products")) return "products";
  if (pathname.startsWith("/app/watchlist")) return "watchlist";
  if (pathname.startsWith("/app/analytics")) return "analytics";
  if (pathname.startsWith("/app/plans-and-credits")) return "plans-and-credits";
  if (pathname.startsWith("/app/ai-costs")) return "ai-costs";
  if (pathname.startsWith("/app/connect")) return "connect";
  if (pathname.startsWith("/app/settings")) return "settings";
  if (pathname.startsWith("/app/help")) return "help";
  return "";
}

function getAiPageContext(location) {
  const pathname = getEmbeddedAppPathname(location.pathname);
  const searchParams = new URLSearchParams(location.search);
  const filters = getSafeFilterContext(searchParams);

  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/dashboard")) return { type: "dashboard", filters };
  if (pathname.startsWith("/app/products/")) {
    const segments = pathname.split("/").filter(Boolean);
    const productRef = segments[2] ? safeDecodePathSegment(segments[2]) : "";
    return {
      type: "product",
      entityId: productRef || undefined,
      entityHandle: productRef && !productRef.startsWith("gid://") ? productRef : undefined,
      filters,
    };
  }
  if (pathname.startsWith("/app/products")) return { type: "products", filters };
  if (pathname.startsWith("/app/watchlist")) return { type: "watchlist", filters };
  if (pathname.startsWith("/app/analytics")) return { type: "analytics", filters };
  if (pathname.startsWith("/app/plans-and-credits")) return { type: "plans-and-credits", filters };
  if (pathname.startsWith("/app/ai-costs")) return { type: "analytics", filters };
  if (pathname.startsWith("/app/background-processes")) return { type: "background-processes", filters };
  if (pathname.startsWith("/app/connect")) return { type: "connect", filters };
  if (pathname.startsWith("/app/settings")) return { type: "settings", filters };
  return { type: "unknown", filters };
}

function getSafeFilterContext(searchParams) {
  const filters = {};
  ["q", "risk", "status", "issue", "source", "vendor", "collection", "sort", "direction"].forEach((key) => {
    const value = searchParams.get(key);
    if (value) filters[key] = value.slice(0, 180);
  });
  return filters;
}

function safeDecodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function setSentrySessionContext(session = {}) {
  const shop = String(session.shop || "").trim();
  const userId = session.userId == null ? "" : String(session.userId);
  const userKey = buildSentryUserKey(shop, userId);

  if (userKey) Sentry.setUser({ id: userKey });
  if (shop) Sentry.setTag("shop", shop);
  Sentry.setTag("product_pulse.embedded", "true");
}

function getSentryClientRuntimeConfig(session = {}, env = {}) {
  return {
    enabled: Boolean(getConfiguredEnvValue(env.VITE_SENTRY_DSN, env.SENTRY_DSN)),
    shop: String(session.shop || ""),
    userId: session.userId == null ? "" : String(session.userId),
    environment: getConfiguredEnvValue(env.SENTRY_ENVIRONMENT, env.APP_ENV, env.NODE_ENV) || "",
    appVersion: getConfiguredEnvValue(env.SENTRY_RELEASE, env.APP_VERSION, env.SOURCE_VERSION, env.COMMIT_SHA) || "",
  };
}

function buildSentryUserKey(shop, userId) {
  const safeShop = String(shop || "").trim();
  const safeUserId = String(userId || "").trim();
  if (safeShop && safeUserId) return `${safeShop}:${safeUserId}`;
  return safeShop || safeUserId;
}

function getConfiguredEnvValue(...values) {
  return values.find((value) => value != null && String(value).trim() !== "");
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    if (shouldCaptureRouteBoundaryError(error)) {
      Sentry.captureException(error);
    }
  }, [error]);

  return boundary.error(error);
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function shouldCaptureRouteBoundaryError(error) {
  if (!error) return false;
  if (!isRouteErrorResponse(error)) return true;
  return error.status >= 500;
}
