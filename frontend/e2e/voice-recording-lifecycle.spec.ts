import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    let activeTracks = 0;
    let permissionRequests = 0;
    const recorders: FakeRecorder[] = [];
    const update = () => {
      document.documentElement.dataset["testActiveTracks"] = String(activeTracks);
      document.documentElement.dataset["testPermissions"] = String(permissionRequests);
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      permissionRequests++; activeTracks++; update();
      let stopped = false;
      return { getTracks: () => [{ stop: () => { if (!stopped) { activeTracks--; stopped = true; update(); } } }] };
    } });
    class FakeRecorder {
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      queued: (() => void) | null = null;
      constructor() { recorders.push(this); }
      start() {
        this.state = "recording";
        const data = this.ondataavailable; const stop = this.onstop; const error = this.onerror;
        this.queued = () => { data?.({ data: new Blob(["OBSOLETE"]) }); stop?.(); error?.(); };
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["CURRENT"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
    document.addEventListener("test:old-recorder", () => recorders[0]?.queued?.());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "音声で入力", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator("#voice-auto-stop").uncheck();
  await page.getByRole("button", { name: "設定を閉じる", exact: true }).click();
});

async function holdTranscript(page: Page) {
  let held: Route | undefined;
  await page.route("**/api/transcription", route => { held = route; });
  return async (text: string) => {
    await expect.poll(() => !!held).toBe(true);
    await held!.fulfill({ json: { text, language: "ja", language_probability: 1,
      audio_duration_seconds: 1, request_id: "fake-delayed", latency_ms: 10 } });
  };
}

async function enterExperience(page: Page) {
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await page.locator("#experience-start").click();
  await expect(page.locator("#experience-workspace")).toHaveAttribute("aria-busy", "false");
}

async function record(page: Page, mode: "dialogue" | "experience") {
  const microphone = page.locator(mode === "dialogue" ? "#voice-input-control" : "#experience-microphone");
  await microphone.click();
  await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "1");
  await microphone.click();
  await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "0");
}

for (const mode of ["dialogue", "experience"] as const) {
  test(`over-limit ${mode} dictation is retained in full, blocks sending, and can be edited`, async ({ page }) => {
    const complete = await holdTranscript(page);
    if (mode === "experience") await enterExperience(page);
    const input = page.locator(mode === "dialogue" ? "#dialogue-input" : "#experience-input");
    const send = page.locator(mode === "dialogue" ? "#dialogue-submit" : "#experience-send");
    const max = mode === "dialogue" ? 1000 : 500;
    let sends = 0;
    page.on("request", request => {
      if (request.url().endsWith(mode === "dialogue" ? "/api/dialogue/stream" : "/api/experience/action")) sends++;
    });
    await input.fill("文".repeat(max));
    await record(page, mode); await complete("追記🌙");
    await expect(input).toHaveValue("文".repeat(max) + "\n追記🌙");
    await expect(input).toBeEnabled();
    await expect(input).toHaveJSProperty("validationMessage", `${max}文字以内に短くしてから送信してください。`);
    await send.click();
    expect(sends).toBe(0);
    await expect(input).toHaveValue("文".repeat(max) + "\n追記🌙");
    await input.fill("短く直した文");
    await expect(input).toHaveJSProperty("validationMessage", "");
    await send.click();
    await expect.poll(() => sends).toBe(1);
    await expect(input).toHaveValue("");
  });
}

test("experience dictation preserves processing-time edits, focus and selection without auto-send", async ({ page }) => {
  const complete = await holdTranscript(page);
  await enterExperience(page);
  const input = page.locator("#experience-input");
  let sends = 0;
  page.on("request", request => { if (request.url().endsWith("/api/experience/action")) sends++; });
  await input.fill("録音前");
  await record(page, "experience");
  await input.fill("待っている間に修正");
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 4, "backward"));
  await complete("声の追記");
  await expect(input).toHaveValue("待っている間に修正\n声の追記");
  await expect(input).toBeFocused();
  await expect(input).toHaveJSProperty("selectionStart", 2);
  await expect(input).toHaveJSProperty("selectionEnd", 4);
  await expect(input).toHaveJSProperty("selectionDirection", "backward");
  expect(sends).toBe(0);
});

for (const switchMode of [false, true]) {
  test(`IME-pending dictation ${switchMode ? "is discarded on mode switch" : "waits for composition and final input"}`, async ({ page }) => {
    const complete = await holdTranscript(page);
    await enterExperience(page);
    const input = page.locator("#experience-input");
    await record(page, "experience");
    await input.fill("みかくてい");
    await input.dispatchEvent("compositionstart", { data: "みかくてい" });
    await complete("声の追記");
    await expect(page.locator("#experience-microphone")).toHaveText("マイク");
    await expect(input).toHaveValue("みかくてい");
    await expect(input).toHaveJSProperty("validationMessage", "文字入力を確定してから送信してください。");
    if (switchMode) await page.getByRole("tab", { name: "対話", exact: true }).click();
    await input.evaluate((element: HTMLTextAreaElement) => {
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "未確定" }));
      element.value = "未確定";
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
    });
    if (switchMode) {
      await expect(page.locator("#dialogue-input")).toHaveValue("");
      await page.getByRole("tab", { name: "体験", exact: true }).click();
    }
    await expect(input).toHaveValue(switchMode ? "未確定" : "未確定\n声の追記");
    await expect(input).toHaveJSProperty("validationMessage", "");
  });
}

test("a processing result cancelled by a mode change cannot reach either draft", async ({ page }) => {
  const complete = await holdTranscript(page);
  await page.locator("#dialogue-input").fill("対話を残す");
  await record(page, "dialogue");
  await enterExperience(page);
  await page.locator("#experience-input").fill("体験も残す");
  await complete("取消済みの声");
  await page.getByRole("tab", { name: "対話", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("対話を残す");
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await expect(page.locator("#experience-input")).toHaveValue("体験も残す");
});

test("mode cancellation and immediate re-record ignore obsolete media events and never auto-send", async ({ page }) => {
  const uploads: string[] = [];
  let dialogueRequests = 0;
  await page.route("**/api/transcription", async route => {
    uploads.push(route.request().postDataBuffer()?.toString() ?? "");
    await route.fulfill({ json: { text: "新しい録音だけ", language: "ja", language_probability: 1,
      audio_duration_seconds: 1, request_id: "fake-asr", latency_ms: 10 } });
  });
  page.on("request", request => { if (request.url().endsWith("/api/dialogue/stream")) dialogueRequests++; });
  await page.locator("#dialogue-input").fill("対話の下書き");
  await page.getByRole("button", { name: "音声で入力", exact: true }).click();
  await expect(page.getByRole("button", { name: "録音を停止して認識", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "0");
  await page.locator("#experience-start").click();
  await page.locator("#experience-input").fill("体験の下書き");
  await page.getByRole("tab", { name: "対話", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("対話の下書き");
  await page.getByRole("button", { name: "音声で入力", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "1");
  await page.evaluate(() => document.dispatchEvent(new Event("test:old-recorder")));
  await expect(page.getByRole("button", { name: "録音を停止して認識", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "1");
  await page.getByRole("button", { name: "録音を停止して認識", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("対話の下書き\n新しい録音だけ");
  await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "0");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain("CURRENT"); expect(uploads[0]).not.toContain("OBSOLETE");
  expect(dialogueRequests).toBe(0);
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await expect(page.locator("#experience-input")).toHaveValue("体験の下書き");
});

test("twenty mode-bound recordings release every fake track and preserve both drafts", async ({ page }) => {
  let uploads = 0;
  page.on("request", request => { if (request.url().endsWith("/api/transcription")) uploads++; });
  await page.locator("#dialogue-input").fill("対話は残す");
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await page.locator("#experience-start").click();
  await page.locator("#experience-input").fill("体験も残す");
  for (let turn = 0; turn < 10; turn++) {
    await page.locator("#experience-microphone").click();
    await expect(page.locator("#experience-microphone")).toHaveText("録音を終える");
    await page.getByRole("tab", { name: "対話", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "0");
    await page.getByRole("button", { name: "音声で入力", exact: true }).click();
    await expect(page.getByRole("button", { name: "録音を停止して認識", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "体験", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "0");
  }
  await expect(page.locator("html")).toHaveAttribute("data-test-permissions", "20");
  await expect(page.locator("#experience-input")).toHaveValue("体験も残す");
  await page.getByRole("tab", { name: "対話", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("対話は残す");
  expect(uploads).toBe(0);
});

for (const mode of ["dialogue", "experience"] as const) {
  test(`busy recognizer preserves ${mode} draft and recovers only on explicit re-record`, async ({ page }) => {
    let uploads = 0;
    await page.route("**/api/transcription", async route => {
      uploads++;
      if (uploads === 1) await route.fulfill({ status: 429, json: { detail: {
        code: "transcription_busy", message: "前の音声をまだ処理しています。", request_id: "fake-busy",
      } } });
      else await route.fulfill({ json: { text: "もう一度話した文", language: "ja", language_probability: 1,
        audio_duration_seconds: 1, request_id: "fake-retry", latency_ms: 10 } });
    });
    if (mode === "experience") {
      await page.getByRole("tab", { name: "体験", exact: true }).click();
      await page.locator("#experience-start").click();
    }
    const input = page.locator(mode === "dialogue" ? "#dialogue-input" : "#experience-input");
    const microphone = page.locator(mode === "dialogue" ? "#voice-input-control" : "#experience-microphone");
    const status = page.locator(mode === "dialogue" ? "#voice-input-status-summary" : "#experience-voice-status");
    await input.fill("消さない下書き");
    await microphone.click();
    await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "1");
    await microphone.click();
    await expect(status).toContainText("前の音声を処理中");
    await expect(input).toHaveValue("消さない下書き");
    await expect(input).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "0");
    expect(uploads).toBe(1);
    await expect(page.locator("html")).toHaveAttribute("data-test-permissions", "1");
    await microphone.click();
    await expect(page.locator("html")).toHaveAttribute("data-test-active-tracks", "1");
    await microphone.click();
    await expect(input).toHaveValue("消さない下書き\nもう一度話した文");
    expect(uploads).toBe(2);
    await expect(status).not.toContainText("前の音声を処理中");
  });
}
