# 認識処理を順番待ちにためない

2026-09-13 / Windows。接続復帰・録音Lifecycleを順に検証後、faster-whisperの受付制御を改善。

## 再現と判断

従来はWorkerがModel/推論Lockの空きを待った。BrowserでHTTPの待機を取り消しても、`asyncio.to_thread`の実Workerは途中で停止するとは限らず、次の録音が後ろへ並ぶ。Fake Modelで読込中/Decode中/遅延Segment列挙中とHTTP Task取消後を固定し、新規7件中4件が変更前にTimeoutで失敗した。

同時に複数の音声を処理する用途ではないため、既存Lockの取得を非待機へ変えた。Model準備から推論完了まで同時1件・待機0件。追加分には429 `transcription_busy`を返す。LockをAsync側で持たないので、HTTP取消だけで空いたことにしない。新しいFramework、Job Queue、依存、モデル、課金は増やさない。

## 利用者の操作

両タブの既存状態表示に「前の音声を処理中です。少し待って録り直してください。」を出す。Draftを消さず、Textは引き続き利用できる。録音の再送・自動再録音・自動会話送信はない。残り処理時間を確定できないため、不正確なCountdownは出さない。

## 検証

- Backend 183 tests、Ruff、pip check成功。新規7件は読込/Decode/Segment全区間の即時拒否、失敗後の容量解放、HTTP Task取消後も実Worker終了まで拒否することを確認。成功後の次の認識とHealth応答も確認。
- Frontend 187 tests、型/lint/build成功。機械可読なCodeでUI理由を選び、Backend文章の文字列一致には依存しない。
- 対象Browser 4件成功。新規2件は両タブで429を注入し、Draft保持、Text継続、Track解放、自動再送なし、明示再録音による成功を確認。直前Sliceの全32件Runとは区別し、Releaseでは全34件を再確認する。
- Fakeの音声/Providerだけを使い、実マイク、既存録音、モデルDownload、外部AI呼出はなし。

## 限界

一回の認識を高速化したわけではなく、取消済み計算の強制終了でもない。処理中に録り直すと再録音が必要になるトレードオフがある。端末内・単一利用者・Provider一つの容量管理であり、Internet公開のRate Limit、アップロード受付全体の防御、複数Process間の制御を提供しない。
