import { redirect } from "react-router";
import prisma from "../../db.server";
import {
  buildRootAppRedirectHref,
  getDefaultRootAppTargetPath,
} from "../../lib/product-pulse-app-paths";
import { authenticate } from "../../shopify.server";

export const meta = () => [
  { title: "ProductPulse AI" },
  {
    name: "description",
    content: "ProductPulse AI opens inside Shopify Admin.",
  },
];

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (!url.searchParams.get("shop")) {
    return redirect(buildRootAppRedirectHref(url, "/landing"));
  }

  const { session } = await authenticate.admin(request);
  const hasStoredProducts = await shopHasStoredProducts(session.shop);
  const targetPath = getDefaultRootAppTargetPath(hasStoredProducts);

  return redirect(buildRootAppRedirectHref(url, targetPath, session.shop));
};

export default function RootIndex() {
  return null;
}

async function shopHasStoredProducts(shop) {
  if (!shop) return false;

  const rollup = await prisma.productPulseProductRollup.findFirst({
    where: { shop },
    select: { id: true },
  });

  if (rollup) return true;

  const snapshot = await prisma.productRiskSnapshot.findFirst({
    where: { shop },
    select: { id: true },
  });

  return Boolean(snapshot);
}
