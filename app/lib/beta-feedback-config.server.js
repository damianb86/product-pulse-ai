/* eslint-env node */

export function isBetaFeedbackEnabled(env = process.env) {
  return booleanEnv(env.BETA_FEEDBACK_ENABLED, String(env.NODE_ENV || "").toLowerCase() === "development");
}

export function getBetaFeedbackClientConfig({ session } = {}, env = process.env) {
  const enabled = isBetaFeedbackEnabled(env);

  if (!enabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    shop: session?.shop || "",
    user: getBetaFeedbackSessionUser(session),
    environment: env.NODE_ENV || "",
    appVersion: env.APP_VERSION || env.SOURCE_VERSION || env.COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || "",
  };
}

function getBetaFeedbackSessionUser(session = {}) {
  const firstName = String(session.firstName || "").trim();
  const lastName = String(session.lastName || "").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ");

  return {
    id: session.userId == null ? "" : String(session.userId),
    email: String(session.email || "").trim(),
    name,
  };
}

function booleanEnv(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return defaultValue;
}
