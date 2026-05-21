import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatKit } from "@openai/chatkit-react";
import { MemoryRouter, useLocation } from "react-router";
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
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("renders a disabled assistant state when ChatKit is not configured", () => {
    renderWithRouter(
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
    renderWithRouter(
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

  it("lets the assistant header switch between full and compact launchers", () => {
    renderWithRouter(
      <ProductPulseChatKitAssistant
        config={{ enabled: false, disabledReason: "ChatKit requires OPENAI_API_KEY on the server." }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    const fullLauncher = screen.getByRole("button", { name: "Open AI Assistant" });
    expect(fullLauncher).not.toHaveClass("ppChatKitLauncher-compact");
    expect(fullLauncher).toHaveTextContent("AI Assistant");

    fireEvent.click(fullLauncher);
    const switchButton = screen.getByRole("switch", { name: "Use compact AI Assistant launcher" });
    expect(switchButton).toHaveAttribute("aria-checked", "false");

    fireEvent.click(switchButton);

    expect(screen.getByRole("switch", { name: "Use full AI Assistant launcher" })).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("productPulse.chatkit.launcherVariant.v1")).toBe("compact");

    fireEvent.click(screen.getByRole("button", { name: "Close AI Assistant" }));
    expect(screen.getByRole("button", { name: "Open AI Assistant" })).toHaveClass("ppChatKitLauncher-compact");
  });

  it("mounts ChatKit inside the assistant drawer when enabled", async () => {
    renderWithRouter(
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
    expect(useChatKit.mock.calls.at(-1)[0].initialThread).toBe(null);
    expect(useChatKit.mock.calls.at(-1)[0].thread.autoScroll).toBe(false);
    expect(useChatKit.mock.calls.at(-1)[0].theme.colorScheme).toBe("light");
    expect(useChatKit.mock.calls.at(-1)[0].header.enabled).toBe(false);
  });

  it("lets the assistant header switch between light and dark themes", async () => {
    renderWithRouter(
      <ProductPulseChatKitAssistant
        config={{
          enabled: true,
          apiUrl: "/api/ai/chatkit/message",
          domainKey: "domain_pk_test",
          disabledReason: null,
        }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    const script = document.querySelector("script[src='https://cdn.platform.openai.com/deployments/chatkit/chatkit.js']");
    fireEvent.load(script);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));
    await screen.findByTestId("chatkit");

    const assistant = screen.getByLabelText("ProductPulse AI assistant");
    const switchButton = screen.getByRole("switch", { name: "Use dark AI Assistant theme" });
    expect(switchButton).toHaveAttribute("aria-checked", "false");
    expect(assistant).toHaveClass("ppChatKitAssistant-light");

    fireEvent.click(switchButton);

    expect(screen.getByRole("switch", { name: "Use light AI Assistant theme" })).toHaveAttribute("aria-checked", "true");
    expect(assistant).toHaveClass("ppChatKitAssistant-dark");
    expect(window.localStorage.getItem("productPulse.chatkit.theme.v1")).toBe("dark");

    await waitFor(() => {
      expect(useChatKit.mock.calls.at(-1)[0].theme.colorScheme).toBe("dark");
    });
  });

  it("restores the active ChatKit thread when the drawer is closed and reopened", async () => {
    renderWithRouter(
      <ProductPulseChatKitAssistant
        config={{
          enabled: true,
          apiUrl: "/api/ai/chatkit/message",
          domainKey: "domain_pk_test",
          disabledReason: null,
        }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    const script = document.querySelector("script[src='https://cdn.platform.openai.com/deployments/chatkit/chatkit.js']");
    fireEvent.load(script);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));
    await screen.findByTestId("chatkit");

    await act(async () => {
      useChatKit.mock.calls.at(-1)[0].onThreadChange({ threadId: "conversation-123" });
    });

    await waitFor(() => {
      expect(useChatKit.mock.calls.at(-1)[0].initialThread).toBe("conversation-123");
    });
    expect(window.sessionStorage.getItem("productPulse.chatkit.conversationId.v1")).toBe("conversation-123");

    fireEvent.click(screen.getByRole("button", { name: "Close AI Assistant" }));
    expect(screen.queryByTestId("chatkit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));
    expect(await screen.findByTestId("chatkit")).toHaveClass("ppChatKitSurface");
    expect(useChatKit.mock.calls.at(-1)[0].initialThread).toBe("conversation-123");
  });

  it("hydrates the active ChatKit thread from session storage", async () => {
    window.sessionStorage.setItem("productPulse.chatkit.conversationId.v1", "stored-conversation");

    renderWithRouter(
      <ProductPulseChatKitAssistant
        config={{
          enabled: true,
          apiUrl: "/api/ai/chatkit/message",
          domainKey: "domain_pk_test",
          disabledReason: null,
        }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    const script = document.querySelector("script[src='https://cdn.platform.openai.com/deployments/chatkit/chatkit.js']");
    fireEvent.load(script);
    fireEvent.click(screen.getByRole("button", { name: "Open AI Assistant" }));
    await screen.findByTestId("chatkit");

    await waitFor(() => {
      expect(useChatKit.mock.calls.at(-1)[0].initialThread).toBe("stored-conversation");
    });
  });

  it("handles ChatKit navigation effects from server-validated actions", async () => {
    const locations = [];
    renderWithRouter(
      <>
        <LocationProbe onChange={(location) => locations.push(`${location.pathname}${location.search}`)} />
        <ProductPulseChatKitAssistant
          config={{
            enabled: true,
            apiUrl: "/api/ai/chatkit/message",
            domainKey: "domain_pk_test",
            disabledReason: null,
          }}
          pageContext={{ type: "product", entityId: "core-linen-trouser" }}
        />
      </>,
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

    await act(async () => {
      useChatKit.mock.calls.at(-1)[0].onEffect({
        name: "product_pulse.navigate",
        data: { url: "/app/products/core-linen-trouser?assistantAction=open_recommendation&recommendationId=fit-note" },
      });
    });

    expect(locations.at(-1)).toBe("/app/products/core-linen-trouser?assistantAction=open_recommendation&recommendationId=fit-note");
  });
});

function renderWithRouter(ui, options = {}) {
  return render(
    <MemoryRouter initialEntries={options.initialEntries || ["/app"]}>
      {ui}
    </MemoryRouter>,
  );
}

function LocationProbe({ onChange }) {
  const location = useLocation();
  onChange(location);
  return null;
}
