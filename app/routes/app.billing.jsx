import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { SourcesBillingScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return getAppViewData();
};

export default function SourcesBilling() {
  const data = useLoaderData();
  return <SourcesBillingScreen data={data} />;
}
