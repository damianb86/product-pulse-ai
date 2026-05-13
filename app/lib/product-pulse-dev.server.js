export function isProductPulseDevelopment() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PLAYWRIGHT_PREVIEW === "true" ||
    process.env.PRODUCT_PULSE_DEV_PANEL === "true" ||
    process.env.SHOPIFY_APP_ENV === "development"
  );
}
