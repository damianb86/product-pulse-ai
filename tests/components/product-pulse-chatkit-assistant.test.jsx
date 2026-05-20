import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("renders a disabled assistant state when ChatKit is not configured", () => {
    render(
      <ProductPulseChatKitAssistant
        config={{ enabled: false, disabledReason: "ChatKit requires OPENAI_API_KEY on the server." }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));

    expect(screen.getByRole("dialog", { name: "AI Assistant" })).toBeInTheDocument();
    expect(screen.getByText("ChatKit requires OPENAI_API_KEY on the server.")).toBeVisible();
    expect(screen.queryByTestId("chatkit")).not.toBeInTheDocument();
  });

  it("mounts ChatKit inside the assistant drawer when enabled", async () => {
    render(
      <ProductPulseChatKitAssistant
        config={{
          enabled: true,
          apiUrl: "/api/ai/chatkit/message",
          domainKey: "product-pulse-custom-backend",
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
        domainKey: "product-pulse-custom-backend",
      }),
    }));
    expect(useChatKit.mock.calls.at(-1)[0].api.getClientSecret).toBeUndefined();
    expect(useChatKit.mock.calls.at(-1)[0].onClientTool).toBeUndefined();
  });
});
