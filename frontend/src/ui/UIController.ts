import {
  CHARACTER_STATES,
  DEFAULT_CAMERA_SETTINGS,
  type CameraSettings,
  type CharacterState,
  type ModelDiagnostics,
} from "../types/character";
import { getCharacterStatePreset } from "../vrm/CharacterStatePresets";

export interface UIActions {
  readonly loadFile: (file: File) => Promise<void>;
  readonly loadDefault: () => Promise<void>;
  readonly setState: (state: CharacterState) => void;
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

  public constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.createMarkup();
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
    const stateBadge = this.required("#current-state");
    const stageStatus = this.required("#stage-state");
    const stageMessage = this.required("#stage-message");

    stateBadge.textContent = preset.label;
    stateBadge.dataset["tone"] = preset.tone;
    stageStatus.textContent = preset.label;
    stageStatus.dataset["tone"] = preset.tone;
    stageMessage.textContent = preset.message;
    this.root.dataset["state"] = state;

    this.root.querySelectorAll<HTMLButtonElement>("[data-state]").forEach((button) => {
      const selected = button.dataset["state"] === state;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    this.updateDeveloperPanel();
  }

  public updateExpression(expression: string): void {
    this.currentExpression = expression;
    this.updateDeveloperPanel();
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

  public updateReducedMotion(enabled: boolean): void {
    const badge = this.required("#motion-status");
    badge.hidden = !enabled;
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

  private createMarkup(): string {
    const stateButtons = CHARACTER_STATES.map((state) => {
      const preset = getCharacterStatePreset(state);
      return `<button class="state-button" type="button" data-state="${state}" aria-pressed="false">
        <span class="state-dot" data-tone="${preset.tone}"></span>
        <span><strong>${preset.shortLabel}</strong><small>${preset.label}</small></span>
      </button>`;
    }).join("");

    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="brand-block">
            <div class="brand-mark" aria-hidden="true"><span></span></div>
            <div>
              <div class="eyebrow">VRM CHARACTER CONTROL / v0.1</div>
              <h1>Adaptive Character Lab</h1>
              <p>表情と動きで応答するAIキャラクター基盤</p>
            </div>
          </div>
          <div class="header-status" aria-label="現在の状態">
            <div class="status-item"><span>状態</span><strong id="current-state" class="status-badge"></strong></div>
            <div class="status-item"><span>モデル</span><strong id="model-status" class="model-badge" data-status="empty">確認中</strong></div>
          </div>
        </header>

        <section class="workspace">
          <section class="viewer-card" aria-label="キャラクタービューアー">
            <div id="character-viewport" class="character-viewport" tabindex="0">
              <div class="viewport-glow glow-one" aria-hidden="true"></div>
              <div class="viewport-glow glow-two" aria-hidden="true"></div>
              <div class="stage-grid" aria-hidden="true"></div>
              <div id="empty-guide" class="empty-guide">
                <span class="guide-kicker">MODEL SETUP</span>
                <strong>VRMモデルが設定されていません</strong>
                <p>右側からVRMファイルを選ぶか、画面へドロップしてください。</p>
              </div>
              <div id="loading-overlay" class="loading-overlay" hidden>
                <div class="loading-card">
                  <span class="loading-orbit" aria-hidden="true"></span>
                  <strong id="loading-text">モデルを読み込んでいます</strong>
                  <div class="progress-track"><span id="loading-progress"></span></div>
                </div>
              </div>
              <div id="fatal-panel" class="fatal-panel" hidden>
                <strong>3D表示を開始できませんでした</strong>
                <p id="fatal-message"></p>
              </div>
              <div class="stage-state-card">
                <span id="stage-state" class="stage-state"></span>
                <p id="stage-message"></p>
              </div>
              <span id="motion-status" class="motion-badge" hidden>動きを抑えています</span>
              <div class="drop-hint" aria-hidden="true">VRMをここへドロップ</div>
            </div>
            <div class="viewer-footer">
              <span class="privacy-mark" aria-hidden="true">●</span>
              <p>選択したVRMモデルはブラウザ内で読み込まれ、外部へ送信されません</p>
            </div>
          </section>

          <aside class="control-panel" aria-label="キャラクター操作">
            <section class="control-section model-section">
              <div class="section-heading"><div><span>01</span><h2>モデル</h2></div><small>LOCAL FILE</small></div>
              <label class="file-button" for="model-file">
                <span class="file-button-icon" aria-hidden="true">＋</span>
                <span><strong>VRMファイルを選択</strong><small>.vrm / 最大200MB</small></span>
              </label>
              <input id="model-file" type="file" accept=".vrm,model/gltf-binary" hidden />
              <button id="default-model-button" class="secondary-button" type="button">既定パスを再確認</button>
              <p class="path-note"><code>public/models/private/character.vrm</code></p>
            </section>

            <section class="control-section state-section">
              <div class="section-heading"><div><span>02</span><h2>キャラクター状態</h2></div><small>MANUAL</small></div>
              <div class="state-grid">${stateButtons}</div>
            </section>

            <details class="control-section compact-section">
              <summary><span><b>03</b> 表情をテスト</span><small>EXPRESSION</small></summary>
              <div class="details-content">
                <label class="field-label" for="expression-select">Expression</label>
                <select id="expression-select" disabled><option value="">モデル読み込み後に選択できます</option></select>
                <div class="range-row">
                  <label for="expression-weight">強さ</label>
                  <output id="expression-weight-output">50%</output>
                </div>
                <input id="expression-weight" type="range" min="0" max="1" step="0.01" value="0.5" disabled />
                <button id="expression-reset" class="text-button" type="button" disabled>状態の表情へ戻す</button>
              </div>
            </details>

            <details class="control-section compact-section">
              <summary><span><b>04</b> カメラ調整</span><small>FRAMING</small></summary>
              <div class="details-content camera-controls">
                ${this.cameraRange("distance", "距離", 0.65, 1.8, 0.01, 1)}
                ${this.cameraRange("heightOffset", "カメラ高さ", -0.5, 0.5, 0.01, 0)}
                ${this.cameraRange("lookAtOffset", "注視点", -0.4, 0.4, 0.01, 0)}
                ${this.cameraRange("modelOffset", "モデル位置", -0.6, 0.6, 0.01, 0)}
                ${this.cameraRange("scale", "表示倍率", 0.65, 1.45, 0.01, 1)}
                <button id="camera-reset" class="text-button" type="button">標準表示に戻す</button>
              </div>
            </details>

            <details class="control-section compact-section developer-section">
              <summary><span><b>05</b> 開発者情報</span><small>DIAGNOSTICS</small></summary>
              <div id="developer-content" class="details-content developer-content"></div>
            </details>
          </aside>
        </section>
        <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      </div>`;
  }

  private registerEvents(): void {
    const signal = this.abortController.signal;
    const input = this.required<HTMLInputElement>("#model-file");

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

    this.root.querySelectorAll<HTMLButtonElement>("[data-state]").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const state = button.dataset["state"] as CharacterState | undefined;
          if (state) this.actions?.setState(state);
        },
        { signal },
      );
    });

    this.registerExpressionEvents(signal);
    this.registerCameraEvents(signal);
    this.registerDropEvents(signal);
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

  private updateDeveloperPanel(): void {
    const container = this.required("#developer-content");
    container.replaceChildren();
    const diagnostics = this.modelDiagnostics;

    const rows: readonly [string, string][] = [
      ["モデル名", diagnostics?.modelName ?? "未設定"],
      ["VRM", diagnostics?.vrmVersion ?? "—"],
      ["作者", diagnostics?.authors.join(", ") || "情報なし"],
      ["状態", this.currentState],
      ["Expression", this.currentExpression],
      ["FPS", `${this.fps} fps`],
      ["読み込み", diagnostics?.loadTimeMs === null || diagnostics === null ? "—" : `${Math.round(diagnostics.loadTimeMs)} ms`],
    ];
    const table = document.createElement("dl");
    table.className = "diagnostic-list";
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      if (label === "FPS") dd.id = "dev-fps";
      table.append(dt, dd);
    });
    container.append(table);

    this.appendTokenList(container, "Expression一覧", diagnostics?.expressions ?? []);
    this.appendTokenList(container, "主要ボーン", diagnostics?.bones ?? []);

    if (diagnostics && Object.keys(diagnostics.meta).length) {
      const metaTitle = document.createElement("h3");
      metaTitle.textContent = "メタ情報";
      const metaList = document.createElement("dl");
      metaList.className = "diagnostic-list compact";
      Object.entries(diagnostics.meta).forEach(([label, value]) => {
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        metaList.append(dt, dd);
      });
      container.append(metaTitle, metaList);
    }

    const warningTitle = document.createElement("h3");
    warningTitle.textContent = "警告";
    const warningList = document.createElement("ul");
    warningList.className = "warning-list";
    const items = this.warnings.length ? this.warnings : ["警告はありません"];
    items.forEach((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      warningList.append(item);
    });
    container.append(warningTitle, warningList);
  }

  private appendTokenList(container: HTMLElement, title: string, values: readonly string[]): void {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("div");
    list.className = "token-list";
    if (!values.length) {
      const empty = document.createElement("span");
      empty.className = "token is-empty";
      empty.textContent = "なし";
      list.append(empty);
    } else {
      values.forEach((value) => {
        const token = document.createElement("span");
        token.className = "token";
        token.textContent = value;
        list.append(token);
      });
    }
    container.append(heading, list);
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

  private cameraRange(
    key: keyof CameraSettings,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
  ): string {
    return `<div class="camera-field">
      <div class="range-row"><label for="camera-${key}">${label}</label><output data-camera-output="${key}">${value.toFixed(2)}</output></div>
      <input id="camera-${key}" data-camera="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>`;
  }

  private required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Required UI element is missing: ${selector}`);
    return element;
  }
}
