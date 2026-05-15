import {
  getWatchlistCronConfig,
  isWatchlistCronRequestAuthorized,
  runWatchlistCron,
} from "../lib/product-pulse-watchlist-cron.server";

export const loader = async ({ request }) => handleWatchlistCronRequest(request);
export const action = async ({ request }) => handleWatchlistCronRequest(request);

async function handleWatchlistCronRequest(request) {
  if (!isWatchlistCronRequestAuthorized(request)) {
    return Response.json(
      { status: "unauthorized", message: "Watchlist cron secret is missing or invalid." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const forceSchedule = isTruthy(url.searchParams.get("force"));
  const forceCadence = isTruthy(url.searchParams.get("forceCadence"));
  const result = await runWatchlistCron({
    config: getWatchlistCronConfig(),
    forceSchedule,
    forceCadence,
  });

  return Response.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}
