# Repo Indexing Rebuild — Part 2: Tools, Bottlenecks, and Phased Rollout

> Companion docs:
> - `docs/repo-indexing-rebuild-research.md` — verified findings
>   from the local clone-and-read pass on Shadow + OpenHands.
> - `docs/repo-indexing-rebuild-plan-1-storage-and-flow.md` —
>   tables, control paths, indexing semantics.

This file covers the agent's tool surface, the bottlenecks to
plan around, the prerequisites that must land first, and the
phased rollout.

## 1. Tool surface for the chat agent

These tools are exposed to the chat agent when a repo is selected.
Direct port of Shadow's tool set (verified against
`apps/server/src/agent/tools/index.ts`) with two changes:

1. We split `get_repo_overview` out as a single Postgres-backed
   tool so the model can orient without spending a sandbox call.
2. We keep our existing `apply_patch` tool from `daytona-tools.ts`
   (Shadow uses `search_replace`; same idea, different name).

| Tool | Backed by | Purpose |
| --- | --- | --- |
| `get_repo_overview` | Postgres (`repo_indexes` + `repo_skeletons` + `agents_md`) | One call to orient. Returns status, total_files, language_stats, AGENTS.md, capped file tree, list of pinned `repo_memories`. |
| `list_dir` | Sandbox `fd -t f` (preferred, installed at boot) or fallback `find -maxdepth N` | Directory contents at a path. |
| `read_file` | Sandbox `cat` / existing `view_file_lines` | Read a file, optional line range. |
| `grep_search` | Sandbox `rg` (preferred, installed at boot) or fallback `grep -rnI` | Regex search across the working repo. With `rg` we get gitignore-aware behaviour for free; with grep we still pass `--exclude-dir=` for noise. |
| `file_search` | Sandbox `fd -g` (preferred) or fallback `find -name` | Fuzzy filename search. |
| `semantic_search` | `repo_code_vectors` + Voyage embeddings | Phase 3 only. Conceptual queries. Returns top-K with similarity ≥ 0.3. Falls back to `grep_search` if the repo's `semantic_index != 'ready'`. |
| `add_memory` | Postgres (`repo_memories`) | Agent-written fact. Length cap 4 KB (DB CHECK), category required, rate limit 20 writes per chat session. |
| `list_memories` | Postgres (`repo_memories`) | Loaded automatically into the system prompt at session start. Tool also exposed for explicit recall. |
| `remove_memory` | Postgres (`repo_memories`) | Same shape as Shadow's. Required to keep memory hygiene. |
| `apply_patch` | Sandbox (existing daytona-tools) | Search/replace edit, kept from current code. Equivalent to Shadow's `search_replace`. |
| `run_terminal_cmd` | Sandbox (existing daytona-tools) | Tests, builds, installs. |

> "Installed at boot": the Daytona `create_sandbox` path will run
> `apt-get install -y -qq ripgrep fd-find` once on first boot. If
> install fails (network, image variant), the tools fall back to
> `grep` / `find` without breaking the agent. Non-blocking.

### 1.1 Semantic search — fallback is mandatory

Mirror Shadow's pattern verbatim: when `semantic_search` is invoked
but the repo's `repo_indexes.semantic_index != 'ready'`, the tool's
`execute()` immediately calls `grep_search` with the same query and
returns those results with a note that semantic was unavailable.
That way the model never hits a "no tool, no answer" wall.

### 1.2 Memory — categories match Shadow exactly

10-category enum (from the verified Prisma schema):
`INFRA, SETUP, STYLES, ARCHITECTURE, TESTING, PATTERNS, BUGS,
PERFORMANCE, CONFIG, GENERAL`. Reusing the names verbatim means we
can adopt their tool prompt phrasing without translation friction.

### 1.3 Tool priority hint in the system prompt

Same DISCOVERY → PLANNING → EXECUTION → VERIFICATION ladder Shadow
uses, with our paths inserted:

- **Discovery**: `get_repo_overview` first. Then any combination of
  `list_dir`, `grep_search`, `file_search`, `read_file` in
  parallel. `semantic_search` only when those produced nothing
  useful.
- **Planning**: identify all files that need touching, dependency
  map, test files.
- **Execution**: `apply_patch` for edits, `run_terminal_cmd` for
  build/test verification.
- **Memory**: `add_memory` whenever a finding is durable
  ("the build script lives at scripts/build.sh"). `list_memories`
  is auto-loaded into the prompt — agents shouldn't call it
  reflexively.

## 2. Agent system prompt scaffolding

When the chat handler builds the system prompt for a repo session,
it composes (in order):

1. The user's general system prompt.
2. **Repo overview block** (from `repo_indexes` + `repo_skeletons`):
   ```
   You are working in {repo_full_name}.
   Default branch: {default_branch}, HEAD: {head_commit_sha[:7]}.
   File count: {total_files}. Languages: {language_stats}.
   Status: {is_stale ? "stale (re-prep in flight)" : "ready"}.
   ```
3. **`agents_md` content** if present (cap 8 KB). This is the user-
   curated layer — same role OpenHands' AGENTS.md plays.
4. **Pinned `repo_memories`** as bulleted list, grouped by category.
5. **Phase-4 wiki rootSummary** if the wiki exists for this repo,
   wrapped in `<codebase_architecture>...</codebase_architecture>`.
   This is the auto-generated layer — same role Shadow's
   `getShadowWikiContent` plays.
6. **Tool list** with priority hint from § 1.3.
7. (Optional) first 200 entries of the file tree as a navigation
   hint. Skipped if `repo_skeletons.truncated_paths = true`.

This is the same shape Shadow's `agent/system-prompt.ts` uses,
which is what gives their agent the discovery-first behaviour
without us writing a custom orchestration loop.

## 3. Bottlenecks and risks

### 3.1 Tarball-in-function for huge monorepos

A 1 GB tarball through `GET /repos/{owner}/{repo}/tarball/{ref}`
inside an Upstash step will OOM the function.

**Mitigation**: size-gate. HEAD the tarball or read
`repository.size` (KB) from the GitHub API metadata first.

- `size_kb < 500_000` → in-function tarball stream.
- `size_kb >= 500_000` → spin up a Daytona sandbox, run
  `git clone --depth=1 --filter=blob:none`, do walk + skeleton +
  (phase 3) embedding inside the sandbox, copy the resulting
  `file_tree.json` and `skeleton.json` back via Daytona's
  `fs.downloadFile`.
- `size_kb >= 5_000_000` (5 GB) → reject with friendly "monorepo
  too large for index" message. Sandbox + grep still works at
  chat time; the user just doesn't get the Postgres skeleton.

### 3.2 Concurrent `initialize` race

Already handled by the atomic upsert SQL in Part 1 § 4.1. The two-
tab race resolves to "first tab wins, second tab polls".

### 3.3 JSONB `file_tree` size

Compact-text path (`repo_skeletons.file_paths` as TEXT) avoids the
multi-MB JSONB read. Per-file metadata is recomputed from the path
list when the agent wants it.

### 3.4 Workflow cancellation when the user deselects

Each `context.run` step starts with a `cancel-check`:

```ts
const row = await db.query(
  `SELECT cancel_requested FROM repo_indexes WHERE id = $1`,
  [repoIndexId],
);
if (row?.cancel_requested) return { cancelled: true };
```

`cancel_requested` is flipped to `true` by:

- `/api/repo-agent/delete` (existing endpoint)
- The deselect path in `chat-page.tsx` (extend the existing
  `cleanupSandbox` call to also POST a "cancel prep" hint).

### 3.5 OAuth token refresh in long-running workflows

`connected_apps.access_token` is an OAuth user token with
`expiry_date` and `refresh_token`. A long prep workflow can outlive
it.

**Mitigation**: a single `getValidGithubToken(userId)` helper that
checks `expiry_date - now() < 5 min`, refreshes via `refresh_token`
when needed, persists the new tokens before the next network call.
If refresh fails, the workflow marks the repo `status='failed'`
with `error_message='github_token_expired'` and returns.

> If this helper doesn't already exist somewhere in `src/lib`, it
> has to be written before phase-1 prep workflow can be reliable.
> Mark as a prerequisite (§ 4 below).

### 3.6 HNSW filter selectivity (Phase 3)

Every `semantic_search` query carries
`WHERE user_id = $1 AND repo_index_id = $2`. With a global HNSW
index, most candidates get filtered out post-fetch and we get
fewer than `LIMIT` rows.

**Mitigation**: pin `vector >= 0.8` and use iterative scans inside
the search RPC:

```sql
CREATE OR REPLACE FUNCTION search_repo_code_vectors(
  p_user_id UUID,
  p_repo_index_id UUID,
  p_query_embedding vector(1024),
  p_limit INT DEFAULT 10,
  p_min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (...)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM set_config('hnsw.iterative_scan', 'strict_order', true);
  PERFORM set_config('hnsw.max_scan_tuples', '20000', true);
  RETURN QUERY
  SELECT ...
  FROM repo_code_vectors c
  WHERE c.user_id = p_user_id
    AND c.repo_index_id = p_repo_index_id
    AND 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_limit;
END $$;
```

Alternative for very large multi-tenant scale (deferred to a later
phase): partition `repo_code_vectors` by `repo_index_id` so each
query lands on a small per-repo HNSW index.

### 3.7 Tree-sitter native bindings on Vercel

Phase 3 needs `tree-sitter`, `tree-sitter-python`,
`tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-c`,
`tree-sitter-cpp` — same set Shadow's `languages.ts` lazy-loads.

These are Node-N-API addons with prebuilt binaries for common Linux
+ Node 22 combos. Shadow runs Node 22 and relies on these working.
Validation step before phase 3:

1. Confirm Vercel's serverless Node runtime version is 22.x.
2. Add a tiny smoke test: `npm i tree-sitter tree-sitter-typescript`
   in a throwaway branch, deploy, parse a sample file. If the
   prebuilt binary doesn't load, fall back to either: (a) shipping
   the native deps via a Lambda layer, (b) running tree-sitter
   inside the Daytona sandbox only (where the build env is
   guaranteed). Option (b) is cleaner but slower per-file.

### 3.8 Voyage rate limits

`voyage-code-3` is roughly 300 RPM with batch size 128. A 30k-chunk
repo takes ~50 minutes to embed. Acceptable for background, not
for "user clicked the repo".

The Phase 3 prep workflow handles this with explicit per-batch
sleep when 429s come back, and writes chunks to
`repo_code_vectors` incrementally so `semantic_index` can flip to
`'partial'` after the first batch — useful for partial-availability
during a long embed.

## 4. Prerequisites that block Phase 1

These are NOT design choices — they're concrete things the rebuild
won't work without. Ordered by blocker severity.

1. **Add `installation_id` to `connected_apps`** (or a sibling
   table) and capture it during the GitHub App install flow.
   Without this, the push webhook's "match installation → user"
   lookup returns null for every push, so the stale-on-push path
   is unbuildable. Migration:
   ```sql
   ALTER TABLE connected_apps ADD COLUMN installation_id TEXT;
   CREATE INDEX connected_apps_installation_idx
     ON connected_apps (installation_id) WHERE installation_id IS NOT NULL;
   -- Backfill: existing rows stay NULL until the user re-installs the App
   -- or until a new App-install webhook handler captures it.
   ```
2. **Confirm OAuth token refresh helper exists** in `src/lib`. If
   not, write `getValidGithubToken(userId)` (§ 3.5).
3. **Confirm Daytona sandbox image has `apt`**. The existing
   `daytona-tools.ts:create_sandbox` already runs
   `apt-get install -y -qq gh`, so this is a known property.
   `apt-get install -y -qq ripgrep fd-find` joins the same line.
4. **Pin `vector >= 0.8`** — only needed before Phase 3 migration.
   Worth confirming the Supabase project's pgvector version now.

## 5. Phased rollout

We don't ship the whole thing at once. Each phase is independently
useful and reversible.

### Phase 1 — restore basic functionality (no embeddings)

Goal: `/api/repo-agent/initialize` no longer 500s; the chat picker
works again with the simplest possible backend.

- New migration: `repo_indexes` + `repo_skeletons` + `repo_memories`
  with RLS.
- New `src/lib/repo-prep/*` module (clone, walk, skeleton,
  agents_md detection — no chunker, no embedder).
- New `/api/workflow/repo-prep/route.ts` running steps 1–5 + 8
  from Part 1 § 4.1 (no embedding step).
- Refactor `/api/repo-agent/initialize/route.ts` to read
  `repo_indexes` instead of the deleted `repo_index_status`.
  Use the atomic upsert SQL.
- Refactor `src/lib/repo-agent/tools.ts`:
  - `get_repo_overview` now reads `repo_skeletons` + `agents_md`.
  - Drop the old `search_repo_code` / `get_repo_structure` /
    `read_repo_file` shape; keep their behaviour but rename to
    match the new tool surface (§ 1).
- Delete `src/lib/repo-agent/indexer-script.ts` (legacy disk
  vector store).
- Property tests:
  - "for any `(user_id, repo_full_name)` row with `status='ready'`
    AND NOT `is_stale`, calling `/initialize` returns within 1 s
    and produces zero Daytona traffic"
  - "for any repo not yet prepped, the workflow completes and the
    skeleton row contains the same files we'd see from
    `git ls-files` minus the exclusion list"
  - "for any push event with a known installation, the matching
    `repo_indexes` row ends up `is_stale = true` and zero
    embedding traffic happens" (gated on prerequisite 1)

### Phase 2 — per-session sandbox + memory tools

Goal: the chat agent has a real working environment with
persistent learned facts.

- New `/api/repo-agent/session/route.ts` that creates / reuses a
  per-(tab, repo) sandbox. Move the sandbox creation out of
  `initialize` and into here.
- Add ripgrep + fd to the sandbox boot command.
- Wire all tools from § 1 except `semantic_search`.
- Wire `repo_memories` into the system prompt builder.
- Property tests for tool isolation:
  - "user A's sandbox cannot read user B's repo"
  - "memory writes from user A do not appear in user B's
    `list_memories`"
  - "category filter on `list_memories` returns only matching rows"

### Phase 3 — semantic search (gated by feature flag)

Goal: cover the conceptual-query case grep can't.

- New migration: `repo_code_vectors` + HNSW index + RPC.
- Validate tree-sitter prebuilt binaries on Vercel runtime
  (§ 3.7). If they don't load, switch to in-sandbox tree-sitter.
- New step in `repo-prep` workflow: chunk + embed + insert.
  Reimplementation of Shadow's chunker logic in our own module
  (no copy from `shadow/apps/server/src/indexing/chunker.ts`).
- New `semantic_search` tool with mandatory grep fallback (§ 1.1).
- Backfill job: for any `repo_indexes` row with
  `semantic_index = 'none'` and `status = 'ready'`, schedule a
  batch-capped re-prep so we don't blow the Voyage rate limit.
- Property tests:
  - "no row of `repo_code_vectors` returned to user A belongs to
    user B"
  - "every `(repo_index_id, file_path, chunk_index)` is unique"
  - "after re-prep, deleted files have no surviving vectors"

### Phase 4 — repo wiki (stretch, gated by feature flag)

Goal: the agent gets a generated narrative for instant orientation,
matching what Shadow's "Shadow Wiki" gives them.

- New migration: `repo_wiki`.
- New step in `repo-prep` workflow: bottom-up directory summary
  via a mini model (`claude-3-5-haiku` or `gpt-4o-mini`).
  Reimplementation of Shadow's `shadowwiki/core.ts` flow in our
  own module.
- Inject `repo_wiki.content.rootSummary` into the system prompt
  block from § 2.5.
- Property tests:
  - "wiki is regenerated when `is_stale` flips"
  - "wiki content stays under 8 KB for the rootSummary slice"

## 6. Open questions for you (non-blocking)

Defaults are listed; flag any you want changed.

1. **Phase 3 timing**: do we ship semantic search in v1 or wait
   until Phase 1 + 2 are stable in production? Default: wait.
2. **Sandbox lifetime**: per-(tab, repo) like today vs per-chat-
   session. Default: per-(tab, repo), matching today's behaviour.
3. **Tarball vs git clone in Daytona**: tarball is faster for prep
   but loses git history. Default: tarball for the workflow's prep
   step (where we don't need git), `git clone --depth=50` inside
   the per-session sandbox (where the agent does want git).
4. **AGENTS.md fallback**: if a repo has no AGENTS.md, do we auto-
   generate a stub? Default: no in Phase 1, yes in Phase 4 via the
   wiki path.
5. **Memory write policy**: free for `category in (BUILD, TEST,
   PATTERNS, BUGS, PERFORMANCE, CONFIG, GENERAL)`, user confirm
   for `category = ARCHITECTURE`. Reasonable starting heuristic;
   revisit after 2 weeks of telemetry.
6. **Wiki generation cost**: Shadow uses a "mini" model (Haiku /
   gpt-4o-mini). Default: Haiku. ~$0.10–0.50 per medium repo.

## 7. Out of scope for this rebuild

- Re-introducing chained indexing into github-memory-ingest /
  github-memory-sync. Stays disabled, per the existing
  `remove-repo-indexer-background-jobs` spec.
- Cross-user repo sharing.
- Public-repo "anyone can ask" mode (DeepWiki feature).
- Multi-language symbol resolution beyond what tree-sitter gives us.
- Replacing Daytona with a different sandbox vendor.
- Replacing Upstash with a different workflow runtime.

---

When you're ready, the next step is to turn Phase 1 into a proper
spec — a small bugfix-style spec to land the prerequisites
(`installation_id` migration + OAuth refresh helper + fix
`/initialize` so it doesn't 500), followed by a feature spec for
the new tables + prep workflow + tool surface refactor.
