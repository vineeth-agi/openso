# Portfolio Recruiter Chatbot

A public, unauthenticated AI chat widget embedded on `/portfolio/[username]` pages. It impersonates the candidate in first person and answers recruiter questions about skills, experience, projects, and code, drawing on three data layers (resume data, portfolio config, GitHub Memory) plus on-demand GitHub API tools when the candidate has connected their account.

## Surface

- **API route**: `POST /api/portfolio-chat`
  - Request body: `{ username: string, messages: UIMessage[] }`
  - Response: AI SDK data stream (`useChat` compatible)
  - Errors are JSON with shape `{ error, code, retryAfter? }` — see the design doc's failure matrix.
- **Widget mount**: `/portfolio/[username]` renders `<ChatWidget />` from `src/portfolio-src/components/chat-widget.tsx` and passes `{ username, candidateName }` as props.
- **Provider**: Gemini via Vertex AI (`src/lib/ai/google-provider.ts`). Vertex auth is handled by the existing provider; no new credentials are needed for this feature beyond what `google-provider.ts` already requires.
- **Rate limiting**: in-memory sliding window keyed on `portfolio-chat:<hashed-ip>` via `src/lib/rate-limit.ts`.

## Environment variables

Copy the relevant entries from `.env.example.portfolio-chat` into your `.env.local`. All values are optional; the route falls back to the defaults shown below.

| Env var | Default | Effect |
|---|---|---|
| `VERTEX_GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model id used by the public chatbot. Override to `gemini-2.5-flash-lite` for cheaper traffic, or `gemini-2.5-pro` for higher quality. |
| `PORTFOLIO_CHAT_RATE_LIMIT` | `60` | Per-IP requests per minute against `/api/portfolio-chat`. Lower for staging, raise for known-good clients. |
| `PORTFOLIO_CHAT_MAX_STEPS` | `5` | Max tool-calling steps per response. Public chat does not need long agentic loops. |
| `PORTFOLIO_CHAT_MAX_TOKENS` | `1024` | Max output tokens per streamed response. Keeps replies crisp and cost predictable. |
| `PORTFOLIO_CHAT_LIVE_TESTS` | `0` | Set to `1` to enable the nightly live-LLM prompt-injection suite (otherwise skipped by `describe.skipIf`). |
| `INSTANCE_SALT` | `change-me-per-deploy` | Salt for hashing client IPs (`sha256(ip + INSTANCE_SALT)`) before they appear in logs. Rotate per deploy. |

## Running the nightly live-LLM injection tests

The injection corpus is exercised in two layers:

1. **Fast (default)** — mocked prompt-shape assertions in `src/__tests__/portfolio-chat/injection-prompt.test.ts` run on every `vitest` invocation.
2. **Live (gated)** — full streaming runs against `gemini-2.5-flash` in `src/__tests__/portfolio-chat/injection-live.test.ts`. Skipped unless `PORTFOLIO_CHAT_LIVE_TESTS=1`.

To run the live suite locally (requires Vertex credentials):

```bash
PORTFOLIO_CHAT_LIVE_TESTS=1 vitest --run src/__tests__/portfolio-chat/injection-live.test.ts
```

The same command runs in the nightly CI workflow. A per-test failure rate above 5% over 20 runs blocks the build.

## Related docs

- Design: `.kiro/specs/portfolio-recruiter-chatbot/design.md`
- Requirements: `.kiro/specs/portfolio-recruiter-chatbot/requirements.md`
- Tasks: `.kiro/specs/portfolio-recruiter-chatbot/tasks.md`
