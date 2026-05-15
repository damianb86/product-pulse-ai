import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductEvidenceReportScreen } from "../components/ProductPulseScreens";
import { getProductDetailForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  return {
    product: await getProductDetailForShop(session.shop, params.productId, admin),
    source: url.searchParams.get("source") || "",
  };
};

export default function ProductEvidenceReport() {
  const { product, source } = useLoaderData();
  return <ProductEvidenceReportScreen product={product} source={source} />;
}
