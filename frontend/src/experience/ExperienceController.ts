import type { PerformancePlan } from "../types/character";
import type { SpeechStatus } from "../speech/types";
import type { VoiceInputStatus } from "../transcription/types";
import { ExperienceClient, type ExperienceGateway } from "./ExperienceClient";
import { ExperienceSession, type ExperienceSessionState } from "./ExperienceSession";
import { createExperienceMarkup, MOON_LABELS, TARGET_LABELS, moonIcon } from "./createExperienceMarkup";
import { isMoon, isTarget, placeMoon, type Arrangement, type ExperienceFocusTarget, type Moon } from "./types";
import "./experience.css";

export type { ExperienceFocusTarget } from "./types";
export interface ExperienceCallbacks {
  readonly onReply: (text: string, performance: PerformancePlan) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onFocus: (target: ExperienceFocusTarget) => void;
  readonly onStop: () => void;
  readonly onToggleSpeech: () => void;
  readonly onMicrophoneToggle: () => void;
}

export class ExperienceController {
  public readonly avatarSlot: HTMLElement;
  private readonly events = new AbortController();
  private readonly session: ExperienceSession;
  private selected: Moon | null = null;
  private draft = "";
  private active = false;
  private disposed = false;
  private provider: "mock" | "openai" | null = null;
  private speech: SpeechStatus = { state: "checking", message: "", action: "none" };
  private voice: Pick<VoiceInputStatus, "state" | "message"> = { state: "checking", message: "" };
  private lastBusy = false;

  public constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: ExperienceCallbacks,
    gateway: ExperienceGateway = new ExperienceClient(),
  ) {
    root.classList.add("experience-frame");
    root.innerHTML = createExperienceMarkup();
    this.avatarSlot = this.required("#experience-avatar-slot");
    this.session = new ExperienceSession(gateway, {
      onChange: (state) => this.render(state),
      onReply: (snapshot) => {
        if (!this.active) return;
        this.callbacks.onFocus(snapshot.focus_target);
        this.callbacks.onReply(snapshot.reply, snapshot.performance);
      },
    });
    this.registerEvents();
    this.render(this.session.state);
  }

  public enter(): void {
    if (this.disposed) return;
    this.active = true;
    this.session.enter();
  }

  public leave(): void {
    this.active = false;
    this.session.leave();
    this.callbacks.onStop();
    this.callbacks.onFocus(null);
    const dialog = this.required<HTMLDialogElement>("#experience-restart-dialog");
    if (dialog.open) dialog.close("cancel");
  }

  public dispose(): void {
    if (this.disposed) return;
    this.leave();
    this.session.dispose();
    this.events.abort();
    this.disposed = true;
  }

  public setDraft(text: string): void {
    this.draft = text.slice(0, 500);
    this.required<HTMLTextAreaElement>("#experience-input").value = this.draft;
    this.renderControls(this.session.state);
  }

  public setVoiceStatus(status: Pick<VoiceInputStatus, "state" | "message">): void {
    this.voice = status;
    this.renderBoard(this.session.state);
    this.renderControls(this.session.state);
  }

  public setSpeechStatus(status: SpeechStatus): void {
    this.speech = status;
    this.renderControls(this.session.state);
  }

  public setProvider(provider: "mock" | "openai" | null): void {
    this.provider = provider;
    this.renderProvider();
  }

  private registerEvents(): void {
    const signal = this.events.signal;
    this.root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button || !this.root.contains(button) || button.disabled || !this.active) return;
      const inspect = button.dataset["inspect"];
      const moon = button.dataset["moon"];
      const slot = button.dataset["slot"];
      if (isTarget(inspect)) void this.perform({ action: "inspect", target: inspect });
      else if (isMoon(moon)) {
        this.selected = this.selected === moon ? null : moon;
        this.renderBoard(this.session.state);
      } else if (slot !== undefined) this.place(Number(slot));
      else if (button.id === "experience-start") void this.session.start();
      else if (button.id === "experience-submit") void this.perform({ action: "submit" });
      else if (button.id === "experience-hint") void this.perform({ action: "hint" });
      else if (button.id === "experience-refresh") void this.session.refresh();
      else if (button.id === "experience-stop") {
        this.session.stop();
        this.callbacks.onStop();
      } else if (button.id === "experience-speech") this.callbacks.onToggleSpeech();
      else if (button.id === "experience-microphone") this.callbacks.onMicrophoneToggle();
      else if (button.id === "experience-restart") this.required<HTMLDialogElement>("#experience-restart-dialog").showModal();
    }, { signal });
    this.required<HTMLTextAreaElement>("#experience-input").addEventListener("input", (event) => {
      this.draft = (event.target as HTMLTextAreaElement).value;
      this.renderControls(this.session.state);
    }, { signal });
    this.required<HTMLFormElement>("#experience-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.sendMessage();
    }, { signal });
    this.required<HTMLDialogElement>("#experience-restart-dialog").addEventListener("close", (event) => {
      if ((event.target as HTMLDialogElement).returnValue !== "restart" || !this.active) return;
      this.callbacks.onStop();
      this.selected = null;
      this.setDraft("");
      void this.session.start(true);
    }, { signal });
  }

  private async perform(action: Parameters<ExperienceSession["action"]>[0]): Promise<boolean> {
    if (!this.active || this.voiceBusy || this.session.state.busy || this.session.state.needsRefresh) return false;
    this.callbacks.onStop();
    return this.session.action(action);
  }

  private async sendMessage(): Promise<void> {
    const sentDraft = this.draft;
    if (!sentDraft.trim()) return;
    if (await this.perform({ action: "message", message: sentDraft.trim() })) {
      if (this.draft === sentDraft) this.setDraft("");
    }
  }

  private place(index: number): void {
    const state = this.session.state;
    if (!state.snapshot || this.voiceBusy || state.busy || state.needsRefresh || state.snapshot.phase === "solved") return;
    let arrangement: Arrangement;
    if (this.selected) arrangement = placeMoon(state.snapshot.arrangement, this.selected, index);
    else {
      const next: [Moon | null, Moon | null, Moon | null] = [...state.snapshot.arrangement];
      if (!next[index]) return;
      next[index] = null;
      arrangement = next;
    }
    void this.perform({ action: "arrange", arrangement }).then((success) => {
      if (success) { this.selected = null; this.renderBoard(this.session.state); }
    });
  }

  private render(state: ExperienceSessionState): void {
    this.root.dataset["experienceStarted"] = String(state.snapshot !== null);
    this.required("#experience-landing").hidden = state.snapshot !== null;
    this.required("#experience-play").hidden = state.snapshot === null;
    this.required("#experience-conversation").hidden = state.snapshot === null;
    this.required("#experience-restart").hidden = !state.hasSession;
    const feedback = state.error || state.snapshot?.notice || "";
    this.required("#experience-feedback").hidden = !feedback && !state.busy;
    this.required("#experience-feedback-text").textContent = state.busy ? "しずくと、確かめています…" : feedback;
    this.required("#experience-refresh").hidden = !state.needsRefresh || state.expired || !state.hasSession;
    this.required("#experience-feedback").dataset["error"] = String(!!state.error);
    if (state.snapshot) {
      this.required("#experience-reply").textContent = state.snapshot.reply;
      this.required("#experience-narration-source").textContent = state.snapshot.narration_provider === "openai" ? "相談APIの返答" : "物語の言葉（固定）";
      const history = this.required<HTMLOListElement>("#experience-history");
      history.replaceChildren(...state.snapshot.messages.map((message) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = message.role === "user" ? "あなた" : "しずく";
        const text = document.createElement("p");
        text.textContent = message.text;
        item.append(label, text);
        return item;
      }));
      this.required("#experience-history-count").textContent = `(${state.snapshot.messages.length})`;
    }
    this.renderBoard(state);
    this.renderControls(state);
    this.renderProvider();
    if (state.busy !== this.lastBusy) {
      this.lastBusy = state.busy;
      this.callbacks.onBusyChange(state.busy);
    }
  }

  private renderBoard(state: ExperienceSessionState): void {
    const snapshot = state.snapshot;
    const solved = snapshot?.phase === "solved";
    this.required("#experience-scene").dataset["focus"] = snapshot?.focus_target ?? "";
    this.required("#experience-scene").dataset["started"] = String(!!snapshot);
    this.required("#experience-scene").dataset["solved"] = String(solved);
    this.root.querySelectorAll<HTMLButtonElement>("[data-inspect]").forEach((button) => {
      const target = button.dataset["inspect"];
      button.hidden = !snapshot;
      button.disabled = state.busy || state.needsRefresh || this.voiceBusy;
      if (!isTarget(target)) return;
      const inspected = snapshot?.inspected.includes(target) ?? false;
      button.dataset["inspected"] = String(inspected);
      button.setAttribute("aria-label", `${TARGET_LABELS[target]}を調べる${inspected ? "（調査済み）" : ""}`);
      const mark = button.querySelector(".exp-inspected");
      if (mark) mark.textContent = inspected ? "✓" : "";
    });
    this.required("#experience-progress").textContent = solved ? "小箱は開きました" : `調べた場所 ${snapshot?.inspected.length ?? 0} / 3`;
    this.required("#experience-selection").textContent = solved ? "三枚の栞が、ひとつの便りをつなぎました。" : this.selected ?
      `${MOON_LABELS[this.selected]}を選択中。置きたい枠を押してね。` : "栞をひとつ選び、左から並ぶ枠へ置いてみて。";
    this.root.querySelectorAll<HTMLButtonElement>("[data-moon]").forEach((button) => {
      const moon = button.dataset["moon"];
      if (!isMoon(moon)) return;
      button.setAttribute("aria-pressed", String(this.selected === moon));
      button.disabled = state.busy || state.needsRefresh || solved || this.voiceBusy;
      const index = snapshot?.arrangement.indexOf(moon) ?? -1;
      this.required(`[data-moon-location="${moon}"]`).textContent = index === -1 ? "手元" : `${index + 1}番目の枠`;
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach((button, index) => {
      const moon = snapshot?.arrangement[index];
      button.disabled = state.busy || state.needsRefresh || solved || this.voiceBusy;
      button.dataset["filled"] = String(!!moon);
      button.setAttribute("aria-label", `${index + 1}番目の枠、${moon ? MOON_LABELS[moon] : "空"}${this.selected ? `。${MOON_LABELS[this.selected]}を置く` : moon ? "。押すと手元に戻す" : ""}`);
      const icon = button.querySelector(".exp-slot-moon");
      const label = button.querySelector(".exp-slot-label");
      if (icon) icon.innerHTML = moon ? moonIcon(moon, 30) : "＋";
      if (label) label.textContent = moon ? MOON_LABELS[moon] : "空の枠";
    });
    this.required("#experience-ending").hidden = !solved;
    const hasLetter = snapshot?.inspected.includes("letter");
    const hint = snapshot?.hint_level ?? 0;
    const clues: string[] = [];
    if (hasLetter) clues.push("手紙の裏面：丸い月は真ん中に。細い月は、半分の月より後ろに。");
    if (hasLetter && hint >= 1) clues.push("丸い月の位置と、残りの二枚の前後。このふたつを見てみよう。");
    if (hasLetter && hint >= 2) clues.push("真ん中を決めたら、残った二枚の前後を考えてみよう。左から順番に。");
    if (hasLetter && hint >= 3) clues.push("左から、半分の月 → 丸い月 → 細い月。");
    if (!hasLetter) clues.push("手紙の裏面はしずくが読めます。手紙も調べてみてください。");
    if (hasLetter && hint === 0) clues.push("このふたつの条件で並べられます。考え方に迷ったら、しずくにヒントを聞いてみて。");
    this.required("#experience-clue-text").textContent = clues.join("\n");
  }

  private renderControls(state: ExperienceSessionState): void {
    const unavailable = state.busy || state.needsRefresh || !state.snapshot || this.voiceBusy;
    const solved = state.snapshot?.phase === "solved";
    this.required<HTMLButtonElement>("#experience-start").disabled = state.busy || state.expired || this.voiceBusy;
    this.required<HTMLButtonElement>("#experience-start").textContent = state.busy ? "書斎を開いています…" : state.hasSession ? "書斎への接続を確認する" : "書斎に入る →";
    this.required<HTMLButtonElement>("#experience-restart").disabled = state.busy || this.voiceBusy;
    this.required<HTMLButtonElement>("#experience-refresh").disabled = state.busy;
    this.required<HTMLButtonElement>("#experience-submit").disabled = unavailable || solved || !state.snapshot?.arrangement.every((moon) => moon !== null);
    this.required<HTMLButtonElement>("#experience-submit").hidden = solved;
    this.required<HTMLButtonElement>("#experience-hint").disabled = unavailable || solved;
    this.required<HTMLButtonElement>("#experience-hint").hidden = solved;
    this.required<HTMLButtonElement>("#experience-send").disabled = unavailable || !this.draft.trim();
    this.required("#experience-send").hidden = state.busy;
    this.required("#experience-stop").hidden = !state.busy;
    this.required<HTMLTextAreaElement>("#experience-input").disabled = false;
    const microphone = this.required<HTMLButtonElement>("#experience-microphone");
    microphone.disabled = !this.voiceBusy && (state.busy || state.needsRefresh || !state.snapshot || this.voice.state === "checking" || this.voice.state === "unavailable");
    microphone.textContent = this.voice.state === "recording" ? "録音を終える" : this.voice.state === "processing" || this.voice.state === "requesting" ? "入力を停止" : "マイク";
    microphone.setAttribute("aria-label", this.voice.state === "recording" ? "録音を終えて文字にする" : "音声入力を切り替える");
    this.required("#experience-speech-status").textContent = this.speech.message;
    this.required("#experience-voice-status").textContent = this.voice.message;
    const speech = this.required<HTMLButtonElement>("#experience-speech");
    speech.hidden = this.speech.action === "none";
    speech.disabled = state.busy;
    speech.textContent = this.speech.action === "stop" ? "音声を止める" : "もう一度聞く";
    this.root.setAttribute("aria-busy", String(state.busy));
  }

  private renderProvider(): void {
    this.required("#experience-provider").textContent = this.provider === "openai" ?
      "相談する：設定済みの対話APIを最大1回使用（従量課金）。送るのはこの体験の相談と許可済みの手掛かりだけ。通常の対話・記憶は使いません。" : this.provider === "mock" ?
      "相談する：Mockの固定応答（外部AI送信なし）。通常の対話・記憶は使いません。" :
      "相談の接続先は確認中です。API設定時は体験の相談だけを送信し、従量課金される場合があります。通常の対話・記憶は使いません。";
  }

  private get voiceBusy(): boolean {
    return this.voice.state === "requesting" || this.voice.state === "recording" || this.voice.state === "processing";
  }

  private required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Experience element not found: ${selector}`);
    return element;
  }
}
