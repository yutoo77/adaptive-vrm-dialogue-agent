import { SpeechApiError, type SpeechClient } from "../speech/SpeechClient";
import type { SpeechStatus, VoiceCatalog, VoiceSettings } from "../speech/types";
import { copyVoiceSettings, isVoiceSettings, parseStoredVoiceSettings, VOICE_STORAGE_KEY } from "../speech/voicePreferences";

interface VoiceSettingsActions {
  readonly change: (settings: VoiceSettings | undefined) => void;
  readonly preview: () => void;
  readonly stop: () => void;
}

export class VoiceSettingsPanel {
  private readonly events = new AbortController();
  private catalog: VoiceCatalog | null = null;
  private current: VoiceSettings | undefined;
  private loading = false;
  private dialogueBusy = false;
  private microphoneBusy = false;
  private speechBusy = false;
  private previewing = false;

  public constructor(
    private readonly root: HTMLElement,
    private readonly client: Pick<SpeechClient, "getVoices">,
    private readonly actions: VoiceSettingsActions,
  ) {
    try { this.current = parseStoredVoiceSettings(localStorage.getItem(VOICE_STORAGE_KEY)); } catch { /* Optional storage. */ }
    actions.change(this.current);
    const signal = this.events.signal;
    this.node<HTMLSelectElement>("voice-choice").addEventListener("change", () => this.readControls(), { signal });
    ["voice-speed", "voice-pitch", "voice-intonation"].forEach((id) => {
      this.node<HTMLInputElement>(id).addEventListener("input", () => this.readControls(), { signal });
    });
    this.node("voice-refresh").addEventListener("click", () => void this.load(true), { signal });
    this.node("voice-reset").addEventListener("click", () => {
      if (!this.catalog) return;
      this.current = this.availableDefaults();
      this.apply(true);
    }, { signal });
    this.node("voice-preview").addEventListener("click", () => {
      if (this.previewing) { this.actions.stop(); return; }
      this.previewing = true;
      this.syncControls();
      this.actions.preview();
    }, { signal });
  }

  public async load(refresh = false): Promise<void> {
    if (this.loading || (this.catalog && !refresh)) return;
    this.loading = true;
    this.note("声の一覧を読み込んでいます…");
    this.syncControls();
    try {
      this.catalog = await this.client.getVoices(this.events.signal);
      if (this.events.signal.aborted) return;
      const select = this.node<HTMLSelectElement>("voice-choice");
      select.replaceChildren();
      for (const voice of this.catalog.voices) {
        const option = document.createElement("option");
        option.value = String(voice.id);
        option.textContent = `${voice.name} / ${voice.style}`;
        select.append(option);
      }
      const missing = this.current && !this.catalog.voices.some((voice) => voice.id === this.current?.speaker_id);
      if (!this.current || missing) this.current = this.availableDefaults();
      this.apply(false);
      this.note(missing ? "保存していた声が見つからないため、利用できる声に戻しました。" : "次の発話から反映。このブラウザに保存します。");
    } catch (error: unknown) {
      if (!this.events.signal.aborted) this.note(error instanceof SpeechApiError ? error.message : "声の一覧を取得できませんでした。");
    } finally {
      this.loading = false;
      if (!this.events.signal.aborted) this.syncControls();
    }
  }

  public setDialogueBusy(busy: boolean): void { this.dialogueBusy = busy; this.syncControls(); }
  public setMicrophoneBusy(busy: boolean): void { this.microphoneBusy = busy; this.syncControls(); }
  public setSpeechStatus(status: SpeechStatus): void {
    this.speechBusy = status.state === "generating" || status.state === "playing";
    if (!this.speechBusy) this.previewing = false;
    this.syncControls();
  }
  public dispose(): void { this.events.abort(); }

  private availableDefaults(): VoiceSettings {
    if (!this.catalog) throw new Error("Voice catalog is not loaded");
    const fallback = this.catalog.voices[0];
    const defaults = copyVoiceSettings(this.catalog.defaults);
    return !fallback || this.catalog.voices.some((voice) => voice.id === defaults.speaker_id)
      ? defaults : { ...defaults, speaker_id: fallback.id };
  }

  private readControls(): void {
    const settings: VoiceSettings = {
      speaker_id: Number(this.node<HTMLSelectElement>("voice-choice").value),
      speed_scale: Number(this.node<HTMLInputElement>("voice-speed").value),
      pitch_scale: Number(this.node<HTMLInputElement>("voice-pitch").value),
      intonation_scale: Number(this.node<HTMLInputElement>("voice-intonation").value),
    };
    if (!isVoiceSettings(settings)) return;
    this.current = settings;
    this.apply(true);
  }

  private apply(persist: boolean): void {
    const settings = this.current;
    if (!settings) return;
    this.node<HTMLSelectElement>("voice-choice").value = String(settings.speaker_id);
    this.node<HTMLInputElement>("voice-speed").value = String(settings.speed_scale);
    this.node<HTMLInputElement>("voice-pitch").value = String(settings.pitch_scale);
    this.node<HTMLInputElement>("voice-intonation").value = String(settings.intonation_scale);
    this.node("voice-speed-value").textContent = `${settings.speed_scale.toFixed(2)}×`;
    this.node("voice-pitch-value").textContent = `${settings.pitch_scale > 0 ? "+" : ""}${settings.pitch_scale.toFixed(2)}`;
    this.node("voice-intonation-value").textContent = `${settings.intonation_scale.toFixed(2)}×`;
    const voice = this.catalog?.voices.find((item) => item.id === settings.speaker_id);
    this.node("voice-credit").textContent = voice?.credit ?? "";
    this.actions.change(copyVoiceSettings(settings));
    if (persist) {
      try {
        localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(settings));
        this.note("次の発話から反映。このブラウザに保存しました。");
      } catch { this.note("設定は有効です。ブラウザへの保存はできませんでした。"); }
    }
  }

  private syncControls(): void {
    this.node<HTMLFieldSetElement>("voice-options").disabled = !this.catalog || this.loading;
    this.node<HTMLButtonElement>("voice-refresh").disabled = this.loading;
    const preview = this.node<HTMLButtonElement>("voice-preview");
    preview.disabled = !this.catalog || this.loading || this.dialogueBusy || this.microphoneBusy
      || (this.speechBusy && !this.previewing);
    preview.textContent = this.previewing ? "試聴を止める" : "声を試す";
  }

  private note(message: string): void { this.node("voice-settings-note").textContent = message; }
  private node<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Missing voice control: ${id}`);
    return element;
  }
}
