import process from "node:process";
import { runProductPulseBackgroundWorker } from "../app/lib/product-pulse-jobs.server.js";

const once = process.argv.includes("--once");

try {
  await runProductPulseBackgroundWorker({ once });
} catch (error) {
  console.error("[product-pulse-worker] failed", error);
  process.exitCode = 1;
}
