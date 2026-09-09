import { describe, expect, it, vi } from "vitest";
import { ExperienceApiError, ExperienceClient, type ExperienceGateway } from "./ExperienceClient";
import { ExperienceSession } from "./ExperienceSession";
import { isExperienceAction, isExperienceSnapshot, placeMoon, type ExperienceSnapshot } from "./types";

const ID = "experience-test-session-123";
const SNAPSHOT: ExperienceSnapshot = {
  session_id: ID, revision: 0, phase: "active", inspected: [], hint_level: 0,
  arrangement: [null, null, null], attempts: 0, reply: "小さな書斎で、手紙を読んでみよう。",
  performance: { emotion: "gentle", intensity: 0.3, gesture: "small_nod", voice_style: "warm", cues: [] },
  focus_target: null, messages: [{ role: "assistant", text: "手紙を読んでみよう。" }],
  narration_provider: "scripted", notice: null,
};

function gateway() {
  return {
    create: vi.fn<ExperienceGateway["create"]>().mockResolvedValue(SNAPSHOT),
    get: vi.fn<ExperienceGateway["get"]>().mockResolvedValue(SNAPSHOT),
    action: vi.fn<ExperienceGateway["action"]>().mockResolvedValue({ ...SNAPSHOT, revision: 1 }),
    cancel: vi.fn<ExperienceGateway["cancel"]>().mockResolvedValue(undefined),
  };
}

function setup(service = gateway()) {
  const onReply = vi.fn();
  const onChange = vi.fn();
  const session = new ExperienceSession(service, { onReply, onChange }, () => ID);
  session.enter();
  return { service, onReply, onChange, session };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("experience validation and placement", () => {
  it("accepts the bounded contract", () => {
    expect(isExperienceSnapshot(SNAPSHOT)).toBe(true);
    expect(isExperienceAction({ action: "arrange", arrangement: ["half", null, "crescent"] })).toBe(true);
  });

  it.each([
    { session_id: "../invalid" }, { revision: -1 }, { revision: Infinity }, { phase: "unlocked" },
    { inspected: ["window", "window"] }, { inspected: ["computer"] }, { hint_level: 4 },
    { arrangement: [null, null] }, { arrangement: ["full", "full", null] }, { attempts: -1 },
    { reply: "" }, { reply: "x".repeat(1001) }, { focus_target: "remote" },
    { narration_provider: "unknown" }, { messages: Array.from({ length: 25 }, () => ({ role: "user", text: "x" })) },
    { messages: [{ role: "system", text: "x" }] },
    { performance: { ...SNAPSHOT.performance, intensity: 0.46 } },
    { performance: { ...SNAPSHOT.performance, gesture: "soft_bounce" } },
    { performance: { ...SNAPSHOT.performance, cues: [{ at: 0.3, intensity: 0.4, gesture: "soft_bounce" }] } },
    { performance: { ...SNAPSHOT.performance, cues: [{ at: 0.3, intensity: 0.6, gesture: "small_nod" }] } },
  ])("rejects invalid/unsafe snapshot data: %j", (override) => {
    expect(isExperienceSnapshot({ ...SNAPSHOT, ...override })).toBe(false);
  });

  it("rejects irrelevant action arguments and unbounded messages", () => {
    expect(isExperienceAction({ action: "submit", message: "open" })).toBe(false);
    expect(isExperienceAction({ action: "inspect", target: "window", arrangement: [null, null, null] })).toBe(false);
    expect(isExperienceAction({ action: "message", message: " " })).toBe(false);
    expect(isExperienceAction({ action: "message", message: "x".repeat(501) })).toBe(false);
  });

  it("moves cards without duplication and replaces the target card", () => {
    const original = ["half", "full", "crescent"] as const;
    expect(placeMoon(original, "half", 2)).toEqual([null, "full", "half"]);
    expect(original).toEqual(["half", "full", "crescent"]);
    expect(placeMoon(original, "half", -1)).toBe(original);
  });
});

describe("ExperienceClient", () => {
  it("uses only scoped experience endpoints and validates the session identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(SNAPSHOT)));
    const client = new ExperienceClient(fetcher);
    await client.create(ID);
    expect(fetcher).toHaveBeenCalledWith("/api/experience/sessions", expect.objectContaining({
      method: "POST", body: JSON.stringify({ session_id: ID }),
    }));
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ...SNAPSHOT, session_id: "another-session-1234" })));
    await expect(client.get(ID)).rejects.toThrow("安全に確認できません");
  });

  it("rejects bad arguments before any network call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new ExperienceClient(fetcher);
    await expect(client.get("../wrong")).rejects.toThrow();
    await expect(client.action(ID, -1, { action: "submit" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not retry a failed mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const client = new ExperienceClient(fetcher);
    await expect(client.action(ID, 0, { action: "hint" })).rejects.toBeInstanceOf(ExperienceApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("honors an already aborted signal", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new ExperienceClient(fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(client.get(ID, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires successful action responses to advance the revision", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(SNAPSHOT)));
    await expect(new ExperienceClient(fetcher).action(ID, 0, { action: "hint" })).rejects.toThrow("進行番号");
  });

  it("preserves HTTP conflict/expiry status without trusting server error text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 409 }));
    await expect(new ExperienceClient(fetcher).get(ID)).rejects.toMatchObject({ status: 409 });
    fetcher.mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(new ExperienceClient(fetcher).get(ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe("ExperienceSession RAM lifecycle", () => {
  it("starts only on explicit action, then refreshes silently on resume", async () => {
    const { session, service, onReply } = setup();
    expect(service.create).not.toHaveBeenCalled();
    await session.start();
    expect(onReply).toHaveBeenCalledTimes(1);
    session.leave();
    session.enter();
    await vi.waitFor(() => expect(service.get).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(session.state.busy).toBe(false));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it("uses distinct per-instance state rather than dialogue/browser storage", async () => {
    const first = setup();
    const second = setup();
    await first.session.start();
    expect(first.session.state.snapshot).not.toBeNull();
    expect(second.session.state.snapshot).toBeNull();
    expect(second.service.create).not.toHaveBeenCalled();
  });

  it("blocks double actions and releases busy before delivering a reply", async () => {
    const { session, service, onReply } = setup();
    await session.start();
    const waiting = deferred<ExperienceSnapshot>();
    service.action.mockReturnValue(waiting.promise);
    onReply.mockImplementation(() => expect(session.state.busy).toBe(false));
    const first = session.action({ action: "hint" });
    expect(await session.action({ action: "hint" })).toBe(false);
    waiting.resolve({ ...SNAPSHOT, revision: 1 });
    expect(await first).toBe(true);
    expect(service.action).toHaveBeenCalledTimes(1);
  });

  it("aborts and cancels pending narration on leave, suppressing a late response", async () => {
    const { session, service, onReply } = setup();
    await session.start();
    const waiting = deferred<ExperienceSnapshot>();
    service.action.mockReturnValue(waiting.promise);
    const pending = session.action({ action: "message", message: "少し教えて" });
    await vi.waitFor(() => expect(service.action).toHaveBeenCalledTimes(1));
    const signal = service.action.mock.calls[0]?.[3];
    session.leave();
    expect(signal?.aborted).toBe(true);
    waiting.resolve({ ...SNAPSHOT, revision: 1 });
    expect(await pending).toBe(false);
    await vi.waitFor(() => expect(service.cancel).toHaveBeenCalledWith(ID));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(session.state.snapshot?.revision).toBe(0);
  });

  it("waits for cancellation before reconciling a quick return", async () => {
    const { session, service } = setup();
    await session.start();
    const waiting = deferred<ExperienceSnapshot>();
    const cancellation = deferred<void>();
    service.action.mockReturnValue(waiting.promise);
    service.cancel.mockReturnValue(cancellation.promise);
    const pending = session.action({ action: "message", message: "相談" });
    await vi.waitFor(() => expect(service.action).toHaveBeenCalledTimes(1));
    session.leave();
    session.enter();
    expect(service.get).not.toHaveBeenCalled();
    cancellation.resolve();
    await vi.waitFor(() => expect(service.get).toHaveBeenCalledTimes(1));
    waiting.resolve({ ...SNAPSHOT, revision: 1 });
    expect(await pending).toBe(false);
  });

  it("reconciles conflicts using GET and never repeats the failed action or narrates the refresh", async () => {
    const { session, service, onReply } = setup();
    await session.start();
    service.action.mockRejectedValue(new ExperienceApiError("stale", 409));
    service.get.mockResolvedValue({ ...SNAPSHOT, revision: 3 });
    expect(await session.action({ action: "submit" })).toBe(false);
    expect(service.action).toHaveBeenCalledTimes(1);
    expect(service.get).toHaveBeenCalledTimes(1);
    expect(session.state.snapshot?.revision).toBe(3);
    expect(session.state.needsRefresh).toBe(false);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("keeps mutations blocked until an uncertain cancellation is confirmed", async () => {
    const { session, service } = setup();
    await session.start();
    service.action.mockRejectedValue(new ExperienceApiError("offline"));
    service.cancel.mockRejectedValueOnce(new ExperienceApiError("offline"));
    expect(await session.action({ action: "message", message: "相談" })).toBe(false);
    expect(session.state.needsRefresh).toBe(true);
    expect(service.get).not.toHaveBeenCalled();
    expect(await session.refresh()).toBe(true);
    expect(service.cancel).toHaveBeenCalledTimes(2);
    expect(service.get).toHaveBeenCalledTimes(1);
  });

  it("treats an expired cancellation target as already stopped", async () => {
    const { session, service } = setup();
    await session.start();
    service.action.mockRejectedValue(new ExperienceApiError("offline"));
    service.cancel.mockRejectedValue(new ExperienceApiError("gone", 404));
    await session.action({ action: "message", message: "相談" });
    expect(await session.refresh()).toBe(true);
    expect(service.cancel).toHaveBeenCalledTimes(1);
  });

  it("does not lose an expiry discovered during conflict reconciliation", async () => {
    const { session, service } = setup();
    await session.start();
    service.action.mockRejectedValue(new ExperienceApiError("stale", 409));
    service.get.mockRejectedValue(new ExperienceApiError("expired", 404));
    await session.action({ action: "hint" });
    expect(session.state.expired).toBe(true);
    expect(session.state.needsRefresh).toBe(true);
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it("blocks further mutations after an ambiguous failure until an explicit read", async () => {
    const { session, service } = setup();
    await session.start();
    service.action.mockRejectedValue(new ExperienceApiError("offline"));
    await session.action({ action: "hint" });
    expect(session.state.needsRefresh).toBe(true);
    expect(await session.action({ action: "hint" })).toBe(false);
    expect(service.get).not.toHaveBeenCalled();
    expect(await session.refresh()).toBe(true);
    expect(session.state.needsRefresh).toBe(false);
  });

  it("does not silently recreate an expired session", async () => {
    const { session, service } = setup();
    await session.start();
    service.get.mockRejectedValue(new ExperienceApiError("expired", 404));
    await session.refresh();
    expect(session.state.expired).toBe(true);
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(await session.action({ action: "hint" })).toBe(false);
  });

  it("reuses the same id for explicitly retrying idempotent start", async () => {
    const { session, service } = setup();
    service.create.mockRejectedValueOnce(new ExperienceApiError("offline"));
    await session.start();
    await session.start();
    expect(service.create.mock.calls.map((call) => call[0])).toEqual([ID, ID]);
  });

  it("cannot restart work after disposal", async () => {
    const { session, service } = setup();
    session.dispose();
    session.enter();
    expect(await session.start()).toBe(false);
    expect(service.create).not.toHaveBeenCalled();
  });
});
