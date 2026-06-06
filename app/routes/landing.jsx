import styles from "./_index/styles.module.css";

export const meta = () => [
  { title: "Open ProductPulse AI from Shopify" },
  {
    name: "description",
    content: "ProductPulse AI starts from Shopify Admin after installation.",
  },
];

export default function LandingFallback() {
  return (
    <main className={styles.fallbackPage}>
      <section className={styles.fallbackCard} aria-labelledby="landing-fallback-title">
        <span className={styles.fallbackMark} aria-hidden="true">P</span>
        <div className={styles.fallbackCopy}>
          <p className={styles.fallbackEyebrow}>ProductPulse AI</p>
          <h1 id="landing-fallback-title">Open ProductPulse AI from Shopify</h1>
          <p>
            ProductPulse AI starts from Shopify Admin after installation. Open the app from your Shopify store to load the correct shop, billing, credits, products, and diagnostics.
          </p>
          <div className={styles.fallbackActions}>
            <a className={styles.fallbackPrimaryButton} href="https://admin.shopify.com/">Open Shopify Admin</a>
            <a className={styles.fallbackSecondaryButton} href="/privacy-policy">Privacy policy</a>
          </div>
        </div>
      </section>
    </main>
  );
}
