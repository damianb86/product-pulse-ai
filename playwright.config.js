import { defineConfig, devices } from "@playwright/test";
import { REQUIRED_SHOPIFY_SCOPES_STRING } from "./app/lib/product-pulse-scopes.js";

const previewEnv = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY || "test_api_key",
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET || "test_api_secret",
  SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || "http://127.0.0.1:3000",
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://preview:preview@127.0.0.1:5432/preview",
  SCOPES: process.env.SCOPES || REQUIRED_SHOPIFY_SCOPES_STRING,
  PLAYWRIGHT_PREVIEW: "true",
};

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.(e2e|spec)\.js/,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer:
    process.env.PLAYWRIGHT_START_SERVER === "true"
      ? {
          command: "npm run dev:preview",
          env: previewEnv,
          url: "http://127.0.0.1:3000/preview",
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
        }
      : undefined,
  projects: [
    { name: "chromium", testMatch: /tests\/e2e\/.*\.js/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: /tests\/e2e\/.*\.js/, use: { ...devices["Pixel 5"] } },
    { name: "accessibility", testMatch: /tests\/accessibility\/.*\.js/, use: { ...devices["Desktop Chrome"] } },
  ],
});
