import { isExperienceAction, isExperienceSnapshot, isSessionId, type ExperienceAction, type ExperienceSnapshot } from "./types";

export interface ExperienceGateway {
  create(sessionId: string, signal?: AbortSignal): Promise<ExperienceSnapshot>;
  get(sessionId: string, signal?: AbortSignal): Promise<ExperienceSnapshot>;
  action(sessionId: string, revision: number, action: ExperienceAction, signal?: AbortSignal): Promise<ExperienceSnapshot>;
  cancel(sessionId: string): Promise<void>;
}

export class ExperienceApiError extends Error {
  public constructor(message: string, public readonly status: number | null = null) {
    super(message);
    this.name = "ExperienceApiError";
  }
}

export class ExperienceClient implements ExperienceGateway {
  public constructor(
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api/experience",
    private readonly timeoutMs = 35_000,
  ) {}

  public async create(sessionId: string, signal?: AbortSignal): Promise<ExperienceSnapshot> {
    return this.snapshot("/sessions", "POST", sessionId, { session_id: sessionId }, signal);
  }

  public async get(sessionId: string, signal?: AbortSignal): Promise<ExperienceSnapshot> {
    return this.snapshot(`/sessions/${encodeURIComponent(sessionId)}`, "GET", sessionId, undefined, signal);
  }

  public async action(sessionId: string, revision: number, action: ExperienceAction, signal?: AbortSignal): Promise<ExperienceSnapshot> {
    if (!isExperienceAction(action) || !Number.isSafeInteger(revision) || revision < 0) {
      throw new ExperienceApiError("操作の形式を確認できませんでした。");
    }
    const snapshot = await this.snapshot("/action", "POST", sessionId, {
      session_id: sessionId, expected_revision: revision, ...action,
    }, signal);
    if (snapshot.revision <= revision) throw new ExperienceApiError("進行番号を確認できませんでした。状態を確認してください。");
    return snapshot;
  }

  public async cancel(sessionId: string): Promise<void> {
    this.validateId(sessionId);
    const payload = await this.request(`/sessions/${encodeURIComponent(sessionId)}/active`, "DELETE", undefined);
    if (typeof payload !== "object" || payload === null || !("cancelled" in payload) || typeof payload.cancelled !== "boolean") {
      throw new ExperienceApiError("相談の停止を確認できませんでした。");
    }
  }

  private async snapshot(path: string, method: string, sessionId: string, body?: unknown, signal?: AbortSignal): Promise<ExperienceSnapshot> {
    this.validateId(sessionId);
    const payload = await this.request(path, method, body, signal);
    if (!isExperienceSnapshot(payload) || payload.session_id !== sessionId) {
      throw new ExperienceApiError("体験の応答を安全に確認できませんでした。状態を確認してください。");
    }
    return payload;
  }

  private validateId(sessionId: string): void {
    if (!isSessionId(sessionId)) throw new ExperienceApiError("体験のIDを確認できませんでした。");
  }

  private async request(path: string, method: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(), method === "POST" ? this.timeoutMs : 5_000);
    try {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method, signal: controller.signal,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = response.status === 404 ? "この体験の進行は見つかりません。Backendの再起動や期限切れの可能性があります。" :
          response.status === 409 ? "進行が更新されていました。最新の状態を確認します。" :
          response.status === 422 ? "この操作は受け付けられませんでした。状態を確認してください。" :
          "体験の処理を完了できませんでした。Backendの起動状態を確認してください。";
        throw new ExperienceApiError(message, response.status);
      }
      return payload;
    } catch (error: unknown) {
      if (signal?.aborted || error instanceof ExperienceApiError) throw error;
      throw new ExperienceApiError(controller.signal.aborted ?
        "応答の待ち時間を超えました。操作が反映済みの可能性があるため、まず状態を確認してください。" :
        "Backendへ接続できませんでした。入力は残っています。起動後に状態を確認してください。");
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
