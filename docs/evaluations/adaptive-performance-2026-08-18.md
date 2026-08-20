# Adaptive Performance 固定Scenario評価

評価日: 2026-08-18

## 目的

返答内容から生成する`PerformancePlan`が、公開可能な固定入力に対して期待する感情・しぐさ・声色を返し、実VOICEVOX音声と実VRM画面まで破綻せず接続するかを確認した。

これはMock Providerの決定的なRuleを対象にした小規模な回帰評価であり、自然言語全般への一般化性能や、人が感じる演技品質を証明するものではない。

## 評価環境

- Dialogue Provider: `mock / mock-v1`（外部送信なし）
- Voice: VOICEVOX Engine 0.25.2 / 冥鳴ひまり / ノーマル / ID 14
- VRM: AvatarSample_A / VRM 1.0
- 入力Data: 自作した架空の日本語10文
- 評価対象: 感情、開始しぐさ、途中Cue、声色、Dialogue API、Speech API、WAV妥当性、実画面の状態復帰

## 固定Scenario

通常7件は、挨拶、感謝、疲労、質問、不安・注意、曖昧入力、中立入力を含む。Failure寄り3件は、複合感情、肯定語の否定、肯定表現の後に悪い事実が続く文を含む。

各Scenarioで、期待する`emotion / gesture / voice_style`との一致、0〜1の`intensity`、Speech APIの成功、生成WAVの形式と長さを確認した。

## 初回結果

| 指標 | 結果 |
| --- | ---: |
| Dialogue API | 10 / 10成功 |
| Speech API / WAV | 10 / 10成功 |
| 通常Scenario一致 | 7 / 7 |
| Failure寄りScenario一致 | 1 / 3 |
| Performance全体一致 | 8 / 10 |
| Dialogue中央値 | 2 ms |
| Speech中央値 | 3,362 ms |

不一致は次の2件だった。

- `別に嬉しくないよ`が、否定より`嬉しい`を優先して`happy`になった。
- `最高だね。全部壊れたけど。`が、後半の損害より`最高`を優先して`happy`になった。

## 修正

- `嬉しくない / 楽しくない / 喜べない / よくなかった`を肯定語より先に判定し、`gentle`へ送るようにした。
- `壊れた / 故障 / 事故 / 失敗した`を注意語へ追加し、肯定語より先に`cautious`へ送るようにした。
- 上記2件をBackendの回帰Testへ追加した。

## 修正後結果

| 指標 | 結果 |
| --- | ---: |
| Dialogue API | 10 / 10成功 |
| Speech API / WAV | 10 / 10成功 |
| 通常Scenario一致 | 7 / 7 |
| Failure寄りScenario一致 | 3 / 3 |
| Performance全体一致 | 10 / 10 |
| Dialogue中央値 | 2 ms |
| Speech中央値 | 3,556 ms |

Speech中央値は初回より194ms長いが、1回ずつの小さな測定であり、入力文とVOICEVOXの通常変動も含む。この差から性能悪化や改善を判断しない。

## Cue Timeline拡張後の再評価

開始Gestureに加えて、文境界を使った途中Cueを最大2件生成するSchemaへ拡張した。Cueは音声の20〜82%の範囲、0.15以上の間隔、許可済みGesture、0〜1の強度だけを受け付ける。

| 指標 | 結果 |
| --- | ---: |
| Dialogue API | 10 / 10成功 |
| Speech API / WAV | 10 / 10成功 |
| Performance全体一致 | 10 / 10 |
| Cue制約適合 | 10 / 10 |
| Dialogue中央値 | 2 ms |
| Speech中央値 | 3,536 ms |

Cue制約適合はSchemaと時間順序の回帰確認であり、しぐさの見た目が自然だと証明する指標ではない。

## 実ブラウザ確認

`ありがとう、助かったよ`を送信し、次を確認した。

- 実VRM `AvatarSample_A`を読み込み、Mock応答を表示した。
- 自動演技は`うれしい 64% / 軽く弾む・明るく`を表示した。
- VOICEVOX再生中もCharacter Stateは`happy`、Expressionは`happy`を維持し、単純な`speaking`表示へ上書きされなかった。
- 音声は正常に再生され、Lip Sync用の音声状態は`playing`になった。
- 再生終了後は`idle / neutral`、音声状態`ready`へ復帰した。
- 応答19ms、音声準備3.37秒。Browser consoleのwarning/errorは0件だった。

Lip Syncの口形制御自体は既存の自動Testと過去の実ブラウザ評価で確認済みである。今回のDOM記録は再生状態との接続を確認したもので、口の見た目の自然さを数値評価したものではない。

## 強度3段階とReduced Motion

開発者向け「演技を比較」を追加し、会話や外部APIを使わずに同一条件を再生した。比較設定は保存せず、OS設定を変更しない。

- `happy / soft_bounce`の30%、60%、90%をAvatarSample_Aで再生し、UI表示とCharacter Stateが各強度へ一致した。
- 30%は表情と姿勢が控えめ、60%は通常利用向け、90%は差が明確だが過剰な跳躍にはならなかった。
- 90%のReduced Motionでは、感情表情を残したまま一回動作の振幅が通常の18%へ抑えられた。
- `cautious / head_tilt / 60%`でも感情・姿勢・しぐさ・表示の組み合わせが一致した。
- 通常／抑制Overrideから「会話連動に戻す」を押すと、`system / idle / neutral`へ復帰した。
- Browser consoleのwarning/errorは0件だった。

これはAvatarSample_Aと現在の画面サイズに対する初期調整である。最終AvatarやCamera framingを変更した場合は、同じ比較を再実行する。

## 音声と演技の時間同期

GestureがVOICEVOXのWAV生成中に終わらないよう、表情・姿勢の準備とGesture開始を分離した。Speech側は`started`時に実音声長を通知し、演技Timelineが開始Gesture、途中Cue、余韻、復帰を決定する。

- 返答受信後、音声生成中は`happy 64%`の表情・姿勢を保持し、`soft_bounce`はまだ開始しなかった。
- Browserの音声再生開始後に`soft_bounce`が始まり、Lip Syncと同じ実再生時点へ同期した。
- `何ができるの？`への`curious 52%`返答では、実再生開始後に開始Gesture、約5.4秒後に`途中Cue 1/1`、完了後に余韻、待機復帰をPhase表示で観測した。
- 正常終了の余韻は感情別360〜680ms。`curious`は540msに設定し、100ms間隔のBrowser観測でも完了後600ms以内に`idle`へ復帰した。
- 再生開始約0.9秒で手動停止すると即時`idle`になり、6.5秒後も予約Cueは発火しなかった。
- 直前音声の再再生でも、保存済みPerformancePlanのGestureを再度開始した。
- Browser consoleのwarning/errorは0件だった。

途中Cueは文境界を再生時間の比率へ近似したもので、実際の音素境界や意味単位を解析してはいない。長文での自然さは最終Avatarを使った利用者評価が必要である。

## 再実行

VOICEVOX EngineとBackendを起動して実行する。

```powershell
cd backend
..\.venv\Scripts\python -m scripts.evaluate_performance
```

終了Code 0は、全API成功、全WAV妥当、全Scenario一致、全Cue制約適合を意味する。

## 限界と次の判断

- 10文は小さく、言い換え、長文、皮肉、方言、多段の感情変化は十分に含まない。
- MockはKeyword Ruleであり、現在の10文へ合わせた回帰結果を未知入力へ一般化できない。
- Enum一致はSchemaと期待分類を確認するが、Animationの自然さや好みは測らない。
- 現在のVoice StyleはWAV再生速度の微調整であり、本格的な感情音声合成ではない。
- Cue位置は文の文字数比による近似で、VOICEVOXの音素時間情報を使っていない。
- 強度3段階はAvatarSample_Aで確認済みだが、最終Avatarでは再評価が必要。
- 実OpenAI Providerは使っておらず、Schema適合と内容適合は未評価。

所有者は右側の「04 演技を比較」から同じ条件を再生し、最終的な好みに合うかを確認できる。最終Avatarへ差し替えた時点でも同じ比較を再実行する。
