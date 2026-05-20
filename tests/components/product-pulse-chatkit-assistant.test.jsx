import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatKit } from "@openai/chatkit-react";
import { ProductPulseChatKitAssistant } from "../../app/components/ProductPulseChatKitAssistant";

vi.mock("@openai/chatkit-react", async () => {
  const React = await import("react");
  return {
    ChatKit: ({ className }) => React.createElement("div", {
      className,
      "data-testid": "chatkit",
    }),
    useChatKit: vi.fn((options) => ({
      control: { options },
      sendUserMessage: vi.fn(),
    })),
  };
});

describe("ProductPulseChatKitAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a disabled assistant state when ChatKit is not configured", () => {
    render(
      <ProductPulseChatKitAssistant
        config={{ enabled: false, disabledReason: "ChatKit requires OPENAI_API_KEY on the server." }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));

    expect(screen.getByRole("dialog", { name: "AI Assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open AI Assistant" })).not.toBeInTheDocument();
    expect(screen.getByText("ChatKit requires OPENAI_API_KEY on the server.")).toBeVisible();
    expect(screen.queryByTestId("chatkit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close AI Assistant" }));
    expect(screen.getByRole("button", { name: "Open AI Assistant" })).toBeInTheDocument();
  });

  it("lets the assistant drawer switch between default and wide widths", () => {
    render(
      <ProductPulseChatKitAssistant
        config={{ enabled: false, disabledReason: "ChatKit requires OPENAI_API_KEY on the server." }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));

    const assistant = screen.getByLabelText("ProductPulse AI assistant");
    expect(assistant).not.toHaveClass("ppChatKitAssistant-expanded");

    fireEvent.click(screen.getByRole("button", { name: "Expand AI Assistant width" }));
    expect(assistant).toHaveClass("ppChatKitAssistant-expanded");

    fireEvent.click(screen.getByRole("button", { name: "Use default AI Assistant width" }));
    expect(assistant).not.toHaveClass("ppChatKitAssistant-expanded");
  });

  it("mounts ChatKit inside the assistant drawer when enabled", async () => {
    render(
      <ProductPulseChatKitAssistant
        config={{
          enabled: true,
          apiUrl: "/api/ai/chatkit/message",
          domainKey: "domain_pk_test",
          disabledReason: null,
        }}
        pageContext={{ type: "product", entityId: "core-linen-trouser" }}
      />,
    );
    const script = document.querySelector("script[src='https://cdn.platform.openai.com/deployments/chatkit/chatkit.js']");
    fireEvent.load(script);

    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));

    expect(await screen.findByTestId("chatkit")).toHaveClass("ppChatKitSurface");
    expect(useChatKit).toHaveBeenCalledWith(expect.objectContaining({
      api: expect.objectContaining({
        url: "/api/ai/chatkit/message",
        domainKey: "domain_pk_test",
      }),
    }));
    expect(useChatKit.mock.calls.at(-1)[0].api.getClientSecret).toBeUndefined();
    expect(useChatKit.mock.calls.at(-1)[0].onClientTool).toBeUndefined();
    expect(useChatKit.mock.calls.at(-1)[0].thread.autoScroll).toBe(false);
  });

  it("handles ChatKit navigation effects from server-validated actions", async () => {
    render(
      <ProductPulseChatKitAssistant
        config={{
          enabled: true,
          apiUrl: "/api/ai/chatkit/message",
          domainKey: "domain_pk_test",
          disabledReason: null,
        }}
        pageContext={{ type: "product", entityId: "core-linen-trouser" }}
      />,
    );

    const script = document.querySelector("script[src='https://cdn.platform.openai.com/deployments/chatkit/chatkit.js']");
    fireEvent.load(script);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));
    await screen.findByTestId("chatkit");

    await act(async () => {
      useChatKit.mock.calls.at(-1)[0].onEffect({
        name: "product_pulse.navigate",
        data: { url: "https://evil.example/app/products/core-linen-trouser" },
      });
    });

    expect(await screen.findByText("That assistant navigation is not available.")).toBeVisible();
  });
});
