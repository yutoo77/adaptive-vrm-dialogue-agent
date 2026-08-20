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
          <span class="brand-monogram" aria-hidden="true">AC</span>
          <h1>Adaptive Character</h1>
        </div>
      </header>

      <main class="workspace">
        <section class="viewer-card" aria-label="キャラクタービューアー">
          <div id="character-viewport" class="character-viewport" tabindex="0">
            <div class="stage-surface" aria-hidden="true"></div>
            <div class="stage-world" aria-hidden="true">
              <span class="stage-lattice stage-lattice-left"></span>
              <span class="stage-lattice stage-lattice-right"></span>
              <span class="stage-moon"></span>
              <span class="stage-ripple stage-ripple-far"></span>
              <span class="stage-ripple stage-ripple-near"></span>
              <span class="stage-mote stage-mote-one"></span>
              <span class="stage-mote stage-mote-two"></span>
              <span class="stage-mote stage-mote-three"></span>
              <span class="stage-mote stage-mote-four"></span>
            </div>
            <div class="stage-topbar">
              <strong id="model-status" class="model-badge" data-status="empty">モデル確認中</strong>
            </div>
            <div id="empty-guide" class="empty-guide">
              <strong>キャラクターを追加</strong>
              <p>VRMファイルをここへドロップ</p>
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
            <div class="drop-hint" aria-hidden="true">ここへドロップ</div>
          </div>
          <div class="viewer-footer">
            <span class="privacy-mark" aria-hidden="true">✓</span>
            <p title="モデルは端末内だけで表示され、外部へ送信されません">端末内表示</p>
          </div>
        </section>

        <aside class="control-panel" aria-label="キャラクター操作">
          <section class="dialogue-section">
            <div class="conversation-header">
              <h2>会話</h2>
              <div class="conversation-actions">
                <small id="dialogue-provider" class="dialogue-provider" data-status="offline" aria-describedby="dialogue-privacy">確認中</small>
                <button id="conversation-reset" class="conversation-reset" type="button" aria-label="新しい会話" title="新しい会話" disabled>
                  <span aria-hidden="true">↻</span><span class="conversation-reset-label">新しい会話</span>
                </button>
              </div>
            </div>
            <span id="dialogue-memory" hidden>直近 0 / 10往復（RAM）</span>
            <div id="performance-status" class="performance-status" data-emotion="neutral" aria-live="polite" hidden>
              <span id="performance-source">自動演技</span>
              <strong id="performance-emotion">自然</strong>
              <small id="performance-detail"></small>
            </div>
            <div id="dialogue-log" class="dialogue-log" role="log" aria-live="polite" aria-busy="false">
              <p class="dialogue-empty">ここから会話を始めましょう</p>
            </div>
            <form id="dialogue-form" class="dialogue-form">
              <label class="visually-hidden" for="dialogue-input">メッセージ</label>
              <textarea
                id="dialogue-input"
                class="dialogue-input"
                rows="1"
                maxlength="1000"
                placeholder="話しかけてみて…"
                disabled
              ></textarea>
              <button id="voice-input-control" class="voice-input-button" type="button" aria-label="音声入力は現在利用できません" title="音声入力は現在利用できません" disabled>
                <span class="voice-input-icon" aria-hidden="true"></span>
              </button>
              <button id="dialogue-submit" class="send-button" type="submit" aria-label="送信" disabled><span aria-hidden="true">↑</span></button>
            </form>
            <p id="dialogue-error" class="dialogue-error" role="alert" hidden></p>
            <div id="voice-input-status" class="voice-input-status" data-voice-input-state="checking">
              <span class="voice-input-status-dot" aria-hidden="true"></span>
              <p id="voice-input-status-message">音声入力を確認しています</p>
            </div>
            <div id="speech-status" class="speech-status" data-speech-state="checking">
              <span class="speech-status-dot" aria-hidden="true"></span>
              <p id="speech-status-message">音声出力を確認しています</p>
              <button id="speech-control" class="speech-control" type="button" disabled>音声待機</button>
            </div>

            <div class="conversation-tools">
              <details id="voice-tools" class="conversation-tool-panel">
                <summary>音声設定</summary>
                <div class="conversation-tool-content">
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

              <details class="conversation-tool-panel persistent-memory-panel">
                <summary><span>記憶</span><small id="persistent-memory-count">0件</small></summary>
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
            </div>
            <p id="dialogue-privacy" hidden>Backendへの接続を確認しています。</p>
          </section>

          <details class="advanced-panel">
            <summary><span>キャラクターを調整</span><small>モデル・表情・カメラ</small></summary>
            <div class="advanced-content">
              <section class="tool-section model-section">
                <div class="tool-heading"><h3>モデル</h3></div>
                <label class="file-button" for="model-file">
                  <span class="file-button-icon" aria-hidden="true">＋</span>
                  <span><strong>VRMファイルを選ぶ</strong><small>.vrm / 最大200MB</small></span>
                </label>
                <input id="model-file" type="file" accept=".vrm,model/gltf-binary" hidden />
                <button id="default-model-button" class="secondary-button" type="button">既定モデルを読み込む</button>
                <p class="path-note"><code>public/models/private/character.vrm</code></p>
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
                  <div class="latency-summary" aria-label="直近の処理時間">
                    <span>処理時間</span>
                    <dl>
                      <div><dt>認識</dt><dd id="latency-transcription">—</dd></div>
                      <div><dt>応答</dt><dd id="latency-dialogue">—</dd></div>
                      <div><dt>音声</dt><dd id="latency-speech">—</dd></div>
                    </dl>
                  </div>
                  <div id="developer-content" class="developer-content"></div>
                </div>
              </details>
            </div>
          </details>
        </aside>
      </main>
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
