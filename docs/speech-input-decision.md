# Speech input decision

更新日: 2026-08-15

## 利用者の課題

Textを入力しにくい場面でも、ボタンを押して話すだけで質問できるようにする。Microphoneは利用者の明示操作後だけ起動し、認識失敗、無音、Permission拒否、CancelからText入力へ戻れることを優先する。

## 比較

| 方式 | 費用 | 音声の送信 | 強み | 弱み | 判断 |
| --- | --- | --- | --- | --- | --- |
| Browser Web Speech / 通常 | 無料 | Browserの認識Serviceへ送信される場合がある | 追加Model不要、実装が軽い | Browser依存、Offline不可の場合があり、送信先の説明が弱い | 既定にはしない |
| Browser Web Speech / On-device | 無料 | 端末内 | Backend不要、Privacyが良い | 対応Browserが限定的で、言語PackのInstallが必要 | 将来の軽量Fallback候補 |
| Local faster-whisper | 無料 | `127.0.0.1`のBackendまで | Browser差が小さく、音声を外部送信しない | Python依存とModel download、CPU推論時間、約500MB級のModel | 採用 |

Web Speech APIは一部BrowserでServer型認識を使い、音声がWeb Serviceへ送られる。On-device指定も存在するが、対応状況が限定的である。

faster-whisperはCTranslate2を使うWhisper実装で、CPUのINT8推論に対応する。`small`は244M parametersで、日本語の短い発話に対する精度とPC負荷の比較開始点として採用候補にする。Modelは初回にHugging Face HubからDownloadされるが、認識時の音声は外部へ送らない。

## 推奨する最初の縦切り

1. 利用者がMicrophone Buttonを押す。
2. BrowserがPermissionを要求する。
3. `MediaRecorder`で最大15秒だけ録音する。
4. Stop後に音声Blobを`POST /api/transcription`へ送る。
5. Backendがlocal faster-whisper `small` / CPU INT8で日本語Textへ変換する。
6. 認識Textを入力欄へ入れ、利用者が確認してから送信する。

最初から自動送信しない。誤認識した文を利用者が確認・修正できることを優先する。録音Dataと認識文は永続保存せず、Application Logにも本文を残さない。

## 2026-08-15の実装・確認結果

- `faster-whisper 1.2.1`、`python-multipart 0.0.32`を追加した。
- `small`を取得し、このPCのHugging Face cacheで463.7MiBを使用した。
- MediaRecorder、最大15秒、自動送信なし、Cancel、4MiB上限、MIME検証を実装した。
- 5.621秒のVOICEVOX音声をCPU INT8で認識し、API経由6,772ms、言語`ja`、確率1.0、句読点を除き本文はほぼ一致した。
- 実マイク、雑音、無音、Permission拒否の手動評価は未完了。ここがGateとして残る。
- CPUで不足を実測するまではGPU化しない。次の比較候補は`base`で、精度低下と速度改善を同じ音声Setで測る。

## 公式資料

- [MDN: SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [MDN: Using the Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)
- [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [OpenAI Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md)
