import { SPEECH_VISEMES, type SpeechHealth, type SpeechSynthesisResult, type SpeechTiming } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SpeechApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly code: string | null = null,
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "SpeechApiError";
  }
}

export class SpeechClient {
  public constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api",
    private readonly timeoutMs = 35_000,
  ) {}

  public async getHealth(signal?: AbortSignal): Promise<SpeechHealth> {
    const response = await this.fetchWithTimeout("/speech/health", { method: "GET" }, signal, 5_000);
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw createSpeechApiError(response.status, payload);
    if (!isSpeechHealth(payload)) {
      throw new SpeechApiError("音声Backendから不正な接続情報が返りました。");
    }
    return payload;
  }

  public async synthesize(text: string, signal?: AbortSignal): Promise<SpeechSynthesisResult> {
    const response = await this.fetchWithTimeout(
      "/speech",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/wav" },
        body: JSON.stringify({ text }),
      },
      signal,
      this.timeoutMs,
    );
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw createSpeechApiError(response.status, payload);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("audio/wav")) {
      throw new SpeechApiError("音声BackendからWAV以外の応答が返りました。", response.status);
    }
    const audio = await response.blob();
    if (!(await isWav(audio))) {
      throw new SpeechApiError("音声Backendから有効なWAVが返りませんでした。", response.status);
    }
    return { audio, timing: parseSpeechTiming(response.headers) };
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error: unknown) {
      if (controller.signal.aborted && !parentSignal?.aborted) {
        throw new SpeechApiError("音声生成が時間内に完了しませんでした。", 504, "client_timeout");
      }
      if (parentSignal?.aborted) throw error;
      throw new SpeechApiError("音声Backendへ接続できませんでした。VOICEVOXの起動状態を確認してください。");
    } finally {
      globalThis.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
}

export function parseSpeechTiming(headers: Headers): SpeechTiming | null {
  if (headers.get("x-speech-timing-version") !== "1") return null;
  const durationMs = parseBoundedInteger(headers.get("x-speech-duration-ms"), 1, 300_000);
  if (durationMs === null) return null;

  return {
    durationMs,
    phraseBoundariesMs: parsePhraseBoundaries(headers.get("x-speech-phrase-boundaries"), durationMs),
    visemes: parseVisemes(headers.get("x-speech-visemes"), durationMs),
  };
}

function parsePhraseBoundaries(value: string | null, durationMs: number): readonly number[] {
  if (!value) return [];
  const result: number[] = [];
  for (const token of value.split(",")) {
    const boundary = parseBoundedInteger(token, 150, durationMs - 150);
    if (boundary === null || (result.at(-1) ?? -1) >= boundary || result.length >= 64) return [];
    result.push(boundary);
  }
  return result;
}

function parseVisemes(value: string | null, durationMs: number): SpeechTiming["visemes"] {
  if (!value) return [];
  const result: Array<SpeechTiming["visemes"][number]> = [];
  let previousStart = -1;
  for (const token of value.split(",")) {
    const [viseme, startToken, durationToken, ...extra] = token.split(":");
    const startMs = parseBoundedInteger(startToken ?? null, 0, durationMs - 1);
    const segmentDurationMs = parseBoundedInteger(durationToken ?? null, 1, durationMs);
    if (
      extra.length > 0 ||
      !SPEECH_VISEMES.includes(viseme as (typeof SPEECH_VISEMES)[number]) ||
      startMs === null ||
      segmentDurationMs === null ||
      startMs < previousStart ||
      startMs + segmentDurationMs > durationMs ||
      result.length >= 240
    ) {
      return [];
    }
    result.push({ viseme: viseme as (typeof SPEECH_VISEMES)[number], startMs, durationMs: segmentDurationMs });
    previousStart = startMs;
  }
  return result;
}

function parseBoundedInteger(value: string | null, minimum: number, maximum: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= minimum && result <= maximum ? result : null;
}

function createSpeechApiError(status: number, payload: unknown): SpeechApiError {
  if (isRecord(payload) && isRecord(payload["detail"])) {
    const detail = payload["detail"];
    return new SpeechApiError(
      typeof detail["message"] === "string" ? detail["message"] : "音声生成に失敗しました。",
      status,
      typeof detail["code"] === "string" ? detail["code"] : null,
      typeof detail["request_id"] === "string" ? detail["request_id"] : null,
    );
  }
  return new SpeechApiError("音声生成に失敗しました。VOICEVOXの起動状態を確認してください。", status);
}

async function isWav(blob: Blob): Promise<boolean> {
  if (blob.size < 12) return false;
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return readAscii(header, 0, 4) === "RIFF" && readAscii(header, 8, 12) === "WAVE";
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function isSpeechHealth(value: unknown): value is SpeechHealth {
  return (
    isRecord(value) &&
    (value["status"] === "ready" || value["status"] === "unavailable") &&
    value["provider"] === "voicevox" &&
    typeof value["speaker_id"] === "number" &&
    (typeof value["engine_version"] === "string" || value["engine_version"] === null) &&
    (typeof value["speaker_name"] === "string" || value["speaker_name"] === null) &&
    (typeof value["style_name"] === "string" || value["style_name"] === null) &&
    (typeof value["credit"] === "string" || value["credit"] === null) &&
    typeof value["message"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
