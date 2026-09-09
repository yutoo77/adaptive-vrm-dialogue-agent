import "./styles.css";

import { DialogueClient } from "./dialogue/DialogueClient";
import { DialogueController } from "./dialogue/DialogueController";
import { PresentationSpeechOutput } from "./dialogue/PresentationSpeechOutput";
import type { EmotionalContinuity } from "./dialogue/types";
import { ExperienceController } from "./experience/ExperienceController";
import { LipSyncController } from "./speech/LipSyncController";
import { SpeechClient } from "./speech/SpeechClient";
import { SpeechController } from "./speech/SpeechController";
import type { SpeechStatus } from "./speech/types";
import { PushToTalkController } from "./transcription/PushToTalkController";
import { TranscriptionClient } from "./transcription/TranscriptionClient";
import type { VoiceInputStatus } from "./transcription/types";
import type { CameraSettings, CharacterState, PerformancePlan } from "./types/character";
import { UIController } from "./ui/UIController";
import { VoiceSettingsPanel } from "./ui/VoiceSettingsPanel";
import { WorkspaceModes, type WorkspaceMode } from "./ui/WorkspaceModes";
import { PerformanceTimelineController } from "./vrm/PerformanceTimelineController";
import { VRMViewer } from "./vrm/VRMViewer";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root was not found.");

const ui = new UIController(root);
let viewer: VRMViewer | null = null;
let performanceTimeline: PerformanceTimelineController | null = null;
let voiceSettings: VoiceSettingsPanel | null = null;
let experience: ExperienceController | null = null;
let workspaceModes: WorkspaceModes | null = null;
let currentMode: WorkspaceMode = "dialogue";
let dialoguePresentationAllowed = true;
let dialogueBusy = false;
let experienceBusy = false;
let experienceSpeechInitialized = false;
let normalContinuity: EmotionalContinuity | null = null;
let normalPerformance: PerformancePlan | null = null;
let experiencePerformance: PerformancePlan | null = null;
let normalSpeechStatus: SpeechStatus = { state: "checking", message: "音声を確認しています。", action: "none" };
let experienceSpeechStatus: SpeechStatus = normalSpeechStatus;
let voiceInputStatus: VoiceInputStatus = { state: "checking", message: "音声入力を確認しています。", action: "none" };
const speechClient = new SpeechClient();
const lipSync = new LipSyncController({
  onViseme: (viseme, weight) => { if (currentMode === "dialogue") viewer?.setLipSyncViseme(viseme, weight); },
  onReset: () => { if (currentMode === "dialogue") viewer?.resetLipSync(); },
});
const speech = new SpeechController(
  speechClient,
  {
    onStatusChange: (status) => {
      normalSpeechStatus = status;
      if (currentMode === "dialogue") { ui.updateSpeechStatus(status); voiceSettings?.setSpeechStatus(status); }
    },
    onPlaybackChange: (event) => { if (currentMode === "dialogue") performanceTimeline?.handlePlayback(event); },
    onWarning: (message) => { if (currentMode === "dialogue") ui.addWarning(message); },
  },
  lipSync,
);
const experienceLipSync = new LipSyncController({
  onViseme: (viseme, weight) => { if (currentMode === "experience") viewer?.setLipSyncViseme(viseme, weight); },
  onReset: () => { if (currentMode === "experience") viewer?.resetLipSync(); },
});
const experienceSpeech = new SpeechController(speechClient, {
  onStatusChange: (status) => {
    experienceSpeechStatus = status;
    experience?.setSpeechStatus(status);
    if (currentMode === "experience") { ui.updateSpeechStatus(status); voiceSettings?.setSpeechStatus(status); }
  },
  onPlaybackChange: (event) => { if (currentMode === "experience") performanceTimeline?.handlePlayback(event); },
  onWarning: (message) => { if (currentMode === "experience") ui.addWarning(message); },
}, experienceLipSync);
const dialogueSpeech = new PresentationSpeechOutput(speech, () => currentMode === "dialogue");
const activeSpeech = (): SpeechController => currentMode === "dialogue" ? speech : experienceSpeech;
const syncVoiceSettingsBusy = (): void => voiceSettings?.setDialogueBusy(
  currentMode === "dialogue" ? dialogueBusy : experienceBusy,
);
voiceSettings = new VoiceSettingsPanel(root, speechClient, {
  change: (settings) => { speech.setVoiceSettings(settings); experienceSpeech.setVoiceSettings(settings); },
  preview: () => {
    performanceTimeline?.clear();
    activeSpeech().speak("こんにちは、しずくだよ。この声でお話ししよう。忙しかった分、少し休もうね。");
  },
  stop: () => activeSpeech().stop(),
});
const voiceInput = new PushToTalkController(new TranscriptionClient(), {
  onStatusChange: (status) => {
    voiceInputStatus = status;
    ui.updateVoiceInputStatus(status);
    experience?.setVoiceStatus(status);
    voiceSettings?.setMicrophoneBusy(["requesting", "recording", "processing"].includes(status.state));
  },
  onMicrophonesChange: (options, selectedDeviceId) => ui.updateMicrophoneOptions(options, selectedDeviceId),
  onTranscript: (text) => {
    if (currentMode === "experience") experience?.setDraft(text);
    else {
      ui.setDialogueDraft(text);
      ui.showNotice("文字起こしを入力欄へ反映しました。内容を確認して送信してください。");
    }
  },
  onCharacterState: (state) => viewer?.setState(state),
  onBeforeRecording: () => activeSpeech().stop(),
  onWarning: (message) => ui.addWarning(message),
  onLatency: (latencyMs) => { if (currentMode === "dialogue") ui.updateLatency("transcription", latencyMs); },
});
const dialogue = new DialogueController(
  new DialogueClient(),
  {
    onConnectionChange: (health, errorMessage) => {
      ui.updateDialogueConnection(health, errorMessage);
      experience?.setProvider(health?.provider ?? null);
    },
    onMessage: (role, text) => ui.appendDialogueMessage(role, text),
    onPartialAssistantMessage: (text) => ui.updateStreamingAssistantMessage(text),
    onCompleteAssistantMessage: (text) => ui.completeStreamingAssistantMessage(text),
    onDiscardPartialAssistantMessage: () => ui.discardStreamingAssistantMessage(),
    onBusyChange: (busy) => { dialogueBusy = busy; ui.updateDialogueBusy(busy); syncVoiceSettingsBusy(); },
    onCharacterState: (state) => {
      if (currentMode !== "dialogue" || !dialoguePresentationAllowed) return;
      if (state === "thinking" || state === "error") performanceTimeline?.clear();
      viewer?.setState(state);
    },
    onPerformancePlan: (performance) => {
      normalPerformance = performance;
      if (currentMode !== "dialogue" || !dialoguePresentationAllowed) return;
      performanceTimeline?.prepare(performance);
      ui.updatePerformance(performance);
    },
    onContinuityChange: (continuity) => {
      normalContinuity = continuity;
      if (currentMode !== "dialogue" || !dialoguePresentationAllowed) return;
      viewer?.setEmotionalContinuity(continuity);
      ui.updateEmotionalContinuity(continuity);
    },
    onError: (message) => {
      ui.showDialogueError(message);
      if (currentMode === "dialogue") ui.addWarning(message);
    },
    onClearError: () => ui.clearDialogueError(),
    onResponseTiming: (stage, latencyMs) => ui.updateLatency(stage, latencyMs),
    onMemoryChange: (turns, maxTurns) => ui.updateDialogueMemory(turns, maxTurns),
    onSummaryChange: (available) => ui.updateDialogueSummary(available),
    onPersistentMemoriesChange: (items) => ui.updatePersistentMemories(items),
    onPersistentMemoryBusyChange: (busy) => ui.updatePersistentMemoryBusy(busy),
    onMemoryNotice: (message) => ui.showNotice(message),
    onCancelled: () => {
      if (currentMode !== "dialogue" || !dialoguePresentationAllowed) return;
      performanceTimeline?.clear();
      ui.updatePerformance(null);
      ui.showNotice("応答を停止しました。会話履歴と長期記憶には保存していません。");
    },
    onConversationReset: () => {
      normalContinuity = null;
      normalPerformance = null;
      if (currentMode === "dialogue") { performanceTimeline?.clear(); viewer?.resetEmotionalContinuity(); }
      ui.resetDialogueConversation();
      ui.showNotice("新しい会話を始めました。前の会話の記憶は消去されています。");
    },
  },
  dialogueSpeech,
);

experience = new ExperienceController(root.querySelector<HTMLElement>("#experience-workspace")!, {
  onReply: (text, performance) => {
    if (currentMode !== "experience") return;
    experiencePerformance = performance;
    experienceSpeech.speak(text, performance);
    performanceTimeline?.prepare(performance);
    ui.updatePerformance(performance);
  },
  onBusyChange: (busy) => {
    experienceBusy = busy;
    syncVoiceSettingsBusy();
    if (busy && currentMode === "experience") { performanceTimeline?.clear(); viewer?.setState("thinking"); }
    if (!busy && currentMode === "experience" && !["generating", "playing"].includes(experienceSpeechStatus.state)) {
      viewer?.returnToEmotionalBaseline();
    }
  },
  onFocus: (target) => {
    if (currentMode !== "experience") return;
    viewer?.setSceneAttention(target === "window" ? { x: -.3, y: .16 }
      : target === "letter" ? { x: -.22, y: -.17 } : target === "box" ? { x: -.3, y: -.08 } : null);
  },
  onStop: () => {
    experienceSpeech.stop();
    if (currentMode === "experience") { performanceTimeline?.clear(); viewer?.returnToEmotionalBaseline(); }
  },
  onToggleSpeech: () => {
    if (currentMode !== "experience") return;
    if (experiencePerformance) performanceTimeline?.prepare(experiencePerformance);
    experienceSpeech.toggle();
  },
  onMicrophoneToggle: () => { if (currentMode === "experience") voiceInput.toggle(); },
});
experience.setVoiceStatus(voiceInputStatus);
experience.setSpeechStatus(experienceSpeechStatus);
workspaceModes = new WorkspaceModes(root, experience.avatarSlot, (mode) => {
  if (["requesting", "recording", "processing"].includes(voiceInputStatus.state)) voiceInput.cancel();
  if (currentMode === "dialogue") {
    dialoguePresentationAllowed = false;
    dialogueSpeech.suspend();
    dialogue.cancelResponse();
  } else experience?.leave();
  performanceTimeline?.clear();
  viewer?.resetLipSync();
  viewer?.setSceneAttention(null);
  viewer?.resetEmotionalContinuity();
  currentMode = mode;
  viewer?.setCompanionFraming(mode === "experience");
  ui.updatePerformance(null);
  delete root.dataset["continuity"];
  syncVoiceSettingsBusy();
  if (mode === "experience") {
    if (!experienceSpeechInitialized) { experienceSpeechInitialized = true; void experienceSpeech.initialize(); }
    ui.updateSpeechStatus(experienceSpeechStatus);
    voiceSettings?.setSpeechStatus(experienceSpeechStatus);
    experience?.enter();
  } else {
    if (normalContinuity) { viewer?.setEmotionalContinuity(normalContinuity); ui.updateEmotionalContinuity(normalContinuity); }
    viewer?.returnToEmotionalBaseline();
    ui.updateSpeechStatus(normalSpeechStatus);
    voiceSettings?.setSpeechStatus(normalSpeechStatus);
  }
});

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
    returnToBaseline: () => viewer?.returnToEmotionalBaseline(),
    reportPhase: (phase, cueIndex, cueTotal) => ui.updatePerformancePhase(phase, cueIndex, cueTotal),
  });

  ui.bind({
    loadFile: (file: File) => viewer?.loadFile(file) ?? Promise.resolve(),
    loadDefault: () => viewer?.loadDefaultModel() ?? Promise.resolve(),
    sendMessage: (message: string) => {
      if (currentMode !== "dialogue" || dialogueBusy) return false;
      dialoguePresentationAllowed = true;
      dialogueSpeech.beginTurn();
      return dialogue.send(message);
    },
    cancelResponse: () => dialogue.cancelResponse(),
    setResponseStyle: (style) => dialogue.setResponseStyle(style),
    resetConversation: () => dialogue.resetConversation(),
    addPersistentMemory: (content: string) => dialogue.addPersistentMemory(content),
    updatePersistentMemory: (memoryId: string, content: string) =>
      dialogue.updatePersistentMemory(memoryId, content),
    deletePersistentMemory: (memoryId: string) => dialogue.deletePersistentMemory(memoryId),
    clearPersistentMemories: () => dialogue.clearPersistentMemories(),
    refreshPersistentMemories: () => dialogue.refreshPersistentMemories(),
    toggleSpeech: () => {
      if (currentMode !== "dialogue") return;
      if (normalPerformance) performanceTimeline?.prepare(normalPerformance);
      dialogue.toggleSpeech();
    },
    loadVoices: () => { void voiceSettings?.load(); },
    toggleVoiceInput: () => voiceInput.toggle(),
    selectMicrophone: (deviceId: string) => voiceInput.selectMicrophone(deviceId),
    setVoiceAutoStop: (enabled: boolean) => voiceInput.setAutoStop(enabled),
    setState: (state: CharacterState) => viewer?.setState(state),
    previewPerformance: (performance) => {
      activeSpeech().stop();
      performanceTimeline?.clear();
      viewer?.setPerformance(performance);
    },
    setReducedMotionMode: (mode) => viewer?.setReducedMotionMode(mode) ?? mode === "reduced",
    restoreAutomaticPerformance: () => {
      activeSpeech().stop();
      performanceTimeline?.clear();
      viewer?.setReducedMotionMode("system");
      viewer?.returnToEmotionalBaseline();
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

  const modelInitialization = viewer.loadDefaultModel();
  void dialogue.initialize();
  void speech.initialize();
  // A local VRM can briefly occupy the browser main thread. Start microphone discovery after
  // that first load so its short health check does not report a false failure during parsing.
  void modelInitialization.then(
    () => voiceInput.initialize(),
    () => voiceInput.initialize(),
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "不明な初期化エラーです。";
  ui.addWarning(message);
  ui.showFatal("3D表示を開始できませんでした。ブラウザのWebGL設定を確認して、ページを再読み込みしてください。");
}

window.addEventListener(
  "beforeunload",
  () => {
    dialogue.dispose();
    experience?.dispose();
    experienceSpeech.dispose();
    workspaceModes?.dispose();
    voiceInput.dispose();
    voiceSettings?.dispose();
    performanceTimeline?.dispose();
    viewer?.dispose();
    ui.dispose();
  },
  { once: true },
);
