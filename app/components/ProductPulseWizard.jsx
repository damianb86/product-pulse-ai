import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";

const WIZARD_STORAGE_KEY = "productPulse.onboardingWizard.completed.v1";
const DASHBOARD_ROUTE = "/app/dashboard";
const CONNECT_ROUTE = "/app/connect";
const PRODUCTS_CANDIDATES_ROUTE = "/app/products?tab=candidates";
const emptyWizardTargets = [];

const connectTargets = [
  { id: "judgemeRow", selector: '[data-pp-connect-source-row="judgemeReviews"]' },
  { id: "judgemeAction", selector: '[data-pp-connect-source-action="judgemeReviews"]' },
  { id: "csvRow", selector: '[data-pp-connect-source-row="csvReviews"]' },
  { id: "csvAction", selector: '[data-pp-connect-source-action="csvReviews"]' },
];

const productQuickScanTargets = [
  { id: "quickScan", selector: '[data-pp-products-quick-scan]' },
];

const productCandidateTargets = [
  { id: "candidateRows", selector: '[data-pp-products-candidate-row]', all: true },
  {
    id: "deepScanAction",
    selector: '[data-pp-products-run-deep-scan-selected]',
  },
];

const backgroundProcessTargets = [
  {
    id: "backgroundProcessPopover",
    selector: '[data-pp-background-process-popover]',
  },
  {
    id: "backgroundProcessButton",
    selector: '[data-pp-background-process-button]',
  },
];

const deepScanCompleteTargets = [
  {
    id: "completionNotice",
    selector: '[data-pp-job-completion-notice="product-diagnosis"]',
  },
  {
    id: "completionNoticeAction",
    selector: '[data-pp-job-completion-open-product="true"]',
  },
];

const productOverviewTargets = [
  { id: "productHero", selector: '[data-pp-product-detail-overview="hero"]' },
  { id: "productHeroSummary", selector: '[data-pp-product-detail-overview="summary"]' },
  { id: "productHeroActions", selector: '[data-pp-product-detail-overview="actions"]' },
];

const productAnalysisPanelTargets = [
  {
    id: "aiInterpretation",
    selector: '[data-pp-product-detail-analysis-panel="ai-interpretation"]',
  },
  {
    id: "recommendedActions",
    selector: '[data-pp-product-detail-analysis-panel="recommended-actions"]',
  },
];

const chatAssistantTargets = [
  { id: "chatLauncher", selector: '[data-pp-chat-launcher]' },
];

const wizardSteps = [
  { id: "welcome", kind: "welcome", route: DASHBOARD_ROUTE },
  { id: "connectReviews", kind: "connect", route: CONNECT_ROUTE, targets: connectTargets },
  { id: "products", kind: "products", route: PRODUCTS_CANDIDATES_ROUTE },
  { id: "backgroundProcesses", kind: "backgroundProcesses", targets: backgroundProcessTargets },
  { id: "deepScanComplete", kind: "deepScanComplete", targets: deepScanCompleteTargets },
  { id: "productOverview", kind: "productOverview", targets: productOverviewTargets },
  { id: "productAnalysisPanels", kind: "productAnalysisPanels", targets: productAnalysisPanelTargets },
  { id: "chatAssistant", kind: "chatAssistant", targets: chatAssistantTargets },
];

const csvProviderBadges = [
  { label: "Judge.me", domain: "judge.me" },
  { label: "Yotpo", domain: "yotpo.com" },
  { label: "Loox", domain: "loox.io" },
  { label: "Okendo", domain: "okendo.io" },
  { label: "Stamped", domain: "stamped.io" },
];

const modalCopy = {
  judgeme: {
    eyebrow: "Judge.me connection",
    title: "Connect Judge.me reviews",
    body: "Paste the Judge.me private API token here. ProductPulse uses it to read review signals for Catalog Scan and Product Diagnosis.",
  },
  csv: {
    eyebrow: "CSV upload",
    title: "Import review data",
    body: "Choose a review CSV with product identifiers and ratings. This is the fallback for Judge.me, Yotpo, Loox, Stamped or any provider that can export reviews.",
  },
  csvPreview: {
    eyebrow: "CSV preview",
    title: "Confirm the detected columns",
    body: "Review the detected mapping and sample rows. Saving the preview stores normalized review evidence for future scans.",
  },
  quickScanCsv: {
    eyebrow: "Catalog Scan data",
    title: "CSV is optional for Catalog Scan",
    body: "You can run Catalog Scan without uploaded reviews. If you already have a CSV, adding it first makes preliminary risk signals stronger.",
  },
  quickScanConfirm: {
    eyebrow: "Catalog Scan confirmation",
    title: "Start the catalog scan",
    body: "This queues a lightweight scan that finds candidate products. When candidates appear, select one and start a Product Diagnosis.",
  },
  deepScanConfirm: {
    eyebrow: "Product Diagnosis confirmation",
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
  const [quickScanJobActive, setQuickScanJobActive] = useState(false);
  const [quickScanStepCompleted, setQuickScanStepCompleted] = useState(false);
  const [deepScanStarted, setDeepScanStarted] = useState(false);
  const [completedDeepScanJob, setCompletedDeepScanJob] = useState(null);
  const step = wizardSteps[stepIndex] || wizardSteps[0];
  const productsState = useProductsWizardState(active && step.kind === "products");
  const openModal = useOpenWizardModal(active);
  const targets = useMemo(
    () => getWizardTargets(step, productsState.hasCandidates, quickScanStepCompleted),
    [productsState.hasCandidates, quickScanStepCompleted, step],
  );
  const targetRects = useWizardSpotlightTargets(targets, active && step.kind !== "welcome");
  const waitingForDeepScan = step.kind === "backgroundProcesses" && deepScanStarted && !completedDeepScanJob;
  const nextDisabled = (step.kind === "products" && (!quickScanStepCompleted || !productsState.hasCandidates || !deepScanStarted))
    || waitingForDeepScan
    || step.kind === "deepScanComplete";
  const labels = getWizardControlLabels(step, productsState, deepScanStarted, quickScanStepCompleted, completedDeepScanJob);

  const completeWizard = useCallback(() => {
    markWizardCompleted();
    setActive(false);
  }, []);

  useEffect(() => {
    setHydrated(true);
    if (!hasWizardCompleted()) {
      setActive(true);
      setStepIndex(0);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("ppWizardActive", active);
    document.body.classList.toggle("ppWizardConnectActive", active && step.kind === "connect");
    document.body.classList.toggle("ppWizardProductsActive", active && step.kind === "products");
    document.body.classList.toggle("ppWizardBackgroundProcessesActive", active && step.kind === "backgroundProcesses");
    document.body.classList.toggle("ppWizardDeepScanCompleteActive", active && step.kind === "deepScanComplete");
    document.body.classList.toggle("ppWizardProductOverviewActive", active && step.kind === "productOverview");
    document.body.classList.toggle("ppWizardProductAnalysisPanelsActive", active && step.kind === "productAnalysisPanels");
    document.body.classList.toggle("ppWizardChatAssistantActive", active && step.kind === "chatAssistant");
    return () => {
      document.body.classList.remove("ppWizardActive");
      document.body.classList.remove("ppWizardConnectActive");
      document.body.classList.remove("ppWizardProductsActive");
      document.body.classList.remove("ppWizardBackgroundProcessesActive");
      document.body.classList.remove("ppWizardDeepScanCompleteActive");
      document.body.classList.remove("ppWizardProductOverviewActive");
      document.body.classList.remove("ppWizardProductAnalysisPanelsActive");
      document.body.classList.remove("ppWizardChatAssistantActive");
    };
  }, [active, step.kind]);

  useEffect(() => {
    if (!active || !step.route || isCurrentWizardRoute(location.pathname, location.search, step)) return;
    navigate(step.route);
  }, [active, location.pathname, location.search, navigate, step]);

  useEffect(() => {
    if (!active || !step.targets?.length) return undefined;
    const timeout = window.setTimeout(() => {
      const selector = step.kind === "connect"
        ? '[data-pp-connect-source-row="judgemeReviews"]'
        : step.kind === "backgroundProcesses"
            ? '[data-pp-background-process-popover], [data-pp-background-process-button]'
            : step.kind === "deepScanComplete"
              ? '[data-pp-job-completion-notice="product-diagnosis"]'
              : step.kind === "productOverview"
                ? '[data-pp-product-detail-overview="hero"]'
                : step.kind === "productAnalysisPanels"
                  ? '[data-pp-product-detail-analysis-panel="ai-interpretation"]'
                  : step.kind === "chatAssistant"
                    ? '[data-pp-chat-launcher]'
          : "";
      if (selector) document.querySelector(selector)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [active, step]);

  useEffect(() => {
    if (!active || step.kind !== "products") return undefined;
    const timeout = window.setTimeout(() => {
      const selector = quickScanStepCompleted && productsState.hasCandidates
        ? '[data-pp-products-candidate-row]'
        : '[data-pp-products-quick-scan]';
      document.querySelector(selector)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [active, productsState.hasCandidates, quickScanStepCompleted, step.kind]);

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
        setQuickScanJobActive(false);
      }
      if (detail.type === "quick-scan-job-started") {
        setQuickScanStarted(true);
        setQuickScanJobActive(true);
      }
      if (detail.type === "quick-scan-job-finished") {
        setQuickScanStarted(false);
        setQuickScanJobActive(false);
        setQuickScanStepCompleted(true);
      }
      if (detail.type === "deep-scan-started") {
        setQuickScanStarted(false);
        setQuickScanJobActive(false);
        setCompletedDeepScanJob(null);
        setDeepScanStarted(true);
        const backgroundStepIndex = wizardSteps.findIndex((candidate) => candidate.kind === "backgroundProcesses");
        if (backgroundStepIndex >= 0) setStepIndex(backgroundStepIndex);
        window.setTimeout(() => openBackgroundProcessesPopover(), 80);
      }
      if (detail.type === "deep-scan-completed" && detail.job?.kind === "product-diagnosis") {
        setCompletedDeepScanJob(detail.job);
        setDeepScanStarted(false);
        const completeStepIndex = wizardSteps.findIndex((candidate) => candidate.kind === "deepScanComplete");
        if (completeStepIndex >= 0) setStepIndex(completeStepIndex);
      }
      if (detail.type === "deep-scan-product-opened") {
        const job = detail.job || completedDeepScanJob;
        if (job) setCompletedDeepScanJob(job);
        const productStepIndex = wizardSteps.findIndex((candidate) => candidate.kind === "productOverview");
        if (productStepIndex >= 0) setStepIndex(productStepIndex);
        if (detail.href) navigate(detail.href);
      }
      if (detail.type === "chat-opened") {
        completeWizard();
      }
    };

    window.addEventListener("productpulse:wizard", handleWizardEvent);
    return () => window.removeEventListener("productpulse:wizard", handleWizardEvent);
  }, [active, completeWizard, completedDeepScanJob, navigate]);

  useEffect(() => {
    const handleStartWizard = () => {
      clearWizardCompleted();
      setConnectCompletion(null);
      setQuickScanStarted(false);
      setQuickScanJobActive(false);
      setQuickScanStepCompleted(false);
      setDeepScanStarted(false);
      setCompletedDeepScanJob(null);
      setStepIndex(0);
      setActive(true);
      if (!isCurrentWizardRoute(location.pathname, location.search, wizardSteps[0])) {
        navigate(DASHBOARD_ROUTE);
      }
    };

    window.addEventListener("productpulse:wizard-start", handleStartWizard);
    return () => window.removeEventListener("productpulse:wizard-start", handleStartWizard);
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!active || step.kind !== "backgroundProcesses") return undefined;
    const timeout = window.setTimeout(() => openBackgroundProcessesPopover(), 80);
    return () => window.clearTimeout(timeout);
  }, [active, step.kind]);

  const advanceWizard = useCallback((options = {}) => {
    if (!options.ignoreDisabled && nextDisabled) return;
    if (stepIndex >= wizardSteps.length - 1) {
      completeWizard();
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    const nextStep = wizardSteps[nextIndex];
    if (nextStep?.route) navigate(nextStep.route);
  }, [completeWizard, navigate, nextDisabled, stepIndex]);

  const handleNext = useCallback(() => {
    if (step.kind === "backgroundProcesses" && !deepScanStarted && !completedDeepScanJob) {
      completeWizard();
      return;
    }
    advanceWizard();
  }, [advanceWizard, completeWizard, completedDeepScanJob, deepScanStarted, step.kind]);

  const handleSkipStep = useCallback(() => {
    if (step.kind === "products") {
      if (!quickScanStepCompleted) {
        setQuickScanStarted(false);
        setQuickScanJobActive(false);
        setQuickScanStepCompleted(true);
        return;
      }

      if (!deepScanStarted) {
        setQuickScanStarted(false);
        setQuickScanJobActive(false);
        setDeepScanStarted(false);
        const backgroundStepIndex = wizardSteps.findIndex((candidate) => candidate.kind === "backgroundProcesses");
        if (backgroundStepIndex >= 0) setStepIndex(backgroundStepIndex);
        window.setTimeout(() => openBackgroundProcessesPopover(), 80);
        return;
      }
    }

    if (step.kind === "backgroundProcesses") {
      completeWizard();
      return;
    }

    if (step.kind === "deepScanComplete") {
      const productStepIndex = wizardSteps.findIndex((candidate) => candidate.kind === "productOverview");
      if (productStepIndex >= 0) setStepIndex(productStepIndex);
      if (completedDeepScanJob?.productHref) navigate(completedDeepScanJob.productHref);
      return;
    }

    advanceWizard({ ignoreDisabled: true });
  }, [advanceWizard, completeWizard, completedDeepScanJob, deepScanStarted, navigate, quickScanStepCompleted, step.kind]);

  const handleBack = useCallback(() => {
    if (stepIndex <= 0) return;
    const previousIndex = stepIndex - 1;
    setStepIndex(previousIndex);
    const previousStep = wizardSteps[previousIndex];
    if (previousStep?.route) navigate(previousStep.route);
  }, [navigate, stepIndex]);

  if (!hydrated || !active) return null;

  return createPortal(
    <>
      <div className="ppWizardBackdropRoot" aria-hidden="true">
        <div className="ppWizardBlurLayer" />
      </div>
      <div className={`ppWizardRoot ppWizardRoot-${step.kind}`} aria-live="polite">
        {step.kind === "welcome" ? <WelcomeWizardStep /> : null}
        {step.kind === "connect" ? (
          <ConnectWizardStep
            targetRects={targetRects}
            openModal={openModal}
            completion={connectCompletion}
          />
        ) : null}
        {step.kind === "products" ? (
          <ProductsWizardStep
            targetRects={targetRects}
            productsState={productsState}
            quickScanStarted={quickScanStarted}
            quickScanJobActive={quickScanJobActive}
            quickScanStepCompleted={quickScanStepCompleted}
            openModal={openModal}
          />
        ) : null}
        {step.kind === "backgroundProcesses" ? (
          <BackgroundProcessesWizardStep targetRects={targetRects} />
        ) : null}
        {step.kind === "deepScanComplete" ? (
          <DeepScanCompleteWizardStep targetRects={targetRects} completedJob={completedDeepScanJob} />
        ) : null}
        {step.kind === "productOverview" ? (
          <ProductOverviewWizardStep targetRects={targetRects} />
        ) : null}
        {step.kind === "productAnalysisPanels" ? (
          <ProductAnalysisPanelsWizardStep targetRects={targetRects} />
        ) : null}
        {step.kind === "chatAssistant" ? (
          <ChatAssistantWizardStep targetRects={targetRects} />
        ) : null}
        {openModal ? <WizardModalCoach modal={openModal} /> : null}
        {step.kind !== "chatAssistant" ? (
          <WizardControlBar
            backLabel={labels.back}
            nextLabel={labels.next}
            canGoBack={stepIndex > 0}
            nextDisabled={nextDisabled}
            onBack={handleBack}
            onNext={handleNext}
            onSkipStep={handleSkipStep}
          />
        ) : null}
      </div>
    </>,
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
        This quick guide will show you where to connect review data, run Catalog Scan, and start
        Product Diagnosis from Candidates.
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
  const judgeAnchor = targetRects.judgemeAction || targetRects.judgemeRow;
  const csvAnchor = targetRects.csvAction || targetRects.csvRow;

  if (!judgeAnchor || !csvAnchor) {
    return <WizardLoadingCard title="Opening Connect" body="We are locating the Judge.me and CSV review source rows." />;
  }

  return (
    <>
      <WizardTooltip
        anchorRect={judgeAnchor}
        className="ppWizardTooltip-judgeme"
        title="Connect Judge.me Reviews"
        eyebrow="Direct connector"
        estimatedHeight={166}
        offsetY={0}
      >
        <p>
          Click <strong>Manage</strong> on Judge.me Reviews to connect your account with a private API
          token. The wizard stays open while you add credentials.
        </p>
      </WizardTooltip>

      <WizardTooltip
        anchorRect={csvAnchor}
        className="ppWizardTooltip-csv"
        title="Upload reviews by CSV"
        eyebrow="Works with any provider"
        estimatedHeight={250}
        forceSide="bottom"
        offsetY={60}
        preferredWidth={392}
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

function ProductsWizardStep({ targetRects, productsState, quickScanStarted, quickScanJobActive, quickScanStepCompleted, openModal }) {
  if (openModal) return null;

  if (!quickScanStepCompleted || !productsState.hasCandidates) {
    const anchor = targetRects.quickScan;
    if (!anchor) {
      return <WizardLoadingCard title="Opening Products" body="We are locating the Candidates tab and Catalog Scan button." />;
    }

    let quickScanTitle = "Run Catalog Scan";
    let quickScanBody = "Click Run Catalog Scan to create lightweight product-risk candidates from your catalog. The wizard stays open while confirmation modals appear.";
    if (quickScanJobActive) {
      quickScanTitle = "Catalog Scan is running";
      quickScanBody = "ProductPulse is scanning the catalog. Keep the wizard open; when the Catalog Scan job finishes, this step will move to the candidate products.";
    } else if (quickScanStarted) {
      quickScanTitle = "Starting Catalog Scan";
      quickScanBody = "ProductPulse is waiting for the Catalog Scan background job to start. Keep the wizard open while the scan modal stays visible.";
    }

    return (
      <WizardTooltip
        anchorRect={anchor}
        className="ppWizardTooltip-products"
        title={quickScanTitle}
        eyebrow="Products"
      >
        <p>{quickScanBody}</p>
      </WizardTooltip>
    );
  }

  const anchor = targetRects.deepScanAction || targetRects.candidateRows;
  if (!anchor) {
    return <WizardLoadingCard title="Candidates ready" body="We are locating the candidate rows and Product Diagnosis action." />;
  }

  return (
    <WizardTooltip
      anchorRect={anchor}
      className="ppWizardTooltip-products"
      title="Select a candidate and run Product Diagnosis"
      eyebrow="Candidates"
      estimatedHeight={150}
      forceSide="bottom"
      preferredWidth={380}
      offsetY={4}
    >
      <p>
        Candidate products are Catalog Scan results that still need Product Diagnosis. Select one row,
        then use the highlighted Run Product Diagnosis action in the toolbar to queue a Product Diagnosis for that product.
      </p>
    </WizardTooltip>
  );
}

function BackgroundProcessesWizardStep({ targetRects }) {
  const anchor = targetRects.backgroundProcessPopover || targetRects.backgroundProcessButton;
  if (!anchor) {
    return <WizardLoadingCard title="Opening Background processes" body="We are opening the process monitor for the Product Diagnosis." />;
  }

  return (
      <WizardTooltip
        anchorRect={anchor}
        className="ppWizardTooltip-backgroundProcesses"
        title="Track the Product Diagnosis"
        eyebrow="Background processes"
        estimatedHeight={292}
        forceSide="left"
        offsetY={24}
        preferredWidth={408}
      >
      <p>
        ProductPulse is running the Product Diagnosis in the background. During this process, the
        system reviews the product context, recent signals, review evidence, return patterns,
        support hints, and catalog metadata to understand what may be causing the risk.
      </p>
      <p>
        The analysis uses AI-assisted reasoning and product-signal scoring to separate useful
        evidence from noise, compare possible causes, and prepare a diagnosis with recommended
        actions. Please wait; this can take a few minutes depending on the amount of evidence.
      </p>
      <div className="ppWizardProcessingStatus" role="status" aria-live="polite">
        <span className="ppWizardInlineSpinner" aria-hidden="true" />
        <span>Product Diagnosis is still running...</span>
      </div>
    </WizardTooltip>
  );
}

function DeepScanCompleteWizardStep({ targetRects, completedJob }) {
  const anchor = targetRects.completionNoticeAction || targetRects.completionNotice;
  if (!anchor) {
    return <WizardLoadingCard title="Product Diagnosis complete" body="We are locating the completion message for the finished Product Diagnosis." />;
  }

  return (
    <WizardTooltip
      anchorRect={anchor}
      className="ppWizardTooltip-deepScanComplete"
      title="Product Diagnosis complete"
      eyebrow="Product ready"
      estimatedHeight={154}
      forceSide="bottom"
      preferredWidth={390}
      offsetY={10}
    >
      <p>
        {completedJob?.productTitle || completedJob?.displayTitle || "This product"} is ready to review. Click <strong>Open product</strong> to see the Product Diagnosis details.
      </p>
    </WizardTooltip>
  );
}

function ProductOverviewWizardStep({ targetRects }) {
  const heroAnchor = targetRects.productHeroSummary || targetRects.productHero;
  const actionsAnchor = targetRects.productHeroActions || targetRects.productHero;

  if (!targetRects.productHero || !heroAnchor || !actionsAnchor) {
    return <WizardLoadingCard title="Opening product details" body="We are locating the product overview and action controls." />;
  }

  return (
    <>
      <WizardTooltip
        anchorRect={heroAnchor}
        className="ppWizardTooltip-productOverview"
        title="Product Diagnosis"
        eyebrow="Product details"
        estimatedHeight={164}
        preferredWidth={392}
        offsetY={-10}
      >
        <p>
          This is the Product Diagnosis detail page for the product. ProductPulse gathers the
          available product, review, return, support, and Shopify signals here so you can read the
          diagnosis with the key metrics in one place.
        </p>
      </WizardTooltip>

      <WizardTooltip
        anchorRect={actionsAnchor}
        className="ppWizardTooltip-productActions"
        title="Product actions"
        eyebrow="Product tools"
        estimatedHeight={156}
        preferredWidth={382}
        offsetY={8}
      >
        <p>
          These buttons hold the actions for this product: run the analysis again when new data
          changes, open Metric Timelines, or use the additional product actions from the menu.
        </p>
      </WizardTooltip>
    </>
  );
}

function ProductAnalysisPanelsWizardStep({ targetRects }) {
  const aiAnchor = targetRects.aiInterpretation;
  const actionsAnchor = targetRects.recommendedActions;

  if (!aiAnchor || !actionsAnchor) {
    return <WizardLoadingCard title="Opening analysis panels" body="We are locating AI Interpretation and Recommended Actions." />;
  }

  return (
    <>
      <WizardTooltip
        anchorRect={aiAnchor}
        className="ppWizardTooltip-aiInterpretation"
        title="AI Interpretation"
        eyebrow="Main finding"
        estimatedHeight={204}
        forceSide="vertical"
        preferredWidth={420}
        offsetY={-8}
      >
        <p>
          This is the most important point of the analysis. It is an AI interpretation across all
          product data ProductPulse knows: product context, review evidence, return signals,
          support signals, and scan results.
        </p>
        <p>
          Read it first to understand what ProductPulse found, including product failures,
          quality risks, or improvements that could make the product perform better.
        </p>
      </WizardTooltip>

      <WizardTooltip
        anchorRect={actionsAnchor}
        className="ppWizardTooltip-recommendedActions"
        title="Recommended Actions"
        eyebrow="Next steps"
        estimatedHeight={180}
        forceSide="top"
        preferredWidth={410}
        offsetY={-6}
      >
        <p>
          These actions are generated from the problems detected for this product. They are meant
          to help the team apply focused fixes that improve product quality and reduce repeated
          issues.
        </p>
      </WizardTooltip>
    </>
  );
}

function ChatAssistantWizardStep({ targetRects }) {
  const anchor = targetRects.chatLauncher;
  if (!anchor) {
    return <WizardLoadingCard title="Opening Pulse Guide" body="We are locating the chat assistant launcher." />;
  }

  return (
    <WizardTooltip
      anchorRect={anchor}
      className="ppWizardTooltip-chatAssistant"
      title="Meet Pulse Guide"
      eyebrow="Intelligent companion"
      estimatedHeight={190}
      preferredWidth={390}
      forceSide="top"
      offsetY={-4}
    >
      <p>
        Pulse Guide is your intelligent chat companion for ProductPulse. Ask it questions about this
        page, Product Diagnosis, evidence, metrics, candidates, watchlists, or what to do next.
      </p>
      <p>
        It can help you investigate details, understand what you are seeing, and move through tasks.
        Open it now to finish the guided setup.
      </p>
    </WizardTooltip>
  );
}

function WizardModalCoach({ modal }) {
  const copy = modalCopy[modal.kind];
  if (!copy || !modal.rect) return null;
  const placement = getTooltipPlacement(modal.rect, 0, 340);
  const sideClass = getWizardTooltipSideClass(placement.side);

  return (
    <aside
      className={`ppWizardModalCoach ${sideClass}`.trim()}
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

function WizardTooltip({
  anchorRect,
  className = "",
  title,
  eyebrow,
  children,
  offsetY = 0,
  preferredWidth = 360,
  estimatedHeight,
  forceSide,
  hideArrow = false,
  widthRatio,
  centered = false,
}) {
  const placement = getTooltipPlacement(anchorRect, offsetY, preferredWidth, { estimatedHeight, forceSide, widthRatio, centered });
  const sideClass = getWizardTooltipSideClass(placement.side);

  return (
    <aside
      className={`ppWizardTooltip ${sideClass} ${className}`.trim()}
      style={placement.style}
      role="dialog"
      aria-label={title}
    >
      {hideArrow ? null : <span className="ppWizardTooltipArrow" style={placement.arrowStyle} aria-hidden="true" />}
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
  onSkipStep,
}) {
  return (
    <footer className="ppWizardControlBar" role="group" aria-label="Wizard controls">
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
      clearWizardSpotlightElement(element);
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
      });
      nextRects[target.id] = getUnionRect(visibleElements);
    });

    setRects(nextRects);
  }, [targets]);

  useEffect(() => {
    if (!enabled) {
      document.querySelectorAll(".ppWizardSpotlightTarget").forEach((element) => {
        clearWizardSpotlightElement(element);
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
        clearWizardSpotlightElement(element);
      });
    };
  }, [enabled, measure, targetsKey]);

  return rects;
}

function clearWizardSpotlightElement(element) {
  element.classList.remove("ppWizardSpotlightTarget");
  element.style.removeProperty("--pp-wizard-target-top");
  element.style.removeProperty("--pp-wizard-target-left");
  element.style.removeProperty("--pp-wizard-target-width");
  element.style.removeProperty("--pp-wizard-target-height");
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
    { kind: "judgeme", selector: "#judgeme-connect-title" },
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

function getWizardTargets(step, hasCandidates, quickScanStepCompleted) {
  if (step.kind === "products") {
    return quickScanStepCompleted && hasCandidates ? productCandidateTargets : productQuickScanTargets;
  }
  return step.targets || emptyWizardTargets;
}

function getWizardControlLabels(step, productsState, deepScanStarted, quickScanStepCompleted, completedDeepScanJob) {
  if (step.kind === "products") {
    const next = !quickScanStepCompleted
      ? "Run Catalog Scan first"
      : productsState.hasCandidates
        ? deepScanStarted ? "Next" : "Waiting for Product Diagnosis"
        : "Waiting for candidates";
    return {
      back: "Back",
      next,
    };
  }
  if (step.kind === "backgroundProcesses") {
    return {
      back: "Back",
      next: deepScanStarted && !completedDeepScanJob ? "Waiting for Product Diagnosis" : "Finish",
    };
  }
  if (step.kind === "deepScanComplete") {
    return {
      back: "Back",
      next: "Open product first",
    };
  }
  if (step.kind === "productOverview") {
    return {
      back: "Back",
      next: "Next",
    };
  }
  if (step.kind === "productAnalysisPanels") {
    return {
      back: "Back",
      next: "Next",
    };
  }
  if (step.kind === "chatAssistant") {
    return {
      back: "Back",
      next: "Finish",
    };
  }
  return {
    back: "Back",
    next: step.kind === "welcome" ? "Next" : "Next",
  };
}

function getConnectCompletionMessage(provider) {
  if (provider === "judgemeReviews") return "Judge.me was connected. When you are ready, click Next to continue to Products.";
  if (provider === "csvReviews") return "CSV reviews were saved. When you are ready, click Next to continue to Products.";
  return "Source saved. When you are ready, click Next to continue to Products.";
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
  const requestedWidth = options.widthRatio ? viewportWidth * options.widthRatio : preferredWidth;
  const tooltipWidth = Math.min(requestedWidth, viewportWidth - 32);
  const estimatedHeight = options.estimatedHeight || 204;
  const gap = 18;
  const centerY = anchorRect.top + (anchorRect.height || 34) / 2;
  const canUseRight = viewportWidth - anchorRect.right >= tooltipWidth + gap + 16;
  const maxTop = viewportHeight - bottomBarHeight - estimatedHeight - 16;

  if (options.forceSide === "top" || (options.forceSide === "vertical" && anchorRect.top - estimatedHeight - gap + offsetY >= 16)) {
    const left = clamp(anchorRect.left, 16, viewportWidth - tooltipWidth - 16);
    const top = clamp(anchorRect.top - estimatedHeight - gap + offsetY, 16, maxTop);
    return {
      side: "top",
      style: {
        width: `${tooltipWidth}px`,
        left: `${left}px`,
        top: `${top}px`,
      },
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
      arrowStyle: {
        top: `${clamp(centerY - top, 22, estimatedHeight - 22)}px`,
      },
    };
  }

  if (options.forceSide !== "bottom" && options.forceSide !== "top" && options.forceSide !== "vertical" && (canUseRight || options.forceSide === "right")) {
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

  const left = options.centered
    ? clamp((viewportWidth - tooltipWidth) / 2, 16, viewportWidth - tooltipWidth - 16)
    : clamp(anchorRect.left, 16, viewportWidth - tooltipWidth - 16);
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

function getWizardTooltipSideClass(side) {
  if (side === "right") return "isRight";
  if (side === "left") return "isLeft";
  if (side === "top") return "isTop";
  return "isBottom";
}

function isCurrentWizardRoute(pathname, search, step) {
  if (step.kind === "welcome") return isDashboardRoute(pathname);
  if (step.kind === "backgroundProcesses") return true;
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

function clearWizardCompleted() {
  try {
    window.localStorage.removeItem(WIZARD_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the visible wizard can still restart for this session.
  }
}

function openBackgroundProcessesPopover() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("productpulse:wizard-open-background-processes"));
}
