import {
  DEFAULT_CAMERA_SETTINGS,
  PERFORMANCE_PREVIEW_INTENSITIES,
  createPerformancePreviewPlan,
  type CameraSettings,
  type CharacterState,
  type ModelDiagnostics,
  type PerformanceEmotion,
  type PerformanceGesture,
  type PerformancePlan,
  type ReducedMotionMode,
} from "../types/character";
import type { PerformanceTimelinePhase } from "../vrm/PerformanceTimelineController";
import type {
  CharacterProfile,
  DialogueHealth,
  DialogueRole,
  EmotionalContinuity,
  PersistentMemoryItem,
  ResponseStyle,
} from "../dialogue/types";
import type { SpeechStatus } from "../speech/types";
import type { MicrophoneOption, VoiceInputStatus } from "../transcription/types";
import { getCharacterStatePreset } from "../vrm/CharacterStatePresets";
import { createAppMarkup, createEmptyDialogue, performanceEmotionLabel } from "./createAppMarkup";
import { icon } from "./icons";
import { renderDeveloperPanel } from "./renderDeveloperPanel";

export type LatencyStage = "transcription" | "first-text" | "text-complete" | "speech-start";

export interface UIActions {
  readonly loadFile: (file: File) => Promise<void>;
  readonly loadDefault: () => Promise<void>;
  readonly sendMessage: (message: string) => boolean;
  readonly cancelResponse: () => boolean;
  readonly setResponseStyle: (style: ResponseStyle) => boolean;
  readonly resetConversation: () => boolean;
  readonly addPersistentMemory: (content: string) => boolean;
  readonly updatePersistentMemory: (memoryId: string, content: string) => boolean;
  readonly deletePersistentMemory: (memoryId: string) => boolean;
  readonly clearPersistentMemories: () => boolean;
  readonly refreshPersistentMemories: () => boolean;
  readonly toggleSpeech: () => void;
  readonly toggleVoiceInput: () => void;
  readonly selectMicrophone: (deviceId: string) => void;
  readonly setVoiceAutoStop: (enabled: boolean) => void;
  readonly setState: (state: CharacterState) => void;
  readonly previewPerformance: (performance: PerformancePlan) => void;
  readonly setReducedMotionMode: (mode: ReducedMotionMode) => boolean;
  readonly restoreAutomaticPerformance: () => void;
  readonly setExpression: (name: string | null, weight: number) => boolean;
  readonly setCamera: (settings: CameraSettings) => CameraSettings;
  readonly resetCamera: () => CameraSettings;
}

export class UIController {
  public readonly viewport: HTMLElement;

  private readonly abortController = new AbortController();
  private actions: UIActions | null = null;
  private warnings: string[] = [];
  private currentState: CharacterState = "idle";
  private currentExpression = "なし";
  private fps = 0;
  private modelDiagnostics: ModelDiagnostics | null = null;
  private dialogueReady = false;
  private dialogueBusy = false;
  private dialogueProvider = "未接続";
  private dialogueModel = "—";
  private characterProfileId = "—";
  private characterProfileVersion = "—";
  private characterShortName = "キャラクター";
  private dialogueMemoryTurns = 0;
  private dialogueMemoryMaxTurns = 10;
  private dialogueSummaryAvailable = false;
  private emotionalContinuity: EmotionalContinuity | null = null;
  private persistentMemories: readonly PersistentMemoryItem[] = [];
  private persistentMemoryBusy = false;
  private clearMemoryArmed = false;
  private speechState: SpeechStatus["state"] = "checking";
  private speechAction: SpeechStatus["action"] = "none";
  private voiceInputState: VoiceInputStatus["state"] = "checking";
  private voiceInputAction: VoiceInputStatus["action"] = "none";
  private microphoneOptionCount = 1;
  private reducedMotionEnabled = false;
  private reducedMotionMode: ReducedMotionMode = "system";
  private readonly latencyMeasurements: Record<LatencyStage, number | null> = {
    transcription: null,
    "first-text": null,
    "text-complete": null,
    "speech-start": null,
  };

  public constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = createAppMarkup();
    this.viewport = this.required("#character-viewport");
    this.registerEvents();
    this.updateState("idle");
    this.updateDeveloperPanel();
  }

  public bind(actions: UIActions): void {
    this.actions = actions;
  }

  public updateState(state: CharacterState): void {
    this.currentState = state;
    const preset = getCharacterStatePreset(state);
    const stageStatus = this.required("#stage-state");
    const stageMessage = this.required("#stage-message");

    stageStatus.textContent = preset.label;
    stageStatus.title = preset.message;
    stageStatus.dataset["tone"] = preset.tone;
    stageMessage.textContent = preset.message;
    this.root.dataset["state"] = state;

    this.root.querySelectorAll<HTMLButtonElement>("button[data-character-state]").forEach((button) => {
      const selected = button.dataset["characterState"] === state;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    this.updateDeveloperPanel();
  }

  public updateExpression(expression: string): void {
    this.currentExpression = expression;
    this.updateDeveloperPanel();
  }

  public updatePerformance(performance: PerformancePlan | null, source: "automatic" | "preview" = "automatic"): void {
    const sourceLabel = this.required("#performance-source");
    const emotion = this.required("#performance-emotion");
    const detail = this.required("#performance-detail");
    const container = this.required("#performance-status");
    if (!performance) {
      sourceLabel.textContent = "反応";
      emotion.textContent = "自然";
      detail.textContent = "";
      container.removeAttribute("title");
      container.dataset["emotion"] = "neutral";
      container.hidden = true;
      return;
    }

    container.hidden = false;
    sourceLabel.textContent = source === "preview"
      ? "演技比較"
      : this.emotionalContinuity?.carried_from_previous
        ? "余韻"
        : "反応";

    const emotionLabels: Readonly<Record<PerformancePlan["emotion"], string>> = {
      neutral: "自然",
      happy: "うれしい",
      gentle: "やさしい",
      curious: "興味",
      cautious: "慎重",
      confused: "困惑",
    };
    const gestureLabels: Readonly<Record<PerformancePlan["gesture"], string>> = {
      none: "しぐさなし",
      small_nod: "小さくうなずく",
      head_tilt: "首をかしげる",
      soft_bounce: "軽く弾む",
    };
    const voiceLabels: Readonly<Record<PerformancePlan["voice_style"], string>> = {
      neutral: "通常",
      warm: "温かく",
      bright: "明るく",
      gentle: "穏やかに",
      serious: "落ち着いて",
    };
    const cueLabel = performance.cues.length > 0 ? `・途中${performance.cues.length}回` : "";
    if (source === "preview") {
      emotion.textContent = `${emotionLabels[performance.emotion]} ${Math.round(performance.intensity * 100)}%`;
      detail.textContent = `${gestureLabels[performance.gesture]}・${voiceLabels[performance.voice_style]}${cueLabel}`;
      container.removeAttribute("title");
    } else {
      emotion.textContent = emotionLabels[performance.emotion];
      detail.textContent = performance.gesture === "none" ? "" : gestureLabels[performance.gesture];
      container.title = `${Math.round(performance.intensity * 100)}%・${voiceLabels[performance.voice_style]}${cueLabel}`;
    }
    container.dataset["emotion"] = performance.emotion;
  }

  public updateEmotionalContinuity(continuity: EmotionalContinuity): void {
    this.emotionalContinuity = continuity;
    this.root.dataset["continuity"] = continuity.carried_from_previous ? "carried" : "current";
    this.updateDeveloperPanel();
  }

  public updatePerformancePhase(
    phase: PerformanceTimelinePhase,
    cueIndex?: number,
    cueTotal?: number,
  ): void {
    const labels: Readonly<Record<Exclude<PerformanceTimelinePhase, "cue">, string>> = {
      prepared: "反応",
      speaking: "話している",
      lingering: "余韻",
      idle: this.emotionalContinuity?.carried_from_previous ? "余韻" : "反応",
    };
    this.required("#performance-source").textContent =
      phase === "cue" ? `しぐさ ${cueIndex ?? 1}/${cueTotal ?? 1}` : labels[phase];
  }

  public updateFps(fps: number): void {
    this.fps = fps;
    const node = this.root.querySelector<HTMLElement>("#dev-fps");
    if (node) node.textContent = `${fps} fps`;
  }

  public updateLoading(loading: boolean, progress: number | null): void {
    const overlay = this.required("#loading-overlay");
    const bar = this.required("#loading-progress");
    const text = this.required("#loading-text");
    overlay.hidden = !loading;
    this.required<HTMLButtonElement>("#default-model-button").disabled = loading;
    this.required<HTMLInputElement>("#model-file").disabled = loading;
    this.root.querySelectorAll<HTMLButtonElement>("[data-pick-model]").forEach((button) => {
      button.disabled = loading;
    });

    if (!loading) {
      bar.style.width = "0%";
      return;
    }

    const percent = progress === null ? null : Math.round(progress * 100);
    bar.style.width = percent === null ? "36%" : `${percent}%`;
    bar.classList.toggle("is-indeterminate", percent === null);
    text.textContent = percent === null ? "モデルを読み込んでいます" : `モデルを読み込んでいます ${percent}%`;
  }

  public updateModelLoaded(diagnostics: ModelDiagnostics): void {
    this.modelDiagnostics = diagnostics;
    this.required("#empty-guide").hidden = true;
    const modelBadge = this.required("#model-status");
    modelBadge.textContent = diagnostics.modelName;
    modelBadge.dataset["status"] = "ready";
    this.populateExpressionSelect(diagnostics.expressions);
    this.updateDeveloperPanel();
  }

  public updateModelMissing(): void {
    this.modelDiagnostics = null;
    this.required("#empty-guide").hidden = false;
    const modelBadge = this.required("#model-status");
    modelBadge.textContent = "モデル未設定";
    modelBadge.dataset["status"] = "empty";
    this.populateExpressionSelect([]);
    this.updateDeveloperPanel();
  }

  public showNotice(message: string): void {
    this.showToast(message, "notice");
  }

  public showError(message: string): void {
    this.showToast(message, "error");
  }

  public addWarning(message: string): void {
    const normalized = message.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!normalized || this.warnings.includes(normalized)) return;
    this.warnings = [normalized, ...this.warnings].slice(0, 8);
    this.updateDeveloperPanel();
  }

  public updateReducedMotion(enabled: boolean, mode: ReducedMotionMode = "system"): void {
    this.reducedMotionEnabled = enabled;
    this.reducedMotionMode = mode;
    const badge = this.required("#motion-status");
    badge.hidden = mode === "system" && !enabled;
    badge.textContent = mode === "normal"
      ? "通常動作で比較中"
      : mode === "reduced"
        ? "動きを抑えています（比較）"
        : "動きを抑えています（OS設定）";
    badge.dataset["mode"] = mode;
    const select = this.root.querySelector<HTMLSelectElement>("#performance-motion-mode");
    if (select) select.value = mode;
    this.updateDeveloperPanel();
  }

  public updateDialogueConnection(health: DialogueHealth | null, errorMessage?: string): void {
    const badge = this.required("#dialogue-provider");
    const providerNote = this.required("#dialogue-provider-note");
    const note = this.required("#dialogue-privacy");
    this.dialogueReady = health?.status === "ready";
    this.dialogueProvider = health?.provider ?? "未接続";
    this.dialogueModel = health?.model ?? "—";
    if (health) {
      this.updatePersistentMemoryCount(health.persistent_memory_count);
      this.updateCharacterProfile(health.character);
    }

    if (!health) {
      badge.textContent = "オフライン";
      badge.dataset["status"] = "error";
      providerNote.textContent = "対話サーバー未接続";
      note.textContent = "対話Backendが起動していません。VRM操作はそのまま利用できます。";
    } else if (health.status === "configuration_error") {
      badge.textContent = "設定エラー";
      badge.dataset["status"] = "error";
      providerNote.textContent = "接続設定を確認してください";
      note.textContent = health.message;
    } else if (health.provider === "mock") {
      badge.textContent = "Mock";
      badge.dataset["status"] = "mock";
      providerNote.textContent = "定型応答 · 外部送信なし";
      note.textContent =
        "直近会話はRAM、明示登録した長期記憶だけは端末内SQLiteへ保存します。Mockでは外部送信しません。";
    } else {
      badge.textContent = "OpenAI";
      badge.dataset["status"] = "online";
      providerNote.textContent = "会話をAPIへ送信";
      note.textContent =
        "OpenAIモードでは今回の入力、会話要約、関連する長期記憶をAPIへ送信します。VRMと音声は送信しません。";
    }
    badge.title = note.textContent;

    if (health?.session_memory_enabled) {
      this.updateDialogueMemory(this.dialogueMemoryTurns, health.session_memory_max_turns);
    }

    if (errorMessage) this.showDialogueError(errorMessage);
    else if (this.dialogueReady) this.clearDialogueError();
    this.syncDialogueControls();
    this.updateDeveloperPanel();
  }

  public appendDialogueMessage(role: DialogueRole, text: string): void {
    const log = this.required("#dialogue-log");
    log.querySelector(".dialogue-empty")?.remove();

    const message = document.createElement("article");
    message.className = `dialogue-message is-${role}`;
    const label = document.createElement("span");
    label.textContent = role === "user" ? "あなた" : this.characterShortName;
    const body = document.createElement("p");
    body.textContent = text;
    message.append(label, body);
    log.append(message);

    const messages = log.querySelectorAll(".dialogue-message");
    if (messages.length > 20) messages[0]?.remove();
    log.scrollTop = log.scrollHeight;
  }

  public updateStreamingAssistantMessage(text: string): void {
    const log = this.required("#dialogue-log");
    log.querySelector(".dialogue-empty")?.remove();
    let message = log.querySelector<HTMLElement>('[data-streaming-assistant="true"]');
    if (!message) {
      message = document.createElement("article");
      message.className = "dialogue-message is-assistant is-streaming";
      message.dataset["streamingAssistant"] = "true";
      message.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = this.characterShortName;
      const body = document.createElement("p");
      message.append(label, body);
      log.append(message);
      const messages = log.querySelectorAll(".dialogue-message");
      if (messages.length > 20) messages[0]?.remove();
    }
    const body = message.querySelector("p");
    if (body) body.textContent = text;
    log.scrollTop = log.scrollHeight;
  }

  public completeStreamingAssistantMessage(text: string): void {
    const message = this.root.querySelector<HTMLElement>('[data-streaming-assistant="true"]');
    if (!message) {
      this.appendDialogueMessage("assistant", text);
      return;
    }
    const body = message.querySelector("p");
    if (body) body.textContent = text;
    message.classList.remove("is-streaming");
    message.removeAttribute("aria-hidden");
    delete message.dataset["streamingAssistant"];
  }

  public discardStreamingAssistantMessage(): void {
    this.root.querySelector<HTMLElement>('[data-streaming-assistant="true"]')?.remove();
  }

  public updateDialogueMemory(turns: number, maxTurns: number): void {
    this.dialogueMemoryTurns = Math.max(0, turns);
    this.dialogueMemoryMaxTurns = Math.max(1, maxTurns);
    this.renderDialogueMemoryStatus();
    this.updateDeveloperPanel();
  }

  public updateDialogueSummary(available: boolean): void {
    this.dialogueSummaryAvailable = available;
    this.renderDialogueMemoryStatus();
    this.updateDeveloperPanel();
  }

  public updatePersistentMemories(items: readonly PersistentMemoryItem[]): void {
    this.persistentMemories = items;
    this.updatePersistentMemoryCount(items.length);
    const list = this.required("#persistent-memory-list");
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "persistent-memory-empty";
      empty.textContent = "記憶はまだありません。";
      list.append(empty);
    } else {
      items.forEach((memory) => list.append(this.createPersistentMemoryItem(memory)));
    }
    this.syncPersistentMemoryControls();
    this.updateDeveloperPanel();
  }

  public updatePersistentMemoryBusy(busy: boolean): void {
    this.persistentMemoryBusy = busy;
    this.required("#persistent-memory-list").setAttribute("aria-busy", String(busy));
    this.syncPersistentMemoryControls();
  }

  public resetDialogueConversation(): void {
    const log = this.required("#dialogue-log");
    log.innerHTML = createEmptyDialogue();
    this.required<HTMLTextAreaElement>("#dialogue-input").value = "";
    this.resizeComposer();
    this.clearDialogueError();
    this.latencyMeasurements.transcription = null;
    this.latencyMeasurements["first-text"] = null;
    this.latencyMeasurements["text-complete"] = null;
    this.latencyMeasurements["speech-start"] = null;
    (["transcription", "first-text", "text-complete", "speech-start"] as const).forEach((stage) => {
      this.required(`#latency-${stage}`).textContent = "—";
    });
    this.updateDialogueMemory(0, this.dialogueMemoryMaxTurns);
    this.emotionalContinuity = null;
    delete this.root.dataset["continuity"];
    this.updatePerformance(null);
    this.updateDialogueSummary(false);
  }

  public updateDialogueBusy(busy: boolean): void {
    this.dialogueBusy = busy;
    if (busy) {
      (["first-text", "text-complete", "speech-start"] as const).forEach((stage) => {
        this.latencyMeasurements[stage] = null;
        this.required(`#latency-${stage}`).textContent = "—";
      });
    }
    const log = this.required("#dialogue-log");
    const submit = this.required<HTMLButtonElement>("#dialogue-submit");
    log.setAttribute("aria-busy", String(busy));
    submit.innerHTML = icon(busy ? "stop" : "send");
    submit.dataset["mode"] = busy ? "cancel" : "send";
    submit.setAttribute("aria-label", busy ? "応答を停止" : "送信");
    submit.title = busy ? "応答を停止" : "送信";
    this.syncDialogueControls();
    this.syncSpeechControl();
  }

  public updateSpeechStatus(status: SpeechStatus): void {
    this.speechState = status.state;
    this.speechAction = status.action;
    const container = this.required("#speech-status");
    const message = this.required("#speech-status-message");
    const button = this.required<HTMLButtonElement>("#speech-control");
    container.dataset["speechState"] = status.state;
    message.textContent = status.message;
    message.title = status.message;
    const summaries: Readonly<Record<SpeechStatus["state"], string>> = {
      checking: "音声出力を確認しています…",
      available: "音声を利用できます",
      generating: "音声を準備しています…",
      playing: "読み上げ中",
      ready: "読み上げが終わりました",
      stopped: "読み上げを停止しました",
      unavailable: "音声出力は未接続です。文字で会話できます。",
      error: "音声を再生できません。文字で会話できます。",
    };
    this.required("#speech-status-summary").textContent = summaries[status.state];
    button.hidden = status.action === "none";
    button.textContent =
      status.action === "stop" ? "音声を停止" : status.action === "replay" ? "もう一度再生" : "音声待機";
    button.setAttribute(
      "aria-label",
      status.action === "stop"
        ? "現在の音声処理を停止"
        : status.action === "replay"
          ? "直前の音声をもう一度再生"
          : "音声操作は現在利用できません",
    );
    this.syncSpeechControl();
    this.updateDeveloperPanel();
  }

  public updateVoiceInputStatus(status: VoiceInputStatus): void {
    this.voiceInputState = status.state;
    this.voiceInputAction = status.action;
    const container = this.required("#voice-input-status");
    const message = this.required("#voice-input-status-message");
    const button = this.required<HTMLButtonElement>("#voice-input-control");
    container.dataset["voiceInputState"] = status.state;
    message.textContent = status.message;
    message.title = status.message;
    const summaries: Readonly<Record<VoiceInputStatus["state"], string>> = {
      checking: "音声入力を確認しています…",
      idle: "マイクで話しかけられます",
      unavailable: "音声入力は使えません。文字で入力できます。",
      requesting: "マイクの許可を待っています…",
      recording: "録音中 · マイクを押すと終了",
      processing: "話した内容を文字にしています…",
      ready: "認識した内容を入力欄で確認してください",
      error: "音声入力に失敗しました。文字で入力できます。",
    };
    this.required("#voice-input-status-summary").textContent = summaries[status.state];

    const labels = {
      start: "音声で入力",
      stop: "録音を停止して認識",
      cancel: "音声入力をキャンセル",
      none: "音声入力は現在利用できません",
    } as const;
    button.setAttribute("aria-label", labels[status.action]);
    button.title = labels[status.action];
    button.dataset["action"] = status.action;
    button.classList.toggle("is-active", status.state === "recording");
    if (["requesting", "recording", "processing", "error"].includes(status.state)) {
      this.required<HTMLDetailsElement>("#voice-tools").open = true;
    }
    this.syncDialogueControls();
    this.syncSpeechControl();
    this.updateDeveloperPanel();
  }

  public updateLatency(stage: LatencyStage, latencyMs: number): void {
    const normalized = Math.max(0, Math.round(latencyMs));
    this.latencyMeasurements[stage] = normalized;
    const value = this.required(`#latency-${stage}`);
    value.textContent = formatLatency(normalized);
    value.title = `${normalized.toLocaleString("ja-JP")} ms`;
    this.updateDeveloperPanel();
  }

  public setDialogueDraft(text: string): void {
    const input = this.required<HTMLTextAreaElement>("#dialogue-input");
    input.value = text;
    this.resizeComposer();
    input.focus();
  }

  public updateMicrophoneOptions(options: readonly MicrophoneOption[], selectedDeviceId: string): void {
    const select = this.required<HTMLSelectElement>("#microphone-select");
    select.replaceChildren();
    options.forEach((microphone) => {
      const option = document.createElement("option");
      option.value = microphone.deviceId;
      option.textContent = microphone.label;
      select.append(option);
    });
    this.microphoneOptionCount = options.length;
    select.value = options.some((option) => option.deviceId === selectedDeviceId) ? selectedDeviceId : "";
    this.syncDialogueControls();
  }

  public showDialogueError(message: string): void {
    const error = this.required("#dialogue-error");
    error.textContent = message;
    error.hidden = false;
  }

  public clearDialogueError(): void {
    const error = this.required("#dialogue-error");
    error.textContent = "";
    error.hidden = true;
  }

  public showFatal(message: string): void {
    this.required("#fatal-message").textContent = message;
    this.required("#fatal-panel").hidden = false;
    this.required("#loading-overlay").hidden = true;
  }

  public dispose(): void {
    this.abortController.abort();
    this.root.replaceChildren();
  }

  private registerEvents(): void {
    const signal = this.abortController.signal;
    const input = this.required<HTMLInputElement>("#model-file");
    this.registerSettingsEvents(signal);
    this.root.querySelectorAll<HTMLButtonElement>("[data-pick-model]").forEach((button) => {
      button.addEventListener("click", () => input.click(), { signal });
    });

    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (file) void this.actions?.loadFile(file);
        input.value = "";
      },
      { signal },
    );
    this.required<HTMLButtonElement>("#default-model-button").addEventListener(
      "click",
      () => void this.actions?.loadDefault(),
      { signal },
    );

    this.registerDialogueEvents(signal);
    this.registerPersistentMemoryEvents(signal);
    this.required<HTMLButtonElement>("#conversation-reset").addEventListener(
      "click",
      () => this.actions?.resetConversation(),
      { signal },
    );
    this.required<HTMLSelectElement>("#response-style-select").addEventListener(
      "change",
      (event) => this.actions?.setResponseStyle((event.currentTarget as HTMLSelectElement).value as ResponseStyle),
      { signal },
    );
    this.required<HTMLButtonElement>("#speech-control").addEventListener(
      "click",
      () => this.actions?.toggleSpeech(),
      { signal },
    );
    this.required<HTMLButtonElement>("#voice-input-control").addEventListener(
      "click",
      () => this.actions?.toggleVoiceInput(),
      { signal },
    );
    this.required<HTMLSelectElement>("#microphone-select").addEventListener(
      "change",
      (event) => this.actions?.selectMicrophone((event.currentTarget as HTMLSelectElement).value),
      { signal },
    );
    this.required<HTMLInputElement>("#voice-auto-stop").addEventListener(
      "change",
      (event) => this.actions?.setVoiceAutoStop((event.currentTarget as HTMLInputElement).checked),
      { signal },
    );

    this.root.querySelectorAll<HTMLButtonElement>("button[data-character-state]").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const state = button.dataset["characterState"] as CharacterState | undefined;
          if (state) this.actions?.setState(state);
        },
        { signal },
      );
    });

    this.registerPerformancePreviewEvents(signal);
    this.registerExpressionEvents(signal);
    this.registerCameraEvents(signal);
    this.registerDropEvents(signal);
  }

  private registerSettingsEvents(signal: AbortSignal): void {
    const dialog = this.required<HTMLDialogElement>("#settings-dialog");
    const tabs = Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"));
    let opener: HTMLElement | null = null;
    const selectTab = (name: string): void => {
      tabs.forEach((tab) => {
        const selected = tab.dataset["settingsTab"] === name;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        this.required(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
      });
      this.required(".settings-body").scrollTop = 0;
    };
    this.root.querySelectorAll<HTMLButtonElement>("[data-settings-target]").forEach((button) => {
      button.addEventListener("click", () => {
        opener = button;
        selectTab(button.dataset["settingsTarget"] ?? "voice");
        dialog.append(this.required("#toast"));
        dialog.showModal();
      }, { signal });
    });
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab.dataset["settingsTab"] ?? "voice"), { signal });
      tab.addEventListener("keydown", (event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        const nextTab = tabs[next];
        if (!nextTab) return;
        selectTab(nextTab.dataset["settingsTab"] ?? "voice");
        nextTab.focus();
      }, { signal });
    });
    this.required("#settings-close").addEventListener("click", () => dialog.close(), { signal });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, summary, [tabindex], a[href]",
      )).filter((element) => element.tabIndex >= 0
        && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      // Keep Tab at the dialog boundary instead of moving to browser chrome.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }, { signal });
    dialog.addEventListener("close", () => {
      this.required(".app-shell").append(this.required("#toast"));
      opener?.focus();
    }, { signal });
  }

  private registerPerformancePreviewEvents(signal: AbortSignal): void {
    const emotion = this.required<HTMLSelectElement>("#performance-preview-emotion");
    const gesture = this.required<HTMLSelectElement>("#performance-preview-gesture");
    const motionMode = this.required<HTMLSelectElement>("#performance-motion-mode");
    const status = this.required("#performance-preview-status");
    const intensityButtons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("button[data-performance-intensity]"),
    );
    let intensity: number = PERFORMANCE_PREVIEW_INTENSITIES.medium;

    const modeLabel = (): string => {
      if (motionMode.value === "normal") return "通常動作";
      if (motionMode.value === "reduced") return "抑制動作";
      return "OS設定に従う";
    };
    const apply = (): void => {
      const plan = createPerformancePreviewPlan(
        emotion.value as PerformanceEmotion,
        gesture.value as PerformanceGesture,
        intensity,
      );
      this.actions?.previewPerformance(plan);
      this.updatePerformance(plan, "preview");
      status.textContent = `${performanceEmotionLabel(plan.emotion)}・${Math.round(plan.intensity * 100)}%・${modeLabel()}`;
    };

    intensityButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
      button.addEventListener(
        "click",
        () => {
          intensity = Number(button.dataset["performanceIntensity"] ?? PERFORMANCE_PREVIEW_INTENSITIES.medium);
          intensityButtons.forEach((candidate) => {
            const selected = candidate === button;
            candidate.classList.toggle("is-active", selected);
            candidate.setAttribute("aria-pressed", String(selected));
          });
          apply();
        },
        { signal },
      );
    });
    emotion.addEventListener("change", apply, { signal });
    gesture.addEventListener("change", apply, { signal });
    motionMode.addEventListener(
      "change",
      () => {
        const mode = motionMode.value as ReducedMotionMode;
        const enabled = this.actions?.setReducedMotionMode(mode) ?? mode === "reduced";
        this.updateReducedMotion(enabled, mode);
        apply();
      },
      { signal },
    );
    this.required<HTMLButtonElement>("#performance-preview-play").addEventListener("click", apply, { signal });
    this.required<HTMLButtonElement>("#performance-preview-reset").addEventListener(
      "click",
      () => {
        this.actions?.restoreAutomaticPerformance();
        this.updatePerformance(null);
        status.textContent = "会話連動へ戻りました。次の返答で自動選択します。";
      },
      { signal },
    );
  }

  private registerDialogueEvents(signal: AbortSignal): void {
    const form = this.required<HTMLFormElement>("#dialogue-form");
    const input = this.required<HTMLTextAreaElement>("#dialogue-input");
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        if (this.dialogueBusy) {
          this.actions?.cancelResponse();
          return;
        }
        const message = input.value;
        if (this.actions?.sendMessage(message)) {
          input.value = "";
          this.resizeComposer();
        }
      },
      { signal },
    );
    input.addEventListener("input", () => this.resizeComposer(), { signal });
    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          form.requestSubmit();
        }
      },
      { signal },
    );
  }

  private resizeComposer(): void {
    const input = this.required<HTMLTextAreaElement>("#dialogue-input");
    input.style.height = "auto";
    input.style.height = `${Math.min(128, input.scrollHeight)}px`;
  }

  private registerPersistentMemoryEvents(signal: AbortSignal): void {
    const form = this.required<HTMLFormElement>("#persistent-memory-form");
    const input = this.required<HTMLTextAreaElement>("#persistent-memory-input");
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        if (this.actions?.addPersistentMemory(input.value)) input.value = "";
      },
      { signal },
    );
    this.required<HTMLButtonElement>("#persistent-memory-refresh").addEventListener(
      "click",
      () => this.actions?.refreshPersistentMemories(),
      { signal },
    );
    const clearButton = this.required<HTMLButtonElement>("#persistent-memory-clear");
    clearButton.addEventListener(
      "click",
      () => {
        if (!this.clearMemoryArmed) {
          this.clearMemoryArmed = true;
          clearButton.textContent = "もう一度押して全削除";
          window.setTimeout(() => this.resetMemoryClearButton(), 5000);
          return;
        }
        if (this.actions?.clearPersistentMemories()) this.resetMemoryClearButton();
      },
      { signal },
    );
  }

  private registerExpressionEvents(signal: AbortSignal): void {
    const select = this.required<HTMLSelectElement>("#expression-select");
    const weight = this.required<HTMLInputElement>("#expression-weight");
    const output = this.required<HTMLOutputElement>("#expression-weight-output");

    const apply = (): void => {
      output.value = `${Math.round(Number(weight.value) * 100)}%`;
      const name = select.value || null;
      if (!this.actions?.setExpression(name, Number(weight.value))) {
        this.addWarning(`Expressionを適用できませんでした: ${select.value}`);
      }
    };
    select.addEventListener("change", apply, { signal });
    weight.addEventListener("input", apply, { signal });
    this.required<HTMLButtonElement>("#expression-reset").addEventListener(
      "click",
      () => {
        select.value = "";
        this.actions?.setExpression(null, 0);
      },
      { signal },
    );
  }

  private registerCameraEvents(signal: AbortSignal): void {
    const controls = Array.from(this.root.querySelectorAll<HTMLInputElement>("[data-camera]"));
    const apply = (): void => {
      const values = new Map(controls.map((input) => [input.dataset["camera"], Number(input.value)]));
      const settings: CameraSettings = {
        distance: values.get("distance") ?? 1,
        heightOffset: values.get("heightOffset") ?? 0,
        lookAtOffset: values.get("lookAtOffset") ?? 0,
        modelOffset: values.get("modelOffset") ?? 0,
        scale: values.get("scale") ?? 1,
      };
      this.syncCameraControls(this.actions?.setCamera(settings) ?? settings);
    };
    controls.forEach((input) => input.addEventListener("input", apply, { signal }));
    this.required<HTMLButtonElement>("#camera-reset").addEventListener(
      "click",
      () => this.syncCameraControls(this.actions?.resetCamera() ?? DEFAULT_CAMERA_SETTINGS),
      { signal },
    );
  }

  private registerDropEvents(signal: AbortSignal): void {
    const prevent = (event: DragEvent): void => {
      event.preventDefault();
      if (event.type === "dragenter" || event.type === "dragover") this.viewport.classList.add("is-dragging");
      if (event.type === "dragleave" || event.type === "drop") this.viewport.classList.remove("is-dragging");
    };
    ["dragenter", "dragover", "dragleave", "drop"].forEach((type) => {
      this.viewport.addEventListener(type, prevent as EventListener, { signal });
    });
    this.viewport.addEventListener(
      "drop",
      (event) => {
        const file = event.dataTransfer?.files[0];
        if (file) void this.actions?.loadFile(file);
      },
      { signal },
    );
  }

  private populateExpressionSelect(expressions: readonly string[]): void {
    const select = this.required<HTMLSelectElement>("#expression-select");
    const weight = this.required<HTMLInputElement>("#expression-weight");
    const reset = this.required<HTMLButtonElement>("#expression-reset");
    select.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = expressions.length ? "状態に合わせて自動選択" : "利用可能なExpressionはありません";
    select.append(defaultOption);
    expressions.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    });
    const enabled = expressions.length > 0;
    select.disabled = !enabled;
    weight.disabled = !enabled;
    reset.disabled = !enabled;
  }

  private syncCameraControls(settings: CameraSettings): void {
    Object.entries(settings).forEach(([key, value]) => {
      const input = this.root.querySelector<HTMLInputElement>(`[data-camera="${key}"]`);
      const output = this.root.querySelector<HTMLOutputElement>(`[data-camera-output="${key}"]`);
      if (input) input.value = String(value);
      if (output) output.value = value.toFixed(2);
    });
  }

  private updateCharacterProfile(profile: CharacterProfile): void {
    this.characterProfileId = profile.id;
    this.characterProfileVersion = profile.version;
    this.characterShortName = profile.short_name;

    const name = this.required("#character-name");
    const version = this.required("#character-version");
    const tagline = this.required("#character-tagline");
    name.textContent = profile.display_name;
    name.title = `${profile.display_name} — ${profile.tagline}`;
    version.textContent = `v${profile.version}`;
    version.hidden = false;
    tagline.textContent = profile.tagline;
    tagline.hidden = false;
    this.required("#character-monogram").textContent = profile.short_name.at(0) ?? "月";
    this.required("#conversation-title").textContent = `${profile.short_name}と話す`;
    this.root.querySelectorAll<HTMLElement>(".dialogue-message.is-assistant > span").forEach((label) => {
      label.textContent = profile.short_name;
    });

    const [primary, light, accent] = profile.theme_colors;
    this.root.style.setProperty("--character-primary", primary);
    this.root.style.setProperty("--character-light", light);
    this.root.style.setProperty("--character-accent", accent);
  }

  private updateDeveloperPanel(): void {
    renderDeveloperPanel(this.required("#developer-content"), {
      diagnostics: this.modelDiagnostics,
      state: this.currentState,
      expression: this.currentExpression,
      dialogueProvider: this.dialogueProvider,
      dialogueModel: this.dialogueModel,
      characterProfile: `${this.characterProfileId} v${this.characterProfileVersion}`,
      emotionalContinuity: this.emotionalContinuity
        ? `${this.emotionalContinuity.emotion} ${Math.round(this.emotionalContinuity.intensity * 100)}% / ${this.emotionalContinuity.turns_held} turn${this.emotionalContinuity.carried_from_previous ? " / carried" : ""}`
        : "なし",
      gazeBehavior: this.emotionalContinuity?.gaze_behavior ?? "responsive",
      dialogueMemoryTurns: this.dialogueMemoryTurns,
      dialogueMemoryMaxTurns: this.dialogueMemoryMaxTurns,
      dialogueSummaryAvailable: this.dialogueSummaryAvailable,
      persistentMemoryCount: this.persistentMemories.length,
      speechState: this.speechState,
      voiceInputState: this.voiceInputState,
      reducedMotionEnabled: this.reducedMotionEnabled,
      reducedMotionMode: this.reducedMotionMode,
      latencySummary: this.formatLatencySummary(),
      fps: this.fps,
      warnings: this.warnings,
    });
  }

  private formatLatencySummary(): string {
    const values = this.latencyMeasurements;
    return `認識 ${formatLatency(values.transcription)} / 初字 ${formatLatency(values["first-text"])} / `
      + `本文 ${formatLatency(values["text-complete"])} / 発話 ${formatLatency(values["speech-start"])}`;
  }

  private renderDialogueMemoryStatus(): void {
    const summary = this.dialogueSummaryAvailable ? "・古い会話は要約済み" : "";
    this.required("#dialogue-memory").textContent =
      `直近 ${this.dialogueMemoryTurns} / ${this.dialogueMemoryMaxTurns}往復（RAM${summary}）`;
  }

  private updatePersistentMemoryCount(count: number): void {
    this.required("#persistent-memory-count").textContent = `${Math.max(0, count)}件`;
  }

  private createPersistentMemoryItem(memory: PersistentMemoryItem): HTMLElement {
    const item = document.createElement("article");
    item.className = "persistent-memory-item";
    item.dataset["memoryId"] = memory.id;
    const editor = document.createElement("textarea");
    editor.value = memory.content;
    editor.maxLength = 500;
    editor.rows = 2;
    editor.setAttribute("aria-label", `長期記憶: ${memory.content}`);
    const meta = document.createElement("small");
    meta.textContent = `${memory.source === "explicit" ? "会話で明示" : "手動登録"}・参照 ${memory.use_count}回`;
    const actions = document.createElement("div");
    actions.className = "persistent-memory-item-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "保存";
    save.addEventListener(
      "click",
      () => this.actions?.updatePersistentMemory(memory.id, editor.value),
      { signal: this.abortController.signal },
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "is-danger";
    remove.textContent = "削除";
    remove.addEventListener(
      "click",
      () => this.actions?.deletePersistentMemory(memory.id),
      { signal: this.abortController.signal },
    );
    actions.append(save, remove);
    item.append(editor, meta, actions);
    return item;
  }

  private syncPersistentMemoryControls(): void {
    const disabled = !this.dialogueReady || this.dialogueBusy || this.persistentMemoryBusy;
    this.required<HTMLTextAreaElement>("#persistent-memory-input").disabled = disabled;
    this.required<HTMLButtonElement>("#persistent-memory-form button").disabled = disabled;
    this.required<HTMLButtonElement>("#persistent-memory-refresh").disabled = disabled;
    this.required<HTMLButtonElement>("#persistent-memory-clear").disabled = disabled || !this.persistentMemories.length;
    this.root.querySelectorAll<HTMLElement>("#persistent-memory-list textarea, #persistent-memory-list button").forEach(
      (control) => {
        (control as HTMLTextAreaElement | HTMLButtonElement).disabled = disabled;
      },
    );
  }

  private resetMemoryClearButton(): void {
    this.clearMemoryArmed = false;
    const button = this.required<HTMLButtonElement>("#persistent-memory-clear");
    button.textContent = "すべて削除";
  }

  private showToast(message: string, type: "notice" | "error"): void {
    const toast = this.required("#toast");
    toast.textContent = message;
    toast.dataset["type"] = type;
    toast.hidden = false;
    window.setTimeout(() => {
      if (toast.textContent === message) toast.hidden = true;
    }, 4200);
  }

  private syncDialogueControls(): void {
    const voiceBusy = this.isVoiceInputBusy();
    const disabled = !this.dialogueReady || this.dialogueBusy || voiceBusy;
    this.required<HTMLTextAreaElement>("#dialogue-input").disabled = disabled;
    this.required<HTMLButtonElement>("#dialogue-submit").disabled =
      !this.dialogueReady || voiceBusy;
    this.required<HTMLButtonElement>("#voice-input-control").disabled =
      !this.dialogueReady || this.dialogueBusy || this.voiceInputAction === "none";
    this.required<HTMLSelectElement>("#microphone-select").disabled =
      !this.dialogueReady || this.dialogueBusy || voiceBusy || this.microphoneOptionCount <= 1;
    this.required<HTMLInputElement>("#voice-auto-stop").disabled =
      !this.dialogueReady || this.dialogueBusy || voiceBusy || this.voiceInputAction === "none";
    this.required<HTMLButtonElement>("#conversation-reset").disabled = disabled;
    this.required<HTMLSelectElement>("#response-style-select").disabled = this.dialogueBusy || voiceBusy;
    this.syncPersistentMemoryControls();
  }

  private syncSpeechControl(): void {
    this.required<HTMLButtonElement>("#speech-control").disabled =
      this.speechAction === "none" || this.dialogueBusy || this.isVoiceInputBusy();
  }

  private isVoiceInputBusy(): boolean {
    return (
      this.voiceInputState === "requesting" ||
      this.voiceInputState === "recording" ||
      this.voiceInputState === "processing"
    );
  }

  private required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Required UI element is missing: ${selector}`);
    return element;
  }
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return "—";
  if (latencyMs < 1000) return `${latencyMs} ms`;
  return `${(latencyMs / 1000).toFixed(2)} s`;
}
