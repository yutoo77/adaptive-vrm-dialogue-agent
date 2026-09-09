import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
});

async function enter(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await page.locator("#experience-start").click();
  await expect(page.locator("#experience-reply")).toContainText("小さな箱");
  await expect(page.locator("#experience-workspace")).toHaveAttribute("aria-busy", "false");
}

async function place(page: Page, moons: string[]): Promise<void> {
  for (const [index, moon] of moons.entries()) {
    await page.locator(`[data-moon="${moon}"]`).click();
    await page.locator(`[data-slot="${index}"]`).click();
    await expect(page.locator(`[data-slot="${index}"]`)).toHaveAttribute("data-filled", "true");
    await expect(page.locator("#experience-workspace")).toHaveAttribute("aria-busy", "false");
  }
}

test("experience completes without AI, retains wrong placement, and restarts only itself", async ({ page }) => {
  await page.goto("/");
  await enter(page);
  await page.locator('[data-inspect="letter"]').click();
  await expect(page.locator("#experience-reply")).toContainText("細い月は、半分の月より後ろに");
  await place(page, ["crescent", "full", "half"]);
  await page.locator("#experience-submit").click();
  await expect(page.locator("#experience-reply")).toContainText("まだ開かない");
  await expect(page.locator('[data-slot="0"]')).toContainText("細い月");
  await page.locator("#experience-hint").click();
  await expect(page.locator("#experience-workspace")).toHaveAttribute("aria-busy", "false");
  await place(page, ["half", "full", "crescent"]);
  await page.locator("#experience-submit").click();
  await expect(page.locator("#experience-ending")).toBeVisible();
  await expect(page.locator("#experience-scene")).toHaveAttribute("data-solved", "true");
  await expect(page.locator("#experience-submit")).toBeHidden();
  await page.locator("#experience-restart").click();
  await page.getByRole("dialog").getByRole("button", { name: "続ける", exact: true }).click();
  await expect(page.locator("#experience-ending")).toBeVisible();
  await page.locator("#experience-restart").click();
  await page.getByRole("dialog").getByRole("button", { name: "最初から始める", exact: true }).click();
  await expect(page.locator("#experience-progress")).toHaveText("調べた場所 0 / 3");
  await expect(page.locator("#experience-ending")).toBeHidden();
});

test("mode round trips preserve both drafts, ordinary history and the same canvas", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialogue-input").fill("こんにちは");
  await page.locator("#dialogue-submit").click();
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  await page.locator("#dialogue-input").fill("通常の下書き");
  const canvas = await page.locator(".character-viewport canvas").elementHandle();
  expect(canvas).not.toBeNull();
  await enter(page);
  await page.locator('[data-inspect="window"]').click();
  await expect(page.locator("#experience-progress")).toHaveText("調べた場所 1 / 3");
  await page.locator("#experience-input").fill("体験の下書き");
  await page.getByRole("tab", { name: "対話", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("通常の下書き");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  expect(await page.locator(".character-viewport canvas").evaluate((node, original) => node === original, canvas)).toBe(true);
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await expect(page.locator("#experience-workspace")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#experience-input")).toHaveValue("体験の下書き");
  await expect(page.locator("#experience-progress")).toHaveText("調べた場所 1 / 3");
  expect(await page.locator("#experience-avatar-slot canvas").evaluate((node, original) => node === original, canvas)).toBe(true);
  await canvas?.dispose();
});

test("narrow screens and unavailable voice still allow puzzle play", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await enter(page);
    await page.locator('[data-inspect="letter"]').click();
    await expect(page.locator("#experience-reply")).toContainText("丸い月は真ん中");
    await page.locator("#experience-input").fill("どこから考えたらいい？");
    await page.locator("#experience-send").click();
    await expect(page.locator("#experience-input")).toHaveValue("");
    await expect(page.locator("#experience-speech-status")).toContainText("Text回答");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator("#experience-workspace").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await place(page, ["half", "full", "crescent"]);
    await page.locator("#experience-submit").click();
    await expect(page.locator("#experience-ending")).toBeVisible();
  }
});

test("workspace tabs support arrow keys without losing the ordinary draft", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialogue-input").fill("キーボードの下書き");
  await page.getByRole("tab", { name: "対話", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "体験", exact: true })).toBeFocused();
  await expect(page.locator("#experience-start")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "対話", exact: true })).toBeFocused();
  await expect(page.locator("#dialogue-input")).toHaveValue("キーボードの下書き");
});
