import { redirect } from "react-router";
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

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
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
          <a className={styles.brand} href="/">
            <span className={styles.brandMark}>P</span>
            <span>ProductPulse AI</span>
          </a>
          <a className={styles.textLink} href="/privacy-policy">Privacy policy</a>
        </nav>

        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Product intelligence for Shopify operations</p>
          <h1 id="landing-title">Find the products creating avoidable returns, refunds, and review friction.</h1>
          <p className={styles.lede}>
            ProductPulse AI turns catalog, order, return, refund, review, retention, and basket signals into product risk diagnostics, evidence, watchlist monitoring, and reviewed catalog actions.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="/app/dashboard?wizard=start">
              <span>Start guided setup</span>
              <span aria-hidden="true">-&gt;</span>
            </a>
            <a className={styles.secondaryButton} href="/app/dashboard">
              Open dashboard
            </a>
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
            title="Connect evidence"
            text="Start with Shopify product data, then add review sources or CSV imports when they are available."
          />
          <WorkflowStep
            number="02"
            title="Scan the catalog"
            text="Rank products by risk, impact, confidence, source coverage, and current sales momentum."
          />
          <WorkflowStep
            number="03"
            title="Diagnose one product"
            text="Open product evidence, return/refund resolution, retention, basket behavior, and recommended actions."
          />
        </div>
      </section>
    </main>
  );
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

function WorkflowStep({ number, title, text }) {
  return (
    <article className={styles.workflowStep}>
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
