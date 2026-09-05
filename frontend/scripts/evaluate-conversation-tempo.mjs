/* global process, fetch, window, performance, HTMLMediaElement, document, console */
// Separate from ordinary tests. --mock uses real local speech without an LLM.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const mock = process.argv.includes("--mock");
const headlessShell = process.argv.includes("--headless-shell");
if (!mock && process.env.RUN_REAL_TEMPO_EVALUATION !== "1") {
  throw new Error("Set RUN_REAL_TEMPO_EVALUATION=1 only after owner approval.");
}
const baseURL = "http://127.0.0.1:15174";
const output = process.argv[2];
if (!output) throw new Error("Provide a local JSON result path.");
const snapshot = await fetch(`${baseURL}/api/evaluation/tempo`).then((r) => r.json());
if (snapshot.provider !== (mock ? "mock" : "openai")) throw new Error("Unexpected provider; refusing evaluation.");
if (snapshot.attempts !== 0 || snapshot.max_requests !== 3) throw new Error("Use a fresh bounded evaluation server.");
// Full Chromium's new headless mode can use the local GPU; CI's headless shell may not.
// Keep --headless-shell for reproducing the older measurements; record the actual renderer below.
const browser = await chromium.launch(headlessShell ? {} : {channel: "chromium"});
const results = [];
try {
  for (const scenario of snapshot.cases) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const timing = {start: null, speech: [], audio: []};
      window.__tempo = timing;
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const path = String(args[0]);
        if (path.endsWith("/dialogue/stream")) timing.start = performance.now();
        let record;
        if (path.endsWith("/speech")) {
          record = {requested: performance.now(), characters: JSON.parse(args[1].body).text.length};
          timing.speech.push(record);
        }
        const response = await originalFetch(...args);
        if (record) {
          record.status = response.status;
          // Observe a copy without delaying the application's response body.
          void response.clone().arrayBuffer().then(() => { record.ready = performance.now(); });
          record.durationMs = Number(response.headers.get("x-speech-duration-ms"));
          record.visemes = Boolean(response.headers.get("x-speech-visemes"));
        }
        return response;
      };
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const record = {};
        timing.audio.push(record);
        this.addEventListener("ended", () => { record.ended = performance.now(); }, {once: true});
        return originalPlay.call(this).then(() => {
          record.started = performance.now();
          record.duration = this.duration;
          record.rate = this.playbackRate;
        });
      };
    });
    await page.goto(baseURL);
    await page.waitForFunction((name) => document.querySelector("#dialogue-provider")?.textContent === name,
      mock ? "Mock" : "OpenAI");
    await page.waitForFunction(() => document.querySelector("#model-status")?.dataset.status === "ready");
    const input = page.getByRole("textbox", {name: "メッセージ"});
    await input.waitFor();
    await input.fill(scenario.message);
    await page.getByRole("button", {name: "送信", exact: true}).click();
    await page.waitForFunction(() => {
      const status = document.querySelector("#speech-status-message")?.textContent ?? "";
      const error = document.querySelector("#dialogue-error");
      return status.includes("再生が完了") || status.includes("Text回答") ||
        (error && !error.hidden && error.textContent.trim());
    }, null, {timeout: 90_000});
    const result = await page.evaluate(() => {
      const t = window.__tempo;
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      const at = (value) => typeof value === "number" && t.start !== null ? Math.round(value - t.start) : null;
      const stages = Object.fromEntries(["first-text", "text-complete", "speech-start"].map((stage) => {
        const title = document.querySelector(`#latency-${stage}`)?.title ?? "";
        return [stage, title ? Number(title.replace(/[^0-9]/g, "")) : null];
      }));
      return {stages, speech: t.speech.map((s) => ({...s, requested: at(s.requested), ready: at(s.ready)})),
        audio: t.audio.map((a) => ({...a, started: at(a.started), ended: at(a.ended)})),
        reply: document.querySelector("#dialogue-log .is-assistant p")?.textContent,
        speechStatus: document.querySelector("#speech-status-message")?.textContent,
        emotion: document.querySelector("#performance-emotion")?.textContent,
        avatarLoaded: document.querySelector("#model-status")?.dataset.status === "ready",
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unavailable"};
    });
    results.push({id: scenario.id, ...result, errors});
    console.log(JSON.stringify({case: scenario.id, stages: result.stages, segments: result.audio.length, errors}));
    await page.close();
    if (!result.speechStatus?.includes("再生が完了") || errors.length) break;
  }
} finally {
  const summary = await fetch(`${baseURL}/api/evaluation/tempo`).then((r) => r.json());
  await writeFile(output, JSON.stringify({model: snapshot.model,
    browserMode: headlessShell ? "headless-shell" : "chromium-new-headless", results, server: summary,
    limitation: "Headless browser playback start, not physical audible onset or human naturalness rating."}, null, 2));
  await browser.close();
}
if (results.length !== 3 || results.some((r) => r.errors.length || !r.speechStatus?.includes("再生が完了"))) {
  process.exitCode = 1;
}
