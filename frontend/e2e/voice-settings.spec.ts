import { expect, test } from "@playwright/test";
import type { VoiceSettings } from "../src/speech/types";

const DEFAULTS: VoiceSettings = { speaker_id: 14, speed_scale: 0.96, pitch_scale: -0.01, intonation_scale: 0.94 };
const CATALOG = {
  defaults: DEFAULTS,
  voices: [
    { id: 14, name: "テストのしずく", style: "標準", credit: "VOICEVOX:テストのしずく" },
    { id: 3, name: "別のテスト音声", style: "標準", credit: "VOICEVOX:別のテスト音声" },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
});

test("voice preview uses the selected settings, preserves chat, persists and resets", async ({ page }) => {
  const requests: Array<{ text: string; voice: VoiceSettings }> = [];
  let dialogueRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/dialogue/stream") dialogueRequests += 1;
  });
  await page.route("**/api/speech/voices", route => route.fulfill({ json: CATALOG }));
  await page.route("**/api/speech", async route => {
    requests.push(route.request().postDataJSON() as { text: string; voice: VoiceSettings });
    await route.fulfill({ contentType: "audio/wav", body: silentWav(), headers: {
      "x-speech-timing-version": "1", "x-speech-duration-ms": "2000",
    } });
  });
  await page.goto("/");
  const draft = page.getByRole("textbox", { name: "メッセージ", exact: true });
  await draft.fill("送信前の下書き");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("声", { exact: true }).selectOption("3");
  await page.getByLabel("速さ", { exact: true }).press("End");
  await page.locator("#voice-options").getByLabel("高さ", { exact: true }).press("Home");
  await page.getByLabel("抑揚", { exact: true }).press("End");
  await expect(page.locator("#voice-credit")).toHaveText("VOICEVOX:別のテスト音声");
  await page.getByRole("button", { name: "声を試す", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]?.voice).toEqual({ speaker_id: 3, speed_scale: 1.6, pitch_scale: -0.15, intonation_scale: 1.5 });
  await page.getByRole("button", { name: "試聴を止める" }).click();
  await expect(page.getByRole("button", { name: "声を試す", exact: true })).toBeEnabled();
  expect(dialogueRequests).toBe(0);
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(0);
  await page.getByRole("button", { name: "設定を閉じる" }).click();
  await expect(draft).toHaveValue("送信前の下書き");

  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByLabel("声", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("速さ", { exact: true })).toHaveValue("1.6");
  await expect(page.locator("#voice-options").getByLabel("高さ", { exact: true })).toHaveValue("-0.15");
  await expect(page.getByLabel("抑揚", { exact: true })).toHaveValue("1.5");
  await page.getByRole("button", { name: "しずくの標準に戻す" }).click();
  await expect(page.getByLabel("声", { exact: true })).toHaveValue("14");
  await expect(page.getByLabel("速さ", { exact: true })).toHaveValue("0.96");
  await expect(page.locator("#voice-options").getByLabel("高さ", { exact: true })).toHaveValue("-0.01");
  await page.getByRole("button", { name: "設定を閉じる" }).click();
  await draft.fill("こんにちは");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  await expect.poll(() => requests.length).toBeGreaterThan(1);
  requests.slice(1).forEach(request => expect(request.voice).toEqual(DEFAULTS));
});

test("voice catalog failure can reconnect and controls fit a narrow screen", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/speech/voices", route => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { detail: { code: "voice_catalog_unavailable", message: "声の一覧を取得できません。" } } })
      : route.fulfill({ json: CATALOG });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.locator("#voice-settings-note")).toContainText("声の一覧を取得できません");
  await expect(page.getByLabel("声", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "再接続", exact: true }).click();
  await expect(page.getByLabel("声", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "声を試す", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "声を試す", exact: true })).toBeInViewport();
  expect(await page.locator(".settings-body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toBeEnabled();
});

function silentWav(): Buffer {
  const samples = 16_000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  return wav;
}
