import "./styles.css";

import { DialogueClient } from "./dialogue/DialogueClient";
import { DialogueController } from "./dialogue/DialogueController";
import { LipSyncController } from "./speech/LipSyncController";
import { SpeechClient } from "./speech/SpeechClient";
import { SpeechController } from "./speech/SpeechController";
import { PushToTalkController } from "./transcription/PushToTalkController";
import { TranscriptionClient } from "./transcription/TranscriptionClient";
import type { CameraSettings, CharacterState } from "./types/character";
import { UIController } from "./ui/UIController";
import { PerformanceTimelineController } from "./vrm/PerformanceTimelineController";
import { VRMViewer } from "./vrm/VRMViewer";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root was not found.");

const ui = new UIController(root);
let viewer: VRMViewer | null = null;
let performanceTimeline: PerformanceTimelineController | null = null;
const lipSync = new LipSyncController({
  onViseme: (viseme, weight) => viewer?.setLipSyncViseme(viseme, weight),
  onReset: () => viewer?.resetLipSync(),
});
const speech = new SpeechController(
  new SpeechClient(),
  {
    onStatusChange: (status) => ui.updateSpeechStatus(status),
    onPlaybackChange: (event) => performanceTimeline?.handlePlayback(event),
    onWarning: (message) => ui.addWarning(message),
    onLatency: (latencyMs) => ui.updateLatency("speech", latencyMs),
  },
  lipSync,
);
const voiceInput = new PushToTalkController(new TranscriptionClient(), {
  onStatusChange: (status) => ui.updateVoiceInputStatus(status),
  onMicrophonesChange: (options, selectedDeviceId) => ui.updateMicrophoneOptions(options, selectedDeviceId),
  onTranscript: (text) => {
    ui.setDialogueDraft(text);
    ui.showNotice("文字起こしを入力欄へ反映しました。内容を確認して送信してください。");
  },
  onCharacterState: (state) => viewer?.setState(state),
  onBeforeRecording: () => speech.stop(),
  onWarning: (message) => ui.addWarning(message),
  onLatency: (latencyMs) => ui.updateLatency("transcription", latencyMs),
});
const dialogue = new DialogueController(
  new DialogueClient(),
  {
    onConnectionChange: (health, errorMessage) => ui.updateDialogueConnection(health, errorMessage),
    onMessage: (role, text) => ui.appendDialogueMessage(role, text),
    onBusyChange: (busy) => ui.updateDialogueBusy(busy),
    onCharacterState: (state) => {
      if (state === "thinking" || state === "error") performanceTimeline?.clear();
      viewer?.setState(state);
    },
    onPerformancePlan: (performance) => {
      performanceTimeline?.prepare(performance);
      ui.updatePerformance(performance);
    },
    onError: (message) => {
      ui.showDialogueError(message);
      ui.addWarning(message);
    },
    onClearError: () => ui.clearDialogueError(),
    onLatency: (latencyMs) => ui.updateLatency("dialogue", latencyMs),
    onMemoryChange: (turns, maxTurns) => ui.updateDialogueMemory(turns, maxTurns),
    onSummaryChange: (available) => ui.updateDialogueSummary(available),
    onPersistentMemoriesChange: (items) => ui.updatePersistentMemories(items),
    onPersistentMemoryBusyChange: (busy) => ui.updatePersistentMemoryBusy(busy),
    onMemoryNotice: (message) => ui.showNotice(message),
    onConversationReset: () => {
      performanceTimeline?.clear();
      ui.resetDialogueConversation();
      ui.showNotice("新しい会話を始めました。前の会話の記憶は消去されています。");
    },
  },
  speech,
);

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
    onReducedMotionChange: (enabled, mode) => ui.updateReducedMotion(enabled, mode),
  });
  performanceTimeline = new PerformanceTimelineController({
    preparePerformance: (performance) => viewer?.preparePerformance(performance),
    playGesture: (gesture, intensity) => viewer?.playPerformanceGesture(gesture, intensity),
    returnToIdle: () => viewer?.setState("idle"),
    reportPhase: (phase, cueIndex, cueTotal) => ui.updatePerformancePhase(phase, cueIndex, cueTotal),
  });

  ui.bind({
    loadFile: (file: File) => viewer?.loadFile(file) ?? Promise.resolve(),
    loadDefault: () => viewer?.loadDefaultModel() ?? Promise.resolve(),
    sendMessage: (message: string) => dialogue.send(message),
    resetConversation: () => dialogue.resetConversation(),
    addPersistentMemory: (content: string) => dialogue.addPersistentMemory(content),
    updatePersistentMemory: (memoryId: string, content: string) =>
      dialogue.updatePersistentMemory(memoryId, content),
    deletePersistentMemory: (memoryId: string) => dialogue.deletePersistentMemory(memoryId),
    clearPersistentMemories: () => dialogue.clearPersistentMemories(),
    refreshPersistentMemories: () => dialogue.refreshPersistentMemories(),
    toggleSpeech: () => dialogue.toggleSpeech(),
    toggleVoiceInput: () => voiceInput.toggle(),
    selectMicrophone: (deviceId: string) => voiceInput.selectMicrophone(deviceId),
    setVoiceAutoStop: (enabled: boolean) => voiceInput.setAutoStop(enabled),
    setState: (state: CharacterState) => viewer?.setState(state),
    previewPerformance: (performance) => {
      speech.stop();
      performanceTimeline?.clear();
      viewer?.setPerformance(performance);
    },
    setReducedMotionMode: (mode) => viewer?.setReducedMotionMode(mode) ?? mode === "reduced",
    restoreAutomaticPerformance: () => {
      speech.stop();
      performanceTimeline?.clear();
      viewer?.setReducedMotionMode("system");
      viewer?.setState("idle");
    },
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
  void dialogue.initialize();
  void speech.initialize();
  void voiceInput.initialize();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "不明な初期化エラーです。";
  ui.addWarning(message);
  ui.showFatal("3D表示を開始できませんでした。ブラウザのWebGL設定を確認して、ページを再読み込みしてください。");
}

window.addEventListener(
  "beforeunload",
  () => {
    dialogue.dispose();
    voiceInput.dispose();
    performanceTimeline?.dispose();
    viewer?.dispose();
    ui.dispose();
  },
  { once: true },
);
