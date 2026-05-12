export function parseGraphqlResponse(responseJson) {
  const errors = [];

  if (Array.isArray(responseJson?.errors)) {
    errors.push(
      ...responseJson.errors.map((error) => ({
        type: "graphql",
        message: error.message || "Shopify returned a GraphQL error.",
        path: error.path || [],
      })),
    );
  }

  collectUserErrors(responseJson?.data).forEach((error) => errors.push(error));

  return {
    ok: errors.length === 0,
    errors,
    data: responseJson?.data || null,
  };
}

export function collectUserErrors(value, path = []) {
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUserErrors(item, [...path, index]));
  }

  const current = Array.isArray(value.userErrors)
    ? value.userErrors.map((error) => ({
        type: "userError",
        message: error.message || "Shopify rejected the operation.",
        field: error.field || [],
        path,
      }))
    : [];

  return [
    ...current,
    ...Object.entries(value)
      .filter(([key]) => key !== "userErrors")
      .flatMap(([key, child]) => collectUserErrors(child, [...path, key])),
  ];
}

export function validateDiagnosisOutput(output) {
  const errors = [];

  if (!output || typeof output !== "object") {
    return { valid: false, errors: ["Diagnosis output must be an object."] };
  }

  if (!output.likelyCause || typeof output.likelyCause !== "string") {
    errors.push("likelyCause is required.");
  }

  if (!Array.isArray(output.issues) || output.issues.length === 0) {
    errors.push("At least one issue is required.");
  }

  if (!Array.isArray(output.recommendations) || output.recommendations.length === 0) {
    errors.push("At least one recommendation is required.");
  }

  if (typeof output.confidence !== "number" || output.confidence < 0 || output.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1.");
  }

  return { valid: errors.length === 0, errors };
}

export function validateProductAction(productId, actionId, products) {
  const product = products.find((item) => item.id === productId || item.slug === productId);
  if (!product) {
    return { valid: false, message: "Product was not found." };
  }

  const action = product.recommendedActions.find((item) => item.id === actionId);
  if (!action) {
    return { valid: false, message: "Recommended action was not found." };
  }

  return { valid: true, product, action };
}
