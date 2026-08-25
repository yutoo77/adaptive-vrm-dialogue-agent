import { describe, expect, it, vi } from "vitest";

import { DialogueApiError, DialogueClient } from "./DialogueClient";
import {
  DialogueController,
  type DialogueCallbacks,
  type DialogueGateway,
  type SpeechOutput,
} from "./DialogueController";
import type { PerformancePlan } from "../types/character";
import type { DialogueHealth, DialogueResponse, DialogueRole, PersistentMemoryItem } from "./types";

const READY_HEALTH: DialogueHealth = {
  status: "ready",
  provider: "mock",
  model: "mock-v1",
  api_key_configured: false,
  message: "ready",
  session_memory_enabled: true,
  session_memory_max_turns: 10,
  session_summary_enabled: true,
  persistent_memory_enabled: true,
  persistent_memory_count: 0,
  character: {
    id: "tsukishiro_shizuku",
    version: "1.0.0",
    display_name: "月白 しずく",
    short_name: "しずく",
    tagline: "静かに寄り添い、考えをほどく案内役",
    self_reference: "わたし",
    user_reference: "あなた",
    speech_principles: ["穏やかに話す"],
    values: ["利用者の選択を尊重する"],
    avoided_expressions: ["過度な持ち上げ"],
    theme_colors: ["#202a5a", "#f7f8ff", "#8f82c7"],
    voice: {
      provider: "voicevox",
      speaker_id: 14,
      speed_scale: 0.96,
      pitch_scale: -0.01,
      intonation_scale: 0.94,
    },
    performance: {
      maximum_intensity: 0.72,
      cue_intensity_scale: 0.82,
      default_voice_style: "warm",
    },
  },
};

const MEMORY_ITEM: PersistentMemoryItem = {
  id: "a".repeat(32),
  content: "好きな色は青",
  source: "manual",
  created_at: "2026-08-17T00:00:00+00:00",
  updated_at: "2026-08-17T00:00:00+00:00",
  use_count: 0,
};

const MEMORY_GATEWAY = {
  cancelActiveDialogue: async (sessionId: string) => ({ session_id: sessionId, cancelled: true }),
  listMemories: async () => ({ items: [], total: 0 }),
  createMemory: async (content: string) => ({ item: { ...MEMORY_ITEM, content }, created: true }),
  updateMemory: async (_memoryId: string, content: string) => ({
    item: { ...MEMORY_ITEM, content },
    created: false,
  }),
  deleteMemory: async (memoryId: string) => ({ id: memoryId, deleted: true }),
  clearMemories: async () => ({ deleted_count: 0 }),
} satisfies Pick<
  DialogueGateway,
  | "cancelActiveDialogue"
  | "listMemories"
  | "createMemory"
  | "updateMemory"
  | "deleteMemory"
  | "clearMemories"
>;

const RESPONSE: DialogueResponse = {
  reply: "こんにちは。",
  response_style: "balanced",
  performance: {
    emotion: "neutral",
    intensity: 0.35,
    gesture: "small_nod",
    voice_style: "neutral",
    cues: [],
  },
  provider: "mock",
  model: "mock-v1",
  request_id: "request-1",
  latency_ms: 2,
  first_text_ms: 1,
  text_complete_ms: 2,
  session_id: "session-test-alpha",
  memory_turns: 1,
  memory_max_turns: 10,
  session_summary_available: false,
  relevant_memory_count: 0,
  saved_memory: null,
};

function createCallbacks() {
  const messages: Array<[DialogueRole, string]> = [];
  const states: string[] = [];
  const busy: boolean[] = [];
  const errors: string[] = [];
  const connections: Array<DialogueHealth | null> = [];
  const latencies: number[] = [];
  const partialAssistantMessages: string[] = [];
  const completedAssistantMessages: string[] = [];
  const responseTimings: Array<[string, number]> = [];
  const memories: Array<[number, number]> = [];
  const persistentMemories: Array<readonly PersistentMemoryItem[]> = [];
  const memoryNotices: string[] = [];
  const memoryBusy: boolean[] = [];
  const performances: PerformancePlan[] = [];
  let conversationResets = 0;
  let cancellations = 0;
  let partialDiscards = 0;
  const callbacks: DialogueCallbacks = {
    onConnectionChange: (health) => connections.push(health),
    onMessage: (role, text) => messages.push([role, text]),
    onPartialAssistantMessage: (text) => partialAssistantMessages.push(text),
    onCompleteAssistantMessage: (text) => {
      completedAssistantMessages.push(text);
      messages.push(["assistant", text]);
    },
    onDiscardPartialAssistantMessage: () => {
      partialDiscards += 1;
    },
    onBusyChange: (value) => busy.push(value),
    onCharacterState: (state) => states.push(state),
    onPerformancePlan: (performance) => performances.push(performance),
    onError: (message) => errors.push(message),
    onClearError: vi.fn(),
    onLatency: (latencyMs) => latencies.push(latencyMs),
    onResponseTiming: (stage, latencyMs) => responseTimings.push([stage, latencyMs]),
    onMemoryChange: (turns, maxTurns) => memories.push([turns, maxTurns]),
    onPersistentMemoriesChange: (items) => persistentMemories.push(items),
    onMemoryNotice: (message) => memoryNotices.push(message),
    onCancelled: () => {
      cancellations += 1;
    },
    onPersistentMemoryBusyChange: (value) => memoryBusy.push(value),
    onConversationReset: () => {
      conversationResets += 1;
    },
  };
  return {
    callbacks,
    messages,
    states,
    busy,
    errors,
    connections,
    latencies,
    partialAssistantMessages,
    completedAssistantMessages,
    responseTimings,
    memories,
    persistentMemories,
    memoryNotices,
    memoryBusy,
    performances,
    get conversationResets() {
      return conversationResets;
    },
    get cancellations() {
      return cancellations;
    },
    get partialDiscards() {
      return partialDiscards;
    },
  };
}

it("validates the versioned character profile in backend health", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(READY_HEALTH), { status: 200 }));
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.getHealth()).resolves.toEqual(READY_HEALTH);
});

it("rejects an invalid character profile before it reaches the UI", async () => {
  const invalidHealth = {
    ...READY_HEALTH,
    character: { ...READY_HEALTH.character, theme_colors: ["not-a-color", "#ffffff", "#000000"] },
  };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(invalidHealth), { status: 200 }));
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.getHealth()).rejects.toBeInstanceOf(DialogueApiError);
});

it("validates and sends the latest text message to the backend", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ message: "テスト", session_id: "session-test-alpha", response_style: "detailed" }),
    );
    return new Response(JSON.stringify(RESPONSE), { status: 200 });
  });
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.sendMessage("テスト", "session-test-alpha", "detailed")).resolves.toEqual(RESPONSE);
});

it("parses chunked NDJSON and exposes only validated text deltas", async () => {
  const encoder = new TextEncoder();
  const payload = [
    { type: "start", request_id: "request-1", provider: "mock", model: "mock-v1" },
    { type: "text_delta", delta: "こん", elapsed_ms: 1 },
    { type: "text_delta", delta: "にちは。", elapsed_ms: 2 },
    { type: "complete", response: RESPONSE },
  ].map((event) => `${JSON.stringify(event)}\n`).join("");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload.slice(0, 41)));
      controller.enqueue(encoder.encode(payload.slice(41)));
      controller.close();
    },
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("/api/dialogue/stream");
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  });
  const deltas: string[] = [];
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(
    client.streamMessage("テスト", "session-test-alpha", "balanced", (delta) => deltas.push(delta)),
  ).resolves.toEqual(RESPONSE);
  expect(deltas).toHaveLength(2);
  expect(deltas.join("")).toBe("こんにちは。");
});

it("turns a typed stream error event into a safe actionable error", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      `${JSON.stringify({
        type: "error",
        error: { code: "rate_limited", message: "少し待ってください。", request_id: "stream-req-1" },
      })}\n`,
      { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
    ),
  );
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(
    client.streamMessage("テスト", "session-test-alpha", "balanced", vi.fn()),
  ).rejects.toMatchObject({
    message: "少し待ってください。",
    code: "rate_limited",
    requestId: "stream-req-1",
  });
});

it("resets one backend conversation session", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/dialogue/sessions/session-test-alpha");
    expect(init?.method).toBe("DELETE");
    return new Response(JSON.stringify({ session_id: "session-test-alpha", cleared_turns: 2 }), { status: 200 });
  });
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.resetSession("session-test-alpha")).resolves.toEqual({
    session_id: "session-test-alpha",
    cleared_turns: 2,
  });
});

it("requests cancellation for one active backend dialogue", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain("/dialogue/sessions/session-test-alpha/active");
    expect(init?.method).toBe("DELETE");
    return new Response(
      JSON.stringify({ session_id: "session-test-alpha", cancelled: true }),
      { status: 200 },
    );
  });
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.cancelActiveDialogue("session-test-alpha")).resolves.toEqual({
    session_id: "session-test-alpha",
    cancelled: true,
  });
});

it("validates persistent memory CRUD responses", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/memories" && init?.method === "GET") {
      return new Response(JSON.stringify({ items: [MEMORY_ITEM], total: 1 }), { status: 200 });
    }
    if (path === "/api/memories" && init?.method === "POST") {
      expect(init.body).toBe(JSON.stringify({ content: "好きな色は青" }));
      return new Response(JSON.stringify({ item: MEMORY_ITEM, created: true }), { status: 200 });
    }
    if (path.endsWith(MEMORY_ITEM.id) && init?.method === "PATCH") {
      return new Response(JSON.stringify({ item: { ...MEMORY_ITEM, content: "青が好き" }, created: false }), {
        status: 200,
      });
    }
    if (path.endsWith(MEMORY_ITEM.id) && init?.method === "DELETE") {
      return new Response(JSON.stringify({ id: MEMORY_ITEM.id, deleted: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ deleted_count: 1 }), { status: 200 });
  });
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.listMemories()).resolves.toMatchObject({ total: 1 });
  await expect(client.createMemory("好きな色は青")).resolves.toMatchObject({ created: true });
  await expect(client.updateMemory(MEMORY_ITEM.id, "青が好き")).resolves.toMatchObject({ created: false });
  await expect(client.deleteMemory(MEMORY_ITEM.id)).resolves.toMatchObject({ deleted: true });
  await expect(client.clearMemories()).resolves.toEqual({ deleted_count: 1 });
});

it("uses the backend public error instead of leaking an unknown payload", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ detail: { code: "rate_limited", message: "少し待ってください。", request_id: "req-1" } }),
      { status: 429 },
    ),
  );
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.sendMessage("テスト", "session-test-alpha", "balanced")).rejects.toMatchObject({
    message: "少し待ってください。",
    status: 429,
    code: "rate_limited",
    requestId: "req-1",
  });
});

it("turns an unstructured backend failure into actionable recovery guidance", async () => {
  const fetchMock = vi.fn(async () => new Response("proxy failure", { status: 500 }));
  const client = new DialogueClient(fetchMock, "/api", 1000);

  await expect(client.sendMessage("テスト", "session-test-alpha", "balanced")).rejects.toMatchObject({
    message: "Backendで処理を完了できませんでした。起動状態を確認して、もう一度送信してください。",
    status: 500,
    code: "backend_unavailable",
  });
});

describe("DialogueController", () => {
  it("renders streamed text incrementally before final validation", async () => {
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => RESPONSE,
      streamMessage: async (_message, _sessionId, _responseStyle, onTextDelta) => {
        onTextDelta("こん");
        await Promise.resolve();
        onTextDelta("にちは。");
        return RESPONSE;
      },
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.send("テスト")).toBe(true);
    await vi.waitFor(() => expect(observed.busy.at(-1)).toBe(false));

    expect(observed.partialAssistantMessages).toHaveLength(2);
    expect(observed.partialAssistantMessages.at(-1)).toBe("こんにちは。");
    expect(observed.completedAssistantMessages).toHaveLength(1);
    expect(observed.completedAssistantMessages[0]).toBe("こんにちは。");
    expect(observed.responseTimings.map(([stage]) => stage)).toEqual(["first-text", "text-complete"]);
    controller.dispose();
  });

  it("feeds closed text toward streaming speech and finalizes it with the validated plan", async () => {
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => RESPONSE,
      streamMessage: async (_message, _sessionId, _responseStyle, onTextDelta) => {
        onTextDelta("こん");
        await Promise.resolve();
        onTextDelta("にちは。");
        return RESPONSE;
      },
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    let onSpeechStarted: (() => void) | undefined;
    const speech: SpeechOutput = {
      speak: vi.fn(),
      beginStreaming: vi.fn((onStarted) => {
        onSpeechStarted = onStarted;
      }),
      appendStreamingText: vi.fn((delta) => {
        if (delta === "にちは。") onSpeechStarted?.();
      }),
      completeStreaming: vi.fn(),
      toggle: vi.fn(),
      stop: vi.fn(),
      discard: vi.fn(),
      dispose: vi.fn(),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks, speech);

    await controller.initialize();
    expect(controller.send("テスト")).toBe(true);
    await vi.waitFor(() => expect(observed.busy.at(-1)).toBe(false));

    expect(speech.beginStreaming).toHaveBeenCalledOnce();
    expect(speech.appendStreamingText).toHaveBeenNthCalledWith(1, "こん");
    expect(speech.appendStreamingText).toHaveBeenNthCalledWith(2, "にちは。");
    expect(speech.completeStreaming).toHaveBeenCalledWith(RESPONSE.reply, RESPONSE.performance);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(observed.responseTimings.map(([stage]) => stage)).toEqual([
      "first-text",
      "speech-start",
      "text-complete",
    ]);
    expect(observed.states).toContain("speaking");
    controller.dispose();
  });

  it("cancels an active response without adding an assistant message or error", async () => {
    const cancelActiveDialogue = vi.fn(async (sessionId: string) => ({
      session_id: sessionId,
      cancelled: true,
    }));
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async (_message, _sessionId, _responseStyle, signal) =>
        new Promise<DialogueResponse>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      cancelActiveDialogue,
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const speech: SpeechOutput = {
      speak: vi.fn(),
      toggle: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks, speech);

    await controller.initialize();
    expect(controller.send("途中で止める")).toBe(true);
    await vi.waitFor(() => expect(observed.busy).toEqual([true]));
    expect(controller.cancelResponse()).toBe(true);
    await vi.waitFor(() => expect(observed.busy).toEqual([true, false]));

    expect(cancelActiveDialogue).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{32}$/));
    expect(observed.messages).toEqual([["user", "途中で止める"]]);
    expect(observed.errors).toEqual([]);
    expect(observed.cancellations).toBe(1);
    expect(observed.states.at(-1)).toBe("idle");
    expect(speech.stop).toHaveBeenCalledTimes(3);
    expect(speech.speak).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not claim cancellation when the backend has no active generation", async () => {
    let finishResponse = (): void => undefined;
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () =>
        new Promise<DialogueResponse>((resolve) => {
          finishResponse = () => resolve(RESPONSE);
        }),
      cancelActiveDialogue: async (sessionId) => ({ session_id: sessionId, cancelled: false }),
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.send("停止対象がない場合")).toBe(true);
    await vi.waitFor(() => expect(observed.busy).toEqual([true]));
    expect(controller.cancelResponse()).toBe(true);
    finishResponse();
    await vi.waitFor(() => expect(observed.busy).toEqual([true, false]));

    expect(observed.cancellations).toBe(0);
    expect(observed.errors).toEqual([]);
    expect(observed.memoryNotices.at(-1)).toContain("既に完了していたため");
    expect(observed.messages).toContainEqual(["assistant", "こんにちは。"]);
    controller.dispose();
  });

  it("sends only the explicitly selected response style", async () => {
    const sentStyles: string[] = [];
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async (_message, _sessionId, responseStyle) => {
        sentStyles.push(responseStyle);
        return { ...RESPONSE, response_style: responseStyle };
      },
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.setResponseStyle("beginner")).toBe(true);
    expect(controller.send("仕組みを教えて")).toBe(true);
    await vi.waitFor(() => expect(sentStyles).toEqual(["beginner"]));

    controller.dispose();
  });

  it("moves the avatar through thinking, explaining, and idle", async () => {
    vi.useFakeTimers();
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => RESPONSE,
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.send(" こんにちは ")).toBe(true);
    await vi.runAllTicks();

    expect(observed.connections).toEqual([READY_HEALTH]);
    expect(observed.messages).toEqual([
      ["user", "こんにちは"],
      ["assistant", "こんにちは。"],
    ]);
    expect(observed.states.slice(0, 2)).toEqual(["thinking", "explaining"]);
    expect(observed.busy).toEqual([true, false]);
    expect(observed.latencies).toHaveLength(1);
    expect(observed.latencies[0]).toBeGreaterThanOrEqual(0);
    expect(observed.memories).toEqual([
      [0, 10],
      [1, 10],
    ]);

    await vi.runAllTimersAsync();
    expect(observed.states.at(-1)).toBe("idle");
    controller.dispose();
    vi.useRealTimers();
  });

  it("shows a safe error and switches the avatar to error", async () => {
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => {
        throw new DialogueApiError("通信に失敗しました。", 503, "unavailable", "req-2");
      },
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.send("テスト")).toBe(true);
    await vi.waitFor(() => expect(observed.busy).toEqual([true, false]));

    expect(observed.errors).toEqual(["通信に失敗しました。（Request ID: req-2）"]);
    expect(observed.states).toContain("error");
    controller.dispose();
  });

  it("hands a successful text reply to speech without coupling it to text success", async () => {
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => RESPONSE,
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const speech: SpeechOutput = {
      speak: vi.fn(),
      toggle: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks, speech);

    await controller.initialize();
    expect(controller.send("テスト")).toBe(true);
    await vi.waitFor(() =>
      expect(speech.speak).toHaveBeenCalledWith("こんにちは。", RESPONSE.performance, expect.any(Function)),
    );

    expect(observed.messages).toContainEqual(["assistant", "こんにちは。"]);
    expect(observed.states).toEqual(["thinking", "explaining"]);
    expect(observed.performances).toEqual([RESPONSE.performance]);
    controller.toggleSpeech();
    expect(speech.toggle).toHaveBeenCalledOnce();
    controller.dispose();
    expect(speech.dispose).toHaveBeenCalledOnce();
  });

  it("uses the bounded performance plan to select an emotional avatar state", async () => {
    const happyResponse: DialogueResponse = {
      ...RESPONSE,
      performance: {
        emotion: "happy",
        intensity: 0.64,
        gesture: "soft_bounce",
        voice_style: "bright",
        cues: [],
      },
    };
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => happyResponse,
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.send("こんにちは")).toBe(true);
    await vi.waitFor(() => expect(observed.states).toContain("happy"));

    expect(observed.performances).toEqual([happyResponse.performance]);
    controller.dispose();
  });

  it("clears backend memory and rotates the session id for a new conversation", async () => {
    const sentSessions: string[] = [];
    const resetSessions: string[] = [];
    const sessionIds = ["session-first-0001", "session-second-0002"];
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async (_message, sessionId) => {
        sentSessions.push(sessionId);
        return { ...RESPONSE, session_id: sessionId };
      },
      resetSession: async (sessionId) => {
        resetSessions.push(sessionId);
        return { session_id: sessionId, cleared_turns: 1 };
      },
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks, null, () => sessionIds.shift() ?? "fallback-session-0003");

    await controller.initialize();
    expect(controller.send("最初の話")).toBe(true);
    await vi.waitFor(() => expect(sentSessions).toEqual(["session-first-0001"]));
    await vi.waitFor(() => expect(observed.busy.at(-1)).toBe(false));

    expect(controller.resetConversation()).toBe(true);
    await vi.waitFor(() => expect(resetSessions).toEqual(["session-first-0001"]));
    await vi.waitFor(() => expect(observed.conversationResets).toBe(1));

    expect(controller.send("新しい話")).toBe(true);
    await vi.waitFor(() => expect(sentSessions).toEqual(["session-first-0001", "session-second-0002"]));
    expect(observed.memories.at(-2)).toEqual([0, 10]);
    controller.dispose();
  });

  it("adds and refreshes owner-managed persistent memory", async () => {
    const stored: PersistentMemoryItem[] = [];
    const gateway: DialogueGateway = {
      ...MEMORY_GATEWAY,
      getHealth: async () => READY_HEALTH,
      sendMessage: async () => RESPONSE,
      resetSession: async (sessionId) => ({ session_id: sessionId, cleared_turns: 0 }),
      listMemories: async () => ({ items: [...stored], total: stored.length }),
      createMemory: async (content) => {
        const item = { ...MEMORY_ITEM, content };
        stored.push(item);
        return { item, created: true };
      },
    };
    const observed = createCallbacks();
    const controller = new DialogueController(gateway, observed.callbacks);

    await controller.initialize();
    expect(controller.addPersistentMemory(" 好きな色は青 ")).toBe(true);
    await vi.waitFor(() => expect(observed.memoryBusy).toEqual([true, false]));

    expect(observed.persistentMemories.at(-1)).toEqual([{ ...MEMORY_ITEM, content: "好きな色は青" }]);
    expect(observed.memoryNotices).toEqual(["長期記憶へ追加しました。"]);
    controller.dispose();
  });
});
