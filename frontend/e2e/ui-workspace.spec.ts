import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // UI controls should work identically on CI without a private VRM asset.
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
});

test("settings preserve the draft, contain focus and return it on Escape", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
  await input.fill("まだ送っていない下書き");
  await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "unavailable");
  const before = await page.locator("#dialogue-form").boundingBox();
  const opener = page.getByRole("button", { name: "設定", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "設定", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "設定を閉じる" })).toBeFocused();
  const voice = page.getByRole("tab", { name: "音声", exact: true });
  await voice.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "記憶", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "記憶", exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "キャラクター", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(voice).toBeFocused();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(input).toHaveValue("まだ送っていない下書き");
  expect(await page.locator("#dialogue-form").boundingBox()).toEqual(before);
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
});

test("speech failure has a readable summary, details and a usable text fallback", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
  await input.fill("こんにちは");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("#speech-status-summary")).toContainText("文字で会話できます");
  const details = page.getByRole("button", { name: "音声出力の詳細", exact: true });
  await details.click();
  await expect(page.getByRole("tab", { name: "音声", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#speech-status-message")).toBeVisible();
  await expect(page.locator("#speech-status-message")).toContainText("VOICEVOX");
  await page.getByRole("button", { name: "設定を閉じる" }).click();
  await expect(details).toBeFocused();
  await expect(input).toBeEnabled();
  await input.fill("文字で続けます");
  await input.press("Enter");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(2);
});

test("explicit memories remain editable inside settings without resetting the conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "メッセージ", exact: true }).fill("こんにちは");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "記憶", exact: true }).click();
  await page.getByRole("textbox", { name: "記憶へ追加する内容" }).fill("UIテスト専用の架空設定：青が好き");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  const item = page.locator(".persistent-memory-item").first();
  await expect(item.locator("textarea")).toHaveValue("UIテスト専用の架空設定：青が好き");
  await item.locator("textarea").fill("UIテスト専用の架空設定：白が好き");
  await item.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#toast")).toBeVisible();
  await expect(page.locator("#settings-dialog #toast")).toHaveCount(1);
  await item.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.locator(".persistent-memory-item")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
});

test("small screens keep the whole composer reachable without horizontal scrolling", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
    await input.fill("こんにちは");
    await input.press("Enter");
    await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
    await expect(page.locator("#speech-status-summary")).toContainText("文字で会話できます");
    const bounds = await page.locator("#dialogue-form").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("tab", { name: "キャラクター", exact: true }).click();
    expect(await page.locator(".settings-body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "設定を閉じる" }).click();
  }
});

test("multiline drafts grow without submitting during IME composition", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
  await input.fill("日本語の入力");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.locator("#dialogue-log .is-user")).toHaveCount(0);
  await input.press("Shift+Enter");
  await input.press("End");
  await input.fill("一行目\n二行目\n三行目\n四行目\n五行目");
  expect((await input.boundingBox())!.height).toBeGreaterThan(44);
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(128);
  await input.press("Enter");
  await expect(page.locator("#dialogue-log .is-user p")).toContainText("五行目");
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "新しい会話", exact: true }).click();
  await expect(page.getByRole("heading", { name: "何から話そう？" })).toBeVisible();
  expect((await input.boundingBox())!.height).toBe(44);
});

test("missing VRM offers a keyboard-accessible file picker while text remains usable", async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
  await page.goto("/");
  const picker = page.locator("#empty-guide").getByRole("button", { name: "VRMファイルを選ぶ" });
  await expect(picker).toBeVisible();
  await picker.focus();
  const chooserEvent = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserEvent;
  expect(chooser.isMultiple()).toBe(false);
  await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toBeEnabled();
});
