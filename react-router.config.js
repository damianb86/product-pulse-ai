import { sentryOnBuildEnd } from "@sentry/react-router";

const sentrySourceMapsEnabled = Boolean(
  stringEnv(process.env.SENTRY_AUTH_TOKEN)
    && stringEnv(process.env.SENTRY_ORG)
    && stringEnv(process.env.SENTRY_PROJECT),
);

export default {
  ...(sentrySourceMapsEnabled ? { buildEnd: sentryOnBuildEnd } : {}),
};

function stringEnv(value) {
  return typeof value === "string" ? value.trim() : "";
}
