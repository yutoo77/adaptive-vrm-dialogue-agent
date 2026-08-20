export interface TranscriptionHealth {
  readonly status: "ready";
  readonly provider: "faster-whisper";
  readonly model: string;
  readonly device: "cpu" | "cuda";
  readonly compute_type: string;
  readonly message: string;
}

export interface TranscriptionResponse {
  readonly text: string;
  readonly language: string;
  readonly language_probability: number;
  readonly audio_duration_seconds: number;
  readonly request_id: string;
  readonly latency_ms: number;
}

export type VoiceInputState =
  | "checking"
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "ready"
  | "unavailable"
  | "error";

export interface VoiceInputStatus {
  readonly state: VoiceInputState;
  readonly message: string;
  readonly action: "none" | "start" | "stop" | "cancel";
}

export interface MicrophoneOption {
  readonly deviceId: string;
  readonly label: string;
}
