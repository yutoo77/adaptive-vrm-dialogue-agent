# Visual Identity Review — 2026-08-20

## 目的

機能説明を増やさず、初見で「Avatarと会話が主役」と分かる固有の画面を作る。既存のVRM制御、Text Fallback、段階的開示を壊さず、外部画像Assetや第三者Characterへ依存しないことを条件とした。

## 実装

- 深藍、白練、藤色を主色、青磁と臙脂を状態色として限定した。
- 円窓、格子、水紋、浮遊片をCSSのGradient、Border、Mask、Animationで描画した。
- Three.jsの環境光、縁取り光、影を同じPaletteへ調整した。
- `#app[data-state]`に応じて、聞き取り、思考、発話、成功、失敗の環境色を控えめに変える。
- `prefers-reduced-motion`では環境Animationも停止する。

## 確認項目

| Scenario | 期待結果 |
| --- | --- |
| Desktop / 実VRM | 白い衣装と肌の階調を失わず、背景に青・白・紫が残る |
| Idle → Thinking | Text状態とAvatar状態を保ったまま、円窓が藤色寄りへ変化する |
| Explaining / Speaking | 水紋だけが緩やかに動き、会話や口形を妨げない |
| 390px / 319px | 入力欄が初期Viewport内に残り、横Overflowがない |
| Reduced Motion | 浮遊片と水紋のAnimation durationが最小化される |
| Asset境界 | Stage描画のための外部画像・Texture・Network requestがない |

## 限界

- 現在の公開Screenshotに使うVRMは公式Sampleで、StageだけがProject固有である。
- 完全なVisual identityには、別途ライセンスを記録した自作・改変VRMが必要である。
- 状態色は理解を補助する装飾であり、状態Textの代替にはしない。
