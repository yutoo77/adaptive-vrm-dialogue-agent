import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Timer,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { SpeechViseme } from "../speech/types";
import type { EmotionalContinuity } from "../dialogue/types";

import {
  DEFAULT_CAMERA_SETTINGS,
  type CameraSettings,
  type CharacterState,
  type ModelDiagnostics,
  type PerformanceGesture,
  type PerformancePlan,
  type ReducedMotionMode,
  performanceEmotionToState,
  resolveReducedMotion,
} from "../types/character";
import { clampCameraSettings } from "../utils/math";
import { getCharacterStatePreset } from "./CharacterStatePresets";
import { CharacterController } from "./CharacterController";
import { FrameRateMeter } from "./FrameRateMeter";
import { GazeMotionController } from "./GazeMotionController";
import { IdleMotionController } from "./IdleMotionController";
import { PerformanceMotionController } from "./PerformanceMotionController";
import { disposeVRMModel, loadVRMModel, ModelLoadError } from "./modelLoader";

export const DEFAULT_MODEL_PATH = "/models/private/character.vrm";
export const MAX_MODEL_BYTES = 200 * 1024 * 1024;

export interface VRMViewerEvents {
  readonly onStateChange: (state: CharacterState) => void;
  readonly onExpressionChange: (expression: string) => void;
  readonly onLoadingChange: (loading: boolean, progress: number | null) => void;
  readonly onModelLoaded: (diagnostics: ModelDiagnostics) => void;
  readonly onModelMissing: () => void;
  readonly onNotice: (message: string) => void;
  readonly onWarning: (message: string) => void;
  readonly onError: (message: string) => void;
  readonly onFps: (fps: number) => void;
  readonly onReducedMotionChange: (enabled: boolean, mode: ReducedMotionMode) => void;
}

export class VRMViewer {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.05, 100);
  private readonly renderer: WebGLRenderer;
  private readonly timer = new Timer();
  private readonly frameRate = new FrameRateMeter();
  private readonly placeholder = new Group();
  private readonly lookAtTarget = new Object3D();
  private readonly controller: CharacterController;
  private readonly idleMotion = new IdleMotionController();
  private readonly gazeMotion = new GazeMotionController();
  private readonly performanceMotion = new PerformanceMotionController();
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private currentVRM: VRM | null = null;
  private currentModelHeight = 1.7;
  private currentModelBaseY = 0;
  private cameraSettings: CameraSettings = DEFAULT_CAMERA_SETTINGS;
  private animationFrameId: number | null = null;
  private loadGeneration = 0;
  private disposed = false;
  private reducedMotionMode: ReducedMotionMode = "system";
  private emotionalContinuity: EmotionalContinuity | null = null;

  public constructor(
    private readonly container: HTMLElement,
    private readonly events: VRMViewerEvents,
  ) {
    this.renderer = this.createRenderer();
    this.timer.connect(document);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.controller = new CharacterController({
      onStateChange: events.onStateChange,
      onExpressionChange: events.onExpressionChange,
      onWarning: events.onWarning,
    });

    this.setupScene();
    this.container.append(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerleave", this.handlePointerLeave);
    this.reducedMotionQuery.addEventListener("change", this.handleReducedMotionChange);
    this.applyReducedMotion(this.reducedMotionQuery.matches);
    this.resize();
    this.start();
  }

  public getState(): CharacterState {
    return this.controller.getState();
  }

  public getActiveExpression(): string {
    return this.controller.getActiveExpression();
  }

  public setState(state: CharacterState): void {
    this.performanceMotion.reset();
    this.controller.setState(state);
  }

  public setPerformance(plan: PerformancePlan): void {
    this.preparePerformance(plan);
    this.playPerformanceGesture(plan.gesture, plan.intensity);
  }

  public preparePerformance(plan: PerformancePlan): void {
    this.controller.applyPerformance(performanceEmotionToState(plan.emotion), plan.intensity);
  }

  public setEmotionalContinuity(continuity: EmotionalContinuity): void {
    this.emotionalContinuity = continuity;
    this.gazeMotion.setBehavior(continuity.gaze_behavior, continuity.intensity);
    this.idleMotion.setContinuityScale(continuity.motion_scale);
  }

  public returnToEmotionalBaseline(): void {
    this.performanceMotion.reset();
    const continuity = this.emotionalContinuity;
    if (!continuity || continuity.emotion === "neutral") {
      this.controller.setState("idle");
      return;
    }
    this.controller.applyPerformance(
      performanceEmotionToState(continuity.emotion),
      Math.min(0.38, continuity.intensity * 0.46),
    );
  }

  public resetEmotionalContinuity(): void {
    this.emotionalContinuity = null;
    this.gazeMotion.reset();
    this.idleMotion.setContinuityScale(1);
    this.controller.setAmbientGaze(0, 0);
    this.setState("idle");
  }

  public playPerformanceGesture(gesture: PerformanceGesture, intensity: number): void {
    this.performanceMotion.start(gesture, intensity);
  }

  public setReducedMotionMode(mode: ReducedMotionMode): boolean {
    this.reducedMotionMode = mode;
    const enabled = resolveReducedMotion(mode, this.reducedMotionQuery.matches);
    this.applyReducedMotion(enabled);
    return enabled;
  }

  public setManualExpression(name: string | null, weight: number): boolean {
    return this.controller.setManualExpression(name, weight);
  }

  public setLipSyncWeight(weight: number): boolean {
    return this.controller.setLipSyncWeight(weight);
  }

  public setLipSyncViseme(viseme: SpeechViseme, weight: number): boolean {
    return this.controller.setLipSyncViseme(viseme, weight);
  }

  public resetLipSync(): void {
    this.controller.resetLipSync();
  }

  public setCameraSettings(settings: CameraSettings): CameraSettings {
    this.cameraSettings = clampCameraSettings(settings);
    this.applyFraming();
    return this.cameraSettings;
  }

  public resetCamera(): CameraSettings {
    return this.setCameraSettings(DEFAULT_CAMERA_SETTINGS);
  }

  public async loadDefaultModel(): Promise<void> {
    await this.loadFromUrl(DEFAULT_MODEL_PATH, true);
  }

  public async loadFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith(".vrm")) {
      this.events.onError("VRM形式（.vrm）のファイルを選択してください。");
      return;
    }
    if (file.size > MAX_MODEL_BYTES) {
      this.events.onError("ファイルが大きすぎます。200MB以下のVRMを選択してください。");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      await this.loadFromUrl(objectUrl, false);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadGeneration += 1;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.resizeObserver.disconnect();
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerleave", this.handlePointerLeave);
    this.reducedMotionQuery.removeEventListener("change", this.handleReducedMotionChange);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.controller.detachVRM();
    this.timer.dispose();
    if (this.currentVRM) disposeVRMModel(this.currentVRM);
    this.currentVRM = null;
    this.disposePlaceholder();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private createRenderer(): WebGLRenderer {
    try {
      const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setClearColor(0xffffff, 0);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.domElement.className = "character-canvas";
      renderer.domElement.setAttribute("aria-label", "VRMキャラクター表示領域");
      return renderer;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`WebGLを初期化できませんでした: ${detail}`, { cause: error });
    }
  }

  private setupScene(): void {
    this.scene.background = null;
    this.scene.add(new AmbientLight(new Color("#eef1ff"), 2.35));

    const keyLight = new DirectionalLight(new Color("#fffdfb"), 4.25);
    keyLight.position.set(2.4, 4.2, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(keyLight);

    const rimLight = new DirectionalLight(new Color("#9da9eb"), 2.25);
    rimLight.position.set(-3.5, 2.6, -1.5);
    this.scene.add(rimLight);

    const floor = new Mesh(new PlaneGeometry(8, 8), new ShadowMaterial({ color: 0x59668f, opacity: 0.14 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.createPlaceholder();
    this.scene.add(this.placeholder, this.lookAtTarget);
    this.applyFraming();
  }

  private createPlaceholder(): void {
    const bodyMaterial = new MeshPhysicalMaterial({
      color: new Color("#f1f3ff"),
      roughness: 0.58,
      metalness: 0.02,
      clearcoat: 0.2,
    });
    const accentMaterial = new MeshPhysicalMaterial({
      color: new Color("#8278b8"),
      roughness: 0.5,
      metalness: 0.04,
    });

    const head = new Mesh(new SphereGeometry(0.34, 40, 28), bodyMaterial);
    head.position.y = 1.58;
    head.castShadow = true;
    const torso = new Mesh(new SphereGeometry(0.58, 40, 28), bodyMaterial);
    torso.scale.set(0.82, 1.25, 0.55);
    torso.position.y = 0.82;
    torso.castShadow = true;
    const neck = new Mesh(new CylinderGeometry(0.14, 0.17, 0.25, 24), bodyMaterial);
    neck.position.y = 1.3;
    const halo = new Mesh(new TorusGeometry(0.73, 0.018, 12, 80), accentMaterial);
    halo.position.set(0, 1.23, -0.32);
    halo.rotation.x = Math.PI / 2;
    const platform = new Mesh(new CircleGeometry(0.82, 64), accentMaterial);
    platform.rotation.x = -Math.PI / 2;
    platform.position.y = 0.005;

    this.placeholder.add(head, torso, neck, halo, platform);
  }

  private disposePlaceholder(): void {
    const materials = new Set<Material>();
    this.placeholder.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const source = Array.isArray(object.material) ? object.material : [object.material];
      source.forEach((material) => materials.add(material));
    });
    materials.forEach((material) => material.dispose());
  }

  private async loadFromUrl(url: string, isDefault: boolean): Promise<void> {
    const generation = ++this.loadGeneration;
    this.events.onLoadingChange(true, null);

    try {
      const loaded = await loadVRMModel(url, (progress) => {
        if (generation === this.loadGeneration) this.events.onLoadingChange(true, progress);
      });
      if (generation !== this.loadGeneration || this.disposed) {
        disposeVRMModel(loaded.vrm);
        return;
      }

      this.replaceModel(loaded.vrm);
      this.events.onModelLoaded(loaded.diagnostics);
      this.events.onNotice("VRMモデルをブラウザ内で読み込みました。");
    } catch (error: unknown) {
      if (generation !== this.loadGeneration) return;
      const message = error instanceof ModelLoadError ? error.userMessage : "モデルの読み込みに失敗しました。";
      const detail = error instanceof ModelLoadError ? error.detail : error instanceof Error ? error.message : String(error);

      if (isDefault && !this.currentVRM) {
        this.events.onModelMissing();
        this.events.onWarning("既定モデルは未設定です。VRMファイルを選択すると表示できます。");
      } else {
        this.events.onError(message);
        this.events.onWarning(detail);
      }
    } finally {
      if (generation === this.loadGeneration) this.events.onLoadingChange(false, null);
    }
  }

  private replaceModel(vrm: VRM): void {
    this.controller.detachVRM();
    if (this.currentVRM) disposeVRMModel(this.currentVRM);

    this.currentVRM = vrm;
    this.placeholder.visible = false;
    this.scene.add(vrm.scene);
    vrm.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.measureModel(vrm);
    this.applyFraming();
    this.controller.attachVRM(vrm, this.lookAtTarget);
  }

  private measureModel(vrm: VRM): void {
    const box = new Box3().setFromObject(vrm.scene);
    if (box.isEmpty()) {
      this.currentModelHeight = 1.7;
      this.currentModelBaseY = 0;
      this.events.onWarning("モデルの大きさを取得できなかったため、標準値で表示します。");
      return;
    }

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    this.currentModelHeight = MathUtils.clamp(size.y, 0.5, 4.0);
    vrm.scene.position.x -= center.x;
    vrm.scene.position.y -= box.min.y;
    vrm.scene.position.z -= center.z;
    this.currentModelBaseY = vrm.scene.position.y;
  }

  private applyFraming(): void {
    const settings = this.cameraSettings;
    if (!this.currentVRM) {
      this.placeholder.scale.setScalar(settings.scale);
      this.placeholder.position.y = settings.modelOffset;
      this.camera.position.set(0, 1.25 + settings.heightOffset, 3.2 * settings.distance);
      this.camera.lookAt(0, 1.2 + settings.lookAtOffset, 0);
      return;
    }

    const height = this.currentModelHeight * settings.scale;
    this.currentVRM.scene.scale.setScalar(settings.scale);
    const modelY = this.currentModelBaseY + settings.modelOffset * this.currentModelHeight;
    this.currentVRM.scene.position.y = modelY;
    this.controller.setRootBaseY(modelY);
    const targetY = height * 0.69 + settings.lookAtOffset * this.currentModelHeight;
    const frameHeight = height * 0.92;
    const distance =
      (frameHeight / (2 * Math.tan(MathUtils.degToRad(this.camera.fov * 0.5)))) * settings.distance;
    this.camera.position.set(0, targetY + settings.heightOffset * this.currentModelHeight, distance);
    this.camera.lookAt(0, targetY, 0);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
  }

  private start(): void {
    if (this.animationFrameId !== null || this.disposed) return;
    this.timer.reset();
    this.frameRate.reset();
    const animate = (timestamp: number): void => {
      if (this.disposed) return;
      this.animationFrameId = requestAnimationFrame(animate);
      this.timer.update(timestamp);
      const delta = Math.min(this.timer.getDelta(), 0.05);
      const preset = getCharacterStatePreset(this.controller.getState());
      const motion = this.idleMotion.update(delta, preset.motion);
      const gaze = this.gazeMotion.update(delta);
      const performance = this.performanceMotion.update(delta);
      this.controller.setAmbientGaze(gaze.offsetX, gaze.offsetY);

      if (this.currentVRM) {
        this.controller.update(delta, motion, performance);
        this.currentVRM.update(delta);
      } else {
        this.placeholder.rotation.y = motion.swayAngle * 0.8;
        this.placeholder.position.y = this.cameraSettings.modelOffset + motion.breathOffset;
      }

      this.renderer.render(this.scene, this.camera);
      const fps = this.frameRate.sample(timestamp);
      if (fps !== null) this.events.onFps(fps);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private readonly handleVisibilityChange = (): void => {
    this.frameRate.reset();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.container.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.controller.setPointer(x, y);
  };

  private readonly handlePointerLeave = (): void => {
    this.controller.setPointer(0, 0);
  };

  private readonly handleReducedMotionChange = (event: MediaQueryListEvent): void => {
    if (this.reducedMotionMode === "system") this.applyReducedMotion(event.matches);
  };

  private applyReducedMotion(enabled: boolean): void {
    this.idleMotion.setReducedMotion(enabled);
    this.gazeMotion.setReducedMotion(enabled);
    this.performanceMotion.setReducedMotion(enabled);
    this.events.onReducedMotionChange(enabled, this.reducedMotionMode);
  }
}
