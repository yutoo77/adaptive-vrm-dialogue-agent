# Development Roadmap

更新日: 2026-08-25

このRoadmapは機能数ではなく、各Vertical Sliceが「動く・復帰できる・評価できる・説明できる」状態になったかで進行を判断する。

## Product Vision

> 自然に会話でき、利用者が許可したことだけを覚え、声・表情・視線・しぐさまで一貫して反応する、ローカル優先の個人AIキャラクター。

今後の主要開発は、このVisionを構成する能力を一つずつ完成させる。同時に複数の主要機能を進めず、既定Mock、Text fallback、利用者による保存・外部送信の制御を壊さない。

## 現在のRelease目標

現在の目標は、Public Portfolioとして公開済みのLocal Applicationへ、`v0.4 Natural Conversation`の最初のSliceとして、利用者が生成中の応答を止められる経路を追加すること。停止したTurnを表示・Session履歴・明示長期記憶へ残さず、停止不成立も成功に見せないことまでを一つの契約とする。

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
- `thinking -> response emotion -> idle`の状態遷移

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

## 現在のEvidence

| 対象 | 自動確認 | 実動作確認 | 残るGap |
| --- | --- | --- | --- |
| Frontend | Type/lint/build、Vitest 64件、Playwright 5件（Mock一往復・返答スタイル・生成停止・段階的開示・Mobile） | Desktop/390px/319px、実VRM、Mock一往復 | Bundle分割、動的UIの追加分割 |
| Backend | Ruff、Pytest 53件、pip check | Mock/VOICEVOX Health | 実OpenAIは未確認 |
| Voice output | API/WAV/Stop/Timing Test | 実VOICEVOX 10/10 | Engine処理の途中Cancel |
| Voice input | Permission/無音/Cancel/マイクTest | 実マイク短文1件 | Noiseを含む固定10文 |
| Performance | Schema/Cue/Reduced Motion Test | 固定10文10/10、実VRM | 皮肉・未知言い換え |
| Interaction | 4種のSchema/API/UI伝播、不明値拒否、OpenAI Instruction Test | Mock固定入力で4種の差を確認 | 実OpenAIの文章品質、利用者評価 |
| Generation cancel | Active Task、停止/保存境界、非保存、UI復帰をAPI/Unit/Browserで確認 | Mock経路 | 実Provider/Network別の停止到達時間 |
| Memory | Session/Persistence/Search Test | CRUD UI | 言い換え検索の定量評価 |
| Security | Local pattern scan、Gitleaks CI、npm/pip audit 0件 | Loopback bind/ignored data、Public RepositoryのSecret scanning確認 | 新しい依存・Data追加時の継続監査 |

詳細は[docs/evaluations](docs/evaluations/)を参照する。固定Scenarioの成功を一般化性能として主張しない。

## Visionに向けた優先順位

### P1 — v0.4 Natural Conversation

最初の主要Sliceは、実Providerを任意で使った自然な複数Turn会話とする。実API Request、費用発生、外部送信は所有者の明示承認後だけ行う。

- Character Profile、会話履歴、明示記憶、返答スタイルを一つのContext契約へ整理する。
- [x] 生成Cancel、発話・Cue・口形の一括停止を設計・実装する。
- [ ] Text Streamingまたは段階表示を、読みやすさとTTS開始Latencyを含めて比較する。
- 応答開始、本文完了、音声開始までのLatencyを分けて計測する。
- 代表会話とFailure Caseで、文脈保持、冗長さ、不確実性、Character一貫性を評価する。
- 既定MockとText fallbackを維持し、実Providerが使えなくても起動とDemoを継続できるようにする。

完了条件:

- 実Providerで複数Turnの代表Scenarioを再現し、結果と費用を記録する。
- [x] 利用者が生成をCancelでき、停止したTurnを保存せず、音声・口形・Gestureが残らない。
- 外部送信対象をUIとREADMEから確認できる。
- Mock、Provider failure、VOICEVOX failureの各Fallbackが通る。

### P2 — v0.5 Character Identity and Embodied Consistency

- 自作または公開条件を満たす改変Avatarを用意し、和風StageとVisual identityを統一する。
- Character Profileに口調、価値観、避ける表現、Voice設定をVersion付きで定義する。
- Turnをまたぐ感情の余韻、視線、頷き、Gestureの頻度とBlendを調整する。
- 本文、Voice Style、表情、視線、Gestureが矛盾しない固定Scenarioを評価する。
- Reduced MotionとModel差異のFallbackを維持する。

### P3 — v0.6 Trusted Memory

- 長期記憶は明示追加または会話中の確認承認だけに限定する。
- 意味検索を導入する場合も、参照した記憶と理由を利用者へ示す。
- 矛盾、期限、編集履歴、Export/Import、全削除を扱う。
- 通常会話の自動永続化と、同意のない大規模User Profileは行わない。

### P4 — Productization and Performance

1. 実マイク固定10文を静音/生活雑音で比較し、意味保持率、再試行、Latencyを記録する。
2. 初回Setup、依存診断、Engine状態、復帰手順を一つの起動体験へまとめる。
3. Three.js/VRMをDynamic importし、約854kBのproduction bundleを分割する。
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
