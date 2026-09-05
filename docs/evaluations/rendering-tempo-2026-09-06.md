# 描画環境と会話テンポ — 2026-09-06

後続確認: [同日の実API対話3件](real-api-tempo-2026-09-06.md)はText・演技データで成功。実API用Backendは起動できたが、音声エンジン起動が実行環境に拒否されたため、最新UIでの実API + 音声の全体測定はまだ残る。以下は先行したMock + GPU確認時点の記録。

## 今回の結論

前回の「音声開始まで約7〜12秒」という数値には、自動テストのブラウザがCPUで3Dを描いていた影響が大きく含まれていた。同じPCでGPUを使うブラウザに切り替えると、実VRMと実VOICEVOXを動かしたMock対話3件の音声開始は **940 / 1,787 / 2,629 ms** の範囲になった。

これは**アプリ自体を数倍高速化した結果ではなく、測定環境を修正した結果**。Mockは定型文なので、外部LLMの生成待ち時間や返答品質は評価していない。自然な会話・3〜5分デモの完成判定もまだ行わない。

## なぜ測り方を変えたか

Playwrightには、専用のheadless shellと通常ブラウザに近いnew headless modeがある。[公式の説明](https://playwright.dev/docs/browsers#chromium-new-headless-mode)に従い、テンポ評価だけを`chromium.launch({channel: "chromium"})`へ変更した。実際に使われた描画装置もJSONへ残す。

このPCで確認した描画装置:

| 起動方法 | WebGL rendererの主要部分 |
| --- | --- |
| `chromium.launch()` | ANGLE / Vulkan / SwiftShader Device (Subzero): CPU描画 |
| `chromium.launch({channel: "chromium"})` | ANGLE / NVIDIA GeForce GTX 1650 / Direct3D11: GPU描画 |

ブラウザの起動方法だけで、すべてのPCでGPUが有効になる保証はない。結果の`renderer`がSwiftShaderやunknownの場合、GPU実測とは扱わない。ユーザーのChrome設定やGPUドライバーは変更していない。

通常の`npm run test:e2e`は、GPUのないCIでも操作を確認するテストとして既存のsoftware-rendering設定を維持した。**操作できるかの検査と、実機の待ち時間の測定を分ける**設計である。新しい依存関係・有料サービス・インストールは追加していない。

## 同じ短文による切り分け

Windows、Intel Core i7-10870H、VOICEVOX 0.25.2、話者14。自作の固定文「少し休もうか。」を使い、音声モデルのwarm-up後、通常描画・描画停止・解像度半分の順と逆順で測った。評価中に他のテスト一式は走らせていない。

| 環境 | 通常描画のWAV準備時間・2回 | 描画を止めたWAV準備時間・2回 |
| --- | --- | --- |
| headless shell / CPU | 4,165 / 4,920 ms | 694 / 661 ms |
| new headless / GPU | 743 / 715 ms | 747 / 672 ms |

GPU条件では描画を止めても大きな短縮は見られなかった。CPU条件での半解像度・影なし・軽量設定は十分な改善にならず、VOICEVOXの`--cpu_num_threads 4`も安定した改善を示さなかった。そのため、**画質・影・アニメーション・音声設定は変更しない**。一時起動した4-threadの音声エンジンは停止し、通常の引数に戻してGPU評価した。

この診断は音声APIへ直接送った固定文の準備時間であり、LLM・会話キュー・Lip Syncの全体評価ではない。ブラウザ内だけのsource instrumentationで描画を切り替え、本番コードへ診断用の画質切替は入れない。GPUの最終診断ではFPS上限を設けず、全描画ループで通常のrenderを呼んだ。

初期の診断には変数名衝突で描画フレームを取得できなかった失敗があった。例外または0フレームの計測を失敗扱いに修正し、その出力は採用していない。途中のFPS上限付きGPU試行も上表には使っていない。各条件2回だけの小標本で、温度や負荷の分散を含む一般的な性能保証ではない。

## アプリ全体のGPUブラウザ確認

3件とも新しいページ、1440×900、実VRM読込完了後に固定入力を送信。GPU以外の画質・話者・文章分割・再生処理は変更していない。音声エンジン再起動後に順番に実行したため、初回の準備コストは均一ではない。

| 固定ケース | 最初の文字 | ブラウザの音声開始 | 文単位の音声数 |
| --- | ---: | ---: | ---: |
| 自己紹介 | 24 ms | 2,629 ms | 3 |
| 疲れた場面 | 15 ms | 1,787 ms | 4 |
| 初心者向け説明 | 18 ms | 940 ms | 4 |

- 3/3件で実VRMを読込、11/11音声を再生完了、ページ例外0件、全件NVIDIA renderer。
- 8か所の文間は、前の`ended`から次の`play()`完了まで14〜46 ms。実際の音声に含まれる無音やスピーカーの遅延は含まない。
- 発話指標は`audio.play()`のPromise完了であり、人間が聞いた最初の音ではない。
- 今回の外部AIリクエストは0件。録音・音声ファイル・実際の個人会話は保存していない。
- 前回、実API評価用の起動が実行環境に拒否された件は未解決。迂回実行はしていない。

## 実装した不具合修正

従来のFPS表示は、アニメーション暴走を防ぐため最大50 msに丸めた時間を使っていた。このため実際の描画ループが2 FPSでも、表示上は約20 FPSになる問題があった。

`FrameRateMeter`へ計測を分離し、`requestAnimationFrame`の実時間で計算するよう修正。タブの表示切替時は計測をリセットして、非表示だった時間を混ぜない。アニメーションの50 ms制限は残し、動作・画質は変えない。このFPSは描画ループの頻度であり、モニターに提示されたフレーム数そのものではない。

追加単体テスト4件: 低FPS、60 FPS、タブ再表示、無効・重複・逆行時刻。Frontend全87件・型検査・ESLint・Build、Backend全81件・Ruff・pip check、既存ブラウザ操作13件を通過。ブラウザ操作テスト内の`voicevox_unreachable`は、音声を意図的に利用不可にしたFallback確認であり、実音声測定の失敗ではない。既存の大きなJS bundle警告（約885 kB / gzip 224 kB）は残る。

## 再現手順

[前回の専用Mock Backend / Frontend起動手順](conversation-tempo-2026-09-05.md#repeatable-browser-harness)で、VOICEVOXとポート18001/15174を起動する。通常デモとは分離し、記憶はRAMのみ。出力先の`backend/.runtime`はGit除外済み。

```powershell
cd frontend
# 実利用に近い描画条件で、定型対話 + 実VRM + 実音声を3件確認
node scripts/evaluate-conversation-tempo.mjs ../backend/.runtime/tempo-gpu.json --mock

# 固定短文だけで描画負荷を比較: warm-up 1件 + 3条件を2回
node scripts/evaluate-render-contention.mjs ../backend/.runtime/render-gpu.json

# 旧ブラウザ条件の比較。CPU描画になるかはrendererも確認する
node scripts/evaluate-render-contention.mjs ../backend/.runtime/render-shell.json --headless-shell
```

`--profiles`は解像度・影・描画頻度を変える診断専用。通常UIの機能ではない。全ブラウザ評価を同時に走らせず、終了後は自分が起動したサーバーだけ停止する。別PCでブラウザが不足する場合は、既存開発依存の`npx playwright install chromium`で両モードを導入できる（無料、ダウンロード容量が必要）。

ローカルの生データは`conversation-tempo-gpu-before-fps.json`、`render-contention-valid.json`、`render-contention-gpu-uncapped.json`（すべて`backend/.runtime/`）にあり、Gitには追加しない。最初の対話3件はFPS修正前、最終描画診断はFPS修正後。描画品質・会話処理は共通であり、FPS修正の高速化効果を示す比較ではない。

## 次の完成条件

実LLMを含む少数ターンの再測定、実マイク・スピーカーでの聴取、3〜5分の連続操作が残る。「自然に話せる」と判断する前に、聞き心地、途中停止、表情の違和感、待ち時間を本人と確認する。Visionや新しいAgent機能へはまだ広げない。

Notion反映案: 「テンポ評価のCPU描画要因を切り分け、GPU + 実VRM + 実音声のMock 3件を確認。FPS計測不具合を修正。実LLM・実マイクと3〜5分の体験評価は継続中」。Notion自体は未更新。

Git: 今回commit・push・公開設定の変更は行っていない。既存の未commit変更は保持。`git diff --check`を通過し、生計測・VRM・Build生成物のGit除外を確認した。起動した評価Backend、Frontend、VOICEVOXは停止し、関連するデモ・テスト用ポートが空いていることを確認した。
