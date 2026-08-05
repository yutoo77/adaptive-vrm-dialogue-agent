# Adaptive Character Lab

表情・視線・姿勢・待機動作を状態ごとに切り替えられる、ローカルVRMキャラクタービューアーです。最終的には、利用者の発話や対話状況に応じて応答方針、声、表情、動きを変えるAIキャラクターを目指します。

現在は **v0.1** です。対話AIや音声機能ではなく、将来それらを接続するためのキャラクター表示・制御レイヤーを実装しています。

## v0.1でできること

- VRM 1.0を主対象としたモデル表示（VRM 0.xも互換補正を試行）
- 既定パス、ファイル選択、ドラッグ＆ドロップでの読み込み
- モデルがなくても確認できる3Dプレースホルダー
- Bounding Boxを使った胸上優先の自動カメラ調整
- 自動瞬き、呼吸、微小な揺れ、控えめなマウス視線追従
- 10種類の状態を手動切り替え
- Expression不足時の安全なフォールバック
- Expressionの手動テスト
- カメラ距離、高さ、注視点、モデル位置、倍率の調整
- モデル情報、Expression、主要ボーン、FPS、読み込み時間、警告の表示
- `prefers-reduced-motion`による動きの抑制

## 技術構成

- Vite
- TypeScript
- Three.js / WebGLRenderer
- `@pixiv/three-vrm`
- Vitest
- ESLint

Reactやバックエンドはv0.1では使用していません。ライブラリはnpmで管理し、実行時に外部CDNを読み込みません。

## 必要なもの

- Node.js 20.19以上、22.12以上、または24以上
- npm
- WebGLが有効なPCブラウザ
- 利用条件を自分で確認したVRMモデル（任意）

## セットアップ

PowerShellまたはコマンドプロンプトで次を実行します。

```powershell
cd adaptive-vrm-dialogue-agent\frontend
npm install
```

## 起動方法

```powershell
npm run dev
```

表示された `http://127.0.0.1:5173/` をブラウザで開きます。Windowsでは、プロジェクト直下の `start_viewer.cmd` をダブルクリックしても起動できます。

## VRMモデルを既定パスへ配置する

1. モデルの配布ページと最新の利用規約を確認する。
2. `docs/model-license-record.md`へ確認結果を記録する。
3. VRMファイルを次の名前で配置する。

```text
frontend/public/models/private/character.vrm
```

4. 開発サーバーを再起動または画面を再読み込みする。

このディレクトリと`*.vrm`はGitの除外対象です。モデル本体はリポジトリや公開ビルドへ含めないでください。

## ブラウザからVRMを選択する

右側の「VRMファイルを選択」を押すか、表示領域へ`.vrm`ファイルをドロップします。Object URLを使ってブラウザ内で読み込み、モデルファイルを外部サーバーへ送信しません。読み込み完了後はObject URLを解放します。

## ライセンス確認について

Aoシリーズを含め、モデル名や作者名だけから利用条件を判断しないでください。研究発表、動画、配信、公開デモ、改変、商用利用、クレジット、再配布がそれぞれ別条件の場合があります。

このアプリはモデルのライセンス可否を自動判定しません。`docs/model-license-record.md`は確認結果を残すためのテンプレートです。

## 状態の切り替え

画面右側から以下を選択できます。

- `idle` — 待機
- `listening` — 聞く
- `thinking` — 考える
- `explaining` — 説明
- `happy` — 笑顔
- `gentle` — やさしく
- `curious` — 興味
- `cautious` — 慎重
- `confused` — 困惑・聞き返し
- `error` — 操作確認が必要な状態

コードからは次のように変更できます。

```ts
characterController.setState("thinking");
```

将来の対話層は、受け取った`character_state`を検証したうえで、この入口だけを呼び出します。

## モデルが表示されない場合

1. ファイル名が`.vrm`であることを確認する。
2. 既定パスを使う場合は、`frontend/public/models/private/character.vrm`に配置したか確認する。
3. `file://`でHTMLを直接開かず、`npm run dev`で起動する。
4. ブラウザでWebGL・ハードウェアアクセラレーションが有効か確認する。
5. 200MBを超えるモデル、破損モデル、対応外拡張を確認する。
6. 「開発者情報」を開き、Expression、ボーン、警告を確認する。
7. 別モデルで読み込めるか比較する。

ExpressionやLookAtが不足しているだけなら、アプリは姿勢制御へフォールバックして表示を続けます。

## テストとビルド

`frontend`で実行します。

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

production buildの確認:

```powershell
npm run preview
```

## 現在の制約

- Ao白衣版VRM本体は含まれておらず、実モデルでの最終表示は未確認です。
- モデル固有の髪・アクセサリーにより自動カメラ位置がずれる場合があります。
- カスタムExpressionの意味はモデルごとに異なります。
- VRMA、モーションキャプチャ、複数キャラクター、モバイル性能保証は対象外です。
- Ollama、VOICEVOX、音声認識、RAG、外部API接続は実装していません。

## Ao白衣版での手動確認

1. Ao白衣版の配布元と利用規約を確認し、`docs/model-license-record.md`を記入する。
2. ファイルを既定パスへ配置するか、画面から選択する。
3. 顔から胸上が画面内に入り、正面を向いているか確認する。
4. 10状態を順に押し、表情が滑らかに切り替わるか確認する。
5. `happy`、`relaxed`、`sad`、`surprised`等の有無を開発者情報で確認する。
6. 瞬き、呼吸、視線追従、首の傾きが過剰でないか確認する。
7. カメラ調整を操作し、顔が切れない範囲を確認する。
8. 別VRMへ再読み込みし、古いモデルが残らないことを確認する。

## ロードマップ

- v0.1: VRM表示、待機動作、表情・状態制御
- v0.2: Ollamaによるテキスト対話と状態決定
- v0.3: VOICEVOX、音声読み上げ、口パク
- v0.4: 音声入力、聞き返し、一時記憶、科学館RAG

詳細は`docs/roadmap.md`と`docs/architecture-review.md`を参照してください。
