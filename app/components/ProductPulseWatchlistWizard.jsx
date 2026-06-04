import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { buildEmbeddedAppPath, getEmbeddedAppPathname } from "../lib/product-pulse-app-paths";

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

const settingsPanelTargets = [
  { id: "settingsPanel", selector: "[data-pp-watchlist-settings-panel]" },
];

const settingsTargets = [
  { id: "settingsPanel", selector: "[data-pp-watchlist-settings-panel]" },
  { id: "runScanButton", selector: "[data-pp-watchlist-run-scan]" },
];

const backgroundProcessTargets = [
  { id: "backgroundProcessPopover", selector: "[data-pp-background-process-popover]" },
  { id: "backgroundProcessButton", selector: "[data-pp-background-process-button]" },
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
  { id: "settingsOverview", kind: "settingsOverview", route: WATCHLIST_ROUTE, targets: settingsPanelTargets },
  { id: "settings", kind: "settings", route: WATCHLIST_ROUTE, targets: settingsTargets },
  { id: "backgroundProcesses", kind: "backgroundProcesses", route: WATCHLIST_ROUTE, targets: backgroundProcessTargets },
  { id: "reportRow", kind: "reportRow", route: WATCHLIST_ROUTE, targets: reportTargets },
  { id: "productHero", kind: "productHero", targets: productHeroTargets },
  { id: "recentRuns", kind: "recentRuns", targets: recentRunsTargets },
];

export function ProductPulseWatchlistWizard() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateToAppPath = useCallback((path, options) => {
    navigate(buildEmbeddedAppPath(location.pathname, path), options);
  }, [location.pathname, navigate]);
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [productAdded, setProductAdded] = useState(false);
  const [scanStarted, setScanStarted] = useState(false);
  const [scanJobCompleted, setScanJobCompleted] = useState(false);
  const [scanReportReady, setScanReportReady] = useState(false);
  const [reportedProduct, setReportedProduct] = useState(null);
  const waitingForScanReportRef = useRef(false);
  const scanJobIdsRef = useRef(new Set());
  const step = watchlistWizardSteps[stepIndex] || watchlistWizardSteps[0];
  const visible = active && isWatchlistRoute(location.pathname);
  const addModalOpen = useSelectorPresent('[data-pp-watchlist-add-modal="true"]', visible && step.kind === "addProduct");
  const reportReady = useSelectorPresent('[data-pp-watchlist-ready-row="true"] [data-pp-watchlist-view-report="true"]', visible);
  const targets = useMemo(
    () => getWatchlistWizardTargets(step, addModalOpen),
    [addModalOpen, step],
  );
  const targetRects = useWatchlistWizardTargets(targets, visible);
  const nextDisabled = getWatchlistWizardNextDisabled(step, { productAdded, scanStarted, reportReady, scanJobCompleted, scanReportReady });
  const labels = getWatchlistWizardControlLabels(step, { productAdded, scanStarted, reportReady, scanJobCompleted, scanReportReady });

  const completeWizard = useCallback(() => {
    markWatchlistWizardCompleted();
    setActive(false);
  }, []);

  const resetWatchlistWizardState = useCallback((nextActive = false) => {
    clearWatchlistWizardCompleted();
    setProductAdded(false);
    setScanStarted(false);
    setScanJobCompleted(false);
    setScanReportReady(false);
    waitingForScanReportRef.current = false;
    scanJobIdsRef.current = new Set();
    setReportedProduct(null);
    setStepIndex(0);
    setActive(nextActive);
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
    setScanJobCompleted(false);
    setScanReportReady(false);
    waitingForScanReportRef.current = false;
    scanJobIdsRef.current = new Set();
    setReportedProduct(null);
    setStepIndex(0);
    setActive(true);
  }, [active, hydrated, location.pathname]);

  useEffect(() => {
    const handleStartWatchlistWizard = () => {
      resetWatchlistWizardState(true);
      if (!isWatchlistIndexRoute(location.pathname)) {
        navigateToAppPath(WATCHLIST_ROUTE);
      }
    };

    window.addEventListener("productpulse:watchlist-wizard-start", handleStartWatchlistWizard);
    return () => window.removeEventListener("productpulse:watchlist-wizard-start", handleStartWatchlistWizard);
  }, [location.pathname, navigateToAppPath, resetWatchlistWizardState]);

  useEffect(() => {
    const handleResetWatchlistWizard = () => resetWatchlistWizardState(false);

    window.addEventListener("productpulse:watchlist-wizard-reset", handleResetWatchlistWizard);
    return () => window.removeEventListener("productpulse:watchlist-wizard-reset", handleResetWatchlistWizard);
  }, [resetWatchlistWizardState]);

  useEffect(() => {
    document.body.classList.toggle("ppWatchlistWizardActive", visible);
    document.body.classList.toggle("ppWatchlistWizardAddProductActive", visible && step.kind === "addProduct");
    document.body.classList.toggle("ppWatchlistWizardTableActive", visible && step.kind === "table");
    document.body.classList.toggle("ppWatchlistWizardSettingsOverviewActive", visible && step.kind === "settingsOverview");
    document.body.classList.toggle("ppWatchlistWizardSettingsActive", visible && step.kind === "settings");
    document.body.classList.toggle("ppWatchlistWizardBackgroundProcessesActive", visible && step.kind === "backgroundProcesses");
    document.body.classList.toggle("ppWatchlistWizardReportActive", visible && step.kind === "reportRow");
    document.body.classList.toggle("ppWatchlistWizardProductHeroActive", visible && step.kind === "productHero");
    document.body.classList.toggle("ppWatchlistWizardRecentRunsActive", visible && step.kind === "recentRuns");
    return () => {
      document.body.classList.remove("ppWatchlistWizardActive");
      document.body.classList.remove("ppWatchlistWizardAddProductActive");
      document.body.classList.remove("ppWatchlistWizardTableActive");
      document.body.classList.remove("ppWatchlistWizardSettingsOverviewActive");
      document.body.classList.remove("ppWatchlistWizardSettingsActive");
      document.body.classList.remove("ppWatchlistWizardBackgroundProcessesActive");
      document.body.classList.remove("ppWatchlistWizardReportActive");
      document.body.classList.remove("ppWatchlistWizardProductHeroActive");
      document.body.classList.remove("ppWatchlistWizardRecentRunsActive");
    };
  }, [step.kind, visible]);

  useEffect(() => {
    if (!visible || !step.route || isCurrentWatchlistWizardRoute(location.pathname, step)) return;
    navigateToAppPath(step.route);
  }, [location.pathname, navigateToAppPath, step, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const scrollTargetIntoView = () => scrollWatchlistWizardTargetIntoView(step, addModalOpen);
    const timeouts = [80, 360].map((delay) => window.setTimeout(scrollTargetIntoView, delay));
    let observer = null;
    let observerTimeout = null;

    if (step.kind === "table") {
      observer = new MutationObserver(scrollTargetIntoView);
      observer.observe(document.body, { childList: true, subtree: true });
      observerTimeout = window.setTimeout(() => observer?.disconnect(), 1600);
    }

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      if (observerTimeout) window.clearTimeout(observerTimeout);
      observer?.disconnect();
    };
  }, [addModalOpen, step, visible]);

  useEffect(() => {
    if (!visible) return undefined;

    const blockInteraction = (event) => {
      if (!shouldBlockWatchlistWizardInteraction(event.target, step.kind)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("pointerdown", blockInteraction, true);
    window.addEventListener("click", blockInteraction, true);
    window.addEventListener("submit", blockInteraction, true);
    return () => {
      window.removeEventListener("pointerdown", blockInteraction, true);
      window.removeEventListener("click", blockInteraction, true);
      window.removeEventListener("submit", blockInteraction, true);
    };
  }, [step.kind, visible]);

  useEffect(() => {
    if (!active || step.kind !== "backgroundProcesses" || !scanStarted || !scanJobCompleted || !scanReportReady) return undefined;
    const timeout = window.setTimeout(() => {
      const reportStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "reportRow");
      if (reportStepIndex >= 0) setStepIndex(reportStepIndex);
      waitingForScanReportRef.current = false;
      scanJobIdsRef.current = new Set();
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [active, scanJobCompleted, scanReportReady, scanStarted, step.kind]);

  useEffect(() => {
    if (!visible || step.kind !== "backgroundProcesses") return undefined;
    const timeout = window.setTimeout(() => openBackgroundProcessesPopover(), 80);
    const interval = window.setInterval(() => openBackgroundProcessesPopover(), 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [step.kind, visible]);

  useEffect(() => {
    if (!active) return undefined;

    const handleQueuedJobs = (event) => {
      if (!waitingForScanReportRef.current) return;
      const jobIds = getWatchlistWizardJobIds(event.detail?.jobs || event.detail?.job);
      if (!jobIds.length) return;
      scanJobIdsRef.current = new Set([...scanJobIdsRef.current, ...jobIds]);
      setScanJobCompleted(false);
    };

    const handleFinishedJobs = (event) => {
      if (!waitingForScanReportRef.current) return;
      const jobs = normalizeWatchlistWizardJobs(event.detail?.jobs || event.detail?.job);
      if (!jobs.length) return;
      const trackedIds = scanJobIdsRef.current;
      const completedTrackedJob = jobs.some((job) => {
        if (!isCompletedWatchlistWizardJob(job)) return false;
        return trackedIds.size ? trackedIds.has(job.id) : true;
      });
      if (completedTrackedJob) setScanJobCompleted(true);
    };

    window.addEventListener("productpulse:jobs-queued", handleQueuedJobs);
    window.addEventListener("productpulse:jobs-finished", handleFinishedJobs);
    return () => {
      window.removeEventListener("productpulse:jobs-queued", handleQueuedJobs);
      window.removeEventListener("productpulse:jobs-finished", handleFinishedJobs);
    };
  }, [active]);

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
        setScanJobCompleted(false);
        setScanReportReady(false);
        waitingForScanReportRef.current = false;
        scanJobIdsRef.current = new Set();
        const tableStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "table");
        if (tableStepIndex >= 0) setStepIndex(tableStepIndex);
      }
      if (detail.type === "scan-started") {
        setScanStarted(true);
        setScanJobCompleted(false);
        setScanReportReady(false);
        waitingForScanReportRef.current = true;
        scanJobIdsRef.current = new Set(getWatchlistWizardJobIds(detail.jobs));
        const backgroundStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "backgroundProcesses");
        if (backgroundStepIndex >= 0) setStepIndex(backgroundStepIndex);
        if (isWatchlistRoute(location.pathname)) {
          window.setTimeout(() => openBackgroundProcessesPopover(), 80);
        }
      }
      if (detail.type === "report-ready") {
        setReportedProduct({
          title: detail.productTitle || "",
          href: detail.productHref || "",
        });
        if (waitingForScanReportRef.current) {
          setScanReportReady(true);
        }
      }
      if (detail.type === "report-opened") {
        setReportedProduct({
          title: detail.productTitle || "",
          href: detail.href || "",
        });
        const productStepIndex = watchlistWizardSteps.findIndex((candidate) => candidate.kind === "productHero");
        if (productStepIndex >= 0) setStepIndex(productStepIndex);
        if (detail.href && !getEmbeddedAppPathname(location.pathname).startsWith(detail.href)) navigateToAppPath(detail.href);
      }
    };

    window.addEventListener("productpulse:watchlist-wizard", handleWatchlistWizardEvent);
    return () => window.removeEventListener("productpulse:watchlist-wizard", handleWatchlistWizardEvent);
  }, [active, location.pathname, navigateToAppPath]);

  const advanceWizard = useCallback((options = {}) => {
    if (!options.ignoreDisabled && nextDisabled) return;
    if (stepIndex >= watchlistWizardSteps.length - 1) {
      completeWizard();
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    const nextStep = watchlistWizardSteps[nextIndex];
    if (nextStep?.route && !isCurrentWatchlistWizardRoute(location.pathname, nextStep)) {
      navigateToAppPath(nextStep.route);
    }
  }, [completeWizard, location.pathname, navigateToAppPath, nextDisabled, stepIndex]);

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
    if (previousStep?.route && !isCurrentWatchlistWizardRoute(location.pathname, previousStep)) {
      navigateToAppPath(previousStep.route);
    }
  }, [location.pathname, navigateToAppPath, stepIndex]);

  if (!hydrated || !visible) return null;

  return createPortal(
    <>
      <div className="ppWizardBackdropRoot ppWatchlistWizardBackdropRoot" aria-hidden="true">
        <div className="ppWizardBlurLayer" />
      </div>
      <div className={`ppWizardRoot ppWatchlistWizardRoot ppWatchlistWizardRoot-${step.kind}`} aria-live="polite">
        <button className="ppWizardSkipTourButton" type="button" onClick={completeWizard}>
          Skip tour
        </button>
        {step.kind === "addProduct" ? (
          <WatchlistAddProductStep targetRects={targetRects} modalOpen={addModalOpen} />
        ) : null}
        {step.kind === "table" ? (
          <WatchlistTableStep targetRects={targetRects} />
        ) : null}
        {step.kind === "settingsOverview" ? (
          <WatchlistSettingsOverviewStep targetRects={targetRects} />
        ) : null}
        {step.kind === "settings" ? (
          <WatchlistSettingsStep targetRects={targetRects} scanStarted={scanStarted} reportReady={reportReady} />
        ) : null}
        {step.kind === "backgroundProcesses" ? (
          <WatchlistBackgroundProcessesStep targetRects={targetRects} scanJobCompleted={scanJobCompleted} scanReportReady={scanReportReady} />
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
          Automatic runs only spend credits when ProductPulse needs to refresh a watched
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

function WatchlistSettingsOverviewStep({ targetRects }) {
  const anchor = targetRects.settingsPanel;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening Watch settings" body="We are locating the Watchlist settings panel." />;
  }

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-settingsOverview"
      title="Watchlist settings"
      eyebrow="Configuration"
      preferredWidth={402}
      estimatedHeight={174}
      forceSide="top"
      offsetY={-12}
    >
      <p>
        This panel controls how Watchlist runs: the scan cadence, alert recipients, trigger rules,
        email alerts, and bulk pause or resume actions for watched products.
      </p>
      <p>
        This step is only an overview, so the settings are locked while the wizard explains them.
        On the next step you will run a manual scan.
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

function WatchlistBackgroundProcessesStep({ targetRects, scanJobCompleted, scanReportReady }) {
  const anchor = targetRects.backgroundProcessPopover || targetRects.backgroundProcessButton;
  if (!anchor) {
    return <WatchlistWizardLoadingCard title="Opening background processes" body="We are opening the process monitor for this Watchlist scan." />;
  }
  const waitingLabel = scanJobCompleted && !scanReportReady
    ? "Preparing the first Watchlist report..."
    : "Waiting for a Watchlist job to complete...";

  return (
    <WatchlistWizardTooltip
      anchorRect={anchor}
      className="ppWatchlistWizardTooltip-backgroundProcesses"
      title="Track the Watchlist scan"
      eyebrow="Background processes"
      preferredWidth={408}
      estimatedHeight={256}
      forceSide="left"
      offsetY={22}
    >
      <p>
        ProductPulse is running the Watchlist process across the active products in this list. The
        system checks each product against the latest stored evidence and queues any diagnosis work
        needed to create fresh Watchlist results.
      </p>
      <p>
        When the run completes, the Watchlist report can be delivered by email. As each product
        finishes, its individual report becomes available here first.
      </p>
      <div className="ppWizardProcessingStatus" role="status" aria-live="polite">
        <span className="ppWizardInlineSpinner" aria-hidden="true" />
        <span>{waitingLabel}</span>
      </div>
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
  if (step.kind === "backgroundProcesses") return !state.scanJobCompleted || !state.scanReportReady;
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
  if (step.kind === "backgroundProcesses") {
    const next = !state.scanJobCompleted
      ? "Waiting for job"
      : state.scanReportReady ? "Next" : "Waiting for report";
    return { back: "Back", next };
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
  if (step.kind === "settingsOverview") return "[data-pp-watchlist-settings-panel]";
  if (step.kind === "settings") return "[data-pp-watchlist-run-scan]";
  if (step.kind === "backgroundProcesses") return "[data-pp-background-process-popover], [data-pp-background-process-button]";
  if (step.kind === "reportRow") return '[data-pp-watchlist-ready-row="true"]';
  if (step.kind === "productHero") return "[data-pp-watchlist-product-hero]";
  if (step.kind === "recentRuns") return "[data-pp-watchlist-recent-runs]";
  return "";
}

function scrollWatchlistWizardTargetIntoView(step, addModalOpen) {
  const selector = getWatchlistWizardScrollSelector(step, addModalOpen);
  if (!selector) return;
  const element = document.querySelector(selector);
  if (!element) return;
  const block = getWatchlistWizardScrollBlock(step);
  element.scrollIntoView?.({ block, inline: "nearest", behavior: "auto" });
}

function getWatchlistWizardScrollBlock(step) {
  if (step.kind === "table") return "end";
  if (step.kind === "settingsOverview" || step.kind === "settings") return "center";
  if (step.kind === "backgroundProcesses") return "center";
  if (step.kind === "reportRow") return "center";
  return "center";
}

function normalizeWatchlistWizardJobs(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function getWatchlistWizardJobIds(value) {
  return normalizeWatchlistWizardJobs(value).map((job) => job?.id).filter(Boolean);
}

function isCompletedWatchlistWizardJob(job) {
  return job?.status === "Completed" && job?.kind === "product-diagnosis";
}

function shouldBlockWatchlistWizardInteraction(target, stepKind) {
  if (!(target instanceof Element)) return false;
  if (target.closest(".ppWatchlistWizardRoot")) return false;
  if (stepKind === "table") {
    return Boolean(target.closest("[data-pp-watchlist-table] a, [data-pp-watchlist-table] button, [data-pp-watchlist-table] [role='button']"));
  }
  if (stepKind === "settingsOverview") {
    return Boolean(target.closest("[data-pp-watchlist-settings-panel]"));
  }
  if (stepKind === "settings") {
    const settingsPanel = target.closest("[data-pp-watchlist-settings-panel]");
    if (!settingsPanel) return false;
    const runScanButton = target.closest("[data-pp-watchlist-run-scan]");
    const runScanForm = target.closest("form")?.querySelector("[data-pp-watchlist-run-scan]");
    return !runScanButton && !runScanForm;
  }
  if (stepKind === "backgroundProcesses") {
    return Boolean(target.closest(".ppGlobalTopbar, [data-pp-background-process-popover], [data-pp-background-process-button]"));
  }
  return false;
}

function isCurrentWatchlistWizardRoute(pathname, step) {
  const appPathname = getEmbeddedAppPathname(pathname);
  if (step.route === WATCHLIST_ROUTE) return isWatchlistIndexRoute(appPathname);
  return step.route && appPathname.startsWith(step.route);
}

function isWatchlistIndexRoute(pathname) {
  const appPathname = getEmbeddedAppPathname(pathname);
  return appPathname === WATCHLIST_ROUTE || appPathname === `${WATCHLIST_ROUTE}/`;
}

function isWatchlistProductRoute(pathname) {
  const appPathname = getEmbeddedAppPathname(pathname);
  return appPathname.startsWith(`${WATCHLIST_ROUTE}/`) && !isWatchlistIndexRoute(appPathname);
}

function isWatchlistRoute(pathname) {
  return isWatchlistIndexRoute(pathname) || isWatchlistProductRoute(pathname);
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

function clearWatchlistWizardCompleted() {
  try {
    window.localStorage.removeItem(WATCHLIST_WIZARD_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the visible wizard can still restart for this session.
  }
}

function openBackgroundProcessesPopover() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("productpulse:wizard-open-background-processes"));
}
