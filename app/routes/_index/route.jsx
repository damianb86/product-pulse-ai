import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>ProductPulse AI</h1>
        <p className={styles.text}>
          Detect why products create returns, refunds and bad reviews, then turn the evidence into Shopify-ready catalog actions.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Catalog Signal Scan</strong>. Product, order, refund, return and review signals are ranked by product risk.
          </li>
          <li>
            <strong>AI Product Diagnosis</strong>. Deep diagnosis explains likely cause, evidence, impact and recommended actions.
          </li>
          <li>
            <strong>Draft Shopify actions</strong>. Fit notes, FAQs, tags and support notes are prepared for merchant review.
          </li>
        </ul>
      </div>
    </div>
  );
}
