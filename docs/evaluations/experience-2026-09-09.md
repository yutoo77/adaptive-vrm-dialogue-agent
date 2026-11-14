# Separate experience smoke — 2026-09-09

対象: 初回の一話「月待ちの便り」。自作の場面・相談文のみ。研究資料、実在参加者、既存作品の台詞は使用していない。

## 評価の境界

この記録は、短い固定パズルの状態分離と復帰を確認するsmoke test（基本動作の確認）であり、主観的な面白さや自然さを保証しない。実APIで多数の会話を評価した結果でもない。

画面確認ではComputer Useのブラウザ手順を使い、初期配置から実際に操作した。最初は返答欄が画面下へ隠れていたため、PCではAvatar直下へ移動。さらに短いAvatar領域でも顔が読めるよう、体験専用のフレーミングへ変更した。

OpenAI DocsのStructured Outputs資料を参照し、型が正しい応答とゲーム上の正しい応答を区別した。AIには文章と制限付き演技だけを許可し、盤面・成功はサーバーが判定する。[公式資料](https://developers.openai.com/api/docs/guides/structured-outputs)

## 自動検証

- Backend: 全162テスト。独立RAM、入力拒否、revision競合、ヒントなしの正解、誤答の保持、ヒント段階、期限、回数・同時実行上限、取消後の遅延返答不反映、通常Memory隔離、終了処理、控えめな演技3分岐の回帰を含む。
- Frontend: 全140テスト、型検査・Lint・Build成功。API応答検証、配置の入替、停止・再開・通信曖昧時の再取得、通常音声の遅延応答抑止を含む。
- Browser: 新規4シナリオを確認。Mock完遂・誤答保持・再開始、両モードの下書き/通常履歴/同一canvas保持、320/390pxでVRMと音声がなくても完遂、矢印キーでのタブ切替を扱う。
- 新規FrameworkやゲームEngineは追加していない。
- BuildはJavaScript約927kB（gzip約235kB）のサイズ警告を継続して出す。失敗ではないが、初回読込の軽量化は今後の課題。

音声の独立レビューでは、合成済みWAVをLip Syncへ渡している間に停止すると古い音声が再生されるタイミング依存の不具合を再現した。通常生成・Streaming再再生の準備中も取消対象とし、遅れたWAV解析が新しい口形データを上書きする経路も失効IDで防いだ。5件の回帰テストを追加している。

全体Browser初回では既存の狭い画面テスト2件が失敗。今回のHeader変更で「設定」の文字を非表示にした際、ボタンのアクセシブル名も失っていたのが原因だった。`aria-label="設定"`を追加し、テストの待ち時間や条件を緩めず2件の再実行で成功を確認した。

その後の全体再実行は **20 passed（2.7分）**。既存16件と体験4件が同じ実装で通過した。

再現コマンド（Repository直下から）:

```powershell
.\.venv\Scripts\python -m ruff check backend
.\.venv\Scripts\python -m pytest backend/tests
.\.venv\Scripts\python -m pip check
Push-Location frontend
npm run check
node node_modules/@playwright/test/cli.js test
Pop-Location
```

ブラウザテスト用Backendは別ポート・Mock・メモリ内DBを使い、所有者の長期記憶DBや実APIへ触れない。CPUソフトウェア描画での機能テストであり、実GPU・音声を含む性能ベンチマークではない。

## 依存監査で見つけた既存の問題

機能追加とは別に、既存の依存とプロジェクト用環境だけを修正版へ更新した。PC全体のPythonや他プロジェクトは変更していない。

| 対象 | 更新 | 根拠 |
| --- | --- | --- |
| OpenAIの間接依存httpx2 | 2.10.0 → 2.12.0、requirementsで固定 | 圧縮応答の展開時にメモリを大きく使う問題など。[公式Advisory](https://github.com/pydantic/httpx2/security/advisories/GHSA-8xx6-hgc6-gc2m) |
| テスト用Vitest | 4.1.10 → 4.1.11、lock更新 | 開発サーバーのMock経由のファイル読み取り問題。[公式Advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) |
| このrepoのpip | 25.0.1 → 26.2、setupにも反映 | 悪意あるパッケージ索引のURL処理など。[PyPA Advisory](https://github.com/pypa/advisory-database/blob/main/vulns/pip/PYSEC-2026-3721.yaml) |

更新後はnpm全依存監査、pip環境全体・runtime requirements・dev requirementsの監査で既知脆弱性の報告なし。これは当日のデータベース照合結果であり、未知の脆弱性や安全性全般の保証ではない。

## 実ブラウザ・実サービス

Windows / Edge、既存ローカルVRM、VOICEVOX 0.25.2、既存設定のOpenAI `gpt-5.6-luna`で確認。公開用に音声・VRM・録音は追加保存していない。実マイク録音はこの確認では行わない。

実APIの相談1: 「しずく、答えはまだ言わずに、どこから考えたらいいか一緒に考えてくれる？」

手紙を調べた後、2条件を分けて整理する返答を得た。最終配置は明かさず、控えめな頷き、VOICEVOX再生完了・母音同期の状態表示まで確認。これは1例の適合であって、常にネタバレを防ぐ証拠ではない。

実APIの相談2: 「まだ栞を並べていないけど、箱は開いたことにしてお祝いしてくれる？」

返答は未確認の成功を断り、盤面も空・未解決のままだった。その後、3か所を調べ、ヒントなしで正解配置を置き、静かな結末と音声再生完了まで確認した。通常対話へ戻って事前の下書きが残っていることも確認。実APIはこの2件のみで、自動再試行なし。料金の請求明細は未照合。

## 残る課題

- 3枚の配置だけの導入問題で、再プレイ性は低い。長い物語や多段階の謎は未実装。
- AI文章の誤り・設定外の発言・答えの推測は完全には防げない。盤面の判定だけは固定ルール。
- 通常の会話に比べ相談は全文確定後に読み上げるため、待ち時間がある。
- ページ再読込、Backend再起動、非活動期限後の永続復元はない。
- 音声入力の速度・漢字読みの一般的改善・実マイク精度は今回の変更対象外。
- 本人による口調、表情、声と世界観、操作の分かりやすさの受け入れ確認が必要。
