# Demo Guide

This guide provides a repeatable three-minute demonstration and a one-minute short version. Use the default Mock Provider so the demo has no API charge and does not send dialogue text to an external AI service.

## Before the demo

1. Complete `./setup.ps1` and start VOICEVOX if voice output is required.
2. Put a permitted VRM at `frontend/public/models/private/character.vrm`, or prepare it for selection in the browser.
3. Run `./start_demo.ps1` and confirm `月白 しずく`, the `Mock` provider badge, response style `自然に`, and the Avatar or placeholder. Mock means fixed test replies, not a local LLM. The model name and Character Profile version are under `表示を調整` (version in `診断情報`).
4. If voice output is part of the demo, open `設定 → 音声`, then close settings, send one short message, and confirm that VOICEVOX plays it. The short failure message opens the full details; a healthy idle state is not repeated on the main screen.
5. Do not show API keys, local files, terminal logs, microphone device names, or private long-term memory in a recording.

## Three-minute route

### 1. Problem and design — 30 seconds

Explain that the goal is not to place unrelated AI features on one screen. The application connects a dialogue result to understandable status, voice, facial expression, gesture, and recoverable fallbacks while keeping the default path local and free.

### 2. Text-to-performance vertical slice — 60 seconds

Send `何ができるの？`.

Point out that the header name, version, short message label, voice defaults, and performance limits come from the same versioned Character Profile. The current VRM is still a separately licensed sample, so do not describe the original Avatar as complete.

Show the flow:

1. the Avatar enters `thinking`;
2. reply text appears incrementally through the typed NDJSON stream;
3. the final schema validates before the UI displays the selected emotion, intensity, gesture, and cue count;
4. VOICEVOX begins from the first closed sentence while later text is still arriving;
5. the mouth follows the five-vowel timeline and the Avatar returns to a weakened emotional baseline, or `idle` when the result is neutral.

Mention that arbitrary bone names and scripts are not accepted. The plan is limited by a validated schema.

Change `返答` from `自然に` to `詳しく` and send the same prompt again. Explain that the user explicitly controls response length; the application does not infer skill or a hidden psychological profile from voice or text. The four allowed values are validated in the browser and backend, and the selection is not persisted after reload.

Optional continuity check: send `今日は疲れた` and then a neutral follow-up such as `そうなんだ`. The second response should show `余韻` rather than starting a new large gesture, while the weakened gentle expression, gaze, and breathing remain. Then send `少し気持ちが軽くなった` and confirm that the explicit recovery replaces the old gentle state. This state remains in RAM for at most two turns and is cleared by `新しい会話`.

If a response remains in `thinking`, the send button changes to `応答を停止`. Stopping returns the Avatar to `idle` without adding an assistant message or saving that turn to session or long-term memory. The default Mock is intentionally fast, so use the automated browser scenario and the cancellation evaluation record as repeatable evidence instead of adding an artificial production delay only for the live demo.

### 3. Voice input and fallback — 40 seconds

Press the microphone button, say a short phrase, and let silence stop the recording. Show that the recognized text returns to the input box instead of being sent automatically. This gives the user a chance to correct a recognition error.

Before a voice demo, optionally run `.\start_demo.ps1 -PrepareVoiceInput` from the repository root. It loads only the cached recognition model into the running Backend, without recording or downloading; failure leaves Text available. This moves model loading earlier, not the remaining CPU inference or silence-detection delay. See the [measured limits](evaluations/transcription-latency-2026-09-13.md).

If microphone permission or transcription fails, show that Text input remains available.

### 4. Memory and user control — 30 seconds

Send `覚えておいて：好きな色は青`, then open `設定 → 記憶`. Show that only explicit content is persisted, it can be edited or deleted, and a new conversation clears the RAM session separately. Closing settings preserves the draft and returns keyboard focus to the opening button.

Do not store sensitive or real personal information in a public demo.

### 5. Evidence and limits — 20 seconds

Close with the test and evaluation evidence, then state the limitations: no Internet deployment, no semantic vector search, one Code-defined Character Profile, no original VRM yet, fixed Japanese emotion markers and a two-turn heuristic rather than broad or user-rated naturalness, already-played provisional speech cannot be retracted, no upstream cancellation or billing guarantee, and no guarantee of transcription quality in noisy environments.

For the separate cooperative experience, use the route below; do not replace or reset the ordinary dialogue demo.

## Cooperative experience — 月待ちの便り

1. Leave an unsent draft in `対話`, then choose `体験 → 書斎に入る`.
2. Inspect the window, letter and box. Shizuku reads both necessary conditions from the letter; hints are optional help, not required information.
3. Select each moon bookmark and a slot, then press `この並びで開ける`. Try a wrong arrangement to show that the board stays intact and no penalty is applied.
4. With full in the middle and the other two reversed, ask for a hint: Shizuku acknowledges the middle and points to the ordering clue. `もう少しヒント` gives a more concrete observation. `答えを見る` opens a confirmation; Escape or `まだ考える` preserves the board, history and hint level. The confirmed third hint reveals the sequence without unlocking anything. These operations make no LLM calls. Free consultation is scripted in Mock (also board-aware after reading the letter); OpenAI uses the configured paid API and only experience-local context.
5. Solve and read the quiet ending. Switch back to `対話` and confirm the draft and history remain. Returning to `体験` retains progress without automatically replaying old speech.

The solution is left-to-right **half / full / crescent** after inspecting the letter. This is an introductory ordering puzzle, not a claim of a difficult escape game or autonomous Tool-calling Agent. Do not reveal the solution before the user tries it.

Voice, VRM and the installed voice preferences are reused. With no VOICEVOX or VRM, use text and the placeholder. Progress is volatile: reload starts a fresh page; backend restart or idle expiry requires a new experience. A transport failure requires a state refresh rather than blindly resending a move. Restart asks for confirmation and affects only the experience.

Owner acceptance remains separate from automated checks: does Shizuku feel calm, is the next action discoverable, and does the collaboration feel worthwhile? Real microphone accuracy and naturalness of all possible AI answers are not certified by the puzzle tests.

## One-minute dialogue route

1. State the problem and local-first policy in 10 seconds.
2. Send `何ができるの？`, switch from `自然` to `詳しく`, and show Text, VOICEVOX, expression, gesture, and lip sync in 30 seconds.
3. Show the explicit-memory controls and automated test counts in 15 seconds.
4. State one measured limitation and the next improvement in 5 seconds.

## Recovery during a live demo

Before describing response speed, distinguish first text (`初字`), completed text (`本文`), and browser playback start (`発話`) in `設定 → 音声 → 診断情報`. These dialogue metrics start at send; they exclude microphone recognition and manual draft confirmation. The [tempo evaluation](evaluations/conversation-tempo-2026-09-05.md) reports a local connection optimization, not a completed natural-conversation performance gate.

The [rendering follow-up](evaluations/rendering-tempo-2026-09-06.md) measures real VRM and local speech with GPU-backed Chromium, but Mock replies. Do not present the faster test-browser numbers as an app-wide speedup or real-LLM conversational latency. Ordinary headless operation tests deliberately remain separate from hardware-dependent tempo evaluation.

The [real-API follow-up](evaluations/real-api-tempo-2026-09-06.md) verifies three Backend-only Text/performance responses. It does not include browser playback. The 3–5 minute natural-conversation demo is still an acceptance target, not a completed test.

Profile v1.1.0 has [a separate conversation-style evaluation](evaluations/conversation-style-2026-09-06.md): nine before/after cases and two identity refinements, without audio. For the next owner-approved OpenAI session, compare a short introduction, an ordinary explanation, good news, and a request to just listen. Check whether the words, voice and expression fit together; do not expect a gesture on every reply. Keep these live-model checks separate from the default free Mock demo and deterministic browser fixtures.

| Problem | Recovery |
| --- | --- |
| VRM is missing | Continue with the 3D placeholder, then select a permitted `.vrm` file. |
| VOICEVOX is unavailable | Continue the Text conversation; start VOICEVOX and reload for voice output. |
| Microphone is denied or silent | Use Text input. The app does not require Voice to continue. |
| Voice-input connection check fails | Use the reconnect control in place of the microphone. Drafts and puzzle progress remain; reconnect does not record. A later microphone press starts recording. |
| Previous transcription is still computing | Wait briefly and record again, or continue by Text. Cancelling the UI does not forcibly interrupt local inference. The app refuses another queued job and does not resend audio automatically. |
| Backend is offline | Keep the VRM viewer open, restart `start_demo.ps1`, then retry. |
| Port 8000 or 5173 belongs to another app | Stop that app or identify its PID; the launcher will not kill an unknown process. |
| Browser blocks autoplay | Use the replay button for the generated audio. |
| A response takes too long | Press the same button, now labelled `応答を停止`; wait for the idle notice before sending again. |

Voice preferences: in `設定 → 音声`, choose an installed speaking voice and adjust `速さ`, `高さ`, or `抑揚`. Use `声を試す` to hear a fixed local sentence, then stop it. Verify the draft and conversation remain unchanged. A new reply uses the selected settings; an already-started reply retains its original settings. Reload to verify persistence, and use `しずくの標準に戻す` to reset. Confirm the selected voice's credit before publishing audio. Details: [voice settings evaluation](evaluations/voice-settings-2026-09-06.md).

Evaluation details and failure cases are stored under [docs/evaluations](evaluations/).
