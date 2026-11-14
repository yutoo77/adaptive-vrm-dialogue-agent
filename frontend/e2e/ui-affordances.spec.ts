import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
});

async function focusUsingTab(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("The icon control was not reachable with Tab");
}

async function focusLabel(target: Locator): Promise<{ display: string; content: string }> {
  return target.evaluate(element => {
    const style = getComputedStyle(element, "::after");
    return { display: style.display, content: style.content };
  });
}

async function expectLabelFits(target: Locator): Promise<void> {
  const size = await target.evaluate(element => {
    const style = getComputedStyle(element, "::after");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Text measurement is unavailable");
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textWidth = context.measureText(element.getAttribute("aria-label") ?? "").width;
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const contentWidth = parseFloat(style.width) - (style.boxSizing === "border-box" ? padding : 0);
    return { contentWidth, textWidth };
  });
  expect(size.contentWidth).toBeGreaterThanOrEqual(size.textWidth - 1);
}

test("scene icons expose short names for hover and keyboard use without permanent labels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
  await input.fill("送信前の下書き");
  const adjust = page.getByRole("button", { name: "キャラクターを調整", exact: true });
  const history = page.getByRole("button", { name: "会話履歴を開く", exact: true });
  const reset = page.getByRole("button", { name: "新しい会話", exact: true });

  for (const control of [adjust, history, reset]) {
    const name = await control.getAttribute("aria-label");
    await expect(control).toHaveAttribute("title", name!);
    expect((await focusLabel(control)).display).toBe("none");
  }

  await focusUsingTab(page, adjust);
  expect(await focusLabel(adjust)).toEqual({ display: "block", content: '"キャラクターを調整"' });
  await expectLabelFits(adjust);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "キャラクター", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(adjust).toBeFocused();
  await expect(input).toHaveValue("送信前の下書き");

  await focusUsingTab(page, history);
  expect(await focusLabel(history)).toEqual({ display: "block", content: '"会話履歴を開く"' });
  await expectLabelFits(history);
  expect((await focusLabel(adjust)).display).toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "会話履歴", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toBeFocused();
  await expect(input).toHaveValue("送信前の下書き");

  await input.press("Enter");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  await expect(reset).toBeEnabled();
  await focusUsingTab(page, reset);
  expect(await focusLabel(reset)).toEqual({ display: "block", content: '"新しい会話"' });
  await expectLabelFits(reset);
  await page.keyboard.press("Enter");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "何から話そう？" })).toBeVisible();
});

test.describe("touch access without hover", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("scene controls and the fixed-reply disclosure are reachable by tapping", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#dialogue-provider")).toHaveText("定型応答");
    await expect(page.locator("#dialogue-provider")).toHaveAttribute("title", "定型応答・外部送信なし");

    await page.getByRole("button", { name: "キャラクターを調整", exact: true }).tap();
    await expect(page.getByRole("tab", { name: "キャラクター", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "設定を閉じる" }).tap();
    await page.getByRole("button", { name: "会話履歴を開く", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: "会話履歴", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "履歴を閉じる" }).tap();
    await page.getByRole("button", { name: "新しい会話", exact: true }).tap();
    await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "設定", exact: true }).tap();
    const privacy = page.locator("#dialogue-privacy");
    await privacy.scrollIntoViewIfNeeded();
    await expect(privacy).toBeVisible();
    await expect(privacy).toContainText("ローカルLLMではありません");
    await expect(privacy).toContainText("外部送信はしません");
    await expect(privacy).toContainText("明示登録した記憶だけ");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test("OpenAI keeps external transmission visible and explains context and cost in settings", async ({ page }) => {
  // Display-only health fixture: no request is sent to an external LLM.
  await page.route("**/api/health", async route => {
    const response = await route.fetch();
    const health: unknown = await response.json();
    await route.fulfill({ response, json: { ...(health as object), provider: "openai" } });
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#dialogue-provider")).toHaveText("OpenAI");
    await expect(page.locator("#dialogue-provider-note")).toBeVisible();
    await expect(page.locator("#dialogue-provider-note")).toHaveText("会話をAPIへ送信");
    await page.getByRole("button", { name: "設定", exact: true }).click();
    const privacy = page.locator("#dialogue-privacy");
    await privacy.scrollIntoViewIfNeeded();
    await expect(privacy).toContainText("入力・直近の会話・要約・関連する長期記憶");
    await expect(privacy).toContainText("従量課金");
    await expect(privacy).toContainText("VRMと録音音声は送信しません");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});
