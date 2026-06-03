import * as Sentry from "@sentry/react-router";

const sentryDsn = stringEnv(process.env.SENTRY_DSN);

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: getSentryEnvironment(process.env),
    release: getSentryRelease(process.env),
    sendDefaultPii: false,
    enableLogs: booleanEnv(process.env.SENTRY_ENABLE_LOGS, false),
    tracesSampleRate: sampleRateEnv(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.02),
    ignoreErrors: [
      "AbortError",
      "The operation was aborted",
    ],
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

function scrubEvent(event) {
  if (event.request?.headers) {
    delete event.request.headers.Authorization;
    delete event.request.headers.authorization;
    delete event.request.headers.Cookie;
    delete event.request.headers.cookie;
    delete event.request.headers["X-Shopify-Access-Token"];
    delete event.request.headers["x-shopify-access-token"];
  }

  if (event.request?.cookies) {
    delete event.request.cookies;
  }

  return event;
}

function getSentryEnvironment(env) {
  return stringEnv(env.SENTRY_ENVIRONMENT)
    || stringEnv(env.APP_ENV)
    || stringEnv(env.NODE_ENV)
    || "development";
}

function getSentryRelease(env) {
  return stringEnv(env.SENTRY_RELEASE)
    || stringEnv(env.APP_VERSION)
    || stringEnv(env.SOURCE_VERSION)
    || stringEnv(env.COMMIT_SHA)
    || "";
}

function sampleRateEnv(value, defaultValue) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return defaultValue;
  return Math.min(1, Math.max(0, rate));
}

function booleanEnv(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return defaultValue;
}

function stringEnv(value) {
  return typeof value === "string" ? value.trim() : "";
}
