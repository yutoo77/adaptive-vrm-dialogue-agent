import type { SpeechStatus } from "../speech/types";

const SUMMARIES: Readonly<Record<SpeechStatus["state"], string>> = {
  checking: "音声出力を確認しています…",
  available: "音声を利用できます",
  generating: "音声を準備しています…",
  playing: "読み上げ中",
  ready: "読み上げが終わりました",
  stopped: "読み上げを停止しました",
  unavailable: "音声未接続",
  error: "再生できません・文字で会話できます",
};

export function speechStatusSummary(status: Pick<SpeechStatus, "state" | "reason">): string {
  if (status.reason === "autoplay-blocked") return "自動再生できません。「もう一度再生」を押してください。";
  return SUMMARIES[status.state];
}
