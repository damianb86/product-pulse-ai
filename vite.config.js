import { reactRouter } from "@react-router/dev/vite";
import { sentryReactRouter } from "@sentry/react-router";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
const allowedHosts = Array.from(
  new Set(["localhost", "127.0.0.1", ".trycloudflare.com", host].filter(Boolean)),
);
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

const sentryBuildConfig = getSentryBuildConfig(process.env);

export default defineConfig((config) => ({
  server: {
    allowedHosts,
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    reactRouter(),
    ...(sentryBuildConfig ? [sentryReactRouter(sentryBuildConfig, config)] : []),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
  ...(sentryBuildConfig ? { sentryConfig: sentryBuildConfig } : {}),
}));

function getSentryBuildConfig(env) {
  const authToken = stringEnv(env.SENTRY_AUTH_TOKEN);
  const org = stringEnv(env.SENTRY_ORG);
  const project = stringEnv(env.SENTRY_PROJECT);

  if (!authToken || !org || !project) return null;

  const releaseName = getSentryRelease(env);

  return {
    authToken,
    org,
    project,
    telemetry: false,
    release: releaseName ? { name: releaseName } : undefined,
    bundleSizeOptimizations: {
      excludeDebugStatements: true,
    },
    sourcemaps: {
      filesToDeleteAfterUpload: ["./build/**/*.map"],
    },
  };
}

function getSentryRelease(env) {
  return stringEnv(env.SENTRY_RELEASE)
    || stringEnv(env.APP_VERSION)
    || stringEnv(env.SOURCE_VERSION)
    || stringEnv(env.COMMIT_SHA);
}

function stringEnv(value) {
  return typeof value === "string" ? value.trim() : "";
}
