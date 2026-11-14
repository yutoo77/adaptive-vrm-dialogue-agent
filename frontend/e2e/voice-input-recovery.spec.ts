import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const root = document.documentElement;
      root.dataset["testMicrophoneRequests"] = String(Number(root.dataset["testMicrophoneRequests"] ?? 0) + 1);
      throw new DOMException("This recovery test must not record", "NotAllowedError");
    } });
  });
});

test("one transient invalid health response recovers automatically without recording", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/transcription/health", async route => {
    requests++;
    if (requests === 1) await route.fulfill({ contentType: "text/html", body: "<html>starting</html>" });
    else await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "音声で入力", exact: true })).toBeEnabled();
  expect(requests).toBe(2);
  await expect(page.locator("html")).not.toHaveAttribute("data-test-microphone-requests");
  await expect(page.locator("#dialogue-input")).toBeEnabled();
});

test("manual reconnection preserves both workspaces and preferences cannot bypass failed health", async ({ page }) => {
  let healthy = false;
  let requests = 0;
  await page.route("**/api/transcription/health", async route => {
    requests++;
    if (!healthy) await route.fulfill({ json: { status: "ready", unexpected: "test-only" } });
    else await route.continue();
  });
  await page.goto("/");
  await page.locator("#dialogue-input").fill("対話の下書きは残す");
  await expect(page.getByRole("button", { name: "音声入力に再接続", exact: true })).toBeEnabled();
  expect(requests).toBe(2);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator("#voice-auto-stop").uncheck();
  await expect(page.locator("#voice-input-status-message")).toContainText("想定した形式と異なります");
  await page.getByRole("button", { name: "設定を閉じる", exact: true }).click();
  await expect(page.getByRole("button", { name: "音声入力に再接続", exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "体験", exact: true }).click();
  await page.locator("#experience-start").click();
  await page.locator('[data-inspect="letter"]').click();
  await expect(page.locator('[data-inspect="letter"]')).toHaveAttribute("data-inspected", "true");
  await page.locator("#experience-input").fill("体験の下書きも残す");
  const history = await page.locator("#experience-history-count").textContent();
  healthy = true;
  await page.getByRole("button", { name: "音声入力に再接続", exact: true }).click();
  await expect(page.locator("#experience-microphone")).toHaveText("マイク");
  await expect(page.locator("#experience-microphone")).toBeEnabled();
  await expect(page.locator("#experience-input")).toHaveValue("体験の下書きも残す");
  await expect(page.locator("#experience-history-count")).toHaveText(history ?? "");
  await expect(page.locator("#experience-voice-status")).toHaveText("");
  await expect(page.locator("html")).not.toHaveAttribute("data-test-microphone-requests");
  expect(requests).toBe(3);
  await page.getByRole("tab", { name: "対話", exact: true }).click();
  await expect(page.locator("#dialogue-input")).toHaveValue("対話の下書きは残す");
  await expect(page.getByRole("button", { name: "音声で入力", exact: true })).toBeEnabled();
});

test("a persistent local outage offers keyboard-accessible recovery at 320px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("**/api/transcription/health", route => route.fulfill({ status: 503, json: { detail: {
    code: "unavailable", message: "音声入力の接続先を確認してください。",
  } } }));
  await page.goto("/");
  const retry = page.getByRole("button", { name: "音声入力に再接続", exact: true });
  await expect(retry).toBeEnabled();
  await retry.focus();
  await expect(retry).toBeFocused();
  await expect(page.locator("#voice-input-status-summary")).toContainText("再接続");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("voice-reconnect-320.png"), fullPage: true });
  await expect(page.locator("#dialogue-input")).toBeEnabled();
  await expect(page.locator("html")).not.toHaveAttribute("data-test-microphone-requests");
});
