import { expect, test } from "@playwright/test";

const SILENT_WAV = createSilentWav(320);

test("free Mock dialogue completes one browser round trip", async ({ page }) => {
  const runtimeErrors: string[] = [];
  const failedResponses: Array<{ readonly url: string; readonly status: number }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "月白 しずく" })).toBeVisible();
  await expect(page.locator("#character-version")).toHaveText("v1.1.0");
  await expect(page.locator("#character-tagline")).toHaveText("静かに寄り添い、考えをほどく案内役");
  await expect(page.locator("#dialogue-provider")).toHaveText("Mock");
  await expect(page.locator("#dialogue-provider-note")).toHaveText("定型応答 · 外部送信なし");

  const input = page.getByRole("textbox", { name: "メッセージ" });
  await expect(input).toBeEnabled();
  await input.fill("こんにちは");
  await page.getByRole("button", { name: "送信" }).click();

  const dialogueLog = page.locator("#dialogue-log");
  await expect(dialogueLog.locator(".is-user p")).toHaveText("こんにちは");
  await expect(dialogueLog.locator(".is-assistant p")).toContainText("今日はどんなことを話そうか");
  await expect(dialogueLog.locator(".is-assistant > span")).toHaveText("しずく");
  await expect(page.locator("#dialogue-memory")).toContainText("直近 1 / 10往復");
  await expect(page.getByRole("button", { name: "送信" })).toBeEnabled();
  await expect(page.locator("#dialogue-error")).toBeHidden();
  await expect(page.locator("#speech-status-message")).toContainText("Text回答はそのまま確認できます");

  const unexpectedResponses = failedResponses.filter(
    ({ url, status }) => !(new URL(url).pathname === "/api/speech" && status === 503),
  );
  const unexpectedRuntimeErrors = runtimeErrors.filter(
    (message) => !message.includes("Failed to load resource: the server responded with a status of 503"),
  );
  expect(unexpectedResponses).toEqual([]);
  expect(unexpectedRuntimeErrors).toEqual([]);
});

test("secondary controls stay behind progressive disclosure", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".stage-world")).toBeVisible();
  await expect(page.locator(".stage-moon")).toBeVisible();
  const modelPicker = page.locator("#settings-character .file-button");
  await expect(modelPicker).toBeHidden();

  await page.getByRole("button", { name: "キャラクターを調整", exact: true }).click();
  await expect(modelPicker).toBeVisible();
  await expect(page.getByText("手動で状態を確認", { exact: true })).toBeVisible();

  await page.locator('button[data-character-state="thinking"]').click();
  await expect(page.locator("#app")).toHaveAttribute("data-state", "thinking");
});

test("short emotional residue remains visible without adding another control", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "メッセージ" });
  const send = page.getByRole("button", { name: "送信" });

  await input.fill("今日は疲れた");
  await send.click();
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  await expect(send).toBeEnabled();

  await input.fill("そうなんだ");
  await send.click();

  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(2);
  await expect(page.locator("#app")).toHaveAttribute("data-continuity", "carried");
  await expect(page.locator("#performance-source")).toHaveText("余韻");
  await expect(page.locator("#performance-emotion")).toHaveText("やさしい");
});

test("explicit response style reaches the free Mock provider", async ({ page }) => {
  await page.goto("/");

  const style = page.getByRole("combobox", { name: "返答の詳しさ" });
  await expect(style).toHaveValue("balanced");
  await style.selectOption("detailed");
  await page.evaluate(() => {
    const state = window as unknown as { streamingTransitionSeen: boolean };
    state.streamingTransitionSeen = false;
    const log = document.querySelector("#dialogue-log");
    if (!log) return;
    new MutationObserver((records) => {
      if (records.some((record) => record.type === "attributes" && record.oldValue?.includes("is-streaming"))) {
        state.streamingTransitionSeen = true;
      }
    }).observe(log, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  });

  await page.getByRole("textbox", { name: "メッセージ" }).fill("何ができる？");
  await page.getByRole("button", { name: "送信" }).click();

  await expect(page.locator("#dialogue-log .is-assistant p")).toContainText(
    "要点を分けて順番に詳しく説明するよ",
  );
  await expect(page.locator("#dialogue-log .is-assistant.is-streaming")).toHaveCount(0);
  await expect(page.locator("#dialogue-log .is-assistant")).not.toHaveAttribute("aria-hidden", "true");
  expect(await page.evaluate(() =>
    (window as unknown as { streamingTransitionSeen: boolean }).streamingTransitionSeen,
  )).toBe(true);
  await expect(page.locator("#latency-first-text")).not.toHaveText("—");
  await expect(page.locator("#latency-text-complete")).not.toHaveText("—");
  await expect(style).toBeEnabled();
});

test("a closed sentence reaches speech while the reply is still streaming", async ({ page }) => {
  const synthesizedTexts: string[] = [];
  await page.addInitScript(() => {
    const state = window as unknown as { speechRequestedWhileStreaming: boolean };
    state.speechRequestedWhileStreaming = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/api/speech")) {
        state.speechRequestedWhileStreaming ||= Boolean(
          document.querySelector("#dialogue-log .is-assistant.is-streaming"),
        );
      }
      return originalFetch(input, init);
    };
  });
  await page.route("**/api/speech", async (route) => {
    const payload = route.request().postDataJSON() as { text?: unknown };
    if (typeof payload.text === "string") synthesizedTexts.push(payload.text);
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      headers: {
        "x-speech-timing-version": "1",
        "x-speech-duration-ms": "320",
      },
      body: SILENT_WAV,
    });
  });
  await page.goto("/");

  await page.getByRole("textbox", { name: "メッセージ" }).fill("こんにちは");
  await page.getByRole("button", { name: "送信" }).click();

  await expect(page.locator("#dialogue-log .is-assistant p")).toContainText("今日はどんなことを話そうか");
  await expect.poll(() => synthesizedTexts.length).toBeGreaterThanOrEqual(1);
  expect(synthesizedTexts[0]).toBe("こんにちは。");
  expect(await page.evaluate(() =>
    (window as unknown as { speechRequestedWhileStreaming: boolean }).speechRequestedWhileStreaming,
  )).toBe(true);
  await expect(page.locator("#latency-speech-start")).not.toHaveText("—");
});

test("user can cancel an active response and return to idle", async ({ page }) => {
  let releaseDialogue: (() => void) | null = null;
  await page.route("**/api/dialogue/sessions/*/active", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const sessionId = segments.at(-2) ?? "session-cancel-e2e";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session_id: sessionId, cancelled: true }),
    });
  });
  await page.route("**/api/dialogue/stream", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await new Promise<void>((resolve) => {
      releaseDialogue = resolve;
    });
    await route.abort("aborted").catch(() => undefined);
  });
  await page.goto("/");

  await page.getByRole("textbox", { name: "メッセージ" }).fill("途中で止める");
  await page.getByRole("button", { name: "送信" }).click();
  const stop = page.getByRole("button", { name: "応答を停止" });
  await expect(stop).toBeEnabled();
  await stop.click();
  releaseDialogue?.();

  await expect(page.getByRole("button", { name: "送信" })).toBeEnabled();
  await expect(page.locator("#app")).toHaveAttribute("data-state", "idle");
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(0);
  await expect(page.locator("#toast")).toContainText("応答を停止しました");
});

test("mobile keeps the conversation composer in the first viewport", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 319, height: 910 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.getByRole("textbox", { name: "メッセージ" })).toBeEnabled();
    await expect(page.locator("#dialogue-form")).toBeInViewport();
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const environmentAnimationDurationMs = await page
    .locator(".dialogue-form")
    .evaluate((element) => {
      const duration = getComputedStyle(element).transitionDuration;
      return duration.endsWith("ms") ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
    });
  expect(environmentAnimationDurationMs).toBeLessThanOrEqual(0.001);
});

function createSilentWav(durationMs: number): Buffer {
  const sampleRate = 8_000;
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}
