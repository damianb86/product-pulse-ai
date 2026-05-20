import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import {
  getMessageFromChatKitClientToolCall,
  PRODUCT_PULSE_CHATKIT_CLIENT_TOOL_NAME,
} from "../ai/chatkit/clientTool";
import { mapAiChatTurnToChatKitToolOutput } from "../ai/chatkit/widgets";

export function ProductPulseChatKitAssistant({ config, pageContext }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const chatKitMethodsRef = useRef(null);
  const normalizedPageContext = useMemo(() => pageContext || { type: "unknown" }, [pageContext]);
  const pageContextKey = useMemo(() => JSON.stringify(normalizedPageContext), [normalizedPageContext]);
  const enabled = Boolean(config?.enabled);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const requestClientSecret = useCallback(async () => {
    setStatusMessage("");
    const response = await fetch("/api/ai/chatkit/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: conversationId || undefined,
        pageContext: normalizedPageContext,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.client_secret) {
      const message = body.message || "ChatKit is unavailable.";
      setStatusMessage(message);
      throw new Error(message);
    }
    if (body.conversationId) setConversationId(body.conversationId);
    return body.client_secret;
  }, [conversationId, normalizedPageContext]);

  const handleClientTool = useCallback(async (toolCall) => {
    if (toolCall.name !== PRODUCT_PULSE_CHATKIT_CLIENT_TOOL_NAME) {
      return {
        ok: false,
        error: "Unsupported ProductPulse ChatKit client tool.",
      };
    }

    const message = getMessageFromChatKitClientToolCall(toolCall);
    if (!message) {
      return {
        ok: false,
        error: "The ProductPulse chat tool needs a message.",
      };
    }

    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: conversationId || undefined,
        message,
        pageContext: normalizedPageContext,
        userIntentMetadata: {
          source: "chatkit",
          clientToolName: toolCall.name,
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: body.message || "ProductPulse AI chat is unavailable.",
      };
    }
    if (body.conversationId) setConversationId(body.conversationId);
    return mapAiChatTurnToChatKitToolOutput(body);
  }, [conversationId, normalizedPageContext]);

  const handleWidgetAction = useCallback(async (action, widgetItem) => {
    const response = await fetch("/api/ai/chatkit/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        itemId: widgetItem?.id,
        conversationId: conversationId || undefined,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status !== "success") {
      setStatusMessage(body.message || "That assistant action is not available yet.");
      return;
    }

    if (body.action?.type === "navigate" && body.action.url) {
      window.location.assign(body.action.url);
      return;
    }

    if (body.action?.type === "send_message" && body.action.message) {
      await chatKitMethodsRef.current?.sendUserMessage({ text: body.action.message });
    }
  }, [conversationId]);

  const chatKit = useChatKit({
    api: {
      getClientSecret: requestClientSecret,
    },
    onClientTool: handleClientTool,
    widgets: {
      onAction: handleWidgetAction,
    },
    theme: {
      colorScheme: "light",
      color: {
        accent: {
          primary: "#1f7a6f",
          level: 1,
        },
      },
      radius: "soft",
      density: "compact",
      typography: {
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
    },
    header: {
      enabled: true,
      title: {
        enabled: true,
        text: "ProductPulse AI",
      },
      rightAction: {
        icon: "close",
        onClick: () => setIsOpen(false),
      },
    },
    history: {
      enabled: true,
      showDelete: false,
      showRename: false,
    },
    startScreen: {
      greeting: "Ask about ProductPulse risk, evidence, analytics, or watchlist status.",
      prompts: getStarterPrompts(normalizedPageContext),
    },
    composer: {
      placeholder: normalizedPageContext.type === "product"
        ? "Ask about this product..."
        : "Ask about ProductPulse data...",
      attachments: { enabled: false },
    },
    disclaimer: {
      text: "Read-only assistant. It cannot apply Shopify changes yet.",
    },
    thread: {
      autoScroll: true,
    },
    onError: (event) => {
      setStatusMessage(event?.error?.message || "ChatKit reported an error.");
    },
  });

  useEffect(() => {
    chatKitMethodsRef.current = chatKit;
  }, [chatKit]);

  useEffect(() => {
    setStatusMessage("");
  }, [pageContextKey]);

  return (
    <aside className={`ppChatKitAssistant${isOpen ? " ppChatKitAssistant-open" : ""}`} aria-label="ProductPulse AI assistant">
      {isOpen ? (
        <div className="ppChatKitPanel" role="dialog" aria-modal="false" aria-label="AI Assistant">
          <div className="ppChatKitPanelHeader">
            <div>
              <strong>AI Assistant</strong>
              <span>{enabled ? "ChatKit" : "Unavailable"}</span>
            </div>
            <button type="button" className="ppChatKitIconButton" onClick={() => setIsOpen(false)} aria-label="Close AI Assistant">
              x
            </button>
          </div>
          {statusMessage ? <div className="ppChatKitStatus" role="status">{statusMessage}</div> : null}
          {!enabled ? (
            <div className="ppChatKitDisabled" role="status">
              {config?.disabledReason || "ChatKit is not configured."}
            </div>
          ) : isMounted ? (
            <ChatKit control={chatKit.control} className="ppChatKitSurface" />
          ) : (
            <div className="ppChatKitDisabled" role="status">Loading assistant...</div>
          )}
        </div>
      ) : null}
      <button
        type="button"
        className="ppChatKitLauncher"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label="Open AI Assistant"
      >
        <span aria-hidden="true">AI</span>
        <strong>Assistant</strong>
      </button>
    </aside>
  );
}

function getStarterPrompts(pageContext) {
  if (pageContext?.type === "product") {
    return [
      { label: "Explain this product", prompt: "Explain this product's current risk.", icon: "analytics" },
      { label: "Show evidence", prompt: "Show the evidence behind this product diagnosis.", icon: "document" },
      { label: "Next steps", prompt: "What should I review next for this product?", icon: "lightbulb" },
    ];
  }

  return [
    { label: "High risk products", prompt: "Which products should I review first?", icon: "search" },
    { label: "Store analytics", prompt: "Summarize my ProductPulse analytics.", icon: "chart" },
    { label: "Watchlist status", prompt: "What is happening on my watchlist?", icon: "star" },
  ];
}
