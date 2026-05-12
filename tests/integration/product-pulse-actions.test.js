import { describe, expect, it } from "vitest";
import {
  applyDraftAction,
  runCatalogSignalScan,
  startProductDiagnosis,
} from "../../app/lib/product-pulse-data";

describe("ProductPulse actions", () => {
  it("creates a running scan state", () => {
    expect(runCatalogSignalScan()).toMatchObject({
      status: "success",
      job: { status: "Running", progress: 8 },
    });
  });

  it("starts diagnosis and consumes one credit", () => {
    expect(startProductDiagnosis("core-linen-trouser", 3)).toMatchObject({
      status: "success",
      creditsRemaining: 2,
    });
  });

  it("blocks diagnosis without credits", () => {
    expect(startProductDiagnosis("core-linen-trouser", 0)).toMatchObject({
      status: "validation_error",
    });
  });

  it("validates draft action application", () => {
    expect(applyDraftAction("core-linen-trouser", "fit-note")).toMatchObject({ status: "success" });
    expect(applyDraftAction("core-linen-trouser", "missing")).toMatchObject({ status: "validation_error" });
  });
});
