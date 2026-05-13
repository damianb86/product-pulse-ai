import { useEffect, useState } from "react";
import { Form, Link, useNavigation, useRevalidator, useSubmit } from "react-router";
import {
  buildConnectViewData,
  chatMeConnectionLinks,
  judgeMeConnectionLinks,
  setLocalCategoryIgnored,
  upsertLocalConnectionRecord,
} from "../lib/product-pulse-connect";

export function DashboardScreen({ data, actionData }) {
  const diagnosisHref = `/app/products/${data.startHere.slug}`;

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
              <div className="ppStartProduct">
                <ProductArt variant="shirt" label="Linen Shirt" size="large" />
                <div className="ppStartCopy">
                  <span>Recommended next product to analyze</span>
                  <h3>Linen Shirt</h3>
                  <div className="ppBadgeRow">
                    <InlineBadge tone="critical" icon="alert-circle">High risk</InlineBadge>
                    <InlineBadge tone="warning" icon="person">Fit issue suspected</InlineBadge>
                  </div>
                  <p>
                    This product shows a high return rate driven by sizing problems and inconsistent
                    fit across reviews.
                  </p>
                </div>
              </div>

              <div className="ppEvidenceGlance">
                <h3>Evidence at a glance</h3>
                <div className="ppEvidenceMetrics">
                  {evidenceMetrics.map((metric) => (
                    <EvidenceMetric key={metric.label} metric={metric} />
                  ))}
                </div>
              </div>

              <div className="ppStartActionPanel">
                <Link className="ppAnalyzeLinkButton ppAnalyzeLinkButton-primary" to={diagnosisHref}>
                  <s-icon type="wand" size="small"></s-icon>
                  <span>Analyze this product</span>
                </Link>
                <span>Uses 1 AI credit</span>
              </div>
            </div>
          </div>
        </s-section>

        <s-section padding="none">
          <div className="ppDashboardSectionHeader">
            <h2>Products to review</h2>
            <s-button href="/app/products" variant="secondary">View all products</s-button>
          </div>
          <div className="ppDashboardTableWrap">
            <table className="ppDashboardTable" data-testid="products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>
                    Risk <s-icon type="sort" size="small"></s-icon>
                  </th>
                  <th>Signals</th>
                  <th>Main suspected issue</th>
                  <th>Sources</th>
                  <th>Last scanned</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reviewProducts.map((product) => (
                  <tr key={product.title}>
                    <td>
                      <div className="ppReviewProduct">
                        <ProductArt variant={product.variant} label={product.title} />
                        <span>{product.title}</span>
                      </div>
                    </td>
                    <td>
                      <s-badge tone={product.riskTone}>{product.risk}</s-badge>
                    </td>
                    <td>
                      <div className="ppSignalCell">
                        <SignalBars tone={product.signalTone} values={product.signalBars} />
                        <span>{product.signals}</span>
                      </div>
                    </td>
                    <td>{product.issue}</td>
                    <td>
                      <SourceIconGroup count={product.sourceOverflow} />
                    </td>
                    <td>{product.lastScanned}</td>
                    <td>
                      <div className="ppTableAction">
                        <Link className="ppAnalyzeLinkButton" to={product.href}>
                          <s-icon type="wand" size="small"></s-icon>
                          <span>Analyze</span>
                        </Link>
                        <button className="ppIconButton" type="button" aria-label={`More actions for ${product.title}`}>
                          <s-icon type="menu-horizontal" size="small"></s-icon>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>

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
              <s-link href="/app/analyses">View all recommended fixes</s-link>
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppNextStepPanel">
              <DashboardIcon type="wand" tone="purple" />
              <div>
                <h2>Next step</h2>
                <h3>Choose a product to analyze</h3>
                <p>
                  Select a product from the table above and run an AI analysis to uncover root causes
                  and fix issues.
                </p>
                <s-button href={diagnosisHref} variant="secondary">Learn how it works</s-button>
              </div>
            </div>
          </s-section>
        </div>
      </ScreenShell>
    </FullWidthPage>
  );
}

const dashboardKpis = [
  {
    label: "Products needing attention",
    value: "18",
    trend: "12% vs last 7 days",
    icon: "product",
    tone: "blue",
  },
  {
    label: "High-risk products",
    value: "6",
    trend: "20% vs last 7 days",
    icon: "shield-check-mark",
    tone: "red",
  },
  {
    label: "Estimated margin at risk",
    value: "$12,450",
    trend: "18% vs last 7 days",
    icon: "cash-dollar",
    tone: "green",
  },
  {
    label: "AI credits available",
    value: "87",
    detail: "Resets in 24 days",
    icon: "wand",
    tone: "purple",
  },
];

const evidenceMetrics = [
  { icon: "return", label: "Return rate", value: "18.7%", detail: "High" },
  { icon: "package", label: "Returns", value: "142", detail: "vs 76 avg" },
  { icon: "star", label: "Negative reviews", value: "52", detail: "vs 18 avg" },
  { icon: "question-circle", label: "Size-related questions", value: "37", detail: "High" },
];

const reviewProducts = [
  {
    title: "Linen Shirt",
    variant: "shirt",
    risk: "High",
    riskTone: "critical",
    signals: 184,
    signalTone: "red",
    signalBars: [38, 58, 76, 92, 66, 48, 24],
    issue: "Fit & sizing",
    sourceOverflow: 1,
    lastScanned: "2h ago",
    href: "/app/products/core-linen-trouser",
  },
  {
    title: "Red Dress",
    variant: "dress",
    risk: "High",
    riskTone: "critical",
    signals: 167,
    signalTone: "red",
    signalBars: [32, 52, 74, 84, 54, 36, 20],
    issue: "Color not as expected",
    sourceOverflow: 1,
    lastScanned: "4h ago",
    href: "/app/products/trail-run-vest",
  },
  {
    title: "Sneakers X",
    variant: "sneaker",
    risk: "Medium",
    riskTone: "warning",
    signals: 96,
    signalTone: "orange",
    signalBars: [18, 32, 44, 64, 76, 20, 12],
    issue: "Durability",
    sourceOverflow: 1,
    lastScanned: "6h ago",
    href: "/app/products/ceramic-pour-over",
  },
  {
    title: "Summer Tee",
    variant: "tee",
    risk: "Medium",
    riskTone: "warning",
    signals: 74,
    signalTone: "orange",
    signalBars: [26, 46, 62, 70, 48, 28, 14],
    issue: "Material quality",
    sourceOverflow: 0,
    lastScanned: "8h ago",
    href: "/app/products/minimal-canvas-tote",
  },
  {
    title: "Canvas Tote",
    variant: "tote",
    risk: "Low",
    riskTone: "success",
    signals: 32,
    signalTone: "green",
    signalBars: [18, 32, 48, 58, 18, 10, 8],
    issue: "Zipper quality",
    sourceOverflow: 0,
    lastScanned: "10h ago",
    href: "/app/products/minimal-canvas-tote",
  },
];

const topIssueBars = [
  { label: "Fit & sizing", value: 564, pct: 100 },
  { label: "Color not as expected", value: 421, pct: 74 },
  { label: "Material quality", value: 318, pct: 57 },
  { label: "Durability", value: 214, pct: 40 },
];

const suggestedFixes = [
  { icon: "measurement-size", label: "Improve size chart & fit guidance", impact: "High impact", tone: "success" },
  { icon: "image", label: "Update product photos & color accuracy", impact: "High impact", tone: "success" },
  { icon: "note", label: "Clarify material & care information", impact: "Medium impact", tone: "warning" },
];

const productEvidenceSources = [
  {
    icon: "return",
    title: "Returns (142)",
    points: [
      "18.7% return rate (vs 7.6% avg)",
      "Top reason: Doesn't fit (64%)",
      "Most common: Too small in chest (41%)",
      "Spikes after size M & L in new colors",
    ],
  },
  {
    icon: "star",
    title: "Reviews (52)",
    points: [
      "52 negative reviews (2-3 star)",
      "38 mention sizing or fit",
      'Frequent phrases: "runs small", "tight in chest", "size up"',
      "Trend worsening in last 14 days",
    ],
  },
  {
    icon: "question-circle",
    title: "Support / Questions (37)",
    points: [
      "37 sizing-related tickets",
      "23 pre-purchase size questions",
      "Frequent requests for chest measurements and fit guidance",
      "High volume in last 7 days",
    ],
  },
];

const detectedIssues = [
  { issue: "Runs small in chest", severity: "High", tone: "critical", confidence: "86%", signals: 96, trendTone: "red", action: "Update size chart & fit note" },
  { issue: "Shoulders feel tight", severity: "High", tone: "critical", confidence: "78%", signals: 61, trendTone: "red", action: "Add shoulder measurement" },
  { issue: "Inconsistent sizing across colors", severity: "Medium", tone: "warning", confidence: "71%", signals: 38, trendTone: "orange", action: "Audit color variants" },
  { issue: "Fabric feels stiff at first", severity: "Low", tone: "warning", confidence: "45%", signals: 23, trendTone: "green", action: "Add care note (softens after wash)" },
  { issue: "Sleeve length a bit long", severity: "Low", tone: "success", confidence: "39%", signals: 17, trendTone: "green", action: "Note in description" },
];

const productRecommendedActions = [
  { icon: "measurement-size", title: "Update size chart with garment measurements", detail: "Add chest, shoulder, and length measurements.", action: "Edit" },
  { icon: "pen", title: "Add fit note to product description", detail: 'Add guidance: "Runs small in the chest. Size up for a relaxed fit."', action: "Apply to Shopify", submit: true },
  { icon: "pen", title: "Add FAQ: How does the Linen Shirt fit?", detail: "Answer common sizing questions proactively.", action: "Add FAQ" },
  { icon: "tag", title: 'Apply "Runs Small" product tag', detail: "Help shoppers set the right expectation.", action: "Apply tag" },
  { icon: "note", title: "Share internal note with support team", detail: "Provide talking points and size guidance.", action: "Copy note" },
];

const productCheckedItems = [
  { icon: "return", label: "Returns analyzed", value: "1,214", detail: "Last 90 days" },
  { icon: "star", label: "Reviews analyzed", value: "8,742", detail: "Last 90 days" },
  { icon: "question-circle", label: "Support tickets", value: "1,126", detail: "Last 90 days" },
  { icon: "note", label: "Product content", value: "12 fields", detail: "Description, specs, etc." },
  { icon: "apps", label: "Competitors reviewed", value: "6", detail: "Similar products" },
  { icon: "chart-vertical", label: "Historical trends", value: "90 days", detail: "vs prior period" },
];

const analyticsKpis = [
  { label: "Estimated margin at risk", value: "$12,450", icon: "cash-dollar", tone: "green", trend: "18%", context: "vs prior 90 days", trendTone: "red" },
  { label: "High-risk products", value: "6", icon: "shield-check-mark", tone: "red", trend: "20%", context: "vs prior 90 days", trendTone: "red" },
  { label: "Return-driven issues", value: "142", icon: "alert-triangle", tone: "orange", trend: "23%", context: "vs prior 90 days", trendTone: "red" },
  { label: "Coverage score", value: "78%", icon: "target", tone: "purple", trend: "12pp", context: "vs prior 90 days", trendTone: "green" },
];

const issueDistributionRows = [
  { label: "Fit & sizing", value: 34, color: "blue" },
  { label: "Color", value: 22, color: "purple" },
  { label: "Material quality", value: 18, color: "green" },
  { label: "Durability", value: 15, color: "yellow" },
  { label: "Packaging", value: 11, color: "pink" },
];

const collectionMarginRows = [
  { label: "Summer Essentials", value: 3420, color: "blue" },
  { label: "Linen Collection", value: 2810, color: "blue" },
  { label: "Everyday Basics", value: 2110, color: "blue" },
  { label: "Activewear", value: 1680, color: "blue" },
  { label: "Accessories", value: 430, color: "blue" },
];

const sourceContributionRows = [
  { label: "Reviews", value: 44, color: "blue" },
  { label: "Returns", value: 28, color: "green" },
  { label: "Support tickets", value: 17, color: "orange" },
  { label: "Q&A", value: 11, color: "purple" },
];

const riskBubbleRows = [
  { x: 16, y: 20, size: 19, tone: "green", label: "Low risk product" },
  { x: 27, y: 34, size: 11, tone: "green", label: "Low risk product" },
  { x: 35, y: 38, size: 9, tone: "green", label: "Low risk product" },
  { x: 43, y: 25, size: 8, tone: "green", label: "Low risk product" },
  { x: 53, y: 31, size: 17, tone: "yellow", label: "Medium risk product" },
  { x: 62, y: 49, size: 18, tone: "orange", label: "Medium risk product" },
  { x: 73, y: 68, size: 12, tone: "red", label: "High risk product" },
  { x: 84, y: 50, size: 16, tone: "red", label: "High risk product" },
  { x: 90, y: 66, size: 30, tone: "red", label: "High risk product" },
  { x: 96, y: 48, size: 10, tone: "red", label: "High risk product" },
];

const topInsightRows = [
  { icon: "home", text: "Fit & sizing issues drive 34% of all signals and are the top driver of returns." },
  { icon: "alert-circle", text: "6 products are high-risk and account for $6,210 (50%) of margin at risk." },
  { icon: "megaphone", text: "Reviews are the leading signal source (44%). Expand coverage on returns & support." },
];

const businessImpactMetrics = [
  { label: "Margin at risk", value: "$12,450", icon: "cash-dollar", tone: "green", trend: "18%", context: "vs prior 90 days" },
  { label: "Potential returns", value: "~218", icon: "package", tone: "orange", trend: "23%", context: "vs prior 90 days" },
  { label: "Revenue at risk", value: "$68,900", icon: "alert-triangle", tone: "purple", trend: "14%", context: "vs prior 90 days" },
  { label: "Cost to fix (est.)", value: "$4,210", icon: "shield-check-mark", tone: "blue", trend: "12%", context: "vs prior 90 days" },
];

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
    const fileName = file?.name || "reviews.csv";
    setRecords((current) => upsertLocalConnectionRecord(current, "csvReviews", {
      connected: true,
      active: true,
      ignored: false,
      available: true,
      health: "connected",
      config: { fileName, uploadedAt: new Date().toISOString() },
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
      health: active ? "connected" : "paused",
      disabledAt: active ? null : new Date().toISOString(),
    }));
  };

  return (
    <FullWidthPage label="Connect" className="ppConnectPage">
      <ScreenShell className="ppDashboard ppConnectScreen">
        <ActionBanner actionData={localToast || actionData} />
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
            onCancel={() => setActiveModal(null)}
            onLocalSubmit={handleLocalCsvUpload}
          />
        )}
      </ScreenShell>
    </FullWidthPage>
  );
}

export function RunningJobsScreen({ data, actionData }) {
  return (
    <s-page heading="Running jobs" inline-size="large-500">
      <ScreenShell>
        <ActionBanner actionData={actionData} />
        <s-section>
          <div className="ppActionRow ppBetween">
            <div>
              <h2 className="ppSectionTitle">Signal pipeline</h2>
              <p className="ppMuted">Imports, grouping, risk scoring and recommendation jobs.</p>
            </div>
            <Form method="post">
              <input type="hidden" name="_action" value="run-scan" />
              <button className="ppPrimaryButton" type="submit">Run scan</button>
            </Form>
          </div>
        </s-section>
        <JobTable jobs={data.jobs} />
      </ScreenShell>
    </s-page>
  );
}

export function ProductsScreen({ data, filters }) {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [localFastScan, setLocalFastScan] = useState(false);
  const productRows = data.productTable?.rows || [];
  const productCount = data.productTable?.total ?? productRows.length;
  const activeScanJob = data.productTable?.activeScanJob || null;
  const persistProductJobs = Boolean(data.persistProductJobs);
  const pendingFastScan = navigation.state === "submitting" && navigation.formData?.get("_action") === "fast-product-scan";
  const fastScanRunning = Boolean(activeScanJob) || pendingFastScan || localFastScan;

  useEffect(() => {
    if (!activeScanJob || !persistProductJobs) return undefined;
    const interval = window.setInterval(() => revalidator.revalidate(), 2000);
    return () => window.clearInterval(interval);
  }, [activeScanJob, persistProductJobs, revalidator]);

  const handleLocalFastScan = () => {
    setLocalFastScan(true);
    window.setTimeout(() => setLocalFastScan(false), 15_000);
  };

  const handleStartFastScan = () => {
    if (fastScanRunning) return;
    if (!persistProductJobs) {
      handleLocalFastScan();
      return;
    }

    const formData = new FormData();
    formData.set("_action", "fast-product-scan");
    submit(formData, { method: "post" });
  };

  return (
    <FullWidthPage heading="Products">
      <ScreenShell className="ppDashboard ppProductsScreen">
        <p className="ppDashboardSubtitle">
          Browse products, review risk signals and run AI diagnosis.
        </p>

        <s-section padding="none">
          <Form method="get" className="ppProductsToolbar">
            <div className="ppProductsSearch">
              <div className="ppSearchControl">
                <s-icon type="search" size="small"></s-icon>
                <input
                  aria-label="Search products"
                  name="q"
                  defaultValue={filters.query || ""}
                  placeholder="Search products"
                  type="search"
                />
              </div>
            </div>
            <div className="ppProductsActions">
              <FastScanButton
                pending={fastScanRunning}
                onStart={handleStartFastScan}
              />
              <s-button href="/app/products" variant="secondary">Clear filters</s-button>
              <s-button type="submit" variant="secondary">
                <s-icon type="refresh" size="small"></s-icon>
                Refresh scan
              </s-button>
              <s-button type="button" variant="secondary">
                <s-icon type="import" size="small"></s-icon>
                Export
              </s-button>
              <button className="ppPrimaryButton" type="button" disabled={productRows.length === 0}>Analyze selected ({productRows.length})</button>
            </div>
            <div className="ppProductsFilters" aria-label="Product filters">
              <label className="ppCompactSelect">
                <span>Risk</span>
                <select name="risk" defaultValue={filters.risk || "all"}>
                  <option value="all">Risk</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="ppCompactSelect">
                <span>Status</span>
                <select name="status" defaultValue="all">
                  <option value="all">Status</option>
                  <option value="needs-attention">Needs attention</option>
                  <option value="monitor">Monitor</option>
                  <option value="good">Good</option>
                </select>
              </label>
              <label className="ppCompactSelect">
                <span>Issue type</span>
                <select name="issue" defaultValue="all">
                  <option value="all">Issue type</option>
                  <option value="fit">Fit & sizing</option>
                  <option value="quality">Quality</option>
                  <option value="color">Color</option>
                </select>
              </label>
              <label className="ppCompactSelect">
                <span>Source</span>
                <select name="source" defaultValue="all">
                  <option value="all">Source</option>
                  <option value="reviews">Reviews</option>
                  <option value="returns">Returns</option>
                  <option value="support">Support</option>
                </select>
              </label>
              <label className="ppCompactSelect ppVendorSelect">
                <span>Vendor or Collection</span>
                <select name="vendor" defaultValue="all">
                  <option value="all">Vendor or Collection</option>
                  <option value="summer">Summer capsule</option>
                  <option value="apparel">Apparel</option>
                </select>
              </label>
              <span className="ppBulkHint">
                Bulk analysis will use 8 credits
                <s-icon type="info" size="small" color="subdued"></s-icon>
              </span>
            </div>
          </Form>
        </s-section>

        <s-section padding="none">
          <div className="ppProductsTableStatus">
            {productRows.length > 0 ? (
              <div className="ppSelectionPill">
                <span>0</span>
                selected
                <button type="button" aria-label="Clear selected products">
                  <s-icon type="x" size="small"></s-icon>
                </button>
              </div>
            ) : (
              <span>No products in ProductPulse yet</span>
            )}
            <span>{productRows.length > 0 ? `${productRows.length} of ${productCount} products` : "0 products"}</span>
          </div>
          <div className={`ppProductsTableWrap ${fastScanRunning ? "isScanning" : ""}`.trim()}>
            <table className="ppProductsTable" data-testid="products-table">
              <thead>
                <tr>
                  <th aria-label="Select products">
                    <input type="checkbox" checked readOnly aria-label="Select all visible products" />
                  </th>
                  <th>Product</th>
                  <th>
                    Risk score <s-icon type="sort" size="small"></s-icon>
                  </th>
                  <th>Status</th>
                  <th>Signals</th>
                  <th>Main suspected issue</th>
                  <th>Sources</th>
                  <th>
                    Last analysis <s-icon type="sort" size="small"></s-icon>
                  </th>
                  <th>Credits</th>
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
                {productRows.map((product) => (
                  <tr key={product.title}>
                    <td>
                      <input type="checkbox" checked={product.selected} readOnly aria-label={`Select ${product.title}`} />
                    </td>
                    <td>
                      <Link className="ppProductsProductCell" to={product.href}>
                        <ProductArt variant={product.variant} label={product.title} />
                        <span>{product.title}</span>
                      </Link>
                    </td>
                    <td>
                      <div className="ppRiskScoreCell">
                        <s-badge tone={product.riskTone}>{product.risk}</s-badge>
                        <span>{product.riskScore}</span>
                      </div>
                    </td>
                    <td><s-badge tone={product.statusTone}>{product.status}</s-badge></td>
                    <td>
                      <div className="ppSignalCell">
                        <SignalBars tone={product.signalTone} values={product.signalBars} />
                        <span>{product.signals}</span>
                      </div>
                    </td>
                    <td>{product.issue}</td>
                    <td><ProductSourceIconGroup sources={product.sources} overflow={product.sourceOverflow} /></td>
                    <td>{product.lastAnalysis}</td>
                    <td>{product.credits}</td>
                    <td>
                      <div className="ppTableAction">
                        <Link className="ppAnalyzeLinkButton" to={product.href}>
                          <s-icon type="wand" size="small"></s-icon>
                          <span>Analyze</span>
                        </Link>
                        <button className="ppIconButton" type="button" aria-label={`More actions for ${product.title}`}>
                          <s-icon type="menu-horizontal" size="small"></s-icon>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          </div>
          {productRows.length > 0 && (
            <div className="ppProductsPagination">
              <label className="ppRowsSelect">
                Rows per page
                <select defaultValue="25">
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
              </label>
              <div className="ppPageControls" aria-label="Pagination">
                <button type="button" aria-label="Previous page">
                  <s-icon type="chevron-left" size="small"></s-icon>
                </button>
                {[1, 2, 3, 4, 5].map((page) => (
                  <button className={page === 1 ? "isActive" : ""} type="button" key={page}>
                    {page}
                  </button>
                ))}
                <button type="button" aria-label="Next page">
                  <s-icon type="chevron-right" size="small"></s-icon>
                </button>
              </div>
            </div>
          )}
        </s-section>
      </ScreenShell>
    </FullWidthPage>
  );
}

function FastScanButton({ pending, onStart }) {
  return (
    <button className="ppPrimaryButton" type="button" disabled={pending} onClick={onStart}>
      <s-icon type="wand" size="small"></s-icon>
      {pending ? "Scan running..." : "Run quick scan"}
    </button>
  );
}

function getProductDetailModel(product) {
  const issueText = product.primaryIssue || "Quality signal needs review";
  const issueCategory = getProductIssueCategory(issueText);
  const firstAction = product.recommendedActions?.[0];
  const detectedIssueRows = getProductDetectedIssues(product, issueCategory);
  const recommendedActions = getProductRecommendedActions(product);
  const evidenceSources = getProductEvidenceSources(product);

  return {
    title: product.title,
    variant: getProductArtVariant(product),
    lastAnalysis: formatProductAnalysisDate(product.lastAnalysis),
    riskLabel: product.riskLabel,
    riskBadgeTone: getBadgeToneFromRiskTone(product.riskTone),
    riskScoreLabel: getProductRiskScoreLabel(product.riskScore),
    riskScore: product.riskScore,
    riskTone: getProductInsightTone(product.riskTone),
    confidence: product.confidence,
    confidenceLabel: product.confidence >= 80 ? "High" : product.confidence >= 65 ? "Medium" : "Low",
    signalCount: product.metrics.signalCount,
    returnRate: product.metrics.returnRate,
    marginAtRisk: product.metrics.marginAtRisk,
    revenueAtRisk: product.metrics.revenueAtRisk,
    issueBadge: issueCategory,
    issueCategory,
    issueDetail: issueText,
    issueTone: product.riskScore >= 55 ? "blue" : "green",
    findingTone: getDashboardToneFromRiskTone(product.riskTone),
    evidenceLabel: product.sourceCoverage.length >= 4 ? "Strong evidence" : "Partial evidence",
    mainFindingTitle: getMainFindingTitle(issueCategory),
    mainFindingDetail: `ProductPulse found repeated ${issueCategory.toLowerCase()} signals for ${product.title}: ${issueText}. The current signal set includes ${product.sourceCoverage.join(", ")}.`,
    recommendedFix: firstAction?.label || "Keep monitoring this product",
    recommendedFixDetail: firstAction ? `${firstAction.type} - ${firstAction.effort} effort` : "No immediate action required",
    evidenceSources,
    detectedIssues: detectedIssueRows,
    recommendedActions,
  };
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
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function getBadgeToneFromRiskTone(tone) {
  if (tone === "critical") return "critical";
  if (tone === "success") return "success";
  return "warning";
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

function getProductIssueCategory(issue) {
  const normalized = issue.toLowerCase();
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("waist") || normalized.includes("inseam")) return "Fit & sizing";
  if (normalized.includes("zipper") || normalized.includes("defect")) return "Durability";
  if (normalized.includes("compat")) return "Compatibility";
  if (normalized.includes("monitor")) return "Monitoring";
  return "Product quality";
}

function getMainFindingTitle(issueCategory) {
  if (issueCategory === "Fit & sizing") return "Sizing & fit expectations are not being met";
  if (issueCategory === "Durability") return "Durability signals are affecting buyer confidence";
  if (issueCategory === "Compatibility") return "Compatibility expectations need clearer guidance";
  if (issueCategory === "Monitoring") return "Product is healthy and should stay monitored";
  return `${issueCategory} signals need review`;
}

function getProductEvidenceSources(product) {
  if (!product.evidence?.length) return productEvidenceSources;

  return product.evidence.map((item) => ({
    icon: getEvidenceIcon(item.source),
    title: `${item.source}`,
    points: [
      item.quote,
      item.weight,
      `${product.metrics.signalCount} total signals in current diagnosis`,
    ],
  }));
}

function getEvidenceIcon(source) {
  const normalized = source.toLowerCase();
  if (normalized.includes("return")) return "return";
  if (normalized.includes("review")) return "star";
  if (normalized.includes("refund")) return "cash-dollar";
  if (normalized.includes("support")) return "question-circle";
  return "note";
}

function getProductDetectedIssues(product, issueCategory) {
  if (!product.primaryIssue) return detectedIssues;

  const firstAction = product.recommendedActions?.[0]?.label || "Review product content";
  const secondaryAction = product.recommendedActions?.[1]?.label || "Monitor signal trend";
  const primarySignals = Math.max(product.metrics.signalCount, 1);

  return [
    {
      issue: product.primaryIssue,
      severity: getProductRiskScoreLabel(product.riskScore),
      tone: product.riskTone,
      confidence: `${product.confidence}%`,
      signals: primarySignals,
      trendTone: product.riskScore >= 75 ? "red" : product.riskScore >= 55 ? "orange" : "green",
      action: firstAction,
    },
    {
      issue: `${issueCategory} signal cluster`,
      severity: product.riskScore >= 75 ? "High" : product.riskScore >= 55 ? "Medium" : "Low",
      tone: product.riskScore >= 75 ? "critical" : product.riskScore >= 55 ? "warning" : "success",
      confidence: `${Math.max(product.confidence - 9, 35)}%`,
      signals: Math.max(Math.round(primarySignals * 0.62), 1),
      trendTone: product.riskScore >= 75 ? "red" : "green",
      action: secondaryAction,
    },
  ];
}

function getProductRecommendedActions(product) {
  if (!product.recommendedActions?.length) return productRecommendedActions;

  return product.recommendedActions.map((action, index) => ({
    icon: getActionIcon(action.type),
    title: action.label,
    detail: `${action.type} - ${action.status} - ${action.effort} effort`,
    action: index === 0 ? "Edit" : action.status === "Draft" ? "Apply to Shopify" : "Apply",
    submit: action.id === "fit-note",
  }));
}

function getActionIcon(type) {
  const normalized = type.toLowerCase();
  if (normalized.includes("copy") || normalized.includes("description")) return "pen";
  if (normalized.includes("faq")) return "question-circle";
  if (normalized.includes("tag")) return "tag";
  if (normalized.includes("note")) return "note";
  return "wand";
}

export function ProductDiagnosisScreen({ product, actionData }) {
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

  return (
    <FullWidthPage label={`${detail.title} product`} className="ppProductDetailPage">
      <ScreenShell className="ppDashboard ppProductDetailScreen">
        <ActionBanner actionData={actionData} />

        <div className="ppProductDetailHeader">
          <Link className="ppAnalyzeLinkButton" to="/app/products">
            <s-icon type="arrow-left" size="small"></s-icon>
            Back
          </Link>
          <div className="ppProductTitleRow">
            <ProductArt variant={detail.variant} label={detail.title} size="hero" />
            <div>
              <h1>{detail.title}</h1>
              <p>AI Product Diagnosis - Last analyzed {detail.lastAnalysis}</p>
              <div className="ppBadgeRow">
                <InlineBadge tone={detail.riskBadgeTone} icon="alert-circle">{detail.riskLabel}</InlineBadge>
                <InlineBadge tone="warning" icon="person">{detail.issueBadge}</InlineBadge>
                <InlineBadge tone="success" icon="star">{detail.evidenceLabel}</InlineBadge>
              </div>
            </div>
          </div>
          <div className="ppProductHeaderActions">
            <Form method="post">
              <input type="hidden" name="_action" value="diagnose" />
              <input type="hidden" name="productId" value={product.slug} />
              <s-button type="submit" variant="secondary">
                <s-icon type="refresh" size="small"></s-icon>
                Re-run diagnosis
              </s-button>
            </Form>
            <button className="ppPrimaryButton" type="button">
              <s-icon type="check" size="small"></s-icon>
              Mark as resolved
            </button>
          </div>
        </div>

        <div className="ppProductSummaryGrid">
          <s-section padding="none">
            <div className="ppMainFindingCard">
              <DashboardIcon type="shield-check-mark" tone={detail.findingTone} />
              <div>
                <span>Main finding</span>
                <h2>{detail.mainFindingTitle}</h2>
                <p>{detail.mainFindingDetail}</p>
              </div>
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppRiskSnapshot">
              <ProductInsightMetric
                title="Risk score"
                value={detail.riskScoreLabel}
                detail={`${detail.riskScore} / 100`}
                tone={detail.riskTone}
                sparkline="risk"
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
                value={formatMoney(detail.marginAtRisk)}
                detail={`${formatMoney(detail.revenueAtRisk)} revenue at risk`}
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
        </div>

        <div className="ppProductDetailGrid">
          <div className="ppProductLeftColumn">
            <s-section padding="none">
              <div className="ppProductPanel">
                <h2>Evidence by source</h2>
                <div className="ppEvidenceSourceGrid">
                  {detail.evidenceSources.map((source) => (
                    <EvidenceSourceCard key={source.title} source={source} />
                  ))}
                </div>
              </div>
            </s-section>

            <s-section padding="none">
              <div className="ppProductPanel">
                <h2>Issues detected</h2>
                <div className="ppIssuesTableWrap">
                  <table className="ppIssuesTable">
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th>Severity</th>
                        <th>Confidence</th>
                        <th>Signals</th>
                        <th>Trend (7d)</th>
                        <th>Suggested action</th>
                        <th aria-label="More actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.detectedIssues.map((issue) => (
                        <tr key={issue.issue}>
                          <td>
                            <s-icon type="product" size="small"></s-icon>
                            {issue.issue}
                          </td>
                          <td><s-badge tone={issue.tone}>{issue.severity}</s-badge></td>
                          <td>{issue.confidence}</td>
                          <td>{issue.signals}</td>
                          <td><MiniTrend tone={issue.trendTone} /></td>
                          <td>{issue.action}</td>
                          <td>
                            <button className="ppIconButton" type="button" aria-label={`More actions for ${issue.issue}`}>
                              <s-icon type="menu-horizontal" size="small"></s-icon>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <s-link href="/app/analytics">View all detected issues ({detail.detectedIssues.length})</s-link>
              </div>
            </s-section>
          </div>

          <s-section padding="none">
            <div className="ppProductPanel ppRecommendedActionsPanel">
              <h2>Recommended actions</h2>
              <div className="ppRecommendedActionList">
                {detail.recommendedActions.map((action) => (
                  <ProductRecommendedAction key={action.title} action={action} product={product} />
                ))}
              </div>
              <s-link href="/app/analyses">View all actions & history</s-link>
            </div>
          </s-section>
        </div>

        <s-section padding="none">
          <div className="ppCheckedPanel">
            <h2>What ProductPulse checked</h2>
            <div className="ppCheckedGrid">
              {productCheckedItems.map((item) => (
                <div className="ppCheckedItem" key={item.label}>
                  <s-icon type={item.icon}></s-icon>
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </s-section>
      </ScreenShell>
    </FullWidthPage>
  );
}

export function AnalyticsScreen() {
  return (
    <FullWidthPage label="Analytics" className="ppAnalyticsPage">
      <ScreenShell className="ppDashboard ppAnalyticsScreen">
        <div className="ppAnalyticsTopbar">
          <div>
            <h1>Analytics</h1>
            <p>Visualize product quality risk, issue trends and estimated impact.</p>
          </div>
          <div className="ppAnalyticsActions">
            <s-button type="button" variant="secondary">
              <s-icon type="calendar" size="small"></s-icon>
              Last 90 days
              <s-icon type="chevron-down" size="small"></s-icon>
            </s-button>
            <s-button type="button" variant="secondary">
              <s-icon type="filter" size="small"></s-icon>
              Filters
            </s-button>
          </div>
        </div>

        <div className="ppAnalyticsKpis" aria-label="Analytics overview">
          {analyticsKpis.map((kpi) => (
            <AnalyticsKpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>

        <div className="ppAnalyticsChartsTop">
          <AnalyticsPanel title="Risk signals over time" subtitle=" " action={<AnalyticsTimeSelect />}>
            <RiskSignalsChart />
          </AnalyticsPanel>

          <AnalyticsPanel title="Issue distribution by type" subtitle="% of total issues">
            <HorizontalBarChart rows={issueDistributionRows} max={40} />
          </AnalyticsPanel>

          <AnalyticsPanel title="Source contribution" subtitle="% of total signals">
            <SourceContributionChart />
          </AnalyticsPanel>
        </div>

        <div className="ppAnalyticsChartsMid">
          <AnalyticsPanel title="Risk vs. revenue impact" subtitle="Each bubble is a product">
            <RiskRevenueBubbleChart />
          </AnalyticsPanel>

          <AnalyticsPanel title="Margin at risk by collection" subtitle="Estimated margin at risk">
            <HorizontalBarChart rows={collectionMarginRows} max={4000} money />
          </AnalyticsPanel>

          <AnalyticsPanel title="Connected-source coverage over time" subtitle="% of product catalog covered">
            <CoverageTrendChart />
          </AnalyticsPanel>
        </div>

        <div className="ppAnalyticsBottom">
          <s-section padding="none">
            <div className="ppAnalyticsPanel ppTopInsightsPanel">
              <h2>
                <s-icon type="lightbulb" size="small"></s-icon>
                Top insights
              </h2>
              <div className="ppTopInsightList">
                {topInsightRows.map((insight) => (
                  <p key={insight.text}>
                    <s-icon type={insight.icon} size="small"></s-icon>
                    {insight.text}
                  </p>
                ))}
              </div>
              <s-link href="/app/analyses">View all insights</s-link>
            </div>
          </s-section>

          <s-section padding="none">
            <div className="ppAnalyticsPanel ppBusinessImpactPanel">
              <div className="ppAnalyticsPanelHeader">
                <div>
                  <h2>Estimated business impact (next 90 days)</h2>
                  <p>Based on current trends</p>
                </div>
              </div>
              <div className="ppBusinessImpactGrid">
                {businessImpactMetrics.map((metric) => (
                  <AnalyticsImpactMetric key={metric.label} metric={metric} />
                ))}
              </div>
              <s-link href="/app/analytics">Learn how ProductPulse AI improves these outcomes</s-link>
            </div>
          </s-section>
        </div>
      </ScreenShell>
    </FullWidthPage>
  );
}

export function AnalysesScreen({ data }) {
  return (
    <s-page heading="Analyses" inline-size="large-500">
      <ScreenShell>
        <s-section heading="Diagnosis history">
          <div className="ppTableWrap">
            <table className="ppTable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Main issue</th>
                  <th>Confidence</th>
                  <th>Credits</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.analyses.map((analysis) => (
                  <tr key={analysis.id}>
                    <td><Link to={`/app/products/${analysis.productSlug}`}>{analysis.productTitle}</Link></td>
                    <td><StatusBadge status={analysis.status} /></td>
                    <td>{analysis.riskScore}</td>
                    <td>{analysis.mainIssue}</td>
                    <td>{analysis.confidence}%</td>
                    <td>{analysis.credits}</td>
                    <td>{analysis.actionsApplied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      </ScreenShell>
    </s-page>
  );
}

export function PreviewScreen({ data, actionData }) {
  return (
    <main className="ppPreview">
      <DashboardScreen data={data} actionData={actionData} />
      <nav className="ppPreviewNav" aria-label="Preview screens">
        <a href="#connect">Connect</a>
        <a href="#jobs">Running jobs</a>
        <a href="#products">Products</a>
        <a href="#diagnosis">Diagnosis</a>
        <a href="#analytics">Analytics</a>
        <a href="#analyses">Analyses</a>
      </nav>
      <section id="connect"><ConnectScreen data={data} /></section>
      <section id="jobs"><RunningJobsScreen data={data} actionData={actionData} /></section>
      <section id="products"><ProductsScreen data={data} filters={{ query: "", risk: "all" }} /></section>
      <section id="diagnosis"><ProductDiagnosisScreen product={data.startHere} data={data} actionData={actionData} /></section>
      <section id="analytics"><AnalyticsScreen data={data} /></section>
      <section id="analyses"><AnalysesScreen data={data} /></section>
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
    <div className="ppEvidenceMetric">
      <s-icon type={metric.icon}></s-icon>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.detail}</small>
    </div>
  );
}

function ProductArt({ variant, label, size = "small" }) {
  return (
    <span
      className={`ppProductArt ppProductArt-${variant} ppProductArt-${size}`}
      role="img"
      aria-label={`${label} product image`}
    >
      <span className="ppProductShape" />
      <span className="ppProductAccent" />
      <span className="ppProductDetail" />
    </span>
  );
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

function SourceIconGroup({ count }) {
  return (
    <span className="ppSourceIcons" aria-label={count ? `Reviews, returns, support and ${count} more source` : "Reviews, returns and support"}>
      <s-icon type="star" size="small"></s-icon>
      <s-icon type="package" size="small"></s-icon>
      <s-icon type="chat" size="small"></s-icon>
      {count > 0 && <span>+{count}</span>}
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
      <strong>{issue.value}</strong>
    </div>
  );
}

function SuggestedFix({ fix }) {
  return (
    <a className="ppFixItem" href="/app/analyses">
      <s-icon type={fix.icon}></s-icon>
      <span>{fix.label}</span>
      <s-badge tone={fix.tone}>{fix.impact}</s-badge>
      <s-icon type="chevron-right" size="small"></s-icon>
    </a>
  );
}

function ProductSourceIconGroup({ sources, overflow }) {
  return (
    <span className="ppSourceIcons" aria-label={`${sources.length + overflow} connected signal sources`}>
      {sources.map((source, index) => (
        <s-icon key={`${source}-${index}`} type={source} size="small"></s-icon>
      ))}
      {overflow > 0 && <span>+{overflow}</span>}
    </span>
  );
}

function ProductInsightMetric({ title, value, detail, footnote, tone = "neutral", progress, sparkline, icon }) {
  return (
    <div className={`ppProductInsight ppProductInsight-${tone}`}>
      <span>
        {title}
        <s-icon type="info" size="small" color="subdued"></s-icon>
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {sparkline && <MiniTrend tone="red" size="large" />}
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

function EvidenceSourceCard({ source }) {
  return (
    <article className="ppEvidenceSourceCard">
      <h3>
        <s-icon type={source.icon} size="small"></s-icon>
        {source.title}
      </h3>
      <ul>
        {source.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </article>
  );
}

function MiniTrend({ tone = "red", size = "base" }) {
  return (
    <span className={`ppMiniTrend ppMiniTrend-${tone} ppMiniTrend-${size}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function ProductRecommendedAction({ action, product }) {
  const button = <s-button type={action.submit ? "submit" : "button"} variant="secondary">{action.action}</s-button>;

  return (
    <article className="ppProductActionItem">
      <s-icon type={action.icon} size="small"></s-icon>
      <div>
        <h3>{action.title}</h3>
        <p>{action.detail}</p>
      </div>
      {action.submit ? (
        <Form method="post">
          <input type="hidden" name="_action" value="apply-action" />
          <input type="hidden" name="productId" value={product.slug} />
          <input type="hidden" name="actionId" value="fit-note" />
          {button}
        </Form>
      ) : (
        button
      )}
    </article>
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
                <tr className={!source.available && !source.locked ? "isUnavailable" : ""} key={source.name}>
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
        <button className="ppConnectSmallButton ppConnectSmallButton-ghost" type="submit">
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

function CsvUploadModal({ source, persistConnectState, isUploading, onCancel, onLocalSubmit }) {
  const formProps = persistConnectState ? { method: "post", encType: "multipart/form-data" } : { onSubmit: onLocalSubmit };
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
            <input name="csvFile" type="file" accept=".csv,text/csv" required />
          </label>
          <p className="ppConnectionHint">
            The file is registered as an active reviews source and can be replaced at any time.
          </p>

          <div className="ppConnectionModalFooter">
            <button className="ppConnectSmallButton ppConnectSmallButton-ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="ppPrimaryButton" type="submit" disabled={isUploading}>
              {isUploading ? "Uploading..." : "Upload CSV"}
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

function ActionBanner({ actionData }) {
  if (!actionData || actionData.suppressBanner) return null;
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

function JobTable({ jobs }) {
  return (
    <s-section heading="Current queue">
      <div className="ppTableWrap">
        <table className="ppTable">
          <thead>
            <tr>
              <th>Job</th>
              <th>Source</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.name}</td>
                <td>{job.source}</td>
                <td><StatusBadge status={job.status} /></td>
                <td><ProgressBar value={job.progress} max={100} label={`${job.progress}%`} /></td>
                <td>{job.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </s-section>
  );
}

function AnalyticsKpiCard({ kpi }) {
  return (
    <article className="ppAnalyticsKpi">
      <DashboardIcon type={kpi.icon} tone={kpi.tone} />
      <div>
        <h2>{kpi.label}</h2>
        <strong>{kpi.value}</strong>
        <span className={`ppAnalyticsTrend ppAnalyticsTrend-${kpi.trendTone}`}>
          {kpi.trendTone === "green" ? <span className="ppTrendArrowUp" aria-hidden="true" /> : <span className="ppTrendArrow" aria-hidden="true" />}
          <b>{kpi.trend}</b>
          {kpi.context}
        </span>
      </div>
    </article>
  );
}

function AnalyticsPanel({ title, subtitle, action, className = "", children }) {
  return (
    <s-section padding="none">
      <div className={`ppAnalyticsPanel ${className}`.trim()}>
        <div className="ppAnalyticsPanelHeader">
          <div>
            <h2>
              {title}
              <s-icon type="info" size="small" color="subdued"></s-icon>
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
        {children}
      </div>
    </s-section>
  );
}

function AnalyticsTimeSelect() {
  return (
    <label className="ppAnalyticsTimeSelect">
      <span>Granularity</span>
      <select defaultValue="daily">
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
    </label>
  );
}

function RiskSignalsChart() {
  return (
    <div className="ppAnalyticsLineWrap">
      <div className="ppAnalyticsLegend">
        <span><i className="ppDot-red" />High</span>
        <span><i className="ppDot-orange" />Medium</span>
        <span><i className="ppDot-green" />Low</span>
      </div>
      <svg className="ppRiskSignalsSvg" viewBox="0 0 640 245" role="img" aria-label="Risk signals over time">
        {[28, 68, 108, 148, 188].map((y) => (
          <line className="ppChartGridLine" key={y} x1="50" y1={y} x2="620" y2={y} />
        ))}
        {[500, 400, 300, 200, 100, 0].map((label, index) => (
          <text className="ppChartAxisText" key={label} x="12" y={32 + index * 40}>{label}</text>
        ))}
        <polyline className="ppRiskLine ppRiskLine-red" points="50,101 72,109 94,103 116,91 138,102 160,87 182,95 204,90 226,71 248,103 270,92 292,65 314,58 336,64 358,55 380,61 402,50 424,66 446,59 468,70 490,62 512,55 534,64 556,48 578,60 600,52 620,68" />
        <polyline className="ppRiskLine ppRiskLine-orange" points="50,145 72,136 94,139 116,132 138,140 160,129 182,137 204,142 226,133 248,137 270,127 292,119 314,121 336,108 358,113 380,122 402,129 424,117 446,126 468,131 490,123 512,115 534,110 556,121 578,117 600,129 620,124" />
        <polyline className="ppRiskLine ppRiskLine-green" points="50,181 72,170 94,176 116,169 138,181 160,173 182,178 204,182 226,176 248,183 270,177 292,171 314,166 336,170 358,178 380,181 402,174 424,179 446,185 468,172 490,178 512,171 534,176 556,183 578,174 600,181 620,164" />
        {["Apr 22", "May 6", "May 20", "Jun 3", "Jun 17", "Jul 1", "Jul 15"].map((label, index) => (
          <text className="ppChartAxisText" key={label} x={70 + index * 88} y="230">{label}</text>
        ))}
      </svg>
    </div>
  );
}

function HorizontalBarChart({ rows, max, money = false }) {
  return (
    <div className="ppAnalyticsBarChart" role="img" aria-label="Horizontal bar chart">
      {rows.map((row) => (
        <div className="ppAnalyticsBarRow" key={row.label}>
          <span>{row.label}</span>
          <div>
            <span className={`ppAnalyticsBar ppAnalyticsBar-${row.color}`} style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <strong>{money ? formatMoney(row.value) : `${row.value}%`}</strong>
        </div>
      ))}
      <div className="ppAnalyticsBarAxis">
        {(money ? ["$0", "$1K", "$2K", "$3K", "$4K"] : ["0%", "10%", "20%", "30%", "40%"]).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function SourceContributionChart() {
  return (
    <div className="ppSourceContribution">
      <div className="ppDonutChart" aria-label="Source contribution donut chart">
        <div>
          <strong>3,642</strong>
          <span>Total signals</span>
        </div>
      </div>
      <div className="ppDonutLegend">
        {sourceContributionRows.map((row) => (
          <div key={row.label}>
            <span><i className={`ppDot-${row.color}`} />{row.label}</span>
            <strong>{row.value}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskRevenueBubbleChart() {
  return (
    <div className="ppRiskRevenueWrap">
      <div className="ppBubbleChart" role="img" aria-label="Risk score compared with revenue impact">
        {riskBubbleRows.map((bubble) => (
          <span
            key={`${bubble.x}-${bubble.y}-${bubble.size}`}
            className={`ppRiskBubble ppRiskBubble-${bubble.tone}`}
            style={{ left: `${bubble.x}%`, bottom: `${bubble.y}%`, width: `${bubble.size}px`, height: `${bubble.size}px` }}
            aria-label={bubble.label}
          />
        ))}
        <span className="ppBubbleAxis ppBubbleAxis-y">Revenue impact</span>
        <span className="ppBubbleAxis ppBubbleAxis-x">Risk score</span>
      </div>
      <div className="ppBubbleLegend">
        <span>Est. margin at risk</span>
        <div><i className="ppBubbleSize ppBubbleSize-large" />$5K</div>
        <div><i className="ppBubbleSize ppBubbleSize-medium" />$2K</div>
        <div><i className="ppBubbleSize ppBubbleSize-small" />$1K</div>
      </div>
    </div>
  );
}

function CoverageTrendChart() {
  return (
    <div className="ppCoverageTrend">
      <svg viewBox="0 0 650 230" role="img" aria-label="Connected-source coverage over time">
        {[30, 70, 110, 150, 190].map((y) => (
          <line className="ppChartGridLine" key={y} x1="42" y1={y} x2="625" y2={y} />
        ))}
        {[100, 75, 50, 25, 0].map((label, index) => (
          <text className="ppChartAxisText" key={label} x="4" y={34 + index * 40}>{label}%</text>
        ))}
        <path className="ppCoverageArea" d="M42 154 L68 146 L94 134 L120 126 L146 112 L172 110 L198 108 L224 100 L250 104 L276 92 L302 75 L328 69 L354 58 L380 60 L406 60 L432 55 L458 50 L484 52 L510 48 L536 49 L562 50 L562 190 L42 190 Z" />
        <polyline className="ppCoverageLine" points="42,154 68,146 94,134 120,126 146,112 172,110 198,108 224,100 250,104 276,92 302,75 328,69 354,58 380,60 406,60 432,55 458,50 484,52 510,48 536,49 562,50" />
        <g className="ppCoverageDots">
          {[42, 68, 94, 120, 146, 172, 198, 224, 250, 276, 302, 328, 354, 380, 406, 432, 458, 484, 510, 536, 562].map((x, index) => (
            <circle key={x} cx={x} cy={[154, 146, 134, 126, 112, 110, 108, 100, 104, 92, 75, 69, 58, 60, 60, 55, 50, 52, 48, 49, 50][index]} r="4" />
          ))}
        </g>
        {["Apr 22", "May 6", "May 20", "Jun 3", "Jun 17", "Jul 1", "Jul 15"].map((label, index) => (
          <text className="ppChartAxisText" key={label} x={50 + index * 82} y="218">{label}</text>
        ))}
      </svg>
      <span className="ppCoverageValue">78%</span>
    </div>
  );
}

function AnalyticsImpactMetric({ metric }) {
  return (
    <article className="ppBusinessImpactMetric">
      <DashboardIcon type={metric.icon} tone={metric.tone} size="small" />
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <small>
          <span className="ppTrendArrow" aria-hidden="true" />
          {metric.trend} {metric.context}
        </small>
      </div>
    </article>
  );
}

function ProgressBar({ value, max, label }) {
  const pct = Math.round(Math.min((value / max) * 100, 100));
  return (
    <div className="ppProgress" aria-label={label || `${pct}% complete`}>
      <div style={{ width: `${pct}%` }} />
      {label && <span>{label}</span>}
    </div>
  );
}

function StatusBadge({ status }) {
  const tone = status === "Completed" ? "success" : status === "Running" ? "info" : status === "Queued" ? "warning" : "info";
  return <s-badge tone={tone}>{status}</s-badge>;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
