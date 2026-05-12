import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("preview screens have no critical axe violations", async ({ page }) => {
  await page.goto("/preview");

  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();

  const critical = results.violations.filter((violation) => violation.impact === "critical");
  expect(critical).toEqual([]);
});
