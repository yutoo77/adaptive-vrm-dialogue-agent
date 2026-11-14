# VOICEVOX母音・アクセント句同期 評価

評価日: 2026-08-20

## 目的

従来の音量に応じた単一口形の開閉から、VOICEVOXの`audio_query`が返す母音長とアクセント句境界を使う同期へ改善し、実WAV・実VRM・停止・再再生まで破綻しないかを確認した。

これはTTSが生成時に持つ予定時間を利用した同期であり0録音音声から音素を再認識する方式ではない。見た目の自然さを数値だけで証明するものでもない。

## 実装境界

- 母音は`a / i / u / e / o`だけを受け付け、VRMの`aa / ih / ou / ee / oh`へ割り当てる。
- 音量Envelopeは引き続き口の開き具合へ使い、母音Timelineは口形の種類だけを決める。
- VOICEVOXの予定時間を実WAV長へScaleし、時刻ずれを抑える。
- 途中Gestureは文字数比を初期値にし、近いアクセント句境界がある場合だけそこへ寄せる。
- Metadataは母音240件、句境界64件まで。欠損・不正・上限超過時は従来の単一口形へFallbackする。
- 任意Expression名、任意Animation、任意Bone操作は受け付けない。

## 自動・API評価

公開可能な架空入力10件をMock Dialogue、実VOICEVOX 0.25.2、冥鳴ひまり（ノーマル / ID 14）で再実行した。

| 指標 | 結果 |
| --- | ---: |
| Dialogue API | 10 / 10成功 |
| Speech API / WAV | 10 / 10成功 |
| 母音Timeline制約・WAV長一致 | 10 / 10 |
| Performance分類・Cue制約 | 10 / 10 |
| 母音Segment数 | 11〜50件 / 応答 |
| アクセント句境界数 | 4〜13件 / 応答 |
| Dialogue中央値 | 2 ms |
| Speech中央値 | 3,584 ms |

別の短文`こんにちは。今日はいい天気だね。何を話そうか？`では、実WAV 4,149ms、母音16件、句境界5件を返した。API MetadataのWAV長差は評価許容2ms以内だった。

## 実VRM・Browser評価

AvatarSample_A（VRM 1.0）で`何ができるの？`を送信し、次を確認した。

- Modelが持つ`aa / ih / ou / ee / oh`の5口形すべてへ発話中に遷移した。
- 感情Expressionを維持したまま、診断表示が`surprised + aa`などへ切り替わった。
- 音声状態は`VOICEVOX母音同期`を表示した。
- Performance Cueは近いアクセント句へ補正され、実時計で再生開始約6.63秒後に`途中Cue 1/1`を表示した。
- 約11.11秒で音声完了と余韻へ入り、約11.64秒で`idle`へ復帰した。
- 再再生開始約0.9秒で停止すると、口形は即座に`neutral`、Characterは待機へ戻り、1秒後にも残留しなかった。
- Browser consoleのwarning/errorは0件だった。

## Fallback

- Timing Headerがない: WAV音量から従来の`aa`中心Lip Syncを行う。
- Headerが不正: WAV自体が妥当なら音声再生を継続し、不正なTimingだけ捨てる。
- Modelに一部の母音口形がない: 利用可能な`a`系口形へFallbackし、警告を一度だけ表示する。
- Modelに口形がない: 音声だけ再生し、警告を一度だけ表示する。
- 停止・失敗: Animation frame、口形Weight、予約Gestureを即時Resetする。

## 限界と次の判断

- 子音、撥音、促音、無声化母音は専用口形にせず、母音と音量Envelopeで近似する。
- VOICEVOXの予定長を実WAVへ一括Scaleするため、局所的な数十msの誤差は残り得る。
- 40ms観測では母音遷移が頻繁だが、画面側のDampingでBlendしている。最終Avatarで口の振幅と追従速度を主観評価する必要がある。
- これはLip Syncと演技時刻の改善であり、AI返答内容や会話Latencyそのものは改善しない。

現時点では、無料・Local・交換可能な構成を保ったまま、単一口形より明確に説明可能で見た目にも差が出る縦切りになった。次は最終Avatarでの振幅調整、または自然なTurn-takingを別の評価可能な機能として扱う。
