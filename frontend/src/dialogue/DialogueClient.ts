import { isResponseStyle } from "./types";
import type {
  CharacterProfile,
  DialogueCancellationResponse,
  DialogueHealth,
  DialogueProviderName,
  DialogueResponse,
  DialogueStreamEvent,
  PersistentMemoryClearResponse,
  PersistentMemoryDeleteResponse,
  PersistentMemoryItem,
  PersistentMemoryListResponse,
  PersistentMemoryMutationResponse,
  ResponseStyle,
  SessionResetResponse,
} from "./types";
import { isPerformancePlan } from "../types/character";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class DialogueApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly code: string | null = null,
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "DialogueApiError";
  }
}

export class DialogueClient {
  public constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api",
    private readonly timeoutMs = 35_000,
  ) {}

  public async getHealth(signal?: AbortSignal): Promise<DialogueHealth> {
    const payload = await this.request("/health", { method: "GET" }, signal, 5_000);
    if (!isDialogueHealth(payload)) {
      throw new DialogueApiError("Backendから不正な接続情報が返りました。");
    }
    return payload;
  }

  public async sendMessage(
    message: string,
    sessionId: string,
    responseStyle: ResponseStyle,
    signal?: AbortSignal,
  ): Promise<DialogueResponse> {
    const payload = await this.request(
      "/dialogue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session_id: sessionId, response_style: responseStyle }),
      },
      signal,
      this.timeoutMs,
    );
    if (!isDialogueResponse(payload)) {
      throw new DialogueApiError("Backendから不正な応答が返りました。");
    }
    return payload;
  }

  public async streamMessage(
    message: string,
    sessionId: string,
    responseStyle: ResponseStyle,
    onTextDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<DialogueResponse> {
    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/dialogue/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ message, session_id: sessionId, response_style: responseStyle }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw createApiError(response.status, payload);
      }
      if (!response.body) {
        throw new DialogueApiError("BackendがStreaming応答を開始できませんでした。", 502, "stream_unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;
      let completed: DialogueResponse | null = null;
      const acceptEvent = (event: DialogueStreamEvent | null): void => {
        if (!event) return;
        if (event.type === "start") {
          if (started || completed) throw invalidStreamError();
          started = true;
          return;
        }
        if (!started || completed) throw invalidStreamError();
        if (event.type === "text_delta") onTextDelta(event.delta);
        if (event.type === "complete") completed = event.response;
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (buffer.length > 64_000) {
          throw new DialogueApiError("BackendのStreaming応答が上限を超えました。", 502, "stream_too_large");
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          acceptEvent(parseDialogueStreamEvent(line));
        }
        if (chunk.done) break;
      }
      acceptEvent(parseDialogueStreamEvent(buffer));
      if (!completed) {
        throw new DialogueApiError(
          "BackendのStreaming応答が完了する前に終了しました。",
          502,
          "incomplete_stream",
        );
      }
      return completed;
    } catch (error: unknown) {
      if (error instanceof DialogueApiError) throw error;
      if (controller.signal.aborted && !signal?.aborted) {
        throw new DialogueApiError("Backendの応答が時間内に返りませんでした。", 504, "client_timeout");
      }
      if (signal?.aborted) throw error;
      throw new DialogueApiError("Backendへ接続できませんでした。起動状態を確認してください。");
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  public async resetSession(sessionId: string, signal?: AbortSignal): Promise<SessionResetResponse> {
    const payload = await this.request(
      `/dialogue/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
      signal,
      5_000,
    );
    if (!isSessionResetResponse(payload)) {
      throw new DialogueApiError("Backendから不正な会話リセット情報が返りました。");
    }
    return payload;
  }

  public async cancelActiveDialogue(sessionId: string): Promise<DialogueCancellationResponse> {
    const payload = await this.request(
      `/dialogue/sessions/${encodeURIComponent(sessionId)}/active`,
      { method: "DELETE" },
      undefined,
      5_000,
    );
    if (!isDialogueCancellationResponse(payload)) {
      throw new DialogueApiError("Backendから不正な応答停止情報が返りました。");
    }
    return payload;
  }

  public async listMemories(signal?: AbortSignal): Promise<PersistentMemoryListResponse> {
    const payload = await this.request("/memories", { method: "GET" }, signal, 5_000);
    if (!isPersistentMemoryListResponse(payload)) {
      throw new DialogueApiError("Backendから不正な長期記憶一覧が返りました。");
    }
    return payload;
  }

  public async createMemory(content: string, signal?: AbortSignal): Promise<PersistentMemoryMutationResponse> {
    return this.mutateMemory("/memories", "POST", content, signal);
  }

  public async updateMemory(
    memoryId: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<PersistentMemoryMutationResponse> {
    return this.mutateMemory(`/memories/${encodeURIComponent(memoryId)}`, "PATCH", content, signal);
  }

  public async deleteMemory(memoryId: string, signal?: AbortSignal): Promise<PersistentMemoryDeleteResponse> {
    const payload = await this.request(
      `/memories/${encodeURIComponent(memoryId)}`,
      { method: "DELETE" },
      signal,
      5_000,
    );
    if (!isPersistentMemoryDeleteResponse(payload)) {
      throw new DialogueApiError("Backendから不正な長期記憶削除情報が返りました。");
    }
    return payload;
  }

  public async clearMemories(signal?: AbortSignal): Promise<PersistentMemoryClearResponse> {
    const payload = await this.request("/memories", { method: "DELETE" }, signal, 5_000);
    if (!isPersistentMemoryClearResponse(payload)) {
      throw new DialogueApiError("Backendから不正な長期記憶全削除情報が返りました。");
    }
    return payload;
  }

  private async mutateMemory(
    path: string,
    method: "POST" | "PATCH",
    content: string,
    signal?: AbortSignal,
  ): Promise<PersistentMemoryMutationResponse> {
    const payload = await this.request(
      path,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
      signal,
      5_000,
    );
    if (!isPersistentMemoryMutationResponse(payload)) {
      throw new DialogueApiError("Backendから不正な長期記憶更新情報が返りました。");
    }
    return payload;
  }

  private async request(
    path: string,
    init: RequestInit,
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw createApiError(response.status, payload);
      return payload;
    } catch (error: unknown) {
      if (error instanceof DialogueApiError) throw error;
      if (controller.signal.aborted && !parentSignal?.aborted) {
        throw new DialogueApiError("Backendの応答が時間内に返りませんでした。", 504, "client_timeout");
      }
      if (parentSignal?.aborted) throw error;
      throw new DialogueApiError("Backendへ接続できませんでした。起動状態を確認してください。");
    } finally {
      globalThis.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
}

function createApiError(status: number, payload: unknown): DialogueApiError {
  if (isRecord(payload) && isRecord(payload["detail"])) {
    const detail = payload["detail"];
    return new DialogueApiError(
      typeof detail["message"] === "string" ? detail["message"] : "Backendでエラーが発生しました。",
      status,
      typeof detail["code"] === "string" ? detail["code"] : null,
      typeof detail["request_id"] === "string" ? detail["request_id"] : null,
    );
  }
  if (status >= 500) {
    return new DialogueApiError(
      "Backendで処理を完了できませんでした。起動状態を確認して、もう一度送信してください。",
      status,
      "backend_unavailable",
    );
  }
  return new DialogueApiError(
    "Backendがリクエストを処理できませんでした。画面を再読み込みして、もう一度試してください。",
    status,
    "request_failed",
  );
}

function isDialogueHealth(value: unknown): value is DialogueHealth {
  return (
    isRecord(value) &&
    (value["status"] === "ready" || value["status"] === "configuration_error") &&
    isProviderName(value["provider"]) &&
    typeof value["model"] === "string" &&
    typeof value["api_key_configured"] === "boolean" &&
    typeof value["message"] === "string" &&
    typeof value["session_memory_enabled"] === "boolean" &&
    typeof value["session_memory_max_turns"] === "number" &&
    typeof value["session_summary_enabled"] === "boolean" &&
    typeof value["persistent_memory_enabled"] === "boolean" &&
    typeof value["persistent_memory_count"] === "number" &&
    isCharacterProfile(value["character"])
  );
}

function isCharacterProfile(value: unknown): value is CharacterProfile {
  if (!isRecord(value) || !isRecord(value["voice"]) || !isRecord(value["performance"])) return false;
  const voice = value["voice"];
  const performance = value["performance"];
  const colors = value["theme_colors"];
  return (
    typeof value["id"] === "string" && /^[a-z0-9_]{3,64}$/.test(value["id"]) &&
    typeof value["version"] === "string" && /^\d+\.\d+\.\d+$/.test(value["version"]) &&
    isNonemptyString(value["display_name"]) &&
    isNonemptyString(value["short_name"]) &&
    isNonemptyString(value["tagline"]) &&
    isNonemptyString(value["self_reference"]) &&
    isNonemptyString(value["user_reference"]) &&
    isStringArray(value["speech_principles"]) &&
    isStringArray(value["values"]) &&
    isStringArray(value["avoided_expressions"]) &&
    Array.isArray(colors) &&
    colors.length === 3 &&
    colors.every((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) &&
    voice["provider"] === "voicevox" &&
    isNumberInRange(voice["speaker_id"], 0, 100_000) &&
    Number.isInteger(voice["speaker_id"]) &&
    isNumberInRange(voice["speed_scale"], 0.5, 2) &&
    isNumberInRange(voice["pitch_scale"], -0.15, 0.15) &&
    isNumberInRange(voice["intonation_scale"], 0, 2) &&
    isNumberInRange(performance["maximum_intensity"], 0.2, 1) &&
    isNumberInRange(performance["cue_intensity_scale"], 0, 1) &&
    isVoiceStyle(performance["default_voice_style"])
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonemptyString);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isVoiceStyle(value: unknown): value is CharacterProfile["performance"]["default_voice_style"] {
  return ["neutral", "warm", "bright", "gentle", "serious"].some((style) => style === value);
}

function isDialogueResponse(value: unknown): value is DialogueResponse {
  return (
    isRecord(value) &&
    typeof value["reply"] === "string" &&
    isResponseStyle(value["response_style"]) &&
    isPerformancePlan(value["performance"]) &&
    isProviderName(value["provider"]) &&
    typeof value["model"] === "string" &&
    typeof value["request_id"] === "string" &&
    typeof value["latency_ms"] === "number" &&
    typeof value["first_text_ms"] === "number" &&
    typeof value["text_complete_ms"] === "number" &&
    typeof value["session_id"] === "string" &&
    typeof value["memory_turns"] === "number" &&
    typeof value["memory_max_turns"] === "number" &&
    typeof value["session_summary_available"] === "boolean" &&
    typeof value["relevant_memory_count"] === "number" &&
    (value["saved_memory"] === null || isPersistentMemoryItem(value["saved_memory"]))
  );
}

function parseDialogueStreamEvent(line: string): DialogueStreamEvent | null {
  const normalized = line.trim();
  if (!normalized) return null;
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new DialogueApiError("Backendから不正なStreaming応答が返りました。", 502, "invalid_stream");
  }
  if (!isRecord(value) || typeof value["type"] !== "string") {
    throw new DialogueApiError("Backendから不正なStreaming応答が返りました。", 502, "invalid_stream");
  }
  if (value["type"] === "error" && isRecord(value["error"])) {
    const error = value["error"];
    throw new DialogueApiError(
      typeof error["message"] === "string" ? error["message"] : "Backendでエラーが発生しました。",
      null,
      typeof error["code"] === "string" ? error["code"] : "stream_failed",
      typeof error["request_id"] === "string" ? error["request_id"] : null,
    );
  }
  if (
    value["type"] === "start" &&
    typeof value["request_id"] === "string" &&
    isProviderName(value["provider"]) &&
    typeof value["model"] === "string"
  ) {
    return value as unknown as DialogueStreamEvent;
  }
  if (
    value["type"] === "text_delta" &&
    typeof value["delta"] === "string" &&
    typeof value["elapsed_ms"] === "number"
  ) {
    return value as unknown as DialogueStreamEvent;
  }
  if (value["type"] === "complete" && isDialogueResponse(value["response"])) {
    return value as unknown as DialogueStreamEvent;
  }
  throw new DialogueApiError("Backendから不正なStreaming応答が返りました。", 502, "invalid_stream");
}

function invalidStreamError(): DialogueApiError {
  return new DialogueApiError("Backendから不正なStreaming応答順序が返りました。", 502, "invalid_stream");
}

function isDialogueCancellationResponse(value: unknown): value is DialogueCancellationResponse {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    typeof value["cancelled"] === "boolean"
  );
}

function isPersistentMemoryItem(value: unknown): value is PersistentMemoryItem {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["content"] === "string" &&
    (value["source"] === "manual" || value["source"] === "explicit") &&
    typeof value["created_at"] === "string" &&
    typeof value["updated_at"] === "string" &&
    typeof value["use_count"] === "number"
  );
}

function isPersistentMemoryListResponse(value: unknown): value is PersistentMemoryListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every(isPersistentMemoryItem) &&
    typeof value["total"] === "number"
  );
}

function isPersistentMemoryMutationResponse(value: unknown): value is PersistentMemoryMutationResponse {
  return isRecord(value) && isPersistentMemoryItem(value["item"]) && typeof value["created"] === "boolean";
}

function isPersistentMemoryDeleteResponse(value: unknown): value is PersistentMemoryDeleteResponse {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["deleted"] === "boolean";
}

function isPersistentMemoryClearResponse(value: unknown): value is PersistentMemoryClearResponse {
  return isRecord(value) && typeof value["deleted_count"] === "number";
}

function isSessionResetResponse(value: unknown): value is SessionResetResponse {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    typeof value["cleared_turns"] === "number"
  );
}

function isProviderName(value: unknown): value is DialogueProviderName {
  return value === "mock" || value === "openai";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
