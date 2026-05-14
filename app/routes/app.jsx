import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ProductPulseJobMonitor } from "../components/ProductPulseJobMonitor";
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
    jobMonitor: await getJobMonitorForShop(session.shop),
  };
};

export default function App() {
  const { apiKey, developmentMode, jobMonitor } = useLoaderData();
  const location = useLocation();
  const activeSection = getActiveNavSection(location.pathname);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app" aria-current={activeSection === "dashboard" ? "page" : undefined} data-active={activeSection === "dashboard" ? "true" : undefined}>Dashboard</s-link>
        <s-link href="/app/products" aria-current={activeSection === "products" ? "page" : undefined} data-active={activeSection === "products" ? "true" : undefined}>Products</s-link>
        <s-link href="/app/analytics" aria-current={activeSection === "analytics" ? "page" : undefined} data-active={activeSection === "analytics" ? "true" : undefined}>Analytics</s-link>
        <s-link href="/app/connect" aria-current={activeSection === "connect" ? "page" : undefined} data-active={activeSection === "connect" ? "true" : undefined}>Connect</s-link>
      </s-app-nav>
      <Outlet />
      <ProductPulseJobMonitor initialMonitor={jobMonitor} developmentMode={developmentMode} />
    </AppProvider>
  );
}

function getActiveNavSection(pathname) {
  if (pathname === "/app" || pathname === "/app/") return "dashboard";
  if (pathname.startsWith("/app/products")) return "products";
  if (pathname.startsWith("/app/analytics")) return "analytics";
  if (pathname.startsWith("/app/connect")) return "connect";
  return "";
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
