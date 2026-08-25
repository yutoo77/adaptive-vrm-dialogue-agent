import type { PerformancePlan } from "../types/character";

export type DialogueProviderName = "mock" | "openai";
export type DialogueRole = "user" | "assistant";
export const RESPONSE_STYLES = ["concise", "balanced", "detailed", "beginner"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

export interface DialogueHealth {
  readonly status: "ready" | "configuration_error";
  readonly provider: DialogueProviderName;
  readonly model: string;
  readonly api_key_configured: boolean;
  readonly message: string;
  readonly session_memory_enabled: boolean;
  readonly session_memory_max_turns: number;
  readonly session_summary_enabled: boolean;
  readonly persistent_memory_enabled: boolean;
  readonly persistent_memory_count: number;
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
}

export interface DialogueCancellationResponse {
  readonly session_id: string;
  readonly cancelled: boolean;
}

export function isResponseStyle(value: unknown): value is ResponseStyle {
  return RESPONSE_STYLES.some((style) => style === value);
}
