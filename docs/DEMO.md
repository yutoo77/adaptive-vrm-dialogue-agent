# Demo Guide

This guide provides a repeatable three-minute demonstration and a one-minute short version. Use the default Mock Provider so the demo has no API charge and does not send dialogue text to an external AI service.

## Before the demo

1. Complete `./setup.ps1` and start VOICEVOX if voice output is required.
2. Put a permitted VRM at `frontend/public/models/private/character.vrm`, or prepare it for selection in the browser.
3. Run `./start_demo.ps1` and confirm the compact `ローカル` provider badge, the response style `自然`, and the selected VRM name, or the placeholder if no model is used.
4. If voice output is part of the demo, open `音声設定`, send one short message, and confirm that VOICEVOX plays it. A healthy idle state is intentionally not repeated on the main screen.
5. Do not show API keys, local files, terminal logs, microphone device names, or private long-term memory in a recording.

## Three-minute route

### 1. Problem and design — 30 seconds

Explain that the goal is not to place unrelated AI features on one screen. The application connects a dialogue result to understandable status, voice, facial expression, gesture, and recoverable fallbacks while keeping the default path local and free.

### 2. Text-to-performance vertical slice — 60 seconds

Send `何ができるの？`.

Show the flow:

1. the Avatar enters `thinking`;
2. the Mock Provider returns deterministic text and a bounded performance plan;
3. the UI displays the selected emotion, intensity, gesture, and cue count;
4. VOICEVOX plays the response;
5. the mouth follows the five-vowel timeline and the Avatar returns to `idle`.

Mention that arbitrary bone names and scripts are not accepted. The plan is limited by a validated schema.

Change `返し方` from `自然` to `詳しく` and send the same prompt again. Explain that the user explicitly controls response length; the application does not infer skill or emotion from voice or text. The four allowed values are validated in the browser and backend, and the selection is not persisted after reload.

### 3. Voice input and fallback — 40 seconds

Press the microphone button, say a short phrase, and let silence stop the recording. Show that the recognized text returns to the input box instead of being sent automatically. This gives the user a chance to correct a recognition error.

If microphone permission or transcription fails, show that Text input remains available.

### 4. Memory and user control — 30 seconds

Send `覚えておいて：好きな色は青`, then open `記憶`. Show that only explicit content is persisted, it can be edited or deleted, and a new conversation clears the RAM session separately.

Do not store sensitive or real personal information in a public demo.

### 5. Evidence and limits — 20 seconds

Close with the test and evaluation evidence, then state the limitations: no Internet deployment, no streaming response, no semantic vector search, no evaluated real-OpenAI style quality, and no guarantee of transcription quality in noisy environments.

## One-minute route

1. State the problem and local-first policy in 10 seconds.
2. Send `何ができるの？`, switch from `自然` to `詳しく`, and show Text, VOICEVOX, expression, gesture, and lip sync in 30 seconds.
3. Show the explicit-memory controls and automated test counts in 15 seconds.
4. State one measured limitation and the next improvement in 5 seconds.

## Recovery during a live demo

| Problem | Recovery |
| --- | --- |
| VRM is missing | Continue with the 3D placeholder, then select a permitted `.vrm` file. |
| VOICEVOX is unavailable | Continue the Text conversation; start VOICEVOX and reload for voice output. |
| Microphone is denied or silent | Use Text input. The app does not require Voice to continue. |
| Backend is offline | Keep the VRM viewer open, restart `start_demo.ps1`, then retry. |
| Port 8000 or 5173 belongs to another app | Stop that app or identify its PID; the launcher will not kill an unknown process. |
| Browser blocks autoplay | Use the replay button for the generated audio. |

Evaluation details and failure cases are stored under [docs/evaluations](evaluations/).
