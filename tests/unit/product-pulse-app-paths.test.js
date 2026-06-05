import { describe, expect, it } from "vitest";
import {
  buildEmbeddedAppHref,
  buildEmbeddedApiPath,
  buildEmbeddedAppPath,
  getEmbeddedAppBasePath,
  getEmbeddedAppPathname,
} from "../../app/lib/product-pulse-app-paths";

describe("product pulse embedded app paths", () => {
  it("preserves Shopify app proxy prefixes for internal app navigation", () => {
    const currentPathname = "/apps/product-pulse-ia/app/dashboard";

    expect(getEmbeddedAppBasePath(currentPathname)).toBe("/apps/product-pulse-ia");
    expect(getEmbeddedAppPathname(currentPathname)).toBe("/app/dashboard");
    expect(buildEmbeddedAppPath(currentPathname, "/app/products")).toBe("/apps/product-pulse-ia/app/products");
    expect(buildEmbeddedApiPath(currentPathname, "/api/beta-feedback")).toBe("/apps/product-pulse-ia/api/beta-feedback");
  });

  it("preserves Shopify embedded params when building internal app hrefs", () => {
    const currentPathname = "/apps/product-pulse-ia/app/dashboard";
    const currentSearch = "?shop=demo-shop.myshopify.com&host=encoded-host&embedded=1&locale=en";

    expect(buildEmbeddedAppHref(currentPathname, "/app/credits-summary", { currentSearch }))
      .toBe("/apps/product-pulse-ia/app/credits-summary?shop=demo-shop.myshopify.com&host=encoded-host&embedded=1&locale=en");
    expect(buildEmbeddedAppHref(currentPathname, "/app/job-status?scope=popover", { currentSearch }))
      .toBe("/apps/product-pulse-ia/app/job-status?scope=popover&shop=demo-shop.myshopify.com&host=encoded-host&embedded=1&locale=en");
  });

  it("adds the loader shop fallback when the current URL is missing shop", () => {
    expect(buildEmbeddedAppHref("/app/dashboard", "/app/credits-summary", { shop: "fallback-shop.myshopify.com" }))
      .toBe("/app/credits-summary?shop=fallback-shop.myshopify.com");
  });

  it("leaves root-mounted app paths unchanged", () => {
    expect(buildEmbeddedAppPath("/app/dashboard", "/app/products")).toBe("/app/products");
    expect(buildEmbeddedApiPath("/app/dashboard", "/api/beta-feedback")).toBe("/api/beta-feedback");
  });
});
