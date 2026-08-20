# AGENTS.md

## Engineering guardrails

- Treat this repository as a public personal-development and job-portfolio project. Do not add research data, private records, personal recordings, or unrelated internal material.
- Preserve the local-first default: Mock dialogue must work without an API key or external AI request.
- Keep secrets in Backend environment variables. Never add API keys to Frontend code or `VITE_` variables.
- Do not commit VRM files, `.env` files, SQLite data, runtime logs, generated audio, virtual environments, `node_modules`, or build output.
- Keep normal conversations in RAM. Persist only content the user explicitly registers as long-term memory.
- Treat model and voice licenses as separate from the source-code license; update the relevant record before publishing a new asset.
- Accept only bounded, validated Avatar states and performance plans. Do not execute arbitrary bone commands, scripts, or remote animations from a Provider response.
- Keep Text input available when Voice input/output fails, and do not request microphone access before a user action.
- Add one major capability at a time and define its success, failure, fallback, cost, and evaluation before widening scope.
- Keep README, Architecture, Demo, and evaluation claims aligned with the implementation. Do not describe planned Agent, RAG, Vision, or deployment features as complete.

## Required checks

Run from the repository root:

```powershell
.\.venv\Scripts\python -m ruff check backend
.\.venv\Scripts\python -m pytest backend\tests
.\.venv\Scripts\python -m pip check
cd frontend
npm run check
```

For a release review, also run `npm audit`, `pip-audit`, a secret scan, and the documented browser demo. Stage, commit, push, and visibility changes remain separate GitHub operations.
