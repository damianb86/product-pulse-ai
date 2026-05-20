import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";

const CHATKIT_BROWSER_SCRIPT_SRC = "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
let chatKitBrowserScriptPromise;

export function ProductPulseChatKitAssistant({ config, pageContext }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [chatKitScriptReady, setChatKitScriptReady] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const chatKitMethodsRef = useRef(null);
  const conversationIdRef = useRef("");
  const pageContextRef = useRef(pageContext || { type: "unknown" });
  const backendSessionRef = useRef(null);
  const normalizedPageContext = useMemo(() => pageContext || { type: "unknown" }, [pageContext]);
  const pageContextKey = useMemo(() => JSON.stringify(normalizedPageContext), [normalizedPageContext]);
  const enabled = Boolean(config?.enabled);

  useEffect(() => {
    setIsMounted(true);
    if (!enabled) {
      setChatKitScriptReady(false);
      return undefined;
    }

    let cancelled = false;
    loadChatKitBrowserScript()
      .then(() => {
        if (!cancelled) setChatKitScriptReady(true);
      })
      .catch(() => {
        if (!cancelled) setStatusMessage("ChatKit could not load. Refresh the page and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    pageContextRef.current = normalizedPageContext;
    backendSessionRef.current = null;
    setStatusMessage("");
  }, [normalizedPageContext, pageContextKey]);

  const ensureBackendSession = useCallback(async () => {
    const requestedConversationId = conversationIdRef.current || undefined;
    const requestedPageContext = pageContextRef.current || { type: "unknown" };
    const cacheKey = JSON.stringify({
      conversationId: requestedConversationId || "",
      pageContext: requestedPageContext,
    });
    if (backendSessionRef.current?.cacheKey === cacheKey) {
      return backendSessionRef.current;
    }

    const response = await fetch("/api/ai/chatkit/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: requestedConversationId,
        pageContext: requestedPageContext,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.enabled) {
      const message = body.message || "ChatKit is unavailable.";
      setStatusMessage(message);
      throw new Error(message);
    }
    if (body.conversationId) {
      conversationIdRef.current = body.conversationId;
      setConversationId(body.conversationId);
    }
    const session = {
      cacheKey: JSON.stringify({
        conversationId: body.conversationId || requestedConversationId || "",
        pageContext: requestedPageContext,
      }),
      conversationId: body.conversationId || requestedConversationId || "",
      pageContext: body.pageContext || requestedPageContext,
    };
    backendSessionRef.current = session;
    return session;
  }, []);

  const chatKitBackendFetch = useCallback(async (input, init = {}) => {
    const session = await ensureBackendSession();
    return fetch(input, attachChatKitMetadata(init, session));
  }, [ensureBackendSession]);

  const handleWidgetAction = useCallback(async (action, widgetItem) => {
    const response = await fetch("/api/ai/chatkit/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        itemId: widgetItem?.id,
        conversationId: conversationIdRef.current || undefined,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status !== "success") {
      setStatusMessage(body.message || "That assistant action is not available yet.");
      return;
    }

    if (body.action?.type === "navigate" && body.action.url) {
      navigateToProductPulseUrl(body.action.url, setStatusMessage);
      return;
    }

    if (body.action?.type === "send_message" && body.action.message) {
      await chatKitMethodsRef.current?.sendUserMessage({ text: body.action.message });
    }
  }, []);

  const handleEffect = useCallback((event) => {
    if (event?.name !== "product_pulse.navigate") return;
    navigateToProductPulseUrl(event?.data?.url, setStatusMessage);
  }, []);

  const chatKit = useChatKit({
    api: {
      url: config?.apiUrl || "/api/ai/chatkit/message",
      domainKey: config?.domainKey || "",
      fetch: chatKitBackendFetch,
    },
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
      autoScroll: false,
    },
    onEffect: handleEffect,
    onThreadChange: (event) => {
      const nextThreadId = event?.threadId || "";
      if (nextThreadId) {
        conversationIdRef.current = nextThreadId;
        setConversationId(nextThreadId);
      }
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

  const assistantClassName = [
    "ppChatKitAssistant",
    isOpen ? "ppChatKitAssistant-open" : "",
    isExpanded ? "ppChatKitAssistant-expanded" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside className={assistantClassName} aria-label="ProductPulse AI assistant">
      {isOpen ? (
        <div className="ppChatKitPanel" role="dialog" aria-modal="false" aria-label="AI Assistant">
          <div className="ppChatKitPanelHeader">
            <div>
              <strong>AI Assistant</strong>
              <span>{enabled ? "Backend AI" : "Unavailable"}</span>
            </div>
            <div className="ppChatKitPanelActions">
              <button
                type="button"
                className="ppChatKitTextButton"
                onClick={() => setIsExpanded((current) => !current)}
                aria-pressed={isExpanded}
                aria-label={isExpanded ? "Use default AI Assistant width" : "Expand AI Assistant width"}
              >
                {isExpanded ? "Default" : "Wide"}
              </button>
              <button type="button" className="ppChatKitIconButton" onClick={() => setIsOpen(false)} aria-label="Close AI Assistant">
                x
              </button>
            </div>
          </div>
          {statusMessage ? <div className="ppChatKitStatus" role="status">{statusMessage}</div> : null}
          {!enabled ? (
            <div className="ppChatKitDisabled" role="status">
              {config?.disabledReason || "ChatKit is not configured."}
            </div>
          ) : isMounted && chatKitScriptReady ? (
            <ChatKit control={chatKit.control} className="ppChatKitSurface" />
          ) : (
            <div className="ppChatKitDisabled" role="status">Loading assistant...</div>
          )}
        </div>
      ) : null}
      {!isOpen ? (
        <button
          type="button"
          className="ppChatKitLauncher"
          onClick={() => setIsOpen(true)}
          aria-expanded="false"
          aria-label="Open AI Assistant"
        >
          <span aria-hidden="true">AI</span>
          <strong>Assistant</strong>
        </button>
      ) : null}
    </aside>
  );
}

function navigateToProductPulseUrl(url, setStatusMessage) {
  if (typeof url !== "string" || !isSafeProductPulsePath(url)) {
    setStatusMessage("That assistant navigation is not available.");
    return;
  }
  window.location.assign(url);
}

function isSafeProductPulsePath(url) {
  return url === "/app" || url.startsWith("/app/");
}

function loadChatKitBrowserScript() {
  if (typeof document === "undefined") return Promise.resolve();
  const existing = document.querySelector(`script[src="${CHATKIT_BROWSER_SCRIPT_SRC}"]`);
  if (existing?.dataset.productPulseLoaded === "true") return Promise.resolve();
  if (chatKitBrowserScriptPromise) return chatKitBrowserScriptPromise;

  chatKitBrowserScriptPromise = new Promise((resolve, reject) => {
    const script = existing || document.createElement("script");
    script.src = CHATKIT_BROWSER_SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.productPulseLoaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", reject, { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return chatKitBrowserScriptPromise;
}

function attachChatKitMetadata(init, session) {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  const body = parseJsonBody(init?.body);
  const metadata = body && typeof body.metadata === "object" && body.metadata !== null
    ? body.metadata
    : {};
  return {
    ...init,
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      ...body,
      metadata: {
        ...metadata,
        source: "chatkit_custom_backend",
        conversationId: session.conversationId || undefined,
        pageContext: session.pageContext || { type: "unknown" },
      },
    }),
  };
}

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body !== "string") return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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
