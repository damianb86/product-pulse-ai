import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const filters = {
    query: url.searchParams.get("q") || "",
    risk: url.searchParams.get("risk") || "all",
  };

  return { data: getAppViewData(filters), filters };
};

export default function Products() {
  const { data, filters } = useLoaderData();
  return <ProductsScreen data={data} filters={filters} />;
}
