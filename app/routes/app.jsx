import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAiChatKitClientConfig } from "../ai/chatkit/config.server";
import { isAiCostDashboardEnabled } from "../ai/observability/usageEvents.server";
import { BetaFeedbackProvider } from "../components/beta-feedback/BetaFeedbackLayer";
import { ProductPulseChatKitAssistant } from "../components/ProductPulseChatKitAssistant";
import { ProductPulseJobMonitor } from "../components/ProductPulseJobMonitor";
import { ProductPulseWizard } from "../components/ProductPulseWizard";
import { getBetaFeedbackClientConfig } from "../lib/beta-feedback-config.server";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { getJobMonitorForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const developmentMode = isProductPulseDevelopment();
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  return {
    apiKey,
    developmentMode,
    aiCostDashboardEnabled: isAiCostDashboardEnabled(),
    chatKit: getAiChatKitClientConfig(),
    jobMonitor: await getJobMonitorForShop(session.shop),
    betaFeedback: getBetaFeedbackClientConfig({ session }),
  };
};

export default function App() {
  const { apiKey, developmentMode, aiCostDashboardEnabled, chatKit, jobMonitor, betaFeedback } = useLoaderData();
  const location = useLocation();
  const activeSection = getActiveNavSection(location.pathname);
  const aiPageContext = getAiPageContext(location);
  const dashboardHref = activeSection === "dashboard" ? `${location.pathname}${location.search}` : "/app/dashboard";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <BetaFeedbackProvider config={betaFeedback}>
        <ProductPulseJobMonitor initialMonitor={jobMonitor} developmentMode={developmentMode} />
        <s-app-nav>
          <s-link href={dashboardHref} data-active={activeSection === "dashboard" ? "true" : undefined}>Dashboard</s-link>
          <s-link href="/app/products" data-active={activeSection === "products" ? "true" : undefined}>Products</s-link>
          <s-link href="/app/watchlist" data-active={activeSection === "watchlist" ? "true" : undefined}>Watchlist</s-link>
          <s-link href="/app/analytics" data-active={activeSection === "analytics" ? "true" : undefined}>Analytics</s-link>
          <s-link href="/app/plans-and-credits" data-active={activeSection === "plans-and-credits" ? "true" : undefined}>Plans & Credits</s-link>
          {aiCostDashboardEnabled ? (
            <s-link href="/app/ai-costs" data-active={activeSection === "ai-costs" ? "true" : undefined}>AI Costs</s-link>
          ) : null}
          <s-link href="/app/connect" data-active={activeSection === "connect" ? "true" : undefined}>Connect</s-link>
          <s-link href="/app/settings" data-active={activeSection === "settings" ? "true" : undefined}>Settings</s-link>
          <s-link href="/app/help" data-active={activeSection === "help" ? "true" : undefined}>Help & Contact</s-link>
        </s-app-nav>
        <Outlet />
        <ProductPulseChatKitAssistant config={chatKit} pageContext={aiPageContext} />
        <ProductPulseWizard />
      </BetaFeedbackProvider>
    </AppProvider>
  );
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
  const pathname = location.pathname;
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

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
