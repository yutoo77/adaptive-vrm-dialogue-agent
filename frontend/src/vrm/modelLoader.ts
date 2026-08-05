import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  type VRMHumanBoneName as HumanBoneName,
} from "@pixiv/three-vrm";

import type { ModelDiagnostics } from "../types/character";

const DIAGNOSTIC_BONES: readonly HumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightHand,
];

export interface LoadedVRMModel {
  readonly vrm: VRM;
  readonly diagnostics: ModelDiagnostics;
}

export class ModelLoadError extends Error {
  public constructor(
    public readonly userMessage: string,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "ModelLoadError";
  }
}

export async function loadVRMModel(
  url: string,
  onProgress?: (ratio: number | null) => void,
): Promise<LoadedVRMModel> {
  const startedAt = performance.now();
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(url, (event) => {
      const ratio = event.lengthComputable && event.total > 0 ? event.loaded / event.total : null;
      onProgress?.(ratio);
    });
    const candidate: unknown = gltf.userData["vrm"];
    if (!isVRM(candidate)) {
      throw new ModelLoadError(
        "選択したファイルをVRMモデルとして読み込めませんでした。",
        "GLTFLoader result did not contain a VRM instance.",
      );
    }

    VRMUtils.removeUnnecessaryVertices(candidate.scene);
    VRMUtils.combineSkeletons(candidate.scene);
    VRMUtils.rotateVRM0(candidate);
    candidate.scene.updateMatrixWorld(true);

    return {
      vrm: candidate,
      diagnostics: createDiagnostics(candidate, performance.now() - startedAt),
    };
  } catch (error: unknown) {
    if (error instanceof ModelLoadError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelLoadError(
      "VRMモデルを読み込めませんでした。ファイル形式や破損の有無を確認してください。",
      detail,
    );
  }
}

export function disposeVRMModel(vrm: VRM): void {
  vrm.scene.removeFromParent();
  VRMUtils.deepDispose(vrm.scene);
}

function isVRM(value: unknown): value is VRM {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["update"] === "function" && typeof record["scene"] === "object";
}

function createDiagnostics(vrm: VRM, loadTimeMs: number): ModelDiagnostics {
  const meta = vrm.meta as unknown as Record<string, unknown>;
  const modelName = firstString(meta["name"], meta["title"], vrm.scene.name) ?? "名称未設定";
  const vrmVersion = firstString(meta["metaVersion"], meta["specVersion"]) ?? "不明";
  const authors = stringList(meta["authors"], meta["author"]);
  const expressions = Object.keys(vrm.expressionManager?.expressionMap ?? {}).sort();
  const bones = DIAGNOSTIC_BONES.filter((name) => vrm.humanoid.getNormalizedBoneNode(name)).map(String);
  const selectedMeta: Record<string, string> = {};

  for (const [label, keys] of Object.entries({
    バージョン: ["version"],
    連絡先: ["contactInformation", "contactInformationReference"],
    参照元: ["references", "reference"],
  })) {
    const value = keys.map((key) => meta[key]).find((item) => item !== undefined);
    const formatted = formatMetaValue(value);
    if (formatted) selectedMeta[label] = formatted;
  }

  return {
    modelName,
    vrmVersion,
    authors,
    meta: selectedMeta,
    expressions,
    bones,
    loadTimeMs,
  };
}

function firstString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringList(...values: readonly unknown[]): readonly string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (items.length) return items;
    }
    if (typeof value === "string" && value.trim()) return [value.trim()];
  }
  return [];
}

function formatMetaValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return strings.length ? strings.join(", ") : null;
  }
  return null;
}
