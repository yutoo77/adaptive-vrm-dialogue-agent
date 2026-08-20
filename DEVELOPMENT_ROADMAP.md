# Development Roadmap

更新日: 2026-08-20

このRoadmapは機能数ではなく、各Vertical Sliceが「動く・復帰できる・評価できる・説明できる」状態になったかで進行を判断する。

## 現在のRelease目標

現在の目標は、新機能追加ではなく、既存のLocal Applicationを就職活動で提示できるPublic Repositoryへ仕上げること。

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
- [ ] 変更差分をReviewし、明示承認後にStage/Commit/Pushする。
- [ ] GitHubの説明、Topics、Visibilityを最終確認する。

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

## 現在のEvidence

| 対象 | 自動確認 | 実動作確認 | 残るGap |
| --- | --- | --- | --- |
| Frontend | Type/lint/build、Vitest 60件、Playwright 3件（Mock一往復・段階的開示・Mobile） | Desktop/390px/319px、実VRM、Mock一往復 | Bundle分割、動的UIの追加分割 |
| Backend | Ruff、Pytest 45件、pip check | Mock/VOICEVOX Health | 実OpenAIは未確認 |
| Voice output | API/WAV/Stop/Timing Test | 実VOICEVOX 10/10 | Engine処理の途中Cancel |
| Voice input | Permission/無音/Cancel/マイクTest | 実マイク短文1件 | Noiseを含む固定10文 |
| Performance | Schema/Cue/Reduced Motion Test | 固定10文10/10、実VRM | 皮肉・未知言い換え |
| Memory | Session/Persistence/Search Test | CRUD UI | 言い換え検索の定量評価 |
| Security | Local pattern scan、Gitleaks CI、npm/pip audit 0件 | Loopback bind/ignored data確認 | Public化後のGitHub Secret scanning確認 |

詳細は[docs/evaluations](docs/evaluations/)を参照する。固定Scenarioの成功を一般化性能として主張しない。

## 公開後の優先順位

### P1 — 現在の体験を強くする

1. 実マイク固定10文を静音/生活雑音で比較し、意味保持率、再試行、Latencyを記録する。
2. 主要画面を追加する場合だけ、残る`UIController` Event調整を対話、Memory、Model領域へ分割する。静的MarkupとDeveloper Panel描画は分離済み。
3. Three.js/VRMをDynamic importし、約851kBのproduction bundleを分割する。
4. Windows以外の起動導線が必要になった場合だけ、Cross-platform scriptまたはDockerを選ぶ。
5. Code-nativeな和風Stageと状態連動の環境光は完了。次は自作・改変Avatarを用意し、背景とCharacterのVisual identityを統一する。

### P2 — Bounded Agent

固定処理だけでは解けない具体的な「公開Knowledgeを検索し、根拠を示す」Scenarioを用意できた場合に進む。

- 1 Agentのみ
- 許可Actionを`ANSWER / ASK_CLARIFICATION / SEARCH / SHOW_SOURCE / REFUSE`へ限定
- ToolはKnowledge SearchとSource Verificationから最大2つ
- 最大実行回数、Timeout、Cancel、Input/Output Schemaを固定
- Chain of Thoughtを保存せず、Action、Tool、Latency、成否、Source IDだけを記録

完了条件:

- 許可Action以外を実行しない。
- Toolの無限呼出がない。
- 検索不要、聞き返し、根拠不足の拒否を固定Scenarioで確認する。
- Agentが固定Ruleより必要だった理由を説明できる。

### P3 — Adaptive InteractionまたはVisionの一方

最初の候補は、利用者が「短く」「詳しく」「初心者向け」を明示選択するAdaptive Interaction。Privacy Riskと評価負荷が低く、現在の対話UIへ自然に接続できるため。

Visionは、画像なしでは解けない具体的なScenarioと公開可能な評価Dataを用意できた場合だけ選ぶ。同時に両方を実装しない。

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
