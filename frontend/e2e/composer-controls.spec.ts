import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const STYLES = [
  { value: "concise", label: "短め" },
  { value: "balanced", label: "ふつう" },
  { value: "detailed", label: "詳しく" },
  { value: "beginner", label: "やさしく" },
];
const SILENT_WAV = silentWav();

interface SentMessage {
  readonly message: string;
  readonly response_style: string;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
  await page.route("**/api/speech/health", route => route.fulfill({ json: {
    status: "ready", provider: "voicevox", speaker_id: 14, engine_version: null,
    speaker_name: null, style_name: null, credit: null, message: "音声エンジンに接続しました。",
  } }));
  // Generated silence exercises the real playback queue, without VOICEVOX or private audio.
  await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/wav", body: SILENT_WAV }));
});

function observeMessages(page: Page): SentMessage[] {
  const messages: SentMessage[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/dialogue/stream" && request.method() === "POST") {
      messages.push(request.postDataJSON() as SentMessage);
    }
  });
  return messages;
}

async function expectReady(page: Page, replyCount: number): Promise<void> {
  await expect(page.locator("#dialogue-log .is-assistant:not(.is-streaming)")).toHaveCount(replyCount);
  await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
  await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "ready");
  await expect(page.getByRole("button", { name: "直前の音声をもう一度再生", exact: true })).toBeEnabled();
}

async function expectComposerLayout(page: Page, originalInputWidth: number): Promise<void> {
  const surface = page.locator(".composer-surface");
  const form = page.locator("#dialogue-form");
  await expect(surface).toHaveCount(1);
  await expect(surface.locator(".composer-tools")).toHaveCount(1);
  await expect(surface.locator("#dialogue-form")).toHaveCount(1);
  await expect(form.locator("#response-style-select, #speech-control")).toHaveCount(0);
  await expect(page.locator("#speech-control")).toHaveAttribute("type", "button");
  await expect(form).toBeInViewport();

  const toolsBox = await surface.locator(".composer-tools").boundingBox();
  const formBox = await form.boundingBox();
  expect(toolsBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(toolsBox!.y + toolsBox!.height).toBeLessThanOrEqual(formBox!.y + 1);

  for (const selector of ["#response-style-select", "#speech-control", "#voice-input-control", "#dialogue-submit"]) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    await expect(control).toBeInViewport();
    const bounds = await control.boundingBox();
    expect(bounds, selector).not.toBeNull();
    expect(bounds!.width, `${selector} touch width`).toBeGreaterThanOrEqual(44);
    expect(bounds!.height, `${selector} touch height`).toBeGreaterThanOrEqual(44);
  }
  const inputBox = await page.locator("#dialogue-input").boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.width).toBeGreaterThanOrEqual(140);
  expect(inputBox!.width).toBeCloseTo(originalInputWidth, 1);
  expect(inputBox!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const viewport of VIEWPORTS) {
  test(`the integrated composer preserves all four styles, request values and touch targets at ${viewport.width}px`, async ({ page }) => {
    const messages = observeMessages(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    const style = page.getByRole("combobox", { name: "話し方", exact: true });
    const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
    await expect(input).toBeEnabled();
    await expect(style).toHaveValue("balanced");
    expect(await style.locator("option").evaluateAll(options => options.map(option => ({
      value: (option as HTMLOptionElement).value,
      label: option.textContent,
    })))).toEqual(STYLES);
    const initialInputBox = await input.boundingBox();
    expect(initialInputBox).not.toBeNull();
    const sentBefore = messages.length;

    await input.fill("まだ送らない下書き");
    await style.focus();
    await style.press("Home");
    await expect(style).toHaveValue("concise");
    await style.press("ArrowDown");
    await expect(style).toHaveValue("balanced");
    await expect(input).toHaveValue("まだ送らない下書き");
    expect(messages).toHaveLength(sentBefore);

    for (const [index, option] of STYLES.entries()) {
      await style.selectOption(option.value);
      await expect(style.locator("option:checked")).toHaveText(option.label);
      expect(messages).toHaveLength(sentBefore + index);
      const message = `こんにちは、${option.label}で話そう`;
      await input.fill(message);
      await page.getByRole("button", { name: "送信", exact: true }).click();
      await expectReady(page, index + 1);
      expect(messages).toHaveLength(sentBefore + index + 1);
      expect(messages.at(-1)).toMatchObject({ message, response_style: option.value });
    }
    await expectComposerLayout(page, initialInputBox!.width);
  });
}

test("generation disables style and speech controls but keeps cancellation and recovery usable", async ({ page }) => {
  const heldMessage = "この返答は途中で止める";
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requestHeld = false;
  await page.route("**/api/dialogue/stream", async route => {
    if ((route.request().postDataJSON() as SentMessage).message !== heldMessage) {
      await route.continue();
      return;
    }
    requestHeld = true;
    await gate;
    await route.abort("aborted").catch(() => undefined);
  });
  await page.route("**/api/dialogue/sessions/*/active", route => route.fulfill({ json: {
    session_id: new URL(route.request().url()).pathname.split("/").at(-2), cancelled: true,
  } }));
  await page.goto("/");
  const style = page.getByRole("combobox", { name: "話し方", exact: true });
  const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
  await expect(input).toBeEnabled();
  await style.selectOption("detailed");
  try {
    await input.fill(heldMessage);
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expect.poll(() => requestHeld).toBe(true);
    await expect(style).toBeDisabled();
    await expect(style).toHaveValue("detailed");
    await expect(input).toBeDisabled();
    await expect(page.locator("#speech-control")).toBeVisible();
    await expect(page.locator("#speech-control")).toBeDisabled();
    const stop = page.getByRole("button", { name: "応答を停止", exact: true });
    await expect(stop).toBeEnabled();
    await stop.click();
    release();
    await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
    await expect(style).toBeEnabled();
    await expect(input).toBeEnabled();
    await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(0);
    await expect(page.locator("#toast")).toContainText("応答を停止しました");
    await style.selectOption("concise");
    await input.fill("こんにちは");
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expectReady(page, 1);
  } finally {
    release();
  }
});

for (const viewport of VIEWPORTS) {
  test(`settings and modes preserve the draft and style, and replay or stop never sends it at ${viewport.width}px`, async ({ page }) => {
    // Multiple native playback cycles and mode changes need a larger total budget; individual waits stay unchanged.
    test.setTimeout(90_000);
    await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/wav", body: silentWav(2000) }));
    const messages = observeMessages(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
    const style = page.getByRole("combobox", { name: "話し方", exact: true });
    await expect(input).toBeEnabled();
    await input.fill("こんにちは");
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expectReady(page, 1);
    const sentBeforeReplay = messages.length;
    const draft = "この下書きは再生操作では送らない";
    await input.fill(draft);
    await style.selectOption("beginner");

    const settings = page.getByRole("button", { name: "設定", exact: true });
    await settings.click();
    await expect(page.getByRole("dialog", { name: "設定", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await expect(input).toHaveValue(draft);
    await expect(style).toHaveValue("beginner");

    await page.getByRole("tab", { name: "体験", exact: true }).click();
    await expect(page.locator("#experience-start")).toBeVisible();
    await page.getByRole("tab", { name: "対話", exact: true }).click();
    await expect(input).toHaveValue(draft);
    await expect(style).toHaveValue("beginner");
    await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);

    const replay = page.getByRole("button", { name: "直前の音声をもう一度再生", exact: true });
    await expect(replay).toBeEnabled();
    await replay.click();
    await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "playing");
    const stopSpeech = page.getByRole("button", { name: "現在の音声処理を停止", exact: true });
    await expect(stopSpeech).toBeEnabled();
    await stopSpeech.click();
    await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "stopped");
    await expect(replay).toBeEnabled();
    await expect(input).toHaveValue(draft);
    await expect(style).toHaveValue("beginner");
    expect(messages).toHaveLength(sentBeforeReplay);
    await replay.click();
    await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "playing");
    await expect(page.locator("#speech-status")).toHaveAttribute("data-speech-state", "ready");
    await expect(input).toHaveValue(draft);
    await expect(style).toHaveValue("beginner");
    expect(messages).toHaveLength(sentBeforeReplay);
    // Only replay needs the longer observation window; the next turn keeps normal playback short.
    await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/wav", body: SILENT_WAV }));
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expectReady(page, 2);
    expect(messages).toHaveLength(sentBeforeReplay + 1);
    expect(messages.at(-1)).toMatchObject({ message: draft, response_style: "beginner" });
  });
}

function silentWav(durationMs = 320): Buffer {
  const samples = Math.round(8000 * durationMs / 1000);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  return wav;
}
