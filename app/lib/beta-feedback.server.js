/* eslint-env node */
import db from "../db.server";
import { sendProductPulseEmail } from "../email.server";

const MAX_TEXT_LENGTH = 4_000;
const MAX_SHORT_TEXT_LENGTH = 320;
const MAX_CONTEXT_CHARACTERS = 24_000;
const MAX_CONTEXT_DEPTH = 5;
const MAX_CONTEXT_ARRAY_ITEMS = 24;
const MAX_CONTEXT_OBJECT_KEYS = 48;

export const BETA_FEEDBACK_CATEGORIES = Object.freeze([
  "bug_error",
  "confusing_data",
  "wrong_value",
  "feature_request",
  "ux_suggestion",
  "something_not_useful",
  "positive_feedback",
  "other",
  "panel_hide",
]);

export const BETA_FEEDBACK_HIDE_REASONS = Object.freeze([
  "not_relevant",
  "do_not_understand",
  "takes_too_much_space",
  "data_looks_wrong",
  "duplicate_information",
  "only_need_sometimes",
  "other",
  "skipped",
]);

const SENSITIVE_KEY_PATTERN = /(token|secret|password|credential|authorization|cookie|session|access|refresh|api[_-]?key|payment|card|cvv|private)/i;

export function getBetaFeedbackUserKey(session = {}) {
  if (session.userId != null) return String(session.userId);
  if (session.email) return String(session.email).trim().toLowerCase();
  return "shop";
}

export function getBetaFeedbackUser(session = {}) {
  const firstName = normalizeText(session.firstName, MAX_SHORT_TEXT_LENGTH);
  const lastName = normalizeText(session.lastName, MAX_SHORT_TEXT_LENGTH);
  return {
    userKey: getBetaFeedbackUserKey(session),
    userId: session.userId == null ? null : String(session.userId),
    userEmail: normalizeEmail(session.email),
    userName: [firstName, lastName].filter(Boolean).join(" ") || null,
  };
}

export async function getBetaFeedbackPreferencesForPage({ session, pageKey }) {
  const safePageKey = normalizePageKey(pageKey);
  const user = getBetaFeedbackUser(session);
  const rows = await db.betaFeedbackPanelPreference.findMany({
    where: {
      shop: session.shop,
      userKey: user.userKey,
      pageKey: safePageKey,
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map(toPublicPanelPreference);
}

export async function createBetaFeedbackReport({ session, payload, request }) {
  const user = getBetaFeedbackUser(session);
  const context = sanitizeBetaFeedbackContext(payload.context || {});
  const email = normalizeEmail(payload.email) || user.userEmail;
  const panel = normalizePanelPayload(payload);
  const related = normalizeRelatedEntity(payload.relatedEntity || payload.related || {});

  const report = await db.betaFeedbackReport.create({
    data: {
      shop: session.shop,
      userKey: user.userKey,
      userId: user.userId,
      userEmail: email,
      userName: user.userName,
      category: normalizeBetaFeedbackCategory(payload.category),
      severity: normalizeSeverity(payload.severity),
      message: normalizeText(payload.message, MAX_TEXT_LENGTH),
      pagePath: normalizeText(payload.pagePath || context?.route?.path || context?.page?.path, MAX_SHORT_TEXT_LENGTH) || null,
      pageRoute: normalizeText(payload.pageRoute || context?.route?.pageKey || context?.page?.key, MAX_SHORT_TEXT_LENGTH) || null,
      panelId: panel.panelId,
      panelLabel: panel.panelLabel,
      source: normalizeText(payload.source || (panel.panelId ? "panel" : "global"), MAX_SHORT_TEXT_LENGTH) || "global",
      relatedEntityType: related.type,
      relatedEntityId: related.id,
      context,
      status: "new",
    },
  });

  queueBetaFeedbackEmail(report, { request });
  return report;
}

export async function recordBetaFeedbackPanelHide({ session, payload, request }) {
  const panel = normalizePanelPayload(payload);
  if (!panel.panelId) {
    throw new Error("panelId is required.");
  }

  const pageKey = normalizePageKey(payload.pageKey || payload.pagePath);
  const reason = normalizeHideReason(payload.reason);
  const reasonMessage = normalizeText(payload.reasonMessage, MAX_TEXT_LENGTH);
  const context = sanitizeBetaFeedbackContext({
    ...(payload.context || {}),
    panelHide: {
      reason,
      reasonMessage,
    },
  });
  const now = new Date();
  const user = getBetaFeedbackUser(session);

  const [preference, report] = await db.$transaction([
    db.betaFeedbackPanelPreference.upsert({
      where: {
        shop_userKey_pageKey_panelId: {
          shop: session.shop,
          userKey: user.userKey,
          pageKey,
          panelId: panel.panelId,
        },
      },
      create: {
        shop: session.shop,
        userKey: user.userKey,
        userId: user.userId,
        pageKey,
        panelId: panel.panelId,
        panelLabel: panel.panelLabel,
        hidden: true,
        hideReason: reason,
        hideReasonMessage: reasonMessage || null,
        context,
        firstHiddenAt: now,
        lastHiddenAt: now,
      },
      update: {
        panelLabel: panel.panelLabel,
        hidden: true,
        hideReason: reason,
        hideReasonMessage: reasonMessage || null,
        context,
        firstHiddenAt: now,
        lastHiddenAt: now,
        restoredAt: null,
      },
    }),
    db.betaFeedbackReport.create({
      data: {
        shop: session.shop,
        userKey: user.userKey,
        userId: user.userId,
        userEmail: user.userEmail,
        userName: user.userName,
        category: "panel_hide",
        severity: "medium",
        message: buildPanelHideMessage(panel, reason, reasonMessage),
        pagePath: normalizeText(payload.pagePath || context?.route?.path, MAX_SHORT_TEXT_LENGTH) || null,
        pageRoute: pageKey,
        panelId: panel.panelId,
        panelLabel: panel.panelLabel,
        source: "panel-hide",
        context,
        status: "new",
      },
    }),
  ]);

  queueBetaFeedbackEmail(report, { request });
  return toPublicPanelPreference(preference);
}

export async function setBetaFeedbackPanelVisibility({ session, payload }) {
  const panel = normalizePanelPayload(payload);
  if (!panel.panelId) {
    throw new Error("panelId is required.");
  }

  const pageKey = normalizePageKey(payload.pageKey || payload.pagePath);
  const hidden = Boolean(payload.hidden);
  const now = new Date();
  const user = getBetaFeedbackUser(session);
  const context = sanitizeBetaFeedbackContext(payload.context || {});

  const preference = await db.betaFeedbackPanelPreference.upsert({
    where: {
      shop_userKey_pageKey_panelId: {
        shop: session.shop,
        userKey: user.userKey,
        pageKey,
        panelId: panel.panelId,
      },
    },
    create: {
      shop: session.shop,
      userKey: user.userKey,
      userId: user.userId,
      pageKey,
      panelId: panel.panelId,
      panelLabel: panel.panelLabel,
      hidden,
      context,
      firstHiddenAt: hidden ? now : null,
      lastHiddenAt: hidden ? now : null,
      restoredAt: hidden ? null : now,
    },
    update: {
      panelLabel: panel.panelLabel,
      hidden,
      context,
      lastHiddenAt: hidden ? now : undefined,
      restoredAt: hidden ? null : now,
    },
  });

  return toPublicPanelPreference(preference);
}

export function sanitizeBetaFeedbackContext(value) {
  const sanitized = sanitizeContextValue(value, 0);
  const context = sanitized && typeof sanitized === "object" ? sanitized : { value: sanitized };
  return clampContext(context);
}

export function normalizeBetaFeedbackCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (BETA_FEEDBACK_CATEGORIES.includes(normalized)) return normalized;
  return "other";
}

function normalizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(normalized)) return normalized;
  return normalized ? normalizeText(normalized, MAX_SHORT_TEXT_LENGTH) : null;
}

function normalizeHideReason(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (BETA_FEEDBACK_HIDE_REASONS.includes(normalized)) return normalized;
  return "other";
}

function normalizePanelPayload(payload = {}) {
  const panel = payload.panel && typeof payload.panel === "object" ? payload.panel : {};
  return {
    panelId: normalizeText(payload.panelId || panel.id || panel.panelId, MAX_SHORT_TEXT_LENGTH) || null,
    panelLabel: normalizeText(payload.panelLabel || panel.label || panel.title, MAX_SHORT_TEXT_LENGTH) || null,
  };
}

function normalizeRelatedEntity(value = {}) {
  return {
    type: normalizeText(value.type || value.entityType, MAX_SHORT_TEXT_LENGTH) || null,
    id: normalizeText(value.id || value.entityId, MAX_SHORT_TEXT_LENGTH) || null,
  };
}

function normalizePageKey(value) {
  const normalized = normalizeText(value, MAX_SHORT_TEXT_LENGTH);
  return normalized || "unknown";
}

function normalizeText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeEmail(value) {
  const email = normalizeText(value, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function sanitizeContextValue(value, depth) {
  if (value == null) return value;
  if (depth > MAX_CONTEXT_DEPTH) return "[truncated]";
  if (value instanceof Date) return value.toISOString();

  const valueType = typeof value;
  if (valueType === "string") return normalizeText(value, 1_200);
  if (valueType === "number" || valueType === "boolean") return value;
  if (valueType === "bigint") return String(value);
  if (valueType !== "object") return normalizeText(value, 1_200);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_CONTEXT_ARRAY_ITEMS).map((item) => sanitizeContextValue(item, depth + 1));
    if (value.length > MAX_CONTEXT_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_CONTEXT_ARRAY_ITEMS} more items truncated]`);
    }
    return items;
  }

  const output = {};
  const entries = Object.entries(value).slice(0, MAX_CONTEXT_OBJECT_KEYS);
  for (const [key, childValue] of entries) {
    const safeKey = normalizeText(key, 120);
    if (!safeKey) continue;
    if (SENSITIVE_KEY_PATTERN.test(safeKey)) {
      output[safeKey] = "[redacted]";
      continue;
    }
    output[safeKey] = sanitizeContextValue(childValue, depth + 1);
  }

  const keyCount = Object.keys(value).length;
  if (keyCount > MAX_CONTEXT_OBJECT_KEYS) {
    output._truncatedKeys = keyCount - MAX_CONTEXT_OBJECT_KEYS;
  }

  return output;
}

function clampContext(context) {
  let json = safeStringify(context);
  if (json.length <= MAX_CONTEXT_CHARACTERS) return context;

  const reduced = {
    truncated: true,
    summary: normalizeText(json, MAX_CONTEXT_CHARACTERS - 120),
  };
  json = safeStringify(reduced);
  if (json.length <= MAX_CONTEXT_CHARACTERS) return reduced;

  return {
    truncated: true,
    summary: reduced.summary.slice(0, Math.max(0, MAX_CONTEXT_CHARACTERS - 300)),
  };
}

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

function toPublicPanelPreference(preference) {
  return {
    id: preference.id,
    pageKey: preference.pageKey,
    panelId: preference.panelId,
    panelLabel: preference.panelLabel,
    hidden: Boolean(preference.hidden),
    hasHideReason: Boolean(preference.hideReason || preference.hideReasonMessage),
    hideReason: preference.hideReason || null,
    updatedAt: preference.updatedAt?.toISOString?.() || null,
  };
}

function buildPanelHideMessage(panel, reason, reasonMessage) {
  const label = panel.panelLabel || panel.panelId;
  const reasonLabel = getHideReasonLabel(reason);
  return [
    `Panel hidden: ${label}`,
    `Reason: ${reasonLabel}`,
    reasonMessage ? `Comment: ${reasonMessage}` : "",
  ].filter(Boolean).join("\n");
}

function getHideReasonLabel(reason) {
  const labels = {
    not_relevant: "Not relevant to me",
    do_not_understand: "I do not understand this panel",
    takes_too_much_space: "It takes too much space",
    data_looks_wrong: "The data looks wrong",
    duplicate_information: "I already get this information elsewhere",
    only_need_sometimes: "I only need it sometimes",
    other: "Other",
    skipped: "Skipped",
  };
  return labels[reason] || labels.other;
}

function queueBetaFeedbackEmail(report, { request } = {}) {
  Promise.resolve()
    .then(() => sendBetaFeedbackEmail(report, { request }))
    .catch((error) => {
      console.error("[beta-feedback.email]", error);
    });
}

async function sendBetaFeedbackEmail(report, { request } = {}) {
  const recipients = getBetaFeedbackEmailRecipients();
  const context = report.context && typeof report.context === "object" ? report.context : {};
  const pageUrl = getFeedbackPageUrl(context, request);
  const contextSummary = getEmailContextSummary(context);
  const message = [
    `Feedback ID: ${report.id}`,
    `Category: ${report.category}`,
    `Severity: ${report.severity || "not provided"}`,
    `Shop: ${report.shop}`,
    `User: ${report.userName || report.userEmail || report.userId || report.userKey || "unknown"}`,
    `Page: ${report.pagePath || "unknown"}`,
    report.panelId ? `Panel: ${report.panelLabel || report.panelId} (${report.panelId})` : "",
    report.relatedEntityType || report.relatedEntityId ? `Related: ${report.relatedEntityType || "entity"} ${report.relatedEntityId || ""}` : "",
    pageUrl ? `App page: ${pageUrl}` : "",
    "",
    "User comment:",
    report.message,
    "",
    "Context summary:",
    ...contextSummary,
  ].filter((line) => line !== "").join("\n");

  return sendProductPulseEmail({
    type: "beta_feedback",
    subject: `Beta feedback: ${report.panelLabel || report.category}`,
    message,
    html: buildBetaFeedbackEmailHtml(report, message, pageUrl),
    replyEmail: report.userEmail || undefined,
    shop: report.shop,
    to: recipients,
    requiredRecipientEnv: "BETA_FEEDBACK_RECIPIENT and/or CONTACT_EMAIL",
  });
}

function getBetaFeedbackEmailRecipients(env = process.env) {
  return [
    env.BETA_FEEDBACK_RECIPIENT,
    env.CONTACT_EMAIL,
  ].filter(Boolean).join(",");
}

function getFeedbackPageUrl(context = {}, request) {
  const currentUrl = normalizeText(context.currentUrl || context.url, 1_000);
  if (currentUrl && /^https?:\/\//i.test(currentUrl)) return currentUrl;

  const path = normalizeText(context.route?.path || context.page?.path, 1_000);
  if (!path || !path.startsWith("/")) return "";

  const base = process.env.SHOPIFY_APP_URL || getRequestOrigin(request);
  if (!base) return path;

  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

function getRequestOrigin(request) {
  if (!request?.url) return "";
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

function getEmailContextSummary(context = {}) {
  const summary = [];
  if (context.viewport) {
    summary.push(`- Viewport: ${context.viewport.width || "?"}x${context.viewport.height || "?"}`);
  }
  if (context.browser?.userAgent) {
    summary.push(`- Browser: ${normalizeText(context.browser.userAgent, 220)}`);
  }
  if (context.route?.search) {
    summary.push(`- Query: ${normalizeText(context.route.search, 220)}`);
  }
  if (context.filters && Object.keys(context.filters).length > 0) {
    summary.push(`- Filters: ${normalizeText(JSON.stringify(context.filters), 320)}`);
  }
  if (context.product?.title || context.product?.id || context.product?.handle) {
    summary.push(`- Product: ${normalizeText(context.product.title || context.product.handle || context.product.id, 220)}`);
  }
  if (context.metric?.name || context.metric?.value) {
    summary.push(`- Metric: ${normalizeText(`${context.metric.name || "metric"} ${context.metric.value || ""}`, 220)}`);
  }
  if (Array.isArray(context.recentClientErrors) && context.recentClientErrors.length) {
    summary.push(`- Recent client errors: ${context.recentClientErrors.length}`);
  }
  if (!summary.length) summary.push("- No additional client context.");
  return summary;
}

function buildBetaFeedbackEmailHtml(report, message, pageUrl) {
  return [
    "<div>",
    `<h2>${escapeHtml(`Beta feedback: ${report.panelLabel || report.category}`)}</h2>`,
    pageUrl ? `<p><a href="${escapeHtml(pageUrl)}">Open app page</a></p>` : "",
    `<pre style="white-space:pre-wrap;font-family:Inter,Arial,sans-serif">${escapeHtml(message)}</pre>`,
    "</div>",
  ].join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
