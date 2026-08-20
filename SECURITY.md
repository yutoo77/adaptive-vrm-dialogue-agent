# Security Policy

## Supported scope

The current application is designed for a single user on one PC. Both the Vite development server and FastAPI bind to `127.0.0.1`. Authentication, rate limiting, TLS termination, and multi-user data isolation are not implemented.

Do not expose the Backend port directly to the Internet. Making the source repository public does not make the running application a public service.

## Data and secrets

- The default Mock Provider keeps dialogue text on the local machine.
- The OpenAI Provider is opt-in and reads `OPENAI_API_KEY` only in the Backend process.
- Push-to-Talk sends audio only to the loopback FastAPI service and uses local faster-whisper inference.
- Normal conversation history is held in RAM. Only explicitly registered long-term memory is stored in `backend/.local/memory.sqlite3`.
- Local `.env` files, SQLite data, runtime logs, VRM files, and generated builds are excluded from Git.
- Do not store passwords, API keys, financial data, medical data, or other sensitive information in long-term memory.

See [ARCHITECTURE.md](ARCHITECTURE.md#dataと外部通信) for the detailed data flow and trust boundaries.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow in the Security tab when available. Include the affected path, a minimal reproduction, the impact, and any suggested mitigation. Do not open a public issue containing an API key, private recording, local database, or other sensitive data.
