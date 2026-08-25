import type { CharacterState, ModelDiagnostics, ReducedMotionMode } from "../types/character";

export interface DeveloperPanelModel {
  readonly diagnostics: ModelDiagnostics | null;
  readonly state: CharacterState;
  readonly expression: string;
  readonly dialogueProvider: string;
  readonly dialogueModel: string;
  readonly characterProfile: string;
  readonly dialogueMemoryTurns: number;
  readonly dialogueMemoryMaxTurns: number;
  readonly dialogueSummaryAvailable: boolean;
  readonly persistentMemoryCount: number;
  readonly speechState: string;
  readonly voiceInputState: string;
  readonly reducedMotionEnabled: boolean;
  readonly reducedMotionMode: ReducedMotionMode;
  readonly latencySummary: string;
  readonly fps: number;
  readonly warnings: readonly string[];
}

export function renderDeveloperPanel(container: HTMLElement, model: DeveloperPanelModel): void {
  container.replaceChildren();
  const diagnostics = model.diagnostics;
  const rows: readonly [string, string][] = [
    ["モデル名", diagnostics?.modelName ?? "未設定"],
    ["VRM", diagnostics?.vrmVersion ?? "—"],
    ["作者", diagnostics?.authors.join(", ") || "情報なし"],
    ["状態", model.state],
    ["Expression", model.expression],
    ["対話", `${model.dialogueProvider} / ${model.dialogueModel}`],
    ["人格Profile", model.characterProfile],
    ["会話記憶", `${model.dialogueMemoryTurns} / ${model.dialogueMemoryMaxTurns} 往復（RAM）`],
    ["会話要約", model.dialogueSummaryAvailable ? "あり（RAM）" : "なし"],
    ["長期記憶", `${model.persistentMemoryCount} 件（端末内SQLite）`],
    ["音声", model.speechState],
    ["音声入力", model.voiceInputState],
    ["動き", model.reducedMotionEnabled ? `抑制 (${model.reducedMotionMode})` : `通常 (${model.reducedMotionMode})`],
    ["処理時間", model.latencySummary],
    ["FPS", `${model.fps} fps`],
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

  appendTokenList(container, "Expression一覧", diagnostics?.expressions ?? []);
  appendTokenList(container, "主要ボーン", diagnostics?.bones ?? []);

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
  const items = model.warnings.length ? model.warnings : ["警告はありません"];
  items.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    warningList.append(item);
  });
  container.append(warningTitle, warningList);
}

function appendTokenList(container: HTMLElement, title: string, values: readonly string[]): void {
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
