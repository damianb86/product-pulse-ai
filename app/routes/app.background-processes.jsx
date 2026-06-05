import { useLoaderData } from "react-router";
import { BackgroundProcessesScreen } from "../components/ProductPulseScreens";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { getBackgroundProcessesForShop } from "../lib/product-pulse-jobs.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.background-processes", { route: "/app/background-processes" });
  const { session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });
  const url = new URL(request.url);
  const developmentMode = isProductPulseDevelopment();

  try {
    const backgroundProcesses = await measureProductPulseStep(
      perf,
      "getBackgroundProcessesForShop",
      () => getBackgroundProcessesForShop(session.shop, {
        page: url.searchParams.get("page"),
        includeLogs: developmentMode,
        perf,
      }),
    );
    perf.done({
      shop: session.shop,
      page: backgroundProcesses.pagination?.page || 1,
      processes: backgroundProcesses.processes?.length || 0,
      activeProcesses: backgroundProcesses.activeProcesses?.length || 0,
      logs: backgroundProcesses.logs?.length || 0,
    });
    return {
      data: {
        backgroundProcesses,
        developmentMode,
      },
    };
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    throw error;
  }
};

export default function BackgroundProcesses() {
  const { data } = useLoaderData();
  return <BackgroundProcessesScreen data={data} />;
}
