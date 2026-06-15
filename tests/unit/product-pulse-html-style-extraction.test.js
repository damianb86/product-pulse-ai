import { describe, expect, it } from "vitest";
import { __productPulseHtmlStyleExtractionTestHooks } from "../../app/lib/product-pulse-html-style-extraction.server";

describe("ProductPulse HTML style extraction", () => {
  it("normalizes extracted templates into safe ProductPulse wrappers", () => {
    const result = __productPulseHtmlStyleExtractionTestHooks.normalizeHtmlStyleExtraction({
      template: "<div onclick=\"bad()\"><script>bad()</script><h3>Theme title</h3><img src=\"https://example.com/a.jpg\"><p>{{CONTENT_HTML}}</p></div>",
      summary: "Uses heading spacing and simple paragraph rhythm.",
      styleNotes: ["Heading spacing", "Paragraph rhythm"],
    }, {
      title: "Canvas Lamp",
    });

    expect(result.template).toContain("{{ATTRIBUTES}}");
    expect(result.template).toContain("{{TITLE}}");
    expect(result.template).toContain("{{CONTENT_HTML}}");
    expect(result.template).not.toMatch(/script|onclick|img|src=/i);
    expect(result.summary).toBe("Uses heading spacing and simple paragraph rhythm.");
    expect(result.styleNotes).toEqual(["Heading spacing", "Paragraph rhythm"]);
  });
});
