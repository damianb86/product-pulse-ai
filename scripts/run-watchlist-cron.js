import process from "node:process";

const appUrl = process.env.PRODUCT_PULSE_CRON_APP_URL || process.env.SHOPIFY_APP_URL;
const secret = process.env.PRODUCT_PULSE_WATCHLIST_CRON_SECRET || process.env.WATCHLIST_CRON_SECRET;
const forceSchedule = process.argv.includes("--force");
const forceCadence = process.argv.includes("--force-cadence");

if (!appUrl) {
  console.error("Missing SHOPIFY_APP_URL or PRODUCT_PULSE_CRON_APP_URL.");
  process.exit(1);
}

const url = new URL("/cron/watchlist", appUrl);
if (forceSchedule) url.searchParams.set("force", "1");
if (forceCadence) url.searchParams.set("forceCadence", "1");

const headers = secret ? { Authorization: `Bearer ${secret}` } : {};
const response = await fetch(url, { headers });
const body = await response.text();

let payload;
try {
  payload = JSON.parse(body);
} catch {
  payload = { status: "unknown", raw: body };
}

console.log(JSON.stringify(payload, null, 2));

if (!response.ok || payload.status === "failed" || payload.status === "unauthorized") {
  process.exit(1);
}
