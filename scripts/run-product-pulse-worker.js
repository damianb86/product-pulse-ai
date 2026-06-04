import process from "node:process";
import { runProductPulseBackgroundWorker } from "../app/lib/product-pulse-jobs.server.js";

const once = process.argv.includes("--once");

console.log(`[product-pulse-worker] starting${once ? " one cycle" : ""}`);

try {
  const result = await runProductPulseBackgroundWorker({ once });
  console.log("[product-pulse-worker] stopped", result);
} catch (error) {
  console.error("[product-pulse-worker] failed", error);
  process.exitCode = 1;
}
