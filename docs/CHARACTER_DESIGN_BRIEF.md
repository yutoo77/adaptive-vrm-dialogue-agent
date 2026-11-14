# Character Design Brief — 月白 しずく

実装Profile: `tsukishiro_shizuku v1.0.0`

## 目的

Adaptive Character Labの対話、音声、表情、口形、控えめなしぐさを見せる、本Project固有のVRM Avatarを制作する。3D Model自体の複雑さではなく、Applicationの画面、状態設計、演技と一体になって見えることを優先する。

## Character像

- 名前は「月白 しずく」。静かに寄り添い、考えをほどく案内役とする。
- 静かで礼儀正しいが、無表情・受動的にはしない。
- 相手の話をよく聞き、答える前に少し考える印象を持たせる。
- 和装の再現ではなく、現代服へ羽織・組紐・水紋の線を取り入れる。
- 大きな身振りより、視線、首の傾き、小さなうなずきで感情を伝える。

## Visual direction

### Palette

| 用途 | 色 | Hex |
| --- | --- | --- |
| 髪・外衣 | 深藍 | `#202A5A` |
| 主衣装 | 月白 | `#F7F8FF` |
| 差し色 | 藤色 | `#8F82C7` |
| 裏地・組紐 | 青磁 | `#6F9F97` |
| 瞳・小面積Accent | 葡萄色 | `#8F4C67` |
| 金具 | 古金 | `#B59B68` |

### Silhouette

- 髪は肩より少し下のStraightを基本にし、後頭部の低い位置へ細い編み込みをまとめる。
- 正面から見た輪郭は左右非対称にしすぎず、横顔で編み込みと組紐が分かるようにする。
- 袖は極端に広げず、Lip Syncや手Gestureより先に服が目立たないVolumeへ抑える。
- 衣装はShort haori風の上着と現代的なOne-pieceまたはPleated skirtで構成する。

### Motif

- 月輪、水紋、細い組紐を使う。
- 大面積の花柄、特定作品を想起させる髪飾り、人形、小物は使わない。
- 模様は左右どちらかの裾か袖へ小さく配置し、Stageの円窓と競合させない。

## 表情と演技の要件

最低限、次のVRM Expressionを自然に出せることを確認する。

- `neutral`
- `happy`
- `relaxed`
- `sad`
- `surprised`
- `angry`
- `blink`または左右Blink
- `aa / ih / ou / ee / oh`

目標は感情を大きく誇張することではない。弱30%、中60%、強90%の比較で、弱でも目元と口元の違いが読み取れ、強でも顔が崩れないことを合格条件とする。

## VRoid Studioでの制作順

1. 新規Modelから顔、体格、髪のSilhouetteだけを決める。
2. 深藍、白練、藤鼠の3色だけで一度書き出し、Stage上の明度を確認する。
3. 青磁、葡萄色、古金を小面積へ追加する。
4. 表情Presetと5母音を確認する。
5. VRM 1.0で書き出し、権限Meta Dataを設定する。
6. `frontend/public/models/private/character.vrm`へ置き、実画面で表情、Lip Sync、Gesture、Reduced Motionを確認する。

## 権利と公開条件

- 自作Texture、または公開Application ScreenshotとGitHub公開を許可する素材だけを使う。
- 使用したVRoid衣装、髪、Textureごとに作者、URL、取得日、改変、Screenshot、再配布条件を記録する。
- Model本体はRepositoryへ含めない。Screenshotや動画の公開条件はModel本体の再配布条件と分けて確認する。
- 第三者Characterの公式画像、Logo、固有小物、衣装PatternをTextureやRepositoryへ取り込まない。

## 完成条件

- ScreenshotだけでStageとAvatarのPaletteが一つの作品として見える。
- Full-bodyとBust-upの両方で顔と衣装の識別点が残る。
- 5母音、Blink、感情6種、Gesture 4種が破綻しない。
- 390px幅で顔が小さすぎず、入力欄を隠さない。
- License記録と公開用Creditが完成している。
