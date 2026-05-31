import { describe, expect, it } from "vitest";
import { parseGraphqlResponse, validateDiagnosisOutput } from "../../app/lib/product-pulse-validation";
import {
  aiEmptyDiagnosis,
  aiInvalidDiagnosis,
  aiValidDiagnosis,
  graphqlSuccess,
  graphqlTopLevelError,
  graphqlUserErrors,
} from "../fixtures/product-pulse-fixtures";

describe("ProductPulse validation", () => {
  it("accepts GraphQL success payloads", () => {
    expect(parseGraphqlResponse(graphqlSuccess)).toMatchObject({ ok: true });
  });

  it("collects GraphQL top-level errors", () => {
    const parsed = parseGraphqlResponse(graphqlTopLevelError);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0]).toMatchObject({ type: "graphql" });
  });

  it("collects GraphQL userErrors recursively", () => {
    const parsed = parseGraphqlResponse(graphqlUserErrors);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0]).toMatchObject({ type: "userError", message: "Product does not exist." });
  });

  it("validates Product Diagnosis output shape", () => {
    expect(validateDiagnosisOutput(aiValidDiagnosis)).toMatchObject({ valid: true });
    expect(validateDiagnosisOutput(aiInvalidDiagnosis).valid).toBe(false);
    expect(validateDiagnosisOutput(aiEmptyDiagnosis).valid).toBe(false);
  });
});
