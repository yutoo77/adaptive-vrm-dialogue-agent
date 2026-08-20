# Project Direction

更新日: 2026-08-20

Adaptive Character Labは、Text/Voice対話の結果を、利用者が理解できる状態表示、音声、表情、口形、しぐさへつなぐローカル優先のVRM対話Applicationである。

大学院研究とは分離した個人開発・技術学習・就職活動用Portfolioとして、公開可能な入力、自己作成Data、または架空Dataだけを扱う。

## North Star

> AI機能を並べるのではなく、利用者が操作とDataを制御でき、失敗から復帰でき、効果と限界を評価できるApplicationとして完成させる。

新機能は、次の3点を説明できる場合だけ追加する。

1. 利用者の何を改善するか。
2. より単純な方法ではなぜ不足するか。
3. 成功とFailureをどのScenarioで評価するか。

## Product仮説

| 項目 | 仮説 |
| --- | --- |
| 対象利用者 | Windows PCで技術学習、相談、考えの整理を行う日本語話者。最初は開発者本人 |
| 利用環境 | 単一PCのLocal利用と、3〜5分の対面Demo |
| 困りごと | 音声認識の誤送信、AIの処理状態が分からないこと、Voice失敗で全体が止まること、保存・外部送信範囲が曖昧なこと |
| 提供価値 | Text/Voiceを選べ、処理状態をAvatarでも理解でき、失敗時はTextへ戻り、保存内容を自分で管理できる |
| Data | 公開可能な資料、自己作成Data、架空Dataのみ。通常会話はRAM、明示記憶だけSQLite |

Avatarが学習効果を必ず高める、Voiceが常に使いやすい、とは主張しない。操作時間、認識成功率、再試行、待ち時間、状態理解をScenarioごとに確認する。

## 現在のApplication

> TextまたはPush-to-Talkで話しかけると、Local Backendが応答し、VOICEVOX音声とVRMの表情・5母音口形・制限付きしぐさで返す個人用AI Character基盤。

| 領域 | 現在地 | 根拠 |
| --- | --- | --- |
| VRM | 表示、Placeholder、状態・表情・姿勢・視線、Reduced Motion | Browser実モデル確認、Frontend Test |
| Text dialogue | Mock/OpenAI境界、入力/応答検証、Timeout、Request ID | API/Controller Test、Mock Browser Demo |
| Voice output | VOICEVOX、停止、再再生、Fallback | 実Engine固定10件、Browser確認 |
| Lip Sync | 実WAVへScaleした5母音と句境界Cue | Timing固定10件、実VRM確認 |
| Voice input | Push-to-Talk、マイク選択、自動停止、Draft確認 | 自動Testと実マイク1件。Noise評価は未完了 |
| Memory | Session 10往復、決定的要約、明示SQLite、CRUD、Local検索 | Session分離/Persistence Test |
| Adaptive Performance | 制限付き感情・Gesture・強度・Cue・Voice Style | 固定10文、Failure Case、実VRM比較 |
| Portfolio quality | README、Screenshot、License、CI、Security/Notice、Demo Guide | 公開前Release Gateを検証中 |

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

## 完成条件

### Local Application

- READMEだけでCleanなWindows環境から起動できる。
- MockでText対話を無料・外部AI送信なしで再現できる。
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
- OpenAI: 任意。明示設定したRequestだけ料金と外部送信が発生する。
- Cloud/公開Server: 現在は不採用。認証、Data retention、費用上限を設計してから検討する。

## Portfolioで説明する中心

1. 失敗してもTextへ戻れるVoice × VRMのVertical Slice。
2. 任意Animationを許さない制限付きPerformancePlan。
3. 実WAV、母音、アクセント句へ同期するLip SyncとGesture。
4. 通常会話と明示長期記憶を分けたData設計。
5. Mockで再現でき、実Providerへ交換できる境界。
6. 成功率だけでなくFailure Caseと一般化の限界を残す評価姿勢。

実装詳細は[ARCHITECTURE.md](ARCHITECTURE.md)、公開前後の優先順位は[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md)を参照する。
