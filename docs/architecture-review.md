# VRMキャラクタービューアー v0.1 設計レビュー

## 1. 要件の理解

このフェーズの目的は、対話AIそのものではなく、将来のエージェントから状態名を受け取ってVRMキャラクターへ反映できる「表示・制御レイヤー」を作ることである。v0.1では、VRM 1.0を主対象に、既定パス・ファイル選択・ドラッグ＆ドロップでのローカル読み込み、モデルなし表示、待機動作、10種類の状態、表情・姿勢・視線制御、開発者情報までを実装する。

仕様書は空のプロジェクトを前提としていたが、実際の作業場所には科学館RAGの既存Pythonアプリがある。異なるランタイムや依存関係を混在させないため、既存コードを変更せず、`adaptive-vrm-dialogue-agent/` を独立サブプロジェクトとして追加する。

## 2. 採用する技術構成

- Vite 8 + TypeScript 6 + vanilla DOM
- Three.js + `@pixiv/three-vrm` 3.x
- Vitestによるモデル不要の単体テスト
- ESLint flat config + typescript-eslint
- CSSのみで構築するレスポンシブUI

Reactは使用しない。v0.1の画面は単一ビューであり、UI状態も限定的なので、DOM制御クラスの方が依存と抽象化を抑えられる。実行時CDNは使わず、すべてnpmで管理する。

`@pixiv/three-vrm`の公式APIに合わせ、`VRMLoaderPlugin`、フレームごとの`VRM.update(delta)`、`VRMUtils.rotateVRM0`、`VRMUtils.deepDispose`を利用する。LookAtは存在する場合だけtargetを設定し、ない場合は正規化頭部ボーンへの弱い回転で代替する。

参考:

- https://github.com/pixiv/three-vrm
- https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRM.html
- https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMUtils.html

## 3. 採用しなかった代替案と理由

- React: v0.1の単一画面には導入効果より構成・依存の増加が大きい。
- WebGPU: 対応ブラウザとMToon描画の検証範囲が広がるため、安定性を優先してWebGLRendererを使う。
- FastAPI/Pythonバックエンド: モデル選択はObject URLでブラウザ内完結でき、v0.1には不要。
- OrbitControls: 背面表示や極端な回転を許しやすい。会話向けの固定カメラ＋限定スライダーの方が安全。
- モーションキャプチャやVRMAアニメーション: 待機動作基盤としては過剰で、モデル差異も増える。
- 表情名の固定参照: カスタムExpressionやVRM 0.xとの差異で壊れやすいため、利用可能一覧から候補順に選ぶ。

## 4. v0.1で実装する範囲

- WebGLシーン、カメラ、ライト、描画ループ、リサイズ・DPR対応
- 既定パス、ファイル選択、ドラッグ＆ドロップでのVRM読み込み
- Object URLの解放、再読み込み世代管理、古いモデルの破棄
- Bounding Boxから胸上を優先する自動フレーミング
- モデルなし時の3Dプレースホルダー
- 10状態の手動切り替えと`CharacterController.setState()`
- Expression候補の安全な解決、補間、欠損時の姿勢フォールバック
- 自動瞬き、呼吸、微小な揺れ、控えめな視線追従
- `prefers-reduced-motion`対応
- カメラ・モデル位置・倍率の調整
- メタ情報、Expression、主要ボーン、FPS、読み込み時間、警告の表示
- モデル不要のロジックテスト、型検査、lint、production build

## 5. v0.1で実装しない範囲

- Ollama、プロンプト、応答JSONの生成
- VOICEVOX、読み上げ、口パク
- 音声入力、聞き返し、一時記憶
- 科学館RAG、FastAPI、WebSocket
- VRMモデルの同梱、ダウンロード、ライセンス自動判定
- VRMA・モーションキャプチャ・物理設定UI
- モバイル向け性能保証や複数キャラクター表示

## 6. 技術的リスク

- MToonやテクスチャ数の多いモデルは初回シェーダーコンパイルが重い。
- VRMのBounding Boxには髪・アクセサリーが含まれ、カメラ位置が理想からずれる場合がある。
- SpringBoneと上半身姿勢の組み合わせはモデルにより見え方が異なる。
- LookAtの設定・表情名・正規化ボーンが不足するモデルがある。
- WebGLが無効、GPU制限、巨大ファイル、破損ファイルでは読み込みに失敗する。
- ブラウザはローカルファイルを既定パスから直接参照できないため、`public`配下に配置してVite経由で配信する必要がある。

エラーは利用者向けの短い案内へ変換し、詳細は開発者パネルの警告へ残す。VRMファイルの拡張子と上限サイズを事前確認し、読み込み世代が古くなった結果は破棄する。

## 7. VRMモデル差異への対応

- VRM 1.0を主対象とし、VRM 0.xは`VRMUtils.rotateVRM0()`で公式互換補正を行う。
- Expressionは大文字小文字を区別せず候補順に探索し、見つからなければ姿勢だけを使う。
- `blink`がなければ`blinkLeft`/`blinkRight`を利用し、どちらもなければ瞬き処理を無効化する。
- 頭、首、胸、背骨、腰は存在するものだけを制御する。
- LookAtがなければ、頭部回転へ制限付きの視線成分を加える。
- 身長と中心はBounding Boxで測定し、胸上フレームを計算する。UIから手動補正も可能にする。

Ao白衣版VRMはリポジトリに存在しないため、実モデルでの見た目、表情名、ライセンス、クレジット表記は未確認である。完了報告では動作確認済みと偽らず、手動確認項目として扱う。

## 8. 将来拡張の方針

UIから状態決定ロジックを分離し、公開入口を`CharacterController.setState(state)`へ統一する。v0.2ではAPIクライアントが`character_state`を検証してこの入口を呼ぶだけにする。v0.3の口パクはExpression制御へ専用チャンネルを追加し、状態表情・瞬き・口形を別レイヤーで合成する。v0.4のRAGは対話層の責務とし、VRMViewerへ文書や質問本文を渡さない。

## 9. 最終的な実装計画

1. 独立ViteプロジェクトとGit除外ルールを作る。
2. 型、状態プリセット、範囲制限、Expression解決を先に実装・テストする。
3. VRMローダーと破棄処理、Viewer、Bounding Boxフレーミングを実装する。
4. CharacterControllerとIdleMotionControllerを接続する。
5. 日本語UI、ローカル読み込み、カメラ調整、開発者パネルを実装する。
6. ドキュメントを整備し、型検査・lint・テスト・buildを通す。
7. モデルなし状態をブラウザで確認し、Ao白衣版の手動確認手順を残す。
