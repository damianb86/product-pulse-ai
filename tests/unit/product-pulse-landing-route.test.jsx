import { describe, expect, it } from "vitest";
import { buildAppRouteHref, buildPublicRouteHref } from "../../app/routes/_index/route.jsx";

describe("product pulse landing route hrefs", () => {
  it("builds dashboard hrefs inside the Shopify app proxy and preserves auth params", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia?embedded=1&hmac=signed&host=encoded-host&id_token=jwt&locale=en&session=session-token&shop=demo-shop.myshopify.com&timestamp=1780595434&wizard=old");

    expect(buildAppRouteHref(url, "/app/dashboard", { wizard: "start" }))
      .toBe("/apps/product-pulse-ia/app/dashboard?embedded=1&hmac=signed&host=encoded-host&id_token=jwt&locale=en&session=session-token&shop=demo-shop.myshopify.com&timestamp=1780595434&wizard=start");
    expect(buildAppRouteHref(url, "/app/dashboard"))
      .toBe("/apps/product-pulse-ia/app/dashboard?embedded=1&hmac=signed&host=encoded-host&id_token=jwt&locale=en&session=session-token&shop=demo-shop.myshopify.com&timestamp=1780595434");
  });

  it("builds public hrefs inside the Shopify app proxy", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia?embedded=1&host=encoded-host&locale=en&shop=demo-shop.myshopify.com");

    expect(buildPublicRouteHref(url, "/"))
      .toBe("/apps/product-pulse-ia/?shop=demo-shop.myshopify.com&host=encoded-host&embedded=1&locale=en");
  });

  it("falls back to auth when the landing URL is missing shop context", () => {
    const url = new URL("https://app-ppa.zuam.dev/apps/product-pulse-ia");

    expect(buildAppRouteHref(url, "/app/dashboard")).toBe("/auth/login");
  });
});
