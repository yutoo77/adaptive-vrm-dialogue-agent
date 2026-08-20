export interface SpeechHealth {
  readonly status: "ready" | "unavailable";
  readonly provider: "voicevox";
  readonly speaker_id: number;
  readonly engine_version: string | null;
  readonly speaker_name: string | null;
  readonly style_name: string | null;
  readonly credit: string | null;
  readonly message: string;
}

export const SPEECH_VISEMES = ["a", "i", "u", "e", "o"] as const;
export type SpeechViseme = (typeof SPEECH_VISEMES)[number];

export interface SpeechVisemeSegment {
  readonly viseme: SpeechViseme;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface SpeechTiming {
  readonly durationMs: number;
  readonly phraseBoundariesMs: readonly number[];
  readonly visemes: readonly SpeechVisemeSegment[];
}

export interface SpeechSynthesisResult {
  readonly audio: Blob;
  readonly timing: SpeechTiming | null;
}

export type SpeechUiState =
  | "checking"
  | "available"
  | "generating"
  | "ready"
  | "playing"
  | "stopped"
  | "unavailable"
  | "error";

export interface SpeechStatus {
  readonly state: SpeechUiState;
  readonly message: string;
  readonly action: "none" | "stop" | "replay";
}
