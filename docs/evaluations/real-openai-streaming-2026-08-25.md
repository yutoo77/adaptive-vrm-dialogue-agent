# Real OpenAI Streaming Evaluation — 2026-08-25

## Purpose

Verify that the new dialogue path exposes useful reply text before the final Structured Output completes, while keeping raw JSON, unvalidated performance instructions, cancelled turns, and secrets out of the user-visible or persisted state.

This is one fixed smoke run. It does not establish general latency, naturalness, or statistical improvement over the earlier non-streaming four-turn evaluation.

## Safety and cost boundary

- Model: `gpt-5.6-luna`
- API: OpenAI Responses API streaming through `openai==3.0.0`
- Request limit: one completed request and one cancellation probe
- Output cap: 240 tokens per request
- Data: only the fictional person `ユウ` and a blue umbrella
- Tools, Web search, files, images, audio, real memories, research data: none
- Response storage: `store=False`
- API key, upstream request ID, and full response text: not printed or committed

The implementation follows the Responses API event boundary: visible text is derived from `response.output_text.delta`, while usage and the validated Pydantic object are accepted only after the completed response. See the [official Responses API streaming reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create).

At the evaluation date, the [official GPT-5.6 Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna) listed $0.20 per million input tokens and $1.20 per million output tokens. Pricing can change.

## Implemented boundary

1. OpenAI streams a `StructuredDialogueOutput` containing `reply` and a bounded `performance` object.
2. The Backend decoder emits only complete decoded characters inside the `reply` JSON string. Split escapes and Unicode surrogate pairs remain buffered until safe.
3. FastAPI sends typed NDJSON events: `start`, `text_delta`, then `complete` or a safe `error`.
4. The Browser incrementally updates one temporary assistant message.
5. Only the final Pydantic-validated reply and `PerformancePlan` may cross the commit boundary into RAM history, explicit SQLite memory, speech, or avatar performance.
6. Cancellation removes the temporary message and does not commit the turn.

## Observed result

| Metric | Observed |
| --- | ---: |
| Visible text deltas | 42 |
| First visible text | 3,321 ms |
| Validated text complete | 4,117 ms |
| Readable lead time | 796 ms |
| Final reply length | 49 characters |
| Input tokens | 1,196 |
| Output tokens | 86 |
| Cached / reasoning tokens | 0 / 0 |
| Completed-request cost | $0.0003424 |

All six fixed checks passed:

- more than one visible delta;
- first text arrived before final completion;
- concatenated visible text exactly matched the validated final reply;
- raw `reply` / `performance` JSON keys were never exposed as text;
- performance intensity stayed at or below 0.7;
- performance cues stayed at or below two.

The measured 796 ms lead means this request became readable before the full response completed. It does **not** prove that every request is 796 ms faster, and it does not make the underlying model finish sooner.

## Cancellation probe

The second fictional request was cancelled 100 ms after it started. The local streaming coroutine settled in 0 ms and returned no usage object.

This confirms cancellation propagation at the observed local asynchronous boundary. It does not prove that OpenAI stopped all upstream computation or billing. The cancelled request cost remains unknown and is excluded from the $0.0003424 completed-request estimate.

## Automated evidence

- Partial structured JSON split every three characters reconstructs only the reply, including split newline, quote, Japanese, and emoji escapes.
- Mock API streaming emits multiple deltas and commits exactly one final turn.
- A provider cancelled after emitting partial text commits no Session or SQLite memory.
- DialogueClient parses NDJSON across arbitrary network chunk boundaries.
- DialogueController records incremental text and the first-text / text-complete stages separately.
- Playwright observes the temporary Streaming state, final state, cancellation cleanup, and Mobile layout.

## Reproduction

This command sends paid external API requests. Run it only after explicit owner approval and with a Backend-only key:

```powershell
cd backend
$env:DIALOGUE_PROVIDER = "openai"
$env:OPENAI_MODEL = "gpt-5.6-luna"
$env:DIALOGUE_MAX_OUTPUT_TOKENS = "240"
$env:RUN_REAL_OPENAI_STREAMING_EVALUATION = "1"
..\.venv\Scripts\python -m scripts.evaluate_openai_streaming
```

Without the explicit `RUN_REAL_OPENAI_STREAMING_EVALUATION=1` gate, the script exits before creating a provider request.

## Limits and next evidence

- One request cannot establish variance or user-perceived naturalness.
- First visible text was still 3.3 seconds after send; Streaming reduces silent waiting but does not remove model latency.
- VOICEVOX starts after the full validated reply. Sentence-level TTS could start earlier, but requires ordering, interruption, lip-sync, and performance-cue contracts.
- Performance becomes available only after final Structured Output validation, so the avatar remains in `thinking` while partial text is shown.
- The Browser uses bounded NDJSON rather than resumable SSE. Local single-user operation does not need reconnection, but Internet deployment would require a different reliability and authentication design.
