import { Form, Link } from "react-router";

export function DashboardScreen({ data, actionData }) {
  return (
    <s-page heading="ProductPulse AI" inline-size="large">
      <ScreenShell>
        <ActionBanner actionData={actionData} />
        <PermissionBanner permissionState={data.permissionState} />

        <s-section>
          <div className="ppHero">
            <div>
              <div className="ppKicker">
                <s-badge tone="info">Quality intelligence</s-badge>
                <span>Catalog Signal Scan included</span>
              </div>
              <h2>Find the products creating returns, refunds and buyer doubt.</h2>
              <p>
                ProductPulse AI connects product, return, refund and review signals, then turns the
                evidence into Shopify-ready actions.
              </p>
              <div className="ppActionRow">
                <Form method="post">
                  <input type="hidden" name="_action" value="run-scan" />
                  <s-button type="submit" variant="primary">Run Catalog Signal Scan</s-button>
                </Form>
                <s-button href={`/app/products/${data.startHere.slug}`} variant="secondary">
                  Diagnose start-here product
                </s-button>
              </div>
            </div>

            <CoveragePanel score={data.coverageScore} state={data.coverageState} />
          </div>
        </s-section>

        <MetricGrid
          metrics={[
            { label: "Products scanned", value: data.products.length, detail: "Fixture catalog for MVP" },
            { label: "High-risk products", value: data.products.filter((product) => product.riskScore >= 75).length, detail: "Need diagnosis first" },
            { label: "Credits available", value: data.billing.creditsAvailable, detail: `${data.billing.creditsUsed} used this cycle` },
            { label: "Data coverage", value: `${data.coverageScore}%`, detail: data.coverageState.label },
          ]}
        />

        <div className="ppTwoColumn">
          <s-section heading="Start here">
            <StartHere product={data.startHere} />
          </s-section>

          <s-section heading="Top issues">
            <IssueList issues={data.topIssues} />
          </s-section>
        </div>

        <s-section heading="Highest-risk products">
          <ProductTable products={data.products.slice(0, 4)} compact />
        </s-section>
      </ScreenShell>
    </s-page>
  );
}

export function ConnectSourcesScreen({ data }) {
  return (
    <s-page heading="Connect sources" inline-size="large">
      <ScreenShell>
        <s-banner tone={data.coverageState.tone} heading={`${data.coverageScore}% data coverage`}>
          {data.coverageState.message}
        </s-banner>

        <div className="ppSourceGrid">
          {data.sourceGroups.map((group) => (
            <s-section key={group.category} heading={group.category}>
              <p className="ppMuted">{group.description}</p>
              <div className="ppSourceStack">
                {group.sources.map((source) => (
                  <SourceCard key={source.key} source={source} />
                ))}
              </div>
            </s-section>
          ))}
        </div>
      </ScreenShell>
    </s-page>
  );
}

export function RunningJobsScreen({ data, actionData }) {
  return (
    <s-page heading="Running jobs" inline-size="large">
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
              <s-button type="submit" variant="primary">Run scan</s-button>
            </Form>
          </div>
        </s-section>
        <JobTable jobs={data.jobs} />
      </ScreenShell>
    </s-page>
  );
}

export function ProductsScreen({ data, filters }) {
  return (
    <s-page heading="Products" inline-size="large">
      <ScreenShell>
        <s-section>
          <Form method="get" className="ppToolbar">
            <s-text-field
              label="Search products"
              name="q"
              value={filters.query || ""}
              placeholder="Search title, handle or issue"
            />
            <label className="ppSelectLabel">
              Risk
              <select name="risk" defaultValue={filters.risk || "all"} className="ppSelect">
                <option value="all">All risk</option>
                <option value="high">High risk</option>
                <option value="watch">Watch</option>
                <option value="healthy">Healthy</option>
              </select>
            </label>
            <s-button type="submit" variant="primary">Filter</s-button>
          </Form>
        </s-section>

        <s-section heading={`Product risk queue (${data.filteredProducts.length})`}>
          {data.filteredProducts.length ? (
            <ProductTable products={data.filteredProducts} />
          ) : (
            <EmptyState
              title="No products match these filters"
              message="Clear search or change risk filter to see the full catalog queue."
            />
          )}
        </s-section>
      </ScreenShell>
    </s-page>
  );
}

export function ProductDiagnosisScreen({ product, actionData }) {
  if (!product) {
    return (
      <s-page heading="Product not found" inline-size="large">
        <ScreenShell>
          <s-banner tone="critical" heading="This product is not in the current signal snapshot">
            Return to Products and choose another item.
          </s-banner>
          <s-button href="/app/products" variant="primary">Back to Products</s-button>
        </ScreenShell>
      </s-page>
    );
  }

  return (
    <s-page heading={product.title} inline-size="large">
      <ScreenShell>
        <ActionBanner actionData={actionData} />

        <s-section>
          <div className="ppDiagnosisHero">
            <div>
              <div className="ppKicker">
                <RiskBadge product={product} />
                <span>{product.collection}</span>
              </div>
              <h2>{product.primaryIssue}</h2>
              <p>
                Likely cause: PDP sizing and expectation gaps are creating avoidable returns. The
                deterministic risk score is based on return rate, refund rate, review rating, issue
                count and estimated margin at risk.
              </p>
              <div className="ppActionRow">
                <Form method="post">
                  <input type="hidden" name="_action" value="diagnose" />
                  <input type="hidden" name="productId" value={product.slug} />
                  <s-button type="submit" variant="primary">
                    Run AI Product Diagnosis ({product.creditCost} credit)
                  </s-button>
                </Form>
                <s-button href="/app/products" variant="secondary">Back to products</s-button>
              </div>
            </div>
            <RiskPanel product={product} />
          </div>
        </s-section>

        <div className="ppThreeColumn">
          <MetricCard label="Return rate" value={`${product.metrics.returnRate}%`} detail="Deterministic Shopify signal" />
          <MetricCard label="Refund rate" value={`${product.metrics.refundRate}%`} detail="Deterministic Shopify signal" />
          <MetricCard label="Confidence" value={`${product.confidence}%`} detail={`${product.sourceCoverage.length} sources contributing`} />
        </div>

        <div className="ppTwoColumn">
          <s-section heading="Evidence by source">
            <EvidenceList evidence={product.evidence} />
          </s-section>

          <s-section heading="Recommended actions">
            <ActionList product={product} actions={product.recommendedActions} />
          </s-section>
        </div>

        <s-section heading="Impact">
          <ImpactGrid product={product} />
        </s-section>
      </ScreenShell>
    </s-page>
  );
}

export function AnalyticsScreen({ data }) {
  return (
    <s-page heading="Analytics" inline-size="large">
      <ScreenShell>
        <div className="ppTwoColumn">
          <s-section heading="Signals over time">
            <BarSeries rows={data.analytics.signalsOverTime} keys={["returns", "reviews", "refunds"]} />
          </s-section>
          <s-section heading="Issue distribution">
            <SingleBarSeries rows={data.analytics.issueDistribution} />
          </s-section>
        </div>

        <div className="ppTwoColumn">
          <s-section heading="Contribution by source">
            <SingleBarSeries rows={data.analytics.sourceContribution} />
          </s-section>
          <s-section heading="Margin at risk by collection">
            <SingleBarSeries rows={data.analytics.marginByCollection} money />
          </s-section>
        </div>

        <s-section heading="Risk vs impact">
          <RiskImpactPlot products={data.products} />
        </s-section>
      </ScreenShell>
    </s-page>
  );
}

export function AnalysesScreen({ data }) {
  return (
    <s-page heading="Analyses" inline-size="large">
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

export function SourcesBillingScreen({ data }) {
  return (
    <s-page heading="Sources & Billing" inline-size="large">
      <ScreenShell>
        <div className="ppTwoColumn">
          <s-section heading="Source health">
            <div className="ppSourceStack">
              {data.sources.map((source) => (
                <SourceHealthRow key={source.key} source={source} />
              ))}
            </div>
          </s-section>

          <s-section heading="Plan and credits">
            <div className="ppBillingCard">
              <s-badge tone="info">{data.billing.plan}</s-badge>
              <h2>{data.billing.creditsAvailable} credits available</h2>
              <p className="ppMuted">
                {data.billing.includedScan} is included. AI Product Diagnosis consumes one base
                credit per product.
              </p>
              <ProgressBar value={data.billing.creditsUsed} max={data.billing.monthlyCredits} />
              <dl className="ppFacts">
                <div><dt>Used</dt><dd>{data.billing.creditsUsed}</dd></div>
                <div><dt>Monthly credits</dt><dd>{data.billing.monthlyCredits}</dd></div>
                <div><dt>Next reset</dt><dd>{data.billing.nextReset}</dd></div>
              </dl>
            </div>
          </s-section>
        </div>
      </ScreenShell>
    </s-page>
  );
}

export function PreviewScreen({ data, actionData }) {
  return (
    <main className="ppPreview">
      <DashboardScreen data={data} actionData={actionData} />
      <nav className="ppPreviewNav" aria-label="Preview screens">
        <a href="#connect">Connect sources</a>
        <a href="#jobs">Running jobs</a>
        <a href="#products">Products</a>
        <a href="#diagnosis">Diagnosis</a>
        <a href="#analytics">Analytics</a>
        <a href="#analyses">Analyses</a>
        <a href="#billing">Billing</a>
      </nav>
      <section id="connect"><ConnectSourcesScreen data={data} /></section>
      <section id="jobs"><RunningJobsScreen data={data} actionData={actionData} /></section>
      <section id="products"><ProductsScreen data={data} filters={{ query: "", risk: "all" }} /></section>
      <section id="diagnosis"><ProductDiagnosisScreen product={data.startHere} data={data} actionData={actionData} /></section>
      <section id="analytics"><AnalyticsScreen data={data} /></section>
      <section id="analyses"><AnalysesScreen data={data} /></section>
      <section id="billing"><SourcesBillingScreen data={data} /></section>
    </main>
  );
}

function ScreenShell({ children }) {
  return <div className="ppShell">{children}</div>;
}

function ActionBanner({ actionData }) {
  if (!actionData) return null;
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

function CoveragePanel({ score, state }) {
  return (
    <div className="ppCoveragePanel" data-testid="coverage-panel">
      <div className="ppScoreRing" style={{ "--score": `${score}%` }}>
        <strong>{score}%</strong>
        <span>Coverage</span>
      </div>
      <s-badge tone={state.tone}>{state.label}</s-badge>
      <p>{state.message}</p>
    </div>
  );
}

function MetricGrid({ metrics }) {
  return (
    <div className="ppMetricGrid">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} />
      ))}
    </div>
  );
}

function MetricCard({ label, value, detail }) {
  return (
    <div className="ppMetricCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StartHere({ product }) {
  return (
    <div className="ppStartCard">
      <RiskBadge product={product} />
      <h3>{product.title}</h3>
      <p>{product.primaryIssue}</p>
      <dl className="ppFacts">
        <div><dt>Impact</dt><dd>{product.impactScore}</dd></div>
        <div><dt>Margin at risk</dt><dd>{formatMoney(product.metrics.marginAtRisk)}</dd></div>
        <div><dt>Credit cost</dt><dd>{product.creditCost}</dd></div>
      </dl>
      <s-button href={`/app/products/${product.slug}`} variant="primary">Open diagnosis</s-button>
    </div>
  );
}

function IssueList({ issues }) {
  return (
    <ol className="ppIssueList">
      {issues.map((issue) => (
        <li key={`${issue.product}-${issue.issue}`}>
          <strong>{issue.issue}</strong>
          <span>{issue.product}</span>
          <RiskPill score={issue.riskScore} />
        </li>
      ))}
    </ol>
  );
}

function SourceCard({ source }) {
  return (
    <div className={`ppSourceCard ${source.connected ? "isConnected" : ""}`}>
      <div className="ppBetween">
        <h3>{source.name}</h3>
        <s-badge tone={source.connected ? "success" : source.required ? "critical" : "warning"}>
          {source.connected ? "Connected" : source.required ? "Required" : "Missing"}
        </s-badge>
      </div>
      <p>{source.contribution}</p>
      {!source.connected && <small>{source.missing}</small>}
      <ProgressBar value={source.connected ? source.weight : 0} max={source.weight} />
    </div>
  );
}

function SourceHealthRow({ source }) {
  return (
    <div className="ppHealthRow">
      <div>
        <strong>{source.name}</strong>
        <span>{source.category}</span>
      </div>
      <s-badge tone={source.connected ? "success" : "warning"}>{source.connected ? "Healthy" : "Not connected"}</s-badge>
    </div>
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

function ProductTable({ products, compact = false }) {
  return (
    <div className="ppTableWrap">
      <table className="ppTable" data-testid="products-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Risk</th>
            {!compact && <th>Signals</th>}
            <th>Sources</th>
            <th>Last analysis</th>
            <th>Credits</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td>
                <strong>{product.title}</strong>
                <span className="ppMutedBlock">{product.primaryIssue}</span>
              </td>
              <td><RiskBadge product={product} /></td>
              {!compact && <td>{product.metrics.signalCount}</td>}
              <td>{product.sourceCoverage.join(", ")}</td>
              <td>{product.lastAnalysis}</td>
              <td>{product.creditCost}</td>
              <td><s-button href={`/app/products/${product.slug}`} variant="secondary">Analyze</s-button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskPanel({ product }) {
  return (
    <div className="ppRiskPanel">
      <div className="ppScoreRing ppRiskRing" style={{ "--score": `${product.riskScore}%` }}>
        <strong>{product.riskScore}</strong>
        <span>Risk</span>
      </div>
      <dl className="ppFacts">
        <div><dt>Impact</dt><dd>{product.impactScore}</dd></div>
        <div><dt>Margin at risk</dt><dd>{formatMoney(product.metrics.marginAtRisk)}</dd></div>
        <div><dt>Revenue at risk</dt><dd>{formatMoney(product.metrics.revenueAtRisk)}</dd></div>
      </dl>
    </div>
  );
}

function EvidenceList({ evidence }) {
  return (
    <div className="ppEvidenceList">
      {evidence.map((item) => (
        <article key={`${item.source}-${item.quote}`} className="ppEvidenceItem">
          <s-badge tone="info">{item.source}</s-badge>
          <p>{`"${item.quote}"`}</p>
          <small>{item.weight}</small>
        </article>
      ))}
    </div>
  );
}

function ActionList({ product, actions }) {
  return (
    <div className="ppActionList">
      {actions.map((action) => (
        <div key={action.id} className="ppActionCard">
          <div>
            <strong>{action.label}</strong>
            <span>{action.type} - {action.effort} effort</span>
          </div>
          <Form method="post">
            <input type="hidden" name="_action" value="apply-action" />
            <input type="hidden" name="productId" value={product.slug} />
            <input type="hidden" name="actionId" value={action.id} />
            <s-button type="submit" variant="primary">Apply draft</s-button>
          </Form>
        </div>
      ))}
    </div>
  );
}

function ImpactGrid({ product }) {
  return (
    <div className="ppImpactGrid">
      <MetricCard label="Revenue at risk" value={formatMoney(product.metrics.revenueAtRisk)} detail="Derived from refund and return signal volume" />
      <MetricCard label="Margin at risk" value={formatMoney(product.metrics.marginAtRisk)} detail="Estimated contribution exposure" />
      <MetricCard label="Issue count" value={product.metrics.issueCount} detail="Grouped deterministic + AI-classified themes" />
      <MetricCard label="Review rating" value={product.metrics.reviewRating.toFixed(1)} detail="Source review average" />
    </div>
  );
}

function BarSeries({ rows, keys }) {
  return (
    <div className="ppChart" role="img" aria-label="Signals over time chart">
      {rows.map((row) => (
        <div className="ppChartRow" key={row.label}>
          <span>{row.label}</span>
          <div className="ppGroupedBars">
            {keys.map((key) => (
              <div key={key} className={`ppBar ppBar-${key}`} style={{ width: `${Math.min(row[key] * 2, 100)}%` }}>
                <span>{key}: {row[key]}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SingleBarSeries({ rows, money = false }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="ppChart" role="img" aria-label="Bar chart">
      {rows.map((row) => (
        <div className="ppChartRow" key={row.label}>
          <span>{row.label}</span>
          <div className="ppSingleBar">
            <div style={{ width: `${(row.value / max) * 100}%` }}>
              {money ? formatMoney(row.value) : `${row.value}%`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskImpactPlot({ products }) {
  return (
    <div className="ppPlot" role="img" aria-label="Risk versus impact by product">
      {products.map((product) => (
        <a
          key={product.id}
          href={`/app/products/${product.slug}`}
          className="ppPlotPoint"
          style={{ left: `${product.riskScore}%`, bottom: `${product.impactScore}%` }}
          aria-label={`${product.title}: risk ${product.riskScore}, impact ${product.impactScore}`}
        >
          <span>{product.title}</span>
        </a>
      ))}
    </div>
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

function RiskBadge({ product }) {
  return <s-badge tone={product.riskTone}>{product.riskLabel}: {product.riskScore}</s-badge>;
}

function RiskPill({ score }) {
  const label = score >= 75 ? "High" : score >= 55 ? "Watch" : "Emerging";
  return <span className={`ppRiskPill ppRisk${label}`}>{label} {score}</span>;
}

function StatusBadge({ status }) {
  const tone = status === "Completed" ? "success" : status === "Running" ? "info" : status === "Queued" ? "warning" : "info";
  return <s-badge tone={tone}>{status}</s-badge>;
}

function EmptyState({ title, message }) {
  return (
    <div className="ppEmptyState">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
