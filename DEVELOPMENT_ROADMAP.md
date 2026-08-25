# Development Roadmap

更新日: 2026-08-25

このRoadmapは機能数ではなく、各Vertical Sliceが「動く・復帰できる・評価できる・説明できる」状態になったかで進行を判断する。

## Product Vision

> 自然に会話でき、利用者が許可したことだけを覚え、声・表情・視線・しぐさまで一貫して反応する、ローカル優先の個人AIキャラクター。

今後の主要開発は、このVisionを構成する能力を一つずつ完成させる。同時に複数の主要機能を進めず、既定Mock、Text fallback、利用者による保存・外部送信の制御を壊さない。

## 現在のRelease目標

`v0.4 Natural Conversation`、`v0.5 Character Identity`、`v0.6 Embodied Continuity`を実装した。`月白 しずく v1.0.0`の本文・声・演技・UIを一つのProfileへ接続し、さらにSession内の感情を最大2 Turnだけ減衰して表情・視線・呼吸へ残す。Character Identityは実OpenAI 26/26・実VOICEVOX 10/10、Continuityは初回24/26のFailureを修正後26/26で確認した。次は独自VRMとのVisual統合、または実利用者による会話・聴取評価を独立Sliceとして進める。

### Public Portfolio Gate

- [x] ProductのProblem、対象利用者、価値、非対象を説明する。
- [x] READMEをDemoと最短起動から読める構成にする。
- [x] 公開可能なScreenshotと3分/1分Demo手順を用意する。
- [x] RepositoryにMIT License、Security Policy、第三者Noticeを追加する。
- [x] Frontend/Backend/Browser smokeのCI定義を追加する。
- [x] Local VRM、`.env`、SQLite、Runtime Log、Build生成物をGit除外する。
- [x] Worktreeと既存Git履歴のSecret patternを確認する。
- [x] npm/pipの既知脆弱性を監査する。
- [x] Cleanな一時環境でSetup、Test、Buildを再現する。
- [x] 変更差分をReviewし、明示承認後にStage/Commit/Pushする。
- [x] GitHubの説明、Topics、Visibilityを最終確認する。

このPublic Portfolio Gateはv0.2公開時に完了した。v0.3 Adaptive InteractionはPR #2でCI通過後に`main`へ統合済み。以後のSliceもFeature Branch、Local検証、CI、Reviewの順で統合する。

Public化と、動作中BackendをInternetへ公開することは別である。現在のBackendは`127.0.0.1`専用で、公開Serviceに必要な認証、Rate Limit、TLS、利用者分離を持たない。

## 完了したVertical Slice

### VRM foundation

- VRM 1.0中心の読込、Placeholder、Drag & Drop
- 表情、姿勢、視線、瞬き、呼吸、待機Arm補正
- Model差異の警告とFallback
- Manual state、Expression、Camera、Diagnostics

### Text dialogue

- FastAPI、Mock/OpenAI Provider境界
- BackendだけでSecretを読み、Frontendで応答を再検証
- Timeout、Request ID、安全なPublic Error
- `thinking -> response emotion -> emotional baseline | idle`の状態遷移

### Voice output and Lip Sync

- Local VOICEVOX Health/Synthesis
- 自動再生、生成/再生Stop、Replay、Textを残すFallback
- WAV Envelopeと5母音Timing
- 句境界へ寄せた途中Gesture、停止時Cue破棄、余韻

### Push-to-Talk

- 利用者操作後だけPermission要求
- マイク選択、切断時Default fallback
- 発話後約1秒の無音停止、5秒無発話のUpload回避
- 最大15秒/4MiB、Cancel、認識TextのDraft確認

### Conversation Memory

- Session別直近10往復、32 Session上限、Reset/分離
- 古いTurnの決定的要約
- 明示登録だけのSQLite長期記憶とCRUD
- 外部Embeddingなしの文字重なり検索

### Adaptive Performance

- 感情6種、Gesture 4種、Voice Style 5種、強度、Cue最大2件
- Mock Rule/OpenAI Structured Output境界
- 弱30%/中60%/強90%とReduced Motion比較
- 固定10文とFailure Case評価

### Adaptive Interaction

- 返答量を「短く・自然・詳しく・やさしく」の4種類から明示選択
- PydanticとTypeScriptで同じEnumを検証し、不明な値を拒否
- Mockでは無料・決定的に差を再現し、OpenAIでは固定Instructionへ変換
- 能力・感情を自動推定せず、選択はFrontendのSession内だけで保持
- API/Provider/Controller/Browser testと固定入力評価

### Natural Conversation — Generation Cancel

- 生成中だけ送信Buttonを`応答を停止`へ切り替える、Controlを増やさないUI
- Session別Active Taskと、停止受付/保存開始を分ける排他境界
- 停止TurnのAssistant本文、Session履歴、明示長期記憶を追加しない契約
- 停止成功時の音声・口形・Gesture Resetと`idle`復帰
- Backend、Controller、Client、Browserを通した決定的な停止評価

### Natural Conversation — Real Provider Evaluation

- 明示環境変数Gateと5 Request上限を持つ、実API専用評価Script
- 公開可能な架空4 Turnだけで、文脈再現、不確実性、返答Style、PerformancePlanを確認
- API使用量を`ProviderUsage`へ正規化し、Latencyと料金Snapshotから費用を算出
- `gpt-5.6-luna`で4/4完了、固定品質Check 21/21、Latency中央値3,496ms
- 既知の完了Request費用上限$0.001601と、停止Requestの費用不明を分けて記録

### Natural Conversation — Reply-only Streaming

- `POST /api/dialogue/stream`の`start -> text_delta* -> complete | error` NDJSON契約
- OpenAI Structured JSONから、Split Escapeを考慮して`reply`だけをDecodeし、Raw JSONを非表示
- 仮Assistant Messageは停止・失敗で破棄し、最終Pydantic検証後だけ履歴・長期記憶・演技・音声へCommit
- Browserで初文・本文完了・発話開始を別々に計測
- 実OpenAIで42 Delta、初文3,321ms、本文完了4,117ms、先行表示796ms、完了費用$0.0003424
- 実Streamingの100ms CancelはLocalで0ms終了。上流計算と請求の停止は保証しない

### Natural Conversation — Closed-sentence Speech Queue

- 未完語句を読ませず、`。！？!?`・改行で閉じた文だけを先行VOICEVOX合成
- 合成Queueと再生Queueを分離し、再生中に次文を合成しながら順序を維持
- 停止・失敗時にActive synthesis、未再生文、Audio、Lip Sync、Replay Dataを一括破棄
- 最終本文との不一致をBackend/Frontendで拒否し、MemoryとPerformanceは最終検証後だけCommit
- 実OpenAI 1件 + 実VOICEVOXでWAV準備6,142ms、従来比較9,019ms、先行2,877ms
- 先行音声は取消不能、最終Plan前の最初の文は中立速度というRiskを明示

### Embodied Continuity

- Session別RAM感情を最大2 Turnだけ減衰して保持し、通常会話やSQLite長期記憶とは分離
- 利用者が「疲れた」「嬉しい」など現在状態を明示した場合は、古い感情より決定的に優先
- 同じ低強度Gestureの反復を抑え、感情から6種の微小視線Behaviorと呼吸・揺れScaleを解決
- 発話後を一律`idle`にせず、非中立時は弱めた表情・視線・呼吸のBaselineへ戻す
- 実OpenAI固定3 Turnで初回24/26のFailureを検出し、補正後26/26。2 Run累計既知費用$0.00172914

## 現在のEvidence

| 対象 | 自動確認 | 実動作確認 | 残るGap |
| --- | --- | --- | --- |
| Frontend | Type/lint/build、Vitest 83件、Playwright 7件（Profile検証・Mock一往復・Text/Speech Streaming・返答スタイル・生成停止・2 Turn感情・段階的開示・Mobile） | Desktop/390px/319px、実VRM、Mock二往復 | Bundle分割、動的UIの追加分割 |
| Backend | Ruff、Pytest 75件、pip check | Mock/VOICEVOX Health、実OpenAI固定4 Turn・Text/Speech/Character Identity/Continuity | 多様な実会話、複数回の分散 |
| Voice output | API/WAV/Stop/Timing/文分割/順序/失敗Test | 実VOICEVOX 10/10、実Pipeline 1件 | Engine処理の途中Cancel、利用者評価 |
| Voice input | Permission/無音/Cancel/マイクTest | 実マイク短文1件 | Noiseを含む固定10文 |
| Performance | Schema/Cue/Reduced Motion Test | 固定10文10/10、実VRM | 皮肉・未知言い換え |
| Interaction | 4種のSchema/API/UI伝播、不明値拒否、OpenAI Instruction Test | Mock 4種、実OpenAI固定4 Turn 21/21 | 多様な文章品質、利用者評価 |
| Generation cancel | Active Stream Task、仮Text破棄、停止/保存境界、非保存、UI復帰をAPI/Unit/Browserで確認 | Mock API、実Streamingは100ms後Cancelから0msで終了 | 上流計算/請求の停止保証 |
| Streaming | Split JSON/Unicode/外側空白、NDJSON、仮Message、文単位Speech Queue、最終CommitをProvider/API/Client/Controller/Browserで確認 | 実OpenAI 42 Delta、先行表示796ms、Speech準備2,877ms前倒し | 複数回分散、可聴Latency、利用者評価 |
| Character Identity | Profile Schema/Version、Instruction境界、演技意味整合、VOICEVOX prosody、UI反映 | 実OpenAI 4/4・26/26、Profile音声10/10 | 独自VRM、聴取評価 |
| Embodied Continuity | Session分離、2 Turn減衰、明示変化優先、Gesture反復抑制、視線周期、Reduced MotionをAPI/Unit/Browserで確認 | 実OpenAI初回24/26、修正後26/26 | 日本語限定Marker、皮肉・曖昧表現、主観評価 |
| Memory | Session/Persistence/Search Test | CRUD UI | 言い換え検索の定量評価 |
| Security | Local pattern scan、Gitleaks CI、npm/pip audit 0件 | Loopback bind/ignored data、Public RepositoryのSecret scanning確認 | 新しい依存・Data追加時の継続監査 |

詳細は[docs/evaluations](docs/evaluations/)を参照する。固定Scenarioの成功を一般化性能として主張しない。

## Visionに向けた優先順位

### P1 — v0.4 Natural Conversation

最初の主要Sliceは、実Providerを任意で使った自然な複数Turn会話とする。実API Request、費用発生、外部送信は所有者の明示承認後だけ行う。

- [x] Character Profile、会話履歴、明示記憶、返答スタイルを一つのContext契約へ整理する。
- [x] 生成Cancel、発話・Cue・口形の一括停止を設計・実装する。
- [x] Text Streamingを、Raw Structured JSONを見せないreply-only契約で実装する。
- [x] 閉じた文だけを先行合成し、順序、停止、最終本文一致を持つSpeech Queueを実装する。
- [x] 最初のText、本文完了、音声開始までのLatencyをBrowserで分けて計測する。
- [x] 固定した代表会話で、文脈保持、冗長さ、不確実性、Character表現を評価する。一般化と利用者評価は別課題とする。
- 既定MockとText fallbackを維持し、実Providerが使えなくても起動とDemoを継続できるようにする。

完了条件:

- [x] 実Providerで複数Turnの代表Scenarioを再現し、結果と費用を記録する。
- [x] 利用者が生成をCancelでき、停止したTurnを保存せず、音声・口形・Gestureが残らない。
- [x] 外部送信対象をUIとREADMEから確認できる。
- [x] Mock、Provider failure、VOICEVOX failureの各Fallbackが通る。

### P2 — v0.5–v0.6 Character Identity and Embodied Consistency

- [ ] 自作または公開条件を満たす改変Avatarを用意し、和風StageとVisual identityを統一する。
- [x] Character Profileに口調、価値観、避ける表現、Theme、Voice設定をVersion付きで定義する。
- [x] ProfileをMock/OpenAI本文、VOICEVOX prosody、演技上限、UIへ接続する。
- [x] Turnをまたぐ感情の余韻、視線、頷き、Gestureの頻度とBlendを調整する。
- [x] 本文、Voice Style、表情、Gestureが矛盾しない固定Scenarioを評価する。
- [x] Reduced MotionとModel差異のFallbackを維持する。

基盤SliceのEvidence:

- 実OpenAI `gpt-5.6-luna` 4/4 Scenario、26/26固定Check、既知費用$0.00120408。
- 実VOICEVOX 0.25.2でProfile prosodyを適用し、固定10文10/10。
- Embodied Continuityは実OpenAI初回24/26で「明示的な回復を穏やかに保ちすぎる」Failureを検出し、補正後26/26。2 Run累計既知費用$0.00172914。
- ProfileはCode定義1種類。独自VRMと聴取比較は完了条件に未到達。

### P3 — v0.7 Trusted Memory

- 長期記憶は明示追加または会話中の確認承認だけに限定する。
- 意味検索を導入する場合も、参照した記憶と理由を利用者へ示す。
- 矛盾、期限、編集履歴、Export/Import、全削除を扱う。
- 通常会話の自動永続化と、同意のない大規模User Profileは行わない。

### P4 — Productization and Performance

1. 実マイク固定10文を静音/生活雑音で比較し、意味保持率、再試行、Latencyを記録する。
2. 初回Setup、依存診断、Engine状態、復帰手順を一つの起動体験へまとめる。
3. Three.js/VRMをDynamic importし、約870kBのproduction bundleを分割する。
4. 主要画面を追加する場合だけ、残る`UIController` Event調整を領域別に分割する。
5. Windows以外の起動導線が必要になった場合だけ、Cross-platform scriptまたはPackagingを選ぶ。

### P5 — Bounded AgentまたはVisionは具体的価値がある場合だけ

Bounded Agentは、固定処理だけでは解けない「公開Knowledgeを検索し、根拠を示す」Scenarioを用意できた場合に進む。

- 1 Agent、Tool最大2つとし、許可Actionを`ANSWER / ASK_CLARIFICATION / SEARCH / SHOW_SOURCE / REFUSE`へ限定する。最大実行回数、Timeout、Cancelも固定する。
- Chain of Thoughtを保存せず、Action、Tool、Latency、成否、Source IDだけを記録する。
- 外部ActionはPreviewと利用者確認を必須にする。

完了条件:

- 許可Action以外を実行しない。
- Toolの無限呼出がない。
- 検索不要、聞き返し、根拠不足の拒否を固定Scenarioで確認する。
- Agentが固定Ruleより必要だった理由を説明できる。

Visionは、画像なしでは解けない具体的なScenarioと公開可能な評価Dataを用意できた場合だけ選ぶ。機能数を増やす目的では追加しない。

## 今は行わないこと

- Multi-Agent、大量のTools、必要性のないAgent Framework
- 常時Camera、顔/声からの感情断定
- 通常会話の自動永続化、大規模User Profile
- 独自AI Modelの一からのTraining
- 必要性のないMicroservices、Kubernetes
- 認証とData境界がない状態でのCloud公開
- Test/Evaluation未完了のまま次の派手機能を重ねること

## Release判断の原則

次の機能へ進む前に、現在の主要経路について以下を満たす。

1. 代表的な成功Scenarioがある。
2. Failure時のFallbackと復帰方法がある。
3. 自動Testまたは再現可能な手動手順がある。
4. 費用、外部送信、保存Data、Licenseを説明できる。
5. READMEとArchitectureが実装と一致する。
6. Product Visionのどの要素を改善したか説明できる。
