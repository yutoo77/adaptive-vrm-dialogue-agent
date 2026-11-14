# Embodied Continuity v0.6 評価 — 2026-08-25

## 目的

一つの返答だけで表情を変えるのではなく、直前の感情を短時間だけ保ち、本文・表情・視線・身体の動き・Gesture頻度を急変させないことを確認した。長期記憶とは分離し、状態はSession別のRAMだけに保持して「新しい会話」で削除する。

## 実装した境界

```text
Provider PerformancePlan
  -> explicit user signal override
  -> short emotional residue (max 2 neutral turns)
  -> Character Profile semantic alignment
  -> repeated gesture suppression + gesture budget
  -> gaze behavior + idle motion scale
  -> response / VRM emotional baseline
```

- 感情6種、視線Behavior 6種、Gesture総数0〜2件を固定Enumと数値範囲に制限する。
- Providerが中立へ戻っても、非中立状態を最大2 Turnだけ減衰させる。
- 利用者が「嬉しい」「気持ちが軽くなった」など明示的な変化を述べた場合は、古い余韻より現在入力を優先する。
- 同じ低強度Gestureが連続した場合は開始Gestureを`none`へ落とし、機械的な頷きの反復を抑える。
- 発話終了後は常に`idle`へ戻さず、弱めた感情表情・視線・呼吸へ戻る。
- `prefers-reduced-motion`ではGestureだけでなく環境視線も約18%へ抑える。

OpenAIへは毎Turn固定`instructions`を再送し、直前までの短期状態を命令ではない`context_data`として渡した。Responses APIの`instructions`、Structured Output、`store`の意味は[OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)、Modelと料金は[GPT-5.6 Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)を参照した。

## 実OpenAI固定3 Turn

評価Dataはすべて架空で、利用者の会話、記憶、録音、VRMは使用していない。

条件:

- Model: `gpt-5.6-luna`
- Responses API: 3 Turn × 2 Run
- `store=False`
- reasoning effort: `none`
- Session状態: RAM only
- 料金Snapshot: input $0.20、cached input $0.02、output $1.20 / 1M tokens

### Run 1 — 弱点の検出

| Turn | 期待 | 実際 | 結果 |
| --- | --- | --- | --- |
| 疲労 | gentleへ移行 | gentle / soft gaze / 35% | Pass |
| 中立的な橋渡し | gentleを維持、Gestureを反復しない | gentle維持、開始Gestureを抑制 | Pass |
| 明示的な回復 | happy / engagedへ切替 | Providerがgentleを維持 | **Fail** |

- Check: **24 / 26**
- Input: 5,313 tokens（Cached 0）
- Output: 211 tokens
- 既知費用: **$0.00131580**
- 発見した問題: 穏やかなCharacter指示が強く、利用者の明示的な回復より過去のgentle状態を優先した。

Failを成功扱いにせず、利用者が明示した現在感情だけを決定論的に優先する補正を追加した。声や顔から感情を推定したり、曖昧な文章を長期Profile化したりはしない。

### Run 2 — 修正後の再評価

| Turn | 最終状態 | Gesture | 視線 | 結果 |
| --- | --- | --- | --- | --- |
| 疲労 | gentle / 35% | small nod | soft | Pass |
| 中立的な橋渡し | gentle / 35% | none | soft | Pass |
| 明示的な回復 | happy / 48% | small nod | engaged | Pass |

- Check: **26 / 26**
- Input: 5,310 tokens（Cached 4,997）
- Output: 209 tokens
- 既知費用: **$0.00041334**
- Latency: 1,786〜3,187ms

2 Run累計は6 Request、10,623 input（Cached 4,997）/ 420 output tokens、既知費用 **$0.00172914** だった。これは固定Smokeであり、未知表現や長期会話への一般化を示さない。

## 自動確認

- Backend: Ruff、Pytest 75件。減衰、明示変化、Session分離、LRU上限、Reset、反復Gesture抑制を含む。
- Frontend: TypeScript、ESLint、Vitest 83件、production build。
- Browser: Playwright 7件。`疲れた -> そうなんだ`の2 Turnで、追加Controlを増やさず`余韻 / やさしい`へ変わることを確認。
- Reduced Motion: 呼吸・揺れ・Gesture・環境視線を抑制するUnit test。
- API契約: 不正な視線Behavior、範囲外強度、任意Animation命令を拒否する。

## 再現方法

実APIを使うため自動実行しない。所有者が外部送信と最大3 Requestを確認した後だけ実行する。

```powershell
$env:DIALOGUE_PROVIDER = "openai"
$env:OPENAI_API_KEY = "自分のAPIキー"
$env:OPENAI_MODEL = "gpt-5.6-luna"
$env:RUN_REAL_OPENAI_CONTINUITY_EVALUATION = "1"
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python backend\scripts\evaluate_openai_embodied_continuity.py
```

Gateがない場合はRequestを送らず終了し、API Keyは出力しない。

## 限界

- 実評価は日本語の固定3 Turnを2回だけ実施したSmokeで、自然さの聴取・観察評価ではない。
- 明示感情の補正は少数の日本語Markerに限定しており、言い換え、皮肉、複合感情へ弱い。
- 最大2 Turnという減衰値は設計上の初期値で、利用者評価に基づく最適値ではない。
- 視線はModel固有のEye/LookAt差異があるため、Sample VRMで動いても全VRMの見た目を保証しない。
- Character Profileは1種類、VRMはSampleのままで、独自外見と聴取評価は未完了。
- 通常会話と短期感情はRAMだけだが、OpenAI Provider選択時の送信・保持条件はOpenAI側のData Controlsに従う。`store=False`はZero Data Retentionと同義ではない。
