import { describe, expect, it } from "vitest";
import {
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

  it("leaves root-mounted app paths unchanged", () => {
    expect(buildEmbeddedAppPath("/app/dashboard", "/app/products")).toBe("/app/products");
    expect(buildEmbeddedApiPath("/app/dashboard", "/api/beta-feedback")).toBe("/api/beta-feedback");
  });
});
