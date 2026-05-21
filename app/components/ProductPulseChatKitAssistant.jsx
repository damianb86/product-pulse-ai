import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { useNavigate } from "react-router";

const CHATKIT_BROWSER_SCRIPT_SRC = "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const CHATKIT_CONVERSATION_STORAGE_KEY = "productPulse.chatkit.conversationId.v1";
const CHATKIT_THEME_STORAGE_KEY = "productPulse.chatkit.theme.v1";
const CHATKIT_LAUNCHER_VARIANT_STORAGE_KEY = "productPulse.chatkit.launcherVariant.v1";
let chatKitBrowserScriptPromise;

export function ProductPulseChatKitAssistant({ config, pageContext }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [chatKitScriptReady, setChatKitScriptReady] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [themeMode, setThemeMode] = useState("light");
  const [launcherVariant, setLauncherVariant] = useState("full");
  const chatKitMethodsRef = useRef(null);
  const conversationIdRef = useRef("");
  const pageContextRef = useRef(pageContext || { type: "unknown" });
  const backendSessionRef = useRef(null);
  const normalizedPageContext = useMemo(() => pageContext || { type: "unknown" }, [pageContext]);
  const pageContextKey = useMemo(() => JSON.stringify(normalizedPageContext), [normalizedPageContext]);
  const enabled = Boolean(config?.enabled);
  const isDarkTheme = themeMode === "dark";
  const isCompactLauncher = launcherVariant === "compact";

  useEffect(() => {
    setIsMounted(true);
    setThemeMode(readStoredThemeMode());
    setLauncherVariant(readStoredLauncherVariant());
    const storedConversationId = readStoredConversationId();
    if (storedConversationId && !conversationIdRef.current) {
      conversationIdRef.current = storedConversationId;
      setConversationId(storedConversationId);
    }
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
      writeStoredConversationId(body.conversationId);
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
      navigateToProductPulseUrl(body.action.url, setStatusMessage, navigate);
      return;
    }

    if (body.action?.type === "send_message" && body.action.message) {
      await chatKitMethodsRef.current?.sendUserMessage({ text: body.action.message });
    }
  }, [navigate]);

  const handleEffect = useCallback((event) => {
    if (event?.name !== "product_pulse.navigate") return;
    navigateToProductPulseUrl(event?.data?.url, setStatusMessage, navigate);
  }, [navigate]);

  const toggleThemeMode = useCallback(() => {
    setThemeMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      writeStoredThemeMode(next);
      return next;
    });
  }, []);

  const toggleLauncherVariant = useCallback(() => {
    setLauncherVariant((current) => {
      const next = current === "compact" ? "full" : "compact";
      writeStoredLauncherVariant(next);
      return next;
    });
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
      colorScheme: themeMode,
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
      enabled: false,
    },
    history: {
      enabled: true,
      showDelete: false,
      showRename: false,
    },
    initialThread: conversationId || null,
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
      const nextThreadId = typeof event?.threadId === "string" ? event.threadId.trim() : "";
      conversationIdRef.current = nextThreadId;
      setConversationId(nextThreadId);
      backendSessionRef.current = null;
      writeStoredConversationId(nextThreadId);
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
    isDarkTheme ? "ppChatKitAssistant-dark" : "ppChatKitAssistant-light",
  ].filter(Boolean).join(" ");

  return (
    <aside className={assistantClassName} aria-label="ProductPulse AI assistant">
      {isOpen ? (
        <div className="ppChatKitPanel" role="dialog" aria-modal="false" aria-label="AI Assistant">
          <div className="ppChatKitPanelHeader">
            <div className="ppChatKitPanelActions">
              <div className="ppChatKitThemeControl" aria-label="AI Assistant theme">
                <span>Theme</span>
                <button
                  type="button"
                  className="ppChatKitThemeSwitch"
                  role="switch"
                  aria-checked={isDarkTheme}
                  aria-label={isDarkTheme ? "Use light AI Assistant theme" : "Use dark AI Assistant theme"}
                  onClick={toggleThemeMode}
                >
                  <span className="ppChatKitThemeSwitchTrack" aria-hidden="true">
                    <span className="ppChatKitThemeSwitchThumb" />
                  </span>
                  <strong>{isDarkTheme ? "Dark" : "Light"}</strong>
                </button>
              </div>
              <div className="ppChatKitThemeControl ppChatKitLauncherControl" aria-label="AI Assistant launcher style">
                <span>Launcher</span>
                <button
                  type="button"
                  className="ppChatKitThemeSwitch ppChatKitLauncherSwitch"
                  role="switch"
                  aria-checked={isCompactLauncher}
                  aria-label={isCompactLauncher ? "Use full AI Assistant launcher" : "Use compact AI Assistant launcher"}
                  onClick={toggleLauncherVariant}
                >
                  <span className="ppChatKitThemeSwitchTrack" aria-hidden="true">
                    <span className="ppChatKitThemeSwitchThumb" />
                  </span>
                  <strong>{isCompactLauncher ? "Icon" : "Full"}</strong>
                </button>
              </div>
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
          className={`ppChatKitLauncher${isCompactLauncher ? " ppChatKitLauncher-compact" : ""}`}
          onClick={() => setIsOpen(true)}
          aria-expanded="false"
          aria-label="Open AI Assistant"
        >
          <span className="ppChatKitLauncherIcon" aria-hidden="true">
            <span className="ppChatKitLauncherIconGlyph" />
          </span>
          <strong className="ppChatKitLauncherLabel">AI Assistant</strong>
        </button>
      ) : null}
    </aside>
  );
}

function navigateToProductPulseUrl(url, setStatusMessage, navigate) {
  if (typeof url !== "string" || !isSafeProductPulsePath(url)) {
    setStatusMessage("That assistant navigation is not available.");
    return;
  }
  window.dispatchEvent(new CustomEvent("productpulse:chatkit-navigate", {
    detail: { url },
  }));
  navigate(url);
}

function isSafeProductPulsePath(url) {
  return url === "/app" || url.startsWith("/app/");
}

function readStoredConversationId() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.sessionStorage?.getItem(CHATKIT_CONVERSATION_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeStoredConversationId(conversationId) {
  if (typeof window === "undefined") return;
  try {
    const normalized = String(conversationId || "").trim();
    if (normalized) {
      window.sessionStorage?.setItem(CHATKIT_CONVERSATION_STORAGE_KEY, normalized);
    } else {
      window.sessionStorage?.removeItem(CHATKIT_CONVERSATION_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in embedded browser privacy modes.
  }
}

function readStoredThemeMode() {
  if (typeof window === "undefined") return "light";
  try {
    const value = String(window.localStorage?.getItem(CHATKIT_THEME_STORAGE_KEY) || "").trim();
    return value === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function writeStoredThemeMode(themeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(CHATKIT_THEME_STORAGE_KEY, themeMode === "dark" ? "dark" : "light");
  } catch {
    // Storage can be unavailable in embedded browser privacy modes.
  }
}

function readStoredLauncherVariant() {
  if (typeof window === "undefined") return "full";
  try {
    const value = String(window.localStorage?.getItem(CHATKIT_LAUNCHER_VARIANT_STORAGE_KEY) || "").trim();
    return value === "compact" ? "compact" : "full";
  } catch {
    return "full";
  }
}

function writeStoredLauncherVariant(launcherVariant) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(CHATKIT_LAUNCHER_VARIANT_STORAGE_KEY, launcherVariant === "compact" ? "compact" : "full");
  } catch {
    // Storage can be unavailable in embedded browser privacy modes.
  }
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
