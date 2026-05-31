import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductMetricTimelinesScreen } from "../components/ProductPulseScreens";
import { getProductDetailForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);

  return {
    product: await getProductDetailForShop(session.shop, params.productId, admin),
  };
};

export default function ProductMetricTimelines() {
  const { product } = useLoaderData();
  return <ProductMetricTimelinesScreen product={product} />;
}
