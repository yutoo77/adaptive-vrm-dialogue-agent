import { describe, expect, it } from "vitest";
import type { SpeechStatus } from "../speech/types";
import type { VoiceInputStatus } from "../transcription/types";
import { speechStatusLabel, voiceStatusLabel } from "./statusPresentation";

const speechCases = {
  checking: "",
  available: "",
  generating: "音声を準備中…",
  ready: "",
  playing: "読み上げ中",
  stopped: "",
  unavailable: "読み上げを利用できません。文字で続けられます。",
  error: "読み上げに失敗しました。文字で続けられます。",
} satisfies Record<SpeechStatus["state"], string>;

const voiceCases = {
  checking: "",
  idle: "",
  requesting: "マイクを確認中…",
  recording: "録音中",
  processing: "文字に変換中…",
  ready: "",
  unavailable: "音声入力を利用できません。文字で入力できます。",
  error: "音声入力に失敗しました。文字で入力できます。",
} satisfies Record<VoiceInputStatus["state"], string>;

describe("speechStatusLabel", () => {
  it.each(Object.entries(speechCases))("presents %s as the requested short label", (state, expected) => {
    expect(speechStatusLabel({ state: state as SpeechStatus["state"] })).toBe(expected);
  });

  it("exposes autoplay recovery based on its reason, independently of message text", () => {
    const blocked: SpeechStatus = {
      state: "ready", action: "replay", message: "any message", reason: "autoplay-blocked",
    };
    expect(speechStatusLabel(blocked)).toBe("自動再生できません。「再生」を押してください。");
    expect(speechStatusLabel({ state: "ready" })).toBe("");
    expect(speechStatusLabel({ state: "playing" })).toBe("読み上げ中");
  });
});

describe("voiceStatusLabel", () => {
  it.each(Object.entries(voiceCases))("presents %s as the requested short label", (state, expected) => {
    expect(voiceStatusLabel({ state: state as VoiceInputStatus["state"] })).toBe(expected);
  });
});
