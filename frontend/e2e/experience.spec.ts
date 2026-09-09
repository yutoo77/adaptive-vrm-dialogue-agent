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
  await expect(page.locator('[data-inspect="letter"]')).toHaveAttribute("data-inspected", "false");
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
  await expect(page.locator('[data-inspect="window"]')).toHaveAttribute("data-inspected", "true");
  await page.locator("#experience-input").fill("体験の下書き");
  await page.getByRole("tab", { name: "対話", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("通常の下書き");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  expect(await page.locator(".character-viewport canvas").evaluate((node, original) => node === original, canvas)).toBe(true);
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await expect(page.locator("#experience-workspace")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#experience-input")).toHaveValue("体験の下書き");
  await expect(page.locator('[data-inspect="window"]')).toHaveAttribute("data-inspected", "true");
  expect(await page.locator("#experience-avatar-slot canvas").evaluate((node, original) => node === original, canvas)).toBe(true);
  await canvas?.dispose();
});

test("narrow screens and unavailable voice still allow puzzle play", async ({ page }, testInfo) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await enter(page);
    await page.locator('[data-inspect="letter"]').click();
    await expect(page.locator("#experience-reply")).toContainText("丸い月は真ん中");
    await page.locator("#experience-input").fill("どこから考えたらいい？");
    await page.locator("#experience-send").click();
    await expect(page.locator("#experience-input")).toHaveValue("");
    await expect(page.locator("#experience-speech-status")).toContainText("文字で続けられます");
    await expect(page.locator("#experience-speech-detail")).toBeHidden();
    await page.locator("#experience-audio-info summary").click();
    await expect(page.locator("#experience-speech-detail")).toContainText("Text回答");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator("#experience-workspace").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await place(page, ["half", "full", "crescent"]);
    await page.locator("#experience-submit").click();
    await expect(page.locator("#experience-ending")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`experience-${viewport.width}.png`), fullPage: true });
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

test("experience keeps supporting copy closed but exposes controls and communication details", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  const workspace = page.locator("#experience-workspace");
  await expect(workspace.getByRole("heading", { name: "月待ちの便り" })).toBeVisible();
  await expect(workspace.getByText("自動保存なし", { exact: true })).toBeVisible();
  await expect(workspace).not.toContainText("しずくと、ひとつの物語");
  await expect(workspace).not.toContainText("あなたに見えるもの");
  await expect(workspace).not.toContainText("余韻を楽しんで");
  await page.locator("#experience-start").click();
  await expect(page.locator("#experience-reply")).toContainText("小さな箱");
  await expect(page.locator("#experience-feedback")).toBeHidden();
  await expect(page.locator("#experience-provider")).toHaveText("相談：定型応答・外部送信なし");
  await expect(page.locator("#experience-provider-detail")).toBeHidden();
  await expect(page.locator("#experience-narration-source")).toBeHidden();
  await page.locator("#experience-provider").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#experience-provider-detail")).toBeVisible();
  await expect(page.locator("#experience-narration-source")).toHaveText("今の返事：定型文");
  await page.locator(".exp-help summary").click();
  await expect(page.locator(".exp-help")).toContainText("手元に戻せます");
  await page.locator('[data-moon="full"]').click();
  await expect(page.locator("#experience-selection")).toHaveText("丸い月 → 置く枠を選ぶ");
  await page.locator('[data-slot="0"]').click();
  await expect(page.locator('[data-moon="full"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-slot="0"]').click();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute("data-filled", "false");
});

test("API cost stays visible, healthy voice stays quiet, and fallback notices remain visible", async ({ page }) => {
  // Only change the displayed provider; puzzle requests still use the isolated Mock server.
  await page.route("**/api/health", async route => {
    const response = await route.fetch();
    const health: unknown = await response.json();
    await route.fulfill({ response, json: { ...(health as object), provider: "openai" } });
  });
  await page.route("**/api/speech/health", route => route.fulfill({ json: {
    status: "ready", provider: "voicevox", speaker_id: 14, engine_version: "test",
    speaker_name: "テスト", style_name: "ノーマル", credit: "テスト", message: "音声エンジンの長い正常説明",
  } }));
  await page.route("**/api/transcription/health", route => route.fulfill({ json: {
    status: "ready", provider: "faster-whisper", model: "test", device: "cpu", compute_type: "int8", message: "音声入力の長い正常説明",
  } }));
  await page.goto("/");
  await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "available");
  await expect(page.locator("#voice-input-control")).toBeEnabled();
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await expect(page.locator("#experience-speech-status")).toHaveText("");
  await page.locator("#experience-start").click();
  await expect(page.locator("#experience-reply")).toContainText("小さな箱");
  await expect(page.locator("#experience-provider")).toHaveText("相談：外部API・従量課金");
  await expect(page.locator("#experience-voice-status")).toHaveText("");
  await expect(page.locator("#experience-provider-detail")).toBeHidden();
  await page.locator("#experience-provider").click();
  await expect(page.locator("#experience-provider-detail")).toContainText("直近履歴12件");
  await expect(page.locator("#experience-provider-detail")).toContainText("盤面の状態");
  await expect(page.locator("#experience-provider-detail")).toContainText("通常の対話・記憶は送りません");
  await page.route("**/api/experience/action", async route => {
    const response = await route.fetch();
    const snapshot: unknown = await response.json();
    await route.fulfill({ response, json: { ...(snapshot as object), notice: "相談AIは利用できないため、固定の応答で続けます。" } });
  });
  await page.locator("#experience-input").fill("一緒に考えよう");
  await page.locator("#experience-send").click();
  await expect(page.locator("#experience-feedback")).toBeVisible();
  await expect(page.locator("#experience-feedback-text")).toContainText("固定の応答で続けます");
});

test("blocked autoplay offers a visible manual play action and clears after playback", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let blockOnce = true;
    HTMLMediaElement.prototype.play = function () {
      if (blockOnce) {
        blockOnce = false;
        return Promise.reject(new DOMException("Test autoplay restriction", "NotAllowedError"));
      }
      return play.call(this);
    };
  });
  await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/wav", body: silentWav() }));
  await page.goto("/");
  await enter(page);
  await expect(page.locator("#experience-speech-status")).toHaveText("自動再生できません。「再生」を押してください。");
  await expect(page.locator("#experience-speech-detail")).toBeHidden();
  await page.locator("#experience-audio-info summary").click();
  await expect(page.locator("#experience-speech-detail")).toContainText("自動再生できませんでした");
  await page.locator("#experience-conversation").getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.locator("#experience-speech-status")).toHaveText("");
  await expect(page.locator("#experience-speech-detail")).toHaveText("");
  await expect(page.locator("#experience-speech")).toHaveText("もう一度聞く");
});

function silentWav(): Buffer {
  const samples = 1600;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  return wav;
}
