import * as Sentry from "@sentry/react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

const sentryDsn = stringEnv(import.meta.env.VITE_SENTRY_DSN);

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: stringEnv(import.meta.env.VITE_SENTRY_ENVIRONMENT) || import.meta.env.MODE,
    release: stringEnv(import.meta.env.VITE_SENTRY_RELEASE),
    sendDefaultPii: false,
    integrations: [
      Sentry.reactRouterTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    enableLogs: booleanEnv(import.meta.env.VITE_SENTRY_ENABLE_LOGS, false),
    tracesSampleRate: sampleRateEnv(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.02),
    tracePropagationTargets: [/^\//],
    replaysSessionSampleRate: sampleRateEnv(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: sampleRateEnv(import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE, 1),
    ignoreErrors: [
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
    denyUrls: [
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-web-extension:\/\//i,
      /extensions\//i,
    ],
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});

function scrubEvent(event) {
  if (event.request?.headers) {
    delete event.request.headers.Authorization;
    delete event.request.headers.authorization;
    delete event.request.headers.Cookie;
    delete event.request.headers.cookie;
  }

  if (event.request?.cookies) {
    delete event.request.cookies;
  }

  return event;
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
