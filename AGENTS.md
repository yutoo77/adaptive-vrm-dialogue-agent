# AGENTS.md

## 方針

- v0.1はVRM表示・待機動作・手動状態制御に限定する。
- Ollama、VOICEVOX、音声認識、RAG、外部API接続を追加しない。
- UI文言は日本語を基本とする。
- VRMモデル本体、ライセンス未確認素材、秘密情報をGitへ追加しない。
- 実行時ライブラリはnpmで固定し、外部CDNへ依存しない。
- モデル差異による欠損は警告に留め、表情やLookAtがなくても画面を壊さない。

## 完了確認

`frontend`で以下を実行する。

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

VRM実モデルがない場合は、モデルなし表示とファイル選択UIまでをブラウザ確認し、実モデル確認は手動項目として残す。
