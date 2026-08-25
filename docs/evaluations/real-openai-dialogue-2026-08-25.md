# Real OpenAI Dialogue Evaluation — 2026-08-25

## Purpose

Evaluate the existing opt-in OpenAI boundary with a real paid request, instead of claiming conversation quality from Mock and Fake tests alone. The run covers four linked fictional turns, bounded structured performance output, response-style adherence, token usage, completed-response latency, and one cancellation probe.

This is a single fixed smoke evaluation. It is not a user study, a broad quality benchmark, or evidence that every conversation remains natural.

## Safety and cost boundary

- Model: `gpt-5.6-luna`
- API: OpenAI Responses API through `openai==3.0.0`
- Request limit: four completed requests and one cancellation probe
- Output cap: 240 tokens per request
- Data: only the fictional person `ユウ` and a blue umbrella
- Tools, Web search, files, images, audio, research data, real memories: none
- Response storage: `store=False`
- API key and upstream request IDs: not printed or written to the repository

At the evaluation date, the official model page listed `gpt-5.6-luna` at $0.20 per million input tokens and $1.20 per million output tokens. Pricing can change, so reruns must check the [current GPT-5.6 Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

`store=False` does not mean that no OpenAI-side retention is possible. OpenAI states that API data is not used to train models unless the customer opts in, while default abuse-monitoring logs may include prompts and responses for up to 30 days. Zero Data Retention is a separate approved account control. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## Fixed scenario

| Turn | Style | Purpose | Deterministic check |
| --- | --- | --- | --- |
| 1 | `balanced` | Add a fictional fact to RAM conversation context | Reply acknowledges the umbrella |
| 2 | `concise` | Recall the immediately preceding fact | Reply contains `青` and `右` in one or two sentences |
| 3 | `detailed` | Ask for an unknown birthday | States uncertainty, invents no numeric date, uses three to six sentences |
| 4 | `beginner` | Give simple anti-forgetting guidance | Keeps the umbrella topic and uses two to four sentences |

Every turn also checks non-empty text, performance intensity at or below 0.7, and at most two bounded cues. Pydantic Structured Output validation remains the stronger schema boundary; the keyword and sentence-count checks only test this fixed scenario.

## Observed result

| Case | Latency | Input tokens | Output tokens | Result |
| --- | ---: | ---: | ---: | --- |
| Fictional context seed | 5,190 ms | 1,189 | 71 | Pass |
| Recent-context recall | 1,768 ms | 1,266 | 56 | Pass |
| Unknown-fact boundary | 3,553 ms | 1,332 | 173 | Pass |
| Beginner guidance | 3,440 ms | 1,488 | 155 | Pass |

Summary:

- Completed turns: 4/4
- Fixed quality checks: 21/21
- Completed-response latency: min 1,768 ms, median 3,496 ms, max 5,190 ms
- Known usage: 5,275 input + 455 output = 5,730 tokens
- Conservative completed-request cost: `(5,275 × $0.20 + 455 × $1.20) / 1,000,000 = $0.001601`
- Cached input tokens reported by the API: 0
- Reasoning tokens reported by the API: 0 (`reasoning.effort=none`)

The concise recall answer was `ユウは青い傘を机の右側に置きました。`. The unknown-fact response explicitly said that the birthday was not present and should not be guessed. The beginner response retained both the blue umbrella and its previous location.

## Cancellation probe

The fifth provider request used the same fictional context and requested a detailed answer. The local task was cancelled 100 ms after it started and propagated `CancelledError` in 1 ms.

This proves that the current Python provider coroutine is cancellable at the observed asynchronous boundary. It does **not** prove that OpenAI stopped all upstream computation, and the cancelled response returned no token usage. Its final billable amount is therefore unknown and excluded from the $0.001601 completed-request estimate. The separate Mock-backed API evaluation remains the deterministic evidence that an accepted app cancellation does not persist conversation or explicit long-term memory.

## Reproduction

This command sends paid external API requests. Run it only with explicit owner approval and a Backend-only API key:

```powershell
cd backend
$env:DIALOGUE_PROVIDER = "openai"
$env:OPENAI_MODEL = "gpt-5.6-luna"
$env:DIALOGUE_MAX_OUTPUT_TOKENS = "240"
$env:RUN_REAL_OPENAI_EVALUATION = "1"
..\.venv\Scripts\python -m scripts.evaluate_openai_dialogue
```

Without the explicit `RUN_REAL_OPENAI_EVALUATION=1` gate, the script exits before creating a provider request.

## Limits and next evidence

- One successful run cannot establish general conversation quality or variance.
- Latency is end-to-end completed-response latency; time to first token is unavailable without streaming.
- Keyword checks can miss semantically wrong answers or penalize valid paraphrases.
- The scenario uses recent RAM context only. It does not evaluate semantic long-term-memory retrieval.
- No VOICEVOX generation was included, so speech-start latency and spoken performance consistency remain separate.
- The next Natural Conversation slice should measure first-text, text-complete, and speech-start timing through a bounded streaming or staged-response contract.
