# Adaptive Interaction Evaluation — 2026-08-25

## Purpose

Evaluate whether a user can explicitly control response length and explanation level without the application inferring ability, emotion, or preference from voice or dialogue text.

This is a bounded interaction control, not automatic personalization. The selected value is held in frontend memory only and resets to `balanced` after reload.

## Contract

| API value | UI label | Expected behavior |
| --- | --- | --- |
| `concise` | 短く | Conclusion first; normally one sentence and at most two |
| `balanced` | 自然 | Natural one-to-three-sentence answer with only necessary context |
| `detailed` | 詳しく | Conclusion followed by organized reason, steps, or cautions |
| `beginner` | やさしく | Avoid unexplained terminology and do not assume user ability |

Pydantic validates the request and TypeScript validates the response. Unknown values such as `auto-detect` are rejected instead of silently mapped. The same enum reaches both Mock and OpenAI provider boundaries.

## Fixed Mock scenario

Prompt: `何ができる？`

The deterministic Mock base answer was passed through each response style. No external API or paid service was called.

| Style | Characters | Observed output |
| --- | ---: | --- |
| `concise` | 41 | 今はText入力を受け取り、返答に合わせて考える・説明する状態へ切り替えられるよ。 |
| `balanced` | 69 | 今はText入力を受け取り、返答に合わせて考える・説明する状態へ切り替えられるよ。VOICEVOXの音声再生と口の動きにも対応しているよ。 |
| `detailed` | 99 | 今はText入力を受け取り、返答に合わせて考える・説明する状態へ切り替えられるよ。VOICEVOXの音声再生と口の動きにも対応しているよ。 理由や手順が必要なら、要点を分けて順番に詳しく説明するよ。 |
| `beginner` | 92 | 今は文字入力を受け取り、返答に合わせて考える・説明する状態へ切り替えられるよ。端末内で作った音声の再生と口の動きにも対応しているよ。 はじめて出てくる言葉には、短い説明を添えて話すね。 |

Result: all four valid values were accepted, produced distinguishable deterministic outputs, and the beginner path replaced project-specific terms in this fixed response.

## Automated evidence

- Backend unit tests cover all four instructions and Mock transformations.
- API tests cover the `balanced` default, all four values, response echo, and `422` for an unknown value.
- Provider tests confirm that OpenAI receives the fixed instruction derived from the selected enum. They do not make a real OpenAI request.
- Frontend tests cover request serialization, response validation, and selection propagation through the controller.
- Playwright changes the visible selector to `詳しく`, sends a Mock message, and checks for the detailed response marker.
- The full local suite result recorded with this change is 52 backend tests, 61 frontend unit tests, and 4 browser tests.

## Failure and boundary cases

| Case | Expected result | Evidence |
| --- | --- | --- |
| Missing request field from an older client | Backend uses `balanced` | API test |
| Unknown or inferred style name | Request is rejected with `422` | API test |
| Provider returns an unknown style | Frontend rejects the response | Client validation test |
| User changes selection during a request | Selector is disabled; the captured style stays with that turn | UI state and controller test |
| Reload | Selection returns to `balanced`; no profile is persisted | Architecture/code inspection |
| OpenAI unavailable or unconfigured | Existing public error path remains; Mock still works | Provider boundary tests |

## Limits

- The Mock result proves contract propagation and a visible demo difference, not general response quality.
- A real OpenAI request was intentionally not sent, so adherence and usefulness across varied prompts are not yet evaluated.
- Character counts from one fixed Japanese prompt do not generalize to all inputs.
- The feature controls presentation only. It does not adapt factual depth to measured knowledge, accessibility needs, or emotional state.
- A future user study would need task-based prompts and preference ratings; it should not infer sensitive traits from voice, face, or conversation history.

## Cost and privacy

The default Mock path is free and remains within the browser and local backend. The selection is not written to SQLite. When the owner explicitly enables OpenAI, the selected style becomes part of the instruction sent with the existing dialogue context and normal API charges apply.
