import type { SpeechStatus } from "../speech/types";
import type { VoiceInputStatus } from "../transcription/types";

const SPEECH_LABELS: Readonly<Record<SpeechStatus["state"], string>> = {
  checking: "",
  available: "",
  generating: "音声を準備中…",
  ready: "",
  playing: "読み上げ中",
  stopped: "",
  unavailable: "読み上げを利用できません。文字で続けられます。",
  error: "読み上げに失敗しました。文字で続けられます。",
};

const VOICE_LABELS: Readonly<Record<VoiceInputStatus["state"], string>> = {
  checking: "",
  idle: "",
  requesting: "マイクを確認中…",
  recording: "録音中",
  processing: "文字に変換中…",
  ready: "",
  unavailable: "音声入力を利用できません。文字で入力できます。",
  error: "音声入力に失敗しました。文字で入力できます。",
};

export function speechStatusLabel(status: Pick<SpeechStatus, "state" | "reason">): string {
  if (status.reason === "autoplay-blocked") return "自動再生できません。「再生」を押してください。";
  return SPEECH_LABELS[status.state];
}

export function voiceStatusLabel(status: Pick<VoiceInputStatus, "state" | "code">): string {
  if (status.code === "transcription_busy") return "前の音声を処理中です。少し待って録り直してください。";
  return VOICE_LABELS[status.state];
}
