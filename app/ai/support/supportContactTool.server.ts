import { z } from "zod";
import db from "../../db.server";
import { sendContactEmail } from "../../email.server";
import type { AiToolContext, AiToolExecutionResult } from "../domain/types";
import type { AiConversationStore, StoredAiConversationMessage } from "../chat/conversationStore.server";
import type { AiPageContext } from "../chat/pageContext";

export const AI_SUPPORT_CONTACT_TOOL_NAME = "product_pulse_send_support_contact";

const MAX_RECENT_MESSAGES = 10;
const MAX_EMAIL_TEXT_LENGTH = 12000;

const relatedDataSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(400),
}).strict();

export const supportContactToolInputSchema = z.object({
  type: z.enum(["problem_report", "contact_request"]).optional().default("problem_report"),
  subject: z.string().trim().min(1).max(160),
  userMessage: z.string().trim().min(1).max(2400),
  interpretation: z.string().trim().min(1).max(2400).optional(),
  requestedOutcome: z.string().trim().max(800).optional(),
  severity: z.enum(["low", "normal", "high"]).optional().default("normal"),
  relatedProductRef: z.string().trim().max(320).optional(),
  relatedProductTitle: z.string().trim().max(180).optional(),
  relatedData: z.array(relatedDataSchema).max(10).optional().default([]),
  replyEmail: z.string().trim().email().max(254).optional(),
}).strict();

export type AiSupportContactToolInput = z.infer<typeof supportContactToolInputSchema>;

export interface AiSupportContactToolResult {
  sent: boolean;
  type: "problem_report" | "contact_request";
  subject: string;
  contactRequestId: string | null;
  safeMessage: string;
}

export interface ExecuteAiSupportContactToolInput {
  context: AiToolContext;
  conversationId: string;
  rawArguments: unknown;
  conversationStore: Pick<AiConversationStore, "listRecentMessages">;
  pageContext?: AiPageContext;
  now?: () => Date;
  contactRequestStore?: {
    create(input: { data: { shop: string; type: string; subject: string; message: string; email: string | null } }): Promise<{ id?: string | null }>;
  };
  sendEmail?: typeof sendContactEmail;
}

export function buildSupportContactOpenAiToolDefinition(
  sanitizeSchema: (schema: unknown) => unknown,
): { type: "function"; name: string; description: string; parameters: unknown; strict: false } {
  return {
    type: "function",
    name: AI_SUPPORT_CONTACT_TOOL_NAME,
    description: [
      "Send a ProductPulse support/contact email for the authenticated shop when the merchant asks to report a problem or contact the team.",
      "Use only after the user has described what they want to report or send.",
      "Include the user's message, your interpretation, related product/data context, and any requested outcome.",
      "The server adds shop identity and recent chat transcript; never accept tenant identity from the model.",
    ].join(" "),
    parameters: sanitizeSchema(z.toJSONSchema(supportContactToolInputSchema)),
    strict: false,
  };
}

export async function executeAiSupportContactTool(
  input: ExecuteAiSupportContactToolInput,
): Promise<AiToolExecutionResult<AiSupportContactToolResult>> {
  const parsed = supportContactToolInputSchema.safeParse(input.rawArguments ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      toolName: AI_SUPPORT_CONTACT_TOOL_NAME,
      error: {
        code: "VALIDATION_ERROR",
        message: "Support contact input failed validation.",
        retryable: false,
        validationIssues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      metadata: { resultCount: 0 },
    };
  }

  const value = parsed.data;
  const now = input.now || (() => new Date());
  const recentMessages = await safeRecentMessages(input.conversationStore, input.context, input.conversationId);
  const report = buildSupportReport({
    context: input.context,
    conversationId: input.conversationId,
    input: value,
    pageContext: input.pageContext,
    recentMessages,
    createdAt: now().toISOString(),
  });

  let contactRequestId: string | null = null;
  try {
    const created = await (input.contactRequestStore || db.contactRequest).create({
      data: {
        shop: input.context.shop,
        type: value.type,
        subject: report.subject,
        message: truncate(report.text, MAX_EMAIL_TEXT_LENGTH),
        email: value.replyEmail || null,
      },
    });
    contactRequestId = created.id ? String(created.id) : null;
  } catch (error) {
    console.warn("[ai.supportContact] contact request persistence failed", safeErrorMessage(error));
  }

  try {
    await (input.sendEmail || sendContactEmail)({
      type: value.type === "problem_report" ? "AI chat problem report" : "AI chat contact request",
      subject: report.subject,
      message: report.text,
      html: report.html,
      replyEmail: value.replyEmail,
      shop: input.context.shop,
    });
  } catch (error) {
    return {
      ok: false,
      toolName: AI_SUPPORT_CONTACT_TOOL_NAME,
      error: {
        code: "SUPPORT_EMAIL_FAILED",
        message: "ProductPulse could not send the support message right now.",
        retryable: true,
      },
      metadata: { resultCount: 0 },
    };
  }

  return {
    ok: true,
    toolName: AI_SUPPORT_CONTACT_TOOL_NAME,
    data: {
      sent: true,
      type: value.type,
      subject: report.subject,
      contactRequestId,
      safeMessage: value.type === "problem_report"
        ? "Thanks, the ProductPulse team received the problem report and will review it."
        : "Thanks, the ProductPulse team received the contact message and will follow up.",
    },
    metadata: { resultCount: 1 },
  };
}

function buildSupportReport(input: {
  context: AiToolContext;
  conversationId: string;
  input: AiSupportContactToolInput;
  pageContext?: AiPageContext;
  recentMessages: StoredAiConversationMessage[];
  createdAt: string;
}): { subject: string; text: string; html: string } {
  const subjectPrefix = input.input.type === "problem_report" ? "AI chat problem" : "AI chat contact";
  const subject = `${subjectPrefix}: ${input.input.subject}`.slice(0, 180);
  const pageSummary = summarizePageContext(input.pageContext);
  const relatedProduct = [
    input.input.relatedProductTitle,
    input.input.relatedProductRef,
  ].filter(Boolean).join(" - ") || "Not specified";
  const relatedData = input.input.relatedData.length
    ? input.input.relatedData.map((item) => `- ${item.label}: ${item.value}`).join("\n")
    : "- Not specified";
  const transcript = input.recentMessages.length
    ? input.recentMessages.map(formatTranscriptLine).join("\n")
    : "No recent chat messages were available.";

  const text = [
    "ProductPulse AI chat support report",
    "",
    "Context",
    `- Shop: ${input.context.shop}`,
    `- User ID: ${input.context.userId ?? "not available"}`,
    `- Session ID: ${input.context.sessionId ?? "not available"}`,
    `- Conversation ID: ${input.conversationId}`,
    `- Created at: ${input.createdAt}`,
    `- Severity: ${input.input.severity}`,
    `- Page context: ${pageSummary}`,
    "",
    "User message",
    input.input.userMessage,
    "",
    "Assistant interpretation",
    input.input.interpretation || "No interpretation provided.",
    "",
    "Requested outcome",
    input.input.requestedOutcome || "Not specified.",
    "",
    "Related product",
    relatedProduct,
    "",
    "Related data mentioned",
    relatedData,
    "",
    "Recent chat transcript",
    transcript,
  ].join("\n");

  const html = htmlDocument({
    title: "ProductPulse AI chat support report",
    rows: [
      ["Shop", input.context.shop],
      ["User ID", String(input.context.userId ?? "not available")],
      ["Session ID", String(input.context.sessionId ?? "not available")],
      ["Conversation ID", input.conversationId],
      ["Created at", input.createdAt],
      ["Severity", input.input.severity],
      ["Page context", pageSummary],
      ["Related product", relatedProduct],
    ],
    sections: [
      ["User message", input.input.userMessage],
      ["Assistant interpretation", input.input.interpretation || "No interpretation provided."],
      ["Requested outcome", input.input.requestedOutcome || "Not specified."],
      ["Related data mentioned", relatedData],
      ["Recent chat transcript", transcript],
    ],
  });

  return { subject, text, html };
}

async function safeRecentMessages(
  store: Pick<AiConversationStore, "listRecentMessages">,
  context: AiToolContext,
  conversationId: string,
): Promise<StoredAiConversationMessage[]> {
  try {
    return await store.listRecentMessages(context, conversationId, MAX_RECENT_MESSAGES);
  } catch {
    return [];
  }
}

function summarizePageContext(pageContext: AiPageContext | undefined): string {
  if (!pageContext) return "none";
  const parts = [`type=${pageContext.type}`];
  if (pageContext.entityId) parts.push(`entityId=${pageContext.entityId}`);
  if (pageContext.entityHandle) parts.push(`entityHandle=${pageContext.entityHandle}`);
  if (pageContext.visibleEntityIds?.length) parts.push(`visibleEntityCount=${pageContext.visibleEntityIds.length}`);
  if (pageContext.dateRange?.from || pageContext.dateRange?.to) {
    parts.push(`dateRange=${pageContext.dateRange.from || ""}..${pageContext.dateRange.to || ""}`);
  }
  return parts.join(", ");
}

function formatTranscriptLine(message: StoredAiConversationMessage): string {
  const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : message.role;
  return `[${toIso(message.createdAt)}] ${role}: ${truncate(message.content, 900)}`;
}

function htmlDocument(input: {
  title: string;
  rows: Array<[string, string]>;
  sections: Array<[string, string]>;
}): string {
  const rowHtml = input.rows.map(([label, value]) => `
    <tr>
      <th>${escapeHtml(label)}</th>
      <td>${escapeHtml(value)}</td>
    </tr>
  `).join("");
  const sectionHtml = input.sections.map(([title, value]) => `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <pre>${escapeHtml(value)}</pre>
    </section>
  `).join("");

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="max-width:760px;margin:0 auto;padding:24px;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
          <div style="padding:20px 22px;background:#4c1d95;color:#ffffff;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.78;">ProductPulse AI</div>
            <h1 style="margin:4px 0 0;font-size:22px;line-height:1.25;">${escapeHtml(input.title)}</h1>
          </div>
          <div style="padding:18px 22px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
              ${rowHtml}
            </table>
            ${sectionHtml}
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: unknown, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || ""));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return "unknown time";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
