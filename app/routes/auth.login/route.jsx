import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const { errors } = loaderData;
  const hasError = Boolean(errors?.shop);

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Open ProductPulse AI from Shopify">
          <s-text>
            {hasError
              ? "The installation request was missing a valid Shopify shop. Return to Shopify Admin and open ProductPulse AI from Apps."
              : "ProductPulse AI starts from Shopify Admin after installation."}
          </s-text>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
