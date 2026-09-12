# 録音取消と即時再開の安全性

2026-09-12 / Windows。接続復帰SliceをLocal検証してCommit後、録音Resourceの所有関係を別Sliceで改善。

## 再現した問題

制御可能なFake Recorderで古いEventを遅らせたところ、変更前は取消済みのBytesが次の録音へ混ざり、古いstop/errorが次のTrackを止めた。選択Deviceの消失処理も、取消後に既定マイクを再要求できた。Device一覧の遅い結果が新しい一覧を上書きする経路もあった。新規10件中7件が修正前に失敗した。

無音判定では停止後の古いAnimation Frameが通知/再予約でき、初期化途中の例外でAudioContextが解放されなかった。追加4件とも修正前に失敗した。実マイクの盗聴や実際の録音混入を観測したという意味ではなく、Fakeを使った決定的な競合条件の再現である。

## 対策

- 操作番号とRecorderそのものが現役かを、data/stop/errorの最初に検証する。
- 終了処理は所有Resourceを切り離し、Callback解除、Recorder停止、Track停止を行う。無音と取消はUploadしない。
- Permission応答が遅れても、取消後はTrackだけ解放し、既定マイクへの再要求をしない。
- Device一覧の世代番号、AudioContextの同一性を使い、古い通知を無視する。
- AudioContext初期化途中で失敗しても閉じ、手動録音のFallbackを維持する。

## 確認

- Frontend 186 tests、型/lint/build成功。新規14件は旧Event、遅い許可/拒否、Device順序逆転、認識応答取消、無音、AudioContextの解放と再予約防止を含む。
- Backend 176 tests、Ruff、pip check成功（このSliceにBackend変更なし）。
- Browserの新規テストでは実Permissionを使わず、明示操作でFake Recorderを開始する。取消で両タブの下書きが残り、旧Event注入後も新録音だけを送ること、自動対話送信がないことを確認する。
- 初回Browser Runの1件は「認識結果を下書きに追記する」というTest側の誤った期待で失敗。既存仕様は認識成功時にDraftを置換するため、Testを修正。取消時の保持と成功時の置換を区別する。
- 最終Browser 32件成功（3.1分、再試行なし）。新規2件も成功し、両タブの20回の開始/取消で毎回Active Trackが0へ戻り、Uploadは0件。旧Event後の録り直しでは新しいFake Bytesだけ1回送られ、自動会話送信は0件。

新規依存・外部API呼出・実録音・公開Asset追加なし。Fakeでの反復は長時間の実マイク品質・CPU/メモリ安定性の証明ではない。音声認識モデルの推論速度は変更していない。
