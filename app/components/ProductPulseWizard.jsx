import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";

const WIZARD_STORAGE_KEY = "productPulse.onboardingWizard.completed.v1";
const DASHBOARD_ROUTE = "/app/dashboard";
const CONNECT_ROUTE = "/app/connect";
const SETTINGS_ROUTE = "/app/settings";
const PRODUCTS_CANDIDATES_ROUTE = "/app/products?tab=candidates";
const emptyWizardTargets = [];

const connectTargets = [
  { id: "chatmeRow", selector: '[data-pp-connect-source-row="chatmeReviews"]' },
  { id: "chatmeAction", selector: '[data-pp-connect-source-action="chatmeReviews"]' },
  { id: "csvRow", selector: '[data-pp-connect-source-row="csvReviews"]' },
  { id: "csvAction", selector: '[data-pp-connect-source-action="csvReviews"]' },
];

const settingsTargets = [
  {
    id: "settingsCards",
    selector: [
      '[data-pp-settings-target="risk-thresholds"]',
      '[data-pp-settings-target="momentum-inclusion"]',
      '[data-pp-settings-target="evidence-lookback"]',
    ].join(", "),
    all: true,
  },
];

const productQuickScanTargets = [
  { id: "quickScan", selector: '[data-pp-products-quick-scan]' },
];

const productCandidateTargets = [
  { id: "candidateRows", selector: '[data-pp-products-candidate-row]', all: true },
  {
    id: "deepScanAction",
    selector: '[data-pp-products-run-deep-scan-selected], [data-pp-products-candidate-run-deep-scan]',
  },
];

const wizardSteps = [
  { id: "welcome", kind: "welcome", route: DASHBOARD_ROUTE },
  { id: "connectReviews", kind: "connect", route: CONNECT_ROUTE, targets: connectTargets },
  { id: "settings", kind: "settings", route: SETTINGS_ROUTE, targets: settingsTargets },
  { id: "products", kind: "products", route: PRODUCTS_CANDIDATES_ROUTE },
];

const csvProviderBadges = [
  { label: "Judge.me", domain: "judge.me" },
  { label: "ChatMe", domain: "chatme.ai" },
  { label: "Yotpo", domain: "yotpo.com" },
  { label: "Loox", domain: "loox.io" },
  { label: "Okendo", domain: "okendo.io" },
  { label: "Stamped", domain: "stamped.io" },
];

const modalCopy = {
  chatme: {
    eyebrow: "ChatMe connection",
    title: "Add your ChatMe credentials",
    body: "Paste the private API token from ChatMe. ProductPulse uses it to read review and Q&A signals for QuickScan and deep product diagnostics.",
  },
  csv: {
    eyebrow: "CSV upload",
    title: "Import review data",
    body: "Choose a review CSV with product identifiers and ratings. This is the fallback for ChatMe, Judge.me, Yotpo, Loox or any provider that can export reviews.",
  },
  csvPreview: {
    eyebrow: "CSV preview",
    title: "Confirm the detected columns",
    body: "Review the detected mapping and sample rows. Saving the preview stores normalized review evidence for future scans.",
  },
  quickScanCsv: {
    eyebrow: "QuickScan data",
    title: "CSV is optional for QuickScan",
    body: "You can run QuickScan without uploaded reviews. If you already have a CSV, adding it first makes preliminary risk signals stronger.",
  },
  quickScanConfirm: {
    eyebrow: "QuickScan confirmation",
    title: "Start the catalog scan",
    body: "This queues a lightweight scan that finds candidate products. When candidates appear, select one and start a deep scan.",
  },
  deepScanConfirm: {
    eyebrow: "Deep scan confirmation",
    title: "Queue the selected product",
    body: "Confirm the analysis to generate product-level evidence, risk, and recommended actions for the selected candidate.",
  },
};

export function ProductPulseWizard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [connectCompletion, setConnectCompletion] = useState(null);
  const [quickScanStarted, setQuickScanStarted] = useState(false);
  const step = wizardSteps[stepIndex] || wizardSteps[0];
  const productsState = useProductsWizardState(active && step.kind === "products");
  const openModal = useOpenWizardModal(active);
  const targets = useMemo(
    () => getWizardTargets(step, productsState.hasCandidates),
    [productsState.hasCandidates, step],
  );
  const targetRects = useWizardSpotlightTargets(targets, active && step.kind !== "welcome");
  const nextDisabled = step.kind === "products" && !productsState.hasCandidates;
  const labels = getWizardControlLabels(step, productsState);

  useEffect(() => {
    setHydrated(true);
    if (!hasWizardCompleted()) {
      setActive(true);
      setStepIndex(0);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("ppWizardActive", active);
    return () => document.body.classList.remove("ppWizardActive");
  }, [active]);

  useEffect(() => {
    if (!active || !step.route || isCurrentWizardRoute(location.pathname, location.search, step)) return;
    navigate(step.route);
  }, [active, location.pathname, location.search, navigate, step]);

  useEffect(() => {
    if (!active || !step.targets?.length) return undefined;
    const timeout = window.setTimeout(() => {
      const selector = step.kind === "connect"
        ? '[data-pp-connect-source-row="chatmeReviews"]'
        : step.kind === "settings"
          ? '[data-pp-settings-target="risk-thresholds"]'
          : "";
      if (selector) document.querySelector(selector)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [active, step]);

  useEffect(() => {
    if (!active || step.kind !== "products") return undefined;
    const timeout = window.setTimeout(() => {
      const selector = productsState.hasCandidates
        ? '[data-pp-products-candidate-row]'
        : '[data-pp-products-quick-scan]';
      document.querySelector(selector)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [active, productsState.hasCandidates, step.kind]);

  useEffect(() => {
    if (!active) return undefined;
    const handleWizardEvent = (event) => {
      const detail = event.detail || {};
      if (detail.type === "connect-provider-saved") {
        setConnectCompletion({
          provider: detail.provider,
          message: getConnectCompletionMessage(detail.provider),
        });
      }
      if (detail.type === "quick-scan-started") {
        setQuickScanStarted(true);
      }
      if (detail.type === "deep-scan-started") {
        setQuickScanStarted(false);
      }
    };

    window.addEventListener("productpulse:wizard", handleWizardEvent);
    return () => window.removeEventListener("productpulse:wizard", handleWizardEvent);
  }, [active]);

  const completeWizard = useCallback(() => {
    markWizardCompleted();
    setActive(false);
  }, []);

  const handleNext = useCallback(() => {
    if (nextDisabled) return;
    if (stepIndex >= wizardSteps.length - 1) {
      completeWizard();
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    const nextStep = wizardSteps[nextIndex];
    if (nextStep?.route) navigate(nextStep.route);
  }, [completeWizard, navigate, nextDisabled, stepIndex]);

  const handleBack = useCallback(() => {
    if (stepIndex <= 0) return;
    const previousIndex = stepIndex - 1;
    setStepIndex(previousIndex);
    const previousStep = wizardSteps[previousIndex];
    if (previousStep?.route) navigate(previousStep.route);
  }, [navigate, stepIndex]);

  if (!hydrated || !active) return null;

  return createPortal(
    <div className={`ppWizardRoot ppWizardRoot-${step.kind}`} aria-live="polite">
      <div className="ppWizardBlurLayer" aria-hidden="true" />
      {step.kind === "welcome" ? <WelcomeWizardStep /> : null}
      {step.kind === "connect" ? (
        <ConnectWizardStep
          targetRects={targetRects}
          openModal={openModal}
          completion={connectCompletion}
        />
      ) : null}
      {step.kind === "settings" ? (
        <SettingsWizardStep targetRects={targetRects} />
      ) : null}
      {step.kind === "products" ? (
        <ProductsWizardStep
          targetRects={targetRects}
          productsState={productsState}
          quickScanStarted={quickScanStarted}
          openModal={openModal}
        />
      ) : null}
      {openModal ? <WizardModalCoach modal={openModal} /> : null}
      <WizardControlBar
        backLabel={labels.back}
        nextLabel={labels.next}
        canGoBack={stepIndex > 0}
        nextDisabled={nextDisabled}
        onBack={handleBack}
        onNext={handleNext}
        onSkip={completeWizard}
      />
    </div>,
    document.body,
  );
}

function WelcomeWizardStep() {
  return (
    <section className="ppWizardWelcomeModal" role="dialog" aria-modal="true" aria-labelledby="pp-wizard-welcome-title">
      <div className="ppWizardWelcomeIcon" aria-hidden="true">
        <span />
      </div>
      <p className="ppWizardEyebrow">ProductPulse AI setup</p>
      <h2 id="pp-wizard-welcome-title">Welcome to your product signal workspace</h2>
      <p>
        ProductPulse connects reviews, returns, support context and Shopify product data so you can
        find product issues faster and decide what to fix next with stronger evidence.
      </p>
      <p>
        This quick guide will show you where to connect review data, tune scan thresholds, run
        QuickScan, and start a deep product scan from Candidates.
      </p>
      <div className="ppWizardProgress" aria-label="Wizard progress">
        <span className="isActive" />
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function ConnectWizardStep({ targetRects, openModal, completion }) {
  if (openModal) return null;
  const chatAnchor = targetRects.chatmeAction || targetRects.chatmeRow;
  const csvAnchor = targetRects.csvAction || targetRects.csvRow;

  if (!chatAnchor || !csvAnchor) {
    return <WizardLoadingCard title="Opening Connect" body="We are locating the ChatMe and CSV review source rows." />;
  }

  return (
    <>
      <WizardTooltip
        anchorRect={chatAnchor}
        className="ppWizardTooltip-chatme"
        title="Connect ChatMe Reviews"
        eyebrow="Direct connector"
      >
        <p>
          Click <strong>Manage</strong> on ChatMe Reviews to connect your account with a private API
          token. You can open and close this setup without ending the wizard.
        </p>
      </WizardTooltip>

      <WizardTooltip
        anchorRect={csvAnchor}
        className="ppWizardTooltip-csv"
        title="Upload reviews by CSV"
        eyebrow="Works with any provider"
        offsetY={36}
      >
        <p>
          Use CSV Upload when you prefer not to connect a provider directly, or when your review
          platform is not available as a connector. Export your review file and upload it here.
        </p>
        <div className="ppWizardProviderBadges" aria-label="Supported CSV provider examples">
          {csvProviderBadges.map((provider) => (
            <span key={provider.label}>
              <img
                src={`https://www.google.com/s2/favicons?domain=${provider.domain}&sz=32`}
                alt=""
                aria-hidden="true"
              />
              {provider.label}
            </span>
          ))}
        </div>
      </WizardTooltip>

      {completion ? (
        <div className="ppWizardSuccessToast" role="status">
          <strong>OK</strong>
          <span>{completion.message}</span>
        </div>
      ) : null}
    </>
  );
}

function SettingsWizardStep({ targetRects }) {
  const anchor = targetRects.settingsCards;
  if (!anchor) {
    return <WizardLoadingCard title="Opening Settings" body="We are locating the three scan configuration controls." />;
  }

  return (
    <WizardTooltip
      anchorRect={anchor}
      className="ppWizardTooltip-settings"
      title="Tune your scan rules"
      eyebrow="Settings"
      offsetY={-16}
    >
      <p>
        Review Product risk thresholds, Product Momentum inclusion, and Evidence lookback. These
        decide which products enter Candidates and how much historical evidence ProductPulse reads.
      </p>
      <p>
        You can save changes or leave the defaults. When you are ready, use the fixed bar below to
        continue to Products.
      </p>
    </WizardTooltip>
  );
}

function ProductsWizardStep({ targetRects, productsState, quickScanStarted, openModal }) {
  if (openModal) return null;

  if (!productsState.hasCandidates) {
    const anchor = targetRects.quickScan;
    if (!anchor) {
      return <WizardLoadingCard title="Opening Products" body="We are locating the Candidates tab and QuickScan button." />;
    }

    return (
      <WizardTooltip
        anchorRect={anchor}
        className="ppWizardTooltip-products"
        title={quickScanStarted ? "QuickScan is running" : "Run QuickScan"}
        eyebrow="Products"
      >
        <p>
          {quickScanStarted
            ? "ProductPulse is scanning the catalog. Keep the wizard open; when candidate products appear, this step will move to the deep scan action."
            : "Click Run quick scan to create lightweight product-risk candidates from your catalog. The wizard stays open while confirmation modals appear."}
        </p>
      </WizardTooltip>
    );
  }

  const anchor = targetRects.deepScanAction || targetRects.candidateRows;
  if (!anchor) {
    return <WizardLoadingCard title="Candidates ready" body="We are locating the candidate rows and deep scan action." />;
  }

  return (
    <WizardTooltip
      anchorRect={anchor}
      className="ppWizardTooltip-products"
      title="Select a candidate and run Deep Scan"
      eyebrow="Candidates"
    >
      <p>
        Candidate products are QuickScan results that still need full AI diagnosis. Select one row,
        then use the action button to queue a deep scan for that product.
      </p>
    </WizardTooltip>
  );
}

function WizardModalCoach({ modal }) {
  const copy = modalCopy[modal.kind];
  if (!copy || !modal.rect) return null;
  const placement = getTooltipPlacement(modal.rect, 0, 340);

  return (
    <aside
      className={`ppWizardModalCoach ${placement.side === "right" ? "isRight" : "isBottom"}`.trim()}
      style={placement.style}
      role="status"
    >
      <span className="ppWizardTooltipArrow" style={placement.arrowStyle} aria-hidden="true" />
      <p className="ppWizardTooltipEyebrow">{copy.eyebrow}</p>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
    </aside>
  );
}

function WizardTooltip({ anchorRect, className = "", title, eyebrow, children, offsetY = 0 }) {
  const placement = getTooltipPlacement(anchorRect, offsetY);

  return (
    <aside
      className={`ppWizardTooltip ${placement.side === "right" ? "isRight" : "isBottom"} ${className}`.trim()}
      style={placement.style}
      role="dialog"
      aria-label={title}
    >
      <span className="ppWizardTooltipArrow" style={placement.arrowStyle} aria-hidden="true" />
      <p className="ppWizardTooltipEyebrow">{eyebrow}</p>
      <h3>{title}</h3>
      {children}
    </aside>
  );
}

function WizardControlBar({
  backLabel,
  nextLabel,
  canGoBack,
  nextDisabled,
  onBack,
  onNext,
  onSkip,
}) {
  return (
    <footer className="ppWizardControlBar" role="group" aria-label="Wizard controls">
      <div className="ppWizardControlBarInner">
        <button className="ppWizardBackButton" type="button" onClick={onBack} disabled={!canGoBack}>
          <s-icon type="chevron-left" size="small"></s-icon>
          {backLabel}
        </button>
        <button className="ppWizardSkipButton" type="button" onClick={onSkip}>
          Skip tour
        </button>
        <button className="ppWizardNextButton" type="button" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
          <s-icon type="chevron-right" size="small"></s-icon>
        </button>
      </div>
    </footer>
  );
}

function WizardLoadingCard({ title, body }) {
  return (
    <section className="ppWizardLoadingCard" role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function useWizardSpotlightTargets(targets, enabled) {
  const [rects, setRects] = useState({});
  const rafRef = useRef(null);
  const targetsKey = useMemo(
    () => targets.map((target) => `${target.id}:${target.selector}:${target.all ? "all" : "one"}`).join("|"),
    [targets],
  );

  const measure = useCallback(() => {
    const nextRects = {};
    document.querySelectorAll(".ppWizardSpotlightTarget").forEach((element) => {
      element.classList.remove("ppWizardSpotlightTarget");
    });

    targets.forEach((target) => {
      const elements = target.all
        ? Array.from(document.querySelectorAll(target.selector))
        : [document.querySelector(target.selector)].filter(Boolean);
      const visibleElements = elements.filter((element) => getComputedStyle(element).display !== "none");
      if (!visibleElements.length) return;

      visibleElements.forEach((element) => element.classList.add("ppWizardSpotlightTarget"));
      nextRects[target.id] = getUnionRect(visibleElements);
    });

    setRects(nextRects);
  }, [targets]);

  useEffect(() => {
    if (!enabled) {
      document.querySelectorAll(".ppWizardSpotlightTarget").forEach((element) => {
        element.classList.remove("ppWizardSpotlightTarget");
      });
      setRects((current) => (Object.keys(current).length ? {} : current));
      return undefined;
    }

    const scheduleMeasure = () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      document.querySelectorAll(".ppWizardSpotlightTarget").forEach((element) => {
        element.classList.remove("ppWizardSpotlightTarget");
      });
    };
  }, [enabled, measure, targetsKey]);

  return rects;
}

function useProductsWizardState(enabled) {
  const [state, setState] = useState({ hasCandidates: false, selectedCandidates: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ hasCandidates: false, selectedCandidates: 0 });
      return undefined;
    }

    const readState = () => {
      const candidateRows = Array.from(document.querySelectorAll("[data-pp-products-candidate-row]"));
      const selectedCandidates = candidateRows.filter((row) => row.querySelector('input[type="checkbox"]')?.checked).length;
      setState((current) => {
        const next = { hasCandidates: candidateRows.length > 0, selectedCandidates };
        return current.hasCandidates === next.hasCandidates && current.selectedCandidates === next.selectedCandidates
          ? current
          : next;
      });
    };

    readState();
    const observer = new MutationObserver(readState);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", readState, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", readState, true);
    };
  }, [enabled]);

  return state;
}

function useOpenWizardModal(enabled) {
  const [modal, setModal] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setModal(null);
      return undefined;
    }

    const readModal = () => {
      const nextModal = getOpenWizardModal();
      setModal((current) => (
        current?.kind === nextModal?.kind
        && Math.round(current?.rect?.top || 0) === Math.round(nextModal?.rect?.top || 0)
        && Math.round(current?.rect?.left || 0) === Math.round(nextModal?.rect?.left || 0)
          ? current
          : nextModal
      ));
    };

    readModal();
    const observer = new MutationObserver(readModal);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", readModal);
    window.addEventListener("scroll", readModal, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", readModal);
      window.removeEventListener("scroll", readModal, true);
    };
  }, [enabled]);

  return modal;
}

function getOpenWizardModal() {
  const candidates = [
    { kind: "chatme", selector: "#chatme-connect-title" },
    { kind: "csv", selector: "#csv-upload-title" },
    { kind: "csvPreview", selector: "#csv-preview-title" },
    { kind: "quickScanCsv", selector: "#quick-scan-csv-title" },
    { kind: "quickScanConfirm", selector: "#quick-scan-confirm-title" },
    { kind: "deepScanConfirm", selector: "#analysis-confirm-title" },
  ];
  const match = candidates.find((candidate) => document.querySelector(candidate.selector));
  if (!match) return null;
  const heading = document.querySelector(match.selector);
  const modal = heading?.closest?.("section");
  if (!modal) return null;
  return { kind: match.kind, rect: getElementRect(modal) };
}

function getWizardTargets(step, hasCandidates) {
  if (step.kind === "products") {
    return hasCandidates ? productCandidateTargets : productQuickScanTargets;
  }
  return step.targets || emptyWizardTargets;
}

function getWizardControlLabels(step, productsState) {
  if (step.kind === "products") {
    return {
      back: "Back",
      next: productsState.hasCandidates ? "Finish" : "Waiting for candidates",
    };
  }
  return {
    back: "Back",
    next: step.kind === "welcome" ? "Next" : "Next",
  };
}

function getConnectCompletionMessage(provider) {
  if (provider === "chatmeReviews") return "ChatMe was connected. When you are ready, click Next to configure Settings.";
  if (provider === "csvReviews") return "CSV reviews were saved. When you are ready, click Next to configure Settings.";
  return "Source saved. When you are ready, click Next to configure Settings.";
}

function getUnionRect(elements) {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const left = Math.min(...rects.map((rect) => rect.left));
  return {
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
  };
}

function getElementRect(element) {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function getTooltipPlacement(anchorRect, offsetY = 0, preferredWidth = 360) {
  if (typeof window === "undefined") return { style: {}, arrowStyle: {}, side: "right" };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const bottomBarHeight = 78;
  const tooltipWidth = Math.min(preferredWidth, viewportWidth - 32);
  const estimatedHeight = 204;
  const gap = 18;
  const centerY = anchorRect.top + (anchorRect.height || 34) / 2;
  const canUseRight = viewportWidth - anchorRect.right >= tooltipWidth + gap + 16;
  const maxTop = viewportHeight - bottomBarHeight - estimatedHeight - 16;

  if (canUseRight) {
    const top = clamp(centerY - estimatedHeight / 2 + offsetY, 16, maxTop);
    return {
      side: "right",
      style: {
        width: `${tooltipWidth}px`,
        left: `${anchorRect.right + gap}px`,
        top: `${top}px`,
      },
      arrowStyle: {
        top: `${clamp(centerY - top, 22, estimatedHeight - 22)}px`,
      },
    };
  }

  const left = clamp(anchorRect.left, 16, viewportWidth - tooltipWidth - 16);
  const preferredTop = anchorRect.bottom + 14 + offsetY;
  const top = preferredTop + estimatedHeight < viewportHeight - bottomBarHeight
    ? preferredTop
    : clamp(anchorRect.top - estimatedHeight - 14, 16, maxTop);

  return {
    side: "bottom",
    style: {
      width: `${tooltipWidth}px`,
      left: `${left}px`,
      top: `${top}px`,
    },
    arrowStyle: {
      left: `${clamp(anchorRect.left + Math.min(anchorRect.width || 40, 70) / 2 - left, 24, tooltipWidth - 24)}px`,
    },
  };
}

function isCurrentWizardRoute(pathname, search, step) {
  if (step.kind === "welcome") return isDashboardRoute(pathname);
  if (step.kind === "products") {
    return pathname.startsWith("/app/products") && new URLSearchParams(search).get("tab") === "candidates";
  }
  return step.route && pathname.startsWith(step.route);
}

function isDashboardRoute(pathname) {
  return pathname === "/app" || pathname === "/app/" || pathname.startsWith(DASHBOARD_ROUTE);
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function hasWizardCompleted() {
  try {
    return window.localStorage.getItem(WIZARD_STORAGE_KEY) === "true";
  } catch {
    return true;
  }
}

function markWizardCompleted() {
  try {
    window.localStorage.setItem(WIZARD_STORAGE_KEY, "true");
  } catch {
    // Ignore storage failures; the visible wizard can still be dismissed for this session.
  }
}
