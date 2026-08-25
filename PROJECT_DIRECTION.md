# Project Direction

更新日: 2026-08-25

Adaptive Character Labは、Text/Voice対話の結果を、利用者が理解できる状態表示、音声、表情、口形、しぐさへつなぐローカル優先のVRM対話Applicationである。

大学院研究とは分離した個人開発・技術学習・就職活動用Portfolioとして、公開可能な入力、自己作成Data、または架空Dataだけを扱う。

## North Star

> 自然に会話でき、利用者が許可したことだけを覚え、声・表情・視線・しぐさまで一貫して反応する、ローカル優先の個人AIキャラクター。

このVisionを、機能選定、Architecture、UX、評価の共通判断軸とする。「自然な会話」「許可された記憶」「身体表現の一貫性」「ローカル優先と利用者制御」のどれも改善しない機能は、原則として追加しない。

AI機能の数ではなく、利用者が操作とDataを制御でき、失敗から復帰でき、効果と限界を評価できる一つの体験として完成させる。

新機能は、次の5点を説明できる場合だけ追加する。

1. Visionのどの要素を改善するか。
2. 利用者の何が良くなるか。
3. より単純な方法ではなぜ不足するか。
4. 成功とFailureをどのScenarioで評価するか。
5. 費用、外部送信、保存Data、利用者の取消手段を説明できるか。

## Product仮説

| 項目 | 仮説 |
| --- | --- |
| 対象利用者 | Windows PCで技術学習、相談、考えの整理を行う日本語話者。最初は開発者本人 |
| 利用環境 | 単一PCのLocal利用と、3〜5分の対面Demo |
| 困りごと | 会話が機械的に途切れること、声と表情・しぐさが噛み合わないこと、音声認識の誤送信、保存・外部送信範囲が曖昧なこと |
| 提供価値 | Text/Voiceで自然に対話し、許可した内容だけを覚え、発話内容と一貫した身体表現で返し、保存と外部送信を自分で管理できる |
| Data | 公開可能な資料、自己作成Data、架空Dataのみ。通常会話はRAM、明示記憶だけSQLite |

Avatarが学習効果を必ず高める、Voiceが常に使いやすい、とは主張しない。操作時間、認識成功率、再試行、待ち時間、状態理解をScenarioごとに確認する。

## 現在のApplication

> TextまたはPush-to-Talkで話しかけると、Local Backendが応答し、VOICEVOX音声とVRMの表情・5母音口形・制限付きしぐさで返す個人用AI Character基盤。

| 領域 | 現在地 | 根拠 |
| --- | --- | --- |
| VRM | 表示、Placeholder、状態・表情・姿勢・視線、Reduced Motion | Browser実モデル確認、Frontend Test |
| Text dialogue | Mock/OpenAI境界、reply-only Streaming、明示返答スタイル4種、入力/応答検証、生成中の停止、Token使用量、Timeout、Request ID | API/Controller/Browser Test、停止時非保存Test、実OpenAI固定4 Turn 4/4・Streaming 42 Delta |
| Voice output | VOICEVOX、閉じた文の先行合成、順序Queue、停止、再再生、Fallback | 実Engine固定10件、実OpenAI+VOICEVOX 1件、Browser確認 |
| Lip Sync | 実WAVへScaleした5母音と句境界Cue | Timing固定10件、実VRM確認 |
| Voice input | Push-to-Talk、マイク選択、自動停止、Draft確認 | 自動Testと実マイク1件。Noise評価は未完了 |
| Memory | Session 10往復、決定的要約、明示SQLite、CRUD、Local検索 | Session分離/Persistence Test |
| Adaptive Performance | 制限付き感情・Gesture・強度・Cue・Voice Style | 固定10文、Failure Case、実VRM比較 |
| Portfolio quality | README、Screenshot、License、CI、Security/Notice、Demo Guide | Public RepositoryとCIで確認 |

Toolを実行するBounded Agent、RAG、Visionは未実装であり、現在の成果として主張しない。

## 設計判断

### vanilla TypeScriptを継続

単一画面ではReact導入の効果より、Dependencyと抽象化の増加が大きいと判断した。Dialogue、Speech、Transcription、VRMをController/Client単位に分け、Frameworkなしでも境界を保つ。

弱点は`UIController`が大きくなったこと。新しい主要画面を追加する前に、表示領域別のComponent/Presenterへ分割する余地がある。

### Mockを既定にする

初回起動、Test、Demo練習を料金・API Key・Networkから切り離せる。OpenAI Providerは交換可能な境界として残し、明示設定時だけ外部送信する。

### Local Voiceを先に選ぶ

VOICEVOXとfaster-whisperにより、音声の外部送信とAPI利用料を避ける。代わりにLocal Engineの起動、約464MiBの認識Model、CPU遅延という負担がある。

### 自由なAnimation命令を受け付けない

返答に合わせた演技は、許可したEnum、Clampした強度、最大2件のCueだけを受け付ける。AIから任意Bone操作やScriptを実行しない。

### Memoryを明示保存に限定

通常会話を勝手にProfile化しない。長期記憶は利用者が追加した内容だけをSQLiteへ保存し、確認と削除を提供する。文字重なり検索は無料・Localだが、Semanticな言い換えに弱い。

### 返答スタイルを推測しない

利用者が「短く・自然・詳しく・やさしく」を明示選択し、BackendまでSchemaで伝える。声・表情・文章から能力や感情を推定せず、選択を長期保存しない。Mockは差を決定的に再現し、OpenAI利用時も同じ4種類を固定Instructionへ変換する。

### 停止をFrontendだけの見せかけにしない

生成中の停止はBrowser側の表示を消すだけで終わらせず、Session別のBackend Provider Taskへ伝える。停止受付と保存開始の境界を排他制御し、受付済みTurnは通常履歴にも明示長期記憶にも追加しない。既に保存開始へ入った場合は停止不成立として示し、取消できたように見せない。

### Structured OutputをそのままStreamingしない

本文と演技Planを一つのSchemaで生成しつつ、途中表示ではRaw JSONを利用者へ見せない。Backendが`reply`文字列の安全にDecodeできた部分だけをNDJSON Deltaへ変換し、`PerformancePlan`とMemoryは最終Pydantic検証と保存開始境界を通過した後だけ確定する。途中Textと先行音声Queueは仮状態であり、停止・失敗時に破棄する。

### 未完の語句を読み上げない

Text表示より取消しにくい音声は、Token単位ではVOICEVOXへ渡さない。句点・疑問符・感嘆符・改行で閉じた文だけを先行合成し、合成順と再生順を別Queueで固定する。最終本文と一致しない場合、停止、Provider失敗では未再生音声とLip Syncを破棄する。一方、既に聞こえた文は取り消せないため、Memoryと演技Planを早期Commitしたとは扱わず、制約として明示する。

## 完成条件

### Local Application

- READMEだけでCleanなWindows環境から起動できる。
- MockでText対話を無料・外部AI送信なしで再現できる。
- 実Provider利用時に、複数Turnの会話、Streaming初文、本文完了、発話準備、停止到達時間、費用・送信範囲を評価できる。架空Dataによる実OpenAI固定4 Turn、Text Streaming 1件、Speech Streaming 1件は完了したが、多様な会話、複数回の分散、利用者が感じる自然さは未評価である。停止ProbeはLocal coroutineの終了だけを確認し、上流計算や請求の停止を保証しない。
- 長期記憶は利用者が明示許可した内容だけとし、参照理由の確認、編集、削除、全削除ができる。
- 一つのTurnで本文、声、表情、視線、しぐさが矛盾せず、停止・割り込み時に一緒にResetできる。
- VRM、VOICEVOX、Microphoneのどれかが失敗しても、利用可能な経路を残す。
- Session、保存Data、外部送信先を利用者が理解し、Reset/Deleteできる。
- 3〜5分Demoを重大停止なく完了できる。

### Portfolio

- Problem、対象利用者、設計理由、実装、評価、Failure、制約をREADMEから追える。
- Frontend/Backendの型、lint、Test、build、Dependency auditが通る。
- Secret、Local Data、VRM本体、Runtime Logを公開Repositoryへ含めない。
- Source Licenseと第三者Software/Assetの条件を区別する。
- Architectureと実装、READMEと実際の挙動が一致する。
- 「実装済み」と「将来構想」を明確に分ける。

## Scope Guard

現在は追加しない:

- Multi-Agent、大量のTools
- 常時Camera、顔や声からの感情断定
- 長期個人Profile、通常会話の自動永続化
- 必要性のないMicroservices、Kubernetes
- 認証・Rate Limit・TLSなしでのInternet Service化
- 評価Gateを飛ばしたRAG、Vision、Cloudの同時追加

別Repositoryを検討するのは、独立した利用者、Release周期、Security境界、大容量Data/Modelのうち2つ以上が分かれる場合に限る。技術Stackが違うだけでは分割しない。

## 費用と外部Service

- 必須Software: Node.js、Python、Browser。無料。
- 既定Demo: Mock。無料、外部AI送信なし。
- Voice: VOICEVOX/faster-whisper。無料だがLocal Resourceと各License条件が必要。
- OpenAI: 任意。明示設定したRequestだけ料金と外部送信が発生する。2026-08-25の固定4 Turnは完了Request分で$0.001601、Text Streaming 1件は$0.0003424、Speech Pipeline 1件は$0.0003892。停止RequestはToken使用量を取得できず、費用不明として除外した。`store=False`はZero Data Retentionを意味しない。
- Cloud/公開Server: 現在は不採用。認証、Data retention、費用上限を設計してから検討する。

## Portfolioで説明する中心

1. 自然な会話、許可された記憶、身体表現、ローカル優先を一つの体験へ統合するProduct Vision。
2. 失敗してもTextへ戻れるVoice × VRMのVertical Slice。
3. 任意Animationを許さない制限付きPerformancePlan。
4. 実WAV、母音、アクセント句へ同期するLip SyncとGesture。
5. 通常会話と明示長期記憶を分けたData設計。
6. Mockで再現でき、実Providerへ交換できる境界。
7. 利用者を推測せず、明示選択を型付き契約でProviderまで通すAdaptive Interaction。
8. 成功率だけでなくFailure Caseと一般化の限界を残す評価姿勢。
9. 停止受付と会話・長期記憶の保存開始を分け、取消結果を偽らないConcurrency設計。
10. 実ProviderのLatency、Token、既知費用を記録し、停止時の上流費用を推測で埋めない評価境界。
11. Structured Outputの型安全性と途中Text表示を両立し、最終検証前の演技・Memory Commitを許さないStreaming境界。
12. 取消不能な先行音声を閉じた文だけに限定し、合成・再生の順序と失敗時破棄を独立Queueで扱うConcurrency設計。

実装詳細は[ARCHITECTURE.md](ARCHITECTURE.md)、公開前後の優先順位は[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md)を参照する。
