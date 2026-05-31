/* eslint-env node */
import { authenticate } from "../shopify.server";
import { isBetaFeedbackEnabled } from "../lib/beta-feedback-config.server";
import {
  createBetaFeedbackReport,
  getBetaFeedbackPreferencesForPage,
  recordBetaFeedbackPanelHide,
  setBetaFeedbackPanelVisibility,
} from "../lib/beta-feedback.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  if (!isBetaFeedbackEnabled()) {
    return json({ status: "disabled", enabled: false, preferences: [] });
  }

  const pageKey = url.searchParams.get("pageKey") || url.searchParams.get("page") || "unknown";
  const preferences = await getBetaFeedbackPreferencesForPage({ session, pageKey });

  return json({ status: "success", enabled: true, preferences });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  if (!isBetaFeedbackEnabled()) {
    return json({ status: "disabled", message: "Beta feedback is disabled." }, { status: 404 });
  }

  let payload;
  try {
    payload = await parseBetaFeedbackPayload(request);
  } catch {
    return json({ status: "validation_error", message: "Request body is invalid." }, { status: 400 });
  }

  const intent = String(payload.intent || "").trim();

  try {
    if (intent === "submit-feedback") {
      if (!String(payload.message || "").trim()) {
        return json({ status: "validation_error", message: "Message is required." }, { status: 400 });
      }
      const report = await createBetaFeedbackReport({ session, payload, request });
      return json({
        status: "success",
        message: "Feedback sent.",
        report: { id: report.id, createdAt: report.createdAt },
      });
    }

    if (intent === "hide-panel") {
      const preference = await recordBetaFeedbackPanelHide({ session, payload, request });
      return json({ status: "success", message: "Panel hidden.", preference });
    }

    if (intent === "set-panel-visibility") {
      const preference = await setBetaFeedbackPanelVisibility({ session, payload });
      return json({ status: "success", message: preference.hidden ? "Panel hidden." : "Panel restored.", preference });
    }
  } catch (error) {
    console.error("[api.beta-feedback]", error);
    return json({ status: "error", message: "Beta feedback could not be saved." }, { status: 500 });
  }

  return json({ status: "validation_error", message: "Unsupported beta feedback action." }, { status: 400 });
};

async function parseBetaFeedbackPayload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }

  const formData = await request.formData();
  const payload = {};
  for (const [key, value] of formData.entries()) {
    payload[key] = value;
  }

  ["context", "panel", "relatedEntity", "related"].forEach((key) => {
    if (!payload[key]) return;
    try {
      payload[key] = JSON.parse(String(payload[key]));
    } catch {
      payload[key] = {};
    }
  });

  if (payload.hidden != null) {
    payload.hidden = ["1", "true", "yes", "on"].includes(String(payload.hidden).toLowerCase());
  }

  return payload;
}

function json(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}
