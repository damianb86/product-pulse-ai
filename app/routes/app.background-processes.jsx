import { useLoaderData } from "react-router";
import { BackgroundProcessesScreen } from "../components/ProductPulseScreens";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { getBackgroundProcessesForShop } from "../lib/product-pulse-jobs.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return {
    data: {
      backgroundProcesses: await getBackgroundProcessesForShop(session.shop),
      developmentMode: isProductPulseDevelopment(),
    },
  };
};

export default function BackgroundProcesses() {
  const { data } = useLoaderData();
  return <BackgroundProcessesScreen data={data} />;
}
