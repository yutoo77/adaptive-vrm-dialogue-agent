# Streaming Speech Evaluation — 2026-08-25

## Purpose

Measure whether a closed first sentence can reach local VOICEVOX before the complete Structured Output is available, without moving conversation memory, the final performance plan, or external data boundaries forward.

This is one fixed smoke run. It is not a user study, a latency distribution, or proof that every reply starts 2.9 seconds sooner.

## Implemented boundary

1. OpenAI reply text arrives through `response.output_text.delta` and the Backend exposes only decoded characters inside `reply`.
2. The Browser keeps incomplete words buffered. Only text ending in `。！？!?` or a newline becomes a speech segment. Punctuation-free text is bounded at 120 characters, preferring a comma or whitespace.
3. VOICEVOX synthesis is sequential while audio playback is independently queued in the same order, allowing the next sentence to be prepared during the current sentence.
4. A provisional sentence may be spoken before the final response object exists, but it is never added to Session or SQLite memory. Final memory and `PerformancePlan` still require the completed Pydantic object.
5. Cancellation or dialogue failure aborts active synthesis, stops audio and lip sync, removes queued segments, and discards the temporary assistant message.
6. If the accumulated deltas differ from the final reply, the provisional queue is discarded and the validated full reply is regenerated. The Backend also rejects a mismatched OpenAI stream before commit.

The external stream follows the [official OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create): the request uses Structured Outputs, streaming, a fixed output-token cap, and `store=False`.

## Safety and cost boundary

- External model: `gpt-5.6-luna`
- OpenAI requests: exactly one completed request
- Local VOICEVOX requests: one first-sentence synthesis and one full-reply comparison
- Data: only the fictional person `ユウ` and a blue umbrella
- Output cap: 240 tokens
- Tools, Web search, files, images, microphone, real memories, and research data: none
- API key, upstream request ID, reply text, and WAV data: not printed or committed
- Known completed OpenAI request cost: $0.0003892 at the 2026-08-25 [official GPT-5.6 Luna pricing snapshot](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

## Real OpenAI plus VOICEVOX result

VOICEVOX 0.25.2, speaker ID 14 (`VOICEVOX:冥鳴ひまり`, normal style) was used locally.

| Stage | Observed |
| --- | ---: |
| Visible text deltas | 60 |
| First visible text | 3,355 ms |
| First closed sentence | 3,602 ms |
| First-sentence synthesis | 2,540 ms |
| First-sentence WAV ready | 6,142 ms |
| Validated text complete | 4,702 ms |
| Full-reply synthesis after completion | 4,317 ms |
| Baseline full-reply WAV ready | 9,019 ms |
| Projected WAV-ready lead | 2,877 ms |
| First sentence / full reply | 38 / 78 characters |
| First sentence / full audio | 6,133 / 12,875 ms |
| OpenAI usage | 1,196 input / 125 output tokens |

All six fixed checks passed: multiple deltas, exact final-text reconstruction, first sentence before completion, strict first-sentence prefix, and valid WAV for both speech requests.

The 2,877 ms value compares WAV-ready timestamps in this single run. It does not include Browser audio decoding, autoplay scheduling, audio-device latency, or a human rating, so it is described as a projected lead rather than measured audible improvement.

## Local VOICEVOX verification

The existing ten public, synthetic Japanese cases were rerun against the same local Engine:

- 10 attempted / 10 succeeded;
- synthesis latency: 2,108 ms minimum, 2,388 ms median, 3,262 ms maximum;
- WAV and timing parsing succeeded for every case;
- no generated WAV was written to the repository.

These values are machine- and warm-up-dependent. They are evidence for this environment, not a VOICEVOX performance guarantee.

## Automated evidence

- Japanese sentence boundaries remain buffered across arbitrary model deltas.
- Repeated punctuation and closing quotes stay with the preceding sentence.
- Punctuation-free responses use a bounded soft break.
- Closed sentences synthesize and play before final reply completion.
- Synthesis remains sequential and playback remains ordered.
- Final mismatch stops provisional audio and falls back to the validated reply.
- Cancellation aborts active synthesis and removes replay data.
- VOICEVOX failure leaves the text response usable.
- Playwright observes `/api/speech` being requested while the assistant message is still marked as Streaming.

## Reproduction

This command sends one paid external OpenAI request and two local VOICEVOX requests. Run it only after explicit owner approval, with VOICEVOX running and a Backend-only API key:

```powershell
cd backend
$env:DIALOGUE_PROVIDER = "openai"
$env:OPENAI_MODEL = "gpt-5.6-luna"
$env:DIALOGUE_MAX_OUTPUT_TOKENS = "240"
$env:RUN_REAL_OPENAI_SPEECH_EVALUATION = "1"
..\.venv\Scripts\python -m scripts.evaluate_openai_streaming_speech
```

Without `RUN_REAL_OPENAI_SPEECH_EVALUATION=1`, the script exits before reading provider configuration or sending a request.

## Limits and risks

- Spoken provisional text cannot be unheard. Cancellation prevents later segments and persistence, but it cannot retract audio already played.
- The final `PerformancePlan` arrives after the reply JSON. If audio starts earlier, the first segment uses neutral playback speed and the confirmed emotion/gesture is applied when the final plan arrives.
- Very long text without punctuation may be split at a comma or the 120-character limit, which is bounded but not linguistically perfect.
- Sequential local synthesis avoids overloading VOICEVOX, but a slow next synthesis can create silence between sentences.
- The Browser queue is not resumable across reloads and is intended for one local user, not Internet deployment.
