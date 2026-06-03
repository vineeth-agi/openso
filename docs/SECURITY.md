# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in Openso, **please report it responsibly**.

- **Email:** [security@openso.dev](mailto:security@openso.dev)
- **Do NOT** open a public GitHub issue for security vulnerabilities.
- We will acknowledge receipt within 48 hours and provide an initial assessment within 5 business days.
- We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure).

## 1. Secret inventory

Sourced from `.env.example`. `NEXT_PUBLIC_*` vars are bundled into the browser
build and are **public by design** — never put a secret behind that prefix.
Everything else is **server-only** and must never reach the client.

| Env var | Purpose | Scope |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical app origin | Public |
| `NEXT_PUBLIC_INSFORGE_BASE_URL` | InsForge backend base URL | Public |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | InsForge client SDK anon key | Public |
| `INSFORGE_API_KEY` | InsForge admin API key | Server-only |
| `INSFORGE_DB_URL` | Direct Postgres connection (incl. DB password) | Server-only |
| `PIONEER_API_KEY` | Pioneer AI API key (DeepSeek models) | Server-only |
| `VOYAGE_API_KEY` | Voyage embeddings API key | Server-only |
| `GITHUB_CLIENT_ID` | GitHub OAuth client id | Server-only |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Server-only |
| `GITHUB_APP_ID` | GitHub App id (non-secret) | Server-only |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM body) | Server-only |
| `NEXT_PUBLIC_GITHUB_APP_URL` | GitHub App install URL | Public |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret | Server-only |
| `GITHUB_TOKEN` | GitHub PAT (server fallback) | Server-only |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | Server-only |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Server-only |
| `QSTASH_TOKEN` | QStash publish token | Server-only |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash signature verification key | Server-only |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key (rotation) | Server-only |
| `DAYTONA_API_KEY` | Daytona sandbox API key | Server-only |
| `RESEND_API_KEY` | Resend email API key | Server-only |
| `FIRECRAWL_API_KEY` | Firecrawl API key | Server-only |
| `CRON_SECRET` | Shared secret guarding cron routes | Server-only |
| `TOKEN_ENC_KEY` | AES-256-GCM master key for token encryption | Server-only |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL | Server-only |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis bearer token | Server-only |

## 2. Workstation hygiene

- **Never commit** secrets — they are gitignored, but verify with `git status`
  before every commit:
  - `.env*.local`
  - `*.pem` (GitHub App private key)
  - `.insforge/project.json`
- Prefer a vault over plaintext `.env.local` on disk. Use the 1Password CLI
  (`op`) to inject secrets at runtime:

  ```bash
  op run --env-file=.env.op.tpl -- npm run dev
  ```

## 3. Production secrets

- Production secrets live **only** in the Vercel project env (dashboard /
  `vercel env`), never in a committed file.

## 4. Rotation runbook

| Credential | Rotate at |
| --- | --- |
| Pioneer AI key (`PIONEER_API_KEY`) | Pioneer AI dashboard |
| GitHub PAT (`GITHUB_TOKEN`) | GitHub → Developer settings → Tokens |
| GitHub App private key | GitHub App settings → Private keys |
| GitHub OAuth client secret | GitHub OAuth App settings |
| InsForge admin key (`INSFORGE_API_KEY`) | InsForge dashboard |
| InsForge DB password (`INSFORGE_DB_URL`) | InsForge dashboard → database |
| QStash token + signing keys | Upstash console → QStash |
| Upstash Redis token | Upstash console → Redis |
| Daytona (`DAYTONA_API_KEY`) | Daytona dashboard |
| Voyage (`VOYAGE_API_KEY`) | Voyage dashboard |
| Firecrawl (`FIRECRAWL_API_KEY`) | Firecrawl dashboard |
| `CRON_SECRET` | Generate random, update env + any caller |
| `TOKEN_ENC_KEY` | See key-rotation flow below |

**Standard rotation:** issue new credential → update Vercel env (and vault) →
redeploy → revoke old credential.

**`TOKEN_ENC_KEY` rotation** (multi-key, see `src/lib/security/token-crypto.ts`):

1. **Deploy new key** — add the new key to `TOKEN_ENC_KEYS` alongside the old one,
   set `TOKEN_ENC_ACTIVE_KEY_ID` to the new key id.
2. **Backfill** — re-encrypt existing rows under the new active key.
3. **Retire old key** — remove the old key from `TOKEN_ENC_KEYS`.

## 5. Pre-commit guard

Add a secret scanner as a pre-commit hook to block accidental commits. Use
[`gitleaks`](https://github.com/gitleaks/gitleaks) or
[`trufflehog`](https://github.com/trufflesecurity/trufflehog). Token prefixes to scan for:

- `eyJ` — JWTs
- `ik_` — InsForge keys
- `dtn_` — Daytona
- `fc-` — Firecrawl
- `sig_` — signing keys
- `ghp_`, `gho_`, `github_pat_` — GitHub tokens
- `pa-` — Voyage keys
- `sk-` — generic secret keys
- `-----BEGIN` — private keys (PEM)

## 6. CSP enforcement

The app ships a Content-Security-Policy in **report-only** mode by default. To
enforce it, set `CSP_ENFORCE=true` in the deployment env (Vercel).
