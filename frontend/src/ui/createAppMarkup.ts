import {
  CHARACTER_STATES,
  PERFORMANCE_EMOTIONS,
  PERFORMANCE_GESTURES,
  PERFORMANCE_PREVIEW_INTENSITIES,
  type CameraSettings,
  type PerformanceEmotion,
  type PerformanceGesture,
} from "../types/character";
import { getCharacterStatePreset } from "../vrm/CharacterStatePresets";
import { icon } from "./icons";

export function createEmptyDialogue(): string {
  return `<div class="dialogue-empty">
    <span class="empty-conversation-mark" aria-hidden="true">${icon("conversation")}</span>
    <h3>何から話そう？</h3>
    <p>今日のことでも、気になっていることでも。</p>
  </div>`;
}

export function createAppMarkup(): string {
  const stateButtons = CHARACTER_STATES.map((state) => {
    const preset = getCharacterStatePreset(state);
    return `<button class="state-button" type="button" data-character-state="${state}" aria-pressed="false">
      <span class="state-dot" data-tone="${preset.tone}"></span>
      <span><strong>${preset.shortLabel}</strong><small>${preset.label}</small></span>
    </button>`;
  }).join("");

  return `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-block">
          <span id="character-monogram" class="brand-monogram" aria-hidden="true">AC</span>
          <div class="brand-copy">
            <div class="brand-title-row">
              <h1 id="character-name">Adaptive Character</h1>
            </div>
            <p id="character-tagline" hidden></p>
          </div>
        </div>
        <button id="settings-open" class="quiet-button" type="button" data-settings-target="voice" aria-haspopup="dialog">
          ${icon("settings")}<span>設定</span>
        </button>
      </header>

      <main class="workspace">
        <section class="viewer-card" aria-label="キャラクタービューアー">
          <div id="character-viewport" class="character-viewport" tabindex="0">
            <div class="stage-surface" aria-hidden="true"></div>
            <div class="stage-world" aria-hidden="true">
              <span class="stage-moon"></span>
            </div>
            <div id="empty-guide" class="empty-guide">
              ${icon("avatar")}
              <strong>キャラクターを追加</strong>
              <p>VRMファイルをドロップするか、選んでください。</p>
              <button class="primary-button" type="button" data-pick-model>VRMファイルを選ぶ</button>
              <small>端末内だけで表示します · 最大200MB</small>
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
            <div class="drop-hint" aria-hidden="true">ここへドロップ</div>
          </div>
          <div class="viewer-footer">
            <div class="stage-state-card" role="status">
              <span id="stage-state" class="stage-state"></span>
              <p id="stage-message" class="visually-hidden"></p>
            </div>
            <div id="performance-status" class="performance-status" data-emotion="neutral" aria-live="polite" hidden>
              <span id="performance-source">反応</span>
              <strong id="performance-emotion">自然</strong>
              <small id="performance-detail"></small>
            </div>
            <button class="quiet-button stage-settings-button" type="button" data-settings-target="character" aria-label="キャラクターを調整" aria-haspopup="dialog">
              ${icon("sliders")}<span>表示を調整</span>
            </button>
          </div>
        </section>

        <section class="control-panel" aria-label="会話と入力">
          <section class="dialogue-section">
            <div class="conversation-header">
              <div class="conversation-heading">
                <h2 id="conversation-title">会話</h2>
                <p class="connection-status"><small id="dialogue-provider" class="dialogue-provider" data-status="offline" aria-describedby="dialogue-privacy">確認中</small><span id="dialogue-provider-note"></span></p>
              </div>
              <div class="conversation-actions">
                <button id="conversation-reset" class="conversation-reset quiet-button" type="button" aria-label="新しい会話" title="新しい会話" disabled>
                  ${icon("newConversation")}<span class="conversation-reset-label">新しい会話</span>
                </button>
              </div>
            </div>
            <span id="dialogue-memory" hidden>直近 0 / 10往復（RAM）</span>
            <div id="dialogue-log" class="dialogue-log" role="log" aria-label="会話履歴" aria-live="polite" aria-busy="false" tabindex="0">
              ${createEmptyDialogue()}
            </div>
            <div class="composer">
            <div class="composer-tools">
              <label class="response-style-control" for="response-style-select">
                <span>返答</span>
                <select id="response-style-select" aria-label="返答の詳しさ" title="次の返答の詳しさを選択">
                  <option value="concise">短く</option>
                  <option value="balanced" selected>自然に</option>
                  <option value="detailed">詳しく</option>
                  <option value="beginner">やさしく</option>
                </select>
              </label>
              <button id="speech-control" class="speech-control quiet-button" type="button" disabled hidden>音声待機</button>
            </div>
            <form id="dialogue-form" class="dialogue-form">
              <label class="visually-hidden" for="dialogue-input">メッセージ</label>
              <textarea
                id="dialogue-input"
                class="dialogue-input"
                rows="1"
                maxlength="1000"
                placeholder="メッセージを入力…"
                aria-describedby="composer-hint"
                disabled
              ></textarea>
              <button id="voice-input-control" class="voice-input-button" type="button" aria-label="音声入力は現在利用できません" title="音声入力は現在利用できません" disabled>
                ${icon("microphone")}
              </button>
              <button id="dialogue-submit" class="send-button" type="submit" data-mode="send" aria-label="送信" title="送信" disabled>${icon("send")}</button>
            </form>
            <p id="composer-hint" class="composer-hint">Enterで送信<span aria-hidden="true"> · </span>Shift + Enterで改行</p>
            <p id="dialogue-error" class="dialogue-error" role="alert" hidden></p>
            <div id="voice-input-status" class="voice-input-status" data-voice-input-state="checking" role="status">
              <span class="voice-input-status-dot" aria-hidden="true"></span>
              <p id="voice-input-status-summary">音声入力を確認しています</p>
              <button class="status-detail-button" type="button" data-settings-target="voice" aria-label="音声入力の詳細" aria-haspopup="dialog">詳細</button>
            </div>
            <div id="speech-status" class="speech-status" data-speech-state="checking" role="status">
              <span class="speech-status-dot" aria-hidden="true"></span>
              <p id="speech-status-summary">音声出力を確認しています</p>
              <button class="status-detail-button" type="button" data-settings-target="voice" aria-label="音声出力の詳細" aria-haspopup="dialog">詳細</button>
            </div>
            </div>
          </section>
        </section>
      </main>

      <dialog id="settings-dialog" class="settings-dialog" aria-labelledby="settings-title">
        <header class="settings-header">
          <h2 id="settings-title">設定</h2>
          <button id="settings-close" class="icon-button" type="button" aria-label="設定を閉じる" autofocus>${icon("close")}</button>
        </header>
        <div class="settings-tabs" role="tablist" aria-label="設定の種類">
          <button id="settings-tab-voice" type="button" role="tab" data-settings-tab="voice" aria-controls="settings-voice" aria-selected="true">${icon("audio")}音声</button>
          <button id="settings-tab-memory" type="button" role="tab" data-settings-tab="memory" aria-controls="settings-memory" aria-selected="false" tabindex="-1">${icon("memory")}記憶</button>
          <button id="settings-tab-character" type="button" role="tab" data-settings-tab="character" aria-controls="settings-character" aria-selected="false" tabindex="-1">${icon("avatar")}キャラクター</button>
        </div>
        <div class="settings-body">
          <section id="settings-voice" class="settings-page" role="tabpanel" aria-labelledby="settings-tab-voice" tabindex="0">
              <details id="voice-tools" class="conversation-tool-panel" open>
                <summary>音声入力</summary>
                <div class="conversation-tool-content">
                  <p id="voice-input-status-message" class="settings-status-message">音声入力を確認しています</p>
                  <label class="microphone-select-row" for="microphone-select">
                    <span>入力マイク</span>
                    <select id="microphone-select" aria-label="入力に使うマイク" disabled>
                      <option value="">既定のマイク</option>
                    </select>
                  </label>
                  <label class="voice-auto-stop-row" for="voice-auto-stop">
                    <input id="voice-auto-stop" type="checkbox" checked />
                    <span>無音で自動停止</span>
                  </label>
                </div>
              </details>

              <section class="settings-section">
                <h3>音声出力</h3>
                <p id="speech-status-message" class="settings-status-message">音声出力を確認しています</p>
              </section>
              <section class="settings-section connection-note">
                <h3>接続とデータ</h3>
                <p id="dialogue-privacy">Backendへの接続を確認しています。</p>
              </section>
          </section>
          <section id="settings-memory" class="settings-page" role="tabpanel" aria-labelledby="settings-tab-memory" tabindex="0" hidden>
              <details class="conversation-tool-panel persistent-memory-panel" open>
                <summary><span>保存した記憶</span><small id="persistent-memory-count">0件</small></summary>
                <div class="persistent-memory-content">
                  <p class="persistent-memory-note">明示して追加した内容だけを端末内に保存します。</p>
                  <form id="persistent-memory-form" class="persistent-memory-form">
                    <label class="visually-hidden" for="persistent-memory-input">記憶へ追加する内容</label>
                    <textarea id="persistent-memory-input" rows="2" maxlength="500" placeholder="覚えてほしいこと"></textarea>
                    <button type="submit">追加</button>
                  </form>
                  <div id="persistent-memory-list" class="persistent-memory-list" aria-live="polite" aria-busy="false">
                    <p class="persistent-memory-empty">記憶を読み込んでいます。</p>
                  </div>
                  <div class="persistent-memory-footer">
                    <button id="persistent-memory-refresh" type="button">再読込</button>
                    <button id="persistent-memory-clear" class="is-danger" type="button" disabled>すべて削除</button>
                  </div>
                </div>
              </details>
          </section>

          <section id="settings-character" class="settings-page" role="tabpanel" aria-labelledby="settings-tab-character" tabindex="0" hidden>
          <details class="advanced-panel" open>
            <summary><span>モデルと動き</span></summary>
            <div class="advanced-content">
              <section class="tool-section model-section">
                <div class="tool-heading"><h3>モデル</h3></div>
                <strong id="model-status" class="model-badge" data-status="empty">モデル確認中</strong>
                <button class="file-button" type="button" data-pick-model>
                  ${icon("upload")}
                  <span><strong>VRMファイルを選ぶ</strong><small>.vrm / 最大200MB</small></span>
                </button>
                <input id="model-file" type="file" accept=".vrm,model/gltf-binary" hidden />
                <button id="default-model-button" class="secondary-button" type="button">既定モデルを読み込む</button>
                <p class="path-note"><code>public/models/private/character.vrm</code></p>
                <p class="settings-status-message">VRMは端末内だけで表示し、外部へ送信しません。</p>
              </section>

              <section class="tool-section state-section">
                <div class="tool-heading"><h3>手動で状態を確認</h3><small>会話中は自動で切り替わります</small></div>
                <div class="state-grid">${stateButtons}</div>
              </section>

              <details class="inner-tool-panel">
                <summary>演技の強さ</summary>
                <div class="inner-tool-content performance-preview-controls">
                  <p class="performance-preview-note">同じ条件で表情としぐさを見比べます。</p>
                  <div class="performance-preview-grid">
                    <label class="field-label" for="performance-preview-emotion">感情
                      <select id="performance-preview-emotion">
                        ${PERFORMANCE_EMOTIONS.map((emotion) => `<option value="${emotion}"${emotion === "happy" ? " selected" : ""}>${performanceEmotionLabel(emotion)}</option>`).join("")}
                      </select>
                    </label>
                    <label class="field-label" for="performance-preview-gesture">しぐさ
                      <select id="performance-preview-gesture">
                        ${PERFORMANCE_GESTURES.map((gesture) => `<option value="${gesture}"${gesture === "soft_bounce" ? " selected" : ""}>${performanceGestureLabel(gesture)}</option>`).join("")}
                      </select>
                    </label>
                  </div>
                  <fieldset class="performance-intensity-fieldset">
                    <legend>強さ</legend>
                    <div class="performance-intensity-buttons">
                      <button type="button" data-performance-intensity="${PERFORMANCE_PREVIEW_INTENSITIES.weak}">弱 <small>30%</small></button>
                      <button type="button" class="is-active" data-performance-intensity="${PERFORMANCE_PREVIEW_INTENSITIES.medium}" aria-pressed="true">中 <small>60%</small></button>
                      <button type="button" data-performance-intensity="${PERFORMANCE_PREVIEW_INTENSITIES.strong}">強 <small>90%</small></button>
                    </div>
                  </fieldset>
                  <label class="field-label" for="performance-motion-mode">動き
                    <select id="performance-motion-mode">
                      <option value="system" selected>OS設定に従う</option>
                      <option value="normal">通常</option>
                      <option value="reduced">控えめ</option>
                    </select>
                  </label>
                  <p id="performance-preview-status" class="performance-preview-status" aria-live="polite">中 60%・OS設定に従う</p>
                  <span id="motion-status" class="motion-badge" hidden>動きを抑えています</span>
                  <div class="performance-preview-actions">
                    <button id="performance-preview-play" class="secondary-button" type="button">再生</button>
                    <button id="performance-preview-reset" class="text-button" type="button">自動へ戻す</button>
                  </div>
                </div>
              </details>

              <details class="inner-tool-panel">
                <summary>表情</summary>
                <div class="inner-tool-content">
                  <label class="field-label" for="expression-select">表情を選択</label>
                  <select id="expression-select" disabled><option value="">モデル読み込み後に選択できます</option></select>
                  <div class="range-row">
                    <label for="expression-weight">強さ</label>
                    <output id="expression-weight-output">50%</output>
                  </div>
                  <input id="expression-weight" type="range" min="0" max="1" step="0.01" value="0.5" disabled />
                  <button id="expression-reset" class="text-button" type="button" disabled>自動表情へ戻す</button>
                </div>
              </details>

              <details class="inner-tool-panel">
                <summary>カメラ</summary>
                <div class="inner-tool-content camera-controls">
                  ${cameraRange("distance", "距離", 0.65, 1.8, 0.01, 1)}
                  ${cameraRange("heightOffset", "高さ", -0.5, 0.5, 0.01, 0)}
                  ${cameraRange("lookAtOffset", "視線", -0.4, 0.4, 0.01, 0)}
                  ${cameraRange("modelOffset", "位置", -0.6, 0.6, 0.01, 0)}
                  ${cameraRange("scale", "大きさ", 0.65, 1.45, 0.01, 1)}
                  <button id="camera-reset" class="text-button" type="button">標準へ戻す</button>
                </div>
              </details>

              <details class="inner-tool-panel developer-section">
                <summary>診断情報</summary>
                <div class="inner-tool-content">
                  <p class="settings-status-message">キャラクター定義 <span id="character-version" class="character-version" hidden></span></p>
                  <div class="latency-summary" aria-label="直近の処理時間">
                    <span>処理時間</span>
                    <dl>
                      <div><dt>認識</dt><dd id="latency-transcription">—</dd></div>
                      <div><dt>初字</dt><dd id="latency-first-text">—</dd></div>
                      <div><dt>本文</dt><dd id="latency-text-complete">—</dd></div>
                      <div><dt>発話</dt><dd id="latency-speech-start">—</dd></div>
                    </dl>
                  </div>
                  <div id="developer-content" class="developer-content"></div>
                </div>
              </details>
            </div>
          </details>
          </section>
        </div>
      </dialog>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    </div>`;
}

function cameraRange(
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

export function performanceEmotionLabel(emotion: PerformanceEmotion): string {
  const labels: Readonly<Record<PerformanceEmotion, string>> = {
    neutral: "自然",
    happy: "うれしい",
    gentle: "やさしい",
    curious: "興味",
    cautious: "慎重",
    confused: "困惑",
  };
  return labels[emotion];
}

function performanceGestureLabel(gesture: PerformanceGesture): string {
  const labels: Readonly<Record<PerformanceGesture, string>> = {
    none: "しぐさなし",
    small_nod: "小さくうなずく",
    head_tilt: "首をかしげる",
    soft_bounce: "軽く弾む",
  };
  return labels[gesture];
}
