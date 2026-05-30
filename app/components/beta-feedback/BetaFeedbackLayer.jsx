import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";

const BetaFeedbackContext = createContext(null);

const FEEDBACK_CATEGORIES = [
  { value: "bug_error", label: "Bug / error" },
  { value: "confusing_data", label: "Confusing data" },
  { value: "wrong_value", label: "Wrong value" },
  { value: "feature_request", label: "Feature request" },
  { value: "ux_suggestion", label: "UX suggestion" },
  { value: "something_not_useful", label: "Something not useful" },
  { value: "positive_feedback", label: "Positive feedback" },
  { value: "other", label: "Other" },
];

const HIDE_REASONS = [
  { value: "not_relevant", label: "Not relevant to me" },
  { value: "do_not_understand", label: "I do not understand this panel" },
  { value: "takes_too_much_space", label: "It takes too much space" },
  { value: "data_looks_wrong", label: "The data looks wrong" },
  { value: "duplicate_information", label: "I already get this information elsewhere" },
  { value: "only_need_sometimes", label: "I only need it sometimes" },
  { value: "other", label: "Other" },
  { value: "skipped", label: "Skip feedback" },
];

const DEFAULT_MODAL_STATE = {
  category: "bug_error",
  severity: "medium",
  message: "",
  email: "",
  status: "idle",
  error: "",
};

export function BetaFeedbackProvider({ config, children }) {
  const location = useLocation();
  const enabled = Boolean(config?.enabled);
  const pageKey = useMemo(() => normalizePageKey(location.pathname), [location.pathname]);
  const recentErrorsRef = useRef([]);
  const [preferences, setPreferences] = useState({});
  const [modal, setModal] = useState(null);
  const [hidePrompt, setHidePrompt] = useState(null);
  const hiddenPanels = useMemo(
    () => getHiddenPanelPreferences(preferences, pageKey),
    [pageKey, preferences],
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const rememberError = (entry) => {
      recentErrorsRef.current = [
        {
          message: String(entry.message || "Client error").slice(0, 320),
          source: String(entry.source || "").slice(0, 220),
          at: new Date().toISOString(),
        },
        ...recentErrorsRef.current,
      ].slice(0, 5);
    };

    const handleError = (event) => {
      rememberError({
        message: event.message || event.error?.message,
        source: event.filename || event.error?.stack || "",
      });
    };
    const handleUnhandledRejection = (event) => {
      rememberError({
        message: event.reason?.message || event.reason || "Unhandled promise rejection",
        source: event.reason?.stack || "",
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const abortController = new AbortController();

    fetch(`/api/beta-feedback?pageKey=${encodeURIComponent(pageKey)}`, {
      headers: { Accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data?.enabled || !Array.isArray(data.preferences)) return;
        setPreferences((current) => ({
          ...current,
          ...Object.fromEntries(data.preferences.map((preference) => [getPreferenceKey(preference.pageKey, preference.panelId), preference])),
        }));
      })
      .catch((error) => {
        if (error?.name !== "AbortError") console.error("[beta-feedback.preferences]", error);
      });

    return () => abortController.abort();
  }, [enabled, pageKey]);

  const collectContext = useCallback((panel = null, extra = {}) => {
    const panelContext = panel?.context && typeof panel.context === "object" ? panel.context : {};
    return {
      ...getAutomaticClientContext({
        config,
        location,
        pageKey,
        recentClientErrors: recentErrorsRef.current,
      }),
      ...panelContext,
      ...extra,
      panel: panel ? {
        id: panel.id,
        label: panel.label,
      } : undefined,
    };
  }, [config, location, pageKey]);

  const updatePreference = useCallback((preference) => {
    if (!preference?.panelId) return;
    setPreferences((current) => ({
      ...current,
      [getPreferenceKey(preference.pageKey || pageKey, preference.panelId)]: preference,
    }));
  }, [pageKey]);

  const postBetaFeedback = useCallback(async (payload) => {
    const response = await fetch("/api/beta-feedback", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !["success", "ok"].includes(String(data.status || ""))) {
      throw new Error(data.message || "Beta feedback could not be saved.");
    }
    return data;
  }, []);

  const openFeedback = useCallback((panel = null, defaults = {}) => {
    const normalizedPanel = normalizePanel(panel);
    setModal({
      panel: normalizedPanel,
      source: normalizedPanel ? "panel" : "global",
      ...DEFAULT_MODAL_STATE,
      ...defaults,
      email: config?.user?.email ? "" : defaults.email || "",
    });
  }, [config?.user?.email]);

  const closeFeedback = useCallback(() => setModal(null), []);

  const submitFeedback = useCallback(async (state) => {
    const panel = normalizePanel(state.panel);
    setModal((current) => current ? { ...current, status: "submitting", error: "" } : current);

    try {
      const data = await postBetaFeedback({
        intent: "submit-feedback",
        category: state.category,
        severity: state.severity,
        message: state.message,
        email: config?.user?.email || state.email,
        pageKey,
        pagePath: `${location.pathname}${location.search}`,
        pageRoute: pageKey,
        panelId: panel?.id,
        panelLabel: panel?.label,
        source: state.source || (panel ? "panel" : "global"),
        relatedEntity: panel?.relatedEntity,
        context: collectContext(panel, state.extraContext),
      });
      setModal((current) => current ? { ...current, status: "success", reportId: data.report?.id || "" } : current);
      window.setTimeout(() => setModal(null), 1300);
    } catch (error) {
      setModal((current) => current ? { ...current, status: "error", error: error.message } : current);
    }
  }, [collectContext, config?.user?.email, location.pathname, location.search, pageKey, postBetaFeedback]);

  const requestPanelHide = useCallback(async (panel) => {
    const normalizedPanel = normalizePanel(panel);
    if (!normalizedPanel) return;

    const preference = preferences[getPreferenceKey(pageKey, normalizedPanel.id)];
    if (!preference?.hasHideReason) {
      setHidePrompt({
        panel: normalizedPanel,
        reason: "not_relevant",
        reasonMessage: "",
        status: "idle",
        error: "",
      });
      return;
    }

    const optimistic = {
      ...preference,
      pageKey,
      panelId: normalizedPanel.id,
      panelLabel: normalizedPanel.label,
      hidden: true,
    };
    updatePreference(optimistic);
    try {
      const data = await postBetaFeedback({
        intent: "set-panel-visibility",
        pageKey,
        pagePath: `${location.pathname}${location.search}`,
        panelId: normalizedPanel.id,
        panelLabel: normalizedPanel.label,
        hidden: true,
        context: collectContext(normalizedPanel),
      });
      updatePreference(data.preference);
    } catch (error) {
      console.error("[beta-feedback.hide]", error);
      updatePreference({ ...optimistic, hidden: false });
    }
  }, [collectContext, location.pathname, location.search, pageKey, postBetaFeedback, preferences, updatePreference]);

  const submitHideReason = useCallback(async (state) => {
    const panel = normalizePanel(state.panel);
    if (!panel) return;

    setHidePrompt((current) => current ? { ...current, status: "submitting", error: "" } : current);
    try {
      const data = await postBetaFeedback({
        intent: "hide-panel",
        pageKey,
        pagePath: `${location.pathname}${location.search}`,
        panelId: panel.id,
        panelLabel: panel.label,
        reason: state.reason,
        reasonMessage: state.reasonMessage,
        context: collectContext(panel),
      });
      updatePreference(data.preference);
      setHidePrompt(null);
    } catch (error) {
      setHidePrompt((current) => current ? { ...current, status: "error", error: error.message } : current);
    }
  }, [collectContext, location.pathname, location.search, pageKey, postBetaFeedback, updatePreference]);

  const restorePanel = useCallback(async (panel) => {
    const normalizedPanel = normalizePanel(panel);
    if (!normalizedPanel) return;

    const current = preferences[getPreferenceKey(pageKey, normalizedPanel.id)] || {};
    const optimistic = {
      ...current,
      pageKey,
      panelId: normalizedPanel.id,
      panelLabel: normalizedPanel.label,
      hidden: false,
    };
    updatePreference(optimistic);
    try {
      const data = await postBetaFeedback({
        intent: "set-panel-visibility",
        pageKey,
        pagePath: `${location.pathname}${location.search}`,
        panelId: normalizedPanel.id,
        panelLabel: normalizedPanel.label,
        hidden: false,
        context: collectContext(normalizedPanel),
      });
      updatePreference(data.preference);
    } catch (error) {
      console.error("[beta-feedback.restore]", error);
      updatePreference({ ...optimistic, hidden: true });
    }
  }, [collectContext, location.pathname, location.search, pageKey, postBetaFeedback, preferences, updatePreference]);

  const isPanelHidden = useCallback((panel) => {
    const normalizedPanel = normalizePanel(panel);
    if (!normalizedPanel) return false;
    return Boolean(preferences[getPreferenceKey(pageKey, normalizedPanel.id)]?.hidden);
  }, [pageKey, preferences]);

  const value = useMemo(() => ({
    enabled,
    config,
    pageKey,
    openFeedback,
    closeFeedback,
    requestPanelHide,
    restorePanel,
    isPanelHidden,
  }), [closeFeedback, config, enabled, isPanelHidden, openFeedback, pageKey, requestPanelHide, restorePanel]);

  if (!enabled) return <>{children}</>;

  return (
    <BetaFeedbackContext.Provider value={value}>
      {children}
      <BetaFeedbackGlobalLauncher onOpen={() => openFeedback(null)} />
      <BetaFeedbackHiddenPanelTray panels={hiddenPanels} onRestore={restorePanel} />
      {modal ? (
        <BetaFeedbackModal
          config={config}
          modal={modal}
          onChange={setModal}
          onClose={closeFeedback}
          onSubmit={submitFeedback}
        />
      ) : null}
      {hidePrompt ? (
        <BetaFeedbackHideModal
          state={hidePrompt}
          onChange={setHidePrompt}
          onClose={() => setHidePrompt(null)}
          onSubmit={submitHideReason}
        />
      ) : null}
    </BetaFeedbackContext.Provider>
  );
}

export function BetaFeedbackPanelControls({ panel, className = "", allowHide = true, showFeedback = true }) {
  const feedback = useContext(BetaFeedbackContext);
  const normalizedPanel = normalizePanel(panel);
  if (!feedback?.enabled || !normalizedPanel) return null;

  return (
    <span className={`ppBetaFeedbackPanelControls ${className}`.trim()} data-beta-feedback-panel-id={normalizedPanel.id}>
      {showFeedback ? (
        <button
          aria-label={`Beta feedback for ${normalizedPanel.label}`}
          className="ppBetaFeedbackPanelButton ppBetaFeedbackPanelButton-feedback"
          onClick={() => feedback.openFeedback(normalizedPanel)}
          title="Beta feedback"
          type="button"
        >
          <s-icon type="chat" size="small"></s-icon>
        </button>
      ) : null}
      {allowHide ? (
        <button
          aria-label={`Hide ${normalizedPanel.label}`}
          className="ppBetaFeedbackPanelButton ppBetaFeedbackPanelButton-hide"
          onClick={() => feedback.requestPanelHide(normalizedPanel)}
          title="Hide this panel"
          type="button"
        >
          <s-icon type="hide" size="small"></s-icon>
        </button>
      ) : null}
    </span>
  );
}

export function BetaFeedbackPanelFrame({ panel, children }) {
  const feedback = useContext(BetaFeedbackContext);
  const normalizedPanel = normalizePanel(panel);
  if (!feedback?.enabled || !normalizedPanel) return <>{children}</>;

  if (!feedback.isPanelHidden(normalizedPanel)) return <>{children}</>;

  return null;
}

function BetaFeedbackHiddenPanelTray({ panels = [], onRestore }) {
  if (!panels.length) return null;

  return (
    <div className="ppBetaFeedbackHiddenTray" aria-label="Hidden beta panels">
      {panels.map((panel) => (
        <button
          aria-label={`Restore ${panel.label}`}
          className="ppBetaFeedbackHiddenTrayButton"
          data-beta-feedback-panel-id={panel.id}
          key={`${panel.pageKey || "page"}-${panel.id}`}
          onClick={() => onRestore(panel)}
          type="button"
        >
          <s-icon type="view" size="small"></s-icon>
          <span className="ppBetaFeedbackHiddenTrayTooltip" role="tooltip">
            <strong>{panel.label}</strong>
            <small>Hidden panel. Click to restore it.</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function BetaFeedbackGlobalLauncher({ onOpen }) {
  return (
    <button
      aria-label="Open beta feedback"
      className="ppBetaFeedbackLauncher"
      onClick={onOpen}
      title="Beta feedback"
      type="button"
    >
      <s-icon type="bug" size="small"></s-icon>
      <span>Beta feedback</span>
    </button>
  );
}

function BetaFeedbackModal({ config, modal, onChange, onClose, onSubmit }) {
  const hasKnownEmail = Boolean(config?.user?.email);
  const submitting = modal.status === "submitting";
  const success = modal.status === "success";
  const title = modal.panel?.label ? `Beta feedback: ${modal.panel.label}` : "Beta feedback";

  const update = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const handleSubmit = (event) => {
    event.preventDefault();
    if (!modal.message.trim() || submitting || success) return;
    onSubmit(modal);
  };

  return (
    <div className="ppBetaFeedbackOverlay" role="presentation">
      <section className="ppBetaFeedbackModal" role="dialog" aria-modal="true" aria-labelledby="pp-beta-feedback-title">
        <div className="ppBetaFeedbackModalHeader">
          <span className="ppBetaFeedbackModalIcon" aria-hidden="true">
            <s-icon type="chat" size="small"></s-icon>
          </span>
          <div>
            <p>ProductPulse beta</p>
            <h2 id="pp-beta-feedback-title">{title}</h2>
          </div>
          <button className="ppBetaFeedbackClose" type="button" aria-label="Close beta feedback" onClick={onClose}>
            <s-icon type="close" size="small"></s-icon>
          </button>
        </div>

        {success ? (
          <div className="ppBetaFeedbackSuccess" role="status">
            <s-icon type="check" size="small"></s-icon>
            <strong>Feedback sent</strong>
            <p>Thanks. ProductPulse attached safe page context to help us improve the beta.</p>
          </div>
        ) : (
          <form className="ppBetaFeedbackForm" onSubmit={handleSubmit}>
            <p className="ppBetaFeedbackContextNote">
              Safe page context will be attached automatically. Secrets, cookies and payment details are not collected.
            </p>

            <label>
              <span>Category</span>
              <select value={modal.category} onChange={(event) => update({ category: event.target.value })}>
                {FEEDBACK_CATEGORIES.map((category) => (
                  <option value={category.value} key={category.value}>{category.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Importance</span>
              <select value={modal.severity} onChange={(event) => update({ severity: event.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>

            <label className="ppBetaFeedbackFullWidth">
              <span>Comment</span>
              <textarea
                maxLength={4000}
                onChange={(event) => update({ message: event.target.value })}
                placeholder="Tell us what happened, what is confusing, or what would make this panel more useful."
                required
                rows={5}
                value={modal.message}
              />
            </label>

            {!hasKnownEmail ? (
              <label className="ppBetaFeedbackFullWidth">
                <span>Email (optional)</span>
                <input
                  onChange={(event) => update({ email: event.target.value })}
                  placeholder="you@example.com"
                  type="email"
                  value={modal.email}
                />
              </label>
            ) : null}

            {modal.error ? <p className="ppBetaFeedbackError" role="alert">{modal.error}</p> : null}

            <div className="ppBetaFeedbackFooter">
              <button className="ppSecondaryButton" type="button" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className="ppPrimaryButton" type="submit" disabled={submitting || !modal.message.trim()}>
                {submitting ? "Sending..." : "Send feedback"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function BetaFeedbackHideModal({ state, onChange, onClose, onSubmit }) {
  const submitting = state.status === "submitting";
  const update = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const handleSubmit = (event) => {
    event.preventDefault();
    if (submitting) return;
    onSubmit(state);
  };

  return (
    <div className="ppBetaFeedbackOverlay" role="presentation">
      <section className="ppBetaFeedbackModal ppBetaFeedbackHideModal" role="dialog" aria-modal="true" aria-labelledby="pp-beta-hide-title">
        <div className="ppBetaFeedbackModalHeader">
          <span className="ppBetaFeedbackModalIcon" aria-hidden="true">
            <s-icon type="hide" size="small"></s-icon>
          </span>
          <div>
            <p>Panel visibility</p>
            <h2 id="pp-beta-hide-title">Hide {state.panel?.label || "this panel"}?</h2>
          </div>
          <button className="ppBetaFeedbackClose" type="button" aria-label="Close hide panel feedback" onClick={onClose}>
            <s-icon type="close" size="small"></s-icon>
          </button>
        </div>

        <form className="ppBetaFeedbackForm ppBetaFeedbackHideForm" onSubmit={handleSubmit}>
          <p className="ppBetaFeedbackContextNote">
            This helps us understand which beta panels are not useful, unclear, wrong, or taking too much space. You can skip the question.
          </p>
          <fieldset>
            <legend>Why do you want to hide it?</legend>
            <div className="ppBetaFeedbackReasonGrid">
              {HIDE_REASONS.map((reason) => (
                <label key={reason.value}>
                  <input
                    checked={state.reason === reason.value}
                    name="hideReason"
                    onChange={() => update({ reason: reason.value })}
                    type="radio"
                    value={reason.value}
                  />
                  <span>{reason.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {state.reason === "other" ? (
            <label className="ppBetaFeedbackFullWidth">
              <span>Tell us why</span>
              <textarea
                maxLength={4000}
                onChange={(event) => update({ reasonMessage: event.target.value })}
                placeholder="Add any detail that would help us improve or remove this panel."
                rows={3}
                value={state.reasonMessage}
              />
            </label>
          ) : null}

          {state.error ? <p className="ppBetaFeedbackError" role="alert">{state.error}</p> : null}

          <div className="ppBetaFeedbackFooter">
            <button className="ppSecondaryButton" type="button" onClick={onClose} disabled={submitting}>Cancel</button>
            <button className="ppPrimaryButton" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : state.reason === "skipped" ? "Hide without feedback" : "Hide panel"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function getAutomaticClientContext({ config, location, pageKey, recentClientErrors }) {
  const searchParams = new URLSearchParams(location.search || "");
  const routeEntity = getRouteEntityContext(location.pathname);
  return {
    timestamp: new Date().toISOString(),
    currentUrl: typeof window === "undefined" ? "" : window.location.href,
    route: {
      path: `${location.pathname}${location.search || ""}`,
      pathname: location.pathname,
      search: location.search || "",
      pageKey,
    },
    entity: routeEntity || undefined,
    product: routeEntity?.type === "product" ? {
      routeParam: routeEntity.routeParam,
      handle: routeEntity.handle || "",
      productGid: routeEntity.productGid || "",
    } : undefined,
    watchlist: routeEntity?.type === "watchlistProduct" ? {
      productRef: routeEntity.routeParam,
    } : undefined,
    filters: getSafeFilters(searchParams),
    shop: {
      domain: config?.shop || "",
    },
    user: {
      knownEmail: Boolean(config?.user?.email),
      id: config?.user?.id || "",
    },
    app: {
      environment: config?.environment || "",
      version: config?.appVersion || "",
    },
    viewport: getViewportContext(),
    browser: getBrowserContext(),
    recentClientErrors,
  };
}

function getRouteEntityContext(pathname = "") {
  const segments = String(pathname || "").split("/").filter(Boolean).map(safeDecodePathSegment);
  if (segments[0] !== "app") return null;

  if (segments[1] === "products" && segments[2]) {
    const routeParam = segments[2];
    return {
      type: "product",
      routeParam,
      handle: routeParam.startsWith("gid://") ? "" : routeParam,
      productGid: routeParam.startsWith("gid://") ? routeParam : "",
      subpage: segments[3] || "detail",
    };
  }

  if (segments[1] === "watchlist" && segments[2]) {
    return {
      type: "watchlistProduct",
      routeParam: segments[2],
      subpage: segments[3] || "detail",
    };
  }

  return null;
}

function safeDecodePathSegment(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function getSafeFilters(searchParams) {
  const filters = {};
  [
    "q", "risk", "status", "issue", "source", "vendor", "collection", "sort", "direction", "tab", "runId", "window", "page", "rows",
    "candidateQ", "candidateRisk", "candidateStatus", "candidateIssue", "candidateVendor", "candidateCollection", "candidateSort", "candidateDirection", "candidatePage", "candidateRows",
    "resolvedQ", "resolvedRisk", "resolvedStatus", "resolvedIssue", "resolvedVendor", "resolvedCollection", "resolvedSort", "resolvedDirection", "resolvedPage", "resolvedRows",
  ].forEach((key) => {
    const value = searchParams.get(key);
    if (value) filters[key] = value.slice(0, 180);
  });
  return filters;
}

function getViewportContext() {
  if (typeof window === "undefined") return {};
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function getBrowserContext() {
  if (typeof window === "undefined" || !window.navigator) return {};
  return {
    userAgent: window.navigator.userAgent,
    language: window.navigator.language,
  };
}

function normalizePanel(panel) {
  if (!panel || typeof panel !== "object") return null;
  const id = String(panel.id || panel.panelId || "").trim();
  if (!id) return null;
  return {
    ...panel,
    id,
    label: String(panel.label || panel.title || id).trim(),
  };
}

function getHiddenPanelPreferences(preferences = {}, pageKey = "") {
  return Object.values(preferences)
    .filter((preference) => preference?.hidden && (!pageKey || preference.pageKey === pageKey))
    .map((preference) => normalizePanel({
      id: preference.panelId,
      label: preference.panelLabel || preference.panelId,
      pageKey: preference.pageKey,
    }))
    .filter(Boolean)
    .sort((first, second) => String(first.label).localeCompare(String(second.label)));
}

function normalizePageKey(pathname) {
  const value = String(pathname || "").trim();
  return value || "unknown";
}

function getPreferenceKey(pageKey, panelId) {
  return `${pageKey || "unknown"}::${panelId || ""}`;
}
