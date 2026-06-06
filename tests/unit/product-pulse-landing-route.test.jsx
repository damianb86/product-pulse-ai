import { describe, expect, it } from "vitest";
import {
  buildLandingAppRouteHref,
  buildLandingPublicRouteHref,
  buildRootAppRedirectHref,
  getDefaultRootAppTargetPath,
} from "../../app/lib/product-pulse-app-paths";

describe("product pulse landing route hrefs", () => {
  it("builds dashboard hrefs inside the Shopify app proxy and preserves auth params", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia?embedded=1&hmac=signed&host=encoded-host&id_token=jwt&locale=en&session=session-token&shop=demo-shop.myshopify.com&timestamp=1780595434&wizard=old");

    expect(buildLandingAppRouteHref(url, "/app/dashboard", { wizard: "start" }))
      .toBe("/apps/product-pulse-ia/app/dashboard?embedded=1&hmac=signed&host=encoded-host&id_token=jwt&locale=en&session=session-token&shop=demo-shop.myshopify.com&timestamp=1780595434&wizard=start");
    expect(buildLandingAppRouteHref(url, "/app/dashboard"))
      .toBe("/apps/product-pulse-ia/app/dashboard?embedded=1&hmac=signed&host=encoded-host&id_token=jwt&locale=en&session=session-token&shop=demo-shop.myshopify.com&timestamp=1780595434");
  });

  it("builds public hrefs inside the Shopify app proxy", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia?embedded=1&host=encoded-host&locale=en&shop=demo-shop.myshopify.com");

    expect(buildLandingPublicRouteHref(url, "/"))
      .toBe("/apps/product-pulse-ia/?shop=demo-shop.myshopify.com&host=encoded-host&embedded=1&locale=en");
  });

  it("falls back to auth when the landing URL is missing shop context", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia");

    expect(buildLandingAppRouteHref(url, "/app/dashboard")).toBe("/auth/login");
  });

  it("chooses products as the default app screen when stored products exist", () => {
    expect(getDefaultRootAppTargetPath(true)).toBe("/app/products");
    expect(getDefaultRootAppTargetPath(false)).toBe("/app/dashboard");
  });

  it("builds root app redirects inside the Shopify app proxy", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia?embedded=1&host=encoded-host&locale=en&shop=demo-shop.myshopify.com");

    expect(buildRootAppRedirectHref(url, "/app/products", "demo-shop.myshopify.com"))
      .toBe("/apps/product-pulse-ia/app/products?shop=demo-shop.myshopify.com&host=encoded-host&embedded=1&locale=en");
  });
});
