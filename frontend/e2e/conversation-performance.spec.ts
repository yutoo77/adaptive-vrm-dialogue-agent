import { expect, test } from "@playwright/test";
import type { DialogueStreamEvent } from "../src/dialogue/types";

test("conversation performance preserves quiet, joyful and questioning replies", async ({ page }) => {
  // Deterministic UI fixtures, not live-model or audible-performance evaluation.
  const cases = [
    { reply: "APIは、サービスへ情報や処理をお願いするための窓口だよ。", emotion: "neutral", gesture: "none", intensity: 0.25, label: "" },
    { reply: "わあ、それはうれしい瞬間だね！", emotion: "happy", gesture: "soft_bounce", intensity: 0.55, label: "軽く弾む" },
    { reply: "何のことか、もう少しだけ教えてくれる？", emotion: "curious", gesture: "head_tilt", intensity: 0.25, label: "首をかしげる" },
  ] as const;
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  for (const sample of cases) {
    await page.route("**/api/dialogue/stream", async (route) => {
      const original = await route.fetch();
      const events = (await original.text()).trim().split("\n").map(
        (line) => JSON.parse(line) as DialogueStreamEvent,
      );
      const start = events.find((event) => event.type === "start");
      const complete = events.find((event) => event.type === "complete");
      if (!start || !complete) throw new Error("Mock stream must contain start and complete events");
      const response = {
        ...complete.response,
        reply: sample.reply,
        performance: {
          emotion: sample.emotion, gesture: sample.gesture, intensity: sample.intensity,
          voice_style: "warm", cues: [],
        },
        continuity: {
          ...complete.response.continuity,
          emotion: sample.emotion, intensity: sample.intensity, carried_from_previous: false,
          gaze_behavior: sample.emotion === "curious" ? "curious" : "responsive",
          gesture_budget: sample.gesture === "none" ? 0 : 1,
        },
      };
      await route.fulfill({
        status: 200, contentType: "application/x-ndjson",
        body: [start, { type: "text_delta", delta: sample.reply, elapsed_ms: 1 },
          { type: "complete", response }].map((event) => JSON.stringify(event)).join("\n") + "\n",
      });
    });
    await page.goto("/");
    await page.getByRole("textbox", { name: "メッセージ" }).fill("表示確認");
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.locator("#dialogue-log .is-assistant p")).toHaveText(sample.reply);
    await expect(page.locator("#performance-status")).toHaveAttribute("data-emotion", sample.emotion);
    await expect(page.locator("#performance-detail")).toHaveText(sample.label);
    await expect(page.getByRole("button", { name: "送信" })).toBeEnabled();
    await expect(page.locator("#dialogue-error")).toBeHidden();
    await page.unroute("**/api/dialogue/stream");
  }
  expect(runtimeErrors).toEqual([]);
});
