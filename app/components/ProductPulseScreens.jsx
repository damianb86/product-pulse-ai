import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useFetcher, useNavigate, useNavigation, useRevalidator, useSubmit } from "react-router";
import {
  buildConnectViewData,
  chatMeConnectionLinks,
  CSV_REVIEW_IMPORT_DISPLAY_NAME,
  judgeMeConnectionLinks,
  setLocalCategoryIgnored,
  upsertLocalConnectionRecord,
} from "../lib/product-pulse-connect";

const PRODUCT_TABLE_ACTIVE_JOB_REFRESH_MS = 4_000;

export function DashboardScreen({ data, actionData }) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const [diagnosisConfirmation, setDiagnosisConfirmation] = useState(null);
  const dashboard = data.dashboard || {};
  const startProduct = dashboard.startProduct || null;
  const diagnosisHref = startProduct?.href || "/app/products";
  const dashboardKpis = dashboard.kpis || [];
  const evidenceMetrics = dashboard.evidenceMetrics || [];
  const topIssueBars = dashboard.issueBars || [];
  const suggestedFixes = dashboard.suggestedFixes || [];
  const insightPanels = dashboard.insightPanels || [];
  const nextStep = dashboard.nextStep || {
    title: "Review products",
    subtitle: "Open the product list",
    detail: "Run QuickScan or open a product diagnosis to start building the dashboard.",
    href: "/app/products",
    buttonLabel: "Go to Products",
  };
  const pendingDashboardDiagnosis = navigation.state === "submitting" && navigation.formData?.get("_action") === "diagnose";
  const startProductDiagnosisRunning = Boolean(startProduct?.diagnosisInProgress || startProduct?.diagnosisJob);

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success") setDiagnosisConfirmation(null);
  }, [actionData]);

  const handleRequestDashboardDiagnosis = () => {
    if (!startProduct || pendingDashboardDiagnosis || startProductDiagnosisRunning) return;
    setDiagnosisConfirmation({
      mode: "single",
      title: "Confirm product analysis",
      products: [startProduct.handle || startProduct.productId || ""],
      productTitles: [startProduct.title],
      count: 1,
      credits: 1,
    });
  };

  const handleConfirmDashboardDiagnosis = () => {
    const productId = diagnosisConfirmation?.products?.[0] || "";
    if (!productId || pendingDashboardDiagnosis) return;
    const formData = new FormData();
    formData.set("_action", "diagnose");
    formData.set("productId", productId);
    submit(formData, { method: "post" });
  };

  return (
    <FullWidthPage heading="Dashboard">
      <ScreenShell className="ppDashboard">
        <ActionBanner actionData={actionData} />
        <PermissionBanner permissionState={data.permissionState} />

        <p className="ppDashboardSubtitle">
          Product quality signals from reviews, returns, refunds and support.
        </p>

        <div className="ppDashboardKpis" aria-label="Product quality overview">
          {dashboardKpis.map((kpi) => (
            <DashboardKpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>

        <s-section padding="none">
          <div className="ppStartPanel">
            <div className="ppStartHeading">
              <DashboardIcon type="wand" tone="purple" size="small" />
              <h2>Start here</h2>
            </div>
            <div className="ppStartContent">
              {startProduct ? (
                <div className="ppStartProduct" title={startProduct.priorityReason}>
                  <ProductArt
                    variant={startProduct.variant || "shirt"}
                    label={startProduct.title}
                    size="large"
                    imageUrl={startProduct.imageUrl}
                    imageAlt={startProduct.imageAlt}
                  />
                  <div className="ppStartCopy">
                    <span>{startProduct.eyebrow || "Recommended next product to analyze"}</span>
                    <h3>{startProduct.title}</h3>
                    <div className="ppBadgeRow">
                      {(startProduct.badges || []).map((badge) => (
                        <InlineBadge key={`${badge.label}-${badge.tone}`} tone={badge.tone} icon={badge.icon}>{badge.label}</InlineBadge>
                      ))}
                    </div>
                    <p>{startProduct.summary}</p>
                  </div>
                </div>
              ) : (
                <div className="ppStartProduct ppStartProduct-empty">
                  <DashboardIcon type="search" tone="blue" />
                  <div className="ppStartCopy">
                    <span>No stored scan data yet</span>
                    <h3>Run QuickScan first</h3>
                    <p>ProductPulse will populate this dashboard after it stores product risk snapshots from Shopify signals.</p>
                  </div>
                </div>
              )}

              <div className="ppEvidenceGlance">
                <h3>Evidence at a glance</h3>
                <div className="ppEvidenceMetrics">
                  {evidenceMetrics.map((metric) => (
                    <EvidenceMetric key={metric.label} metric={metric} />
                  ))}
                </div>
              </div>

              <div className="ppStartActionPanel">
                {startProduct && !startProductDiagnosisRunning ? (
                  <button
                    className="ppPrimaryButton"
                    type="button"
                    disabled={pendingDashboardDiagnosis}
                    onClick={handleRequestDashboardDiagnosis}
                  >
                    <s-icon type="wand" size="small"></s-icon>
                    <span>{pendingDashboardDiagnosis ? "Queueing..." : startProduct.actionLabel || "Run product diagnosis"}</span>
                  </button>
                ) : (
                  <Link className="ppPrimaryButton" to={diagnosisHref}>
                    <s-icon type="product" size="small"></s-icon>
                    <span>{startProductDiagnosisRunning ? "View running product" : "Go to Products"}</span>
                  </Link>
                )}
                <span>{startProductDiagnosisRunning ? getDashboardDiagnosisJobLabel(startProduct.diagnosisJob) : startProduct?.actionHint || "Start with QuickScan"}</span>
              </div>
            </div>
          </div>
        </s-section>

        {diagnosisConfirmation && (
          <ProductAnalysisConfirmModal
            confirmation={diagnosisConfirmation}
            pending={pendingDashboardDiagnosis}
            pendingIds={pendingDashboardDiagnosis ? diagnosisConfirmation.products : []}
            onCancel={() => setDiagnosisConfirmation(null)}
            onConfirm={handleConfirmDashboardDiagnosis}
          />
        )}

        <div className="ppDashboardInsights">
          {insightPanels.map((panel) => (
            <s-section padding="none" key={panel.title}>
              <DashboardInsightPanel panel={panel} />
            </s-section>
          ))}
        </div>

        <div className="ppDashboardBottom">
          <s-section padding="none">
            <div className="ppDashboardPanel">
              <h2>Top issues</h2>
              <div className="ppIssueBars">
                {topIssueBars.map((issue) => (
                  <IssueBar key={issue.label} issue={issue} />
                ))}
              </div>
              <s-link href="/app/analytics">View all issues</s-link>
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppDashboardPanel">
              <h2>Suggested fixes</h2>
              <div className="ppFixList">
                {suggestedFixes.map((fix) => (
                  <SuggestedFix key={fix.label} fix={fix} />
                ))}
              </div>
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppNextStepPanel">
              <DashboardIcon type="wand" tone="purple" />
              <div>
                <h2>Next step</h2>
                <h3>{nextStep.subtitle}</h3>
                <p>{nextStep.detail}</p>
                <Link className="ppNextStepButton" to={nextStep.href || diagnosisHref}>
                  <s-icon type="product" size="small"></s-icon>
                  <span>{nextStep.buttonLabel || nextStep.title}</span>
                </Link>
              </div>
            </div>
          </s-section>
        </div>
      </ScreenShell>
    </FullWidthPage>
  );
}

function getDashboardDiagnosisJobLabel(job) {
  const status = String(job?.status || "").toLowerCase();
  if (status === "running") return "Product diagnosis is running";
  if (status === "queued") return "Product diagnosis is queued";
  return "Product diagnosis is already in progress";
}

function getProductDiagnosisRunningLabel(job) {
  const status = String(job?.status || "").toLowerCase();
  if (status === "queued") return "Diagnosis queued";
  return "Diagnosis running";
}

const coverageUnlocks = [
  { icon: "target", title: "More accurate issue detection", detail: "ProductPulse can separate product defects from expectation gaps." },
  { icon: "clock", title: "Faster root-cause analysis", detail: "Signals from reviews, returns and support are grouped into one diagnosis." },
  { icon: "wand", title: "Better recommended fixes", detail: "Actions become more specific when the system sees the full customer journey." },
  { icon: "shield-check-mark", title: "Cleaner coverage score", detail: "Ignored categories stop creating false missing-data warnings." },
];

export function ConnectScreen({ data, actionData }) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const [records, setRecords] = useState(() => data?.connect?.records || []);
  const [activeModal, setActiveModal] = useState(null);
  const [localToast, setLocalToast] = useState(null);
  const [localConnecting, setLocalConnecting] = useState(false);
  const persistConnectState = Boolean(data?.persistConnectState);
  const connectView = buildConnectViewData(records);
  const isSubmitting = navigation.state === "submitting";
  const pendingAction = isSubmitting ? String(navigation.formData?.get("_action") || "") : "";
  const pendingSourceKey = isSubmitting ? String(navigation.formData?.get("sourceKey") || "") : "";
  const judgeMeSource = connectView.signalCategories
    .flatMap((category) => category.sources)
    .find((source) => source.key === "judgemeReviews");
  const chatMeSource = connectView.signalCategories
    .flatMap((category) => category.sources)
    .find((source) => source.key === "chatmeReviews");
  const csvSource = connectView.signalCategories
    .flatMap((category) => category.sources)
    .find((source) => source.key === "csvReviews");
  const csvActionData = actionData?.providerKey === "csvReviews" ? actionData : null;

  useEffect(() => {
    setRecords(data?.connect?.records || []);
  }, [data?.connect?.records]);

  useEffect(() => {
    if (actionData?.status === "success") {
      setActiveModal(null);
    }
  }, [actionData]);

  const toggleIgnored = (category) => {
    const ignored = !category.ignored;
    setRecords((current) => setLocalCategoryIgnored(current, category.id, ignored));
    if (persistConnectState) {
      const formData = new FormData();
      formData.set("_action", "set-category-ignored");
      formData.set("categoryId", category.id);
      formData.set("ignored", String(ignored));
      submit(formData, { method: "post" });
    }
  };

  const handleLocalJudgeMeConnect = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const token = String(formData.get("privateApiToken") || "").trim();
    if (!token) {
      setLocalToast({ status: "validation_error", message: "Enter the Judge.me private API token before connecting." });
      return;
    }

    setLocalConnecting(true);
    window.setTimeout(() => {
      setRecords((current) => upsertLocalConnectionRecord(current, "judgemeReviews", {
        connected: true,
        active: true,
        ignored: false,
        available: true,
        health: "connected",
        config: { tokenLast4: token.slice(-4), provider: "Judge.me Reviews" },
        connectedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      }));
      setLocalConnecting(false);
      setActiveModal(null);
      setLocalToast({ status: "success", message: "Connected to Judge.me." });
    }, 450);
  };

  const handleLocalChatMeConnect = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const token = String(formData.get("privateApiToken") || "").trim();
    if (!token) {
      setLocalToast({ status: "validation_error", message: "Enter the ChatMe private API token before connecting." });
      return;
    }

    setLocalConnecting(true);
    window.setTimeout(() => {
      setRecords((current) => upsertLocalConnectionRecord(current, "chatmeReviews", {
        connected: true,
        active: true,
        ignored: false,
        available: true,
        health: "connected",
        config: { tokenLast4: token.slice(-4), provider: "ChatMe Reviews" },
        connectedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      }));
      setLocalConnecting(false);
      setActiveModal(null);
      setLocalToast({ status: "success", message: "Connected to ChatMe." });
    }, 450);
  };

  const handleLocalCsvUpload = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get("csvFile");
    const originalFileName = file?.name || "reviews.csv";
    const fileName = CSV_REVIEW_IMPORT_DISPLAY_NAME;
    setRecords((current) => upsertLocalConnectionRecord(current, "csvReviews", {
      connected: true,
      active: true,
      ignored: false,
      available: true,
      health: "connected",
      config: { fileName, displayFileName: fileName, originalFileName, uploadedAt: new Date().toISOString() },
      connectedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    }));
    setActiveModal(null);
    setLocalToast({ status: "success", message: `${fileName} is ready for review analysis.` });
  };

  const handleLocalActiveChange = (source, active) => {
    setRecords((current) => upsertLocalConnectionRecord(current, source.key, {
      connected: source.connected,
      available: source.available,
      active,
      health: active ? "connected" : "disabled",
      disabledAt: active ? null : new Date().toISOString(),
    }));
  };

  return (
    <FullWidthPage label="Connect" className="ppConnectPage">
      <ScreenShell className="ppDashboard ppConnectScreen">
        <ActionBanner actionData={localToast || actionData} hideSuccess />
        <ConnectionToast actionData={localToast || actionData} />

        <div className="ppConnectHeader">
          <div>
            <h1>Connect your sources</h1>
            <p>Select the customer signals ProductPulse will analyze.</p>
          </div>
        </div>

        <div className="ppConnectLayout">
          <div className="ppConnectMain">
            {connectView.signalCategories.map((category) => (
              <ConnectCategoryCard
                key={category.id}
                category={category}
                onToggleIgnored={toggleIgnored}
                onOpenJudgeMe={() => setActiveModal("judgeme")}
                onOpenChatMe={() => setActiveModal("chatme")}
                onOpenCsv={() => setActiveModal("csv")}
                onLocalActiveChange={handleLocalActiveChange}
                persistConnectState={persistConnectState}
                pendingSourceKey={pendingSourceKey}
              />
            ))}
            <ConnectCategoryCard
              category={connectView.productDataCategory}
              locked
              persistConnectState={persistConnectState}
              pendingSourceKey={pendingSourceKey}
            />

            <p className="ppConnectHelp">
              Need help connecting a source? <s-link href="/app/connect">View our setup guide</s-link>
              <s-icon type="external" size="small"></s-icon>
            </p>
          </div>

          <aside className="ppConnectAside">
            <s-section padding="none">
              <ConnectCoverageCard
                categories={connectView.signalCategories}
                coverage={connectView.coverage}
                activeWeight={connectView.activeWeight}
              />
            </s-section>

            <s-section padding="none">
              <div className="ppConnectInfoCard">
                <h2>What better coverage unlocks</h2>
                <div className="ppCoverageUnlockList">
                  {coverageUnlocks.map((item) => (
                    <p key={item.title}>
                      <s-icon type={item.icon} size="small"></s-icon>
                      <span>
                        <strong>{item.title}</strong>
                        {item.detail}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            </s-section>

            <s-section padding="none">
              <div className="ppConnectInfoCard ppCoverageRulesCard">
                <h2>Coverage rules</h2>
                <p>
                  Shopify product and order data is always available as baseline context and is not
                  counted in this customer-signal coverage score.
                </p>
                <p>
                  If your store does not use a category, ignore it and ProductPulse will treat it as
                  complete for coverage purposes.
                </p>
              </div>
            </s-section>
          </aside>
        </div>

        <div className="ppConnectFooter">
          <span>{connectView.coverage}% effective customer-signal coverage</span>
          <button className="ppPrimaryButton" type="button">Continue</button>
        </div>

        {activeModal === "judgeme" && (
          <JudgeMeConnectionModal
            source={judgeMeSource}
            persistConnectState={persistConnectState}
            isConnecting={pendingAction === "connect-judgeme" || localConnecting}
            onCancel={() => setActiveModal(null)}
            onLocalSubmit={handleLocalJudgeMeConnect}
          />
        )}

        {activeModal === "chatme" && (
          <ChatMeConnectionModal
            source={chatMeSource}
            persistConnectState={persistConnectState}
            isConnecting={pendingAction === "connect-chatme" || localConnecting}
            onCancel={() => setActiveModal(null)}
            onLocalSubmit={handleLocalChatMeConnect}
          />
        )}

        {activeModal === "csv" && (
          <CsvUploadModal
            source={csvSource}
            persistConnectState={persistConnectState}
            isUploading={pendingAction === "upload-csv"}
            actionData={csvActionData}
            onCancel={() => setActiveModal(null)}
            onLocalSubmit={handleLocalCsvUpload}
          />
        )}
      </ScreenShell>
    </FullWidthPage>
  );
}

export function ProductsScreen({ data, filters = {}, actionData }) {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopifyProductSearchFetcher = useFetcher();
  const [localFastScan, setLocalFastScan] = useState(false);
  const [localSortConfig, setLocalSortConfig] = useState(null);
  const [openActionProduct, setOpenActionProduct] = useState(null);
  const [selectedProducts, setSelectedProducts] = useState(() => new Set());
  const [searchOpen, setSearchOpen] = useState(Boolean(filters.query));
  const [searchValue, setSearchValue] = useState(filters.query || "");
  const [shopifyProductSearchOpen, setShopifyProductSearchOpen] = useState(false);
  const [shopifyProductSearchQuery, setShopifyProductSearchQuery] = useState("");
  const [quickScanConfirmation, setQuickScanConfirmation] = useState(false);
  const [analysisConfirmation, setAnalysisConfirmation] = useState(null);
  const productTableRows = data.productTable?.rows;
  const productRows = useMemo(() => productTableRows || [], [productTableRows]);
  const productCount = data.productTable?.total ?? productRows.length;
  const totalAllProducts = data.productTable?.totalAll ?? productCount;
  const filterOptions = data.productTable?.filterOptions || {};
  const page = data.productTable?.page || 1;
  const rowsPerPage = data.productTable?.rowsPerPage || Number(filters.rows || 25);
  const totalPages = data.productTable?.totalPages || 1;
  const activeScanJob = data.productTable?.activeScanJob || null;
  const activeDiagnosisJobs = data.productTable?.activeDiagnosisJobs || [];
  const persistProductJobs = Boolean(data.persistProductJobs);
  const pendingFastScan = navigation.state === "submitting" && navigation.formData?.get("_action") === "fast-product-scan";
  const pendingBulkAnalyze = navigation.state === "submitting" && navigation.formData?.get("_action") === "bulk-diagnose";
  const pendingAnalyzeIds = pendingBulkAnalyze ? Array.from(navigation.formData?.getAll("productId") || []).map(String) : [];
  const fastScanRunning = Boolean(activeScanJob) || pendingFastScan || localFastScan;
  const sortConfig = localSortConfig || (filters.sort ? { key: filters.sort, direction: filters.direction || "desc" } : null);
  const visibleProductKeys = productRows.map(getProductActionKey);
  const selectedCount = selectedProducts.size;
  const allVisibleSelected = visibleProductKeys.length > 0 && visibleProductKeys.every((key) => selectedProducts.has(key));
  const hasVisibleSelection = visibleProductKeys.some((key) => selectedProducts.has(key));
  const currentSearchQuery = filters.query || "";
  const shopifyProductSearchData = shopifyProductSearchFetcher.data || {};
  const shopifyProductSearchResults = shopifyProductSearchQuery.trim().length >= 2
    ? shopifyProductSearchData.products || []
    : [];
  const shopifyProductSearchPending = shopifyProductSearchFetcher.state !== "idle";
  const shopifyProductSearchError = shopifyProductSearchData.status === "validation_error"
    ? shopifyProductSearchData.message
    : "";
  const submitProductFilters = (overrides = {}) => {
    submit(buildProductFilterFormData(filters, { rows: String(rowsPerPage), ...overrides }), { method: "get", replace: true });
  };

  useEffect(() => {
    const hasProductDiagnosisJobs = activeDiagnosisJobs.length > 0 || productRows.some((product) => product.diagnosisJob);
    if ((!activeScanJob && !hasProductDiagnosisJobs) || !persistProductJobs) return undefined;
    const interval = window.setInterval(() => revalidator.revalidate(), PRODUCT_TABLE_ACTIVE_JOB_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [activeDiagnosisJobs.length, activeScanJob, persistProductJobs, productRows, revalidator]);

  useEffect(() => {
    setLocalSortConfig(null);
  }, [filters.sort, filters.direction]);

  useEffect(() => {
    setSearchValue(currentSearchQuery);
    setSearchOpen(Boolean(currentSearchQuery));
  }, [currentSearchQuery]);

  useEffect(() => {
    if (searchValue === currentSearchQuery) return undefined;
    const timeout = window.setTimeout(() => {
      submit(
        buildProductFilterFormData(filters, { rows: String(rowsPerPage), query: searchValue, page: "1" }),
        { method: "get", replace: true },
      );
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [
    searchValue,
    currentSearchQuery,
    filters.risk,
    filters.status,
    filters.issue,
    filters.source,
    filters.vendor,
    filters.rows,
    filters.sort,
    filters.direction,
    filters,
    rowsPerPage,
    submit,
  ]);

  useEffect(() => {
    if (!shopifyProductSearchOpen) return undefined;
    const query = shopifyProductSearchQuery.trim();
    if (query.length < 2) return undefined;

    const timeout = window.setTimeout(() => {
      const formData = new FormData();
      formData.set("_action", "search-shopify-products");
      formData.set("query", query);
      shopifyProductSearchFetcher.submit(formData, { method: "post" });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [shopifyProductSearchFetcher, shopifyProductSearchOpen, shopifyProductSearchQuery]);

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success" && (actionData?.analyzedCount || actionData?.queuedCount)) {
      setSelectedProducts(new Set());
      setAnalysisConfirmation(null);
      setShopifyProductSearchOpen(false);
    }
  }, [actionData]);

  const handleLocalFastScan = () => {
    setLocalFastScan(true);
    window.setTimeout(() => setLocalFastScan(false), 15_000);
  };

  const handleStartFastScan = () => {
    if (fastScanRunning) return;
    setQuickScanConfirmation(true);
  };

  const handleConfirmFastScan = () => {
    if (fastScanRunning) return;
    setQuickScanConfirmation(false);
    if (!persistProductJobs) {
      handleLocalFastScan();
      return;
    }

    const formData = new FormData();
    formData.set("_action", "fast-product-scan");
    submit(formData, { method: "post" });
  };

  const handleSort = (key) => {
    const nextDirection = sortConfig?.key === key && sortConfig.direction === "desc" ? "asc" : "desc";
    setLocalSortConfig({ key, direction: nextDirection });
    submitProductFilters({ sort: key, direction: nextDirection, page: "1" });
  };

  const handleFilterChange = (event) => {
    const target = event.target;
    if (!target?.name) return;
    submitProductFilters({ [target.name]: target.value, page: "1" });
  };

  const handleToggleAllVisible = () => {
    setSelectedProducts((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleProductKeys.forEach((key) => next.delete(key));
      } else {
        visibleProductKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  const handleToggleProduct = (product) => {
    const key = getProductActionKey(product);
    setSelectedProducts((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAnalyzeSelected = () => {
    if (!selectedCount || pendingBulkAnalyze) return;
    const selectedIds = Array.from(selectedProducts);
    const selectedRows = productRows.filter((product) => selectedProducts.has(getProductActionKey(product)));
    setAnalysisConfirmation({
      mode: "bulk",
      title: "Confirm selected product analysis",
      products: selectedIds,
      productTitles: selectedRows.map((product) => product.title),
      count: selectedIds.length,
      credits: selectedIds.length,
    });
  };

  const handleAnalyzeProduct = (product) => {
    if (pendingBulkAnalyze) return;
    const productId = getProductActionKey(product);
    setOpenActionProduct(null);
    setAnalysisConfirmation({
      mode: "single",
      title: "Confirm product analysis",
      products: [productId],
      productTitles: [product.title],
      count: 1,
      credits: product.credits || 1,
    });
  };

  const handleAnalyzeShopifyProduct = (product) => {
    if (pendingBulkAnalyze || !product?.id) return;
    setShopifyProductSearchOpen(false);
    setAnalysisConfirmation({
      mode: "shopify-product",
      title: "Confirm product analysis",
      products: [product.id],
      productTitles: [product.title],
      count: 1,
      credits: 1,
    });
  };

  const handleConfirmAnalysis = () => {
    if (!analysisConfirmation?.products?.length || pendingBulkAnalyze) return;
    const formData = new FormData();
    formData.set("_action", "bulk-diagnose");
    analysisConfirmation.products.forEach((productId) => formData.append("productId", productId));
    submit(formData, { method: "post" });
  };

  return (
    <FullWidthPage heading="Products">
      <ScreenShell className={`ppDashboard ppProductsScreen ${fastScanRunning ? "isScanning" : ""}`.trim()}>
        <div className="ppProductsContent">
          <div className="ppProductsHeader">
            <p className="ppDashboardSubtitle">
              Browse products, review risk signals and run AI diagnosis.
            </p>
            <div className="ppProductsHeaderActions">
              <button
                className="ppSecondaryActionButton ppShopifyProductSearchButton"
                type="button"
                onClick={() => setShopifyProductSearchOpen(true)}
              >
                <s-icon type="search" size="small"></s-icon>
                Find Shopify product
              </button>
              <FastScanButton
                pending={fastScanRunning}
                onStart={handleStartFastScan}
              />
            </div>
          </div>
          <ActionBanner actionData={actionData} />

          <s-section padding="none">
            <div className="ppProductsToolbar">
              <div className="ppProductsFilters" aria-label="Product filters" onChange={handleFilterChange}>
                <ProductFilterSelect name="risk" label="Risk" value={filters.risk || "all"} options={filterOptions.risks} />
                <ProductFilterSelect name="status" label="Status" value={filters.status || "all"} options={filterOptions.statuses} />
                <ProductFilterSelect name="issue" label="Issue type" value={filters.issue || "all"} options={filterOptions.issues} />
                <ProductFilterSelect name="source" label="Source" value={filters.source || "all"} options={filterOptions.sources} />
                <ProductFilterSelect name="vendor" label="Vendor or Collection" value={filters.vendor || "all"} options={filterOptions.vendors} vendor />
              </div>
              <div className="ppProductsSecondaryActions">
                <button className="ppPrimaryButton" type="button" disabled={selectedCount === 0 || pendingBulkAnalyze} onClick={handleAnalyzeSelected}>
                  <s-icon type="wand" size="small"></s-icon>
                  {pendingBulkAnalyze ? "Analyzing..." : `Analyze selected (${selectedCount})`}
                </button>
                <Link className="ppSecondaryActionButton" to="/app/products">
                  <s-icon type="x" size="small"></s-icon>
                  Clear filters
                </Link>
              </div>
            </div>
          </s-section>

          <s-section className="ppProductsTableSection" padding="none">
            <div className="ppProductsTableStatus">
              {selectedCount > 0 && productRows.length > 0 && (
              <div className="ppSelectionPill">
                <span>{selectedCount}</span>
                selected
                <button type="button" aria-label="Clear selected products" onClick={() => setSelectedProducts(new Set())}>
                  <s-icon type="x" size="small"></s-icon>
                </button>
              </div>
              )}
              <span>{productRows.length > 0 ? `${productRows.length} of ${productCount} products${totalAllProducts !== productCount ? ` (${totalAllProducts} scanned)` : ""}` : "No products in ProductPulse yet"}</span>
              <div className="ppProductsTableTools">
                <button
                  className="ppTableSearchButton"
                  type="button"
                  aria-label="Search products"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen((open) => !open)}
                >
                  <s-icon type="search" size="small"></s-icon>
                </button>
                {searchOpen && (
                  <div className="ppTableSearchControl">
                    <s-icon type="search" size="small"></s-icon>
                    <input
                      aria-label="Search products"
                      value={searchValue}
                      onChange={(event) => setSearchValue(event.target.value)}
                      placeholder="Search products"
                      type="search"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="ppProductsTableWrap">
            <table className="ppProductsTable" data-testid="products-table">
              <thead>
                <tr>
                  <th aria-label="Select products">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      aria-checked={hasVisibleSelection && !allVisibleSelected ? "mixed" : allVisibleSelected}
                      aria-label="Select all visible products"
                      onChange={handleToggleAllVisible}
                    />
                  </th>
                  <th>Product</th>
                  <th>
                    <SortableHeader
                      active={sortConfig?.key === "riskScore"}
                      direction={sortConfig?.direction}
                      label="Risk score"
                      onSort={() => handleSort("riskScore")}
                    />
                  </th>
                  <th>Status</th>
                  <th>Analysis</th>
                  <th>Signals</th>
                  <th>Main suspected issue</th>
                  <th>Sources</th>
                  <th>
                    <SortableHeader
                      active={sortConfig?.key === "lastAnalysis"}
                      direction={sortConfig?.direction}
                      label="Last analysis"
                      onSort={() => handleSort("lastAnalysis")}
                    />
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {productRows.length === 0 && (
                  <tr className="ppProductsEmptyRow">
                    <td colSpan="10">
                      <div className="ppProductsEmptyState">
                        <DashboardIcon type="search" tone="blue" />
                        <div>
                          <h2>No scanned products yet</h2>
                          <p>Run a quick catalog scan to look for early product quality signals across your store.</p>
                        </div>
                        <FastScanButton
                          pending={fastScanRunning}
                          onStart={handleStartFastScan}
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {productRows.map((product) => {
                  const actionKey = getProductActionKey(product);
                  const selected = selectedProducts.has(actionKey);
                  const diagnosisState = getProductDiagnosisState(product, pendingAnalyzeIds);

                  const rowClassName = [
                    diagnosisState ? "isDiagnosing" : "",
                    product.resolvedAt ? "isResolved" : "",
                  ].filter(Boolean).join(" ");

                  return (
                    <tr className={rowClassName} key={actionKey}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected}
                          aria-label={`Select ${product.title}`}
                          onChange={() => handleToggleProduct(product)}
                        />
                      </td>
                      <td>
                        <Link className="ppProductsProductCell" to={product.href}>
                          <span className="ppProductImageWrap">
                            <ProductArt
                              variant={product.variant}
                              label={product.title}
                              imageUrl={product.imageUrl}
                              imageAlt={product.imageAlt}
                            />
                            {diagnosisState && (
                              <span className="ppProductDiagnosisLoader" aria-label={`${diagnosisState.label} for ${product.title}`}>
                                <span aria-hidden="true" />
                              </span>
                            )}
                          </span>
                          <span className="ppProductsProductText">
                            <span>{product.title}</span>
                            {diagnosisState && <small>{diagnosisState.label}</small>}
                            {product.resolvedAt && (
                              <small className="ppResolvedProductMarker">
                                <s-icon type="check" size="small"></s-icon>
                                {product.resolvedLabel || "Resolved"}
                              </small>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <div className="ppRiskScoreCell">
                          <s-badge tone={product.riskTone}>{product.risk}</s-badge>
                          <span>{product.riskScore}</span>
                        </div>
                      </td>
                      <td><s-badge tone={product.statusTone}>{product.status}</s-badge></td>
                      <td><ProductAnalysisStatusBadge product={product} showLabel={false} /></td>
                      <td>
                        <ProductSignalCell product={product} />
                      </td>
                      <td>{product.issue}</td>
                      <td><ProductSourceIconGroup sources={product.sources} overflow={product.sourceOverflow} /></td>
                      <td>{product.lastAnalysis}</td>
                      <td>
                        <div className="ppTableAction">
                          <button
                            className="ppAnalyzeLinkButton ppAnalyzeIconOnly"
                            type="button"
                            aria-label={`Analyze ${product.title}`}
                            disabled={pendingBulkAnalyze}
                            onClick={() => handleAnalyzeProduct(product)}
                          >
                            <s-icon type="wand" size="small"></s-icon>
                          </button>
                          <ProductActionMenu
                            product={product}
                            open={openActionProduct === actionKey}
                            onToggle={() => setOpenActionProduct((current) => (current === actionKey ? null : actionKey))}
                            onClose={() => setOpenActionProduct(null)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {productRows.length > 0 && (
            <div className="ppProductsPagination">
              <label className="ppRowsSelect">
                Rows per page
                <select value={rowsPerPage} onChange={(event) => submitProductFilters({ rows: event.target.value, page: "1" })}>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
              </label>
              <div className="ppPageControls" aria-label="Pagination">
                {page > 1 ? (
                  <Link to={buildProductFilterHref(filters, { rows: rowsPerPage, page: page - 1 })} aria-label="Previous page">
                    <s-icon type="chevron-left" size="small"></s-icon>
                  </Link>
                ) : (
                  <button type="button" aria-label="Previous page" disabled>
                    <s-icon type="chevron-left" size="small"></s-icon>
                  </button>
                )}
                {getVisiblePages(page, totalPages).map((pageNumber) => (
                  <Link
                    className={pageNumber === page ? "isActive" : ""}
                    to={buildProductFilterHref(filters, { rows: rowsPerPage, page: pageNumber })}
                    key={pageNumber}
                  >
                    {pageNumber}
                  </Link>
                ))}
                {page < totalPages ? (
                  <Link to={buildProductFilterHref(filters, { rows: rowsPerPage, page: page + 1 })} aria-label="Next page">
                    <s-icon type="chevron-right" size="small"></s-icon>
                  </Link>
                ) : (
                  <button type="button" aria-label="Next page" disabled>
                    <s-icon type="chevron-right" size="small"></s-icon>
                  </button>
                )}
              </div>
            </div>
          )}
          </s-section>
        </div>
      </ScreenShell>
      {fastScanRunning && (
        <div className="ppProductsScanOverlay" role="status">
          <div>
            <span className="ppScanSpinner" aria-hidden="true" />
            <h2>Fast product scan running</h2>
            <p>
              ProductPulse is checking the catalog for potential quality signals. You can leave this page;
              the backend job will keep running.
            </p>
            <small>{activeScanJob ? activeScanJob.source : "Starting scan..."}</small>
          </div>
        </div>
      )}
      {shopifyProductSearchOpen && (
        <ShopifyProductSearchModal
          query={shopifyProductSearchQuery}
          results={shopifyProductSearchResults}
          pending={shopifyProductSearchPending}
          error={shopifyProductSearchError}
          onAnalyze={handleAnalyzeShopifyProduct}
          onCancel={() => setShopifyProductSearchOpen(false)}
          onQueryChange={setShopifyProductSearchQuery}
        />
      )}
      {analysisConfirmation && (
        <ProductAnalysisConfirmModal
          confirmation={analysisConfirmation}
          pending={pendingBulkAnalyze}
          pendingIds={pendingAnalyzeIds}
          onCancel={() => setAnalysisConfirmation(null)}
          onConfirm={handleConfirmAnalysis}
        />
      )}
      {quickScanConfirmation && (
        <QuickScanConfirmModal
          pending={pendingFastScan}
          onCancel={() => setQuickScanConfirmation(false)}
          onConfirm={handleConfirmFastScan}
        />
      )}
    </FullWidthPage>
  );
}

export function SettingsScreen({ data = {}, actionData }) {
  const navigation = useNavigation();
  const settings = actionData?.settings || data.settings || getDefaultProductPulseClientSettings();
  const isSaving = navigation.state === "submitting";
  const batchEnabled = Boolean(settings.diagnosis?.useOpenAiBatchForDiagnostics);

  return (
    <FullWidthPage heading="Settings" className="ppSettingsPage">
      <ScreenShell className="ppDashboard ppSettingsScreen">
        <div className="ppSettingsHero">
          <div>
            <span>ProductPulse controls</span>
            <h2>Workspace controls</h2>
            <p>
              Tune how ProductPulse classifies product risk, keeps QuickScan candidates, and queues detailed AI diagnosis work.
            </p>
          </div>
          <div className="ppSettingsHeroSummary" aria-label="Current risk threshold summary">
            <strong>{settings.risk.highThreshold}+</strong>
            <span>High risk</span>
            <small>QuickScan keeps products from {settings.risk.minimumScore}+ risk score.</small>
          </div>
        </div>

        <ActionBanner actionData={actionData} />

        <Form method="post" className="ppSettingsForm">
          <input type="hidden" name="_action" value="save-settings" />

          <section className="ppSettingsCard ppSettingsRiskCard" aria-labelledby="settings-risk-title">
            <div className="ppSettingsCardHeader">
              <DashboardIcon type="target" tone="blue" />
              <div>
                <span>Risk scoring</span>
                <h2 id="settings-risk-title">Risk score thresholds</h2>
                <p>
                  Control which products ProductPulse keeps after QuickScan and where low, medium and high risk start.
                </p>
              </div>
            </div>

            <div className="ppSettingsRiskPreview">
              <span style={{ width: `${settings.risk.minimumScore}%` }}>Ignored</span>
              <span style={{ width: `${Math.max(8, settings.risk.mediumThreshold - settings.risk.minimumScore)}%` }}>Low</span>
              <span style={{ width: `${Math.max(8, settings.risk.highThreshold - settings.risk.mediumThreshold)}%` }}>Medium</span>
              <span style={{ width: `${Math.max(8, 100 - settings.risk.highThreshold)}%` }}>High</span>
            </div>

            <div className="ppSettingsFieldGrid">
              <SettingsNumberField
                name="minimumScore"
                label="Minimum QuickScan score"
                detail="Products below this score are left out of ProductPulse after QuickScan."
                defaultValue={settings.risk.minimumScore}
                min="0"
                max="90"
              />
              <SettingsNumberField
                name="mediumThreshold"
                label="Medium risk starts at"
                detail="Products at or above this score are marked as Monitor."
                defaultValue={settings.risk.mediumThreshold}
                min="1"
                max="95"
              />
              <SettingsNumberField
                name="highThreshold"
                label="High risk starts at"
                detail="Products at or above this score are marked as Needs attention."
                defaultValue={settings.risk.highThreshold}
                min="2"
                max="100"
              />
            </div>
          </section>

          <section className="ppSettingsGrid">
            <div className="ppSettingsCard" aria-labelledby="settings-products-title">
              <div className="ppSettingsCardHeader">
                <DashboardIcon type="product" tone="green" />
                <div>
                  <span>Product list</span>
                  <h2 id="settings-products-title">Table defaults</h2>
                  <p>Set the defaults merchants see when they open the Products workspace.</p>
                </div>
              </div>

              <label className="ppSettingsSelectField">
                <span>Default rows per page</span>
                <select
                  name="defaultRowsPerPage"
                  aria-label="Default rows per page"
                  defaultValue={settings.products.defaultRowsPerPage}
                >
                  <option value="25">25 products</option>
                  <option value="50">50 products</option>
                </select>
                <small>Used when the Products page is opened without an explicit rows parameter.</small>
              </label>
            </div>

            <div className="ppSettingsCard" aria-labelledby="settings-queue-title">
              <div className="ppSettingsCardHeader">
                <DashboardIcon type="wand" tone="purple" />
                <div>
                  <span>AI diagnosis</span>
                  <h2 id="settings-queue-title">Queue limits</h2>
                  <p>Protect credits and make bulk diagnosis submissions deliberate.</p>
                </div>
              </div>

              <SettingsNumberField
                name="maxQueuedPerSubmission"
                label="Max diagnoses queued at once"
                detail="Bulk analysis submissions above this limit are rejected before jobs are created."
                defaultValue={settings.diagnosis.maxQueuedPerSubmission}
                min="1"
                max="50"
              />
            </div>
          </section>

          <section className={`ppSettingsCard ppSettingsBatchCard ${batchEnabled ? "isEnabled" : ""}`.trim()} aria-labelledby="settings-batch-title">
            <div className="ppSettingsBatchLayout">
              <div className="ppSettingsCardHeader">
                <DashboardIcon type="clock" tone="purple" />
                <div>
                  <span>Cost control</span>
                  <h2 id="settings-batch-title">OpenAI Batch diagnostics</h2>
                  <p>
                    Batch processing groups non-urgent diagnosis requests into asynchronous OpenAI jobs. It can reduce
                    model cost, but product diagnostics may complete later instead of immediately.
                  </p>
                </div>
              </div>

              <label className="ppSettingsBatchToggle">
                <input
                  type="checkbox"
                  name="useOpenAiBatchForDiagnostics"
                  aria-label="Use OpenAI Batch for detailed diagnostics"
                  defaultChecked={batchEnabled}
                />
                <span>
                  <strong>Use OpenAI Batch for detailed diagnostics</strong>
                  <small>Planned setting. Saved here now, but current diagnosis jobs still use the existing realtime queue.</small>
                </span>
              </label>
            </div>

            <div className="ppSettingsBatchFacts">
              <span><s-icon type="cash-dollar" size="small"></s-icon> Lower cost for non-urgent AI work</span>
              <span><s-icon type="clock" size="small"></s-icon> Asynchronous completion window</span>
              <span><s-icon type="info" size="small"></s-icon> Best for large diagnosis backlogs</span>
            </div>
          </section>

          <div className="ppSettingsFooter">
            <Link className="ppSecondaryActionButton" to="/app/products">
              <s-icon type="product" size="small"></s-icon>
              Back to Products
            </Link>
            <button className="ppPrimaryButton" type="submit" disabled={isSaving}>
              <s-icon type="check" size="small"></s-icon>
              {isSaving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </Form>
      </ScreenShell>
    </FullWidthPage>
  );
}

function SettingsNumberField({ name, label, detail, defaultValue, min, max }) {
  return (
    <label className="ppSettingsNumberField">
      <span>{label}</span>
      <input
        type="number"
        name={name}
        aria-label={label}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step="1"
      />
      <small>{detail}</small>
    </label>
  );
}

function getDefaultProductPulseClientSettings() {
  return {
    risk: {
      minimumScore: 50,
      mediumThreshold: 55,
      highThreshold: 75,
    },
    products: {
      defaultRowsPerPage: 25,
    },
    diagnosis: {
      maxQueuedPerSubmission: 25,
      useOpenAiBatchForDiagnostics: false,
    },
  };
}

function QuickScanConfirmModal({ pending, onCancel, onConfirm }) {
  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal" role="dialog" aria-modal="true" aria-labelledby="quick-scan-confirm-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type="search" size="small"></s-icon>
          </span>
          <div>
            <span>QuickScan</span>
            <h2 id="quick-scan-confirm-title">Confirm quick product scan</h2>
            <p>
              ProductPulse will run a lightweight Shopify scan across the catalog to refresh preliminary risk signals.
            </p>
          </div>
        </div>

        <div className="ppAnalysisConfirmCost">
          <div>
            <span>Estimated cost</span>
            <strong>1 credit</strong>
          </div>
          <small>QuickScan costs 1 credit and runs as a background job.</small>
        </div>

        <div className="ppActionConfirmNotice">
          <s-icon type="info" size="small"></s-icon>
          <p>Products that already have a full AI product diagnosis will be ignored so their detailed analysis is not overwritten.</p>
        </div>

        <div className="ppAnalysisConfirmFooter">
          <button className="ppSecondaryButton" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="ppPrimaryButton" type="button" onClick={onConfirm} disabled={pending}>
            <s-icon type="search" size="small"></s-icon>
            {pending ? "Starting QuickScan..." : "Accept cost and run QuickScan"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProductAnalysisConfirmModal({ confirmation, pending, pendingIds, onCancel, onConfirm }) {
  const productTitles = Array.isArray(confirmation.productTitles) ? confirmation.productTitles.filter(Boolean) : [];
  const hiddenCount = Math.max(0, confirmation.count - productTitles.length);
  const isSingle = confirmation.count === 1;

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal" role="dialog" aria-modal="true" aria-labelledby="analysis-confirm-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type="wand" size="small"></s-icon>
          </span>
          <div>
            <span>AI Product Diagnosis</span>
            <h2 id="analysis-confirm-title">{confirmation.title}</h2>
            <p>
              {isSingle
                ? "This will queue a detailed AI diagnosis for this product."
                : `This will queue detailed AI diagnoses for ${confirmation.count} selected products. Jobs will run one at a time.`}
            </p>
          </div>
        </div>

        <div className="ppAnalysisConfirmCost">
          <div>
            <span>Estimated cost</span>
            <strong>{confirmation.credits} credit{confirmation.credits === 1 ? "" : "s"}</strong>
          </div>
          <small>1 credit per product diagnosis. Confirming will start background jobs.</small>
        </div>

        {productTitles.length > 0 && (
          <div className="ppAnalysisConfirmProducts">
            <span>{isSingle ? "Product" : "Products"}</span>
            <ul>
              {productTitles.slice(0, 5).map((title) => (
                <li key={title}>{title}</li>
              ))}
              {hiddenCount > 0 && <li>{hiddenCount} more selected product{hiddenCount === 1 ? "" : "s"}</li>}
            </ul>
          </div>
        )}

        <div className="ppAnalysisConfirmFooter">
          <button className="ppSecondaryButton" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="ppPrimaryButton" type="button" onClick={onConfirm} disabled={pending}>
            <s-icon type="wand" size="small"></s-icon>
            {pending ? getPendingAnalysisLabel(pendingIds) : "Accept cost and run analysis"}
          </button>
        </div>
      </section>
    </div>
  );
}

function RecommendedActionConfirmModal({ confirmation, product, pending, onCancel }) {
  const action = confirmation.action || {};
  const application = confirmation.application || getRecommendedActionApplication(action, product);
  const editedText = String(confirmation.editedText ?? application.value ?? "");
  const isTagChange = String(application.target || "").toLowerCase().includes("tag");
  const valuePreview = editedText || "No value supplied.";
  const submitLabel = pending ? "Applying change..." : "Accept and apply change";

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal ppActionConfirmModal" role="dialog" aria-modal="true" aria-labelledby="action-confirm-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type={isTagChange ? "tag" : "wand"} size="small"></s-icon>
          </span>
          <div>
            <span>{application.target}</span>
            <h2 id="action-confirm-title">{application.confirmationTitle || "Confirm product update"}</h2>
            <p>{application.confirmationDetail || "ProductPulse will apply this change to the Shopify product."}</p>
          </div>
        </div>

        <div className="ppActionConfirmMeta">
          <div>
            <span>Product</span>
            <strong>{product.title}</strong>
          </div>
          <div>
            <span>Operation</span>
            <strong>{application.operation}</strong>
          </div>
        </div>

        {application.currentValue && (
          <div className="ppActionConfirmCurrent">
            <span>{application.currentValueLabel || "Current value"}</span>
            <CurrentDescriptionInsertionPreview application={application} asPre />
          </div>
        )}

        <div className="ppActionConfirmChange">
          <span>{application.valueLabel || "New value"}</span>
          <pre>{valuePreview}</pre>
        </div>

        <div className="ppActionConfirmNotice">
          <s-icon type="info" size="small"></s-icon>
          <p>This will modify the Shopify product only after you confirm. ProductPulse will store the action in the product history.</p>
        </div>

        <Form method="post" className="ppAnalysisConfirmFooter">
          <input type="hidden" name="_action" value="apply-action" />
          <input type="hidden" name="productId" value={product.slug} />
          <input type="hidden" name="actionId" value={action.id || ""} />
          <input type="hidden" name="label" value={action.title || action.label || ""} />
          <input type="hidden" name="draftText" value={editedText} />
          <input type="hidden" name="applyMode" value="apply" />
          <input type="hidden" name="actionVariant" value={application.variantId || ""} />
          <button className="ppSecondaryButton" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="ppPrimaryButton" type="submit" disabled={pending || !editedText.trim()}>
            <s-icon type={isTagChange ? "tag" : "wand"} size="small"></s-icon>
            {submitLabel}
          </button>
        </Form>
      </section>
    </div>
  );
}

function getPendingAnalysisLabel(pendingIds) {
  const count = Array.isArray(pendingIds) ? pendingIds.length : 0;
  return count > 1 ? "Queuing analyses..." : "Queuing analysis...";
}

function FastScanButton({ pending, onStart }) {
  return (
    <button className="ppQuickScanButton" type="button" disabled={pending} onClick={onStart}>
      <s-icon type="search" size="small"></s-icon>
      {pending ? "Scan running..." : "Run quick scan"}
    </button>
  );
}

function ShopifyProductSearchModal({
  query,
  results,
  pending,
  error,
  onAnalyze,
  onCancel,
  onQueryChange,
}) {
  const normalizedQuery = query.trim();
  const hasQuery = normalizedQuery.length >= 2;

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal ppShopifyProductSearchModal" role="dialog" aria-modal="true" aria-labelledby="shopify-product-search-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type="search" size="small"></s-icon>
          </span>
          <div>
            <span>Shopify catalog</span>
            <h2 id="shopify-product-search-title">Find Shopify product</h2>
            <p>
              Search the live Shopify catalog, select a product that has not appeared in QuickScan, and queue a full AI diagnosis.
            </p>
          </div>
        </div>

        <label className="ppShopifyProductSearchControl">
          <span>Search Shopify products</span>
          <div>
            <s-icon type="search" size="small"></s-icon>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by title, handle, product ID or SKU"
            />
          </div>
        </label>

        <div className="ppShopifyProductSearchBody">
          {!hasQuery && (
            <div className="ppShopifyProductSearchEmpty">
              <DashboardIcon type="search" tone="blue" size="small" />
              <p>Type at least 2 characters to search products directly in Shopify.</p>
            </div>
          )}

          {hasQuery && pending && (
            <div className="ppShopifyProductSearchEmpty" role="status">
              <span className="ppScanSpinner" aria-hidden="true" />
              <p>Searching Shopify products...</p>
            </div>
          )}

          {hasQuery && !pending && error && (
            <div className="ppActionConfirmNotice ppShopifyProductSearchError">
              <s-icon type="info" size="small"></s-icon>
              <p>{error}</p>
            </div>
          )}

          {hasQuery && !pending && !error && results.length === 0 && (
            <div className="ppShopifyProductSearchEmpty">
              <DashboardIcon type="search" tone="blue" size="small" />
              <p>No Shopify products matched this search.</p>
            </div>
          )}

          {hasQuery && !pending && !error && results.length > 0 && (
            <div className="ppShopifyProductResults" role="list">
              {results.map((product) => (
                <article className="ppShopifyProductResult" role="listitem" key={product.id}>
                  <ProductArt
                    variant={product.variant}
                    label={product.title}
                    imageUrl={product.imageUrl}
                    imageAlt={product.imageAlt}
                  />
                  <div className="ppShopifyProductResultText">
                    <div>
                      <strong>{product.title}</strong>
                      <span>{product.existingSnapshot ? "In ProductPulse" : "Not in QuickScan"}</span>
                    </div>
                    <p>{product.handle ? `/${product.handle}` : "Shopify product"}</p>
                    <small>
                      {[product.status, product.detail, product.sku ? `SKU ${product.sku}` : ""].filter(Boolean).join(" - ")}
                    </small>
                  </div>
                  <button
                    className="ppShopifyProductResultAction"
                    type="button"
                    onClick={() => onAnalyze(product)}
                  >
                    <s-icon type="wand" size="small"></s-icon>
                    Run diagnosis
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="ppAnalysisConfirmFooter">
          <button className="ppSecondaryButton" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function ProductFilterSelect({ name, label, value, options, vendor = false }) {
  const normalizedOptions = Array.isArray(options) && options.length ? options : [{ value: "all", label }];

  return (
    <label className={`ppCompactSelect ${vendor ? "ppVendorSelect" : ""}`.trim()}>
      <span>{label}</span>
      <select name={name} value={value || "all"} onChange={() => {}}>
        {normalizedOptions.map((option) => (
          <option value={option.value} key={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function SortableHeader({ active, direction, label, onSort }) {
  return (
    <button className={`ppSortableHeader ${active ? "isActive" : ""}`} type="button" onClick={onSort}>
      <span>{label}</span>
      {active && <span className="ppSortArrow" aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function buildProductFilterFormData(current = {}, overrides = {}) {
  const values = {
    query: "",
    risk: "all",
    status: "all",
    issue: "all",
    source: "all",
    vendor: "all",
    page: "1",
    rows: "25",
    sort: "",
    direction: "desc",
    ...current,
    ...overrides,
  };
  const formData = new FormData();

  if (values.query) formData.set("q", values.query);
  ["risk", "status", "issue", "source", "vendor"].forEach((name) => {
    if (values[name] && values[name] !== "all") formData.set(name, values[name]);
  });
  if (String(values.page || "1") !== "1") formData.set("page", String(values.page));
  if (String(values.rows || "25") !== "25") formData.set("rows", String(values.rows));
  if (values.sort) {
    formData.set("sort", values.sort);
    formData.set("direction", values.direction === "asc" ? "asc" : "desc");
  }

  return formData;
}

function buildProductFilterHref(current = {}, overrides = {}) {
  const params = new URLSearchParams(buildProductFilterFormData(current, overrides));
  const query = params.toString();
  return query ? `/app/products?${query}` : "/app/products";
}

function getVisiblePages(currentPage, totalPages) {
  const total = Math.max(1, totalPages || 1);
  const start = Math.max(1, Math.min(currentPage - 2, total - 4));
  const end = Math.min(total, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function getProductActionKey(product) {
  return product.productGid || product.handle || product.href || product.title;
}

function getProductDiagnosisState(product, pendingAnalyzeIds = []) {
  const productKey = getProductActionKey(product);
  const pendingKeys = new Set((pendingAnalyzeIds || []).map(String));
  const persistedJob = product.diagnosisJob;

  if (pendingKeys.has(String(productKey))) {
    return {
      status: "Queued",
      label: "Queuing diagnosis",
    };
  }

  if (!persistedJob) return null;
  const status = String(persistedJob.status || "").toLowerCase();
  if (status === "running") {
    return {
      status: persistedJob.status,
      label: "Diagnosis running",
    };
  }
  if (status === "queued") {
    return {
      status: persistedJob.status,
      label: "Diagnosis queued",
    };
  }

  return null;
}

function getProductAnalysisDisplay(product = {}) {
  const metrics = product.metrics || {};
  const depth = product.analysisDepth
    || (metrics.latestDiagnosisId || metrics.lastDetailedDiagnosisAt || product.latestDiagnosisId ? "full" : product.hasRiskSnapshot === false ? "catalog" : "quickscan");

  if (depth === "full") {
    return {
      depth: "full",
      label: product.analysisLabel || "Full diagnosis",
      icon: product.analysisIcon || "wand",
      tone: product.analysisTone || "success",
      detail: product.analysisDetail || "Deep AI product diagnosis completed. Recommended actions can be reviewed and applied.",
      completedAt: product.analysisCompletedAt || metrics.lastDetailedDiagnosisAt || null,
    };
  }

  if (depth === "catalog") {
    return {
      depth: "catalog",
      label: product.analysisLabel || "Not scanned",
      icon: product.analysisIcon || "product",
      tone: product.analysisTone || "neutral",
      detail: product.analysisDetail || "No ProductPulse scan has been stored for this product yet.",
      completedAt: null,
    };
  }

  return {
    depth: "quickscan",
    label: product.analysisLabel || "QuickScan only",
    icon: product.analysisIcon || "search",
    tone: product.analysisTone || "info",
    detail: product.analysisDetail || "Only the fast Shopify scan has run. Run product diagnosis to unlock recommended actions.",
    completedAt: null,
  };
}

function ProductAnalysisStatusBadge({ product, detail = false, showLabel = true, titleIcon = false, completionOnly = false }) {
  const analysis = getProductAnalysisDisplay(product);
  const popoverTitle = completionOnly && analysis.depth === "full" ? "Deep analysis completed" : getAnalysisPopoverTitle(analysis);
  const popoverDetail = completionOnly
    ? formatProductAnalysisDate(analysis.completedAt || product.lastAnalysis)
    : analysis.detail;
  return (
    <button className={`ppAnalysisStatusWrap ${titleIcon ? "ppAnalysisStatusWrap-titleIcon" : ""}`.trim()} type="button" aria-label={`${popoverTitle}. ${popoverDetail}`}>
      <span className={`ppAnalysisStatus ppAnalysisStatus-${analysis.depth} ${detail ? "ppAnalysisStatus-detail" : ""} ${titleIcon ? "ppAnalysisStatus-titleIcon" : ""}`.trim()}>
        <span className="ppAnalysisStatusIcon" aria-hidden="true">
          <s-icon type={analysis.icon} size="small"></s-icon>
        </span>
        {showLabel && (
          <span>
            <strong>{analysis.label}</strong>
            {detail && <small>{analysis.detail}</small>}
          </span>
        )}
      </span>
      <span className="ppAnalysisStatusPopover" role="tooltip">
        <strong>{popoverTitle}</strong>
        <small>{popoverDetail}</small>
      </span>
    </button>
  );
}

function getAnalysisPopoverTitle(analysis) {
  if (analysis.depth === "full") return "Deep Analysis completed";
  if (analysis.depth === "quickscan") return "Fast Analysis completed";
  return "No analysis completed";
}

function getProductDetailModel(product) {
  const metrics = product.metrics || {};
  const sourceCoverage = product.sourceCoverage || [];
  const hasRiskSnapshot = product.hasRiskSnapshot !== false;
  const analysisStatus = getProductAnalysisDisplay(product);
  const hasFullDiagnosis = analysisStatus.depth === "full";
  const activeDiagnosisJob = getActiveProductDiagnosisFromProduct(product);
  const issueText = product.primaryIssue || "";
  const issueCategory = getProductIssueCategory(issueText);
  const firstAction = product.recommendedActions?.[0];
  const detectedIssueRows = getProductDetectedIssues(product, issueCategory, hasRiskSnapshot);
  const recommendedActions = hasFullDiagnosis ? getProductRecommendedActions(product) : [];
  const evidenceSources = getProductEvidenceSources(product);
  const checkedItems = getProductCheckedItems(product);
  const mainFinding = sanitizeProductMainFinding(product.mainFinding);

  return {
    title: product.title,
    variant: getProductArtVariant(product),
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    shopifyAdminUrl: product.shopifyAdminUrl,
    lastAnalysis: formatProductAnalysisDate(product.lastAnalysis),
    analysisStatus,
    analysisDepth: analysisStatus.depth,
    analysisLabel: analysisStatus.label,
    analysisDetail: analysisStatus.detail,
    hasFullDiagnosis,
    activeDiagnosisJob,
    diagnosisInProgress: Boolean(activeDiagnosisJob),
    diagnosisButtonLabel: hasFullDiagnosis ? "Re-run product diagnosis" : "Run product diagnosis",
    riskLabel: product.riskLabel,
    riskBadgeTone: getBadgeToneFromRiskTone(product.riskTone),
    riskScoreLabel: hasRiskSnapshot ? getProductRiskScoreLabel(product.riskScore) : "Not scanned",
    riskScore: product.riskScore || 0,
    riskTone: getProductInsightTone(product.riskTone),
    confidence: product.confidence || 0,
    confidenceLabel: getConfidenceLabel(product.confidence || 0, hasRiskSnapshot),
    signalCount: metrics.signalCount || 0,
    returnRate: metrics.returnRate || 0,
    estimatedImpact: getEstimatedImpactValue(metrics),
    marginAtRisk: getEstimatedMarginValue(metrics),
    revenueAtRisk: getEstimatedRevenueValue(metrics),
    riskTrend: Array.isArray(metrics.riskTrend) ? metrics.riskTrend : [],
    issueBadge: issueCategory,
    showIssueBadge: Boolean(issueText),
    issueCategory,
    issueDetail: issueText || "No deterministic product issue stored yet.",
    issueTone: product.riskScore >= 55 ? "blue" : "green",
    findingTone: getDashboardToneFromRiskTone(product.riskTone),
    evidenceLabel: getEvidenceLabel(evidenceSources, sourceCoverage),
    showEvidenceBadge: evidenceSources.length > 0,
    mainFindingTitle: mainFinding?.title || (issueText ? getMainFindingTitle(issueCategory) : "No ProductPulse issue stored for this product"),
    mainFindingDetail: mainFinding?.detail || (issueText
      ? `ProductPulse found repeated ${issueCategory.toLowerCase()} signals for ${product.title}: ${issueText}. The current signal set includes ${sourceCoverage.join(", ")}.`
      : `Only ${sourceCoverage.join(", ") || "Shopify product"} data is available for ${product.title}. Run QuickScan to create risk signals before deep diagnosis.`),
    recommendedFix: hasFullDiagnosis ? (firstAction?.label || "No deterministic action yet") : "Run full product diagnosis",
    recommendedFixDetail: hasFullDiagnosis
      ? (firstAction ? `${firstAction.type} - ${firstAction.effort} effort` : "No stored recommendation from current product signals.")
      : "Recommended actions are intentionally locked until this product has a completed deep diagnosis.",
    evidenceSources,
    detectedIssues: detectedIssueRows,
    recommendedActions,
    checkedItems,
    actionHistory: product.actionHistory || [],
    resolvedAt: product.resolvedAt || null,
    canDiagnose: product.canDiagnose !== false && hasRiskSnapshot && !activeDiagnosisJob,
    canResolve: product.canResolve !== false && hasRiskSnapshot && hasFullDiagnosis,
  };
}

function getActiveProductDiagnosisFromProduct(product = {}) {
  const job = product.diagnosisJob;
  const status = String(job?.status || "").toLowerCase();
  return status === "queued" || status === "running" ? job : null;
}

function getConfidenceLabel(confidence, hasRiskSnapshot = true) {
  if (!hasRiskSnapshot) return "0 stored";
  if (confidence >= 80) return "High";
  if (confidence >= 65) return "Medium";
  if (confidence > 0) return "Low";
  return "0 stored";
}

function getEstimatedImpactValue(metrics = {}) {
  return Number(metrics.estimatedImpact || metrics.revenueAtRisk || metrics.refundAmount || 0);
}

function getEstimatedRevenueValue(metrics = {}) {
  return Number(metrics.revenueAtRisk || metrics.estimatedImpact || metrics.refundAmount || 0);
}

function getEstimatedMarginValue(metrics = {}) {
  const margin = Number(metrics.marginAtRisk || 0);
  if (margin > 0) return margin;
  const revenue = getEstimatedRevenueValue(metrics);
  return revenue > 0 ? Math.round(revenue * 0.45 * 100) / 100 : 0;
}

function getProductArtVariant(product) {
  const variantMap = {
    "core-linen-trouser": "shirt",
    "trail-run-vest": "hoodie",
    "ceramic-pour-over": "bottle",
    "minimal-canvas-tote": "tote",
  };

  return variantMap[product.slug] || "shirt";
}

function formatProductAnalysisDate(value) {
  if (!value || value === "Not analyzed") return "Not analyzed";
  const date = value instanceof Date
    ? value
    : new Date(String(value).includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function getBadgeToneFromRiskTone(tone) {
  if (tone === "critical") return "critical";
  if (tone === "success") return "success";
  return "warning";
}

function getBadgeToneFromSeverity(severity, fallbackTone = "warning") {
  const normalized = String(severity || "").toLowerCase();
  if (normalized.includes("high") || normalized.includes("critical")) return "critical";
  if (normalized.includes("medium") || normalized.includes("moderate")) return "warning";
  if (normalized.includes("low") || normalized.includes("success") || normalized.includes("healthy")) return "success";
  return getBadgeToneFromRiskTone(fallbackTone);
}

function getDashboardToneFromRiskTone(tone) {
  if (tone === "critical") return "red";
  if (tone === "success") return "green";
  if (tone === "info") return "blue";
  return "orange";
}

function getProductInsightTone(tone) {
  if (tone === "critical") return "red";
  if (tone === "success") return "green";
  return "blue";
}

function getProductRiskScoreLabel(score) {
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  if (score >= 35) return "Emerging";
  return "Low";
}

function getEvidenceLabel(evidenceSources, sourceCoverage) {
  if (evidenceSources.length >= 4) return "Strong evidence";
  if (evidenceSources.length > 1) return `${evidenceSources.length} evidence sources`;
  if (evidenceSources.length === 1) return evidenceSources[0].title;
  if (sourceCoverage.length > 0) return `${sourceCoverage.length} signal sources`;
  return "No signal evidence";
}

function getTrendTone(values, fallbackScore = 0) {
  const trendValues = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (trendValues.length >= 2) {
    const first = trendValues[0];
    const last = trendValues[trendValues.length - 1];
    if (last > first) return "red";
    if (last < first) return "green";
  }
  if (fallbackScore >= 75) return "red";
  if (fallbackScore >= 55) return "orange";
  return "green";
}

function getProductIssueCategory(issue) {
  if (!issue) return "No issue";
  const normalized = issue.toLowerCase();
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("waist") || normalized.includes("inseam")) return "Fit & sizing";
  if (normalized.includes("zipper") || normalized.includes("defect")) return "Durability";
  if (normalized.includes("subjective") || normalized.includes("preference") || normalized.includes("dislike")) return "Subjective negative reaction";
  if (normalized.includes("unsafe") || normalized.includes("danger") || normalized.includes("safety") || normalized.includes("peligro")) return "Safety concern";
  if (normalized.includes("fear") || normalized.includes("scare") || normalized.includes("miedo") || normalized.includes("asusta")) return "Subjective negative reaction";
  if (normalized.includes("compat")) return "Compatibility";
  if (normalized.includes("content") || normalized.includes("description") || normalized.includes("metadata")) return "Product content";
  if (normalized.includes("monitor")) return "Monitoring";
  return "Product quality";
}

function getMainFindingTitle(issueCategory) {
  if (issueCategory === "Fit & sizing") return "Sizing & fit expectations are not being met";
  if (issueCategory === "Durability") return "Durability signals are affecting buyer confidence";
  if (issueCategory === "Compatibility") return "Compatibility expectations need clearer guidance";
  if (issueCategory === "Safety concern") return "Customer language suggests a safety concern";
  if (issueCategory === "Subjective negative reaction") return "Subjective negative reactions are emerging";
  if (issueCategory === "Product content") return "Product content needs clearer shopper guidance";
  if (issueCategory === "Monitoring") return "Product is healthy and should stay monitored";
  return `${issueCategory} signals need review`;
}

function getMainFindingParagraphs(value) {
  const raw = String(value || "").replace(/\r/g, "\n").trim();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return (paragraphs.length ? paragraphs : [raw.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()])
    .filter(Boolean)
    .slice(0, 3);
}

function getProductEvidenceSources(product) {
  if (!product.evidence?.length) return [];

  return product.evidence
    .map((item) => ({
      icon: getEvidenceIcon(item.source),
      title: `${item.source}`,
      points: getEvidencePoints(item, product),
      priority: getEvidenceSourcePriority(item.source),
    }))
    .sort((first, second) => first.priority - second.priority);
}

function getEvidencePoints(item, product) {
  const metrics = product.metrics || {};
  const textInsights = metrics.textInsights || {};
  const normalized = String(item.source || "").toLowerCase();
  const points = [
    item.quote,
    item.weight,
    ...(Array.isArray(item.points) ? item.points : []),
    ...(Array.isArray(item.details) ? item.details : []),
  ].filter(Boolean);

  if (normalized.includes("return")) {
    if (Number(metrics.returnUnits || 0) > 0) points.push(`${formatInteger(metrics.returnUnits)} return units analyzed`);
    if (Number(metrics.returnRate || 0) > 0) points.push(`${metrics.returnRate}% return rate in the scan window`);
    if (Array.isArray(metrics.topReturnReasons) && metrics.topReturnReasons.length) points.push(`Top reasons: ${metrics.topReturnReasons.join(", ")}`);
    if (textInsights.returns?.sentiment?.total) points.push(formatSentimentPoint("Return notes", textInsights.returns.sentiment));
    if (Array.isArray(textInsights.returns?.emotions) && textInsights.returns.emotions.length) points.push(`Return-note emotions: ${formatEvidenceEmotionCounts(textInsights.returns.emotions)}`);
    if (textInsights.returns?.subjectiveNegativity?.count) points.push(`Subjective return-note reactions: ${textInsights.returns.subjectiveNegativity.count} of ${textInsights.returns.subjectiveNegativity.total}`);
  }

  if (normalized.includes("refund")) {
    if (Number(metrics.refundUnits || 0) > 0) points.push(`${formatInteger(metrics.refundUnits)} refunded units`);
    if (Number(metrics.refundAmount || 0) > 0) points.push(`${formatMoney(metrics.refundAmount)} refunded amount`);
    if (Number(metrics.refundRate || 0) > 0) points.push(`${metrics.refundRate}% refund rate`);
  }

  if (normalized.includes("judge") || normalized.includes("review")) {
    if (Number(metrics.reviewCount || 0) > 0) points.push(`${formatInteger(metrics.reviewCount)} Judge.me reviews analyzed`);
    if (Number(metrics.avgRating || metrics.reviewRating || 0) > 0) points.push(`${metrics.avgRating || metrics.reviewRating} average rating`);
    if (Number(metrics.negativeReviewCount || 0) > 0) points.push(`${formatInteger(metrics.negativeReviewCount)} negative reviews`);
    if (Number(metrics.negativeReviewRate || 0) > 0) points.push(`${metrics.negativeReviewRate}% negative review rate`);
    if (Number(metrics.recentNegativeReviewCount || 0) > 0) points.push(`${formatInteger(metrics.recentNegativeReviewCount)} recent negative reviews`);
    if (textInsights.reviews?.sentiment?.total) points.push(formatSentimentPoint("Review text", textInsights.reviews.sentiment));
    if (Array.isArray(textInsights.reviews?.emotions) && textInsights.reviews.emotions.length) points.push(`Review emotions: ${formatEvidenceEmotionCounts(textInsights.reviews.emotions)}`);
  }

  if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) {
    if (textInsights.sentiment?.total) points.push(formatSentimentPoint("All customer text", textInsights.sentiment));
    if (textInsights.returns?.sentiment?.total) points.push(formatSentimentPoint("Return notes", textInsights.returns.sentiment));
    if (textInsights.reviews?.sentiment?.total) points.push(formatSentimentPoint("Review text", textInsights.reviews.sentiment));
    if (Array.isArray(textInsights.emotions) && textInsights.emotions.length) points.push(`Deterministic emotion taxonomy: ${formatEvidenceEmotionCounts(textInsights.emotions)}`);
    if (textInsights.subjectiveNegativity?.count) points.push(`Subjective negative reactions: ${textInsights.subjectiveNegativity.count} of ${textInsights.subjectiveNegativity.total} customer text signals`);
    if (Array.isArray(textInsights.aiKnownEmotions) && textInsights.aiKnownEmotions.length) points.push(`AI emotion taxonomy: ${formatEvidenceEmotionCounts(textInsights.aiKnownEmotions)}`);
    if (Array.isArray(textInsights.aiEmergentSentiments) && textInsights.aiEmergentSentiments.length) points.push(`Emergent emotions: ${formatEvidenceEmotionCounts(textInsights.aiEmergentSentiments)}`);
    if (Array.isArray(textInsights.otherReturnClassifications) && textInsights.otherReturnClassifications.length) {
      textInsights.otherReturnClassifications.slice(0, 5).forEach((item) => {
        points.push(`"Other" return notes classified as ${item.label} ${item.count} time${Number(item.count || 0) === 1 ? "" : "s"}`);
      });
    }
    if (Array.isArray(textInsights.returns?.examples) && textInsights.returns.examples.length) {
      textInsights.returns.examples.slice(0, 4).forEach((example) => {
        points.push(`Return note example (${example.sentiment}${example.emotion && example.emotion !== "none" ? `, ${formatEvidenceEmotionLabel(example.emotion)}` : ""}): "${example.text}"`);
      });
    }
    if (Array.isArray(textInsights.reviews?.examples) && textInsights.reviews.examples.length) {
      textInsights.reviews.examples.slice(0, 3).forEach((example) => {
        points.push(`Review example (${example.sentiment}${example.emotion && example.emotion !== "none" ? `, ${formatEvidenceEmotionLabel(example.emotion)}` : ""}): "${example.text}"`);
      });
    }
  }

  if (normalized.includes("product") || normalized.includes("shopify")) {
    if (metrics.vendor) points.push(`Vendor: ${metrics.vendor}`);
    if (metrics.productType) points.push(`Product type: ${metrics.productType}`);
    if (Number(metrics.descriptionWordCount || 0) > 0) points.push(`${formatInteger(metrics.descriptionWordCount)} description words`);
    if (Number(metrics.contentQualityScore || 0) > 0) points.push(`${metrics.contentQualityScore}/100 content quality score`);
    if (Number(metrics.variantCount || 0) > 0) points.push(`${formatInteger(metrics.variantCount)} variants available`);
    if (Array.isArray(metrics.collections) && metrics.collections.length) points.push(`Collections: ${metrics.collections.join(", ")}`);
    if (Array.isArray(metrics.tags) && metrics.tags.length) points.push(`${formatInteger(metrics.tags.length)} product tags stored`);
  }

  if (normalized.includes("variant") && Array.isArray(metrics.affectedVariants) && metrics.affectedVariants.length) {
    points.push(`Affected variants: ${metrics.affectedVariants.join(", ")}`);
  }

  if (Number(metrics.signalCount || 0) > 0) points.push(`${formatInteger(metrics.signalCount)} total signals in current diagnosis`);
  if (metrics.lastSignalAt) points.push(`Last signal captured ${formatProductAnalysisDate(metrics.lastSignalAt)}`);

  const maxPoints = normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer") ? 22 : 12;
  return [...new Set(points)].slice(0, maxPoints);
}

function getEvidenceSourcePriority(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) return 0;
  if (normalized.includes("return")) return 1;
  if (normalized.includes("review") || normalized.includes("judge")) return 2;
  if (normalized.includes("refund")) return 3;
  if (normalized.includes("product") || normalized.includes("shopify")) return 4;
  if (normalized.includes("variant")) return 5;
  return 10;
}

function formatSentimentPoint(label, sentiment = {}) {
  return `${label} sentiment: ${Number(sentiment.negative || 0)} negative, ${Number(sentiment.neutral || 0)} neutral, ${Number(sentiment.positive || 0)} positive`;
}

function formatEvidenceEmotionCounts(items = []) {
  return items
    .filter((item) => item?.label && Number(item.count || item.signals || 0) > 0)
    .map((item) => `${item.label} ${Number(item.count || item.signals || 0)}`)
    .join(", ");
}

function formatEvidenceEmotionLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getEvidenceIcon(source) {
  const normalized = source.toLowerCase();
  if (normalized.includes("return")) return "return";
  if (normalized.includes("review")) return "star";
  if (normalized.includes("refund")) return "cash-dollar";
  if (normalized.includes("support")) return "question-circle";
  if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) return "note";
  if (normalized.includes("content") || normalized.includes("description")) return "note";
  return "duplicate";
}

function getProductDetectedIssues(product, issueCategory, hasRiskSnapshot = true) {
  if (Array.isArray(product.issues) && product.issues.length) {
    return product.issues.filter((issue) => !isNonActionableContentFinding(issue)).map((issue, index) => ({
      issue: issue.issue || issue.label || `Issue ${index + 1}`,
      issueCode: issue.issueCode || "",
      severity: issue.severity || getProductRiskScoreLabel(product.riskScore || 0),
      tone: getBadgeToneFromSeverity(issue.severity, issue.tone || product.riskTone),
      confidence: typeof issue.confidence === "number" ? `${issue.confidence}%` : issue.confidence || `${product.confidence || 0}%`,
      signals: issue.signals || product.metrics?.signalCount || 0,
      evidence: Array.isArray(issue.evidence) ? issue.evidence.filter(Boolean) : [],
      trend: Array.isArray(issue.trend) ? issue.trend : product.metrics?.signalTrend || [],
      trendTone: getTrendTone(Array.isArray(issue.trend) ? issue.trend : product.metrics?.signalTrend || [], product.riskScore),
      action: issue.action || getIssueActionLabel(issue.issue || product.primaryIssue, issueCategory),
    }));
  }

  if (!product.primaryIssue || !hasRiskSnapshot) return [];

  const firstAction = product.recommendedActions?.[0]?.label || "Review product content";
  const secondaryAction = product.recommendedActions?.[1]?.label || "Monitor signal trend";
  const primarySignals = Math.max(product.metrics?.signalCount || 0, 1);

  return [
    {
      issue: product.primaryIssue,
      severity: getProductRiskScoreLabel(product.riskScore),
      tone: getBadgeToneFromSeverity(getProductRiskScoreLabel(product.riskScore), product.riskTone),
      confidence: `${product.confidence}%`,
      signals: primarySignals,
      trend: product.metrics?.signalTrend || [],
      trendTone: getTrendTone(product.metrics?.signalTrend || [], product.riskScore),
      action: firstAction,
    },
    {
      issue: `${issueCategory} signal cluster`,
      severity: product.riskScore >= 75 ? "High" : product.riskScore >= 55 ? "Medium" : "Low",
      tone: getBadgeToneFromSeverity(product.riskScore >= 75 ? "High" : product.riskScore >= 55 ? "Medium" : "Low"),
      confidence: `${Math.max(product.confidence - 9, 35)}%`,
      signals: Math.max(Math.round(primarySignals * 0.62), 1),
      trend: product.metrics?.signalTrend || [],
      trendTone: getTrendTone(product.metrics?.signalTrend || [], product.riskScore),
      action: secondaryAction,
    },
  ];
}

function sanitizeProductMainFinding(mainFinding) {
  if (!mainFinding) return mainFinding;
  return {
    ...mainFinding,
    detail: removeNonActionableContentFindingText(mainFinding.detail),
  };
}

function removeNonActionableContentFindingText(value) {
  const paragraphs = String(value || "").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const filtered = paragraphs.filter((paragraph) => !isNonActionableContentText(paragraph));
  return (filtered.length ? filtered : paragraphs).join("\n\n");
}

function isNonActionableContentFinding(issue = {}) {
  const text = `${issue.code || ""} ${issue.issue || ""} ${issue.label || ""} ${(Array.isArray(issue.evidence) ? issue.evidence.join(" ") : issue.evidence) || ""}`;
  return isNonActionableContentText(text);
}

function isNonActionableContentText(value) {
  const normalized = String(value || "").toLowerCase();
  return [
    "title and description may be disconnected",
    "title and description alignment could be reviewed",
    "product type is not explained",
    "product type could be clearer",
    "tags are not reflected in description",
    "tags could be reflected in description",
    "collection context is missing",
    "collection context could be clearer",
  ].some((phrase) => normalized.includes(phrase));
}

function getIssueActionLabel(issue, issueCategory) {
  const normalized = String(issue || issueCategory || "").toLowerCase();
  if (normalized.includes("return")) return "Review return evidence";
  if (normalized.includes("refund")) return "Review refund impact";
  if (normalized.includes("fear") || normalized.includes("safety") || normalized.includes("scare")) return "Review fear/safety language";
  if (normalized.includes("variant")) return "Review affected variants";
  if (normalized.includes("fit") || normalized.includes("sizing")) return "Draft shopper-facing fit guidance";
  return "Review product signals";
}

function getIssueIcon(issue) {
  const normalized = String(issue || "").toLowerCase();
  if (normalized.includes("return")) return "return";
  if (normalized.includes("refund")) return "cash-dollar";
  if (normalized.includes("sentiment") || normalized.includes("language")) return "note";
  if (normalized.includes("fear") || normalized.includes("safety") || normalized.includes("scare")) return "alert-circle";
  if (normalized.includes("variant")) return "product";
  if (normalized.includes("expectation") || normalized.includes("description") || normalized.includes("color")) return "tag";
  if (normalized.includes("content") || normalized.includes("metadata")) return "note";
  if (normalized.includes("fit") || normalized.includes("sizing")) return "person";
  if (normalized.includes("defect") || normalized.includes("durability")) return "alert-circle";
  return "product";
}

function getProductRecommendedActions(product) {
  const actionHistory = Array.isArray(product.actionHistory) ? product.actionHistory : [];
  if (!product.recommendedActions?.length) return [];
  const normalizedActions = consolidateReviewRecommendedActions(product.recommendedActions);

  return normalizedActions.map((action, index) => ({
    id: action.id,
    label: action.label,
    type: action.type,
    status: action.status,
    effort: action.effort,
    icon: getActionIcon(`${action.id || ""} ${action.type || ""} ${action.label || ""}`),
    iconSymbol: getActionIconSymbol(`${action.id || ""} ${action.type || ""} ${action.label || ""}`),
    title: action.label,
    detail: getRecommendedActionDetail(action),
    reason: getRecommendedActionReason(action, product),
    evidence: getRecommendedActionEvidence(action, product),
    priority: index === 0 ? "Primary next step" : getRecommendedActionPriority(action, product),
    application: getRecommendedActionApplication(action, product),
    meta: getRecommendedActionMeta(action),
    action: getRecommendedActionButtonLabel(action, index),
    mode: getRecommendedActionMode(action, index),
    payload: action.payload || {},
    appliedRecord: actionHistory.find((record) => record.actionId === action.id),
    submit: getRecommendedActionMode(action, index) === "submit",
  }));
}

function consolidateReviewRecommendedActions(actions = []) {
  const consolidated = actions.find((action) => action.id === "review-product-evidence");
  if (consolidated) {
    return actions.filter((action) => action.id === consolidated.id || !isLegacyReviewAction(action));
  }

  const reviewActions = actions.filter(isLegacyReviewAction);
  if (reviewActions.length <= 1) return actions;

  const firstReviewIndex = actions.findIndex(isLegacyReviewAction);
  const mergedReviewAction = {
    id: "review-product-evidence",
    label: "Review product evidence",
    type: "Workflow",
    effort: "Low",
    status: "Ready",
    payload: mergeReviewActionPayloads(reviewActions),
  };
  const withoutReviews = actions.filter((action) => !isLegacyReviewAction(action));
  return [
    ...withoutReviews.slice(0, firstReviewIndex),
    mergedReviewAction,
    ...withoutReviews.slice(firstReviewIndex),
  ];
}

function isLegacyReviewAction(action) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (action.id === "review-product-evidence") return false;
  return normalized.includes("workflow") && normalized.includes("review");
}

function mergeReviewActionPayloads(actions = []) {
  const payloads = actions.map((action) => action.payload || {});
  const reviewSections = actions.map((action) => buildReviewSectionFromAction(action)).filter(Boolean);
  return {
    reviewSections,
    focusSources: reviewSections.map((section) => section.source).filter(Boolean),
    topReturnReasons: uniqueStrings(payloads.flatMap((payload) => payload.topReturnReasons || [])),
    affectedVariants: uniqueStrings(payloads.flatMap((payload) => payload.affectedVariants || [])),
    contentIssues: payloads.flatMap((payload) => payload.contentIssues || []),
    negativeReviewCount: payloads.reduce((max, payload) => Math.max(max, Number(payload.negativeReviewCount || 0)), 0),
    avgRating: payloads.find((payload) => payload.avgRating)?.avgRating || 0,
    refundAmount: payloads.reduce((max, payload) => Math.max(max, Number(payload.refundAmount || 0)), 0),
    refundUnits: payloads.reduce((max, payload) => Math.max(max, Number(payload.refundUnits || 0)), 0),
    refundRate: payloads.reduce((max, payload) => Math.max(max, Number(payload.refundRate || 0)), 0),
  };
}

function buildReviewSectionFromAction(action) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("return")) {
    const reasons = Array.isArray(payload.topReturnReasons) ? payload.topReturnReasons : [];
    return {
      key: "returns",
      label: "Return reasons",
      source: "Shopify returns",
      count: payload.returnUnits || reasons.length,
      items: reasons.map((reason) => ({ label: reason, evidence: "Stored return reason" })),
    };
  }
  if (normalized.includes("variant")) {
    const variants = Array.isArray(payload.affectedVariants) ? payload.affectedVariants : [];
    return {
      key: "variants",
      label: "Affected variants",
      source: "Shopify variants",
      count: variants.length,
      items: variants.map((variant) => ({ label: variant, evidence: "Variant concentration" })),
    };
  }
  if (normalized.includes("refund")) {
    return {
      key: "refunds",
      label: "Refund impact",
      source: "Shopify refunds",
      count: payload.refundUnits || 0,
      items: [{ label: `${payload.refundUnits || 0} refunded units`, evidence: `${payload.refundRate || 0}% refund rate` }],
    };
  }
  if (normalized.includes("content") || normalized.includes("title") || normalized.includes("tag") || normalized.includes("collection")) {
    const contentIssues = Array.isArray(payload.contentIssues) ? payload.contentIssues : [];
    return {
      key: "content",
      label: "Title, tags and collection alignment",
      source: "Product content",
      count: contentIssues.length,
      items: contentIssues.map((issue) => (typeof issue === "string" ? { label: issue } : issue)),
    };
  }
  if (normalized.includes("review")) {
    return {
      key: "reviews",
      label: "Negative Judge.me reviews",
      source: "Judge.me reviews",
      count: payload.negativeReviewCount || 0,
      items: [{ label: `${payload.negativeReviewCount || 0} negative reviews`, evidence: `${payload.avgRating || 0} average rating` }],
    };
  }
  return null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function getEvidenceIndexForReviewTarget(target, evidenceSources = []) {
  if (typeof target === "number") return Math.max(0, Math.min(target, evidenceSources.length - 1));
  const payload = target?.payload || {};
  const focusSources = [
    ...(Array.isArray(payload.focusSources) ? payload.focusSources : []),
    ...(Array.isArray(payload.reviewSections) ? payload.reviewSections.map((section) => section.source || section.label) : []),
  ].map(normalizeEvidenceLabel).filter(Boolean);
  if (!focusSources.length) return 0;

  const matchedIndex = evidenceSources.findIndex((source) => {
    const title = normalizeEvidenceLabel(`${source.title || ""} ${source.source || ""}`);
    return focusSources.some((focus) => title.includes(focus) || focus.includes(title));
  });
  return matchedIndex >= 0 ? matchedIndex : 0;
}

function normalizeEvidenceLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getRecommendedActionDetail(action) {
  const payload = action.payload || {};
  if (Array.isArray(payload.faqItems) && payload.faqItems.length) return formatFaqItemsForDisplay(payload.faqItems);
  if (payload.draftText) return payload.draftText;
  if (payload.note) return payload.note;
  if (Array.isArray(payload.reviewSections) && payload.reviewSections.length) {
    return payload.reviewSections
      .map((section) => `${section.label}: ${formatInteger(section.count || section.items?.length || 0)} signal${Number(section.count || section.items?.length || 0) === 1 ? "" : "s"}`)
      .join(". ");
  }
  if (Array.isArray(payload.topReturnReasons) && payload.topReturnReasons.length) return payload.topReturnReasons.join(", ");
  if (Array.isArray(payload.affectedVariants) && payload.affectedVariants.length) return payload.affectedVariants.join(", ");
  if (Number(payload.refundAmount || 0) > 0) return `${formatMoney(payload.refundAmount)} refunded across ${formatInteger(payload.refundUnits || 0)} units`;
  return "Ready from current stored product signals.";
}

function isFaqRecommendedAction(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  return normalized.includes("faq") || Array.isArray(action.payload?.faqItems);
}

function getFaqRecommendedActionApplication(action, product = null, options = {}) {
  const payload = action.payload || {};
  const variants = getFaqApplicationVariants(payload);
  const defaultVariantId = payload.defaultApplyMode || variants[1]?.id || variants[0]?.id || "description-section";
  const variantId = variants.some((variant) => variant.id === options.variantId) ? options.variantId : defaultVariantId;
  const selectedVariant = variants.find((variant) => variant.id === variantId) || variants[0];
  const currentDescription = getCurrentDescriptionForAction(product, payload);
  const value = formatFaqItemsForDisplay(payload.faqItems, payload.draftText);
  const isMetafield = variantId === "metafield-json";

  return {
    kind: "shopify_product",
    editable: true,
    target: selectedVariant.target,
    operation: selectedVariant.operation,
    intro: getFaqApplicationIntro(variantId, payload),
    confirmationTitle: isMetafield ? "Confirm FAQ metafield update" : "Confirm product FAQ update",
    confirmationDetail: getFaqConfirmationDetail(variantId, payload),
    applyLabel: selectedVariant.applyLabel,
    valueLabel: isMetafield ? "FAQ questions and answers to save" : "FAQ questions and answers to add",
    value,
    currentValueLabel: "Current Shopify description",
    currentValue: isMetafield ? "" : currentDescription,
    insertionPosition: isMetafield ? "" : "append",
    variants,
    variantId,
    defaultVariantId,
    relatedActions: Array.isArray(payload.relatedActionLabels) ? payload.relatedActionLabels : [],
  };
}

function getFaqApplicationVariants(payload = {}) {
  const configured = Array.isArray(payload.applicationOptions) ? payload.applicationOptions : [];
  const defaults = [
    { id: "description-section", label: "Full FAQ in description", target: "Product description", operation: "Append FAQ section", applyLabel: "Add FAQ section" },
    { id: "description-collapsible", label: "Collapsible FAQ", target: "Product description", operation: "Append collapsible FAQ", applyLabel: "Add collapsible FAQ" },
    { id: "description-modal", label: "Modal-style FAQ", target: "Product description", operation: "Append modal-style FAQ", applyLabel: "Add FAQ modal" },
    { id: "metafield-json", label: "Product metafield", target: "Product metafield", operation: "Save JSON metafield", applyLabel: "Save FAQ metafield" },
  ];
  const configuredById = new Map(configured.map((item) => [item.id, item]));
  return defaults.map((item) => ({ ...item, ...(configuredById.get(item.id) || {}) }));
}

function getFaqApplicationIntro(variantId, payload = {}) {
  const reasons = Array.isArray(payload.faqNeed?.reasons) ? payload.faqNeed.reasons : [];
  const reasonText = reasons.length ? ` ProductPulse is suggesting FAQ coverage because ${reasons[0].toLowerCase()}` : "";
  if (variantId === "description-section") {
    return `This will append the generated questions and answers as a visible FAQ section in the Shopify product description.${reasonText}`;
  }
  if (variantId === "description-modal") {
    return `This will append a modal-style FAQ block to the Shopify product description using HTML that can be styled by the theme.${reasonText}`;
  }
  if (variantId === "metafield-json") {
    const namespace = payload.metafield?.namespace || "productpulse";
    const key = payload.metafield?.key || "faq_items";
    return `This will save the generated FAQ as JSON in the product metafield ${namespace}.${key}. A product template or theme block can render it from that metafield.${reasonText}`;
  }
  return `This will append a compact collapsible FAQ to the Shopify product description so shoppers can open it without making the PDP much longer.${reasonText}`;
}

function getFaqConfirmationDetail(variantId, payload = {}) {
  if (variantId === "metafield-json") {
    const namespace = payload.metafield?.namespace || "productpulse";
    const key = payload.metafield?.key || "faq_items";
    return `ProductPulse will write JSON FAQ data to ${namespace}.${key}. Existing product description HTML will not change.`;
  }
  if (variantId === "description-modal") return "ProductPulse will append modal-style FAQ HTML to the current Shopify product description.";
  if (variantId === "description-section") return "ProductPulse will append a visible FAQ section to the current Shopify product description.";
  return "ProductPulse will append a collapsible FAQ HTML block to the current Shopify product description.";
}

function formatFaqItemsForDisplay(faqItems = [], fallback = "") {
  const items = Array.isArray(faqItems) ? faqItems : [];
  if (!items.length) return String(fallback || "").trim();
  return items
    .map((item) => `${item.question}\n${item.answer}`)
    .join("\n\n");
}

function getRecommendedActionApplication(action, product = null, options = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();

  if (isFaqRecommendedAction(action)) {
    return getFaqRecommendedActionApplication(action, product, options);
  }

  if (payload.tag || normalized.includes("shopify tag") || normalized.includes("product tag")) {
    const tag = String(payload.tag || "").trim();
    return {
      kind: "shopify_product",
      editable: false,
      target: "Product tags",
      operation: "Add tag",
      intro: `This will add the Shopify product tag "${tag}" so the product can be segmented, filtered, or reviewed later.`,
      confirmationTitle: "Confirm product tag update",
      confirmationDetail: "ProductPulse will add this tag to the Shopify product. Existing tags will stay untouched.",
      applyLabel: "Add tag to product",
      valueLabel: "Tag to add",
      value: tag,
    };
  }

  if (payload.draftText && (normalized.includes("pdp") || normalized.includes("description") || normalized.includes("faq") || normalized.includes("fit"))) {
    const operation = getDescriptionOperationForAction(action);
    const currentDescription = getCurrentDescriptionForAction(product, payload);
    const value = getDescriptionActionValue({ action, product, operation, currentDescription });
    return {
      kind: "shopify_product",
      editable: true,
      target: "Product description",
      operation: getDescriptionOperationText(operation),
      intro: getDescriptionActionIntro(operation, action),
      confirmationTitle: "Confirm product description update",
      confirmationDetail: getDescriptionConfirmationDetail(operation),
      applyLabel: getDescriptionApplyLabel(operation),
      valueLabel: operation === "replace" ? "Suggested improved description" : "Text to add",
      value,
      currentValueLabel: "Current Shopify description",
      currentValue: currentDescription,
      insertionPosition: operation === "replace" ? "" : operation,
      relatedActions: Array.isArray(payload.relatedActionLabels) ? payload.relatedActionLabels : [],
    };
  }

  if (payload.note) {
    return {
      kind: "clipboard",
      editable: true,
      target: "Internal note",
      operation: "Copy note",
      intro: "This is an internal support note. It does not change Shopify product data; copy it and use it in your support workflow.",
      applyLabel: "Copy note",
      valueLabel: "Note text",
      value: payload.note,
    };
  }

  return {
    kind: "review",
    editable: false,
    target: "Product evidence",
    operation: Array.isArray(payload.reviewSections) && payload.reviewSections.length ? "Review related evidence" : "Review",
    intro: Array.isArray(payload.reviewSections) && payload.reviewSections.length
      ? "This groups the related review tasks into one evidence pass: returns, variants, refunds, reviews and content alignment when those signals exist."
      : "This action opens the supporting evidence so you can inspect the signal before deciding whether to change the product.",
    applyLabel: "Review evidence",
    valueLabel: "Evidence",
    value: getRecommendedActionDetail(action),
  };
}

function getDescriptionOperationForAction(action) {
  const payload = action.payload || {};
  if (["replace", "prepend", "append"].includes(payload.operation)) return payload.operation;
  if (["prepend", "append"].includes(payload.placement)) return payload.placement;
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (normalized.includes("rewrite-product-description") || normalized.includes("rewrite")) return "replace";
  if (normalized.includes("faq")) return "append";
  return "prepend";
}

function getDescriptionOperationText(operation) {
  if (operation === "replace") return "Improve description";
  if (operation === "append") return "Append to description";
  return "Add to top of description";
}

function getDescriptionActionIntro(operation, action = {}) {
  if (operation === "replace") {
    return "ProductPulse suggests improving the Shopify product description while preserving useful existing copy. The suggested draft can also incorporate related shopper-facing notes when they overlap.";
  }
  if (operation === "append") {
    return "ProductPulse suggests adding this section to the end of the Shopify product description. You can edit the text before applying it.";
  }
  const placement = action.payload?.placement === "append" ? "end" : "beginning";
  return `ProductPulse suggests adding this note to the ${placement} of the Shopify product description so shoppers see it before buying. You can edit the text before applying it.`;
}

function getDescriptionConfirmationDetail(operation) {
  if (operation === "replace") return "This will update the Shopify product description with the suggested text below. Existing useful copy is included in the draft when available.";
  if (operation === "append") return "This will append the text below to the existing Shopify product description.";
  return "This will add the text below to the top of the existing Shopify product description.";
}

function getDescriptionApplyLabel(operation) {
  if (operation === "replace") return "Update description";
  if (operation === "append") return "Append to product";
  return "Apply to product";
}

function getCurrentDescriptionForAction(product, payload = {}) {
  return String(product?.currentDescriptionText || payload.currentDescriptionText || "").trim();
}

function getDescriptionActionValue({ action, product, operation, currentDescription }) {
  const payload = action.payload || {};
  const draftText = String(payload.draftText || "").trim();
  if (operation !== "replace") return draftText;
  return buildEnhancedDescriptionPreview({
    currentDescription,
    suggestedText: draftText,
    relatedText: getRelatedDescriptionText(product, payload),
  });
}

function getRelatedDescriptionText(product, payload = {}) {
  const relatedIds = Array.isArray(payload.relatedActionIds) ? payload.relatedActionIds : [];
  if (!relatedIds.length || !Array.isArray(product?.recommendedActions)) return "";
  const relatedAction = product.recommendedActions.find((item) => relatedIds.includes(item.id) && item.payload?.draftText);
  return relatedAction?.payload?.draftText || "";
}

function buildEnhancedDescriptionPreview({ currentDescription, suggestedText, relatedText }) {
  const current = normalizeActionText(currentDescription);
  const suggested = normalizeActionText(suggestedText);
  const related = normalizeActionText(relatedText);
  const additions = [related, suggested].filter(Boolean);
  const uniqueAdditions = [];

  additions.forEach((addition) => {
    if (current && textIncludesMeaning(current, addition)) return;
    if (uniqueAdditions.some((existing) => textIncludesMeaning(existing, addition))) return;
    uniqueAdditions.push(addition);
  });

  if (!current) return uniqueAdditions.join("\n\n") || suggested;
  if (!uniqueAdditions.length) return current;
  return [current, ...uniqueAdditions].join("\n\n");
}

function normalizeActionText(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textIncludesMeaning(firstValue, secondValue) {
  const first = String(firstValue || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const second = String(secondValue || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!first || !second) return false;
  if (first.includes(second) || second.includes(first)) return true;
  const firstTokens = new Set(first.split(/\s+/).filter((token) => token.length > 4));
  const secondTokens = second.split(/\s+/).filter((token) => token.length > 4);
  if (!firstTokens.size || !secondTokens.length) return false;
  const shared = secondTokens.filter((token) => firstTokens.has(token)).length;
  return shared / Math.max(secondTokens.length, 1) >= 0.72;
}

function getRecommendedActionReason(action, product) {
  const payload = action.payload || {};
  const metrics = product.metrics || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  const contentIssueLabels = getContentIssueLabels(payload.contentIssues);

  if (Array.isArray(payload.reviewSections) && payload.reviewSections.length) {
    return `ProductPulse grouped ${payload.reviewSections.length} related review area${payload.reviewSections.length === 1 ? "" : "s"} so you can inspect the evidence once instead of working through overlapping review tasks.`;
  }

  if (contentIssueLabels.length) {
    return `ProductPulse found content issues that can reduce buyer confidence: ${contentIssueLabels.slice(0, 3).join(", ")}.`;
  }
  if (Array.isArray(payload.topReturnReasons) && payload.topReturnReasons.length) {
    return `Return evidence shows repeated reasons: ${payload.topReturnReasons.slice(0, 3).join(", ")}. Reviewing them helps separate product issues from operational noise.`;
  }
  if (Array.isArray(payload.affectedVariants) && payload.affectedVariants.length) {
    return `Signals are concentrated in specific variants: ${payload.affectedVariants.slice(0, 4).join(", ")}. This action focuses the review where risk is most likely.`;
  }
  if (Number(payload.refundAmount || 0) > 0) {
    return `Refund impact is measurable: ${formatMoney(payload.refundAmount)} across ${formatInteger(payload.refundUnits || 0)} units. This action checks whether the loss is preventable.`;
  }
  if (Number(payload.negativeReviewCount || 0) > 0) {
    return `${formatInteger(payload.negativeReviewCount)} negative Judge.me reviews are connected to this product. Reviewing them can clarify the language customers use.`;
  }
  if (Array.isArray(payload.faqItems) && payload.faqItems.length) {
    const reasons = Array.isArray(payload.faqNeed?.reasons) ? payload.faqNeed.reasons : [];
    if (reasons.length) return `ProductPulse found FAQ-worthy buyer uncertainty: ${reasons.slice(0, 2).join(" ")}`;
    return `ProductPulse generated ${payload.faqItems.length} FAQ item${payload.faqItems.length === 1 ? "" : "s"} from repeated diagnosis signals and product-content gaps.`;
  }
  if (payload.note) {
    return "This creates a concise internal note so support can respond consistently while the product issue is being reviewed.";
  }
  if (payload.draftText || normalized.includes("pdp") || normalized.includes("description") || normalized.includes("faq")) {
    const issue = product.primaryIssue || "current product signals";
    return `This is suggested because ProductPulse detected ${issue}. Clearer shopper-facing copy can reduce avoidable confusion before purchase.`;
  }
  if (metrics.signalCount) {
    return `This action is based on ${formatInteger(metrics.signalCount)} stored product signal${metrics.signalCount === 1 ? "" : "s"} across the available sources.`;
  }
  return "This action is available from the current diagnosis and can be reviewed before anything is applied.";
}

function getContentIssueLabels(contentIssues) {
  if (!Array.isArray(contentIssues)) return [];

  return contentIssues
    .map((issue) => {
      if (typeof issue === "string") return issue.trim();
      if (!issue || typeof issue !== "object") return "";
      return String(issue.label || issue.evidence || issue.code || issue.severity || "").trim();
    })
    .filter((label) => !isNonActionableContentText(label))
    .filter(Boolean);
}

function getRecommendedActionEvidence(action, product) {
  const payload = action.payload || {};
  const metrics = product.metrics || {};
  const evidence = [];

  if (Array.isArray(payload.reviewSections) && payload.reviewSections.length) {
    payload.reviewSections.slice(0, 3).forEach((section) => {
      evidence.push(`${formatInteger(section.count || section.items?.length || 0)} ${section.label}`);
    });
  }
  if (Array.isArray(payload.topReturnReasons) && payload.topReturnReasons.length) evidence.push(`${payload.topReturnReasons.length} return reason${payload.topReturnReasons.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.affectedVariants) && payload.affectedVariants.length) evidence.push(`${payload.affectedVariants.length} affected variant${payload.affectedVariants.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.contentIssues) && payload.contentIssues.length) evidence.push(`${payload.contentIssues.length} content issue${payload.contentIssues.length === 1 ? "" : "s"}`);
  if (Number(payload.refundAmount || 0) > 0) evidence.push(formatMoney(payload.refundAmount));
  if (Number(payload.negativeReviewCount || 0) > 0) evidence.push(`${formatInteger(payload.negativeReviewCount)} negative reviews`);
  if (Array.isArray(payload.faqItems) && payload.faqItems.length) {
    evidence.push(`${payload.faqItems.length} FAQ item${payload.faqItems.length === 1 ? "" : "s"}`);
    if (Number(payload.faqNeed?.signals || 0) > 0) evidence.push(`${formatInteger(payload.faqNeed.signals)} FAQ signal${Number(payload.faqNeed.signals) === 1 ? "" : "s"}`);
    if (Array.isArray(payload.faqNeed?.topics) && payload.faqNeed.topics[0]) evidence.push(payload.faqNeed.topics[0]);
  }
  if (!evidence.length && Number(metrics.signalCount || 0) > 0) evidence.push(`${formatInteger(metrics.signalCount)} product signals`);
  if (!evidence.length && Number(metrics.confidence || product.confidence || 0) > 0) evidence.push(`${metrics.confidence || product.confidence}% confidence`);

  return evidence.slice(0, 3);
}

function getRecommendedActionPriority(action, product) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("faq")) return "Buyer clarity";
  if (normalized.includes("rewrite") || normalized.includes("draft") || normalized.includes("description") || normalized.includes("fit")) return "Customer-facing fix";
  if (normalized.includes("review")) return "Evidence review";
  if (normalized.includes("support") || normalized.includes("note")) return "Team workflow";
  if (product.riskScore >= 75) return "High-risk product";
  return "Recommended";
}

function getRecommendedActionMeta(action) {
  return [
    { icon: getActionIcon(action.type), label: action.type },
    { icon: getActionStatusIcon(action.status), label: action.status },
    { icon: "wand", label: `${action.effort} effort` },
  ].filter((item) => item.label);
}

function getActionStatusIcon(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("draft")) return "wand";
  if (normalized.includes("ready")) return "check";
  if (normalized.includes("applied")) return "check";
  return "info";
}

function getProductCheckedItems(product) {
  const metrics = product.metrics || {};
  const sources = product.sourceCoverage || [];
  const items = [];
  const windowDays = metrics.windowDays || 0;
  const productMeta = [
    metrics.productType,
    metrics.vendor,
    Array.isArray(metrics.collections) && metrics.collections.length ? `${metrics.collections.length} collections` : "",
    Array.isArray(metrics.tags) && metrics.tags.length ? `${metrics.tags.length} tags` : "",
  ].filter(Boolean).join(" - ");

  if (sources.some((source) => String(source).toLowerCase().includes("product")) || productMeta) {
    items.push({
      icon: "product",
      label: "Shopify product data",
      value: `${metrics.variantCount ?? metrics.affectedVariants?.length ?? 0} variants`,
      detail: productMeta || "Product metadata stored",
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("order")) || Number(metrics.soldUnits || 0) > 0) {
    items.push({
      icon: "package",
      label: "Units sold analyzed",
      value: formatInteger(metrics.soldUnits || 0),
      detail: `${windowDays || 0} day Shopify order window`,
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("return")) || Number(metrics.returnUnits || 0) > 0) {
    items.push({
      icon: "return",
      label: "Returns analyzed",
      value: formatInteger(metrics.returnUnits || 0),
      detail: `${metrics.returnRate || 0}% return rate`,
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("refund")) || Number(metrics.refundUnits || 0) > 0) {
    items.push({
      icon: "cash-dollar",
      label: "Refunds analyzed",
      value: formatInteger(metrics.refundUnits || 0),
      detail: `${formatMoney(metrics.refundAmount || 0)} refunded`,
    });
  }

  if (Array.isArray(metrics.topReturnReasons) && metrics.topReturnReasons.length) {
    items.push({
      icon: "note",
      label: "Return reasons",
      value: formatInteger(metrics.topReturnReasons.length),
      detail: metrics.topReturnReasons.join(", "),
    });
  }

  if (Array.isArray(metrics.affectedVariants) && metrics.affectedVariants.length) {
    items.push({
      icon: "product",
      label: "Affected variants",
      value: formatInteger(metrics.affectedVariants.length),
      detail: metrics.affectedVariants.join(", "),
    });
  }

  if (Number(metrics.contentIssueCount || 0) > 0 || Number(metrics.descriptionWordCount || 0) > 0) {
    items.push({
      icon: "note",
      label: "Product content",
      value: `${metrics.contentQualityScore || 0}/100`,
      detail: `${formatInteger(metrics.descriptionWordCount || 0)} description words, ${formatInteger(metrics.contentIssueCount || 0)} content issues`,
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("judge")) || Number(metrics.reviewCount || 0) > 0) {
    items.push({
      icon: "star",
      label: "Judge.me reviews",
      value: formatInteger(metrics.reviewCount || 0),
      detail: `${metrics.avgRating || metrics.reviewRating || 0} avg rating, ${formatInteger(metrics.negativeReviewCount || 0)} negative`,
    });
  }

  return items;
}

function getRecommendedActionMode(action, index) {
  const normalizedType = String(action.type || "").toLowerCase();
  const normalizedId = String(action.id || "").toLowerCase();
  const payload = action.payload || {};
  const hasShopifyApplyPayload = Boolean(payload.draftText || payload.tag);
  if (normalizedId.includes("run-ai-diagnosis")) return "diagnose";
  if (hasShopifyApplyPayload && (normalizedType.includes("pdp copy") || normalizedType.includes("faq") || normalizedType.includes("tag"))) return "apply-product";
  if (hasShopifyApplyPayload && index === 0 && action.status === "Draft") return "apply-product";
  if (normalizedType.includes("internal") || normalizedId.includes("copy")) return "copy";
  if (normalizedType.includes("workflow") || normalizedId.includes("review-return")) return "review";
  return "submit";
}

function getRecommendedActionButtonLabel(action, index) {
  const mode = getRecommendedActionMode(action, index);
  if (mode === "apply-product") return getRecommendedActionApplication(action).applyLabel;
  if (mode === "copy") return "Copy note";
  if (mode === "review") return "Review";
  if (mode === "diagnose") return "Run";
  if (String(action.type || "").toLowerCase().includes("tag")) return "Apply tag";
  return action.status === "Draft" ? "Apply to Shopify" : "Apply";
}

function getActionIcon(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("refund")) return "cash-dollar";
  if (normalized.includes("return")) return "return";
  if (normalized.includes("variant")) return "product";
  if (normalized.includes("review")) return "star";
  if (normalized.includes("title") || normalized.includes("metadata")) return "note";
  if (normalized.includes("copy") || normalized.includes("description") || normalized.includes("pdp") || normalized.includes("quality")) return "note";
  if (normalized.includes("faq")) return "question-circle";
  if (normalized.includes("tag")) return "tag";
  if (normalized.includes("note")) return "duplicate";
  if (normalized.includes("workflow")) return "view";
  if (normalized.includes("apply") || normalized.includes("product")) return "product";
  return "wand";
}

function getActionIconSymbol(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("refund")) return "$";
  if (normalized.includes("return")) return "RET";
  if (normalized.includes("variant")) return "SKU";
  if (normalized.includes("review") && (normalized.includes("title") || normalized.includes("tag"))) return "R#";
  if (normalized.includes("review")) return "REV";
  if (normalized.includes("title") || normalized.includes("tag") || normalized.includes("metadata")) return "#";
  if (normalized.includes("faq")) return "?";
  if (normalized.includes("pdf")) return "PDF";
  if (normalized.includes("note")) return "NT";
  if (normalized.includes("copy") || normalized.includes("description") || normalized.includes("pdp") || normalized.includes("quality")) return "TXT";
  if (normalized.includes("workflow")) return "WF";
  if (normalized.includes("apply") || normalized.includes("product")) return "P";
  return "AI";
}

export function ProductDiagnosisScreen({ product, actionData }) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const evidencePanelRef = useRef(null);
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState(0);
  const [ignoredIssues, setIgnoredIssues] = useState(() => new Set());
  const [resolvedLocally, setResolvedLocally] = useState(Boolean(product?.resolvedAt));
  const [dismissedActionIds, setDismissedActionIds] = useState(() => new Set());
  const [toastData, setToastData] = useState(null);
  const [editingAction, setEditingAction] = useState(null);
  const [actionConfirmation, setActionConfirmation] = useState(null);
  const [diagnosisConfirmation, setDiagnosisConfirmation] = useState(null);
  const [recommendedActionsCollapsed, setRecommendedActionsCollapsed] = useState(false);
  const [draftText, setDraftText] = useState("");
  const pendingActionType = navigation.state === "submitting" ? navigation.formData?.get("_action") : null;
  const pendingActionId = navigation.state === "submitting" ? navigation.formData?.get("actionId") : null;

  useEffect(() => {
    setResolvedLocally(Boolean(product?.resolvedAt));
    setIgnoredIssues(new Set());
    setDismissedActionIds(new Set());
    setSelectedEvidenceIndex(0);
    setDiagnosisConfirmation(null);
    setRecommendedActionsCollapsed(false);
  }, [product?.slug, product?.resolvedAt]);

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success" && actionData?.action?.id === "mark-resolved") {
      setResolvedLocally(true);
    }
    if (actionData?.status === "success") {
      setActionConfirmation(null);
      setDiagnosisConfirmation(null);
    }
  }, [actionData]);

  useEffect(() => {
    if (actionData?.message && !actionData.suppressBanner) setToastData(actionData);
  }, [actionData]);

  useEffect(() => {
    if (!toastData) return undefined;
    const timeout = window.setTimeout(() => setToastData(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toastData]);

  useEffect(() => {
    if (navigation.state === "submitting") setToastData(null);
  }, [navigation.state]);

  if (!product) {
    return (
      <FullWidthPage heading="Product not found">
        <ScreenShell>
          <s-banner tone="critical" heading="This product is not in the current signal snapshot">
            Return to Products and choose another item.
          </s-banner>
          <Link className="ppPrimaryButton" to="/app/products">Back to Products</Link>
        </ScreenShell>
      </FullWidthPage>
    );
  }

  const detail = getProductDetailModel(product);
  const selectedEvidence = detail.evidenceSources[selectedEvidenceIndex] || detail.evidenceSources[0];
  const visibleRecommendedActions = detail.recommendedActions.filter((action) => !dismissedActionIds.has(action.id || action.title));
  const visibleRecommendedActionCount = detail.hasFullDiagnosis ? visibleRecommendedActions.length : 0;
  const resolved = resolvedLocally || Boolean(detail.resolvedAt);
  const diagnosisPending = pendingActionType === "diagnose";
  const resolvingPending = pendingActionType === "mark-resolved";
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/app/products");
  };
  const showToast = (message, status = "success") => setToastData({ status, message });

  const handleReviewEvidence = (target = 0) => {
    if (!detail.evidenceSources.length) {
      showToast("0 stored evidence sources for this product.", "validation_error");
      return;
    }
    const index = getEvidenceIndexForReviewTarget(target, detail.evidenceSources);
    setSelectedEvidenceIndex(index);
    window.requestAnimationFrame(() => {
      evidencePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleToggleRecommendedActions = () => {
    setRecommendedActionsCollapsed((current) => {
      const next = !current;
      if (next) setEditingAction(null);
      return next;
    });
  };

  const handleRequestProductDiagnosis = () => {
    if (!detail.canDiagnose || diagnosisPending) return;
    const productId = product.slug || product.handle || "";
    setDiagnosisConfirmation({
      mode: "single",
      title: "Confirm product analysis",
      products: [productId],
      productTitles: [detail.title],
      count: 1,
      credits: product.credits || 1,
    });
  };

  const handleConfirmProductDiagnosis = () => {
    if (!diagnosisConfirmation?.products?.length || diagnosisPending) return;
    const formData = new FormData();
    formData.set("_action", "diagnose");
    formData.set("productId", diagnosisConfirmation.products[0] || "");
    submit(formData, { method: "post" });
  };

  const handleIgnoreIssue = (issue) => {
    setIgnoredIssues((current) => {
      const next = new Set(current);
      next.add(issue.issue);
      return next;
    });
    showToast(`${issue.issue} ignored for this review session.`);
  };

  const handleCreateIssueAction = (issue) => {
    setEditingAction({
      id: `issue-${issue.issue}`,
      title: `Draft action for ${issue.issue}`,
      payload: { draftText: `Investigate ${issue.issue} and apply the suggested action: ${issue.action}.` },
    });
    setDraftText(`Investigate ${issue.issue} and apply the suggested action: ${issue.action}.`);
  };

  const handleEditAction = (action) => {
    setEditingAction(action);
    setDraftText(action.payload?.draftText || action.detail);
  };

  const handleCopyAction = async (action) => {
    const text = action.payload?.note || action.payload?.draftText || `${detail.title}: ${action.title}. ${action.detail}`;
    try {
      await window.navigator?.clipboard?.writeText(text);
    } catch {
      // Clipboard is not available in every embedded test/browser surface.
    }
    showToast(`${action.title} copied.`);
  };

  const handleRequestApplyAction = (action, editedText, application = null) => {
    setActionConfirmation({
      action,
      editedText,
      application: application || action.application || getRecommendedActionApplication(action, product),
    });
  };

  const handleDismissAction = (action) => {
    setDismissedActionIds((current) => {
      const next = new Set(current);
      next.add(action.id || action.title);
      return next;
    });
    showToast(`${action.title} dismissed for this review session.`);
  };

  return (
    <FullWidthPage label={`${detail.title} product`} className="ppProductDetailPage">
      <ScreenShell className="ppDashboard ppProductDetailScreen">
        <ProductDetailToast actionData={toastData} onDismiss={() => setToastData(null)} />

        <div className="ppProductDetailHeader">
          <button className="ppProductBackButton" type="button" onClick={handleBack}>
            <s-icon type="arrow-left" size="small"></s-icon>
            Back
          </button>
          <div className="ppProductTitleRow">
            <span className="ppProductHeroImageWrap">
              <ProductArt
                variant={detail.variant}
                label={detail.title}
                size="hero"
                imageUrl={detail.imageUrl}
                imageAlt={detail.imageAlt}
              />
            </span>
            <div>
              <div className="ppProductTitleHeading">
                <h1>{detail.title}</h1>
                {detail.hasFullDiagnosis && (
                  <ProductAnalysisStatusBadge product={product} showLabel={false} titleIcon completionOnly />
                )}
              </div>
              <p>
                {detail.hasFullDiagnosis ? "AI Product Diagnosis" : detail.analysisDepth === "quickscan" ? "QuickScan product signals" : "ProductPulse status"}
                {" - Last analyzed "}
                {detail.lastAnalysis}
              </p>
              <div className="ppBadgeRow">
                <InlineBadge tone={resolved ? "success" : detail.riskBadgeTone} icon={resolved ? "check" : "alert-circle"}>
                  {resolved ? "Resolved" : detail.riskLabel}
                </InlineBadge>
                {detail.showIssueBadge && <InlineBadge tone="warning" icon="product">{detail.issueBadge}</InlineBadge>}
                {detail.showEvidenceBadge && <InlineBadge tone="success" icon="star">{detail.evidenceLabel}</InlineBadge>}
              </div>
            </div>
          </div>
          <div className="ppProductHeaderActions">
            {detail.shopifyAdminUrl && (
              <a
                className="ppProductExternalButton"
                href={detail.shopifyAdminUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open product in Shopify admin"
              >
                <s-icon type="external" size="small"></s-icon>
              </a>
            )}
            {detail.diagnosisInProgress ? (
              <span className="ppProductDiagnosisRunning">
                <span className="ppMiniSpinner" aria-hidden="true" />
                {getProductDiagnosisRunningLabel(detail.activeDiagnosisJob)}
              </span>
            ) : (
              <button className="ppPrimaryButton" type="button" disabled={!detail.canDiagnose || diagnosisPending} onClick={handleRequestProductDiagnosis}>
                <s-icon type="wand" size="small"></s-icon>
                {diagnosisPending ? "Queueing..." : detail.diagnosisButtonLabel}
              </button>
            )}
            <Form method="post">
              <input type="hidden" name="_action" value="mark-resolved" />
              <input type="hidden" name="productId" value={product.slug} />
              <button className="ppSecondaryButton ppResolveButton" type="submit" disabled={!detail.canResolve || resolved || resolvingPending}>
                <s-icon type="check" size="small"></s-icon>
                {resolved ? "Resolved" : resolvingPending ? "Resolving..." : "Mark as resolved"}
              </button>
            </Form>
          </div>
        </div>

        <div className="ppProductSummaryGrid">
          <s-section padding="none">
            <div className="ppRiskSnapshot">
              <ProductInsightMetric
                title="Risk score"
                value={detail.riskScoreLabel}
                detail={`${detail.riskScore} / 100`}
                tone={detail.riskTone}
                sparkline={detail.riskTrend}
              />
              <ProductInsightMetric
                title="Confidence"
                value={detail.confidenceLabel}
                detail={`${detail.confidence}%`}
                footnote={`Based on ${detail.signalCount} signals`}
                tone="green"
                progress={detail.confidence}
              />
              <ProductInsightMetric
                title="Estimated impact"
                value={formatMoney(detail.estimatedImpact)}
                detail={`${formatMoney(detail.marginAtRisk)} estimated margin at risk`}
                footnote={`${detail.returnRate}% return rate`}
                tone="red"
              />
              <ProductInsightMetric
                title="Main issue"
                value={detail.issueCategory}
                detail={detail.issueDetail}
                tone={detail.issueTone}
                icon="product"
              />
              <ProductInsightMetric
                title="Recommended fix"
                value={detail.recommendedFix}
                detail={detail.recommendedFixDetail}
              />
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppMainFindingCard">
              <DashboardIcon type="shield-check-mark" tone={detail.findingTone} />
              <div>
                <span>Main finding</span>
                <h2>{detail.mainFindingTitle}</h2>
                <div className="ppMainFindingText">
                  {getMainFindingParagraphs(detail.mainFindingDetail).map((paragraph, index) => (
                    <p key={`${detail.slug}-main-finding-${index}`}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </div>
          </s-section>
        </div>

        <s-section padding="none">
          <div className={`ppProductPanel ppRecommendedActionsPanel ppRecommendedActionsFull${recommendedActionsCollapsed ? " isCollapsed" : ""}`}>
            <div className="ppRecommendedActionsHeader">
              <div>
                <h2>Recommended actions</h2>
                <span>
                  {detail.hasFullDiagnosis
                    ? `${visibleRecommendedActionCount} action${visibleRecommendedActionCount === 1 ? "" : "s"} available`
                    : "Run full diagnosis to unlock actions"}
                </span>
              </div>
              <button
                className="ppPanelCollapseButton"
                type="button"
                aria-expanded={!recommendedActionsCollapsed}
                aria-controls="pp-recommended-actions-content"
                onClick={handleToggleRecommendedActions}
              >
                <s-icon type={recommendedActionsCollapsed ? "chevron-down" : "chevron-up"} size="small"></s-icon>
                <span>{recommendedActionsCollapsed ? "Expand" : "Minimize"}</span>
              </button>
            </div>
            {!recommendedActionsCollapsed && (
              <div id="pp-recommended-actions-content">
                <div className="ppRecommendedActionList">
                  {!detail.hasFullDiagnosis ? (
                    <EmptyProductDetailState
                      message="Recommended actions will appear after you run the full product diagnosis for this product."
                      variant="recommendedActions"
                    />
                  ) : visibleRecommendedActions.length === 0 && (
                    <EmptyProductDetailState
                      message="0 deterministic recommended actions from current stored signals."
                      variant="recommendedActions"
                    />
                  )}
                  {visibleRecommendedActions.map((action) => (
                    <ProductRecommendedAction
                      key={action.title}
                      action={action}
                      product={product}
                      pending={pendingActionId === action.id || (action.mode === "diagnose" && diagnosisPending)}
                      onEdit={handleEditAction}
                      onCopy={handleCopyAction}
                      onReview={handleReviewEvidence}
                      onRequestApply={handleRequestApplyAction}
                      onDismiss={handleDismissAction}
                    />
                  ))}
                </div>
                {editingAction && (
                  <Form method="post" className="ppActionDraftEditor">
                    <input type="hidden" name="_action" value="apply-action" />
                    <input type="hidden" name="productId" value={product.slug} />
                    <input type="hidden" name="actionId" value={editingAction.id} />
                    <input type="hidden" name="label" value={editingAction.title} />
                    <label htmlFor="pp-action-draft">Draft</label>
                    <textarea
                      id="pp-action-draft"
                      name="draftText"
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                    />
                    <div>
                      <button className="ppSecondaryButton" type="button" onClick={() => setEditingAction(null)}>Cancel</button>
                      <button className="ppPrimaryButton" type="submit" disabled={pendingActionId === editingAction.id}>
                        {pendingActionId === editingAction.id ? "Saving..." : "Save draft"}
                      </button>
                    </div>
                  </Form>
                )}
              </div>
            )}
          </div>
        </s-section>

        <div className="ppProductDetailGrid">
          <div className="ppProductDetailMainColumn">
            <s-section padding="none">
              <div className="ppProductPanel" ref={evidencePanelRef}>
                <h2>Issues detected</h2>
                <div className="ppIssuesTableWrap">
                  <table className="ppIssuesTable">
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th>Severity</th>
                        <th>Confidence</th>
                        <th>Signals</th>
                        <th>Trend</th>
                        <th>Suggested action</th>
                        <th aria-label="More actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.detectedIssues.length === 0 && (
                        <tr className="ppIssuesEmptyRow">
                          <td colSpan="7">
                            <EmptyProductDetailState message="0 deterministic issues detected from stored product signals." />
                          </td>
                        </tr>
                      )}
                      {detail.detectedIssues.map((issue, index) => {
                        const ignored = ignoredIssues.has(issue.issue);

                        return (
                          <tr className={ignored ? "isIgnored" : ""} key={issue.issue}>
                            <td>
                              <span className="ppIssueNameCell">
                                <span className="ppIssueIcon" aria-hidden="true">
                                  <s-icon type={getIssueIcon(issue.issue)} size="small"></s-icon>
                                </span>
                                <span>
                                  <strong>{issue.issue}</strong>
                                  {issue.evidence?.length > 0 && (
                                    <small>{issue.evidence.slice(0, 2).join(" ")}</small>
                                  )}
                                </span>
                                {ignored && <s-badge tone="success">Ignored</s-badge>}
                              </span>
                            </td>
                            <td><s-badge tone={issue.tone}>{issue.severity}</s-badge></td>
                            <td>{issue.confidence}</td>
                            <td>{issue.signals}</td>
                            <td><MiniTrend tone={issue.trendTone} values={issue.trend} /></td>
                            <td>{issue.action}</td>
                            <td>
                              <IssueInlineActions
                                issue={issue}
                                onReview={() => handleReviewEvidence(detail.evidenceSources.length ? index % detail.evidenceSources.length : 0)}
                                onCreateAction={() => handleCreateIssueAction(issue)}
                                onIgnore={() => handleIgnoreIssue(issue)}
                                ignored={ignored}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </s-section>

            <s-section padding="none">
              <div className="ppProductPanel">
                <h2>Evidence by source</h2>
                {detail.evidenceSources.length > 0 ? (
                  <>
                    <div className="ppEvidenceTabs" role="tablist" aria-label="Evidence sources">
                      {detail.evidenceSources.map((source, index) => (
                        <button
                          className={index === selectedEvidenceIndex ? "isActive" : ""}
                          type="button"
                          role="tab"
                          aria-selected={index === selectedEvidenceIndex}
                          key={source.title}
                          onClick={() => setSelectedEvidenceIndex(index)}
                        >
                          <s-icon type={source.icon} size="small"></s-icon>
                          {source.title}
                        </button>
                      ))}
                    </div>
                    <EvidenceSourceCard source={selectedEvidence} featured />
                  </>
                ) : (
                  <EmptyProductDetailState message="0 evidence sources stored for this product yet." />
                )}
              </div>
            </s-section>
          </div>
          <s-section padding="none">
            <div className="ppCheckedPanel">
              <h2>What ProductPulse checked</h2>
              <div className="ppCheckedGrid">
                {detail.checkedItems.map((item) => (
                  <div className="ppCheckedItem" key={item.label}>
                    <s-icon type={item.icon}></s-icon>
                    <div>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </div>
                  </div>
                ))}
                {detail.checkedItems.length === 0 && (
                  <EmptyProductDetailState message="0 product-specific checks stored yet." />
                )}
              </div>
            </div>
          </s-section>
        </div>
        {diagnosisConfirmation && (
          <ProductAnalysisConfirmModal
            confirmation={diagnosisConfirmation}
            pending={diagnosisPending}
            pendingIds={diagnosisPending ? diagnosisConfirmation.products : []}
            onCancel={() => setDiagnosisConfirmation(null)}
            onConfirm={handleConfirmProductDiagnosis}
          />
        )}
        {actionConfirmation && (
          <RecommendedActionConfirmModal
            confirmation={actionConfirmation}
            product={product}
            pending={pendingActionType === "apply-action"}
            onCancel={() => setActionConfirmation(null)}
          />
        )}
      </ScreenShell>
    </FullWidthPage>
  );
}

function announceProductPulseJobs(actionData) {
  if (typeof window === "undefined" || actionData?.status !== "success") return;
  const jobs = [
    ...(Array.isArray(actionData.jobs) ? actionData.jobs : []),
    actionData.job,
  ].filter(Boolean);
  if (!jobs.length) return;
  window.dispatchEvent(new CustomEvent("productpulse:jobs-queued", { detail: { jobs } }));
}

export function AnalyticsScreen({ data }) {
  const analyticsView = data?.analytics || {};
  const [businessImpactOpen, setBusinessImpactOpen] = useState(false);
  const kpis = analyticsView.kpis || [];
  const issueDistribution = analyticsView.issueDistribution || { rows: [], max: 1 };
  const sourceContribution = analyticsView.sourceContribution || { rows: [], total: 0, totalLabel: "0" };
  const collectionMargin = analyticsView.collectionMargin || { rows: [], max: 1 };
  const topInsights = analyticsView.topInsights || [];
  const businessImpact = analyticsView.businessImpact || { title: "Estimated business impact", subtitle: "", metrics: [] };
  const riskSignals = analyticsView.riskSignals || { series: [], labels: [] };
  const riskBubbles = analyticsView.riskBubbles || [];

  return (
    <FullWidthPage label="Analytics" className="ppAnalyticsPage">
      <ScreenShell className="ppDashboard ppAnalyticsScreen">
        <div className="ppAnalyticsTopbar">
          <div>
            <h1>Analytics</h1>
            <p>Visualize product quality risk, issue trends and estimated impact.</p>
          </div>
          <div className="ppAnalyticsActions">
            <span><s-icon type="calendar" size="small"></s-icon>{analyticsView.windowLabel || "Stored scan window"}</span>
            <span><s-icon type="product" size="small"></s-icon>{analyticsView.productCountLabel || "0 stored products"}</span>
            <span><s-icon type="clock" size="small"></s-icon>{analyticsView.lastUpdatedLabel || "No scan data yet"}</span>
          </div>
        </div>

        <div className="ppAnalyticsKpis" aria-label="Analytics overview">
          {kpis.map((kpi) => (
            <AnalyticsKpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>

        <div className="ppAnalyticsChartGrid">
          <AnalyticsPanel title="Risk vs. margin impact" subtitle="Each bubble is a product, sized by margin at risk" className="ppAnalyticsPanelRiskMargin">
            <RiskRevenueBubbleChart bubbles={riskBubbles} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Issue distribution by type" subtitle="Signal count by issue cluster" className="ppAnalyticsPanelIssueDistribution">
            <HorizontalBarChart rows={issueDistribution.rows} max={issueDistribution.max} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Risk signals over time" subtitle="Stored QuickScan and full diagnosis signal trends" className="ppAnalyticsPanelLine">
            <RiskSignalsChart chart={riskSignals} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Source contribution" subtitle="Extracted signals by evidence source" className="ppAnalyticsPanelSource">
            <SourceContributionChart contribution={sourceContribution} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Margin at risk by collection" subtitle="Estimated margin at risk" className="ppAnalyticsPanelCollection">
            <HorizontalBarChart rows={collectionMargin.rows} max={collectionMargin.max} money />
          </AnalyticsPanel>
        </div>

        <div className="ppAnalyticsBottom">
          <s-section padding="none">
            <div className="ppAnalyticsPanel ppTopInsightsPanel">
              <h2>
                <s-icon type="lightbulb" size="small"></s-icon>
                Top insights
                <AnalyticsInfoPopover info={getAnalyticsPanelInfo("Top insights")} />
              </h2>
              <div className="ppTopInsightList">
                {topInsights.map((insight) => (
                  <p key={insight.text}>
                    <s-icon type={insight.icon} size="small"></s-icon>
                    {insight.text}
                  </p>
                ))}
              </div>
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppAnalyticsPanel ppBusinessImpactPanel">
              <div className="ppAnalyticsPanelHeader">
                <div>
                  <h2>
                    {businessImpact.title}
                    <AnalyticsInfoPopover info={getAnalyticsPanelInfo(businessImpact.title)} />
                  </h2>
                  <p>{businessImpact.subtitle}</p>
                </div>
              </div>
              <div className="ppBusinessImpactGrid">
                {businessImpact.metrics.map((metric) => (
                  <AnalyticsImpactMetric key={metric.label} metric={metric} />
                ))}
              </div>
              <button className="ppAnalyticsInfoLink" type="button" onClick={() => setBusinessImpactOpen(true)}>
                <s-icon type="info" size="small"></s-icon>
                Learn how ProductPulse AI improves these outcomes
              </button>
            </div>
          </s-section>
        </div>
        {businessImpactOpen && (
          <BusinessImpactInfoModal
            businessImpact={businessImpact}
            windowLabel={analyticsView.windowLabel || "Stored scan window"}
            onClose={() => setBusinessImpactOpen(false)}
          />
        )}
      </ScreenShell>
    </FullWidthPage>
  );
}

export function PreviewScreen({ data, actionData }) {
  return (
    <main className="ppPreview">
      <DashboardScreen data={data} actionData={actionData} />
      <nav className="ppPreviewNav" aria-label="Preview screens">
        <a href="#connect">Connect</a>
        <a href="#products">Products</a>
        <a href="#diagnosis">Diagnosis</a>
        <a href="#analytics">Analytics</a>
      </nav>
      <section id="connect"><ConnectScreen data={data} /></section>
      <section id="products"><ProductsScreen data={data} filters={{ query: "", risk: "all" }} /></section>
      <section id="diagnosis"><ProductDiagnosisScreen product={data.startHere} data={data} actionData={actionData} /></section>
      <section id="analytics"><AnalyticsScreen data={data} /></section>
    </main>
  );
}
function DashboardKpiCard({ kpi }) {
  const [trendValue, trendContext] = kpi.trend ? kpi.trend.split(" vs ") : [];

  return (
    <article className="ppDashboardKpi">
      <DashboardIcon type={kpi.icon} tone={kpi.tone} />
      <div>
        <h2>{kpi.label}</h2>
        <strong>{kpi.value}</strong>
        {kpi.trend ? (
          <span className="ppTrend">
            <strong>{trendValue}</strong>
            <span>vs {trendContext}</span>
          </span>
        ) : (
          <span className="ppKpiDetail">
            {kpi.detail}
            <s-icon type="info" size="small" color="subdued"></s-icon>
          </span>
        )}
      </div>
    </article>
  );
}

function DashboardIcon({ type, tone = "blue", size = "base" }) {
  return (
    <span className={`ppDashboardIcon ppDashboardIcon-${tone} ppDashboardIcon-${size}`} aria-hidden="true">
      <s-icon type={type}></s-icon>
    </span>
  );
}

function InlineBadge({ tone, icon, children }) {
  return (
    <span className={`ppInlineBadge ppInlineBadge-${tone}`}>
      <s-icon type={icon} size="small"></s-icon>
      <span>{children}</span>
    </span>
  );
}

function EvidenceMetric({ metric }) {
  return (
    <div className={`ppEvidenceMetric ppEvidenceMetric-${metric.tone || "neutral"}`}>
      <s-icon type={metric.icon}></s-icon>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.detail}</small>
    </div>
  );
}

function ProductArt({ variant, label, size = "small", imageUrl, imageAlt }) {
  return (
    <span
      className={`ppProductArt ppProductArt-${variant} ppProductArt-${size}`}
      role={imageUrl ? undefined : "img"}
      aria-label={imageUrl ? undefined : `${label} product image`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={imageAlt || `${label} product image`} loading="lazy" />
      ) : (
        <>
          <span className="ppProductShape" />
          <span className="ppProductAccent" />
          <span className="ppProductDetail" />
        </>
      )}
    </span>
  );
}

function ProductSignalCell({ product }) {
  const details = product.signalDetails || buildFallbackSignalDetails(product);

  return (
    <span className="ppSignalPopoverWrap">
      <button className="ppSignalTrigger" type="button" aria-label={`Explain signals for ${product.title}`}>
        <SignalBars tone={product.signalTone} values={product.signalBars || []} />
        <span>{product.signals}</span>
      </button>
      <span className="ppSignalPopover" role="tooltip">
        <strong>{details.summary}</strong>
        <span className="ppSignalPopoverList">
          {(details.bars || []).map((bar, index) => (
            <span className="ppSignalPopoverItem" key={`${bar.label}-${index}`}>
              <span className="ppSignalPopoverBar" aria-hidden="true">
                <span style={{ width: `${Math.max(5, Math.min(100, Number(bar.value || 0)))}%` }} />
              </span>
              <span>
                <b>{bar.label}</b>
                <small>{bar.detail}</small>
              </span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

function buildFallbackSignalDetails(product) {
  const values = product.signalBars || [];
  const fallbackBars = [
    ["Product setup", "Catalog setup, type, vendor, tags, collections, variants and SKUs."],
    ["PDP content", "Product page description and content-quality signals."],
    ["Reviews", "Connected review rating and negative-review pressure."],
    ["Repeated reasons", "Repeated return reasons, refund reasons, customer language or affected variants."],
    ["Refund pressure", "Refund units, refund rate, refund amount and refund notes."],
    ["Return pressure", "Return units, return rate and return reasons."],
    ["Recent trend", "Recent dated signal momentum in the latest scan window."],
  ];

  return {
    summary: `${product.issue || "Product quality"} risk score ${product.riskScore || 0}/100 from ${product.signals || 0} signals. Bars run left to right from product setup to post-purchase pressure.`,
    bars: fallbackBars.map(([label, detail], index) => ({
      label,
      value: values[index] || 0,
      detail,
    })),
  };
}

function SignalBars({ values, tone }) {
  return (
    <span className={`ppSignalBars ppSignalBars-${tone}`} aria-hidden="true">
      {values.map((value, index) => (
        <span key={`${value}-${index}`} style={{ height: `${value}%` }} />
      ))}
    </span>
  );
}

function IssueBar({ issue }) {
  return (
    <div className="ppIssueBar">
      <span>{issue.label}</span>
      <div>
        <span style={{ width: `${issue.pct}%` }} />
      </div>
      <strong>{issue.displayValue || issue.value}</strong>
    </div>
  );
}

function SuggestedFix({ fix }) {
  return (
    <a className="ppFixItem" href={fix.href || "/app/products"}>
      <s-icon type={fix.icon}></s-icon>
      <span>{fix.label}</span>
      <s-badge tone={fix.tone}>{fix.impact}</s-badge>
      <s-icon type="chevron-right" size="small"></s-icon>
    </a>
  );
}

function DashboardInsightPanel({ panel }) {
  return (
    <div className="ppDashboardPanel ppDashboardInsightPanel">
      <div className="ppDashboardPanelHeader">
        <h2>{panel.title}</h2>
        {panel.detail && <span>{panel.detail}</span>}
      </div>
      {panel.visual === "analysisCoverage" ? (
        <AnalysisCoverageDonut rows={panel.rows || []} compact />
      ) : (
        <div className="ppIssueBars">
          {(panel.rows || []).map((row) => (
            <IssueBar key={`${panel.title}-${row.label}`} issue={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductSourceIconGroup({ sources, overflow }) {
  const sourceTokens = (sources || []).map(normalizeSourceToken);
  const overflowCount = Number(overflow || 0);
  const hasFullSourceList = sourceTokens.length > 3;
  const totalCount = sourceTokens.length + (hasFullSourceList ? 0 : overflowCount);
  const primarySource = sourceTokens[0] || normalizeSourceToken("source");

  return (
    <span className="ppSourceTokenWrap">
      <button className="ppSourceSummaryTrigger" type="button" aria-label={`${totalCount || 1} source${totalCount === 1 ? "" : "s"} used for this product`}>
        <span className={`ppSourceSummaryGlyph ppSourceSummaryGlyph-${primarySource.key}`} aria-hidden="true">
          <s-icon type="duplicate" size="small"></s-icon>
        </span>
      </button>
      <span className="ppSourcePopover ppSourceSummaryPopover" role="tooltip">
        <strong>Sources used</strong>
        <span className="ppSourcePopoverList">
          {sourceTokens.map((source, index) => (
            <span className="ppSourcePopoverRow" key={`${source.key}-${source.label}-${index}`}>
              <span className={`ppSourceGlyph ppSourceToken-${source.key}`} aria-hidden="true">{getSourceGlyph(source.key)}</span>
              <span>
                <b>{source.label}</b>
                <small>{source.detail}</small>
              </span>
            </span>
          ))}
          {!sourceTokens.length && (
            <span className="ppSourcePopoverRow">
              <span className="ppSourceGlyph" aria-hidden="true">S</span>
              <span>
                <b>Signal source</b>
                <small>No source detail stored for this product yet.</small>
              </span>
            </span>
          )}
          {!hasFullSourceList && overflowCount > 0 && (
            <small>{overflowCount} additional source{overflowCount === 1 ? "" : "s"} stored for this product.</small>
          )}
        </span>
      </span>
    </span>
  );
}

function normalizeSourceToken(source) {
  if (source && typeof source === "object") return source;
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("product") || normalized.includes("catalog")) {
    return { key: "products", label: "Products", shortLabel: "PDP", detail: "Shopify product, variant, tag and collection data." };
  }
  if (normalized.includes("order") || normalized.includes("sale")) {
    return { key: "orders", label: "Orders", shortLabel: "ORD", detail: "Shopify order line items and sold units." };
  }
  if (normalized.includes("refund")) {
    return { key: "refunds", label: "Refunds", shortLabel: "REF", detail: "Shopify refunded units and refund amount." };
  }
  if (normalized.includes("return")) {
    return { key: "returns", label: "Returns", shortLabel: "RET", detail: "Shopify return units and return reasons." };
  }
  if (normalized.includes("review") || normalized.includes("judge") || normalized.includes("csv") || normalized.includes("star")) {
    return { key: "reviews", label: "Reviews", shortLabel: "REV", detail: "Customer review ratings, text and complaint themes." };
  }
  if (normalized.includes("support") || normalized.includes("chat")) {
    return { key: "support", label: "Support", shortLabel: "SUP", detail: "Support conversations and buyer questions." };
  }
  return { key: "source", label: "Signal source", shortLabel: "SRC", detail: "Additional connected signal source." };
}

function getSourceGlyph(key) {
  const glyphs = {
    products: "P",
    orders: "#",
    refunds: "$",
    returns: "R",
    reviews: "*",
    support: "?",
  };
  return glyphs[key] || "S";
}

function ProductActionMenu({ product, open, onToggle, onClose }) {
  const [copied, setCopied] = useState(false);
  const handle = product.handle || product.href?.split("/").filter(Boolean).pop() || product.title;

  const handleCopy = async () => {
    try {
      await window.navigator?.clipboard?.writeText(handle);
    } catch {
      // The action still updates locally when clipboard access is unavailable.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    onClose();
  };

  return (
    <span className="ppActionMenuWrap">
      <button
        className="ppIconButton"
        type="button"
        aria-expanded={open}
        aria-label={`More actions for ${product.title}`}
        onClick={onToggle}
      >
        <s-icon type="menu-horizontal" size="small"></s-icon>
      </button>
      {open && (
        <span className="ppActionMenu" role="menu">
          <Link role="menuitem" to={product.href} onClick={onClose}>
            <s-icon type="view" size="small"></s-icon>
            View diagnostics
          </Link>
          <button role="menuitem" type="button" onClick={handleCopy}>
            <s-icon type="duplicate" size="small"></s-icon>
            {copied ? "Copied handle" : "Copy handle"}
          </button>
          {product.resolvedAt ? (
            <button role="menuitem" type="button" disabled>
              <s-icon type="check" size="small"></s-icon>
              Resolved
            </button>
          ) : (
            <Form method="post" role="none">
              <input type="hidden" name="_action" value="mark-resolved" />
              <input type="hidden" name="productId" value={getProductActionKey(product)} />
              <button role="menuitem" type="submit" onClick={onClose}>
                <s-icon type="check" size="small"></s-icon>
                Mark as resolved
              </button>
            </Form>
          )}
        </span>
      )}
    </span>
  );
}

function ProductInsightMetric({ title, value, detail, footnote, tone = "neutral", progress, sparkline, icon }) {
  const trendValues = Array.isArray(sparkline) ? sparkline : [];
  const helpText = getInsightMetricHelp(title);

  return (
    <div className={`ppProductInsight ppProductInsight-${tone}`}>
      <span>
        {title}
        <button className="ppInsightInfoWrap" type="button" aria-label={`What ${title} means`}>
          <s-icon type="info" size="small" color="subdued"></s-icon>
          <span className="ppInsightTooltip" role="tooltip">{helpText}</span>
        </button>
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {trendValues.length > 0 && <MiniTrend tone={getTrendTone(trendValues)} size="large" values={trendValues} />}
      {icon && <DashboardIcon type={icon} tone="blue" size="small" />}
      {typeof progress === "number" && (
        <div className="ppProductInsightProgress" aria-label={`${progress}% confidence`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {footnote && (
        <em>
          {footnote.includes("18%") && <span className="ppTrendArrow" aria-hidden="true" />}
          {footnote}
        </em>
      )}
    </div>
  );
}

function getInsightMetricHelp(title) {
  switch (title) {
    case "Risk score":
      return "Deterministic score from the stored product signals. Higher values mean this product should be reviewed before lower-ranked products.";
    case "Confidence":
      return "How complete and consistent the available signals are for this diagnosis. More stored evidence generally increases confidence.";
    case "Estimated impact":
      return "Estimated revenue opportunity at risk from refunds, return rate, negative review pressure and recent product signals. Margin at risk is shown underneath.";
    case "Main issue":
      return "The strongest issue category found in the product's current signals, such as returns, refunds, variants or expectation mismatch.";
    case "Recommended fix":
      return "The safest next action ProductPulse can recommend from deterministic evidence before any deeper AI review.";
    default:
      return "Product-specific signal summary calculated from the evidence stored for this product.";
  }
}

function EvidenceSourceCard({ source, featured = false }) {
  return (
    <article className={`ppEvidenceSourceCard ${featured ? "isFeatured" : ""}`.trim()}>
      <div className="ppEvidenceSourceHeader">
        <h3>
          <s-icon type={source.icon} size="small"></s-icon>
          {source.title}
        </h3>
        <span>{source.points.length} signals</span>
      </div>
      <div className="ppEvidencePointList">
        {source.points.map((point, index) => (
          <EvidencePoint point={point} key={`${point}-${index}`} />
        ))}
      </div>
    </article>
  );
}

function EvidencePoint({ point }) {
  const parsed = parseEvidencePoint(point);
  return (
    <div className={`ppEvidencePoint ppEvidencePoint-${parsed.tone}`} aria-label={point}>
      <span className="ppEvidencePointMarker" aria-hidden="true"></span>
      <div>
        {parsed.label && <strong>{parsed.label}</strong>}
        <p>{renderEvidenceText(parsed.body || parsed.label || point)}</p>
      </div>
    </div>
  );
}

function parseEvidencePoint(point) {
  const text = String(point || "").trim();
  const [rawLabel, ...rest] = text.split(":");
  const hasLabel = rest.length > 0 && rawLabel.length <= 42;
  const body = hasLabel ? rest.join(":").trim() : text;
  return {
    label: hasLabel ? rawLabel.trim() : "",
    body,
    tone: getEvidencePointTone(text),
  };
}

function getEvidencePointTone(text) {
  const normalized = String(text || "").toLowerCase();
  if (normalized.includes("negative") || normalized.includes("high risk") || normalized.includes("refunded") || normalized.includes("return-note reactions")) return "negative";
  if (normalized.includes("positive") || normalized.includes("healthy") || normalized.includes("satisfaction") || normalized.includes("delight")) return "positive";
  if (normalized.includes("neutral") || normalized.includes("monitor") || normalized.includes("weak")) return "neutral";
  if (normalized.includes("emotion") || normalized.includes("sentiment") || normalized.includes("language")) return "insight";
  return "default";
}

function renderEvidenceText(text) {
  const tokens = String(text || "").split(/(\bnegative\b|\bpositive\b|\bneutral\b|\breturns?\b|\brefunds?\b|\breviews?\b|\bemotions?\b|\bsentiment\b|\bsubjective\b|\bAI\b|\d+(?:\.\d+)?%?|\$[\d,]+(?:\.\d+)?|"[^"]+")/gi);
  return tokens.filter(Boolean).map((token, index) => {
    const normalized = token.toLowerCase();
    if (/^"/.test(token)) return <em className="ppEvidenceQuote" key={`${token}-${index}`}>{token}</em>;
    if (normalized === "negative") return <span className="ppEvidenceTextNegative" key={`${token}-${index}`}>{token}</span>;
    if (normalized === "positive") return <span className="ppEvidenceTextPositive" key={`${token}-${index}`}>{token}</span>;
    if (normalized === "neutral") return <span className="ppEvidenceTextNeutral" key={`${token}-${index}`}>{token}</span>;
    if (/^\d/.test(token) || /^\$/.test(token)) return <span className="ppEvidenceNumber" key={`${token}-${index}`}>{token}</span>;
    if (/\b(return|returns|refund|refunds|review|reviews|emotion|emotions|sentiment|subjective|ai)\b/i.test(token)) {
      return <span className="ppEvidenceKeyword" key={`${token}-${index}`}>{token}</span>;
    }
    return token;
  });
}

function EmptyProductDetailState({ message, variant = "default" }) {
  const recommendedActions = variant === "recommendedActions";

  return (
    <div className={`ppProductDetailEmpty${recommendedActions ? " ppProductDetailEmpty-recommended" : ""}`}>
      <s-icon type={recommendedActions ? "wand" : "info"} size={recommendedActions ? "large" : "small"}></s-icon>
      <span>{message}</span>
    </div>
  );
}

function ProductDetailToast({ actionData, onDismiss }) {
  if (!actionData?.message || actionData.suppressBanner) return null;
  const tone = actionData.status === "success" ? "success" : actionData.status === "validation_error" ? "warning" : "critical";

  return (
    <div className={`ppProductToast ppProductToast-${tone}`} role="status">
      <s-icon type={tone === "success" ? "check" : "info"} size="small"></s-icon>
      <span>{actionData.message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        <s-icon type="x" size="small"></s-icon>
      </button>
    </div>
  );
}

function IssueInlineActions({ issue, onReview, onCreateAction, onIgnore, ignored }) {
  return (
    <span className="ppIssueInlineActions" aria-label={`Actions for ${issue.issue}`}>
      <button
        type="button"
        aria-label={`Review evidence for ${issue.issue}`}
        onClick={onReview}
      >
        <s-icon type="view" size="small"></s-icon>
        <span role="tooltip">Review evidence</span>
      </button>
      <button
        type="button"
        aria-label={`Create action draft for ${issue.issue}`}
        onClick={onCreateAction}
      >
        <s-icon type="wand" size="small"></s-icon>
        <span role="tooltip">Create action draft</span>
      </button>
      <button
        type="button"
        aria-label={`${ignored ? "Ignored" : "Ignore"} ${issue.issue}`}
        disabled={ignored}
        onClick={onIgnore}
      >
        <s-icon type={ignored ? "check" : "x"} size="small"></s-icon>
        <span role="tooltip">{ignored ? "Already ignored" : "Ignore for now"}</span>
      </button>
    </span>
  );
}

function MiniTrend({ tone = "red", size = "base", values = [] }) {
  const trend = normalizeSparklineValues(values, size);
  const pathPoints = trend.points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <span className={`ppMiniTrend ppMiniTrend-${tone} ppMiniTrend-${size}`} aria-hidden="true">
      <svg viewBox={`0 0 ${trend.width} ${trend.height}`} focusable="false">
        <polyline points={pathPoints} />
      </svg>
    </span>
  );
}

function normalizeSparklineValues(values, size = "base") {
  const sourceValues = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  const fallback = Array.from({ length: 7 }, () => 0);
  const width = size === "large" ? 70 : 62;
  const height = size === "large" ? 26 : 20;
  const normalized = normalizeTrendForSparkline(sourceValues.length ? sourceValues : fallback);
  const max = Math.max(...normalized, 1);
  const min = Math.min(...normalized);
  const range = max - min;
  const horizontalStep = width / Math.max(normalized.length - 1, 1);
  const verticalPadding = 3;
  const drawableHeight = height - verticalPadding * 2;
  const points = normalized.map((value, index) => ({
    x: Math.round(index * horizontalStep * 10) / 10,
    y: Math.round((range > 0
      ? height - verticalPadding - ((value - min) / range) * drawableHeight
      : height / 2) * 10) / 10,
  }));

  return { width, height, points };
}

function normalizeTrendForSparkline(values) {
  const cleaned = values.map((value) => Math.max(0, Number(value) || 0));
  if (!cleaned.some((value) => value > 0)) return cleaned.map(() => 0);
  return cleaned.map((value, index) => {
    const previous = cleaned[index - 1] ?? value;
    const next = cleaned[index + 1] ?? value;
    return previous * 0.2 + value * 0.6 + next * 0.2;
  });
}

function ProductRecommendedAction({ action, product, pending = false, onEdit, onCopy, onReview, onRequestApply, onDismiss }) {
  const baseApplication = getRecommendedActionApplication(action, product);
  const [selectedVariantId, setSelectedVariantId] = useState(baseApplication.defaultVariantId || baseApplication.variantId || "");
  const application = getRecommendedActionApplication(action, product, { variantId: selectedVariantId || baseApplication.defaultVariantId });
  const actionStateKey = action.id || action.title || "";
  const productStateKey = product?.slug || product?.id || "";
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [editedText, setEditedText] = useState(application.value || action.detail || "");
  const [isEditingInline, setIsEditingInline] = useState(false);
  const applied = action.appliedRecord?.status === "applied";
  const drafted = action.appliedRecord?.status === "draft";
  const mode = action.mode || (action.submit ? "submit" : "edit");
  const actionId = action.id || action.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const buttonText = applied
    ? "Applied"
    : drafted
      ? "Draft saved"
      : pending
        ? "Working..."
        : mode === "apply-product"
          ? application.applyLabel
          : action.action;
  const detailText = String(application.editable ? editedText : action.detail || "");
  const hasLongDetail = detailText.length > 300 || detailText.split(/\s+/).length > 70;
  const disabled = pending || applied;
  const actionButton = getRecommendedActionButton(action, mode, buttonText, disabled, {
    actionId,
    application,
    editedText,
    product,
    onCopy,
    onEdit,
    onRequestApply,
    onReview,
  });

  useEffect(() => {
    setSelectedVariantId(baseApplication.defaultVariantId || baseApplication.variantId || "");
    setIsEditingInline(false);
    setDetailExpanded(false);
  }, [actionStateKey, productStateKey, baseApplication.defaultVariantId, baseApplication.variantId]);

  useEffect(() => {
    setEditedText(application.value || action.detail || "");
    setIsEditingInline(false);
  }, [application.value, action.detail]);

  return (
    <article className={`ppProductActionItem ${applied || drafted ? "isApplied" : ""}`.trim()}>
      <div className="ppProductActionHeader">
        <div className="ppProductActionIcon">
          <s-icon type={action.icon} size="small"></s-icon>
          <span className="ppProductActionIconFallback">{action.iconSymbol || "AI"}</span>
        </div>
        <div className="ppProductActionTitleBlock">
          <h3>{action.title}</h3>
          <div className="ppProductActionPills">
            <span className="ppActionPriorityPill">{action.priority}</span>
            {action.appliedRecord && <em>{applied ? "Applied" : "Draft saved"}</em>}
          </div>
        </div>
      </div>
      <div className="ppProductActionBody">
        <div className="ppActionApplicationIntro">
          <strong>{application.operation}</strong>
          <p>{application.intro}</p>
        </div>
        {application.variants?.length > 1 && (
          <div className="ppActionVariantChooser" role="group" aria-label={`How to apply ${action.title}`}>
            <span>Apply as</span>
            <div>
              {application.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  className={variant.id === application.variantId ? "isSelected" : ""}
                  onClick={() => setSelectedVariantId(variant.id)}
                >
                  <strong>{variant.label}</strong>
                  <small>{variant.operation}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {application.currentValue && (
          <div className="ppActionCurrentValueBox">
            <span>{application.currentValueLabel || "Current value"}</span>
            <CurrentDescriptionInsertionPreview application={application} />
          </div>
        )}
        {application.relatedActions?.length > 0 && (
          <div className="ppActionRelatedBox">
            <s-icon type="link" size="small"></s-icon>
            <span>Related suggestion: {application.relatedActions.join(", ")}</span>
          </div>
        )}
        {application.editable && isEditingInline ? (
          <label className="ppActionInlineEditor">
            <span>{application.valueLabel}</span>
            <textarea
              aria-label="Description text to apply"
              value={editedText}
              rows={detailExpanded ? 10 : 6}
              onChange={(event) => setEditedText(event.target.value)}
            />
          </label>
        ) : application.editable ? (
          <div className="ppActionSuggestionBox">
            <span>{application.valueLabel}</span>
            <p className={`ppActionDetailText ppActionSuggestionText ${hasLongDetail && !detailExpanded ? "isClamped" : ""}`.trim()}>{detailText}</p>
            <button className="ppActionEditSuggestionButton" type="button" onClick={() => setIsEditingInline(true)} aria-label={`Edit suggested text for ${action.title}`}>
              <s-icon type="edit" size="small"></s-icon>
              <span>Edit</span>
            </button>
          </div>
        ) : (
          <p className={`ppActionDetailText ${hasLongDetail && !detailExpanded ? "isClamped" : ""}`.trim()}>{detailText}</p>
        )}
        {hasLongDetail && !isEditingInline && (
          <button className="ppActionDetailToggle" type="button" onClick={() => setDetailExpanded((expanded) => !expanded)}>
            {detailExpanded ? "Show less" : "Show more"}
          </button>
        )}
        <div className="ppActionReasonBox">
          <span>
            <s-icon type="info" size="small"></s-icon>
            Why this is suggested
          </span>
          <p>{action.reason}</p>
        </div>
        <div className="ppActionMetaRow">
          {action.meta.map((meta) => (
            <span key={`${actionId}-${meta.label}`}>
              <s-icon type={meta.icon} size="small"></s-icon>
              {meta.label}
            </span>
          ))}
          {action.evidence.map((item) => (
            <span className="ppActionEvidencePill" key={`${actionId}-${item}`}>
              <s-icon type="chart-line" size="small"></s-icon>
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="ppProductActionCta">
        <button className="ppActionDismissButton" type="button" onClick={() => onDismiss(action)} disabled={pending || applied}>
          <s-icon type="x" size="small"></s-icon>
          <span>Dismiss</span>
        </button>
        {actionButton}
      </div>
    </article>
  );
}

function CurrentDescriptionInsertionPreview({ application, asPre = false }) {
  const currentValue = String(application.currentValue || "");
  const marker = getDescriptionInsertionMarker(application);
  const content = (
    <>
      {marker?.position === "prepend" && <DescriptionInsertionMarker label={marker.label} />}
      {asPre ? <pre>{currentValue}</pre> : <p>{currentValue}</p>}
      {marker?.position === "append" && <DescriptionInsertionMarker label={marker.label} />}
    </>
  );

  return asPre ? <div className="ppDescriptionInsertionPreview isPre">{content}</div> : <div className="ppDescriptionInsertionPreview">{content}</div>;
}

function DescriptionInsertionMarker({ label }) {
  return (
    <span className="ppDescriptionInsertionMarker">
      <s-icon type="plus-circle" size="small"></s-icon>
      {label}
    </span>
  );
}

function getDescriptionInsertionMarker(application = {}) {
  const position = application.insertionPosition;
  if (position === "prepend") return { position, label: "ProductPulse text will be added here, before the current description" };
  if (position === "append") return { position, label: "ProductPulse text will be added here, after the current description" };
  return null;
}

function getRecommendedActionButton(action, mode, buttonText, disabled, context) {
  const { actionId, application, editedText, product, onCopy, onEdit, onRequestApply, onReview } = context;
  const content = (
    <>
      <span>{buttonText}</span>
      <s-icon type={disabled ? "check" : "chevron-right"} size="small"></s-icon>
    </>
  );

  if (mode === "edit") {
    return (
      <button className="ppActionCtaButton" type="button" disabled={disabled} onClick={() => onEdit(action)}>
        {content}
      </button>
    );
  }
  if (mode === "apply-product") {
    return (
      <button className="ppActionCtaButton" type="button" disabled={disabled} onClick={() => onRequestApply(action, application.editable ? editedText : application.value, application)}>
        {content}
      </button>
    );
  }
  if (mode === "copy") {
    const copyAction = {
      ...action,
      payload: {
        ...(action.payload || {}),
        note: application.editable ? editedText : action.payload?.note,
        draftText: application.editable ? editedText : action.payload?.draftText,
      },
      detail: application.editable ? editedText : action.detail,
    };
    return (
      <button className="ppActionCtaButton" type="button" onClick={() => onCopy(copyAction)}>
        {content}
      </button>
    );
  }
  if (mode === "review") {
    return (
      <button className="ppActionCtaButton" type="button" onClick={() => onReview(action)}>
        {content}
      </button>
    );
  }
  if (mode === "diagnose") {
    return (
      <Form method="post">
        <input type="hidden" name="_action" value="diagnose" />
        <input type="hidden" name="productId" value={product.slug} />
        <button className="ppActionCtaButton" type="submit" disabled={disabled}>{content}</button>
      </Form>
    );
  }
  return (
    <Form method="post">
      <input type="hidden" name="_action" value="apply-action" />
      <input type="hidden" name="productId" value={product.slug} />
      <input type="hidden" name="actionId" value={actionId} />
      <button className="ppActionCtaButton" type="submit" disabled={disabled}>{content}</button>
    </Form>
  );
}

function ConnectCategoryCard({
  category,
  locked = false,
  onToggleIgnored,
  onOpenJudgeMe,
  onOpenChatMe,
  onOpenCsv,
  onLocalActiveChange,
  persistConnectState = false,
  pendingSourceKey = "",
}) {
  const status = locked ? "Always on" : category.ignored ? "Ignored" : category.connected ? "Connected" : "Needs source";
  const statusTone = locked || category.connected || category.ignored ? "success" : "warning";

  return (
    <s-section padding="none">
      <article className={`ppConnectCategory ${category.ignored ? "isIgnored" : ""}`.trim()}>
        <div className="ppConnectCategoryHeader">
          <div>
            <h2>
              <DashboardIcon type={category.icon} tone={category.tone} size="small" />
              {category.title}
              <span>{category.tag}</span>
            </h2>
            <p>{category.coverageNote}</p>
          </div>
          <div className="ppConnectCategoryControls">
            {!locked && <s-badge tone={statusTone}>{status}</s-badge>}
            {locked ? (
              <button className="ppIgnoreCategoryButton" type="button" disabled>Always on</button>
            ) : (
              <button
                className="ppIgnoreCategoryButton"
                type="button"
                aria-pressed={category.ignored}
                onClick={() => onToggleIgnored(category)}
              >
                {category.ignored ? "Use category" : "Ignore category"}
              </button>
            )}
          </div>
        </div>

        <div className="ppConnectSourceTableWrap">
          <table className="ppConnectSourceTable">
            <thead>
              <tr>
                <th>Source</th>
                <th>What it provides</th>
                <th>Signals extracted</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {category.sources.map((source) => (
                <tr className={getConnectSourceRowClass(source)} key={source.name}>
                  <td>
                    <div className="ppConnectSourceName">
                      <ConnectSourceLogo source={source} />
                      <span>
                        {source.name}
                        {!source.available && !source.locked && <small>{source.detail}</small>}
                      </span>
                    </div>
                  </td>
                  <td>{source.source}</td>
                  <td>{source.provides}</td>
                  <td>
                    <div className={`ppConnectStatus ppConnectStatus-${getConnectStatusTone(source.status)}`}>
                      <span />
                      <strong>{source.status}</strong>
                      {source.detail && <small>{source.detail}</small>}
                    </div>
                  </td>
                  <td>
                    <ConnectSourceActions
                      source={source}
                      persistConnectState={persistConnectState}
                      pending={pendingSourceKey === source.key}
                      onOpenJudgeMe={onOpenJudgeMe}
                      onOpenChatMe={onOpenChatMe}
                      onOpenCsv={onOpenCsv}
                      onLocalActiveChange={onLocalActiveChange}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </s-section>
  );
}

function ConnectSourceActions({
  source,
  persistConnectState,
  pending,
  onOpenJudgeMe,
  onOpenChatMe,
  onOpenCsv,
  onLocalActiveChange,
}) {
  if (source.locked) {
    return <button className="ppConnectSmallButton" type="button" disabled>Included</button>;
  }

  if (!source.available) {
    return <button className="ppConnectSmallButton" type="button" disabled>Coming soon</button>;
  }

  const activeButton = source.connected && (
    persistConnectState ? (
      <Form method="post" className="ppInlineForm">
        <input type="hidden" name="_action" value="set-source-active" />
        <input type="hidden" name="sourceKey" value={source.key} />
        <input type="hidden" name="active" value={source.active ? "false" : "true"} />
        <button className="ppConnectSmallButton ppConnectSmallButton-ghost" type="submit" disabled={pending}>
          {pending ? "Saving..." : source.active ? "Disable" : "Enable"}
        </button>
      </Form>
    ) : (
      <button
        className="ppConnectSmallButton ppConnectSmallButton-ghost"
        type="button"
        onClick={() => onLocalActiveChange(source, !source.active)}
      >
        {source.active ? "Disable" : "Enable"}
      </button>
    )
  );

  if (source.actionKind === "judgeme") {
    return (
      <div className="ppConnectActions">
        <button className="ppConnectSmallButton" type="button" onClick={onOpenJudgeMe}>
          {source.connected ? "Manage" : "Manage"}
        </button>
        {activeButton}
      </div>
    );
  }

  if (source.actionKind === "chatme") {
    return (
      <div className="ppConnectActions">
        <button className="ppConnectSmallButton" type="button" onClick={onOpenChatMe}>
          {source.connected ? "Manage" : "Manage"}
        </button>
        {activeButton}
      </div>
    );
  }

  if (source.actionKind === "csv") {
    return (
      <div className="ppConnectActions">
        <button className="ppConnectSmallButton" type="button" onClick={onOpenCsv}>
          {source.action}
        </button>
        {activeButton}
      </div>
    );
  }

  return <button className="ppConnectSmallButton" type="button" disabled>{source.action}</button>;
}

function getConnectSourceRowClass(source) {
  const classes = [];
  if (!source.available && !source.locked) classes.push("isUnavailable");
  if (source.available && source.connected && !source.active && !source.locked) classes.push("isDisabled");
  return classes.join(" ");
}

function ConnectCoverageCard({ categories, coverage, activeWeight }) {
  const ignoredWeight = categories.reduce((total, category) => (
    category.ignored ? total + category.weight : total
  ), 0);
  const connectedWeight = categories.reduce((total, category) => (
    category.connected && !category.ignored ? total + category.weight : total
  ), 0);
  const missingWeight = Math.max(0, 100 - coverage);

  return (
    <div className="ppConnectCoverageCard">
      <div className="ppDashboardPanelHeader">
        <h2>
          Data coverage
          <s-icon type="info" size="small" color="subdued"></s-icon>
        </h2>
        <p>Customer-signal coverage only. Shopify baseline data is excluded.</p>
      </div>

      <div className="ppConnectPieWrap">
        <div
          className="ppConnectPie"
          style={{ "--coverage-gradient": getConnectCoverageGradient(categories) }}
          aria-label={`${coverage}% effective customer-signal coverage`}
        >
          <strong>{coverage}%</strong>
          <span>Effective coverage</span>
        </div>
        <div className="ppConnectPieSummary">
          <p><strong>{connectedWeight}%</strong> connected signal weight</p>
          <p><strong>{ignoredWeight}%</strong> ignored by merchant choice</p>
          <p><strong>{missingWeight}%</strong> still missing</p>
          <small>{activeWeight}% active source weight after ignored categories.</small>
        </div>
      </div>

      <div className="ppConnectCoverageLegend">
        {categories.map((category) => {
          const ignored = category.ignored;
          const complete = category.connected || ignored;
          return (
            <div className={complete ? "isComplete" : ""} key={category.id}>
              <span>
                <i className={`ppConnectLegendDot ppConnectLegendDot-${category.id}`} />
                {category.title}
              </span>
              <strong>{category.weight}%</strong>
              <small>{ignored ? "Ignored" : category.connected ? "Connected" : "Missing"}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JudgeMeConnectionModal({ source, persistConnectState, isConnecting, onCancel, onLocalSubmit }) {
  const formProps = persistConnectState ? { method: "post" } : { onSubmit: onLocalSubmit };
  return (
    <div className="ppConnectionModalOverlay" role="presentation">
      <section className="ppConnectionModal" role="dialog" aria-modal="true" aria-labelledby="judgeme-connect-title">
        <div className="ppConnectionModalHeader">
          <ConnectSourceLogo source={source} />
          <div>
            <span>Judge.me</span>
            <h2 id="judgeme-connect-title">Judge.me Reviews</h2>
            <p>Enter your credentials to connect ProductPulse AI.</p>
          </div>
        </div>

        <Form {...formProps} className="ppConnectionForm">
          <input type="hidden" name="_action" value="connect-judgeme" />
          <label className="ppConnectionField">
            <span>Private API token</span>
            <input
              name="privateApiToken"
              type="password"
              autoComplete="off"
              placeholder="Paste your Judge.me private API token"
              required
            />
          </label>
          <p className="ppConnectionHint">
            ProductPulse tests the token before saving it and stores the connection for future syncs.
          </p>

          <div className="ppConnectionLinkRow">
            <a href={judgeMeConnectionLinks.app} target="_blank" rel="noreferrer">
              Open Judge.me API settings
              <s-icon type="external" size="small"></s-icon>
            </a>
            <a href={judgeMeConnectionLinks.docs} target="_blank" rel="noreferrer">
              Judge.me API documentation
              <s-icon type="external" size="small"></s-icon>
            </a>
          </div>

          <div className="ppConnectionModalFooter">
            <button className="ppConnectSmallButton ppConnectSmallButton-ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="ppPrimaryButton" type="submit" disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}

function ChatMeConnectionModal({ source, persistConnectState, isConnecting, onCancel, onLocalSubmit }) {
  const formProps = persistConnectState ? { method: "post" } : { onSubmit: onLocalSubmit };
  return (
    <div className="ppConnectionModalOverlay" role="presentation">
      <section className="ppConnectionModal" role="dialog" aria-modal="true" aria-labelledby="chatme-connect-title">
        <div className="ppConnectionModalHeader">
          <ConnectSourceLogo source={source} />
          <div>
            <span>ChatMe</span>
            <h2 id="chatme-connect-title">ChatMe Reviews</h2>
            <p>Enter your credentials to connect ProductPulse AI.</p>
          </div>
        </div>

        <Form {...formProps} className="ppConnectionForm">
          <input type="hidden" name="_action" value="connect-chatme" />
          <label className="ppConnectionField">
            <span>Private API token</span>
            <input
              name="privateApiToken"
              type="password"
              autoComplete="off"
              placeholder="Paste your private API token"
              required
            />
          </label>
          <p className="ppConnectionHint">
            ProductPulse tests the token before saving it and stores the connection for future syncs.
          </p>

          <div className="ppConnectionLinkRow">
            <a href={chatMeConnectionLinks.app} target="_blank" rel="noreferrer">Open ChatMe</a>
            <a href={chatMeConnectionLinks.docs} target="_blank" rel="noreferrer">Where to find the API token</a>
          </div>

          <div className="ppConnectionModalFooter">
            <button className="ppConnectSmallButton ppConnectSmallButton-ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="ppPrimaryButton" type="submit" disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}

function CsvUploadModal({ source, persistConnectState, isUploading, actionData, onCancel, onLocalSubmit }) {
  const formProps = persistConnectState ? { method: "post", encType: "multipart/form-data" } : { onSubmit: onLocalSubmit };
  const uploadError = actionData?.status && actionData.status !== "success" ? actionData.message : "";
  return (
    <div className="ppConnectionModalOverlay" role="presentation">
      <section className="ppConnectionModal" role="dialog" aria-modal="true" aria-labelledby="csv-upload-title">
        <div className="ppConnectionModalHeader">
          <ConnectSourceLogo source={source} />
          <div>
            <span>CSV reviews</span>
            <h2 id="csv-upload-title">Upload review data</h2>
            <p>Upload a CSV with product handles, ratings and review text.</p>
          </div>
        </div>

        <Form {...formProps} className="ppConnectionForm">
          <input type="hidden" name="_action" value="upload-csv" />
          <label className="ppConnectionField">
            <span>CSV file</span>
            <input name="csvFile" type="file" accept=".csv,text/csv" required disabled={isUploading} />
          </label>
          <p className="ppConnectionHint">
            ProductPulse reads the headers with AI, finds product, rating and review text columns, then saves a normalized review file for this store.
          </p>
          {isUploading && (
            <div className="ppCsvProcessingPanel" role="status">
              <span className="ppCsvProcessingSpinner" aria-hidden="true"></span>
              <div>
                <strong>Processing CSV</strong>
                <p>Uploading the file, detecting review columns and normalizing product-linked reviews.</p>
              </div>
            </div>
          )}
          {uploadError && !isUploading && (
            <div className="ppCsvUploadError" role="alert">
              <s-icon type="alert-circle" size="small"></s-icon>
              <span>{uploadError}</span>
            </div>
          )}

          <div className="ppConnectionModalFooter">
            <button className="ppConnectSmallButton ppConnectSmallButton-ghost" type="button" onClick={onCancel} disabled={isUploading}>
              Cancel
            </button>
            <button className="ppPrimaryButton" type="submit" disabled={isUploading}>
              {isUploading ? "Processing..." : "Upload CSV"}
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}

function ConnectionToast({ actionData }) {
  if (!actionData?.message || actionData.status !== "success") return null;
  return (
    <div className="ppConnectionToast" role="status">
      <s-icon type="check-circle" size="small"></s-icon>
      {actionData.message}
    </div>
  );
}

function ConnectSourceLogo({ source }) {
  return (
    <span className={`ppConnectSourceLogo ppConnectSourceLogo-${source.tone}`} aria-hidden="true">
      {source.logoUrl ? <img src={source.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : source.logo}
    </span>
  );
}

function getConnectStatusTone(status) {
  if (status === "Connected" || status === "Always on") return "green";
  if (status === "Planned") return "orange";
  return "gray";
}

function getConnectCoverageGradient(categories) {
  let cursor = 0;
  const colors = {
    reviews: "var(--pp-pulse-blue)",
    returns: "var(--pp-signal-teal)",
    support: "var(--pp-warning-amber)",
    ignored: "var(--pp-slate-500)",
    missing: "var(--pp-slate-200)",
  };
  const stops = categories.map((category) => {
    const start = cursor;
    const end = cursor + category.weight;
    cursor = end;
    const color = category.ignored
      ? colors.ignored
      : category.connected
        ? colors[category.id]
        : colors.missing;
    return `${color} ${start}% ${end}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function ScreenShell({ children, className = "" }) {
  return <div className={`ppShell ${className}`.trim()}>{children}</div>;
}

function FullWidthPage({ heading, label, className = "", children }) {
  const titleId = heading ? `pp-page-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
  const labelProps = heading ? { "aria-labelledby": titleId } : { "aria-label": label };

  return (
    <main className={`ppFullWidthPage ${className}`.trim()} {...labelProps}>
      {heading && <h1 id={titleId} className="ppPageTitle">{heading}</h1>}
      {children}
    </main>
  );
}

function ActionBanner({ actionData, hideSuccess = false }) {
  if (!actionData || actionData.suppressBanner) return null;
  if (hideSuccess && actionData.status === "success") return null;
  const tone = actionData.status === "success" ? "success" : actionData.status === "validation_error" ? "warning" : "critical";
  return (
    <s-banner tone={tone} heading={actionData.status === "success" ? "Done" : "Action needs attention"}>
      {actionData.message}
    </s-banner>
  );
}

function PermissionBanner({ permissionState }) {
  if (permissionState?.hasRequiredScopes) return null;
  return (
    <s-banner tone="critical" heading="Missing Shopify permissions">
      ProductPulse needs {permissionState.missingScopes.join(", ")} to calculate complete product quality signals.
    </s-banner>
  );
}

function AnalyticsKpiCard({ kpi }) {
  return (
    <article className="ppAnalyticsKpi">
      <DashboardIcon type={kpi.icon} tone={kpi.tone} />
      <div>
        <h2>{kpi.label}</h2>
        <strong>{kpi.value}</strong>
        {kpi.trend ? (
          <span className={`ppAnalyticsTrend ppAnalyticsTrend-${kpi.trendTone || "neutral"}`}>
            {kpi.trendTone === "green" ? <span className="ppTrendArrowUp" aria-hidden="true" /> : <span className="ppTrendArrow" aria-hidden="true" />}
            <b>{kpi.trend}</b>
            {kpi.context}
          </span>
        ) : (
          <span className="ppAnalyticsDetail">{kpi.detail}</span>
        )}
      </div>
    </article>
  );
}

function AnalyticsPanel({ title, subtitle, action, className = "", children }) {
  const info = getAnalyticsPanelInfo(title);

  return (
    <div className={`ppAnalyticsPanelShell ${className}`.trim()}>
      <s-section padding="none">
        <div className={`ppAnalyticsPanel ${className}`.trim()}>
          <div className="ppAnalyticsPanelHeader">
            <div>
              <h2>
                {title}
                <AnalyticsInfoPopover info={info} />
              </h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {action}
          </div>
          {children}
        </div>
      </s-section>
    </div>
  );
}

function AnalyticsInfoPopover({ info }) {
  const panelInfo = info || getAnalyticsPanelInfo("");
  return (
    <span className="ppAnalyticsInfoPopover">
      <button className="ppAnalyticsInfoButton" type="button" aria-label={`About ${panelInfo.title}`}>
        <s-icon type="info" size="small" color="subdued"></s-icon>
      </button>
      <span className="ppAnalyticsInfoBubble" role="tooltip">
        <strong>{panelInfo.title}</strong>
        <span>{panelInfo.body}</span>
        {panelInfo.items?.length > 0 && (
          <span className="ppAnalyticsInfoList">
            {panelInfo.items.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

function getAnalyticsPanelInfo(title = "") {
  const normalizedTitle = String(title).toLowerCase();
  if (normalizedTitle.includes("risk signals over time")) {
    return {
      title: "Risk signals over time",
      body: "Shows how stored product-quality signals are moving across the current scan window. It uses saved QuickScan and full diagnosis trend arrays, not synthetic forecast data.",
      items: [
        "Red, amber and green lines separate high, medium and low risk buckets.",
        "Each point is built from the available signal trend stored for products in that bucket.",
      ],
    };
  }
  if (normalizedTitle.includes("issue distribution")) {
    return {
      title: "Issue distribution by type",
      body: "Groups all detected issues into readable issue clusters and sums the stored signal count behind each cluster.",
      items: [
        "Full diagnosis issues are used first when available.",
        "QuickScan products fall back to their primary issue and signal count.",
      ],
    };
  }
  if (normalizedTitle.includes("source contribution")) {
    return {
      title: "Source contribution",
      body: "Breaks down where the evidence is coming from so you can see which sources are driving the current risk picture.",
      items: [
        "Includes returns, refunds, reviews, customer language and product-content checks when those signals exist.",
        "If no detailed counts exist, it falls back to stored source coverage.",
      ],
    };
  }
  if (normalizedTitle.includes("risk vs") || normalizedTitle.includes("risk versus")) {
    return {
      title: "Risk vs. margin impact",
      body: "Plots products by risk and estimated margin exposure so you can prioritize work by urgency and financial relevance.",
      items: [
        "X-axis: deterministic product risk score, starting slightly below the lowest plotted product and ending at 100.",
        "Y-axis and bubble size: estimated margin at risk for that product.",
        "Hover a bubble for product details; click it to open the product diagnosis page.",
      ],
    };
  }
  if (normalizedTitle.includes("margin at risk by collection")) {
    return {
      title: "Margin at risk by collection",
      body: "Aggregates product-level margin exposure into Shopify collections or product-type fallbacks.",
      items: [
        "A product in multiple stored collections can contribute proportionally to more than one collection.",
        "Only stored products with calculated margin exposure are included.",
      ],
    };
  }
  if (normalizedTitle.includes("analysis coverage")) {
    return {
      title: "Analysis coverage by depth",
      body: "Compares how many stored products only have QuickScan results against how many already have a full AI product diagnosis.",
      items: [
        "QuickScan only means the product has lightweight Shopify-native risk scoring.",
        "Full diagnosis means the deeper product-specific analysis has been completed.",
      ],
    };
  }
  if (normalizedTitle.includes("top insights")) {
    return {
      title: "Top insights",
      body: "Summarizes the highest-signal observations ProductPulse can make from the stored analytics dataset.",
      items: [
        "Insights are ranked from issue concentration, high-risk impact, source coverage and diagnosis coverage.",
        "They are meant to guide attention, not replace product-level diagnosis.",
      ],
    };
  }
  if (normalizedTitle.includes("estimated business impact")) {
    return {
      title: "Estimated business impact",
      body: "Projects where product-quality work could reduce revenue leakage over the visible analysis window.",
      items: [
        "Uses stored refund value, projected return exposure, review pressure and eligible recommended actions.",
        "This is a prioritization model, not an accounting report.",
      ],
    };
  }
  return {
    title: "Analytics panel",
    body: "Explains how this panel is calculated from stored ProductPulse scan and diagnosis data.",
    items: [],
  };
}

function RiskSignalsChart({ chart }) {
  const series = chart?.series || [];
  const labels = chart?.labels || [];

  return (
    <div className="ppAnalyticsLineWrap">
      <div className="ppAnalyticsLegend">
        {series.map((row) => (
          <span key={row.label}><i className={`ppDot-${row.color}`} />{row.label}</span>
        ))}
      </div>
      <svg className="ppRiskSignalsSvg" viewBox="0 0 640 245" role="img" aria-label="Risk signals over time">
        {[28, 68, 108, 148, 188].map((y) => (
          <line className="ppChartGridLine" key={y} x1="50" y1={y} x2="620" y2={y} />
        ))}
        {[100, 80, 60, 40, 20, 0].map((label, index) => (
          <text className="ppChartAxisText" key={label} x="12" y={32 + index * 32}>{label}</text>
        ))}
        {series.map((row) => (
          <polyline
            key={row.label}
            className={`ppRiskLine ppRiskLine-${row.color}`}
            points={getAnalyticsLinePoints(row.values)}
          />
        ))}
        {labels.map((label, index) => label && (
          <text className="ppChartAxisText" key={`${label}-${index}`} x={50 + index * (570 / Math.max(labels.length - 1, 1))} y="230">{label}</text>
        ))}
      </svg>
    </div>
  );
}

function HorizontalBarChart({ rows, max, money = false }) {
  const safeRows = rows?.length ? rows : [{ label: "No data", value: 0, displayValue: money ? "$0" : "0" }];
  const safeMax = Math.max(Number(max || 0), ...safeRows.map((row) => Number(row.value || 0)), 1);
  const axisLabels = buildBarAxisLabels(safeMax, money);

  return (
    <div className="ppAnalyticsBarChart" role="img" aria-label="Horizontal bar chart">
      {safeRows.map((row) => (
        <div className="ppAnalyticsBarRow" key={row.label}>
          <span>{row.label}</span>
          <div>
            <span className={`ppAnalyticsBar ppAnalyticsBar-${row.color || "blue"}`} style={{ width: `${Math.max(0, Math.min(100, (Number(row.value || 0) / safeMax) * 100))}%` }} />
          </div>
          <strong>{row.displayValue || (money ? formatMoney(row.value) : formatInteger(row.value))}</strong>
        </div>
      ))}
      <div className="ppAnalyticsBarAxis">
        {axisLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function SourceContributionChart({ contribution }) {
  const rows = contribution?.rows || [];
  const totalLabel = contribution?.totalLabel || "0";
  const donutGradient = buildDonutGradient(rows);

  return (
    <div className="ppSourceContribution">
      <div className="ppDonutChart" aria-label="Source contribution donut chart" style={{ "--pp-donut-gradient": donutGradient }}>
        <div>
          <strong>{totalLabel}</strong>
          <span>Total signals</span>
        </div>
      </div>
      <div className="ppDonutLegend">
        {(rows.length ? rows : [{ label: "No source signals", color: "blue", percent: 0, displayValue: "0 signals" }]).map((row) => (
          <div key={row.label}>
            <span><i className={`ppDot-${row.color}`} />{row.label}</span>
            <strong>{row.percent}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalysisCoverageDonut({ rows, compact = false }) {
  const safeRows = rows?.length ? rows : [
    { label: "Full diagnosis", value: 0, percent: 0, color: "purple", displayValue: "0%" },
    { label: "QuickScan only", value: 0, percent: 0, color: "blue", displayValue: "0%" },
  ];
  const fullRow = safeRows.find((row) => String(row.label || "").toLowerCase().includes("full")) || safeRows[0];
  const quickRow = safeRows.find((row) => String(row.label || "").toLowerCase().includes("quick")) || safeRows[1];
  const total = safeRows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const fullPercent = total ? Math.round((Number(fullRow?.value || 0) / total) * 100) : 0;
  const donutGradient = buildDonutGradient(safeRows);

  return (
    <div className={`ppAnalysisCoverageDonut${compact ? " isCompact" : ""}`.trim()}>
      <div className="ppDonutChart ppAnalysisDepthDonut" aria-label="Analysis coverage by depth" style={{ "--pp-donut-gradient": donutGradient }}>
        <div>
          <strong>{fullPercent}%</strong>
          <span>Full diagnosis</span>
        </div>
      </div>
      <div className="ppDonutLegend">
        {[fullRow, quickRow].filter(Boolean).map((row) => (
          <div key={row.label}>
            <span><i className={`ppDot-${row.color || "blue"}`} />{row.label}</span>
            <strong>{row.displayValue || `${row.percent || 0}%`}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskRevenueBubbleChart({ bubbles }) {
  const safeBubbles = bubbles?.length ? bubbles : [];
  const maxImpact = Math.max(...safeBubbles.map((bubble) => Number(bubble.impact || 0)), 0);
  const yAxisMax = getRiskBubbleAxisMax(maxImpact);
  const xAxis = getRiskBubbleXAxis(safeBubbles);
  const yTicks = getRiskBubbleYAxisTicks(yAxisMax);
  const [activeBubble, setActiveBubble] = useState(null);
  const showBubble = (event, bubble) => {
    setActiveBubble({
      bubble,
      position: getRiskBubblePopoverPosition(event.currentTarget),
    });
  };

  return (
    <div className="ppRiskRevenueWrap">
      <div className="ppBubbleChart" role="group" aria-label="Risk score compared with revenue impact">
        <div className="ppBubbleYTicks" aria-hidden="true">
          {yTicks.map((tick) => (
            <span key={tick.value} className="ppBubbleYTick" style={{ bottom: `${tick.position}%` }}>{tick.label}</span>
          ))}
        </div>
        <div className="ppBubblePlot">
          {xAxis.ticks.slice(1).map((tick) => (
            <span key={`x-${tick}`} className="ppBubbleGridLine ppBubbleGridLine-x" style={{ left: `${getRiskBubbleXPosition(tick, xAxis)}%` }} />
          ))}
          {yTicks.slice(1).map((tick) => (
            <span key={`y-${tick.value}`} className="ppBubbleGridLine ppBubbleGridLine-y" style={{ bottom: `${tick.position}%` }} />
          ))}
          {safeBubbles.map((bubble) => {
            const position = getRiskBubblePlotPosition(bubble, yAxisMax, xAxis);
            return (
              <Link
                key={`${bubble.label}-${bubble.riskScore}-${bubble.impact}-${bubble.size}`}
                className={`ppRiskBubble ppRiskBubble-${bubble.tone}`}
                to={bubble.href || "/app/products"}
                style={{ left: `${position.x}%`, bottom: `${position.y}%`, width: `${bubble.size}px`, height: `${bubble.size}px` }}
                aria-label={`${bubble.label}: open product detail. Risk ${bubble.riskScore}, margin impact ${formatMoney(bubble.impact || 0)}`}
                onMouseEnter={(event) => showBubble(event, bubble)}
                onFocus={(event) => showBubble(event, bubble)}
                onMouseLeave={() => setActiveBubble(null)}
                onBlur={() => setActiveBubble(null)}
              />
            );
          })}
        </div>
        <div className="ppBubbleXTicks" aria-hidden="true">
          {xAxis.ticks.map((tick) => (
            <span key={tick} className="ppBubbleXTick" style={{ left: `${getRiskBubbleXPosition(tick, xAxis)}%` }}>{tick}</span>
          ))}
        </div>
        <span className="ppBubbleAxis ppBubbleAxis-y">Margin impact</span>
        <span className="ppBubbleAxis ppBubbleAxis-x">Risk score</span>
      </div>
      {activeBubble && (
        <RiskBubbleFloatingPopover bubble={activeBubble.bubble} position={activeBubble.position} />
      )}
      <div className="ppBubbleLegend">
        <span>Est. margin at risk</span>
        <div><i className="ppBubbleSize ppBubbleSize-large" />{formatCompactMoney(maxImpact)}</div>
        <div><i className="ppBubbleSize ppBubbleSize-medium" />{formatCompactMoney(maxImpact * 0.5)}</div>
        <div><i className="ppBubbleSize ppBubbleSize-small" />{formatCompactMoney(maxImpact * 0.2)}</div>
      </div>
    </div>
  );
}

function getRiskBubblePlotPosition(bubble, yAxisMax, xAxis = { min: 0, max: 100 }) {
  const riskScore = Number.isFinite(Number(bubble.riskScore)) ? Number(bubble.riskScore) : Number(bubble.x || 0);
  const impact = Number(bubble.impact || 0);
  return {
    x: getRiskBubbleXPosition(riskScore, xAxis),
    y: yAxisMax > 0 ? clampNumber((impact / yAxisMax) * 100, 3, 97) : 3,
  };
}

function getRiskBubbleXAxis(bubbles = []) {
  const scores = bubbles
    .map((bubble) => Number.isFinite(Number(bubble.riskScore)) ? Number(bubble.riskScore) : Number(bubble.x || 0))
    .filter((score) => Number.isFinite(score));
  const lowestScore = scores.length ? Math.min(...scores) : 0;
  const min = scores.length ? clampNumber(Math.floor((lowestScore - 10) / 10) * 10, 0, 90) : 0;
  return {
    min,
    max: 100,
    ticks: getRiskBubbleXTicks(min),
  };
}

function getRiskBubbleXTicks(min) {
  if (min <= 0) return [0, 25, 50, 75, 100];
  const step = min >= 40 ? 10 : 20;
  const ticks = [min];
  let next = Math.ceil((min + step) / step) * step;
  while (next < 100) {
    ticks.push(next);
    next += step;
  }
  ticks.push(100);
  return [...new Set(ticks)];
}

function getRiskBubbleXPosition(value, xAxis) {
  const min = Number(xAxis?.min || 0);
  const max = Number(xAxis?.max || 100);
  const range = Math.max(max - min, 1);
  return clampNumber(((Number(value || 0) - min) / range) * 100, 0, 100);
}

function getRiskBubbleYAxisTicks(maxValue) {
  const axisMax = getRiskBubbleAxisMax(maxValue);
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = axisMax * ratio;
    return {
      value,
      position: ratio * 100,
      label: formatCompactMoney(value),
    };
  });
}

function getRiskBubbleAxisMax(value) {
  const rawValue = Number(value || 0);
  if (!rawValue || rawValue <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(rawValue));
  const normalized = rawValue / magnitude;
  const niceStep = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  return niceStep * magnitude;
}

function RiskBubbleFloatingPopover({ bubble, position }) {
  const placement = position?.placement || "above";
  return (
    <div
      className={`ppRiskBubbleFloatingPopover ppRiskBubbleFloatingPopover-${placement}`}
      role="tooltip"
      style={{
        left: `${position?.left || 0}px`,
        top: `${position?.top || 0}px`,
      }}
    >
      <strong>{bubble.label}</strong>
      <span><b>{bubble.riskLabel || "Risk"}</b> risk score: {bubble.riskScore}/100</span>
      <span><b>Margin impact:</b> {formatMoney(bubble.impact || 0)}</span>
      <span><b>Main issue:</b> {bubble.issueLabel || "Product quality"}</span>
      <span><b>Signals:</b> {formatInteger(bubble.signalCount || 0)} stored signals</span>
      <span><b>Rates:</b> {formatPercent(bubble.returnRate || 0)} returns / {formatPercent(bubble.refundRate || 0)} refunds</span>
      <em>{bubble.analysisLabel || "Stored product analysis"}. Click to open product details.</em>
    </div>
  );
}

function getRiskBubblePopoverPosition(element) {
  const rect = element.getBoundingClientRect();
  const popoverWidth = 292;
  const viewportWidth = typeof window === "undefined" ? popoverWidth + 32 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
  const left = clampNumber(rect.left + rect.width / 2, popoverWidth / 2 + 12, viewportWidth - popoverWidth / 2 - 12);
  const hasRoomAbove = rect.top > 170;
  const top = hasRoomAbove
    ? clampNumber(rect.top - 14, 12, viewportHeight - 12)
    : clampNumber(rect.bottom + 14, 12, viewportHeight - 12);

  return {
    left,
    top,
    placement: hasRoomAbove ? "above" : "below",
  };
}

function AnalyticsImpactMetric({ metric }) {
  return (
    <article className="ppBusinessImpactMetric">
      <DashboardIcon type={metric.icon} tone={metric.tone} size="small" />
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <small>{metric.detail}</small>
      </div>
    </article>
  );
}

function BusinessImpactInfoModal({ businessImpact, windowLabel, onClose }) {
  const metrics = businessImpact?.metrics || [];
  const revenueMetric = metrics.find((metric) => String(metric.label || "").toLowerCase().includes("revenue"));
  const marginMetric = metrics.find((metric) => String(metric.label || "").toLowerCase().includes("margin"));
  const returnsMetric = metrics.find((metric) => String(metric.label || "").toLowerCase().includes("returns"));
  const actionsMetric = metrics.find((metric) => String(metric.label || "").toLowerCase().includes("actions"));

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppBusinessImpactModal" role="dialog" aria-modal="true" aria-labelledby="business-impact-title">
        <div className="ppBusinessImpactModalHero">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type="cash-dollar" size="small"></s-icon>
          </span>
          <div>
            <span>{windowLabel}</span>
            <h2 id="business-impact-title">How ProductPulse estimates business impact</h2>
            <p>
              This projection turns stored product risk signals into a practical next-90-day exposure view. It is designed for prioritization, not accounting.
            </p>
          </div>
        </div>

        <div className="ppImpactFlow">
          <div>
            <s-icon type="target" size="small"></s-icon>
            <strong>Signals</strong>
            <span>QuickScan and full diagnostics collect returns, refunds, reviews, content issues and recent trend pressure.</span>
          </div>
          <div>
            <s-icon type="chart-line" size="small"></s-icon>
            <strong>Projection</strong>
            <span>Known refund value, return rate, revenue at risk and review drag are normalized to the active scan window.</span>
          </div>
          <div>
            <s-icon type="wand" size="small"></s-icon>
            <strong>Action value</strong>
            <span>Recommended actions show where the product team can reduce preventable returns or buyer confusion.</span>
          </div>
        </div>

        <div className="ppImpactExplainGrid">
          <ImpactExplainCard metric={revenueMetric} label="Revenue at risk" detail="Refund value plus projected revenue pressure from products with stored risk signals." />
          <ImpactExplainCard metric={marginMetric} label="Margin at risk" detail="Estimated margin exposure using the app's current margin assumption for prioritized products." />
          <ImpactExplainCard metric={returnsMetric} label="Potential returns" detail="A lightweight forecast based on observed return units in each product's available Shopify order window." />
          <ImpactExplainCard metric={actionsMetric} label="Recommended actions" detail="Open and applied actions indicate how much of the detected risk has an available workflow." />
        </div>

        <div className="ppImpactFormula">
          <span>Working model</span>
          <p>
            ProductPulse combines <strong>refund value</strong>, <strong>projected return exposure</strong>, <strong>review conversion drag</strong> and <strong>margin at risk</strong>. More full diagnostics improve confidence because they add customer language, product-content analysis and recommendation quality.
          </p>
        </div>

        <div className="ppAnalysisConfirmFooter">
          <button className="ppPrimaryButton" type="button" onClick={onClose}>
            <s-icon type="check" size="small"></s-icon>
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

function ImpactExplainCard({ metric, label, detail }) {
  return (
    <article>
      <DashboardIcon type={metric?.icon || "info"} tone={metric?.tone || "blue"} size="small" />
      <div>
        <span>{metric?.label || label}</span>
        <strong>{metric?.value || "0"}</strong>
        <p>{metric?.detail || detail}</p>
      </div>
    </article>
  );
}

function getAnalyticsLinePoints(values = []) {
  const cleanValues = (Array.isArray(values) && values.length ? values : [0, 0, 0, 0, 0, 0, 0])
    .map((value) => Math.max(0, Number(value || 0)));
  const max = Math.max(...cleanValues, 1);
  const min = Math.min(...cleanValues);
  const range = Math.max(max - min, 1);
  const left = 50;
  const top = 28;
  const width = 570;
  const height = 160;
  return cleanValues.map((value, index) => {
    const x = left + index * (width / Math.max(cleanValues.length - 1, 1));
    const y = top + height - ((value - min) / range) * height;
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(" ");
}

function buildBarAxisLabels(max, money) {
  return Array.from({ length: 5 }, (_, index) => {
    const value = (Number(max || 0) / 4) * index;
    return money ? formatCompactMoney(value) : formatInteger(value);
  });
}

function buildDonutGradient(rows) {
  if (!rows?.length) {
    return "conic-gradient(var(--pp-slate-200) 0 100%)";
  }
  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    const width = Math.max(0, Number(row.percent || 0));
    cursor += width;
    return `${getAnalyticsColorVar(row.color)} ${start}% ${cursor}%`;
  });
  if (cursor < 100) stops.push(`var(--pp-slate-200) ${cursor}% 100%`);
  return `conic-gradient(${stops.join(", ")})`;
}

function getAnalyticsColorVar(color) {
  const colors = {
    red: "var(--pp-risk-red)",
    orange: "var(--pp-warning-amber)",
    yellow: "var(--pp-warning-amber)",
    green: "var(--pp-signal-teal)",
    blue: "var(--pp-pulse-blue)",
    purple: "var(--pp-insight-violet)",
    pink: "var(--pp-risk-red)",
  };
  return colors[color] || colors.blue;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, Number(value || 0)));
}
