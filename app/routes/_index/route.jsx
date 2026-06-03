import { Link, useLoaderData } from "react-router";
import styles from "./styles.module.css";

export const meta = () => [
  { title: "ProductPulse AI | Product Risk Diagnostics" },
  {
    name: "description",
    content:
      "ProductPulse AI helps Shopify merchants find product risk from orders, returns, refunds, reviews, retention, and basket signals.",
  },
];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const wizardHref = buildAppRouteHref(url, "/app/dashboard", { wizard: "start" });
  const dashboardHref = buildAppRouteHref(url, "/app/dashboard");
  const homeHref = buildPublicRouteHref(url, "/");

  return {
    hasShopContext: Boolean(url.searchParams.get("shop")),
    homeHref,
    wizardHref,
    dashboardHref,
  };
};

export default function App() {
  const { hasShopContext, homeHref, wizardHref, dashboardHref } = useLoaderData();

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroScene} aria-hidden="true">
          <div className={styles.signalBoard}>
            <div className={styles.boardHeader}>
              <span>Product risk workspace</span>
              <strong>Live catalog signals</strong>
            </div>
            <div className={styles.scoreGrid}>
              <SceneMetric label="Risk" value="82" tone="risk" />
              <SceneMetric label="Confidence" value="74" tone="confidence" />
              <SceneMetric label="Impact" value="$1.8k" tone="impact" />
            </div>
            <div className={styles.issueStack}>
              <SceneIssue label="Return pressure" value="+18%" tone="coral" />
              <SceneIssue label="Refund leakage" value="$640" tone="amber" />
              <SceneIssue label="Review friction" value="12 signals" tone="teal" />
            </div>
            <div className={styles.actionRail}>
              <span>Description update</span>
              <span>FAQ draft</span>
              <span>Watchlist</span>
            </div>
          </div>
          <div className={styles.timelinePanel}>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>

        <nav className={styles.topbar} aria-label="ProductPulse AI public links">
          <Link className={styles.brand} to={homeHref}>
            <span className={styles.brandMark}>P</span>
            <span>ProductPulse AI</span>
          </Link>
          <Link className={styles.textLink} to="/privacy-policy">Privacy policy</Link>
          <Link className={styles.textLink} to="/privacy">Privacy policy</Link>
        </nav>

        <div className={styles.heroContent}>
          <div className={styles.badges} aria-label="ProductPulse AI focus">
            <span className={`${styles.softBadge} ${styles.primaryBadge}`}>Product risk</span>
            <span className={styles.softBadge}>Evidence-first diagnoses</span>
            <span className={styles.softBadge}>Merchant-reviewed actions</span>
          </div>
          <p className={styles.eyebrow}>Product intelligence for Shopify operations</p>
          <h1 id="landing-title">Find the products creating avoidable returns, refunds, and review friction.</h1>
          <p className={styles.lede}>
            ProductPulse AI turns catalog, order, return, refund, review, retention, and basket signals into product risk diagnostics, evidence, watchlist monitoring, and reviewed catalog actions.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} to={wizardHref}>
              <span>Start guided setup</span>
              <span aria-hidden="true">-&gt;</span>
            </Link>
            <Link className={styles.secondaryButton} to={dashboardHref}>Open dashboard</Link>
          </div>
          {!hasShopContext ? (
            <p className={styles.shopContextNote}>
              Install or open ProductPulse AI from Shopify Admin to start the guided setup for your store.
            </p>
          ) : null}
          <div className={styles.heroStats} aria-label="ProductPulse workflow highlights">
            <div>
              <strong>Risk</strong>
              <span>Prioritize products by evidence, impact, and confidence.</span>
            </div>
            <div>
              <strong>Diagnosis</strong>
              <span>Review likely causes, proof, and recommended actions.</span>
            </div>
            <div>
              <strong>Watchlist</strong>
              <span>Track changes after new sales, returns, refunds, or reviews.</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>How it starts</p>
          <h2 id="workflow-title">A guided path from source coverage to first diagnosis.</h2>
        </div>
        <div className={styles.workflowGrid}>
          <WorkflowStep
            number="01"
            icon="sources"
            title="Connect evidence"
            text="Start with Shopify product data, then add review sources or CSV imports when they are available."
          />
          <WorkflowStep
            number="02"
            icon="diagnosis"
            title="Scan the catalog"
            text="Rank products by risk, impact, confidence, source coverage, and current sales momentum."
          />
          <WorkflowStep
            number="03"
            icon="actions"
            title="Diagnose one product"
            text="Open product evidence, return/refund resolution, retention, basket behavior, and recommended actions."
          />
        </div>
      </section>
    </main>
  );
}

function buildAppRouteHref(url, pathname, extraParams = {}) {
  const params = new URLSearchParams();

  url.searchParams.forEach((value, key) => {
    if (key === "wizard" || key === "startWizard") return;
    params.append(key, value);
  });

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  });

  if (!params.get("shop")) return "/auth/login";
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function buildPublicRouteHref(url, pathname) {
  const params = new URLSearchParams();
  ["shop", "host", "embedded", "locale"].forEach((key) => {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function SceneMetric({ label, value, tone }) {
  return (
    <div className={`${styles.sceneMetric} ${styles[`sceneMetric_${tone}`]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SceneIssue({ label, value, tone }) {
  return (
    <div className={styles.sceneIssue}>
      <span className={`${styles.issueDot} ${styles[`issueDot_${tone}`]}`}></span>
      <strong>{label}</strong>
      <em>{value}</em>
    </div>
  );
}

function WorkflowStep({ number, icon, title, text }) {
  return (
    <article className={styles.workflowStep}>
      <span className={styles.stepNumber}>{number}</span>
      <span className={styles.stepIcon}>
        <LandingIcon type={icon} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function LandingIcon({ type }) {
  if (type === "sources") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h7" />
        <path d="M4 17h7" />
        <path d="M13 12h7" />
        <circle cx="16" cy="7" r="3" />
        <circle cx="8" cy="12" r="3" />
        <circle cx="16" cy="17" r="3" />
      </svg>
    );
  }

  if (type === "diagnosis") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 3-4 3 2 4-7" />
        <path d="M17 6h3v3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
      <path d="M5 5v14" />
    </svg>
  );
}
