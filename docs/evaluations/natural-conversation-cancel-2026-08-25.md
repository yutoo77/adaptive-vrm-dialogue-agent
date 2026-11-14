# Natural Conversation Cancellation Evaluation — 2026-08-25

## Purpose

Evaluate whether a user can stop an active dialogue generation as one end-to-end action, rather than only hiding a loading indicator in the browser. A successfully cancelled turn must not add an assistant message, session history, or explicit long-term memory, and the Avatar must return to `idle`.

This is the first bounded slice of `v0.4 Natural Conversation`. It does not claim streaming output or evaluated real-provider conversation quality.

## Contract

| Situation | Expected result |
| --- | --- |
| Dialogue generation is active | The send button becomes `応答を停止` and remains keyboard accessible |
| Stop is accepted before commit | The backend cancels the session's provider task and returns `cancelled: true` |
| Cancelled prompt contains `覚えておいて：...` | Neither session history nor SQLite long-term memory is changed |
| Stop succeeds | No assistant message or error is shown; performance, speech, mouth shape, and gesture state return to idle |
| No cancellable generation exists | The backend returns `cancelled: false`; the frontend does not present this as success |

The backend keeps one `ActiveDialogue` record per session. Cancellation acceptance and commit start use the same lock, so only one of them can win. Once cancellation is accepted, the handler checks the flag before any conversation or long-term-memory mutation. Once commit has started, cancellation returns `false` instead of claiming that a saved turn was removed.

## Deterministic backend scenario

The API test uses a local `BlockingProvider` that waits at an asynchronous cancellation point. It sends `覚えておいて：保存しない` in one thread and then calls:

```text
DELETE /api/dialogue/sessions/{session_id}/active
```

Observed assertions:

- the cancellation endpoint returned HTTP 200 with `cancelled: true`;
- the original dialogue request ended with HTTP 409 and code `dialogue_cancelled`;
- the provider received `CancelledError`;
- session history remained empty;
- persistent-memory count remained zero;
- a later cancellation returned `cancelled: false`.

No external API, paid service, real personal data, or VOICEVOX engine was used.

## Frontend and browser evidence

- `DialogueClient` validates the cancellation response and rejects malformed data.
- `DialogueController` sends the generated session ID, stops speech immediately, waits for backend acknowledgement, suppresses the assistant message only on accepted cancellation, and reports a failed or missing target honestly.
- `UIController` reuses the send button as `応答を停止` while keeping the text field locked against a second submission.
- The Playwright scenario holds a Mock dialogue request, presses the stop button, and checks `idle`, an enabled send button, no assistant message, and the cancellation notice.
- The full local suite recorded for this slice is 53 backend tests, 64 frontend unit tests, and 5 browser tests.

## Failure and boundary cases

| Case | Current behavior | Remaining limit |
| --- | --- | --- |
| Stop endpoint is unreachable | A public error is shown; success is not claimed | The upstream request may continue until its own timeout |
| Generation already entered commit | Cancellation returns `false` | The completed turn remains because cancellation was too late |
| Provider cooperates with task cancellation | Awaiting work receives cancellation promptly | Actual arrival time depends on the provider and network stack |
| Provider suppresses or delays cancellation | The accepted-cancel flag still prevents later persistence | Upstream computation may not stop immediately |
| VOICEVOX is already synthesizing | Browser speech, mouth shape, and queued gesture are reset | The normal VOICEVOX endpoint may continue engine-side synthesis after client disconnect |
| Real OpenAI provider | Code uses the same provider-task boundary | No real request or cost/latency evaluation was performed |

## Result

The local Mock path satisfies the cancellation contract across API, controller, UI, and browser layers. The important invariant is stronger than visual recovery: an accepted stop cannot cross into conversation or explicit-memory persistence.

The next Natural Conversation evidence should measure first-token, text-complete, and speech-start latency with an explicitly approved real provider, then compare streaming or staged display. This evaluation must remain separate because it would send dialogue text externally and incur API cost.
