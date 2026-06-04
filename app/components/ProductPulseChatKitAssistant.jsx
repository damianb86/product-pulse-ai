import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { useLocation, useNavigate } from "react-router";
import { buildEmbeddedApiPath, buildEmbeddedAppPath, getEmbeddedAppPathname } from "../lib/product-pulse-app-paths";

const CHATKIT_BROWSER_SCRIPT_SRC = "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const CHATKIT_CONVERSATION_STORAGE_KEY = "productPulse.chatkit.conversationId.v1";
const CHATKIT_CONVERSATION_STATE_STORAGE_KEY = "productPulse.chatkit.conversationState.v1";
const CHATKIT_THEME_STORAGE_KEY = "productPulse.chatkit.theme.v2";
const CHATKIT_ASSISTANT_NAME = "Pulse Guide";
let chatKitBrowserScriptPromise;

export function ProductPulseChatKitAssistant({ config, quota, pageContext }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [chatKitScriptReady, setChatKitScriptReady] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [themeMode, setThemeMode] = useState("dark");
  const [startScreenDismissed, setStartScreenDismissed] = useState(false);
  const chatKitMethodsRef = useRef(null);
  const conversationIdRef = useRef("");
  const startScreenDismissedRef = useRef(false);
  const pageContextRef = useRef(pageContext || { type: "unknown" });
  const backendSessionRef = useRef(null);
  const normalizedPageContext = useMemo(() => pageContext || { type: "unknown" }, [pageContext]);
  const pageContextKey = useMemo(() => JSON.stringify(normalizedPageContext), [normalizedPageContext]);
  const enabled = Boolean(config?.enabled);
  const quotaExceededMessage = quota && quota.allowed === false
    ? quota.message || "No podés usar más el chat este mes porque superaste la cuota mensual de chat."
    : "";
  const isDarkTheme = themeMode === "dark";
  const chatKitControlsReady = enabled && isMounted && chatKitScriptReady;
  const starterContent = useMemo(() => getStarterContent(normalizedPageContext), [normalizedPageContext]);

  useEffect(() => {
    setIsMounted(true);
    setThemeMode(readStoredThemeMode());
    const storedConversation = readStoredConversationState();
    if (storedConversation.conversationId && !conversationIdRef.current) {
      conversationIdRef.current = storedConversation.conversationId;
      setConversationId(storedConversation.conversationId);
      startScreenDismissedRef.current = storedConversation.started;
      setStartScreenDismissed(storedConversation.started);
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
    startScreenDismissedRef.current = startScreenDismissed;
  }, [startScreenDismissed]);

  useEffect(() => {
    pageContextRef.current = normalizedPageContext;
    backendSessionRef.current = null;
    setStatusMessage(isOpen && quotaExceededMessage ? quotaExceededMessage : "");
  }, [normalizedPageContext, pageContextKey, isOpen, quotaExceededMessage]);

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
      writeStoredConversationState(body.conversationId, startScreenDismissedRef.current);
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

  const markConversationStarted = useCallback(() => {
    startScreenDismissedRef.current = true;
    setStartScreenDismissed(true);
    if (conversationIdRef.current) {
      writeStoredConversationState(conversationIdRef.current, true);
    }
  }, []);

  const chatKitBackendFetch = useCallback(async (input, init = {}) => {
    if (isChatKitUserMessageRequest(init?.body)) {
      markConversationStarted();
    }
    const session = await ensureBackendSession();
    return fetch(getScopedApiInput(input, location.pathname), attachChatKitMetadata(init, session));
  }, [ensureBackendSession, location.pathname, markConversationStarted]);

  const handleWidgetAction = useCallback(async (action, widgetItem) => {
    const response = await fetch(buildEmbeddedApiPath(location.pathname, "/api/ai/chatkit/action"), {
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
      navigateToProductPulseUrl(body.action.url, setStatusMessage, navigate, location.pathname);
      return;
    }

    if (body.action?.type === "send_message" && body.action.message) {
      await chatKitMethodsRef.current?.sendUserMessage({ text: body.action.message });
    }
  }, [location.pathname, navigate]);

  const handleEffect = useCallback((event) => {
    if (event?.name !== "product_pulse.navigate") return;
    navigateToProductPulseUrl(event?.data?.url, setStatusMessage, navigate, location.pathname);
  }, [location.pathname, navigate]);

  const toggleThemeMode = useCallback(() => {
    setThemeMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      writeStoredThemeMode(next);
      return next;
    });
  }, []);

  const startNewChat = useCallback(async () => {
    const methods = chatKitMethodsRef.current;
    setStatusMessage("");
    conversationIdRef.current = "";
    setConversationId("");
    backendSessionRef.current = null;
    startScreenDismissedRef.current = false;
    setStartScreenDismissed(false);
    writeStoredConversationState("", false);

    try {
      await methods?.setThreadId?.(null);
      await methods?.focusComposer?.();
    } catch {
      setStatusMessage("New chat is not available yet.");
    }
  }, []);

  const openChatHistory = useCallback(async () => {
    setStatusMessage("");
    markConversationStarted();
    try {
      await chatKitMethodsRef.current?.showHistory?.();
    } catch {
      setStatusMessage("Chat history is not available yet.");
    }
  }, [markConversationStarted]);

  const openAssistant = useCallback(() => {
    setIsOpen(true);
    if (quotaExceededMessage) setStatusMessage(quotaExceededMessage);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail: { type: "chat-opened" } }));
    }
  }, [quotaExceededMessage]);

  const sendStarterPrompt = useCallback(async (prompt) => {
    const text = typeof prompt === "string" ? prompt.trim() : "";
    if (!text) return;
    const methods = chatKitMethodsRef.current;
    if (!methods?.sendUserMessage) {
      setStatusMessage("The assistant is still loading. Try again in a moment.");
      return;
    }
    setStatusMessage("");
    markConversationStarted();
    try {
      await methods.sendUserMessage({ text });
    } catch {
      startScreenDismissedRef.current = false;
      setStartScreenDismissed(false);
      setStatusMessage("I could not send that prompt. Try typing it below.");
    }
  }, [markConversationStarted]);

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
      greeting: "",
      prompts: [],
    },
    composer: {
      placeholder: normalizedPageContext.type === "product"
        ? "Ask about this product..."
        : "Ask about ProductPulse data...",
      attachments: { enabled: false },
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
      writeStoredConversationState(nextThreadId, startScreenDismissedRef.current);
    },
    onError: (event) => {
      setStatusMessage(event?.error?.message || "ChatKit reported an error.");
    },
  });

  useEffect(() => {
    chatKitMethodsRef.current = chatKit;
  }, [chatKit]);

  useEffect(() => {
    if (!chatKit?.addEventListener || !chatKit?.removeEventListener) return undefined;
    const handleConversationStarted = () => markConversationStarted();
    chatKit.addEventListener("chatkit.response.start", handleConversationStarted);
    chatKit.addEventListener("chatkit.thread.load.start", handleConversationStarted);
    return () => {
      chatKit.removeEventListener("chatkit.response.start", handleConversationStarted);
      chatKit.removeEventListener("chatkit.thread.load.start", handleConversationStarted);
    };
  }, [chatKit, markConversationStarted]);

  const assistantClassName = [
    "ppChatKitAssistant",
    isOpen ? "ppChatKitAssistant-open" : "",
    isExpanded ? "ppChatKitAssistant-expanded" : "",
    isDarkTheme ? "ppChatKitAssistant-dark" : "ppChatKitAssistant-light",
  ].filter(Boolean).join(" ");
  const showStarterScreen = enabled && isMounted && chatKitScriptReady && !startScreenDismissed;

  return (
    <aside className={assistantClassName} aria-label={`${CHATKIT_ASSISTANT_NAME} assistant`} data-pp-chat-assistant={isOpen ? "open" : "closed"}>
      {isOpen ? (
        <div className="ppChatKitPanel" role="dialog" aria-modal="false" aria-label={CHATKIT_ASSISTANT_NAME} data-pp-chat-panel>
          <div className="ppChatKitPanelHeader">
            <div className="ppChatKitPanelActions">
              <div className="ppChatKitPanelActionsLeft">
                <div className="ppChatKitThemeControl" aria-label={`${CHATKIT_ASSISTANT_NAME} theme`}>
                  <button
                    type="button"
                    className="ppChatKitThemeSwitch"
                    role="switch"
                    aria-checked={isDarkTheme}
                    aria-label={isDarkTheme ? `Use light ${CHATKIT_ASSISTANT_NAME} theme` : `Use dark ${CHATKIT_ASSISTANT_NAME} theme`}
                    onClick={toggleThemeMode}
                  >
                    <span className="ppChatKitThemeSwitchTrack" aria-hidden="true">
                      <span className="ppChatKitThemeSwitchThumb" />
                    </span>
                  </button>
                </div>
              </div>
              <div className="ppChatKitPanelActionsRight">
                <button
                  type="button"
                  className="ppChatKitIconButton"
                  onClick={startNewChat}
                  aria-label={`Start a new ${CHATKIT_ASSISTANT_NAME} chat`}
                  title="New chat"
                  disabled={!chatKitControlsReady}
                >
                  <ChatKitHeaderIcon type="new" />
                </button>
                <button
                  type="button"
                  className="ppChatKitIconButton"
                  onClick={openChatHistory}
                  aria-label={`Open ${CHATKIT_ASSISTANT_NAME} chat history`}
                  title="History"
                  disabled={!chatKitControlsReady}
                >
                  <ChatKitHeaderIcon type="history" />
                </button>
                <button
                  type="button"
                  className="ppChatKitIconButton"
                  onClick={() => setIsExpanded((current) => !current)}
                  aria-pressed={isExpanded}
                  aria-label={isExpanded ? `Use default ${CHATKIT_ASSISTANT_NAME} width` : `Expand ${CHATKIT_ASSISTANT_NAME} width`}
                  title={isExpanded ? "Default size" : "Wide size"}
                >
                  <ChatKitHeaderIcon type={isExpanded ? "collapse" : "expand"} />
                </button>
                <button type="button" className="ppChatKitIconButton" onClick={() => setIsOpen(false)} aria-label={`Close ${CHATKIT_ASSISTANT_NAME}`} title="Close">
                  <ChatKitHeaderIcon type="close" />
                </button>
              </div>
            </div>
          </div>
          {statusMessage ? <div className="ppChatKitStatus" role="status">{statusMessage}</div> : null}
          {!enabled ? (
            <div className="ppChatKitDisabled" role="status">
              {config?.disabledReason || "ChatKit is not configured."}
            </div>
          ) : isMounted && chatKitScriptReady ? (
            <div className="ppChatKitBody">
              <ChatKit control={chatKit.control} className="ppChatKitSurface" />
              {showStarterScreen ? (
                <ProductPulseChatKitStartScreen content={starterContent} onSelectPrompt={sendStarterPrompt} />
              ) : null}
            </div>
          ) : (
            <div className="ppChatKitDisabled" role="status">Loading assistant...</div>
          )}
        </div>
      ) : null}
      {!isOpen ? (
        <button
          type="button"
          className="ppChatKitLauncher"
          onClick={openAssistant}
          aria-expanded="false"
          aria-label={`Open ${CHATKIT_ASSISTANT_NAME}`}
          title={`Open ${CHATKIT_ASSISTANT_NAME}`}
          data-pp-chat-launcher
        >
          <span className="ppChatKitLauncherIcon" aria-hidden="true">
            <img
              className="ppChatKitLauncherIconGlyph"
              src="/assets/ai-assistant-icon-gradient-transparent.png"
              alt=""
              width="46"
              height="46"
            />
          </span>
        </button>
      ) : null}
    </aside>
  );
}

function ChatKitHeaderIcon({ type }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    focusable: "false",
  };
  if (type === "new") {
    return (
      <svg {...commonProps}>
        <path d="M12 5V19" />
        <path d="M5 12H19" />
      </svg>
    );
  }
  if (type === "history") {
    return (
      <svg {...commonProps}>
        <path d="M4.8 12A7.2 7.2 0 1 0 7 6.8" />
        <path d="M4.8 5.2V9H8.6" />
        <path d="M12 8.2V12.3L14.7 14" />
      </svg>
    );
  }
  if (type === "expand") {
    return (
      <svg {...commonProps}>
        <path d="M9 4.8H4.8V9" />
        <path d="M4.8 4.8L10 10" />
        <path d="M15 19.2H19.2V15" />
        <path d="M19.2 19.2L14 14" />
      </svg>
    );
  }
  if (type === "collapse") {
    return (
      <svg {...commonProps}>
        <path d="M10 4.8V10H4.8" />
        <path d="M10 10L4.8 4.8" />
        <path d="M14 19.2V14H19.2" />
        <path d="M14 14L19.2 19.2" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M6.5 6.5L17.5 17.5" />
      <path d="M17.5 6.5L6.5 17.5" />
    </svg>
  );
}

function ProductPulseChatKitStartScreen({ content, onSelectPrompt }) {
  const actions = Array.isArray(content?.actions) ? content.actions : [];
  return (
    <section className="ppChatKitStartScreen" aria-label="Pulse Guide start screen">
      <div className="ppChatKitStartIntro">
        <span>{content.eyebrow}</span>
        <h2>{content.title}</h2>
        <p>{content.description}</p>
      </div>
      <div className="ppChatKitStartCapabilityGrid" aria-label="Pulse Guide capabilities">
        {(content.capabilities || []).map((capability) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
      <div className="ppChatKitStartPromptGrid" aria-label="Quick questions">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`ppChatKitStartPrompt ppChatKitStartPrompt-${action.tone || "green"}`}
            onClick={() => onSelectPrompt(action.prompt)}
          >
            <span className="ppChatKitStartPromptIcon" aria-hidden="true">
              <ChatKitStarterIcon type={action.icon} />
            </span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChatKitStarterIcon({ type }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    focusable: "false",
  };
  if (type === "risk") {
    return <svg {...commonProps}><path d="M12 3.8 19.2 7v5.4c0 4.1-2.8 6.7-7.2 7.8-4.4-1.1-7.2-3.7-7.2-7.8V7L12 3.8Z" /><path d="M12 8.2v4.4" /><path d="M12 16.2h.01" /></svg>;
  }
  if (type === "evidence") {
    return <svg {...commonProps}><path d="M7.2 4.8h6.2l3.4 3.4v11H7.2z" /><path d="M13.4 4.8v3.4h3.4" /><path d="M9.6 11.2h4.8" /><path d="M9.6 14.2h4.8" /><path d="M9.6 17.2h3" /></svg>;
  }
  if (type === "metrics") {
    return <svg {...commonProps}><path d="M4.8 18.8h14.4" /><path d="M7.2 15.8v-4.2" /><path d="M12 15.8V7.4" /><path d="M16.8 15.8v-6.1" /><path d="m6.4 9.8 4.1-3.2 3.3 2.4 4-4.1" /></svg>;
  }
  if (type === "actions") {
    return <svg {...commonProps}><path d="M5.4 17.8c3.2-4.6 7.2-7.7 13.2-9.9" /><path d="m15.6 6.4 3.4 1.3-1.3 3.4" /><circle cx="6.6" cy="17.2" r="2" /><path d="m11.2 4.5.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" /></svg>;
  }
  if (type === "edit") {
    return <svg {...commonProps}><path d="M5.4 15.8 15.8 5.4a2.2 2.2 0 0 1 3.1 3.1L8.5 18.9H5.4z" /><path d="m14.4 6.8 2.8 2.8" /></svg>;
  }
  if (type === "method") {
    return <svg {...commonProps}><circle cx="12" cy="12" r="7.4" /><path d="M12 8.3v3.9" /><path d="M12 15.7h.01" /></svg>;
  }
  if (type === "watchlist") {
    return <svg {...commonProps}><path d="M12 4.3 14.3 9l5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2L4.5 9.8 9.7 9z" /></svg>;
  }
  if (type === "support") {
    return <svg {...commonProps}><path d="M5 12.8a7 7 0 0 1 14 0v3.4a2 2 0 0 1-2 2h-2.2" /><path d="M5 13h3v5H6.8A1.8 1.8 0 0 1 5 16.2z" /><path d="M19 13h-3v5h1.2a1.8 1.8 0 0 0 1.8-1.8z" /><path d="M10.5 19h3" /></svg>;
  }
  return <svg {...commonProps}><path d="M4.8 12h14.4" /><path d="M12 4.8v14.4" /></svg>;
}

function navigateToProductPulseUrl(url, setStatusMessage, navigate, currentPathname = "") {
  if (typeof url !== "string" || !isSafeProductPulsePath(url)) {
    setStatusMessage("That assistant navigation is not available.");
    return;
  }
  const scopedUrl = buildEmbeddedAppPath(currentPathname, url);
  window.dispatchEvent(new CustomEvent("productpulse:chatkit-navigate", {
    detail: { url: scopedUrl },
  }));
  navigate(scopedUrl);
}

function getScopedApiInput(input, currentPathname = "") {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return buildEmbeddedApiPath(currentPathname, input);
  }
  if (input instanceof URL && input.pathname.startsWith("/api/")) {
    return new URL(buildEmbeddedApiPath(currentPathname, `${input.pathname}${input.search}${input.hash}`), input.origin);
  }
  return input;
}

function isSafeProductPulsePath(url) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(String(url || ""))) return false;
  const pathname = getEmbeddedAppPathname(url);
  return pathname === "/app" || pathname.startsWith("/app/");
}

function readStoredConversationState() {
  const emptyState = { conversationId: "", started: false };
  if (typeof window === "undefined") return emptyState;
  try {
    const rawState = String(window.sessionStorage?.getItem(CHATKIT_CONVERSATION_STATE_STORAGE_KEY) || "").trim();
    if (!rawState) return emptyState;
    const parsed = JSON.parse(rawState);
    const conversationId = String(parsed?.conversationId || "").trim();
    return {
      conversationId,
      started: Boolean(conversationId && parsed?.started),
    };
  } catch {
    return emptyState;
  }
}

function writeStoredConversationState(conversationId, started) {
  if (typeof window === "undefined") return;
  try {
    const normalized = String(conversationId || "").trim();
    if (normalized) {
      window.sessionStorage?.setItem(CHATKIT_CONVERSATION_STORAGE_KEY, normalized);
      window.sessionStorage?.setItem(CHATKIT_CONVERSATION_STATE_STORAGE_KEY, JSON.stringify({
        conversationId: normalized,
        started: Boolean(started),
      }));
    } else {
      window.sessionStorage?.removeItem(CHATKIT_CONVERSATION_STORAGE_KEY);
      window.sessionStorage?.removeItem(CHATKIT_CONVERSATION_STATE_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in embedded browser privacy modes.
  }
}

function readStoredThemeMode() {
  if (typeof window === "undefined") return "dark";
  try {
    const value = String(window.localStorage?.getItem(CHATKIT_THEME_STORAGE_KEY) || "").trim();
    return value === "light" ? "light" : "dark";
  } catch {
    return "dark";
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

function isChatKitUserMessageRequest(body) {
  const parsed = parseJsonBody(body);
  return parsed.type === "threads.create" || parsed.type === "threads.add_user_message";
}

function getStarterContent(pageContext) {
  if (pageContext?.type === "product") {
    return {
      eyebrow: "Product context",
      title: "Ask Pulse Guide about this product",
      description: "Use the assistant to read ProductPulse data, explain risk, surface evidence, and prepare confirmed app-owned actions. It will not change Shopify directly.",
      capabilities: ["Risk", "Evidence", "Metrics", "Internal actions"],
      actions: [
        { label: "Explain risk", description: "Why this product is flagged", icon: "risk", tone: "red", prompt: "Explain this product's current risk, confidence, and impact." },
        { label: "Show evidence", description: "Returns, refunds, reviews, signals", icon: "evidence", tone: "blue", prompt: "Show the strongest evidence behind this product diagnosis." },
        { label: "Key metrics", description: "Compact numbers to review", icon: "metrics", tone: "green", prompt: "Summarize the key ProductPulse metrics for this product." },
        { label: "Recommended actions", description: "What to review first", icon: "actions", tone: "purple", prompt: "List the recommended actions for this product and explain which one I should review first." },
        { label: "Create action", description: "Prepare an app-owned action", icon: "edit", tone: "amber", prompt: "Help me create a new internal ProductPulse action for this product. Ask what type of action I want." },
        { label: "Rewrite action", description: "Edit an existing recommendation", icon: "edit", tone: "purple", prompt: "Guide me to rewrite an existing recommended action for this product." },
        { label: "Explain scoring", description: "How the scores are calculated", icon: "method", tone: "blue", prompt: "Explain how ProductPulse calculates this product's scores and what each score means." },
        { label: "Report issue", description: "Send context to support", icon: "support", tone: "slate", prompt: "I need to report a problem with this product analysis." },
      ],
    };
  }

  return {
    eyebrow: "ProductPulse assistant",
    title: "Ask what to review, why it matters, and what to do next",
    description: "Pulse Guide can read ProductPulse data, explain scoring and evidence, summarize the catalog, and prepare confirmed internal actions. Shopify changes stay outside the chat.",
    capabilities: ["Catalog risk", "Analytics", "Watchlist", "Guidance"],
    actions: [
      { label: "Priority products", description: "Unresolved products to review first", icon: "risk", tone: "red", prompt: "Which unresolved products should I review first and why?" },
      { label: "Marketing report", description: "Catalog summary for planning", icon: "metrics", tone: "green", prompt: "Analyze all unresolved products and give me a concise marketing-ready report." },
      { label: "Top risk drivers", description: "Common issues across products", icon: "evidence", tone: "blue", prompt: "What are the most common product issues across my catalog?" },
      { label: "Watchlist status", description: "Current monitored products", icon: "watchlist", tone: "purple", prompt: "Summarize the current ProductPulse watchlist status." },
      { label: "Analytics summary", description: "Trends, impact, and signals", icon: "metrics", tone: "blue", prompt: "Summarize my ProductPulse analytics and important trends." },
      { label: "Actions to review", description: "Internal recommendations pending", icon: "actions", tone: "amber", prompt: "Show recommended internal actions that need review." },
      { label: "Explain scoring", description: "Risk, momentum, impact, confidence", icon: "method", tone: "green", prompt: "Explain how ProductPulse scores risk, momentum, impact, and confidence." },
      { label: "Report issue", description: "Send context to support", icon: "support", tone: "slate", prompt: "I need help reporting a problem with the app." },
    ],
  };
}
