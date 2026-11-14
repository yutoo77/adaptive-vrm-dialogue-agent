import { describe, expect, it } from "vitest";
import type { SpeechStatus } from "../speech/types";
import { speechStatusSummary } from "./speechStatusPresentation";

describe("dialogue speech status summary", () => {
  it.each([
    ["checking", "音声出力を確認しています…"],
    ["available", "音声を利用できます"],
    ["generating", "音声を準備しています…"],
    ["playing", "読み上げ中"],
    ["ready", "読み上げが終わりました"],
    ["stopped", "読み上げを停止しました"],
    ["unavailable", "音声未接続"],
    ["error", "再生できません・文字で会話できます"],
  ] as const)("keeps %s distinct", (state, expected) => {
    expect(speechStatusSummary({ state })).toBe(expected);
  });

  it("does not mistake blocked autoplay for completed playback", () => {
    const blocked: SpeechStatus = {
      state: "ready", reason: "autoplay-blocked", action: "replay", message: "original detail",
    };
    expect(speechStatusSummary(blocked)).toBe("自動再生できません。「もう一度再生」を押してください。");
    expect(speechStatusSummary({ state: "ready" })).toBe("読み上げが終わりました");
    expect(blocked.message).toBe("original detail");
  });
});
