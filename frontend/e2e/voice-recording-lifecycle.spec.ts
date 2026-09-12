import { expect, test } from "@playwright/test";

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
  await expect(page.locator("#dialogue-input")).toHaveValue("新しい録音だけ");
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
