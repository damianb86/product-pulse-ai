import privacyStylesheet from "../styles/privacy-policy.css?url";

const CONTACT_EMAIL = "contact@zuam.dev";
const LAST_UPDATED = "June 2, 2026";

export const links = () => [
  { rel: "stylesheet", href: privacyStylesheet },
];

export const meta = () => [
  { title: "Privacy Policy | ProductPulse AI" },
  {
    name: "description",
    content:
      "ProductPulse AI privacy policy for Shopify merchants, including data collection, processing purposes, AI providers, retention, security, and privacy rights.",
  },
];

export default function PrivacyPolicy() {
  return (
    <main className="ppLegalPage">
      <section className="ppLegalHero" aria-labelledby="privacy-title">
        <div className="ppLegalHeroInner">
          <p className="ppLegalEyebrow">ProductPulse AI</p>
          <h1 id="privacy-title">Privacy Policy</h1>
          <p>
            This policy explains how ProductPulse AI collects, uses, shares,
            retains, and protects data when merchants install and use the app.
          </p>
          <div className="ppLegalHeroMeta" aria-label="Privacy policy metadata">
            <span>Last updated: {LAST_UPDATED}</span>
            <span>Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></span>
          </div>
        </div>
      </section>

      <section className="ppLegalShell" aria-label="Privacy policy content">
        <nav className="ppLegalNav" aria-label="Privacy policy sections">
          <a href="#summary">Summary</a>
          <a href="#data-we-collect">Data we collect</a>
          <a href="#how-we-use-data">How we use data</a>
          <a href="#ai-processing">AI processing</a>
          <a href="#sharing">Sharing</a>
          <a href="#retention">Retention</a>
          <a href="#rights">Rights</a>
          <a href="#resources">Resources</a>
        </nav>

        <div className="ppLegalContent">
          <PolicySection id="summary" eyebrow="Overview" title="Summary">
            <div className="ppLegalSummaryGrid">
              <SummaryCard
                title="What the app does"
                body="ProductPulse AI helps Shopify merchants identify product-level operational risk from catalog, order, return, refund, review, retention, and purchase-pattern signals."
              />
              <SummaryCard
                title="Main purpose"
                body="We process merchant store data to calculate product risk, generate Product Diagnosis records, show evidence, monitor watched products, and prepare merchant-reviewed action drafts."
              />
              <SummaryCard
                title="What we do not do"
                body="We do not sell personal data, use merchant or customer data for behavioral advertising, or track storefront visitors outside the merchant admin workflow."
              />
              <SummaryCard
                title="Merchant control"
                body="Merchants control app installation, source connections, CSV imports, watchlist settings, alert recipients, and which recommended actions are reviewed or applied."
              />
            </div>
          </PolicySection>

          <PolicySection id="data-we-collect" eyebrow="Collection" title="Data We Collect">
            <p>
              ProductPulse AI collects the minimum data needed to provide the
              product analysis, monitoring, support, billing, and security
              features selected by the merchant.
            </p>
            <div className="ppLegalTwoColumn">
              <InfoBlock title="Shop and account data">
                <ul>
                  <li>Shop domain, app installation state, granted scopes, and Shopify session tokens.</li>
                  <li>Staff user identifiers and contact details when Shopify provides them for embedded app authentication.</li>
                  <li>Support requests, beta feedback, page context, and contact email addresses supplied by the merchant.</li>
                </ul>
              </InfoBlock>
              <InfoBlock title="Catalog and product data">
                <ul>
                  <li>Product identifiers, titles, handles, descriptions, vendors, product types, tags, collections, variants, SKUs, prices, media, SEO fields, and selected metafields.</li>
                  <li>Inventory and location signals when needed to understand product availability and catalog context.</li>
                </ul>
              </InfoBlock>
              <InfoBlock title="Orders, returns, refunds, and retention">
                <ul>
                  <li>Order, line-item, variant, quantity, revenue, refund, return, exchange, replacement, and status information connected to analyzed products.</li>
                  <li>Return reasons, refund notes, customer notes, timestamps, and order IDs used to build evidence, timelines, and return/refund resolution views.</li>
                  <li>Customer identifiers when available from Shopify, used to calculate cohort, retention, repeat-purchase, basket, and product relationship metrics.</li>
                </ul>
              </InfoBlock>
              <InfoBlock title="Reviews and optional sources">
                <ul>
                  <li>Review ratings, review text, review dates, product identifiers, and source metadata from merchant-connected review services.</li>
                  <li>CSV review imports uploaded by the merchant, including mapped product identifiers, ratings, text, and dates.</li>
                  <li>Connection health, source preferences, credentials, and sync metadata for merchant-configured sources.</li>
                </ul>
              </InfoBlock>
              <InfoBlock title="App activity and AI records">
                <ul>
                  <li>Catalog scans, Product Diagnosis jobs, job logs, risk snapshots, evidence, recommendations, score history, watchlist activity, action records, and credit ledger entries.</li>
                  <li>AI conversations, tool calls, app-owned draft proposals, audit logs, model usage events, token usage, and estimated AI cost metadata.</li>
                </ul>
              </InfoBlock>
              <InfoBlock title="Billing data">
                <ul>
                  <li>Subscription status, credit purchases, credit usage, billing plan names, Shopify billing identifiers, and payment confirmation references.</li>
                  <li>ProductPulse AI does not collect or store payment card numbers. Paid plans and credit packs are approved through Shopify Billing.</li>
                </ul>
              </InfoBlock>
            </div>
          </PolicySection>

          <PolicySection id="how-we-use-data" eyebrow="Purpose" title="How We Use Data">
            <ul className="ppLegalChecklist">
              <li>Authenticate merchants and provide the embedded Shopify admin experience.</li>
              <li>Read product, order, return, refund, review, and catalog signals selected by the merchant.</li>
              <li>Calculate product risk, impact, confidence, return/refund metrics, retention metrics, Sales Momentum, basket behavior, and product relationship insights.</li>
              <li>Create Product Diagnosis records with issues, evidence, likely causes, recommendations, and product timelines.</li>
              <li>Monitor watchlisted products, compare changes against baselines, and send merchant-configured alerts.</li>
              <li>Prepare ProductPulse-owned action drafts, recommendations, and audit records for merchant review.</li>
              <li>Operate credits, subscriptions, billing history, support, security, abuse prevention, troubleshooting, and legal compliance.</li>
            </ul>
          </PolicySection>

          <PolicySection id="ai-processing" eyebrow="AI" title="AI Processing and Automated Output">
            <p>
              ProductPulse AI uses deterministic calculations and bounded AI
              synthesis. AI may summarize evidence, classify issue themes,
              explain metrics, draft ProductPulse action records, and answer
              merchant questions inside the app.
            </p>
            <div className="ppLegalNotice">
              <strong>Merchant review stays required.</strong>
              <span>
                AI output is not a final business decision. Product scores,
                recommendations, chat responses, and action drafts are provided
                for merchant review. The assistant does not directly change
                Shopify products from chat.
              </span>
            </div>
            <p>
              Prompts sent to AI providers may include product metadata,
              calculated metrics, review excerpts, return/refund context,
              merchant chat messages, and app-owned records needed to answer the
              merchant request. We do not use merchant or customer data to build
              advertising profiles.
            </p>
          </PolicySection>

          <PolicySection id="sharing" eyebrow="Processors" title="How We Share Data">
            <p>
              We share data only as needed to operate ProductPulse AI, provide
              merchant-selected integrations, comply with law, or protect the
              app. We do not sell personal data.
            </p>
            <div className="ppLegalProcessorList">
              <ProcessorItem
                name="Shopify"
                purpose="App authentication, Admin API access, privacy webhooks, and Shopify Billing."
              />
              <ProcessorItem
                name="AI providers"
                purpose="OpenAI and Google Gemini may process prompts, responses, tool context, and usage metadata to provide AI analysis and chat features."
              />
              <ProcessorItem
                name="Review services"
                purpose="Judge.me, Loox, and Yotpo are used only when a merchant connects them to retrieve product review evidence."
              />
              <ProcessorItem
                name="Email provider"
                purpose="SMTP email services may process support messages, setup requests, and watchlist alert emails."
              />
              <ProcessorItem
                name="Infrastructure providers"
                purpose="Hosting, database, logging, and security providers process data required to run, monitor, and protect the app."
              />
            </div>
          </PolicySection>

          <PolicySection id="retention" eyebrow="Lifecycle" title="Retention, Deletion, and Compliance Webhooks">
            <p>
              We keep merchant store data while the app is installed and for as
              long as needed to provide analysis history, watchlist monitoring,
              auditability, billing records, support, security, and legal
              compliance. We minimize customer-level data by transforming it
              into product-level metrics, cohorts, counts, evidence, and
              timelines wherever practical.
            </p>
            <ul className="ppLegalChecklist">
              <li>When Shopify sends a customer data request, we review ProductPulse records for the relevant shop and process the request according to Shopify privacy requirements.</li>
              <li>When Shopify sends a customer redaction request, ProductPulse removes customer-linked order references from stored product timeline records where the requested order IDs are present.</li>
              <li>When Shopify sends a shop redaction request, ProductPulse deletes app-owned records for that shop, including sessions, sources, scans, diagnoses, actions, watchlist data, AI records, feedback, contact requests, credit records, and retention summaries.</li>
              <li>Merchants can also contact us to request a data summary or deletion of ProductPulse app-owned records.</li>
            </ul>
          </PolicySection>

          <PolicySection id="security" eyebrow="Protection" title="Security">
            <p>
              We use administrative, technical, and organizational safeguards to
              protect data. Access tokens and source credentials are kept
              server-side. Connections use HTTPS/TLS where supported. Access to
              production systems is limited to people and providers who need it
              to operate, secure, or support the app.
            </p>
            <p>
              No online service can guarantee absolute security. Merchants
              should remove unused integrations, rotate source credentials when
              needed, and avoid uploading unnecessary personal data in CSV files
              or support messages.
            </p>
          </PolicySection>

          <PolicySection id="rights" eyebrow="Control" title="Merchant and Customer Rights">
            <p>
              Merchants are responsible for their own privacy notices, lawful
              basis, consent management, and customer communications for data
              they choose to process through ProductPulse AI. ProductPulse AI
              supports merchant and customer privacy requests through Shopify
              compliance webhooks and direct support requests.
            </p>
            <ul className="ppLegalChecklist">
              <li>Merchants can disconnect optional sources and stop CSV imports at any time.</li>
              <li>Merchants can pause or remove watchlisted products and disable watchlist alerts.</li>
              <li>Merchants can request access, correction, export, or deletion of ProductPulse app-owned records by contacting us.</li>
              <li>Customers can exercise rights through the merchant, and Shopify privacy webhooks help ProductPulse process applicable requests.</li>
            </ul>
          </PolicySection>

          <PolicySection id="international" eyebrow="Transfers" title="International Processing">
            <p>
              ProductPulse AI and its service providers may process data in
              countries other than the merchant's or customer's country. Where
              required, we rely on appropriate contractual, organizational, and
              technical safeguards for cross-border processing.
            </p>
          </PolicySection>

          <PolicySection id="changes" eyebrow="Updates" title="Changes to This Policy">
            <p>
              We may update this policy when ProductPulse AI changes, when
              Shopify requirements change, or when legal requirements require an
              update. The latest version will be posted on this page with a new
              last updated date.
            </p>
          </PolicySection>

          <PolicySection id="resources" eyebrow="Help" title="Resources and Contact">
            <div className="ppLegalResourceGrid">
              <a className="ppLegalResource" href={`mailto:${CONTACT_EMAIL}`}>
                <strong>Privacy and support requests</strong>
                <span>{CONTACT_EMAIL}</span>
              </a>
              <a className="ppLegalResource" href="/app/help">
                <strong>In-app Help and Contact</strong>
                <span>Installed merchants can open help from the app navigation.</span>
              </a>
              <a
                className="ppLegalResource"
                href="https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance"
                rel="noreferrer"
                target="_blank"
              >
                <strong>Shopify privacy webhooks</strong>
                <span>Shopify documentation for mandatory compliance webhooks.</span>
              </a>
            </div>
          </PolicySection>
        </div>
      </section>
    </main>
  );
}

function PolicySection({ id, eyebrow, title, children }) {
  return (
    <section className="ppLegalSection" id={id}>
      <p className="ppLegalSectionEyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <div className="ppLegalSectionBody">{children}</div>
    </section>
  );
}

function SummaryCard({ title, body }) {
  return (
    <article className="ppLegalSummaryCard">
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function InfoBlock({ title, children }) {
  return (
    <article className="ppLegalInfoBlock">
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function ProcessorItem({ name, purpose }) {
  return (
    <article className="ppLegalProcessorItem">
      <h3>{name}</h3>
      <p>{purpose}</p>
    </article>
  );
}
