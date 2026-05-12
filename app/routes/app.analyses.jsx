import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AnalysesScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return getAppViewData();
};

export default function Analyses() {
  const data = useLoaderData();
  return <AnalysesScreen data={data} />;
}
