/* global process, fetch, window, performance, document, Audio, URL, setTimeout, clearTimeout, console */
// Local speech only. Test-time source instrumentation never changes the production bundle.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const output = process.argv[2];
const profiles = process.argv.includes("--profiles");
const headlessShell = process.argv.includes("--headless-shell");
if (!output) throw new Error("Provide an ignored local JSON result path.");
const baseURL = "http://127.0.0.1:15174";
const health = await fetch(`${baseURL}/api/health`).then((r) => r.json());
if (health.provider !== "mock") throw new Error("This test requires Mock; it never calls an LLM.");
const browser = await chromium.launch(headlessShell ? {} : {channel: "chromium"});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
const results = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { window.__renderProbe = {skip: false, frames: [], scale: 1, shadows: true, fps: 0}; });
await page.route("**/src/vrm/VRMViewer.ts*", async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  const needle = "this.renderer.render(this.scene, this.camera);";
  if (source.split(needle).length !== 2) throw new Error("Renderer changed; inspect instrumentation before running.");
  const injection = `
    const probe = window.__renderProbe;
    if (probe.appliedScale !== probe.scale) {
      this.renderer.setPixelRatio(probe.scale);
      probe.appliedScale = probe.scale;
    }
    if (probe.appliedShadows !== probe.shadows) {
      this.renderer.shadowMap.enabled = probe.shadows;
      this.scene.traverse((object) => {
        if (object.material) {
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            material.needsUpdate = true;
          }
        }
      });
      probe.appliedShadows = probe.shadows;
    }
    const renderStarted = window.performance.now();
    const drawn = !probe.skip && (!probe.fps || timestamp - (probe.lastDraw ?? -Infinity) >= 1000 / probe.fps - 0.5);
    if (drawn) { ${needle} probe.lastDraw = timestamp; }
    probe.frames.push({at: timestamp, cost: window.performance.now() - renderStarted, drawn});
    if (probe.frames.length > 600) probe.frames.shift();
  `;
  await route.fulfill({response, body: source.replace(needle, injection)});
});
try {
  await page.goto(baseURL);
  await page.waitForFunction(() => document.querySelector("#model-status")?.dataset.status === "ready");
  await page.evaluate(async () => {
    window.__renderProbe.skip = true;
    const response = await fetch("/api/speech", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: "少し休もうか。"})});
    if (!response.ok) throw new Error(`Warm-up speech status ${response.status}`);
    await response.arrayBuffer();
  });
  const modes = profiles ? [
    {name: "normal", skip: false, scale: 1, shadows: true, fps: 0},
    {name: "no-shadows", skip: false, scale: 1, shadows: false, fps: 0},
    {name: "light", skip: false, scale: 0.5, shadows: false, fps: 15},
  ] : [
    {name: "normal", skip: false, scale: 1, shadows: true, fps: 0},
    {name: "draw-skipped", skip: true, scale: 1, shadows: true, fps: 0},
    {name: "half-resolution", skip: false, scale: 0.5, shadows: true, fps: 0},
  ];
  for (const [round, order] of [modes, [...modes].reverse()].entries()) {
    for (const mode of order) {
      await page.evaluate(async (mode) => {
        Object.assign(window.__renderProbe, mode);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        window.__renderProbe.frames = [];
      }, mode);
      const row = await page.evaluate(async () => {
        const started = performance.now();
        const response = await fetch("/api/speech", {method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({text: "少し休もうか。"})});
        if (!response.ok) throw new Error(`Speech status ${response.status}`);
        const blob = await response.blob();
        const readyMs = Math.round(performance.now() - started);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let playbackMs;
        try {
          await audio.play();
          playbackMs = Math.round(performance.now() - started);
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("audio playback timed out")), 15_000);
            audio.onended = () => { clearTimeout(timeout); resolve(); };
            audio.onerror = () => { clearTimeout(timeout); reject(new Error("audio failed")); };
          });
        } finally { audio.pause(); URL.revokeObjectURL(url); }
        const frames = window.__renderProbe.frames;
        const drawn = frames.filter((f) => f.drawn);
        const intervals = frames.slice(1).map((f, i) => f.at - frames[i].at);
        const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
        return {readyMs, playbackMs, frameCount: frames.length, frameIntervalMs: median(intervals),
          drawnFrames: drawn.length,
          renderCpuMs: median(frames.map((f) => f.cost)), audioMs: Number(response.headers.get("x-speech-duration-ms"))};
      });
      results.push({round, mode: mode.name, ...row});
      console.log(JSON.stringify(results.at(-1)));
      if (!row.frameCount || errors.length) throw new Error("Invalid rendering sample; inspect page errors.");
    }
  }
} finally {
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  await writeFile(output, JSON.stringify({browserMode: headlessShell ? "headless-shell" : "chromium-new-headless",
    renderer, results, errors, externalAIRequests: 0}, null, 2));
  await browser.close();
}
if (results.length !== 6 || errors.length) process.exitCode = 1;
