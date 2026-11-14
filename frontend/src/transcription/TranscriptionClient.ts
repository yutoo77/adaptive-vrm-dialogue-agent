import type { TranscriptionHealth, TranscriptionResponse } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class TranscriptionApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly code: string | null = null,
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "TranscriptionApiError";
  }
}

export class TranscriptionClient {
  public constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api",
    private readonly timeoutMs = 120_000,
  ) {}

  public async getHealth(signal?: AbortSignal): Promise<TranscriptionHealth> {
    // Only this read-only probe retries. Never repeat a recording upload automatically.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const payload = await this.request("/transcription/health", { method: "GET", cache: "no-store" }, signal, 5_000);
        if (!isTranscriptionHealth(payload)) {
          throw new TranscriptionApiError("音声入力の接続情報が想定した形式と異なります。再接続してください。", 200, "client_invalid_health");
        }
        return payload;
      } catch (error: unknown) {
        if (attempt >= 1 || signal?.aborted || !canRetryHealth(error)) throw error;
        await waitForHealthRetry(signal);
      }
    }
  }

  public async transcribe(audio: Blob, signal?: AbortSignal): Promise<TranscriptionResponse> {
    const body = new FormData();
    body.append("audio", audio, recordingFileName(audio.type));
    const payload = await this.request(
      "/transcription",
      { method: "POST", body },
      signal,
      this.timeoutMs,
    );
    if (!isTranscriptionResponse(payload)) {
      throw new TranscriptionApiError("Backendから不正な文字起こし結果が返りました。");
    }
    return payload;
  }

  private async request(
    path: string,
    init: RequestInit,
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    parentSignal?.throwIfAborted();
    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      let payload: unknown;
      try { payload = await response.json(); }
      catch {
        if (response.ok) throw new TranscriptionApiError("音声認識Backendの返答をJSONとして読み取れませんでした。接続先を確認してください。", response.status, "client_invalid_json");
        payload = null;
      }
      controller.signal.throwIfAborted();
      if (!response.ok) throw createApiError(response.status, payload);
      return payload;
    } catch (error: unknown) {
      if (parentSignal?.aborted) throw parentSignal.reason;
      if (controller.signal.aborted) {
        throw new TranscriptionApiError("音声認識が時間内に完了しませんでした。", 504, "client_timeout");
      }
      if (error instanceof TranscriptionApiError) throw error;
      throw new TranscriptionApiError("音声認識Backendへ接続できませんでした。起動状態を確認してください。", null, "client_unreachable");
    } finally {
      globalThis.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
}

function canRetryHealth(error: unknown): boolean {
  return error instanceof TranscriptionApiError &&
    !(error.status !== null && error.status >= 400 && error.status < 500);
}

function waitForHealthRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = (): void => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 350);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function createApiError(status: number, payload: unknown): TranscriptionApiError {
  if (isRecord(payload) && isRecord(payload["detail"])) {
    const detail = payload["detail"];
    return new TranscriptionApiError(
      typeof detail["message"] === "string" ? detail["message"] : "音声認識でエラーが発生しました。",
      status,
      typeof detail["code"] === "string" ? detail["code"] : null,
      typeof detail["request_id"] === "string" ? detail["request_id"] : null,
    );
  }
  return new TranscriptionApiError(
    status >= 500
      ? "音声認識を完了できませんでした。Backendの起動状態を確認してください。"
      : "録音データを処理できませんでした。もう一度録音してください。",
    status,
    status >= 500 ? "backend_unavailable" : "request_failed",
  );
}

function recordingFileName(mimeType: string): string {
  if (mimeType.includes("ogg")) return "recording.ogg";
  if (mimeType.includes("mp4")) return "recording.m4a";
  if (mimeType.includes("wav")) return "recording.wav";
  return "recording.webm";
}

function isTranscriptionHealth(value: unknown): value is TranscriptionHealth {
  return (
    isRecord(value) &&
    value["status"] === "ready" &&
    value["provider"] === "faster-whisper" &&
    typeof value["model"] === "string" &&
    (value["device"] === "cpu" || value["device"] === "cuda") &&
    typeof value["compute_type"] === "string" &&
    typeof value["message"] === "string"
  );
}

function isTranscriptionResponse(value: unknown): value is TranscriptionResponse {
  return (
    isRecord(value) &&
    typeof value["text"] === "string" &&
    typeof value["language"] === "string" &&
    typeof value["language_probability"] === "number" &&
    typeof value["audio_duration_seconds"] === "number" &&
    typeof value["request_id"] === "string" &&
    typeof value["latency_ms"] === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
