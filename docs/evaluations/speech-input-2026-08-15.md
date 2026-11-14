# Speech input evaluation — 2026-08-15

## 対象

- Provider: faster-whisper 1.2.1
- Model: `small`
- Device / compute type: CPU / INT8
- 入力: VOICEVOX 冥鳴ひまり（ノーマル）で生成した5.621秒のWAV
- 正解文: `こんにちは。Adaptive Character Labへようこそ。今日はどんなことを話そうか？`

## 結果

| 経路 | Latency | Language | Probability | 認識文 |
| --- | ---: | --- | ---: | --- |
| Provider直接 | 6,937ms | ja | 1.0 | こんにちはアダプティブキャラクターラブへようこそ今日はどんなことを話そうか |
| `POST /api/transcription` | 6,772ms | ja | 1.0 | こんにちはアダプティブキャラクターラブへようこそ今日はどんなことを話そうか |

固有名詞はカタカナ化され、句読点は脱落したが、質問内容は保持された。モデル取得は18.2秒、ローカルキャッシュ使用量は463.7MiBだった。

## 自動検証

- Backend: Pytest 20件、Ruff成功
- Frontend: Vitest 40件、TypeScript、ESLint、production build成功
- Dependency: Runtime requirementsに対するpip-auditで既知脆弱性0件
- API: MIME、空ファイル、4MiB超過、Provider公開Error、Request IDを検証
- UI: 録音開始前はマイクを要求しない、録音停止、認識結果をDraftへ反映、Track停止、Permission拒否案内を検証
- Device選択: 音声入力だけを列挙し、選択した`deviceId`を次回の`getUserMedia()`へ指定する自動Testに成功
- Voice activity: 瞬間Noiseを発話扱いしない、継続音を発話として開始する、約1秒無音で停止する、5秒無発話をBackendへ送らない自動Testに成功
- 実ブラウザ: `small / 端末内処理`表示、マイクButtonと送信Buttonの配置、Console error 0件

## 未完了のGate

- 人の実マイク音声を静かな環境で固定10文録音する。
- 同じ10文を生活雑音ありで録音し、完全一致だけでなく意味保持と再試行回数を記録する。
- 無音、Permission拒否、録音中Cancel、認識中Cancelを実ブラウザで確認する。
- 初回と2回目以降のLatencyを分けて記録する。

TTS音声1件の成功だけで「音声入力完成」とは判断しない。現段階は縦切り実装とHTTP経路の成立までで、2B-2の品質Gateは未達である。

## 2026-08-16 追記 — 所有者の実Microphone

- 短い発話「こんにちは」を録音し、入力欄へ「こんにちは」と反映された。
- 認識文を送信し、Mock ProviderからText応答が返るところまで確認した。
- 実Microphoneの最初の縦経路は1/1成功。
- 別Microphone、固定10文、Noise、無音、Permission拒否、Cancel、Latency計測は引き続き未完了。

## 2026-08-17 追記 — 段階別Latency表示

- Browser側の往復時間を`認識`、`応答`、`音声準備`に分けて、`キャラクターを調整`内の診断情報へ直近値を表示する機能を追加した。
- Mock Providerへの画面操作で`応答 27 ms`への更新を確認した。
- VOICEVOX未起動時は`音声準備 —`のままとなり、Text対話と計測欄は継続した。
- Console warning / errorは0件。FrontendのTypeScript、ESLint、Vitest 40件、production buildに成功した。
- 実Microphoneの固定10文、Noise、初回/2回目以降の実測値はまだ未記録である。
