import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { DialogueStreamEvent } from "../src/dialogue/types";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const LONG_REPLY = [
  "窓辺に置いたしおりを覚えている？",
  ...Array.from({ length: 16 }, (_, index) =>
    `${index + 1}枚目には、帰り道で見上げた月のことを書いておいたよ。`),
  "最後まで読んでくれて、ありがとう。",
].join("\n");
const LAST_REPLY = "しおりは窓辺に置いてあるよ。";
const STREAM_PROMPT = "しおりの続きを教えて";
const PARTIAL_REPLY = "窓を開けると、冷たい夜風が";
const STREAM_ERROR = "返答を続けられませんでした。もう一度お試しください。";
const FAIL_STREAM_EVENT = "dialogue-scene-test:fail-stream";
const FIRST_CHUNK_EVENT = "dialogue-scene-test:first-chunk";

test.beforeEach(async ({ page }) => {
  await page.route("**/models/private/character.vrm", route => route.fulfill({ status: 404 }));
});

async function replyWith(page: Page, replies: readonly string[]): Promise<void> {
  let turn = 0;
  await page.route("**/api/dialogue/stream", async route => {
    const original = await route.fetch();
    const events = (await original.text()).trim().split("\n").map(
      (line) => JSON.parse(line) as DialogueStreamEvent,
    );
    const start = events.find(event => event.type === "start");
    const complete = events.find(event => event.type === "complete");
    const reply = replies[turn++];
    if (!start || !complete || reply === undefined) throw new Error("Expected a Mock dialogue and fixture reply");
    const stream: DialogueStreamEvent[] = [
      start,
      { type: "text_delta", delta: reply, elapsed_ms: 1 },
      { type: "complete", response: { ...complete.response, reply } },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: stream.map(event => JSON.stringify(event)).join("\n") + "\n",
    });
  });
}

async function sendMessage(page: Page, message: string, reply: string): Promise<void> {
  await page.getByRole("textbox", { name: "メッセージ", exact: true }).fill(message);
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("#dialogue-log .is-assistant:not(.is-streaming) p").last()).toHaveText(reply);
  await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
}

async function screenshot(page: Page, info: TestInfo, file: string): Promise<void> {
  if (process.env["SCENE_SCREENSHOTS"] === "1") {
    await page.screenshot({ path: info.outputPath(file), animations: "disabled" });
  }
}

async function holdReply(page: Page, delayFirstChunk = false): Promise<void> {
  await page.addInitScript(({ prompt, partial, error, failureEvent, firstChunkEvent, delayFirstChunk }) => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).endsWith("/api/dialogue/stream") || typeof init?.body !== "string") {
        return fetch(input, init);
      }
      const body = JSON.parse(init.body) as { message?: string };
      if (body.message !== prompt) return fetch(input, init);

      const encoder = new TextEncoder();
      const signal = init.signal;
      const requestId = "scene-stream-e2e";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (signal?.aborted) {
            controller.error(signal.reason);
            return;
          }
          const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          const abort = () => controller.error(signal?.reason);
          signal?.addEventListener("abort", abort, { once: true });
          send({ type: "start", request_id: requestId, provider: "mock", model: "mock" });
          const sendFirstChunk = () => send({ type: "text_delta", delta: partial, elapsed_ms: 1 });
          if (delayFirstChunk) {
            window.addEventListener(firstChunkEvent, sendFirstChunk, signal ? { once: true, signal } : { once: true });
          } else {
            sendFirstChunk();
          }
          window.addEventListener(failureEvent, () => {
            signal?.removeEventListener("abort", abort);
            send({ type: "error", error: { code: "stream_failed", message: error, request_id: requestId } });
            controller.close();
          }, signal ? { once: true, signal } : { once: true });
        },
      });
      return Promise.resolve(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    };
  }, { prompt: STREAM_PROMPT, partial: PARTIAL_REPLY, error: STREAM_ERROR, failureEvent: FAIL_STREAM_EVENT,
    firstChunkEvent: FIRST_CHUNK_EVENT, delayFirstChunk });
}

test("waiting for a new reply does not relabel the previous reply as thinking", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await holdReply(page, true);
  await replyWith(page, [LAST_REPLY]);
  await page.goto("/");
  await sendMessage(page, "しおりはどこ？", LAST_REPLY);

  await page.getByRole("textbox", { name: "メッセージ", exact: true }).fill(STREAM_PROMPT);
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const caption = page.locator("#current-utterance");
  await expect(caption).toHaveText("考え中…");
  await expect(caption.locator("p")).toHaveCount(0);
  await expect(page.locator("#recent-dialogue")).toContainText(LAST_REPLY);
  await expect(page.locator("#dialogue-log .is-assistant p")).toHaveText(LAST_REPLY);

  await page.evaluate(event => window.dispatchEvent(new Event(event)), FIRST_CHUNK_EVENT);
  await expect(caption.locator("p")).toHaveText(PARTIAL_REPLY);
  await expect(caption.locator(".scene-speaker")).toHaveText("しずく");
  await page.evaluate(event => window.dispatchEvent(new Event(event)), FAIL_STREAM_EVENT);
  await expect(page.locator("#dialogue-error")).toContainText(STREAM_ERROR);
  await expect(caption.locator("p")).toHaveText(LAST_REPLY);
  await expect(caption.locator(".scene-speaker")).toHaveText("しずく");
});

test("a completed reply stays visible while the saved-memory refresh is outstanding", async ({ page }) => {
  const initialMemories = page.waitForResponse(response => response.url().endsWith("/api/memories"));
  await page.goto("/");
  await initialMemories;

  let releaseRefresh = () => {};
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let refreshOutstanding = false;
  let savedMemoryId: string | undefined;
  let completedReply = "";
  await page.route("**/api/dialogue/stream", async route => {
    const original = await route.fetch();
    const body = await original.text();
    const events = body.trim().split("\n").map(line => JSON.parse(line) as DialogueStreamEvent);
    const complete = events.find(event => event.type === "complete");
    if (!complete?.response.saved_memory) throw new Error("Expected a completed reply with an explicit saved memory");
    savedMemoryId = complete.response.saved_memory.id;
    completedReply = complete.response.reply;
    await route.fulfill({ response: original, body });
  });
  await page.route("**/api/memories", async route => {
    if (route.request().method() === "GET") {
      refreshOutstanding = true;
      await refreshGate;
    }
    await route.continue();
  });

  try {
    await page.getByRole("textbox", { name: "メッセージ", exact: true })
      .fill("覚えておいて：対話シーンE2E専用の架空設定、しおりは青");
    await page.getByRole("button", { name: "送信", exact: true }).click();

    await expect.poll(() => refreshOutstanding).toBe(true);
    expect(completedReply).not.toBe("");
    const caption = page.locator("#current-utterance");
    const log = page.locator("#dialogue-log");
    await expect(log).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "応答を停止", exact: true })).toBeEnabled();
    await expect(caption.locator("p")).toBeVisible();
    await expect(caption.locator("p")).toHaveText(completedReply);
    await expect(caption.locator(".scene-speaker")).toHaveText("しずく");
    await expect(log.locator(".is-streaming")).toHaveCount(0);

    releaseRefresh();
    await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
    await expect(log).toHaveAttribute("aria-busy", "false");
    await expect(caption.locator("p")).toHaveText(completedReply);
    await expect(caption.locator(".scene-speaker")).toHaveText("しずく");
  } finally {
    releaseRefresh();
    if (savedMemoryId) {
      const removed = await page.request.delete(`/api/memories/${savedMemoryId}`);
      expect(removed.ok()).toBe(true);
    }
  }
});

test("the current reply leads the scene while the preview keeps three previous lines", async ({ page }, info) => {
  await page.setViewportSize(DESKTOP);
  await replyWith(page, ["窓のそばで話そう。", "夜風が少し涼しいね。", "今日は月がきれいだね。"]);
  await page.goto("/");
  await sendMessage(page, "こんばんは", "窓のそばで話そう。");
  await sendMessage(page, "窓を開けようか", "夜風が少し涼しいね。");
  await sendMessage(page, "月が見える？", "今日は月がきれいだね。");

  await expect(page.locator("#current-utterance p")).toHaveText("今日は月がきれいだね。");
  const preview = page.locator("#recent-dialogue");
  await expect(preview).toBeVisible();
  await expect(preview.locator(".recent-line")).toHaveCount(3);
  for (const line of ["窓を開けようか", "夜風が少し涼しいね。", "月が見える？"]) {
    await expect(preview).toContainText(line);
  }
  await expect(preview).not.toContainText("こんばんは");
  await expect(preview).not.toContainText("今日は月がきれいだね。");
  const userLine = preview.locator(".is-user").last();
  const assistantLine = preview.locator(".is-assistant");
  await expect(userLine).toHaveCSS("text-align", "right");
  await expect(assistantLine).toHaveCSS("text-align", "left");
  for (const line of [userLine, assistantLine]) {
    await expect(line).toHaveCSS("font-size", "14px");
    await expect(line).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(line.locator("span")).toHaveClass("visually-hidden");
  }
  const userBounds = await userLine.boundingBox();
  const assistantBounds = await assistantLine.boundingBox();
  expect(userBounds!.x).toBeGreaterThan(assistantBounds!.x);
  expect(userBounds!.x + userBounds!.width).toBeGreaterThan(assistantBounds!.x + assistantBounds!.width);
  await expect(page.locator("#history-dialog")).toBeHidden();
  await expect(page.locator("#dialogue-log .dialogue-message")).toHaveCount(6);
  await screenshot(page, info, "scene-desktop.png");
});

test("consecutive user lines keep the same alignment after cancelled replies", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await holdReply(page, true);
  await replyWith(page, [LAST_REPLY]);
  await page.route("**/api/dialogue/sessions/*/active", async route => {
    const sessionId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    await route.fulfill({ json: { session_id: sessionId, cancelled: true } });
  });
  await page.goto("/");
  await sendMessage(page, "しおりはどこ？", LAST_REPLY);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("textbox", { name: "メッセージ", exact: true }).fill(STREAM_PROMPT);
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expect(page.locator("#current-utterance")).toHaveText("考え中…");
    await page.getByRole("button", { name: "応答を停止", exact: true }).click();
    await expect(page.getByRole("button", { name: "送信", exact: true })).toBeEnabled();
  }
  await expect(page.locator("#current-utterance p")).toHaveText(LAST_REPLY);
  const recent = page.locator("#recent-dialogue");
  await expect(recent.locator(".is-user")).toHaveCount(3);
  await expect(recent.locator(".is-assistant")).toHaveCount(0);
  for (const line of await recent.locator(".is-user").all()) {
    await expect(line).toHaveCSS("text-align", "right");
  }
});

test("long replies stay in bounds and the transcript is reachable on desktop and mobile", async ({ page }, info) => {
  await page.setViewportSize(DESKTOP);
  await replyWith(page, [LONG_REPLY]);
  await page.goto("/");
  await sendMessage(page, "しおりの話を聞かせて", LONG_REPLY);

  const opener = page.getByRole("button", { name: "会話履歴を開く", exact: true });
  const dialog = page.locator("#history-dialog");
  const caption = page.locator("#current-utterance");
  const form = page.locator("#dialogue-form");
  for (const [size, viewport] of [["desktop", DESKTOP], ["mobile", MOBILE]] as const) {
    await page.setViewportSize(viewport);
    await expect(caption.locator("p")).toContainText("窓辺に置いたしおりを覚えている？");
    await expect(caption).toBeVisible();
    await expect(form).toBeInViewport();
    const captionBox = await caption.boundingBox();
    const formBox = await form.boundingBox();
    expect(captionBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    expect(captionBox!.height).toBeLessThan(viewport.height / 3);
    expect(captionBox!.y + captionBox!.height).toBeLessThanOrEqual(formBox!.y + 1);
    expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (size === "mobile") await expect(page.locator("#recent-dialogue")).toBeHidden();
    await screenshot(page, info, `scene-long-${size}.png`);

    const readReply = page.getByRole("button", { name: "全文を読む", exact: true });
    const trigger = size === "desktop" ? readReply : opener;
    await trigger.click();
    await expect(dialog).toBeVisible();
    const fullReply = dialog.locator("#dialogue-log .is-assistant p");
    await expect(fullReply).toBeVisible();
    await expect(fullReply).toHaveText(LONG_REPLY);
    expect(await fullReply.evaluate(node => node.scrollHeight)).toBeLessThanOrEqual(
      await fullReply.evaluate(node => node.clientHeight + 1),
    );
    await expect(dialog.locator("#dialogue-log .is-user p")).toHaveText("しおりの話を聞かせて");
    await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await screenshot(page, info, `scene-history-${size}.png`);
    if (size === "desktop") await page.keyboard.press("Escape");
    else await dialog.locator("#history-close").click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

for (const outcome of ["stop", "error"] as const) {
  test(`the scene restores the last completed reply after a streaming ${outcome}`, async ({ page }, info) => {
    await page.setViewportSize(DESKTOP);
    await holdReply(page);
    await replyWith(page, [LAST_REPLY]);
    const cancellationRequests: string[] = [];
    await page.route("**/api/dialogue/sessions/*/active", async route => {
      const sessionId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
      cancellationRequests.push(route.request().method());
      await route.fulfill({ json: { session_id: sessionId, cancelled: true } });
    });
    await page.goto("/");
    await sendMessage(page, "しおりはどこ？", LAST_REPLY);

    const caption = page.locator("#current-utterance p");
    const log = page.locator("#dialogue-log");
    const preview = page.locator("#recent-dialogue");
    const input = page.getByRole("textbox", { name: "メッセージ", exact: true });
    const send = page.getByRole("button", { name: "送信", exact: true });
    const stop = page.getByRole("button", { name: "応答を停止", exact: true });
    const error = page.locator("#dialogue-error");
    await expect(caption).toHaveText(LAST_REPLY);
    await input.fill(STREAM_PROMPT);
    await send.click();
    await expect(stop).toBeEnabled();
    await expect(caption).toHaveText(PARTIAL_REPLY);
    await expect(log.locator(".is-assistant.is-streaming")).toHaveAttribute("aria-hidden", "true");
    await expect(log.locator(".is-assistant:not(.is-streaming) p")).toHaveText(LAST_REPLY);
    await expect(preview).not.toContainText(PARTIAL_REPLY);

    if (outcome === "stop") {
      await screenshot(page, info, "scene-streaming.png");
      await stop.click();
      await expect(page.locator("#toast")).toContainText("応答を停止しました");
      await expect(error).toBeHidden();
    } else {
      await page.evaluate(event => window.dispatchEvent(new Event(event)), FAIL_STREAM_EVENT);
      await expect(error).toBeVisible();
      await expect(error).toContainText(STREAM_ERROR);
    }

    await expect(send).toBeEnabled();
    await expect(input).toBeEnabled();
    await expect(caption).toHaveText(LAST_REPLY);
    await expect(log.locator(".is-assistant.is-streaming")).toHaveCount(0);
    await expect(log.locator(".is-assistant p")).toHaveText(LAST_REPLY);
    await expect(log).not.toContainText(PARTIAL_REPLY);
    await expect(log.locator(".is-user p").last()).toHaveText(STREAM_PROMPT);
    expect(cancellationRequests).toEqual(outcome === "stop" ? ["DELETE"] : []);
    await screenshot(page, info, `scene-stream-${outcome}.png`);
  });
}
