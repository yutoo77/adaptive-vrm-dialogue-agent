import type {
  DialogueHealth,
  DialogueProviderName,
  DialogueResponse,
  PersistentMemoryClearResponse,
  PersistentMemoryDeleteResponse,
  PersistentMemoryItem,
  PersistentMemoryListResponse,
  PersistentMemoryMutationResponse,
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

  public async sendMessage(message: string, sessionId: string, signal?: AbortSignal): Promise<DialogueResponse> {
    const payload = await this.request(
      "/dialogue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session_id: sessionId }),
      },
      signal,
      this.timeoutMs,
    );
    if (!isDialogueResponse(payload)) {
      throw new DialogueApiError("Backendから不正な応答が返りました。");
    }
    return payload;
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
    typeof value["persistent_memory_count"] === "number"
  );
}

function isDialogueResponse(value: unknown): value is DialogueResponse {
  return (
    isRecord(value) &&
    typeof value["reply"] === "string" &&
    isPerformancePlan(value["performance"]) &&
    isProviderName(value["provider"]) &&
    typeof value["model"] === "string" &&
    typeof value["request_id"] === "string" &&
    typeof value["latency_ms"] === "number" &&
    typeof value["session_id"] === "string" &&
    typeof value["memory_turns"] === "number" &&
    typeof value["memory_max_turns"] === "number" &&
    typeof value["session_summary_available"] === "boolean" &&
    typeof value["relevant_memory_count"] === "number" &&
    (value["saved_memory"] === null || isPersistentMemoryItem(value["saved_memory"]))
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
