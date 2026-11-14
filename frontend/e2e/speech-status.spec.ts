import { expect, test, type Page } from "@playwright/test";

const CONNECTION_DETAIL = "VOICEVOXに接続できません。起動してから「再接続」を押してください。";

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
});

async function speechHealth(page: Page, status: "ready" | "unavailable"): Promise<void> {
  await page.route("**/api/speech/health", route => route.fulfill({ json: {
    status, provider: "voicevox", speaker_id: 14, engine_version: null,
    speaker_name: null, style_name: null, credit: null,
    message: status === "unavailable" ? CONNECTION_DETAIL : "音声エンジンに接続しました。",
  } }));
}

async function sendGreeting(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: "メッセージ", exact: true }).fill("こんにちは");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("#dialogue-log .is-assistant")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
}

test("initial missing optional speech stays quiet and keeps keyboard access to details", async ({ page }) => {
  let synthesisRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/speech") synthesisRequests++;
  });
  await speechHealth(page, "unavailable");
  await page.goto("/");
  const status = page.locator("#speech-status");
  await expect(status).toHaveAttribute("data-speech-state", "unavailable");
  await expect(page.locator("#speech-status-summary")).toHaveText("音声未接続");
  await expect(status).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(status.locator(".speech-status-dot")).toBeHidden();
  expect(synthesisRequests).toBe(0);

  const details = page.getByRole("button", { name: "音声出力の詳細", exact: true });
  await details.focus();
  await details.press("Enter");
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await expect(page.locator("#speech-status-message")).toHaveText(CONNECTION_DETAIL);
  await expect(page.getByRole("button", { name: "再接続", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
  await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toBeEnabled();
});

test("a synthesis attempt that fails remains a visible warning on a narrow screen", async ({ page }) => {
  let synthesisRequests = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await speechHealth(page, "unavailable");
  await page.route("**/api/speech", route => {
    synthesisRequests++;
    return route.fulfill({ status: 503, json: { detail: {
      code: "speech_unavailable", message: CONNECTION_DETAIL,
    } } });
  });
  await page.goto("/");
  await expect(page.locator("#speech-status-summary")).toHaveText("音声未接続");
  await sendGreeting(page);
  const status = page.locator("#speech-status");
  await expect(status).toHaveAttribute("data-speech-state", "error");
  await expect(status).toBeInViewport();
  await expect(page.locator("#speech-status-summary")).toHaveText("再生できません・文字で会話できます");
  await expect(status).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(synthesisRequests).toBeGreaterThan(0);
  await expect(page.locator("#current-utterance")).toContainText("今日はどんなことを話そうか");
  await expect(page.locator("#dialogue-error")).toBeHidden();
  await page.getByRole("button", { name: "音声出力の詳細", exact: true }).click();
  await expect(page.locator("#speech-status-message")).toContainText(CONNECTION_DETAIL);
  await page.getByRole("button", { name: "設定を閉じる", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toBeEnabled();
});

test("blocked autoplay stays visible, manual replay works, and completion is quiet", async ({ page }) => {
  await speechHealth(page, "ready");
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
  const status = page.locator("#speech-status");
  await expect(status).toHaveAttribute("data-speech-state", "available");
  await expect(status).toBeHidden();
  await sendGreeting(page);
  await expect(status).toHaveAttribute("data-speech-reason", "autoplay-blocked");
  await expect(status).toBeVisible();
  await expect(page.locator("#speech-status-summary")).toHaveText("自動再生できません。「もう一度再生」を押してください。");
  await page.getByRole("button", { name: "直前の音声をもう一度再生", exact: true }).click();
  await expect(status).toHaveAttribute("data-speech-state", "playing");
  await expect(page.locator("#speech-status-summary")).toHaveText("読み上げ中");
  await expect(status).not.toHaveAttribute("data-speech-reason", "autoplay-blocked");
  await expect(status).toHaveAttribute("data-speech-state", "ready");
  await expect(status).toBeHidden();
  await expect(page.getByRole("button", { name: "直前の音声をもう一度再生", exact: true })).toBeEnabled();
});

test("an explicit replay failure does not become a quiet unavailable state", async ({ page }) => {
  await speechHealth(page, "ready");
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Test playback failure", "NotSupportedError"));
  });
  await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/wav", body: silentWav() }));
  await page.goto("/");
  await sendGreeting(page);
  const status = page.locator("#speech-status");
  await expect(status).toHaveAttribute("data-speech-reason", "autoplay-blocked");
  await page.getByRole("button", { name: "直前の音声をもう一度再生", exact: true }).click();
  await expect(status).toHaveAttribute("data-speech-state", "error");
  await expect(status).not.toHaveAttribute("data-speech-reason", "autoplay-blocked");
  await expect(status).toBeVisible();
  await expect(page.locator("#speech-status-summary")).toHaveText("再生できません・文字で会話できます");
  await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
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
