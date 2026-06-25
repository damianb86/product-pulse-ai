import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));

const { serializeError } = await import("../../app/lib/product-pulse-job-logs.server");

describe("ProductPulse job log helpers", () => {
  it("serializes thrown Response objects with useful fields", () => {
    const response = new Response("Internal failure", {
      status: 500,
      statusText: "Internal Server Error",
    });

    expect(serializeError(response)).toMatchObject({
      name: "Response",
      message: "500 Internal Server Error",
      status: 500,
      statusText: "Internal Server Error",
      ok: false,
    });
  });
});
