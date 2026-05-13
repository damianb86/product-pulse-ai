import { Outlet, useLoaderData, useRouteError } from "react-router";
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

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/jobs">Running</s-link>
        <s-link href="/app/connect">Connect</s-link>
      </s-app-nav>
      <Outlet />
      <ProductPulseJobMonitor initialMonitor={jobMonitor} developmentMode={developmentMode} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
