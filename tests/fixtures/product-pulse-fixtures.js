import { billing, getAppViewData, products, sourceGroups } from "../../app/lib/product-pulse-data";
import { REQUIRED_SHOPIFY_SCOPES } from "../../app/lib/product-pulse-scopes";

export const installedShop = {
  shop: "damian-xdcxxupp",
  scopes: REQUIRED_SHOPIFY_SCOPES,
  credits: billing.creditsAvailable,
};

export const newShop = {
  shop: "new-damian-xdcxxupp",
  scopes: REQUIRED_SHOPIFY_SCOPES.filter((scope) => scope === "read_products"),
  credits: 0,
};

export const missingScopeShop = {
  shop: "limited-damian-xdcxxupp",
  scopes: REQUIRED_SHOPIFY_SCOPES.filter((scope) => scope !== "read_returns"),
  missingScopes: ["read_returns"],
};

export const expiredSessionShop = {
  shop: "expired-damian-xdcxxupp",
  session: "expired",
};

export const productFixtures = products;
export const sourceFixtures = sourceGroups;
export const defaultView = getAppViewData();

export const graphqlSuccess = {
  data: {
    products: {
      nodes: productFixtures.map((product) => ({ id: product.id, title: product.title, handle: product.handle })),
    },
  },
};

export const graphqlTopLevelError = {
  errors: [{ message: "Access denied for returns.", path: ["returns"] }],
};

export const graphqlUserErrors = {
  data: {
    productUpdate: {
      product: null,
      userErrors: [{ field: ["id"], message: "Product does not exist." }],
    },
  },
};

export const aiValidDiagnosis = {
  likelyCause: "Sizing copy does not match customer fit expectations.",
  confidence: 0.86,
  issues: [{ type: "fit", label: "Runs small" }],
  recommendations: [{ type: "faq", label: "Add sizing FAQ" }],
};

export const aiInvalidDiagnosis = { likelyCause: "", confidence: 1.4 };
export const aiEmptyDiagnosis = null;
