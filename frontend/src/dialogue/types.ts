import type { GazeBehavior, PerformanceEmotion, PerformancePlan } from "../types/character";

export type DialogueProviderName = "mock" | "openai";
export type DialogueRole = "user" | "assistant";
export const RESPONSE_STYLES = ["concise", "balanced", "detailed", "beginner"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

export interface CharacterVoiceProfile {
  readonly provider: "voicevox";
  readonly speaker_id: number;
  readonly speed_scale: number;
  readonly pitch_scale: number;
  readonly intonation_scale: number;
}

export interface CharacterPerformanceProfile {
  readonly maximum_intensity: number;
  readonly cue_intensity_scale: number;
  readonly default_voice_style: "neutral" | "warm" | "bright" | "gentle" | "serious";
}

export interface CharacterProfile {
  readonly id: string;
  readonly version: string;
  readonly display_name: string;
  readonly short_name: string;
  readonly tagline: string;
  readonly self_reference: string;
  readonly user_reference: string;
  readonly speech_principles: readonly string[];
  readonly values: readonly string[];
  readonly avoided_expressions: readonly string[];
  readonly theme_colors: readonly [string, string, string];
  readonly voice: CharacterVoiceProfile;
  readonly performance: CharacterPerformanceProfile;
}

export interface DialogueHealth {
  readonly status: "ready" | "configuration_error";
  readonly provider: DialogueProviderName;
  readonly model: string;
  readonly api_key_configured: boolean;
  readonly message: string;
  readonly session_memory_enabled: boolean;
  readonly session_memory_max_turns: number;
  readonly session_summary_enabled: boolean;
  readonly emotional_continuity_enabled: boolean;
  readonly emotional_continuity_max_carry_turns: number;
  readonly persistent_memory_enabled: boolean;
  readonly persistent_memory_count: number;
  readonly character: CharacterProfile;
}

export interface EmotionalContinuity {
  readonly emotion: PerformanceEmotion;
  readonly intensity: number;
  readonly turn_index: number;
  readonly turns_held: number;
  readonly carried_from_previous: boolean;
  readonly gaze_behavior: GazeBehavior;
  readonly motion_scale: number;
  readonly gesture_budget: number;
}

export interface PersistentMemoryItem {
  readonly id: string;
  readonly content: string;
  readonly source: "manual" | "explicit";
  readonly created_at: string;
  readonly updated_at: string;
  readonly use_count: number;
}

export interface PersistentMemoryListResponse {
  readonly items: readonly PersistentMemoryItem[];
  readonly total: number;
}

export interface PersistentMemoryMutationResponse {
  readonly item: PersistentMemoryItem;
  readonly created: boolean;
}

export interface PersistentMemoryDeleteResponse {
  readonly id: string;
  readonly deleted: boolean;
}

export interface PersistentMemoryClearResponse {
  readonly deleted_count: number;
}

export interface DialogueResponse {
  readonly reply: string;
  readonly response_style: ResponseStyle;
  readonly performance: PerformancePlan;
  readonly continuity: EmotionalContinuity;
  readonly provider: DialogueProviderName;
  readonly model: string;
  readonly request_id: string;
  readonly latency_ms: number;
  readonly first_text_ms: number;
  readonly text_complete_ms: number;
  readonly session_id: string;
  readonly memory_turns: number;
  readonly memory_max_turns: number;
  readonly session_summary_available: boolean;
  readonly relevant_memory_count: number;
  readonly saved_memory: PersistentMemoryItem | null;
}

export interface DialogueStreamStartEvent {
  readonly type: "start";
  readonly request_id: string;
  readonly provider: DialogueProviderName;
  readonly model: string;
}

export interface DialogueStreamTextDeltaEvent {
  readonly type: "text_delta";
  readonly delta: string;
  readonly elapsed_ms: number;
}

export interface DialogueStreamCompleteEvent {
  readonly type: "complete";
  readonly response: DialogueResponse;
}

export type DialogueStreamEvent =
  | DialogueStreamStartEvent
  | DialogueStreamTextDeltaEvent
  | DialogueStreamCompleteEvent;

export interface SessionResetResponse {
  readonly session_id: string;
  readonly cleared_turns: number;
  readonly cleared_emotional_state: boolean;
}

export interface DialogueCancellationResponse {
  readonly session_id: string;
  readonly cancelled: boolean;
}

export function isResponseStyle(value: unknown): value is ResponseStyle {
  return RESPONSE_STYLES.some((style) => style === value);
}
