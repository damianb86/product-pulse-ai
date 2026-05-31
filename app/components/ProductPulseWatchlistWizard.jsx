import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";

const WATCHLIST_WIZARD_STORAGE_KEY = "productPulse.watchlistWizard.completed.v1";
const WATCHLIST_ROUTE = "/app/watchlist";
const emptyTargets = [];

const addButtonTargets = [
  { id: "addButton", selector: '[data-pp-watchlist-add-button="header"]' },
];

const addModalTargets = [
  { id: "addModal", selector: '[data-pp-watchlist-add-modal="true"]' },
  { id: "addModalInput", selector: "[data-pp-shopify-product-search-input]" },
];

const tableTargets = [
  { id: "watchlistTable", selector: "[data-pp-watchlist-table]" },
];

const settingsTargets = [
  { id: "settingsPanel", selector: "[data-pp-watchlist-settings-panel]" },
  { id: "runScanButton", selector: "[data-pp-watchlist-run-scan]" },
];

const reportTargets = [
  { id: "reportRow", selector: '[data-pp-watchlist-ready-row="true"]' },
  { id: "viewReportButton", selector: '[data-pp-watchlist-view-report="true"]' },
];

const productHeroTargets = [
  {
    id: "productSummary",
    selector: "[data-pp-watchlist-product-hero], [data-pp-watchlist-product-insight]",
    all: true,
  },
];

const recentRunsTargets = [
  { id: "recentRuns", selector: "[data-pp-watchlist-recent-runs]" },
];

const watchlistWizardSteps = [
  { id: "addProduct", kind: "addProduct", route: WATCHLIST_ROUTE },
  { id: "table", kind: "table", route: WATCHLIST_ROUTE, targets: tableTargets },
  { id: "settings", kind: "settings", route: WATCHLIST_ROUTE, targets: settingsTargets },
  { id: "reportRow", kind: "reportRow", route: WATCHLIST_ROUTE, targets: reportTargets },
  { id: "productHero", kind: "productHero", targets: productHeroTargets },
  { id: "recentRuns", kind: "recentRuns", targets: recentRunsTargets },
];

export function ProductPulseWatchlistWizard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [productAdded, setProductAdded] = useState(false);
  const [scanStarted, setScanStarted] = useState(false);
  const [reportedProduct, setReportedProduct] = useState(null);
  const step = watchlistWizardSteps[stepIndex] || watchlistWizardSteps[0];
  const addModalOpen = useSelectorPresent('[data-pp-watchlist-add-modal="true"]', active && step.kind === "addProduct");
  const reportReady = useSelectorPresent('[data-pp-watchlist-ready-row="true"] [data-pp-watchlist-view-report="true"]', active);
  const targets = useMemo(
    () => getWatchlistWizardTargets(step, addModalOpen),
    [addModalOpen, step],
  );
  const targetRects = useWatchlistWizardTargets(targets, active);
  const nextDisabled = getWatchlistWizardNextDisabled(step, { productAdded, scanStarted, reportReady });
  const labels = getWatchlistWizardControlLabels(step, { productAdded, scanStarted, reportReady });

  const completeWizard = useCallback(() => {
    markWatchlistWizardCompleted();
    setActive(false);
  }, []);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || active || hasWatchlistWizardCompleted()) return;
    if (!isWatchlistIndexRoute(location.pathname)) return;
    if (document.body.classList.contains("ppWizardActive")) return;
    setProductAdded(false);
    setScanStarted(false);
    setReportedProduct(null);
    setStepIndex(0);
    setActive(true);
  }, [active, hydrated, location.pathname]);

  useEffect(() => {
    if (!active) return;
    if (!location.pathname.startsWith(WATCHLIST_ROUTE)) {
      setActive(false);
    }
  }, [active, location.pathname]);

  useEffect(() => {
    document.body.classList.toggle("ppWatchlistWizardActive", active);
    document.body.classList.toggle("ppWatchlistWizardAddProductActive", active && step.kind === "addProduct");
    document.body.classList.toggle("ppWatchlistWizardTableActive", active && step.kind === "table");
    document.body.classList.toggle("ppWatchlistWizardSettingsActive", active && step.kind === "settings");
    document.body.classList.toggle("ppWatchlistWizardReportActive", active && step.kind === "reportRow");
    document.body.classList.toggle("ppWatchlistWizardProductHeroActive", active && step.kind === "productHero");
    document.body.classList.toggle("ppWatchlistWizardRecentRunsActive", active && step.kind === "recentRuns");
    return () => {
      document.body.classList.remove("ppWatchlistWizardActive");
      document.body.classList.remove("ppWatchlistWizardAddProductActive");
      document.body.classList.remove("ppWatchlistWizardTableActive");
      document.body.classList.remove("ppWatchlistWizardSettingsActive");
      document.body.classList.remove("ppWatchlistWizardReportActive");
      document.body.classList.remove("ppWatchlistWizardProductHeroActive");
      document.body.classList.remove("ppWatchlistWizardRecentRunsActive");
    };
  }, [active, step.kind]);

  useEffect(() => {
    if (!active || !step.route || isCurrentWatchlistWizardRoute(location.pathname, step)) return;
    navigate(step.route);
  }, [active, location.pathname, navigate, step]);

  useEffect(() => {
    if (!active) return undefined;
    const selector = getWatchlistWizardScrollSelector(step, addModalOpen);
    if (!selector) return undefined;
    const timeout = window.setTimeout(() => {
      document.querySelector(selector)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [active, addModalOpen, step]);

  useEffect(() => {
    if (!active || step.kind !== "settings" || !scanStarted || !reportReady) return undefined;
    const timeout = window.setTimeout(() => {
      const reportStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "reportRow");
      if (reportStepIndex >= 0) setStepIndex(reportStepIndex);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [active, reportReady, scanStarted, step.kind]);

  useEffect(() => {
    if (!active || step.kind !== "reportRow" || !isWatchlistProductRoute(location.pathname)) return;
    const productStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "productHero");
    if (productStepIndex >= 0) setStepIndex(productStepIndex);
  }, [active, location.pathname, step.kind]);

  useEffect(() => {
    if (!active) return undefined;
    const handleWatchlistWizardEvent = (event) => {
      const detail = event.detail || {};
      if (detail.type === "product-added") {
        setProductAdded(true);
        const tableStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "table");
        if (tableStepIndex >= 0) setStepIndex(tableStepIndex);
      }
      if (detail.type === "scan-started") {
        setScanStarted(true);
      }
      if (detail.type === "report-ready") {
        setReportedProduct({
          title: detail.productTitle || "",
          href: detail.productHref || "",
        });
      }
      if (detail.type === "report-opened") {
        setReportedProduct({
          title: detail.productTitle || "",
          href: detail.href || "",
        });
        const productStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "productHero");
        if (productStepIndex >= 0) setStepIndex(productStepIndex);
        if (detail.href && !location.pathname.startsWith(detail.href)) navigate(detail.href);
      }
    };

    window.addEventListener("productpulse:watchlist-wizard", handleWatchlistWizardEvent);
    return () => window.removeEventListener("productpulse:watchlist-wizard", handleWatchlistWizardEvent);
  }, [active, location.pathname, navigate]);

  const advanceWizard = useCallback((options = {}) => {
    if (!options.ignoreDisabled && nextDisabled) return;
    if (stepIndex >= watchlistWizardSteps.length - 1) {
      completeWizard();
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    const nextStep = watchlistWizardSteps[nextIndex];
    if (nextStep?.route) navigate(nextStep.route);
  }, [completeWizard, navigate, nextDisabled, stepIndex]);

  const handleNext = useCallback(() => {
    advanceWizard();
  }, [advanceWizard]);

  const handleSkipStep = useCallback(() => {
    advanceWizard({ ignoreDisabled: true });
  }, [advanceWizard]);

  const handleBack = useCallback(() => {
    if (stepIndex <= 0) return;
    const previousIndex = stepIndex - 1;
    setStepIndex(previousIndex);
    const previousStep = watchlistWizardSteps[previousIndex];
    if (previousStep?.route) navigate(previousStep.route);
  }, [navigate, stepIndex]);

  if (!hydrated || !active) return null;

  return createPortal(
    <>
      <div className="ppWizardBackdropRoot ppWatchlistWizardBackdropRoot" aria-hidden="true">
        <div className="ppWizardBlurLayer" />
      </div>
      <div className={`ppWizardRoot ppWatchlistWizardRoot ppWatchlistWizardRoot-${step.kind}`} aria-live="polite">
        {step.kind === "addProduct" ? (
          <WatchlistAddProductStep targetRects={targetRects} modalOpen={addModalOpen} />
        ) : null}
        {step.kind === "table" ? (
          <WatchlistTableStep targetRects={targetRects} />
        ) : null}
        {step.kind === "settings" ? (
          <WatchlistSettingsStep targetRects={targetRects} scanStarted={scanStarted} reportReady={reportReady} />
        ) : null}
        {step.kind === "reportRow" ? (
          <WatchlistReportRowStep targetRects={targetRects} reportedProduct={reportedProduct} />
        ) : null}
        {step.kind === "productHero" ? (
          <WatchlistProductHeroStep targetRects={targetRects} />
        ) : null}
        {step.kind === "recentRuns" ? (
          <WatchlistRecentRunsStep targetRects={targetRects} />
        ) : null}
        <WatchlistWizardControlBar
          backLabel={labels.back}
          nextLabel={labels.next}
          canGoBack={stepIndex > 0}
          nextDisabled={nextDisabled}
          onBack={handleBack}
          onNext={handleNext}
          onSkipStep={handleSkipStep}
        />
      </div>
    </>,
    document.body,
  );
}

function WatchlistAddProductStep({ targetRects, modalOpen }) {
  if (modalOpen) {
    const anchor = targetRects.addModalInput || targetRects.addModal;
    if (!anchor) {
      return <WatchlistWizardLoadingCard title="Opening product search" body="We are locating the product search modal." />;
    }

    return (
      <WatchlistWizardTooltip
        anchorRect={anchor}
        className="ppWatchlistWizardTooltip-addModal"
        title="Choose a product to watch"
        eyebrow="Add to Watchlist"
        preferredWidth={384}
        estimatedHeight={154}
        forceSide="right"
      >
        <p>
          Type a product name, SKU, handle, or product ID. Select one result with Add to watchlist
          and ProductPulse will start tracking it in this Watchlist.
        </p>
      </WatchlistWizardTooltip>
    );
  }

  const anchor = targetRects.addButton;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening Watchlist" body="We are locating the Add watched product button." />;
  }

  return (
    <>
      <section className="ppWatchlistWizardIntroModal" role="dialog" aria-modal="true" aria-labelledby="pp-watchlist-wizard-intro-title">
        <p className="ppWizardEyebrow">Watchlist setup</p>
        <h2 id="pp-watchlist-wizard-intro-title">Monitor product changes automatically</h2>
        <p>
          Watchlist follows selected products over time, compares each new run against the previous
          baseline, and shows what changed without making you rerun manual analysis every day.
        </p>
        <p>
          Automatic runs only spend diagnosis credits when ProductPulse needs to refresh a watched
          product. If nothing changed, the scan can keep the existing diagnosis without consuming a credit.
        </p>
      </section>
      <WatchlistWizardTooltip
        anchorRect={anchor}
        className="ppWatchlistWizardTooltip-addButton"
        title="Add a watched product"
        eyebrow="First step"
        preferredWidth={362}
        estimatedHeight={142}
        forceSide="bottom"
      >
        <p>
          Start by adding one Shopify product to the Watchlist. Click Add watched product to open
          the product search modal.
        </p>
      </WatchlistWizardTooltip>
    </>
  );
}

function WatchlistTableStep({ targetRects }) {
  const anchor = targetRects.watchlistTable;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening watched products" body="We are locating the Watchlist product table." />;
  }

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-table"
      title="Watched products"
      eyebrow="Current Watchlist"
      preferredWidth={400}
      estimatedHeight={166}
      forceSide="top"
      offsetY={-6}
    >
      <p>
        This table lists the products currently monitored by Watchlist. From here you can open the
        latest report, pause monitoring, resume a paused product, or remove a product from the list.
      </p>
    </WatchlistWizardTooltip>
  );
}

function WatchlistSettingsStep({ targetRects, scanStarted, reportReady }) {
  const anchor = targetRects.runScanButton || targetRects.settingsPanel;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening Watch settings" body="We are locating Watch settings and the manual scan action." />;
  }

  const title = scanStarted && !reportReady ? "Watchlist scan is running" : "Run a Watchlist scan";

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-settings"
      title={title}
      eyebrow="Watch settings"
      preferredWidth={390}
      estimatedHeight={scanStarted && !reportReady ? 216 : 174}
      forceSide="top"
      offsetY={-12}
    >
      {scanStarted && !reportReady ? (
        <>
          <p>
            ProductPulse is running the Watchlist refresh. It checks the watched products against
            the latest stored evidence, queues the needed Product Diagnosis work, and waits for a
            reportable result.
          </p>
          <div className="ppWizardProcessingStatus" role="status" aria-live="polite">
            <span className="ppWizardInlineSpinner" aria-hidden="true" />
            <span>Waiting for a Watchlist report...</span>
          </div>
        </>
      ) : (
        <p>
          Watchlist runs automatically on the configured cadence, but you can also run it manually.
          Use Run scan now to refresh the Watchlist and create the next report when a product has
          new results.
        </p>
      )}
    </WatchlistWizardTooltip>
  );
}

function WatchlistReportRowStep({ targetRects, reportedProduct }) {
  const anchor = targetRects.viewReportButton || targetRects.reportRow;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Waiting for a Watchlist report" body="We are locating the finished product row and its View report action." />;
  }

  const productLabel = reportedProduct?.title || "this product";

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-reportRow"
      title="Open the product report"
      eyebrow="Report ready"
      preferredWidth={382}
      estimatedHeight={158}
      forceSide="top"
      offsetY={-8}
    >
      <p>
        The latest Watchlist result is ready for {productLabel}. Click View report to open the
        product-level Watchlist report and review what changed.
      </p>
    </WatchlistWizardTooltip>
  );
}

function WatchlistProductHeroStep({ targetRects }) {
  const anchor = targetRects.productSummary;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening Watchlist report" body="We are locating the report header." />;
  }

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-productHero"
      title="Product Watchlist report"
      eyebrow="Watchlist report"
      preferredWidth={420}
      estimatedHeight={176}
      forceSide="bottom"
    >
      <p>
        This header summarizes the selected Watchlist run for the product: the product identity,
        report status, latest run, and how many changes were detected since the previous run.
      </p>
    </WatchlistWizardTooltip>
  );
}

function WatchlistRecentRunsStep({ targetRects }) {
  const anchor = targetRects.recentRuns;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening recent runs" body="We are locating the recent Watchlist runs panel." />;
  }

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-recentRuns"
      title="Recent Watchlist runs"
      eyebrow="Run history"
      preferredWidth={398}
      estimatedHeight={162}
      forceSide="bottom"
    >
      <p>
        Recent runs let you move through previous Watchlist executions for this product. Open older
        runs to see how risk, evidence, orders, returns, reviews, and recommendations changed over time.
      </p>
    </WatchlistWizardTooltip>
  );
}

function WatchlistWizardTooltip({
  anchorRect,
  className = "",
  title,
  eyebrow,
  children,
  offsetY = 0,
  preferredWidth = 360,
  estimatedHeight,
  forceSide,
}) {
  const placement = getTooltipPlacement(anchorRect, offsetY, preferredWidth, { estimatedHeight, forceSide });
  const sideClass = getWizardTooltipSideClass(placement.side);

  return (
    <aside
      className={`ppWizardTooltip ${sideClass} ${className}`.trim()}
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

function WatchlistWizardControlBar({
  backLabel,
  nextLabel,
  canGoBack,
  nextDisabled,
  onBack,
  onNext,
  onSkipStep,
}) {
  return (
    <footer className="ppWizardControlBar ppWatchlistWizardControlBar" role="group" aria-label="Watchlist wizard controls">
      <div className="ppWizardControlBarInner">
        <button className="ppWizardBackButton" type="button" onClick={onBack} disabled={!canGoBack}>
          <s-icon type="chevron-left" size="small"></s-icon>
          {backLabel}
        </button>
        <button className="ppWizardSkipButton" type="button" onClick={onSkipStep}>
          Skip step
        </button>
        <button className="ppWizardNextButton" type="button" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
          <s-icon type="chevron-right" size="small"></s-icon>
        </button>
      </div>
    </footer>
  );
}

function WatchlistWizardLoadingCard({ title, body }) {
  return (
    <section className="ppWizardLoadingCard" role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function useSelectorPresent(selector, enabled) {
  const [present, setPresent] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPresent(false);
      return undefined;
    }

    const check = () => setPresent(Boolean(document.querySelector(selector)));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [enabled, selector]);

  return present;
}

function useWatchlistWizardTargets(targets, enabled) {
  const [rects, setRects] = useState({});
  const rafRef = useRef(null);
  const targetsKey = useMemo(
    () => targets.map((target) => `${target.id}:${target.selector}:${target.all ? "all" : "one"}`).join("|"),
    [targets],
  );

  const measure = useCallback(() => {
    const nextRects = {};
    document.querySelectorAll(".ppWatchlistWizardSpotlightTarget").forEach((element) => {
      clearWatchlistWizardSpotlightElement(element);
    });

    targets.forEach((target) => {
      const elements = target.all
        ? Array.from(document.querySelectorAll(target.selector))
        : [document.querySelector(target.selector)].filter(Boolean);
      const visibleElements = elements.filter((element) => getComputedStyle(element).display !== "none");
      if (!visibleElements.length) return;

      visibleElements.forEach((element) => {
        const rect = getElementRect(element);
        element.style.setProperty("--pp-wizard-target-top", `${rect.top}px`);
        element.style.setProperty("--pp-wizard-target-left", `${rect.left}px`);
        element.style.setProperty("--pp-wizard-target-width", `${rect.width}px`);
        element.style.setProperty("--pp-wizard-target-height", `${rect.height}px`);
        element.classList.add("ppWizardSpotlightTarget");
        element.classList.add("ppWatchlistWizardSpotlightTarget");
      });
      nextRects[target.id] = getUnionRect(visibleElements);
    });

    setRects(nextRects);
  }, [targets]);

  useEffect(() => {
    if (!enabled) {
      document.querySelectorAll(".ppWatchlistWizardSpotlightTarget").forEach((element) => {
        clearWatchlistWizardSpotlightElement(element);
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
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      document.querySelectorAll(".ppWatchlistWizardSpotlightTarget").forEach((element) => {
        clearWatchlistWizardSpotlightElement(element);
      });
    };
  }, [enabled, measure, targetsKey]);

  return rects;
}

function clearWatchlistWizardSpotlightElement(element) {
  element.classList.remove("ppWizardSpotlightTarget");
  element.classList.remove("ppWatchlistWizardSpotlightTarget");
  element.style.removeProperty("--pp-wizard-target-top");
  element.style.removeProperty("--pp-wizard-target-left");
  element.style.removeProperty("--pp-wizard-target-width");
  element.style.removeProperty("--pp-wizard-target-height");
}

function getWatchlistWizardTargets(step, addModalOpen) {
  if (step.kind === "addProduct") return addModalOpen ? addModalTargets : addButtonTargets;
  return step.targets || emptyTargets;
}

function getWatchlistWizardNextDisabled(step, state) {
  if (step.kind === "addProduct") return !state.productAdded;
  if (step.kind === "settings") return !state.scanStarted || !state.reportReady;
  if (step.kind === "reportRow") return true;
  return false;
}

function getWatchlistWizardControlLabels(step, state) {
  if (step.kind === "addProduct") {
    return { back: "Back", next: state.productAdded ? "Next" : "Add product first" };
  }
  if (step.kind === "settings") {
    return {
      back: "Back",
      next: !state.scanStarted ? "Run scan now first" : state.reportReady ? "Next" : "Waiting for report",
    };
  }
  if (step.kind === "reportRow") return { back: "Back", next: "Open report first" };
  if (step.kind === "recentRuns") return { back: "Back", next: "Finish" };
  return { back: "Back", next: "Next" };
}

function getWatchlistWizardScrollSelector(step, addModalOpen) {
  if (step.kind === "addProduct") {
    return addModalOpen ? '[data-pp-watchlist-add-modal="true"]' : '[data-pp-watchlist-add-button="header"]';
  }
  if (step.kind === "table") return "[data-pp-watchlist-table]";
  if (step.kind === "settings") return "[data-pp-watchlist-run-scan]";
  if (step.kind === "reportRow") return '[data-pp-watchlist-ready-row="true"]';
  if (step.kind === "productHero") return "[data-pp-watchlist-product-hero]";
  if (step.kind === "recentRuns") return "[data-pp-watchlist-recent-runs]";
  return "";
}

function isCurrentWatchlistWizardRoute(pathname, step) {
  if (step.route === WATCHLIST_ROUTE) return isWatchlistIndexRoute(pathname);
  return step.route && pathname.startsWith(step.route);
}

function isWatchlistIndexRoute(pathname) {
  return pathname === WATCHLIST_ROUTE || pathname === `${WATCHLIST_ROUTE}/`;
}

function isWatchlistProductRoute(pathname) {
  return pathname.startsWith(`${WATCHLIST_ROUTE}/`) && !isWatchlistIndexRoute(pathname);
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

function getTooltipPlacement(anchorRect, offsetY = 0, preferredWidth = 360, options = {}) {
  if (typeof window === "undefined") return { style: {}, arrowStyle: {}, side: "right" };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const bottomBarHeight = 78;
  const tooltipWidth = Math.min(preferredWidth, viewportWidth - 32);
  const estimatedHeight = options.estimatedHeight || 204;
  const gap = 18;
  const centerY = anchorRect.top + (anchorRect.height || 34) / 2;
  const canUseRight = viewportWidth - anchorRect.right >= tooltipWidth + gap + 16;
  const maxTop = viewportHeight - bottomBarHeight - estimatedHeight - 16;

  if (options.forceSide === "top") {
    const left = clamp(anchorRect.left, 16, viewportWidth - tooltipWidth - 16);
    const top = clamp(anchorRect.top - estimatedHeight - gap + offsetY, 16, maxTop);
    return {
      side: "top",
      style: { width: `${tooltipWidth}px`, left: `${left}px`, top: `${top}px` },
      arrowStyle: {
        left: `${clamp(anchorRect.left + (anchorRect.width || 40) / 2 - left, 24, tooltipWidth - 24)}px`,
      },
    };
  }

  if (options.forceSide === "left") {
    const top = clamp(centerY - estimatedHeight / 2 + offsetY, 16, maxTop);
    return {
      side: "left",
      style: {
        width: `${tooltipWidth}px`,
        left: `${clamp(anchorRect.left - tooltipWidth - gap, 16, viewportWidth - tooltipWidth - 16)}px`,
        top: `${top}px`,
      },
      arrowStyle: { top: `${clamp(centerY - top, 22, estimatedHeight - 22)}px` },
    };
  }

  if (options.forceSide !== "bottom" && (canUseRight || options.forceSide === "right")) {
    const top = clamp(centerY - estimatedHeight / 2 + offsetY, 16, maxTop);
    return {
      side: "right",
      style: { width: `${tooltipWidth}px`, left: `${anchorRect.right + gap}px`, top: `${top}px` },
      arrowStyle: { top: `${clamp(centerY - top, 22, estimatedHeight - 22)}px` },
    };
  }

  const left = clamp(anchorRect.left, 16, viewportWidth - tooltipWidth - 16);
  const preferredTop = anchorRect.bottom + 14 + offsetY;
  const top = preferredTop + estimatedHeight < viewportHeight - bottomBarHeight
    ? preferredTop
    : clamp(anchorRect.top - estimatedHeight - 14, 16, maxTop);

  return {
    side: "bottom",
    style: { width: `${tooltipWidth}px`, left: `${left}px`, top: `${top}px` },
    arrowStyle: {
      left: `${clamp(anchorRect.left + Math.min(anchorRect.width || 40, 70) / 2 - left, 24, tooltipWidth - 24)}px`,
    },
  };
}

function getWizardTooltipSideClass(side) {
  if (side === "right") return "isRight";
  if (side === "left") return "isLeft";
  if (side === "top") return "isTop";
  return "isBottom";
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function hasWatchlistWizardCompleted() {
  try {
    return window.localStorage.getItem(WATCHLIST_WIZARD_STORAGE_KEY) === "true";
  } catch {
    return true;
  }
}

function markWatchlistWizardCompleted() {
  try {
    window.localStorage.setItem(WATCHLIST_WIZARD_STORAGE_KEY, "true");
  } catch {
    // Ignore storage failures; the visible wizard can still be dismissed for this session.
  }
}
