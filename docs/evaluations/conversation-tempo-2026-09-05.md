# Conversation tempo — 2026-09-05

Work started September 5; final verification continued into September 6 (JST).

Follow-up: [September 6 rendering diagnosis](rendering-tempo-2026-09-06.md) separates headless-shell CPU rendering from GPU-backed Chromium, records a real-voice Mock rerun, and fixes the FPS display. The historical measurements below are unchanged; the hardware-accelerated Mock check is no longer pending, but real-LLM and owner listening checks remain open.

Later update: [September 6 real-API check](real-api-tempo-2026-09-06.md) completed three Backend Text/performance cases. The real-API server launch succeeded; local speech-engine startup was rejected separately. The current-UI real-API-plus-voice and owner listening checks remain open.

## Scope and result

One improvement: reuse the local VOICEVOX HTTP client across health checks and sentence synthesis. Model, prompt, speaker, prosody, sentence boundaries, memory, and Avatar controls are unchanged. No dependency was added. Ordinary Mock remains free and sends no conversation to an external AI.

On this Windows PC, constructing an HTTPX client took roughly 0.53–0.64 seconds even for a local `/version` request. Previously every sentence reconstructed that client. The Backend now owns one lazy connection pool, ignores environment proxies for local speech, and closes the pool through the application's shutdown lifecycle. A failed speech request can still be retried; Text fallback is unchanged.

This follows [HTTPX's guidance on reusing async clients](https://www.python-httpx.org/async/#opening-and-closing-clients). OpenAI's [latency guide](https://developers.openai.com/api/docs/guides/latency-optimization) informed the decision to measure the pipeline instead of changing the model without evidence.

## Local paired measurement

VOICEVOX 0.25.2, speaker 14, existing Character Profile, Intel Core i7-10870H (8 cores / 16 logical processors). Four self-authored Japanese phrases, two rounds; order fresh/reused in round 1 and reused/fresh in round 2. Voice-model loading was warmed before both modes. No browser or test suite was running during this paired comparison.

The `fresh` mode reconstructs the client for each phrase, reproducing the previous connection lifecycle. Both modes use the same current synthesis implementation and local destination; this isolates connection reuse, not all historical version differences.

| Characters | Round | Fresh client | Reused client | Saving |
| ---: | ---: | ---: | ---: | ---: |
| 11 | 1 | 1,322 ms | 770 ms | 552 ms |
| 7 | 1 | 1,222 ms | 646 ms | 576 ms |
| 22 | 1 | 1,946 ms | 1,466 ms | 480 ms |
| 40 | 1 | 3,140 ms | 2,726 ms | 414 ms |
| 11 | 2 | 1,579 ms | 967 ms | 612 ms |
| 7 | 2 | 1,450 ms | 788 ms | 662 ms |
| 22 | 2 | 2,301 ms | 1,652 ms | 649 ms |
| 40 | 2 | 3,302 ms | 2,599 ms | 703 ms |

- Median paired saving: **594 ms per synthesis** in this small sample.
- Fresh/reused median: 1,762.5 / 1,216.5 ms.
- SHA-256 equality: **8/8 paired WAVs identical**, not merely the same length.
- No WAV or real conversation was persisted. External AI requests: **0**.
- This does not establish a 594 ms improvement in full conversation latency, every PC, cold startup, or every later sentence gap. Synthesis may overlap playback.

Run with local VOICEVOX already listening on `127.0.0.1:50021`:

```powershell
cd backend
..\.venv\Scripts\python -m scripts.evaluate_speech_connection
```

The script uses explicit local Mock settings, not environment-selected OpenAI settings. It makes 17 local synthesis requests (one warm-up, eight pairs) and closes all owned clients.

## Browser integration and remaining limitation

Three fixed inputs (greeting, fatigue, beginner explanation) were played with the **real local VRM and real VOICEVOX, but Mock dialogue**. All three completed playback with vowel timing and no page exceptions. This checks wiring and completion, not AI reply quality or a human assessment of lip-sync accuracy.

The headless browser uses `ANGLE / SwiftShader`, including when no software-rendering flag is supplied. Full-size VRM rendering competes with local synthesis and main-thread work. The diagnostic run observed playback-start times of 8,206 / 13,084 / 9,376 ms. These are slow and **not a conversational-tempo pass**. They must not be presented as hardware-accelerated desktop measurements or evidence that an API model is slow. Some diagnostic runs overlapped automated checks; only the isolated local paired measurement above is used to quantify the optimization.

The final browser harness observes response bodies without holding up the application's fetch, checks that the actual VRM loaded, and records renderer, first text, completed text, sentence request/body-ready, and media playback/ended timestamps. The existing UI label `初文` was corrected to `初字`: that metric is the first text delta, not a complete sentence. `発話` is the resolution of browser `audio.play()`, not physical speaker onset; microphone recognition and manual confirmation are outside it.

Final harness rerun, without a concurrent test suite: three cases completed, 11 sentence segments, all actual VRMs loaded, zero page exceptions. First-text times were 282 / 305 / 313 ms; playback-start times were **6,851 / 11,688 / 7,448 ms**. Renderer remained SwiftShader. Removing observation-related fetch blocking did not make this software-rendered environment pass the tempo gate; the renderer/CPU-contention explanation is a hypothesis, not an isolated causal benchmark.

The intended real-OpenAI evaluation launch was rejected by the execution environment before starting. No alternative route was used to send those requests. The owner has authorized a small existing-API evaluation, but **no live OpenAI rerun or prompt/model comparison was completed in this change**.

## Repeatable browser harness

This is separate from ordinary tests. It uses a dedicated RAM-only Backend and must not replace the normal demo server. It does not open the owner's SQLite database. The real mode accepts only three fixed inputs, balanced style, at most three attempts, no SDK retries, and at most 240 output tokens per request. Its attempt cap is not an account-wide billing limit.

Start local VOICEVOX, then use separate terminals from the repository:

```powershell
# Terminal 1: local-only conversation, real local speech.
.\.venv\Scripts\python -m uvicorn scripts.tempo_server:create_mock_app --factory --app-dir backend --host 127.0.0.1 --port 18001 --no-access-log

# Terminal 2
cd frontend
$env:BACKEND_PROXY_TARGET = "http://127.0.0.1:18001"
npm run dev -- --port 15174 --strictPort

# Terminal 3, after Backend and Frontend are ready
cd frontend
node scripts/evaluate-conversation-tempo.mjs ../backend/.runtime/tempo-browser.json --mock
```

The authorized opt-in real mode uses `scripts.tempo_server:create_app`, Backend `DIALOGUE_PROVIDER=openai`, `OPENAI_MODEL=gpt-5.6-luna`, and `DIALOGUE_MAX_OUTPUT_TOKENS=240`, with a Backend-only API key. `RUN_REAL_TEMPO_EVALUATION=1` must be set for that Backend and the evaluation command; omit `--mock` only for this real mode. Restart the evaluation Backend to start a new bounded run. Do not put keys in scripts or Frontend variables. Stop both terminals and any owned voice engine after testing.

## Gates

- Verification: Backend Ruff, 81 pytest tests and pip check passed; Frontend typecheck, ESLint, 83 unit tests and Build passed; all 13 browser operation tests passed. The existing large-bundle warning remains (about 885 kB / 223 kB gzip). No commit, push, or visibility change was performed.
- Automated: client reused once; pool closed on shutdown; recovery after connection failure; existing voice settings and timing retained; opt-in/cap/input guards; Mock ignores an inherited API environment.
- Pending: hardware-accelerated browser end-to-end measurement, real LLM few-turn evaluation, physical microphone/speaker, listening comfort, and a continuous 3–5 minute owner demo.
- Next major capability remains conversation tempo. No Vision, new Agent framework, automatic microphone sending, or new paid service was added.

Notion roadmap wording: "Local voice connection overhead reduced (8 paired measurements, median 594 ms; identical audio). Browser real-voice integration checked with Mock. Hardware-accelerated end-to-end/real-LLM and owner listening evaluation remain open." Notion itself was not updated.
