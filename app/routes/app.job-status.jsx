import { authenticate } from "../shopify.server";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { cancelBackgroundJobForShop, getJobMonitorForShop } from "../lib/product-pulse-jobs.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";

export const shouldRevalidate = () => false;

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.job-status", { route: "/app/job-status" });
  const { session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });
  const url = new URL(request.url);
  const scope = normalizeJobStatusScope(url.searchParams.get("scope"));
  const developmentMode = isProductPulseDevelopment();
  const includeRecentJobs = developmentMode || scope === "popover" || scope === "topbar";
  const includeLogs = developmentMode && scope === "popover";

  try {
    const jobMonitor = await measureProductPulseStep(
      perf,
      "getJobMonitorForShop",
      () => getJobMonitorForShop(session.shop, {
        includeRecentJobs,
        includeLogs,
        includePointSummary: false,
        perf,
      }),
    );
    perf.done({
      shop: session.shop,
      scope,
      activeJobs: jobMonitor.activeJobs?.length || 0,
      activeJobCount: jobMonitor.activeJobCount ?? jobMonitor.activeJobs?.length ?? 0,
      recentJobs: jobMonitor.recentJobs?.length || 0,
      logs: jobMonitor.logs?.length || 0,
    });
    return Response.json({
      developmentMode,
      jobMonitor,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    throw error;
  }
};

function normalizeJobStatusScope(value) {
  return value === "popover" || value === "topbar" ? value : "summary";
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "cancel-background-job") {
    return Response.json(await cancelBackgroundJobForShop(session.shop, formData.get("jobId")));
  }

  return Response.json({ status: "validation_error", message: "Unsupported background job action." }, { status: 400 });
};
