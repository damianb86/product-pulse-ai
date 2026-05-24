/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));

const {
  AI_SUPPORT_CONTACT_TOOL_NAME,
  executeAiSupportContactTool,
} = await import("../../app/ai/support/supportContactTool.server");

const context = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  sessionId: "session-1",
  createdAt: "2026-05-24T12:00:00.000Z",
};

describe("ProductPulse AI support contact tool", () => {
  it("sends a scoped support email with recent chat and page context", async () => {
    const sendEmail = vi.fn().mockResolvedValue({});
    const contactRequestStore = {
      create: vi.fn().mockResolvedValue({ id: "contact-1" }),
    };
    const conversationStore = {
      listRecentMessages: vi.fn().mockResolvedValue([
        {
          id: "msg-1",
          conversationId: "conversation-1",
          role: "user",
          content: "El botón View evidence no abre nada en este producto.",
          createdAt: "2026-05-24T12:01:00.000Z",
        },
        {
          id: "msg-2",
          conversationId: "conversation-1",
          role: "assistant",
          content: "Puedo reportarlo al equipo con el contexto del producto.",
          createdAt: "2026-05-24T12:01:10.000Z",
        },
      ]),
    };

    const result = await executeAiSupportContactTool({
      context,
      conversationId: "conversation-1",
      rawArguments: {
        type: "problem_report",
        subject: "Evidence action is broken",
        userMessage: "El botón View evidence no abre nada en este producto.",
        interpretation: "The merchant is reporting a broken ChatKit evidence navigation action.",
        requestedOutcome: "Review why the evidence action does not navigate.",
        relatedProductRef: "gid://shopify/Product/123",
        relatedProductTitle: "Mona Lisa",
        relatedData: [{ label: "Action", value: "open_evidence" }],
      },
      pageContext: {
        type: "product",
        entityId: "gid://shopify/Product/123",
        entityHandle: "mona-lisa",
      },
      conversationStore,
      contactRequestStore,
      sendEmail,
      now: () => new Date("2026-05-24T12:02:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: AI_SUPPORT_CONTACT_TOOL_NAME,
      data: {
        sent: true,
        contactRequestId: "contact-1",
      },
    });
    expect(conversationStore.listRecentMessages).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      "conversation-1",
      expect.any(Number),
    );
    expect(contactRequestStore.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shop: context.shop,
        type: "problem_report",
        email: null,
      }),
    }));
    const emailPayload = sendEmail.mock.calls[0][0];
    expect(emailPayload.shop).toBe(context.shop);
    expect(emailPayload.subject).toContain("Evidence action is broken");
    expect(emailPayload.message).toContain("Shop: shop-a.myshopify.com");
    expect(emailPayload.message).toContain("Conversation ID: conversation-1");
    expect(emailPayload.message).toContain("Mona Lisa - gid://shopify/Product/123");
    expect(emailPayload.message).toContain("open_evidence");
    expect(emailPayload.message).toContain("User: El botón View evidence");
    expect(emailPayload.html).toContain("ProductPulse AI chat support report");
  });

  it("returns a safe validation error for incomplete contact input", async () => {
    const result = await executeAiSupportContactTool({
      context,
      conversationId: "conversation-1",
      rawArguments: { type: "problem_report" },
      conversationStore: { listRecentMessages: vi.fn().mockResolvedValue([]) },
      contactRequestStore: { create: vi.fn() },
      sendEmail: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("rejects model-supplied tenant identity instead of trusting it", async () => {
    const sendEmail = vi.fn();
    const contactRequestStore = { create: vi.fn() };

    const result = await executeAiSupportContactTool({
      context,
      conversationId: "conversation-1",
      rawArguments: {
        type: "contact_request",
        subject: "Need help",
        userMessage: "Please contact me about this store.",
        shop: "evil-shop.myshopify.com",
      },
      conversationStore: { listRecentMessages: vi.fn().mockResolvedValue([]) },
      contactRequestStore,
      sendEmail,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(contactRequestStore.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
