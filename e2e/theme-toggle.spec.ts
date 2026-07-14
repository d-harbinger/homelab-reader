import { test, expect } from "@playwright/test";

// Light-mode gate. The palette is a zinc-scale CSS-variable remap under
// html[data-theme="light"] (globals.css) — this spec proves the three
// moving parts: the header toggle flips the attribute and repaints the
// chrome, the choice persists across a reload (the layout.tsx boot
// script), and toggling back restores the dark chrome. Screenshots land
// in e2e/screenshots/ for human review of the actual palettes.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };

// Tailwind v4 emits wide-gamut color functions, so the computed
// background arrives as lab()/oklch()/rgb() depending on the pipeline.
// Rather than string-match a format, measure lightness: zinc-950 is
// near-black (L ≈ 2), the light remap near-white (L ≈ 98). rgb() falls
// back to a channel average scaled to 0–100.
async function bodyLightness(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const nums = bg.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    if (bg.startsWith("rgb")) {
      const [r, g, b] = nums;
      return ((r + g + b) / 3 / 255) * 100;
    }
    return nums[0] ?? NaN; // lab()/oklch(): first component is lightness
  });
}

test("theme toggle: light remap applies, persists across reload, reverts", async ({ page }) => {
  // Create the first admin, or log in when another spec in the same run
  // already did — same order-tolerant bootstrap the textquote spec uses.
  await page.goto("/setup");
  const setupOffered = await page
    .getByRole("heading", { name: /welcome to homelab-reader/i })
    .isVisible()
    .catch(() => false);
  if (setupOffered) {
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.fill("#confirm", ADMIN.password);
    await page.getByRole("button", { name: /create admin/i }).click();
    // First-run step 2 (privacy choice): decline online lookups so the
    // suite runs fully offline.
    await page.waitForURL("**/setup/privacy");
    await page.getByRole("button", { name: /keep everything offline/i }).click();
  } else {
    await page.goto("/login");
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
  }
  await page.waitForURL("**/");

  // Dark is the default: no data-theme attribute, near-black chrome.
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  expect(await bodyLightness(page)).toBeLessThan(20);
  await page.screenshot({ path: "e2e/screenshots/theme-dark.png", fullPage: false });

  // Toggle → attribute set, chrome repaints to the light remap.
  await page.getByRole("button", { name: /switch to light mode/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyLightness(page)).toBeGreaterThan(90);
  await page.screenshot({ path: "e2e/screenshots/theme-light.png", fullPage: false });

  // Reload → the boot script re-applies the stored choice before paint.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyLightness(page)).toBeGreaterThan(90);

  // Toggle back → dark chrome, and the choice sticks on reload too.
  await page.getByRole("button", { name: /switch to dark mode/i }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  expect(await bodyLightness(page)).toBeLessThan(20);
  await page.reload();
  expect(await bodyLightness(page)).toBeLessThan(20);
});
