# デモ開始前の音声認識モデル読込

2026-09-13。既存の対話/体験画面を変更せず、起動時の明示Optionだけを追加。

```powershell
.\start_demo.ps1 -PrepareVoiceInput
```

`POST /api/transcription/prepare`で、稼働中のBackendへ取得済みModelを読み込む。別Processで準備して終了する既存Download Scriptとは違い、モデルが同じBackendのRAMに残る。通常起動は従来どおり遅延読込。既に起動済みの場合もOptionを実行でき、会話・画面・記憶をリセットしない。

## 成功/失敗/費用

- Modelは`local_files_only=True`で読み、Downloadしない。音声入力や合成、LLM呼出もない。
- 同じModelが読込済みなら何もしない。準備中は認識と同じ容量制御を使い、他RequestをQueueへためない。
- 未取得・読込不能なら安全な503、処理競合なら429。起動Scriptは警告してText Demoを続け、準備のために会話を止めない。
- 新規依存・API料金なし。起動時にCPU処理が発生し、ModelをRAMへ保持するため、音声を使わない場合よりメモリを使う。未取得モデルの準備はREADMEの明示Download手順で行う。
- このOptionはModel構築の前倒し。最初の推論/VAD初期化や通常の認識時間をなくす機能ではない。通常の録音経路の初回取得動作は変更していない。

## 確認

- 新規5 tests: Cached-only、2回呼出の同一Model再利用、音声非処理、Cache失敗後の解放、準備/録音の排他、GET Healthの非読込、APIの成功/安全な503を確認。
- PowerShell構文検査成功。抽出した準備FunctionへのMock HTTPで、Optionなしの非呼出と、失敗時の警告/Text継続を確認（実Serverを故障させない）。
- 実WindowsでOption付き起動成功。音声送信前にGET Healthのmodel_loaded=true、Cache-Control=no-storeを確認。同じ起動済みアプリへOptionを再実行しても成功。
- 自作の「丸い月を真ん中に置いてみよう」（VOICEVOX合成2.24秒）を実ローカル認識APIへ1回送信。事前model_loaded=true、HTTP200、本文一致（句読点除く）、HTTP2,934ms/Backend2,923ms。マイク/外部AI/記憶保存はなし。これは初回読込込みとの制御されたA/B比較ではない。
- EdgeでVRM表示と有効なマイクButtonを確認。利用者の実マイク品質は未検証。

Backend全193 tests、Ruff、pip check成功。Frontend187 tests、型/lint/build、Browser全34 tests成功（5.0分、再試行なし）。npm audit/pip-auditも既知脆弱性なし。既存の大きなVite Bundle警告は残る。

## 既存対話のRelease smoke（上のASR計測とは別）

所有者が許可した既存OpenAI設定で、架空の一往復をEdgeから送信。「動作確認だよ。月の栞を一緒に並べられて、ちょっと嬉しい。」に短い返答が返り、UIは「うれしい・小さくうなずく」へ移った。生成済み音声の再再生で「話している/読み上げ中」を確認し、終了後に入力可能/再再生へ戻ることを確認。VRM表示も維持された。

これは実API 1件の従量課金を伴う疎通確認で、料金額の集計や会話品質の広範な評価ではない。API/Character Profileは変更していない。録音も記憶登録も行わず、口形精度や聴感の評価とは区別する。
