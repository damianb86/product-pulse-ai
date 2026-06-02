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
      focusComposer: vi.fn(),
      setThreadId: vi.fn(),
      sendUserMessage: vi.fn(),
      showHistory: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  };
});

describe("ProductPulseChatKitAssistant", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
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

    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));

    expect(screen.getByRole("dialog", { name: "Pulse Guide" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Pulse Guide" })).not.toBeInTheDocument();
    expect(screen.getByText("ChatKit requires OPENAI_API_KEY on the server.")).toBeVisible();
    expect(screen.queryByTestId("chatkit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Pulse Guide" }));
    expect(screen.getByRole("button", { name: "Open Pulse Guide" })).toBeInTheDocument();
  });

  it("lets the assistant drawer switch between default and wide widths", () => {
    renderWithRouter(
      <ProductPulseChatKitAssistant
        config={{ enabled: false, disabledReason: "ChatKit requires OPENAI_API_KEY on the server." }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));

    const assistant = screen.getByLabelText("Pulse Guide assistant");
    expect(assistant).not.toHaveClass("ppChatKitAssistant-expanded");

    fireEvent.click(screen.getByRole("button", { name: "Expand Pulse Guide width" }));
    expect(assistant).toHaveClass("ppChatKitAssistant-expanded");

    fireEvent.click(screen.getByRole("button", { name: "Use default Pulse Guide width" }));
    expect(assistant).not.toHaveClass("ppChatKitAssistant-expanded");
  });

  it("renders the launcher as an icon-only button", () => {
    renderWithRouter(
      <ProductPulseChatKitAssistant
        config={{ enabled: false, disabledReason: "ChatKit requires OPENAI_API_KEY on the server." }}
        pageContext={{ type: "dashboard" }}
      />,
    );

    const launcher = screen.getByRole("button", { name: "Open Pulse Guide" });
    expect(launcher).toHaveClass("ppChatKitLauncher");
    expect(launcher.textContent.trim()).toBe("");

    fireEvent.click(launcher);
    expect(screen.queryByRole("switch", { name: /launcher/i })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));

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
    expect(useChatKit.mock.calls.at(-1)[0].theme.colorScheme).toBe("dark");
    expect(useChatKit.mock.calls.at(-1)[0].header.enabled).toBe(false);
    expect(useChatKit.mock.calls.at(-1)[0].startScreen).toMatchObject({ greeting: "", prompts: [] });
    expect(useChatKit.mock.calls.at(-1)[0].disclaimer).toBeUndefined();
  });

  it("renders a compact custom start screen with quick prompts", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
    await screen.findByTestId("chatkit");

    expect(screen.getByRole("heading", { name: "Ask what to review, why it matters, and what to do next" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /products|report|drivers|watchlist|summary|actions|scoring|issue/i })).toHaveLength(8);

    const methods = useChatKit.mock.results.at(-1).value;
    fireEvent.click(screen.getByRole("button", { name: /Priority products/i }));

    await waitFor(() => {
      expect(methods.sendUserMessage).toHaveBeenCalledWith({ text: "Which unresolved products should I review first and why?" });
    });
    expect(screen.queryByRole("heading", { name: "Ask what to review, why it matters, and what to do next" })).not.toBeInTheDocument();
  });

  it("hides the custom start screen when the user sends a typed ChatKit message", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/api/ai/chatkit/session")) {
        return new Response(JSON.stringify({
          enabled: true,
          conversationId: "conversation-typed-message",
          pageContext: { type: "dashboard" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
    await screen.findByTestId("chatkit");

    expect(screen.getByRole("heading", { name: "Ask what to review, why it matters, and what to do next" })).toBeVisible();

    await act(async () => {
      await useChatKit.mock.calls.at(-1)[0].api.fetch("/api/ai/chatkit/message", {
        method: "POST",
        body: JSON.stringify({
          type: "threads.create",
          params: {
            input: {
              content: [{ type: "input_text", text: "Analizame este producto" }],
              attachments: [],
              inference_options: {},
            },
          },
        }),
      });
    });

    expect(screen.queryByRole("heading", { name: "Ask what to review, why it matters, and what to do next" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("productPulse.chatkit.conversationState.v1")).toContain("\"started\":true");
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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
    await screen.findByTestId("chatkit");

    const assistant = screen.getByLabelText("Pulse Guide assistant");
    const switchButton = screen.getByRole("switch", { name: "Use light Pulse Guide theme" });
    expect(switchButton).toHaveAttribute("aria-checked", "true");
    expect(assistant).toHaveClass("ppChatKitAssistant-dark");

    fireEvent.click(switchButton);

    expect(screen.getByRole("switch", { name: "Use dark Pulse Guide theme" })).toHaveAttribute("aria-checked", "false");
    expect(assistant).toHaveClass("ppChatKitAssistant-light");
    expect(window.localStorage.getItem("productPulse.chatkit.theme.v2")).toBe("light");

    await waitFor(() => {
      expect(useChatKit.mock.calls.at(-1)[0].theme.colorScheme).toBe("light");
    });
  });

  it("starts a clean chat and opens ChatKit history from header icons", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
    await screen.findByTestId("chatkit");

    await act(async () => {
      useChatKit.mock.calls.at(-1)[0].onThreadChange({ threadId: "conversation-123" });
    });
    expect(window.sessionStorage.getItem("productPulse.chatkit.conversationId.v1")).toBe("conversation-123");

    const methods = useChatKit.mock.results.at(-1).value;
    fireEvent.click(screen.getByRole("button", { name: "Start a new Pulse Guide chat" }));

    await waitFor(() => {
      expect(methods.setThreadId).toHaveBeenCalledWith(null);
    });
    expect(methods.focusComposer).toHaveBeenCalled();
    expect(window.sessionStorage.getItem("productPulse.chatkit.conversationId.v1")).toBe(null);
    expect(window.sessionStorage.getItem("productPulse.chatkit.conversationState.v1")).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide chat history" }));

    await waitFor(() => {
      expect(useChatKit.mock.results.some((result) => result.value.showHistory.mock.calls.length > 0)).toBe(true);
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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
    await screen.findByTestId("chatkit");

    await act(async () => {
      useChatKit.mock.calls.at(-1)[0].onThreadChange({ threadId: "conversation-123" });
    });

    await waitFor(() => {
      expect(useChatKit.mock.calls.at(-1)[0].initialThread).toBe("conversation-123");
    });
    expect(window.sessionStorage.getItem("productPulse.chatkit.conversationId.v1")).toBe("conversation-123");

    fireEvent.click(screen.getByRole("button", { name: "Close Pulse Guide" }));
    expect(screen.queryByTestId("chatkit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
    expect(await screen.findByTestId("chatkit")).toHaveClass("ppChatKitSurface");
    expect(useChatKit.mock.calls.at(-1)[0].initialThread).toBe("conversation-123");
  });

  it("hydrates the active ChatKit thread from session storage", async () => {
    window.sessionStorage.setItem("productPulse.chatkit.conversationState.v1", JSON.stringify({
      conversationId: "stored-conversation",
      started: true,
    }));

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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Open Pulse Guide" }));
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
