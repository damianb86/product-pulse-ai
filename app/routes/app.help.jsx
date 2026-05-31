import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendContactEmail } from "../email.server";
import styles from "../styles/help.module.css";

const DEFAULT_CONTACT_EMAIL = "support@example.com";

const requestCards = [
  {
    icon: "sources",
    title: "Set up source coverage",
    text: "Get help connecting Shopify product, order, return, refund, review, CSV, and optional support sources so coverage reflects your real workflow.",
    action: "Request setup help",
    modal: "setup",
    tone: "primary",
  },
  {
    icon: "diagnosis",
    title: "Understand diagnosis results",
    text: "Ask about risk, confidence, Estimated Margin Exposure, Sales Momentum, retention, evidence by source, diagnosis credits, and ProductPulse action records.",
    action: "Ask a question",
    modal: "support",
  },
  {
    icon: "spark",
    title: "Suggest a workflow improvement",
    text: "Share ideas for connectors, metric timelines, retention views, issue labels, action templates, or catalog review flows your team needs.",
    action: "Send suggestion",
    modal: "suggestion",
  },
];

const supportAreas = [
  {
    icon: "coverage",
    title: "Coverage and scopes",
    text: "Review source health, required read scopes, optional imports, and why a signal may be unavailable or ignored.",
  },
  {
    icon: "evidence",
    title: "Evidence and AI boundaries",
    text: "Understand what comes from deterministic product metrics, what AI summarizes, and how schema validation protects the output.",
  },
  {
    icon: "actions",
    title: "Catalog action rollout",
    text: "Turn findings into ProductPulse-owned PDP copy guidance, fit notes, FAQs, support snippets, tags, and internal product-quality review tasks.",
  },
  {
    icon: "diagnosis",
    title: "Retention and LTV",
    text: "Read Shopify order cohorts, same-product repurchase, cross-sell retention, LTV contribution, monthly order activity, and retention-health signals.",
  },
  {
    icon: "coverage",
    title: "Timelines and history",
    text: "Compare stored score history, metric timelines, product timeline events, Watchlist baselines, and change reports without re-running every analysis.",
  },
  {
    icon: "spark",
    title: "Assistant and confirmations",
    text: "Use the AI assistant for explanations and ProductPulse-owned proposals while keeping Shopify writes behind separate, explicit workflows.",
  },
];

const workflowSteps = [
  {
    eyebrow: "01",
    title: "Connect sources",
    text: "Start with Shopify product data, then add reviews, returns, refunds, CSV imports, and future support sources as they become available.",
    href: "/app/connect",
    linkText: "Open Connect",
  },
  {
    eyebrow: "02",
    title: "Run Catalog Scan",
    text: "Create a background catalog scan that calculates product-level risk snapshots from the available signals.",
    href: "/app/products",
    linkText: "Scan products",
  },
  {
    eyebrow: "03",
    title: "Diagnose one product",
    text: "Spend 1.0 diagnosis credit to run Product Diagnosis with likely cause, confidence, issue clusters, evidence, and recommended actions.",
    href: "/app/products",
    linkText: "Review products",
  },
  {
    eyebrow: "04",
    title: "Act from evidence",
    text: "Review recommended actions, description previews, highlighted copy differences, and supporting evidence before saving ProductPulse action state.",
    href: "/app/analytics",
    linkText: "Review analytics",
  },
];

const featureGuideItems = [
  {
    icon: "diagnosis",
    title: "Dashboard and Products",
    text: "Use Dashboard for priority products, active jobs, diagnosis credits, top issues, latest diagnoses, and recommended actions. Use Products to review diagnosed products, Catalog Scan candidates, resolved items, and Watchlist actions.",
  },
  {
    icon: "evidence",
    title: "Product detail and evidence",
    text: "Product detail combines risk, confidence, Estimated Margin Exposure, Sales Momentum, return pressure, refund leakage, customer signals, evidence tabs, action history, product timeline, relationships, and score history.",
  },
  {
    icon: "coverage",
    title: "Metric timelines",
    text: "Metric timelines aligns product risk, Estimated Margin Exposure, return/refund metrics, retention health, Sales Momentum, confidence, evidence, ratings, customer signals, and main issue across the same time window.",
  },
  {
    icon: "sources",
    title: "Retention metrics",
    text: "Retention metrics use deterministic Shopify order cohorts to show repeat purchase rates, same-product repurchase, cross-sell retention, LTV contribution, segments, and monthly order activity.",
  },
  {
    icon: "actions",
    title: "Recommended actions",
    text: "ProductPulse actions are app-owned records. Description actions show current and proposed previews, can expand full text, and highlight changed blocks before a merchant applies anything outside ProductPulse.",
  },
  {
    icon: "spark",
    title: "AI assistant",
    text: "The assistant can explain screens, formulas, evidence, and safe next steps; it can propose or save confirmed ProductPulse actions, but it cannot directly mutate Shopify products.",
  },
];

const commonTopics = [
  "Coverage score looks low because optional customer-signal sources are missing, disabled, ignored, or outside the analysis window.",
  "Catalog Scan is deterministic: it reads available catalog, order, return, refund, review rating, CSV, and coverage metadata without calling the AI model.",
  "Product Diagnosis uses deterministic metrics plus bounded AI synthesis to classify likely cause, evidence, and recommended actions.",
  "Metric timelines compare different metrics on one shared time domain; missing months or sparse snapshots can change how much history is visible.",
  "Retention and LTV views are cohort-based, so low customer volume or immature 90-day windows can make retention signals sparse.",
  "Recommended action previews are ProductPulse records first; direct Shopify product writes are not performed by the assistant.",
  "Watchlist reports compare new source movement, product risk, Sales Momentum, evidence, and diagnosis changes against a stored baseline.",
  "Missing Shopify scopes should show recovery guidance instead of silently producing partial analysis.",
];

const privacyStoredItems = [
  "Source connection state, coverage preferences, and health metadata.",
  "Catalog scan jobs, diagnosis jobs, job logs, and recoverable error details.",
  "Product risk snapshots, Product Diagnosis summaries, issue evidence, and recommendations.",
  "Product retention runs, cohort summaries, LTV curves, segment rows, and monthly order activity used in retention views.",
  "Product timeline events, metric score history, Watchlist products, Watchlist settings, and Watchlist activity.",
  "ProductPulse actions, AI conversation records, AI tool/audit logs, app-owned proposals, usage events, diagnosis credit ledger entries, and contact requests from this page.",
  "Shopify session tokens required for embedded admin authentication.",
];

const privacyMinimizedItems = [
  "Customer-level order data is transformed into product-level metrics and cohorts for the app views.",
  "CSV imports should be mapped to product identifiers, ratings, review text, and dates before storage.",
  "Support connectors are optional; raw support-ticket PII is not required for the current product-quality workflow.",
  "The AI assistant may save confirmed ProductPulse records, but it does not apply Shopify description, SEO, price, inventory, tag, variant, image, collection, or metafield changes.",
];

const modalContent = {
  setup: {
    title: "Request setup help",
    type: "setup",
    subjectPlaceholder: "Coverage, Catalog Scan, or source setup",
    messageLabel: "What are you trying to configure?",
    messagePlaceholder:
      "Example: We have Shopify returns, refunds, Judge.me reviews, and a CSV import, but coverage still looks low and Catalog Scan has not ranked any products yet.",
    intro:
      "Tell us which sources you use, what the app shows today, and what a good ProductPulse workflow should unlock for your team.",
    primary: "Send setup request",
  },
  suggestion: {
    title: "Suggest an improvement",
    type: "suggestion",
    subjectPlaceholder: "Connector, analytics, or action idea",
    messageLabel: "What should ProductPulse add or improve?",
    messagePlaceholder:
      "Example: Add a Zendesk source and show which support themes changed the risk score, retention health, or recommended action for each product.",
    intro:
      "Connector requests, missing issue labels, analytics gaps, confusing copy, and action-template ideas are all useful.",
    primary: "Send suggestion",
  },
  support: {
    title: "Contact support",
    type: "support",
    subjectPlaceholder: "Question about ProductPulse AI",
    messageLabel: "How can we help?",
    messagePlaceholder:
      "Example: A product has a high risk score, but the evidence tab, metric timelines, or retention panel do not show the source signal I expected.",
    intro:
      "Share enough detail to reproduce or understand the behavior. Include the screen, product, source, or job state when relevant.",
    primary: "Send message",
  },
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return {
    // eslint-disable-next-line no-undef
    contactEmail: process.env.CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "privacy-data-request") {
    const counts = await getProductPulseDataCounts(session.shop);

    await sendContactEmail({
      type: "Privacy: Data summary",
      subject: "Privacy - ProductPulse data summary requested",
      shop: session.shop,
      message: [
        `Shop: ${session.shop}`,
        "",
        "Data currently stored for this shop:",
        `- Source connection records: ${counts.sources}`,
        `- Catalog signal jobs: ${counts.jobs}`,
        `- Job log entries: ${counts.jobLogs}`,
        `- Product risk snapshots: ${counts.riskSnapshots}`,
        `- Product diagnoses: ${counts.diagnoses}`,
        `- ProductPulse actions: ${counts.actions}`,
        `- Product retention runs: ${counts.retentionRuns}`,
        `- Product timeline events: ${counts.timelineEvents}`,
        `- Watchlist products: ${counts.watchlistItems}`,
        `- Watchlist settings: ${counts.watchSettings}`,
        `- Watchlist activity entries: ${counts.watchActivities}`,
        `- Product score history entries: ${counts.scoreHistory}`,
        `- AI conversations: ${counts.aiConversations}`,
        `- AI usage events: ${counts.aiUsageEvents}`,
        `- AI action proposals: ${counts.aiActionProposals}`,
        `- AI app draft proposals: ${counts.aiAppDraftProposals}`,
        `- Diagnosis credit ledger entries: ${counts.creditEntries}`,
        `- Contact requests: ${counts.contacts}`,
        `- Sessions: ${counts.sessions}`,
        "",
        "ProductPulse AI stores product-level signal data, app-owned action state, and assistant records needed for traceability. It avoids using customer account profiles as a product-quality requirement.",
      ].join("\n"),
    });

    return {
      ok: true,
      intent: "privacy-data-request",
      counts,
      message: "Data summary sent to our team. We will respond within 30 days.",
    };
  }

  if (intent === "privacy-data-delete") {
    await deleteProductPulseData(session.shop);

    await sendContactEmail({
      type: "Privacy: Data deleted",
      subject: "Privacy - Merchant deleted all ProductPulse data",
      shop: session.shop,
      message: [
        `Shop: ${session.shop}`,
        "",
        "The merchant requested deletion of all ProductPulse AI app data.",
        "Deleted: source records, jobs, job logs, risk snapshots, diagnoses, product actions, retention records, product timeline events, watchlist products, watch settings, watch activity, product score history, AI conversations, AI usage events, AI proposals, diagnosis credit ledger entries, contact requests, and sessions.",
      ].join("\n"),
    });

    return {
      ok: true,
      intent: "privacy-data-delete",
      message: "All ProductPulse AI data for this shop has been permanently deleted.",
    };
  }

  const type = String(formData.get("type") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const replyEmail = String(formData.get("email") ?? "").trim() || undefined;

  if (!type || !message) {
    return {
      ok: false,
      intent: "contact",
      message: "Message is required.",
    };
  }

  try {
    await db.contactRequest.create({
      data: {
        shop: session.shop,
        type,
        subject: subject || type,
        message,
        email: replyEmail ?? null,
      },
    });

    await sendContactEmail({
      type,
      subject: subject || type,
      message,
      replyEmail,
      shop: session.shop,
    });

    return {
      ok: true,
      intent: "contact",
      message: "Message sent. We will get back to you soon.",
    };
  } catch (error) {
    console.error("[help.action]", error);
    return {
      ok: false,
      intent: "contact",
      message: "Something went wrong. Please try again.",
    };
  }
};

export default function Help() {
  const { contactEmail } = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const privacyFetcher = useFetcher();
  const [openModal, setOpenModal] = useState(null);
  const [privacyDeleteOpen, setPrivacyDeleteOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");

  const activeModal = openModal ? modalContent[openModal] : null;
  const isSubmitting = fetcher.state !== "idle";
  const isPrivacySubmitting = privacyFetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    if (data.intent !== "contact") return;

    if (data.ok) {
      shopify.toast.show(data.message);
      setOpenModal(null);
      setSubject("");
      setMessage("");
      setEmail("");
    } else {
      shopify.toast.show(data.message, { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  useEffect(() => {
    if (privacyFetcher.state !== "idle" || !privacyFetcher.data) return;
    const data = privacyFetcher.data;

    if (data.ok) {
      const extra = data.counts ? ` ${formatProductPulseCounts(data.counts)}` : "";
      shopify.toast.show(`${data.message}${extra}`, { duration: 7000 });
    } else {
      shopify.toast.show(data.message, { isError: true });
    }
  }, [privacyFetcher.state, privacyFetcher.data, shopify]);

  const closeModal = () => {
    setOpenModal(null);
    setSubject("");
    setMessage("");
    setEmail("");
  };

  const submitForm = () => {
    if (!activeModal || !message.trim()) return;

    const formData = new FormData();
    formData.set("intent", "contact");
    formData.set("type", activeModal.type);
    formData.set("subject", subject || activeModal.title);
    formData.set("message", message);
    formData.set("email", email);
    fetcher.submit(formData, { method: "post" });
  };

  const requestPrivacySummary = () => {
    const formData = new FormData();
    formData.set("intent", "privacy-data-request");
    privacyFetcher.submit(formData, { method: "post" });
  };

  const deletePrivacyData = () => {
    const formData = new FormData();
    formData.set("intent", "privacy-data-delete");
    privacyFetcher.submit(formData, { method: "post" });
    setPrivacyDeleteOpen(false);
  };

  return (
    <main className={styles.helpShell} aria-label="Help & contact">
      <div className={styles.helpPage}>
        <section className={styles.hero} aria-labelledby="help-hero-title">
          <div className={styles.heroCopy}>
            <div className={styles.badges} aria-label="ProductPulse support focus">
              <span className={`${styles.softBadge} ${styles.primaryBadge}`}>App support</span>
              <span className={styles.softBadge}>Product timelines</span>
              <span className={styles.softBadge}>No automatic Shopify writes</span>
            </div>
            <div>
              <p className={styles.kicker}>ProductPulse AI support</p>
              <h1 className={styles.heroTitle} id="help-hero-title">
                Get clearer product decisions from every signal.
              </h1>
              <p className={styles.heroText}>
                Use this page when source coverage, Catalog Scan jobs, Product Diagnosis,
                retention metrics, metric timelines, Watchlist reports, ProductPulse
                actions, diagnosis credits, or privacy questions block your catalog review workflow.
              </p>
            </div>
            <div className={styles.heroActions}>
              <s-button
                variant="primary"
                onClick={() => setOpenModal("setup")}
              >
                Request setup help
              </s-button>
              <s-button onClick={() => setOpenModal("support")}>
                Contact support
              </s-button>
            </div>
            <div className={styles.heroStats} aria-label="Support workflow highlights">
              <div>
                <strong>10+</strong>
                <span>Product views and workflows</span>
              </div>
              <div>
                <strong>1</strong>
                <span>Point per diagnosis</span>
              </div>
              <div>
                <strong>0</strong>
                <span>Automatic product writes</span>
              </div>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <img
              className={styles.heroImage}
              src="/assets/help.png"
              alt="ProductPulse AI connects reviews, refunds, returns, and support signals into evidence-backed product actions."
            />
          </div>
        </section>

        <section className={styles.requestGrid} aria-label="Contact options">
          {requestCards.map((card) => (
            <div className={styles.requestCard} key={card.title}>
              <div className={styles.cardTitle}>
                <span
                  className={
                    card.tone === "primary"
                      ? styles.iconBoxPrimary
                      : styles.iconBox
                  }
                >
                  <HelpIcon type={card.icon} />
                </span>
                <h2>{card.title}</h2>
              </div>
              <p>{card.text}</p>
              <s-button
                variant={card.tone === "primary" ? "primary" : undefined}
                onClick={() => setOpenModal(card.modal)}
              >
                {card.action}
              </s-button>
            </div>
          ))}
        </section>

        <section className={styles.workflowSection} aria-labelledby="workflow-title">
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>Recommended path</p>
            <h2 id="workflow-title">Start from coverage, then move to action.</h2>
            <p>
              ProductPulse works best when the team can trace each recommendation
              back to source coverage, deterministic metrics, and a product-level
              diagnosis.
            </p>
          </div>
          <div className={styles.workflowGrid}>
            {workflowSteps.map((step) => (
              <article className={styles.workflowStep} key={step.title}>
                <span>{step.eyebrow}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <a href={step.href}>{step.linkText}</a>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.supportPanel} aria-labelledby="feature-guide-title">
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>What ProductPulse covers</p>
            <h2 id="feature-guide-title">Use the right view for the decision you are making.</h2>
            <p>
              ProductPulse has several product-level views. Use this guide to decide
              whether you need portfolio prioritization, a single-Product Diagnosis,
              timeline comparison, retention review, or a safe ProductPulse action.
            </p>
          </div>
          <div className={styles.serviceGrid}>
            {featureGuideItems.map((item) => (
              <div className={styles.serviceItem} key={item.title}>
                <span className={styles.smallIcon}>
                  <HelpIcon type={item.icon} />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.supportGrid} aria-label="Support details">
          <div className={styles.supportPanel}>
            <div className={styles.sectionIntro}>
              <p className={styles.kicker}>How support can help</p>
              <h2>Focused help for catalog, CX, and ecommerce teams.</h2>
              <p>
                ProductPulse is built for product-level decisions, not generic
                reporting. The best support requests include the product, source,
                job, metric, or action that needs review.
              </p>
            </div>
            <div className={styles.serviceGrid}>
              {supportAreas.map((service) => (
                <div className={styles.serviceItem} key={service.title}>
                  <span className={styles.smallIcon}>
                    <HelpIcon type={service.icon} />
                  </span>
                  <div>
                    <h3>{service.title}</h3>
                    <p>{service.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className={styles.contactPanel} aria-labelledby="direct-contact-title">
            <div className={styles.cardTitle}>
              <span className={styles.smallIconDark}>
                <HelpIcon type="email" />
              </span>
              <h2 id="direct-contact-title">Direct contact</h2>
            </div>
            <p>
              Prefer email? Send the shop context, screen name, product handle,
              and the result your team expected.
            </p>
            <div className={styles.emailBox}>{contactEmail}</div>
            <s-button onClick={() => setOpenModal("support")}>
              Send from app
            </s-button>
          </aside>
        </section>

        <section className={styles.topicPanel} aria-labelledby="topics-title">
          <div className={styles.topicHeader}>
            <span className={styles.iconBoxPrimary}>
              <HelpIcon type="spark" />
            </span>
            <div>
              <p className={styles.kicker}>Common support topics</p>
              <h2 id="topics-title">Questions worth sending with context.</h2>
            </div>
          </div>
          <ul className={styles.checkList}>
            {commonTopics.map((item) => (
              <li key={item}>
                <span aria-hidden="true">+</span>
                <p>{item}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.privacyPanel} aria-labelledby="privacy-title">
          <div className={styles.privacyHeader}>
            <span className={styles.iconBox}>
              <HelpIcon type="lock" />
            </span>
            <div>
              <p className={styles.kicker}>Data and privacy</p>
              <h2 id="privacy-title">Product-level data, minimized by design.</h2>
              <p>
                ProductPulse keeps tokens server-side and stores only the
                app-owned data needed for traceability, diagnosis, support, and
                diagnosis credit accounting.
              </p>
            </div>
          </div>

          <div className={styles.privacyColumns}>
            <div>
              <h3>Stored for this shop</h3>
              <ul className={styles.dotList}>
                {privacyStoredItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Minimized or gated</h3>
              <ul className={styles.dotList}>
                {privacyMinimizedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className={styles.privacyActions}>
            <s-button
              loading={
                isPrivacySubmitting &&
                privacyFetcher.formData?.get("intent") ===
                  "privacy-data-request"
              }
              disabled={isPrivacySubmitting}
              onClick={requestPrivacySummary}
            >
              Request data summary
            </s-button>
            <s-button
              tone="critical"
              variant="tertiary"
              disabled={isPrivacySubmitting}
              onClick={() => setPrivacyDeleteOpen(true)}
            >
              Delete all my data
            </s-button>
          </div>
        </section>
      </div>

      {privacyDeleteOpen && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-delete-title"
          >
            <div className={styles.modalHeader}>
              <h2 id="privacy-delete-title">Delete all ProductPulse data?</h2>
              <s-button
                variant="tertiary"
                onClick={() => setPrivacyDeleteOpen(false)}
              >
                Close
              </s-button>
            </div>
            <p>
              This permanently deletes source records, jobs, job logs, risk
              snapshots, diagnoses, product actions, retention records, product
              timeline events, Watchlist products, Watchlist settings, Watchlist
              activity, product score history, AI conversations, AI usage events,
              AI proposals, diagnosis credit ledger entries, contact requests, and Shopify
              sessions for this shop.
            </p>
            <p className={styles.subduedText}>
              This action cannot be undone. You may be asked to log in again
              after deletion.
            </p>
            <div className={styles.modalActions}>
              <s-button
                variant="tertiary"
                onClick={() => setPrivacyDeleteOpen(false)}
              >
                Cancel
              </s-button>
              <s-button
                tone="critical"
                loading={isPrivacySubmitting}
                onClick={deletePrivacyData}
              >
                Delete permanently
              </s-button>
            </div>
          </div>
        </div>
      )}

      {activeModal && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-modal-title"
          >
            <div className={styles.modalHeader}>
              <h2 id="contact-modal-title">{activeModal.title}</h2>
              <s-button variant="tertiary" onClick={closeModal}>
                Close
              </s-button>
            </div>
            <p>{activeModal.intro}</p>
            <form
              className={styles.formGrid}
              onSubmit={(event) => {
                event.preventDefault();
                submitForm();
              }}
            >
              <label>
                <span>{activeModal.messageLabel}</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.currentTarget.value)}
                  placeholder={activeModal.messagePlaceholder}
                  rows={5}
                />
              </label>
              <label>
                <span>Subject</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.currentTarget.value)}
                  placeholder={activeModal.subjectPlaceholder}
                />
              </label>
              <label>
                <span>Reply email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  placeholder="you@store.com"
                />
              </label>
              <div className={styles.modalActions}>
                <s-button type="button" variant="tertiary" onClick={closeModal}>
                  Cancel
                </s-button>
                <s-button
                  type="button"
                  variant="primary"
                  disabled={!message.trim() || isSubmitting}
                  loading={isSubmitting}
                  onClick={submitForm}
                >
                  {isSubmitting ? "Sending..." : activeModal.primary}
                </s-button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

async function getProductPulseDataCounts(shop) {
  const [
    sources,
    jobs,
    jobLogs,
    riskSnapshots,
    diagnoses,
    actions,
    retentionRuns,
    retentionSummaries,
    retentionCohortCells,
    timelineEvents,
    watchlistItems,
    watchSettings,
    watchActivities,
    scoreHistory,
    aiConversations,
    aiConversationMessages,
    aiUsageEvents,
    aiActionProposals,
    aiAppDraftProposals,
    creditEntries,
    contacts,
    sessions,
  ] = await Promise.all([
    db.productPulseSource.count({ where: { shop } }),
    db.catalogSignalJob.count({ where: { shop } }),
    db.productPulseJobLog.count({ where: { shop } }),
    db.productRiskSnapshot.count({ where: { shop } }),
    db.productDiagnosis.count({ where: { shop } }),
    db.productAction.count({ where: { shop } }),
    db.productRetentionRun.count({ where: { shopId: shop } }),
    db.productRetentionSummary.count({ where: { shopId: shop } }),
    db.productRetentionCohortCell.count({ where: { shopId: shop } }),
    db.productTimelineEvent.count({ where: { shop } }),
    db.productWatchlistItem.count({ where: { shop } }),
    db.productWatchSettings.count({ where: { shop } }),
    db.productWatchActivity.count({ where: { shop } }),
    db.productScoreHistory.count({ where: { shop } }),
    db.aiConversation.count({ where: { shop } }),
    db.aiConversationMessage.count({ where: { shop } }),
    db.aiUsageEvent.count({ where: { shop } }),
    db.aiActionProposal.count({ where: { shop } }),
    db.aiAppDraftProposal.count({ where: { shop } }),
    db.creditLedgerEntry.count({ where: { shop } }),
    db.contactRequest.count({ where: { shop } }),
    db.session.count({ where: { shop } }),
  ]);

  return {
    sources,
    jobs,
    jobLogs,
    riskSnapshots,
    diagnoses,
    actions,
    retentionRuns,
    retentionSummaries,
    retentionCohortCells,
    timelineEvents,
    watchlistItems,
    watchSettings,
    watchActivities,
    scoreHistory,
    aiConversations,
    aiConversationMessages,
    aiUsageEvents,
    aiActionProposals,
    aiAppDraftProposals,
    creditEntries,
    contacts,
    sessions,
  };
}

async function deleteProductPulseData(shop) {
  await db.$transaction([
    db.aiAppDraftAuditLog.deleteMany({ where: { shop } }),
    db.aiAppDraftProposal.deleteMany({ where: { shop } }),
    db.aiActionAuditLog.deleteMany({ where: { shop } }),
    db.aiActionProposal.deleteMany({ where: { shop } }),
    db.aiConversationToolCall.deleteMany({ where: { shop } }),
    db.aiConversationMessage.deleteMany({ where: { shop } }),
    db.aiConversation.deleteMany({ where: { shop } }),
    db.aiUsageEvent.deleteMany({ where: { shop } }),
    db.productAction.deleteMany({ where: { shop } }),
    db.productTimelineEvent.deleteMany({ where: { shop } }),
    db.productRetentionSummary.deleteMany({ where: { shopId: shop } }),
    db.productRetentionSegmentDaily.deleteMany({ where: { shopId: shop } }),
    db.productRetentionDailyActivity.deleteMany({ where: { shopId: shop } }),
    db.productRetentionCohortCell.deleteMany({ where: { shopId: shop } }),
    db.productRetentionDailyCohort.deleteMany({ where: { shopId: shop } }),
    db.productRetentionRun.deleteMany({ where: { shopId: shop } }),
    db.productDiagnosis.deleteMany({ where: { shop } }),
    db.productRiskSnapshot.deleteMany({ where: { shop } }),
    db.productWatchActivity.deleteMany({ where: { shop } }),
    db.productWatchlistItem.deleteMany({ where: { shop } }),
    db.productWatchSettings.deleteMany({ where: { shop } }),
    db.productScoreHistory.deleteMany({ where: { shop } }),
    db.productPulseJobLog.deleteMany({ where: { shop } }),
    db.catalogSignalJob.deleteMany({ where: { shop } }),
    db.productPulseSource.deleteMany({ where: { shop } }),
    db.creditLedgerEntry.deleteMany({ where: { shop } }),
    db.contactRequest.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}

function formatProductPulseCounts(counts) {
  return [
    `${counts.riskSnapshots} risk snapshot(s)`,
    `${counts.diagnoses} diagnosis record(s)`,
    `${counts.actions} ProductPulse action(s)`,
    `${counts.retentionRuns} retention run(s)`,
    `${counts.timelineEvents} timeline event(s)`,
    `${counts.watchlistItems} watchlist product(s)`,
    `${counts.watchActivities} watch activity record(s)`,
    `${counts.scoreHistory} score history record(s)`,
    `${counts.aiConversations} AI conversation(s)`,
    `${counts.aiUsageEvents} AI usage event(s)`,
    `${counts.sources} source record(s)`,
    `${counts.contacts} contact request(s)`,
  ].join(", ");
}

function HelpIcon({ type }) {
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

  if (type === "spark") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2L12 3Z" />
        <path d="M5 4v3" />
        <path d="M3.5 5.5h3" />
      </svg>
    );
  }

  if (type === "coverage") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 12a8 8 0 1 1 8 8" />
        <path d="M12 4v8l5 3" />
        <path d="M4 20h5" />
      </svg>
    );
  }

  if (type === "evidence") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 4h14v16H5z" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    );
  }

  if (type === "actions") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
        <path d="M5 5v14" />
      </svg>
    );
  }

  if (type === "email") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 6h16v12H4z" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }

  if (type === "lock") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 10h12v10H6z" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 5h16v11H7l-3 3V5Z" />
      <path d="M8 9h8" />
      <path d="M8 12h5" />
    </svg>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
