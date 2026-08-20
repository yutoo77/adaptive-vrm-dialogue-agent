# Voice output evaluation — 2026-08-15

## 対象

- Application: Adaptive Character Lab v0.2
- Speech Backend: VOICEVOX Engine 0.25.2
- 話者: ID 14（冥鳴ひまり / ノーマル）
- Dialogue Provider: Mock
- 実行環境: Windows / CPU synthesis
- 入力Data: `backend/scripts/evaluate_speech.py`に固定した公開可能な架空文10件

比較試聴後、所有者の選択により冥鳴ひまりを第一候補として採用した。

## 自動連続合成

Backendの`POST /api/speech`へ10文を順番に送信し、WAV Header、Request ID、往復時間、音声長を記録した。

| 指標 | 結果 |
| --- | ---: |
| 成功 | 10 / 10 |
| 失敗 | 0 |
| 往復時間 最小 | 2,204 ms |
| 往復時間 中央値 | 2,578 ms |
| 往復時間 P95 | 3,490 ms |
| 往復時間 最大 | 3,490 ms |
| 生成音声 合計 | 49.707秒 |
| 生成音声 中央値 | 4.976秒 |
| WAV 合計 | 2,386,360 bytes |

重大停止と不正WAVは0件だった。一方、2.2〜3.5秒程度の待ち時間があるため、短い会話でも即時応答には見えない。Push-to-Talkでも生成中表示を維持し、将来必要ならStreamingまたは文分割合成を比較する。

## 実ブラウザ確認

ローカルVRM `AvatarSample_A`と実VOICEVOXを接続して次を確認した。

- `explaining`から`playing`へ移り、Avatarが`話しています`になる。
- 実WAVの振幅に合わせて`aa`口形が動く。
- 生成中の停止で音声処理が終わり、Avatarが`待機中`へ戻る。
- 再生中の停止で音声とLip Syncが止まり、Avatarが`待機中`へ戻る。
- 停止後の再再生で`話しています`へ戻り、再度停止できる。
- 確認中のBrowser console warning / errorは0件。

## 主観評価と残課題

同一文を4話者で比較し、所有者が冥鳴ひまりを選択した。声質の好みは確認できたが、次の項目はVoice入力を含む3〜5分Demoで継続評価する。

- キャラクター外観と声の一致
- 固有名詞、数字、英字の読み方
- 句読点と文末の間
- 6〜8秒の返答を10回聞いたときの疲れにくさ
- 公開時に必要な音声ライブラリ規約とクレジット

## 再実行

VOICEVOX EngineとApplication Backendを起動してから実行する。

```powershell
cd backend
..\.venv\Scripts\python -m scripts.evaluate_speech
```

JSONが標準出力へ出る。`summary.failed`が1以上なら終了コード1、BackendまたはVOICEVOXへ接続できない場合は終了コード2になる。
