# 音声入力の接続復帰

2026-09-12 / Windows。新規依存、モデル取得、API課金、実マイク録音はなし。

## 対象と成功条件

起動時の音声入力Health確認が失敗しても、ページ再読込や会話・謎解きのリセットなしに復帰する。再接続はマイクを開かず、録音データを再送しない。非対応ブラウザには操作できない再接続を提示しない。

以前のEdgeでの「不正な音声入力情報」は初回レスポンスを捕捉しておらず、原因未確定。この変更を、その一回の障害の原因を完全に特定したものとは扱わない。

## 実装と判断

- Health GETのみ、350ms後に一度だけ再試行。通信/形式/5xxが対象で4xxは対象外。各回5秒Timeout。無限Retryや定期Pollingはしない。
- BrowserのfetchとBackendのHealthヘッダーでキャッシュを抑止する。録音POSTは自動再試行しない。
- 失敗時は既存マイクButtonを再接続へ変更。正常復帰後、もう一度利用者が押したときだけ録音する。
- 接続未完了/失敗時にマイク設定を変えても録音可能にならない。重複初期化と破棄後のHealth/Device情報反映を防ぐ。
- 本文読取TimeoutがJSON不正に化けるケースはFake Responseで再現できた。修正前に失敗するTestを確認し、Abort/Timeoutを優先判定するよう修正した。

## 確認結果

- Backend 176 tests、Ruff、pip check成功。Healthの`Cache-Control: no-store`をTest。
- Frontend 172 tests、型/lint/build成功。うち新規12 testsでRetry回数、4xx/POSTの非Retry、取消後の非送信、Timeout分類、Timer解放、設定による回避の防止、破棄後の通知抑止を確認。
- Browser 30 tests成功（2.8分、再試行なし）。新規3件は一時的不正HTML、継続不正Schema、継続503を注入。両タブの下書き、調査履歴、再接続時のマイク非起動、Keyboard操作と320px幅を確認。
- 320pxの失敗画面を画像でも確認。再接続は既存操作の場所に収まり、Text入力を妨げない。画像はignored test-resultsのみ。
- 既存EdgeアプリでVRMと正常な音声入力Buttonを確認。実マイクには触れない。
- npm audit / pip-audit（開発依存を含む）: 既知脆弱性なし。履歴Secret scanはReleaseのCIで別途確認する。

## 限界

本Sliceは接続復帰であり、認識速度や認識精度の改善ではない。実録音、長時間運転、初回の一過性障害そのものの確定的再現は未実施。既存の大きなVite bundle警告（約931kB / gzip約236kB）は別課題として残す。
