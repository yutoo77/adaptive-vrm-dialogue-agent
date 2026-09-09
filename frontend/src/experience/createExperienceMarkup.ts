import type { Moon } from "./types";

export const MOON_LABELS: Readonly<Record<Moon, string>> = { half: "半分の月", full: "丸い月", crescent: "細い月" };
export const TARGET_LABELS = { window: "窓", letter: "手紙", box: "小箱" } as const;

export function moonIcon(moon: Moon, size = 34): string {
  const shape = moon === "full" ? '<circle cx="24" cy="24" r="16" fill="currentColor"/>' :
    moon === "half" ? '<path d="M24 8a16 16 0 0 1 0 32Z" fill="currentColor"/><circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="1.4"/>' :
      '<path d="M29 8a16 16 0 1 0 11 23A16 16 0 0 1 29 8Z" fill="currentColor"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${shape}</svg>`;
}

export function createExperienceMarkup(): string {
  return `
    <header class="exp-heading">
      <div><p class="exp-kicker">しずくと、ひとつの物語</p><h1>月待ちの便り</h1></div>
      <button type="button" id="experience-restart" class="exp-text-button" hidden>最初から</button>
    </header>
    <div class="exp-layout">
      <section class="exp-story" aria-label="月待ちの書斎">
        <div class="exp-scene" id="experience-scene">
          <svg class="exp-room" viewBox="0 0 640 280" role="img" aria-label="青い空の窓と、手紙、小箱のある静かな書斎">
            <defs>
              <linearGradient id="experience-sky" x2="0" y2="1"><stop stop-color="#dbe8f5"/><stop offset="1" stop-color="#edf3f8"/></linearGradient>
              <linearGradient id="experience-light" x2="1" y2="1"><stop stop-color="#fbfcfd"/><stop offset="1" stop-color="#f3f0e9"/></linearGradient>
            </defs>
            <path fill="url(#experience-light)" d="M0 0h640v280H0z"/>
            <path d="M0 194h640v86H0" fill="#ece7dc"/>
            <path d="M0 194h640M0 202h640" fill="none" stroke="#d7d0c3"/>
            <path d="M55 0v185h230V0" fill="#fff" stroke="#d9e1e9" stroke-width="3"/>
            <path d="M68 0h204v171H68z" fill="url(#experience-sky)"/>
            <circle cx="220" cy="59" r="20" fill="#fffdf2"/>
            <path d="M171 0v173M67 104h205" stroke="#fafbfc" stroke-width="7"/>
            <path d="M44 183h253v10H44z" fill="#fdfdfd" stroke="#d9e1e9"/>
            <path d="m79 203 185-9 65 86H79z" fill="#fffdf6" opacity=".35"/>
            <path d="m83 225 113-28 83 29-114 31z" fill="#d0c6b5" opacity=".3"/>
            <path d="m83 216 115-27 83 28-115 30z" fill="#fffdf6" stroke="#c9bdab" stroke-width="1.4"/>
            <path d="m99 213 82 9 19-30m-19 30-13 20" fill="none" stroke="#dfd5c7" stroke-width="1.3"/>
            <circle cx="181" cy="221" r="7" fill="#a4b6cd"/><path d="M184 216a5 5 0 1 0 2 6 5 5 0 0 1-2-6" fill="#f5f7fa"/>
            <path d="m392 219 137-5 50 21-137 9z" fill="#c9c1b3" opacity=".35"/>
            <path class="exp-box-lid" d="m389 190 129-13 47 25-128 15z" fill="#e4d7bd" stroke="#b8a788" stroke-width="1.5"/>
            <path class="exp-box-note" d="m427 197 66-7 18 14-67 8z" fill="#fffdf6" stroke="#c9bdab"/>
            <path d="m389 190 48 27v26l-48-26z" fill="#cfc0a4" stroke="#b8a788" stroke-width="1.5"/>
            <path d="m437 217 128-15v27l-128 14z" fill="#ddd0b6" stroke="#b8a788" stroke-width="1.5"/>
            <path class="exp-box-lid" d="m398 190 119-11 34 20-113 13z" fill="none" stroke="#f2eadb"/>
            <path d="m469 221 21-3v11l-21 3z" fill="#a6a28a"/>
            <path class="exp-box-lid" d="m421 190 20-2 6 4-20 2m16-3 20-2 6 4-20 2m16-3 20-2 6 4-20 2" fill="none" stroke="#b5a282" stroke-width="2"/>
            <path d="M345 70h97M345 80h57" stroke="#dcdedc" stroke-width="2"/>
          </svg>
          <div class="exp-scene-caption" aria-hidden="true">月を待つ、静かな書斎。</div>
          <button type="button" class="exp-hotspot exp-window" data-inspect="window" aria-label="窓を調べる" hidden><span>窓</span><span class="exp-inspected" aria-hidden="true"></span></button>
          <button type="button" class="exp-hotspot exp-letter" data-inspect="letter" aria-label="手紙を調べる" hidden><span>手紙</span><span class="exp-inspected" aria-hidden="true"></span></button>
          <button type="button" class="exp-hotspot exp-box" data-inspect="box" aria-label="小箱を調べる" hidden><span>小箱</span><span class="exp-inspected" aria-hidden="true"></span></button>
        </div>
        <div id="experience-landing" class="exp-landing">
          <h2>あなたに見えるもの。<br>しずくに読めるもの。</h2>
          <p>三枚の月の栞と、閉じた小箱。<br>手掛かりを持ち寄って、ふたりで箱を開ける小さな体験です。</p>
          <button type="button" id="experience-start" class="exp-primary">書斎に入る <span aria-hidden="true">→</span></button>
          <p class="exp-fine">時間制限なし · 操作とヒントはAPI課金なし<br>進行はこのページの間だけ保持されます。自動保存はありません。</p>
        </div>
        <div id="experience-play" class="exp-play" hidden>
          <div class="exp-board-heading"><h2 id="experience-board-title">三枚の月の栞</h2><span id="experience-progress" class="exp-fine"></span></div>
          <p id="experience-selection" class="exp-instruction" aria-live="polite">栞をひとつ選び、左から並ぶ枠へ置いてみて。</p>
          <div class="exp-moons" role="group" aria-label="月の栞を選ぶ">
            ${(["full", "crescent", "half"] as const).map((moon) => `<button type="button" class="exp-moon" data-moon="${moon}" aria-pressed="false">${moonIcon(moon)}<span>${MOON_LABELS[moon]}</span><small data-moon-location="${moon}">手元</small></button>`).join("")}
          </div>
          <div class="exp-slots" role="group" aria-label="小箱の枠・左から順に">
            ${[0, 1, 2].map((index) => `<button type="button" class="exp-slot" data-slot="${index}" aria-label="${index + 1}番目の枠、空"><small>${index + 1}</small><span class="exp-slot-moon" aria-hidden="true">＋</span><span class="exp-slot-label">空の枠</span></button>`).join("")}
          </div>
          <p class="exp-slot-help">選択なしで置いた栞を押すと、手元に戻せます。</p>
          <div class="exp-board-actions"><button type="button" id="experience-submit" class="exp-primary">この並びで開ける</button><button type="button" id="experience-hint" class="exp-secondary">しずくにヒントを聞く</button></div>
          <details class="exp-clue"><summary>ふたりの手掛かり</summary><p id="experience-clue-text">気になる場所を押して、調べてみてください。手紙の裏面はしずくが読めます。</p></details>
          <section id="experience-ending" class="exp-ending" aria-label="物語の終わり" hidden><span aria-hidden="true">${moonIcon("crescent", 28)}</span><div><h2>便りは、あなたのもとへ。</h2><p>小箱が開きました。少し、この余韻を楽しんでいこう。</p></div></section>
        </div>
        <div id="experience-feedback" class="exp-feedback" role="status" aria-live="polite" hidden><p id="experience-feedback-text"></p><button type="button" id="experience-refresh" class="exp-secondary" hidden>状態を確認する</button></div>
      </section>
      <aside class="exp-companion" aria-label="一緒に考えるしずく">
      <div id="experience-avatar-slot"></div>
      <section id="experience-conversation" class="exp-conversation" aria-label="この体験の相談" hidden>
        <div class="exp-reply-heading"><h2>しずく</h2><span id="experience-narration-source" class="exp-fine">物語の言葉</span><button type="button" id="experience-speech" class="exp-text-button" hidden>もう一度聞く</button></div>
        <p id="experience-reply" class="exp-reply" aria-live="polite"></p>
        <div class="exp-statuses"><span id="experience-speech-status"></span><span id="experience-voice-status"></span></div>
        <form id="experience-form"><label for="experience-input">しずくに短く相談する</label><div class="exp-input-row"><textarea id="experience-input" rows="2" maxlength="500" placeholder="「手紙には何と書いてある？」" aria-describedby="experience-provider"></textarea><div class="exp-input-actions"><button type="button" id="experience-microphone" class="exp-secondary" aria-label="音声で相談を入力する">マイク</button><button type="submit" id="experience-send" class="exp-primary">相談する</button><button type="button" id="experience-stop" class="exp-secondary" hidden>停止</button></div></div></form>
        <p id="experience-provider" class="exp-fine"></p>
        <details class="exp-history"><summary>ここまでのやりとり <span id="experience-history-count"></span></summary><ol id="experience-history"></ol></details>
      </section>
      </aside>
    </div>
    <dialog id="experience-restart-dialog" class="exp-restart-dialog" aria-labelledby="experience-restart-title"><form method="dialog"><h2 id="experience-restart-title">最初から始めますか？</h2><p>この体験の進行・やりとり・下書きを新しくします。通常の対話には影響しません。</p><div><button class="exp-secondary" value="cancel" autofocus>続ける</button><button class="exp-primary" value="restart">最初から始める</button></div></form></dialog>
  `;
}
