# 月待ちの便り — 設計と境界

2026-09-09。通常の対話を保持したまま、別の「体験」で遊ぶ最初の一話。

## 体験

白・青・紙の色を基調にした静かな書斎。窓、手紙、小箱の3か所を調べる。
利用者には月の栞（半分・丸い・細い）が見え、しずくには手紙の裏面が読める。
裏面の手掛かりは「丸い月は真ん中に。細い月は、半分の月より後ろに」。
小箱の3枠へ左から栞を並べる。正解は half / full / crescent。天文学の知識は不要。
会話は静かで現代的な言葉。既存作品の台詞・固有設定・素材は持ち込まない。
制限時間、失敗罰、過度な喜び、突然の音や画面効果は使わない。

## 境界と完成条件

- 通常対話のDOM、下書き、履歴を破棄しない。モードを変えると進行中の発話・録音・生成を止める。
- 声とAvatar設定は共通。体験の進行・会話は別ID・別RAMストア。通常の記憶を読まず書かない。
- 切替で進行は保持する。ページ再読込・Backend再起動後の復元は今回保証しない。自動保存なしと案内する。
- ゲーム状態はサーバーが管理。LLMは解錠、栞の移動、成功判定を実行しない。
- 調査・配置・判定はAPI課金なしの固定処理。自由な相談のみ設定済み対話APIを最大1回使う。失敗時は固定の案内へ戻す。
- Mockでも最初から最後まで遊べる。実APIは自作の短い文だけで限定確認する。
- 通常対話への往復、途中停止、二重送信、API停止、誤答、成功、再開、狭い画面を確認する。

## API契約 v1

`POST /api/experience/sessions` body `{session_id}` は同じIDに対して冪等。session_idは16〜64文字の英数字・`_-`。
`GET /api/experience/sessions/{session_id}` は状態取得。期限切れ・不明IDは404（勝手に初期化しない）。
`POST /api/experience/action` body `{session_id, expected_revision, action, target?, arrangement?, message?}`。
actionは inspect / hint / arrange / submit / message。inspectのtargetはwindow / letter / box。
arrangeは長さ3、要素half / full / crescent / null。同じ栞の重複禁止。
messageは1〜500文字。他のactionは不要な引数を受け付けない。revision不一致は409。
`DELETE /api/experience/sessions/{session_id}/active` は未確定の相談生成を停止し `{cancelled:boolean}` を返す。

全ての取得・更新の成功レスポンスは同じsnapshot:

```typescript
interface ExperienceSnapshot {
  session_id: string;
  revision: number;
  phase: "active" | "solved";
  inspected: ("window" | "letter" | "box")[];
  hint_level: number; // 0..3
  arrangement: ("half" | "full" | "crescent" | null)[]; // exactly 3
  attempts: number;
  reply: string;
  performance: PerformancePlan; // existing bounded contract, intensity <= .45; no soft_bounce
  focus_target: "window" | "letter" | "box" | null;
  messages: {role: "user" | "assistant"; text: string}[]; // bounded, RAM only
  narration_provider: "scripted" | "openai";
  notice: string | null;
}
```

Startのreply例: 「小さな箱と、三枚の月の栞があるね。わたしは手紙の裏を読んでみる。そちらも、見てみてくれる？」
手紙を調べると裏面の2条件を両方開示する。必須情報をヒントに隠さず、ヒントなしでも一意に解ける。
hintは条件の言い換え・考え方・最終配置を段階的に開示する。手紙を調べる前のhintは調査を案内し、段階を進めない。
成功には手紙を調べたことと正しい配置を要する。誤答は配置を維持し、静かに再考を促す。
自由会話で正解と主張してもphaseは変わらない。許可済みの手掛かり以外の正解情報をLLMへ渡さない。

## Frontendモジュール境界

`ExperienceController` がクライアント、ビュー、RAMのsession_id/進行/下書きを所有する。
constructor(root:HTMLElement, callbacks) / enter():void / leave():void / dispose():void。
callbacks: onReply(text,performance), onBusyChange(busy), onFocus(target), onStop(), onMicrophoneToggle()。
公開メソッド: setDraft(text), setVoiceStatus({state,message}), setSpeechStatus({state,message,action}), toggleSpeechハンドラはcallbacks.onToggleSpeech。
発話・VRM・音声入力はmain.tsが共通設定で配線する。別のSpeechControllerを使い通常対話の再生データを守る。
モード切替・メイン配線は親担当。通常UIを変更せず、新しいhiddenの体験コンテナへ描画する。
UIは実行可能な盤面・選択・ヒント・短い会話を優先し、説明カードを並べない。
初回プレイ後の調整では、紹介用コピーとクリア後の作者の語りを削除した。正常Mockの案内も警告として出さず、`notice`は利用不可など注意が必要な場合だけ返す。
操作方法・通信/保存・返事の生成元は開閉欄へ移し、課金/外部送信の有無は相談欄に残す。音声の正常待機は静かにし、処理中・失敗・自動再生拒否は短い状態表示と詳細で伝える。

## 採用理由と限界

- 追加Framework、DB、ゲームEngineは不要。既存のTypeScript / FastAPI / VRM / VOICEVOXを使い、依存を増やさない。
- 書斎は自作SVG、操作はHTMLのbutton。画像生成や外部素材取得なしで、Keyboard操作と狭い画面に対応する。
- `WorkspaceModes`は既存のAvatar DOMを移動する。WebGLのcanvasとモデルを作り直さず、通常会話のDOMと下書きを残す。
- PCでは盤面の右にAvatarと相談をまとめ、返答が画面外に隠れる配置を避ける。体験時は顔を読める上半身フレーミングに切り替え、通常のカメラ設定そのものは上書きしない。
- 体験の音声は専用の`SpeechController`と`LipSyncController`を持つ。共有するのは設定とAvatarだけで、通常会話の再生データを上書きしない。
- `ExperienceSession`は取消の完了を待ってから再取得する。モードをすぐ往復しても古い応答を再生しない。通信結果が不明な変更は自動再送しない。
- Backendは32セッション、非活動4時間、履歴24件、相談API24回/セッション、同時4回に制限する。これはローカル使用の保護であり、認証や公開サービス用のRate Limitではない。
- 自由相談は本文全体の検証後に音声化する。通常対話の文単位Streamingと異なり、AI相談の待ち時間は残る。
- LLMへ許可するのは文章と制限付き演技のみ。強度は0.45以下、跳ねるしぐさは禁止。Structured Outputsは形式の検証であり、発言の正しさを保証しない。
- LLMが未確認の解錠を文章で語る、答えを推測する可能性は残る。盤面・成功表示の状態は変更できないが、文章の完全な制御は主張しない。
- 小さな3枚の配置問題であり、本格的な謎解きゲームでも、Toolを自律実行するAgentでもない。物語の量や難易度を増やす前に利用者の体験評価を行う。
- 視線は対象方向への短い控えめな反応。正確な3D物体注視や指差しではない。モデルによって表現差がある。
- 研究資料、実在参加者、他作品の設定は使わない。現在のVRMは従来の別途許諾されたサンプルのままで、独自モデル完成とはしない。

## 費用と外部送信

Mock、盤面操作、ヒント、VOICEVOXはローカルでAPI課金なし。OpenAI設定時の「相談する」だけ既存のAPIを1回呼ぶ（SDKの自動再試行なし）。APIキーはBackend環境変数のみで扱う。
外部へ送る内容は固定のしずく設定、今回の相談、この体験の直近履歴12件、開示済み条件、盤面などの状態。通常会話・長期記憶は送らない。
停止はこのアプリでの反映を止めるもので、上流の計算や請求の取消を保証しない。ブラウザ再読込後は別体験になるため、セッション上限はアカウント全体の予算上限ではない。
