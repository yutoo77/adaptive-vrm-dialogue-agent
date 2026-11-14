# 会話画面のUI設計メモ

今回の調整はPR #17〜#19取り込み後のmainを基準にする。以下は変更時点ごとの記録であり、2026-09-05の配置・技術選択は現在の画面仕様ではない。現在の操作は[デモガイド](DEMO.md)を参照。

## 2026-11-14 音声状態と操作説明の仕上げ

話し方と音声再生は、入力欄に接する上段の操作行へまとめ、共通の背景面で一体化する。セレクトや再生を送信フォーム内へ入れず、既存の選択値・イベント・キーボード順序を維持する。1440×900 / 390×844の3案比較と採用理由は[入力操作の配置記録](evaluations/composer-layout-2026-11-14.md)を参照。

初期の音声未接続を控えめにし、実際の再生失敗・自動再生制限の案内は残す。調整・履歴・新しい会話は標準のホバー説明とフォーカス時の短い名前を使い、Mockは「定型応答」と表示する。通常対話の照明だけを少し弱め、カメラ・視線・体験の照明は維持する。初回のセリフ欄は比較後も現状維持。採用・見送り理由と実VRMの比較は[確認記録](evaluations/dialogue-ui-polish-2026-11-14.md)を参照。

## 2026-11-13 PR #18上の小規模な仕上げ

作業時点のPR #18のcommit `2c23e6d` を基準に、部屋・カメラ・セリフ欄・文字サイズを維持して調整した。仕上げのcommit `70a28e5` も含め、PR #18はmainへマージ済み。

- 右履歴はユーザーを右寄せ、しずくを左寄せにする。左右に28px / 20pxの余白を設け、短文も同じ始点に並ばないようにした。既存の淡い色・14px・最大3件・2行省略・読み上げ用話者名は維持。並び順ではなく実際の話者クラスで判断する。
- 色・文字の太さ・ターン間隔も変える案を実画面で比較したが、過去の返答が強く目立つため見送った。新しい枠・ラベル・アイコンは追加していない。
- 設定のカメラ項目「視線」はキャラクターの目線ではなくカメラの注視点を動かすので、「上下の向き」へ名称だけ変更した。値・処理は変更していない。
- 1440×900、1024×768、390×844で、同じ実VRMと固定文・開眼姿勢による修正前後を比較。履歴の短文・長文・連続したユーザー発言を確認した。比較画像は表示用fixtureであり、実音声や外部AIの評価ではない。
- スマホの通常画面・全文履歴・セリフ欄・入力欄に明らかな問題は見られず、変更しない。760px以下で右履歴を隠す仕様も維持する。

## 2026-11-13 目線と細部の調整

通常対話のカメラを中立時の目の高さへ合わせ、LookAtの中心もカメラへ向ける。構図の注視点 `.82H`、表示範囲 `.58H`、机と背景は維持。頭・首を固定せず、体験の画角と視線は変更しない。3候補の実VRM比較、数値、検証範囲は[調整記録](evaluations/dialogue-eye-contact-2026-11-13.md)に残した。

直近履歴の枠と見える話者名を外し、読み上げ用の名前は保持する。入力の選択は「話し方 / ふつう」、音声エラーは短くして詳細へつなぐ。次の返答待ちに前の文を「考え中…」として見せない。セリフの読みやすさと全文への導線は維持する。

## 2026-11-13 月明かりの対話シーン

部屋の奥行きと大きなキャラクターは参考A、画面端に履歴を添える配置は参考Bから着想を得た。しずくを中央に配置し、右端は最大3件、長文は下部の3行から全文へ開く。760px以下では履歴をボタンから開く。スマホ幅でも入力欄と送信／停止が画面内に収まることを確認する。 [参考A](https://www.twitch.tv/mutsukinemo/clip/TenuousCrypticKoupreyThisIsSparta-luUnUyUDu7SplXoS)・[参考B](https://chzzk.naver.com/video/33554)

`DialoguePresentation.tsx`のReact rootにセリフ、履歴、履歴dialogをまとめる。生成中のセリフは暫定扱い。停止や失敗で暫定文を取り除き、最後の確定済みセリフへ戻る。従来のVRM Viewerをモード間で移動し、セリフの更新と独立した描画を保つ。テキスト入力、設定、録音、音声、記憶の操作には従来のコントローラを使う。画面全体をReact化したわけではなく、Reactと既存DOM操作が同じ表示領域を更新しない境界を設ける。Reactとオリジナル背景をバンドルし、利用時の外部通信やAPI料金は増えない。この刷新時点ではJavaScriptが約222kB増えた。

背景は組み込み画像生成で作成し、約64kBのWebPへ変換した。生成時の指定は、16:10のアニメ会話ゲーム向け背景、青い月明かりの読書室、左に窓・本・ランプ、中央にVRMを置く余白、右に文字を載せる壁、手前に木の机とカップ。画像内の人物、ロゴ、UI、文字、配信素材は除外した。

<details>
<summary>背景生成プロンプト</summary>

> Use case: stylized-concept. Create an original anime visual novel environment plate for the background of a live VRM conversation. 16:10 landscape, eye-level straight-on, a quiet Japanese moonlit reading room in blue hour, clean hand-painted animation background, softly simplified shapes and deliberate atmosphere. One tall blue window on the left with a small waning moon and pale blue curtains, a low shelf and two simple books far left, a small warm amber lamp in the left midground, muted pale blue wall and warm paper surfaces. Leave the central 45% with softly lit low-detail wall and empty space for a large 3D character, and the right third as a calm slightly darker blue wall with minimal visual noise for a few overlaid conversation lines. Across the bottom 12% a low continuous foreground pale wooden desk with a single white teacup at the far left, eye-level seated perspective. Restrained slate blue, ink indigo, pale cloud blue, warm ivory, small amber accents. Gentle warm domestic atmosphere, diffuse moonlight, visually strong but clean hand-drawn art direction. Room only, strictly no human, no character silhouette, no UI, no text, no logo, no watermark, no neon, no copied streamer props. Full bleed.

</details>

確認は1440×900と390×844の長文・履歴、生成途中からの停止／失敗、VRM未読込、既存の設定・モード切替・録音・先行音声を対象とする。`SCENE_SCREENSHOTS=1`で追加のブラウザテストからスクリーンショットを取得できる。実マイクとスマートフォン実機の操作感は利用者による確認を残す。

## 2026-09-05 改修時の記録

2026-09-05 / v0.6.0からの作業版。機能追加ではなく、会話画面の読みやすさと操作の整理を対象にする。

## 主な利用場面

ローカルでAvatarに話しかけ、返答・表情・発話を確かめる3〜5分のデモ。主な端末はPCと仮定し、スマートフォン幅でも入力を見失わないことを確かめる。実利用者テストは別途必要。

## 変更前の観察

- 会話本文12px、話者名8px、音声状態9px。通常の閲覧距離では読みづらい。
- 設定と会話が同じスクロール領域にあり、調整すると入力の位置が動く。
- 390×844の会話後、入力欄の下端は830px。音声エラーや設定は画面外へ続く。
- 背景の格子・光の輪・粒子と多数の小さな枠が、Avatarと会話以外にも視線を引く。
- VRMの表示、Textへのフォールバック、会話連動の状態変化は維持する。

## 方針

主役はAvatarと会話。PCは大きなステージと読み物としての会話欄を横に並べ、スマートフォンはAvatar・会話・入力の順に配置する。本文は16px、補助情報は原則12〜14px。白と青を軸に、線と余白で領域を分ける。

会話画面に常時必要なのは入力・送信/停止・マイク・返答の詳しさ・接続先。音声、明示登録の記憶、モデル/表情/カメラ/診断はネイティブのdialogへまとめる。設定パネルはキーボードで開閉でき、閉じたら起点へ戻る。

PCのキャラクター調整中は、背景を暗くしたりぼかしたりしない。表情やカメラの結果を同じ明るさで見ながら調整するため。スマートフォン幅の設定は全画面なので、Avatarの結果は閉じて確認する。

背景はキャラクターの月のモチーフを静かに残し、格子や浮遊粒子は外す。状態は文字でも示し、色だけに依存しない。モデルや演技の処理は変えない。

音声が失敗しても入力を隠さない。短い状態表示から詳細と回復方法に到達できるようにする。Mockは実際のLLMと区別して表示する。

## 実装上の選択

- 既存のTypeScript、CSS、Three.js、UIControllerを使う。追加ライブラリ・費用なし。
- 既存の操作IDとUIActionsの境界を維持し、APIや記憶保存の仕様を変更しない。
- 設定はブラウザ標準のdialogを採用。背景の操作禁止とEscapeは標準動作に任せ、Tabが最後の項目からブラウザの操作欄へ移るChromiumの挙動には、先頭へ循環する小さな境界処理を加える。
- UI改善スキルv2の「実画面を同じ条件で比較」「主操作と補助操作を分ける」「自動検査と利用者テストを区別」を適用する。
- Avatarの上に会話を重ねる案は、長文とモデルの重なりを避けるため今回は採用しない。

## 確認条件

同じVRM、Mockの「こんにちは」への返答、100%相当・deviceScaleFactor 1、1440×900と390×844で変更前後を比較する。追加で1024px幅、320px幅、短い画面、長文、空、エラー、設定のキーボード操作、送信・停止・再開を確認する。

設計の狙いと、実際に確認した結果は分けて記録する。視覚の好み・読み取り時間・実機のソフトキーボード・実際の音声品質は、自動テストのみでは合格としない。

## 体験画面のコピー方針（2026-09-09）

初回プレイの利用者フィードバックに基づき、作者による雰囲気の説明・紹介文・余韻の指示を外す。
雰囲気は絵、余白、しずくの台詞で伝える。通常対話の画面は変更しない。

- 常時表示は物語の題、操作、選択状態、しずくの返事を中心にする。調査済みは対象のチェックで示す。
- 手掛かり・操作方法・履歴はそれぞれ必要な時に開く。必須の手掛かりはしずくの返事にも残す。
- 相談欄には外部送信・従量課金か定型応答かを短く表示。送信範囲、保存、現在の返事の生成元は同じ開閉欄の中へ。
- 正常待機中の音声エンジン説明は出さない。処理中・失敗・自動再生拒否は短い案内を出し、失敗の詳細を開けるようにする。
- 文字を減らすために文字サイズを縮めない。削減後もキーボード、狭い画面、異常時の回復操作を確認する。
