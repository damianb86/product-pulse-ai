import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Form, Link, useFetcher, useNavigate, useNavigation, useRevalidator, useSubmit } from "react-router";
import {
  buildConnectViewData,
  chatMeConnectionLinks,
  CSV_REVIEW_IMPORT_DISPLAY_NAME,
  judgeMeConnectionLinks,
  upsertLocalConnectionRecord,
} from "../lib/product-pulse-connect";

const PRODUCT_TABLE_ACTIVE_JOB_REFRESH_MS = 4_000;
const RISK_THRESHOLD_HANDLE_GAP = 5;
const PRODUCT_PULSE_SETTINGS_SAVE_BAR_ID = "product-pulse-settings-save-bar";
const PRODUCT_PULSE_MIN_LOOKBACK_DAYS = 10;
const PRODUCT_PULSE_MAX_LOOKBACK_DAYS = 365;
const DEFAULT_MOMENTUM_INCLUSION_THRESHOLD = 70;
const MOCK_DATASET_STAGE_ACTIONS = [
  {
    stage: "products",
    label: "Create products",
    icon: "product",
    detail: "Creates or reuses the 15 GEN products with variants, SEO, tags and HTML descriptions.",
  },
  {
    stage: "orders",
    label: "Create orders",
    icon: "calendar",
    detail: "Creates or resumes 200 historical orders, skipping existing generated order indexes.",
  },
  {
    stage: "outcomes",
    label: "Returns & refunds",
    icon: "cash-dollar",
    detail: "Creates controlled returns and refunds from generated fulfilled order line items.",
  },
  {
    stage: "reviews",
    label: "CSV reviews",
    icon: "file",
    detail: "Writes the normalized CSV review source linked to the generated products.",
  },
  {
    stage: "manifest",
    label: "Finalize report",
    icon: "file",
    detail: "Saves the scenario manifest with expected findings, actions and phase summaries.",
  },
];

export function DashboardScreen({ data, actionData }) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const [diagnosisConfirmation, setDiagnosisConfirmation] = useState(null);
  const dashboard = data.dashboard || {};
  const startProduct = dashboard.startProduct || null;
  const diagnosisHref = startProduct?.href || "/app/products";
  const dashboardKpis = dashboard.kpis || [];
  const priorityProducts = dashboard.priorityProducts || [];
  const actionQueue = dashboard.actionQueue || { total: 0, rows: [] };
  const topActiveIssues = dashboard.topActiveIssues || [];
  const coverageSummary = dashboard.coverageSummary || {};
  const pendingDashboardDiagnosis = navigation.state === "submitting" && navigation.formData?.get("_action") === "diagnose";
  const startProductDiagnosisRunning = Boolean(startProduct?.diagnosisInProgress || startProduct?.diagnosisJob);
  const dashboardCtaKind = startProduct?.ctaKind || "link";
  const dashboardCtaHref = startProduct?.ctaHref || startProduct?.href || "/app/products";
  const dashboardCtaIcon = startProduct?.ctaIcon || (dashboardCtaKind === "diagnose" ? "wand" : "product");
  const dashboardCtaRequiresDiagnosis = dashboardCtaKind === "diagnose" || dashboardCtaKind === "recheck";

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success") setDiagnosisConfirmation(null);
  }, [actionData]);

  const handleRequestDashboardDiagnosis = () => {
    if (!startProduct || !dashboardCtaRequiresDiagnosis || pendingDashboardDiagnosis || startProductDiagnosisRunning) return;
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
          Current product quality status from product diagnostics, recommended actions and connected evidence.
        </p>

        <div className="ppDashboardKpis" aria-label="Product quality overview">
          {dashboardKpis.map((kpi) => (
            <DashboardKpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>

        <s-section padding="none">
          <div className="ppStartPanel ppNextBestActionPanel">
            <div className="ppStartHeading">
              <DashboardIcon type="wand" tone="purple" size="small" />
              <h2>Next best action</h2>
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
                    <span>{startProduct.eyebrow || "Recommended next step"}</span>
                    <h3>{startProduct.actionTitle || startProduct.title}</h3>
                    <strong className="ppNextBestProductName">{startProduct.title}</strong>
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

              <div className="ppNextBestWhy">
                <h3>Why this matters</h3>
                <div>
                  {(startProduct?.whyMetrics || []).map((metric) => (
                    <span className={`ppNextBestWhyMetric ppNextBestWhyMetric-${metric.tone || "neutral"}`} key={metric.label}>
                      <strong>{metric.value}</strong>
                      <small>{metric.label}</small>
                    </span>
                  ))}
                </div>
                <p>{startProduct?.whySummary || "ProductPulse ranks the next action by product risk, diagnosis confidence, financial exposure and open recommended actions."}</p>
              </div>

              <div className="ppStartActionPanel">
                {startProduct && !startProductDiagnosisRunning && dashboardCtaRequiresDiagnosis ? (
                  <button
                    className="ppPrimaryButton"
                    type="button"
                    disabled={pendingDashboardDiagnosis}
                    onClick={handleRequestDashboardDiagnosis}
                  >
                    <s-icon type="wand" size="small"></s-icon>
                    <span>{pendingDashboardDiagnosis ? "Queueing..." : startProduct.actionLabel || "Run full diagnosis"}</span>
                  </button>
                ) : (
                  <Link className="ppPrimaryButton" to={startProductDiagnosisRunning ? diagnosisHref : dashboardCtaHref}>
                    <s-icon type={startProductDiagnosisRunning ? "product" : dashboardCtaIcon} size="small"></s-icon>
                    <span>{startProductDiagnosisRunning ? "View running product" : startProduct?.actionLabel || "Analyze more products"}</span>
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

        <div className="ppDashboardActionGrid">
          <div className="ppDashboardPriorityStack">
            <s-section padding="none">
              <DashboardPriorityProducts products={priorityProducts} />
            </s-section>

            <s-section padding="none">
              <DashboardTopActiveIssues issues={topActiveIssues} />
            </s-section>
          </div>

          <s-section padding="none">
            <DashboardActionQueue queue={actionQueue} />
          </s-section>
        </div>

        <s-section padding="none">
          <DashboardCoverageSummary summary={coverageSummary} />
        </s-section>
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
  { icon: "shield-check-mark", title: "Cleaner coverage score", detail: "Disabled sources are excluded so inactive imports do not create noisy warnings." },
];

export function ConnectScreen({ data, actionData }) {
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

function isQuickScanCsvReviewSourceAvailable(data = {}) {
  if (data.quickScanCsvReviews) return Boolean(data.quickScanCsvReviews.available);
  const sources = Array.isArray(data.sourceGroups)
    ? data.sourceGroups.flatMap((group) => group.sources || [])
    : [];
  const csvSource = sources.find((source) => source.key === "csvReviews" || source.sourceKey === "csvReviews");
  if (!csvSource) return false;
  return Boolean(csvSource.connected && csvSource.active !== false);
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
  const [addedCandidateProductIds, setAddedCandidateProductIds] = useState(() => new Set());
  const shopifyProductSearchSubmitRef = useRef(shopifyProductSearchFetcher.submit);
  const productTableSearchInputRef = useRef(null);
  const [quickScanConfirmation, setQuickScanConfirmation] = useState(false);
  const [quickScanCsvWarning, setQuickScanCsvWarning] = useState(false);
  const [analysisConfirmation, setAnalysisConfirmation] = useState(null);
  const [watchlistConfirmation, setWatchlistConfirmation] = useState(null);
  const [deleteAnalysisConfirmation, setDeleteAnalysisConfirmation] = useState(null);
  const productTableRows = data.productTable?.rows;
  const candidateTableRows = data.candidateProductTable?.rows;
  const productRows = useMemo(() => productTableRows || [], [productTableRows]);
  const candidateRows = useMemo(() => candidateTableRows || [], [candidateTableRows]);
  const allVisibleRows = useMemo(() => [...productRows, ...candidateRows], [productRows, candidateRows]);
  const productCount = data.productTable?.total ?? productRows.length;
  const candidateCount = data.candidateProductTable?.total ?? candidateRows.length;
  const totalAllProducts = data.productTable?.totalAll ?? productCount;
  const candidateTotalAllProducts = data.candidateProductTable?.totalAll ?? candidateCount;
  const filterOptions = data.productTable?.filterOptions || {};
  const candidateFilters = filters.candidates || {};
  const candidateFilterOptions = data.candidateProductTable?.filterOptions || filterOptions;
  const page = data.productTable?.page || 1;
  const rowsPerPage = data.productTable?.rowsPerPage || Number(filters.rows || 25);
  const totalPages = data.productTable?.totalPages || 1;
  const candidatePage = data.candidateProductTable?.page || 1;
  const candidateRowsPerPage = data.candidateProductTable?.rowsPerPage || Number(candidateFilters.rows || 25);
  const candidateTotalPages = data.candidateProductTable?.totalPages || 1;
  const activeScanJob = data.productTable?.activeScanJob || null;
  const activeDiagnosisJobs = [
    ...(data.productTable?.activeDiagnosisJobs || []),
    ...(data.candidateProductTable?.activeDiagnosisJobs || []),
  ];
  const persistProductJobs = Boolean(data.persistProductJobs);
  const pendingFastScan = navigation.state === "submitting" && navigation.formData?.get("_action") === "fast-product-scan";
  const pendingBulkAnalyze = navigation.state === "submitting" && navigation.formData?.get("_action") === "bulk-diagnose";
  const pendingCandidateAdd = navigation.state === "submitting" && navigation.formData?.get("_action") === "add-shopify-product-candidate";
  const pendingWatchlistAction = navigation.state === "submitting" && ["add-to-watchlist", "add-selected-to-watchlist", "remove-from-watchlist"].includes(String(navigation.formData?.get("_action") || ""));
  const pendingBulkWatchlistAdd = navigation.state === "submitting" && navigation.formData?.get("_action") === "add-selected-to-watchlist";
  const pendingDeleteAnalysis = navigation.state === "submitting" && navigation.formData?.get("_action") === "delete-product-analysis";
  const pendingAnalyzeIds = pendingBulkAnalyze ? Array.from(navigation.formData?.getAll("productId") || []).map(String) : [];
  const fastScanRunning = Boolean(activeScanJob) || pendingFastScan || localFastScan;
  const quickScanCsvAvailable = isQuickScanCsvReviewSourceAvailable(data);
  const sortConfig = localSortConfig || (filters.sort ? { key: filters.sort, direction: filters.direction || "desc" } : null);
  const [localCandidateSortConfig, setLocalCandidateSortConfig] = useState(null);
  const candidateSortConfig = localCandidateSortConfig || (candidateFilters.sort ? { key: candidateFilters.sort, direction: candidateFilters.direction || "desc" } : null);
  const selectedProductRows = useMemo(
    () => allVisibleRows.filter((product) => selectedProducts.has(getProductActionKey(product))),
    [allVisibleRows, selectedProducts],
  );
  const selectedCount = selectedProducts.size;
  const currentSearchQuery = filters.query || "";
  const currentCandidateSearchQuery = candidateFilters.query || "";
  const [candidateSearchOpen, setCandidateSearchOpen] = useState(Boolean(currentCandidateSearchQuery));
  const [candidateSearchValue, setCandidateSearchValue] = useState(currentCandidateSearchQuery);
  const candidateTableSearchInputRef = useRef(null);
  const normalizedShopifyProductSearchQuery = shopifyProductSearchQuery.trim();
  const shopifyProductSearchData = shopifyProductSearchFetcher.data || {};
  const shopifyProductSearchResponseQuery = String(shopifyProductSearchData.query || "");
  const shopifyProductSearchHasQuery = normalizedShopifyProductSearchQuery.length >= 2;
  const shopifyProductSearchHasFreshResponse = shopifyProductSearchHasQuery
    && shopifyProductSearchResponseQuery === normalizedShopifyProductSearchQuery;
  const shopifyProductSearchResults = shopifyProductSearchHasFreshResponse
    ? shopifyProductSearchData.products || []
    : [];
  const shopifyProductSearchPending = shopifyProductSearchHasQuery
    && (shopifyProductSearchFetcher.state !== "idle" || !shopifyProductSearchHasFreshResponse);
  const shopifyProductSearchError = shopifyProductSearchHasFreshResponse && shopifyProductSearchData.status === "validation_error"
    ? shopifyProductSearchData.message
    : "";
  const submitProductFilters = (overrides = {}, table = "main") => {
    const rowCount = table === "candidates" ? candidateRowsPerPage : rowsPerPage;
    submit(buildProductFilterFormData(filters, { rows: String(rowCount), ...overrides }, table), { method: "get", replace: true });
  };

  useEffect(() => {
    const hasProductDiagnosisJobs = activeDiagnosisJobs.length > 0 || allVisibleRows.some((product) => product.diagnosisJob);
    if ((!activeScanJob && !hasProductDiagnosisJobs) || !persistProductJobs) return undefined;
    const interval = window.setInterval(() => revalidator.revalidate(), PRODUCT_TABLE_ACTIVE_JOB_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [activeDiagnosisJobs.length, activeScanJob, persistProductJobs, allVisibleRows, revalidator]);

  useEffect(() => {
    setLocalSortConfig(null);
  }, [filters.sort, filters.direction]);

  useEffect(() => {
    setLocalCandidateSortConfig(null);
  }, [candidateFilters.sort, candidateFilters.direction]);

  useEffect(() => {
    setSearchValue(currentSearchQuery);
    setSearchOpen(Boolean(currentSearchQuery));
  }, [currentSearchQuery]);

  useEffect(() => {
    setCandidateSearchValue(currentCandidateSearchQuery);
    setCandidateSearchOpen(Boolean(currentCandidateSearchQuery));
  }, [currentCandidateSearchQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    productTableSearchInputRef.current?.focus();
    productTableSearchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (!candidateSearchOpen) return;
    candidateTableSearchInputRef.current?.focus();
    candidateTableSearchInputRef.current?.select();
  }, [candidateSearchOpen]);

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
    filters.collection,
    filters.rows,
    filters.sort,
    filters.direction,
    filters,
    rowsPerPage,
    submit,
  ]);

  useEffect(() => {
    if (candidateSearchValue === currentCandidateSearchQuery) return undefined;
    const timeout = window.setTimeout(() => {
      submit(
        buildProductFilterFormData(filters, { rows: String(candidateRowsPerPage), query: candidateSearchValue, page: "1" }, "candidates"),
        { method: "get", replace: true },
      );
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [
    candidateSearchValue,
    currentCandidateSearchQuery,
    candidateFilters.risk,
    candidateFilters.status,
    candidateFilters.issue,
    candidateFilters.source,
    candidateFilters.vendor,
    candidateFilters.collection,
    candidateFilters.rows,
    candidateFilters.sort,
    candidateFilters.direction,
    filters,
    candidateRowsPerPage,
    submit,
  ]);

  useEffect(() => {
    shopifyProductSearchSubmitRef.current = shopifyProductSearchFetcher.submit;
  }, [shopifyProductSearchFetcher.submit]);

  useEffect(() => {
    if (!shopifyProductSearchOpen) return undefined;
    const query = shopifyProductSearchQuery.trim();
    if (query.length < 2) return undefined;

    const timeout = window.setTimeout(() => {
      const formData = new FormData();
      formData.set("_action", "search-shopify-products");
      formData.set("query", query);
      shopifyProductSearchSubmitRef.current(formData, { method: "post" });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [shopifyProductSearchOpen, shopifyProductSearchQuery]);

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success" && (actionData?.analyzedCount || actionData?.queuedCount)) {
      setSelectedProducts(new Set());
      setAnalysisConfirmation(null);
      setShopifyProductSearchOpen(false);
    }
    if (actionData?.status === "success" && actionData?.action?.id === "add-shopify-product-candidate" && actionData.action.productGid) {
      setAddedCandidateProductIds((current) => {
        const next = new Set(current);
        next.add(actionData.action.productGid);
        return next;
      });
    }
    if (["add-watched-product", "add-watched-products", "remove-watched-product"].includes(String(actionData?.action?.id || ""))) {
      setWatchlistConfirmation(null);
      setOpenActionProduct(null);
    }
    if (actionData?.status === "success" && actionData?.action?.id === "delete-product-analysis") {
      setDeleteAnalysisConfirmation(null);
      setOpenActionProduct(null);
      const deletedKey = String(actionData.action.productGid || actionData.action.handle || "");
      if (deletedKey) {
        setSelectedProducts((current) => {
          const next = new Set(current);
          next.delete(deletedKey);
          return next;
        });
      }
    }
    if (actionData?.status === "success" && actionData?.action?.id === "add-watched-products") {
      setSelectedProducts(new Set());
    }
  }, [actionData]);

  const handleLocalFastScan = () => {
    setLocalFastScan(true);
    window.setTimeout(() => setLocalFastScan(false), 15_000);
  };

  const handleStartFastScan = () => {
    if (fastScanRunning) return;
    if (!quickScanCsvAvailable) {
      setQuickScanCsvWarning(true);
      return;
    }
    setQuickScanConfirmation(true);
  };

  const handleContinueQuickScanWithoutCsv = () => {
    setQuickScanCsvWarning(false);
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

  const handleSort = (key, table = "main") => {
    const currentSortConfig = table === "candidates" ? candidateSortConfig : sortConfig;
    const nextDirection = currentSortConfig?.key === key && currentSortConfig.direction === "desc" ? "asc" : "desc";
    if (table === "candidates") {
      setLocalCandidateSortConfig({ key, direction: nextDirection });
    } else {
      setLocalSortConfig({ key, direction: nextDirection });
    }
    submitProductFilters({ sort: key, direction: nextDirection, page: "1" }, table);
  };

  const handleFilterChange = (event, table = "main") => {
    const target = event.target;
    if (!target?.name) return;
    submitProductFilters({ [target.name]: target.value, page: "1" }, table);
  };

  const getRowsSelectionState = (rows) => {
    const keys = rows.map(getProductActionKey);
    return {
      keys,
      selectedCount: rows.filter((product) => selectedProducts.has(getProductActionKey(product))).length,
      allSelected: keys.length > 0 && keys.every((key) => selectedProducts.has(key)),
      hasSelection: keys.some((key) => selectedProducts.has(key)),
    };
  };

  const handleToggleRows = (rows) => {
    const selectionState = getRowsSelectionState(rows);
    setSelectedProducts((current) => {
      const next = new Set(current);
      if (selectionState.allSelected) {
        selectionState.keys.forEach((key) => next.delete(key));
      } else {
        selectionState.keys.forEach((key) => next.add(key));
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
    setAnalysisConfirmation({
      mode: "bulk",
      title: "Confirm selected product analysis",
      products: selectedIds,
      productTitles: selectedProductRows.map((product) => product.title),
      count: selectedIds.length,
      credits: selectedIds.length,
    });
  };

  const handleAddSelectedToWatchlist = () => {
    if (!selectedCount || pendingBulkWatchlistAdd) return;
    const products = selectedProductRows
      .filter((product) => product.productGid)
      .map((product) => ({
        productGid: product.productGid,
        title: product.title,
        handle: product.handle,
        sku: product.sku,
        imageUrl: product.imageUrl,
        imageAlt: product.imageAlt || product.title,
      }));
    if (!products.length) return;

    const formData = new FormData();
    formData.set("_action", "add-selected-to-watchlist");
    formData.set("products", JSON.stringify(products));
    submit(formData, { method: "post" });
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

  const handleRequestWatchlistToggle = (product) => {
    if (!product?.productGid || pendingWatchlistAction) return;
    setOpenActionProduct(null);
    setWatchlistConfirmation({
      mode: product.isWatched ? "remove" : "add",
      product,
    });
  };

  const handleRequestDeleteAnalysis = (product) => {
    if (!product) return;
    setOpenActionProduct(null);
    setDeleteAnalysisConfirmation({ product });
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

  const handleAddShopifyProductCandidate = (product) => {
    if (pendingCandidateAdd || !product?.id) return;
    setAddedCandidateProductIds((current) => {
      const next = new Set(current);
      next.add(product.id);
      return next;
    });
    const formData = new FormData();
    formData.set("_action", "add-shopify-product-candidate");
    formData.set("productId", product.id);
    submit(formData, { method: "post" });
  };

  const handleConfirmAnalysis = () => {
    if (!analysisConfirmation?.products?.length || pendingBulkAnalyze) return;
    const formData = new FormData();
    formData.set("_action", "bulk-diagnose");
    analysisConfirmation.products.forEach((productId) => formData.append("productId", productId));
    submit(formData, { method: "post" });
  };

  const renderProductFilters = ({ table = "main", tableFilters = {}, tableFilterOptions = {}, includeActions = false }) => (
    <s-section padding="none">
      <div className={`ppProductsToolbar ${table === "candidates" ? "ppProductsCandidatesToolbar" : ""}`.trim()}>
        <div className="ppProductsFilters" aria-label={table === "candidates" ? "Candidate filters" : "Product filters"}>
          <div className="ppProductsFilterPills">
            <ProductFilterPillGroup
              name="risk"
              label="Risk"
              value={tableFilters.risk || "all"}
              options={tableFilterOptions.risks}
              onChange={(value) => submitProductFilters({ risk: value, page: "1" }, table)}
            />
            <ProductFilterPillGroup
              name="status"
              label="Status"
              value={tableFilters.status || "all"}
              options={tableFilterOptions.statuses}
              onChange={(value) => submitProductFilters({ status: value, page: "1" }, table)}
            />
          </div>
          <div className="ppProductsSelectFilters" onChange={(event) => handleFilterChange(event, table)}>
            <ProductFilterSelect name="issue" label="Issue type" value={tableFilters.issue || "all"} options={tableFilterOptions.issues} />
            <ProductFilterSelect name="source" label="Source" value={tableFilters.source || "all"} options={tableFilterOptions.sources} />
            <ProductFilterSearchInput name="vendor" label="Vendor" value={tableFilters.vendor || ""} options={tableFilterOptions.vendors} scope={table} />
            <ProductFilterSearchInput name="collection" label="Collection" value={tableFilters.collection || ""} options={tableFilterOptions.collections} scope={table} />
          </div>
        </div>
        {includeActions && (
          <div className="ppProductsSecondaryActions">
            <button className="ppPrimaryButton" type="button" disabled={selectedCount === 0 || pendingBulkAnalyze} onClick={handleAnalyzeSelected}>
              <s-icon type="wand" size="small"></s-icon>
              {pendingBulkAnalyze ? "Analyzing..." : `Analyze selected (${selectedCount})`}
            </button>
            {selectedCount > 0 && (
              <button className="ppSecondaryActionButton ppProductsWatchlistBulkButton" type="button" disabled={pendingBulkWatchlistAdd} onClick={handleAddSelectedToWatchlist}>
                <s-icon type="binoculars" size="small"></s-icon>
                {pendingBulkWatchlistAdd ? "Adding..." : "Add to Watchlist"}
              </button>
            )}
            <Link className="ppSecondaryActionButton" to="/app/products">
              <s-icon type="x" size="small"></s-icon>
              Clear filters
            </Link>
          </div>
        )}
      </div>
    </s-section>
  );

  const renderProductTable = ({
    table = "main",
    title,
    description,
    rows,
    count,
    totalAll,
    currentPage,
    pageSize,
    pages,
    tableSortConfig,
    searchState,
    emptyTitle,
    emptyDescription,
    tableTestId,
    showFindProduct = false,
  }) => {
    const selectionState = getRowsSelectionState(rows);
    const productLabel = table === "candidates" ? "candidates" : "products";

    return (
      <s-section className={`ppProductsTableSection ${table === "candidates" ? "ppProductsCandidatesSection" : ""}`.trim()} padding="none">
        <div className="ppProductsTableHeading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="ppProductsTableStatus">
          {selectionState.selectedCount > 0 && rows.length > 0 && (
            <div className="ppSelectionPill">
              <span>{selectionState.selectedCount}</span>
              selected
              <button type="button" aria-label={`Clear selected ${productLabel}`} onClick={() => setSelectedProducts(new Set())}>
                <s-icon type="x" size="small"></s-icon>
              </button>
            </div>
          )}
          <span>
            {rows.length > 0
              ? `${rows.length} of ${count} ${productLabel}${totalAll !== count ? ` (${totalAll} stored)` : ""}`
              : table === "candidates" ? "No candidates in this view" : "No full diagnostics in this view"}
          </span>
          <div className="ppProductsTableTools">
            {showFindProduct && (
              <button
                className="ppTableFindProductButton"
                type="button"
                onClick={() => setShopifyProductSearchOpen(true)}
              >
                <span className="ppShopifyTinyIcon" aria-hidden="true">S</span>
                Find Shopify product
              </button>
            )}
            {!searchState.open && (
              <button
                className="ppTableSearchButton"
                type="button"
                aria-label={`Search ${productLabel}`}
                aria-expanded={searchState.open}
                onClick={() => searchState.setOpen(true)}
              >
                <s-icon type="search" size="small"></s-icon>
              </button>
            )}
            {searchState.open && (
              <div className="ppTableSearchControl">
                <s-icon type="search" size="small"></s-icon>
                <input
                  ref={searchState.inputRef}
                  aria-label={`Search ${productLabel}`}
                  value={searchState.value}
                  onChange={(event) => searchState.setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") searchState.setOpen(false);
                  }}
                  placeholder={`Search ${productLabel}`}
                  type="search"
                />
                <button type="button" aria-label={`Close ${productLabel} search`} onClick={() => searchState.setOpen(false)}>
                  <s-icon type="x" size="small"></s-icon>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="ppProductsTableWrap">
          <table className="ppProductsTable" data-testid={tableTestId}>
            <thead>
              <tr>
                <th aria-label={`Select ${productLabel}`}>
                  <input
                    type="checkbox"
                    checked={selectionState.allSelected}
                    aria-checked={selectionState.hasSelection && !selectionState.allSelected ? "mixed" : selectionState.allSelected}
                    aria-label={`Select all visible ${productLabel}`}
                    onChange={() => handleToggleRows(rows)}
                  />
                </th>
                <th>Product</th>
                <th>
                  <SortableHeader
                    active={tableSortConfig?.key === "riskScore"}
                    direction={tableSortConfig?.direction}
                    label="Product risk"
                    onSort={() => handleSort("riskScore", table)}
                  />
                </th>
                <th>Trend</th>
                <th>Momentum</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Main suspected issue</th>
                <th>Sources</th>
                <th>
                  <SortableHeader
                    active={tableSortConfig?.key === "lastAnalysis"}
                    direction={tableSortConfig?.direction}
                    label="Last analysis"
                    onSort={() => handleSort("lastAnalysis", table)}
                  />
                </th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="ppProductsEmptyRow">
                  <td colSpan="11">
                    <div className="ppProductsEmptyState">
                      <DashboardIcon type="search" tone="blue" />
                      <div>
                        <h2>{emptyTitle}</h2>
                        <p>{emptyDescription}</p>
                      </div>
                      <FastScanButton
                        pending={fastScanRunning}
                        onStart={handleStartFastScan}
                      />
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((product) => {
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
                    <td><ProductRiskTrendCell product={product} /></td>
                    <td><ProductMomentumCell product={product} onWatchlistToggle={handleRequestWatchlistToggle} /></td>
                    <td><s-badge tone={product.statusTone}>{product.status}</s-badge></td>
                    <td>
                      <ProductSignalCell product={product} />
                    </td>
                    <td>{product.issue}</td>
                    <td><ProductSourceIconGroup sources={product.sources} overflow={product.sourceOverflow} /></td>
                    <td>{product.lastAnalysis}</td>
                    <td>
                      <div className="ppTableAction">
                        <button
                          className="ppAnalyzeLinkButton ppAnalyzeLinkButton-primary ppAnalyzeIconOnly"
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
                          onWatchlistToggle={handleRequestWatchlistToggle}
                          onDeleteAnalysis={handleRequestDeleteAnalysis}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="ppProductsPagination">
            <label className="ppRowsSelect">
              Rows per page
              <select value={pageSize} onChange={(event) => submitProductFilters({ rows: event.target.value, page: "1" }, table)}>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </label>
            <div className="ppPageControls" aria-label={`${title} pagination`}>
              {currentPage > 1 ? (
                <Link to={buildProductFilterHref(filters, { rows: pageSize, page: currentPage - 1 }, table)} aria-label="Previous page">
                  <s-icon type="chevron-left" size="small"></s-icon>
                </Link>
              ) : (
                <button type="button" aria-label="Previous page" disabled>
                  <s-icon type="chevron-left" size="small"></s-icon>
                </button>
              )}
              {getVisiblePages(currentPage, pages).map((pageNumber) => (
                <Link
                  className={pageNumber === currentPage ? "isActive" : ""}
                  to={buildProductFilterHref(filters, { rows: pageSize, page: pageNumber }, table)}
                  key={pageNumber}
                >
                  {pageNumber}
                </Link>
              ))}
              {currentPage < pages ? (
                <Link to={buildProductFilterHref(filters, { rows: pageSize, page: currentPage + 1 }, table)} aria-label="Next page">
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
    );
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
              <FastScanButton
                pending={fastScanRunning}
                onStart={handleStartFastScan}
              />
            </div>
          </div>
          <ActionBanner actionData={actionData} />

          {renderProductFilters({
            table: "main",
            tableFilters: filters,
            tableFilterOptions: filterOptions,
            includeActions: true,
          })}

          {renderProductTable({
            table: "main",
            title: "Full diagnostics",
            description: "Products with completed or running deep AI diagnosis.",
            rows: productRows,
            count: productCount,
            totalAll: totalAllProducts,
            currentPage: page,
            pageSize: rowsPerPage,
            pages: totalPages,
            tableSortConfig: sortConfig,
            tableTestId: "products-table",
            showFindProduct: true,
            searchState: {
              open: searchOpen,
              value: searchValue,
              inputRef: productTableSearchInputRef,
              setOpen: setSearchOpen,
              setValue: setSearchValue,
            },
            emptyTitle: "No full diagnostics yet",
            emptyDescription: "Run product diagnosis from Candidates or find a Shopify product to start a deep analysis.",
          })}

          <div className="ppProductsCandidateDivider">
            <span>Candidate products</span>
            <p>QuickScan-only products worth reviewing before spending a deep-diagnosis run.</p>
          </div>

          {renderProductFilters({
            table: "candidates",
            tableFilters: candidateFilters,
            tableFilterOptions: candidateFilterOptions,
          })}

          {renderProductTable({
            table: "candidates",
            title: "Candidates",
            description: "Products captured by QuickScan or added manually, without a completed deep diagnosis yet.",
            rows: candidateRows,
            count: candidateCount,
            totalAll: candidateTotalAllProducts,
            currentPage: candidatePage,
            pageSize: candidateRowsPerPage,
            pages: candidateTotalPages,
            tableSortConfig: candidateSortConfig,
            tableTestId: "products-candidates-table",
            showFindProduct: true,
            searchState: {
              open: candidateSearchOpen,
              value: candidateSearchValue,
              inputRef: candidateTableSearchInputRef,
              setOpen: setCandidateSearchOpen,
              setValue: setCandidateSearchValue,
            },
            emptyTitle: "No candidates yet",
            emptyDescription: "Run QuickScan or add a Shopify product as a candidate without starting a diagnosis.",
          })}
        </div>
      </ScreenShell>
      {fastScanRunning && (
        <div className="ppProductsScanOverlay" role="status">
          <div>
            <span className="ppScanSpinner" aria-hidden="true" />
            <h2>Fast product scan running</h2>
            <p>
              ProductPulse is checking the catalog for potential quality signals. The backend job will keep running.
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
          onAddCandidate={handleAddShopifyProductCandidate}
          onCancel={() => setShopifyProductSearchOpen(false)}
          onQueryChange={setShopifyProductSearchQuery}
          actionLabel="Run diagnostics"
          addedProductIds={addedCandidateProductIds}
          addedActionLabel="Added to Candidates"
          addedStatusKind="candidate"
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
      {watchlistConfirmation && (
        <WatchlistConfirmModal
          confirmation={watchlistConfirmation}
          pending={pendingWatchlistAction}
          onCancel={() => setWatchlistConfirmation(null)}
        />
      )}
      {deleteAnalysisConfirmation && (
        <DeleteProductAnalysisConfirmModal
          confirmation={deleteAnalysisConfirmation}
          pending={pendingDeleteAnalysis}
          onCancel={() => setDeleteAnalysisConfirmation(null)}
        />
      )}
      {quickScanConfirmation && (
        <QuickScanConfirmModal
          pending={pendingFastScan}
          onCancel={() => setQuickScanConfirmation(false)}
          onConfirm={handleConfirmFastScan}
        />
      )}
      {quickScanCsvWarning && (
        <QuickScanCsvReviewsModal
          onCancel={() => setQuickScanCsvWarning(false)}
          onContinue={handleContinueQuickScanWithoutCsv}
        />
      )}
    </FullWidthPage>
  );
}

export function WatchlistScreen({ data = {}, actionData }) {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopifyProductSearchFetcher = useFetcher();
  const [shopifyProductSearchOpen, setShopifyProductSearchOpen] = useState(false);
  const [shopifyProductSearchQuery, setShopifyProductSearchQuery] = useState("");
  const shopifyProductSearchSubmitRef = useRef(shopifyProductSearchFetcher.submit);
  const watchlist = data.watchlist || {};
  const rows = useMemo(() => (Array.isArray(watchlist.rows) ? watchlist.rows : []), [watchlist.rows]);
  const activities = Array.isArray(watchlist.activities) ? watchlist.activities : [];
  const trend = watchlist.trend || {};
  const settings = watchlist.settings || {};
  const mock = watchlist.mock || {};
  const maxProducts = Number(watchlist.maxProducts || 5);
  const watchedCount = Number(watchlist.watchedCount ?? rows.length);
  const activeWatchedCount = rows.filter((row) => row.status !== "Paused").length;
  const slotsAvailable = Math.max(0, Number(watchlist.slotsAvailable ?? maxProducts - watchedCount));
  const watchedProductIds = useMemo(() => new Set(rows.map((row) => row.productGid).filter(Boolean)), [rows]);
  const pendingAdd = navigation.state === "submitting" && navigation.formData?.get("_action") === "add-watched-product";
  const normalizedShopifyProductSearchQuery = shopifyProductSearchQuery.trim();
  const shopifyProductSearchData = shopifyProductSearchFetcher.data || {};
  const shopifyProductSearchResponseQuery = String(shopifyProductSearchData.query || "");
  const shopifyProductSearchHasQuery = normalizedShopifyProductSearchQuery.length >= 2;
  const shopifyProductSearchHasFreshResponse = shopifyProductSearchHasQuery
    && shopifyProductSearchResponseQuery === normalizedShopifyProductSearchQuery;
  const shopifyProductSearchResults = shopifyProductSearchHasFreshResponse
    ? shopifyProductSearchData.products || []
    : [];
  const shopifyProductSearchPending = shopifyProductSearchHasQuery
    && (shopifyProductSearchFetcher.state !== "idle" || !shopifyProductSearchHasFreshResponse);
  const shopifyProductSearchError = shopifyProductSearchHasFreshResponse && shopifyProductSearchData.status === "validation_error"
    ? shopifyProductSearchData.message
    : "";
  const atCapacity = watchedCount >= maxProducts;
  const hasActiveWatchlistDiagnosisJobs = rows.some((row) => getProductDiagnosisState(row));

  useEffect(() => {
    shopifyProductSearchSubmitRef.current = shopifyProductSearchFetcher.submit;
  }, [shopifyProductSearchFetcher.submit]);

  useEffect(() => {
    if (!hasActiveWatchlistDiagnosisJobs) return undefined;
    const interval = window.setInterval(() => revalidator.revalidate(), PRODUCT_TABLE_ACTIVE_JOB_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveWatchlistDiagnosisJobs, revalidator]);

  useEffect(() => {
    if (!shopifyProductSearchOpen) return undefined;
    const query = shopifyProductSearchQuery.trim();
    if (query.length < 2) return undefined;

    const timeout = window.setTimeout(() => {
      const formData = new FormData();
      formData.set("_action", "search-shopify-products");
      formData.set("query", query);
      shopifyProductSearchSubmitRef.current(formData, { method: "post" });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [shopifyProductSearchOpen, shopifyProductSearchQuery]);

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success" && actionData?.action?.id === "add-watched-product") {
      setShopifyProductSearchOpen(false);
      setShopifyProductSearchQuery("");
    }
  }, [actionData]);

  const handleAddWatchedProduct = (product) => {
    if (pendingAdd || !product?.id || watchedProductIds.has(product.id)) return;
    const formData = new FormData();
    formData.set("_action", "add-watched-product");
    formData.set("productGid", product.id);
    formData.set("title", product.title || "");
    formData.set("handle", product.handle || "");
    formData.set("sku", product.sku || "");
    formData.set("imageUrl", product.imageUrl || "");
    formData.set("imageAlt", product.imageAlt || product.title || "");
    submit(formData, { method: "post" });
  };

  return (
    <FullWidthPage heading="Watchlist">
      <ScreenShell className="ppDashboard ppWatchlistScreen">
        <div className="ppWatchlistHeader">
          <div>
            <p className="ppDashboardSubtitle">Monitor up to 5 products with automatic rescans and email alerts.</p>
          </div>
          <div className="ppWatchlistHeaderActions">
            <button className="ppPrimaryButton ppWatchlistAddButton" type="button" disabled={atCapacity || pendingAdd} onClick={() => setShopifyProductSearchOpen(true)}>
              <s-icon type="plus" size="small"></s-icon>
              {pendingAdd ? "Adding..." : "Add watched product"}
            </button>
          </div>
        </div>

        <ActionBanner actionData={actionData} />

        <div className="ppWatchlistStats" aria-label="Watchlist overview">
          <WatchlistStatCard icon="binoculars" tone="watch" label="Watched products" value={`${watchedCount} / ${maxProducts}`} detail={`${slotsAvailable} slot${slotsAvailable === 1 ? "" : "s"} available`} />
          <WatchlistStatCard icon="calendar" tone="blue" label="Scan cadence" value={mock.scanCadence || "Every 3 days"} detail={mock.scanCadenceDetail || "Automatic rescans"} />
          <WatchlistStatCard icon="refresh" tone="green" label="Last watch run" value={mock.lastRun || "6h ago"} detail={mock.lastRunDetail || "All active products scanned"} />
          <WatchlistStatCard icon="clock" tone="blue" label="Next watch run" value={mock.nextRun || "In 2d 18h"} detail={mock.nextRunDetail || "May 21, 9:00 AM"} />
          <WatchlistStatCard icon="alert-triangle" tone="orange" label="New issues detected" value={mock.newIssues || "2 this week"} detail={mock.newIssuesDetail || "2 vs last week"} trend="up" />
          <WatchlistStatCard icon="email" tone="green" label="Alert status" value={mock.alertStatus || "Email alerts on"} detail={mock.alertStatusDetail || "2 recipients"} />
        </div>

        <div className="ppWatchlistInfoBanner">
          <s-icon type="info" size="small"></s-icon>
          <span>Automatic rescans run on your selected cadence. We&apos;ll email you when new issues are detected.</span>
          <a href="/app/help">Learn more <s-icon type="external" size="small"></s-icon></a>
        </div>

        <s-section padding="none">
          <div className="ppWatchlistTableWrap">
            <table className="ppWatchlistTable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Latest risk score</th>
                  <th>Latest change / new issue</th>
                  <th>Last issue / last update</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="6">
                      <div className="ppWatchlistEmptyState">
                        <DashboardIcon type="binoculars" tone="watch" />
                        <div>
                          <h2>No watched products yet</h2>
                          <p>Add up to five Shopify products to monitor on the watch cadence.</p>
                        </div>
                        <button className="ppPrimaryButton ppWatchlistAddButton" type="button" disabled={pendingAdd} onClick={() => setShopifyProductSearchOpen(true)}>
                          <s-icon type="plus" size="small"></s-icon>
                          Add watched product
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {rows.map((product) => (
                  <WatchlistProductRow product={product} key={product.productGid || product.id} />
                ))}
              </tbody>
            </table>
            <div className="ppWatchlistTableFooter">
              {rows.length ? `1-${rows.length} of ${rows.length} products` : `0 of ${maxProducts} products`}
            </div>
          </div>
        </s-section>

        <div className="ppWatchlistBottomGrid">
          <WatchlistActivityPanel activities={activities} />
          <WatchlistTrendPanel trend={trend} />
          <WatchlistSettingsPanel settings={settings} watchedCount={watchedCount} activeWatchedCount={activeWatchedCount} actionData={actionData} />
        </div>
      </ScreenShell>

      {shopifyProductSearchOpen && (
        <ShopifyProductSearchModal
          query={shopifyProductSearchQuery}
          results={shopifyProductSearchResults}
          pending={shopifyProductSearchPending}
          error={shopifyProductSearchError}
          onAnalyze={handleAddWatchedProduct}
          onCancel={() => setShopifyProductSearchOpen(false)}
          onQueryChange={setShopifyProductSearchQuery}
          title="Add watched product"
          eyebrow="Watchlist"
          description="Search the live Shopify catalog and add one product to automatic monitoring. You can watch up to five products."
          actionLabel="Add to watchlist"
          actionIcon="plus"
          addedProductIds={watchedProductIds}
          addedActionLabel="Watching"
        />
      )}
    </FullWidthPage>
  );
}

function WatchlistStatCard({ icon, tone, label, value, detail, trend = "" }) {
  return (
    <article className="ppWatchlistStatCard">
      <DashboardIcon type={icon} tone={tone} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small className={trend ? `ppWatchlistStatTrend ppWatchlistStatTrend-${trend}` : ""}>{detail}</small>
      </div>
    </article>
  );
}

function WatchlistProductRow({ product }) {
  const [reportOpen, setReportOpen] = useState(false);
  const latestTone = product.latestChangeTone || "slate";
  const hasScore = Number.isFinite(Number(product.riskScore));
  const paused = product.status === "Paused";
  const latestReport = product.latestChangeReport || null;
  const hasReport = Boolean(latestReport);
  const diagnosisState = getProductDiagnosisState(product);

  return (
    <>
      <tr className={diagnosisState ? "isDiagnosing" : ""}>
        <td>
          <Link className="ppWatchlistProductCell" to={product.href || "/app/products"}>
            <span className="ppWatchlistProductImageWrap">
              <ProductArt
                variant={product.variant || "shirt"}
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
            <span>
              <strong>{product.title}</strong>
              {diagnosisState && <small className="ppWatchlistDiagnosisLabel">{diagnosisState.label}</small>}
              <small>{product.sku ? `SKU: ${product.sku}` : product.handle ? `/${product.handle}` : "Shopify product"}</small>
            </span>
          </Link>
        </td>
        <td>
          <span className={`ppWatchStatus ppWatchStatus-${product.statusTone || "success"}`}>
            <span aria-hidden="true" />
            {product.status || "Watching"}
          </span>
        </td>
        <td>
          <div className="ppWatchRiskCell">
            <span className={`ppWatchRiskDial ppWatchRiskDial-${product.riskTone || "subdued"}`}>{hasScore ? product.riskScore : "-"}</span>
            <strong className={`ppWatchRiskLabel ppWatchRiskLabel-${product.riskTone || "subdued"}`}>{product.riskLabel || "Pending"}</strong>
          </div>
        </td>
        <td>
          <div className="ppWatchIssueCell">
            <span className={`ppWatchIssueDot ppWatchIssueDot-${latestTone}`} aria-hidden="true" />
            <span>
              <strong>{product.latestChange || "Awaiting first scan"}</strong>
              <small>{product.latestChangeDetail || "This product will be checked on the next watch run."}</small>
            </span>
          </div>
        </td>
        <td>
          <div className="ppWatchUpdateCell">
            <strong>{product.lastIssue || "Not scanned yet"}</strong>
            <small>{product.lastIssueDetail || "Waiting for automatic watch cadence"}</small>
          </div>
        </td>
        <td>
          <div className="ppWatchRowActions" aria-label={`Watchlist actions for ${product.title}`}>
            <button
              className="ppWatchActionsButton ppWatchActionsButton-report"
              type="button"
              disabled={!hasReport}
              aria-label={`View latest Watchlist change report for ${product.title}`}
              onClick={() => setReportOpen(true)}
            >
              <s-icon type="chart-line" size="small"></s-icon>
            </button>
            <Link className="ppWatchActionsButton" to={product.href || "/app/products"} aria-label={`View ${product.title}`}>
              <s-icon type="view" size="small"></s-icon>
            </Link>
            <Form method="post">
              <input type="hidden" name="_action" value={paused ? "resume-watched-product" : "pause-watched-product"} />
              <input type="hidden" name="productGid" value={product.productGid || ""} />
              <button className="ppWatchActionsButton" type="submit" aria-label={`${paused ? "Resume" : "Pause"} ${product.title}`}>
                {paused ? (
                  <s-icon type="play" size="small"></s-icon>
                ) : (
                  <span className="ppPauseGlyph" aria-hidden="true"><span /><span /></span>
                )}
              </button>
            </Form>
            <Form method="post">
              <input type="hidden" name="_action" value="remove-watched-product" />
              <input type="hidden" name="productGid" value={product.productGid || ""} />
              <button className="ppWatchActionsButton ppWatchActionsButton-danger" type="submit" aria-label={`Remove ${product.title} from watchlist`}>
                <s-icon type="x" size="small"></s-icon>
              </button>
            </Form>
          </div>
        </td>
      </tr>
      {reportOpen && hasReport ? (
        <WatchChangeReportModal product={product} report={latestReport} onClose={() => setReportOpen(false)} />
      ) : null}
    </>
  );
}

function WatchChangeReportModal({ product, report, onClose }) {
  if (typeof document === "undefined") return null;
  const isBaselineReport = report?.status === "baseline";
  const sections = isBaselineReport ? [] : (Array.isArray(report?.sections) ? report.sections : []);
  const visibleSections = isBaselineReport ? [] : getVisibleWatchReportSections(sections);
  const sourceInsights = isBaselineReport ? [] : (Array.isArray(report?.sourceInsights) ? report.sourceInsights : []);
  const current = report?.current || {};
  const changedCards = isBaselineReport ? [] : getWatchReportChangeCards(report, visibleSections);
  const hasVisibleChanges = changedCards.length > 0 || visibleSections.length > 0 || sourceInsights.length > 0;
  const effectiveStatus = isBaselineReport ? "baseline" : (!hasVisibleChanges ? "unchanged" : report?.status);
  const statusTone = getWatchReportStatusTone(effectiveStatus);
  const statusLabel = getWatchReportStatusLabel(effectiveStatus);

  return createPortal(
    <div className="ppAnalysisConfirmOverlay ppWatchChangeReportOverlay" role="presentation">
      <section className="ppWatchChangeReportModal" role="dialog" aria-modal="true" aria-labelledby="watch-change-report-title">
        <header className="ppWatchChangeReportHeader">
          <DashboardIcon type={effectiveStatus === "unchanged" ? "check" : "chart-line"} tone="blue" />
          <div>
            <span className="ppWatchChangeReportEyebrow">Watchlist change report</span>
            <h2 id="watch-change-report-title">{product.title}</h2>
            <p>{report?.narrative || report?.summary || "Latest Watchlist comparison for this product."}</p>
          </div>
          <strong className={`ppWatchChangeReportHeaderStatus ppWatchChangeReportHeaderStatus-${statusTone}`}>
            <span aria-hidden="true" />
            {statusLabel}
          </strong>
          <button className="ppModalCloseButton" type="button" aria-label="Close Watchlist change report" onClick={onClose}>
            <s-icon type="x" size="small"></s-icon>
          </button>
        </header>

        <div className="ppWatchChangeReportBody">
          <div className="ppWatchChangeReportMeta">
            <div>
              <DashboardIcon type="calendar" tone="blue" size="small" />
              <span>Previous run</span>
              <strong>{formatWatchReportTimestamp(report?.previousRunAt) || "No previous run"}</strong>
            </div>
            <div>
              <DashboardIcon type="clock" tone="blue" size="small" />
              <span>Current run</span>
              <strong>{formatWatchReportTimestamp(report?.currentRunAt || report?.createdAt)}</strong>
            </div>
            <div>
              <DashboardIcon type="file" tone="blue" size="small" />
              <span>Changed fields</span>
              <strong>{Number(report?.changeCount || 0)}</strong>
            </div>
            <div>
              <DashboardIcon type={effectiveStatus === "unchanged" ? "check" : "alert-circle"} tone={statusTone} size="small" />
              <span>Scan status</span>
              <strong className={`ppWatchChangeReportStatus ppWatchChangeReportStatus-${statusTone}`}>{statusLabel}</strong>
            </div>
          </div>

          {isBaselineReport ? (
            <section className="ppWatchBaselinePanel" aria-label="No previous Watchlist data">
              <DashboardIcon type="calendar" tone="blue" />
              <div>
                <h3>No previous Watchlist data</h3>
                <p>
                  This was the first Watchlist run for {product.title}. ProductPulse saved the current diagnosis as the baseline.
                  Future Watchlist runs will compare new reviews, returns, refunds, product risk, momentum and evidence against this point.
                </p>
                <div className="ppWatchBaselinePills">
                  <span>Baseline captured</span>
                  <span>No comparison yet</span>
                  <span>Changes start next run</span>
                </div>
              </div>
            </section>
          ) : changedCards.length ? (
            <section className="ppWatchChangedPanel" aria-label="Watchlist fields that changed">
              <div className="ppWatchChangedPanelTitle">
                <h3>What changed</h3>
                {report?.headline ? <p>{report.headline}</p> : null}
              </div>
              <div className="ppWatchChangedGrid">
                {changedCards.map((change) => {
                  const tone = getWatchChangeCardTone(change);
                  return (
                    <article className={`ppWatchChangedCard ppWatchChangedCard-${tone}`} key={change.sectionId ? `${change.sectionId}-${change.id}` : change.id || change.label}>
                      <DashboardIcon type={getWatchChangeCardIcon(change)} tone={tone} size="small" />
                      <div>
                        <span>{change.label}</span>
                        <strong>
                          <em>{change.from}</em>
                          <s-icon type="arrow-right" size="small"></s-icon>
                          <em>{change.to}</em>
                        </strong>
                        <small>{change.detail}</small>
                      </div>
                      <b className={`ppWatchChangeDelta ppWatchChangeDelta-${getWatchChangeDeltaTone(change)}`}>{change.delta}</b>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : effectiveStatus === "unchanged" ? (
            <section className="ppWatchNoChangesPanel" aria-label="No Watchlist changes detected">
              <DashboardIcon type="check" tone="green" />
              <div>
                <h3>No changes detected</h3>
                <p>No meaningful product risk, evidence, financial exposure or momentum movement was detected since the previous Watchlist run.</p>
              </div>
            </section>
          ) : report?.headline ? (
            <div className={`ppWatchChangeReportHeadline ppWatchChangeReportHeadline-${statusTone}`}>
              <s-icon type="info" size="small"></s-icon>
              <span>{report.headline}</span>
            </div>
          ) : null}

          {sourceInsights.length ? (
            <div className="ppWatchChangeReportInsights">
              {sourceInsights.map((insight) => {
                const quote = getWatchInsightQuote(insight);
                const bullets = getWatchInsightBullets(insight);
                return (
                  <article className={`ppWatchChangeReportInsight ppWatchChangeReportInsight-${insight.tone || "blue"}`} key={insight.id || insight.title}>
                    <div className="ppWatchChangeReportInsightHeader">
                      <DashboardIcon type={getWatchReportInsightIcon(insight.id)} tone={insight.tone || "blue"} size="small" />
                      <div>
                        <h3>{insight.title}</h3>
                        <p>{insight.summary}</p>
                      </div>
                    </div>
                    <div className="ppWatchInsightPills">
                      {getWatchInsightPills(insight).map((pill) => <span key={pill}>{pill}</span>)}
                    </div>
                    {bullets.length ? (
                      <ul>
                        {bullets.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : null}
                    {quote ? <blockquote>{quote}</blockquote> : null}
                  </article>
                );
              })}
            </div>
          ) : null}

          <div className="ppWatchChangeReportSections">
            {visibleSections.map((section) => (
              <article className="ppWatchChangeReportSection" key={section.id || section.title}>
                <div className="ppWatchChangeReportSectionHeader">
                  <DashboardIcon type={getWatchReportSectionIcon(section.id)} tone={section.tone || "blue"} size="small" />
                  <h3>{section.title}</h3>
                </div>
                <div className="ppWatchChangeRows">
                  {(section.changes || []).map((change) => (
                    <div className="ppWatchChangeRow" key={change.id || change.label}>
                      <strong>{change.label}</strong>
                      <span>{change.from} <s-icon type="arrow-right" size="small"></s-icon> {change.to}</span>
                      <em className={`ppWatchChangeDelta ppWatchChangeDelta-${getWatchChangeDeltaTone(change)}`}>{change.delta}</em>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="ppWatchChangeReportSnapshot">
            <DashboardIcon type="shield-check-mark" tone="blue" size="small" />
            <h3>Current product state</h3>
            <div>
              <span className="ppWatchSnapshotRisk"><b>Risk:</b> {current.riskLabel || "Pending"} · {current.riskScore ?? "-"}</span>
              <span className="ppWatchSnapshotConfidence"><b>Confidence:</b> {current.confidence ?? "-"}%</span>
              <span><b>Primary issue:</b> {current.primaryIssue || "No primary issue"}</span>
              <span className="ppWatchSnapshotReturn"><b>Return rate:</b> {current.returnRatePercent ?? 0}%</span>
              <span className="ppWatchSnapshotMomentum"><b>Momentum:</b> {current.productMomentumTier || "No momentum"} · {current.productMomentumScore ?? 0} / 100</span>
            </div>
          </div>
        </div>

        <footer className="ppAnalysisConfirmFooter ppWatchChangeReportFooter">
          <Link className="ppSecondaryButton" to={product.href || "/app/products"} onClick={onClose}>
            <s-icon type="external" size="small"></s-icon>
            Open product
          </Link>
          <button className="ppPrimaryButton" type="button" onClick={onClose}>
            Done
            <s-icon type="check" size="small"></s-icon>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function getWatchReportChangeCards(report, sections = []) {
  const explicit = Array.isArray(report?.changes) ? report.changes : [];
  const sectionChanges = sections.flatMap((section) => (
    Array.isArray(section?.changes)
      ? section.changes.map((change) => ({ ...change, sectionId: section.id, sectionTitle: section.title }))
      : []
  ));
  return (explicit.length ? explicit : sectionChanges).filter(isMeaningfulWatchReportChange).slice(0, 4);
}

function getVisibleWatchReportSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((section) => ({
      ...section,
      changes: (Array.isArray(section?.changes) ? section.changes : []).filter(isMeaningfulWatchReportChange),
    }))
    .filter((section) => section.changes.length);
}

function isMeaningfulWatchReportChange(change = {}) {
  if (!change || typeof change !== "object") return false;
  const id = String(change.id || "").toLowerCase();
  if (id === "no-meaningful-change") return false;
  const delta = String(change.delta || "").trim().toLowerCase();
  if (["", "stable", "no change", "unchanged", "0", "+0", "$0", "+$0", "0%", "+0%"].includes(delta)) return false;
  const from = normalizeWatchComparableValue(change.from);
  const to = normalizeWatchComparableValue(change.to);
  if (from && to && from === to) return false;
  return true;
}

function normalizeWatchComparableValue(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getWatchReportStatusTone(status) {
  if (status === "unchanged") return "green";
  if (status === "baseline") return "blue";
  return "orange";
}

function getWatchReportStatusLabel(status) {
  if (status === "unchanged") return "No changes";
  if (status === "baseline") return "Baseline";
  return "Changes detected";
}

function getWatchReportSectionIcon(sectionId) {
  if (sectionId === "risk") return "target";
  if (sectionId === "evidence") return "view";
  if (sectionId === "impact") return "cash-dollar";
  if (sectionId === "momentum") return "chart-line";
  return "info";
}

function getWatchReportInsightIcon(insightId) {
  if (insightId === "return-evidence") return "return";
  if (insightId === "review-evidence") return "star";
  if (insightId === "refund-evidence") return "cash-dollar";
  if (insightId === "product-content") return "product";
  return "info";
}

function getWatchChangeCardIcon(change = {}) {
  const id = String(change.id || change.label || "").toLowerCase();
  if (id.includes("review")) return "star";
  if (id.includes("return")) return "return";
  if (id.includes("refund") || id.includes("revenue") || id.includes("margin") || id.includes("impact")) return "cash-dollar";
  if (id.includes("signal") || id.includes("evidence")) return "chart-line";
  if (id.includes("momentum")) return "chart-line";
  if (id.includes("confidence")) return "shield-check-mark";
  return "target";
}

function getWatchChangeCardTone(change = {}) {
  const id = String(change.id || change.label || "").toLowerCase();
  if (id.includes("negative") || id.includes("risk") || id.includes("return-rate")) return "red";
  if (id.includes("return")) return "orange";
  if (id.includes("refund") || id.includes("revenue") || id.includes("margin") || id.includes("impact")) return "purple";
  if (id.includes("signal") || id.includes("evidence")) return "green";
  if (id.includes("momentum")) return "green";
  return "blue";
}

function getWatchInsightPills(insight = {}) {
  const pills = [insight.metric].filter(Boolean);
  const bullets = Array.isArray(insight.bullets) ? insight.bullets : [];
  bullets.slice(0, 2).forEach((bullet) => {
    const text = String(bullet || "").split(":")[0].replace(/\.$/, "").trim();
    if (text) pills.push(text);
  });
  return Array.from(new Set(pills)).slice(0, 3);
}

function getWatchInsightQuote(insight = {}) {
  const bullets = Array.isArray(insight.bullets) ? insight.bullets : [];
  const quoteBullet = bullets.find((bullet) => /representative/i.test(String(bullet || "")));
  if (!quoteBullet) return "";
  return String(quoteBullet).replace(/^Representative [^:]+:\s*/i, "").trim();
}

function getWatchInsightBullets(insight = {}) {
  const bullets = Array.isArray(insight.bullets) ? insight.bullets : [];
  return bullets
    .filter((bullet) => !/representative/i.test(String(bullet || "")))
    .slice(0, 4);
}

function getWatchChangeDirectionTone(direction) {
  if (direction === "up") return "up";
  if (direction === "down") return "down";
  return "neutral";
}

function getWatchChangeDeltaTone(change = {}) {
  const direction = getWatchChangeDirectionTone(change.direction);
  if (direction === "neutral") return "neutral";
  const id = String(change.id || change.label || "").toLowerCase();
  const increaseIsNegative = (
    id.includes("risk")
    || id.includes("negative")
    || id.includes("return-rate")
    || id.includes("refund")
    || id.includes("revenue")
    || id.includes("margin")
    || id.includes("impact")
  );
  if (increaseIsNegative) {
    return direction === "up" ? "bad" : "good";
  }
  return direction === "up" ? "good" : "bad";
}

function formatWatchReportTimestamp(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function WatchlistActivityPanel({ activities = [], showAllLink = true }) {
  return (
    <section className="ppWatchlistPanel">
      <div className="ppWatchlistPanelHeader">
        <h2>Recent watch activity</h2>
        {showAllLink ? <Link to="/app/watchlist/activity" reloadDocument>View all</Link> : null}
      </div>
      <div className="ppWatchActivityList">
        {activities.length === 0 && (
          <div className="ppWatchPanelEmpty">
            <DashboardIcon type="refresh" tone="blue" size="small" />
            <span>Watch activity will appear when products are added, paused, removed or scanned.</span>
          </div>
        )}
        {activities.map((activity) => (
          <article key={activity.id || `${activity.title}-${activity.detail}-${activity.time}`}>
            <DashboardIcon type={activity.icon} tone={activity.tone} size="small" />
            <div>
              <strong>{activity.title}</strong>
              <small>{activity.detail}</small>
            </div>
            <span>{activity.time}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function WatchlistTrendPanel({ trend = {} }) {
  const series = Array.isArray(trend.series) ? trend.series.filter((item) => item.path) : [];
  const hasSeries = series.length > 0;
  const riskScore = Number.isFinite(Number(trend.riskScore)) ? Math.round(Number(trend.riskScore)) : null;

  return (
    <section className="ppWatchlistPanel ppWatchTrendPanel">
      <div className="ppWatchlistPanelHeader">
        <div>
          <h2>Watchlist trend (risk activity)</h2>
          <small>{hasSeries ? "Risk history for all watched products" : "Risk history for watched products"}</small>
        </div>
      </div>
      <div className="ppWatchTrendMetric">
        <strong>{riskScore ?? "-"}</strong>
        <span>{riskScore === null ? "No data" : `Avg ${trend.riskLabel || "risk"}`}</span>
      </div>
      <div className="ppWatchTrendChart" aria-label="Watchlist product risk trend">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {series.map((item) => {
            const linePoints = Array.isArray(item.points) && item.points.length ? item.points : parseSvgPointString(item.path);
            return (
              <path
                key={item.productGid || item.productTitle}
                className="ppWatchTrendLine"
                d={buildSmoothSvgPath(linePoints)}
                stroke={item.color || "#2563EB"}
              />
            );
          })}
        </svg>
      </div>
      <div className="ppWatchTrendLegend" aria-label="Watched product trend legend">
        {hasSeries ? series.map((item) => (
          <Link key={item.productGid || item.productTitle} to={item.href || "/app/products"} title={item.productTitle}>
            <span style={{ backgroundColor: item.color || "#2563EB" }} aria-hidden="true" />
            <strong>{item.productTitle || "Watched product"}</strong>
            <small>{Number.isFinite(Number(item.riskScore)) ? `${item.riskScore} · ${item.riskLabel}` : item.riskLabel || "No data"}</small>
          </Link>
        )) : (
          <span className="ppWatchTrendLegendEmpty">Run diagnostics to start storing score history.</span>
        )}
      </div>
      <div className="ppWatchTrendCallout">
        <span className="ppWatchIssueDot ppWatchIssueDot-orange" aria-hidden="true" />
        <div>
          <strong>{trend.calloutTitle || "No watch trend yet"}</strong>
          <small>{trend.calloutDetail || "Add a watched product and run analyses to build history."}</small>
        </div>
        <s-icon type="chevron-right" size="small"></s-icon>
      </div>
    </section>
  );
}

export function WatchlistActivityScreen({ data = {} }) {
  const watchlist = data.watchlist || {};
  const groups = Array.isArray(watchlist.groupedActivities) ? watchlist.groupedActivities : [];
  const activities = Array.isArray(watchlist.activities) ? watchlist.activities : [];

  return (
    <FullWidthPage heading="Watch activity">
      <ScreenShell className="ppDashboard ppWatchlistScreen ppWatchActivityScreen">
        <div className="ppWatchlistHeader">
          <div>
            <Link className="ppBackLink" to="/app/watchlist"><s-icon type="arrow-left" size="small"></s-icon> Back to Watchlist</Link>
            <p className="ppDashboardSubtitle">Complete activity log for watched products, scan updates and watchlist changes.</p>
          </div>
        </div>
        <div className="ppWatchlistStats" aria-label="Watch activity overview">
          <WatchlistStatCard icon="binoculars" tone="watch" label="Watched products" value={`${watchlist.watchedCount || 0} / ${watchlist.maxProducts || 5}`} detail={`${watchlist.slotsAvailable || 0} slots available`} />
          <WatchlistStatCard icon="refresh" tone="blue" label="Stored events" value={activities.length} detail="Latest watchlist activity" />
          <WatchlistStatCard icon="pause" tone="purple" label="Paused products" value={(watchlist.rows || []).filter((row) => row.status === "Paused").length} detail="Not included in automatic watches" />
          <WatchlistStatCard icon="wand" tone="orange" label="Risk updates" value={activities.filter((activity) => ["watch_scan_completed", "diagnosis_completed"].includes(activity.eventType)).length} detail="Scan or diagnosis events" />
        </div>
        <section className="ppWatchlistPanel ppWatchActivityFullPanel">
          <div className="ppWatchlistPanelHeader">
            <h2>All watch activity</h2>
            <span>{activities.length} event{activities.length === 1 ? "" : "s"}</span>
          </div>
          {groups.length === 0 && (
            <div className="ppWatchPanelEmpty ppWatchPanelEmpty-large">
              <DashboardIcon type="refresh" tone="blue" />
              <span>No watch activity has been recorded yet.</span>
            </div>
          )}
          <div className="ppWatchActivityTimeline">
            {groups.map((group) => (
              <section key={group.day}>
                <h3>{group.day}</h3>
                <div className="ppWatchActivityList ppWatchActivityList-full">
                  {group.items.map((activity) => (
                    <article key={activity.id}>
                      <DashboardIcon type={activity.icon} tone={activity.tone} size="small" />
                      <div>
                        <strong>{activity.title}</strong>
                        <small>{activity.detail || activity.productTitle || "Watchlist activity"}</small>
                      </div>
                      <span>{activity.timestamp}</span>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </ScreenShell>
    </FullWidthPage>
  );
}

function WatchlistSettingsPanel({ settings = {}, watchedCount = 0, activeWatchedCount = watchedCount, actionData }) {
  const navigation = useNavigation();
  const [editing, setEditing] = useState(false);
  const pendingAction = navigation.state === "submitting" ? String(navigation.formData?.get("_action") || "") : "";
  const settingsOptions = settings.options || {};
  const cadenceOptions = settingsOptions.cadence || [
    { value: "1", label: "Every day" },
    { value: "2", label: "Every 2 days" },
    { value: "3", label: "Every 3 days" },
    { value: "7", label: "Weekly" },
    { value: "14", label: "Every 2 weeks" },
  ];
  const triggerRuleOptions = settingsOptions.triggerRules || [
    { value: "new_or_rising_risk", label: "Notify on new issues or rising risk" },
    { value: "new_issue_only", label: "Only new issue detected" },
    { value: "risk_score_increase", label: "Risk score increases" },
    { value: "medium_or_high_risk", label: "Medium or high risk detected" },
    { value: "any_watch_change", label: "Any watched product change" },
  ];
  const summaryOptions = settingsOptions.summaries || [
    { value: "daily_digest_8am", label: "Daily digest at 8:00 AM" },
    { value: "weekly_monday_8am", label: "Weekly summary Monday at 8:00 AM" },
    { value: "immediate_only", label: "Immediate alerts only" },
    { value: "none", label: "No summary email" },
  ];
  const rows = [
    ["clock", "Scan cadence", settings.scanCadenceLabel || "Every 3 days"],
    ["profile", "Alert recipients", `${settings.alertRecipientCount || 0} recipient${Number(settings.alertRecipientCount || 0) === 1 ? "" : "s"}`],
    ["email", "Trigger rule", settings.triggerRuleLabel || "Notify on new issues or rising risk"],
    ["email", "Digest / summary", settings.summaryScheduleLabel || "Daily digest at 8:00 AM"],
  ];

  useEffect(() => {
    if (actionData?.status === "success" && actionData?.action?.id === "update-watch-settings") {
      setEditing(false);
    }
  }, [actionData]);

  return (
    <section className="ppWatchlistPanel ppWatchSettingsPanel">
      <div className="ppWatchlistPanelHeader">
        <h2>Watch settings</h2>
        {!editing ? <button type="button" onClick={() => setEditing(true)}>Edit</button> : null}
      </div>
      {editing ? (
        <Form method="post" className="ppWatchSettingsForm">
          <input type="hidden" name="_action" value="update-watch-settings" />
          <label>
            <span>Scan cadence</span>
            <select name="scanCadenceDays" defaultValue={settings.scanCadenceValue || "3"}>
              {cadenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Alert recipients</span>
            <textarea name="alertRecipients" rows="3" defaultValue={settings.alertRecipientsText || ""} placeholder="ops@store.com, support@store.com" />
            <small>Use commas or one email per line.</small>
          </label>
          <label>
            <span>Trigger rule</span>
            <select name="triggerRule" defaultValue={settings.triggerRule || "new_or_rising_risk"}>
              {triggerRuleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Summary</span>
            <select name="summarySchedule" defaultValue={settings.summarySchedule || "daily_digest_8am"}>
              {summaryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="ppWatchSettingsCheckbox">
            <input type="checkbox" name="alertsEnabled" defaultChecked={settings.alertsEnabled !== false} />
            <span>Email alerts enabled</span>
          </label>
          <div className="ppWatchSettingsFormActions">
            <button className="ppSecondaryButton" type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button className="ppPrimaryButton" type="submit" disabled={pendingAction === "update-watch-settings"}>
              <s-icon type="save" size="small"></s-icon>
              {pendingAction === "update-watch-settings" ? "Saving..." : "Save settings"}
            </button>
          </div>
        </Form>
      ) : (
        <>
          <div className="ppWatchSettingsRows">
            {rows.map(([icon, label, value]) => (
              <div key={label}>
                <s-icon type={icon} size="small"></s-icon>
                <span>{label}</span>
                <strong title={value}>{value}</strong>
              </div>
            ))}
            <div>
              <s-icon type="info" size="small"></s-icon>
              <span>Alerts</span>
              <Form method="post" className="ppWatchInlineForm">
                <input type="hidden" name="_action" value="toggle-watch-alerts" />
                <button
                  className={`ppWatchToggleButton ${settings.alertsEnabled ? "isOn" : "isOff"}`}
                  type="submit"
                  aria-label={settings.alertsEnabled ? "Disable watch alerts" : "Enable watch alerts"}
                  disabled={pendingAction === "toggle-watch-alerts"}
                >
                  <span>{settings.alertsEnabled ? "On" : "Off"}</span>
                  <span className="ppWatchToggle" aria-hidden="true" />
                </button>
              </Form>
            </div>
          </div>
          <div className="ppWatchSettingsActions">
            <Form method="post">
              <input type="hidden" name="_action" value="pause-all-watches" />
              <button className="ppSecondaryButton" type="submit" disabled={!activeWatchedCount || pendingAction === "pause-all-watches"}>
                <span className="ppPauseGlyph ppPauseGlyph-inline" aria-hidden="true"><span /><span /></span>
                {pendingAction === "pause-all-watches" ? "Pausing..." : "Pause all watches"}
              </button>
            </Form>
            <Form method="post">
              <input type="hidden" name="_action" value="run-watch-scan" />
              <button className="ppSecondaryButton ppWatchRunNowButton" type="submit" disabled={!activeWatchedCount || pendingAction === "run-watch-scan"}>
                <span className="ppQuickScanBolt" aria-hidden="true">⚡</span>
                {pendingAction === "run-watch-scan" ? "Queueing..." : "Run scan now"}
              </button>
            </Form>
          </div>
        </>
      )}
    </section>
  );
}

export function SettingsScreen({ data = {}, actionData }) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef(null);
  const settings = actionData?.settings || data.settings || getDefaultProductPulseClientSettings();
  const normalizedSettingsRisk = useMemo(() => normalizeClientRiskThresholds(settings.risk), [settings.risk]);
  const normalizedMomentumThreshold = normalizeClientMomentumThreshold(settings.momentum?.minimumScore);
  const normalizedQueueLimit = normalizeClientQueueLimit(settings.diagnosis?.maxQueuedPerSubmission);
  const normalizedLookbackDays = normalizeClientLookbackDays(settings.analysis?.lookbackDays);
  const mockDataset = actionData?.mockDataset || data.mockDataset || null;
  const [riskThresholds, setRiskThresholds] = useState(normalizedSettingsRisk);
  const [momentumThreshold, setMomentumThreshold] = useState(normalizedMomentumThreshold);
  const [queueLimit, setQueueLimit] = useState(normalizedQueueLimit);
  const [lookbackDays, setLookbackDays] = useState(normalizedLookbackDays);
  const isSaving = navigation.state === "submitting";
  const pendingMockDatasetStage = navigation.state === "submitting"
    && navigation.formData?.get("_action") === "start-shopify-mock-dataset"
    ? String(navigation.formData?.get("stage") || "all")
    : null;
  const isStartingMockDataset = Boolean(pendingMockDatasetStage);
  const settingsDirty = riskThresholds.minimumScore !== normalizedSettingsRisk.minimumScore
    || riskThresholds.mediumThreshold !== normalizedSettingsRisk.mediumThreshold
    || riskThresholds.highThreshold !== normalizedSettingsRisk.highThreshold
    || Number(momentumThreshold) !== Number(normalizedMomentumThreshold)
    || Number(queueLimit) !== Number(normalizedQueueLimit)
    || Number(lookbackDays) !== Number(normalizedLookbackDays);

  useEffect(() => {
    setRiskThresholds(normalizedSettingsRisk);
    setMomentumThreshold(normalizedMomentumThreshold);
    setQueueLimit(normalizedQueueLimit);
    setLookbackDays(normalizedLookbackDays);
  }, [normalizedSettingsRisk, normalizedMomentumThreshold, normalizedQueueLimit, normalizedLookbackDays]);

  useEffect(() => {
    const saveBar = getShopifySaveBarApi();
    if (!saveBar) return undefined;
    const operation = settingsDirty ? saveBar.show : saveBar.hide;
    operation.call(saveBar, PRODUCT_PULSE_SETTINGS_SAVE_BAR_ID)?.catch?.(() => {});
    return undefined;
  }, [settingsDirty]);

  useEffect(() => () => {
    getShopifySaveBarApi()?.hide?.(PRODUCT_PULSE_SETTINGS_SAVE_BAR_ID)?.catch?.(() => {});
  }, []);

  useEffect(() => {
    announceProductPulseJobs(actionData);
  }, [actionData]);

  const handleSaveSettings = () => {
    if (!formRef.current || isSaving) return;
    const formData = new FormData(formRef.current);
    formData.set("_action", "save-settings");
    formData.set("minimumScore", String(riskThresholds.minimumScore));
    formData.set("mediumThreshold", String(riskThresholds.mediumThreshold));
    formData.set("highThreshold", String(riskThresholds.highThreshold));
    formData.set("momentumMinimumScore", String(momentumThreshold));
    formData.set("maxQueuedPerSubmission", String(queueLimit));
    formData.set("analysisLookbackDays", String(lookbackDays));
    submit(formData, { method: "post" });
  };

  const handleDiscardSettings = () => {
    setRiskThresholds(normalizedSettingsRisk);
    setMomentumThreshold(normalizedMomentumThreshold);
    setQueueLimit(normalizedQueueLimit);
    setLookbackDays(normalizedLookbackDays);
    getShopifySaveBarApi()?.hide?.(PRODUCT_PULSE_SETTINGS_SAVE_BAR_ID)?.catch?.(() => {});
  };

  return (
    <FullWidthPage heading="Settings" className="ppSettingsPage">
      <ScreenShell className="ppDashboard ppSettingsScreen">
        <ui-save-bar id={PRODUCT_PULSE_SETTINGS_SAVE_BAR_ID}>
          <button variant="primary" type="button" disabled={isSaving ? true : undefined} onClick={handleSaveSettings}>
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button type="button" disabled={isSaving ? true : undefined} onClick={handleDiscardSettings}>
            Discard
          </button>
        </ui-save-bar>

        <div className="ppSettingsHero">
          <div>
            <span>ProductPulse controls</span>
            <h2>Workspace controls</h2>
            <p>
              Tune how ProductPulse classifies product risk, keeps QuickScan candidates, and queues detailed AI diagnosis work.
            </p>
          </div>
          <div className="ppSettingsHeroSummary" aria-label="Current risk threshold summary">
            <strong>{riskThresholds.highThreshold}+</strong>
            <span>High risk</span>
            <small>QuickScan keeps products from {riskThresholds.minimumScore}+ product risk or {momentumThreshold}+ momentum.</small>
          </div>
        </div>

        <ActionBanner actionData={actionData} />

        <Form ref={formRef} method="post" className="ppSettingsForm">
          <input type="hidden" name="_action" value="save-settings" />

          <section className="ppSettingsCard ppSettingsRiskCard" aria-labelledby="settings-risk-title">
            <div className="ppSettingsCardHeader">
              <DashboardIcon type="target" tone="blue" />
              <div>
                <span>Risk scoring</span>
                <h2 id="settings-risk-title">Product risk thresholds</h2>
                <p>
                  Control which products ProductPulse keeps after QuickScan and where low, medium and high risk start.
                </p>
              </div>
            </div>

            <div className="ppSettingsRiskPreview">
              <span style={{ width: `${riskThresholds.minimumScore}%` }}>Ignored</span>
              <span style={{ width: `${Math.max(8, riskThresholds.mediumThreshold - riskThresholds.minimumScore)}%` }}>Low</span>
              <span style={{ width: `${Math.max(8, riskThresholds.highThreshold - riskThresholds.mediumThreshold)}%` }}>Medium</span>
              <span style={{ width: `${Math.max(8, 100 - riskThresholds.highThreshold)}%` }}>High</span>
            </div>

            <RiskThresholdSlider thresholds={riskThresholds} onChange={setRiskThresholds} />

            <MomentumInclusionSlider value={momentumThreshold} onChange={setMomentumThreshold} />
          </section>

          <section className="ppSettingsGrid ppSettingsGridSingle">
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
                detail="Bulk analysis submissions above this limit are rejected before jobs are created. Use a finite cap to prevent accidental credit-heavy batches."
                value={queueLimit}
                onChange={(event) => setQueueLimit(clampClientInteger(event.target.value, 1, 500, normalizedQueueLimit))}
                min="1"
                max="500"
              />
            </div>

            <section className="ppSettingsCard ppSettingsWindowCard" aria-labelledby="settings-window-title">
              <div className="ppSettingsCardHeader">
                <DashboardIcon type="clock" tone="cyan" />
                <div>
                  <span>Analysis window</span>
                  <h2 id="settings-window-title">Evidence lookback</h2>
                  <p>
                    Choose how far back ProductPulse reads orders, returns, refunds and connected reviews during QuickScan and full product diagnostics.
                  </p>
                </div>
              </div>

              <AnalysisLookbackSlider value={lookbackDays} onChange={setLookbackDays} />
            </section>
          </section>
        </Form>

        <div className="ppSettingsForm">
          <section className="ppSettingsCard ppSettingsMockDatasetCard" aria-labelledby="settings-mock-dataset-title">
            <div className="ppSettingsCardHeader">
              <DashboardIcon type="product" tone="purple" />
              <div>
                <span>Testing dataset</span>
                <h2 id="settings-mock-dataset-title">Create Shopify mock dataset</h2>
                <p>
                  Generate 15 controlled <strong>GEN</strong> products, historical Shopify orders, returns, refunds and a normalized CSV review source for end-to-end diagnostic testing.
                </p>
              </div>
            </div>

            <div className="ppSettingsMockDatasetGrid">
              <div>
                <strong>What ProductPulse creates</strong>
                <p>
                  Product stories are intentional: some listings are healthy, others include title, content, variant, refund, return and sentiment problems that should be detected by the app.
                </p>
              </div>
              <ul>
                <li>15 Shopify products with HTML descriptions, SEO, tags and variants.</li>
                <li>200 historical test orders distributed across roughly 300 days.</li>
                <li>Selected full or partial returns and refunds, including Other notes.</li>
                <li>Hundreds of normalized CSV reviews linked to the generated products.</li>
              </ul>
            </div>

            <div className="ppSettingsMockDatasetMeta">
              <span>
                <strong>{mockDataset?.config?.productCount || 0}</strong>
                Last GEN products
              </span>
              <span>
                <strong>{mockDataset?.config?.orderCount || 0}</strong>
                Last generated orders
              </span>
              <span>
                <strong>{mockDataset?.config?.reviewCount || 0}</strong>
                Last CSV reviews
              </span>
              <span>
                <strong>{mockDataset?.config?.generatedAt ? formatWatchReportTimestamp(mockDataset.config.generatedAt) : "Never"}</strong>
                Last run
              </span>
              <span>
                <strong>{mockDataset?.config?.evolutionOrderCount || 0}</strong>
                Recent evolution orders
              </span>
            </div>

            <div className="ppSettingsMockDatasetActions">
              <p>
                Shopify can throttle long test-data jobs. Run each stage separately; every stage reuses existing GEN products or generated orders so you can resume after a failure.
              </p>
            </div>

            <div className="ppSettingsMockStageGrid" aria-label="Mock dataset generation stages">
              {MOCK_DATASET_STAGE_ACTIONS.map((stageAction) => {
                const stageState = mockDataset?.config?.stages?.[stageAction.stage] || {};
                const completed = stageState.status === "completed";
                const running = pendingMockDatasetStage === stageAction.stage;
                return (
                  <Form method="post" className="ppSettingsMockStageCard" key={stageAction.stage}>
                    <input type="hidden" name="_action" value="start-shopify-mock-dataset" />
                    <input type="hidden" name="stage" value={stageAction.stage} />
                    <DashboardIcon type={stageAction.icon} tone={completed ? "green" : "purple"} size="small" />
                    <div>
                      <strong>{stageAction.label}</strong>
                      <p>{stageAction.detail}</p>
                      <small>
                        {completed
                          ? `Completed ${formatWatchReportTimestamp(stageState.completedAt)}`
                          : stageState.status === "running"
                            ? "Running"
                            : "Not completed yet"}
                      </small>
                    </div>
                    <button className="ppSecondaryButton" type="submit" disabled={isStartingMockDataset ? true : undefined}>
                      {running ? "Starting..." : completed ? "Resume / verify" : "Run stage"}
                    </button>
                  </Form>
                );
              })}
            </div>

            <Form method="post" className="ppSettingsMockEvolutionCard">
              <input type="hidden" name="_action" value="start-shopify-mock-dataset" />
              <input type="hidden" name="stage" value="evolution" />
              <DashboardIcon type="chart-line" tone={mockDataset?.config?.stages?.evolution?.status === "completed" ? "green" : "purple"} size="small" />
              <div>
                <strong>Create recent evolution batch</strong>
                <p>
                  Adds a small, recent two-week set of GEN orders, returns, refunds and CSV reviews so Watchlist change reports can detect what changed since the previous diagnosis.
                </p>
                <small>
                  {mockDataset?.config?.stages?.evolution?.status === "completed"
                    ? `Completed ${formatWatchReportTimestamp(mockDataset.config.stages.evolution.completedAt)}`
                    : "Creates or reuses 41 recent evolution orders and rewrites the CSV with new reviews."}
                </small>
              </div>
              <button className="ppPrimaryButton" type="submit" disabled={isStartingMockDataset ? true : undefined}>
                {pendingMockDatasetStage === "evolution" ? "Starting..." : "Run evolution batch"}
              </button>
            </Form>
          </section>
        </div>
      </ScreenShell>
    </FullWidthPage>
  );
}

function RiskThresholdSlider({ thresholds, onChange }) {
  const legend = [
    { label: "Ignored", value: `0-${Math.max(0, thresholds.minimumScore - 1)}` },
    { label: "Low", value: `${thresholds.minimumScore}-${Math.max(thresholds.minimumScore, thresholds.mediumThreshold - 1)}` },
    { label: "Medium", value: `${thresholds.mediumThreshold}-${Math.max(thresholds.mediumThreshold, thresholds.highThreshold - 1)}` },
    { label: "High", value: `${thresholds.highThreshold}-100` },
  ];

  const handleChange = (key) => (event) => {
    onChange(getNextClientRiskThresholds(thresholds, key, event.target.value));
  };

  return (
    <div className="ppSettingsRiskSlider" style={{
      "--pp-risk-min": `${thresholds.minimumScore}%`,
      "--pp-risk-medium": `${thresholds.mediumThreshold}%`,
      "--pp-risk-high": `${thresholds.highThreshold}%`,
    }}>
      <input type="hidden" name="minimumScore" value={thresholds.minimumScore} />
      <input type="hidden" name="mediumThreshold" value={thresholds.mediumThreshold} />
      <input type="hidden" name="highThreshold" value={thresholds.highThreshold} />

      <div className="ppSettingsRiskScale" aria-hidden="true">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>

      <div className="ppSettingsRiskTrack">
        <div className="ppSettingsRiskTrackBase" aria-hidden="true" />
        <input
          className="ppSettingsRiskRange ppSettingsRiskRange-min"
          type="range"
          aria-label="Minimum QuickScan score"
          min="0"
          max="100"
          step="1"
          value={thresholds.minimumScore}
          onChange={handleChange("minimumScore")}
        />
        <input
          className="ppSettingsRiskRange ppSettingsRiskRange-medium"
          type="range"
          aria-label="Medium risk starts at"
          min="0"
          max="100"
          step="1"
          value={thresholds.mediumThreshold}
          onChange={handleChange("mediumThreshold")}
        />
        <input
          className="ppSettingsRiskRange ppSettingsRiskRange-high"
          type="range"
          aria-label="High risk starts at"
          min="0"
          max="100"
          step="1"
          value={thresholds.highThreshold}
          onChange={handleChange("highThreshold")}
        />
      </div>

      <div className="ppSettingsRiskHandleLabels" aria-live="polite">
        <span><strong>Minimum</strong> {thresholds.minimumScore}</span>
        <span><strong>Medium starts</strong> {thresholds.mediumThreshold}</span>
        <span><strong>High starts</strong> {thresholds.highThreshold}</span>
      </div>

      <div className="ppSettingsRiskLegend" aria-label="Product risk intervals">
        {legend.map((item) => (
          <span key={item.label}>
            <strong>{item.label}</strong>
            {item.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function MomentumInclusionSlider({ value, onChange }) {
  const normalizedValue = normalizeClientMomentumThreshold(value);
  const handleChange = (event) => {
    onChange(normalizeClientMomentumThreshold(event.target.value));
  };

  return (
    <div className="ppSettingsMomentumControl" style={{ "--pp-momentum-threshold": `${normalizedValue}%` }}>
      <input type="hidden" name="momentumMinimumScore" value={normalizedValue} />
      <div className="ppSettingsMomentumHeader">
        <div>
          <strong>Product Momentum inclusion</strong>
          <p>
            QuickScan keeps products at or above this Product Momentum even when Product Risk is below the minimum risk threshold.
          </p>
        </div>
        <span>{normalizedValue}+</span>
      </div>
      <div className="ppSettingsMomentumSliderRow">
        <input
          type="range"
          aria-label="Minimum Product Momentum score"
          min="0"
          max="100"
          step="1"
          value={normalizedValue}
          onChange={handleChange}
        />
        <input
          type="number"
          aria-label="Minimum Product Momentum exact value"
          min="0"
          max="100"
          step="1"
          value={normalizedValue}
          onChange={handleChange}
        />
      </div>
      <div className="ppSettingsMomentumLegend" aria-hidden="true">
        <span>Ignored</span>
        <span>Stable</span>
        <span>Rising</span>
        <span>Hot</span>
      </div>
    </div>
  );
}

function SettingsNumberField({ name, label, detail, defaultValue, value, onChange, min, max }) {
  const controlledProps = value == null ? { defaultValue } : { value, onChange };
  return (
    <label className="ppSettingsNumberField">
      <span>{label}</span>
      <input
        type="number"
        name={name}
        aria-label={label}
        {...controlledProps}
        min={min}
        max={max}
        step="1"
      />
      <small>{detail}</small>
    </label>
  );
}

function AnalysisLookbackSlider({ value, onChange }) {
  const normalizedValue = normalizeClientLookbackDays(value);
  const percentage = ((normalizedValue - PRODUCT_PULSE_MIN_LOOKBACK_DAYS) / (PRODUCT_PULSE_MAX_LOOKBACK_DAYS - PRODUCT_PULSE_MIN_LOOKBACK_DAYS)) * 100;
  const handleChange = (event) => {
    onChange(normalizeClientLookbackDays(event.target.value));
  };

  return (
    <div className="ppSettingsLookbackControl" style={{ "--pp-lookback-progress": `${percentage}%` }}>
      <input type="hidden" name="analysisLookbackDays" value={normalizedValue} />
      <div className="ppSettingsLookbackValue">
        <strong>{normalizedValue}</strong>
        <span>days back</span>
      </div>
      <div className="ppSettingsLookbackSliderRow">
        <input
          type="range"
          aria-label="Analysis lookback days"
          min={PRODUCT_PULSE_MIN_LOOKBACK_DAYS}
          max={PRODUCT_PULSE_MAX_LOOKBACK_DAYS}
          step="1"
          value={normalizedValue}
          onChange={handleChange}
        />
        <input
          type="number"
          aria-label="Analysis lookback days exact value"
          min={PRODUCT_PULSE_MIN_LOOKBACK_DAYS}
          max={PRODUCT_PULSE_MAX_LOOKBACK_DAYS}
          step="1"
          value={normalizedValue}
          onChange={handleChange}
        />
      </div>
      <div className="ppSettingsLookbackTicks" aria-hidden="true">
        <span>10d</span>
        <span>60d default</span>
        <span>180d</span>
        <span>365d</span>
      </div>
      <p>
        Older orders, returns, refunds and reviews are ignored for scoring. Use a shorter window for fresh risk, or a longer one when volume is low.
      </p>
    </div>
  );
}

function getShopifySaveBarApi() {
  if (typeof window === "undefined") return null;
  return window.shopify?.saveBar || null;
}

function getDefaultProductPulseClientSettings() {
  return {
    risk: {
      minimumScore: 18,
      mediumThreshold: 55,
      highThreshold: 75,
    },
    momentum: {
      minimumScore: DEFAULT_MOMENTUM_INCLUSION_THRESHOLD,
    },
    diagnosis: {
      maxQueuedPerSubmission: 25,
    },
    analysis: {
      lookbackDays: 60,
    },
  };
}

function normalizeClientQueueLimit(value) {
  return clampClientInteger(value, 1, 500, 25);
}

function normalizeClientLookbackDays(value) {
  return clampClientInteger(value, PRODUCT_PULSE_MIN_LOOKBACK_DAYS, PRODUCT_PULSE_MAX_LOOKBACK_DAYS, 60);
}

function normalizeClientMomentumThreshold(value) {
  return clampClientInteger(value, 0, 100, DEFAULT_MOMENTUM_INCLUSION_THRESHOLD);
}

function normalizeClientRiskThresholds(risk = {}) {
  const minimumScore = clampClientInteger(risk.minimumScore, 0, 90, 18);
  const mediumThreshold = clampClientInteger(
    risk.mediumThreshold,
    minimumScore + RISK_THRESHOLD_HANDLE_GAP,
    95,
    Math.max(55, minimumScore + RISK_THRESHOLD_HANDLE_GAP),
  );
  const highThreshold = clampClientInteger(
    risk.highThreshold,
    mediumThreshold + RISK_THRESHOLD_HANDLE_GAP,
    100,
    Math.max(75, mediumThreshold + RISK_THRESHOLD_HANDLE_GAP),
  );
  return { minimumScore, mediumThreshold, highThreshold };
}

function getNextClientRiskThresholds(current, key, value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return current;

  if (key === "minimumScore") {
    return {
      ...current,
      minimumScore: Math.min(Math.min(90, current.mediumThreshold - RISK_THRESHOLD_HANDLE_GAP), Math.max(0, number)),
    };
  }

  if (key === "mediumThreshold") {
    return {
      ...current,
      mediumThreshold: Math.min(
        current.highThreshold - RISK_THRESHOLD_HANDLE_GAP,
        Math.max(current.minimumScore + RISK_THRESHOLD_HANDLE_GAP, number),
      ),
    };
  }

  if (key === "highThreshold") {
    return {
      ...current,
      highThreshold: Math.min(100, Math.max(current.mediumThreshold + RISK_THRESHOLD_HANDLE_GAP, number)),
    };
  }

  return current;
}

function clampClientInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function QuickScanCsvReviewsModal({ onCancel, onContinue }) {
  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal ppQuickScanCsvModal" role="dialog" aria-modal="true" aria-labelledby="quick-scan-csv-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon ppQuickScanCsvIcon" aria-hidden="true">
            <s-icon type="file" size="small"></s-icon>
          </span>
          <div>
            <span>Recommended source</span>
            <h2 id="quick-scan-csv-title">Add CSV reviews before QuickScan?</h2>
            <p>
              QuickScan can run without review data, but uploaded CSV reviews make the scan more useful when you already collect product reviews.
            </p>
          </div>
        </div>

        <div className="ppActionConfirmNotice ppQuickScanCsvNotice">
          <s-icon type="info" size="small"></s-icon>
          <p>
            ProductPulse does not call your review provider during QuickScan. It only uses the normalized CSV review file uploaded in Connect.
          </p>
        </div>

        <div className="ppAnalysisConfirmProducts ppQuickScanCsvChecklist">
          <span>Recommended CSV fields</span>
          <ul>
            <li>Product handle or Shopify product ID so reviews can be matched to products.</li>
            <li>Rating or stars so QuickScan can include review pressure in the preliminary score.</li>
            <li>Review date and text are optional for QuickScan, but useful later for deep diagnosis.</li>
          </ul>
        </div>

        <div className="ppAnalysisConfirmFooter ppQuickScanCsvFooter">
          <button className="ppSecondaryButton" type="button" onClick={onCancel}>Cancel</button>
          <Link className="ppSecondaryButton" to="/app/connect">Upload CSV first</Link>
          <button className="ppPrimaryButton" type="button" onClick={onContinue}>Continue without CSV</button>
        </div>
      </section>
    </div>
  );
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
            <span className="ppQuickScanBolt" aria-hidden="true">⚡</span>
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

function WatchlistConfirmModal({ confirmation, pending, onCancel }) {
  const product = confirmation.product || {};
  const removing = confirmation.mode === "remove";
  const titleId = removing ? "watchlist-remove-confirm-title" : "watchlist-add-confirm-title";
  const submitLabel = removing
    ? pending ? "Removing..." : "Remove from Watchlist"
    : pending ? "Adding..." : "Add to Watchlist";

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal ppWatchlistConfirmModal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ppAnalysisConfirmHeader">
          <span className={`ppAnalysisConfirmIcon ${removing ? "ppWatchlistConfirmIcon-remove" : "ppWatchlistConfirmIcon-add"}`} aria-hidden="true">
            {removing ? <s-icon type="x" size="small"></s-icon> : <ProductPulseGlyph type="binoculars" />}
          </span>
          <div>
            <span>Watchlist</span>
            <h2 id={titleId}>{removing ? "Remove watched product" : "Add watched product"}</h2>
            <p>
              {removing
                ? "ProductPulse will stop monitoring this product on the Watchlist cadence. Existing diagnostics and history will stay available."
                : "ProductPulse will add this product to the Watchlist so it can be monitored by the configured automatic cadence."}
            </p>
          </div>
        </div>

        <div className="ppAnalysisConfirmProducts">
          <span>Product</span>
          <ul>
            <li>{product.title || "Selected product"}</li>
          </ul>
        </div>

        <div className="ppActionConfirmNotice">
          <s-icon type="info" size="small"></s-icon>
          <p>
            {removing
              ? "You can add this product back later from the product detail page or the Products table."
              : "The Watchlist supports up to five products. If it is full, ProductPulse will ask you to remove one first."}
          </p>
        </div>

        <Form method="post" className="ppAnalysisConfirmFooter">
          <input type="hidden" name="_action" value={removing ? "remove-from-watchlist" : "add-to-watchlist"} />
          <input type="hidden" name="productGid" value={product.productGid || ""} />
          {!removing && (
            <>
              <input type="hidden" name="title" value={product.title || ""} />
              <input type="hidden" name="handle" value={product.handle || ""} />
              <input type="hidden" name="sku" value={product.sku || ""} />
              <input type="hidden" name="imageUrl" value={product.imageUrl || ""} />
              <input type="hidden" name="imageAlt" value={product.imageAlt || product.title || ""} />
            </>
          )}
          <button className="ppSecondaryButton" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className={removing ? "ppSecondaryButton ppWatchlistRemoveConfirmButton" : "ppPrimaryButton"} type="submit" disabled={pending || !product.productGid}>
            {removing ? <s-icon type="x" size="small"></s-icon> : <ProductPulseGlyph type="binoculars" />}
            {submitLabel}
          </button>
        </Form>
      </section>
    </div>
  );
}

function DeleteProductAnalysisConfirmModal({ confirmation, pending, onCancel }) {
  const product = confirmation.product || {};
  const productId = getProductActionKey(product);

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal ppDeleteAnalysisConfirmModal" role="dialog" aria-modal="true" aria-labelledby="delete-product-analysis-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon ppDeleteAnalysisConfirmIcon" aria-hidden="true">
            <ProductPulseGlyph type="trash" />
          </span>
          <div>
            <span>Delete local analysis</span>
            <h2 id="delete-product-analysis-title">Delete product analysis?</h2>
            <p>
              ProductPulse will remove this product from the local analysis database. This does not delete or modify the Shopify product.
            </p>
          </div>
        </div>

        <div className="ppAnalysisConfirmProducts">
          <span>Product</span>
          <ul>
            <li>{product.title || "Selected product"}</li>
          </ul>
        </div>

        <div className="ppActionConfirmNotice ppDeleteAnalysisNotice">
          <s-icon type="info" size="small"></s-icon>
          <p>
            Stored diagnostics, recommendations, action states, score history, Watchlist tracking and related ProductPulse jobs for this product will be removed.
            To analyze it again, use <strong>Find Shopify product</strong> from the Products table and run a new diagnosis.
          </p>
        </div>

        <Form method="post" className="ppAnalysisConfirmFooter">
          <input type="hidden" name="_action" value="delete-product-analysis" />
          <input type="hidden" name="productId" value={productId || ""} />
          <button className="ppSecondaryButton" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="ppSecondaryButton ppDeleteAnalysisConfirmButton" type="submit" disabled={pending || !productId}>
            <ProductPulseGlyph type="trash" />
            {pending ? "Deleting..." : "Delete analysis"}
          </button>
        </Form>
      </section>
    </div>
  );
}

function RecommendedActionConfirmModal({ confirmation, product, pending, onCancel }) {
  const action = confirmation.action || {};
  const application = confirmation.application || getRecommendedActionApplication(action, product);
  const editedText = String(confirmation.editedText ?? application.value ?? "");
  const isTagChange = String(application.target || "").toLowerCase().includes("tag");
  const tagOverride = String(confirmation.tagOverride || "");
  const valuePreview = editedText || "No value supplied.";
  const unresolvedPlaceholders = getEditableTextPlaceholders(editedText);
  const metafieldMissing = application.isMetafield && (!String(application.metafieldNamespace || "").trim() || !String(application.metafieldKey || "").trim());
  const submitLabel = pending ? "Applying change..." : application.confirmationSubmitLabel || "Accept and apply change";

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
          {application.isMetafield && (
            <div>
              <span>Metafield</span>
              <strong>{application.metafieldNamespace}.{application.metafieldKey}</strong>
            </div>
          )}
        </div>

        {application.currentValue && (
          <div className="ppActionConfirmCurrent">
            <span>{application.currentValueLabel || "Current value"}</span>
            <CurrentDescriptionInsertionPreview application={application} asPre />
          </div>
        )}

        <div className="ppActionConfirmChange">
          <span>{application.valueLabel || "New value"}</span>
          <pre>{renderAnalysisText(valuePreview)}</pre>
        </div>

        {unresolvedPlaceholders.length > 0 && (
          <PlaceholderReviewNotice placeholders={unresolvedPlaceholders} />
        )}

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
          <input type="hidden" name="field" value={application.field || ""} />
          {tagOverride && <input type="hidden" name="tag" value={tagOverride} />}
          <input type="hidden" name="applyMode" value="apply" />
          <input type="hidden" name="actionVariant" value={application.variantId || ""} />
          <input type="hidden" name="descriptionOperation" value={application.descriptionOperation || ""} />
          <input type="hidden" name="metafieldNamespace" value={application.metafieldNamespace || ""} />
          <input type="hidden" name="metafieldKey" value={application.metafieldKey || ""} />
          <input type="hidden" name="metafieldType" value={application.metafieldType || ""} />
          <button className="ppSecondaryButton" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="ppPrimaryButton" type="submit" disabled={pending || !editedText.trim() || unresolvedPlaceholders.length > 0 || metafieldMissing}>
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
      <span className="ppQuickScanBolt" aria-hidden="true">⚡</span>
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
  title = "Find Shopify product",
  eyebrow = "Shopify catalog",
  description = "Search the live Shopify catalog, select a product that has not appeared in QuickScan, and queue a full AI diagnosis.",
  actionLabel = "Run diagnosis",
  actionIcon = "wand",
  addedProductIds = [],
  addedActionLabel = "Added",
  addedStatusKind = "watchlist",
  onAddCandidate,
  candidateActionLabel = "Add to Candidates",
}) {
  const normalizedQuery = query.trim();
  const hasQuery = normalizedQuery.length >= 2;
  const addedProductIdSet = addedProductIds instanceof Set ? addedProductIds : new Set(addedProductIds);

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppAnalysisConfirmModal ppShopifyProductSearchModal" role="dialog" aria-modal="true" aria-labelledby="shopify-product-search-title">
        <div className="ppAnalysisConfirmHeader">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type="search" size="small"></s-icon>
          </span>
          <div>
            <span>{eyebrow}</span>
            <h2 id="shopify-product-search-title">{title}</h2>
            <p>{description}</p>
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
              {results.map((product) => {
                const alreadyAdded = addedProductIdSet.has(product.id);
                return (
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
                        <ProductSearchStatusIcon product={product} alreadyAdded={alreadyAdded} addedActionLabel={addedActionLabel} addedStatusKind={addedStatusKind} />
                      </div>
                      <p>{product.handle ? `/${product.handle}` : "Shopify product"}</p>
                      <small>
                        {[product.status, product.detail, product.sku ? `SKU ${product.sku}` : ""].filter(Boolean).join(" - ")}
                      </small>
                    </div>
                    <div className="ppShopifyProductResultActions">
                      <ShopifyProductResultActionButton
                        className="ppShopifyProductResultRunAction"
                        icon={actionIcon}
                        label={actionLabel}
                        tooltip="Run diagnostics and move this product into Full diagnostics while the job runs."
                        iconOnly={Boolean(onAddCandidate)}
                        onClick={() => onAnalyze(product)}
                      />
                      {onAddCandidate && (
                        <ShopifyProductResultActionButton
                          className="ppShopifyProductResultCandidateAction"
                          disabled={alreadyAdded || getProductSearchStatus(product).tone !== "catalog"}
                          icon={alreadyAdded ? "check" : "plus"}
                          label={alreadyAdded ? addedActionLabel : candidateActionLabel}
                          tooltip={alreadyAdded
                            ? "This product is already listed in Candidates."
                            : getProductSearchStatus(product).tone === "catalog"
                            ? "Add this product to Candidates without running any scan."
                            : "This product is already stored in ProductPulse."}
                          onClick={() => onAddCandidate(product)}
                        />
                      )}
                    </div>
                  </article>
                );
              })}
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

function ShopifyProductResultActionButton({
  className = "",
  disabled = false,
  icon,
  label,
  tooltip,
  iconOnly = false,
  onClick,
}) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={`ppShopifyProductResultAction ${iconOnly ? "ppShopifyProductResultActionIconOnly" : ""} ${className}`.trim()}
        type="button"
        ref={triggerRef}
        disabled={disabled}
        aria-label={iconOnly ? label : undefined}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={onClick}
      >
        <s-icon type={icon} size="small"></s-icon>
        {!iconOnly && <span>{label}</span>}
      </button>
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppProductPulseSearchStatusPopover" width={236} placement="top-center">
        <strong>{label}</strong>
        {tooltip && <small>{tooltip}</small>}
      </FloatingTablePopover>
    </>
  );
}

function ProductSearchStatusIcon({ product, alreadyAdded = false, addedActionLabel = "Added", addedStatusKind = "watchlist" }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const status = getProductSearchStatus(product, alreadyAdded, addedStatusKind);
  const label = alreadyAdded ? addedActionLabel : status.label;
  const detail = status.detail;

  return (
    <>
      <button
        className={`ppProductPulseSearchStatus ppProductPulseSearchStatus-${status.tone}`}
        type="button"
        ref={triggerRef}
        aria-label={`${label}. ${detail}`}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {status.icon === "binoculars" ? <ProductPulseGlyph type="binoculars" /> : <s-icon type={status.icon} size="small"></s-icon>}
      </button>
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppProductPulseSearchStatusPopover" width={252} placement="top-center">
        <strong>{label}</strong>
        <small>{detail}</small>
      </FloatingTablePopover>
    </>
  );
}

function getProductSearchStatus(product = {}, alreadyAdded = false, addedStatusKind = "watchlist") {
  if (alreadyAdded) {
    if (addedStatusKind === "candidate") {
      return {
        icon: "check",
        tone: "added",
        label: "Added to Candidates",
        detail: "This product is now listed in Candidates. You can still run diagnostics from this modal.",
      };
    }
    return {
      icon: "binoculars",
      tone: "watch",
      label: "Already added",
      detail: "This product is already selected for this workflow.",
    };
  }
  const status = product.productPulseStatus || (product.existingSnapshot ? product.analysisDepth === "full" ? "full" : "quickscan" : "catalog");
  if (status === "full") {
    return {
      icon: "wand",
      tone: "full",
      label: product.productPulseStatusLabel || "Deep analysis completed",
      detail: product.productPulseStatusDetail || "This product already has a completed deep product diagnosis in ProductPulse.",
    };
  }
  if (status === "quickscan") {
    return {
      icon: "search",
      tone: "quickscan",
      label: product.productPulseStatusLabel || "QuickScan stored",
      detail: product.productPulseStatusDetail || "This product is stored in ProductPulse with lightweight QuickScan signals only.",
    };
  }
  return {
    icon: "product",
    tone: "catalog",
    label: product.productPulseStatusLabel || "Not in ProductPulse",
    detail: product.productPulseStatusDetail || "This Shopify product is not stored in ProductPulse yet.",
  };
}

function ProductFilterPillGroup({ label, value, options, onChange }) {
  const normalizedOptions = Array.isArray(options) && options.length ? options : [{ value: "all", label: "All" }];

  return (
    <div className="ppFilterPillGroup" aria-label={`${label} filter`}>
      <span className="ppFilterPillGroupLabel">{label}</span>
      <div>
        {normalizedOptions.map((option) => {
          const active = (value || "all") === option.value;
          return (
            <button
              className={`ppFilterPill ${active ? "isActive" : ""}`.trim()}
              type="button"
              key={option.value}
              aria-pressed={active}
              onClick={() => onChange?.(option.value)}
            >
              {option.label}
              {Number.isFinite(option.count) && <small>{option.count}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProductFilterSelect({ name, label, value, options }) {
  const normalizedOptions = Array.isArray(options) && options.length ? options : [{ value: "all", label }];

  return (
    <label className="ppCompactSelect">
      <span>{label}</span>
      <select name={name} value={value || "all"} onChange={() => {}}>
        {normalizedOptions.map((option) => (
          <option value={option.value} key={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ProductFilterSearchInput({ name, label, value, options, scope = "" }) {
  const normalizedOptions = Array.isArray(options) && options.length ? options.filter((option) => option.value !== "all") : [];
  const matchingOption = normalizedOptions.find((option) => option.value === value || option.label === value);
  const normalizedValue = !value || value === "all" ? "" : matchingOption?.label || value;
  const [draftValue, setDraftValue] = useState(normalizedValue);
  const listId = `pp-products-${scope ? `${scope}-` : ""}${name}-options`;

  useEffect(() => {
    setDraftValue(normalizedValue);
  }, [normalizedValue]);

  return (
    <label className="ppCompactSelect ppCompactSearchFilter">
      <span>{label}</span>
      <input
        type="search"
        name={name}
        value={draftValue}
        list={listId}
        onChange={(event) => setDraftValue(event.target.value)}
        placeholder={`Search ${label.toLowerCase()}`}
        autoComplete="off"
      />
      <datalist id={listId}>
        {normalizedOptions.map((option) => (
          <option value={option.label} key={option.value} />
        ))}
      </datalist>
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

const PRODUCT_FILTER_DEFAULTS = {
  query: "",
  risk: "all",
  status: "all",
  issue: "all",
  source: "all",
  vendor: "all",
  collection: "all",
  page: "1",
  rows: "25",
  sort: "",
  direction: "desc",
};

function buildProductFilterFormData(current = {}, overrides = {}, table = "main") {
  const mainValues = {
    ...PRODUCT_FILTER_DEFAULTS,
    ...current,
  };
  delete mainValues.candidates;
  const candidateValues = {
    ...PRODUCT_FILTER_DEFAULTS,
    ...(current.candidates || {}),
  };
  const targetValues = table === "candidates" ? candidateValues : mainValues;
  Object.assign(targetValues, overrides);

  const formData = new FormData();
  appendProductFilterFormValues(formData, mainValues);
  appendProductFilterFormValues(formData, candidateValues, "candidate");

  return formData;
}

function appendProductFilterFormValues(formData, values = {}, prefix = "") {
  const getParamName = (name) => {
    if (!prefix) return name === "query" ? "q" : name;
    if (name === "query") return `${prefix}Q`;
    return `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  };
  const normalizedValues = {
    query: "",
    risk: "all",
    status: "all",
    issue: "all",
    source: "all",
    vendor: "all",
    collection: "all",
    page: "1",
    rows: "25",
    sort: "",
    direction: "desc",
    ...values,
  };

  if (normalizedValues.query) formData.set(getParamName("query"), normalizedValues.query);
  ["risk", "status", "issue", "source", "vendor", "collection"].forEach((name) => {
    if (normalizedValues[name] && normalizedValues[name] !== "all") formData.set(getParamName(name), normalizedValues[name]);
  });
  if (String(normalizedValues.page || "1") !== "1") formData.set(getParamName("page"), String(normalizedValues.page));
  if (String(normalizedValues.rows || "25") !== "25") formData.set(getParamName("rows"), String(normalizedValues.rows));
  if (normalizedValues.sort) {
    formData.set(getParamName("sort"), normalizedValues.sort);
    formData.set(getParamName("direction"), normalizedValues.direction === "asc" ? "asc" : "desc");
  }
}

function buildProductFilterHref(current = {}, overrides = {}, table = "main") {
  const params = new URLSearchParams(buildProductFilterFormData(current, overrides, table));
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
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const analysis = getProductAnalysisDisplay(product);
  const popoverTitle = completionOnly && analysis.depth === "full" ? "Deep analysis completed" : getAnalysisPopoverTitle(analysis);
  const popoverDetail = completionOnly
    ? formatProductAnalysisDate(analysis.completedAt || product.lastAnalysis)
    : analysis.detail;
  return (
    <button
      className={`ppAnalysisStatusWrap ${titleIcon ? "ppAnalysisStatusWrap-titleIcon" : ""}`.trim()}
      type="button"
      ref={triggerRef}
      aria-label={`${popoverTitle}. ${popoverDetail}`}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
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
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppAnalysisStatusPopover" width={244} placement="bottom-center">
        <strong>{popoverTitle}</strong>
        <small>{popoverDetail}</small>
      </FloatingTablePopover>
    </button>
  );
}

function getAnalysisPopoverTitle(analysis) {
  if (analysis.depth === "full") return "Deep Analysis completed";
  if (analysis.depth === "quickscan") return "Fast Analysis completed";
  return "No analysis completed";
}

function getProductDetailModel(product) {
  const metrics = { ...(product.metrics || {}) };
  metrics.returnRate = clampPercentValue(metrics.returnRate || 0);
  metrics.refundRate = clampPercentValue(metrics.refundRate || 0);
  const sourceCoverage = product.sourceCoverage || [];
  const hasRiskSnapshot = product.hasRiskSnapshot !== false;
  const analysisStatus = getProductAnalysisDisplay(product);
  const hasFullDiagnosis = analysisStatus.depth === "full";
  const activeDiagnosisJob = getActiveProductDiagnosisFromProduct(product);
  const ignoredIssues = getIgnoredIssueRecords(product);
  const issueText = product.primaryIssue || "";
  const issueCategory = getProductIssueCategory(issueText);
  const detectedIssueRows = getProductDetectedIssues(product, issueCategory, hasRiskSnapshot);
  const recommendedActions = hasFullDiagnosis ? getProductRecommendedActions(product) : [];
  const firstAction = recommendedActions[0];
  const evidenceSources = getProductEvidenceSources(product);
  const checkedItems = getProductCheckedItems(product);
  const mainFinding = sanitizeProductMainFinding(product.mainFinding);
  const riskTrendValues = getProductRiskTrendValues(product);
  const riskDisplay = getProductRiskDisplay(product.riskScore, riskTrendValues, product.riskTone, hasRiskSnapshot);
  const monthlyOrderActivity = normalizeProductMonthlyOrderActivity(metrics.monthlyOrderActivity);
  const returnRatePrediction = normalizeProductReturnRatePrediction(metrics.returnRatePrediction);
  const productMomentum = normalizeProductMomentum(metrics.productMomentum);
  const hasMonthlyOrderActivity = hasProductMonthlyOrderActivity(monthlyOrderActivity);
  const hasReturnRatePrediction = hasProductReturnRatePrediction(returnRatePrediction);
  const productStatus = product.status || metrics.productStatus || "";
  const productCollections = Array.isArray(metrics.collections) && metrics.collections.length
    ? metrics.collections
    : [product.collection].filter(Boolean);

  return {
    productGid: product.productGid || product.id || "",
    handle: product.handle || product.slug || "",
    slug: product.slug || product.handle || "",
    title: product.title,
    productStatus,
    productStatusLabel: getProductStatusLabel(productStatus),
    productStatusTone: getProductStatusTone(productStatus),
    productType: product.productType || metrics.productType || "",
    vendor: product.vendor || metrics.vendor || "",
    collections: productCollections,
    sku: product.sku || metrics.sku || "",
    variant: getProductArtVariant(product),
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    shopifyAdminUrl: product.shopifyAdminUrl,
    shopifyStorefrontUrl: product.shopifyStorefrontUrl,
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
    riskScoreLabel: riskDisplay.label,
    riskTrendLabel: riskDisplay.trendLabel,
    riskScore: product.riskScore || 0,
    riskTone: riskDisplay.tone,
    confidence: product.confidence || 0,
    confidenceLabel: getConfidenceLabel(product.confidence || 0, hasRiskSnapshot),
    signalCount: metrics.signalCount || 0,
    returnRate: metrics.returnRate || 0,
    estimatedImpact: getEstimatedImpactValue(metrics),
    marginAtRisk: getEstimatedMarginValue(metrics),
    revenueAtRisk: getEstimatedRevenueValue(metrics),
    impactRange: metrics.impactRange || {
      low: metrics.impactFactors?.impactLow,
      mid: metrics.impactFactors?.impactMid,
      high: metrics.impactFactors?.impactHigh,
    },
    priorityScore: Number(metrics.priorityScore || 0),
    evidenceStrengthScore: Number(metrics.evidenceStrengthScore || metrics.confidenceFactors?.evidenceStrengthScore || 0),
    scoreCalculationStatus: metrics.scoreCalculationStatus || getScoreCalculationStatus(metrics),
    riskTrend: riskTrendValues,
    riskHistory: Array.isArray(metrics.riskHistory) ? metrics.riskHistory : [],
    monthlyOrderActivity,
    hasMonthlyOrderActivity,
    returnRatePrediction,
    hasReturnRatePrediction,
    productMomentum,
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
    recommendedFix: hasFullDiagnosis ? (firstAction?.title || firstAction?.label || "No deterministic action yet") : "Run full product diagnosis",
    recommendedFixDetail: hasFullDiagnosis
      ? (firstAction ? `${firstAction.type} - ${firstAction.effort} effort` : "No stored recommendation from current product signals.")
      : "Recommended actions are intentionally locked until this product has a completed deep diagnosis.",
    evidenceSources,
    detectedIssues: detectedIssueRows,
    recommendedActions,
    checkedItems,
    actionHistory: product.actionHistory || [],
    ignoredIssues,
    isWatched: Boolean(product.isWatched),
    watchlistStatus: product.watchlistStatus || null,
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

function getProductStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "Status unavailable";
  if (normalized === "active" || normalized === "published") return "Published";
  if (normalized === "draft") return "Draft";
  if (normalized === "archived") return "Archived";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getProductStatusTone(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "published") return "success";
  if (normalized === "draft") return "warning";
  if (normalized === "archived") return "critical";
  return "info";
}

function getStorefrontUrlFromAdminUrl(adminUrl, handle) {
  const productHandle = String(handle || "").trim();
  if (!adminUrl || !productHandle) return "";
  try {
    const url = new URL(adminUrl);
    return `${url.protocol}//${url.host}/products/${encodeURIComponent(productHandle)}`;
  } catch {
    return "";
  }
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

function getScoreCalculationStatus(metrics = {}) {
  if (metrics.riskComponents?.calculationState === "score_breakdown_reconstructed" || metrics.scoreBreakdownReconstructed) {
    return "Score breakdown reconstructed";
  }
  if (metrics.riskComponents && Object.keys(metrics.riskComponents).length) {
    return "Score calculated from persisted components";
  }
  return "Score components unavailable";
}

function clampPercentValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return clampNumber(number, 0, 100);
}

function calculateClientUnitRatePercent(numeratorUnits, denominatorUnits, fallbackPercent = 0) {
  const numerator = Number(numeratorUnits || 0);
  const denominator = Number(denominatorUnits || 0);
  const rawRate = denominator > 0 ? (numerator / denominator) * 100 : fallbackPercent;
  return clampPercentValue(rawRate);
}

function normalizeProductMonthlyOrderActivity(activity = null) {
  const months = (Array.isArray(activity?.months) ? activity.months : [])
    .map((month) => ({
      key: String(month.key || month.label || ""),
      label: String(month.label || month.key || ""),
      shortLabel: String(month.shortLabel || month.label || month.key || ""),
      startAt: month.startAt || null,
      orders: Number(month.orders || 0),
      orderUnits: Number(month.orderUnits || 0),
      revenue: Number(month.revenue || 0),
      returnedOrders: Number(month.returnedOrders || 0),
      returnedUnits: Number(month.returnedUnits || 0),
      refundedOrders: Number(month.refundedOrders || 0),
      refundedUnits: Number(month.refundedUnits || 0),
      refundAmount: Number(month.refundAmount || 0),
      returnRate: calculateClientUnitRatePercent(month.returnedUnits, month.orderUnits, month.returnRate ?? 0),
      refundRate: calculateClientUnitRatePercent(month.refundedUnits, month.orderUnits, month.refundRate ?? 0),
    }))
    .filter((month) => month.key || month.label);

  const summary = activity?.summary || {};
  const computed = months.reduce((totals, month) => ({
    totalOrders: totals.totalOrders + month.orders,
    totalOrderUnits: totals.totalOrderUnits + month.orderUnits,
    totalRevenue: totals.totalRevenue + month.revenue,
    totalReturnedOrders: totals.totalReturnedOrders + month.returnedOrders,
    totalReturnedUnits: totals.totalReturnedUnits + month.returnedUnits,
    totalRefundedOrders: totals.totalRefundedOrders + month.refundedOrders,
    totalRefundedUnits: totals.totalRefundedUnits + month.refundedUnits,
    totalRefundAmount: totals.totalRefundAmount + month.refundAmount,
    maxOrders: Math.max(totals.maxOrders, month.orders, month.returnedOrders, month.refundedOrders),
  }), {
    totalOrders: 0,
    totalOrderUnits: 0,
    totalRevenue: 0,
    totalReturnedOrders: 0,
    totalReturnedUnits: 0,
    totalRefundedOrders: 0,
    totalRefundedUnits: 0,
    totalRefundAmount: 0,
    maxOrders: 0,
  });

  const totalOrders = Number(summary.totalOrders ?? computed.totalOrders);
  const totalReturnedOrders = Number(summary.totalReturnedOrders ?? computed.totalReturnedOrders);
  const totalRefundedOrders = Number(summary.totalRefundedOrders ?? computed.totalRefundedOrders);
  const totalOrderUnits = Number(summary.totalOrderUnits ?? computed.totalOrderUnits);
  const totalReturnedUnits = Number(summary.totalReturnedUnits ?? computed.totalReturnedUnits);
  const totalRefundedUnits = Number(summary.totalRefundedUnits ?? computed.totalRefundedUnits);

  return {
    source: activity?.source || "",
    windowDays: Number(activity?.windowDays || 0),
    generatedAt: activity?.generatedAt || null,
    months,
    summary: {
      ...computed,
      ...summary,
      totalOrders,
      totalOrderUnits,
      totalReturnedOrders,
      totalReturnedUnits,
      totalRefundedOrders,
      totalRefundedUnits,
      maxOrders: Math.max(Number(summary.maxOrders || computed.maxOrders || 0), 1),
      returnRate: calculateClientUnitRatePercent(
        totalReturnedUnits,
        totalOrderUnits,
        summary.returnRate ?? (totalOrders ? (totalReturnedOrders / totalOrders) * 100 : 0),
      ),
      refundRate: calculateClientUnitRatePercent(
        totalRefundedUnits,
        totalOrderUnits,
        summary.refundRate ?? (totalOrders ? (totalRefundedOrders / totalOrders) * 100 : 0),
      ),
    },
  };
}

function normalizeProductReturnRatePrediction(prediction = null) {
  const observedPoints = (Array.isArray(prediction?.observedPoints) ? prediction.observedPoints : [])
    .map((point) => ({
      kind: "observed",
      key: String(point.key || point.startAt || point.label || ""),
      label: String(point.label || point.key || ""),
      startAt: point.startAt || null,
      orders: Number(point.orders || 0),
      orderUnits: Number(point.orderUnits || 0),
      returnedOrders: Number(point.returnedOrders || 0),
      returnedUnits: Number(point.returnedUnits || 0),
      rawReturnRate: point.rawReturnRate == null ? null : clampPercentValue(point.rawReturnRate),
      smoothedReturnRate: clampPercentValue(point.smoothedReturnRate ?? point.rawReturnRate ?? 0),
    }))
    .filter((point) => point.key || point.label);
  const forecastPoints = (Array.isArray(prediction?.forecastPoints) ? prediction.forecastPoints : [])
    .map((point) => ({
      kind: "forecast",
      key: String(point.key || point.startAt || point.label || ""),
      label: String(point.label || point.key || ""),
      startAt: point.startAt || null,
      predictedReturnRate: clampPercentValue(point.predictedReturnRate || 0),
      basePredictedReturnRate: clampPercentValue(point.basePredictedReturnRate ?? point.predictedReturnRate ?? 0),
      baselineReturnRate: clampPercentValue(point.baselineReturnRate || 0),
      seasonalReturnRate: clampPercentValue(point.seasonalReturnRate || 0),
    }))
    .filter((point) => point.key || point.label);
  const summary = prediction?.summary || {};

  return {
    source: prediction?.source || "",
    granularity: prediction?.granularity || "weekly",
    windowDays: Number(prediction?.windowDays || 0),
    generatedAt: prediction?.generatedAt || null,
    observedPoints,
    forecastPoints,
    summary: {
      totalOrders: Number(summary.totalOrders || 0),
      totalReturnedOrders: Number(summary.totalReturnedOrders || 0),
      totalOrderUnits: Number(summary.totalOrderUnits || 0),
      totalReturnedUnits: Number(summary.totalReturnedUnits || 0),
      totalReturnRate: clampPercentValue(summary.totalReturnRate || 0),
      last30DayReturnRate: clampPercentValue(summary.last30DayReturnRate || 0),
      last60DayReturnRate: clampPercentValue(summary.last60DayReturnRate || 0),
      forecastNext90ReturnRate: clampPercentValue(summary.forecastNext90ReturnRate || 0),
      confidence: summary.confidence || "Unavailable",
    },
    actionAdjustment: prediction?.actionAdjustment || null,
    model: prediction?.model || null,
  };
}

function hasProductMonthlyOrderActivity(activity = null) {
  const summary = activity?.summary || {};
  const months = Array.isArray(activity?.months) ? activity.months : [];
  return Boolean(
    Number(summary.totalOrders || 0) > 0
      || Number(summary.totalOrderUnits || 0) > 0
      || Number(summary.totalRevenue || 0) > 0
      || months.some((month) => Number(month.orders || 0) > 0 || Number(month.orderUnits || 0) > 0 || Number(month.revenue || 0) > 0),
  );
}

function hasProductReturnRatePrediction(prediction = null) {
  const summary = prediction?.summary || {};
  const observedPoints = Array.isArray(prediction?.observedPoints) ? prediction.observedPoints : [];
  const hasOrders = Number(summary.totalOrders || 0) > 0
    || Number(summary.totalOrderUnits || 0) > 0
    || observedPoints.some((point) => Number(point.orders || 0) > 0 || Number(point.orderUnits || 0) > 0);
  const hasReturns = Number(summary.totalReturnedOrders || 0) > 0
    || Number(summary.totalReturnedUnits || 0) > 0
    || observedPoints.some((point) => Number(point.returnedOrders || 0) > 0 || Number(point.returnedUnits || 0) > 0);
  return hasOrders && hasReturns;
}

function normalizeProductMomentum(momentum = null) {
  if (!momentum || typeof momentum !== "object") return null;
  const components = momentum.components || {};
  const inputs = momentum.inputs || {};
  const catalog = momentum.catalog || {};
  const display = momentum.display || {};
  const score = Number(momentum.score ?? 0);

  return {
    source: momentum.source || "",
    score: Number.isFinite(score) ? Math.round(score) : 0,
    tier: momentum.tier || getMomentumTierFromScore(score),
    direction: momentum.direction || "Steady",
    confidence: Number(momentum.confidence || 0),
    confidenceLabel: momentum.confidenceLabel || getMomentumConfidenceLabel(Number(momentum.confidence || 0)),
    calculatedAt: momentum.calculatedAt || null,
    windowDays: Number(momentum.windowDays || 0),
    baselineDays: Number(momentum.baselineDays || 0),
    components: {
      currentVelocityScore: Number(components.currentVelocityScore || 0),
      growthScore: Number(components.growthScore || 0),
      catalogShareScore: Number(components.catalogShareScore || 0),
      trendConsistencyScore: Number(components.trendConsistencyScore || 0),
      recencyScore: Number(components.recencyScore || 0),
    },
    inputs: {
      unitsLast7Days: Number(inputs.unitsLast7Days || 0),
      unitsLast14Days: Number(inputs.unitsLast14Days || 0),
      unitsLast30Days: Number(inputs.unitsLast30Days || 0),
      unitsPrevious30Days: Number(inputs.unitsPrevious30Days || 0),
      unitsPrevious90Days: Number(inputs.unitsPrevious90Days || 0),
      revenueLast30Days: Number(inputs.revenueLast30Days || 0),
      revenuePrevious30Days: Number(inputs.revenuePrevious30Days || 0),
      revenuePrevious90Days: Number(inputs.revenuePrevious90Days || 0),
      ordersLast30Days: Number(inputs.ordersLast30Days || 0),
      weeklyUnitsLast4Weeks: Array.isArray(inputs.weeklyUnitsLast4Weeks) ? inputs.weeklyUnitsLast4Weeks.map((value) => Number(value || 0)) : [],
      weeklyRevenueLast4Weeks: Array.isArray(inputs.weeklyRevenueLast4Weeks) ? inputs.weeklyRevenueLast4Weeks.map((value) => Number(value || 0)) : [],
      lastSaleAt: inputs.lastSaleAt || null,
    },
    catalog: {
      unitsVelocityScore: Number(catalog.unitsVelocityScore || 0),
      revenueVelocityScore: Number(catalog.revenueVelocityScore || 0),
      productShareLast30: Number(catalog.productShareLast30 || 0),
      productShareBaseline: Number(catalog.productShareBaseline || 0),
      shareLiftRatio: Number(catalog.shareLiftRatio || 0),
      topCatalogPercent: catalog.topCatalogPercent == null ? null : Number(catalog.topCatalogPercent),
      catalogProductCount: Number(catalog.catalogProductCount || 0),
      hasCatalogBaseline: Boolean(catalog.hasCatalogBaseline),
    },
    display: {
      growthPercent: Number(display.growthPercent || 0),
      growthLabel: display.growthLabel || formatSignedPercent(Number(display.growthPercent || 0)),
      catalogPositionLabel: display.catalogPositionLabel || (catalog.topCatalogPercent ? `Top ${catalog.topCatalogPercent}%` : "Catalog baseline pending"),
      trendLabel: display.trendLabel || "Sales trend unavailable",
      recommendedUse: display.recommendedUse || "Run deep diagnosis again after new sales.",
    },
    flags: momentum.flags || {},
  };
}

function getMomentumTierFromScore(score) {
  const value = Number(score || 0);
  if (value >= 80) return "Hot";
  if (value >= 60) return "Rising";
  if (value >= 40) return "Stable";
  if (value >= 20) return "Cooling";
  return "Low activity";
}

function getProductMomentumTone(momentum = {}) {
  const tier = String(momentum.tier || "").toLowerCase();
  if (tier.includes("hot")) return "blue";
  if (tier.includes("rising")) return "green";
  if (tier.includes("cooling")) return "orange";
  if (tier.includes("low")) return "neutral";
  return "blue";
}

function getMomentumConfidenceLabel(confidence) {
  const value = Number(confidence || 0);
  if (value >= 80) return "High confidence";
  if (value >= 60) return "Medium confidence";
  if (value >= 40) return "Low confidence";
  return "Very low confidence";
}

function getFinancialExposureFootnote(detail = {}) {
  const range = detail.impactRange || {};
  const low = Number(range.low || 0);
  const high = Number(range.high || 0);
  if (low > 0 && high > 0 && high > low) {
    return `Likely range ${formatMoney(low)} - ${formatMoney(high)}`;
  }
  return `${detail.returnRate}% return rate`;
}

function getFinancialExposureRangeLabel(detail = {}) {
  const range = detail.impactRange || {};
  const low = Number(range.low || 0);
  const high = Number(range.high || 0);
  if (low > 0 && high > 0 && high > low) {
    return `${formatMoney(low)} - ${formatMoney(high)}`;
  }
  return "No range available";
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

function getMostRecentProductDateValue(product, extraValues = []) {
  const metrics = product?.metrics || {};
  const candidates = [
    ...extraValues,
    product?.lastAnalysis,
    product?.analysisCompletedAt,
    metrics.latestDiagnosisAt,
    metrics.lastDiagnosisAt,
    metrics.lastAnalyzedAt,
    metrics.lastSignalAt,
  ];

  return candidates.reduce((latest, value) => {
    if (!value || value === "Not analyzed") return latest;
    const date = value instanceof Date
      ? value
      : new Date(String(value).includes("T") ? value : `${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return latest;
    if (!latest || date.getTime() > latest.date.getTime()) return { value, date };
    return latest;
  }, null)?.value || null;
}

function detailEvidenceFreshness(product, extraValues = []) {
  const value = getMostRecentProductDateValue(product, extraValues);
  return value ? formatProductAnalysisDate(value) : detailLastAnalysis(product);
}

function getBadgeToneFromRiskTone(tone) {
  if (tone === "critical") return "critical";
  if (tone === "success") return "success";
  return "warning";
}

function getBadgeToneFromTrendTone(tone) {
  if (tone === "red") return "critical";
  if (tone === "green") return "success";
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

function getProductRiskTrendValues(product = {}) {
  const rowValues = (Array.isArray(product.riskTrend) ? product.riskTrend : [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (rowValues.length >= 2) return rowValues;
  const historyValues = (Array.isArray(product.metrics?.riskHistory) ? product.metrics.riskHistory : [])
    .map((entry) => Number(entry?.riskScore))
    .filter((value) => Number.isFinite(value));
  if (historyValues.length >= 2) return historyValues;
  return (Array.isArray(product.metrics?.riskTrend) ? product.metrics.riskTrend : [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function getProductRiskTrendState(values = []) {
  const trendValues = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (trendValues.length < 2) return "level";
  const first = trendValues[0];
  const last = trendValues[trendValues.length - 1];
  const change = last - first;
  if (change <= -5) return "improving";
  if (change >= 5) return "rising";
  return "stable";
}

function getProductRiskDisplay(score, trendValues = [], riskTone = "info", hasRiskSnapshot = true) {
  if (!hasRiskSnapshot) return { label: "Not scanned", trendLabel: "No saved trend", tone: "blue" };
  const trendState = getProductRiskTrendState(trendValues);
  const trendLabel = trendState === "improving"
    ? "Improving"
    : trendState === "rising"
      ? "Rising"
      : trendState === "stable"
        ? "Stable"
        : "No saved trend";
  return {
    label: getProductRiskScoreLabel(score),
    trendLabel,
    tone: getProductInsightTone(riskTone),
  };
}

function getProductRiskTableTrendLabel(values = []) {
  const trendState = getProductRiskTrendState(values);
  if (trendState === "improving") return "Falling";
  if (trendState === "rising") return "Rising";
  return "Stable";
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

  const groups = new Map();

  product.evidence.forEach((item) => {
    const title = getCanonicalEvidenceSourceTitle(item.source);
    const points = getEvidencePoints(item, product);
    const persistedPoints = getStoredEvidencePoints(item);
    const current = groups.get(title) || {
      title,
      points: [],
      persistedPoints: [],
      persistedRecords: [],
      sourceTitles: [],
    };

    current.sourceTitles.push(item.source);
    points.forEach((point) => {
      if (point && !current.points.includes(point)) current.points.push(point);
    });
    persistedPoints.forEach((point) => {
      if (point && !current.persistedPoints.includes(point)) current.persistedPoints.push(point);
    });
    getStoredEvidenceRecords(item).forEach((record) => {
      if (record.body && !current.persistedRecords.some((stored) => stableEvidenceRecordKey(stored) === stableEvidenceRecordKey(record))) {
        current.persistedRecords.push(record);
      }
    });
    groups.set(title, current);
  });

  return [...groups.values()]
    .map((group) => ({
      icon: getEvidenceIcon(group.title),
      title: group.title,
      summary: getEvidenceSourceSummary(group.title, group.points, product),
      tone: getEvidenceSourceTone(group.title, group.points),
      cards: getEvidenceSourceCards(group.title, group.points, product),
      points: group.points,
      persistedPoints: group.persistedPoints,
      persistedRecords: group.persistedRecords,
      priority: getEvidenceSourcePriority(group.title),
      sourceTitles: group.sourceTitles,
    }))
    .sort((first, second) => first.priority - second.priority);
}

function getCanonicalEvidenceSourceTitle(source = "") {
  const normalized = String(source || "").toLowerCase().trim();
  if (normalized === "shopify product" || normalized === "product content" || normalized === "variants") {
    return "Shopify product";
  }
  return String(source || "Evidence source");
}

function getEvidenceSourceSummary(source, points = [], product = {}) {
  const normalized = String(source || "").toLowerCase();
  const metrics = product.metrics || {};
  const firstPoint = points.find(Boolean) || "No stored details yet.";

  if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) {
    return "Customer language is being interpreted as diagnostic evidence, including sentiment, emotion taxonomy and recurring phrases.";
  }
  if (normalized.includes("return")) {
    return `Return behavior is contributing to the product risk model${metrics.returnRate ? ` with a ${metrics.returnRate}% return rate` : ""}.`;
  }
  if (normalized.includes("refund")) {
    return `Refund pressure is tracked separately from returns to highlight financial impact${metrics.refundAmount ? ` (${formatMoney(metrics.refundAmount)})` : ""}.`;
  }
  if (normalized.includes("review") || normalized.includes("judge")) {
    return "Review evidence connects rating pressure, negative language and customer-reported expectations to the diagnosis.";
  }
  if (normalized.includes("order") || normalized.includes("sales")) {
    return "Order data establishes baseline sold units, sales velocity and demand context for the diagnosis.";
  }
  if (normalized.includes("variant")) {
    return "Variant evidence shows whether signals concentrate in a specific SKU, size, color or option.";
  }
  if (normalized.includes("product") || normalized.includes("shopify")) {
    return "Shopify product metadata is used as baseline context for content quality, variants, tags and merchandising structure.";
  }
  return firstPoint;
}

function getEvidenceSourceTone(source, points = []) {
  const normalized = `${source || ""} ${points.join(" ")}`.toLowerCase();
  if (normalized.includes("negative") || normalized.includes("refund") || normalized.includes("return") || normalized.includes("high risk")) return "critical";
  if (normalized.includes("emotion") || normalized.includes("sentiment") || normalized.includes("ai ")) return "insight";
  if (normalized.includes("positive") || normalized.includes("healthy")) return "success";
  return "neutral";
}

function getStoredEvidencePoints(item = {}) {
  return getStoredEvidenceRecords(item).map(formatStoredEvidenceRecordPoint).filter(Boolean);
}

function getStoredEvidenceRecords(item = {}) {
  const values = [
    item.quote,
    item.summary,
    item.body,
    ...(Array.isArray(item.points) ? item.points : []),
    ...(Array.isArray(item.details) ? item.details : []),
  ];
  return values
    .map((value) => formatStoredEvidenceRecord(value))
    .filter((record) => record.body);
}

function formatStoredEvidenceRecord(value) {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = parseEvidencePoint(value);
    return { title: parsed.label, body: parsed.body, tone: parsed.tone };
  }
  if (!value || typeof value !== "object") return { body: "" };
  const label = value.title || value.label || value.section || value.sectionKey || value.section_key || value.key || "";
  const body = value.body || value.text || value.summary || value.detail || value.value || "";
  const normalizedBody = String(body || "").trim();
  if (!normalizedBody) return { body: "" };
  return {
    title: String(label || "").trim(),
    body: normalizedBody,
    sectionKey: value.sectionKey || value.section_key || value.key || "",
    sourceTitle: value.sourceTitle || value.source_title || value.source || value.providerTitle || value.provider_title || "",
    sourceKey: value.sourceKey || value.source_key || value.providerKey || value.provider_key || "",
  };
}

function formatStoredEvidenceRecordPoint(record = {}) {
  return record.title ? `${record.title}: ${record.body}` : record.body;
}

function stableEvidenceRecordKey(record = {}) {
  return [
    record.title,
    record.body,
    record.sectionKey,
    record.sourceTitle,
    record.sourceKey,
  ].map((value) => String(value || "").toLowerCase().trim()).join("|");
}

function getEvidencePoints(item, product) {
  const metrics = product.metrics || {};
  const textInsights = metrics.textInsights || {};
  const normalized = String(item.source || "").toLowerCase();
  const points = [
    ...getStoredEvidencePoints(item),
    item.weight,
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
  if (normalized.includes("ai evidence synthesis")) return -1;
  if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) return 0;
  if (normalized.includes("return")) return 1;
  if (normalized.includes("review") || normalized.includes("judge")) return 2;
  if (normalized.includes("refund")) return 3;
  if (normalized.includes("product") || normalized.includes("content")) return 4;
  if (normalized.includes("order") || normalized.includes("sales")) return 5;
  if (normalized.includes("variant")) return 6;
  if (normalized.includes("shopify")) return 7;
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

function getEvidenceEmotionPolarity(item = {}) {
  const explicit = String(item.polarity || "").toLowerCase();
  if (["positive", "neutral", "negative"].includes(explicit)) return explicit;
  const code = String(item.code || item.normalizedLabel || item.label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (["satisfaction", "trust", "relief", "delight"].includes(code)) return "positive";
  if (["uncertainty", "indifference"].includes(code)) return "neutral";
  if (!code || code.includes("none")) return "neutral";
  return "negative";
}

function getEvidenceIcon(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("ai evidence") || normalized.includes("ai synthesis")) return "ai-evidence-synthesis";
  if (normalized.includes("customer") || normalized.includes("language") || normalized.includes("sentiment")) return "customer-language-analysis";
  if (normalized.includes("csv") || (normalized.includes("review") && !normalized.includes("judge") && !normalized.includes("judgeme"))) return "csv-reviews";
  if (normalized.includes("refund")) return "shopify-refunds";
  if (normalized.includes("return")) return "shopify-returns";
  if (normalized.includes("order") || normalized.includes("sales")) return "shopify-orders";
  if (normalized.includes("variant")) return "variants";
  if (normalized.includes("product") || normalized.includes("shopify") || normalized.includes("content") || normalized.includes("description")) return "shopify-product";
  if (normalized.includes("review")) return "star";
  if (normalized.includes("support")) return "question-circle";
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
  const ignoredIssues = getIgnoredIssueRecords(product);
  const filteredActions = product.recommendedActions.filter((action) => !isRecommendedActionRelatedToIgnoredIssues(action, ignoredIssues, product));
  const normalizedActions = consolidateDescriptionRecommendedActions(consolidateReviewRecommendedActions(filteredActions), product);
  const rankedActions = rankRecommendedActionsForDisplay(normalizedActions, product);

  return rankedActions.map((action, index) => ({
    id: action.id,
    label: action.label,
    type: action.type,
    status: action.status,
    effort: action.effort,
    icon: getActionIcon(`${action.id || ""} ${action.type || ""} ${action.label || ""}`),
    iconSymbol: getActionIconSymbol(`${action.id || ""} ${action.type || ""} ${action.label || ""}`),
    title: getRecommendedActionTitle(action, product),
    detail: getRecommendedActionDetail(action),
    reason: getRecommendedActionReason(action, product),
    evidence: getRecommendedActionEvidence(action, product),
    priority: index === 0 ? "Primary next step" : getRecommendedActionPriority(action, product),
    application: getRecommendedActionApplication(action, product),
    meta: getRecommendedActionMeta(action),
    action: getRecommendedActionButtonLabel(action, index),
    mode: getRecommendedActionMode(action, index),
    payload: action.payload || {},
    appliedRecord: getRecommendedActionHistoryRecord(action, actionHistory),
    submit: getRecommendedActionMode(action, index) === "submit",
  }));
}

function rankRecommendedActionsForDisplay(actions = [], product = {}) {
  return (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({
      action,
      index,
      score: getRecommendedActionDisplayScore(action, product),
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map((item) => item.action);
}

function getRecommendedActionDisplayScore(action = {}, product = {}) {
  const payload = action.payload || {};
  const application = getRecommendedActionApplication(action, product);
  const mode = getRecommendedActionMode(action, 0);
  const actionKind = getRecommendedActionKind(mode, application);
  const impact = getActionRankingImpact(action);
  const confidence = getActionRankingConfidence(action, product);
  const applyRisk = getActionRankingApplyRisk(action, application);
  const effort = getActionRankingEffort(action);
  const visibility = getActionRankingVisibility(action);
  const evidenceStrength = getActionRankingEvidenceStrength(action, product);
  const tier = getActionRankingTier(action);
  const reason = getActionRankingReason(action);
  const normalized = getRecommendedActionRankingText(action, application);
  const isCustomerFacing = visibility === "customer";
  const isInternal = visibility === "internal";
  const isOperational = visibility === "operational";
  const isSensitive = isSensitiveRecommendedAction(action, application);
  const affectsReturnsOrReviews = /return|review|sentiment|quality|qa|variant|content|description|pdp|expectation|faq|spec|sizing|fit/.test(`${reason} ${normalized}`);
  const lowRiskHighImpact = impact === "high" && applyRisk === "low";
  const lowEffortHighImpact = impact === "high" && (effort === "low" || effort === "medium");
  const idealPrimary = isCustomerFacing && lowRiskHighImpact && evidenceStrength === "strong" && lowEffortHighImpact;
  const sourceIntegrityAction = /source.*mismatch|source integrity|review feed integrity|feed mismatch/.test(normalized);
  const productSourceIntegrity = /source integrity|review feed|feed mismatch|metadata mismatch|review mismatch|wrong product|wrong sku/.test([
    product.primaryIssue,
    product.metrics?.primaryIssue,
    ...(Array.isArray(product.metrics?.contentAnalysis?.issues) ? product.metrics.contentAnalysis.issues : []).map((issue) => `${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`),
  ].join(" ").toLowerCase());
  const refundOperationalAction = /supplier|qa/.test(normalized)
    && Number(product.metrics?.refundUnits || 0) >= 3
    && Number(product.metrics?.refundRate || 0) >= 20;
  const broadVariantAction = /variant|option|sku/.test(normalized) && !hasStrongDisplayedVariantConcentration(product.metrics || {});
  const refundOnlyPricingAction = /price|pricing|compare-at/.test(normalized)
    && Number(product.metrics?.refundUnits || 0) >= 3
    && !/\b(expensive|overpriced|not worth|value|price perception|quality for the price)\b/.test(normalized);

  let score = 0;
  score += { high: 48, medium: 24, optional: 4 }[impact] || 0;
  score += { high: 18, medium: 9, low: -6 }[confidence] || 0;
  score += { low: 20, medium: 6, high: -22 }[applyRisk] || 0;
  score += { low: 12, medium: 6, high: -8 }[effort] || 0;
  score += { strong: 18, moderate: 9, weak: -8, conflicting: 2 }[evidenceStrength] || 0;
  score += tier === 1 ? 12 : tier === 2 ? 2 : -18;
  score += isCustomerFacing ? 24 : isOperational ? 6 : -12;

  if (idealPrimary) score += 22;
  if (lowRiskHighImpact && confidence === "high") score += 16;
  if (lowEffortHighImpact) score += 12;
  if (affectsReturnsOrReviews && impact === "high") score += 10;
  if (/expectation|fit note|quality note|faq|spec|details|correct-product-description|description/.test(normalized)) score += 8;
  if (sourceIntegrityAction) score += 150;
  if (productSourceIntegrity && !sourceIntegrityAction && /description|pdp|expectation|faq|fit|variant|option|price|pricing|compare-at/.test(normalized)) score -= 120;
  if (refundOperationalAction) score += 116;
  if (broadVariantAction) score -= 80;
  if (refundOnlyPricingAction) score -= 70;
  if (/tag|collection|workflow|monitoring|baseline|connect-missing-source|internal note/.test(normalized)) score -= 10;
  if (actionKind === "investigation") score -= 18;
  if (isInternal) score -= 8;
  if (isSensitive) {
    score -= 26;
    if (evidenceStrength !== "strong") score -= 10;
  }
  const approval = normalizeActionRankingValue(payload.approvalLevel || payload.approval);
  if (approval.includes("strong") || approval.includes("manual approval")) score -= 8;

  return score;
}

function hasStrongDisplayedVariantConcentration(metrics = {}) {
  const variantCount = Number(metrics.variantCount || 0);
  const details = Array.isArray(metrics.affectedVariantDetails) ? metrics.affectedVariantDetails : [];
  if (!details.length) return false;
  const counts = details.map((item) => Number(item.count || 0)).filter((count) => count > 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const strongest = Math.max(0, ...counts);
  if (strongest < 3 || total < 4) return false;
  const affectedCount = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : details.length;
  const ratio = strongest / Math.max(total, 1);
  if (variantCount > 1 && affectedCount >= variantCount && ratio < 0.85) return false;
  return ratio >= 0.65;
}

function getRecommendedActionRankingText(action = {}, application = {}) {
  const payload = action.payload || {};
  return [
    action.id,
    action.type,
    action.label,
    action.title,
    payload.shopifyField,
    payload.reasonCategory,
    payload.expectedBenefit,
    payload.proposedChange,
    payload.trigger,
    application.target,
    application.operation,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
}

function getActionRankingImpact(action = {}) {
  const payload = action.payload || {};
  const explicit = normalizeActionRankingValue(payload.impact || payload.impactLevel);
  if (explicit.includes("high")) return "high";
  if (explicit.includes("medium")) return "medium";
  if (explicit.includes("optional")) return "optional";
  const normalized = getRecommendedActionRankingText(action);
  if (/expectation|description|pdp|faq|spec|details|variant|qa|supplier|source.*mismatch|status|draft|archive|inventory|price|compare-at/.test(normalized)) return "high";
  if (/seo|meta|title|handle|media|image|alt text|classification|category|vendor|product type|template|watchlist|diagnosis/.test(normalized)) return "medium";
  return "optional";
}

function getActionRankingConfidence(action = {}, product = {}) {
  const explicit = normalizeActionRankingValue(action.payload?.confidence);
  if (explicit.includes("high")) return "high";
  if (explicit.includes("medium")) return "medium";
  if (explicit.includes("low")) return "low";
  const confidence = Number(product.confidence || product.metrics?.confidence || 0);
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

function getActionRankingApplyRisk(action = {}, application = {}) {
  const explicit = normalizeActionRankingValue(action.payload?.applicationRisk || application.applicationRisk);
  if (explicit.includes("high")) return "high";
  if (explicit.includes("medium")) return "medium";
  if (explicit.includes("low")) return "low";
  return isSensitiveRecommendedAction(action, application) ? "high" : "low";
}

function getActionRankingEffort(action = {}) {
  const explicit = normalizeActionRankingValue(action.effort || action.payload?.effort);
  if (explicit.includes("high")) return "high";
  if (explicit.includes("medium")) return "medium";
  if (explicit.includes("low")) return "low";
  return "low";
}

function getActionRankingVisibility(action = {}) {
  const explicit = normalizeActionRankingValue(action.payload?.visibility);
  if (explicit.includes("customer")) return "customer";
  if (explicit.includes("operational")) return "operational";
  if (explicit.includes("internal")) return "internal";
  const inferred = normalizeActionRankingValue(inferActionVisibility(action));
  if (inferred.includes("customer")) return "customer";
  if (inferred.includes("operational")) return "operational";
  return "internal";
}

function getActionRankingEvidenceStrength(action = {}, product = {}) {
  const explicit = normalizeActionRankingValue(action.payload?.evidenceStrength);
  if (explicit.includes("conflicting")) return "conflicting";
  if (explicit.includes("strong")) return "strong";
  if (explicit.includes("moderate")) return "moderate";
  if (explicit.includes("weak")) return "weak";
  const inferred = normalizeActionRankingValue(inferActionEvidenceStrength(action));
  if (inferred.includes("conflicting")) return "conflicting";
  if (inferred.includes("strong")) return "strong";
  if (inferred.includes("moderate")) return "moderate";
  if (inferred.includes("weak")) return "weak";
  const payload = action.payload || {};
  const metrics = product.metrics || {};
  const signalCount = [
    Number(payload.returnUnits || metrics.returnUnits || 0),
    Number(payload.negativeReviewCount || metrics.negativeReviewCount || 0),
    Number(payload.signalsCount || metrics.signalCount || 0),
    Array.isArray(payload.topReturnReasons) ? payload.topReturnReasons.length : 0,
    Array.isArray(payload.contentIssues) ? payload.contentIssues.length : 0,
    Array.isArray(payload.affectedVariants) ? payload.affectedVariants.length : 0,
    Array.isArray(payload.reviewSections) ? payload.reviewSections.reduce((sum, section) => sum + Number(section.count || section.items?.length || 0), 0) : 0,
  ].reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const sourceCount = Array.isArray(product.sourceCoverage) ? product.sourceCoverage.length : Array.isArray(metrics.sourceCoverage) ? metrics.sourceCoverage.length : 0;
  if (signalCount >= 10 && sourceCount >= 3) return "strong";
  if (signalCount >= 5 || sourceCount >= 2) return "moderate";
  return "weak";
}

function getActionRankingTier(action = {}) {
  const explicit = Number(action.payload?.actionTier || action.actionTier || 0);
  if ([1, 2, 3].includes(explicit)) return explicit;
  const impact = getActionRankingImpact(action);
  const visibility = getActionRankingVisibility(action);
  if (impact === "high" && visibility !== "internal") return 1;
  if (impact === "medium") return 2;
  return 3;
}

function getActionRankingReason(action = {}) {
  return normalizeActionRankingValue(action.payload?.reasonCategory || inferActionReasonCategory(action));
}

function normalizeActionRankingValue(value = "") {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function isSensitiveRecommendedAction(action = {}, application = {}) {
  const normalized = getRecommendedActionRankingText(action, application);
  return /\b(price|compare-at|inventory|status|archive|draft|unlisted|pause affected|reduce availability|stop selling)\b/.test(normalized);
}

function getRecommendedActionHistoryRecord(action = {}, actionHistory = []) {
  const records = (Array.isArray(actionHistory) ? actionHistory : [])
    .filter((record) => !isSystemRecommendedActionRecord(record))
    .sort((first, second) => getRecommendedActionRecordTime(second) - getRecommendedActionRecordTime(first));
  const actionKeys = getRecommendedActionMatchKeys(action);
  const hasPreciseIdentity = hasPreciseRecommendedActionIdentity(action);
  const exactRecord = records.find((record) => intersectsActionKeys(actionKeys, getStoredRecommendedActionMatchKeys(record)));
  if (exactRecord) return getArchivedActionStateFromRecordStatus(exactRecord.status) ? exactRecord : null;
  if (hasPreciseIdentity) return null;

  const actionFamily = getRecommendedActionPersistenceFamily(action);
  if (!actionFamily) return null;
  if (!shouldUseRecommendedActionFamilyFallback(actionFamily)) return null;
  const familyRecord = records.find((record) => (
    getRecommendedActionPersistenceFamily(record) === actionFamily
  ));
  return familyRecord && getArchivedActionStateFromRecordStatus(familyRecord.status) ? familyRecord : null;
}

function getRecommendedActionRecordTime(record = {}) {
  return new Date(record.appliedAt || record.createdAt || 0).getTime();
}

function isSystemRecommendedActionRecord(record = {}) {
  const actionId = String(record.actionId || record.actionType || record.id || "").toLowerCase();
  return ["mark-resolved", "mark-unresolved", "ignore-issue", "unignore-issue", "run-ai-diagnosis"].includes(actionId);
}

function getRecommendedActionMatchKeys(action = {}) {
  const payload = action.payload || {};
  const identityKeys = getPreciseRecommendedActionIdentityValues(action, payload)
    .map(normalizeRecommendedActionMatchKey)
    .filter(Boolean);
  if (identityKeys.length) return new Set(identityKeys);

  return new Set([
    action.label,
    action.title,
  ].map(normalizeRecommendedActionMatchKey).filter(Boolean));
}

function hasPreciseRecommendedActionIdentity(action = {}) {
  const payload = action.payload || {};
  return getPreciseRecommendedActionIdentityValues(action, payload)
    .map(normalizeRecommendedActionMatchKey)
    .filter(Boolean)
    .length > 0;
}

function getPreciseRecommendedActionIdentityValues(action = {}, payload = {}) {
  return [
    action.id,
    action.actionId,
    action.actionType,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...getPreciseStoredRecommendedActionAliases(payload.actionAliases),
    ...getPreciseStoredRecommendedActionAliases(action.actionAliases),
  ];
}

function getStoredRecommendedActionMatchKeys(record = {}) {
  const payload = record.payload || {};
  const identityKeys = [
    record.actionId,
    record.actionType,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...getPreciseStoredRecommendedActionAliases(payload.actionAliases),
    ...getPreciseStoredRecommendedActionAliases(record.actionAliases),
  ].map(normalizeRecommendedActionMatchKey).filter(Boolean);
  if (identityKeys.length) return new Set(identityKeys);

  return new Set([
    record.label,
    record.id,
  ].map(normalizeRecommendedActionMatchKey).filter(Boolean));
}

function intersectsActionKeys(firstKeys, secondKeys) {
  if (!firstKeys?.size || !secondKeys?.size) return false;
  return [...firstKeys].some((key) => secondKeys.has(key));
}

function normalizeRecommendedActionMatchKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const BROAD_STORED_RECOMMENDED_ACTION_ALIASES = new Set([
  "product-description-changes",
  "review-product-evidence",
  "product-evidence",
  "product-faq",
  "create-product-faq",
  "title-metadata",
  "product-metadata",
  "variant-options",
  "workflow-tag",
  "media-alt-text",
  "commercial-control",
]);

function getPreciseStoredRecommendedActionAliases(aliases = []) {
  return (Array.isArray(aliases) ? aliases : [])
    .filter((alias) => !BROAD_STORED_RECOMMENDED_ACTION_ALIASES.has(normalizeRecommendedActionMatchKey(alias)));
}

function shouldUseRecommendedActionFamilyFallback(family = "") {
  return ["product-description", "product-evidence"].includes(family);
}

function getRecommendedActionPersistenceFamily(action = {}) {
  const payload = action.payload || {};
  const normalized = normalizeActionMatchText([action.id, action.actionId, action.actionType, action.label, action.title, action.type, payload]);
  if (action.id === "product-description-changes" || action.actionId === "product-description-changes" || payload.descriptionChangeGroup || isDescriptionChangeAction(action)) return "product-description";
  if (action.id === "review-product-evidence" || action.actionId === "review-product-evidence" || Array.isArray(payload.reviewSections) || /\b(evidence|inspect|verify|investigation|review)\b/.test(normalized)) return "product-evidence";
  if (isFaqRecommendedAction(action)) return "product-faq";
  if (payload.draftTitle || /\b(title|seo|metadata|meta description)\b/.test(normalized)) return "product-metadata";
  if (payload.productStatus || /\b(status|draft|archive|unlisted)\b/.test(normalized)) return "product-status";
  if (payload.tag || Array.isArray(payload.tags) || /\b(tag|collection)\b/.test(normalized)) return "product-workflow";
  if (Array.isArray(payload.mediaUpdates) || /\b(image|media|alt text)\b/.test(normalized)) return "product-media";
  if (/\b(variant|option|sku)\b/.test(normalized)) return "product-variant";
  return "";
}

function getIgnoredIssueRecords(product = {}) {
  const actionHistory = Array.isArray(product.actionHistory) ? product.actionHistory : [];
  const issueStates = new Map();
  actionHistory
    .filter((record) => isIgnoredIssueRecord(record) || isUnignoredIssueRecord(record))
    .sort((first, second) => {
      const firstTime = new Date(first.appliedAt || first.createdAt || 0).getTime();
      const secondTime = new Date(second.appliedAt || second.createdAt || 0).getTime();
      return firstTime - secondTime;
    })
    .forEach((record) => {
      const payload = record.payload || {};
      const issue = String(payload.issue || record.label || "").replace(/^(Ignore|Restore) issue:\s*/i, "").trim();
      const issueCode = String(payload.issueCode || "").trim();
      const issueKey = normalizeIssueIgnoreKey(payload.issueKey || issueCode || issue);
      if (!issueKey) return;
      issueStates.set(issueKey, {
        id: record.id || issueKey,
        issue,
        issueCode,
        issueKey,
        suggestedAction: payload.suggestedAction || "",
        createdAt: record.appliedAt || record.createdAt || payload.ignoredAt || "",
        ignored: isIgnoredIssueRecord(record),
      });
    });

  return [...issueStates.values()]
    .filter((record) => record.ignored)
    .filter((record) => record.issueKey);
}

function isIgnoredIssueRecord(record = {}) {
  return record.actionId === "ignore-issue" && (record.status === "ignored" || record.status === "applied");
}

function isUnignoredIssueRecord(record = {}) {
  return record.actionId === "unignore-issue" && record.status === "applied";
}

function normalizeIssueIgnoreKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function buildIssueIgnorePayload(issue = {}) {
  const issueName = String(issue.issue || issue.label || "").trim();
  const issueCode = String(issue.issueCode || "").trim();
  const issueKey = normalizeIssueIgnoreKey(issueCode || issueName);
  return {
    issue: issueName,
    issueCode,
    issueKey,
    suggestedAction: String(issue.action || "").trim(),
  };
}

function isIssueIgnored(issue = {}, ignoredIssueKeys = new Set()) {
  const payload = buildIssueIgnorePayload(issue);
  return ignoredIssueKeys.has(payload.issueKey) || ignoredIssueKeys.has(normalizeIssueIgnoreKey(payload.issue));
}

function isRecommendedActionRelatedToIgnoredIssues(action = {}, ignoredIssues = [], product = {}) {
  return ignoredIssues.some((issue) => isRecommendedActionRelatedToIssue(action, issue, product));
}

function isRecommendedActionRelatedToIssue(action = {}, issue = {}, product = {}) {
  const actionText = normalizeActionMatchText([
    action.id,
    action.label,
    action.title,
    action.type,
    action.status,
    action.payload,
  ]);
  const issueText = normalizeActionMatchText([issue.issue, issue.issueCode, issue.suggestedAction]);
  const issueKey = normalizeIssueIgnoreKey(issue.issueKey || issue.issueCode || issue.issue);
  const issueFamily = getIgnoredIssueFamily(issueText);
  const actionFamily = getRecommendedActionFamily(action, product);

  if (issueKey && actionText.includes(issueKey)) return true;
  if (issueText && actionText.includes(issueText) && issueText.length >= 8) return true;
  if (issue.suggestedAction && normalizeActionMatchText(action.label || action.title).includes(normalizeActionMatchText(issue.suggestedAction))) return true;
  if (issueFamily && actionFamily === issueFamily) return true;

  if (issueFamily === "reviews" && ["reviews", "customer-language"].includes(actionFamily)) return true;
  if (issueFamily === "customer-language" && ["reviews", "customer-language"].includes(actionFamily)) return true;
  if (issueFamily === "returns" && ["returns", "customer-language"].includes(actionFamily)) return true;

  const productIssueKey = normalizeIssueIgnoreKey(product.primaryIssue || "");
  if (productIssueKey && issueKey === productIssueKey && isPrimaryIssueRecommendedAction(action)) return true;

  return false;
}

function normalizeActionMatchText(value) {
  const text = Array.isArray(value)
    ? value.map((item) => normalizeActionMatchText(item)).join(" ")
    : typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value || "");
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getIgnoredIssueFamily(issueText = "") {
  const normalized = normalizeActionMatchText(issueText);
  if (/\b(return|returns|returned|returning)\b/.test(normalized)) return "returns";
  if (/\b(refund|refunds|refunded)\b/.test(normalized)) return "refunds";
  if (/\b(review|reviews|judge|rating|ratings|stars?)\b/.test(normalized)) return "reviews";
  if (/\b(sentiment|language|emotion|fear|scare|scary|safety|unsafe|customer text)\b/.test(normalized)) return "customer-language";
  if (/\b(variant|variants|sku|size|color|option)\b/.test(normalized)) return "variants";
  if (/\b(content|description|title|tag|tags|collection|pdp|faq)\b/.test(normalized)) return "content";
  return "";
}

function getRecommendedActionFamily(action = {}, product = {}) {
  const payload = action.payload || {};
  const normalized = normalizeActionMatchText([action.id, action.label, action.title, action.type, payload]);
  if (Array.isArray(payload.reviewSections) && payload.reviewSections.length) return "reviews";
  if (Array.isArray(payload.topReturnReasons) || /\breturn/.test(normalized)) return "returns";
  if (Number(payload.refundUnits || 0) > 0 || Number(payload.refundAmount || 0) > 0 || /\brefund/.test(normalized)) return "refunds";
  if (Number(payload.negativeReviewCount || 0) > 0 || /\b(review|judge|rating)\b/.test(normalized)) return "reviews";
  if (Array.isArray(payload.affectedVariants) || /\b(variant|sku)\b/.test(normalized)) return "variants";
  if (Array.isArray(payload.contentIssues) || Array.isArray(payload.faqItems) || /\b(description|pdp|content|title|tag|collection|faq|fit note)\b/.test(normalized)) return "content";
  if (/\b(note|support)\b/.test(normalized) && product.primaryIssue) return getIgnoredIssueFamily(product.primaryIssue) || "customer-language";
  return "";
}

function isPrimaryIssueRecommendedAction(action = {}) {
  const normalized = normalizeActionMatchText([action.id, action.label, action.title, action.type, action.payload]);
  return /\b(pdp|description|copy|support|note|tag|faq|fit|quality)\b/.test(normalized);
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

function consolidateDescriptionRecommendedActions(actions = [], product = {}) {
  const descriptionActions = actions.filter((action) => isDescriptionChangeAction(action, product));
  if (descriptionActions.length <= 1) return actions;

  const firstDescriptionIndex = actions.findIndex((action) => isDescriptionChangeAction(action, product));
  const descriptionChanges = descriptionActions
    .map((action) => buildDescriptionChangeDescriptor(action, product))
    .filter(Boolean)
    .reduce((changes, change) => mergeEquivalentDescriptionChange(changes, change), [])
    .sort((first, second) => getDescriptionChangeOrder(first.operation) - getDescriptionChangeOrder(second.operation));
  if (!descriptionChanges.length) return actions.filter((action) => !isDescriptionChangeAction(action, product));
  if (descriptionActions.length <= 1 && descriptionChanges.length <= 1) return actions;

  const payloads = descriptionActions.map((action) => action.payload || {});
  const groupMetadata = getDescriptionActionGroupMetadata(descriptionActions, product);
  const groupedAction = {
    id: "product-description-changes",
    label: "Update product description",
    type: "PDP copy",
    effort: getHighestActionEffort(descriptionActions),
    status: "Ready",
    payload: {
      descriptionChangeGroup: true,
      descriptionChanges,
      operation: "replace",
      trigger: "ProductPulse found multiple product-description improvements that should be reviewed together.",
      proposedChange: "Apply selected description changes in one Shopify update.",
      shopifyField: "Product description",
      expectedImpact: "Reduce buyer confusion and keep the final PDP description consistent.",
      shortDescription: mergeRecommendedActionRationales(payloads) || "Apply selected shopper-facing description changes as one consistent PDP update.",
      applicationRisk: "Low",
      approval: "Review required before applying",
      impact: groupMetadata.impact,
      impactLevel: groupMetadata.impactLevel,
      actionTier: groupMetadata.actionTier,
      visibility: "Customer-facing",
      confidence: groupMetadata.confidence,
      evidenceStrength: groupMetadata.evidenceStrength,
      reasonCategory: groupMetadata.reasonCategory,
      expectedBenefit: groupMetadata.expectedBenefit,
      reversibility: "Moderate",
      approvalLevel: "Review required",
      contentIssues: payloads.flatMap((payload) => Array.isArray(payload.contentIssues) ? payload.contentIssues : []),
      whyThisAction: mergeRecommendedActionRationales(payloads),
      topReturnReasons: uniqueStrings(payloads.flatMap((payload) => payload.topReturnReasons || [])),
      returnUnits: payloads.reduce((max, payload) => Math.max(max, Number(payload.returnUnits || 0)), 0),
      returnRate: payloads.reduce((max, payload) => Math.max(max, Number(payload.returnRate || 0)), 0),
      negativeReviewCount: payloads.reduce((max, payload) => Math.max(max, Number(payload.negativeReviewCount || 0)), 0),
      relatedActionLabels: descriptionActions.map((action) => getRecommendedActionTitle(action, product)),
    },
  };
  const withoutDescriptionActions = actions.filter((action) => !isDescriptionChangeAction(action, product));
  return [
    ...withoutDescriptionActions.slice(0, firstDescriptionIndex),
    groupedAction,
    ...withoutDescriptionActions.slice(firstDescriptionIndex),
  ];
}

function getDescriptionActionGroupMetadata(actions = [], product = {}) {
  const payloads = actions.map((action) => action.payload || {});
  const impact = getStrongestCompactValue(payloads.map((payload) => payload.impact || payload.impactLevel), "Medium", ["High", "Medium", "Optional"]);
  const confidence = getStrongestCompactValue(
    payloads.map((payload) => payload.confidence).concat(product.confidence >= 75 ? ["High"] : product.confidence >= 50 ? ["Medium"] : []),
    "Medium",
    ["High", "Medium", "Low"],
  );
  const evidenceStrength = getStrongestCompactValue(payloads.map((payload) => payload.evidenceStrength), inferDescriptionGroupEvidenceStrength(actions, product), ["Strong", "Moderate", "Weak", "Conflicting"]);
  const actionTier = actions.reduce((best, action) => {
    const tier = Number(action.payload?.actionTier || action.actionTier || 0);
    return tier > 0 ? Math.min(best, tier) : best;
  }, impact === "High" ? 1 : 2);

  return {
    impact,
    impactLevel: impact === "Optional" ? "Optional" : `${impact} impact`,
    actionTier,
    confidence,
    evidenceStrength,
    reasonCategory: inferActionReasonCategory(actions[0] || {}),
    expectedBenefit: "Reduce confusion",
  };
}

function getStrongestCompactValue(values = [], fallback = "", orderedValues = []) {
  const normalizedValues = values
    .map((value) => getCompactIndicatorValue(value, ""))
    .filter(Boolean);
  const candidates = normalizedValues.length ? normalizedValues : [fallback].filter(Boolean);
  if (!orderedValues.length) return candidates[0] || fallback || "";
  const lowerOrder = orderedValues.map((value) => value.toLowerCase());
  return candidates
    .sort((first, second) => {
      const firstIndex = lowerOrder.indexOf(String(first).toLowerCase());
      const secondIndex = lowerOrder.indexOf(String(second).toLowerCase());
      return (firstIndex < 0 ? 999 : firstIndex) - (secondIndex < 0 ? 999 : secondIndex);
    })[0] || fallback || "";
}

function inferDescriptionGroupEvidenceStrength(actions = [], product = {}) {
  const payloadSignalCount = actions.reduce((total, action) => {
    const payload = action.payload || {};
    return total
      + Number(payload.returnUnits || 0)
      + Number(payload.negativeReviewCount || 0)
      + (Array.isArray(payload.contentIssues) ? payload.contentIssues.length : 0)
      + (Array.isArray(action.evidence) ? action.evidence.length : 0);
  }, 0);
  const metrics = product.metrics || {};
  const signalCount = Math.max(payloadSignalCount, Number(metrics.signalCount || 0));
  const sourceCount = Array.isArray(product.sourceCoverage) ? product.sourceCoverage.length : Array.isArray(metrics.sourceCoverage) ? metrics.sourceCoverage.length : 0;
  if (signalCount >= 10 && sourceCount >= 3) return "Strong";
  if (signalCount >= 5 || sourceCount >= 2) return "Moderate";
  return "Weak";
}

function mergeRecommendedActionRationales(payloads = []) {
  const rationales = uniqueStrings((Array.isArray(payloads) ? payloads : [])
    .flatMap((payload) => [payload?.whyThisAction, payload?.actionRationale, payload?.rationale])
    .filter(Boolean));
  if (!rationales.length) return "";
  if (rationales.length === 1) return rationales[0];
  return rationales.slice(0, 2).join(" ");
}

function mergeEquivalentDescriptionChange(changes = [], change = {}) {
  const duplicateIndex = changes.findIndex((existing) => areEquivalentDescriptionChanges(existing, change));
  if (duplicateIndex < 0) return [...changes, change];
  const merged = {
    ...changes[duplicateIndex],
    title: chooseDescriptionChangeTitle(changes[duplicateIndex], change),
    reason: mergeDescriptionChangeReasons(changes[duplicateIndex].reason, change.reason),
    relatedTitles: uniqueStrings([
      ...(Array.isArray(changes[duplicateIndex].relatedTitles) ? changes[duplicateIndex].relatedTitles : [changes[duplicateIndex].title]),
      change.title,
    ]),
  };
  return changes.map((item, index) => (index === duplicateIndex ? merged : item));
}

function areEquivalentDescriptionChanges(first = {}, second = {}) {
  if (!first.text || !second.text) return false;
  if (textIncludesMeaning(first.text, second.text)) return true;
  const firstCause = normalizeDescriptionCause(first);
  const secondCause = normalizeDescriptionCause(second);
  return Boolean(firstCause && secondCause && firstCause === secondCause && first.operation === second.operation);
}

function normalizeDescriptionCause(change = {}) {
  return normalizeActionMatchText([
    change.causeKey,
    change.reason,
    change.title,
  ]).split(/\s+/).filter((token) => token.length > 3).slice(0, 18).join(" ");
}

function chooseDescriptionChangeTitle(first = {}, second = {}) {
  const titles = [first.title, second.title].map((value) => String(value || "").trim()).filter(Boolean);
  const preferred = titles.find((title) => /expectation|fit|quality note/i.test(title))
    || titles.find((title) => !/guidance/i.test(title))
    || titles[0];
  return preferred || "Update product description";
}

function mergeDescriptionChangeReasons(first = "", second = "") {
  const reasons = uniqueStrings([first, second]);
  if (reasons.length <= 1) return reasons[0] || "";
  const [primary, secondary] = reasons;
  if (textIncludesMeaning(primary, secondary)) return primary.length >= secondary.length ? primary : secondary;
  return `${primary} Related signal: ${secondary}`;
}

function isDescriptionChangeAction(action = {}) {
  const payload = action.payload || {};
  if (!payload.draftText) return false;
  if (payload.note || payload.draftTitle || payload.productStatus || payload.tag || Array.isArray(payload.tags)) return false;
  if (payload.field && !["description", "descriptionHtml", "body_html"].includes(String(payload.field || "").trim())) return false;
  if (isFaqRecommendedAction(action)) return false;
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""} ${payload.field || ""}`.toLowerCase();
  return normalized.includes("pdp")
    || normalized.includes("description")
    || normalized.includes("fit")
    || ["replace", "prepend", "append"].includes(payload.operation)
    || ["prepend", "append"].includes(payload.placement);
}

function buildDescriptionChangeDescriptor(action = {}, product = {}) {
  const payload = action.payload || {};
  const currentDescription = getCurrentDescriptionForAction(product, payload);
  const operation = getResolvedDescriptionOperationForAction(action, product, currentDescription);
  const text = getDescriptionActionValue({ action, product, operation, currentDescription });
  if (!normalizeActionText(text)) return null;

  return {
    id: action.id || normalizeIssueIgnoreKey(action.label || action.title || operation),
    actionId: action.id || "",
    title: getRecommendedActionTitle(action, product),
    operation,
    operationLabel: getDescriptionOperationText(operation),
    text,
    intro: getDescriptionActionIntro(operation, action),
    reason: getDescriptionChangeSpecificReason(action, product, operation) || getDescriptionActionWhyNarrative(action, product) || getRecommendedActionReason(action, product),
    causeKey: payload.causeKey || "",
  };
}

function getDescriptionChangeSpecificReason(action = {}, product = {}, operation = "") {
  const payload = action.payload || {};
  const metrics = product.metrics || {};
  const normalizedTitle = `${action.id || ""} ${action.label || ""} ${action.title || ""} ${payload.issue || ""}`.toLowerCase();
  const contentIssues = getContentIssueLabels(payload.contentIssues || metrics.contentIssues || metrics.contentAnalysis?.issues);
  const returnReasons = normalizeActionReasonList(payload.topReturnReasons || metrics.topReturnReasonDetails || metrics.topReturnReasons, "return reason");
  const negativeReviews = Number(payload.negativeReviewCount ?? metrics.negativeReviewCount ?? 0);
  const returnUnits = Number(payload.returnUnits ?? metrics.returnUnits ?? 0);
  const focusedIssue = pickDescriptionChangeFocus(contentIssues, normalizedTitle, payload.issue || product.primaryIssue);
  const evidence = buildDescriptionSpecificEvidence({ returnUnits, returnReasons, negativeReviews, focusedIssue });

  if (operation === "prepend") {
    return `This top-of-description note is meant to set expectations before the shopper reads the full PDP. ${evidence || `It focuses on ${focusedIssue || "the main buyer-confusion signal"} so the warning or clarification is visible before purchase.`}`;
  }
  if (operation === "append") {
    return `This appended guidance adds supporting detail without replacing the existing PDP copy. ${evidence || `It fills in ${focusedIssue || "a specific missing detail"} after the main description so shoppers can confirm the product fit before buying.`}`;
  }
  if (operation === "replace") {
    return `This rewrite should only change the core description where the PDP is unclear or incomplete. ${evidence || `It focuses on ${focusedIssue || "the strongest content gap"} while preserving useful existing product information.`}`;
  }
  return evidence ? `This change focuses on one specific PDP gap: ${evidence}` : "";
}

function pickDescriptionChangeFocus(contentIssues = [], normalizedTitle = "", fallback = "") {
  const title = String(normalizedTitle || "").toLowerCase();
  const matchers = [
    { test: /\b(size|fit|dimension|measurement|compatib)/, label: "size, fit or compatibility clarity" },
    { test: /\b(material|quality|finish|durability|leak|waterproof|safety)/, label: "quality, material or durability expectations" },
    { test: /\b(color|visual|image|photo|appearance|aesthetic|mood|dark|dramatic|scale)/, label: "visual expectations" },
    { test: /\b(include|package|content|what.*buy|missing|spec|detail)/, label: "included contents and product specs" },
    { test: /\b(language|region|adapter|charger|manual|locale)/, label: "regional or compatibility guidance" },
  ];
  const direct = matchers.find((matcher) => matcher.test.test(title));
  if (direct) return direct.label;
  const issue = contentIssues.find((item) => {
    const normalized = String(item || "").toLowerCase();
    return matchers.some((matcher) => matcher.test.test(normalized));
  }) || contentIssues[0] || fallback;
  return String(issue || "").replace(/[_-]+/g, " ").toLowerCase();
}

function buildDescriptionSpecificEvidence({ returnUnits = 0, returnReasons = [], negativeReviews = 0, focusedIssue = "" } = {}) {
  const pieces = [];
  if (focusedIssue) pieces.push(`It targets ${focusedIssue}`);
  if (returnUnits > 0) {
    pieces.push(`${formatInteger(returnUnits)} return${returnUnits === 1 ? "" : "s"}${returnReasons.length ? ` mention ${formatQuotedInlineList(returnReasons.slice(0, 2))}` : ""}`);
  }
  if (negativeReviews > 0) {
    pieces.push(`${formatInteger(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"} support the same shopper concern`);
  }
  if (!pieces.length) return "";
  return `${pieces.join(", ")}.`;
}

function getDescriptionChangeOrder(operation = "") {
  if (operation === "replace") return 1;
  if (operation === "prepend") return 2;
  if (operation === "append") return 3;
  return 4;
}

function getHighestActionEffort(actions = []) {
  const order = { high: 3, medium: 2, low: 1 };
  const highest = actions.reduce((current, action) => {
    const normalized = String(action.effort || "Low").toLowerCase();
    return order[normalized] > order[current] ? normalized : current;
  }, "low");
  return highest.charAt(0).toUpperCase() + highest.slice(1);
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
      items: variants.map((variant) => ({ label: variant, evidence: "Affected scope" })),
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
  if (payload.draftTitle) return payload.draftTitle;
  if (Array.isArray(payload.faqItems) && payload.faqItems.length) return formatFaqItemsForDisplay(payload.faqItems);
  if (payload.draftText) return payload.draftText;
  if (payload.note) return payload.note;
  if (payload.mediaGuidance) return payload.mediaGuidance;
  if (payload.qaNote) return payload.qaNote;
  if (payload.productStatus) return `Set Shopify product status to ${payload.productStatus}.`;
  if (Array.isArray(payload.tags) && payload.tags.length) return payload.tags.join(", ");
  if (payload.collectionName) return `Add or move this product to ${payload.collectionName}.`;
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

function getRecommendedActionTitle(action = {}, product = {}) {
  if (shouldTreatDescriptionRewriteAsAppend(action, product)) return "Add text to end of description";
  return action.label || action.title || "Recommended action";
}

function isFaqRecommendedAction(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  return normalized.includes("faq") || Array.isArray(action.payload?.faqItems);
}

function getFaqRecommendedActionApplication(action, product = null, options = {}) {
  const payload = action.payload || {};
  const variants = getFaqApplicationVariants(payload);
  const defaultVariantId = normalizeFaqApplicationVariantId(payload.defaultApplyMode || variants[1]?.id || variants[0]?.id || "description-section");
  const requestedVariantId = normalizeFaqApplicationVariantId(options.variantId || "");
  const variantId = variants.some((variant) => variant.id === requestedVariantId) ? requestedVariantId : defaultVariantId;
  const selectedVariant = variants.find((variant) => variant.id === variantId) || variants[0];
  const currentDescription = getCurrentDescriptionForAction(product, payload);
  const value = formatFaqItemsForDisplay(payload.faqItems, payload.draftText);
  const isMetafield = variantId === "metafield-html";
  const metafield = getFaqApplicationMetafield(payload, options);

  return withRecipeApplicationFields(action, {
    kind: "shopify_product",
    editable: true,
    target: selectedVariant.target,
    operation: selectedVariant.operation,
    intro: getFaqApplicationIntro(variantId, payload, metafield),
    confirmationTitle: isMetafield ? "Confirm FAQ metafield update" : "Confirm product FAQ update",
    confirmationDetail: getFaqConfirmationDetail(variantId, payload, metafield),
    applyLabel: selectedVariant.applyLabel,
    valueLabel: isMetafield ? "FAQ questions and answers to save" : "FAQ questions and answers to add",
    value,
    currentValueLabel: "Current Shopify description",
    currentValue: isMetafield ? "" : currentDescription,
    insertionPosition: isMetafield ? "" : "append",
    faqItems: normalizeFaqPreviewItems(payload.faqItems),
    variants,
    variantId,
    defaultVariantId,
    isMetafield,
    metafieldNamespace: metafield.namespace,
    metafieldKey: metafield.key,
    metafieldType: metafield.type,
    relatedActions: Array.isArray(payload.relatedActionLabels) ? payload.relatedActionLabels : [],
  });
}

function getFaqApplicationVariants(payload = {}) {
  const configured = Array.isArray(payload.applicationOptions) ? payload.applicationOptions : [];
  const defaults = [
    { id: "description-section", label: "Full FAQ in description", target: "Product description", operation: "Append FAQ section", applyLabel: "Add FAQ section" },
    { id: "description-collapsible", label: "Collapsible FAQ", target: "Product description", operation: "Append collapsible FAQ", applyLabel: "Add collapsible FAQ" },
    { id: "description-modal", label: "Modal-style FAQ", target: "Product description", operation: "Append modal-style FAQ", applyLabel: "Add FAQ modal" },
    { id: "metafield-html", label: "Product metafield", target: "Product metafield", operation: "Save HTML metafield", applyLabel: "Save FAQ metafield" },
  ];
  const configuredById = new Map(configured.map((item) => {
    const id = normalizeFaqApplicationVariantId(item.id);
    return [id, { ...item, id }];
  }));
  return defaults.map((item) => ({ ...item, ...(configuredById.get(item.id) || {}) }));
}

function getFaqApplicationIntro(variantId, payload = {}, metafield = null) {
  const reasons = Array.isArray(payload.faqNeed?.reasons) ? payload.faqNeed.reasons : [];
  const reasonText = reasons.length ? ` ProductPulse is suggesting FAQ coverage because ${reasons[0].toLowerCase()}` : "";
  if (variantId === "description-section") {
    return `This will append the generated questions and answers as a visible FAQ section in the Shopify product description.${reasonText}`;
  }
  if (variantId === "description-modal") {
    return `This will append a modal-style FAQ block to the Shopify product description using HTML that can be styled by the theme.${reasonText}`;
  }
  if (variantId === "metafield-html") {
    const namespace = metafield?.namespace || payload.metafield?.namespace || "productpulse";
    const key = metafield?.key || payload.metafield?.key || "faq_html";
    return `This will save the generated FAQ HTML in the product metafield ${namespace}.${key}. If the metafield is not present on the product, Shopify will create it when the value is saved.${reasonText}`;
  }
  return `This will append a compact collapsible FAQ to the Shopify product description so shoppers can open it without making the PDP much longer.${reasonText}`;
}

function getFaqConfirmationDetail(variantId, payload = {}, metafield = null) {
  if (variantId === "metafield-html") {
    const namespace = metafield?.namespace || payload.metafield?.namespace || "productpulse";
    const key = metafield?.key || payload.metafield?.key || "faq_html";
    return `ProductPulse will write FAQ HTML to ${namespace}.${key} as a Shopify long text metafield. Existing product description HTML will not change.`;
  }
  if (variantId === "description-modal") return "ProductPulse will append modal-style FAQ HTML to the current Shopify product description.";
  if (variantId === "description-section") return "ProductPulse will append a visible FAQ section to the current Shopify product description.";
  return "ProductPulse will append a collapsible FAQ HTML block to the current Shopify product description.";
}

function normalizeFaqApplicationVariantId(value = "") {
  const normalized = String(value || "").trim();
  return normalized === "metafield-json" ? "metafield-html" : normalized;
}

function getFaqApplicationMetafield(payload = {}, options = {}) {
  const metafield = payload.metafield || {};
  return {
    namespace: normalizeFaqMetafieldPart(options.metafieldNamespace ?? payload.metafieldNamespace ?? metafield.namespace ?? "productpulse", "productpulse", true),
    key: normalizeFaqMetafieldPart(options.metafieldKey ?? payload.metafieldKey ?? metafield.key ?? "faq_html", "faq_html", false),
    type: "multi_line_text_field",
  };
}

function normalizeFaqMetafieldPart(value = "", fallback = "", allowAppNamespace = false) {
  const raw = String(value || "").trim();
  if (allowAppNamespace && raw === "$app") return raw;
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function formatFaqItemsForDisplay(faqItems = [], fallback = "") {
  const items = Array.isArray(faqItems) ? faqItems : [];
  if (!items.length) return String(fallback || "").trim();
  return items
    .map((item) => `${item.question}\n${item.answer}`)
    .join("\n\n");
}

function normalizeFaqPreviewItems(faqItems = []) {
  return (Array.isArray(faqItems) ? faqItems : [])
    .map((item) => ({
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim(),
    }))
    .filter((item) => item.question || item.answer);
}

function getFaqPreviewItems(application = {}, detailText = "") {
  const structuredItems = normalizeFaqPreviewItems(application.faqItems);
  if (structuredItems.length) return structuredItems;

  const sections = String(detailText || "")
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections
    .map((section) => {
      const lines = section.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      return {
        question: lines[0] || "",
        answer: lines.slice(1).join("\n"),
      };
    })
    .filter((item) => item.question && item.answer);
}

function getGroupedDescriptionActionApplication(action, product = null, options = {}) {
  const payload = action.payload || {};
  const currentDescription = getCurrentDescriptionForAction(product, payload);
  const descriptionChanges = normalizeDescriptionChangesForApplication(payload.descriptionChanges);
  const selectedChangeIds = Array.isArray(options.selectedChangeIds)
    ? options.selectedChangeIds
    : descriptionChanges.map((change) => change.id);
  const selectedChanges = descriptionChanges.filter((change) => selectedChangeIds.includes(change.id));
  const value = buildGroupedDescriptionValue(currentDescription, selectedChanges);

  return withRecipeApplicationFields(action, {
    kind: "shopify_product",
    editable: true,
    target: "Product description",
    operation: "Apply selected description changes",
    descriptionOperation: "replace",
    intro: "ProductPulse found multiple description changes for this product. Review them together, select the changes you want, and ProductPulse will apply them as one consistent description update.",
    confirmationTitle: "Confirm product description update",
    confirmationDetail: "ProductPulse will apply the selected description changes together so separate recommendations do not overwrite each other.",
    applyLabel: "Apply selected changes",
    valueLabel: "Final updated description",
    value,
    currentValueLabel: "Current Shopify description",
    currentValue: currentDescription,
    insertionPosition: "",
    descriptionChanges,
    selectedChangeIds,
    relatedActions: descriptionChanges.map((change) => change.title),
  });
}

function normalizeDescriptionChangesForApplication(changes = []) {
  return (Array.isArray(changes) ? changes : [])
    .map((change, index) => {
      const id = String(change.id || change.actionId || `description-change-${index + 1}`).trim();
      const operation = ["replace", "prepend", "append"].includes(change.operation) ? change.operation : "append";
      const text = normalizeActionText(change.text || change.draftText || "");
      if (!id || !text) return null;
      return {
        id,
        actionId: change.actionId || id,
        title: change.title || getDescriptionOperationText(operation),
        operation,
        operationLabel: change.operationLabel || getDescriptionOperationText(operation),
        text,
        intro: change.intro || getDescriptionActionIntro(operation),
        reason: change.reason || "",
      };
    })
    .filter(Boolean)
    .sort((first, second) => getDescriptionChangeOrder(first.operation) - getDescriptionChangeOrder(second.operation));
}

function buildGroupedDescriptionValue(currentDescription = "", selectedChanges = []) {
  const current = normalizeActionText(currentDescription);
  const replacement = selectedChanges.find((change) => change.operation === "replace");
  const base = replacement?.text || current;
  const prependTexts = selectedChanges.filter((change) => change.operation === "prepend").map((change) => change.text);
  const appendTexts = selectedChanges.filter((change) => change.operation === "append").map((change) => change.text);
  const blocks = [];

  [...prependTexts, base, ...appendTexts].forEach((block) => {
    const normalized = normalizeActionText(block);
    if (!normalized) return;
    if (blocks.some((existing) => textIncludesMeaning(existing, normalized))) return;
    blocks.push(normalized);
  });

  return blocks.join("\n\n");
}

function getRecommendedActionApplication(action, product = null, options = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();

  if (Array.isArray(payload.descriptionChanges) && payload.descriptionChanges.length) {
    return getGroupedDescriptionActionApplication(action, product, options);
  }

  if (isFaqRecommendedAction(action)) {
    return getFaqRecommendedActionApplication(action, product, options);
  }

  if (payload.field === "seo.title" || normalized.includes("seo title")) {
    const value = String(payload.draftText || payload.draftTitle || "").replace(/\s+/g, " ").trim();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      field: "seo.title",
      editable: true,
      target: "SEO title",
      operation: "Update SEO title",
      intro: "This updates only the Shopify search engine listing title. The visible product title will stay unchanged.",
      confirmationTitle: "Confirm SEO title update",
      confirmationDetail: "ProductPulse will update the product SEO title in Shopify after you review the proposed text.",
      applyLabel: "Update SEO title",
      valueLabel: "Proposed SEO title",
      value,
      currentValueLabel: "Current SEO title",
      currentValue: payload.currentValue || product?.metrics?.seoTitle || "",
    });
  }

  if (payload.field === "seo.description" || normalized.includes("meta description")) {
    const value = String(payload.draftText || "").replace(/\s+/g, " ").trim();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      field: "seo.description",
      editable: true,
      target: "Meta description",
      operation: "Update meta description",
      intro: "This updates the Shopify search engine listing description. It does not change the product page description shoppers see on the PDP.",
      confirmationTitle: "Confirm meta description update",
      confirmationDetail: "ProductPulse will update the product meta description in Shopify after you review the proposed copy.",
      applyLabel: "Update meta description",
      valueLabel: "Proposed meta description",
      value,
      currentValueLabel: "Current meta description",
      currentValue: payload.currentValue || product?.metrics?.seoDescription || "",
    });
  }

  if (payload.draftHandle || payload.field === "handle" || normalized.includes("url handle")) {
    const value = String(payload.draftText || payload.draftHandle || "").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      field: "handle",
      editable: true,
      target: "URL handle",
      operation: "Update URL handle",
      intro: "This changes the Shopify product URL handle. ProductPulse requests a redirect so old links continue to work when Shopify supports it.",
      confirmationTitle: "Confirm URL handle update",
      confirmationDetail: "ProductPulse will update the product URL handle and request a redirect from the old handle.",
      applyLabel: "Update handle",
      valueLabel: "Proposed URL handle",
      value,
      currentValueLabel: "Current URL handle",
      currentValue: payload.currentValue || product?.handle || "",
    });
  }

  if (Array.isArray(payload.mediaUpdates) && payload.mediaUpdates.length) {
    const primaryUpdate = payload.mediaUpdates[0] || {};
    const suggestedAltText = String(payload.draftText || primaryUpdate.suggestedAltText || "").trim();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      editable: true,
      target: "Product media alt text",
      operation: payload.mediaUpdates.length === 1 ? "Update media alt text" : `Update ${payload.mediaUpdates.length} media alt texts`,
      intro: getMediaActionIntro(payload),
      confirmationTitle: "Confirm product media alt text update",
      confirmationDetail: payload.mediaUpdates.length === 1
        ? "ProductPulse will update the selected Shopify product media alt text."
        : "ProductPulse will apply the reviewed alt text to the selected Shopify product media items.",
      applyLabel: "Update alt text",
      valueLabel: "Suggested alt text",
      value: suggestedAltText,
      currentValueLabel: primaryUpdate.targetLabel || "Current media alt text",
      currentValue: primaryUpdate.currentAltText || "No alt text is currently set for this media.",
    });
  }

  if (payload.draftTitle || payload.field === "title" || normalized.includes("product title")) {
    const title = String(payload.draftTitle || action.detail || "").replace(/\s+/g, " ").trim();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      field: "title",
      editable: true,
      target: "Product title",
      operation: "Update title",
      intro: "This will update the Shopify product title after you review the proposed title. Use this only when the current title is generic, misleading, or unclear.",
      confirmationTitle: "Confirm product title update",
      confirmationDetail: "ProductPulse will update the Shopify product title. Existing description, variants and tags will stay untouched.",
      applyLabel: "Update title",
      valueLabel: "Proposed Shopify title",
      value: title,
      currentValueLabel: "Current Shopify title",
      currentValue: payload.currentTitle || product?.title || "",
    });
  }

  if (payload.productStatus || payload.field === "status" || normalized.includes("set product to draft")) {
    const status = String(payload.productStatus || "DRAFT").toUpperCase();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      editable: false,
      target: "Product status",
      operation: "Set product status",
      intro: "This is a high-risk operational control. ProductPulse will only change product status after explicit confirmation.",
      confirmationTitle: "Confirm product status change",
      confirmationDetail: `ProductPulse will set this Shopify product to ${status}. This can affect product availability and should be used only when the evidence is strong.`,
      applyLabel: `Set ${status.toLowerCase()}`,
      valueLabel: "New Shopify status",
      value: status,
      currentValueLabel: "Current Shopify status",
      currentValue: payload.currentStatus || product?.metrics?.productStatus || "",
    });
  }

  if (payload.field === "classification" || normalized.includes("product classification")) {
    const draftVendor = String(payload.draftVendor || "").trim();
    const draftProductType = String(payload.draftProductType || "").trim();
    const value = [
      draftVendor ? `Vendor: ${draftVendor}` : "",
      draftProductType ? `Product type: ${draftProductType}` : "",
      payload.draftCategory ? `Category to review: ${payload.draftCategory}` : "",
    ].filter(Boolean).join("\n");
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      editable: true,
      target: "Product classification",
      operation: "Update classification",
      intro: "This updates available Shopify classification fields when a concrete vendor or product type is proposed. Category changes remain a review item unless a valid Shopify category ID is provided.",
      confirmationTitle: "Confirm product classification update",
      confirmationDetail: "ProductPulse will update the proposed Shopify product classification fields after review.",
      applyLabel: "Update classification",
      valueLabel: "Proposed classification",
      value,
      currentValueLabel: "Current classification",
      currentValue: [
        product?.metrics?.vendor ? `Vendor: ${product.metrics.vendor}` : "",
        product?.metrics?.productType ? `Product type: ${product.metrics.productType}` : "",
      ].filter(Boolean).join("\n"),
    });
  }

  if (payload.field === "templateSuffix" || payload.templateSuffix || normalized.includes("product template")) {
    const value = String(payload.templateSuffix || payload.draftText || "").trim();
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      editable: true,
      target: "Product template",
      operation: "Update template",
      intro: "This changes the Shopify product template suffix. Use it only after confirming the theme includes the proposed template.",
      confirmationTitle: "Confirm product template update",
      confirmationDetail: "ProductPulse will update the product template suffix in Shopify.",
      applyLabel: "Update template",
      valueLabel: "Proposed template suffix",
      value,
      currentValueLabel: "Current template suffix",
      currentValue: payload.currentTemplateSuffix || product?.metrics?.templateSuffix || "default",
    });
  }

  if (Array.isArray(payload.metafields) && payload.metafields.length) {
    const value = payload.metafields.map((metafield) => `${metafield.namespace}.${metafield.key}: ${metafield.value}`).join("\n");
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      editable: false,
      target: "Product metafields",
      operation: "Set product metafields",
      intro: "This saves structured ProductPulse metadata on the Shopify product for internal workflows, theme blocks or reporting.",
      confirmationTitle: "Confirm product metafields update",
      confirmationDetail: "ProductPulse will set the listed product metafields in Shopify.",
      applyLabel: "Save metafields",
      valueLabel: "Metafields to save",
      value,
    });
  }

  if (isVariantOptionsRecommendedAction(action)) {
    return getVariantOptionsActionApplication(action, product);
  }

  if (normalized.includes("add-to-watchlist") || normalized.includes("watchlist")) {
    return withRecipeApplicationFields(action, {
      kind: "productpulse_workflow",
      editable: false,
      target: "ProductPulse Watchlist",
      operation: "Add to Watchlist",
      intro: "This adds the product to periodic Watchlist monitoring so future deep diagnostics can track changes over time.",
      confirmationTitle: "Confirm Watchlist addition",
      confirmationDetail: "ProductPulse will add this product to the Watchlist if there is an available slot.",
      applyLabel: "Add to Watchlist",
      confirmationSubmitLabel: "Add to Watchlist",
      valueLabel: "Product to watch",
      value: product?.title || payload.productTitle || action.title || "Selected product",
      hidePreview: true,
      useApplyLabelInModal: true,
    });
  }

  if (payload.tag || Array.isArray(payload.tags) || normalized.includes("shopify tag") || normalized.includes("product tag")) {
    const tags = Array.isArray(payload.tags) ? payload.tags.map(String).filter(Boolean) : [String(payload.tag || "").trim()].filter(Boolean);
    return {
      ...withRecipeApplicationFields(action, {
      kind: "shopify_product",
      editable: false,
      target: "Product tags",
      operation: "Add tag",
      intro: `This will add internal Shopify product tags so the product can be segmented, filtered, or reviewed later.`,
      confirmationTitle: "Confirm product tag update",
      confirmationDetail: "ProductPulse will add these tags to the Shopify product. Existing tags will stay untouched.",
      applyLabel: tags.length === 1 ? "Add tag to product" : "Add tags to product",
      valueLabel: tags.length === 1 ? "Tag to add" : "Tags to add",
      value: tags.join(", "),
      }),
    };
  }

  if (payload.draftText && (normalized.includes("pdp") || normalized.includes("description") || normalized.includes("faq") || normalized.includes("fit"))) {
    const currentDescription = getCurrentDescriptionForAction(product, payload);
    const operation = getResolvedDescriptionOperationForAction(action, product, currentDescription);
    const value = getDescriptionActionValue({ action, product, operation, currentDescription });
    return withRecipeApplicationFields(action, {
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
    });
  }

  if (payload.note) {
    return withRecipeApplicationFields(action, {
      kind: "clipboard",
      editable: true,
      target: "Internal note",
      operation: "Copy note",
      intro: "This is an internal support note. It does not change Shopify product data; copy it and use it in your support workflow.",
      applyLabel: "Copy note",
      valueLabel: "Note text",
      value: payload.note,
    });
  }

  return {
    ...withRecipeApplicationFields(action, {
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
    }),
  };
}

function isVariantOptionsRecommendedAction(action = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""} ${payload.shopifyField || ""}`.toLowerCase();
  return action.id === "correct-variant-options"
    || Array.isArray(payload.variantUpdates)
    || normalized.includes("fix variant")
    || normalized.includes("variant options")
    || normalized.includes("productvariant option");
}

function getVariantOptionsActionApplication(action = {}, product = {}) {
  const payload = action.payload || {};
  const variantUpdates = normalizeVariantActionUpdates(payload);
  const hasDirectUpdates = variantUpdates.some((update) => update.variantId && update.optionValues.length);
  const suggestionsText = formatVariantActionSuggestions(variantUpdates, payload);
  const currentText = formatVariantActionCurrentValue(variantUpdates, payload);
  const editUrl = product?.shopifyAdminUrl || payload.shopifyAdminUrl || "";

  if (hasDirectUpdates) {
    return withRecipeApplicationFields(action, {
      kind: "shopify_product",
      field: "variants",
      editable: false,
      target: "Product variants/options",
      operation: "Update variant option values",
      intro: "ProductPulse found variant or option labels that may be unclear to shoppers. Review the exact option-value changes before applying them to Shopify.",
      confirmationTitle: "Confirm variant option update",
      confirmationDetail: "ProductPulse will update the proposed Shopify variant option values. Option names, prices and inventory will stay unchanged.",
      applyLabel: "Update variants",
      useApplyLabelInModal: true,
      valueLabel: "Suggested variant/option updates",
      value: suggestionsText,
      currentValueLabel: "Current variant/options",
      currentValue: currentText,
      externalEditUrl: editUrl,
      externalEditLabel: "Edit in Shopify",
      variantUpdates,
    });
  }

  return withRecipeApplicationFields(action, {
    kind: "review",
    editable: false,
    target: "Product variants/options",
    operation: "Inspect variant names/options",
    intro: "ProductPulse does not have enough structured variant-option data to safely update this automatically. Use the suggested labels as a guide, then edit the product in Shopify.",
    applyLabel: "Open evidence",
    valueLabel: "Suggested variant review",
    value: suggestionsText || getRecommendedActionDetail(action),
    currentValueLabel: "Current affected variants",
    currentValue: currentText,
    externalEditUrl: editUrl,
    externalEditLabel: "Edit in Shopify",
    variantUpdates,
  });
}

function normalizeVariantActionUpdates(payload = {}) {
  const directUpdates = Array.isArray(payload.variantUpdates) ? payload.variantUpdates : [];
  if (directUpdates.length) {
    return directUpdates
      .map((update) => ({
        variantId: String(update.variantId || update.id || "").trim(),
        variantTitle: String(update.variantTitle || update.currentName || update.title || "").trim(),
        sku: String(update.sku || "").trim(),
        currentLabel: String(update.currentLabel || update.currentName || update.variantTitle || update.title || "").trim(),
        suggestedLabel: String(update.suggestedLabel || update.suggestedName || update.suggestion || "").trim(),
        optionValues: Array.isArray(update.optionValues)
          ? update.optionValues.map((option) => ({
              optionName: String(option.optionName || option.name || "").trim(),
              currentValue: String(option.currentValue || option.value || "").trim(),
              suggestedValue: String(option.suggestedValue || option.name || option.value || "").trim(),
            })).filter((option) => option.optionName && option.suggestedValue && !sameVariantLabel(option.currentValue, option.suggestedValue))
          : [],
      }))
      .filter(hasMeaningfulVariantSuggestion);
  }

  const affected = Array.isArray(payload.affectedVariants) ? payload.affectedVariants : [];
  const details = Array.isArray(payload.variantDetails) ? payload.variantDetails : [];
  return uniqueStrings([...affected, ...details.map((item) => item.label || item.title || item.sku || "")])
    .map((label) => ({
      variantId: "",
      variantTitle: label,
      sku: "",
      currentLabel: label,
      suggestedLabel: buildReadableVariantSuggestion(label, payload),
      optionValues: [],
    }))
    .filter(hasMeaningfulVariantSuggestion);
}

function hasMeaningfulVariantSuggestion(update = {}) {
  if (Array.isArray(update.optionValues) && update.optionValues.some((option) => !sameVariantLabel(option.currentValue, option.suggestedValue))) return true;
  return Boolean(update.suggestedLabel && !sameVariantLabel(update.currentLabel || update.variantTitle, update.suggestedLabel));
}

function sameVariantLabel(first = "", second = "") {
  return String(first || "").replace(/\s+/g, " ").trim().toLowerCase()
    === String(second || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function buildReadableVariantSuggestion(label = "", payload = {}) {
  const value = String(label || "").trim();
  if (!value) return "";
  if (/^default title$/i.test(value)) {
    const firstOptionName = String(Array.isArray(payload.optionNames) ? payload.optionNames[0] || "" : "").toLowerCase();
    if (firstOptionName.includes("size")) return "One size";
    if (firstOptionName.includes("color") || firstOptionName.includes("colour")) return "Standard color";
    return "Standard";
  }
  if (/^[a-z0-9-]{3,}$/i.test(value) && value === value.toUpperCase()) return `SKU ${value}`;
  return value.replace(/\s+/g, " ").trim();
}

function formatVariantActionCurrentValue(updates = [], payload = {}) {
  const lines = updates.map((update) => {
    const optionText = update.optionValues?.length
      ? update.optionValues.map((option) => `${option.optionName}: ${option.currentValue || "empty"}`).join(", ")
      : "";
    const suffix = [update.sku ? `SKU ${update.sku}` : "", optionText].filter(Boolean).join(" - ");
    return `${update.currentLabel || update.variantTitle || "Variant"}${suffix ? ` (${suffix})` : ""}`;
  });
  if (lines.length) return lines.join("\n");
  const affected = Array.isArray(payload.affectedVariants) ? payload.affectedVariants : [];
  return affected.length ? affected.join("\n") : "No affected variant labels were loaded.";
}

function formatVariantActionSuggestions(updates = [], payload = {}) {
  const lines = updates.map((update) => {
    const optionChanges = update.optionValues?.length
      ? update.optionValues.map((option) => `${option.optionName}: ${option.currentValue || "empty"} -> ${option.suggestedValue}`).join(", ")
      : "";
    const labelChange = update.suggestedLabel && update.suggestedLabel !== update.currentLabel
      ? `${update.currentLabel || update.variantTitle || "Variant"} -> ${update.suggestedLabel}`
      : update.suggestedLabel || update.currentLabel || update.variantTitle || "";
    return [labelChange, optionChanges].filter(Boolean).join(" | ");
  }).filter(Boolean);
  if (lines.length) return lines.join("\n");
  return payload.trigger || "Review the affected variant names, option values and SKUs before changing the product.";
}

function withRecipeApplicationFields(action, application) {
  const payload = action.payload || {};
  return {
    ...application,
    trigger: payload.trigger || "",
    proposedChange: payload.proposedChange || application.operation || "",
    shopifyField: payload.shopifyField || application.target || "",
    expectedImpact: payload.expectedImpact || "",
    applicationRisk: payload.applicationRisk || "Low",
    approval: payload.approval || "Review required before applying",
    reviewApplyFlow: payload.reviewApplyFlow || "Review -> Apply",
    priorityGroup: payload.priorityGroup || action.priorityGroup || "",
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

function getResolvedDescriptionOperationForAction(action, product = null, currentDescription = "") {
  const operation = getDescriptionOperationForAction(action);
  if (operation !== "replace") return operation;
  return shouldTreatDescriptionRewriteAsAppend(action, product, currentDescription) ? "append" : operation;
}

function shouldTreatDescriptionRewriteAsAppend(action = {}, product = null, currentDescriptionOverride = "") {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (!normalized.includes("rewrite") && payload.operation !== "replace") return false;
  const currentDescription = currentDescriptionOverride || getCurrentDescriptionForAction(product, payload);
  return Boolean(getAppendedDescriptionText(currentDescription, payload.draftText));
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

function getMediaActionIntro(payload = {}) {
  const updates = Array.isArray(payload.mediaUpdates) ? payload.mediaUpdates : [];
  const target = updates.length === 1 ? (updates[0]?.targetLabel || "the selected product media") : `${updates.length} product media items`;
  const imageBrief = String(payload.imageBrief || "").trim();
  return [
    `ProductPulse suggests updating alt text for ${target} so the PDP media explains the product more clearly.`,
    imageBrief ? `Recommended visual direction: ${imageBrief}` : "",
  ].filter(Boolean).join(" ");
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
  if (operation === "append") return getAppendedDescriptionText(currentDescription, draftText) || draftText;
  if (operation !== "replace") return draftText;
  return buildEnhancedDescriptionPreview({
    currentDescription,
    suggestedText: draftText,
    relatedText: getRelatedDescriptionText(product, payload),
  });
}

function getAppendedDescriptionText(currentDescription = "", proposedDescription = "") {
  const current = normalizeActionText(currentDescription);
  const proposed = normalizeActionText(proposedDescription);
  if (!current || !proposed || proposed.length <= current.length) return "";
  if (!proposed.toLowerCase().startsWith(current.toLowerCase())) return "";
  return proposed
    .slice(current.length)
    .replace(/^[\s:;,.-]+/, "")
    .trim();
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
  const base = suggested || current;
  const additions = [related].filter(Boolean);
  const uniqueAdditions = [];

  additions.forEach((addition) => {
    if (base && textIncludesMeaning(base, addition)) return;
    if (uniqueAdditions.some((existing) => textIncludesMeaning(existing, addition))) return;
    uniqueAdditions.push(addition);
  });

  if (!base) return uniqueAdditions.join("\n\n");
  if (!uniqueAdditions.length) return base;
  return [base, ...uniqueAdditions].join("\n\n");
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

  if (payload.mediaGuidance || Array.isArray(payload.mediaUpdates) || normalized.includes("media") || normalized.includes("image")) {
    const narrative = getMediaActionWhyNarrative(action, product);
    if (narrative) return narrative;
  }

  if (payload.trigger && payload.expectedImpact) {
    return `${payload.trigger} Expected impact: ${payload.expectedImpact}`;
  }

  if (Array.isArray(payload.reviewSections) && payload.reviewSections.length) {
    return `ProductPulse grouped ${payload.reviewSections.length} related review area${payload.reviewSections.length === 1 ? "" : "s"} so you can inspect the evidence once instead of working through overlapping review tasks.`;
  }

  if (contentIssueLabels.length) {
    return `ProductPulse found content issues that can reduce buyer confidence: ${contentIssueLabels.slice(0, 3).join(", ")}.`;
  }
  if (Array.isArray(payload.topReturnReasons) && payload.topReturnReasons.length) {
    return `Return evidence shows repeated reasons: ${formatQuotedInlineList(payload.topReturnReasons.slice(0, 3))}. Reviewing them helps separate product issues from operational noise.`;
  }
  if (Array.isArray(payload.affectedVariants) && payload.affectedVariants.length) {
    return `Signals are concentrated in specific variants: ${formatQuotedInlineList(payload.affectedVariants.slice(0, 4))}. This action focuses the review where risk is most likely.`;
  }
  if (Number(payload.refundAmount || 0) > 0) {
    return `Refund impact is measurable: ${formatMoney(payload.refundAmount)} across ${formatInteger(payload.refundUnits || 0)} units. This action checks whether the loss is preventable.`;
  }
  if (Number(payload.negativeReviewCount || 0) > 0) {
    return `${formatInteger(payload.negativeReviewCount)} negative Judge.me reviews are connected to this product. Reviewing them can clarify the language customers use.`;
  }
  if (Array.isArray(payload.faqItems) && payload.faqItems.length) {
    const reasons = Array.isArray(payload.faqNeed?.reasons) ? payload.faqNeed.reasons : [];
    if (reasons.length) return `ProductPulse found FAQ-worthy buyer uncertainty: ${formatQuotedInlineList(reasons.slice(0, 2))}.`;
    return `ProductPulse generated ${payload.faqItems.length} FAQ item${payload.faqItems.length === 1 ? "" : "s"} from repeated diagnosis signals and product-content gaps.`;
  }
  if (payload.note) {
    return "This creates a concise internal note so support can respond consistently while the product issue is being reviewed.";
  }
  if (payload.draftText || normalized.includes("pdp") || normalized.includes("description") || normalized.includes("faq")) {
    const narrative = getDescriptionActionWhyNarrative(action, product);
    if (narrative) return narrative;
    const issue = product.primaryIssue || "current product signals";
    return `This is suggested because ProductPulse detected ${issue}. Clearer shopper-facing copy can reduce avoidable confusion before purchase.`;
  }
  if (metrics.signalCount) {
    return `This action is based on ${formatInteger(metrics.signalCount)} stored product signal${metrics.signalCount === 1 ? "" : "s"} across the available sources.`;
  }
  return "This action is available from the current diagnosis and can be reviewed before anything is applied.";
}

function getMediaActionWhyNarrative(action = {}, product = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (!normalized.includes("media") && !normalized.includes("image") && !payload.mediaGuidance && !Array.isArray(payload.mediaUpdates)) return "";
  const metrics = product.metrics || {};
  const pieces = [];
  const missingAlt = Number(payload.mediaWithoutAltCount ?? metrics.mediaWithoutAltCount ?? 0);
  const mediaCount = Number(payload.mediaCount ?? metrics.mediaCount ?? 0);
  const negativeReviews = Number(payload.negativeReviewCount ?? metrics.negativeReviewCount ?? 0);
  const returnReasons = normalizeActionReasonList(payload.topReturnReasons || metrics.topReturnReasonDetails || metrics.topReturnReasons, "return reason");
  const issue = getHumanReadableActionIssue(payload.issue || product.primaryIssue || "visual expectation mismatch");
  const imageBrief = String(payload.imageBrief || "").trim();

  if (missingAlt > 0) pieces.push(`${formatInteger(missingAlt)} media item${missingAlt === 1 ? "" : "s"} missing alt text`);
  if (mediaCount === 0) pieces.push("no product media was found in Shopify product data");
  if (negativeReviews > 0) pieces.push(`${formatInteger(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"}`);
  if (returnReasons.length) pieces.push(`return language tied to ${formatQuotedInlineList(returnReasons.slice(0, 2))}`);

  const evidence = pieces.length ? pieces.join(", ") : "the diagnosis found media or visual-context risk";
  const outcome = imageBrief
    ? ` ProductPulse recommends: ${imageBrief}`
    : " The proposed alt text should describe the visible product, color, format, material or scale instead of only repeating the title.";
  return `ProductPulse recommends improving product media because ${evidence} point to ${issue}. Better image context and alt text help shoppers understand what they are buying before purchase.${outcome}`;
}

function getDescriptionActionWhyNarrative(action = {}, product = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  const isDescriptionLike = normalized.includes("description")
    || normalized.includes("pdp")
    || normalized.includes("faq")
    || payload.descriptionChangeGroup
    || ["replace", "prepend", "append"].includes(payload.operation)
    || ["prepend", "append"].includes(payload.placement);
  if (!isDescriptionLike) return "";
  if (!payload.draftText && !payload.descriptionChangeGroup && !normalized.includes("description") && !normalized.includes("pdp") && !normalized.includes("faq")) return "";
  const metrics = product.metrics || {};
  const reasons = normalizeActionReasonList(payload.topReturnReasons || metrics.topReturnReasonDetails || metrics.topReturnReasons, "return reason");
  const contentIssues = getContentIssueLabels(payload.contentIssues || metrics.contentIssues || metrics.contentAnalysis?.issues);
  const returnUnits = Number(payload.returnUnits ?? metrics.returnUnits ?? 0);
  const negativeReviews = Number(payload.negativeReviewCount ?? metrics.negativeReviewCount ?? 0);
  const issue = getHumanReadableActionIssue(payload.issue || product.primaryIssue || contentIssues[0] || "buyer clarity");
  const evidenceParts = [];

  if (returnUnits > 0) {
    evidenceParts.push(`${formatInteger(returnUnits)} return${returnUnits === 1 ? "" : "s"}${reasons.length ? ` tied to ${formatQuotedInlineList(reasons.slice(0, 2))}` : ""}`);
  }
  if (negativeReviews > 0) {
    evidenceParts.push(`${formatInteger(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"}`);
  }
  if (contentIssues.length) {
    evidenceParts.push(`content analysis found ${formatInlineList(contentIssues.slice(0, 2)).toLowerCase()}`);
  }

  if (!evidenceParts.length) return "";

  const operation = getResolvedDescriptionOperationForAction(action, product);
  const actionText = operation === "append"
    ? "adding this text at the end of the description"
    : operation === "prepend"
      ? "adding this text before the current description"
      : "updating the product description";

  return `ProductPulse recommends ${actionText} because ${evidenceParts.join(", ")} point to ${issue}. This gives shoppers clearer expectations before purchase, reducing avoidable confusion before they buy.`;
}

function normalizeActionReasonList(value, fallback = "signal") {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const label = String(item.label || item.reason || item.name || "").trim();
      const count = Number(item.count || item.units || item.quantity || 0);
      return label ? `${label}${count ? ` (${formatInteger(count)})` : ""}` : "";
    })
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => item || fallback);
}

function getHumanReadableActionIssue(value = "") {
  const label = getProductIssueCategory(String(value || ""));
  return label && label !== "No issue" ? label.toLowerCase() : String(value || "buyer clarity").replace(/[_-]+/g, " ").toLowerCase();
}

function formatInlineList(items = []) {
  const list = items.map((item) => String(item || "").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
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
  if (payload.draftTitle) evidence.push("Title clarity");
  if (Array.isArray(payload.tags) && payload.tags.length) evidence.push(`${payload.tags.length} tags`);
  if (payload.mediaWithoutAltCount) evidence.push(`${payload.mediaWithoutAltCount} media without alt text`);
  if (payload.productStatus) evidence.push(`Status: ${payload.productStatus}`);
  if (payload.collectionName) evidence.push(payload.collectionName);
  if (payload.applicationRisk) evidence.push(`${payload.applicationRisk} apply risk`);
  if (!evidence.length && Number(metrics.signalCount || 0) > 0) evidence.push(`${formatInteger(metrics.signalCount)} product signals`);
  if (!evidence.length && Number(metrics.confidence || product.confidence || 0) > 0) evidence.push(`${metrics.confidence || product.confidence}% confidence`);

  return evidence.slice(0, 3);
}

function getRecommendedActionPriority(action, product) {
  const priorityGroup = String(action.payload?.priorityGroup || "").trim();
  if (priorityGroup && !/^primary\b/i.test(priorityGroup)) return priorityGroup;
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
    action.payload?.applicationRisk ? { icon: "alert-circle", label: `${action.payload.applicationRisk} apply risk` } : null,
    { icon: "wand", label: `${action.effort} effort` },
  ].filter((item) => item?.label);
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
  const monthlySummary = metrics.monthlyOrderActivity?.summary || {};
  const variantCount = Number(metrics.variantCount ?? (Array.isArray(metrics.variants) ? metrics.variants.length : 0))
    || Number(metrics.affectedVariants?.length || 0);
  const analyzedUnits = Number(monthlySummary.totalOrderUnits ?? metrics.soldUnits ?? 0);
  const returnRate = monthlySummary.returnRate ?? metrics.returnRate ?? 0;
  const refundRate = monthlySummary.refundRate ?? metrics.refundRate ?? 0;
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
      value: `${formatInteger(variantCount)} variant${variantCount === 1 ? "" : "s"}`,
      detail: productMeta || "Product metadata stored",
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("order")) || analyzedUnits > 0) {
    items.push({
      icon: "package",
      label: "Units sold analyzed",
      value: formatInteger(analyzedUnits),
      detail: `${windowDays || 0} day Shopify order window`,
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("return")) || Number(metrics.returnUnits || 0) > 0) {
    items.push({
      icon: "return",
      label: "Returns analyzed",
      value: formatInteger(metrics.returnUnits || 0),
      detail: `${formatPercent(returnRate)} return rate`,
    });
  }

  if (sources.some((source) => String(source).toLowerCase().includes("refund")) || Number(metrics.refundUnits || 0) > 0) {
    items.push({
      icon: "cash-dollar",
      label: "Refunds analyzed",
      value: formatInteger(metrics.refundUnits || 0),
      detail: `${formatMoney(metrics.refundAmount || 0)} refunded, ${formatPercent(refundRate)} refund rate`,
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
  const hasShopifyApplyPayload = Boolean(
    payload.draftText
    || payload.tag
    || payload.draftTitle
    || payload.draftHandle
    || payload.productStatus
    || payload.templateSuffix
    || payload.field === "classification"
    || (Array.isArray(payload.tags) && payload.tags.length)
    || (Array.isArray(payload.metafields) && payload.metafields.length)
    || (Array.isArray(payload.descriptionChanges) && payload.descriptionChanges.length)
    || (Array.isArray(payload.mediaUpdates) && payload.mediaUpdates.length)
    || (Array.isArray(payload.variantUpdates) && payload.variantUpdates.length)
  );
  if (normalizedId.includes("run-ai-diagnosis") || normalizedId.includes("run-full-diagnosis")) return "diagnose";
  if (normalizedId.includes("add-to-watchlist")) return "apply-product";
  if (Array.isArray(payload.mediaUpdates) && payload.mediaUpdates.length) return "apply-product";
  if (hasDirectVariantOptionUpdates(payload)) return "apply-product";
  if (payload.draftTitle || payload.productStatus || payload.draftHandle || payload.templateSuffix || payload.field === "classification" || payload.field === "seo.title" || payload.field === "seo.description" || (Array.isArray(payload.metafields) && payload.metafields.length)) return "apply-product";
  if (hasShopifyApplyPayload && (normalizedType.includes("pdp copy") || normalizedType.includes("faq") || normalizedType.includes("tag"))) return "apply-product";
  if (hasShopifyApplyPayload && index === 0 && action.status === "Draft") return "apply-product";
  if (normalizedType.includes("internal") || normalizedId.includes("copy")) return "copy";
  if (normalizedType.includes("workflow") || normalizedType.includes("variant") || normalizedType.includes("commercial") || normalizedType.includes("inventory") || normalizedType.includes("media") || normalizedType.includes("qa") || normalizedId.includes("review-return")) return "review";
  return "submit";
}

function hasDirectVariantOptionUpdates(payload = {}) {
  return normalizeVariantActionUpdates(payload).some((update) => update.variantId && update.optionValues.length);
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
  if (normalized.includes("seo") || normalized.includes("url handle")) return "search";
  if (normalized.includes("template")) return "product";
  if (normalized.includes("metafield")) return "file";
  if (normalized.includes("classification") || normalized.includes("category")) return "product";
  if (normalized.includes("source") || normalized.includes("coverage")) return "external";
  if (normalized.includes("watchlist")) return "view";
  if (normalized.includes("diagnosis") || normalized.includes("baseline")) return "wand";
  if (normalized.includes("price") || normalized.includes("commercial")) return "cash-dollar";
  if (normalized.includes("inventory")) return "package";
  if (normalized.includes("collection")) return "duplicate";
  if (normalized.includes("media") || normalized.includes("image")) return "image";
  if (normalized.includes("qa") || normalized.includes("supplier")) return "shield-check-mark";
  if (normalized.includes("status") || normalized.includes("draft") || normalized.includes("high-risk")) return "alert-circle";
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
  if (normalized.includes("seo")) return "SEO";
  if (normalized.includes("url handle")) return "URL";
  if (normalized.includes("template")) return "TPL";
  if (normalized.includes("metafield")) return "MF";
  if (normalized.includes("classification") || normalized.includes("category")) return "CAT";
  if (normalized.includes("source") || normalized.includes("coverage")) return "SRC";
  if (normalized.includes("watchlist")) return "WT";
  if (normalized.includes("diagnosis") || normalized.includes("baseline")) return "AI";
  if (normalized.includes("price") || normalized.includes("commercial")) return "$";
  if (normalized.includes("inventory")) return "INV";
  if (normalized.includes("collection")) return "COL";
  if (normalized.includes("media") || normalized.includes("image")) return "IMG";
  if (normalized.includes("qa") || normalized.includes("supplier")) return "QA";
  if (normalized.includes("status") || normalized.includes("draft") || normalized.includes("high-risk")) return "!";
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
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const dismissFetcher = useFetcher();
  const evidencePanelRef = useRef(null);
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState(0);
  const [ignoredIssues, setIgnoredIssues] = useState(() => new Set(getIgnoredIssueRecords(product).map((issue) => issue.issueKey)));
  const [resolvedLocally, setResolvedLocally] = useState(null);
  const [minimizedActionStates, setMinimizedActionStates] = useState(() => ({}));
  const [selectedRecommendedAction, setSelectedRecommendedAction] = useState(null);
  const [toastData, setToastData] = useState(null);
  const [editingAction, setEditingAction] = useState(null);
  const [actionConfirmation, setActionConfirmation] = useState(null);
  const [actionsCompleteModalOpen, setActionsCompleteModalOpen] = useState(false);
  const [diagnosisConfirmation, setDiagnosisConfirmation] = useState(null);
  const [watchlistConfirmation, setWatchlistConfirmation] = useState(null);
  const [watchlistLocalState, setWatchlistLocalState] = useState(null);
  const [detailActionsOpen, setDetailActionsOpen] = useState(false);
  const [recommendedActionsCollapsed, setRecommendedActionsCollapsed] = useState(false);
  const [recommendedActionSort, setRecommendedActionSort] = useState("priority");
  const [recommendedActionsExpanded, setRecommendedActionsExpanded] = useState(false);
  const [draftText, setDraftText] = useState("");
  const productRef = useRef(product);
  const minimizedActionStatesRef = useRef(minimizedActionStates);
  const lastDismissFetcherDataKeyRef = useRef("");
  const productIdentityKey = product?.slug || product?.handle || product?.id || product?.productGid || "";
  const productResolvedAt = product?.resolvedAt || "";
  const pendingActionType = navigation.state === "submitting" ? navigation.formData?.get("_action") : null;
  const pendingActionId = navigation.state === "submitting" ? navigation.formData?.get("actionId") : null;
  const pendingIssueKey = navigation.state === "submitting" && ["ignore-issue", "unignore-issue"].includes(String(navigation.formData?.get("_action") || ""))
    ? normalizeIssueIgnoreKey(navigation.formData?.get("issueKey"))
    : "";
  const pendingIssueAction = pendingIssueKey ? String(navigation.formData?.get("_action") || "") : "";

  useEffect(() => {
    productRef.current = product;
  }, [product]);

  useEffect(() => {
    minimizedActionStatesRef.current = minimizedActionStates;
  }, [minimizedActionStates]);

  useEffect(() => {
    const nextProduct = productRef.current;
    setResolvedLocally(null);
    setIgnoredIssues(new Set(getIgnoredIssueRecords(nextProduct).map((issue) => issue.issueKey)));
    setMinimizedActionStates({});
    setSelectedRecommendedAction(null);
    setSelectedEvidenceIndex(0);
    setActionsCompleteModalOpen(false);
    setDiagnosisConfirmation(null);
    setWatchlistConfirmation(null);
    setWatchlistLocalState(null);
    setDetailActionsOpen(false);
    setRecommendedActionsCollapsed(false);
    setRecommendedActionSort("priority");
    setRecommendedActionsExpanded(false);
  }, [productIdentityKey, productResolvedAt]);

  useEffect(() => {
    announceProductPulseJobs(actionData);
    if (actionData?.status === "success" && actionData?.action?.id === "mark-resolved") {
      setResolvedLocally(true);
    }
    if (actionData?.status === "success" && actionData?.action?.id === "mark-unresolved") {
      setResolvedLocally(false);
    }
    if (actionData?.status === "success" && actionData?.action?.id === "add-watched-product") {
      setWatchlistLocalState(true);
      setWatchlistConfirmation(null);
    }
    if (actionData?.status === "success" && actionData?.action?.id === "remove-watched-product") {
      setWatchlistLocalState(false);
      setWatchlistConfirmation(null);
    }
    if (actionData?.status === "success" && actionData?.action?.id === "ignore-issue") {
      const issueKey = normalizeIssueIgnoreKey(actionData.action.payload?.issueKey || actionData.action.payload?.issueCode || actionData.action.payload?.issue);
      if (issueKey) {
        setIgnoredIssues((current) => {
          const next = new Set(current);
          next.add(issueKey);
          return next;
        });
      }
    }
    if (actionData?.status === "success" && actionData?.action?.id === "unignore-issue") {
      const issueKey = normalizeIssueIgnoreKey(actionData.action.payload?.issueKey || actionData.action.payload?.issueCode || actionData.action.payload?.issue);
      if (issueKey) {
        setIgnoredIssues((current) => {
          const next = new Set(current);
          next.delete(issueKey);
          return next;
        });
      }
    }
    if (actionData?.status === "success" && actionData?.action?.id && !["mark-resolved", "mark-unresolved", "ignore-issue", "unignore-issue", "add-watched-product", "remove-watched-product"].includes(actionData.action.id)) {
      const actionKey = actionData.action.id;
      const archivedState = getArchivedActionStateFromRecordStatus(actionData.actionRecordStatus || "applied");
      if (archivedState && willCompleteProductRecommendedActions(productRef.current, actionKey, minimizedActionStatesRef.current)) {
        setActionsCompleteModalOpen(true);
      }
      if (archivedState) setMinimizedActionStates((current) => ({ ...current, [actionKey]: archivedState }));
      setSelectedRecommendedAction(null);
      setEditingAction(null);
    }
    if (actionData?.status === "success") {
      setActionConfirmation(null);
      setDiagnosisConfirmation(null);
      setWatchlistConfirmation(null);
      setDetailActionsOpen(false);
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

  useEffect(() => {
    const data = dismissFetcher.data;
    const dataKey = data?.status === "success"
      ? `${data.action?.id || ""}:${data.actionRecordStatus || ""}:${data.message || ""}`
      : "";
    if (dismissFetcher.state !== "idle" || !dataKey || lastDismissFetcherDataKeyRef.current === dataKey) return;
    lastDismissFetcherDataKeyRef.current = dataKey;
    revalidator.revalidate();
  }, [dismissFetcher.data, dismissFetcher.state, revalidator]);

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
  const ignoredIssueRows = detail.detectedIssues.filter((issue) => isIssueIgnored(issue, ignoredIssues));
  const selectedEvidence = detail.evidenceSources[selectedEvidenceIndex] || detail.evidenceSources[0];
  const isActionArchived = (action) => {
    return Boolean(getArchivedActionState(action, minimizedActionStates));
  };
  const activeRecommendedActions = detail.recommendedActions.filter((action) => !isRecommendedActionRelatedToIgnoredIssues(action, ignoredIssueRows, product));
  const hiddenIgnoredRecommendedActionCount = Math.max(0, detail.recommendedActions.length - activeRecommendedActions.length);
  const visibleRecommendedActions = sortRecommendedActionsForPanel(
    activeRecommendedActions.filter((action) => !isActionArchived(action)),
    recommendedActionSort,
    product,
  );
  const displayedRecommendedActions = recommendedActionsExpanded
    ? visibleRecommendedActions
    : visibleRecommendedActions.slice(0, 3);
  const hiddenVisibleRecommendedActionCount = Math.max(visibleRecommendedActions.length - displayedRecommendedActions.length, 0);
  const minimizedRecommendedActions = sortRecommendedActionsForPanel(
    activeRecommendedActions.filter((action) => isActionArchived(action)),
    recommendedActionSort,
    product,
  );
  const visibleRecommendedActionCount = detail.hasFullDiagnosis ? visibleRecommendedActions.length : 0;
  const resolved = resolvedLocally ?? Boolean(detail.resolvedAt);
  const diagnosisPending = pendingActionType === "diagnose";
  const resolvingPending = pendingActionType === "mark-resolved" || pendingActionType === "mark-unresolved";
  const watchlistPending = pendingActionType === "add-to-watchlist" || pendingActionType === "remove-from-watchlist";
  const isWatched = watchlistLocalState ?? Boolean(detail.isWatched);
  const productStatusLabel = resolved ? "Resolved" : detail.productStatusLabel;
  const productStatusTone = resolved ? "success" : detail.productStatusTone;
  const storeUrl = detail.shopifyStorefrontUrl || getStorefrontUrlFromAdminUrl(detail.shopifyAdminUrl, detail.handle);
  const productMetaItems = [
    ["Handle", detail.handle || "Unavailable"],
    ["Type", detail.productType || "Product"],
    ["Vendor", detail.vendor || "Unknown vendor"],
    ["Collections", detail.collections.length ? detail.collections.join(", ") : "Uncategorized"],
  ];
  const analysisPillLabel = detail.lastAnalysis === "Not analyzed" ? "Not analyzed" : `Analyzed ${detail.lastAnalysis}`;
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

  const handleOpenRecommendedAction = (action) => {
    setSelectedRecommendedAction(action);
    setEditingAction(null);
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

  const handleRequestWatchlistToggle = () => {
    if (watchlistPending || !detail.productGid) return;
    setWatchlistConfirmation({
      mode: isWatched ? "remove" : "add",
      product: detail,
    });
  };

  const handleIgnoreIssue = (issue) => {
    const ignorePayload = buildIssueIgnorePayload(issue);
    setIgnoredIssues((current) => {
      const next = new Set(current);
      if (ignorePayload.issueKey) next.add(ignorePayload.issueKey);
      return next;
    });
    const formData = new FormData();
    formData.set("_action", "ignore-issue");
    formData.set("productId", product.slug || product.handle || "");
    formData.set("issue", ignorePayload.issue);
    formData.set("issueCode", ignorePayload.issueCode);
    formData.set("issueKey", ignorePayload.issueKey);
    formData.set("suggestedAction", ignorePayload.suggestedAction);
    submit(formData, { method: "post" });
  };

  const handleUnignoreIssue = (issue) => {
    const ignorePayload = buildIssueIgnorePayload(issue);
    setIgnoredIssues((current) => {
      const next = new Set(current);
      if (ignorePayload.issueKey) next.delete(ignorePayload.issueKey);
      return next;
    });
    const formData = new FormData();
    formData.set("_action", "unignore-issue");
    formData.set("productId", product.slug || product.handle || "");
    formData.set("issue", ignorePayload.issue);
    formData.set("issueCode", ignorePayload.issueCode);
    formData.set("issueKey", ignorePayload.issueKey);
    formData.set("suggestedAction", ignorePayload.suggestedAction);
    submit(formData, { method: "post" });
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
    setSelectedRecommendedAction(null);
    setActionConfirmation({
      action,
      editedText,
      application: application || action.application || getRecommendedActionApplication(action, product),
    });
  };

  const handleDismissAction = (action) => {
    const actionKey = getRecommendedActionKey(action);
    if (willCompleteVisibleRecommendedActions(activeRecommendedActions, minimizedActionStates, actionKey)) {
      setActionsCompleteModalOpen(true);
    }
    setMinimizedActionStates((current) => ({ ...current, [actionKey]: "dismissed" }));
    setSelectedRecommendedAction(null);
    setActionConfirmation(null);
    setEditingAction(null);
    const formData = new FormData();
    formData.set("_action", "dismiss-action");
    formData.set("productId", product.slug || product.handle || "");
    formData.set("actionId", action.id || actionKey);
    formData.set("label", action.title || action.label || "");
    dismissFetcher.submit(formData, { method: "post" });
    showToast(`${action.title} dismissed for this product.`);
  };

  const handleRestoreDismissedAction = (action) => {
    const actionKey = getRecommendedActionKey(action);
    setMinimizedActionStates((current) => ({ ...current, [actionKey]: "active" }));
    setSelectedRecommendedAction(null);
    const formData = new FormData();
    formData.set("_action", "restore-action");
    formData.set("productId", product.slug || product.handle || "");
    formData.set("actionId", action.id || actionKey);
    formData.set("label", action.title || action.label || "");
    dismissFetcher.submit(formData, { method: "post" });
    showToast(`${action.title} restored.`);
  };

  const handleMarkActionReviewed = (action) => {
    const actionKey = getRecommendedActionKey(action);
    if (willCompleteVisibleRecommendedActions(activeRecommendedActions, minimizedActionStates, actionKey)) {
      setActionsCompleteModalOpen(true);
    }
    setMinimizedActionStates((current) => ({ ...current, [actionKey]: "reviewed" }));
    setSelectedRecommendedAction(null);
    setActionConfirmation(null);
    setEditingAction(null);
    const formData = new FormData();
    formData.set("_action", "review-action");
    formData.set("productId", product.slug || product.handle || "");
    formData.set("actionId", action.id || actionKey);
    formData.set("label", action.title || action.label || "");
    dismissFetcher.submit(formData, { method: "post" });
    showToast(`${action.title} marked as reviewed.`);
  };

  const handleAddInvestigationTag = (action) => {
    const tag = getInvestigationTagForAction(action);
    if (!tag) {
      showToast("No internal tag is available for this investigation.", "validation_error");
      return;
    }
    const tagAction = {
      ...action,
      payload: {
        ...(action.payload || {}),
        tag,
      },
    };
    setSelectedRecommendedAction(null);
    setActionConfirmation({
      action: tagAction,
      editedText: tag,
      tagOverride: tag,
      application: getRecommendedActionApplication(tagAction, product),
    });
  };

  const handleExpandArchivedAction = (action) => {
    const archivedState = getArchivedActionState(action, minimizedActionStates);
    setSelectedRecommendedAction(archivedState
      ? {
          ...action,
          archivedStateOverride: archivedState,
          appliedRecord: action.appliedRecord || { status: archivedState },
        }
      : action);
  };

  return (
    <FullWidthPage label={`${detail.title} product`} className="ppProductDetailPage">
      <ScreenShell className="ppDashboard ppProductDetailScreen">
        <ProductDetailToast actionData={toastData} onDismiss={() => setToastData(null)} />

        <button className="ppProductBackButton ppProductBackButtonStandalone" type="button" onClick={handleBack}>
          <s-icon type="arrow-left" size="small"></s-icon>
          Back to products
        </button>

        <section className="ppProductDetailHeroPanel" aria-label="Product overview">
          <span className="ppProductHeroImageWrap">
            <ProductArt
              variant={detail.variant}
              label={detail.title}
              size="hero"
              imageUrl={detail.imageUrl}
              imageAlt={detail.imageAlt}
            />
            <ProductAnalysisStatusBadge product={product} showLabel={false} titleIcon completionOnly={detail.hasFullDiagnosis} />
          </span>
          <div className="ppProductDetailHeroCopy">
            <div className="ppProductTitleHeading">
              <h1>{detail.title}</h1>
            </div>
            <div className="ppProductDetailStatusRow">
              <span className={`ppProductStatusPill ppProductStatusPill-${productStatusTone}`}>{productStatusLabel}</span>
              <span className="ppProductStatusPill ppProductStatusPill-analysis">{analysisPillLabel}</span>
            </div>
            <dl className="ppProductMetaLine">
              {productMetaItems.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}:</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="ppProductHeaderActions">
            {detail.diagnosisInProgress ? (
              <span className="ppProductDiagnosisRunning">
                <span className="ppMiniSpinner" aria-hidden="true" />
                {getProductDiagnosisRunningLabel(detail.activeDiagnosisJob)}
              </span>
            ) : (
              <button className="ppSecondaryButton ppProductAnalyzeButton" type="button" disabled={!detail.canDiagnose || diagnosisPending} onClick={handleRequestProductDiagnosis}>
                <s-icon type="refresh" size="small"></s-icon>
                {diagnosisPending ? "Queueing..." : detail.hasFullDiagnosis ? "Re-analyze" : detail.diagnosisButtonLabel}
              </button>
            )}
            {storeUrl ? (
              <a
                className="ppProductStoreButton"
                href={storeUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="View product on store"
              >
                <span>View on store</span>
                <s-icon type="external" size="small"></s-icon>
              </a>
            ) : (
              <span className="ppProductStoreButton isDisabled" aria-disabled="true">
                <span>View on store</span>
                <s-icon type="external" size="small"></s-icon>
              </span>
            )}
            <ProductDetailActionsMenu
              detail={detail}
              product={product}
              open={detailActionsOpen}
              onToggle={() => setDetailActionsOpen((open) => !open)}
              onClose={() => setDetailActionsOpen(false)}
              onWatchlistToggle={handleRequestWatchlistToggle}
              isWatched={isWatched}
              watchlistPending={watchlistPending}
              resolved={resolved}
              resolvingPending={resolvingPending}
            />
          </div>
        </section>

        <div className="ppProductSummaryGrid" aria-label="Product signal summary">
          <div className="ppRiskSnapshot">
            <ProductInsightMetric
              title="Product risk"
              value={detail.riskScoreLabel}
              detail={`${detail.riskScore} / 100`}
              footnote={detail.riskTrendLabel}
              tone={detail.riskTone}
              sparkline={detail.riskTrend}
              icon="alert-circle"
            />
            <ProductInsightMetric
              title="Product Momentum"
              value={detail.productMomentum ? detail.productMomentum.tier : "Needs deep diagnosis"}
              detail={detail.productMomentum ? `${detail.productMomentum.score} / 100` : "Commercial momentum unavailable"}
              footnote={detail.productMomentum
                ? `${detail.productMomentum.display.growthLabel} 30d · ${detail.productMomentum.display.catalogPositionLabel}`
                : "Run product diagnosis to calculate recent sales strength."}
              tone={detail.productMomentum ? getProductMomentumTone(detail.productMomentum) : "neutral"}
              sparkline={detail.productMomentum?.inputs.weeklyUnitsLast4Weeks || []}
              icon="wand"
            />
            <ProductInsightMetric
              title="Diagnosis confidence"
              value={detail.confidenceLabel}
              detail={`${detail.confidence}%`}
              footnote={`Based on ${detail.signalCount} signals`}
              tone="green"
              progress={detail.confidence}
              icon="shield-check-mark"
            />
            <ProductInsightMetric
              title="Financial exposure"
              value={formatMoney(detail.estimatedImpact)}
              detail={`${formatMoney(detail.marginAtRisk)} margin at risk`}
              footnote={getFinancialExposureFootnote(detail)}
              tone="red"
              icon="cash-dollar"
            />
            <ProductInsightMetric
              title="Main issue"
              value={detail.issueCategory}
              detail={detail.issueDetail}
              tone={detail.issueTone}
              icon="product"
            />
          </div>
        </div>

        <div className="ppProductDetailLayout">
          <main className="ppProductDetailPrimary">
            <div className="ppMainFindingCard">
              <DashboardIcon type="shield-check-mark" tone={detail.findingTone} />
              <div>
                <span>AI Summary</span>
                <h2>{detail.mainFindingTitle}</h2>
                <div className="ppMainFindingText">
                  {getMainFindingParagraphs(detail.mainFindingDetail).map((paragraph, index) => (
                    <p key={`${detail.slug}-main-finding-${index}`}>{renderAnalysisText(paragraph)}</p>
                  ))}
                </div>
              </div>
            </div>

            <div className="ppProductPanel ppIssuesOverviewPanel">
                <h2>Issues detected <span>{detail.detectedIssues.length}</span></h2>
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
                        const ignorePayload = buildIssueIgnorePayload(issue);
                        const ignored = isIssueIgnored(issue, ignoredIssues);
                        const ignorePending = pendingIssueKey === ignorePayload.issueKey && pendingIssueAction === "ignore-issue";
                        const unignorePending = pendingIssueKey === ignorePayload.issueKey && pendingIssueAction === "unignore-issue";
                        const issueEvidenceText = issue.evidence?.length > 0 ? issue.evidence.slice(0, 2).join(" ") : "";

                        return (
                          <tr className={ignored ? "isIgnored" : ""} key={issue.issue}>
                            <td>
                              <span className="ppIssueNameCell">
                                <span className="ppIssueIcon" aria-hidden="true">
                                  <s-icon type={getIssueIcon(issue.issue)} size="small"></s-icon>
                                </span>
                                <span>
                                  <strong>{issue.issue}</strong>
                                  {issueEvidenceText && (
                                    <small title={issueEvidenceText}>{issueEvidenceText}</small>
                                  )}
                                </span>
                                {ignored && <s-badge tone="success">Ignored</s-badge>}
                              </span>
                            </td>
                            <td><s-badge tone={issue.tone}>{issue.severity}</s-badge></td>
                            <td>{issue.confidence}</td>
                            <td>{issue.signals}</td>
                            <td><MiniTrend tone={issue.trendTone} values={issue.trend} /></td>
                            <td title={issue.action}>{issue.action}</td>
                            <td>
                              <IssueInlineActions
                                issue={issue}
                                onReview={() => handleReviewEvidence(detail.evidenceSources.length ? index % detail.evidenceSources.length : 0)}
                                onIgnore={() => handleIgnoreIssue(issue)}
                                onUnignore={() => handleUnignoreIssue(issue)}
                                ignored={ignored}
                                pending={ignorePending || unignorePending}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            {!detail.hasFullDiagnosis ? (
              <ProductDeepDiagnosisDataPlaceholder detail={detail} />
            ) : (detail.hasMonthlyOrderActivity || detail.hasReturnRatePrediction) ? (
              <div className={`ppProductDeepResearchGrid ${detail.hasMonthlyOrderActivity && detail.hasReturnRatePrediction ? "" : "isSingle"}`.trim()}>
                {detail.hasMonthlyOrderActivity && <ProductOrderActivityPanel detail={detail} />}
                {detail.hasReturnRatePrediction && <ProductReturnRatePredictionPanel detail={detail} />}
              </div>
            ) : null}
          </main>

          <aside className="ppProductDetailSidebar">
            <ProductDetailSectionLabel number="2" title="Recommended actions" subtitle="Clear, actionable next steps" />
            <div className={`ppProductPanel ppRecommendedActionsPanel ppRecommendedActionsFull${recommendedActionsCollapsed ? " isCollapsed" : ""}`}>
              <div className="ppRecommendedActionsHeader">
                <div>
                  <h2>Recommended actions</h2>
                  <p>Prioritized next steps based on product signals and evidence.</p>
                  <span>
                    {detail.hasFullDiagnosis
                      ? `${visibleRecommendedActionCount} action${visibleRecommendedActionCount === 1 ? "" : "s"}${minimizedRecommendedActions.length ? ` / ${minimizedRecommendedActions.length} minimized` : ""}${ignoredIssues.size ? ` / ${ignoredIssues.size} ignored issue${ignoredIssues.size === 1 ? "" : "s"}` : ""}`
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
                  <div className="ppRecommendedActionsToolbar">
                    <span className="ppRecommendedActionsCountBadge">
                      <span className="ppRecommendedActionsCountIcon" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
                      {visibleRecommendedActionCount} action{visibleRecommendedActionCount === 1 ? "" : "s"}
                    </span>
                    <label className="ppRecommendedActionsSort">
                      <span>Sort recommended actions</span>
                      <select
                        value={recommendedActionSort}
                        onChange={(event) => {
                          setRecommendedActionSort(event.target.value);
                          setRecommendedActionsExpanded(false);
                        }}
                      >
                        <option value="priority">Sort by priority</option>
                        <option value="impact">Sort by impact</option>
                        <option value="confidence">Sort by confidence</option>
                        <option value="risk">Sort by lowest apply risk</option>
                        <option value="effort">Sort by lowest effort</option>
                      </select>
                    </label>
                  </div>
                  <div className="ppRecommendedActionList">
                    {!detail.hasFullDiagnosis ? (
                      <EmptyProductDetailState
                        message="Recommended actions will appear after you run the full product diagnosis for this product."
                        variant="recommendedActions"
                      />
                    ) : visibleRecommendedActions.length === 0 && minimizedRecommendedActions.length === 0 && (
                      <EmptyProductDetailState
                        message={hiddenIgnoredRecommendedActionCount
                          ? `${hiddenIgnoredRecommendedActionCount} recommendation${hiddenIgnoredRecommendedActionCount === 1 ? "" : "s"} hidden because related issues are ignored for this product.`
                          : "0 deterministic recommended actions from current stored signals."}
                        variant="recommendedActions"
                      />
                    )}
                    {displayedRecommendedActions.map((action, index) => (
                      <ProductRecommendedActionCompact
                        key={getRecommendedActionKey(action)}
                        action={action}
                        index={index}
                        onOpen={handleOpenRecommendedAction}
                      />
                    ))}
                  </div>
                  {visibleRecommendedActions.length > 3 && (
                    <button
                      className="ppRecommendedActionsMore"
                      type="button"
                      onClick={() => setRecommendedActionsExpanded((expanded) => !expanded)}
                    >
                      <span>{recommendedActionsExpanded ? "View less" : `View more${hiddenVisibleRecommendedActionCount ? ` (${hiddenVisibleRecommendedActionCount})` : ""}`}</span>
                      <s-icon type={recommendedActionsExpanded ? "chevron-up" : "chevron-down"} size="small"></s-icon>
                    </button>
                  )}
                  {minimizedRecommendedActions.length > 0 && (
                    <MinimizedRecommendedActionsTray
                      actions={minimizedRecommendedActions}
                      minimizedActionStates={minimizedActionStates}
                      onExpand={handleExpandArchivedAction}
                    />
                  )}
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

            <ProductDetailSectionLabel number="3" title="Evidence summary" subtitle="Quick summary by category" />
            <ProductEvidenceSummaryPanel detail={detail} onSelectEvidence={handleReviewEvidence} />
            <ProductRiskHistoryPanel detail={detail} />
            <ProductMomentumPanel detail={detail} />
          </aside>
        </div>

        <div className="ppProductDetailFullWidth">
          <ProductDetailSectionLabel number="4" title="Evidence by source" subtitle="Explore the evidence clearly" />
          <div ref={evidencePanelRef}>
            <EvidenceObservabilityPanel
              detail={detail}
              product={product}
              selectedEvidence={selectedEvidence}
              selectedEvidenceIndex={selectedEvidenceIndex}
              onSelectEvidence={setSelectedEvidenceIndex}
            />
          </div>
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
        {watchlistConfirmation && (
          <WatchlistConfirmModal
            confirmation={watchlistConfirmation}
            pending={watchlistPending}
            onCancel={() => setWatchlistConfirmation(null)}
          />
        )}
        {selectedRecommendedAction && !actionConfirmation && (
          <RecommendedActionDetailModal
            action={selectedRecommendedAction}
            product={product}
            pending={pendingActionId === selectedRecommendedAction.id || (selectedRecommendedAction.mode === "diagnose" && diagnosisPending)}
            onClose={() => setSelectedRecommendedAction(null)}
            onEdit={handleEditAction}
            onCopy={handleCopyAction}
            onReview={handleReviewEvidence}
            onRequestApply={handleRequestApplyAction}
            onDismiss={handleDismissAction}
            onRestoreDismiss={handleRestoreDismissedAction}
            onMarkReviewed={handleMarkActionReviewed}
            onAddInvestigationTag={handleAddInvestigationTag}
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
        {actionsCompleteModalOpen && (
          <RecommendedActionsCompleteModal
            productTitle={detail.title}
            onClose={() => setActionsCompleteModalOpen(false)}
          />
        )}
      </ScreenShell>
    </FullWidthPage>
  );
}

function ProductDetailSectionLabel({ number, title, subtitle }) {
  return (
    <div className="ppProductDetailSectionLabel">
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
    </div>
  );
}

function ProductDeepDiagnosisDataPlaceholder({ detail }) {
  return (
    <section className="ppProductDeepDiagnosisPlaceholder" aria-label="Full diagnosis required for commercial charts">
      <span className="ppProductDeepDiagnosisPlaceholderIcon" aria-hidden="true">
        <s-icon type="wand" size="large"></s-icon>
      </span>
      <div>
        <span>Full diagnosis needed</span>
        <h2>Commercial charts are not available yet</h2>
        <p>
          Monthly order activity and return-rate prediction are unlocked after a full product diagnosis.
          Run the full diagnosis for {detail.title} to calculate order history, return behavior and forward-looking return risk from stored Shopify evidence.
        </p>
      </div>
    </section>
  );
}

function ProductOrderActivityPanel({ detail }) {
  const activity = detail.monthlyOrderActivity || normalizeProductMonthlyOrderActivity(null);
  const months = activity.months || [];
  const summary = activity.summary || {};
  const hasActivity = months.some((month) => month.orders || month.returnedOrders || month.refundedOrders);
  const maxOrders = Math.max(Number(summary.maxOrders || 0), ...months.map((month) => Math.max(month.orders, month.returnedOrders, month.refundedOrders)), 1);
  const windowLabel = activity.windowDays ? `${activity.windowDays}-day window` : "Stored window";
  const rangeLabel = getMonthlyOrderActivityRangeLabel(months);

  return (
    <section className="ppProductOrderActivityPanel" aria-label="Monthly order activity">
      <div className="ppOrderActivityHeader">
        <div>
          <span>Deep research</span>
          <h2>Monthly order activity</h2>
          <p>Orders, returns and refunds for this product, grouped by the order month inside the configured analysis window.</p>
        </div>
        <div className="ppOrderActivityWindow">
          <s-icon type="calendar" size="small"></s-icon>
          <span>{windowLabel}</span>
          {rangeLabel && <small>{rangeLabel}</small>}
        </div>
      </div>

      <div className="ppOrderActivitySummary">
        <OrderActivityStat label="Total orders" value={formatInteger(summary.totalOrders)} detail={`${formatInteger(summary.totalOrderUnits)} units ordered`} tone="blue" />
        <OrderActivityStat label="Returned orders" value={formatInteger(summary.totalReturnedOrders)} detail={`${formatPercent(summary.returnRate)} of orders`} tone="amber" />
        <OrderActivityStat label="Refunded orders" value={formatInteger(summary.totalRefundedOrders)} detail={`${formatPercent(summary.refundRate)} of orders`} tone="red" />
        <OrderActivityStat label="Refund value" value={formatMoney(summary.totalRefundAmount || 0)} detail={`${formatMoney(summary.totalRevenue || 0)} ordered revenue`} tone="teal" />
      </div>

      {hasActivity ? (
        <div className="ppOrderActivityChart" role="img" aria-label={`Monthly Shopify orders chart for ${detail.title}`}>
          <OrderActivityComboChart months={months} maxOrders={maxOrders} />
          <div className="ppOrderActivityLegend" aria-label="Monthly order activity legend">
            <span><i className="ppOrderActivityLegendTotal" />Total orders</span>
            <span><i className="ppOrderActivityLegendReturns" />Returned orders</span>
            <span><i className="ppOrderActivityLegendRefunds" />Refunded orders</span>
          </div>
        </div>
      ) : (
        <EmptyProductDetailState message="No monthly Shopify order activity is stored yet. Run product diagnosis after order access is available." />
      )}
    </section>
  );
}

function ProductReturnRatePredictionPanel({ detail }) {
  const prediction = detail.returnRatePrediction || normalizeProductReturnRatePrediction(null);
  const observedPoints = prediction.observedPoints || [];
  const forecastPoints = prediction.forecastPoints || [];
  const summary = prediction.summary || {};
  const hasPrediction = observedPoints.some((point) => point.orders || point.returnedOrders) || forecastPoints.length > 0;
  const chart = getReturnRatePredictionChart(prediction);
  const actionCopy = getReturnRatePredictionActionCopy(prediction.actionAdjustment);

  return (
    <section className="ppProductReturnPredictionPanel" aria-label="Return rate prediction">
      <div className="ppReturnPredictionHeader">
        <div>
          <span>Prediction model</span>
          <h2>Return rate prediction</h2>
          <p>Weekly Shopify order cohorts, smoothed from observed return behavior and projected three months forward.</p>
        </div>
        <s-badge tone={getReturnRatePredictionConfidenceTone(summary.confidence)}>{summary.confidence || "Unavailable"} confidence</s-badge>
      </div>

      <div className="ppReturnPredictionStats">
        <OrderActivityStat
          label="Total return rate"
          value={formatPercent(summary.totalReturnRate)}
          detail={`${formatInteger(summary.totalReturnedUnits || summary.totalReturnedOrders)} of ${formatInteger(summary.totalOrderUnits || summary.totalOrders)} units`}
          tone="blue"
        />
        <OrderActivityStat label="Last 60 days" value={formatPercent(summary.last60DayReturnRate)} detail="Recent order cohorts" tone="amber" />
        <OrderActivityStat label="Last 30 days" value={formatPercent(summary.last30DayReturnRate)} detail="Current short-term signal" tone="red" />
        <OrderActivityStat label="Next 3 months" value={formatPercent(summary.forecastNext90ReturnRate)} detail={actionCopy.short} tone="teal" />
      </div>

      {hasPrediction ? (
        <>
          <div className="ppReturnPredictionChartWrap">
            <div className="ppReturnPredictionPlot">
              <div className="ppReturnPredictionYAxis" aria-hidden="true">
                <span className="ppReturnPredictionYAxisTitle">Return rate</span>
                {chart.yTicks.map((tick) => (
                  <span key={tick.label} style={{ top: `${tick.y}%` }}>{tick.label}</span>
                ))}
              </div>
              <svg className="ppReturnPredictionChart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Return rate prediction for ${detail.title}`}>
                {chart.yTicks.map((tick) => (
                  <path key={`y-${tick.label}`} className="ppReturnPredictionGridLine" d={`M 0 ${tick.y} L 100 ${tick.y}`} />
                ))}
                {chart.monthTicks.map((tick) => (
                  <path key={`month-${tick.key}`} className="ppReturnPredictionMonthLine" d={`M ${tick.x} 8 L ${tick.x} 92`} />
                ))}
                {chart.boundaryX > 0 && <path className="ppReturnPredictionBoundary" d={`M ${chart.boundaryX} 8 L ${chart.boundaryX} 92`} />}
                {chart.observedPath && <path className="ppReturnPredictionObserved" d={chart.observedPath} />}
                {chart.forecastPath && <path className="ppReturnPredictionForecast" d={chart.forecastPath} />}
              </svg>
              <div className="ppReturnPredictionXAxis">
                {chart.monthTicks.map((tick) => (
                  <span key={tick.key} style={{ left: `${tick.x}%` }}>{tick.label}</span>
                ))}
                {chart.boundaryX > 0 && <strong style={{ left: `${chart.boundaryX}%` }}>Today</strong>}
              </div>
            </div>
            <div className="ppReturnPredictionLegend">
              <span><i className="ppReturnPredictionLegendObserved" />Observed smoothed return rate</span>
              <span><i className="ppReturnPredictionLegendForecast" />Predicted next 3 months</span>
            </div>
          </div>
          <ReturnPredictionActionImpact adjustment={prediction.actionAdjustment} />
        </>
      ) : (
        <EmptyProductDetailState message="No return-rate prediction is available yet. Run product diagnosis after Shopify order and return data is available." />
      )}
    </section>
  );
}

function ProductMomentumPanel({ detail }) {
  const momentum = detail.productMomentum;
  if (!momentum) {
    return (
      <section className="ppProductMomentumPanel" aria-label="Product Momentum">
        <div className="ppProductMomentumHeader">
          <div>
            <span>Commercial signal</span>
            <h2>Product Momentum</h2>
            <p>Commercial strength is calculated from recent Shopify order velocity, growth and catalog position.</p>
          </div>
          <s-badge tone="warning">Deep diagnosis needed</s-badge>
        </div>
        <EmptyProductDetailState message="Run product diagnosis to calculate Product Momentum for this product." />
      </section>
    );
  }

  const componentRows = [
    { label: "Current velocity", value: momentum.components.currentVelocityScore, detail: "Recent units and revenue vs catalog" },
    { label: "Growth", value: momentum.components.growthScore, detail: "Last 30 days vs previous 30 days" },
    { label: "Catalog share", value: momentum.components.catalogShareScore, detail: "Product share vs its baseline" },
    { label: "Trend consistency", value: momentum.components.trendConsistencyScore, detail: "Weekly activity and direction" },
    { label: "Recency", value: momentum.components.recencyScore, detail: "How recently orders happened" },
  ];

  return (
    <section className="ppProductMomentumPanel" aria-label="Product Momentum">
      <div className="ppProductMomentumHeader">
        <div>
          <span>Commercial signal</span>
          <h2>Product Momentum</h2>
          <p>This score answers whether the product matters commercially right now. It is separate from Product Risk.</p>
        </div>
        <s-badge tone={getMomentumBadgeTone(momentum)}>{momentum.tier}</s-badge>
      </div>
      <div className="ppProductMomentumBody">
        <div className="ppProductMomentumScore">
          <strong>{momentum.score}<small>/100</small></strong>
          <span>{momentum.direction}</span>
          <p>{momentum.display.growthLabel} vs previous 30 days · {momentum.display.catalogPositionLabel}</p>
        </div>
        <ProductMomentumTrendCard momentum={momentum} />
      </div>
      <div className="ppProductMomentumBreakdown">
        {componentRows.map(({ label, value, detail: componentDetail }) => (
          <div className="ppProductMomentumComponent" key={label}>
            <span>{label}</span>
            <strong>{formatInteger(value)}</strong>
            <div aria-hidden="true"><span style={{ width: `${clampNumber(value, 0, 100)}%` }} /></div>
            <small>{componentDetail}</small>
          </div>
        ))}
      </div>
      <div className="ppProductMomentumMeta">
        <span><b>{momentum.confidenceLabel}</b> · {formatInteger(momentum.confidence)}/100</span>
        <span>{formatInteger(momentum.inputs.unitsLast30Days)} units · {formatMoney(momentum.inputs.revenueLast30Days)} revenue in the last 30 days</span>
      </div>
    </section>
  );
}

function ProductMomentumTrendCard({ momentum }) {
  const rows = getProductMomentumWeeklyRows(momentum);
  return (
    <div className="ppProductMomentumTrendCard">
      <div className="ppProductMomentumTrendHeader">
        <span>Last 4 weeks</span>
        <strong>{momentum.display.trendLabel}</strong>
      </div>
      {rows.length ? (
        <div className="ppProductMomentumTrendBars" role="img" aria-label={`Weekly units for ${momentum.tier} Product Momentum`}>
          {rows.map((row) => (
            <div className={row.isLatest ? "isLatest" : ""} key={row.label}>
              <strong>{formatInteger(row.value)}</strong>
              <span aria-hidden="true">{row.value > 0 ? <i style={{ height: `${row.height}%`, width: "100%" }} /> : null}</span>
              <small>{row.label}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="ppProductMomentumTrendEmpty">Weekly Shopify order buckets are not available for this product yet.</p>
      )}
      <p>{getProductMomentumWhyText(momentum)}</p>
    </div>
  );
}

function getProductMomentumWeeklyRows(momentum = {}) {
  const values = Array.isArray(momentum.inputs?.weeklyUnitsLast4Weeks)
    ? momentum.inputs.weeklyUnitsLast4Weeks.map((value) => Math.max(0, Number(value || 0)))
    : [];
  const max = Math.max(...values, 1);
  return values.map((value, index) => ({
    label: ["W-3", "W-2", "W-1", "Now"][index] || `W${index + 1}`,
    value,
    height: value > 0 ? clampNumber((value / max) * 100, 14, 100) : 0,
    isLatest: index === values.length - 1,
  }));
}

function getProductMomentumWhyText(momentum = {}) {
  const inputs = momentum.inputs || {};
  const weekly = Array.isArray(inputs.weeklyUnitsLast4Weeks) ? inputs.weeklyUnitsLast4Weeks.map((value) => Number(value || 0)) : [];
  const firstWeek = weekly.length ? weekly[0] : 0;
  const latestWeek = weekly.length ? weekly[weekly.length - 1] : 0;
  const weeklyDirection = latestWeek > firstWeek
    ? `weekly units rose from ${formatInteger(firstWeek)} to ${formatInteger(latestWeek)}`
    : latestWeek < firstWeek
      ? `weekly units cooled from ${formatInteger(firstWeek)} to ${formatInteger(latestWeek)}`
      : weekly.length
        ? `weekly units held at ${formatInteger(latestWeek)}`
        : "weekly order buckets are missing";
  const previousUnits = Number(inputs.unitsPrevious30Days || 0);
  const currentUnits = Number(inputs.unitsLast30Days || 0);
  const growthText = previousUnits > 0
    ? `${formatInteger(currentUnits)} units in the last 30 days vs ${formatInteger(previousUnits)} before`
    : `${formatInteger(currentUnits)} units in the last 30 days with limited prior baseline`;
  const catalogPosition = String(momentum.display?.catalogPositionLabel || "catalog baseline pending").toLowerCase();
  return `${momentum.tier} because ${growthText}, catalog position is ${catalogPosition}, and ${weeklyDirection}.`;
}

function getMomentumBadgeTone(momentum = {}) {
  const tier = String(momentum.tier || "").toLowerCase();
  if (tier.includes("hot") || tier.includes("rising")) return "success";
  if (tier.includes("cooling")) return "warning";
  return "info";
}

function getProductMomentumBarsTone(momentum = {}) {
  const tier = String(momentum.tier || "").toLowerCase();
  if (tier.includes("hot") || tier.includes("rising")) return "green";
  if (tier.includes("cooling")) return "orange";
  return "gray";
}

function getReturnRatePredictionChart(prediction = {}) {
  const observed = (prediction.observedPoints || []).map((point) => ({
    ...point,
    value: Number(point.smoothedReturnRate || 0),
    date: getReturnPredictionPointDate(point),
  }));
  const forecast = (prediction.forecastPoints || []).map((point) => ({
    ...point,
    value: Number(point.predictedReturnRate || 0),
    date: getReturnPredictionPointDate(point),
  }));
  const allValues = [...observed, ...forecast].map((point) => point.value).filter((value) => Number.isFinite(value));
  if (!allValues.length) {
    return { observedPath: "", forecastPath: "", boundaryX: 0, startLabel: "", endLabel: "", monthTicks: [], yTicks: [] };
  }
  const min = Math.max(0, Math.min(...allValues) - 4);
  const max = Math.min(100, Math.max(...allValues) + 4);
  const range = Math.max(max - min, 1);
  const totalCount = Math.max(observed.length + forecast.length - 1, 1);
  const mapPoint = (point, index) => ({
    x: Math.round((index / totalCount) * 1000) / 10,
    y: Math.round((92 - ((point.value - min) / range) * 84) * 10) / 10,
    date: point.date,
    label: point.label || point.key || "",
  });
  const observedChartPoints = observed.map((point, index) => mapPoint(point, index));
  const forecastOffset = Math.max(observed.length - 1, 0);
  const forecastChartPoints = forecast.map((point, index) => mapPoint(point, forecastOffset + index + 1));
  const boundaryX = observedChartPoints.length ? observedChartPoints[observedChartPoints.length - 1].x : 0;
  const startLabel = observed[0]?.label || observed[0]?.key || "";
  const endLabel = forecast[forecast.length - 1]?.label || forecast[forecast.length - 1]?.key || "";
  const allChartPoints = [...observedChartPoints, ...forecastChartPoints];
  return {
    observedPath: buildSmoothSvgPath(observedChartPoints),
    forecastPath: buildSmoothSvgPath(boundaryX && forecastChartPoints.length ? [observedChartPoints[observedChartPoints.length - 1], ...forecastChartPoints] : forecastChartPoints),
    boundaryX,
    startLabel,
    endLabel,
    monthTicks: buildReturnPredictionMonthTicks(allChartPoints),
    yTicks: buildReturnPredictionYAxisTicks(min, max, range),
  };
}

function getReturnPredictionPointDate(point = {}) {
  const raw = point.startAt || point.key || point.label;
  if (!raw) return null;
  const value = String(raw);
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildReturnPredictionMonthTicks(chartPoints = []) {
  const ticks = [];
  const seen = new Set();
  chartPoints.forEach((point) => {
    if (!point.date) return;
    const key = `${point.date.getUTCFullYear()}-${String(point.date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (seen.has(key)) return;
    seen.add(key);
    ticks.push({
      key,
      x: clampNumber(point.x, 0, 100),
      label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(point.date),
    });
  });
  return ticks;
}

function buildReturnPredictionYAxisTicks(min, max, range) {
  const values = [max, min + range / 2, min]
    .map((value) => Math.round(clampNumber(value, 0, 100) * 10) / 10);
  return [...new Set(values)].map((value) => ({
    value,
    label: formatPercent(value),
    y: Math.round((92 - ((value - min) / Math.max(range, 1)) * 84) * 10) / 10,
  }));
}

function getReturnRatePredictionActionCopy(adjustment = null) {
  if (!adjustment) {
    return {
      short: "No action adjustment",
    };
  }
  if (adjustment.direction === "improving") {
    return {
      short: "Improved by handled actions",
    };
  }
  if (adjustment.direction === "worsening") {
    return {
      short: "Worse with open actions",
    };
  }
  return {
    short: "Neutral action impact",
  };
}

function getReturnRatePredictionConfidenceTone(confidence) {
  const normalized = String(confidence || "").toLowerCase();
  if (normalized.includes("high")) return "success";
  if (normalized.includes("medium")) return "warning";
  if (normalized.includes("low")) return "info";
  return "neutral";
}

function OrderActivityStat({ label, value, detail, tone }) {
  return (
    <div className={`ppOrderActivityStat ppOrderActivityStat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function OrderActivityComboChart({ months = [], maxOrders = 1 }) {
  const axisMax = getOrderActivityAxisMax(maxOrders);
  const ticks = getOrderActivityAxisTicks(axisMax);
  const returnPath = getOrderActivityLinePath(months, "returnedOrders", axisMax);
  const refundPath = getOrderActivityLinePath(months, "refundedOrders", axisMax);

  return (
    <div className="ppOrderActivityCombo">
      <div className="ppOrderActivityYAxis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.value} style={{ top: `${tick.y}%` }}>{formatInteger(tick.value)}</span>
        ))}
      </div>
      <div className="ppOrderActivityPlotFrame">
        <div className="ppOrderActivityGridLines" aria-hidden="true">
          {ticks.map((tick) => <span key={tick.value} style={{ top: `${tick.y}%` }} />)}
        </div>
        <div className="ppOrderActivityBars" style={{ gridTemplateColumns: `repeat(${Math.max(months.length, 1)}, minmax(0, 1fr))` }}>
          {months.map((month) => (
            <OrderActivityMonthBar key={month.key || month.label} month={month} maxOrders={axisMax} />
          ))}
        </div>
        <svg className="ppOrderActivityLineOverlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {returnPath && <path className="ppOrderActivityLine ppOrderActivityLineReturns" d={returnPath} />}
          {refundPath && <path className="ppOrderActivityLine ppOrderActivityLineRefunds" d={refundPath} />}
        </svg>
      </div>
      <div className="ppOrderActivityXAxis" style={{ gridTemplateColumns: `repeat(${Math.max(months.length, 1)}, minmax(0, 1fr))` }}>
        {months.map((month) => (
          <span key={month.key || month.label} title={`${month.label}: ${formatInteger(month.orders)} orders`}>
            <b>{formatInteger(month.orders)}</b>
            <small>{month.shortLabel || month.label}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function OrderActivityMonthBar({ month, maxOrders }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const orderHeight = getOrderActivityBarHeight(month.orders, maxOrders);
  const title = `${month.label}: ${formatInteger(month.orders)} orders, ${formatInteger(month.returnedOrders)} returned, ${formatInteger(month.refundedOrders)} refunded`;

  return (
    <button
      type="button"
      className="ppOrderActivityMonth"
      ref={triggerRef}
      aria-label={title}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="ppOrderActivityBarShell" aria-hidden="true">
        <span className="ppOrderActivityBar ppOrderActivityBarTotal" style={{ height: `${orderHeight}%` }} />
      </div>
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppOrderActivityPopover" width={268} estimatedHeight={178} placement="top-center">
        <span className="ppOrderActivityPopoverHeader">
          <strong>{month.label || month.shortLabel}</strong>
          <small>{formatMoney(month.revenue || 0)} revenue</small>
        </span>
        <span className="ppOrderActivityPopoverRows">
          <span><b>Total orders</b><strong>{formatInteger(month.orders)}</strong><small>{formatInteger(month.orderUnits)} units</small></span>
          <span><b>Returns</b><strong>{formatInteger(month.returnedOrders)}</strong><small>{formatPercent(month.returnRate)}</small></span>
          <span><b>Refunds</b><strong>{formatInteger(month.refundedOrders)}</strong><small>{formatPercent(month.refundRate)}</small></span>
        </span>
        <span className="ppOrderActivityPopoverFooter">
          Refund value: <strong>{formatMoney(month.refundAmount || 0)}</strong>
        </span>
      </FloatingTablePopover>
    </button>
  );
}

function getOrderActivityBarHeight(value, maxValue) {
  const count = Number(value || 0);
  if (!count) return 0;
  return Math.max(8, Math.min(100, (count / Math.max(Number(maxValue || 1), 1)) * 100));
}

function getOrderActivityAxisMax(value) {
  const max = Math.max(Number(value || 0), 1);
  const magnitude = max <= 10 ? 5 : max <= 50 ? 10 : max <= 100 ? 25 : 50;
  return Math.ceil(max / magnitude) * magnitude;
}

function getOrderActivityAxisTicks(axisMax) {
  const max = Math.max(Number(axisMax || 0), 1);
  return [1, 0.75, 0.5, 0.25, 0].map((ratio) => {
    const value = Math.round(max * ratio);
    return {
      value,
      y: Math.round((100 - (value / max) * 100) * 10) / 10,
    };
  });
}

function getOrderActivityLinePath(months = [], key, axisMax) {
  const count = months.length;
  if (!count) return "";
  const max = Math.max(Number(axisMax || 0), 1);
  const points = months.map((month, index) => {
    const value = Math.max(0, Number(month[key] || 0));
    return {
      x: Math.round((((index + 0.5) / count) * 100) * 10) / 10,
      y: Math.round((100 - (value / max) * 100) * 10) / 10,
    };
  });
  return buildSmoothSvgPath(points);
}

function ReturnPredictionActionImpact({ adjustment = null }) {
  if (!adjustment) {
    return (
      <div className="ppReturnPredictionActionImpact ppReturnPredictionActionImpact-neutral">
        <div>
          <s-icon type="info" size="small"></s-icon>
          <strong>No action impact yet</strong>
          <span>Complete recommended actions to let ProductPulse lower the forecast path on refresh.</span>
        </div>
      </div>
    );
  }
  const pending = Number(adjustment.pending || 0);
  const applied = Number(adjustment.applied || 0);
  const reviewed = Number(adjustment.reviewed || 0);
  const dismissed = Number(adjustment.dismissed || 0);
  const total = Number(adjustment.total || pending + applied + reviewed + dismissed || 0);
  const handled = Number(adjustment.handled || applied + reviewed + dismissed);
  const handledPercent = total ? Math.round((handled / total) * 100) : 0;
  const shift = Number(adjustment.adjustmentPoints || 0);
  const direction = shift < 0 ? "improving" : shift > 0 ? "worsening" : "neutral";
  const shiftLabel = `${shift > 0 ? "+" : ""}${Math.round(shift * 10) / 10} pts`;

  return (
    <div className={`ppReturnPredictionActionImpact ppReturnPredictionActionImpact-${direction}`}>
      <div className="ppReturnPredictionActionImpactHeader">
        <span>
          <s-icon type={direction === "improving" ? "check" : direction === "worsening" ? "alert-circle" : "info"} size="small"></s-icon>
          <strong>Recommendation impact</strong>
        </span>
        <b>{shiftLabel}</b>
      </div>
      <div className="ppReturnPredictionActionProgress" aria-label={`${handled} of ${total} recommendations handled`}>
        <span style={{ width: `${Math.max(0, Math.min(100, handledPercent))}%` }} />
      </div>
      <div className="ppReturnPredictionActionCounts">
        <span><b>{applied}</b> applied</span>
        <span><b>{reviewed}</b> reviewed</span>
        <span><b>{dismissed}</b> dismissed</span>
        <span><b>{pending}</b> open</span>
      </div>
      <p>Applied or reviewed recommendations pull the forecast downward after the next diagnosis refresh.</p>
    </div>
  );
}

function getMonthlyOrderActivityRangeLabel(months = []) {
  const activeMonths = months.filter((month) => month.orders || month.returnedOrders || month.refundedOrders);
  const range = activeMonths.length ? activeMonths : months;
  const first = range[0];
  const last = range[range.length - 1];
  if (!first || !last) return "";
  if ((first.label || first.key) === (last.label || last.key)) return first.label || first.key;
  return `${first.label || first.key} to ${last.label || last.key}`;
}

function ProductEvidenceSummaryPanel({ detail, onSelectEvidence }) {
  const evidenceRows = detail.evidenceSources.slice(0, 7);

  return (
    <div className="ppProductEvidenceSummaryPanel">
      <div className="ppEvidenceSummaryList">
        {evidenceRows.map((source, index) => (
          <EvidenceSummaryCompactRow
            key={source.title}
            source={source}
            onSelect={() => onSelectEvidence(index)}
          />
        ))}
        {evidenceRows.length === 0 && (
          <div className="ppEvidenceSummaryEmpty">
            <EmptyProductDetailState message="0 evidence sources stored for this product yet." />
          </div>
        )}
      </div>

      {detail.evidenceSources.length > 0 && (
        <button className="ppEvidenceSummaryViewAll" type="button" onClick={() => onSelectEvidence(0)}>
          View all sources ({formatInteger(detail.evidenceSources.length)})
          <s-icon type="chevron-right" size="small"></s-icon>
        </button>
      )}
    </div>
  );
}

function EvidenceSummaryCompactRow({ source, onSelect }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const signalCount = Number(source.points?.length || 0);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <>
      <button
        className="ppEvidenceSummaryRow"
        type="button"
        ref={triggerRef}
        onClick={onSelect}
        onBlur={handleClose}
        onFocus={handleOpen}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        <span className={`ppEvidenceSummaryIcon ppEvidenceTone-${source.tone}`} aria-hidden="true">
          <ProductPulseGlyph type={source.icon} />
        </span>
        <strong>{source.title}</strong>
        <em>{formatInteger(signalCount)}</em>
      </button>
      <FloatingTablePopover
        anchorRef={triggerRef}
        open={open}
        className="ppEvidenceSummaryPopover"
        width={300}
        estimatedHeight={132}
        placement="bottom-end"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        <strong>{source.title}</strong>
        <p>{source.summary}</p>
        {source.points?.slice(0, 2).map((point) => (
          <span className="ppEvidenceSummaryPopoverPoint" key={point}>{point}</span>
        ))}
        <small>{formatInteger(signalCount)} signal{signalCount === 1 ? "" : "s"} stored</small>
      </FloatingTablePopover>
    </>
  );
}

function ProductRiskHistoryPanel({ detail }) {
  const historyPoints = getProductRiskHistoryPoints(detail);
  const chart = getProductRiskHistoryChart(historyPoints);
  const latest = historyPoints[historyPoints.length - 1] || null;
  const previous = historyPoints.length > 1 ? historyPoints[historyPoints.length - 2] : null;
  const currentRisk = latest ? latest.riskScore : Number(detail.riskScore || 0);
  const trendTone = getTrendTone(historyPoints.map((point) => point.riskScore), currentRisk);
  const change = latest && previous ? latest.riskScore - previous.riskScore : 0;
  const hasSavedHistory = historyPoints.some((point) => point.kind === "history");
  const changeLabel = getProductRiskHistoryChangeLabel(change, hasSavedHistory);
  const windowLabel = getProductRiskHistoryWindowLabel(historyPoints, hasSavedHistory);

  return (
    <div className={`ppProductRiskHistoryPanel ppProductRiskHistoryPanel-${trendTone}`}>
      <div className="ppProductRiskHistoryHeader">
        <div>
          <span>Product risk over time</span>
          <strong>{formatInteger(currentRisk)} / 100</strong>
        </div>
        <s-badge tone={getBadgeToneFromTrendTone(trendTone)}>{detail.riskTrendLabel}</s-badge>
      </div>
      <div className="ppProductRiskHistoryChart" aria-label="Product risk history chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={changeLabel}>
          <path className="ppProductRiskHistoryLine" d={buildSmoothSvgPath(chart.points)} />
        </svg>
      </div>
      <div className="ppProductRiskHistoryMeta">
        <span>
          <s-icon type="chart-line" size="small"></s-icon>
          {changeLabel}
        </span>
        <small>{windowLabel}</small>
      </div>
      {latest?.primaryIssue && (
        <p className="ppProductRiskHistoryIssue">{latest.primaryIssue}</p>
      )}
    </div>
  );
}

function getProductRiskHistoryPoints(detail = {}) {
  const savedHistory = (Array.isArray(detail.riskHistory) ? detail.riskHistory : [])
    .map((entry, index) => {
      const riskScore = Number(entry.riskScore);
      if (!Number.isFinite(riskScore)) return null;
      return {
        kind: "history",
        riskScore: Math.max(0, Math.min(100, Math.round(riskScore))),
        label: entry.recordedAt ? formatProductAnalysisDate(entry.recordedAt) : `Analysis ${index + 1}`,
        source: getProductRiskHistorySourceLabel(entry.source),
        recordedAt: entry.recordedAt || null,
        primaryIssue: entry.primaryIssue || "",
      };
    })
    .filter(Boolean);

  if (savedHistory.length) return savedHistory;

  const trendValues = (Array.isArray(detail.riskTrend) ? detail.riskTrend : [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (trendValues.length) {
    return trendValues.map((value, index) => ({
      kind: "trend",
      riskScore: Math.max(0, Math.min(100, Math.round(value))),
      label: index === trendValues.length - 1 ? "Current" : `Point ${index + 1}`,
      source: "Stored risk trend",
      recordedAt: null,
      primaryIssue: "",
    }));
  }

  if (Number.isFinite(Number(detail.riskScore))) {
    return [{
      kind: "current",
      riskScore: Math.max(0, Math.min(100, Math.round(Number(detail.riskScore)))),
      label: "Current",
      source: "Current snapshot",
      recordedAt: null,
      primaryIssue: "",
    }];
  }

  return [];
}

function getProductRiskHistoryChart(historyPoints = []) {
  const values = historyPoints.map((point) => point.riskScore);
  if (!values.length) return { path: "", points: [] };
  if (values.length === 1) {
    const y = Math.round((100 - values[0]) * 10) / 10;
    return {
      path: `0,${y} 100,${y}`,
      points: [{ x: 0, y }, { x: 100, y }],
    };
  }
  const min = Math.max(0, Math.min(...values) - 6);
  const max = Math.min(100, Math.max(...values) + 6);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => ({
    x: Math.round((index / (values.length - 1)) * 1000) / 10,
    y: Math.round((100 - ((value - min) / range) * 100) * 10) / 10,
  }));
  return {
    path: points.map((point) => `${point.x},${point.y}`).join(" "),
    points,
  };
}

function parseSvgPointString(value = "") {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter(Boolean);
}

function buildSmoothSvgPath(points = []) {
  const source = (Array.isArray(points) ? points : [])
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!source.length) return "";
  if (source.length === 1) return `M ${source[0].x},${source[0].y}`;
  if (source.length === 2) return `M ${source[0].x},${source[0].y} L ${source[1].x},${source[1].y}`;

  const commands = [`M ${source[0].x},${source[0].y}`];
  for (let index = 1; index < source.length - 1; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    const midX = Math.round(((current.x + next.x) / 2) * 10) / 10;
    const midY = Math.round(((current.y + next.y) / 2) * 10) / 10;
    commands.push(`Q ${current.x},${current.y} ${midX},${midY}`);
  }
  const last = source[source.length - 1];
  commands.push(`L ${last.x},${last.y}`);
  return commands.join(" ");
}

function getProductRiskHistoryChangeLabel(change, hasSavedHistory) {
  if (!hasSavedHistory) return "Waiting for another saved analysis";
  if (change > 0) return `Up ${Math.abs(change)} pts since last analysis`;
  if (change < 0) return `Down ${Math.abs(change)} pts since last analysis`;
  return "Stable since last analysis";
}

function getProductRiskHistoryWindowLabel(points = [], hasSavedHistory = false) {
  if (!hasSavedHistory) return "Saved history appears after QuickScan or deep diagnostics run again.";
  const first = points[0];
  const last = points[points.length - 1];
  if (first?.recordedAt && last?.recordedAt && first.recordedAt !== last.recordedAt) {
    return `${points.length} saved scores · ${first.label} to ${last.label}`;
  }
  return `${points.length} saved score${points.length === 1 ? "" : "s"}`;
}

function getProductRiskHistorySourceLabel(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("full")) return "Deep diagnosis";
  if (normalized.includes("quick")) return "QuickScan";
  if (normalized.includes("watch")) return "Watchlist scan";
  return source ? String(source) : "ProductPulse";
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
  const [impactBreakdownKey, setImpactBreakdownKey] = useState(analyticsView.impactBreakdown?.defaultKey || "collection");
  const kpis = analyticsView.kpis || [];
  const businessImpact = analyticsView.businessImpact || { title: "Estimated business impact", subtitle: "", metrics: [] };
  const riskBubbles = analyticsView.riskBubbles || [];
  const impactTrend = analyticsView.impactTrend || { series: [], labels: [] };
  const issueImpact = analyticsView.issueImpact || { rows: [] };
  const impactBreakdown = analyticsView.impactBreakdown || { defaultKey: "collection", filters: [] };
  const breakdownFilters = impactBreakdown.filters || [];
  const selectedBreakdown = breakdownFilters.find((filter) => filter.key === impactBreakdownKey)
    || breakdownFilters.find((filter) => filter.key === impactBreakdown.defaultKey)
    || breakdownFilters[0]
    || { key: "collection", label: "By collection", rows: [] };
  const actionPerformance = analyticsView.actionPerformance || { rows: [], effectiveness: [] };
  const catalogCoverage = analyticsView.catalogCoverage || { rows: [] };
  const evidenceSourceCoverage = analyticsView.evidenceSourceCoverage || [];
  const topProductsAtRisk = analyticsView.topProductsAtRisk || [];

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
          <AnalyticsPanel title="Risk vs. margin impact" subtitle="X: product risk · Y: margin at risk · Bubble size: revenue at risk" className="ppAnalyticsPanelRiskMargin">
            <RiskRevenueBubbleChart bubbles={riskBubbles} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Margin at risk over time" subtitle="Current total vs. reconstructed trend-weighted exposure" className="ppAnalyticsPanelTrend">
            <AnalyticsTrendChart chart={impactTrend} ariaLabel="Margin at risk over time" />
          </AnalyticsPanel>

          <AnalyticsPanel title="Issue impact by type" subtitle="Issue types ranked by business exposure, not just raw signal volume" className="ppAnalyticsPanelIssueImpact">
            <IssueImpactTable rows={issueImpact.rows} />
          </AnalyticsPanel>

          <AnalyticsPanel
            title="Impact breakdown"
            subtitle="Slice margin exposure by Shopify catalog dimensions and evidence source"
            className="ppAnalyticsPanelBreakdown"
          >
            <AnalyticsBreakdownTabs filters={breakdownFilters} selectedKey={selectedBreakdown.key} onChange={setImpactBreakdownKey} />
            <ImpactBreakdownPanel breakdown={selectedBreakdown} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Action performance" subtitle="Recommended-action workflow health and post-fix measurement readiness" className="ppAnalyticsPanelActionPerformance">
            <ActionPerformancePanel performance={actionPerformance} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Catalog coverage" subtitle="How representative the current analytics set is" className="ppAnalyticsPanelCatalogCoverage">
            <CatalogCoveragePanel coverage={catalogCoverage} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Evidence source coverage" subtitle="Evidence coverage, contribution and source state" className="ppAnalyticsPanelSourceCoverage">
            <EvidenceSourceCoveragePanel rows={evidenceSourceCoverage} />
          </AnalyticsPanel>
        </div>

        <div className="ppAnalyticsBottom">
          <AnalyticsPanel title="Top products at risk" subtitle="Top 5 products ranked by operational priority" className="ppAnalyticsPanelTopProducts">
            <TopProductsAtRiskTable rows={topProductsAtRisk} />
          </AnalyticsPanel>

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
        <a href="#watchlist">Watchlist</a>
        <a href="#diagnosis">Diagnosis</a>
        <a href="#analytics">Analytics</a>
      </nav>
      <section id="connect"><ConnectScreen data={data} /></section>
      <section id="products"><ProductsScreen data={data} filters={{ query: "", risk: "all" }} /></section>
      <section id="watchlist"><WatchlistScreen data={{ watchlist: getPreviewWatchlistData(data) }} /></section>
      <section id="diagnosis"><ProductDiagnosisScreen product={data.startHere} data={data} actionData={actionData} /></section>
      <section id="analytics"><AnalyticsScreen data={data} /></section>
    </main>
  );
}

function getPreviewWatchlistData(data = {}) {
  const product = data.startHere || {};
  return {
    maxProducts: 5,
    watchedCount: product.title ? 1 : 0,
    slotsAvailable: product.title ? 4 : 5,
    rows: product.title ? [{
      id: "preview-watch-1",
      productGid: product.productGid || product.id || "gid://shopify/Product/preview",
      title: product.title,
      handle: product.handle || product.slug || "",
      sku: product.sku || "WATCH-PREVIEW",
      status: "Watching",
      statusTone: "success",
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt || product.title,
      href: product.href || "/app/products",
      riskScore: product.riskScore || 63,
      riskLabel: product.risk || "Medium",
      riskTone: product.riskTone || "warning",
      latestChange: "New product quality issue",
      latestChangeDetail: product.issue || "Product quality signal detected",
      latestChangeTone: "orange",
      lastIssue: product.lastAnalysis ? `Updated ${product.lastAnalysis}` : "Detected 6h ago",
      lastIssueDetail: "May 18, 2:02 AM",
      latestChangeReport: {
        status: "changed",
        narrative: "Since the last run, negative reviews increased 5 -> 6, the top return reason shifted to color, and evidence signals rose 19 -> 21.",
        headline: "4 meaningful Watchlist changes were detected since the previous run.",
        changeCount: 4,
        previousRunAt: "2026-05-17T19:41:00.000Z",
        currentRunAt: "2026-05-17T19:43:00.000Z",
        current: {
          riskLabel: product.risk || "Medium",
          riskScore: product.riskScore || 68,
          confidence: product.confidence || 80,
          primaryIssue: product.issue || "Product quality",
          returnRatePercent: product.returnRatePercent || 100,
          productMomentumTier: product.productMomentumTier || "Rising",
          productMomentumScore: product.productMomentumScore || 65,
        },
        sections: [
          {
            id: "evidence",
            title: "Evidence movement",
            tone: "green",
            changes: [
              { id: "evidence-signals", label: "Evidence signals", from: "19", to: "21", delta: "+2", direction: "up", detail: "More evidence signals were detected in the latest run." },
              { id: "new-reviews", label: "New reviews", from: "0", to: "1", delta: "+1", direction: "up", detail: "One new review was captured since the previous Watchlist run." },
              { id: "negative-sentiment", label: "Negative sentiment", from: "0", to: "1", delta: "+1", direction: "up", detail: "New customer language changed the sentiment profile." },
            ],
          },
          {
            id: "financial",
            title: "Financial exposure",
            tone: "purple",
            changes: [
              { id: "revenue-at-risk", label: "Revenue at risk", from: "$1,799", to: "$1,801", delta: "+$2", direction: "up", detail: "Revenue exposure increased slightly based on latest evidence." },
              { id: "margin-at-risk", label: "Margin at risk", from: "$320", to: "$329", delta: "+$9", direction: "up", detail: "Margin exposure moved with the current product state." },
            ],
          },
        ],
        sourceInsights: [
          {
            id: "review-evidence",
            title: "Review evidence changed",
            tone: "blue",
            metric: "+1 New review",
            summary: "The newest review added one negative sentiment signal to the Watchlist comparison.",
            bullets: [
              "New review ratings: 1 Star.",
              "New review sentiment: 1 negative, 0 neutral, 0 positive.",
              "Representative review: \"The product felt different than expected and needs clearer guidance.\"",
            ],
          },
          {
            id: "product-content",
            title: "Product content changed",
            tone: "blue",
            metric: "PDP content updated",
            summary: "Product content was rechecked and contributes updated content-quality context.",
            bullets: [
              "Description now has 264 words.",
              "Current content quality score: 75.",
              "Detected content issues: Missing customer guidance, Missing specifications.",
            ],
          },
        ],
      },
    }] : [],
    mock: {},
  };
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

function ProductPulseGlyph({ type }) {
  if (type === "ai-evidence-synthesis") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-aiEvidence" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M5.5 15.5C7.2 14.1 8.55 12.35 9.6 10.25C10.1 9.25 11.55 9.25 12.05 10.25L12.35 10.85C12.85 11.85 14.25 11.95 14.9 11.05L16.8 8.45" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 18H18.5" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
        <path d="M17.8 3.7L18.35 5.25L19.9 5.8L18.35 6.35L17.8 7.9L17.25 6.35L15.7 5.8L17.25 5.25L17.8 3.7Z" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.4 4.6L6.75 5.55L7.7 5.9L6.75 6.25L6.4 7.2L6.05 6.25L5.1 5.9L6.05 5.55L6.4 4.6Z" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "customer-language-analysis") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-customerLanguage" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M6 7.5C6 6.11929 7.11929 5 8.5 5H15.5C16.8807 5 18 6.11929 18 7.5V12.5C18 13.8807 16.8807 15 15.5 15H11L7.5 18V15.5C6.67157 15.5 6 14.8284 6 14V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 9H14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 12H12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="17.5" cy="17.5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M19.3 19.3L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "shopify-returns") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-shopifyReturns" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M8.5 8.5H16.2C18.35 8.5 20.1 10.25 20.1 12.4C20.1 14.55 18.35 16.3 16.2 16.3H9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M9 5.5L6 8.5L9 11.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.4 16.3H7.8C5.65 16.3 3.9 14.55 3.9 12.4C3.9 11.25 4.4 10.22 5.2 9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M14.4 13.3L17.4 16.3L14.4 19.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "csv-reviews") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-csvReviews" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M8 4.75H14L18 8.75V18C18 19.1046 17.1046 20 16 20H8C6.89543 20 6 19.1046 6 18V6.75C6 5.64543 6.89543 4.75 8 4.75Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 4.75V8.75H18" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 10.2L12.7416 11.7024L14.4 11.9434L13.2 13.1136L13.4832 14.7651L12 13.985L10.5168 14.7651L10.8 13.1136L9.6 11.9434L11.2584 11.7024L12 10.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "shopify-refunds") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-shopifyRefunds" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M14.6 9.2C14.1 8.5 13.2 8 12.1 8C10.7 8 9.8 8.7 9.8 9.8C9.8 10.9 10.8 11.4 12.3 11.7C13.8 12 14.8 12.5 14.8 13.8C14.8 15 13.7 16 12 16C10.7 16 9.6 15.5 8.9 14.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 6.9V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 16V17.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7.4 14.5L8.9 14.6L8.8 16.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "shopify-product") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-shopifyProduct" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M12 3.8L18.6 7.55V15.95L12 19.8L5.4 15.95V7.55L12 3.8Z" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
        <path d="M5.6 7.7L12 11.45L18.4 7.7" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
        <path d="M12 11.45V19.4" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
        <path d="M9.1 5.45L15.6 9.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" opacity="0.9" />
        <path d="M15.2 13.2L16.1 12.3L17 13.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16.1 12.3V15.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "shopify-orders") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-shopifyOrders" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M8 7V6.1C8 3.83563 9.79086 2 12 2C14.2091 2 16 3.83563 16 6.1V7" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
        <path d="M6.6 7H17.4C18.2837 7 19 7.71634 19 8.6V18.3C19 19.1837 18.2837 19.9 17.4 19.9H6.6C5.71634 19.9 5 19.1837 5 18.3V8.6C5 7.71634 5.71634 7 6.6 7Z" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
        <path d="M8.6 11H15.4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
        <path d="M8.6 14H13" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
        <path d="M15.3 14.1L16.1 14.9L17.5 13.4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "variants") {
    return (
      <svg className="ppProductPulseSvgIcon ppProductPulseSvgIcon-variants" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M7.5 5.2H10.5C11.3284 5.2 12 5.87157 12 6.7V9.7C12 10.5284 11.3284 11.2 10.5 11.2H7.5C6.67157 11.2 6 10.5284 6 9.7V6.7C6 5.87157 6.67157 5.2 7.5 5.2Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13.5 12.8H16.5C17.3284 12.8 18 13.4716 18 14.3V17.3C18 18.1284 17.3284 18.8 16.5 18.8H13.5C12.6716 18.8 12 18.1284 12 17.3V14.3C12 13.4716 12.6716 12.8 13.5 12.8Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M15 5.2H18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16.5 3.7V6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 16H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7.5 14.5V17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "thumb-up" || type === "thumb-down") {
    return (
      <svg className={`ppThumbGlyph ppThumbGlyph-${type === "thumb-down" ? "down" : "up"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7.2 10.6v9.1" />
        <path d="M3.8 10.9h3.4v8.4H3.8z" />
        <path d="M7.2 11.1l4.1-7.4c.4-.8 1.6-.6 1.8.3l.3 1.7c.2 1-.1 2-.8 2.8l-1 1.1h5.7c1.1 0 1.9 1 1.7 2l-1.1 5.8c-.2 1.4-1.4 2.4-2.8 2.4H7.2" />
      </svg>
    );
  }
  if (type === "binoculars") {
    return (
      <svg className="ppBinocularsIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.2" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M12 2.8v3.1" />
        <path d="M12 18.1v3.1" />
        <path d="M2.8 12h3.1" />
        <path d="M18.1 12h3.1" />
        <path d="M12 12l5.2-5.2" />
        <path d="M7.7 8.7a6.2 6.2 0 0 1 8.6 0" />
      </svg>
    );
  }
  if (type === "pause") {
    return <span className="ppPauseGlyph" aria-hidden="true"><span /><span /></span>;
  }
  if (type === "trash") {
    return (
      <svg className="ppTrashIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4.5 6.5h15" />
        <path d="M9.5 6.5V4.8c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2v1.7" />
        <path d="M7.2 6.5l.7 12.1c.1 1 .8 1.8 1.9 1.8h4.4c1.1 0 1.8-.8 1.9-1.8l.7-12.1" />
        <path d="M10.4 10.1v6.4" />
        <path d="M13.6 10.1v6.4" />
      </svg>
    );
  }
  return <s-icon type={type || "info"}></s-icon>;
}

function DashboardIcon({ type, tone = "blue", size = "base" }) {
  return (
    <span className={`ppDashboardIcon ppDashboardIcon-${tone} ppDashboardIcon-${size}`} aria-hidden="true">
      <ProductPulseGlyph type={type} />
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

function DashboardPriorityProducts({ products }) {
  const rows = Array.isArray(products) ? products : [];
  return (
    <div className="ppDashboardPanel ppPriorityProductsPanel">
      <div className="ppDashboardPanelHeader">
        <h2>Priority products</h2>
        <span>Products with important open actions, ranked by priority and exposure.</span>
      </div>
      <div className="ppPriorityProductList">
        {rows.length ? rows.map((product) => (
          <Link className="ppPriorityProductItem" to={product.href || "/app/products"} key={product.id || product.title}>
            <span className={`ppPriorityProductRank ppPriorityProductRank-${product.riskTone || "neutral"}`}>{product.rank}</span>
            <span>
              <strong>{product.title}</strong>
              <small>{product.riskLabel} · {product.marginAtRiskLabel} margin at risk · {product.issueLabel}</small>
            </span>
            <em>{product.actionLabel}</em>
            <s-icon type="chevron-right" size="small"></s-icon>
          </Link>
        )) : (
          <div className="ppPriorityProductEmpty">
            <s-icon type="check" size="small"></s-icon>
            <span>No priority products with important pending actions.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardActionQueue({ queue }) {
  const rows = Array.isArray(queue?.rows) ? queue.rows : [];
  return (
    <div className="ppDashboardPanel ppActionQueuePanel">
      <div className="ppDashboardPanelHeader">
        <h2>Action queue</h2>
        <span>{queue?.detail || "Recommended actions waiting for review."}</span>
      </div>
      <div className="ppActionQueueTotal">
        <strong>{queue?.totalLabel || "0"}</strong>
        <span>pending actions</span>
      </div>
      <div className="ppActionQueueList">
        {rows.map((row) => (
          <Link className="ppActionQueueItem" to={row.href || "/app/products"} key={row.label}>
            <span className={`ppActionQueueIcon ppActionQueueIcon-${row.tone || "blue"}`}>
              <s-icon type={row.icon || "wand"} size="small"></s-icon>
            </span>
            <span>
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </span>
            <em>{row.valueLabel}</em>
          </Link>
        ))}
      </div>
    </div>
  );
}

function DashboardTopActiveIssues({ issues }) {
  const rows = Array.isArray(issues) ? issues : [];
  return (
    <div className="ppDashboardPanel ppTopActiveIssuesPanel">
      <div className="ppDashboardPanelHeader">
        <h2>Top active issue types</h2>
        <span>Ranked by affected products and margin exposure, not raw signal count.</span>
      </div>
      <div className="ppTopIssueTable" role="table" aria-label="Top active issue types">
        <div role="row">
          <span role="columnheader">Issue type</span>
          <span role="columnheader">Products affected</span>
          <span role="columnheader">Margin at risk</span>
        </div>
        {rows.map((issue) => (
          <div role="row" key={issue.label}>
            <strong role="cell">{issue.label}</strong>
            <span role="cell">{issue.productsLabel}</span>
            <em role="cell">{issue.marginAtRiskLabel}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardCoverageSummary({ summary }) {
  const sources = Array.isArray(summary?.sources) ? summary.sources : [];
  const catalog = summary?.catalogCoverage || {};
  const productPulseCoverage = summary?.productPulseCoverage || summary?.quickScanCatalogCoverage || {};
  return (
    <div className="ppDashboardPanel ppCoverageSummaryPanel">
      <div className="ppDashboardPanelHeader">
        <h2>Data coverage / scan coverage</h2>
        <span>{summary?.detail || "Coverage updates as products are scanned and sources connect."}</span>
      </div>
      <div className="ppCoverageSummaryGrid">
        <div className={`ppCoverageSummaryStatus ppCoverageSummaryStatus-${summary?.tone || "blue"}`}>
          <span className="ppCoverageStatusIcon" aria-hidden="true">
            <s-icon type={summary?.icon || "check"} size="small"></s-icon>
          </span>
          <span className="ppCoverageStatusCopy">
            <strong>{summary?.statusLabel || "No scan data"}</strong>
            <small>{summary?.coverageLine || "Run QuickScan to build coverage."}</small>
          </span>
          <div className="ppCoverageStatusSources ppCoverageSourcePills">
            {sources.map((source) => (
              <DashboardCoverageSourcePill source={source} key={source.label} />
            ))}
          </div>
        </div>
        <DashboardCoverageMetricCard
          metric={catalog}
          fallbackLabel="Total catalog"
          fallbackAriaLabel="ProductPulse coverage across the Shopify catalog"
          fallbackDetail="Products below the QuickScan threshold may not appear in ProductPulse, but can still carry hidden risk."
        />
        <DashboardCoverageMetricCard
          metric={productPulseCoverage}
          fallbackLabel="Products in ProductPulse"
          fallbackAriaLabel="Full diagnostics coverage inside ProductPulse"
          fallbackDetail="QuickScan-only products have lightweight deterministic signals and still need full diagnostics for final recommendations."
        />
      </div>
      {summary?.recommendation && (
        <div className={`ppCoverageRecommendation ppCoverageRecommendation-${summary.recommendation.tone || "blue"}`}>
          <s-icon type={summary.recommendation.icon || "info"} size="small"></s-icon>
          <p>{summary.recommendation.text}</p>
        </div>
      )}
    </div>
  );
}

function DashboardCoverageMetricCard({ metric = {}, fallbackLabel, fallbackAriaLabel, fallbackDetail }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const label = metric.label || fallbackLabel;
  const hasInfo = Boolean(metric.infoTitle || metric.infoDetail || metric.infoFootnote);
  const percent = Math.max(0, Math.min(100, Number(metric.percent || 0)));

  return (
    <div className={`ppCoverageCatalogCard ppCoverageCatalogCard-${metric.tone || "blue"}`}>
      <div className="ppCoverageMetricHeader">
        <div className="ppCoverageMetricTitleWrap">
          <span className="ppCoverageMetricTitle">{label}</span>
          {hasInfo && (
            <button
              aria-label={`Explain ${label}`}
              className="ppCoverageInfoButton"
              onBlur={() => setOpen(false)}
              onFocus={() => setOpen(true)}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
              ref={triggerRef}
              type="button"
            >
              <s-icon type="info" size="small"></s-icon>
            </button>
          )}
        </div>
        <strong>{metric.percentLabel || "0%"}</strong>
      </div>
      {metric.secondaryLabel && <div className="ppCoverageMetricSubline">{metric.secondaryLabel}</div>}
      <div className="ppCoverageCatalogMeter" aria-label={metric.ariaLabel || fallbackAriaLabel}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>{metric.detail || fallbackDetail}</p>
      {metric.subline && <small className="ppCoverageMetricFootnote">{metric.subline}</small>}
      {hasInfo && (
        <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppCoverageSourcePopover ppCoverageMetricPopover" width={360} estimatedHeight={190}>
          <strong>{metric.infoTitle || label}</strong>
          <span>{metric.infoDetail || metric.detail}</span>
          {metric.infoFootnote && <span>{metric.infoFootnote}</span>}
        </FloatingTablePopover>
      )}
    </div>
  );
}

function DashboardCoverageSourcePill({ source }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const connected = source.tone === "success";

  return (
    <button
      className={`ppCoverageSourcePill ppCoverageSourcePill-${source.tone || "neutral"}`}
      ref={triggerRef}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      type="button"
      aria-label={`${source.label}: ${connected ? "connected" : "not connected"}`}
    >
      <span className="ppCoverageSourceIcon" aria-hidden="true">
        <ProductPulseGlyph type={source.icon || "check"} />
      </span>
      <span>{source.label}</span>
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppCoverageSourcePopover" width={300} estimatedHeight={130}>
        <strong>{source.label} {connected ? "connected" : "not connected"}</strong>
        <span>{source.detail || (connected
          ? `${source.label} evidence was found in stored product diagnostics and contributes to coverage quality.`
          : `${source.label} evidence has not been found yet. Connect or import this source to improve diagnosis confidence.`)}</span>
      </FloatingTablePopover>
    </button>
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

function ProductRiskTrendCell({ product }) {
  const values = getProductRiskTrendValues(product);
  const href = product.href || `/app/products/${product.handle || product.slug || product.id}`;
  const trendValues = values.length >= 2
    ? values
    : [Number(product.riskScore || 0), Number(product.riskScore || 0)];
  const trendLabel = getProductRiskTableTrendLabel(trendValues);

  return (
    <Link className="ppRiskTrendCell" to={href} aria-label={`${trendLabel} risk trend for ${product.title}`}>
      <span>{trendLabel}</span>
      <MiniTrend tone="table" values={trendValues} />
    </Link>
  );
}

function ProductMomentumCell({ product, onWatchlistToggle }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(null);
  const momentum = normalizeProductMomentum(product.productMomentum || product.metrics?.productMomentum);
  const href = product.href || `/app/products/${product.handle || product.slug || product.id}`;
  const showPopover = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 500);
  };

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  if (!momentum) {
    return (
      <span
        className="ppMomentumPopoverWrap"
        ref={triggerRef}
        onBlur={scheduleClose}
        onFocus={showPopover}
        onMouseEnter={showPopover}
        onMouseLeave={scheduleClose}
      >
        <Link className="ppMomentumMissingTrigger" to={href} aria-label={`Product Momentum unavailable for ${product.title}`}>
          <s-icon type="info" size="small"></s-icon>
          <span>Missing</span>
        </Link>
        <FloatingTablePopover
          anchorRef={triggerRef}
          open={open}
          className="ppMomentumPopover"
          width={300}
          estimatedHeight={140}
          onMouseEnter={showPopover}
          onMouseLeave={scheduleClose}
        >
          <strong>Product Momentum unavailable</strong>
          <span>Run a deep product diagnosis to calculate current commercial strength from sales velocity, growth, catalog share and recent activity.</span>
        </FloatingTablePopover>
      </span>
    );
  }

  const trendValues = momentum.inputs.weeklyUnitsLast4Weeks.length
    ? momentum.inputs.weeklyUnitsLast4Weeks
    : [momentum.score, momentum.score];
  const momentumTone = getTrendTone(trendValues, momentum.score);
  const canSuggestWatchlist = shouldSuggestWatchlistForMomentum(momentum, product);

  return (
    <span
      className="ppMomentumPopoverWrap"
      ref={triggerRef}
      onBlur={scheduleClose}
      onFocus={showPopover}
      onMouseEnter={showPopover}
      onMouseLeave={scheduleClose}
    >
      <Link className={`ppMomentumTrigger ppMomentumTrigger-${getProductMomentumBarsTone(momentum)}`} to={href} aria-label={`Open Product Momentum for ${product.title}`}>
        <span className="ppMomentumTriggerMain">
          <MiniTrend tone={momentumTone} values={trendValues} />
          <span>{momentum.tier} {momentum.score}</span>
        </span>
        <span className="ppMomentumSubline">{momentum.display.growthLabel} 30d · {momentum.display.catalogPositionLabel}</span>
      </Link>
      <FloatingTablePopover
        anchorRef={triggerRef}
        open={open}
        className="ppMomentumPopover"
        width={360}
        estimatedHeight={330}
        onMouseEnter={showPopover}
        onMouseLeave={scheduleClose}
      >
        <span className="ppMomentumPopoverHeader">
          <span>Product Momentum</span>
          <strong>{momentum.tier} · {momentum.score}/100</strong>
          <small>{momentum.direction} · {momentum.confidenceLabel}</small>
        </span>
        <span className="ppMomentumPopoverTrend">
          <MiniTrend tone={momentumTone} size="large" values={trendValues} />
          <span>{momentum.display.trendLabel}</span>
        </span>
        <span className="ppMomentumPopoverStats">
          <span>
            <b>Last 30 days</b>
            <strong>{formatInteger(momentum.inputs.unitsLast30Days)} units</strong>
            <small>{formatMoney(momentum.inputs.revenueLast30Days)} revenue</small>
          </span>
          <span>
            <b>Growth</b>
            <strong>{momentum.display.growthLabel}</strong>
            <small>vs previous 30 days</small>
          </span>
          <span>
            <b>Catalog position</b>
            <strong>{momentum.display.catalogPositionLabel}</strong>
            <small>{getMomentumCatalogComparisonLabel(momentum)}</small>
          </span>
          <span>
            <b>Confidence</b>
            <strong>{momentum.confidenceLabel}</strong>
            <small>{formatInteger(momentum.confidence)}/100</small>
          </span>
        </span>
        {canSuggestWatchlist ? (
          <button
            className="ppMomentumWatchlistButton"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              onWatchlistToggle?.(product);
            }}
          >
            <ProductPulseGlyph type="binoculars" />
            Add to Watchlist
          </button>
        ) : (
          <span className="ppSignalPopoverFooter">{momentum.display.recommendedUse}</span>
        )}
      </FloatingTablePopover>
    </span>
  );
}

function shouldSuggestWatchlistForMomentum(momentum = {}, product = {}) {
  const recommendedUse = String(momentum.display?.recommendedUse || "").toLowerCase();
  return Boolean(
    !product.isWatched
      && product.productGid
      && (Number(momentum.score || 0) >= 70 || recommendedUse.includes("watchlist")),
  );
}

function getMomentumCatalogComparisonLabel(momentum = {}) {
  const catalogProductCount = Number(momentum.catalog?.catalogProductCount || 0);
  if (catalogProductCount > 0) return `${formatInteger(catalogProductCount)} products compared`;
  if (momentum.catalog?.hasCatalogBaseline) return "Catalog baseline available";
  return "Catalog baseline pending";
}

function ProductSignalCell({ product }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const details = normalizeProductEvidenceDetails(product);
  const evidenceHref = details.fullEvidenceHref || `${product.href || `/app/products/${product.handle || product.slug || product.id}`}/evidence`;

  return (
    <span
      className="ppSignalPopoverWrap"
      ref={triggerRef}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link className="ppSignalTrigger" to={evidenceHref} aria-label={`Open evidence for ${product.title}`}>
        <span className="ppSignalTriggerMain">
          <SignalBars tone={details.tone || product.signalTone} values={details.values || product.signalBars || []} />
          <span>{details.signalCount}</span>
        </span>
        <span className="ppSignalStrengthLine">{details.strengthLabel} · {details.sourceCount} source{details.sourceCount === 1 ? "" : "s"}</span>
      </Link>
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppSignalPopover" width={340} estimatedHeight={280}>
        <strong>{details.summary}</strong>
        <span className="ppSignalPopoverMeta">
          <span><b>Main issue</b>{details.mainIssue}</span>
          <span><b>Recommended action</b>{details.recommendedAction}</span>
        </span>
        {details.topEvidence.length > 0 && (
          <span className="ppSignalPopoverList">
            <b>Top evidence</b>
            {details.topEvidence.map((item) => (
              <span className="ppSignalPopoverItem" key={item.label}>
                <s-icon type={item.icon || "target"} size="small"></s-icon>
                <span>
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                </span>
              </span>
            ))}
          </span>
        )}
        <span className="ppSignalPopoverFooter">Click the Evidence cell to view full evidence.</span>
      </FloatingTablePopover>
    </span>
  );
}

function normalizeProductEvidenceDetails(product) {
  const rawDetails = product.signalDetails || buildFallbackSignalDetails(product);
  const bars = Array.isArray(rawDetails.bars) ? rawDetails.bars : [];
  const signalCount = Number(rawDetails.signalCount ?? product.signals ?? 0);
  const sourceCount = Number(rawDetails.sourceCount ?? getEvidenceSourceCount(product, bars));
  const strengthLabel = rawDetails.strengthLabel || getEvidenceStrengthLabel({ signalCount, sourceCount, conflicting: rawDetails.conflicting });
  const tone = rawDetails.tone || getEvidenceTone(product, signalCount);
  const values = bars.length ? bars.map((bar) => Number(bar.value || 0)) : product.signalBars || [];
  const mainIssue = rawDetails.mainIssue || product.issue || "Product quality";
  const recommendedAction = rawDetails.recommendedAction || product.recommendedAction || "Review product diagnosis";
  const topEvidence = rawDetails.topEvidence?.length
    ? rawDetails.topEvidence
    : bars
      .filter((bar) => Number(bar.signalUnits || bar.value || 0) > 0)
      .sort((first, second) => Number(second.signalUnits || second.value || 0) - Number(first.signalUnits || first.value || 0))
      .slice(0, 4)
      .map((bar) => ({
        label: bar.label,
        detail: bar.detail,
        icon: bar.icon,
      }));

  return {
    ...rawDetails,
    bars,
    values,
    signalCount,
    sourceCount,
    strengthLabel,
    tone,
    mainIssue,
    recommendedAction,
    topEvidence,
    summary: rawDetails.summary || `${strengthLabel} evidence · ${signalCount} signal${signalCount === 1 ? "" : "s"} · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`,
  };
}

function getEvidenceSourceCount(product, bars = []) {
  const activeFamilies = bars.filter((bar) => Number(bar.signalUnits || 0) > 0).length;
  if (activeFamilies > 0) return activeFamilies;
  const sourceCount = Number(product.sourceCount || 0);
  if (sourceCount > 0) return sourceCount;
  const sourceTokens = Array.isArray(product.sources) ? product.sources.length : 0;
  return Math.max(sourceTokens + Number(product.sourceOverflow || 0), 0);
}

function getEvidenceStrengthLabel({ signalCount, sourceCount, conflicting = false }) {
  if (conflicting) return "Conflicting";
  if (signalCount >= 10 && sourceCount >= 3) return "Strong";
  if (signalCount >= 5 || sourceCount >= 2) return "Moderate";
  if (signalCount >= 1) return sourceCount <= 1 ? "Sparse" : "Weak";
  return "Sparse";
}

function getEvidenceTone(product, signalCount) {
  if (signalCount <= 0) return "gray";
  const normalized = String(product.risk || product.riskLabel || product.signalTone || "").toLowerCase();
  if (normalized.includes("high") || normalized.includes("red") || normalized.includes("critical")) return "red";
  if (normalized.includes("medium") || normalized.includes("watch") || normalized.includes("orange") || normalized.includes("warning")) return "orange";
  return "green";
}

function buildFallbackSignalDetails(product) {
  const values = product.signalBars || [];
  const fallbackBars = [
    ["Product / PDP content", "Product setup, product page copy and content-quality evidence."],
    ["Reviews", "Connected review rating and negative-review pressure."],
    ["Customer language", "Repeated customer phrases, return notes, review text or sentiment evidence."],
    ["Returns", "Return units, return rate and return reasons."],
    ["Refunds / financial", "Refund units, refund amount and financial pressure."],
  ];
  const signalCount = Number(product.signals || 0);
  const sourceCount = getEvidenceSourceCount(product, fallbackBars.map((bar, index) => ({ label: bar[0], value: values[index] || 0, signalUnits: values[index] ? 1 : 0 })));
  const strengthLabel = getEvidenceStrengthLabel({ signalCount, sourceCount });

  return {
    signalCount,
    sourceCount,
    strengthLabel,
    mainIssue: product.issue || "Product quality",
    recommendedAction: product.recommendedAction || "Review product diagnosis",
    summary: `${strengthLabel} evidence · ${signalCount} signal${signalCount === 1 ? "" : "s"} · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`,
    bars: fallbackBars.map(([label, detail], index) => ({
      label,
      value: values[index] || 0,
      detail,
      signalUnits: values[index] ? 1 : 0,
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

function FloatingTablePopover({
  anchorRef,
  open,
  className = "",
  width = 320,
  estimatedHeight = 220,
  placement = "bottom-start",
  role = "tooltip",
  children,
  onMouseEnter,
  onMouseLeave,
}) {
  const style = useFloatingTablePopoverStyle(anchorRef, open, { width, estimatedHeight, placement });
  if (!open || !style || typeof document === "undefined") return null;

  return createPortal(
    <span
      className={`${className} ppFloatingTablePopover`.trim()}
      role={role}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </span>,
    document.body,
  );
}

function useFloatingTablePopoverStyle(anchorRef, open, { width = 320, estimatedHeight = 220, placement = "bottom-start" } = {}) {
  const [style, setStyle] = useState(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      setStyle(null);
      return undefined;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 12;
      const offset = 8;
      const viewportWidth = window.innerWidth || 0;
      const viewportHeight = window.innerHeight || 0;
      let left = rect.left;

      if (placement.endsWith("end")) {
        left = rect.right - width;
      } else if (placement.endsWith("center")) {
        left = rect.left + rect.width / 2 - width / 2;
      }

      left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

      const preferredBelow = rect.bottom + offset;
      const preferredAbove = rect.top - estimatedHeight - offset;
      const top = preferredBelow + estimatedHeight <= viewportHeight - margin
        ? preferredBelow
        : Math.max(margin, preferredAbove);

      setStyle({
        position: "fixed",
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        width: `${width}px`,
        zIndex: 10000,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, width, estimatedHeight, placement]);

  return style;
}

function ProductSourceIconGroup({ sources, overflow }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const sourceTokens = (sources || []).map(normalizeSourceToken);
  const overflowCount = Number(overflow || 0);
  const hasFullSourceList = sourceTokens.length > 3;
  const totalCount = sourceTokens.length + (hasFullSourceList ? 0 : overflowCount);
  const primarySource = sourceTokens[0] || normalizeSourceToken("source");

  return (
    <span
      className="ppSourceTokenWrap"
      ref={triggerRef}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="ppSourceSummaryTrigger" type="button" aria-label={`${totalCount || 1} source${totalCount === 1 ? "" : "s"} used for this product`}>
        <span className={`ppSourceSummaryGlyph ppSourceSummaryGlyph-${primarySource.key}`} aria-hidden="true">
          <s-icon type="duplicate" size="small"></s-icon>
        </span>
      </button>
      <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppSourcePopover ppSourceSummaryPopover" width={360} estimatedHeight={260} placement="bottom-end">
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
      </FloatingTablePopover>
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

function ProductActionMenu({ product, open, onToggle, onClose, onWatchlistToggle, onDeleteAnalysis }) {
  const triggerRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const handle = product.handle || product.href?.split("/").filter(Boolean).pop() || product.title;

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".ppActionMenu")) return;
      onClose?.();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

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
    <span className="ppActionMenuWrap" ref={triggerRef}>
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
        <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppActionMenu" width={232} estimatedHeight={248} placement="bottom-end" role="menu">
          <Link role="menuitem" to={product.href} onClick={onClose}>
            <s-icon type="view" size="small"></s-icon>
            View diagnostics
          </Link>
          <button role="menuitem" type="button" onClick={handleCopy}>
            <s-icon type="duplicate" size="small"></s-icon>
            {copied ? "Copied handle" : "Copy handle"}
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={!product.productGid}
            onClick={() => onWatchlistToggle?.(product)}
          >
            {product.isWatched ? <s-icon type="x" size="small"></s-icon> : <ProductPulseGlyph type="binoculars" />}
            {product.isWatched ? "Remove from Watchlist" : "Add to Watchlist"}
          </button>
          {product.resolvedAt ? (
            <Form method="post" role="none">
              <input type="hidden" name="_action" value="mark-unresolved" />
              <input type="hidden" name="productId" value={getProductActionKey(product)} />
              <button role="menuitem" type="submit" onClick={onClose}>
                <s-icon type="x" size="small"></s-icon>
                Mark unresolved
              </button>
            </Form>
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
          <button
            className="ppActionMenuDanger"
            role="menuitem"
            type="button"
            onClick={() => onDeleteAnalysis?.(product)}
          >
            <ProductPulseGlyph type="trash" />
            Delete analysis
          </button>
        </FloatingTablePopover>
      )}
    </span>
  );
}

function ProductDetailActionsMenu({
  detail,
  product,
  open,
  onToggle,
  onClose,
  onWatchlistToggle,
  isWatched,
  watchlistPending,
  resolved,
  resolvingPending,
}) {
  const triggerRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const productId = detail.slug || detail.handle || product?.slug || product?.handle || "";
  const handle = detail.handle || product?.handle || productId;

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".ppProductDetailActionMenu")) return;
      onClose?.();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const handleCopy = async () => {
    try {
      await window.navigator?.clipboard?.writeText(handle);
    } catch {
      // Clipboard may be unavailable inside embedded Shopify surfaces.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    onClose?.();
  };

  const handleWatchlistClick = () => {
    onClose?.();
    onWatchlistToggle?.();
  };

  return (
    <span className="ppActionMenuWrap ppProductDetailActionMenuWrap" ref={triggerRef}>
      <button
        className="ppProductOverflowButton"
        type="button"
        aria-expanded={open}
        aria-label={`More actions for ${detail.title}`}
        onClick={onToggle}
      >
        <s-icon type="menu-horizontal" size="small"></s-icon>
      </button>
      {open && (
        <FloatingTablePopover anchorRef={triggerRef} open={open} className="ppActionMenu ppProductDetailActionMenu" width={236} estimatedHeight={214} placement="bottom-end" role="menu">
          <span className="ppProductDetailActionMenuHeader">Product actions</span>
          <button
            role="menuitem"
            type="button"
            disabled={watchlistPending || !detail.productGid}
            onClick={handleWatchlistClick}
          >
            {isWatched ? <s-icon type="x" size="small"></s-icon> : <ProductPulseGlyph type="binoculars" />}
            {isWatched ? "Remove from Watchlist" : "Add to Watchlist"}
          </button>
          {resolved ? (
            <Form method="post" role="none">
              <input type="hidden" name="_action" value="mark-unresolved" />
              <input type="hidden" name="productId" value={productId} />
              <button role="menuitem" type="submit" disabled={!detail.canResolve || resolvingPending} onClick={onClose}>
                <s-icon type="x" size="small"></s-icon>
                {resolvingPending ? "Saving..." : "Mark unresolved"}
              </button>
            </Form>
          ) : (
            <Form method="post" role="none">
              <input type="hidden" name="_action" value="mark-resolved" />
              <input type="hidden" name="productId" value={productId} />
              <button role="menuitem" type="submit" disabled={!detail.canResolve || resolvingPending} onClick={onClose}>
                <s-icon type="check" size="small"></s-icon>
                {resolvingPending ? "Saving..." : "Mark as resolved"}
              </button>
            </Form>
          )}
          <button role="menuitem" type="button" onClick={handleCopy}>
            <s-icon type="duplicate" size="small"></s-icon>
            {copied ? "Copied handle" : "Copy handle"}
          </button>
          {detail.shopifyAdminUrl && (
            <a role="menuitem" href={detail.shopifyAdminUrl} target="_blank" rel="noreferrer" onClick={onClose}>
              <s-icon type="external" size="small"></s-icon>
              Open in Shopify admin
            </a>
          )}
        </FloatingTablePopover>
      )}
    </span>
  );
}

function ProductInsightMetric({ title, value, detail, footnote, tone = "neutral", progress, sparkline, icon }) {
  const trendValues = Array.isArray(sparkline) ? sparkline : [];
  const helpText = getInsightMetricHelp(title);
  const metricIcon = icon || getInsightMetricIcon(title);

  return (
    <div className={`ppProductInsight ppProductInsight-${tone}`}>
      <div className="ppProductInsightTop">
        <span className="ppProductInsightIcon" aria-hidden="true">
          <ProductPulseGlyph type={metricIcon} />
        </span>
        <span>
          {title}
          <button className="ppInsightInfoWrap" type="button" aria-label={`What ${title} means`}>
            <s-icon type="info" size="small" color="subdued"></s-icon>
            <span className="ppInsightTooltip" role="tooltip">{helpText}</span>
          </button>
        </span>
      </div>
      <strong>{value}</strong>
      <small>{renderAnalysisText(detail)}</small>
      {trendValues.length > 0 && <MiniTrend tone={getTrendTone(trendValues)} size="large" values={trendValues} />}
      {typeof progress === "number" && (
        <div className="ppProductInsightProgress" aria-label={`${progress}% confidence`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {footnote && (
        <em>
          {footnote.includes("18%") && <span className="ppTrendArrow" aria-hidden="true" />}
          {renderAnalysisText(footnote)}
        </em>
      )}
    </div>
  );
}

function getInsightMetricHelp(title) {
  switch (title) {
    case "Product risk":
      return "Severity of the product problem only. Financial impact is not included in this score.";
    case "Product Momentum":
      return "Current commercial strength from recent sales velocity, growth, catalog share, trend consistency and sales recency. It does not measure product risk.";
    case "Diagnosis confidence":
      return "Reliability of the diagnosis based on source coverage, effective sample size, product match quality, source agreement, freshness and confidence caps.";
    case "Financial exposure":
      return "Estimated observed and projected financial exposure from refunds, return processing, returned-unit margin loss and review conversion drag.";
    case "Main issue":
      return "The strongest issue category found in the product's current signals, such as returns, refunds, variants or expectation mismatch.";
    case "Recommended fix":
      return "The safest next action ProductPulse can recommend from deterministic evidence before any deeper AI review.";
    default:
      return "Product-specific signal summary calculated from the evidence stored for this product.";
  }
}

function getInsightMetricIcon(title) {
  switch (title) {
    case "Product risk":
      return "alert-circle";
    case "Product Momentum":
      return "wand";
    case "Diagnosis confidence":
      return "shield-check-mark";
    case "Financial exposure":
      return "cash-dollar";
    case "Main issue":
      return "product";
    default:
      return "info";
  }
}

function EvidenceObservabilityPanel({ detail, product, selectedEvidence, selectedEvidenceIndex, onSelectEvidence }) {
  const sources = detail.evidenceSources || [];
  if (!sources.length) {
    return (
      <div className="ppProductPanel ppEvidenceObservabilityPanel">
        <EvidenceObservabilityHeader detail={detail} />
        <EmptyProductDetailState message="0 evidence sources stored for this product yet." />
      </div>
    );
  }

  const activeSource = selectedEvidence || sources[0];
  const activeCards = activeSource.cards?.length
    ? activeSource.cards
    : getEvidenceSourceCards(activeSource.title, activeSource.points, product);
  const reportHref = getProductEvidenceReportHref(product, activeSource);
  const activeSourceTitle = activeSource.title || "";
  const sourceReportKind = getEvidenceSourceReportKind(activeSourceTitle);

  return (
    <div className="ppProductPanel ppEvidenceObservabilityPanel">
      <EvidenceObservabilityHeader detail={detail} />

      <div className="ppEvidenceTabsModern" role="tablist" aria-label="Evidence sources">
        {sources.map((source, index) => (
          <button
            className={index === selectedEvidenceIndex ? "isActive" : ""}
            type="button"
            role="tab"
            aria-selected={index === selectedEvidenceIndex}
            aria-label={source.title}
            key={source.title}
            onClick={() => onSelectEvidence(index)}
          >
            <span className={`ppEvidenceTabIcon ppEvidenceTone-${source.tone}`} aria-hidden="true">
              <ProductPulseGlyph type={source.icon} />
            </span>
            <span>{source.title}</span>
            <strong>{source.points.length}</strong>
          </button>
        ))}
      </div>

      {sourceReportKind === "customer-language" && (
        <CustomerLanguageEvidencePanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "returns" && (
        <ShopifyReturnsEvidencePanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "reviews" && (
        <ReviewEvidencePanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "refunds" && (
        <RefundEvidencePanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "orders" && (
        <OrdersEvidencePanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "shopify-product" && (
        <ShopifyProductEvidencePanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "ai-synthesis" && (
        <AiEvidenceSynthesisPanel source={activeSource} product={product} reportHref={reportHref} />
      )}
      {sourceReportKind === "generic" && (
        <GenericEvidenceSourceReportPanel source={activeSource} product={product} reportHref={reportHref} cards={activeCards} />
      )}
    </div>
  );
}

function getEvidenceSourceReportKind(source = "") {
  if (isCustomerLanguageEvidenceSource(source)) return "customer-language";
  if (isShopifyRefundsEvidenceSource(source)) return "refunds";
  if (isShopifyReturnsEvidenceSource(source)) return "returns";
  if (isShopifyOrdersEvidenceSource(source)) return "orders";
  if (isReviewEvidenceSource(source)) return "reviews";
  if (isShopifyProductEvidenceSource(source)) return "shopify-product";
  if (isAiEvidenceSynthesisSource(source)) return "ai-synthesis";
  return "generic";
}

function isCustomerLanguageEvidenceSource(source = "") {
  const normalized = String(source || "").toLowerCase();
  return normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer");
}

function isReviewEvidenceSource(source = "") {
  const normalized = String(source || "").toLowerCase();
  return normalized.includes("review") || normalized.includes("judge") || normalized.includes("judgeme");
}

function isShopifyReturnsEvidenceSource(source = "") {
  const normalized = String(source || "").toLowerCase();
  return normalized.includes("return") && !normalized.includes("refund");
}

function isShopifyRefundsEvidenceSource(source = "") {
  return String(source || "").toLowerCase().includes("refund");
}

function isShopifyOrdersEvidenceSource(source = "") {
  const normalized = String(source || "").toLowerCase();
  return normalized.includes("order") || normalized.includes("sales");
}

function isShopifyProductEvidenceSource(source = "") {
  return String(source || "").toLowerCase().trim() === "shopify product";
}

function isAiEvidenceSynthesisSource(source = "") {
  return String(source || "").toLowerCase().includes("ai evidence synthesis");
}

function EvidenceObservabilityHeader({ detail }) {
  return (
    <div className="ppEvidenceObservabilityHeader">
      <div>
        <h2>Evidence by source</h2>
        <p>Explore and review the evidence behind each detected issue.</p>
      </div>
      <div className="ppEvidenceHeaderMeta">
        <strong>{detail.evidenceSources.length}</strong>
        <span>sources</span>
      </div>
    </div>
  );
}

function CustomerLanguageEvidencePanel({ source, product, reportHref }) {
  const metrics = product.metrics || {};
  const textInsights = metrics.textInsights || {};
  const aiContext = getAiEvidenceContextSection(product, "customer-language");
  const sentiment = getCombinedCustomerLanguageSentiment(metrics);
  const emotionSummary = getCustomerLanguageEmotionSummary(metrics);
  const primaryEmotion = emotionSummary.primary;
  const secondaryEmotion = emotionSummary.secondary;
  const sentimentVisual = getSentimentVisual(sentiment);
  const themes = getCustomerLanguageThemes(textInsights, source.points, metrics);
  const signalBreakdown = getCustomerLanguageSignalBreakdown(metrics);
  const signalRows = getCustomerLanguageSignalRows(textInsights, themes, metrics, emotionSummary);
  const recurringThemeCount = Math.max(
    themes.filter((theme) => Number(theme.count || 0) > 0).length,
    Number(textInsights.repeatedLanguage?.length || 0),
    Number(textInsights.returns?.repeatedLanguage?.length || 0),
    Number(metrics.refundInsights?.repeatedLanguage?.length || 0),
  );
  const aiConfidence = getCustomerLanguageAiConfidenceLabel({ textInsights, sentiment, source });

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppCustomerLanguageReport">
      <EvidenceSourceReportHeader source={source} title="Customer language analysis" summary="AI analyzes customer language to uncover sentiment, emotions and recurring themes." />
      <EvidenceAiContextBlock section={aiContext} />

      <div className="ppEvidenceHeroMetricStrip">
        <EvidenceSourceStatCard icon="note" label="Text signals" value={formatInteger(sentiment.total)} detail="Reviews, return notes and refund notes" tone="blue" />
        <EvidenceSourceStatCard icon="alert-circle" label="Negative language" value={formatInteger(sentiment.negative)} detail={`${formatInteger(sentiment.neutral)} neutral / ${formatInteger(sentiment.positive)} positive`} tone={sentiment.negative > 0 ? "red" : "teal"} />
        <EvidenceSourceStatCard icon="target" label="Primary emotion" value={formatEvidenceEmotionLabelOnly(primaryEmotion)} detail={primaryEmotion?.count ? `Detected in ${formatInteger(primaryEmotion.count)} signals` : "No primary emotion stored"} tone={primaryEmotion?.polarity === "negative" ? "red" : primaryEmotion?.polarity === "positive" ? "teal" : "violet"} />
        <EvidenceSourceStatCard icon="wand" label="Secondary emotion" value={formatEvidenceEmotionLabelOnly(secondaryEmotion)} detail={secondaryEmotion?.count ? `${formatInteger(secondaryEmotion.count)} next-strongest signals` : "Only one emotion cluster stored"} tone={secondaryEmotion?.polarity === "negative" ? "amber" : secondaryEmotion?.polarity === "positive" ? "teal" : "violet"} />
      </div>

      <section className="ppEvidenceReportSectionCard">
        <div className="ppEvidenceReportSectionHeaderRow">
          <div>
            <h4>Snapshot overview</h4>
            <p>What&apos;s driving customer conversations</p>
          </div>
          <Link to={reportHref}>View full report <s-icon type="chevron-right" size="small"></s-icon></Link>
        </div>

        <div className="ppCustomerSnapshotGrid">
          <EvidenceSourceStatCard compact icon="wand" label="AI reading" value={getCustomerLanguageAiReadingLabel({ aiContext, themes, primaryEmotion, sentiment })} detail="Plain-language interpretation" tone={primaryEmotion?.polarity === "negative" ? "red" : "violet"} />
          <EvidenceSourceStatCard compact icon={sentimentVisual.icon} label="Overall sentiment" value={getDominantSentimentLabel(sentiment)} detail={`${formatInteger(sentiment.negative)} negative · ${formatInteger(sentiment.neutral)} neutral · ${formatInteger(sentiment.positive)} positive`} tone={sentimentVisual.tone} />
          <EvidenceSourceStatCard compact icon="note" label="Recurring themes" value={formatInteger(recurringThemeCount)} detail="Themes found" tone="blue" />
          <EvidenceSourceStatCard compact icon="shield-check-mark" label="AI confidence" value={aiConfidence} detail="Signal quality" tone={aiConfidence === "High" ? "teal" : aiConfidence === "Medium" ? "amber" : "blue"} />
        </div>

        <div className="ppCustomerLanguageAnalysisGrid">
          <div>
            <h4>Top themes</h4>
            <p>Most frequent themes found in customer language</p>
            <EvidenceThemeBarList themes={themes} />
          </div>
          <div>
            <h4>Signal breakdown</h4>
            <p>How signals are distributed</p>
            <EvidenceSignalDonut total={signalBreakdown.total} rows={signalBreakdown.rows} />
          </div>
        </div>
      </section>

      <section className="ppEvidenceReportSectionCard">
        <div className="ppEvidenceReportSectionHeaderRow">
          <div>
            <h4>All signals by type</h4>
            <p>Detailed breakdown of all detected signals</p>
          </div>
        </div>
        <div className="ppEvidenceSignalTableWrap">
          <table className="ppEvidenceSignalTable">
            <thead>
              <tr>
                <th>Signal type</th>
                <th>What it means</th>
                <th>Count</th>
                <th>Source detail</th>
              </tr>
            </thead>
            <tbody>
              {signalRows.map((row) => (
                <tr key={row.type}>
                  <td>
                    <span className="ppEvidenceSignalNameCell">
                      <span className={`ppEvidenceSignalTypeIcon ppEvidenceMetricCard-${row.tone}`}>
                        <ProductPulseGlyph type={row.icon} />
                      </span>
                      <span>{row.type}</span>
                    </span>
                  </td>
                  <td>{row.meaning}</td>
                  <td>{row.count}</td>
                  <td>{row.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ppEvidenceTableFooter">
          <Link to={reportHref}>View full report <s-icon type="chevron-right" size="small"></s-icon></Link>
        </div>
      </section>
    </div>
  );
}

function ShopifyReturnsEvidencePanel({ source, product, reportHref }) {
  const metrics = product.metrics || {};
  const textInsights = metrics.textInsights || {};
  const aiContext = getAiEvidenceContextSection(product, "returns");
  const returnsSentiment = normalizeEvidenceSentiment(textInsights.returns?.sentiment);
  const returnSentimentLabel = getDominantSentimentLabel(returnsSentiment);
  const returnSentimentTone = getEvidenceSentimentTone(returnsSentiment);
  const topReasons = getReturnReasonRows(metrics);
  const topReason = topReasons[0] || { label: "No reason stored", count: 0, share: 0 };
  const repeatedLanguage = getReturnRepeatedLanguage(textInsights);
  const returnExamples = getReturnExampleRows(textInsights, metrics);

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppShopifyReturnsReport">
      <EvidenceSourceReportHeader source={source} title="Shopify returns" summary={`Return behavior is contributing to the product risk model${Number(metrics.returnRate || 0) ? ` with a ${formatPercent(metrics.returnRate)} return rate.` : "."}`} />
      <EvidenceAiContextBlock section={aiContext} />

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        <EvidenceSourceStatCard icon="return" label="Total returns" value={formatInteger(metrics.returnUnits || 0)} detail={`${formatPercent(metrics.returnRate || 0)} return rate`} tone="blue" />
        <EvidenceSourceStatCard icon="chart-line" label="Return rate" value={formatPercent(metrics.returnRate || 0)} detail={`${formatInteger(metrics.soldUnits || 0)} sold units in scan window`} tone={Number(metrics.returnRate || 0) >= 20 ? "teal" : "blue"} />
        <EvidenceSourceStatCard icon="clock" label="Returned within" value={`${formatInteger(metrics.returnUnits || 0)} units`} detail={`${formatInteger(metrics.windowDays || 60)} day evidence window`} tone="blue" trend={metrics.signalTrend} />
        <EvidenceSourceStatCard icon="target" label="Top reason" value={topReason.label} detail={topReason.detail || "Most frequent"} tone="violet" />
      </div>

      <div className="ppReturnsEvidenceGrid">
        <section className="ppEvidenceReportSectionCard ppReturnsOverTimeCard">
          <h4>Returns over time</h4>
          <p>Return rate trend in scan window</p>
          <EvidenceReturnRateChart activity={metrics.monthlyOrderActivity} prediction={metrics.returnRatePrediction} returnRate={metrics.returnRate} />
        </section>

        <section className="ppEvidenceReportSectionCard ppReturnsTopReasonsCard">
          <h4>Top return reasons</h4>
          <p>By return units</p>
          <EvidenceReasonBarList rows={topReasons} total={Number(metrics.returnUnits || 0)} />
          <Link to={reportHref}>View all reasons <s-icon type="chevron-right" size="small"></s-icon></Link>
        </section>
      </div>

      <div className="ppReturnsDetailMetricGrid">
        <EvidenceSourceStatCard icon="calendar" label="Last signal captured" value={metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : detailLastAnalysis(product)} detail={`${formatInteger(metrics.signalCount || source.points.length)} total signals`} tone="blue" />
        <EvidenceSourceStatCard icon="return" label="Return notes sentiment" value={returnSentimentLabel} detail={`${formatInteger(returnsSentiment.negative)} negative · ${formatInteger(returnsSentiment.neutral)} neutral · ${formatInteger(returnsSentiment.positive)} positive`} tone={returnSentimentTone} />
        <EvidenceSourceStatCard icon="note" label="Repeated language" value={formatInteger(repeatedLanguage.length)} detail={repeatedLanguage[0] ? `${quoteSourceText(repeatedLanguage[0].term)} (${formatInteger(repeatedLanguage[0].count)})` : "No repeated return language"} tone={repeatedLanguage.length ? "red" : "blue"} />
        <EvidenceSourceStatCard icon="lightbulb" label="Return insights" value={formatInteger(getReturnInsightCount(textInsights, source))} detail="Insight groups" tone="blue" />
        <EvidenceSourceStatCard icon="product" label="Vendor" value={metrics.vendor || "Not stored"} detail={metrics.vendor || "Vendor not captured"} tone="blue" />
        <EvidenceSourceStatCard icon="product" label="Product type" value={metrics.productType || "Not stored"} detail={metrics.productType || "Product type not captured"} tone="blue" />
        <EvidenceSourceStatCard icon="note" label="Description words" value={formatInteger(metrics.descriptionWordCount || 0)} detail="In product description" tone="blue" />
        <EvidenceSourceStatCard icon="shield-check-mark" label="Content quality" value={metrics.contentQualityScore ? `${metrics.contentQualityScore} / 100` : "Not scored"} detail="Content quality score" tone="blue" />
      </div>

      <div className="ppReturnsBottomGrid">
        <section className="ppEvidenceReportSectionCard ppRecentReturnNotesCard">
          <div className="ppEvidenceReportSectionHeaderRow">
            <div>
              <h4>Recent return notes</h4>
              <p>Latest return notes captured</p>
            </div>
            <Link to={reportHref}>View all notes <s-icon type="chevron-right" size="small"></s-icon></Link>
          </div>
          <div className="ppRecentReturnNoteList">
            {returnExamples.map((example) => (
              <div key={`${example.text}-${example.date}`}>
                <span>{renderAnalysisText(example.text)}</span>
                <small>{example.date}</small>
              </div>
            ))}
          </div>
        </section>

        <Link aria-label="View Full Report" className="ppReturnsFullReportCard" to={reportHref}>
          <span className="ppReturnsFullReportIcon" aria-hidden="true">
            <s-icon type="chart-line" size="small"></s-icon>
          </span>
          <strong>View full report</strong>
          <small>See technical evidence, detected issues and raw source data.</small>
          <span>Open full report <s-icon type="chevron-right" size="small"></s-icon></span>
        </Link>
      </div>
    </div>
  );
}

function ReviewEvidencePanel({ source, product, reportHref }) {
  const aiContext = getAiEvidenceContextSection(product, "reviews", { sourceTitle: source.title });
  const reviewStats = getReviewEvidenceStats(source, product);
  const emotionRows = getReviewEmotionRows(product.metrics?.textInsights || {}, source.title);
  const repeatedLanguage = getReviewRepeatedLanguage(product.metrics?.textInsights || {}, source.title);
  const repeatedLanguageTone = getEvidencePhraseTone(repeatedLanguage, reviewStats.negativeCount ? "red" : "teal");
  const examples = getReviewExampleRows(product.metrics?.textInsights || {}, source.points, reviewStats, source.title);
  const sentimentTrend = getReviewSentimentTrendData(product.metrics?.textInsights || {}, source.title, reviewStats);
  const insights = [
    { label: "Average rating / negative rate", value: reviewStats.negativeRateLabel, detail: "Product-level rating pressure", tone: reviewStats.negativeCount ? "red" : "teal" },
    { label: "Evidence", value: formatInteger(reviewStats.totalAnalyzed || reviewStats.reviewCount), detail: "Reviews analyzed", tone: "blue" },
    { label: "Total signals detected", value: formatInteger(source.points.length || reviewStats.negativeCount), detail: "Review evidence points", tone: "violet" },
  ];

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppReviewEvidenceReport">
      <EvidenceSourceReportHeader source={source} title={source.title || "Judge.me reviews"} eyebrow="Reviews" summary="Review evidence connects rating pressure, negative language and customer-reported expectations." />
      <EvidenceAiContextBlock section={aiContext} />

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        <EvidenceSourceStatCard icon="star" label="Total reviews" value={formatInteger(reviewStats.reviewCount)} detail={`${formatInteger(reviewStats.negativeCount)} negative reviews`} tone="blue" />
        <EvidenceSourceStatCard icon="star" label="Average rating" value={reviewStats.averageRatingLabel} detail="Product-level rating" tone="teal" />
        <EvidenceSourceStatCard icon="thumb-down" label="Negative reviews" value={formatInteger(reviewStats.negativeCount)} detail={`${reviewStats.negativeRateLabel} negative rate`} tone={reviewStats.negativeCount ? "red" : "teal"} />
        <EvidenceSourceStatCard icon="clock" label="Recent negatives" value={formatInteger(reviewStats.recentNegativeCount)} detail={reviewStats.recentNegativeWindowLabel} tone={reviewStats.recentNegativeCount ? "red" : "blue"} />
      </div>

      <div className="ppEvidenceTwoColumnGrid ppEvidenceReviewTrendGrid">
        <section className="ppEvidenceReportSectionCard">
          <h4>Review sentiment over time</h4>
          <p>Positive, neutral and negative reviews from first to latest review</p>
          <EvidenceReviewSentimentTrendChart trend={sentimentTrend} />
        </section>

        <section className="ppEvidenceReportSectionCard">
          <h4>Review sentiment</h4>
          <EvidenceSignalDonut total={reviewStats.sentiment.total} rows={reviewStats.sentimentRows} />
        </section>
      </div>

      <div className="ppEvidenceTwoColumnGrid">
        <section className="ppEvidenceReportSectionCard">
          <h4>Review emotions <span>(detected)</span></h4>
          <EvidenceBarList rows={emotionRows} tone="red" emptyLabel="No review emotions stored" />
        </section>

        <section className="ppEvidenceReportSectionCard">
          <div className="ppEvidenceReportSectionHeaderRow ppEvidenceReportSectionHeaderRow-compact">
            <div>
              <h4>Repeated review language</h4>
              <p>Top repeated phrases</p>
            </div>
          </div>
          <EvidencePhraseList phrases={repeatedLanguage} tone={repeatedLanguageTone} emptyLabel="No repeated review phrases stored" />
          <Link className="ppEvidenceSectionLink" to={reportHref}>See all phrases <s-icon type="chevron-right" size="small"></s-icon></Link>
        </section>
      </div>

      <div className="ppEvidenceTwoColumnGrid ppEvidenceTwoColumnGrid-wideLeft">
        <section className="ppEvidenceReportSectionCard">
          <div className="ppEvidenceReportSectionHeaderRow">
            <div>
              <h4>Latest negative review examples</h4>
              <p>Showing {formatInteger(Math.min(examples.length, 4))} of {formatInteger(examples.length || 0)}</p>
            </div>
          </div>
          <div className="ppEvidenceReviewExampleGrid">
            {examples.length ? examples.slice(0, 4).map((example, index) => (
              <article key={`${example.title}-${example.text}-${index}`} className="ppEvidenceReviewExample">
                <div className="ppEvidenceReviewStars" aria-label={`${formatInteger(example.rating)} star review`}>
                  {Array.from({ length: 5 }, (_, starIndex) => (
                    <span className={starIndex < Number(example.rating || 1) ? "isActive" : ""} key={starIndex}>★</span>
                  ))}
                  <small>{example.date}</small>
                </div>
                <strong>{example.title}</strong>
                <p>{renderAnalysisText(example.text)}</p>
                <div>
                  {example.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                  <em>Evidence #{index + 1}</em>
                </div>
              </article>
            )) : (
              <div className="ppEvidenceReviewEmptyState">
                <s-icon type="star" size="small"></s-icon>
                <strong>No negative review examples</strong>
                <span>{reviewStats.reviewCount ? "Stored reviews in this source are not currently negative." : "No review rows are stored for this source."}</span>
              </div>
            )}
          </div>
        </section>

        <section className="ppEvidenceReportSectionCard ppEvidenceReviewSummaryCard">
          <h4>Review evidence</h4>
          <p>{formatInteger(reviewStats.negativeCount)} negative reviews out of {formatInteger(reviewStats.reviewCount)} analyzed</p>
          <strong>{reviewStats.negativeRateLabel} negative rate</strong>
          <div className="ppEvidenceSingleBar"><span style={{ width: `${Math.max(2, clampPercentValue(reviewStats.negativeRate))}%` }}></span></div>
          <Link to={reportHref}>View all reviews <s-icon type="chevron-right" size="small"></s-icon></Link>
        </section>
      </div>

      <div className="ppEvidenceBottomReportGrid">
        <section className="ppEvidenceReportSectionCard">
          <h4>{source.title || "Review"} insights</h4>
          <div className="ppEvidenceMiniInsightGrid">
            {insights.map((item) => (
              <EvidenceMiniInsight key={item.label} {...item} />
            ))}
          </div>
        </section>
        <EvidenceFullReportCard href={reportHref} />
      </div>
    </div>
  );
}

function RefundEvidencePanel({ source, product, reportHref }) {
  const metrics = product.metrics || {};
  const refundInsights = metrics.refundInsights || {};
  const aiContext = getAiEvidenceContextSection(product, "refunds");
  const refundSentiment = normalizeEvidenceSentiment(refundInsights.sentiment);
  const reasonRows = getRefundReasonRows(metrics);
  const repeatedLanguage = getRefundRepeatedLanguage(metrics);
  const refundExamples = getRefundExampleRows(metrics);
  const topReason = reasonRows[0] || { label: "No reason stored", count: 0, share: 0 };

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppRefundEvidenceReport">
      <EvidenceSourceReportHeader source={source} title="Shopify refunds" eyebrow="Refunds" summary={`Refund pressure is tracked separately from returns to highlight financial impact${Number(metrics.refundAmount || 0) ? ` (${formatMoney(metrics.refundAmount)})` : "."}`} />
      <EvidenceAiContextBlock section={aiContext} />

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        <EvidenceSourceStatCard icon="star" label="Refunded units" value={formatInteger(metrics.refundUnits || refundInsights.total || 0)} detail={`${formatPercent(metrics.refundRate || refundInsights.refundRate || 0)} refund rate`} tone="blue" />
        <EvidenceSourceStatCard icon="cash-dollar" label="Refund amount" value={formatMoney(metrics.refundAmount || refundInsights.refundAmount || 0)} detail="Stored refund value" tone="red" />
        <EvidenceSourceStatCard icon="chart-line" label="Refund pressure" value={formatPercent(metrics.refundRate || refundInsights.refundRate || 0)} detail={`${formatInteger(metrics.soldUnits || refundInsights.soldUnits || 0)} sold units baseline`} tone={Number(metrics.refundRate || refundInsights.refundRate || 0) >= 20 ? "red" : "amber"} />
        <EvidenceSourceStatCard icon="cash-dollar" label="Margin at risk" value={formatMoney(metrics.marginAtRisk || 0)} detail={`${formatMoney(metrics.revenueAtRisk || 0)} revenue at risk`} tone="teal" />
      </div>

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        <EvidenceSourceStatCard icon="star" label="Refund evidence" value={formatMoney(metrics.refundAmount || refundInsights.refundAmount || 0)} detail={`${formatPercent(metrics.refundRate || refundInsights.refundRate || 0)} of refunded units`} tone="red" />
        <EvidenceSourceStatCard icon="calendar" label="Last signal captured" value={metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : detailLastAnalysis(product)} detail={`${formatInteger(metrics.signalCount || source.points.length)} total signals`} tone="blue" />
        <EvidenceSourceStatCard icon="target" label="Top refund reason" value={topReason.label} detail="Primary refund signal" tone="violet" />
        <EvidenceSourceStatCard icon="alert-circle" label="Refund-note tone" value={formatInteger(refundSentiment.negative)} detail={`${formatInteger(refundSentiment.negative)} negative, ${formatInteger(refundSentiment.neutral)} neutral, ${formatInteger(refundSentiment.positive)} positive`} tone={refundSentiment.negative ? "red" : "blue"} />
      </div>

      <div className="ppEvidenceThreeColumnGrid ppEvidenceThreeColumnGrid-equal">
        <section className="ppEvidenceReportSectionCard">
          <h4>Refund reasons / context</h4>
          <p>By refunded units</p>
          <EvidenceReasonBarList rows={reasonRows} total={Number(metrics.refundUnits || refundInsights.total || 0)} />
          <Link className="ppEvidenceSectionLink" to={reportHref}>View all reasons <s-icon type="chevron-right" size="small"></s-icon></Link>
        </section>

        <section className="ppEvidenceReportSectionCard">
          <h4>Refund note sentiment</h4>
          <EvidenceSignalDonut total={refundSentiment.total} rows={getSentimentDonutRows(refundSentiment)} />
        </section>

        <section className="ppEvidenceReportSectionCard">
          <h4>Repeated refund-note language</h4>
          <p>Top repeated phrases</p>
          <EvidencePhraseList phrases={repeatedLanguage} tone="red" emptyLabel="No repeated refund-note language stored" />
          <Link className="ppEvidenceSectionLink" to={reportHref}>See all phrases <s-icon type="chevron-right" size="small"></s-icon></Link>
        </section>
      </div>

      <div className="ppReturnsDetailMetricGrid">
        <EvidenceSourceStatCard icon="note" label="Refund note" value={topReason.label} detail="Most common note" tone="blue" />
        <EvidenceSourceStatCard icon="cash-dollar" label="Refunded units" value={formatInteger(metrics.refundUnits || refundInsights.total || 0)} detail="Refunded units" tone="blue" />
        <EvidenceSourceStatCard icon="cash-dollar" label="Refund amount" value={formatMoney(metrics.refundAmount || refundInsights.refundAmount || 0)} detail="Total refunded" tone="red" />
        <EvidenceSourceStatCard icon="product" label="Vendor" value={metrics.vendor || "Not stored"} detail="Vendor" tone="blue" />
        <EvidenceSourceStatCard icon="tag" label="Product type" value={metrics.productType || "Not stored"} detail="Product type" tone="blue" />
      </div>

      <div className="ppReturnsBottomGrid">
        <section className="ppEvidenceReportSectionCard">
          <div className="ppEvidenceReportSectionHeaderRow">
            <div>
              <h4>Recent refund notes</h4>
              <p>Showing {formatInteger(refundExamples.length)} of {formatInteger(refundExamples.length)}</p>
            </div>
          </div>
          <div className="ppEvidenceRefundNoteGrid">
            {refundExamples.map((example, index) => (
              <article key={`${example.text}-${index}`}>
                <strong>{example.reason || "Refund note"}</strong>
                <p>{renderAnalysisText(example.text)}</p>
                <span>{example.date}</span>
                <em>{example.sentiment}</em>
              </article>
            ))}
          </div>
        </section>
        <EvidenceFullReportCard href={reportHref} />
      </div>
    </div>
  );
}

function OrdersEvidencePanel({ source, product, reportHref }) {
  const metrics = product.metrics || {};
  const activity = normalizeProductMonthlyOrderActivity(metrics.monthlyOrderActivity);
  const summary = activity.summary || {};
  const unitsSold = Number(summary.totalOrderUnits || metrics.soldUnits || 0);
  const orderCount = Number(summary.totalOrders || metrics.orderCount || metrics.ordersLast30Days || 0);
  const revenue = Number(summary.totalRevenue || metrics.salesAmount || metrics.revenueLast30Days || metrics.revenueAtRisk || 0);
  const windowDays = Number(activity.windowDays || metrics.windowDays || 365);
  const aov = orderCount ? revenue / orderCount : Number(metrics.avgOrderValue || metrics.avgUnitRevenue || 0);
  const velocity = windowDays ? unitsSold / windowDays : 0;
  const channelRows = getOrderChannelRows(metrics, orderCount);
  const geographyRows = getOrderGeographyRows(metrics, orderCount);
  const insightRows = [
    { label: "Units sold in window", value: formatInteger(unitsSold), detail: "Units sold in window", tone: "blue" },
    { label: "Order window", value: formatInteger(windowDays), detail: "Order window", tone: "violet" },
    { label: "Total signals detected", value: formatInteger(metrics.signalCount || source.points.length), detail: "Total signals detected", tone: "blue" },
  ];

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppOrdersEvidenceReport">
      <EvidenceSourceReportHeader source={source} title="Shopify orders" eyebrow="Orders" summary="Order data establishes baseline sold units, velocity and demand context." />

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        <EvidenceSourceStatCard icon="cash-dollar" label="Units sold" value={formatInteger(unitsSold)} detail="Sold in scan window" tone="teal" />
        <EvidenceSourceStatCard icon="cash-dollar" label="Orders" value={formatInteger(orderCount)} detail="Orders in scan window" tone="teal" />
        <EvidenceSourceStatCard icon="clock" label="Order window" value={`${formatInteger(windowDays)} days`} detail="Analysis window" tone="blue" />
        <EvidenceSourceStatCard icon="cash-dollar" label="AOV" value={formatMoney(aov)} detail="Average order value" tone="blue" />
      </div>

      <div className="ppReturnsEvidenceGrid">
        <section className="ppEvidenceReportSectionCard ppOrdersLineChartCard">
          <h4>Units sold over time</h4>
          <p>Daily sold units</p>
          <EvidenceOrdersLineChart months={activity.months} fallbackValue={unitsSold} />
        </section>
        <section className="ppEvidenceReportSectionCard ppOrderVelocityCard">
          <h4>Order velocity</h4>
          <p>By units per day</p>
          <strong>{formatDecimal(velocity, 3)}</strong>
          <small>Units per day (avg)</small>
          <MiniTrend tone="violet" values={activity.months.map((month) => Number(month.orderUnits || month.orders || 0))} />
        </section>
      </div>

      <div className="ppEvidenceTwoColumnGrid">
        <section className="ppEvidenceReportSectionCard">
          <h4>Sales by channel</h4>
          <p>By sold units</p>
          <EvidenceBarList rows={channelRows} tone="violet" emptyLabel="No channel data stored" />
        </section>
        <section className="ppEvidenceReportSectionCard">
          <h4>Geography</h4>
          <p>By order origin</p>
          <EvidenceBarList rows={geographyRows} tone="blue" emptyLabel="No geography data stored" />
        </section>
      </div>

      <div className="ppReturnsDetailMetricGrid">
        <EvidenceSourceStatCard icon="product" label="Vendor" value={metrics.vendor || "Not stored"} detail="Vendor" tone="blue" />
        <EvidenceSourceStatCard icon="tag" label="Product type" value={metrics.productType || "Not stored"} detail="Product type" tone="blue" />
        <EvidenceSourceStatCard icon="duplicate" label="Collections" value={formatInteger(getEvidenceList(metrics.collections).length)} detail="Collections" tone="blue" />
        <EvidenceSourceStatCard icon="note" label="Signal count" value={formatInteger(metrics.signalCount || source.points.length)} detail="Total signals" tone="blue" />
      </div>

      <div className="ppEvidenceBottomReportGrid">
        <section className="ppEvidenceReportSectionCard">
          <h4>Order insights</h4>
          <div className="ppEvidenceMiniInsightGrid">
            {insightRows.map((item, index) => (
              <EvidenceMiniInsight key={item.label} label={`Insight ${index + 1}`} value={item.value} detail={item.detail} tone={item.tone} />
            ))}
          </div>
        </section>
        <EvidenceFullReportCard href={reportHref} />
      </div>
    </div>
  );
}

function GenericEvidenceSourceReportPanel({ source, product, reportHref, cards = [] }) {
  const visibleCards = cards.length ? cards : getEvidenceSourceCards(source.title, source.points, product);
  const heroCards = visibleCards.slice(0, 4);
  const detailCards = visibleCards.slice(4);

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppGenericEvidenceReport">
      <EvidenceSourceReportHeader source={source} title={source.title} eyebrow={getEvidenceSourcePanelTitle(source.title)} summary={source.summary} />

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        {heroCards.map((card) => (
          <EvidenceSourceStatCard key={`${source.title}-${card.label}-${card.value}`} icon={card.icon} label={card.label} value={card.value} detail={card.detail} tone={card.tone || "blue"} trend={card.trend} />
        ))}
      </div>

      <div className="ppEvidenceBottomReportGrid">
        <section className="ppEvidenceReportSectionCard">
          <div className="ppEvidenceReportSectionHeaderRow">
            <div>
              <h4>Source findings</h4>
              <p>Most relevant evidence points from this source</p>
            </div>
          </div>
          <div className="ppEvidenceFindingStream ppEvidenceFindingStream-compact">
            {(source.points.length ? source.points : ["No stored details yet."]).slice(0, 8).map((point, index) => (
              <EvidenceFinding point={point} index={index} key={`${source.title}-generic-${point}-${index}`} />
            ))}
          </div>
        </section>

        <EvidenceFullReportCard href={reportHref} />
      </div>

      {detailCards.length > 0 && (
        <div className="ppEvidenceMetricGrid">
          {detailCards.map((card) => (
            <EvidenceMetricCard card={card} key={`${source.title}-detail-${card.label}-${card.value}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShopifyProductEvidencePanel({ source, product, reportHref }) {
  const metrics = product.metrics || {};
  const visibleCards = getEvidenceSourceCards(source.title, source.points, product);
  const heroCards = visibleCards.slice(0, 4);
  const detailCards = visibleCards.slice(4, 10);
  const variantRows = getShopifyProductVariantRows(metrics);
  const variantAiContext = getAiEvidenceContextSection(product, "variants");

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppShopifyProductEvidenceReport">
      <EvidenceSourceReportHeader
        source={source}
        title="Shopify product"
        eyebrow="Product data"
        summary="Product metadata, PDP content and variant context are reviewed together so catalog findings do not repeat across separate tabs."
      />

      <div className="ppEvidenceHeroMetricStrip ppEvidenceHeroMetricStrip-four">
        {heroCards.map((card) => (
          <EvidenceSourceStatCard key={`${source.title}-${card.label}-${card.value}`} icon={card.icon} label={card.label} value={card.value} detail={card.detail} tone={card.tone || "blue"} trend={card.trend} />
        ))}
      </div>

      <div className="ppEvidenceBottomReportGrid ppEvidenceBottomReportGrid-single">
        <section className="ppEvidenceReportSectionCard">
          <div className="ppEvidenceReportSectionHeaderRow">
            <div>
              <h4>Variant intelligence</h4>
              <p>Variant-level evidence available from Shopify, refunds and language signals</p>
            </div>
            <Link to={reportHref}>View full report <s-icon type="chevron-right" size="small"></s-icon></Link>
          </div>
          <EvidenceAiContextBlock section={variantAiContext} compact />
          <div className="ppEvidenceSignalTableWrap">
            <table className="ppEvidenceSignalTable">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Shopify data</th>
                  <th>Sales</th>
                  <th>Affected signals</th>
                  <th>Refunds</th>
                  <th>Returns</th>
                  <th>Reviews / language</th>
                </tr>
              </thead>
              <tbody>
                {variantRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div className="ppEvidenceSignalNameCell">
                        <span className={`ppEvidenceSignalTypeIcon ppEvidenceMetricCard-${row.tone}`}><ProductPulseGlyph type="variants" /></span>
                        <span>{row.variant}</span>
                      </div>
                    </td>
                    <td><VariantEvidenceCell evidence={row.shopifyData} /></td>
                    <td><VariantEvidenceCell evidence={row.sales} compactDetails /></td>
                    <td><VariantEvidenceCell evidence={row.affectedSignals} compactDetails /></td>
                    <td><VariantEvidenceCell evidence={row.refunds} compactDetails popoverLabel={`${row.variant} refund evidence`} /></td>
                    <td><VariantEvidenceCell evidence={row.returns} compactDetails popoverLabel={`${row.variant} return evidence`} /></td>
                    <td><VariantEvidenceCell evidence={row.reviews} compactDetails popoverLabel={`${row.variant} review evidence`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {detailCards.length > 0 && (
        <div className="ppEvidenceMetricGrid">
          {detailCards.map((card) => (
            <EvidenceMetricCard card={card} key={`${source.title}-detail-${card.label}-${card.value}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function AiEvidenceSynthesisPanel({ source, product, reportHref }) {
  const sections = getPersistedAiEvidenceSections(source);

  return (
    <div className="ppEvidenceSourcePanel ppEvidenceSourcePanel-specialized ppAiEvidenceSynthesisReport">
      <EvidenceSourceReportHeader
        source={source}
        title="AI evidence synthesis"
        eyebrow="Synthesis"
        summary="Technical interpretation of the stored product diagnosis across reviews, refunds, orders, product content and variants."
      />

      <section className="ppEvidenceReportSectionCard">
        <div className="ppEvidenceReportSectionHeaderRow">
          <div>
            <h4>Technical synthesis</h4>
            <p>How the evidence fits together</p>
          </div>
          <Link to={reportHref}>View full report <s-icon type="chevron-right" size="small"></s-icon></Link>
        </div>
        <div className="ppEvidenceFindingStream ppEvidenceFindingStream-compact">
          {sections.length ? sections.map((section, index) => (
            <div className={`ppEvidenceFinding ppEvidenceFinding-${section.tone || "default"}`} key={section.title}>
              <span className="ppEvidenceFindingIndex">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{section.title}</strong>
                <p>{renderAnalysisText(section.body)}</p>
              </div>
            </div>
          )) : <EmptyProductDetailState message="No stored AI synthesis text is available for this diagnosis." />}
        </div>
      </section>

      <div className="ppEvidenceMetricGrid">
        <EvidenceMetricCard card={{ label: "Signal count", value: formatInteger(product.metrics?.signalCount || source.points.length), detail: "Total stored diagnostic evidence for this product.", icon: "duplicate", tone: "blue" }} />
        <EvidenceMetricCard card={{ label: "Model confidence", value: `${formatInteger(product.confidence || 0)}%`, detail: "Diagnosis confidence stored with the current product snapshot.", icon: "shield-check-mark", tone: Number(product.confidence || 0) >= 80 ? "teal" : "amber" }} />
        <EvidenceMetricCard card={{ label: "Financial exposure", value: formatMoney(product.metrics?.estimatedImpact || product.estimatedImpact || 0), detail: "Business exposure is shown separately from Product Risk.", icon: "cash-dollar", tone: "violet" }} />
        <EvidenceMetricCard card={{ label: "Freshness", value: detailEvidenceFreshness(product), detail: "Most recent stored signal or diagnosis timestamp.", icon: "calendar", tone: "blue" }} />
      </div>
    </div>
  );
}

function EvidenceAiContextBlock({ section, compact = false }) {
  if (!section?.body) return null;
  return (
    <aside className={`ppEvidenceAiContextBlock${compact ? " ppEvidenceAiContextBlock-compact" : ""}`}>
      <span><s-icon type="wand" size="small"></s-icon>AI synthesis</span>
      <p>{renderAnalysisText(section.body)}</p>
    </aside>
  );
}

function getAiEvidenceContextSection(product = {}, sourceKind = "", options = {}) {
  const sectionKeysByKind = {
    "customer-language": ["customer-language"],
    reviews: ["customer-language"],
    returns: ["post-purchase"],
    refunds: ["post-purchase"],
    variants: ["variant-scope"],
  };
  const sectionKeys = sectionKeysByKind[sourceKind];
  if (!sectionKeys) return null;
  const aiSource = getAiEvidenceSynthesisSource(product);
  if (!aiSource.available) return null;
  const sections = getPersistedAiEvidenceSections(aiSource);
  const matchingSections = sections.filter((section) => sectionKeys.includes(section.key));
  const requestedSourceKey = normalizeEvidenceProviderKey(options.sourceKey || options.sourceTitle || "");
  if (requestedSourceKey) {
    return matchingSections.find((section) => normalizeEvidenceProviderKey(section.sourceKey || section.sourceTitle) === requestedSourceKey) || null;
  }
  return matchingSections.find((section) => !section.sourceKey && !section.sourceTitle) || matchingSections[0] || null;
}

function getAiEvidenceSynthesisSource(product = {}) {
  const item = getEvidenceList(product.evidence).find((evidence) => isAiEvidenceSynthesisSource(evidence.source));
  if (!item) return { title: "AI evidence synthesis", points: [], summary: "", tone: "insight", icon: "ai-evidence-synthesis", available: false };
  const persistedRecords = getStoredEvidenceRecords(item);
  const persistedPoints = getStoredEvidencePoints(item);
  const points = getEvidencePoints(item, product);
  return {
    title: "AI evidence synthesis",
    points,
    persistedPoints,
    persistedRecords,
    summary: persistedPoints[0] || points[0] || "",
    tone: "insight",
    icon: "ai-evidence-synthesis",
    available: true,
  };
}

function getPersistedAiEvidenceSections(source = {}) {
  const records = getEvidenceList(source.persistedRecords).length
    ? getEvidenceList(source.persistedRecords)
    : getEvidenceList(source.persistedPoints).map((point) => {
        const parsed = parseEvidencePoint(point);
        return { title: parsed.label, body: parsed.body, tone: parsed.tone };
      });
  return records
    .map((record, index) => {
      const body = String(record.body || "").trim();
      if (!body || isAiEvidenceMetadataText(body)) return null;
      const explicitKey = normalizePersistedAiSectionKey(record.sectionKey);
      const title = getPersistedAiEvidenceSectionTitle(record.title, body, index, explicitKey);
      const key = explicitKey || getPersistedAiEvidenceSectionKey(title, body);
      return {
        title,
        body,
        key,
        sourceTitle: String(record.sourceTitle || "").trim(),
        sourceKey: normalizeEvidenceProviderKey(record.sourceKey || record.sourceTitle || ""),
        tone: getPersistedAiEvidenceSectionTone(key, record.tone),
      };
    })
    .filter(Boolean)
    .filter((section, index, sections) => sections.findIndex((item) => (
      item.key === section.key
      && item.body === section.body
      && item.sourceKey === section.sourceKey
    )) === index)
    .slice(0, 8);
}

function isAiEvidenceMetadataText(value = "") {
  const normalized = String(value || "").toLowerCase().trim();
  return normalized === "generated from deterministic metrics and stored snippets."
    || normalized.includes("total signals in current diagnosis")
    || normalized.startsWith("last signal captured");
}

function getPersistedAiEvidenceSectionTitle(label = "", body = "", index = 0, explicitKey = "") {
  const key = explicitKey || getPersistedAiEvidenceSectionKeyFromText(label) || getPersistedAiEvidenceSectionKeyFromText(body);
  if (key === "cross-source") return "Cross-source reading";
  if (key === "customer-language") return "Customer language";
  if (key === "post-purchase") return "Refund and return evidence";
  if (key === "variant-scope") return "Variant scope";
  if (key === "catalog-context") return "PDP and catalog context";
  if (key === "operational") return "Operational interpretation";
  return label ? String(label).trim() : index === 0 ? "Stored synthesis" : "Additional synthesis";
}

function normalizePersistedAiSectionKey(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("customer") || normalized.includes("language") || normalized.includes("review") || normalized.includes("sentiment")) return "customer-language";
  if (normalized.includes("refund") || normalized.includes("return") || normalized.includes("post_purchase") || normalized.includes("postpurchase")) return "post-purchase";
  if (normalized.includes("variant") || normalized.includes("sku") || normalized.includes("option")) return "variant-scope";
  if (normalized.includes("pdp") || normalized.includes("catalog") || normalized.includes("content") || normalized.includes("description") || normalized.includes("shopify_product")) return "catalog-context";
  if (normalized.includes("operational") || normalized.includes("risk") || normalized.includes("confidence") || normalized.includes("exposure") || normalized.includes("triage")) return "operational";
  if (normalized.includes("cross") || normalized.includes("source")) return "cross-source";
  return "";
}

function getPersistedAiEvidenceSectionKey(title = "", body = "") {
  const explicitKey = getPersistedAiEvidenceSectionKeyFromText(title);
  if (explicitKey) return explicitKey;
  return getPersistedAiEvidenceSectionKeyFromText(body) || "stored-synthesis";
}

function getPersistedAiEvidenceSectionKeyFromText(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (/\bcross\b/.test(normalized) || normalized.includes("source agreement") || normalized.includes("source reading")) return "cross-source";
  if (/\bcustomer\b/.test(normalized) || /\blanguage\b/.test(normalized) || /\breviews?\b/.test(normalized) || /\bsentiment\b/.test(normalized)) return "customer-language";
  if (/\brefunds?\b/.test(normalized) || /\breturns?\b/.test(normalized) || normalized.includes("post-purchase") || normalized.includes("post purchase")) return "post-purchase";
  if (/\bvariants?\b/.test(normalized) || /\bskus?\b/.test(normalized) || /\boptions?\b/.test(normalized)) return "variant-scope";
  if (/\bpdp\b/.test(normalized) || /\bcatalog\b/.test(normalized) || /\bcontent\b/.test(normalized) || /\bdescription\b/.test(normalized) || normalized.includes("shopify product")) return "catalog-context";
  if (/\boperational\b/.test(normalized) || /\brisk\b/.test(normalized) || /\bconfidence\b/.test(normalized) || /\bexposure\b/.test(normalized) || /\btriage\b/.test(normalized)) return "operational";
  return "";
}

function getPersistedAiEvidenceSectionTone(key = "", fallbackTone = "default") {
  if (key === "customer-language" || key === "variant-scope" || key === "catalog-context") return "insight";
  if (key === "post-purchase") return "negative";
  if (key === "operational") return "default";
  return fallbackTone || "default";
}

function normalizeEvidenceProviderKey(value = "") {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("csv")) return "csv_reviews";
  if (normalized.includes("judge") || normalized.includes("judgeme")) return "judgeme_reviews";
  if (normalized.includes("chatme") || normalized.includes("chat_me")) return "chatme_reviews";
  if (normalized.includes("review")) return normalized;
  return normalized;
}

function VariantEvidenceCell({ evidence, compactDetails = false, popoverLabel = "variant evidence" }) {
  const details = getEvidenceList(evidence?.details);
  const visibleDetails = compactDetails ? [] : details.slice(0, 2);
  const popoverDetails = compactDetails ? details : details.slice(2);
  return (
    <div className={`ppVariantEvidenceCell ppVariantEvidenceCell-${evidence?.tone || "neutral"}`}>
      <div className="ppVariantEvidenceCellMain">
        <strong>{evidence?.summary || "No variant-specific evidence"}</strong>
        {popoverDetails.length ? <VariantEvidenceDetailsPopover details={popoverDetails} label={popoverLabel} /> : null}
      </div>
      {visibleDetails.map((detail, index) => (
        <small key={`${detail}-${index}`}>{renderAnalysisText(detail)}</small>
      ))}
    </div>
  );
}

function VariantEvidenceDetailsPopover({ details = [], label = "variant evidence" }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const popoverId = `variant-evidence-${reactId}-${normalizeVariantEvidenceKey(label || "details").replace(/[^a-z0-9]+/g, "-") || "details"}`;

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (event.target?.closest?.(".ppVariantEvidenceFloatingPopover")) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        className="ppVariantEvidencePopoverButton"
        type="button"
        ref={triggerRef}
        aria-label={`View details for ${label}`}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <s-icon type="info" size="small"></s-icon>
      </button>
      <FloatingTablePopover
        anchorRef={triggerRef}
        open={open}
        className="ppVariantEvidenceFloatingPopover"
        width={380}
        estimatedHeight={220}
        placement="bottom-end"
        role="dialog"
      >
        <div id={popoverId} className="ppVariantEvidencePopoverContent">
          <strong>{startCase(label)}</strong>
          <div>
            {details.map((detail, index) => (
              <p key={`${detail}-${index}`}>{renderAnalysisText(detail)}</p>
            ))}
          </div>
        </div>
      </FloatingTablePopover>
    </>
  );
}

function getShopifyProductVariantRows(metrics = {}) {
  const affectedDetails = getEvidenceList(metrics.affectedVariantDetails);
  const variantInsights = getEvidenceList(metrics.variantInsights);
  const refundExamples = getEvidenceList(metrics.refundInsights?.examples);
  const returnExamples = getEvidenceList(metrics.textInsights?.returns?.examples);
  const reviewExamples = getEvidenceList(metrics.textInsights?.reviews?.examples);
  const variantCandidates = getShopifyProductVariantCandidates(metrics, [
    ...variantInsights,
    ...refundExamples,
    ...returnExamples,
    ...reviewExamples,
  ]);

  const rows = variantCandidates.map((variant, index) => {
    const title = getVariantDisplayTitle(variant);
    const insight = getVariantInsightForVariant(variantInsights, variant);
    const refundSignals = getEvidenceList(insight?.refunds?.examples).length
      ? getEvidenceList(insight.refunds.examples)
      : refundExamples.filter((example) => matchesVariantEvidence(example, variant));
    const returnSignals = getEvidenceList(insight?.returns?.examples).length
      ? getEvidenceList(insight.returns.examples)
      : returnExamples.filter((example) => matchesVariantEvidence(example, variant));
    const reviewSignals = getEvidenceList(insight?.reviews?.examples).length
      ? getEvidenceList(insight.reviews.examples)
      : reviewExamples.filter((example) => matchesVariantEvidence(example, variant));
    const affectedSignals = getAffectedVariantSignalCount(affectedDetails, variant)
      || Number(insight?.signalCount || 0)
      || sumVariantEvidenceUnits(refundSignals)
      || sumVariantEvidenceUnits(returnSignals)
      || Number(insight?.reviews?.negativeCount || 0)
      || reviewSignals.length
      || 0;
    const hasVariantEvidence = Boolean(affectedSignals || Number(insight?.sales?.units || 0) || refundSignals.length || returnSignals.length || reviewSignals.length);
    return {
      key: `${normalizeVariantEvidenceKey(title) || "variant"}-${variant.id || variant.sku || index}`,
      variant: title,
      shopifyData: getVariantShopifyDataCell({ ...variant, ...getVariantShopifyFieldsFromInsight(insight) }),
      sales: getVariantSalesEvidenceCell(insight),
      affectedSignals: getVariantAffectedSignalsCell({ affectedSignals, affectedDetails, variant, metrics, insight }),
      refunds: getVariantRefundEvidenceCell(refundSignals, insight?.refunds),
      returns: getVariantTextEvidenceCell(returnSignals, "return", insight?.returns),
      reviews: getVariantReviewEvidenceCell(reviewSignals, insight?.reviews),
      tone: hasVariantEvidence ? "amber" : "blue",
    };
  });

  if (rows.length) return rows;
  return [{
    key: "no-variants-stored",
    variant: "No variants stored",
    shopifyData: buildVariantEvidenceCell("No Shopify variant data", ["No variant title, SKU or price is stored for this product."], "neutral"),
    sales: buildVariantEvidenceCell("No sales evidence", [], "neutral"),
    affectedSignals: buildVariantEvidenceCell("0 affected signals", ["Variant analysis needs Shopify variant data and product-matched returns, refunds or reviews."], "neutral"),
    refunds: buildVariantEvidenceCell("No refund evidence", [], "neutral"),
    returns: buildVariantEvidenceCell("No return evidence", [], "neutral"),
    reviews: buildVariantEvidenceCell("No review evidence", [], "neutral"),
    tone: "blue",
  }];
}

function getShopifyProductVariantCandidates(metrics = {}, evidenceExamples = []) {
  const variants = [];
  const seen = new Set();
  const addVariant = (variant) => {
    const normalizedVariant = typeof variant === "string" ? { title: variant } : variant;
    const title = getVariantDisplayTitle(normalizedVariant);
    const key = normalizeVariantEvidenceKey(title || normalizedVariant?.sku || normalizedVariant?.id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    variants.push(normalizedVariant);
  };

  getEvidenceList(metrics.variants).forEach(addVariant);
  getEvidenceList(metrics.variantInsights).forEach((item) => addVariant({
    id: item.variantId,
    title: item.variantTitle,
    sku: item.sku,
    price: item.price,
    selectedOptions: item.selectedOptions,
  }));
  getEvidenceList(metrics.affectedVariantDetails).forEach((item) => addVariant({ title: item.label || item.variant || item.name, count: item.count }));
  getEvidenceList(metrics.affectedVariants).forEach(addVariant);
  evidenceExamples.forEach((item) => {
    const title = item.variant || item.variantTitle || item.variantName || item.variantLabel;
    if (title) addVariant({ title, sku: item.sku || item.variantSku, id: item.variantId });
  });

  return variants;
}

function getVariantDisplayTitle(variant = {}) {
  if (typeof variant === "string") return variant;
  return variant.title || variant.variantTitle || variant.name || variant.label || getVariantOptionsLabel(variant) || variant.sku || "Variant";
}

function getVariantOptionsLabel(variant = {}) {
  const rawOptions = variant.selectedOptions || variant.options;
  const selectedOptions = Array.isArray(rawOptions)
    ? rawOptions
    : rawOptions && typeof rawOptions === "object"
      ? Object.entries(rawOptions).map(([name, value]) => ({ name, value }))
      : [];
  const optionValues = selectedOptions.map((option) => {
    if (typeof option === "string") return option;
    return option.value || option.name || option.label;
  }).filter(Boolean);
  return optionValues.join(" / ");
}

function getVariantShopifyDataCell(variant = {}) {
  const sku = variant.sku || variant.variantSku || "";
  const price = variant.price || variant.unitPrice || variant.amount;
  const optionText = getVariantOptionsLabel(variant);
  const details = [
    optionText ? `Options: ${optionText}` : "",
    variant.id ? `Variant ID: ${String(variant.id).split("/").pop()}` : "",
  ].filter(Boolean);
  const summary = [sku ? `SKU ${sku}` : "", price ? formatMoney(price) : ""].filter(Boolean).join(" · ") || "SKU / price not stored";
  return buildVariantEvidenceCell(summary, details, sku || price ? "blue" : "neutral");
}

function getVariantAffectedSignalsCell({ affectedSignals = 0, affectedDetails = [], variant = {}, metrics = {} }) {
  const detail = affectedDetails.find((item) => matchesVariantEvidence(item, variant));
  const count = Number(affectedSignals || detail?.count || 0);
  const details = [
    detail?.detail || detail?.evidence || detail?.reason || "",
    Number(metrics.variantConcentration || 0) ? `${formatPercent(metrics.variantConcentration)} affected-scope concentration` : "",
  ].filter(Boolean);
  if (!count) return buildVariantEvidenceCell("No affected-scope signal", details, "neutral");
  return buildVariantEvidenceCell(`${formatInteger(count)} stored signal${count === 1 ? "" : "s"}`, details, "amber");
}

function getVariantSalesEvidenceCell(insight = null) {
  const units = Number(insight?.sales?.units || 0);
  const amount = Number(insight?.sales?.amount || 0);
  if (!units && !amount) return buildVariantEvidenceCell("No sales evidence", [], "neutral");
  const details = [
    amount ? `${formatMoney(amount)} sales amount` : "",
    Number(insight?.returns?.rate || 0) ? `${formatPercent(insight.returns.rate)} return rate for this variant` : "",
    Number(insight?.refunds?.rate || 0) ? `${formatPercent(insight.refunds.rate)} refund rate for this variant` : "",
  ].filter(Boolean);
  return buildVariantEvidenceCell(`${formatInteger(units)} sold unit${units === 1 ? "" : "s"}`, details, "teal");
}

function getVariantRefundEvidenceCell(refundSignals = [], refundSummary = null) {
  const quantity = Number(refundSummary?.units || 0) || sumVariantEvidenceUnits(refundSignals);
  const amount = Number(refundSummary?.amount || 0) || refundSignals.reduce((sum, item) => sum + Number(item.amount || item.refundAmount || 0), 0);
  if (!quantity && !amount) return buildVariantEvidenceCell("No refund evidence", [], "neutral");
  const details = refundSignals.map((item) => formatVariantEvidenceExample(item, "refund")).filter(Boolean);
  getEvidenceList(refundSummary?.topReasons).slice(0, 2).forEach((item) => {
    if (item?.label) details.push(`Top refund reason: ${item.label}${item.count ? ` (${formatInteger(item.count)})` : ""}`);
  });
  const summary = `${formatInteger(quantity)} refund signal${quantity === 1 ? "" : "s"}${amount ? ` · ${formatMoney(amount)}` : ""}`;
  return buildVariantEvidenceCell(summary, details, "red");
}

function getVariantTextEvidenceCell(items = [], kind = "signal", sourceSummary = null) {
  const quantity = Number(sourceSummary?.units || 0) || sumVariantEvidenceUnits(items);
  if (!quantity && !items.length) return buildVariantEvidenceCell(`No ${kind} evidence`, [], "neutral");
  const details = items.map((item) => formatVariantEvidenceExample(item, kind)).filter(Boolean);
  getEvidenceList(sourceSummary?.topReasons).slice(0, 2).forEach((item) => {
    if (item?.label) details.push(`Top ${kind} reason: ${item.label}${item.count ? ` (${formatInteger(item.count)})` : ""}`);
  });
  return buildVariantEvidenceCell(`${formatInteger(quantity)} ${kind} signal${quantity === 1 ? "" : "s"}`, details, kind === "review" ? "violet" : "amber");
}

function getVariantReviewEvidenceCell(items = [], reviewSummary = null) {
  const reviewCount = Number(reviewSummary?.count || 0);
  const negativeCount = Number(reviewSummary?.negativeCount || 0);
  const positiveCount = Number(reviewSummary?.positiveCount || 0);
  const quantity = reviewCount || sumVariantEvidenceUnits(items);
  if (!quantity && !items.length) return buildVariantEvidenceCell("No review evidence", [], "neutral");
  const details = items.map((item) => formatVariantEvidenceExample(item, "review")).filter(Boolean);
  getEvidenceList(reviewSummary?.sources).slice(0, 2).forEach((item) => {
    if (item?.label) details.push(`${item.label}: ${formatInteger(item.count || 0)} review${Number(item.count || 0) === 1 ? "" : "s"}`);
  });
  const rating = Number(reviewSummary?.averageRating || 0);
  if (rating) details.push(`${formatDecimal(rating, 1)} average rating for this variant`);
  const summary = negativeCount && positiveCount
    ? `${formatInteger(negativeCount)} negative · ${formatInteger(positiveCount)} positive`
    : negativeCount
    ? `${formatInteger(negativeCount)} negative review${negativeCount === 1 ? "" : "s"} · ${formatInteger(reviewCount)} total`
    : positiveCount
    ? `${formatInteger(positiveCount)} positive review${positiveCount === 1 ? "" : "s"}`
    : `${formatInteger(quantity)} review signal${quantity === 1 ? "" : "s"}`;
  return buildVariantEvidenceCell(summary, details, "violet");
}

function getVariantInsightForVariant(variantInsights = [], variant = {}) {
  return getEvidenceList(variantInsights).find((item) => matchesVariantEvidence(item, variant)) || null;
}

function getVariantShopifyFieldsFromInsight(insight = null) {
  if (!insight) return {};
  return {
    id: insight.variantId,
    variantId: insight.variantId,
    title: insight.variantTitle,
    variantTitle: insight.variantTitle,
    sku: insight.sku,
    price: insight.price,
    selectedOptions: insight.selectedOptions,
  };
}

function sumVariantEvidenceUnits(items = []) {
  return items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || item.count || item.units || 1)), 0);
}

function formatVariantEvidenceExample(item = {}, kind = "signal") {
  const reason = item.reasonText || item.reason || item.issueCode || item.adjustmentReason || "";
  const rating = item.rating ? `${item.rating}/5` : "";
  const sentiment = item.sentiment ? startCase(item.sentiment) : "";
  const text = item.noteText || item.text || item.analysisText || "";
  const prefix = [rating, sentiment, reason ? startCase(reason) : ""].filter(Boolean).join(" · ");
  const body = text ? quoteSourceText(summarizeEvidencePoint(text)) : "";
  return [prefix || startCase(kind), body].filter(Boolean).join(": ");
}

function buildVariantEvidenceCell(summary, details = [], tone = "neutral") {
  return { summary, details: getEvidenceList(details), tone };
}

function getAffectedVariantSignalCount(affectedDetails = [], variant = {}) {
  const detail = affectedDetails.find((item) => matchesVariantEvidence(item, variant));
  return Number(detail?.count || 0);
}

function matchesVariantEvidence(item = {}, variant = {}) {
  const itemKeys = getVariantEvidenceKeys(item);
  const variantKeys = getVariantEvidenceKeys(variant);
  if (!itemKeys.length || !variantKeys.length) return false;
  return itemKeys.some((itemKey) => variantKeys.some((variantKey) => (
    itemKey === variantKey
      || variantKey.split(/[^a-z0-9]+/).includes(itemKey)
      || itemKey.split(/[^a-z0-9]+/).includes(variantKey)
      || (itemKey.length > 2 && variantKey.includes(itemKey))
      || (variantKey.length > 2 && itemKey.includes(variantKey))
  )));
}

function getVariantEvidenceKeys(value = {}) {
  if (typeof value === "string") return [normalizeVariantEvidenceKey(value)].filter(Boolean);
  const keys = [
    value.id,
    value.variantId,
    value.sku,
    value.variantSku,
    value.title,
    value.variant,
    value.variantTitle,
    value.variantName,
    value.variantLabel,
    value.label,
    value.name,
    getVariantOptionsLabel(value),
  ];
  return [...new Set(keys.map(normalizeVariantEvidenceKey).filter(Boolean))];
}

function normalizeVariantEvidenceKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/^gid:\/\/shopify\/productvariant\//, "")
    .replace(/\bdefault title\b/g, "default variant")
    .replace(/\s+/g, " ")
    .trim();
}

function EvidenceSourceReportHeader({ source, title, summary, eyebrow = "" }) {
  return (
    <div className="ppEvidenceActiveHeader ppEvidenceReportActiveHeader">
      <div className="ppEvidenceActiveTitle">
        <span className={`ppEvidenceSourceGlyph ppEvidenceTone-${source.tone}`}>
          <ProductPulseGlyph type={source.icon} />
        </span>
        <div>
          {eyebrow && <span>{eyebrow}</span>}
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>
      <span className="ppEvidenceSignalCount">{source.points.length} signals</span>
    </div>
  );
}

function EvidenceSourceStatCard({ icon = "info", label, value, detail, tone = "blue", compact = false, trend = null }) {
  return (
    <article className={`ppEvidenceSourceStatCard ppEvidenceMetricCard-${tone}${compact ? " ppEvidenceSourceStatCard-compact" : ""}`}>
      <span className="ppEvidenceMetricIcon" aria-hidden="true">
        <ProductPulseGlyph type={icon} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value || "0"}</strong>
        <small>{renderAnalysisText(detail || "Stored evidence")}</small>
      </div>
      {Array.isArray(trend) && trend.length > 0 && <MiniTrend tone={getTrendTone(trend)} values={trend} />}
    </article>
  );
}

function getReviewEvidenceStats(source = {}, product = {}) {
  const metrics = product.metrics || {};
  const textInsights = metrics.textInsights || {};
  const sourceTitle = source?.title || source || "";
  const sourceSummary = getReviewSourceSummary(textInsights, sourceTitle);
  const sourceStats = getReviewSourceStats(metrics, sourceTitle);
  const reviewCount = Number(sourceStats.reviewCount || 0);
  const averageRating = Number(sourceStats.avgRating || sourceStats.averageRating || 0);
  const negativeCount = Number(sourceStats.negativeReviewCount || 0);
  const negativeRate = Number(sourceStats.negativeReviewRate || (reviewCount ? (negativeCount / reviewCount) * 100 : 0));
  const recentNegativeWindowDays = Number(sourceStats.recentNegativeReviewWindowDays || metrics.recentNegativeReviewWindowDays || 30);
  const recentNegativeCount = Number(sourceStats.recentNegativeReviewCount || 0);
  const storedSentiment = normalizeEvidenceSentiment(sourceSummary?.sentiment || (!isSpecificReviewSource(sourceTitle) ? textInsights.reviews?.sentiment : null));
  const sentiment = storedSentiment.total
    ? storedSentiment
    : {
        total: reviewCount,
        negative: negativeCount,
        neutral: Math.max(0, reviewCount - negativeCount),
        positive: 0,
      };

  return {
    reviewCount,
    averageRating,
    averageRatingLabel: averageRating ? formatDecimal(averageRating, 1) : "0",
    negativeCount,
    negativeRate,
    negativeRateLabel: formatPercent(negativeRate),
    recentNegativeCount,
    recentNegativeWindowDays,
    recentNegativeWindowLabel: `Last ${formatInteger(recentNegativeWindowDays)} days`,
    totalAnalyzed: Math.max(reviewCount, sentiment.total),
    sentiment,
    sentimentRows: getSentimentDonutRows(sentiment),
  };
}

function getReviewSentimentTrendData(textInsights = {}, sourceTitle = "", reviewStats = {}) {
  const sourceSummary = getReviewSourceSummary(textInsights, sourceTitle);
  const specificSource = isSpecificReviewSource(sourceTitle);
  const storedTrend = getEvidenceList(sourceSummary?.sentimentTrend || (!specificSource ? textInsights.reviews?.sentimentTrend : []));
  const normalizedTrend = storedTrend
    .map((row, index) => ({
      key: row.key || row.label || `trend-${index}`,
      label: row.label || row.key || `Point ${index + 1}`,
      date: row.date || row.createdAt || "",
      positive: Number(row.positive || 0),
      neutral: Number(row.neutral || 0),
      negative: Number(row.negative || 0),
      total: Number(row.total || 0),
    }))
    .filter((row) => row.total || row.positive || row.neutral || row.negative);
  if (normalizedTrend.length) return normalizedTrend;

  const sentiment = normalizeEvidenceSentiment(sourceSummary?.sentiment || reviewStats.sentiment);
  if (!sentiment.total) return [];
  return [{
    key: "current",
    label: "Current",
    date: "",
    positive: sentiment.positive,
    neutral: sentiment.neutral,
    negative: sentiment.negative,
    total: sentiment.total,
  }];
}

function getSentimentDonutRows(sentiment = {}) {
  const normalized = normalizeEvidenceSentiment(sentiment);
  return [
    { label: "Negative", value: normalized.negative, tone: "red", color: "var(--pp-risk-red)" },
    { label: "Neutral", value: normalized.neutral, tone: "blue", color: "var(--pp-pulse-blue)" },
    { label: "Positive", value: normalized.positive, tone: "teal", color: "var(--pp-signal-teal)" },
  ];
}

function uniqueByEvidenceLabel(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = String(item.label || item.normalizedLabel || item.code || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isReviewScopedEvidenceItem(item = {}) {
  const sources = getEvidenceList(item.sources || item.sourceTypes || item.source)
    .map((source) => String(source || "").toLowerCase());
  if (!sources.length) return true;
  return sources.some((source) => source.includes("review") || source.includes("csv") || source.includes("judgeme"));
}

function isSpecificReviewSource(sourceTitle = "") {
  const normalized = normalizeEvidenceProviderKey(sourceTitle);
  return ["csv_reviews", "judgeme_reviews", "chatme_reviews"].includes(normalized);
}

function getReviewStatsKey(sourceTitle = "") {
  const normalized = normalizeEvidenceProviderKey(sourceTitle);
  if (normalized === "csv_reviews") return "csv";
  if (normalized === "judgeme_reviews") return "judgeMe";
  if (normalized === "chatme_reviews") return "chatMe";
  return "total";
}

function getReviewSourceStats(metrics = {}, sourceTitle = "") {
  const stats = metrics.reviewSourceStats || {};
  const statsKey = getReviewStatsKey(sourceTitle);
  if (stats[statsKey]) return stats[statsKey];
  if (statsKey === "csv") {
    return {
      reviewCount: metrics.csvReviewCount || metrics.csvReviewRatingCount || 0,
      negativeReviewCount: metrics.csvNegativeReviewCount || metrics.csvLowRatingCount || 0,
      avgRating: metrics.csvAverageRating || metrics.csvReviewRating || 0,
      negativeReviewRate: metrics.csvNegativeRatingRate || 0,
      recentNegativeReviewCount: metrics.csvRecentNegativeReviewCount || 0,
    };
  }
  if (statsKey === "judgeMe") {
    return {
      reviewCount: metrics.judgeMeReviewCount || 0,
      negativeReviewCount: metrics.judgeMeNegativeReviewCount || 0,
      avgRating: metrics.judgeMeAverageRating || 0,
      negativeReviewRate: 0,
      recentNegativeReviewCount: 0,
    };
  }
  return stats.total || {
    reviewCount: metrics.reviewCount || 0,
    negativeReviewCount: metrics.negativeReviewCount || 0,
    avgRating: metrics.avgRating || metrics.reviewRating || 0,
    negativeReviewRate: metrics.negativeReviewRate || 0,
    recentNegativeReviewCount: metrics.recentNegativeReviewCount || 0,
  };
}

function getReviewSourceSummary(textInsights = {}, sourceTitle = "") {
  const bySource = textInsights.reviews?.bySource || textInsights.reviewSources || {};
  const sourceKey = getReviewStatsKey(sourceTitle);
  return bySource[sourceKey] || bySource[normalizeEvidenceProviderKey(sourceTitle)] || null;
}

function normalizePhraseSentiments(item = {}) {
  const sentiments = item.sentiments && typeof item.sentiments === "object" ? item.sentiments : {};
  const dominant = String(item.dominantSentiment || item.sentiment || "").toLowerCase();
  const count = Math.max(1, Number(item.count || item.signals || 0));
  return {
    positive: Number(sentiments.positive || 0) || (dominant === "positive" ? count : 0),
    neutral: Number(sentiments.neutral || 0) || (dominant === "neutral" ? count : 0),
    negative: Number(sentiments.negative || 0) || (dominant === "negative" ? count : 0),
  };
}

function getDominantPhraseSentiment(sentiments = {}) {
  return Object.entries(sentiments)
    .sort((first, second) => Number(second[1] || 0) - Number(first[1] || 0))[0]?.[0] || "neutral";
}

function getEvidencePhraseTone(phrases = [], fallbackTone = "red") {
  const totals = (Array.isArray(phrases) ? phrases : []).reduce((acc, phrase) => {
    const sentiments = normalizePhraseSentiments(phrase);
    acc.positive += Number(sentiments.positive || 0);
    acc.negative += Number(sentiments.negative || 0);
    return acc;
  }, { positive: 0, negative: 0 });
  if (totals.positive > totals.negative) return "teal";
  if (totals.negative > totals.positive) return "red";
  return fallbackTone;
}

function normalizeTextForEvidenceHeuristics(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePositiveRecoveryReviewText(text = "", rating = 0) {
  const normalized = normalizeTextForEvidenceHeuristics(text);
  const hasRecovery = /\b(arrived safely|arrived intact|better packaging|better separators|packaging looked much better|no chips?|no damage|no cracks?|problem is being handled|issue is being handled|resolved|fixed|improved|more confident)\b/.test(normalized);
  const hasStrongRecovery = /\b(arrived safely|arrived intact|better separators|no chips?|no damage|no cracks?|more confident|problem is being handled|issue is being handled)\b/.test(normalized);
  const hasUnresolvedProblem = /\b(still broken|still cracked|still damaged|still missing|still a problem|still an issue|arrived broken|arrived damaged|arrived cracked|not fixed|not resolved|not improved|no improvement|continues? to|keeps? (breaking|leaking|failing)|doesn t work|doesnt work|not working|unusable|unsafe|dangerous|failed|leaks?|leaking)\b/.test(normalized);
  return (Number(rating || 0) >= 4 || hasStrongRecovery) && hasRecovery && !hasUnresolvedProblem;
}

function getReviewEmotionRows(textInsights = {}, sourceTitle = "") {
  const sourceSummary = getReviewSourceSummary(textInsights, sourceTitle);
  const specificSource = isSpecificReviewSource(sourceTitle);
  const reviewSentiment = normalizeEvidenceSentiment(sourceSummary?.sentiment || (!specificSource ? textInsights.reviews?.sentiment || textInsights.sentiment : null));
  const reviewEmotions = getEvidenceList(sourceSummary?.emotions || (!specificSource ? textInsights.reviews?.emotions : []));
  const aiKnownEmotions = getEvidenceList(textInsights.aiKnownEmotions);
  const fallbackEmotions = getEvidenceList(!specificSource ? textInsights.emotions : []);
  let sourceRows = reviewEmotions.length ? reviewEmotions : !specificSource && aiKnownEmotions.length ? aiKnownEmotions : fallbackEmotions;

  if (reviewSentiment.total && reviewSentiment.positive > reviewSentiment.negative) {
    const negativeEmotionTotal = sourceRows
      .filter((item) => getEvidenceEmotionPolarity(item) === "negative")
      .reduce((total, item) => total + Number(item.count || item.signals || 0), 0);
    if (negativeEmotionTotal > reviewSentiment.negative) {
      const positiveAiRows = aiKnownEmotions.filter((item) => getEvidenceEmotionPolarity(item) === "positive" && isReviewScopedEvidenceItem(item));
      const cappedNegativeRows = sourceRows.filter((item) => getEvidenceEmotionPolarity(item) === "negative" && Number(item.count || item.signals || 0) <= reviewSentiment.negative);
      const nonNegativeRows = sourceRows.filter((item) => getEvidenceEmotionPolarity(item) !== "negative");
      sourceRows = uniqueByEvidenceLabel([
        ...positiveAiRows,
        ...nonNegativeRows,
        ...cappedNegativeRows,
      ]);
    }
  } else if (reviewSentiment.total && reviewSentiment.negative === 0 && reviewSentiment.positive > 0) {
    const positiveAiRows = aiKnownEmotions.filter((item) => getEvidenceEmotionPolarity(item) === "positive" && isReviewScopedEvidenceItem(item));
    const nonNegativeRows = sourceRows.filter((item) => getEvidenceEmotionPolarity(item) !== "negative");
    sourceRows = positiveAiRows.length ? positiveAiRows : nonNegativeRows;
  }

  const rows = sourceRows
    .map((item) => ({
      label: item.label || item.normalizedLabel || item.code || "Emotion",
      count: Number(item.count || item.signals || 0),
    }))
    .filter((item) => item.label && item.count >= 0)
    .sort((first, second) => second.count - first.count)
    .slice(0, 5);
  return rows.length ? rows : [{ label: "No emotion taxonomy stored", count: 0 }];
}

function getReviewRepeatedLanguage(textInsights = {}, sourceTitle = "") {
  const sourceSummary = getReviewSourceSummary(textInsights, sourceTitle);
  if (sourceSummary?.repeatedLanguage?.length) {
    return dedupePhraseRows(sourceSummary.repeatedLanguage.map((item) => ({
      term: item.term || item.label || item.phrase || "",
      count: Number(item.count || item.signals || 0),
      sentiments: normalizePhraseSentiments(item),
      dominantSentiment: item.dominantSentiment || item.sentiment || getDominantPhraseSentiment(normalizePhraseSentiments(item)),
    })).filter((item) => item.term)).slice(0, 6);
  }
  const sourceKey = normalizeEvidenceProviderKey(sourceTitle);
  const specificSource = isSpecificReviewSource(sourceTitle);
  const rows = [
    ...getEvidenceList(!specificSource ? textInsights.reviews?.repeatedLanguage : []),
    ...getEvidenceList(textInsights.repeatedLanguage).filter((item) => {
      const sources = getEvidenceList(item.sources).join(" ").toLowerCase();
      if (sourceKey === "csv_reviews") return sources.includes("csv");
      if (sourceKey === "judgeme_reviews") return sources.includes("judgeme") || sources.includes("judge");
      if (sourceKey === "chatme_reviews") return sources.includes("chatme");
      return sources.includes("review");
    }),
  ].map((item) => ({
    term: item.term || item.label || item.phrase || "",
    count: Number(item.count || item.signals || 0),
    sentiments: normalizePhraseSentiments(item),
    dominantSentiment: item.dominantSentiment || item.sentiment || getDominantPhraseSentiment(normalizePhraseSentiments(item)),
  })).filter((item) => item.term);
  return dedupePhraseRows(rows).slice(0, 6);
}

function getReviewExampleRows(textInsights = {}, points = [], reviewStats = {}, sourceTitle = "") {
  const sourceSummary = getReviewSourceSummary(textInsights, sourceTitle);
  const sourceKey = normalizeEvidenceProviderKey(sourceTitle);
  const specificSource = isSpecificReviewSource(sourceTitle);
  const sourceExamples = getEvidenceList(sourceSummary?.examples).length
    ? getEvidenceList(sourceSummary.examples)
    : getEvidenceList(textInsights.reviews?.examples).filter((example) => !specificSource || reviewExampleMatchesSource(example, sourceKey));
  const examples = dedupeReviewExampleRows(sourceExamples
    .map((example) => ({
      title: example.title || example.summary || truncateText(example.text || example.body || "Review example", 56),
      text: example.text || example.body || example.note || "Review text was captured but no excerpt is stored.",
      rating: Number(example.rating || (String(example.sentiment || "").toLowerCase() === "negative" ? 1 : 3)),
      date: example.date || example.createdAt ? formatProductAnalysisDate(example.date || example.createdAt) : "",
      tags: [
        example.emotion ? formatEvidenceEmotionLabel(example.emotion) : "",
        example.sentiment ? startCase(example.sentiment) : "",
      ].filter(Boolean),
    }))
    .filter((example) => !looksLikePositiveRecoveryReviewText(`${example.title} ${example.text}`, example.rating)));
  if (examples.length) return examples;
  if (Number(reviewStats.negativeCount || 0) <= 0) return [];

  return dedupeReviewExampleRows(points
    .map((point) => parseEvidencePoint(point))
    .filter((point) => /review|rating|negative|star/i.test(`${point.label} ${point.body}`))
    .slice(0, 4)
    .map((point) => ({
      title: truncateText(point.label || "Review evidence", 56),
      text: point.body || point.label || "Review evidence captured.",
      rating: /negative|low|bad|poor/i.test(point.body || point.label || "") ? 1 : 3,
      date: "",
      tags: [/negative|bad|poor/i.test(point.body || "") ? "Negative" : "Evidence"].filter(Boolean),
    })));
}

function dedupeReviewExampleRows(examples = []) {
  const seen = new Set();
  return (Array.isArray(examples) ? examples : []).filter((example) => {
    const textKey = normalizeReviewExampleFingerprint(example.text || example.body || example.note || "");
    const titleKey = normalizeReviewExampleFingerprint(example.title || example.summary || "");
    const key = textKey.length >= 18 ? textKey : `${titleKey}|${textKey}|${Number(example.rating || 0)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReviewExampleFingerprint(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u2018\u2019\u201C\u201D"']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewExampleMatchesSource(example = {}, sourceKey = "") {
  const normalized = normalizeEvidenceProviderKey(example.source || example.sourceLabel || example.provider || "");
  return normalized && normalized === sourceKey;
}

function getRefundReasonRows(metrics = {}) {
  const refundInsights = metrics.refundInsights || {};
  const total = Math.max(Number(metrics.refundUnits || refundInsights.total || 0), 0);
  const rows = getEvidenceReasonItems(refundInsights.topReasons || metrics.topRefundReasonDetails || metrics.topRefundReasons)
    .map((item) => {
      const countMatch = String(item.detail || "").match(/\d+/);
      const count = Number(item.count || countMatch?.[0] || 0);
      const share = Number(item.share || item.percent || item.percentage || (total && count ? (count / total) * 100 : 0));
      return { ...item, count, share };
    });
  if (!rows.length && total > 0) {
    rows.push({ label: "Order Level Refund", count: total, share: 100, detail: `${formatInteger(total)} refunded units` });
  }
  const usedLabels = new Set(rows.map((row) => String(row.label).toLowerCase()));
  ["Order Level Refund", "Damaged", "Doesn't Fit", "Changed Mind", "Not as Described"].forEach((label) => {
    if (!usedLabels.has(label.toLowerCase())) rows.push({ label, count: 0, share: 0, detail: "0 signals" });
  });
  return rows.slice(0, 5);
}

function getRefundRepeatedLanguage(metrics = {}) {
  const rows = getEvidenceList(metrics.refundInsights?.repeatedLanguage)
    .map((item) => ({
      term: item.term || item.label || item.phrase || "",
      count: Number(item.count || item.signals || 0),
    }))
    .filter((item) => item.term);
  return dedupePhraseRows(rows).slice(0, 6);
}

function getRefundExampleRows(metrics = {}) {
  const examples = getEvidenceList(metrics.refundInsights?.examples)
    .map((example) => ({
      reason: example.reasonText || example.reason || example.issueCode ? startCase(example.reasonText || example.reason || example.issueCode) : "Refund note",
      text: example.noteText || example.text || example.reasonText || "Refund context was captured without a free-form note.",
      date: example.createdAt ? formatProductAnalysisDate(example.createdAt) : (metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : ""),
      sentiment: example.sentiment ? startCase(example.sentiment) : "Operational",
    }));
  if (examples.length) return examples.slice(0, 4);
  return [{ reason: "No refund notes stored", text: "Refund units or amount may exist without a Shopify refund note.", date: "", sentiment: "Info" }];
}

function dedupePhraseRows(rows = []) {
  const byTerm = new Map();
  rows.forEach((row) => {
    const term = String(row.term || "").replace(/^["“]+|["”]+$/g, "").trim();
    if (!term) return;
    const key = term.toLowerCase();
    const current = byTerm.get(key);
    const sentiments = normalizePhraseSentiments(row);
    const currentSentiments = current ? normalizePhraseSentiments(current) : { positive: 0, neutral: 0, negative: 0 };
    const nextSentiments = {
      positive: Math.max(currentSentiments.positive, sentiments.positive),
      neutral: Math.max(currentSentiments.neutral, sentiments.neutral),
      negative: Math.max(currentSentiments.negative, sentiments.negative),
    };
    byTerm.set(key, {
      ...(current || {}),
      term,
      count: Math.max(Number(row.count || 0), Number(current?.count || 0)),
      sentiments: nextSentiments,
      dominantSentiment: getDominantPhraseSentiment(nextSentiments),
    });
  });
  return [...byTerm.values()].sort((first, second) => second.count - first.count);
}

function truncateText(value = "", maxLength = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function EvidenceBarList({ rows = [], tone = "violet", emptyLabel = "No rows stored" }) {
  const visibleRows = rows.length ? rows : [{ label: emptyLabel, count: 0 }];
  const max = Math.max(...visibleRows.map((row) => Number(row.count || row.value || 0)), 1);
  return (
    <div className={`ppEvidenceHorizontalBars ppEvidenceHorizontalBars-${tone}`}>
      {visibleRows.map((row) => {
        const count = Number(row.count || row.value || 0);
        const share = Number(row.share || row.percent || row.percentage || 0);
        const detail = row.detail || (share ? `${formatPercent(share)}` : "");
        return (
          <div key={row.label}>
            <span><strong>{row.label}</strong><em>{detail || formatInteger(count)}</em></span>
            <div aria-hidden="true"><span style={{ width: `${Math.max(count ? 6 : 1, Math.round((count / max) * 100))}%` }}></span></div>
          </div>
        );
      })}
    </div>
  );
}

function EvidencePhraseList({ phrases = [], tone = "red", emptyLabel = "No repeated phrases stored" }) {
  if (!phrases.length) {
    return (
      <div className="ppEvidencePhraseListEmpty">
        <strong>{emptyLabel}</strong>
        <span>No repeated phrase was detected for this source.</span>
      </div>
    );
  }

  return (
    <div className={`ppEvidencePhraseList ppEvidencePhraseList-${tone}`}>
      {phrases.map((phrase) => (
        <div key={phrase.term}>
          <strong>{quoteSourceText(phrase.term)}</strong>
          <span>{formatInteger(phrase.count || 0)}</span>
        </div>
      ))}
    </div>
  );
}

function EvidenceMiniInsight({ label, value, detail, tone = "blue" }) {
  return (
    <article className={`ppEvidenceMiniInsight ppEvidenceMetricCard-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EvidenceFullReportCard({ href }) {
  return (
    <Link aria-label="View Full Report" className="ppReturnsFullReportCard" to={href}>
      <span className="ppReturnsFullReportIcon" aria-hidden="true">
        <s-icon type="file" size="small"></s-icon>
      </span>
      <strong>View full report</strong>
      <small>See technical evidence, issues and raw source data.</small>
      <span>Open full report <s-icon type="chevron-right" size="small"></s-icon></span>
    </Link>
  );
}

function getOrderChannelRows(metrics = {}, orderCount = 0) {
  const rawRows = getEvidenceList(metrics.salesByChannel || metrics.orderChannels || metrics.channels);
  if (rawRows.length) {
    return rawRows.map((row) => ({
      label: row.label || row.channel || row.name || "Channel",
      count: Number(row.count || row.orders || row.units || row.value || 0),
      share: Number(row.share || row.percent || row.percentage || 0),
      detail: row.detail || "",
    }));
  }
  return orderCount
    ? [{ label: "Online Store", count: orderCount, share: 100, detail: `${formatPercent(100)}` }, { label: "Other", count: 0, share: 0, detail: "0%" }]
    : [{ label: "No channel data stored", count: 0, share: 0, detail: "" }];
}

function getOrderGeographyRows(metrics = {}, orderCount = 0) {
  const rawRows = getEvidenceList(metrics.orderGeography || metrics.salesByCountry || metrics.geography || metrics.countries);
  if (rawRows.length) {
    return rawRows.map((row) => ({
      label: row.label || row.country || row.name || "Region",
      count: Number(row.count || row.orders || row.units || row.value || 0),
      share: Number(row.share || row.percent || row.percentage || 0),
      detail: row.detail || "",
    }));
  }
  return orderCount
    ? [{ label: "Captured Shopify orders", count: orderCount, share: 100, detail: `${formatPercent(100)}` }]
    : [{ label: "No geography data stored", count: 0, share: 0, detail: "" }];
}

function EvidenceOrdersLineChart({ months = [], fallbackValue = 0 }) {
  const sourcePoints = (Array.isArray(months) ? months : [])
    .map((month) => ({
      label: month.shortLabel || month.label || month.key || "",
      value: Number(month.orderUnits || month.orders || 0),
    }))
    .filter((point) => point.label);
  const points = sourcePoints.length >= 2
    ? sourcePoints
    : [{ label: "Start", value: 0 }, { label: "Now", value: Number(fallbackValue || 0) }];
  const max = Math.max(...points.map((point) => point.value), 1);
  const chartPoints = points.map((point, index) => ({
    x: points.length === 1 ? 50 : Math.round((index / (points.length - 1)) * 1000) / 10,
    y: Math.round((100 - (point.value / max) * 90) * 10) / 10,
  }));
  const path = buildSmoothSvgPath(chartPoints);
  const labels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].filter(Boolean);

  return (
    <div className="ppEvidenceOrdersLineChart">
      <div className="ppEvidenceOrdersYAxis" aria-hidden="true">
        <span>{formatInteger(max)}</span>
        <span>{formatInteger(Math.round(max / 2))}</span>
        <span>0</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Units sold over time">
        <path d={path} />
      </svg>
      <div className="ppEvidenceReturnXAxis" aria-hidden="true">
        {labels.map((label, index) => <span key={`${label.label}-${index}`}>{label.label}</span>)}
      </div>
    </div>
  );
}

function normalizeEvidenceSentiment(sentiment = {}) {
  return {
    total: Number(sentiment?.total || 0),
    negative: Number(sentiment?.negative || 0),
    neutral: Number(sentiment?.neutral || 0),
    positive: Number(sentiment?.positive || 0),
    dominant: sentiment?.dominant || "",
  };
}

function combineEvidenceSentiments(items = []) {
  const totals = items
    .map(normalizeEvidenceSentiment)
    .filter((item) => Number(item.total || 0) > 0)
    .reduce((acc, item) => {
      acc.total += item.total;
      acc.negative += item.negative;
      acc.neutral += item.neutral;
      acc.positive += item.positive;
      return acc;
    }, { total: 0, negative: 0, neutral: 0, positive: 0, dominant: "" });
  totals.dominant = getDominantSentimentLabel(totals).toLowerCase();
  return totals;
}

function getCombinedCustomerLanguageSentiment(metrics = {}) {
  const textInsights = metrics.textInsights || {};
  const reviewSentiment = normalizeEvidenceSentiment(textInsights.reviews?.sentiment);
  const returnSentiment = normalizeEvidenceSentiment(textInsights.returns?.sentiment);
  const refundSentiment = normalizeEvidenceSentiment(metrics.refundInsights?.sentiment);
  const sourceSentiments = [reviewSentiment, returnSentiment, refundSentiment].filter((item) => item.total > 0);
  if (sourceSentiments.length) return combineEvidenceSentiments(sourceSentiments);
  return normalizeEvidenceSentiment(textInsights.sentiment);
}

function getCustomerLanguageEmotionSummary(metrics = {}) {
  const textInsights = metrics.textInsights || {};
  const grouped = new Map();
  const addEmotion = (item, source) => {
    const label = item?.label || item?.normalizedLabel || item?.code || "";
    const cleanLabel = String(label || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanLabel || /^none stored$/i.test(cleanLabel)) return;
    const key = cleanLabel.toLowerCase();
    const count = Math.max(1, Number(item.count || item.signals || 0));
    const existing = grouped.get(key);
    grouped.set(key, {
      label: cleanLabel.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      count: Math.max(Number(existing?.count || 0), count),
      polarity: item.polarity || existing?.polarity || getEvidenceEmotionPolarity(item),
      sources: [...new Set([...(existing?.sources || []), source].filter(Boolean))],
    });
  };

  getEvidenceList(textInsights.aiKnownEmotions).forEach((item) => addEmotion(item, "AI taxonomy"));
  getEvidenceList(textInsights.aiEmergentSentiments).forEach((item) => addEmotion(item, "Emergent"));
  getEvidenceList(textInsights.emotions).forEach((item) => addEmotion(item, "Language"));
  getEvidenceList(textInsights.reviews?.emotions).forEach((item) => addEmotion(item, "Reviews"));
  getEvidenceList(textInsights.returns?.emotions).forEach((item) => addEmotion(item, "Returns"));

  const emotions = [...grouped.values()].sort((first, second) => {
    if (second.count !== first.count) return second.count - first.count;
    if ((second.sources?.length || 0) !== (first.sources?.length || 0)) return (second.sources?.length || 0) - (first.sources?.length || 0);
    return first.label.localeCompare(second.label);
  });

  return {
    emotions,
    primary: emotions[0] || null,
    secondary: emotions[1] || null,
  };
}

function formatEvidenceEmotionLabelOnly(item) {
  return item?.label || "None stored";
}

function getDominantSentimentLabel(sentiment = {}) {
  if (!sentiment.total) return "None stored";
  if (sentiment.negative >= sentiment.neutral && sentiment.negative >= sentiment.positive && sentiment.negative > 0) return "Negative";
  if (sentiment.positive >= sentiment.neutral && sentiment.positive > 0) return "Positive";
  return "Neutral";
}

function getSentimentVisual(sentiment = {}) {
  const label = getDominantSentimentLabel(sentiment);
  if (label === "Positive") return { icon: "thumb-up", tone: "teal" };
  if (label === "Negative") return { icon: "thumb-down", tone: "red" };
  if (label === "Neutral") return { icon: "info", tone: "violet" };
  return { icon: "info", tone: "blue" };
}

function getCustomerLanguageAiReadingLabel({ themes = [], primaryEmotion = null, sentiment = {} }) {
  const sentimentLabel = getDominantSentimentLabel(sentiment);
  const topTheme = themes.find((theme) => Number(theme.count || 0) > 0 && !/^no recurring theme/i.test(theme.label));
  if (sentimentLabel === "Positive" && Number(sentiment.negative || 0) > 0) return "Positive with friction";
  if (sentimentLabel === "Negative" && primaryEmotion?.label) return `${primaryEmotion.label} concern`;
  if (sentimentLabel === "Positive" && topTheme?.label) return `${topTheme.label} praise`;
  if (primaryEmotion?.label && topTheme?.label) return `${primaryEmotion.label} around ${topTheme.label}`;
  if (topTheme?.label) return `${topTheme.label} pattern`;
  return sentimentLabel === "None stored" ? "No reading stored" : `${sentimentLabel} language`;
}

function getCustomerLanguageAiConfidenceLabel({ textInsights = {}, sentiment = {}, source = {} }) {
  const signalCount = Number(sentiment.total || 0);
  const hasAiLabels = getEvidenceList(textInsights.aiKnownEmotions).length + getEvidenceList(textInsights.aiEmergentSentiments).length;
  const sourceSignals = Number(source?.points?.length || 0);
  if (signalCount >= 8 || (signalCount >= 4 && hasAiLabels >= 2) || sourceSignals >= 8) return "High";
  if (signalCount >= 3 || hasAiLabels) return "Medium";
  return "Low";
}

function getCustomerLanguageThemes(textInsights = {}, points = [], metrics = {}) {
  const byLabel = new Map();
  const addTheme = (label, count = 1) => {
    const cleanLabel = String(label || "").replace(/^["“]+|["”]+$/g, "").trim();
    if (!cleanLabel || /^none stored$/i.test(cleanLabel)) return;
    const key = cleanLabel.toLowerCase();
    byLabel.set(key, {
      label: cleanLabel,
      count: Math.max(Number(byLabel.get(key)?.count || 0), Math.max(1, Number(count || 1))),
    });
  };

  getEvidenceList(textInsights.otherReturnClassifications).forEach((item) => addTheme(item.label || item.issueCode, item.count));
  getEvidenceList(textInsights.repeatedLanguage).forEach((item) => addTheme(item.term || item.label, item.count));
  getEvidenceList(textInsights.returns?.repeatedLanguage).forEach((item) => addTheme(item.term || item.label, item.count));
  getEvidenceList(textInsights.reviews?.repeatedLanguage).forEach((item) => addTheme(item.term || item.label, item.count));
  getEvidenceList(metrics.refundInsights?.repeatedLanguage).forEach((item) => addTheme(item.term || item.label, item.count));

  points.forEach((point) => {
    const parsed = parseEvidencePoint(point);
    const body = parsed.body || parsed.label || point;
    const quoted = String(body).match(/"([^"]+)"/);
    if (quoted) addTheme(quoted[1], 1);
  });

  const themes = filterOverlappingEvidenceThemes([...byLabel.values()]).slice(0, 5);
  return themes.length ? themes : [{ label: "No recurring theme stored", count: 0 }];
}

function filterOverlappingEvidenceThemes(themes = []) {
  const normalizedThemes = themes
    .map((theme) => ({
      ...theme,
      count: Number(theme.count || 0),
      words: normalizeEvidenceText(theme.label).split(" ").filter(Boolean),
    }))
    .filter((theme) => theme.label && theme.words.length)
    .sort((first, second) => {
      if (second.count !== first.count) return second.count - first.count;
      const firstNegated = isNegatedEvidencePhrase(first.label) ? 1 : 0;
      const secondNegated = isNegatedEvidencePhrase(second.label) ? 1 : 0;
      if (secondNegated !== firstNegated) return secondNegated - firstNegated;
      return first.words.length - second.words.length;
    });
  const selected = [];
  normalizedThemes.forEach((theme) => {
    const isNestedDuplicate = selected.some((current) => {
      if (current.count !== theme.count || isNegatedEvidencePhrase(theme.label)) return false;
      const currentText = ` ${normalizeEvidenceText(current.label)} `;
      const themeText = ` ${normalizeEvidenceText(theme.label)} `;
      return themeText.includes(currentText) || currentText.includes(themeText);
    });
    if (!isNestedDuplicate) selected.push(theme);
  });
  return selected.map((theme) => ({ label: theme.label, count: theme.count }));
}

function isNegatedEvidencePhrase(value = "") {
  return /^(not|no|never|without|doesn't|doesnt|didn't|didnt|isn't|isnt|can't|cant)\b/i.test(String(value || "").trim());
}

function getCustomerLanguageSignalBreakdown(metrics = {}) {
  const sentiment = getCombinedCustomerLanguageSentiment(metrics);
  const other = Math.max(0, sentiment.total - sentiment.negative - sentiment.neutral - sentiment.positive);
  return {
    total: sentiment.total,
    rows: [
      { label: "Negative", value: sentiment.negative, tone: "red", color: "var(--pp-risk-red)" },
      { label: "Neutral", value: sentiment.neutral, tone: "violet", color: "var(--pp-insight-violet)" },
      { label: "Positive", value: sentiment.positive, tone: "teal", color: "var(--pp-signal-teal)" },
      { label: "Other / Info", value: other, tone: "neutral", color: "var(--pp-slate-300)" },
    ],
  };
}

function getCustomerLanguageSignalRows(textInsights = {}, themes = [], metrics = {}, emotionSummary = null) {
  const returnsSentiment = normalizeEvidenceSentiment(textInsights.returns?.sentiment);
  const reviewsSentiment = normalizeEvidenceSentiment(textInsights.reviews?.sentiment);
  const refundSentiment = normalizeEvidenceSentiment(metrics.refundInsights?.sentiment);
  const primaryEmotion = emotionSummary?.primary || getCustomerLanguageEmotionSummary(metrics).primary;
  const secondaryEmotion = emotionSummary?.secondary || null;
  const subjective = textInsights.subjectiveNegativity || {};
  const insightCount = themes.filter((theme) => Number(theme.count || 0) > 0).length;
  const topTheme = themes.find((theme) => Number(theme.count || 0) > 0 && !/^no recurring theme/i.test(theme.label));
  const formatSentimentCount = (item) => item.total
    ? `${formatInteger(item.negative)} negative / ${formatInteger(item.positive)} positive`
    : "No stored text";
  const formatSentimentDetail = (item, sourceLabel) => item.total
    ? `${formatInteger(item.total)} ${sourceLabel}; ${formatInteger(item.neutral)} neutral`
    : `No ${sourceLabel} stored`;

  return [
    {
      type: "Primary emotion",
      meaning: "Strongest customer emotion cluster",
      count: formatEvidenceEmotionLabelOnly(primaryEmotion),
      trend: primaryEmotion?.count ? `${formatInteger(primaryEmotion.count)} signals · ${(primaryEmotion.sources || []).join(", ") || "stored language"}` : "No primary emotion stored",
      icon: "target",
      tone: primaryEmotion?.polarity === "negative" ? "red" : primaryEmotion?.polarity === "positive" ? "teal" : "violet",
    },
    {
      type: "Secondary emotion",
      meaning: "Next strongest emotion signal",
      count: formatEvidenceEmotionLabelOnly(secondaryEmotion),
      trend: secondaryEmotion?.count ? `${formatInteger(secondaryEmotion.count)} signals · ${(secondaryEmotion.sources || []).join(", ") || "stored language"}` : "Only one emotion cluster stored",
      icon: "wand",
      tone: secondaryEmotion?.polarity === "negative" ? "amber" : secondaryEmotion?.polarity === "positive" ? "teal" : "violet",
    },
    {
      type: "Subjective reactions",
      meaning: "Customer wording that describes expectation or perception",
      count: formatInteger(subjective.count || 0),
      trend: subjective.total ? `${formatInteger(subjective.total)} text signals` : "No subjective signal stored",
      icon: "return",
      tone: "blue",
    },
    {
      type: "Customer themes",
      meaning: "Repeated phrases after removing generic emotion labels",
      count: formatInteger(insightCount),
      trend: topTheme ? `Top theme: ${topTheme.label} (${formatInteger(topTheme.count)})` : "No recurring theme stored",
      icon: "lightbulb",
      tone: "violet",
    },
    {
      type: "Returns sentiment",
      meaning: "Sentiment in return notes",
      count: formatSentimentCount(returnsSentiment),
      trend: formatSentimentDetail(returnsSentiment, "return-note signals"),
      icon: "return",
      tone: returnsSentiment.negative ? "red" : "blue",
    },
    {
      type: "Refund-note sentiment",
      meaning: "Sentiment in refund and restock notes",
      count: formatSentimentCount(refundSentiment),
      trend: formatSentimentDetail(refundSentiment, "refund-note signals"),
      icon: "cash-dollar",
      tone: refundSentiment.negative ? "red" : "blue",
    },
    {
      type: "Reviews sentiment",
      meaning: "Sentiment in reviews",
      count: formatSentimentCount(reviewsSentiment),
      trend: formatSentimentDetail(reviewsSentiment, "review text signals"),
      icon: "star",
      tone: reviewsSentiment.negative ? "amber" : "blue",
    },
  ];
}

function EvidenceThemeBarList({ themes = [] }) {
  const max = Math.max(...themes.map((theme) => Number(theme.count || 0)), 1);
  return (
    <div className="ppEvidenceThemeBars">
      {themes.map((theme) => {
        const count = Number(theme.count || 0);
        return (
          <div key={theme.label}>
            <span>{theme.label}</span>
            <div aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round((count / max) * 100))}%` }}></span></div>
            <strong>{formatInteger(count)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceSignalDonut({ total = 0, rows = [] }) {
  const safeTotal = Math.max(Number(total || 0), rows.reduce((sum, row) => sum + Number(row.value || 0), 0), 1);
  let cursor = 0;
  const segments = rows.map((row) => {
    const value = Math.max(0, Number(row.value || 0));
    const start = cursor;
    const end = cursor + (value / safeTotal) * 100;
    cursor = end;
    return `${row.color} ${start}% ${end}%`;
  }).join(", ");
  const background = segments || "var(--pp-slate-200) 0% 100%";

  return (
    <div className="ppEvidenceDonutWrap">
      <div className="ppEvidenceDonut" style={{ background: `conic-gradient(${background})` }} aria-hidden="true">
        <span><strong>{formatInteger(total)}</strong><small>Total signals</small></span>
      </div>
      <div className="ppEvidenceDonutLegend">
        {rows.map((row) => (
          <div key={row.label}>
            <span style={{ background: row.color }}></span>
            <strong>{row.label}</strong>
            <em>{formatInteger(row.value)} ({formatPercent(safeTotal ? (Number(row.value || 0) / safeTotal) * 100 : 0)})</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function getReturnReasonRows(metrics = {}) {
  const total = Math.max(Number(metrics.returnUnits || 0), 0);
  const rawRows = getEvidenceReasonItems(metrics.topReturnReasonDetails || metrics.topReturnReasons)
    .map((item) => {
      const countMatch = String(item.detail || "").match(/\d+/);
      const count = Number(item.count || countMatch?.[0] || 0);
      const share = Number(item.share || item.percent || item.percentage || (total && count ? (count / total) * 100 : 0));
      return {
        ...item,
        key: getReturnReasonKey(item.key || item.category || item.label),
        label: formatReturnReasonDisplayLabel(item.label),
        category: item.category ? formatReturnReasonDisplayLabel(item.category) : "",
        count,
        share,
      };
    });

  const rowsByKey = new Map();
  const genericOtherRows = [];
  const specificOtherRows = [];
  const genericOtherCount = rawRows
    .filter((row) => getReturnReasonKey(row.key || row.category || row.label) === "other")
    .reduce((max, row) => Math.max(max, Number(row.count || 0)), 0);

  rawRows.forEach((row) => {
    const key = getReturnReasonKey(row.key || row.label);
    const categoryKey = getReturnReasonKey(row.category);
    const isOther = key === "other" || categoryKey === "other" || isOtherReasonLabel(row.label);
    const isSpecificOther = isOther && /:\s*\S/.test(row.label);

    if (isOther && !isSpecificOther) {
      genericOtherRows.push({ ...row, key: "other", label: "Other", category: "Other" });
      return;
    }

    if (isSpecificOther) {
      specificOtherRows.push({ ...row, key: "other", category: "Other" });
      return;
    }

    if (genericOtherCount > 0 && Number(row.count || 0) === genericOtherCount && isLikelyReturnNoteReason(row.label)) {
      specificOtherRows.push({ ...row, key: "other", category: "Other", label: `Other: ${row.label}` });
      return;
    }

    const existing = rowsByKey.get(key);
    if (!existing) {
      rowsByKey.set(key, { ...row, key });
      return;
    }
    existing.count += row.count;
    existing.share = Math.max(existing.share, row.share);
  });

  if (specificOtherRows.length) {
    specificOtherRows.forEach((row) => rowsByKey.set(`other:${row.label.toLowerCase()}`, row));
  } else if (genericOtherRows.length) {
    const mergedOther = genericOtherRows.reduce((acc, row) => ({
      ...acc,
      count: acc.count + row.count,
      share: Math.max(acc.share, row.share),
    }), { ...genericOtherRows[0], count: 0, share: 0 });
    rowsByKey.set("other", mergedOther);
  }

  const rows = [...rowsByKey.values()]
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));

  const usedKeys = new Set(rows.map((row) => getReturnReasonKey(row.key || row.label)));
  [
    { key: "other", label: "Other" },
    { key: "color", label: "Color" },
    { key: "not_as_described", label: "Not as described" },
    { key: "quality_issue", label: "Quality issue" },
    { key: "wrong_item", label: "Wrong item" },
  ].forEach(({ key, label }) => {
    if (!usedKeys.has(key)) rows.push({ key, label, count: 0, share: 0, detail: "0 signals" });
  });
  return rows.slice(0, 5);
}

function getReturnReasonKey(value = "") {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized === "other" || normalized === "other reason" || normalized === "other reasons") return "other";
  if (normalized === "not as described") return "not_as_described";
  if (normalized === "quality issue" || normalized === "quality") return "quality_issue";
  if (normalized === "wrong item" || normalized === "wrong product") return "wrong_item";
  if (normalized === "colour") return "color";
  return normalized;
}

function isOtherReasonLabel(value = "") {
  return getReturnReasonKey(value) === "other";
}

function formatReturnReasonDisplayLabel(value = "") {
  const text = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const [category, ...rest] = text.split(":");
  if (rest.length && isOtherReasonLabel(category)) {
    return `Other: ${formatReturnReasonDisplayLabel(rest.join(":"))}`;
  }
  const key = getReturnReasonKey(text);
  if (key === "other") return "Other";
  if (key === "not_as_described") return "Not as described";
  if (key === "quality_issue") return "Quality issue";
  if (key === "wrong_item") return "Wrong item";
  if (key === "color") return "Color";
  if (isLikelyReturnNoteReason(text)) return text.charAt(0).toUpperCase() + text.slice(1);
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function isLikelyReturnNoteReason(value = "") {
  const text = String(value || "").trim();
  if (text.length < 18) return false;
  return /[.;:,]/.test(text) || /\b(expected|looks?|arrived|because|too|not|missing|different|broken|damaged|poses?|surface|quality)\b/i.test(text);
}

function getEvidenceSentimentTone(sentiment = {}) {
  const label = getDominantSentimentLabel(sentiment);
  if (label === "Negative") return "red";
  if (label === "Positive") return "teal";
  if (label === "Neutral") return "violet";
  return "blue";
}

function EvidenceReasonBarList({ rows = [], total = 0 }) {
  const max = Math.max(...rows.map((row) => Number(row.count || 0)), Number(total || 0), 1);
  return (
    <div className="ppEvidenceReasonBars">
      {rows.map((row) => {
        const count = Number(row.count || 0);
        const share = Number(row.share || (total && count ? (count / total) * 100 : 0));
        return (
          <div key={row.key || row.label}>
            <span><strong title={row.label}>{row.label}</strong><em>{formatInteger(count)} ({formatPercent(share)})</em></span>
            <div aria-hidden="true"><span style={{ width: `${Math.max(count ? 6 : 1, Math.round((count / max) * 100))}%` }}></span></div>
          </div>
        );
      })}
    </div>
  );
}

function getReturnTimelinePoints(activity = null, prediction = null, fallbackReturnRate = 0) {
  const months = Array.isArray(activity?.months) ? activity.months : [];
  const monthPoints = months
    .filter((month) => month.key || month.label)
    .map((month) => ({
      label: month.shortLabel || month.label || month.key,
      value: clampPercentValue(month.returnRate || 0),
    }));
  if (monthPoints.length >= 2) return monthPoints;
  const observed = Array.isArray(prediction?.observedPoints) ? prediction.observedPoints : [];
  const observedPoints = observed.map((point) => ({
    label: point.label || point.key,
    value: clampPercentValue(point.smoothedReturnRate || point.rawReturnRate || 0),
  }));
  if (observedPoints.length >= 2) return observedPoints;
  return [
    { label: "Start", value: 0 },
    { label: "Now", value: clampPercentValue(fallbackReturnRate || 0) },
  ];
}

function EvidenceReturnRateChart({ activity = null, prediction = null, returnRate = 0 }) {
  const points = getReturnTimelinePoints(activity, prediction, returnRate);
  const chartPoints = points.map((point, index) => ({
    x: points.length === 1 ? 50 : Math.round((index / (points.length - 1)) * 1000) / 10,
    y: Math.round((100 - clampPercentValue(point.value)) * 10) / 10,
  }));
  const path = buildSmoothSvgPath(chartPoints);
  const areaPath = chartPoints.length
    ? `M 0,100 L ${chartPoints.map((point) => `${point.x},${point.y}`).join(" L ")} L 100,100 Z`
    : "";
  const labels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].filter(Boolean);

  return (
    <div className="ppEvidenceReturnChart">
      <div className="ppEvidenceReturnYAxis" aria-hidden="true">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0%</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Return rate over time">
        <path className="ppEvidenceReturnArea" d={areaPath} />
        <path className="ppEvidenceReturnLine" d={path} />
      </svg>
      <div className="ppEvidenceReturnXAxis" aria-hidden="true">
        {labels.map((label, index) => <span key={`${label.label}-${index}`}>{label.label}</span>)}
      </div>
    </div>
  );
}

function EvidenceReviewSentimentTrendChart({ trend = [] }) {
  const rows = Array.isArray(trend) && trend.length
    ? trend
    : [{ key: "empty", label: "No dated reviews", positive: 0, neutral: 0, negative: 0, total: 0 }];
  const max = Math.max(
    ...rows.flatMap((row) => [Number(row.positive || 0), Number(row.neutral || 0), Number(row.negative || 0)]),
    1,
  );
  const labels = rows.length > 1
    ? [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].filter(Boolean)
    : rows;

  return (
    <div className="ppEvidenceReviewTrendChart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Review sentiment over time">
        {[25, 50, 75].map((line) => <line key={line} className="ppEvidenceReviewTrendGridLine" x1="0" x2="100" y1={line} y2={line} />)}
        <path className="ppEvidenceReviewTrendLine ppEvidenceReviewTrendLine-positive" d={getReviewSentimentTrendPath(rows, "positive", max)} />
        <path className="ppEvidenceReviewTrendLine ppEvidenceReviewTrendLine-neutral" d={getReviewSentimentTrendPath(rows, "neutral", max)} />
        <path className="ppEvidenceReviewTrendLine ppEvidenceReviewTrendLine-negative" d={getReviewSentimentTrendPath(rows, "negative", max)} />
      </svg>
      <div className="ppEvidenceReviewTrendXAxis" aria-hidden="true">
        {labels.map((row, index) => <span key={`${row.key || row.label}-${index}`}>{row.label}</span>)}
      </div>
      <div className="ppEvidenceReviewTrendLegend">
        <span><i className="ppEvidenceReviewTrendDot-positive"></i>Positive</span>
        <span><i className="ppEvidenceReviewTrendDot-neutral"></i>Neutral</span>
        <span><i className="ppEvidenceReviewTrendDot-negative"></i>Negative</span>
      </div>
    </div>
  );
}

function getReviewSentimentTrendPath(rows = [], key = "positive", max = 1) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : [{ [key]: 0 }];
  const safeMax = Math.max(1, Number(max || 1));
  const points = safeRows.map((row, index) => {
    const value = Math.max(0, Number(row[key] || 0));
    const x = safeRows.length === 1 ? 50 : Math.round((index / (safeRows.length - 1)) * 1000) / 10;
    const y = Math.round((92 - (value / safeMax) * 76) * 10) / 10;
    return { x, y };
  });
  if (points.length === 1) {
    return buildSmoothSvgPath([{ x: 0, y: points[0].y }, { x: 100, y: points[0].y }]);
  }
  return buildSmoothSvgPath(points);
}

function getReturnRepeatedLanguage(textInsights = {}) {
  return [
    ...getEvidenceList(textInsights.returns?.repeatedLanguage),
    ...getEvidenceList(textInsights.repeatedLanguage).filter((item) => getEvidenceList(item.sources).some((source) => String(source).toLowerCase().includes("return"))),
  ].map((item) => ({
    term: item.term || item.label || "",
    count: Number(item.count || item.signals || 0),
  })).filter((item) => item.term);
}

function getReturnInsightCount(textInsights = {}, source = {}) {
  return getEvidenceList(textInsights.otherReturnClassifications).length
    + getEvidenceList(textInsights.returns?.emotions).length
    + getEvidenceList(textInsights.returns?.examples).length
    + Math.max(0, Number(source?.points?.length || 0) - 3);
}

function getReturnExampleRows(textInsights = {}, metrics = {}) {
  const examples = getEvidenceList(textInsights.returns?.examples).map((example) => ({
    text: example.text || example.note || "Return note captured",
    date: example.date || example.createdAt || (metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : ""),
  }));
  if (examples.length) return examples.slice(0, 4);
  return [
    { text: "No return notes captured for this product yet.", date: metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : "" },
  ];
}

function EvidenceMetricCard({ card }) {
  const popover = getEvidenceMetricCardPopover(card);
  return (
    <article className={`ppEvidenceMetricCard ppEvidenceMetricCard-${card.tone || "blue"}`}>
      <span className="ppEvidenceMetricIcon" aria-hidden="true">
        <ProductPulseGlyph type={card.icon || "info"} />
      </span>
      <div>
        <span>{card.label}</span>
        <strong>{card.value}</strong>
        <small>{renderAnalysisText(card.detail)}</small>
      </div>
      {card.badge && <em>{card.badge}</em>}
      {Array.isArray(card.trend) && card.trend.length > 0 && <MiniTrend tone={getTrendTone(card.trend)} values={card.trend} />}
      <span className="ppEvidenceMetricPopover" role="tooltip">
        <strong>{renderAnalysisText(popover.title)}</strong>
        <span>{renderAnalysisText(popover.body)}</span>
        {popover.items.length > 0 && (
          <span className="ppEvidenceMetricPopoverList">
            {popover.items.map((item) => (
              <small key={`${card.label}-${item.label}`}>
                <b>{item.label}</b>
                {renderAnalysisText(item.value)}
              </small>
            ))}
          </span>
        )}
      </span>
    </article>
  );
}

function getEvidenceMetricCardPopover(card = {}) {
  const title = card.popoverTitle || `${card.label}: ${card.value}`;
  const body = card.popoverBody || card.popoverDetail || `This card summarizes ${String(card.label || "this evidence").toLowerCase()} for the selected evidence source. ProductPulse uses it as an early reading of what was found and why it may matter for product diagnosis.`;
  const items = Array.isArray(card.popoverItems) ? card.popoverItems : [];
  if (items.length) return { title, body, items };

  return {
    title,
    body,
    items: [
      { label: "Current value", value: String(card.value || "No value stored") },
      { label: "Source detail", value: String(card.detail || "No additional source detail stored yet.") },
      { label: "Why it matters", value: getEvidenceMetricWhyItMatters(card) },
    ],
  };
}

function getEvidenceMetricWhyItMatters(card = {}) {
  const label = String(card.label || "").toLowerCase();
  if (label.includes("return")) return "Returns are hard post-purchase evidence and help separate real product friction from isolated feedback.";
  if (label.includes("refund")) return "Refunds add operational and financial pressure, especially when the rate is high across enough orders.";
  if (label.includes("rating") || label.includes("review")) return "Reviews capture customer expectations and sentiment that may not appear in Shopify returns.";
  if (label.includes("emotion") || label.includes("sentiment") || label.includes("language") || label.includes("reaction")) return "Customer language helps explain the reason behind a metric and can reveal subjective or emerging patterns.";
  if (label.includes("variant") || label.includes("scope") || label.includes("sku") || label.includes("option")) return "Affected scope shows whether the issue is broad or concentrated in a specific variant, option or SKU.";
  if (label.includes("description") || label.includes("content") || label.includes("tag") || label.includes("collection")) return "Product content can create or reduce expectation gaps before the shopper buys.";
  if (label.includes("impact") || label.includes("margin") || label.includes("revenue")) return "Financial exposure is tracked separately from product risk so prioritization can consider business impact without inflating severity.";
  return "This finding adds context to the source tab and helps explain the evidence behind the diagnosis.";
}

function EvidenceFinding({ point, index }) {
  const parsed = parseEvidencePoint(point);
  return (
    <div className={`ppEvidenceFinding ppEvidenceFinding-${parsed.tone}`} aria-label={point}>
      <span className="ppEvidenceFindingIndex">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <strong>{parsed.label || getEvidenceFindingTitle(point)}</strong>
        <p>{renderEvidenceText(parsed.body || parsed.label || point)}</p>
      </div>
    </div>
  );
}

export function ProductEvidenceReportScreen({ product, source = "" }) {
  if (!product) {
    return (
      <FullWidthPage heading="Evidence report not found">
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
  const selectedSourceName = source || "All sources";
  const metricRows = getEvidenceReportMetricRows(product.metrics || {});
  const reportGeneratedAt = product.metrics?.lastDetailedDiagnosisAt || product.lastAnalysis;
  const scoreModel = getEvidenceReportScoreModel(product, detail);

  return (
    <FullWidthPage heading="Full Evidence Report">
      <ScreenShell className="ppDashboard ppEvidenceReportScreen">
        <div className="ppEvidenceReportHeader">
          <Link className="ppProductBackButton" to={product.href || `/app/products/${product.slug}`}>
            <s-icon type="arrow-left" size="small"></s-icon>
            Back to product
          </Link>
          <div className="ppEvidenceReportHero">
            <ProductArt
              variant={detail.variant}
              label={detail.title}
              imageUrl={detail.imageUrl}
              imageAlt={detail.imageAlt}
            />
            <div>
              <span>Technical evidence report</span>
              <h1>{detail.title}</h1>
              <p>
                Full diagnostic record for {selectedSourceName}. This page keeps the raw supporting evidence,
                issue relationships, product metrics and recommended action context in one technical view.
              </p>
              <small>{reportGeneratedAt ? `Last report signal: ${formatProductAnalysisDate(reportGeneratedAt)}` : "No report timestamp stored"}</small>
            </div>
          </div>
          <div className="ppEvidenceReportSummary">
            <EvidenceMetricCard card={{ label: "Product risk", value: `${detail.riskScore}/100`, detail: detail.riskTrendLabel, icon: "target", tone: detail.riskBadgeTone }} />
            <EvidenceMetricCard card={{ label: "Diagnosis confidence", value: `${detail.confidence}%`, detail: detail.confidenceLabel, icon: "shield-check-mark", tone: "blue" }} />
            <EvidenceMetricCard card={{ label: "Financial exposure", value: formatMoney(detail.estimatedImpact), detail: `${formatMoney(detail.marginAtRisk)} margin at risk`, icon: "cash-dollar", tone: "teal" }} />
            <EvidenceMetricCard card={{ label: "Evidence strength", value: `${detail.evidenceStrengthScore || 0}/100`, detail: `${detail.signalCount} stored signals`, icon: "duplicate", tone: "violet" }} />
          </div>
        </div>

        <section className="ppEvidenceReportSection">
          <div className="ppEvidenceReportSectionHeader">
            <span>01</span>
            <div>
              <h2>Score calculation</h2>
              <p>Mathematical model, persisted components and theoretical rules behind the diagnosis.</p>
            </div>
          </div>
          <div className="ppEvidenceScoreTheoryGrid">
            <article>
              <h3>Product risk formula</h3>
              <p>
                ProductPulse scores product severity separately from money. It starts from a small baseline,
                adds smoothed risk families, then applies small agreement and recency bonuses. Financial
                exposure is intentionally excluded from product risk.
              </p>
              <code>risk_score = clamp(base + returns_score + reviews_score + sentiment_score + content_gap_score + refund_score + variant_score + agreement_bonus + recency_bonus, 0, 100)</code>
            </article>
            <article>
              <h3>Diagnosis confidence model</h3>
              <p>
                Diagnosis confidence is reliability, not severity. It uses source coverage, independent sources,
                effective sample size, product match quality, agreement and freshness, then applies caps for
                sparse samples, single-source diagnoses, incomplete data and reconstructed score details.
              </p>
              <code>confidence_score = min(coverage + independent_sources + effective_sample + match + agreement + freshness - penalties, caps)</code>
            </article>
            <article>
              <h3>Financial exposure model</h3>
              <p>
                Financial exposure is money, not product severity. It separates observed loss, projected return
                loss, review conversion drag, revenue at risk and margin at risk. Sparse samples show a likely
                range around the expected estimate.
              </p>
              <code>impact_score = observed_loss + projected_return_loss + review_conversion_drag</code>
            </article>
            <article>
              <h3>Action priority model</h3>
              <p>
                Action priority combines severity, reliability and normalized financial exposure so operational
                triage can prioritize high-risk products with enough evidence and meaningful business exposure.
              </p>
              <code>priority_score = 0.50 * risk_score + 0.25 * confidence_score + 0.25 * normalized_log_impact_score</code>
            </article>
          </div>
          <div className="ppEvidenceScoreGrid">
            <EvidenceScoreBreakdownCard
              title="Product risk calculation"
              subtitle={scoreModel.riskSubtitle}
              total={`${detail.riskScore}/100`}
              rows={scoreModel.riskRows}
              footer={scoreModel.riskFooter}
            />
            <EvidenceScoreBreakdownCard
              title="Diagnosis confidence calculation"
              subtitle="Reliability of the diagnosis, not severity."
              total={`${detail.confidence}%`}
              rows={scoreModel.confidenceRows}
              footer={scoreModel.confidenceFooter}
            />
            <EvidenceScoreBreakdownCard
              title="Financial exposure calculation"
              subtitle="Stored financial exposure from Shopify and connected evidence."
              total={formatMoney(detail.estimatedImpact)}
              rows={scoreModel.impactRows}
              footer={scoreModel.impactFooter}
            />
          </div>
        </section>

        <section className="ppEvidenceReportSection">
          <div className="ppEvidenceReportSectionHeader">
            <span>02</span>
            <div>
              <h2>Issues detected</h2>
              <p>Every issue currently stored for this product, including confidence, severity, trend and source snippets.</p>
            </div>
          </div>
          <div className="ppEvidenceReportIssueGrid">
            {detail.detectedIssues.length > 0 ? detail.detectedIssues.map((issue) => (
              <article className="ppEvidenceReportIssue" key={issue.issue}>
                <div>
                  <span className={`ppIssueIcon ppIssueIcon-${issue.tone}`} aria-hidden="true">
                    <s-icon type={getIssueIcon(issue.issue)} size="small"></s-icon>
                  </span>
                  <div>
                    <h3>{issue.issue}</h3>
                    <p>{renderAnalysisText(issue.action)}</p>
                  </div>
                </div>
                <dl>
                  <div><dt>Severity</dt><dd><s-badge tone={issue.tone}>{issue.severity}</s-badge></dd></div>
                  <div><dt>Confidence</dt><dd>{issue.confidence}</dd></div>
                  <div><dt>Signals</dt><dd>{issue.signals}</dd></div>
                  <div><dt>Trend</dt><dd><MiniTrend tone={issue.trendTone} values={issue.trend} /></dd></div>
                </dl>
                {issue.evidence?.length > 0 && (
                  <ul>
                    {issue.evidence.map((item) => <li key={`${issue.issue}-${item}`}>{renderEvidenceText(item)}</li>)}
                  </ul>
                )}
              </article>
            )) : (
              <EmptyProductDetailState message="0 deterministic issues detected from stored product signals." />
            )}
          </div>
        </section>

        <section className="ppEvidenceReportSection">
          <div className="ppEvidenceReportSectionHeader">
            <span>03</span>
            <div>
              <h2>Evidence sources</h2>
              <p>All source summaries, compact metrics and every stored evidence point used by the diagnosis.</p>
            </div>
          </div>
          <div className="ppEvidenceReportSourceList">
            {detail.evidenceSources.map((sourceItem) => (
              <article className="ppEvidenceReportSource" key={sourceItem.title}>
                <div className="ppEvidenceReportSourceHeader">
                  <span className={`ppEvidenceSourceGlyph ppEvidenceTone-${sourceItem.tone}`} aria-hidden="true">
                    <ProductPulseGlyph type={sourceItem.icon} />
                  </span>
                  <div>
                    <h3>{sourceItem.title}</h3>
                    <p>{renderAnalysisText(sourceItem.summary)}</p>
                  </div>
                  <strong>{sourceItem.points.length} signals</strong>
                </div>
                <div className="ppEvidenceMetricGrid">
                  {(sourceItem.cards || getEvidenceSourceCards(sourceItem.title, sourceItem.points, product)).map((card) => (
                    <EvidenceMetricCard card={card} key={`${sourceItem.title}-report-${card.label}-${card.value}`} />
                  ))}
                </div>
                <div className="ppEvidenceFindingStream">
                  {sourceItem.points.map((point, index) => (
                    <EvidenceFinding point={point} index={index} key={`${sourceItem.title}-${point}-${index}`} />
                  ))}
                </div>
              </article>
            ))}
            {detail.evidenceSources.length === 0 && <EmptyProductDetailState message="0 evidence sources stored for this product yet." />}
          </div>
        </section>

        <section className="ppEvidenceReportSection">
          <div className="ppEvidenceReportSectionHeader">
            <span>04</span>
            <div>
              <h2>Raw product metrics</h2>
              <p>Structured metrics currently stored for scoring, confidence, impact and diagnosis generation.</p>
            </div>
          </div>
          <div className="ppEvidenceRawTableWrap">
            <table className="ppEvidenceRawTable">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {metricRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.key}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ppEvidenceReportSection">
          <div className="ppEvidenceReportSectionHeader">
            <span>05</span>
            <div>
              <h2>Recommendations and checks</h2>
              <p>Action context and the ProductPulse checks that were available when this report was rendered.</p>
            </div>
          </div>
          <div className="ppEvidenceReportTwoColumn">
            <div className="ppEvidenceReportBlock">
              <h3>Recommended actions</h3>
              {detail.ignoredIssues.length > 0 && (
                <div className="ppEvidenceIgnoredNotice">
                  <s-icon type="info" size="small"></s-icon>
                  <span>
                    {detail.ignoredIssues.length} issue{detail.ignoredIssues.length === 1 ? "" : "s"} ignored for this product.
                    Recommendations associated with ignored issues are hidden from this report.
                  </span>
                </div>
              )}
              {detail.recommendedActions.length ? detail.recommendedActions.map((action) => (
                <article key={action.id || action.title}>
                  <strong>{action.title}</strong>
                  <p>{action.detail}</p>
                  <small>{action.type} / {action.status} / {action.effort} effort</small>
                  {action.payload && <pre>{formatRawReportValue(action.payload)}</pre>}
                </article>
              )) : <EmptyProductDetailState message="0 recommended actions stored for this product." />}
            </div>
            <div className="ppEvidenceReportBlock">
              <h3>What ProductPulse checked</h3>
              {detail.checkedItems.length ? detail.checkedItems.map((item) => (
                <article key={item.label}>
                  <strong>{item.label}</strong>
                  <p>{item.value}</p>
                  <small>{item.detail}</small>
                </article>
              )) : <EmptyProductDetailState message="0 product-specific checks stored yet." />}
            </div>
          </div>
        </section>
      </ScreenShell>
    </FullWidthPage>
  );
}

function EvidenceScoreBreakdownCard({ title, subtitle, total, rows = [], footer = "" }) {
  return (
    <article className="ppEvidenceScoreCard">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{total}</strong>
      </header>
      <div className="ppEvidenceScoreRows">
        {rows.map((row) => (
          <div className="ppEvidenceScoreRow" key={row.key || row.label}>
            <div>
              <span className={`ppEvidenceScoreDot ppEvidenceScoreDot-${row.tone || "blue"}`} aria-hidden="true"></span>
              <div>
                <b>{row.label}</b>
                <small>{row.detail}</small>
              </div>
            </div>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      {footer ? <p className="ppEvidenceScoreFooter">{footer}</p> : null}
    </article>
  );
}

function getEvidenceReportScoreModel(product = {}, detail = {}) {
  const metrics = product.metrics || {};
  const riskRows = getEvidenceReportRiskRows(product, detail);
  const confidenceRows = getEvidenceReportConfidenceRows(product, detail);
  const impactRows = getEvidenceReportImpactRows(product, detail);
  const hasPersistedRiskComponents = Boolean(metrics.riskComponents && Object.keys(metrics.riskComponents).length);

  return {
    riskRows,
    riskSubtitle: hasPersistedRiskComponents
      ? detail.scoreCalculationStatus || "Score calculated from persisted components."
      : "Score breakdown reconstructed from stored metrics because this product predates component persistence.",
    riskFooter: getRiskScoreFooter(metrics, detail, riskRows, hasPersistedRiskComponents),
    confidenceRows,
    confidenceFooter: getConfidenceFooter(metrics, detail),
    impactRows,
    impactFooter: getImpactFooter(metrics, detail),
  };
}

function getEvidenceReportRiskRows(product = {}, detail = {}) {
  const metrics = product.metrics || {};
  const persisted = metrics.riskComponents || {};
  const persistedRows = getPersistedRiskComponentRows(persisted);
  if (persistedRows.length) return persistedRows;

  const base = Number(detail.riskScore || 0) > 0 ? 8 : 0;
  const factors = [
    {
      key: "returns",
      label: "Returns anomaly",
      weight: getReturnRiskWeight(metrics),
      detail: `${formatInteger(metrics.returnUnits)} returns, ${formatPercent(metrics.returnRate)} return rate vs. ${formatPercent(metrics.storeAvgReturnRate)} store baseline.`,
      tone: "red",
    },
    {
      key: "refunds",
      label: "Refund pressure",
      weight: getRefundRiskWeight(metrics),
      detail: `${formatInteger(metrics.refundUnits)} refunds, ${formatPercent(metrics.refundRate)} refund rate, ${formatMoney(metrics.refundAmount || 0)} refunded.`,
      tone: "amber",
    },
    {
      key: "reviews",
      label: "Review anomaly",
      weight: getReviewRiskWeight(metrics),
      detail: `${formatInteger(metrics.negativeReviewCount)} negative reviews from ${formatInteger(metrics.reviewCount || metrics.csvReviewRatingCount)} connected reviews.`,
      tone: "violet",
    },
    {
      key: "customerLanguage",
      label: "Customer language and sentiment",
      weight: getLanguageRiskWeight(metrics),
      detail: `${formatInteger(metrics.textInsights?.sentiment?.negative)} negative text signals from ${formatInteger(metrics.textInsights?.sentiment?.total)} analyzed customer texts.`,
      tone: "violet",
    },
    {
      key: "content",
      label: "Product content quality",
      weight: getContentRiskWeight(metrics),
      detail: `${formatInteger(metrics.contentIssueCount)} content issues, content quality ${metrics.contentQualityScore ? `${metrics.contentQualityScore}/100` : "not scored"}.`,
      tone: "blue",
    },
    {
      key: "supportingSignals",
      label: "Evidence strength",
      weight: getSignalSupportRiskWeight(product, metrics),
      detail: `${formatInteger(metrics.signalCount)} total signals across ${formatInteger(product.sourceCoverage?.length || detail.evidenceSources?.length)} sources. This reconstructs confidence-style support, not financial impact.`,
      tone: "teal",
    },
    {
      key: "variants",
      label: "Affected scope",
      weight: getEvidenceList(metrics.affectedVariants).length ? 5 : 0,
      detail: `${formatInteger(getEvidenceList(metrics.affectedVariants).length)} affected variants stored. A single-variant product contributes 0 variant-risk points.`,
      tone: "amber",
    },
  ].filter((factor) => Number(factor.weight || 0) > 0);

  if (!factors.length) {
    return [{
      key: "no-risk",
      label: "No stored risk components",
      value: "0 pts",
      detail: "This product does not have enough stored risk evidence to explain a score.",
      tone: "blue",
    }];
  }

  const allocatable = Math.max(0, Number(detail.riskScore || 0) - base);
  const totalWeight = factors.reduce((sum, factor) => sum + Number(factor.weight || 0), 0) || 1;
  const rows = [];
  if (base) {
    rows.push({
      key: "base",
      label: "Model baseline",
      value: `${base} pts`,
      detail: "Small baseline applied when a product has stored risk evidence.",
      tone: "blue",
    });
  }

  let allocated = 0;
  factors.forEach((factor, index) => {
    const points = index === factors.length - 1
      ? Math.max(0, allocatable - allocated)
      : Math.max(0, Math.round((allocatable * factor.weight) / totalWeight));
    allocated += points;
    rows.push({ ...factor, value: `${points} pts` });
  });

  return rows;
}

function getPersistedRiskComponentRows(components = {}) {
  const rows = [
    riskComponentRow(components.base, "base", "Model baseline", "Small baseline applied before signal families.", "blue"),
    riskComponentRow(components.returnsScore ?? components.returnAnomaly ?? components.returnRate, "returns", "Returns score", "Smoothed excess return rate versus the store or category baseline.", "red"),
    riskComponentRow(components.reviewsScore ?? components.reviewAnomaly ?? components.csvRatings, "reviews", "Reviews score", "Smoothed negative review rate, rating pressure and CSV/Judge.me review signals.", "violet"),
    riskComponentRow(components.sentimentScore ?? components.textSentimentRisk, "sentiment", "Sentiment score", "Semantic modifier from AI-classified return notes, review text, emotions and repeated phrasing.", "violet"),
    riskComponentRow(components.contentGapScore ?? components.contentRisk, "content", "Content gap score", "Description, title, tag, collection and PDP clarity signals.", "blue"),
    riskComponentRow(components.refundScore ?? components.refundOperationalRisk ?? components.refundPressure ?? components.refundAnomaly, "refunds", "Refund score", "Refund rate pressure and operational refund signals. Dollar impact is kept outside product risk.", "amber"),
    riskComponentRow(components.variantScore ?? components.variantConcentration, "variants", "Affected scope", "Variant concentration contributes only when there is more than one variant and repeated affected-variant evidence.", "amber"),
    riskComponentRow(components.agreementBonus ?? components.sourceAgreement, "sourceAgreement", "Agreement bonus", "Small capped bonus when independent sources point to the same product issue.", "teal"),
    riskComponentRow(components.recencyBonus ?? components.recency ?? components.recentSpike, "recency", "Recency bonus", "Small capped bonus when recent evidence is stronger than older evidence.", "blue"),
  ].filter(Boolean);

  return rows.length ? rows : Object.entries(components)
    .filter(([key, value]) => !["rawScore", "calculated", "riskScore", "final"].includes(key) && Number(value || 0) !== 0)
    .map(([key, value]) => riskComponentRow(value, key, startCase(key), "Persisted scoring component.", "blue"))
    .filter(Boolean);
}

function riskComponentRow(value, key, label, detail, tone) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return {
    key,
    label,
    value: `${formatScorePoints(numeric)} pts`,
    detail,
    tone,
  };
}

function getEvidenceReportConfidenceRows(product = {}, detail = {}) {
  const metrics = product.metrics || {};
  const factors = metrics.confidenceFactors || {};
  if (Object.keys(factors).length) {
    const rows = [
      confidenceRow(factors.coverageScore, "coverage", "Source coverage", "Signals available from Shopify products, orders, returns, refunds and connected review sources.", "blue"),
      confidenceRow(factors.independentSourceScore, "independentSources", "Independent sources", `${formatInteger(factors.independentSourceCount || 0)} independent source families contributed to reliability.`, "violet"),
      confidenceRow(factors.effectiveSampleScore ?? factors.sampleScore ?? factors.sample, "sample", "Effective sample size", `${formatInteger(factors.effectiveSampleSize || metrics.signalCount || 0)} deduplicated events or customers, not raw signal count.`, "teal"),
      confidenceRow(factors.productMatchScore ?? factors.matchScore ?? factors.match, "match", "Product match quality", "Connected reviews matched this Shopify product by product ID, handle, title or SKU.", "blue"),
      confidenceRow(factors.agreementScore ?? factors.consistencyScore ?? factors.agreement, "agreement", "Source agreement", "Multiple independent sources agree on the same issue or pressure.", "violet"),
      confidenceRow(factors.freshnessScore ?? factors.recencyScore ?? factors.recency, "freshness", "Freshness", "Recent evidence makes the diagnosis easier to trust.", "teal"),
      confidenceRow(factors.penalties ? -Number(factors.penalties) : factors.lowSamplePenalty ? -Number(factors.lowSamplePenalty) : factors.penalty ? -Number(factors.penalty) : 0, "penalty", "Confidence penalties", "Missing order, return or refund access, sparse samples, weak product matching, duplicate signals, single-source diagnoses or subjective-only issues reduce confidence.", "red"),
      confidenceRow(factors.maxConfidence, "cap", "Confidence cap", "Maximum confidence allowed for the available source coverage.", "amber"),
    ].filter(Boolean);
    if (rows.length) return rows;
  }

  return [
    {
      key: "sourceCoverage",
      label: "Source coverage",
      value: `${formatInteger(product.sourceCoverage?.length || detail.evidenceSources?.length)} sources`,
      detail: `${getEvidenceList(product.sourceCoverage).join(", ") || "No source coverage stored"}.`,
      tone: "blue",
    },
    {
      key: "sampleSize",
      label: "Effective sample size",
      value: `${formatInteger(metrics.signalCount)} signals`,
      detail: `${formatInteger(metrics.soldUnits)} sold units, ${formatInteger(metrics.returnUnits)} returns, ${formatInteger(metrics.refundUnits)} refunds, ${formatInteger(metrics.negativeReviewCount)} negative reviews. Newer score models deduplicate this before confidence scoring.`,
      tone: "teal",
    },
    {
      key: "agreement",
      label: "Agreement",
      value: getConfidenceAgreementLabel(metrics),
      detail: "Confidence rises when returns, refunds, reviews, customer language and content analysis point to the same issue.",
      tone: "violet",
    },
    {
      key: "final",
      label: "Final persisted confidence",
      value: `${detail.confidence}%`,
      detail: "Stored confidence after sparse-signal caps, subjective-signal caps and source penalties.",
      tone: "blue",
    },
  ];
}

function confidenceRow(value, key, label, detail, tone) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return {
    key,
    label,
    value: key === "cap" ? `${formatScorePoints(numeric)} max` : `${numeric > 0 ? "+" : ""}${formatScorePoints(numeric)}`,
    detail,
    tone,
  };
}

function getEvidenceReportImpactRows(product = {}, detail = {}) {
  const metrics = product.metrics || {};
  const impact = metrics.impactFactors || metrics.estimatedImpactFactors || {};
  const avgUnitRevenue = Number(metrics.avgUnitRevenue || 0);
  const rows = [
    {
      key: "observedLoss",
      label: "Observed loss",
      value: formatMoney(impact.observedLoss ?? 0),
      detail: "Refunded value, return processing cost and lost margin from returned units already observed.",
      tone: "red",
    },
    {
      key: "refundValue",
      label: "Observed refunded value",
      value: formatMoney(impact.refundValueAtRisk ?? metrics.refundAmount ?? 0),
      detail: `${formatInteger(metrics.refundUnits)} refunded units in the available order window.`,
      tone: "red",
    },
    {
      key: "returnProcessing",
      label: "Return processing cost",
      value: formatMoney(impact.returnProcessingCost ?? 0),
      detail: `${formatInteger(metrics.returnUnits)} returned units multiplied by the configured processing-cost assumption.`,
      tone: "amber",
    },
    {
      key: "projectedReturnLoss",
      label: "Projected return loss",
      value: formatMoney(impact.projectedReturnLoss ?? impact.projectedFutureReturnLoss ?? getReturnExposureValue(metrics)),
      detail: `${formatPercent(metrics.returnRate)} return rate over ${formatInteger(metrics.soldUnits)} sold units, projected through the available scan window.`,
      tone: "amber",
    },
    {
      key: "reviewDrag",
      label: "Review conversion drag",
      value: formatMoney(impact.reviewConversionDrag ?? getReviewDragValue(metrics)),
      detail: `${formatInteger(metrics.negativeReviewCount)} negative reviews can reduce conversion, especially when recent.`,
      tone: "violet",
    },
    {
      key: "revenue",
      label: "Revenue at risk",
      value: formatMoney(impact.revenueAtRisk ?? detail.revenueAtRisk),
      detail: "Projected lost revenue, return revenue exposure and review conversion revenue drag.",
      tone: "blue",
    },
    {
      key: "margin",
      label: "Margin at risk",
      value: formatMoney(detail.marginAtRisk),
      detail: avgUnitRevenue ? `${formatMoney(avgUnitRevenue)} average unit revenue used where available.` : "Uses stored margin at risk or a conservative share of revenue at risk.",
      tone: "teal",
    },
    {
      key: "range",
      label: "Likely range",
      value: getFinancialExposureRangeLabel(detail),
      detail: "Low and high estimates widen when the effective sample is small.",
      tone: "blue",
    },
  ];

  return rows.filter((row) => row.value !== formatMoney(0) || ["margin", "range"].includes(row.key));
}

function getRiskScoreFooter(metrics = {}, detail = {}, riskRows = [], hasPersistedRiskComponents = false) {
  const components = metrics.riskComponents || {};
  const rawScore = components.rawScore ?? components.calculated ?? components.rawRisk;
  const componentTotal = riskRows.reduce((sum, row) => sum + Number(String(row.value || "").replace(/[^0-9.-]/g, "") || 0), 0);
  if (hasPersistedRiskComponents && Number.isFinite(Number(rawScore))) {
    return `${detail.scoreCalculationStatus || "Score calculated from persisted components"}. Raw component sum: ${formatScorePoints(rawScore)} points. Final product risk: ${detail.riskScore}/100. Financial exposure is excluded from product risk.`;
  }
  if (hasPersistedRiskComponents && componentTotal > 0) {
    return `${detail.scoreCalculationStatus || "Score calculated from persisted components"}. Persisted component total: ${formatScorePoints(componentTotal)} risk units. Final product risk: ${detail.riskScore}/100.`;
  }
  if (componentTotal > 0) {
    return `Score breakdown reconstructed. Rows sum to ${formatScorePoints(componentTotal)} points, matching the persisted ${detail.riskScore}/100 product risk from stored metrics.`;
  }
  return "No score components are available yet. Run QuickScan or a full product diagnosis to persist scoring evidence.";
}

function getConfidenceFooter(metrics = {}, detail = {}) {
  const factors = metrics.confidenceFactors || {};
  if (Object.keys(factors).length) {
    const maxConfidence = factors.maxConfidence ? ` The model capped diagnosis confidence at ${formatScorePoints(factors.maxConfidence)} for sample size, source independence, data quality or reconstruction limits.` : "";
    return `Final diagnosis confidence: ${detail.confidence}%. It measures reliability, not product severity.${maxConfidence}`;
  }
  return `Final diagnosis confidence: ${detail.confidence}%. Confidence is capped down when evidence is sparse, subjective or available from only one weak source.`;
}

function getImpactFooter(metrics = {}, detail = {}) {
  const revenue = getEstimatedRevenueValue(metrics);
  const margin = getEstimatedMarginValue(metrics);
  const range = getFinancialExposureRangeLabel(detail);
  return `Final financial exposure: ${formatMoney(detail.estimatedImpact)}. Revenue at risk is ${formatMoney(revenue)} and margin at risk is ${formatMoney(margin)}. Likely range: ${range}.`;
}

function getReturnRiskWeight(metrics = {}) {
  const returnRate = Number(metrics.returnRate || 0);
  const storeAvgReturnRate = Number(metrics.storeAvgReturnRate || 0);
  const anomaly = storeAvgReturnRate > 0
    ? Math.max(0, Math.min(25, ((returnRate / storeAvgReturnRate) - 1) * 14))
    : Math.min(22, returnRate * 1.2);
  return anomaly * getReportSampleSupport(metrics.returnUnits);
}

function getRefundRiskWeight(metrics = {}) {
  const refundRate = Number(metrics.refundRate || 0);
  const storeAvgRefundRate = Number(metrics.storeAvgRefundRate || 0);
  const anomaly = storeAvgRefundRate > 0
    ? Math.max(0, Math.min(20, ((refundRate / storeAvgRefundRate) - 1) * 11))
    : Math.min(18, refundRate);
  const impact = Math.min(15, Math.log10(Number(metrics.refundAmount || 0) + 1) * 4);
  const pressure = Number(metrics.refundPressure?.highPressure || metrics.refundInsights?.highPressure) ? 10 : Math.min(8, refundRate * 0.3);
  return (anomaly + impact + pressure) * getReportRefundSupport(metrics);
}

function getReviewRiskWeight(metrics = {}) {
  const reviewCount = Number(metrics.reviewCount || metrics.csvReviewRatingCount || 0);
  const negativeReviewCount = Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || 0);
  if (!reviewCount || !negativeReviewCount) return 0;
  const ratePressure = Number(metrics.negativeReviewRate || metrics.csvNegativeRatingRate || 0) * 0.18;
  const ratingPressure = Math.max(0, 4 - Number(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating || 0)) * 2.5;
  const sampleSupport = negativeReviewCount <= 1 ? 0.18 : negativeReviewCount === 2 ? 0.32 : negativeReviewCount <= 4 ? 0.58 : 1;
  return Math.min(20, ratePressure + ratingPressure) * sampleSupport;
}

function getLanguageRiskWeight(metrics = {}) {
  const sentiment = metrics.textInsights?.sentiment || {};
  const total = Number(sentiment.total || 0);
  if (!total) return 0;
  const negative = Number(sentiment.negative || 0);
  const subjective = Number(metrics.textInsights?.subjectiveNegativity?.count || 0);
  const ratio = Number(metrics.textInsights?.subjectiveNegativity?.ratio || 0);
  const objective = Math.max(0, negative - subjective);
  const objectiveRisk = Math.min(8, (objective / total) * 10) * getReportSampleSupport(objective);
  const subjectiveRisk = subjective <= 1
    ? Math.min(1.5, ratio * 1.5)
    : Math.min(8, 1.8 + ratio * 5 + Math.log2(subjective + 1) * 0.7);
  return Math.min(8, objectiveRisk + subjectiveRisk);
}

function getContentRiskWeight(metrics = {}) {
  const storedRisk = Number(metrics.contentQualityRisk || 0);
  if (storedRisk > 0) return Math.min(16, storedRisk);
  const issueCount = Number(metrics.contentIssueCount || 0);
  return issueCount ? Math.min(16, issueCount * 4) : 0;
}

function getSignalSupportRiskWeight(product = {}, metrics = {}) {
  const signalCount = Number(metrics.signalCount || 0);
  const sourceCount = Number(product.sourceCoverage?.length || 0);
  const recentSignals = Number(metrics.recentSignalUnits || 0);
  const signalVolume = Math.min(12, Math.sqrt(signalCount) * 2.6);
  const sourceAgreement = sourceCount > 1 ? Math.min(9, sourceCount * 2.25) : 0;
  const recency = signalCount ? Math.min(9, (recentSignals / Math.max(signalCount, 1)) * 15) : 0;
  return signalVolume + sourceAgreement + recency;
}

function getReportSampleSupport(count) {
  const signalCount = Number(count || 0);
  if (signalCount <= 0) return 0;
  if (signalCount === 1) return 0.28;
  if (signalCount === 2) return 0.58;
  if (signalCount === 3) return 0.74;
  if (signalCount === 4) return 0.86;
  return 1;
}

function getReportRefundSupport(metrics = {}) {
  const refundUnits = Number(metrics.refundUnits || 0);
  if (!refundUnits) return 0;
  if (Number(metrics.soldUnits || 0) > 10 && Number(metrics.refundRate || 0) > 20) return 1;
  if (refundUnits <= 2) return getReportSampleSupport(refundUnits) * 0.45;
  return 0.85;
}

function getConfidenceAgreementLabel(metrics = {}) {
  const agreeingSources = [
    Number(metrics.returnUnits || 0) > 0,
    Number(metrics.refundUnits || 0) > 0,
    Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || 0) > 0,
    Number(metrics.textInsights?.sentiment?.negative || 0) > 0,
    Number(metrics.contentIssueCount || 0) > 0,
  ].filter(Boolean).length;
  if (agreeingSources >= 3) return "Strong";
  if (agreeingSources === 2) return "Moderate";
  if (agreeingSources === 1) return "Single source";
  return "No agreement";
}

function getReturnExposureValue(metrics = {}) {
  const salesAmount = Number(metrics.salesAmount || 0);
  const returnRate = Number(metrics.returnRate || 0) / 100;
  const avgUnitRevenue = Number(metrics.avgUnitRevenue || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  if (salesAmount > 0 && returnRate > 0) return salesAmount * returnRate;
  if (avgUnitRevenue > 0 && returnUnits > 0) return avgUnitRevenue * returnUnits;
  return 0;
}

function getReviewDragValue(metrics = {}) {
  const salesAmount = Number(metrics.salesAmount || metrics.revenueAtRisk || 0);
  const negativeRate = Number(metrics.negativeReviewRate || metrics.csvNegativeRatingRate || 0) / 100;
  return salesAmount > 0 && negativeRate > 0 ? salesAmount * Math.min(0.18, negativeRate * 0.35) : 0;
}

function formatScorePoints(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(numeric) < 10 && numeric % 1 !== 0 ? 1 : 0,
  }).format(numeric);
}

function startCase(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getEvidenceSourcePanelTitle(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("return")) return "Returns";
  if (normalized.includes("refund")) return "Refunds";
  if (normalized.includes("review") || normalized.includes("judge")) return "Reviews";
  if (normalized.includes("csv")) return "CSV data";
  if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) return "AI sentiment";
  if (normalized.includes("variant")) return "Variants";
  if (normalized.includes("product") || normalized.includes("shopify")) return "Product data";
  return source || "Evidence";
}

function getProductEvidenceReportHref(product, source) {
  const base = product?.href || (product?.slug ? `/app/products/${product.slug}` : "/app/products");
  const sourceQuery = source?.title ? `?source=${encodeURIComponent(source.title)}` : "";
  return `${base}/evidence${sourceQuery}`;
}

function getEvidenceTrendLabel(values = []) {
  const trendValues = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (trendValues.length < 2) return "No trend";
  const first = trendValues[0];
  const last = trendValues[trendValues.length - 1];
  if (last > first) return "Increasing";
  if (last < first) return "Improving";
  return "Stable";
}

function getEvidenceFindingTitle(point) {
  const tone = getEvidencePointTone(point);
  if (tone === "negative") return "Risk signal detected";
  if (tone === "positive") return "Positive signal observed";
  if (tone === "insight") return "AI language insight";
  if (tone === "neutral") return "Context signal";
  return "Supporting finding";
}

function getEvidenceReportMetricRows(metrics = {}) {
  const rows = [];
  const visit = (value, path) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      rows.push({ key: path, value: value.length ? formatRawReportValue(value) : "[]" });
      return;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) return;
      entries.forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key));
      return;
    }
    rows.push({ key: path, value: String(value) });
  };
  Object.entries(metrics).forEach(([key, value]) => visit(value, key));
  return rows.length ? rows : [{ key: "metrics", value: "No stored metrics" }];
}

function formatRawReportValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function getEvidenceSourceCards(source, points = [], product = {}) {
  const metrics = product.metrics || {};
  const textInsights = metrics.textInsights || {};
  const normalized = String(source || "").toLowerCase();
  const cards = [];
  const add = (label, value, detail, icon = "info", tone = "blue", extra = {}) => {
    if (value === null || value === undefined || value === "") return;
    cards.push({
      label,
      value,
      detail: detail || "Stored evidence",
      icon,
      tone,
      popoverBody: getEvidenceMetricPopoverBody({ source, label, value, detail, metrics, textInsights, product }),
      ...extra,
    });
  };

  if (normalized.includes("return")) {
    const topReasons = getEvidenceReasonItems(metrics.topReturnReasonDetails || metrics.topReturnReasons);
    add("Total returns", formatInteger(metrics.returnUnits), `${formatPercent(metrics.returnRate)} return rate`, "return", "blue");
    add("Return rate", formatPercent(metrics.returnRate), `${formatInteger(metrics.soldUnits)} sold units in scan window`, "chart-line", "teal");
    add("Returned within window", `${formatInteger(metrics.returnUnits)} units`, `${metrics.windowDays || 60} day evidence window`, "clock", "blue", { trend: metrics.signalTrend });
    add("Top reason", topReasons[0]?.label || metrics.primaryIssue || "No reason stored", topReasons[0]?.detail || "Highest-count return signal", "target", "violet", topReasons[0]?.badge ? { badge: topReasons[0].badge } : {});
    add("Other reason signal", topReasons[1]?.label || "No second reason", topReasons[1]?.detail || "Secondary return reason", "note", "violet", topReasons[1]?.badge ? { badge: topReasons[1].badge } : {});
    add("Last signal captured", metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : detailLastAnalysis(product), `${formatInteger(metrics.signalCount)} total signals`, "calendar", "blue");
  } else if (normalized.includes("refund")) {
    const topReasons = getEvidenceReasonItems(metrics.topRefundReasonDetails || metrics.topRefundReasons);
    add("Refunded units", formatInteger(metrics.refundUnits), `${formatPercent(metrics.refundRate)} refund rate`, "cash-dollar", "blue");
    add("Refund amount", formatMoney(metrics.refundAmount || 0), "Stored refund value from Shopify", "cash-dollar", "red");
    add("Refund pressure", formatPercent(metrics.refundRate), `${formatInteger(metrics.soldUnits)} sold units baseline`, "chart-line", Number(metrics.refundRate || 0) > 20 ? "red" : "amber");
    add("Top refund reason", topReasons[0]?.label || "No reason stored", topReasons[0]?.detail || "Primary refund signal", "target", "violet", topReasons[0]?.badge ? { badge: topReasons[0].badge } : {});
    add("Margin at risk", formatMoney(metrics.marginAtRisk || 0), `${formatMoney(metrics.revenueAtRisk || 0)} revenue at risk`, "cash-dollar", "teal");
    add("Last signal captured", metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : detailLastAnalysis(product), `${formatInteger(metrics.signalCount)} total signals`, "calendar", "blue");
  } else if (normalized.includes("review") || normalized.includes("judge")) {
    add("Total reviews", formatInteger(metrics.reviewCount || metrics.csvReviewCount || metrics.judgeMeReviewCount), `${formatInteger(metrics.negativeReviewCount)} negative reviews`, "star", "blue");
    add("Average rating", metrics.avgRating || metrics.reviewRating || "0", "Product-level review rating", "star", "teal");
    add("Negative reviews", formatInteger(metrics.negativeReviewCount), `${formatPercent(metrics.negativeReviewRate)} negative review rate`, "alert-circle", Number(metrics.negativeReviewRate || 0) > 25 ? "red" : "amber");
    add("Recent negatives", formatInteger(metrics.recentNegativeReviewCount), "Recent negative review signals", "clock", "violet");
    add("Review sentiment", formatSentimentSummary(textInsights.reviews?.sentiment), "AI-readable review language", "note", "violet");
    add("Review emotions", getTopEmotionLabel(textInsights.reviews?.emotions), "Dominant detected review emotion", "lightbulb", "violet");
  } else if (normalized.includes("csv")) {
    add("CSV reviews", formatInteger(metrics.csvReviewCount || metrics.csvReviewRatingCount), "Normalized external review rows", "file", "blue");
    add("CSV rating", metrics.csvAverageRating || metrics.csvReviewRating || metrics.avgRating || "0", "Average rating from uploaded CSV", "star", "teal");
    add("Matched products", formatInteger(metrics.csvMatchedReviewCount || metrics.csvReviewCount), "Rows matched to Shopify product identifiers", "link", "violet");
    add("Negative CSV reviews", formatInteger(metrics.csvNegativeReviewCount || metrics.negativeReviewCount), "Imported low-rating signals", "alert-circle", "amber");
    add("Source health", metrics.csvReviewCount || metrics.csvReviewRatingCount ? "Available" : "No CSV data", "CSV can be disabled from Connect", "check-circle", "blue");
    add("Last imported", metrics.csvImportedAt ? formatProductAnalysisDate(metrics.csvImportedAt) : "Stored import", "Normalized file is stored by shop", "calendar", "blue");
  } else if (normalized.includes("language") || normalized.includes("sentiment") || normalized.includes("customer")) {
    const combinedSentiment = getCombinedCustomerLanguageSentiment(metrics);
    const emotionSummary = getCustomerLanguageEmotionSummary(metrics);
    const sentimentVisual = getSentimentVisual(combinedSentiment);
    add("Text signals", formatInteger(combinedSentiment.total), "Reviews, return notes and refund notes analyzed together", "note", "blue");
    add("Negative language", formatInteger(combinedSentiment.negative), `${formatInteger(combinedSentiment.neutral)} neutral / ${formatInteger(combinedSentiment.positive)} positive`, "alert-circle", Number(combinedSentiment.negative || 0) > 0 ? "red" : "teal");
    add("Primary emotion", formatEvidenceEmotionLabelOnly(emotionSummary.primary), emotionSummary.primary?.count ? `${formatInteger(emotionSummary.primary.count)} labeled signals` : "No primary emotion stored", "lightbulb", emotionSummary.primary?.polarity === "negative" ? "red" : "violet");
    add("Secondary emotion", formatEvidenceEmotionLabelOnly(emotionSummary.secondary), emotionSummary.secondary?.count ? `${formatInteger(emotionSummary.secondary.count)} next-strongest signals` : "Only one emotion cluster stored", "wand", emotionSummary.secondary?.polarity === "negative" ? "amber" : "violet");
    add("Overall sentiment", getDominantSentimentLabel(combinedSentiment), `${formatInteger(combinedSentiment.negative)} negative / ${formatInteger(combinedSentiment.positive)} positive`, sentimentVisual.icon, sentimentVisual.tone);
    add("Subjective reactions", formatInteger(textInsights.subjectiveNegativity?.count), `${formatInteger(textInsights.subjectiveNegativity?.total)} customer text signals`, "view", "amber");
  } else if (normalized.includes("order") || normalized.includes("sales")) {
    const activity = normalizeProductMonthlyOrderActivity(metrics.monthlyOrderActivity);
    const summary = activity.summary || {};
    const unitsSold = Number(summary.totalOrderUnits || metrics.soldUnits || 0);
    const orderCount = Number(summary.totalOrders || metrics.orderCount || metrics.ordersLast30Days || 0);
    const revenue = Number(summary.totalRevenue || metrics.salesAmount || metrics.revenueLast30Days || metrics.revenueAtRisk || 0);
    const windowDays = Number(activity.windowDays || metrics.windowDays || 365);
    const aov = orderCount ? revenue / orderCount : Number(metrics.avgOrderValue || metrics.avgUnitRevenue || 0);
    add("Units sold", formatInteger(unitsSold), "Sold in scan window", "cash-dollar", "teal");
    add("Orders", formatInteger(orderCount), "Orders in scan window", "cash-dollar", "teal");
    add("Order window", `${formatInteger(windowDays)} days`, "Analysis window", "clock", "blue");
    add("AOV", formatMoney(aov), "Average order value", "cash-dollar", "blue");
    add("Revenue", formatMoney(revenue), "Order revenue in available window", "cash-dollar", "teal");
    add("Last signal captured", metrics.lastSignalAt ? formatProductAnalysisDate(metrics.lastSignalAt) : detailLastAnalysis(product), `${formatInteger(metrics.signalCount)} total signals`, "calendar", "blue");
  } else if (normalized.includes("variant")) {
    add("Affected variants", formatInteger(getEvidenceList(metrics.affectedVariants).length), getEvidenceList(metrics.affectedVariants).slice(0, 3).join(", ") || "No affected variants stored", "duplicate", "blue");
    add("Variant count", formatInteger(metrics.variantCount), "Shopify product variants", "product", "teal");
    add("SKU count", formatInteger(metrics.skuCount), "Variant SKUs captured", "number", "blue");
    add("Options", getEvidenceList(metrics.optionNames).join(", ") || "No options stored", "Size, color or product options", "checkbox", "violet");
    add("Affected scope", formatPercent(metrics.variantConcentration || 0), "Share of signals concentrated in affected variants", "target", "amber");
    add("Signal trend", getEvidenceTrendLabel(metrics.signalTrend), "Issue movement for variant-related signals", "chart-line", "blue", { trend: metrics.signalTrend });
  } else if (normalized.includes("product") || normalized.includes("shopify")) {
    add("Description words", formatInteger(metrics.descriptionWordCount), metrics.hasDescription ? "Clean PDP description text detected" : "No usable PDP description text found", "note", metrics.hasDescription ? "teal" : "red");
    add("Content quality", metrics.contentQualityScore ? `${metrics.contentQualityScore}/100` : "Not scored", "100 means no deterministic copy issues were detected", "shield-check-mark", "violet");
    add("Product type", metrics.productType || "Not stored", metrics.vendor || "Vendor not stored", "product", "blue");
    add("Collections", formatInteger(getEvidenceList(metrics.collections).length), getEvidenceList(metrics.collections).slice(0, 3).join(", ") || "No collections stored", "duplicate", "teal");
    add("Tags", formatInteger(getEvidenceList(metrics.tags).length), getEvidenceList(metrics.tags).slice(0, 4).join(", ") || "No tags stored", "target", "blue");
    add("Variants", formatInteger(metrics.variantCount), `${formatInteger(metrics.skuCount)} SKUs`, "product", "violet");
    add("Media coverage", formatInteger(metrics.mediaCount), metrics.mediaWithoutAltCount ? `${formatInteger(metrics.mediaWithoutAltCount)} media item${Number(metrics.mediaWithoutAltCount) === 1 ? "" : "s"} missing alt text` : "Media alt text looks covered", "image", metrics.mediaWithoutAltCount ? "amber" : "teal");
  }

  appendEvidencePointCards(cards, { source, points, metrics, product });

  return cards;
}

function appendEvidencePointCards(cards, { source, points = [], metrics = {}, product = {} }) {
  const existingKeys = new Set(cards.map((card) => `${String(card.label).toLowerCase()}|${String(card.value).toLowerCase()}`));
  const existingLabels = new Set(cards.map((card) => String(card.label).toLowerCase()));
  points.forEach((point, index) => {
    const parsed = parseEvidencePoint(point);
    const label = getEvidencePointLabel({ parsed, point, source, index });
    const value = getEvidencePointValue(parsed, index);
    const detail = summarizeEvidencePoint(parsed.body || parsed.label || point);
    const key = `${String(label).toLowerCase()}|${String(value).toLowerCase()}`;
    if (existingLabels.has(String(label).toLowerCase()) && ["description words", "content quality", "variants", "collections", "tags"].includes(String(label).toLowerCase())) return;
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    existingLabels.add(String(label).toLowerCase());
    cards.push({
      label,
      value,
      detail,
      icon: getEvidenceIcon(source),
      tone: getEvidencePointTone(point) === "negative" ? "red" : getEvidencePointTone(point) === "positive" ? "teal" : getEvidencePointTone(point) === "insight" ? "violet" : "blue",
      popoverTitle: value && normalizeEvidenceText(value) !== normalizeEvidenceText(label) ? `${label}: ${value}` : label,
      popoverBody: getEvidencePointPopoverBody({ source, parsed, index, metrics, product }),
      popoverItems: [
        { label: "What it says", value: detail },
        { label: "Source", value: String(source || "Evidence source") },
        { label: "Why it matters", value: getEvidencePointInterpretation(parsed.body || point) },
      ],
    });
  });
}

function getEvidencePointValue(parsed = {}, index = 0) {
  const body = String(parsed.body || parsed.label || "");
  const money = body.match(/\$[\d,]+(?:\.\d+)?/);
  if (money) return money[0];
  const percent = body.match(/\b\d+(?:\.\d+)?%/);
  if (percent) return percent[0];
  const count = body.match(/\b\d+\b/);
  if (count) return count[0];
  const quoted = body.match(/"([^"]+)"/);
  if (quoted) return quoted[1].slice(0, 32);
  const compactBody = summarizeEvidencePoint(body);
  if (compactBody && compactBody !== "Stored source evidence" && compactBody.length <= 52) return compactBody;
  return `Evidence ${index + 1}`;
}

function getEvidencePointLabel({ parsed = {}, point = "", source = "", index = 0 }) {
  const rawLabel = String(parsed.label || "").trim();
  if (rawLabel && !/^finding\s+\d+$/i.test(rawLabel)) return rawLabel;
  const body = normalizeEvidenceText(parsed.body || point);
  if (body.includes("description words")) return "Description words";
  if (body.includes("content quality")) return "Content quality";
  if (body.startsWith("vendor")) return "Vendor";
  if (body.startsWith("product type")) return "Product type";
  if (body.startsWith("collections")) return "Collections";
  if (body.includes("product tags")) return "Product tags";
  if (body.includes("variants available")) return "Variant coverage";
  if (body.includes("total signals")) return "Signal count";
  if (body.includes("last signal")) return "Freshness";
  if (body.includes("return-note sentiment") || body.includes("return note example")) return "Return language";
  if (body.includes("review example") || body.includes("negative reviews")) return "Review evidence";
  if (body.includes("emotion") || body.includes("sentiment")) return "Customer sentiment";
  if (body.includes("refund")) return "Refund evidence";
  const sourceName = String(source || "Evidence").replace(/^shopify\s+/i, "").replace(/\s+analysis$/i, "");
  return `${sourceName || "Evidence"} insight ${index + 1}`;
}

function normalizeEvidenceText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function summarizeEvidencePoint(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "Stored source evidence";
  return text.length > 96 ? `${text.slice(0, 93).trim()}...` : text;
}

function getEvidenceMetricPopoverBody({ source, label, value, detail, metrics = {}, textInsights = {}, product = {} }) {
  const sourceName = String(source || "this source");
  const metricName = String(label || "metric").toLowerCase();
  const valueText = String(value || "no value");
  const detailText = String(detail || "No additional detail stored.");

  if (metricName.includes("return")) {
    return `${sourceName} shows ${valueText}. ${detailText}. This matters because returns are confirmed post-purchase friction and are weighted with smoothing against the store baseline.`;
  }
  if (metricName.includes("refund")) {
    return `${sourceName} shows ${valueText}. ${detailText}. Refunds are treated as a supporting product-quality signal and as financial exposure, but they do not directly inflate product risk by dollar amount.`;
  }
  if (metricName.includes("rating") || metricName.includes("review")) {
    return `${sourceName} shows ${valueText}. ${detailText}. Reviews contribute through rating pressure, negative review rate and language patterns when enough product-matched rows exist.`;
  }
  if (metricName.includes("emotion") || metricName.includes("sentiment") || metricName.includes("language")) {
    const total = getCombinedCustomerLanguageSentiment(metrics).total || textInsights.sentiment?.total || metrics.textInsights?.sentiment?.total || 0;
    return `${sourceName} shows ${valueText}. ${detailText}. ProductPulse analyzed ${formatInteger(total)} customer text signal${Number(total) === 1 ? "" : "s"} to understand tone, emotion and repeated language.`;
  }
  if (metricName.includes("variant") || metricName.includes("scope") || metricName.includes("sku")) {
    return `${sourceName} shows ${valueText}. ${detailText}. Scope is important because a problem concentrated in one option is handled differently from a product-wide issue.`;
  }
  if (metricName.includes("description") || metricName.includes("content") || metricName.includes("tag") || metricName.includes("collection")) {
    if (metricName.includes("description")) {
      return `${sourceName} shows ${valueText}. ${detailText}. This matters because the PDP description is the main place to set expectations before the shopper buys; missing or very short copy can create avoidable confusion.`;
    }
    if (metricName.includes("content quality")) {
      return `${sourceName} shows ${valueText}. ${detailText}. The score is a deterministic content check: it drops when ProductPulse finds missing descriptions, very short copy, clearly disconnected title/description, or other buyer-facing content gaps.`;
    }
    return `${sourceName} shows ${valueText}. ${detailText}. Product content and catalog metadata help explain whether shoppers can understand what they are buying before checkout.`;
  }
  if (metricName.includes("margin") || metricName.includes("revenue") || metricName.includes("impact")) {
    return `${sourceName} shows ${valueText}. ${detailText}. Financial exposure is used for action priority and is kept separate from product risk severity.`;
  }

  return `${sourceName} shows ${valueText}. ${detailText}. This matters because it gives the merchant a source-level clue about what may be influencing product risk, confidence or priority for ${product.title || "this product"}.`;
}

function getEvidencePointPopoverBody({ source, parsed, index, product }) {
  const body = parsed.body || parsed.label || "Stored source evidence";
  const label = getEvidencePointLabel({ parsed, point: body, source, index });
  return `${label} matters for ${product.title || "this product"} because it adds context to what shoppers see, say, return or refund. Read it as supporting evidence, not as a standalone diagnosis. Evidence excerpt: ${summarizeEvidencePoint(body)}`;
}

function getEvidencePointInterpretation(text) {
  const tone = getEvidencePointTone(text);
  if (tone === "negative") return "This can point to buyer friction. It matters more when repeated, recent, or confirmed by another source.";
  if (tone === "positive") return "This is counter-evidence. It can reduce concern when negative signals are sparse or isolated.";
  if (tone === "insight") return "This explains the customer language behind the metric, which helps decide whether copy, QA, support or catalog data should change.";
  if (tone === "neutral") return "This is context for interpreting the product. It does not create risk by itself, but it helps audit the diagnosis.";
  return "This source detail helps explain what ProductPulse knows about the product before the merchant opens the full report.";
}

function detailLastAnalysis(product) {
  return product?.lastAnalysis && product.lastAnalysis !== "Not analyzed"
    ? formatProductAnalysisDate(product.lastAnalysis)
    : "Not captured";
}

function getEvidenceReasonItems(value) {
  return getEvidenceList(value).map((item) => {
    if (typeof item === "string") return { label: item, detail: "Stored reason", badge: "", count: 0, share: 0 };
    const label = item.label || item.reason || item.name || item.value || "Reason";
    const count = Number(item.count || item.quantity || item.units || 0);
    const share = Number(item.share || item.percent || item.percentage || 0);
    return {
      ...item,
      label,
      detail: item.detail || (count ? `${formatInteger(count)} signal${count === 1 ? "" : "s"}` : "Stored reason"),
      badge: share ? formatPercent(share) : "",
      count,
      share,
    };
  }).filter((item) => item.label);
}

function getEvidenceList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatSentimentSummary(sentiment = {}) {
  const total = Number(sentiment.total || 0);
  if (!total) return "0";
  return `${formatInteger(sentiment.negative)} negative`;
}

function quoteSourceText(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^["“].*["”]$/.test(text) ? text : `"${text.replace(/^["“]+|["”]+$/g, "")}"`;
}

function formatQuotedInlineList(items = []) {
  return formatInlineList(items.map(quoteSourceText).filter(Boolean));
}

function getEditableTextPlaceholders(value = "") {
  const text = String(value || "");
  const pattern = /\{([A-Za-z][^{}\n]{0,80})\}/g;
  const placeholders = [];
  let match;
  while ((match = pattern.exec(text))) {
    const placeholder = `{${String(match[1] || "").trim()}}`;
    if (placeholder.length > 2 && !placeholders.includes(placeholder)) placeholders.push(placeholder);
  }
  return placeholders;
}

function getActionApplicationPlaceholders(application = {}, text = "") {
  const values = [text];
  if (Array.isArray(application.descriptionChanges) && application.descriptionChanges.length) {
    const selectedIds = new Set(Array.isArray(application.selectedChangeIds) ? application.selectedChangeIds : []);
    application.descriptionChanges.forEach((change) => {
      if (!selectedIds.size || selectedIds.has(change.id)) values.push(change.text);
    });
  }
  return uniqueStrings(values.flatMap(getEditableTextPlaceholders));
}

function PlaceholderReviewNotice({ placeholders = [] }) {
  if (!placeholders.length) return null;
  return (
    <div className="ppPlaceholderNotice" role="alert">
      <s-icon type="alert-circle" size="small"></s-icon>
      <p>
        This generated text still contains placeholders that must be replaced before applying:
        {" "}
        <strong>{placeholders.join(", ")}</strong>.
        {" "}
        Edit the text and replace each placeholder with the correct product details.
      </p>
    </div>
  );
}

function getTopEmotionLabel(items = []) {
  const list = getEvidenceList(items)
    .map((item) => ({
      label: item.label || item.normalizedLabel || item.code || "",
      count: Number(item.count || item.signals || 0),
    }))
    .filter((item) => item.label);
  if (!list.length) return "None stored";
  list.sort((a, b) => b.count - a.count);
  return list[0].count ? `${list[0].label} ${formatInteger(list[0].count)}` : list[0].label;
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
    if (/^"/.test(token)) return <q className="ppEvidenceQuote" key={`${token}-${index}`}>{token.replace(/^"|"$/g, "")}</q>;
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

function renderAnalysisText(value = "") {
  const text = String(value || "");
  if (!text) return "";
  const parts = [];
  const pattern = /"([^"]+)"|“([^”]+)”|(\{[A-Za-z][^{}\n]{0,80}\})/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[3]) {
      parts.push(
        <span className="ppEditablePlaceholder" key={`placeholder-${match.index}`}>
          {match[3]}
        </span>,
      );
    } else {
      parts.push(
        <q className="ppInlineQuote" key={`quote-${match.index}`}>
          {match[1] || match[2] || ""}
        </q>,
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
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

function IssueInlineActions({ issue, onReview, onIgnore, onUnignore, ignored, pending = false }) {
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
        aria-label={`${ignored ? "Unignore" : pending ? "Saving" : "Ignore"} ${issue.issue}`}
        disabled={pending}
        onClick={ignored ? onUnignore : onIgnore}
      >
        {pending ? <span className="ppMiniSpinner" aria-hidden="true" /> : <s-icon type={ignored ? "plus-circle" : "x"} size="small"></s-icon>}
        <span role="tooltip">{ignored ? "Unignore issue" : pending ? "Saving issue state" : "Ignore for now"}</span>
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

function MinimizedRecommendedActionsTray({ actions, minimizedActionStates, onExpand }) {
  return (
    <div className="ppMinimizedActionsTray" aria-label="Minimized recommended actions">
      <span>Completed and dismissed</span>
      <div>
        {actions.map((action) => {
          const state = getArchivedActionState(action, minimizedActionStates);
          const label = getArchivedActionLabel(state);
          return (
            <button
              className={`ppMinimizedActionChip ppMinimizedActionChip-${state || "minimized"}`}
              type="button"
              key={getRecommendedActionKey(action)}
              aria-label={`Expand ${action.title}`}
              onClick={() => onExpand(action)}
            >
              <s-icon type={state === "dismissed" ? "x" : "check"} size="small"></s-icon>
              <span>{action.title}</span>
              <em>{label}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecommendedActionsCompleteModal({ productTitle, onClose }) {
  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppActionsCompleteModal" role="dialog" aria-modal="true" aria-labelledby="actions-complete-title">
        <div className="ppActionsCompleteCheck" aria-hidden="true">
          <s-icon type="check" size="large"></s-icon>
        </div>
        <span>Product actions complete</span>
        <h2 id="actions-complete-title">All recommended actions are handled</h2>
        <p>
          You have reviewed, applied, or dismissed every open recommendation for {productTitle}. Keep monitoring this product and run another deep diagnosis in the next few days to confirm how the evidence evolves.
        </p>
        <button className="ppPrimaryButton" type="button" onClick={onClose}>
          <s-icon type="check" size="small"></s-icon>
          Done
        </button>
      </section>
    </div>
  );
}

function getRecommendedActionKey(action = {}) {
  return action.id || action.title || action.label || "recommended-action";
}

function willCompleteProductRecommendedActions(product, archivedActionKey, minimizedActionStates = {}) {
  if (!product) return false;
  const detail = getProductDetailModel(product);
  if (!detail.hasFullDiagnosis || !detail.recommendedActions.length) return false;
  return willCompleteVisibleRecommendedActions(detail.recommendedActions, minimizedActionStates, archivedActionKey);
}

function willCompleteVisibleRecommendedActions(actions = [], minimizedActionStates = {}, archivedActionKey = "") {
  const normalizedArchivedKey = String(archivedActionKey || "");
  return actions.length > 0 && actions.every((action) => {
    const actionKey = getRecommendedActionKey(action);
    return actionKey === normalizedArchivedKey || Boolean(getArchivedActionState(action, minimizedActionStates));
  });
}

function getArchivedActionState(action = {}, minimizedActionStates = {}) {
  const actionKey = getRecommendedActionKey(action);
  if (Object.prototype.hasOwnProperty.call(minimizedActionStates, actionKey)) {
    const localState = minimizedActionStates[actionKey];
    return localState === "active" ? "" : localState;
  }
  const storedState = getArchivedActionStateFromRecordStatus(action.appliedRecord?.status);
  if (storedState) return storedState;
  return "";
}

function getArchivedActionLabel(state) {
  if (state === "dismissed") return "Dismissed";
  if (state === "applied") return "Applied";
  if (state === "reviewed") return "Reviewed";
  return "Minimized";
}

function getArchivedActionStateFromRecordStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("dismiss")) return "dismissed";
  if (normalized.includes("review")) return "reviewed";
  if (normalized.includes("applied")) return "applied";
  return "";
}

function sortRecommendedActionsForPanel(actions = [], sortKey = "priority", product = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const key = String(sortKey || "priority");
  const ranked = list.map((action, index) => ({ action, index }));

  const getValue = (action) => {
    const payload = action.payload || {};
    if (key === "impact") return getActionSortRank(getCompactIndicatorValue(payload.impact || payload.impactLevel, "Optional"), { highFirst: true });
    if (key === "confidence") return getActionSortRank(getCompactIndicatorValue(payload.confidence, "Medium"), { highFirst: true });
    if (key === "risk") return getActionSortRank(getCompactIndicatorValue(payload.applicationRisk, "Low"), { highFirst: false });
    if (key === "effort") return getActionSortRank(getCompactIndicatorValue(action.effort || payload.effort, "Low"), { highFirst: false });
    return getRecommendedActionDisplayScore(action, product);
  };

  return ranked
    .sort((first, second) => getValue(second.action) - getValue(first.action) || first.index - second.index)
    .map((item) => item.action);
}

function getActionSortRank(value = "", { highFirst = true } = {}) {
  const normalized = String(value || "").toLowerCase();
  const highOrder = { high: 3, medium: 2, optional: 1, low: 1 };
  const lowOrder = { low: 3, medium: 2, high: 1, optional: 1 };
  const order = highFirst ? highOrder : lowOrder;
  if (normalized.includes("high")) return order.high;
  if (normalized.includes("medium")) return order.medium;
  if (normalized.includes("optional")) return order.optional;
  if (normalized.includes("low")) return order.low;
  return 0;
}

function ProductRecommendedActionCompact({ action, index, onOpen }) {
  const badgeLabel = action.priority || action.type || action.effort || "Recommended";
  const indicators = getCompactRecommendedActionMetricItems(action);
  const description = getCompactRecommendedActionDescription(action);
  return (
    <button
      className="ppCompactRecommendedAction"
      type="button"
      aria-label={`Open recommended action ${action.title}`}
      onClick={() => onOpen(action)}
    >
      <span className="ppCompactRecommendedIndex">{index + 1}</span>
      <span className="ppCompactRecommendedContent">
        <strong>{action.title}</strong>
        <span className={`ppCompactRecommendedBadge ppCompactRecommendedBadge-${getCompactActionPriorityTone(badgeLabel)}`}>
          <span aria-hidden="true"></span>
          {badgeLabel}
        </span>
        <span className="ppCompactRecommendedDescription">{description}</span>
      </span>
      <s-icon type="chevron-right" size="small"></s-icon>
      <span className="ppCompactRecommendedMetrics" aria-label="Recommended action indicators">
        {indicators.map((indicator) => (
          <span className="ppCompactActionMetric" key={indicator.label}>
            <span className={`ppCompactActionMetricIcon ppCompactActionMetricIcon-${indicator.tone}`}>
              <s-icon type={indicator.icon} size="small"></s-icon>
            </span>
            <span>
              <small>{indicator.label}</small>
              <strong>{indicator.value}</strong>
            </span>
          </span>
        ))}
      </span>
    </button>
  );
}

function getCompactRecommendedActionMetricItems(action = {}) {
  const payload = action.payload || {};
  const impact = getCompactIndicatorValue(payload.impact || payload.impactLevel, "Optional");
  const applicationRisk = getCompactIndicatorValue(payload.applicationRisk, "Low");
  const effort = getCompactIndicatorValue(action.effort || payload.effort, "Low");
  const confidence = getCompactIndicatorValue(payload.confidence, "Medium");

  return [
    { label: "Impact", value: impact, tone: getCompactImpactTone(impact), icon: "target" },
    { label: "Risk", value: applicationRisk, tone: getCompactRiskTone(applicationRisk), icon: "shield-check-mark" },
    { label: "Effort", value: effort, tone: getCompactEffortTone(effort), icon: "clock" },
    { label: "Confidence", value: confidence, tone: getCompactConfidenceTone(confidence), icon: "chart-line" },
  ].filter((item) => item.value);
}

function getCompactRecommendedActionDescription(action = {}) {
  const payload = action.payload || {};
  const candidates = [
    payload.shortDescription,
    payload.description,
    payload.expectedBenefit,
    payload.expectedImpact,
    payload.proposedChange,
    payload.whyThisAction,
    action.detail,
    action.reason,
  ];
  const value = candidates.map((item) => String(item || "").replace(/\s+/g, " ").trim()).find(Boolean);
  if (value) return truncateCompactActionDescription(value);
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (normalized.includes("faq")) return "Add a focused FAQ to answer shopper questions before checkout.";
  if (normalized.includes("qa") || normalized.includes("supplier")) return "Review quality or fulfillment signals with the responsible team.";
  if (normalized.includes("description") || normalized.includes("pdp") || normalized.includes("copy")) return "Improve PDP copy so shoppers understand the product before buying.";
  if (normalized.includes("tag") || normalized.includes("workflow")) return "Add internal workflow context so the product is easier to track.";
  return "Review this recommended next step based on the stored diagnosis evidence.";
}

function truncateCompactActionDescription(value = "", maxLength = 104) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function getRecommendedActionExtendedDetails(action = {}, application = {}) {
  const payload = action.payload || {};
  const impact = getCompactIndicatorValue(payload.impact || payload.impactLevel, "Optional");
  const applicationRisk = getCompactIndicatorValue(payload.applicationRisk, "Low");
  const effort = getCompactIndicatorValue(action.effort || payload.effort, "Low");
  const visibility = getCompactIndicatorValue(payload.visibility, inferActionVisibility(action));
  const confidence = getCompactIndicatorValue(payload.confidence, "Medium");
  const evidenceStrength = getCompactIndicatorValue(payload.evidenceStrength, inferActionEvidenceStrength(action));
  const shopifyField = getCompactShopifyField(payload.shopifyField || action.type || "ProductPulse workflow");
  const reversibility = getCompactIndicatorValue(payload.reversibility, inferActionReversibility(action));
  const approval = getCompactIndicatorValue(payload.approvalLevel || payload.approval, inferActionApproval(action));
  const reason = getCompactIndicatorValue(payload.reasonCategory, inferActionReasonCategory(action));
  const expectedBenefit = getCompactIndicatorValue(payload.expectedBenefit || payload.expectedImpact, inferActionExpectedBenefit(action));

  return [
    { label: "Impact", value: impact, tone: getCompactImpactTone(impact) },
    { label: "Apply risk", value: applicationRisk, tone: getCompactRiskTone(applicationRisk) },
    { label: "Effort", value: effort, tone: getCompactEffortTone(effort) },
    { label: "Visibility", value: visibility, tone: getCompactVisibilityTone(visibility) },
    { label: "Confidence", value: confidence, tone: getCompactConfidenceTone(confidence) },
    { label: "Evidence", value: evidenceStrength, tone: getCompactEvidenceTone(evidenceStrength) },
    { label: "Shopify field", value: application.shopifyField || shopifyField, tone: "neutral" },
    { label: "Reversibility", value: reversibility, tone: getCompactReversibilityTone(reversibility) },
    { label: "Approval", value: approval, tone: getCompactApprovalTone(approval) },
    { label: "Reason", value: reason, tone: "neutral" },
    { label: "Benefit", value: expectedBenefit, tone: "blue" },
  ].filter((item) => item.value);
}

function getCompactIndicatorValue(value, fallback = "") {
  const raw = String(value || fallback || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (/^high impact$/i.test(raw)) return "High";
  if (/^medium impact$/i.test(raw)) return "Medium";
  if (/^optional$/i.test(raw)) return "Optional";
  if (/^review required before applying$/i.test(raw)) return "Review required";
  if (/^manual approval required$/i.test(raw)) return "Strong confirmation required";
  return raw;
}

function getCompactShopifyField(value = "") {
  const text = String(value || "").trim();
  if (!text) return "Workflow";
  return text
    .replace(/^Product\./, "")
    .replace(/^ProductVariant\./, "Variant ")
    .replace(/^InventoryLevel /, "Inventory ")
    .replace(/productpulse\./i, "")
    .replace(/\bor\b.+$/i, "")
    .trim()
    .slice(0, 32);
}

function inferActionVisibility(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (/\b(description|pdp|faq|title|seo|meta|handle|media|image|alt text|specs|details)\b/.test(normalized)) return "Customer-facing";
  if (/\b(status|price|inventory|variant|supplier|qa|fulfillment|safety)\b/.test(normalized)) return "Operational";
  return "Internal";
}

function inferActionEvidenceStrength(action = {}) {
  const evidenceCount = Array.isArray(action.evidence) ? action.evidence.length : 0;
  const normalized = `${action.id || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("mismatch")) return "Conflicting";
  if (evidenceCount >= 3) return "Strong";
  if (evidenceCount >= 2) return "Moderate";
  return "Weak";
}

function inferActionReversibility(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (/\b(status|archive|draft|inventory|price|variant)\b/.test(normalized)) return "Hard";
  if (/\b(description|title|seo|meta|handle|template|media|collection|classification)\b/.test(normalized)) return "Moderate";
  return "Easy";
}

function inferActionApproval(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.applicationRisk || ""}`.toLowerCase();
  if (/\b(high|status|archive|draft|inventory|price|manual approval)\b/.test(normalized)) return "Strong confirmation required";
  if (/\b(tag|metafield|watchlist|baseline|note)\b/.test(normalized)) return "Auto-safe";
  return "Review required";
}

function inferActionReasonCategory(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.trigger || ""}`.toLowerCase();
  if (/\b(momentum|watchlist|baseline)\b/.test(normalized)) return "Momentum";
  if (/\b(seo|meta|handle)\b/.test(normalized)) return "SEO";
  if (/\b(variant|sku|option)\b/.test(normalized)) return "Variant issue";
  if (/\b(sentiment|subjective|safety|emotion)\b/.test(normalized)) return "Sentiment";
  if (/\b(review|rating|judge|csv)\b/.test(normalized)) return "Reviews";
  if (/\b(refund|price|margin|value)\b/.test(normalized)) return "Refunds";
  if (/\b(return)\b/.test(normalized)) return "Returns";
  return "Content gap";
}

function inferActionExpectedBenefit(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.expectedImpact || ""}`.toLowerCase();
  if (/\b(seo|meta|handle)\b/.test(normalized)) return "Improve SEO";
  if (/\b(tag|collection|metafield|workflow|support|note|coverage|watchlist|baseline)\b/.test(normalized)) return "Improve workflow";
  if (/\b(status|inventory|draft|archive|safety|qa|supplier)\b/.test(normalized)) return "Prevent bad purchases";
  if (/\b(return|refund|variant|fit|size|quality|durability)\b/.test(normalized)) return "Reduce returns";
  return "Reduce confusion";
}

function getCompactRiskTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "red";
  if (normalized.includes("medium")) return "amber";
  return "green";
}

function getCompactImpactTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "red";
  if (normalized.includes("medium")) return "amber";
  return "blue";
}

function getCompactEffortTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "amber";
  if (normalized.includes("medium")) return "blue";
  return "green";
}

function getCompactVisibilityTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("customer")) return "violet";
  if (normalized.includes("operational")) return "amber";
  return "blue";
}

function getCompactConfidenceTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "green";
  if (normalized.includes("low")) return "amber";
  return "blue";
}

function getCompactEvidenceTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("strong")) return "green";
  if (normalized.includes("conflicting")) return "red";
  if (normalized.includes("weak")) return "amber";
  return "blue";
}

function getCompactReversibilityTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("hard")) return "red";
  if (normalized.includes("moderate")) return "amber";
  return "green";
}

function getCompactApprovalTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("strong")) return "red";
  if (normalized.includes("review")) return "amber";
  return "green";
}

function getCompactActionPriorityTone(priority = "") {
  const normalized = String(priority || "").toLowerCase();
  if (normalized.includes("high")) return "red";
  if (normalized.includes("medium")) return "teal";
  if (normalized.includes("optional")) return "blue";
  if (normalized.includes("primary")) return "violet";
  if (normalized.includes("customer") || normalized.includes("clarity") || normalized.includes("buyer")) return "teal";
  if (normalized.includes("risk")) return "red";
  if (normalized.includes("review") || normalized.includes("evidence")) return "blue";
  return "blue";
}

function ProductActionRecipeDetails({ application }) {
  const rows = [
    { label: "Reason detected", value: application.trigger, icon: "chart-line" },
    { label: "Will edit", value: application.shopifyField, icon: "product" },
    { label: "Expected benefit", value: application.expectedImpact, icon: "target" },
    { label: "Risk", value: application.applicationRisk, icon: "alert-circle", tone: getActionRiskTone(application.applicationRisk) },
    { label: "Approval", value: application.approval || application.reviewApplyFlow, icon: "check" },
  ].filter((item) => item.value);

  if (!rows.length) return null;

  return (
    <div className="ppActionRecipeGrid" aria-label="Recommended action recipe">
      {rows.map((row) => (
        <span className={`ppActionRecipeItem ppActionRecipeItem-${row.tone || "neutral"}`} key={row.label}>
          <s-icon type={row.icon} size="small"></s-icon>
          <small>{row.label}</small>
          <strong>{renderAnalysisText(row.value)}</strong>
        </span>
      ))}
    </div>
  );
}

function RecommendedActionReviewBody({
  action,
  actionKind = "applyable",
  application,
  product,
  editedText,
  detailExpanded,
  hasLongDetail,
  isEditingInline,
  unresolvedPlaceholders = [],
  onDetailExpandedChange,
  onDescriptionChangeExpandedToggle,
  onDescriptionChangeSelectedChange,
  onEditedTextChange,
  onEditText,
  onSelectedVariantChange,
  onMetafieldNamespaceChange,
  onMetafieldKeyChange,
}) {
  const detailText = String(application.editable ? editedText : application.value || action.detail || "");

  if (actionKind === "investigation") {
    return (
      <RecommendedActionInvestigationBody
        action={action}
        application={application}
        product={product}
      />
    );
  }

  return (
    <div className="ppProductActionBody ppActionReviewBody">
      <RecommendedActionReviewSection icon="edit" title="Proposed change">
        <p className="ppActionSectionLead">{application.intro}</p>
        {unresolvedPlaceholders.length > 0 && (
          <PlaceholderReviewNotice placeholders={unresolvedPlaceholders} />
        )}
        {application.descriptionChanges?.length && !isEditingInline ? (
          <RecommendedActionDescriptionChangeGroup
            changes={application.descriptionChanges}
            expandedIds={application.expandedDescriptionChangeIds}
            selectedIds={application.selectedChangeIds}
            onExpandedToggle={onDescriptionChangeExpandedToggle}
            onSelectedChange={onDescriptionChangeSelectedChange}
          />
        ) : (
          <RecommendedActionProposedChange
            action={action}
            application={application}
            detailExpanded={detailExpanded}
            detailText={detailText}
            hasLongDetail={hasLongDetail}
            isEditingInline={isEditingInline}
            onDetailExpandedChange={onDetailExpandedChange}
            onEditedTextChange={onEditedTextChange}
            onEditText={onEditText}
          />
        )}
        {application.variants?.length > 1 && (
          <div className="ppActionVariantChooser ppActionVariantChooser-review" role="group" aria-label={`How to apply ${action.title}`}>
            <span>Apply as</span>
            <div>
              {application.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  className={variant.id === application.variantId ? "isSelected" : ""}
                  onClick={() => onSelectedVariantChange(variant.id)}
                >
                  <strong>{variant.label}</strong>
                  <small>{variant.operation}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {application.isMetafield && (
          <RecommendedActionMetafieldConfig
            application={application}
            onNamespaceChange={onMetafieldNamespaceChange}
            onKeyChange={onMetafieldKeyChange}
          />
        )}
      </RecommendedActionReviewSection>

      {!application.hidePreview && (
        <RecommendedActionReviewSection icon="view" title="Preview">
          <RecommendedActionPreview application={application} editedText={editedText} />
        </RecommendedActionReviewSection>
      )}

      <RecommendedActionReviewSection icon="chart-line" title="Why this action">
        <RecommendedActionWhyItems action={action} product={product} />
      </RecommendedActionReviewSection>

      <RecommendedActionReviewSection icon="check-circle" title="Apply details">
        <RecommendedActionApplyDetails action={action} application={application} />
      </RecommendedActionReviewSection>

      <RecommendedActionAdvancedDetails action={action} application={application} />
    </div>
  );
}

function RecommendedActionMetafieldConfig({ application, onNamespaceChange, onKeyChange }) {
  return (
    <div className="ppFaqMetafieldFields">
      <div className="ppFaqMetafieldFieldsGrid">
        <label>
          <span>Namespace</span>
          <input
            aria-label="FAQ metafield namespace"
            type="text"
            value={application.metafieldNamespace || ""}
            onChange={(event) => onNamespaceChange?.(event.target.value)}
            placeholder="productpulse"
          />
        </label>
        <label>
          <span>Key</span>
          <input
            aria-label="FAQ metafield key"
            type="text"
            value={application.metafieldKey || ""}
            onChange={(event) => onKeyChange?.(event.target.value)}
            placeholder="faq_html"
          />
        </label>
      </div>
      <p>ProductPulse will save this FAQ as HTML in a Shopify long text metafield. Shopify creates the product metafield when it does not already exist.</p>
    </div>
  );
}

function RecommendedActionInvestigationBody({ action, application, product }) {
  return (
    <div className="ppProductActionBody ppActionReviewBody ppActionReviewBody-investigation">
      <RecommendedActionReviewSection icon="search" title="Recommended follow-up">
        <p className="ppInvestigationLead">{getInvestigationFollowupText(action, application, product)}</p>
      </RecommendedActionReviewSection>

      <RecommendedActionReviewSection icon="check-circle" title="What to verify">
        <ul className="ppInvestigationChecklist">
          {getInvestigationChecklistItems(action, product).map((item) => (
            <li key={item}>
              <s-icon type="check" size="small"></s-icon>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </RecommendedActionReviewSection>

      {application.variantUpdates?.length > 0 && (
        <RecommendedActionReviewSection icon="product" title="Suggested variant labels">
          <RecommendedActionVariantSuggestions suggestions={application.variantUpdates} />
        </RecommendedActionReviewSection>
      )}

      <RecommendedActionReviewSection icon="chart-line" title="Evidence summary">
        <RecommendedActionWhyItems action={action} product={product} />
      </RecommendedActionReviewSection>

      <RecommendedActionReviewSection icon="target" title="Suggested next steps">
        <ol className="ppInvestigationNextSteps">
          {getInvestigationNextSteps(action).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </RecommendedActionReviewSection>

      <RecommendedActionReviewSection icon="info" title="Apply details">
        <RecommendedActionInvestigationDetails action={action} application={application} />
      </RecommendedActionReviewSection>

      <RecommendedActionAdvancedDetails action={action} application={application} />
    </div>
  );
}

function RecommendedActionVariantSuggestions({ suggestions = [] }) {
  return (
    <div className="ppVariantSuggestionList">
      {suggestions.map((suggestion, index) => (
        <article className="ppVariantSuggestionItem" key={`${suggestion.variantId || suggestion.currentLabel || "variant"}-${index}`}>
          <span>
            <small>Current</small>
            <strong>{suggestion.currentLabel || suggestion.variantTitle || "Variant"}</strong>
            {suggestion.sku && <em>SKU {suggestion.sku}</em>}
          </span>
          <s-icon type="chevron-right" size="small"></s-icon>
          <span>
            <small>Suggested</small>
            <strong>{suggestion.suggestedLabel || formatVariantOptionValueSummary(suggestion.optionValues) || "Review option value"}</strong>
            {suggestion.optionValues?.length > 0 && <em>{formatVariantOptionValueSummary(suggestion.optionValues)}</em>}
          </span>
        </article>
      ))}
    </div>
  );
}

function formatVariantOptionValueSummary(optionValues = []) {
  return optionValues
    .map((option) => `${option.optionName}: ${option.suggestedValue}`)
    .filter(Boolean)
    .join(", ");
}

function getInvestigationFollowupText(action = {}, application = {}, product = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (normalized.includes("variant") && application.variantUpdates?.length > 0) {
    return "Review the suggested variant or option labels, then update the Shopify variant values directly when the mapping is safe or open Shopify to edit option names.";
  }
  if (normalized.includes("supplier") || normalized.includes("qa")) {
    return "Verify whether this product has a QA issue, source mismatch, supplier-related quality problem, or a signal that should be escalated internally.";
  }
  if (normalized.includes("variant")) {
    return "Inspect whether the diagnosis is concentrated in one variant, SKU, size, color, supplier, or product option before changing customer-facing content.";
  }
  if (normalized.includes("source") || normalized.includes("integrity") || normalized.includes("mismatch")) {
    return "Confirm whether the evidence belongs to this exact Shopify product and whether reviews, returns, or CSV data were linked correctly.";
  }
  if (normalized.includes("fulfillment") || normalized.includes("return") || normalized.includes("refund")) {
    return "Review the operational evidence and decide whether the issue is product-related, fulfillment-related, refund-policy noise, or a customer expectation mismatch.";
  }
  return application.intro || action.reason || `Review the supporting evidence for ${product.title || "this product"} before deciding whether a Shopify change or internal follow-up is needed.`;
}

function getInvestigationChecklistItems(action = {}, product = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  const items = [];

  if (Array.isArray(payload.reviewSections) && payload.reviewSections.length) {
    items.push("Open each supporting evidence source and confirm which signals are tied to this product.");
  }
  if (normalized.includes("source") || normalized.includes("mismatch")) {
    items.push("Check whether reviews or imported records mention another product, SKU, title, handle, or collection.");
  }
  if (normalized.includes("variant") || Array.isArray(payload.affectedVariants)) {
    items.push("Confirm whether one variant, SKU, size, color, or supplier is driving most of the issue.");
  }
  if (normalized.includes("qa") || normalized.includes("supplier") || normalized.includes("quality") || String(product.primaryIssue || "").toLowerCase().includes("quality")) {
    items.push("Inspect quality complaints and decide whether QA or supplier escalation is needed.");
  }
  if (Number(payload.returnUnits || product.metrics?.returnUnits || 0) > 0 || Number(product.metrics?.returnRate || 0) > 0) {
    items.push("Review return reasons and notes to separate product defects from expectation or fulfillment noise.");
  }
  if (Number(payload.negativeReviewCount || product.metrics?.negativeReviewCount || 0) > 0) {
    items.push("Read negative review language and confirm whether it describes a repeatable product problem.");
  }

  items.push("Decide whether the next step is a product content change, internal tag, QA check, supplier escalation, or dismissal.");
  return uniqueStrings(items).slice(0, 6);
}

function getInvestigationNextSteps(action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  const steps = ["Open supporting evidence"];
  if (normalized.includes("qa") || normalized.includes("supplier") || normalized.includes("quality")) {
    steps.push("Add an internal QA tag if the issue is confirmed");
    steps.push("Escalate internally with the strongest evidence");
  } else if (normalized.includes("variant")) {
    steps.push("Inspect affected variants in Shopify");
    steps.push("Create a variant-specific fix if one option is responsible");
  } else {
    steps.push("Mark as reviewed after verification");
    steps.push("Escalate internally only if the issue is confirmed");
  }
  steps.push("Dismiss the action if the evidence does not support it");
  return steps.slice(0, 4);
}

function RecommendedActionInvestigationDetails({ action, application }) {
  const optionalAction = getInvestigationOptionalShopifyAction(action);
  const baseDetails = [
    { icon: "product", label: "Will edit", value: "Nothing by default", tone: "blue" },
    { icon: "tag", label: "Optional Shopify action", value: optionalAction, tone: "blue" },
    { icon: "alert-circle", label: "Risk", value: application.applicationRisk || "Low", tone: getActionRiskTone(application.applicationRisk) },
    { icon: "check", label: "Approval", value: "Manual review required", tone: "warning" },
  ];
  const details = [
    ...baseDetails,
    ...getRecommendedActionExtendedDetails(action, application)
      .filter((detail) => !["Apply risk", "Shopify field", "Approval"].includes(detail.label))
      .map((detail) => ({
        icon: getActionDetailIcon(detail.label),
        label: detail.label,
        value: detail.value,
        tone: getActionDetailTone(detail),
      })),
  ];

  return (
    <div className="ppActionApplyDetailsGrid ppActionApplyDetailsGrid-investigation">
      {details.map((detail) => (
        <span className={`ppActionApplyDetail ppActionApplyDetail-${detail.tone || "neutral"}`} key={detail.label}>
          <s-icon type={detail.icon} size="small"></s-icon>
          <small>{detail.label}</small>
          <strong>{detail.value}</strong>
        </span>
      ))}
    </div>
  );
}

function getInvestigationOptionalShopifyAction(action = {}) {
  if (action.payload?.tag || (Array.isArray(action.payload?.tags) && action.payload.tags.length)) return "Add internal tag";
  if (getInvestigationTagForAction(action)) return "Add QA review tag";
  return "None";
}

function getInvestigationTagForAction(action = {}) {
  if (action.payload?.tag) return String(action.payload.tag).trim();
  if (Array.isArray(action.payload?.tags) && action.payload.tags.length) return String(action.payload.tags[0] || "").trim();
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (normalized.includes("qa") || normalized.includes("supplier") || normalized.includes("quality")) return "qa-review-needed";
  return "";
}

function getInvestigationPrimaryActionLabel(action = {}, mode = "") {
  if (mode === "copy") return "Copy note";
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (normalized.includes("variant")) return "Inspect evidence";
  if (normalized.includes("source") || normalized.includes("integrity") || normalized.includes("mismatch")) return "Open evidence";
  if (normalized.includes("qa") || normalized.includes("supplier")) return "Start verification";
  return "Open evidence";
}

function RecommendedActionReviewSection({ icon, title, children }) {
  return (
    <section className="ppActionReviewSection">
      <span className="ppActionReviewSectionIcon" aria-hidden="true">
        <s-icon type={icon} size="small"></s-icon>
      </span>
      <div className="ppActionReviewSectionContent">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

function RecommendedActionDescriptionChangeGroup({
  changes = [],
  expandedIds = {},
  selectedIds = [],
  onExpandedToggle,
  onSelectedChange,
}) {
  const selectedSet = new Set(selectedIds);

  return (
    <div className="ppDescriptionChangeGroup">
      {changes.map((change) => {
        const selected = selectedSet.has(change.id);
        const expanded = Boolean(expandedIds?.[change.id]);
        return (
          <article className={`ppDescriptionChangeItem ${selected ? "isSelected" : "isUnselected"}`.trim()} key={change.id}>
            <label className="ppDescriptionChangeItemHeader">
              <input
                type="checkbox"
                checked={selected}
                onChange={(event) => onSelectedChange?.(change.id, event.target instanceof HTMLInputElement ? event.target.checked : false)}
              />
              <span>
                <strong>{change.title}</strong>
                <small>{change.operationLabel}</small>
              </span>
              <button type="button" onClick={(event) => {
                event.preventDefault();
                onExpandedToggle?.(change.id);
              }}>
                {expanded ? "Collapse" : "Expand"}
                <s-icon type={expanded ? "chevron-up" : "chevron-right"} size="small"></s-icon>
              </button>
            </label>
            <p className={`ppDescriptionChangeText ${expanded ? "" : "isClamped"}`.trim()}>{renderAnalysisText(change.text)}</p>
            {expanded && change.reason && <small className="ppDescriptionChangeReason">{renderAnalysisText(change.reason)}</small>}
          </article>
        );
      })}
    </div>
  );
}

function RecommendedActionProposedChange({
  action,
  application,
  detailText,
  detailExpanded,
  hasLongDetail,
  isEditingInline,
  onDetailExpandedChange,
  onEditedTextChange,
  onEditText,
}) {
  const faqPreviewItems = !isEditingInline && isFaqRecommendedAction(action)
    ? getFaqPreviewItems(application, detailText)
    : [];

  return (
    <div className="ppActionProposedChangeBox">
      {isEditingInline ? (
        <label className="ppActionInlineEditor ppActionInlineEditor-review">
          <span>{application.valueLabel || "Proposed value"}</span>
          <textarea
            aria-label="Description text to apply"
            value={detailText}
            rows={detailExpanded ? 10 : 6}
            onChange={(event) => onEditedTextChange(event.target.value)}
          />
        </label>
      ) : (
        <>
          {application.valueLabel && <span className="ppActionProposedValueLabel">{application.valueLabel}</span>}
          {faqPreviewItems.length ? (
            <div className={`ppActionFaqPreview ${hasLongDetail && !detailExpanded ? "isClamped" : ""}`.trim()}>
              {faqPreviewItems.map((item, index) => (
                <article className="ppActionFaqPreviewItem" key={`${item.question || "faq"}-${index}`}>
                  {item.question && <strong>{renderAnalysisText(item.question)}</strong>}
                  {item.answer && <p>{renderAnalysisText(item.answer)}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className={`ppActionDetailText ppActionSuggestionText ${hasLongDetail && !detailExpanded ? "isClamped" : ""}`.trim()}>
              {renderAnalysisText(detailText || "No proposed value supplied.")}
            </p>
          )}
          {application.editable && (
            <button className="ppActionEditSuggestionButton ppActionEditSuggestionButton-review" type="button" onClick={onEditText} aria-label={`Edit suggested text for ${action.title}`}>
              <s-icon type="edit" size="small"></s-icon>
            </button>
          )}
        </>
      )}
      {hasLongDetail && !isEditingInline && (
        <button className="ppActionDetailToggle" type="button" onClick={() => onDetailExpandedChange((expanded) => !expanded)}>
          {detailExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function RecommendedActionPreview({ application, editedText }) {
  const preview = getRecommendedActionPreviewParts(application, editedText);
  const beforeHighlights = Array.isArray(preview.beforeHighlights) ? preview.beforeHighlights : [];
  const afterHighlights = [
    ...(Array.isArray(preview.afterHighlights) ? preview.afterHighlights : []),
    ...(preview.highlightText ? [{ text: preview.highlightText, position: preview.highlightPosition || "before" }] : []),
  ];
  const leadingAfterHighlights = afterHighlights.filter((highlight) => highlight.position !== "after");
  const trailingAfterHighlights = afterHighlights.filter((highlight) => highlight.position === "after");

  return (
    <div className="ppActionPreviewGrid">
      <div className="ppActionPreviewColumn">
        <strong>{preview.beforeLabel}</strong>
        <div className="ppActionPreviewBox">
          {beforeHighlights.map((highlight, index) => (
            <ActionPreviewHighlightBlock highlight={highlight} key={`before-highlight-${index}`} />
          ))}
          <p>{renderAnalysisText(preview.beforeText)}</p>
        </div>
      </div>
      <span className="ppActionPreviewArrow" aria-hidden="true">
        <s-icon type="chevron-right" size="small"></s-icon>
      </span>
      <div className="ppActionPreviewColumn">
        <strong>{preview.afterLabel}</strong>
        <div className="ppActionPreviewBox ppActionPreviewBox-after">
          {leadingAfterHighlights.map((highlight, index) => (
            <ActionPreviewHighlightBlock highlight={highlight} key={`after-highlight-leading-${index}`} />
          ))}
          {preview.afterText && <p>{renderAnalysisText(preview.afterText)}</p>}
          {trailingAfterHighlights.map((highlight, index) => (
            <ActionPreviewHighlightBlock highlight={highlight} key={`after-highlight-trailing-${index}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionPreviewHighlightBlock({ highlight }) {
  const text = typeof highlight === "string" ? highlight : highlight?.text;
  const label = typeof highlight === "string" ? "" : highlight?.label;
  if (!text) return null;
  return (
    <div className="ppActionPreviewInsertedText">
      <s-icon type="wand" size="small"></s-icon>
      <div>
        {label && <strong>{label}</strong>}
        <p>{renderAnalysisText(text)}</p>
      </div>
    </div>
  );
}

function getRecommendedActionPreviewParts(application = {}, editedText = "") {
  const proposed = normalizeActionText(editedText || application.value || "");
  const current = normalizeActionText(application.currentValue || "");
  const target = String(application.target || "").toLowerCase();
  const isDescription = target.includes("description");
  const beforeLabel = application.currentValueLabel
    ? `${application.currentValueLabel}${isDescription ? " (excerpt)" : ""}`
    : "Current Shopify value";
  const afterLabel = isDescription ? "Updated description preview" : `${application.target || "Updated value"} preview`;
  const emptyCurrent = isDescription ? "No current Shopify description was loaded for this product." : "No current Shopify value was loaded.";

  if (isDescription && Array.isArray(application.descriptionChanges) && application.descriptionChanges.length) {
    const selectedIds = Array.isArray(application.selectedChangeIds) && application.selectedChangeIds.length
      ? new Set(application.selectedChangeIds)
      : new Set(application.descriptionChanges.map((change) => change.id));
    const selectedChanges = application.descriptionChanges.filter((change) => selectedIds.has(change.id));
    const replacement = selectedChanges.find((change) => change.operation === "replace");
    const prependChanges = selectedChanges.filter((change) => change.operation === "prepend");
    const appendChanges = selectedChanges.filter((change) => change.operation === "append");
    const baseText = replacement ? "" : toActionPreviewExcerpt(current || emptyCurrent);
    return {
      beforeLabel,
      afterLabel,
      beforeText: toActionPreviewExcerpt(current || emptyCurrent),
      afterText: baseText,
      afterHighlights: [
        ...prependChanges.map((change) => buildActionPreviewChangeHighlight(change, "before")),
        ...(replacement ? [buildActionPreviewChangeHighlight(replacement, "before")] : []),
        ...appendChanges.map((change) => buildActionPreviewChangeHighlight(change, "after")),
      ],
    };
  }

  if (application.insertionPosition === "prepend" && current) {
    return {
      beforeLabel,
      afterLabel,
      beforeText: toActionPreviewExcerpt(current || emptyCurrent),
      highlightText: toActionPreviewExcerpt(proposed),
      afterText: toActionPreviewExcerpt(current),
    };
  }

  if (application.insertionPosition === "append" && current) {
    return {
      beforeLabel,
      afterLabel,
      beforeText: toActionPreviewExcerpt(current || emptyCurrent),
      highlightText: toActionPreviewExcerpt(proposed),
      highlightPosition: "after",
      afterText: toActionPreviewExcerpt(current),
    };
  }

  return {
    beforeLabel,
    afterLabel,
    beforeText: toActionPreviewExcerpt(current || emptyCurrent),
    highlightText: isDescription ? "" : "",
    afterText: toActionPreviewExcerpt(proposed || "No proposed value supplied."),
  };
}

function buildActionPreviewChangeHighlight(change = {}, position = "before") {
  return {
    label: change.operationLabel || change.title || "ProductPulse change",
    text: toActionPreviewExcerpt(change.text || ""),
    position,
  };
}

function toActionPreviewExcerpt(value = "", maxLength = 460) {
  const text = normalizeActionText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function RecommendedActionWhyItems({ action, product }) {
  const items = getRecommendedActionWhyItems(action, product);
  const narrative = getRecommendedActionWhyNarrative(action, product);
  return (
    <>
      {narrative && <p className="ppActionWhyNarrative">{renderAnalysisText(narrative)}</p>}
      <div className="ppActionWhyGrid">
        {items.map((item) => (
          <span className={`ppActionWhyItem ppActionWhyItem-${item.tone || "neutral"}`} key={`${item.label}-${item.value}`}>
            <s-icon type={item.icon} size="small"></s-icon>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </span>
        ))}
      </div>
    </>
  );
}

function getRecommendedActionWhyNarrative(action = {}, product = {}) {
  const payload = action.payload || {};
  const aiRationale = String(payload.whyThisAction || payload.actionRationale || payload.rationale || "").trim();
  return aiRationale || getDescriptionActionWhyNarrative(action, product) || getMediaActionWhyNarrative(action, product);
}

function getRecommendedActionWhyItems(action = {}, product = {}) {
  const payload = action.payload || {};
  const metrics = product.metrics || {};
  const items = [];
  const windowDays = metrics.windowDays || payload.windowDays || 90;
  const returnUnits = Number(payload.returnUnits ?? metrics.returnUnits ?? 0);
  const returnRate = Number(payload.returnRate ?? metrics.returnRate ?? 0);
  const negativeReviews = Number(payload.negativeReviewCount ?? metrics.negativeReviewCount ?? 0);
  const contentIssues = Array.isArray(payload.contentIssues) ? payload.contentIssues.length : Number(metrics.contentIssueCount || 0);
  const signalCount = Number(payload.signalsCount ?? metrics.signalCount ?? product.signalsCount ?? 0);
  const affectedVariants = Array.isArray(payload.affectedVariants) ? payload.affectedVariants.length : 0;
  const mediaWithoutAlt = Number(payload.mediaWithoutAltCount ?? metrics.mediaWithoutAltCount ?? 0);
  const mediaUpdates = Array.isArray(payload.mediaUpdates) ? payload.mediaUpdates.length : 0;

  if (returnUnits > 0 || returnRate > 0) {
    items.push({
      icon: "refresh",
      tone: returnRate >= 15 ? "risk" : "warning",
      value: returnUnits > 0 ? `${formatInteger(returnUnits)} return${returnUnits === 1 ? "" : "s"}` : `${returnRate}% return rate`,
      label: `in the last ${windowDays} days`,
    });
  }

  if (negativeReviews > 0) {
    items.push({
      icon: "star",
      tone: negativeReviews >= 5 ? "risk" : "warning",
      value: `${formatInteger(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"}`,
      label: "mention product concerns",
    });
  }

  if (contentIssues > 0) {
    items.push({
      icon: "info",
      tone: "blue",
      value: `${formatInteger(contentIssues)} content gap${contentIssues === 1 ? "" : "s"}`,
      label: "may reduce buyer clarity",
    });
  }

  if (affectedVariants > 0) {
    items.push({
      icon: "product",
      tone: "blue",
      value: `${formatInteger(affectedVariants)} affected variant${affectedVariants === 1 ? "" : "s"}`,
      label: "concentrates the diagnosis",
    });
  }

  if (mediaWithoutAlt > 0 || mediaUpdates > 0) {
    items.push({
      icon: "image",
      tone: "blue",
      value: `${formatInteger(mediaUpdates || mediaWithoutAlt)} media update${(mediaUpdates || mediaWithoutAlt) === 1 ? "" : "s"}`,
      label: "recommended for visual clarity",
    });
  }

  if (signalCount > 0) {
    items.push({
      icon: "chart-line",
      tone: "blue",
      value: `${formatInteger(signalCount)} stored signal${signalCount === 1 ? "" : "s"}`,
      label: "support this recommendation",
    });
  }

  if (!items.length) {
    items.push({
      icon: "info",
      tone: "blue",
      value: "Diagnosis evidence",
      label: action.reason || "ProductPulse found enough context to recommend this action.",
    });
  }

  return items.slice(0, 3);
}

function RecommendedActionApplyDetails({ action, application }) {
  const baseDetails = [
    { icon: "edit", label: "Will edit", value: application.shopifyField || application.target || "ProductPulse workflow", tone: "blue" },
    { icon: "alert-circle", label: "Risk", value: application.applicationRisk || "Low", tone: getActionRiskTone(application.applicationRisk) },
    { icon: "check", label: "Approval", value: application.approval || "Review required", tone: "warning" },
  ];
  const extendedDetails = getRecommendedActionExtendedDetails(action, application)
    .filter((detail) => !["Apply risk", "Shopify field", "Approval"].includes(detail.label))
    .map((detail) => ({
      icon: getActionDetailIcon(detail.label),
      label: detail.label,
      value: detail.value,
      tone: getActionDetailTone(detail),
    }));
  const details = uniqueActionDetailRows([...baseDetails, ...extendedDetails]);

  return (
    <div className="ppActionApplyDetailsGrid">
      {details.map((detail) => (
        <span className={`ppActionApplyDetail ppActionApplyDetail-${detail.tone || "neutral"}`} key={detail.label}>
          <s-icon type={detail.icon} size="small"></s-icon>
          <small>{detail.label}</small>
          <strong>{detail.value}</strong>
        </span>
      ))}
    </div>
  );
}

function uniqueActionDetailRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row.label || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return Boolean(row.value);
  });
}

function getActionDetailIcon(label = "") {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("impact") || normalized.includes("benefit")) return "target";
  if (normalized.includes("effort")) return "wand";
  if (normalized.includes("visibility")) return "view";
  if (normalized.includes("confidence") || normalized.includes("evidence")) return "chart-line";
  if (normalized.includes("reversibility")) return "refresh";
  if (normalized.includes("reason")) return "info";
  return "product";
}

function getActionDetailTone(detail = {}) {
  const tone = String(detail.tone || "").toLowerCase();
  if (tone === "red" || tone === "high") return "high";
  if (tone === "amber" || tone === "warning" || tone === "medium") return "warning";
  if (tone === "green" || tone === "low") return "low";
  return "blue";
}

function RecommendedActionAdvancedDetails({ action, application }) {
  const meta = Array.isArray(action.meta) ? action.meta : [];
  const evidence = Array.isArray(action.evidence) ? action.evidence : [];
  const hasDetails = application.trigger
    || application.expectedImpact
    || application.relatedActions?.length
    || meta.length
    || evidence.length
    || action.reason;

  if (!hasDetails) return null;

  return (
    <details className="ppActionAdvancedDetails">
      <summary>
        <span>Show details</span>
        <s-icon type="chevron-right" size="small"></s-icon>
      </summary>
      <div>
        <ProductActionRecipeDetails application={application} />
        {application.trigger && (
          <p><strong>Reason detected:</strong> {renderAnalysisText(application.trigger)}</p>
        )}
        {application.expectedImpact && (
          <p><strong>Expected benefit:</strong> {renderAnalysisText(application.expectedImpact)}</p>
        )}
        {action.reason && (
          <p><strong>Diagnosis rationale:</strong> {renderAnalysisText(action.reason)}</p>
        )}
        {application.relatedActions?.length > 0 && (
          <p><strong>Related suggestion:</strong> {renderAnalysisText(application.relatedActions.join(", "))}</p>
        )}
        {(meta.length > 0 || evidence.length > 0) && (
          <div className="ppActionMetaRow">
            {meta.map((item) => (
              <span key={`advanced-${item.label}`}>
                <s-icon type={item.icon} size="small"></s-icon>
                {item.label}
              </span>
            ))}
            {evidence.map((item) => (
              <span className="ppActionEvidencePill" key={`advanced-${item}`}>
                <s-icon type="chart-line" size="small"></s-icon>
                {renderAnalysisText(item)}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function getActionRiskTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  return "low";
}

function getRecommendedActionKind(mode = "", application = {}) {
  if (mode === "apply-product") return "applyable";
  const target = String(application.target || "").toLowerCase();
  if (
    target.includes("product description")
    || target.includes("product title")
    || target.includes("product tags")
    || target.includes("product status")
    || target.includes("media alt text")
    || target.includes("seo title")
    || target.includes("meta description")
    || target.includes("url handle")
    || target.includes("product classification")
    || target.includes("product template")
    || target.includes("product metafields")
    || target.includes("productpulse watchlist")
  ) return "applyable";
  return "investigation";
}

function getRecommendedActionHeaderPills(action = {}, application = {}, actionKind = "applyable") {
  if (actionKind === "investigation") {
    return [
      { icon: "info", label: "No Shopify change", tone: "blue" },
      { icon: "check-circle", label: "Manual verification required", tone: "medium" },
      { icon: "alert-circle", label: `${application.applicationRisk || "Low"} risk`, tone: getActionRiskTone(application.applicationRisk) },
    ];
  }

  return [
    { icon: "star", label: action.priority || "Primary next step", tone: "blue" },
    { icon: "check-circle", label: `${application.applicationRisk || "Low"} risk`, tone: getActionRiskTone(application.applicationRisk) },
    { icon: "clock", label: `${action.effort || "Low"} effort`, tone: "blue" },
  ].filter((pill) => pill.label);
}

function getRecommendedActionModalKicker(actionKind = "applyable", action = {}) {
  if (actionKind !== "investigation") return "Recommended action";
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""}`.toLowerCase();
  if (normalized.includes("source") || normalized.includes("integrity") || normalized.includes("mismatch")) return "Verification needed";
  if (normalized.includes("qa") || normalized.includes("supplier")) return "Manual follow-up";
  return "Investigation recommended";
}

function getRecommendedActionModalSubtitle(application = {}, actionKind = "applyable") {
  if (actionKind === "investigation") {
    return "Review the checklist and evidence before deciding whether this needs a Shopify change or an internal follow-up.";
  }

  const target = String(application.target || "").toLowerCase();
  if (target.includes("description") && application.insertionPosition === "prepend") {
    return "Create a note shoppers will see before they buy.";
  }
  if (target.includes("description") && application.insertionPosition === "append") {
    return "Add product guidance without replacing the current description.";
  }
  if (target.includes("description")) {
    return "Review the suggested product description update before applying it.";
  }
  if (target.includes("tag")) {
    return "Add internal Shopify tags to support product-quality workflows.";
  }
  if (target.includes("status")) {
    return "Review this high-impact operational change before updating Shopify.";
  }
  return "Review the proposed Shopify change before applying it.";
}

function RecommendedActionDetailModal({ action, product, pending = false, onClose, onEdit, onCopy, onReview, onRequestApply, onDismiss, onRestoreDismiss, onMarkReviewed, onAddInvestigationTag }) {
  if (!action) return null;
  const applied = action.appliedRecord?.status === "applied";
  const drafted = action.appliedRecord?.status === "draft";
  const application = getRecommendedActionApplication(action, product);
  const mode = action.mode || getRecommendedActionMode(action, 0);
  const actionKind = getRecommendedActionKind(mode, application);
  const headerPills = getRecommendedActionHeaderPills(action, application, actionKind);

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className={`ppRecommendedActionModal ppRecommendedActionModal-${actionKind}`} role="dialog" aria-modal="true" aria-labelledby="recommended-action-detail-title">
        <div className="ppRecommendedActionModalHeader">
          <div className="ppProductActionIcon">
            <s-icon type={action.icon} size="small"></s-icon>
            <span className="ppProductActionIconFallback">{action.iconSymbol || "AI"}</span>
          </div>
          <div>
            <span className="ppRecommendedActionModalKicker">{getRecommendedActionModalKicker(actionKind, action)}</span>
            <h2 className="ppRecommendedActionModalTitle" id="recommended-action-detail-title">{action.title}</h2>
            <span className="ppRecommendedActionModalPills">
              {headerPills.map((pill) => (
                <span className={`ppActionPriorityPill ppActionPriorityPill-${pill.tone}`} key={pill.label}>
                  <s-icon type={pill.icon} size="small"></s-icon>
                  {pill.label}
                </span>
              ))}
              {action.appliedRecord && <em>{applied ? "Applied" : drafted ? "Draft saved" : action.appliedRecord.status}</em>}
            </span>
            <p>{getRecommendedActionModalSubtitle(application, actionKind)}</p>
          </div>
          <button className="ppModalCloseButton" type="button" aria-label="Close recommended action" onClick={onClose}>
            <s-icon type="x" size="small"></s-icon>
          </button>
        </div>
        <ProductRecommendedAction
          action={action}
          product={product}
          pending={pending}
          onEdit={onEdit}
          onCopy={onCopy}
          onReview={onReview}
          onRequestApply={onRequestApply}
          onDismiss={onDismiss}
          onRestoreDismiss={onRestoreDismiss}
          onMarkReviewed={onMarkReviewed}
          onAddInvestigationTag={onAddInvestigationTag}
          actionKind={actionKind}
          showHeader={false}
        />
      </section>
    </div>
  );
}

function ProductRecommendedAction({ action, product, pending = false, onEdit, onCopy, onReview, onRequestApply, onDismiss, onRestoreDismiss, onMarkReviewed, onAddInvestigationTag, onCollapse, showHeader = true, actionKind: forcedActionKind = "" }) {
  const baseApplication = getRecommendedActionApplication(action, product);
  const [selectedVariantId, setSelectedVariantId] = useState(baseApplication.defaultVariantId || baseApplication.variantId || "");
  const [metafieldNamespace, setMetafieldNamespace] = useState(baseApplication.metafieldNamespace || "");
  const [metafieldKey, setMetafieldKey] = useState(baseApplication.metafieldKey || "");
  const defaultDescriptionChangeIds = getDefaultDescriptionChangeIds(baseApplication);
  const defaultDescriptionChangeKey = defaultDescriptionChangeIds.join("|");
  const [selectedDescriptionChangeIds, setSelectedDescriptionChangeIds] = useState(defaultDescriptionChangeIds);
  const [expandedDescriptionChangeIds, setExpandedDescriptionChangeIds] = useState({});
  const application = getRecommendedActionApplication(action, product, {
    variantId: selectedVariantId || baseApplication.defaultVariantId,
    selectedChangeIds: selectedDescriptionChangeIds,
    metafieldNamespace,
    metafieldKey,
  });
  const actionStateKey = action.id || action.title || "";
  const productStateKey = product?.slug || product?.id || "";
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [editedText, setEditedText] = useState(application.value || action.detail || "");
  const [isEditingInline, setIsEditingInline] = useState(false);
  const archivedState = action.archivedStateOverride || getArchivedActionStateFromRecordStatus(action.appliedRecord?.status);
  const applied = action.appliedRecord?.status === "applied";
  const dismissed = archivedState === "dismissed";
  const drafted = action.appliedRecord?.status === "draft";
  const mode = action.mode || (action.submit ? "submit" : "edit");
  const actionKind = forcedActionKind || getRecommendedActionKind(mode, application);
  const investigationTag = actionKind === "investigation" ? getInvestigationTagForAction(action) : "";
  const actionId = action.id || action.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const hasSelectedDescriptionChanges = !application.descriptionChanges?.length || application.selectedChangeIds?.length > 0;
  const defaultButtonText = applied
    ? "Applied"
    : drafted
      ? "Draft saved"
      : pending
        ? "Working..."
        : mode === "apply-product"
          ? application.applyLabel
          : action.action;
  const buttonText = !showHeader && actionKind === "applyable" && mode === "apply-product" && !applied && !drafted && !pending
    ? (application.useApplyLabelInModal ? application.applyLabel : "Apply change")
    : !showHeader && actionKind === "investigation" && !applied && !drafted && !pending
      ? getInvestigationPrimaryActionLabel(action, mode)
      : defaultButtonText;
  const effectiveApplication = application.descriptionChanges?.length
    ? { ...application, expandedDescriptionChangeIds }
    : application;
  const detailText = String(effectiveApplication.editable ? editedText : action.detail || "");
  const hasLongDetail = detailText.length > 300 || detailText.split(/\s+/).length > 70;
  const placeholderApplication = isEditingInline ? { ...effectiveApplication, descriptionChanges: [] } : effectiveApplication;
  const unresolvedPlaceholders = getActionApplicationPlaceholders(placeholderApplication, detailText);
  const metafieldMissing = effectiveApplication.isMetafield && (!String(effectiveApplication.metafieldNamespace || "").trim() || !String(effectiveApplication.metafieldKey || "").trim());
  const disabled = pending || applied || !hasSelectedDescriptionChanges || metafieldMissing || (actionKind === "applyable" && unresolvedPlaceholders.length > 0);
  const actionButton = getRecommendedActionButton(action, mode, buttonText, disabled, {
    actionId,
    application: effectiveApplication,
    editedText,
    product,
    onCopy,
    onEdit,
    onRequestApply,
    onReview,
    actionKind,
  });

  useEffect(() => {
    setSelectedVariantId(baseApplication.defaultVariantId || baseApplication.variantId || "");
    setMetafieldNamespace(baseApplication.metafieldNamespace || "");
    setMetafieldKey(baseApplication.metafieldKey || "");
    setSelectedDescriptionChangeIds(defaultDescriptionChangeKey ? defaultDescriptionChangeKey.split("|") : []);
    setExpandedDescriptionChangeIds({});
    setIsEditingInline(false);
    setDetailExpanded(false);
  }, [actionStateKey, productStateKey, baseApplication.defaultVariantId, baseApplication.variantId, baseApplication.metafieldNamespace, baseApplication.metafieldKey, defaultDescriptionChangeKey]);

  useEffect(() => {
    setEditedText(application.value || action.detail || "");
    setIsEditingInline(false);
  }, [application.value, action.detail]);

  const actionBody = (
    <RecommendedActionReviewBody
      action={action}
      actionKind={actionKind}
      application={effectiveApplication}
      product={product}
      editedText={editedText}
      detailExpanded={detailExpanded}
      hasLongDetail={hasLongDetail}
      isEditingInline={isEditingInline}
      unresolvedPlaceholders={unresolvedPlaceholders}
      onDetailExpandedChange={setDetailExpanded}
      onDescriptionChangeExpandedToggle={(changeId) => setExpandedDescriptionChangeIds((current) => ({ ...current, [changeId]: !current[changeId] }))}
      onDescriptionChangeSelectedChange={(changeId, selected) => setSelectedDescriptionChangeIds((current) => updateSelectedDescriptionChangeIds(current, changeId, selected, baseApplication))}
      onEditedTextChange={setEditedText}
      onEditText={() => setIsEditingInline(true)}
      onMetafieldNamespaceChange={setMetafieldNamespace}
      onMetafieldKeyChange={setMetafieldKey}
      onSelectedVariantChange={setSelectedVariantId}
    />
  );

  const actionCta = (
    <div className={`ppProductActionCta ${showHeader ? "" : "ppRecommendedActionModalFooter"}`.trim()}>
      <button
        className={`ppActionDismissButton ${dismissed ? "isRestore" : ""}`.trim()}
        type="button"
        onClick={() => dismissed ? onRestoreDismiss?.(action) : onDismiss(action)}
        disabled={pending || applied}
      >
        <s-icon type={dismissed ? "refresh" : "x"} size="small"></s-icon>
        <span>{dismissed ? "Undo dismiss" : "Dismiss"}</span>
      </button>
      {!showHeader && actionKind === "applyable" && application.editable && (
        <button className="ppActionEditFooterButton" type="button" onClick={() => setIsEditingInline(true)} disabled={pending || applied}>
          <s-icon type="edit" size="small"></s-icon>
          <span>Edit text</span>
        </button>
      )}
      {!showHeader && actionKind === "investigation" && (
        <button
          className="ppActionEditFooterButton"
          type="button"
          onClick={() => investigationTag ? onAddInvestigationTag?.(action) : onMarkReviewed?.(action)}
          disabled={pending || applied}
        >
          <s-icon type={investigationTag ? "tag" : "check"} size="small"></s-icon>
          <span>{investigationTag ? "Add QA tag" : "Mark reviewed"}</span>
        </button>
      )}
      {!showHeader && application.externalEditUrl && (
        <a className="ppActionEditFooterButton" href={application.externalEditUrl} target="_blank" rel="noreferrer">
          <s-icon type="external" size="small"></s-icon>
          <span>{application.externalEditLabel || "Edit in Shopify"}</span>
        </a>
      )}
      {actionButton}
    </div>
  );

  if (!showHeader) {
    return (
      <>
        <article className={`ppProductActionItem ${applied || drafted ? "isApplied" : ""} isModalContent`.trim()}>
          {actionBody}
        </article>
        {actionCta}
      </>
    );
  }

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
        {onCollapse && (
          <button className="ppProductActionCollapseButton" type="button" aria-label={`Collapse ${action.title}`} onClick={() => onCollapse(action)}>
            <s-icon type="chevron-up" size="small"></s-icon>
          </button>
        )}
      </div>
      {actionBody}
      {actionCta}
    </article>
  );
}

function getDefaultDescriptionChangeIds(application = {}) {
  return Array.isArray(application.descriptionChanges)
    ? application.descriptionChanges.map((change) => change.id).filter(Boolean)
    : [];
}

function updateSelectedDescriptionChangeIds(current = [], changeId = "", selected = false, application = {}) {
  const availableIds = getDefaultDescriptionChangeIds(application);
  const availableIdSet = new Set(availableIds);
  if (!availableIdSet.has(changeId)) return current;
  const selectedSet = new Set(current.filter((id) => availableIdSet.has(id)));
  if (selected) {
    selectedSet.add(changeId);
  } else {
    selectedSet.delete(changeId);
  }
  return availableIds.filter((id) => selectedSet.has(id));
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
  const { actionId, application, editedText, product, onCopy, onEdit, onRequestApply, onReview, actionKind } = context;
  const content = (
    <>
      <span>{buttonText}</span>
      <s-icon type={disabled ? "check" : "chevron-right"} size="small"></s-icon>
    </>
  );

  if (actionKind === "investigation" && mode !== "copy") {
    return (
      <button className="ppActionCtaButton" type="button" onClick={() => onReview(action)} disabled={disabled}>
        {content}
      </button>
    );
  }

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
  onOpenJudgeMe,
  onOpenChatMe,
  onOpenCsv,
  onLocalActiveChange,
  persistConnectState = false,
  pendingSourceKey = "",
}) {
  const status = locked ? "Always on" : category.connected ? "Connected" : "Needs source";
  const statusTone = locked || category.connected ? "success" : "warning";

  return (
    <s-section padding="none">
      <article className="ppConnectCategory">
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
            ) : null}
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
  const connectedWeight = categories.reduce((total, category) => (
    category.connected ? total + category.weight : total
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
          <p><strong>{missingWeight}%</strong> still missing</p>
          <small>{activeWeight}% active source weight from available customer-signal categories.</small>
        </div>
      </div>

      <div className="ppConnectCoverageLegend">
        {categories.map((category) => {
          const complete = category.connected;
          return (
            <div className={complete ? "isComplete" : ""} key={category.id}>
              <span>
                <i className={`ppConnectLegendDot ppConnectLegendDot-${category.id}`} />
                {category.title}
              </span>
              <strong>{category.weight}%</strong>
              <small>{category.connected ? "Connected" : "Missing"}</small>
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
    missing: "var(--pp-slate-200)",
  };
  const stops = categories.map((category) => {
    const start = cursor;
    const end = cursor + category.weight;
    cursor = end;
    const color = category.connected
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
  if (normalizedTitle.includes("margin at risk over time")) {
    return {
      title: "Margin at risk over time",
      body: "The top KPI is current total margin at risk. This chart reconstructs the shape over time, so the trend-weighted margin can be different.",
      items: [
        "Trend-weighted margin multiplies each product's margin exposure by its stored risk trend at each point.",
        "Products needing attention count products whose trend lands in medium or high risk.",
        "High, medium and low lines show how products move between operational risk buckets.",
      ],
    };
  }
  if (normalizedTitle.includes("issue impact")) {
    return {
      title: "Issue impact by type",
      body: "Ranks issue clusters by business impact so the largest product-quality problems are not hidden behind raw signal counts.",
      items: [
        "Products affected counts unique products per issue type.",
        "Margin at risk is allocated across the relevant issue clusters on each product.",
        "Average confidence summarizes the stored diagnosis confidence behind that issue type.",
      ],
    };
  }
  if (normalizedTitle.includes("impact breakdown")) {
    return {
      title: "Impact breakdown",
      body: "Slices estimated margin and revenue exposure by Shopify dimensions and evidence sources.",
      items: [
        "Collection and vendor views help identify where quality issues concentrate operationally.",
        "Source view shows which evidence channels are currently driving exposure.",
        "Average product risk helps separate high-value exposure from low-risk catalog volume.",
      ],
    };
  }
  if (normalizedTitle.includes("action performance")) {
    return {
      title: "Action performance",
      body: "Tracks how recommended actions move through the product-quality workflow.",
      items: [
        "Suggested, pending, applied and dismissed are based on stored action records.",
        "Fix effectiveness stays in a waiting state until enough post-fix data is available.",
      ],
    };
  }
  if (normalizedTitle.includes("catalog coverage")) {
    return {
      title: "Catalog coverage",
      body: "Explains how much of the stored product set is represented by QuickScan and full diagnosis data.",
      items: [
        "Full diagnoses have AI-generated product-level findings.",
        "QuickScan only products have deterministic lightweight scan data.",
        "Missing reviews or returns rows identify data coverage gaps that affect confidence.",
      ],
    };
  }
  if (normalizedTitle.includes("evidence source coverage")) {
    return {
      title: "Evidence source coverage",
      body: "Shows which evidence sources are connected, partial or missing and how much they contribute to the analytics set.",
      items: [
        "Percentages are based on extracted evidence units, not source importance.",
        "Partial means the source exists for some products but not the full stored catalog.",
      ],
    };
  }
  if (normalizedTitle.includes("top products at risk")) {
    return {
      title: "Top products at risk",
      body: "Ranks stored products by operational priority so teams can move from analytics into product diagnosis.",
      items: [
        "Priority uses product risk, diagnosis confidence and normalized financial exposure.",
        "Each row links directly to the product diagnosis page.",
      ],
    };
  }
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
      body: "Plots products by product risk and estimated margin exposure. Bubble size uses revenue at risk so high-revenue products remain visible even when margin exposure is lower.",
      items: [
        "X-axis: product risk, starting slightly below the lowest plotted product and ending at 100.",
        "Y-axis: estimated margin at risk for that product.",
        "Bubble size: estimated revenue at risk.",
        "Quadrants: Fix now, Monitor, Review later and Low priority.",
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

function AnalyticsTrendChart({ chart, ariaLabel = "Analytics trend chart" }) {
  const series = chart?.series || [];
  const labels = chart?.labels || [];
  const summary = chart?.summary || null;
  const safeSeries = series.length ? series : [{ label: "No trend data", color: "blue", values: [0, 0, 0, 0, 0, 0, 0], displayValue: "0", detail: "Run scans to build trend data." }];
  const layout = {
    left: 62,
    top: 24,
    width: 812,
    height: 236,
    labelY: 316,
    viewBoxWidth: 900,
    viewBoxHeight: 340,
  };
  const yTicks = getAnalyticsTrendYAxisTicks(safeSeries[0]?.values || [], layout);
  const [activeLegend, setActiveLegend] = useState(null);

  return (
    <div className="ppAnalyticsTrendChart">
      <div className="ppAnalyticsTrendMain">
        <svg className="ppRiskSignalsSvg ppAnalyticsImpactTrendSvg" viewBox={`0 0 ${layout.viewBoxWidth} ${layout.viewBoxHeight}`} role="img" aria-label={ariaLabel}>
          {yTicks.map((tick, index) => (
            <g key={`${tick.label}-${index}`}>
              <line className="ppChartGridLine" x1={layout.left} y1={tick.y} x2={layout.left + layout.width} y2={tick.y} />
              <text className="ppChartAxisText ppChartAxisText-y" x="10" y={tick.y + 4}>{tick.label}</text>
            </g>
          ))}
          <line className="ppChartAxisLine" x1={layout.left} y1={layout.top} x2={layout.left} y2={layout.top + layout.height} />
          <text className="ppChartAxisTitle" x="10" y="18">Margin</text>
          {safeSeries.map((row) => {
            const points = getAnalyticsLinePointList(row.values, layout);
            return (
              <path
                key={row.label}
                className={`ppRiskLine ppRiskLine-${row.color || "blue"}`}
                d={buildSmoothSvgPath(points)}
              />
            );
          })}
          {labels.map((label, index) => label && (
            <text className="ppChartAxisText" key={`${label}-${index}`} x={layout.left + index * (layout.width / Math.max(labels.length - 1, 1))} y={layout.labelY}>{label}</text>
          ))}
        </svg>
        <div className="ppAnalyticsTrendLegend" aria-label="Trend line legend">
          {safeSeries.map((row) => (
            <button
              key={`legend-${row.label}`}
              type="button"
              className="ppAnalyticsTrendLegendItem"
              onMouseEnter={() => setActiveLegend(row)}
              onFocus={() => setActiveLegend(row)}
              onMouseLeave={() => setActiveLegend(null)}
              onBlur={() => setActiveLegend(null)}
            >
              <i className={`ppDot-${row.color || "blue"}`} aria-hidden="true" />
              <span>{row.label}</span>
              <s-icon type="info" size="small"></s-icon>
            </button>
          ))}
          {activeLegend && (
            <div className="ppAnalyticsTrendLegendPopover" role="tooltip">
              <strong>{activeLegend.label}</strong>
              <span>{activeLegend.detail || "This line is calculated from stored ProductPulse analytics values."}</span>
              <small>Current value: {activeLegend.displayValue || formatInteger((activeLegend.values || []).at(-1) || 0)}</small>
            </div>
          )}
        </div>
      </div>
      <div className="ppAnalyticsTrendSide">
        {summary && (
          <div className="ppAnalyticsTrendContext" aria-label="Margin at risk comparison">
            <span><b>Current total</b>{summary.currentTotalLabel || "$0"}</span>
            <span><b>Trend-weighted now</b>{summary.trendWeightedLabel || "$0"}</span>
            <small>{summary.detail}</small>
          </div>
        )}
        <div className="ppAnalyticsTrendSummary">
          {safeSeries.slice(0, 5).map((row) => (
            <article key={row.label} className={`ppAnalyticsTrendSummaryCard ppAnalyticsTrendSummaryCard-${row.color || "blue"}`}>
              <span><i className={`ppDot-${row.color || "blue"}`} />{row.label}</span>
              <strong>{row.displayValue || formatInteger((row.values || []).at(-1) || 0)}</strong>
              {row.detail && <small>{row.detail}</small>}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function IssueImpactTable({ rows }) {
  const safeRows = rows?.length ? rows : [];
  return (
    <div className="ppAnalyticsTableWrap">
      <table className="ppAnalyticsTable">
        <thead>
          <tr>
            <th>Issue type</th>
            <th>Products affected</th>
            <th>Margin at risk</th>
            <th>Signals</th>
            <th>Avg confidence</th>
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row) => (
            <tr key={row.label}>
              <td>
                <strong>{row.label}</strong>
              </td>
              <td>{row.productsAffectedLabel || formatInteger(row.productsAffected || 0)}</td>
              <td>{row.marginAtRiskLabel || formatMoney(row.marginAtRisk || 0)}</td>
              <td>{row.signalCountLabel || formatInteger(row.signalCount || 0)}</td>
              <td>{row.avgConfidenceLabel || formatPercent(row.avgConfidence || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsBreakdownTabs({ filters, selectedKey, onChange }) {
  if (!filters?.length) return null;
  return (
    <div className="ppAnalyticsSegmentedControl" role="tablist" aria-label="Impact breakdown dimension">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          role="tab"
          aria-selected={filter.key === selectedKey}
          className={filter.key === selectedKey ? "isActive" : ""}
          onClick={() => onChange(filter.key)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function ImpactBreakdownPanel({ breakdown }) {
  const [expanded, setExpanded] = useState(false);
  const rows = breakdown?.rows?.length ? breakdown.rows : [];
  const visibleRows = expanded ? rows : rows.slice(0, 6);
  const hiddenCount = Math.max(rows.length - visibleRows.length, 0);
  const max = Math.max(...rows.map((row) => Number(row.marginAtRisk || row.value || 0)), 1);

  useEffect(() => {
    setExpanded(false);
  }, [breakdown?.key]);

  return (
    <div className="ppImpactBreakdownList">
      {visibleRows.map((row) => {
        const pct = Math.max(5, Math.round((Number(row.marginAtRisk || row.value || 0) / max) * 100));
        return (
          <article key={`${breakdown?.key || "breakdown"}-${row.label}`}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.productsLabel || `${formatInteger(row.productsAffected || 0)} products`} · Avg risk {formatInteger(row.avgRisk || 0)}/100</span>
            </div>
            <div className="ppImpactBreakdownBar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div>
              <strong>{row.marginAtRiskLabel || formatMoney(row.marginAtRisk || 0)}</strong>
              <span>{row.revenueAtRiskLabel || formatMoney(row.revenueAtRisk || 0)} revenue</span>
            </div>
          </article>
        );
      })}
      {rows.length > 6 && (
        <button className="ppImpactBreakdownMore" type="button" onClick={() => setExpanded((current) => !current)}>
          <span>{expanded ? "View less" : `View more${hiddenCount ? ` (${hiddenCount})` : ""}`}</span>
          <s-icon type={expanded ? "chevron-up" : "chevron-down"} size="small"></s-icon>
        </button>
      )}
    </div>
  );
}

function ActionPerformancePanel({ performance }) {
  const rows = performance?.rows || [];
  const effectiveness = performance?.effectiveness || [];
  return (
    <div className="ppActionPerformance">
      <div className="ppActionPerformanceGrid">
        {rows.map((row) => (
          <article key={row.label}>
            <DashboardIcon type={row.icon || "wand"} tone={row.tone || "blue"} size="small" />
            <div>
              <span>{row.label}</span>
              <strong>{row.valueLabel || formatInteger(row.value || 0)}</strong>
              <small>{row.detail}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="ppFixEffectiveness">
        <h3>Fix effectiveness</h3>
        {effectiveness.map((metric) => (
          <p key={metric.label}>
            <strong>{metric.label}</strong>
            <span>{metric.value}</span>
            <small>{metric.detail}</small>
          </p>
        ))}
      </div>
    </div>
  );
}

function CatalogCoveragePanel({ coverage }) {
  const rows = coverage?.rows || [];
  return (
    <div className="ppCatalogCoverage">
      <div className="ppCatalogCoverageHero">
        <strong>{coverage?.analyzedLabel || "0 stored products analyzed"}</strong>
        <span>Analytics only reflects products stored by QuickScan or manual diagnosis.</span>
      </div>
      <div className="ppCatalogCoverageRows">
        {rows.map((row) => {
          const pct = Math.max(0, Math.min(100, Math.round((Number(row.value || 0) / Math.max(Number(row.total || 1), 1)) * 100)));
          return (
            <div key={row.label} className={`ppCatalogCoverageRow ppCatalogCoverageRow-${row.tone || "blue"}`}>
              <div>
                <span>{row.label}</span>
                <strong>{row.valueLabel || formatInteger(row.value || 0)}</strong>
              </div>
              <span className="ppCatalogCoverageTrack" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceSourceCoveragePanel({ rows }) {
  const safeRows = rows?.length ? rows : [];
  return (
    <div className="ppEvidenceCoverageRows">
      {safeRows.map((row) => (
        <article key={row.label}>
          <DashboardIcon type={row.icon || "info"} tone={row.stateTone === "green" ? "green" : row.stateTone === "orange" ? "orange" : "blue"} size="small" />
          <div>
            <div>
              <strong>{row.label}</strong>
              <span className={`ppAnalyticsStatusPill ppAnalyticsStatusPill-${row.stateTone || "blue"}`}>{row.state}</span>
            </div>
            <p>{row.detail}</p>
            <span className="ppEvidenceCoverageMeta">{row.percentLabel} contribution · {row.countLabel} evidence units · {row.productsLabel}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function TopProductsAtRiskTable({ rows }) {
  const safeRows = rows?.length ? rows : [];
  return (
    <div className="ppTopProductsTableWrap">
      <table className="ppTopProductsTable">
        <thead>
          <tr>
            <th>Product</th>
            <th>Risk</th>
            <th>Margin at risk</th>
            <th>Revenue at risk</th>
            <th>Main issue</th>
            <th>Confidence</th>
            <th>Recommended action</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={row.href}>{row.title}</Link>
              </td>
              <td>
                <span className={`ppAnalyticsRiskPill ppAnalyticsRiskPill-${row.riskTone || "green"}`}>{row.riskLabel} {formatInteger(row.riskScore)}</span>
              </td>
              <td>{row.marginAtRiskLabel || formatMoney(row.marginAtRisk || 0)}</td>
              <td>{row.revenueAtRiskLabel || formatMoney(row.revenueAtRisk || 0)}</td>
              <td>{row.mainIssue}</td>
              <td>{row.confidenceLabel || formatPercent(row.confidence || 0)}</td>
              <td>{row.recommendedAction}</td>
              <td>
                <span className={`ppAnalyticsStatusPill ppAnalyticsStatusPill-${row.statusTone || "blue"}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskRevenueBubbleChart({ bubbles }) {
  const safeBubbles = bubbles?.length ? bubbles : [];
  const maxImpact = Math.max(...safeBubbles.map((bubble) => Number(bubble.impact || 0)), 0);
  const yAxisMax = getRiskBubbleAxisMax(maxImpact);
  const xAxis = getRiskBubbleXAxis(safeBubbles);
  const yTicks = getRiskBubbleYAxisTicks(yAxisMax);
  const quadrantRiskPosition = getRiskBubbleXPosition(75, xAxis);
  const [activeBubble, setActiveBubble] = useState(null);
  const showBubble = (event, bubble) => {
    setActiveBubble({
      bubble,
      position: getRiskBubblePopoverPosition(event.currentTarget),
    });
  };

  return (
    <div className="ppRiskRevenueWrap">
      <div className="ppBubbleChart" role="group" aria-label="Product risk compared with revenue impact">
        <div className="ppBubbleYTicks" aria-hidden="true">
          {yTicks.map((tick) => (
            <span key={tick.value} className="ppBubbleYTick" style={{ bottom: `${tick.position}%` }}>{tick.label}</span>
          ))}
        </div>
        <div className="ppBubblePlot">
          <span className="ppBubbleQuadrant ppBubbleQuadrant-monitor">Monitor</span>
          <span className="ppBubbleQuadrant ppBubbleQuadrant-fix">Fix now</span>
          <span className="ppBubbleQuadrant ppBubbleQuadrant-low">Low priority</span>
          <span className="ppBubbleQuadrant ppBubbleQuadrant-review">Review later</span>
          <span className="ppBubbleThreshold ppBubbleThreshold-x" style={{ left: `${quadrantRiskPosition}%` }} />
          <span className="ppBubbleThreshold ppBubbleThreshold-y" style={{ bottom: "50%" }} />
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
                aria-label={`${bubble.label}: open product detail. Risk ${bubble.riskScore}, margin at risk ${formatMoney(bubble.impact || 0)}, revenue at risk ${formatMoney(bubble.revenueAtRisk || 0)}`}
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
        <span className="ppBubbleAxis ppBubbleAxis-x">Product risk</span>
      </div>
      {activeBubble && (
        <RiskBubbleFloatingPopover bubble={activeBubble.bubble} position={activeBubble.position} />
      )}
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
      <span><b>{bubble.riskLabel || "Risk"}</b> product risk: {bubble.riskScore}/100</span>
      <span><b>Margin at risk:</b> {formatMoney(bubble.impact || 0)}</span>
      <span><b>Revenue at risk:</b> {formatMoney(bubble.revenueAtRisk || 0)}</span>
      <span><b>Quadrant:</b> {bubble.quadrant || "Priority review"}</span>
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
  const [showFullCalculation, setShowFullCalculation] = useState(false);
  const calculation = businessImpact?.calculation || buildBusinessImpactModalFallbackCalculation(metrics, windowLabel);
  const inputRows = calculation.inputs || [];
  const breakdownRows = calculation.currentBreakdown || [];

  return (
    <div className="ppAnalysisConfirmOverlay" role="presentation">
      <section className="ppBusinessImpactModal" role="dialog" aria-modal="true" aria-labelledby="business-impact-title">
        <div className="ppBusinessImpactModalHero">
          <span className="ppAnalysisConfirmIcon" aria-hidden="true">
            <s-icon type="cash-dollar" size="small"></s-icon>
          </span>
          <div>
            <div className="ppBusinessImpactModalBadges" aria-label="Business impact model attributes">
              {[calculation.windowLabel || windowLabel, "Stored signals", "Projection model", "Not accounting total"].map((badge) => (
                <span key={badge}>{badge}</span>
              ))}
            </div>
            <h2 id="business-impact-title">How ProductPulse calculates business impact</h2>
            <p>
              Business impact estimates the next 90-day exposure from stored product risk signals, returns, refunds, reviews, margin data and recommended actions.
            </p>
          </div>
        </div>

        <div className="ppImpactCalculationModel">
          <span>Calculation model</span>
          {(calculation.formulas || []).map((formula) => (
            <p key={formula.label}>
              <strong>{formula.label}</strong>
              <span>= {formula.expression}</span>
            </p>
          ))}
        </div>

        <div className="ppImpactBreakdownModalSection">
          <h3>Current breakdown</h3>
          <div className="ppImpactBreakdownModalGrid">
            {breakdownRows.map((row) => (
              <article key={row.label}>
                <header>
                  <span>{row.label}</span>
                  <strong>{row.valueLabel || row.value || "0"}</strong>
                </header>
                <div>
                  {(row.components || []).map((component) => (
                    <p key={`${row.label}-${component.label}`}>
                      <span>{component.label}</span>
                      <strong>{component.valueLabel || component.value || "0"}</strong>
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="ppImpactInputsSection">
          <div>
            <h3>Inputs used</h3>
            <p>Each input is marked as available, estimated, missing or not used for this current calculation.</p>
          </div>
          <div className="ppImpactInputGrid">
            {inputRows.map((input) => (
              <article key={input.label}>
                <div>
                  <strong>{input.label}</strong>
                  <small>{input.detail}</small>
                </div>
                <span className={`ppImpactInputStatus ppImpactInputStatus-${input.tone || "blue"}`}>{input.status}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="ppImpactConfidenceSection">
          <div>
            <span>Calculation confidence</span>
            <strong>{calculation.confidence?.label || "Medium"} · {formatInteger(calculation.confidence?.score || 0)}/100</strong>
            <p>
              Confidence is higher when product orders, returns, reviews and margin data are available. If margin data is missing, ProductPulse uses a conservative margin estimate.
            </p>
          </div>
          <ul>
            {(calculation.confidence?.drivers || []).map((driver) => (
              <li key={driver}>{driver}</li>
            ))}
          </ul>
        </div>

        <div className="ppImpactInterpretationSection">
          <div>
            <h3>How to interpret this</h3>
            <p>
              This estimate is designed for prioritization. It shows where product issues may create financial exposure over the next 90 days. It is not a replacement for accounting, payout, tax or profit reporting.
            </p>
          </div>
          <div>
            <h3>Assumptions</h3>
            <ul>
              {(calculation.assumptions || []).map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        </div>

        {showFullCalculation && (
          <div className="ppImpactFullCalculation">
            <h3>Full calculation detail</h3>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Risk</th>
                  <th>Confidence</th>
                  <th>Revenue at risk</th>
                  <th>Margin at risk</th>
                  <th>Refund value</th>
                  <th>Returns</th>
                  <th>Calculated</th>
                </tr>
              </thead>
              <tbody>
                {(calculation.productRows || []).map((row) => (
                  <tr key={row.id || row.title}>
                    <td>{row.title}</td>
                    <td>{row.riskLabel}</td>
                    <td>{row.confidenceLabel}</td>
                    <td>{row.revenueAtRiskLabel}</td>
                    <td>{row.marginAtRiskLabel}</td>
                    <td>{row.refundAmountLabel}</td>
                    <td>{row.returnUnitsLabel}</td>
                    <td>{row.calculatedAtLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!(calculation.productRows || []).length && (
              <p>No product-level calculation rows are available yet. Run QuickScan or product diagnostics to populate this table.</p>
            )}
          </div>
        )}

        <div className="ppImpactAuditNote">
          <span>Audit note</span>
          <p>
            ProductPulse stores the calculation components separately from product risk. Risk explains severity, confidence explains reliability, and business impact estimates exposure. Those numbers should be reviewed together before prioritizing operational work.
          </p>
        </div>

        <div className="ppAnalysisConfirmFooter">
          <button className="ppSecondaryButton" type="button" onClick={() => setShowFullCalculation((value) => !value)}>
            <s-icon type="chart-line" size="small"></s-icon>
            {showFullCalculation ? "Hide full calculation" : "View full calculation"}
          </button>
          <button className="ppPrimaryButton" type="button" onClick={onClose}>
            <s-icon type="check" size="small"></s-icon>
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

function buildBusinessImpactModalFallbackCalculation(metrics = [], windowLabel = "Last 90 days") {
  const findMetric = (keyword) => metrics.find((metric) => String(metric.label || "").toLowerCase().includes(keyword));
  const revenueMetric = findMetric("revenue");
  const marginMetric = findMetric("margin");
  const returnsMetric = findMetric("returns");
  const actionsMetric = findMetric("actions");
  return {
    windowLabel,
    formulas: [
      { label: "Revenue at risk", expression: "observed refund value + projected return exposure + review conversion drag" },
      { label: "Margin at risk", expression: "projected return margin loss + refund margin loss + estimated operational exposure" },
      { label: "Potential returns", expression: "projected units exposed x estimated return probability" },
      { label: "Recommended actions", expression: "open actions + applied actions + dismissed actions" },
    ],
    currentBreakdown: [
      { label: "Revenue at risk", valueLabel: revenueMetric?.value || "$0", components: [{ label: "Current displayed estimate", valueLabel: revenueMetric?.detail || "No revenue exposure stored yet" }] },
      { label: "Margin at risk", valueLabel: marginMetric?.value || "$0", components: [{ label: "Current displayed estimate", valueLabel: marginMetric?.detail || "No margin exposure stored yet" }] },
      { label: "Potential returns", valueLabel: returnsMetric?.value || "~0", components: [{ label: "Current displayed estimate", valueLabel: returnsMetric?.detail || "No return projection stored yet" }] },
      { label: "Recommended actions", valueLabel: actionsMetric?.value || "0", components: [{ label: "Current displayed estimate", valueLabel: actionsMetric?.detail || "No action status stored yet" }] },
    ],
    inputs: [],
    confidence: { label: "Low", score: 0, drivers: ["Detailed calculation inputs are not available in this payload."] },
    assumptions: ["Projection window: current analytics window", "Uses stored diagnosis signals when available."],
    productRows: [],
  };
}

function getAnalyticsTrendYAxisTicks(values = [], layout = {}) {
  const cleanValues = (Array.isArray(values) && values.length ? values : [0])
    .map((value) => Math.max(0, Number(value || 0)))
    .filter(Number.isFinite);
  const max = Math.max(...cleanValues, 1);
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const top = Number(layout.top ?? 28);
  const height = Number(layout.height ?? 160);
  return ticks.map((ratio) => ({
    y: top + (1 - ratio) * height,
    label: formatCompactMoney(max * ratio),
  }));
}

function getAnalyticsLinePointList(values = [], layout = {}) {
  const cleanValues = (Array.isArray(values) && values.length ? values : [0, 0, 0, 0, 0, 0, 0])
    .map((value) => Math.max(0, Number(value || 0)));
  const max = Math.max(...cleanValues, 1);
  const min = Math.min(...cleanValues);
  const range = Math.max(max - min, 1);
  const left = Number(layout.left ?? 50);
  const top = Number(layout.top ?? 28);
  const width = Number(layout.width ?? 570);
  const height = Number(layout.height ?? 160);
  return cleanValues.map((value, index) => {
    const x = left + index * (width / Math.max(cleanValues.length - 1, 1));
    const y = top + height - ((value - min) / range) * height;
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
    };
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "$0";
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  if (absolute < 1000) return `${sign}$${formatCompactWholeNumber(absolute)}`;

  const unit = absolute >= 1_000_000_000
    ? { divisor: 1_000_000_000, suffix: "B" }
    : absolute >= 1_000_000
      ? { divisor: 1_000_000, suffix: "M" }
      : { divisor: 1000, suffix: "K" };
  const scaled = absolute / unit.divisor;
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${sign}$${String(rounded).replace(/\.0$/, "")}${unit.suffix}`;
}

function formatCompactWholeNumber(value) {
  return String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
}

function formatSignedPercent(value) {
  const number = Number(value || 0);
  const formatted = formatPercent(Math.abs(number));
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDecimal(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number(value || 0));
}

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, Number(value || 0)));
}
