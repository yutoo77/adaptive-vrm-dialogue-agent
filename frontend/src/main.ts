import "./styles.css";

import type { CameraSettings, CharacterState } from "./types/character";
import { UIController } from "./ui/UIController";
import { VRMViewer } from "./vrm/VRMViewer";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root was not found.");

const ui = new UIController(root);
let viewer: VRMViewer | null = null;

try {
  viewer = new VRMViewer(ui.viewport, {
    onStateChange: (state) => ui.updateState(state),
    onExpressionChange: (expression) => ui.updateExpression(expression),
    onLoadingChange: (loading, progress) => ui.updateLoading(loading, progress),
    onModelLoaded: (diagnostics) => ui.updateModelLoaded(diagnostics),
    onModelMissing: () => ui.updateModelMissing(),
    onNotice: (message) => ui.showNotice(message),
    onWarning: (message) => ui.addWarning(message),
    onError: (message) => {
      ui.showError(message);
      viewer?.setState("error");
    },
    onFps: (fps) => ui.updateFps(fps),
    onReducedMotionChange: (enabled) => ui.updateReducedMotion(enabled),
  });

  ui.bind({
    loadFile: (file: File) => viewer?.loadFile(file) ?? Promise.resolve(),
    loadDefault: () => viewer?.loadDefaultModel() ?? Promise.resolve(),
    setState: (state: CharacterState) => viewer?.setState(state),
    setExpression: (name: string | null, weight: number) => viewer?.setManualExpression(name, weight) ?? false,
    setCamera: (settings: CameraSettings) => viewer?.setCameraSettings(settings) ?? settings,
    resetCamera: () => viewer?.resetCamera() ?? {
      distance: 1,
      heightOffset: 0,
      lookAtOffset: 0,
      modelOffset: 0,
      scale: 1,
    },
  });

  void viewer.loadDefaultModel();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "不明な初期化エラーです。";
  ui.addWarning(message);
  ui.showFatal("3D表示を開始できませんでした。ブラウザのWebGL設定を確認して、ページを再読み込みしてください。");
}

window.addEventListener(
  "beforeunload",
  () => {
    viewer?.dispose();
    ui.dispose();
  },
  { once: true },
);
