# Repo Agent — Full Roadmap (9 Phases)

> Grounded in:
> - `docs/repo-indexing-rebuild-plan-1-storage-and-flow.md`
> - `docs/repo-indexing-rebuild-plan-2-tools-and-phasing.md`
> - `docs/repo-indexing-rebuild-research.md`
> - `.kiro/specs/repo-indexing-phase-1-skeleton/` (Phase 1 spec)
>
> Infrastructure stack (no new vendors across any phase):
> - **Daytona** — per-session code execution sandbox
> - **Upstash Workflow** — durable background job orchestration
> - **Supabase Postgres** — persistent state with RLS + pgvector
> - **GitHub OAuth + GitHub App** — user auth + webhook delivery

---

## Phase 1 — Skeleton Indexing

**Goal**: Restore basic functionality — `/initialize` no longer 500s, chat picker works with the simplest possible backend.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `get_repo_overview` | Postgres (`repo_indexes` + `repo_skeletons`) | Returns status, total files, language stats, AGENTS.md content, capped file tree (10k entries), config-file contents. Single call to orient the agent. |

### Tables Created

| Table | Purpose |
|-------|---------|
| `repo_indexes` | Per-user-per-repo state row (status, head SHA, language stats, agents_md, stale flag) |
| `repo_skeletons` | Fast-fetch file path list (TEXT) + config file blobs (JSONB) |
| `repo_memories` | Agent-learned facts — created empty, wired in Phase 2 |

### GitHub APIs Consumed

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}` | Read `repository.size` (KB) for size-gate + `default_branch` |
| `GET /repos/{owner}/{repo}/commits/{ref}` | Resolve HEAD commit SHA |
| `GET /repos/{owner}/{repo}/tarball/{ref}` | Download repo tarball (repos < 500 MB) |

### Workflow

6-step Upstash Workflow at `/api/workflow/repo-prep/route.ts`:

1. **cancel-check** — short-circuit if user deselected
2. **clone** — tarball in-function (< 500 MB) or `git clone --depth=1` in Daytona sandbox (500 MB–5 GB)
3. **walk-and-classify** — file walk + exclusion list + language stats + tier classification
4. **build-skeleton** — write `repo_skeletons` row (file_paths TEXT, config_files JSONB)
5. **detect-agents-md** — read `AGENTS.md` or `.openhands/microagents/repo.md`, cap 32 KB
6. **finalize** — set `status='ready'`, `is_stale=false`, write head SHA + stats

### Prerequisites

- `connected_apps.installation_id` column (for push-webhook → user lookup)
- `getValidGithubToken(userId)` helper (OAuth token refresh)
- Daytona sandbox image has `apt` (confirmed: existing `create_sandbox` already uses it)

### What User Prompts This Unlocks

- Picking a repo from the chat "+" menu works again (no more 500 errors)
- Agent can answer "What languages is this repo?" / "How many files?" / "What's in the README?"
- Push events mark repos stale; next selection triggers re-prep automatically

### Infrastructure Needed

- Supabase Postgres: 3 new tables with RLS
- Upstash Workflow: 1 new workflow route (`/api/workflow/repo-prep`)
- Daytona: only for repos > 500 MB (tarball path handles most repos in-function)
- GitHub App: `push` webhook event delivery (already configured)

---

## Phase 2 — Per-Session Sandbox + Memory Tools

**Goal**: Agent has a real working environment with persistent learned facts.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `list_dir` | Sandbox (`fd -t f` preferred, `find` fallback) | Directory contents at a path |
| `read_file` | Sandbox (`cat` / line-range via `sed`) | Read a file, optional line range |
| `grep_search` | Sandbox (`rg` preferred, `grep -rnI` fallback) | Regex search across the working repo, gitignore-aware |
| `file_search` | Sandbox (`fd -g` preferred, `find -name` fallback) | Fuzzy filename search |
| `apply_patch` | Sandbox (existing `daytona-tools.ts`) | Search/replace edit on a file |
| `run_terminal_cmd` | Sandbox (existing `daytona-tools.ts`) | Run tests, builds, installs |
| `add_memory` | Postgres (`repo_memories`) | Write a durable fact (4 KB cap, 10 categories, 20 writes/session) |
| `list_memories` | Postgres (`repo_memories`) | Recall memories (auto-loaded into system prompt) |
| `remove_memory` | Postgres (`repo_memories`) | Delete a memory for hygiene |

### GitHub APIs Consumed

None new. Sandbox uses the cloned repo (git clone with OAuth token injected as `GITHUB_TOKEN` env var).

### Prerequisites

- Phase 1 complete (tables exist, `/initialize` works, skeleton is populated)
- Daytona sandbox image boots with `apt-get install -y -qq ripgrep fd-find`

### What User Prompts This Unlocks

- "Show me `src/index.ts`"
- "Find all TODO comments"
- "Run the tests"
- "Fix this lint error"
- "What's the build script?" (agent remembers via `add_memory`)
- "Search for where `createUser` is called"

### Infrastructure Needed

- Daytona: per-(tab, repo) sandbox with `autoDeleteInterval=15` min. Boot script extended to install `ripgrep` + `fd-find`.
- Supabase Postgres: `repo_memories` table (already created in Phase 1 migration)
- New route: `/api/repo-agent/session/route.ts` — creates/reuses sandbox per (tab, repo) pair

---

## Phase 3 — Semantic Search (Embeddings)

**Goal**: Cover conceptual queries that grep can't handle.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `semantic_search` | `repo_code_vectors` (pgvector HNSW, 1024-dim) + Voyage `voyage-code-3` | Conceptual code search. Returns top-K with similarity ≥ 0.3. **Mandatory grep fallback** when `semantic_index != 'ready'`. |

### Tables Created

| Table | Purpose |
|-------|---------|
| `repo_code_vectors` | Chunked code with 1024-dim embeddings. HNSW index. Unique on `(repo_index_id, file_path, chunk_index)`. |

### GitHub APIs Consumed

None new. Embedding pipeline reads from the already-cloned repo in the workflow.

### New Workflow Step

Added to `/api/workflow/repo-prep` between step 5 (detect-agents-md) and step 6 (finalize):

- **embed-chunks** — tree-sitter AST symbol walk → chunk (200-line max) → batch embed via Voyage `voyage-code-3` → insert into `repo_code_vectors` → set `semantic_index = 'ready'`

### Prerequisites

- Phase 2 complete (sandbox tools working, memory wired)
- `vector >= 0.8` extension enabled on Supabase project (for iterative scans)
- Tree-sitter native binaries validated on Vercel Node 22 runtime (or fallback: run tree-sitter inside Daytona sandbox)
- Voyage AI API key configured

### What User Prompts This Unlocks

- "Where is authentication handled?"
- "Find the error handling pattern"
- "How does the payment flow work?"
- "What's the caching strategy?"
- Any conceptual query where exact text matching fails

### Infrastructure Needed

- Supabase Postgres: `repo_code_vectors` table + HNSW index + `search_repo_code_vectors` RPC
- Voyage AI: `voyage-code-3` embeddings (~300 RPM, batch 128). Background-only; never blocks user interaction.
- Upstash Workflow: extended with embed step (per-batch sleep on 429s, incremental writes)
- New route: `/api/repo-agent/search/route.ts`

---

## Phase 4 — Auto-Generated Wiki

**Goal**: Agent gets instant deep orientation via LLM-generated narrative.

### New Tools Introduced

None. Wiki content is injected into the system prompt automatically as `<codebase_architecture>...</codebase_architecture>`.

### Tables Created

| Table | Purpose |
|-------|---------|
| `repo_wiki` | JSONB with `rootSummary`, `perDir`, `perFile` summaries. One row per repo. |

### GitHub APIs Consumed

None new.

### New Workflow Step

Added to `/api/workflow/repo-prep` after the embed step:

- **generate-wiki** — bottom-up directory summary via mini model (`claude-3-5-haiku` or `gpt-4o-mini`). Walks file tree, extracts tree-sitter symbols, summarizes each file (≤200 tokens), then bottom-up summarizes directories. Final `rootSummary` injected into agent system prompt.

### Prerequisites

- Phase 3 complete (or Phase 2 — wiki doesn't strictly depend on vectors, but benefits from symbol extraction)
- Mini model API key (Anthropic or OpenAI) configured

### What User Prompts This Unlocks

- Agent immediately understands architecture without exploring
- Better first-turn answers ("How is this project structured?")
- Reduced tool calls for orientation — the agent already knows the layout
- Auto-generated AGENTS.md stub for repos that lack one

### Infrastructure Needed

- Supabase Postgres: `repo_wiki` table
- LLM: mini model calls (~$0.10–0.50 per medium repo)
- Upstash Workflow: extended with wiki generation step

---

## Phase 5 — Git Operations + PR Lifecycle

**Goal**: Agent can make changes and submit them as pull requests.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `create_branch` | Sandbox (`git checkout -b`) | Create a new branch from current HEAD |
| `commit_changes` | Sandbox (`git add` + `git commit`) | Stage and commit changes |
| `push_branch` | Sandbox (`git push -u origin`) | Push branch to remote |
| `create_pr` | GitHub API | Create a pull request |
| `update_pr` | GitHub API | Update PR title/body/state |
| `list_prs` | GitHub API | List open/closed PRs |
| `get_pr_diff` | GitHub API | Get PR details and diff |
| `merge_pr` | GitHub API | Merge a pull request |

### GitHub APIs Consumed

| Endpoint | Purpose |
|----------|---------|
| `POST /repos/{owner}/{repo}/pulls` | Create a pull request |
| `PATCH /repos/{owner}/{repo}/pulls/{pull_number}` | Update PR title/body/state |
| `GET /repos/{owner}/{repo}/pulls` | List pull requests (with filters: state, head, base) |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}` | Get PR details + diff |
| `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` | Merge a pull request |

Git operations (branch, commit, push) happen inside the Daytona sandbox via `run_terminal_cmd`. The `gh` CLI is already installed at sandbox boot (existing `daytona-tools.ts`).

### Prerequisites

- Phase 2 complete (sandbox with git configured, `GITHUB_TOKEN` injected)
- OAuth token with `repo` scope (already the case for connected GitHub accounts)
- `gh` CLI installed in sandbox (already done per existing `create_sandbox` boot script)

### What User Prompts This Unlocks

- "Refactor the auth module and open a PR"
- "Fix this bug and submit a PR for review"
- "Create a feature branch for dark mode"
- "What PRs are open right now?"
- "Merge PR #12 if CI is green"

### Infrastructure Needed

- Daytona: sandbox already has git + `gh` CLI. OAuth user token passed as `GITHUB_TOKEN` env var.
- GitHub API: REST calls from the route layer using the user's OAuth token.
- No new tables needed.

---

## Phase 6 — PR Review + CI/CD Autofix Loop

**Goal**: Agent can read review comments, read CI logs, fix issues, and push follow-up commits until CI is green.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `list_pr_reviews` | GitHub API | List reviews on a PR |
| `list_pr_comments` | GitHub API | List inline review comments |
| `reply_to_review` | GitHub API | Reply to a review comment |
| `get_ci_status` | GitHub API | Get workflow run status for a ref |
| `get_ci_logs` | GitHub API + Sandbox | Download and parse CI run logs |
| `rerun_workflow` | GitHub API | Re-run a failed workflow or failed jobs only |
| `push_fix_commit` | Sandbox | Commit + push a fix (combines commit_changes + push_branch) |

### GitHub APIs Consumed

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` | List reviews |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments` | List inline review comments |
| `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` | Reply to a review comment |
| `GET /repos/{owner}/{repo}/actions/runs` | List workflow runs for a ref |
| `GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs` | Download run logs (zip) |
| `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun` | Re-run entire workflow |
| `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs` | Re-run only failed jobs |

### Prerequisites

- Phase 5 complete (agent can create branches, commit, push, create PRs)
- GitHub App permissions: `actions:read` + `actions:write` + `pull_requests:write`

### What User Prompts This Unlocks

- "Fix the CI failure on PR #23"
- "Address the review comments on my PR"
- "Why is the build failing?"
- "Re-run the failed tests"
- "Keep pushing fixes until CI is green" (the Devin autofix loop)

### Infrastructure Needed

- Daytona: CI log parsing happens in the sandbox (unzip + grep on the downloaded log archive)
- GitHub API: REST calls from the route layer for review/CI endpoints
- No new tables needed. The autofix loop is orchestrated by the agent's tool-use cycle.

### Note

This is the "Devin autofix" loop — the agent reads failure, patches, pushes, and repeats until green. The loop is bounded by the chat session's tool-call budget, not by infrastructure.

---

## Phase 7 — Issue Management + Triage

**Goal**: Agent can read, create, close, label, and comment on issues.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `list_issues` | GitHub API | List issues with filters (state, labels, assignee) |
| `get_issue` | GitHub API | Get single issue details |
| `create_issue` | GitHub API | Create a new issue |
| `close_issue` | GitHub API | Close an issue (with optional comment) |
| `add_issue_comment` | GitHub API | Add a comment to an issue |
| `add_labels` | GitHub API | Add labels to an issue |
| `remove_labels` | GitHub API | Remove a label from an issue |
| `assign_issue` | GitHub API | Assign users to an issue |

### GitHub APIs Consumed

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/issues` | List issues (with filters: state, labels, assignee) |
| `GET /repos/{owner}/{repo}/issues/{issue_number}` | Get single issue |
| `POST /repos/{owner}/{repo}/issues` | Create issue |
| `PATCH /repos/{owner}/{repo}/issues/{issue_number}` | Update issue (close, edit, assign) |
| `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` | Add comment |
| `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` | Add labels |
| `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}` | Remove label |
| `POST /repos/{owner}/{repo}/issues/{issue_number}/assignees` | Assign users |

### Prerequisites

- Phase 2 complete (for code understanding when fixing issues)
- GitHub App permissions: `issues:write`

### What User Prompts This Unlocks

- "Fix issue #42 and open a PR"
- "Create an issue for the memory leak I found"
- "Triage the open bugs — label them by severity"
- "Close issue #15 as won't-fix with a comment explaining why"
- "What issues are assigned to me?"
- "Summarize the open issues"

### Infrastructure Needed

- GitHub API: REST calls from the route layer using the user's OAuth token
- No new tables needed. All issue state lives in GitHub.
- No sandbox needed for issue operations (pure API calls)

### Note

SWE-agent's primary use case is "take a GitHub issue, fix it autonomously." Combined with Phase 5 (PR creation), this phase enables that full workflow: read issue → understand code → fix → open PR → link to issue.

---

## Phase 8 — Security + Dependency Scanning

**Goal**: Agent can check for vulnerabilities and create fix PRs.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `list_dependabot_alerts` | GitHub API | List Dependabot vulnerability alerts |
| `get_alert_details` | GitHub API | Get full details of a specific alert |
| `list_code_scanning_alerts` | GitHub API | List CodeQL / code scanning alerts |
| `dismiss_alert` | GitHub API | Dismiss or reopen an alert with reason |
| `create_security_fix_pr` | GitHub API + Sandbox | Generate a fix and open a PR (combines sandbox edit + Phase 5 PR tools) |

### GitHub APIs Consumed

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/dependabot/alerts` | List Dependabot alerts |
| `GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number}` | Get alert details |
| `PATCH /repos/{owner}/{repo}/dependabot/alerts/{alert_number}` | Dismiss/reopen alert |
| `GET /repos/{owner}/{repo}/code-scanning/alerts` | List CodeQL alerts |
| `GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}` | Get CodeQL alert details |
| `PATCH /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}` | Dismiss CodeQL alert |

### Prerequisites

- Phase 5 complete (for creating fix PRs)
- GitHub App permissions: `security_events:read` + `vulnerability_alerts:read`
- Repository must have Dependabot and/or CodeQL enabled (agent reports "not enabled" otherwise)

### What User Prompts This Unlocks

- "Are there any critical vulnerabilities?"
- "Fix the high-severity Dependabot alerts"
- "Upgrade lodash to fix CVE-2024-XXXX and open a PR"
- "Show me the CodeQL findings"
- "Dismiss the low-severity alerts with a reason"

### Infrastructure Needed

- GitHub API: REST calls for Dependabot + code scanning endpoints
- Daytona: fix generation uses sandbox (read vulnerable code, update dependency, run tests, push)
- Combines with Phase 5 PR creation tools for the full fix-and-submit workflow

---

## Phase 9 — Release Management

**Goal**: Agent can manage releases, generate changelogs, compare versions.

### New Tools Introduced

| Tool | Backed By | Description |
|------|-----------|-------------|
| `list_releases` | GitHub API | List all releases |
| `get_release` | GitHub API | Get a specific release |
| `create_release` | GitHub API | Create a release (with auto-generated notes option) |
| `compare_commits` | GitHub API | Compare two commits/tags/branches |
| `generate_changelog` | GitHub API + LLM | Generate a human-readable changelog |
| `list_tags` | GitHub API | List repository tags |

### GitHub APIs Consumed

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/releases` | List releases |
| `GET /repos/{owner}/{repo}/releases/{release_id}` | Get release details |
| `POST /repos/{owner}/{repo}/releases` | Create release |
| `POST /repos/{owner}/{repo}/releases/generate-notes` | Auto-generate release notes |
| `GET /repos/{owner}/{repo}/compare/{basehead}` | Compare two commits/tags/branches |
| `GET /repos/{owner}/{repo}/tags` | List tags |
| `GET /repos/{owner}/{repo}/commits` | List commits (for changelog generation) |

### Prerequisites

- Phase 5 complete (for tagging and pushing)
- GitHub App permissions: `contents:write`

### What User Prompts This Unlocks

- "What changed since v2.1.0?"
- "Create a release for the current HEAD with auto-generated notes"
- "Generate a changelog from the last 20 commits"
- "Tag this as v2.2.0 and publish a release"
- "Compare main with the last release tag"

### Infrastructure Needed

- GitHub API: REST calls for releases, tags, compare endpoints
- LLM: changelog summarization (optional — GitHub's `generate-notes` endpoint handles the basic case)
- Daytona: tag creation via `git tag` + `git push --tags` in sandbox

---

## Cumulative Tool Surface

All tools across all 9 phases, with backing infrastructure and required permissions.

| Tool | Phase | Backed By | Permission Required |
|------|-------|-----------|-------------------|
| `get_repo_overview` | 1 | Postgres | — (internal read) |
| `list_dir` | 2 | Sandbox (fd/find) | — (sandbox-local) |
| `read_file` | 2 | Sandbox (cat/sed) | — (sandbox-local) |
| `grep_search` | 2 | Sandbox (rg/grep) | — (sandbox-local) |
| `file_search` | 2 | Sandbox (fd/find) | — (sandbox-local) |
| `apply_patch` | 2 | Sandbox | — (sandbox-local) |
| `run_terminal_cmd` | 2 | Sandbox | — (sandbox-local) |
| `add_memory` | 2 | Postgres | — (internal write) |
| `list_memories` | 2 | Postgres | — (internal read) |
| `remove_memory` | 2 | Postgres | — (internal write) |
| `semantic_search` | 3 | Postgres (pgvector) | — (internal read) |
| `create_branch` | 5 | Sandbox (git) | OAuth `repo` scope |
| `commit_changes` | 5 | Sandbox (git) | OAuth `repo` scope |
| `push_branch` | 5 | Sandbox (git) | OAuth `repo` scope |
| `create_pr` | 5 | GitHub API | OAuth `repo` scope |
| `update_pr` | 5 | GitHub API | OAuth `repo` scope |
| `list_prs` | 5 | GitHub API | OAuth `repo` scope |
| `get_pr_diff` | 5 | GitHub API | OAuth `repo` scope |
| `merge_pr` | 5 | GitHub API | OAuth `repo` scope |
| `list_pr_reviews` | 6 | GitHub API | App `pull_requests:read` |
| `list_pr_comments` | 6 | GitHub API | App `pull_requests:read` |
| `reply_to_review` | 6 | GitHub API | App `pull_requests:write` |
| `get_ci_status` | 6 | GitHub API | App `actions:read` |
| `get_ci_logs` | 6 | GitHub API + Sandbox | App `actions:read` |
| `rerun_workflow` | 6 | GitHub API | App `actions:write` |
| `push_fix_commit` | 6 | Sandbox (git) | OAuth `repo` scope |
| `list_issues` | 7 | GitHub API | App `issues:read` |
| `get_issue` | 7 | GitHub API | App `issues:read` |
| `create_issue` | 7 | GitHub API | App `issues:write` |
| `close_issue` | 7 | GitHub API | App `issues:write` |
| `add_issue_comment` | 7 | GitHub API | App `issues:write` |
| `add_labels` | 7 | GitHub API | App `issues:write` |
| `remove_labels` | 7 | GitHub API | App `issues:write` |
| `assign_issue` | 7 | GitHub API | App `issues:write` |
| `list_dependabot_alerts` | 8 | GitHub API | App `vulnerability_alerts:read` |
| `get_alert_details` | 8 | GitHub API | App `vulnerability_alerts:read` |
| `list_code_scanning_alerts` | 8 | GitHub API | App `security_events:read` |
| `dismiss_alert` | 8 | GitHub API | App `security_events:write` |
| `create_security_fix_pr` | 8 | GitHub API + Sandbox | App `vulnerability_alerts:read` + OAuth `repo` |
| `list_releases` | 9 | GitHub API | App `contents:read` |
| `get_release` | 9 | GitHub API | App `contents:read` |
| `create_release` | 9 | GitHub API | App `contents:write` |
| `compare_commits` | 9 | GitHub API | App `contents:read` |
| `generate_changelog` | 9 | GitHub API + LLM | App `contents:read` |
| `list_tags` | 9 | GitHub API | App `contents:read` |

---

## GitHub App Permission Matrix

Permissions needed per phase. Each phase is additive — later phases require all prior permissions.

| Permission | Scope | Phase Introduced | Purpose |
|------------|-------|-----------------|---------|
| `contents:read` | Repository | 1 | Clone repo, read files, list commits |
| `metadata:read` | Repository | 1 | Basic repo info (size, default branch) |
| `contents:write` | Repository | 9 | Create tags, releases |
| `pull_requests:read` | Repository | 5 | List PRs, read PR details |
| `pull_requests:write` | Repository | 5 | Create/update/merge PRs, reply to reviews |
| `actions:read` | Repository | 6 | Read workflow runs, download logs |
| `actions:write` | Repository | 6 | Re-run workflows |
| `issues:read` | Repository | 7 | List/read issues |
| `issues:write` | Repository | 7 | Create/close/label/assign issues |
| `vulnerability_alerts:read` | Repository | 8 | Read Dependabot alerts |
| `security_events:read` | Repository | 8 | Read CodeQL alerts |
| `security_events:write` | Repository | 8 | Dismiss alerts |

### Webhook Events

| Event | Phase | Purpose |
|-------|-------|---------|
| `push` | 1 | Mark `repo_indexes.is_stale = true` |
| `pull_request` | 6 | (Future) Auto-respond to review requests |
| `workflow_run` | 6 | (Future) Notify agent of CI completion |

### OAuth User Token Scopes

The OAuth user token (stored in `connected_apps.access_token`) needs:
- `repo` — full access to private repos (read/write code, PRs, issues)
- This is already the scope requested during GitHub OAuth flow

---

## What's Explicitly OUT of Scope (and Why)

| Capability | Reason |
|-----------|--------|
| Delete repos/branches destructively | Irreversible. Too dangerous for an agent to perform without extreme guardrails. |
| Manage org members/permissions | Admin-level operation, not per-repo developer workflow. |
| GitHub Projects v2 management | Complex GraphQL-only API, niche use case, high implementation cost for low value. |
| Webhooks CRUD | Infrastructure concern, not developer workflow. Managed by the GitHub App config. |
| GitHub Pages deployment | Niche. Most users deploy via CI/CD, not direct Pages API calls. |
| Forking repos | Creates new repos with billing implications. Not a sandbox-safe operation. |
| Cross-user repo sharing | Multi-tenant complexity. Each user's data is RLS-isolated by design. |
| Public-repo "anyone can ask" mode | DeepWiki-style feature. Different product, different auth model. |
| GitHub Discussions | Low priority, rarely used in agent workflows. |
| GitHub Packages / Container Registry | Package management is CI/CD territory, not agent territory. |
| Repository transfer | Destructive org-level operation. |
| Branch protection rules | Admin-level, rarely changed by developers. |

---

## Architecture Constraints (All Phases)

These constraints apply uniformly across every phase:

### Sandbox
- All code execution uses **Daytona** (existing `src/lib/tools/daytona-tools.ts`)
- Per-session sandbox: one sandbox per (browser tab × repo selection) pair
- Boot script installs: `git`, `gh` CLI (Phase 1), `ripgrep`, `fd-find` (Phase 2)
- `autoDeleteInterval = 15` minutes of inactivity (safety net)
- Sandbox auto-deletes on repo deselect or tab close (existing `chat-page.tsx` cleanup)
- Large repos (500 MB–5 GB) clone inside sandbox; repos > 5 GB are rejected gracefully

### Background Work
- All durable background work uses **Upstash Workflow**
- Each workflow step starts with a `cancel-check` (reads `repo_indexes.cancel_requested`)
- Workflow is idempotent: re-running at the same SHA produces the same result
- Concurrent trigger suppression via atomic SQL upsert (no in-memory Maps)
- `maxDuration = 300` per step (Vercel Pro tier)

### Persistent State
- All persistent state uses **Supabase Postgres** with RLS
- Every table has `user_id` column with `USING (auth.uid() = user_id)` policy
- Service role bypass for workflow steps and API routes that verify auth separately
- No client-side direct DB access for agent tables (all through API routes)

### Authentication
- **OAuth user tokens** (with refresh) for user-scoped operations (code read/write, PRs, issues)
- **GitHub App installation tokens** for webhook-triggered operations (stale marking)
- Token refresh via `getValidGithubToken(userId)` — checks `expiry_date - now() < 5 min`, refreshes automatically
- If refresh fails, workflow marks repo `status='failed'` with `error_message='github_token_expired'`

### Vendor Lock
- **No new vendors introduced across any phase**
- Existing stack: Daytona, Upstash, Supabase, Voyage AI, Vercel
- pgvector replaces what would otherwise be Pinecone (Shadow's choice)
- Voyage `voyage-code-3` is the embedding model (1024-dim, code-tuned)

---

## Phase Dependency Graph

```
Phase 1 (Skeleton)
  ├── Phase 2 (Sandbox + Memory)
  │     ├── Phase 3 (Semantic Search)
  │     │     └── Phase 4 (Wiki) *can also follow Phase 2 directly
  │     ├── Phase 5 (Git + PRs)
  │     │     ├── Phase 6 (Review + CI Autofix)
  │     │     ├── Phase 8 (Security Scanning)
  │     │     └── Phase 9 (Releases)
  │     └── Phase 7 (Issues) *only needs Phase 2 for code understanding
  └── (nothing else depends solely on Phase 1)
```

### Critical Path

The longest dependency chain is:
`Phase 1 → Phase 2 → Phase 5 → Phase 6`

Phases 7, 8, and 9 can be developed in parallel once Phase 5 lands.
Phase 4 (Wiki) can start as soon as Phase 2 is stable.

---

## Migration Sequence

| Migration File | Phase | Tables/Objects Created |
|---------------|-------|----------------------|
| `<UTC>_create-repo-indexes.sql` | 1 | `repo_indexes`, `repo_skeletons`, `repo_memories`, `repo_memory_category` enum, all indexes + RLS |
| `<UTC>_create-repo-code-vectors.sql` | 3 | `repo_code_vectors`, HNSW index, `search_repo_code_vectors` RPC |
| `<UTC>_create-repo-wiki.sql` | 4 | `repo_wiki` |
| (no new tables) | 5–9 | — (these phases use GitHub API, not new tables) |

---

## Risk Register

| Risk | Phase | Mitigation |
|------|-------|-----------|
| Tarball OOM for large repos | 1 | Size-gate: repos > 500 MB clone in Daytona sandbox instead of in-function |
| Concurrent `/initialize` race | 1 | Atomic SQL upsert with `(xmax = 0)` trick — first tab wins, second polls |
| OAuth token expires mid-workflow | 1+ | `getValidGithubToken()` auto-refreshes; failure → `status='failed'` |
| Tree-sitter binaries don't load on Vercel | 3 | Validate before Phase 3; fallback: run tree-sitter inside Daytona sandbox |
| Voyage rate limits (300 RPM) | 3 | Per-batch sleep on 429s; incremental writes; `semantic_index='partial'` for early availability |
| HNSW filter selectivity (multi-tenant) | 3 | Pin `vector >= 0.8`, use iterative scans with `hnsw.max_scan_tuples = 20000` |
| Wiki generation cost | 4 | Use mini model (Haiku/gpt-4o-mini); ~$0.10–0.50 per medium repo |
| Agent pushes to wrong branch | 5 | Always create new branch; never push to main/master directly |
| CI log size (can be 100+ MB) | 6 | Parse logs inside sandbox (unzip + grep for failures); never load full log into context |
| Dependabot not enabled on repo | 8 | Agent reports "Dependabot not enabled" gracefully; no crash |

---

## Success Metrics (per phase)

| Phase | Key Metric | Target |
|-------|-----------|--------|
| 1 | `/initialize` warm-path latency | < 1 second |
| 1 | `/initialize` cold-path completion | < 60 seconds for repos < 50k files |
| 2 | Tool call success rate | > 95% (sandbox tools) |
| 2 | Memory recall accuracy | Memories appear in system prompt within 1 session |
| 3 | Semantic search relevance | Top-3 results contain the answer for 80% of conceptual queries |
| 4 | First-turn answer quality | Agent needs ≤ 2 tool calls to answer architecture questions |
| 5 | PR creation success rate | > 90% when agent has made valid edits |
| 6 | CI autofix loop convergence | Fixes CI within 3 iterations for 70% of failures |
| 7 | Issue-to-PR automation | Agent can go from issue → fix → PR in a single session |
| 8 | Vulnerability fix rate | Agent can fix 60% of Dependabot alerts (dependency bumps) |
| 9 | Release note quality | Generated notes cover all PRs merged since last release |


---

## Vercel Open Agents — What to Steal (Verified Patterns)

> Source: `vercel-labs/open-agents` (MIT licensed, 5.6k stars). Cloned and read at the time of writing this section. Below are the exact patterns to mirror in our codebase, with file references to the original source so any contributor can re-verify.
>
> **Adoption posture: Option B — steal patterns, keep our stack.** We do NOT fork. We do NOT switch from Daytona/Upstash/Supabase to Vercel Sandbox/Workflow/Neon. We re-implement these patterns in our own modules using our existing infrastructure.

### 1. The Sandbox Interface Pattern (Phase 2 — `packages/sandbox/interface.ts`)

Open Agents defines a clean `Sandbox` interface that all sandbox implementations conform to. This is exactly the abstraction we should mirror — it cleanly separates "what the agent needs" from "which vendor backs it."

**Methods to mirror in `src/lib/repo-prep/sandbox-interface.ts`:**

```ts
interface Sandbox {
  readonly type: "cloud";
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly currentBranch?: string;
  readonly hooks?: SandboxHooks;
  readonly environmentDetails?: string;  // Injected into system prompt
  readonly host?: string;
  readonly expiresAt?: number;
  readonly timeout?: number;

  readFile(path: string, encoding: "utf-8"): Promise<string>;
  readFileBuffer(path: string): Promise<Buffer>;
  writeFile(path: string, content: string, encoding: "utf-8"): Promise<void>;
  stat(path: string): Promise<SandboxStats>;
  access(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  exec(command: string, cwd: string, timeoutMs: number, options?: { signal?: AbortSignal }): Promise<ExecResult>;
  execDetached?(command: string, cwd: string): Promise<{ commandId: string }>;
  setGitHubAuthToken?(token?: string): Promise<void>;
  domain?(port: number): string;
  stop(): Promise<void>;
  extendTimeout?(additionalMs: number): Promise<{ expiresAt: number }>;
  snapshot?(): Promise<SnapshotResult>;
  getState?(): unknown;
}
```

**`SandboxHooks` for lifecycle events:**

```ts
interface SandboxHooks {
  afterStart?: (sandbox: Sandbox) => Promise<void>;
  beforeStop?: (sandbox: Sandbox) => Promise<void>;
  onTimeout?: (sandbox: Sandbox) => Promise<void>;
  onTimeoutExtended?: (sandbox: Sandbox, additionalMs: number) => Promise<void>;
}
```

**Why this matters for us:**
- Our existing `daytona-tools.ts` exposes Daytona-specific types directly to tool implementations. Wrapping them behind this `Sandbox` interface means our `read_file`, `bash`, etc. tools become vendor-agnostic — the same way Open Agents' tools work on any sandbox that implements the interface.
- The `hooks` pattern (`afterStart`, `beforeStop`, `onTimeout`) is how they handle "commit uncommitted changes before stopping" cleanly, instead of scattering that logic across the codebase.

**Action**: In Phase 2, create `src/lib/repo-prep/sandbox-interface.ts` with this exact shape, then implement `DaytonaSandbox implements Sandbox` in a sibling file. All Phase 2+ tools consume the `Sandbox` interface, never Daytona types directly.

### 2. The Skills System (Phase 2 / Optional — `packages/agent/skills/`)

Open Agents has a **skills system** that's strictly better than our planned `add_memory` tool for extensibility. A "skill" is a markdown file (`SKILL.md`) with YAML frontmatter that the agent can invoke as a slash command or call programmatically.

**Frontmatter structure:**

```yaml
---
name: commit
description: Stage all changes and create a commit with a generated message
version: 1.0.0
allowed-tools: bash, edit, read
context: fork  # optional: run in isolated subagent context
agent: executor  # optional: which subagent type to use
---
```

**Skill discovery (`packages/agent/skills/discovery.ts`):**
- Scans configured directories (e.g., `.agents/skills/`, repo-root `.openhands/microagents/`)
- Each subdirectory containing `SKILL.md` becomes a skill
- Frontmatter is parsed; body is loaded on-demand when the skill is invoked
- Built-in commands (`model`, `resume`, `new`) are reserved and skills can't shadow them
- Duplicate skill names are de-duplicated case-insensitively (first wins)

**Skill invocation flow (`packages/agent/tools/skill.ts`):**
1. Agent calls `skill` tool with `{ skill: "commit", args: "-m fix bug" }`
2. Tool finds the skill metadata, reads `SKILL.md` from the sandbox
3. Strips YAML frontmatter, substitutes `$ARGUMENTS` placeholder
4. Injects `Skill directory: <abs-path>` line so the body can reference scripts/resources
5. Returns the substituted body as tool output — the agent's next turn acts on those instructions

**Why this matters for us:**
- We can ship per-repo skills via the existing `AGENTS.md` / `.openhands/microagents/*.md` convention — extending what Phase 1 already detects
- Skills are **sandbox-agnostic** — they run as plain markdown directives, not as JS code
- This replaces our planned ad-hoc `add_memory` extension model with a proper file-based pattern that users can write themselves
- The slash-command UX (`/commit`, `/review`) is what users already expect from Cursor/Claude Code

**Action**: Add a **Phase 2.5 — Skills System** between Phase 2 (sandbox tools) and Phase 5 (PRs). It introduces:
- `skill` tool (the invocation endpoint)
- Skill discovery from `.agents/skills/`, `<repo>/.agents/skills/`, `<repo>/.openhands/microagents/`
- Frontmatter parser + body extractor
- Built-in skills shipped with our app: `commit`, `review-pr`, `triage-issue`, `add-memory`, `recall-memory`

### 3. The Hibernate/Resume Sandbox Lifecycle (Phase 2 — `packages/sandbox/vercel/sandbox.ts`)

Open Agents' sandbox lifecycle is **strictly better** than our planned "auto-delete after 15 min". Three concrete improvements:

**(a) Native snapshot-based persistence**

```ts
// Vercel Sandbox SDK supports persistent snapshots:
sdk.snapshot() → { snapshotId: string }
VercelSandboxSDK.create({ source: { type: "snapshot", snapshotId } })
```

Daytona supports snapshots too (`daytona.snapshot.create()`) — we just don't use them today. Adding snapshot/resume means a user can come back hours later and pick up where they left off, including dev servers and uncommitted edits.

**(b) Proactive timeout with buffer + lifecycle hooks**

```ts
// Pseudo-pattern from Open Agents:
const TIMEOUT_BUFFER_MS = 30_000;
const sdkTimeout = userTimeout + TIMEOUT_BUFFER_MS;  // SDK kills it last

scheduleProactiveStop(); // calls onTimeout hook BEFORE the SDK kills the sandbox
// ↓
// onTimeout fires → app commits dirty changes, persists state
// ↓
// SDK timeout fires 30s later → kills the VM
```

This solves the "user's work disappears when sandbox times out" problem by giving the app a 30-second window to flush state.

**(c) `extendTimeout(additionalMs)` for active sessions**

If the agent is still working when the timeout approaches, the app can extend it without recreating the sandbox.

**Why this matters for us:**
- Our current Daytona setup auto-deletes after 15 min of inactivity. Once it's gone, the user loses their work-in-progress branch + uncommitted changes.
- Adopting hibernate/resume means: tab close → snapshot → user reopens hours later → resume from exact state.
- The `onTimeout` hook is where we'd auto-commit-and-push uncommitted work to a `wip/` branch as a safety net.

**Action**: In Phase 2, add to `src/lib/repo-prep/sandbox-interface.ts`:
- `snapshot()` and `resume(snapshotId)` methods
- `hooks.onTimeout` lifecycle hook
- `extendTimeout(ms)` method
- Persist `sandboxId` + `lastSnapshotId` per (user, tab, repo) in a new `repo_sessions` table

### 4. The GitHub Credential-Brokering Pattern (Phase 5 — `packages/sandbox/vercel/sandbox.ts`)

This is the **single most important pattern** to steal for Phase 5 (PR creation). Open Agents has a clever solution to the "how do we let the agent push code without exposing the GitHub token to it" problem.

**The pattern:**

```ts
// 1. The sandbox VM has NO direct GitHub token. The agent never sees it.
// 2. The Vercel Sandbox network policy is configured so HTTP requests
//    to api.github.com / github.com / codeload.github.com are
//    transformed at the network layer:
{
  allow: {
    "api.github.com": [{ transform: [{ headers: { Authorization: "Bearer ${token}" } }] }],
    "github.com":     [{ transform: [{ headers: { Authorization: "Basic ${base64(...)}" } }] }],
    "codeload.github.com": [...],
    "uploads.github.com": [...],
  }
}

// 3. The agent runs `git clone https://github.com/owner/repo.git`
//    The network policy injects the auth header transparently.
//    The agent can never read the token, but git operations work.

// 4. setGitHubAuthToken(token) enables brokering for a critical section;
//    setGitHubAuthToken(undefined) disables it after the operation.
```

**The system prompt explicitly tells the agent:**

> "Git is available for local inspection only; do not configure remotes or credentials"
> "GitHub CLI (gh) is NOT available; do not call GitHub write APIs from this sandbox"
> "GitHub writes are handled by the broker outside this sandbox. Do not configure credentials, commit, or push from inside the sandbox."

**Why this matters for us:**
- Our current plan injects `GITHUB_TOKEN` as an env var into the Daytona sandbox. The agent can `cat $GITHUB_TOKEN`, exfiltrate it via `curl`, or accidentally commit it. **This is a real security hole we shouldn't ship.**
- The broker pattern means: the sandbox has filesystem-only auth, all GitHub writes happen in our Next.js route layer using a separately-stored token, and the agent's only PR-creation surface is "make changes, then ask the broker to commit and push."

**The actual flow (from `packages/sandbox/git.ts` + system prompt):**

1. Agent makes file edits in the sandbox (`write`, `edit` tools)
2. Agent calls a `commit_changes` tool — this does NOT run `git commit` in the sandbox
3. Tool reads the staged diff via `git diff --cached` (read-only) inside the sandbox
4. Tool sends the file contents to the **broker layer** (our Next.js route)
5. Broker uses GitHub Contents API or Trees API to create the commit on GitHub directly
6. Broker calls `syncToRemote(branch)` inside the sandbox — fetches and resets to the new remote head
7. Sandbox is now in sync with remote, but never had write credentials

**Action**: In Phase 5, change the design:
- ❌ NOT: `git commit && git push` inside the sandbox (current plan)
- ✅ INSTEAD: agent edits files, then a broker route reads the diff, posts to GitHub Contents API, syncs sandbox to new HEAD
- Specific function shapes to copy from `packages/sandbox/git.ts`:
  - `hasUncommittedChanges(sandbox)`
  - `stageAll(sandbox)` (just `git add -A` — read-only intent declaration)
  - `getChangedFiles(sandbox)` — parses `git diff --cached --name-status -z HEAD` with NUL separators
  - `detectBinaryFiles(sandbox)` — uses numstat to identify binaries
  - `readFileContents(sandbox, changes)` — reads each changed file as utf-8 or base64
  - `syncToRemote(sandbox, branch)` — `git fetch` + `git reset --hard origin/branch` after broker commit lands
  - `syncToRemotePreservingChanges(sandbox, branch)` — stash local edits, sync, pop

### 5. The Agent Tool Set (Phase 2 — `packages/agent/tools/`)

Open Agents' tool surface is **almost identical to what we planned**, but with cleaner names and contracts. Worth copying the names and descriptions verbatim:

| Open Agents Tool | Our Plan | Recommendation |
|---|---|---|
| `read` | `read_file` | Use `read` (shorter, matches their convention) |
| `write` | (planned: `write_file`) | Use `write` |
| `edit` | `apply_patch` | Use `edit` (theirs is clearer about what it does) |
| `grep` | `grep_search` | Use `grep` |
| `glob` | `file_search` | Use `glob` (more accurate — it's glob-pattern based) |
| `bash` | `run_terminal_cmd` | Use `bash` |
| `todo_write` | (not in plan) | **ADD THIS** — agent uses it to plan multi-step work |
| `task` | (not in plan, but covered by subagent pattern) | Add this in Phase 2 — see point 6 below |
| `ask_user_question` | (not in plan) | **ADD THIS** — structured Q&A is much better than open-ended chat |
| `skill` | (covered by point 2) | Phase 2.5 |
| `web_fetch` | (not in plan) | Optional addition |

**Concrete tool design takeaways (from reading the implementations):**

- **`read` tool defaults**: `offset = 1, limit = 2000`. Returns lines numbered as `"N: content"` so the agent can reference exact line numbers.
- **`edit` tool requires uniqueness**: If `oldString` appears multiple times, the tool fails with the count. Forces the agent to provide enough context to disambiguate, or to set `replaceAll: true` explicitly.
- **`bash` tool dangerous-pattern detection**: They have a regex list (`DANGEROUS_COMMAND_PATTERNS`) for `rm -rf`, `curl`, fork bombs, `dd`, etc. that triggers a `needsApproval` callback. Same idea for `.env` file access.
- **Path security** (`packages/agent/tools/path-security.ts`): All file tools resolve paths and verify they stay inside the workspace. Symlink-resolution (`resolveSandboxRealPath`) prevents escapes via `ln -s`.
- **All file paths are workspace-relative**, never absolute, never use `cd ... &&`. The system prompt explicitly forbids `cd` prefixes.

**Action**: When implementing Phase 2 tools, copy the input schemas, descriptions, and error messages directly from `packages/agent/tools/{read,write,grep,glob,bash}.ts`. They've been refined through real production use.

### 6. The Subagent / `task` Pattern (Phase 2 — `packages/agent/subagents/`)

Open Agents has three named subagents:

```ts
SUBAGENT_REGISTRY = {
  explorer: "read-only codebase exploration, tracing behavior, answering questions",
  executor: "well-scoped implementation work — edits, scaffolding, refactors",
  design:   "production-grade frontend interfaces, polished design",
}
```

The agent invokes a subagent via the `task` tool:

```ts
task({
  subagentType: "executor",
  task: "Migrate auth from JWT to session cookies",
  instructions: "Goal: ... Steps: ... Verification: ...",
})
```

**Key properties:**
- Subagents are **autonomous** (cannot ask follow-up questions)
- Hard step limit (`SUBAGENT_STEP_LIMIT`, default 25) to prevent runaway
- Return only a final summary message — the parent agent never sees their internal tool calls
- Each subagent has its own system prompt tuned for its role

**Why this matters for us:**
- For complex tasks ("refactor the entire auth module"), the main agent shouldn't have to do everything in one context. Spawning an `executor` subagent keeps the main context clean and the work focused.
- The `explorer` subagent is perfect for "research before changing" — it can read 50 files without polluting the main agent's context.

**Action**: Add to Phase 2:
- A `task` tool with `subagentType` enum
- Three subagents: `explorer` (read-only), `executor` (write-allowed), `design` (frontend-tuned)
- Each subagent has its own system prompt + tool subset (e.g., `explorer` has no `edit` or `write`)

### 7. The System Prompt Architecture (Phase 2 — `packages/agent/system-prompt.ts`)

Their system prompt is composed in this exact order:

1. **Core prompt** (model-agnostic) — agency, persistence, guardrails, parallel execution rules, tool usage hierarchy, verification loop, git safety, security, scope discipline
2. **Model-family overlay** — different behavior for Claude (todo-heavy), GPT (autonomous-completion-focused), Gemini (concise), Other
3. **Environment block** — `cwd`, current branch, sandbox host, exposed ports
4. **Cloud sandbox instructions** — explicitly forbids `git commit/push/credentials` inside sandbox (the credential-brokering pattern from §4)
5. **Project-specific instructions** — `customInstructions` from `AGENTS.md` content
6. **Skills section** — auto-generated list of available skills with slash-command instructions

**Why this matters for us:**
- Our current plan in `plan-2 § 2` outlines a system prompt structure that's mostly identical, but missing the model-family overlay and the explicit git-safety rules.
- The model-family detection (`detectModelFamily(modelId)`) and per-family overlay is a small addition that pays off significantly — Claude needs different prompting than GPT than Gemini.

**Action**: When implementing the system prompt builder for Phase 2, mirror the order and the per-family overlay pattern. The git-safety section ("Do not commit unless the user explicitly asks") is critical.

### 8. The Verification Loop (Embedded in System Prompt)

Open Agents bakes a strict verification loop into the system prompt:

> "After EVERY code change, validate your work and iterate until clean:
> 1. Use the project's own scripts — NEVER run raw tool commands. Check AGENTS.md and `package.json` `scripts`.
> 2. Detect the package manager from lock files.
> 3. Run verification in order: typecheck → lint → tests → build.
> 4. If verification reveals errors introduced by your changes, fix them and re-run verification.
> 5. Repeat until all checks pass."

**Why this matters for us:**
- This is what gets us from "agent makes edits" to "agent makes edits that compile and pass tests" — which is what unlocks reliable PR creation.
- The package-manager detection (lockfile-driven, never assumed) prevents the agent from running `npm install` on a `bun` project.

**Action**: Phase 2 system prompt MUST include this verification loop verbatim. It's the difference between "agent that codes" and "agent that ships green PRs."

---

## Summary of Plan Changes (After Studying Open Agents)

### Phases that change

| Phase | Original Plan | Updated Plan |
|---|---|---|
| **Phase 2** | Per-session sandbox + memory tools | + `Sandbox` interface abstraction (point 1) + lifecycle hooks (point 3) + verification loop in system prompt (point 8) + `task`/subagent system (point 6) + `todo_write` + `ask_user_question` tools (point 5) |
| **Phase 2.5** (NEW) | — | **Skills system** (point 2) — `skill` tool, frontmatter parser, discovery from `.agents/skills/` and `<repo>/.openhands/microagents/`, built-in skills (commit, review-pr, triage-issue) |
| **Phase 5** | Git + PRs via in-sandbox `git push` and `gh pr create` | **GitHub credential-brokering pattern** (point 4) — sandbox has NO write tokens; broker route uses GitHub Contents API to create commits, then syncs sandbox to new HEAD via `syncToRemote()` |

### Phases that don't change

- **Phase 1 (Skeleton Indexing)** — unchanged, our unique value-add
- **Phase 3 (Semantic Search)** — unchanged, Open Agents has nothing equivalent
- **Phase 4 (Wiki)** — unchanged, Open Agents has nothing equivalent
- **Phases 6–9** — unchanged in scope; they consume the broker pattern from Phase 5

### What we explicitly do NOT adopt

- ❌ Vercel Sandbox / Vercel Workflow / Neon Postgres / Better Auth — we keep Daytona / Upstash / Supabase / our existing auth
- ❌ Their full agent loop (`open-agent.ts`) — too tied to Vercel AI SDK's `ToolLoopAgent`. We keep our own chat handler.
- ❌ Their model gateway — we already use a different LLM provider setup
- ❌ Their UI components — different design system

### What we DO adopt (cumulative)

- ✅ `Sandbox` interface abstraction (Phase 2)
- ✅ Sandbox lifecycle hooks (`afterStart`, `beforeStop`, `onTimeout`, `onTimeoutExtended`) (Phase 2)
- ✅ Hibernate / snapshot / resume pattern (Phase 2)
- ✅ Tool naming and input schemas: `read`, `write`, `edit`, `grep`, `glob`, `bash`, `todo_write`, `ask_user_question`, `task`, `skill` (Phase 2)
- ✅ Path-security module with workspace-relative resolution + symlink check (Phase 2)
- ✅ `bash` tool's dangerous-pattern approval list (Phase 2)
- ✅ Subagent registry pattern with `explorer` / `executor` / `design` (Phase 2)
- ✅ Skills system: `SKILL.md` + frontmatter + slash-command discovery (Phase 2.5 — NEW)
- ✅ System-prompt structure with model-family overlay + verification loop (Phase 2)
- ✅ GitHub credential-brokering pattern: no write tokens in sandbox, broker handles commits via Contents API (Phase 5 — replaces in-sandbox `git push`)
- ✅ Git helper functions: `hasUncommittedChanges`, `getChangedFiles`, `detectBinaryFiles`, `readFileContents`, `syncToRemote` (Phase 5)

### Net effect

These changes don't add work — they sharpen the design. Phase 5 specifically becomes **safer** (no token in sandbox) and **simpler** (no `gh` CLI dependency). Phase 2 becomes **more capable** with the same effort, because we're copying battle-tested patterns instead of inventing them.

The skills system (Phase 2.5) is genuinely additive — but it's a small phase (one tool, one parser, one discovery loop) that unlocks a much bigger UX win because users can write their own slash-commands as markdown files.
