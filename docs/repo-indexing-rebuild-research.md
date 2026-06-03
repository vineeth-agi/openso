# Repo Indexing Rebuild — Research & Findings

> Companion doc: see `docs/repo-indexing-rebuild-plan.md` for the
> proposed architecture and phased rollout. This file captures the
> research that drives the decisions there.

## 0. Confidence levels (revalidation 2026-05-28, after local clones)

I shallow-cloned both reference repos with `git clone --depth=1
--filter=blob:none` into `.tmp-research/`, read the actual source,
and then deleted the clones. Confidence has been upgraded for the
claims I could verify directly.

| Claim | Source | Confidence |
| --- | --- | --- |
| Our `repo_index_status` / `repo_code_chunks` tables are gone and `/api/repo-agent/initialize` queries them | Direct read of `prod-db.sql` + `initialize/route.ts` | **High — verified** |
| Our `connected_apps` has no `installation_id` column | Direct read of `prod-db.sql` lines 65-71 | **High — verified** |
| Our Daytona tools use `grep` + `find`, not `rg`/`fd` | Direct read of `daytona-tools.ts` | **High — verified** |
| Our chat sandbox is per-repo-selection per-tab, auto-deletes after 15 min | Direct read of `chat-page.tsx` + `daytona-tools.ts` | **High — verified** |
| Shadow uses tree-sitter + a code graph + Pinecone for code search | Direct read of `apps/server/src/indexing/{indexer.ts,graph.ts,chunker.ts,embedderWrapper.ts,languages.ts}` | **High — verified** |
| Shadow has a `RepositoryIndex` table keyed on `repoFullName` with `lastCommitSha` | Direct read of `packages/db/prisma/schema.prisma` | **High — verified** |
| Shadow's tool surface: `read_file`, `edit_file`, `search_replace`, `delete_file`, `list_dir`, `grep_search`, `file_search`, `semantic_search`, `run_terminal_cmd`, `todo_write`, `add_memory`, `list_memories`, `remove_memory` | Direct read of `apps/server/src/agent/tools/index.ts` | **High — verified** |
| Shadow's `semantic_search` is gated on `isIndexingComplete(repo)` and falls back to `grep_search` if no repo or indexing not done | Direct read of `tools/index.ts` lines ~210-310 | **High — verified** |
| Shadow has a `Memory` model with categories (INFRA, SETUP, STYLES, ARCHITECTURE, TESTING, PATTERNS, BUGS, PERFORMANCE, CONFIG, GENERAL) keyed on `(userId, repoFullName)` | Direct read of `schema.prisma` | **High — verified** |
| Shadow has a separate `CodebaseUnderstanding` model storing LLM-generated wiki content keyed on `repoFullName` | Direct read of `schema.prisma` + `shadowwiki/db-storage.ts` | **High — verified** |
| Shadow's "Shadow Wiki" pre-generates a per-repo narrative summary during init using a small/cheap LLM and tree-sitter symbol extraction | Direct read of `indexing/shadowwiki/core.ts` | **High — verified** |
| Shadow's chunker chunks at function/class boundaries with sliding-window fallback at 200 lines per chunk | Direct read of `chunker.ts` + `constants.ts` (`DEFAULT_MAX_LINES_PER_CHUNK = 200`) | **High — verified** |
| Shadow's webhook handler only reacts to PR-closed events (archives the task), NOT push events | Direct read of `webhooks/github-webhook.ts` | **High — verified** |
| Shadow has a `local` vs `remote` execution mode abstraction; `ToolExecutor` interface unifies file ops, grep, semantic search, git, and command exec across both | Direct read of `execution/index.ts` + `interfaces/tool-executor.ts` | **High — verified** |
| Shadow's "background indexing" tracks active jobs in an in-memory `Map<repoFullName, Promise<void>>` for duplicate suppression and skips if `lastCommitSha` matches the task's `baseCommitSha` | Direct read of `initialization/background-indexing.ts` | **High — verified** |
| OpenHands' v1 default agent (`CodeActAgent`) lives in a sibling repo (`software-agent-sdk`), not in `OpenHands/OpenHands` | This repo's README + `app_server` layout: server-only here | **High — verified** |
| OpenHands repo we cloned has no embedding/vector code in the server tree; storage is only event/file storage (S3/GCS/local) | grep_search across all of `openhands/` returns no embedding/vector/pinecone references in agent context | **High — verified** |
| OpenHands microagents = markdown files at `.openhands/microagents/*.md` or repo-root `AGENTS.md`, optionally activated by triggers in frontmatter | Direct read of `OpenHands/AGENTS.md` § Microagents and `.openhands/microagents/` layout | **High — verified** |
| Devin / DeepWiki retrieval architecture | Public Cognition AI posts only — internals not published | **Low — directional only** |
| Cursor uses both grep and async vector index | Public Cursor blog | **Medium — secondary sources** |

## 1. Where we are right now

- The previous indexer (`src/lib/repo-indexer/*` + tables `repo_code_chunks`,
  `repo_index_status` + `/api/workflow/repo-index-incremental`) has been
  removed from the DB and from the code surface.
- What still exists:
  - `src/app/api/repo-agent/initialize/route.ts` — still references the
    deleted tables (`repo_index_status`) and the deleted workflow
    (`repo-index-incremental`). It will 500 on first call.
  - `src/lib/repo-agent/tools.ts` — sandbox-based search tools
    (`search_repo_code`, `get_repo_structure`, `read_repo_file`) tied
    to a Daytona sandbox per repo.
  - `src/lib/repo-agent/indexer-script.ts` — script that previously ran
    inside a sandbox to build a JSON vector store on disk.
  - The chat UI at `src/views/chat/chat-page.tsx` still calls
    `/api/repo-agent/initialize` and shows an "indexing..." pill.
- Daytona, Upstash Workflow, Voyage AI, and Supabase pgvector are all
  configured and used elsewhere in the app. We are not introducing new
  vendors.

So the rebuild is greenfield on storage, but we have to drop into the
existing chat UI, the Daytona helpers (`src/lib/tools/daytona-tools.ts`),
and the Upstash Workflow runtime without disturbing them.

## 2. What the two reference repos actually do (verified, not guessed)

### 2.1 Shadow (`ishaan1013/shadow`) — the closer match to our problem

Shadow does, in fact, build a real semantic index. The "Pinecone is
optional" framing in the README is misleading — the indexer always
runs against Pinecone, and `semantic_search` is gated on whether the
indexing for the repo is complete. What's optional is whether you
*enable* indexing for a repo at all (`UserSettings.enableIndexing`).

The `apps/server/src/indexing/` pipeline is:

1. `indexer.ts:indexRepo(repoFullName, taskId, options)` — orchestrator.
   - Walks the repo via the `ToolExecutor` abstraction (works in
     both local mode and the remote Kata-container mode).
   - Skips dirs starting with `.` (except `.github`), and
     `node_modules`, `dist`, `build`, `.next`, `coverage`.
   - Skips files whose extension is in `EXCLUDED_EXTENSIONS`.
   - For supported langs (Python, JS, TS, TSX, C, C++) loads a
     tree-sitter grammar via `safeRequire(name)` lazy-loader.
   - For unsupported langs creates fixed-200-line chunks.
   - For supported langs runs `extractGeneric(rootNode, spec, src)`
     to pull `defs`, `imports`, `calls`, `docs` nodes.
   - Builds a graph of `REPO → FILE → SYMBOL → CHUNK`, plus
     `SYMBOL → SYMBOL CALLS` cross-file edges (only when the callee
     symbol name is unique repo-wide).
   - Calls `chunkSymbol({...})` per symbol to produce CHUNK nodes,
     with three strategies: whole-symbol (≤200 lines), AST-aware
     subdivision by named children, sliding window fallback.
   - Files with no extracted symbols still get file-level chunks.
   - At the end, calls
     `embedAndUpsertToPinecone(graph.nodes, repo, {clearNamespace})`
     which routes through Pinecone's auto-embed API (no Voyage/OpenAI
     direct calls in the server).
   - The Pinecone metadata stores `code` (truncated to 5000 chars),
     `path`, `name`, `lang`, `line_start`, `line_end`, `kind`,
     `fullCode` (for embedding only).

2. `RepositoryIndex` table (Prisma) is the per-repo state row:
   - `id`, `repoFullName UNIQUE`, `lastIndexedAt`, `lastCommitSha`,
     `createdAt`, `updatedAt`. That's it. Status is implicit:
     a row exists ⇒ indexed at that commit.

3. `initialization/background-indexing.ts` triggers the indexer:
   - Holds an in-process `Map<repoFullName, Promise<void>>` to
     suppress duplicates within a single Node process.
   - Reads the current task's `baseCommitSha` and skips if
     `RepositoryIndex.lastCommitSha === baseCommitSha`.
   - Fires `indexRepo` async (no await on the caller path), updates
     `RepositoryIndex.lastIndexedAt + lastCommitSha` in `.finally`.

4. `agent/tools/index.ts` is the tool factory. `createTools(taskId)`:
   - Reads `task.repoUrl` to figure out the repo.
   - Calls `isIndexingComplete(repo)` (= "row in `RepositoryIndex`
     exists AND no in-flight job"). If true, exposes
     `semantic_search`. If false, the tool is omitted from the toolset
     and the LLM only gets `grep_search` + `file_search`.
   - Even when `semantic_search` is exposed, its `execute` falls back
     to `grep_search` if `repo` can't be resolved.

5. `Memory` model (Prisma) is per-`(userId, repoFullName)`:
   - Categories: INFRA, SETUP, STYLES, ARCHITECTURE, TESTING,
     PATTERNS, BUGS, PERFORMANCE, CONFIG, GENERAL.
   - Three tools: `add_memory`, `list_memories`, `remove_memory`.
   - Loaded automatically into the system prompt at chat init.

6. `CodebaseUnderstanding` model (Prisma) — separate from indexing:
   - One row per `repoFullName UNIQUE`.
   - Stores LLM-generated wiki content as JSONB.
   - Generated by `indexing/shadowwiki/core.ts` during init using a
     "mini" model (Claude Haiku, GPT-4o-mini, or Grok-3 small).
   - Walks the file tree, extracts tree-sitter symbols, summarizes
     each file with the mini model into ≤200 tokens, then
     bottom-up summarizes directories. Final `rootSummary` is
     injected into the agent system prompt as
     `<codebase_architecture>...</codebase_architecture>`.
   - Gated on `UserSettings.enableShadowWiki` (default true).
   - This is what lets the agent "orient" without paying for
     embeddings — it's a markdown narrative, not a vector store.

7. Webhook (`webhooks/github-webhook.ts`):
   - Only handles `pull_request.closed` (merged or just closed).
   - Archives the matching `Task` rows.
   - Does NOT trigger any re-indexing on push. Re-index is implicit:
     when a new task is created at a new `baseCommitSha`,
     `startBackgroundIndexing` fires.

8. `ToolExecutor` interface (`execution/interfaces/tool-executor.ts`):
   - Unified shape for both local and remote modes:
     `getFileStats`, `readFile`, `writeFile`, `deleteFile`,
     `searchReplace`, `listDirectory`, `listDirectoryRecursive`,
     `searchFiles` (file_search), `grepSearch`, `semanticSearch`
     (delegates to Pinecone retrieval), `executeCommand`,
     `getWorkspacePath`, `isRemote`, `getTaskId`, plus git ops.
   - Local mode uses Node `fs` + child_process; remote mode posts to
     a sidecar service running inside each Kata container.

### 2.2 OpenHands (`All-Hands-AI/OpenHands`, formerly `OpenHands/OpenHands`)

The repo we cloned is **not** the agent runtime. The actual
`CodeActAgent` and tool implementations live in a sibling repo,
`software-agent-sdk`. The cloned repo is a server + integrations
+ frontend that wraps the SDK. Confirmed by:

- README explicitly points to
  `https://github.com/OpenHands/software-agent-sdk/`.
- No embedding / vector / pinecone / chromadb references anywhere
  in `openhands/app_server/` or `openhands/server/`.
- `openhands/app_server/sandbox/*` is the agent's runtime
  abstraction — Docker, K8s/remote, process-local. The agent is
  whatever the SDK gives you.

What is actually in this repo and matters to us:

1. **Microagents convention.** Repo-root `AGENTS.md` is loaded as
   always-on context. Files under `.openhands/microagents/*.md` are
   loaded on demand with optional trigger keywords in frontmatter.
   This is the one architectural decision we'll mirror directly.
2. **No background pre-embedding step.** The default agent navigates
   with whatever tools the SDK exposes, which the
   `skills/default-tools.md` microagent advertises as MCP-driven
   (e.g., `mcp-server-fetch`). The actual file-finding tools
   (read/write/grep/find) come from the SDK's runtime, not from
   anything in this repo.
3. **Sandbox spec model.** Every conversation gets a `SandboxSpec`
   (Docker image, command, cwd, secrets). The spec model in
   `openhands/app_server/sandbox/sandbox_spec_models.py` is a
   reasonable target for our `repo_session` shape.

The takeaway: OpenHands is a **good reference for tool naming and the
microagent / AGENTS.md convention**, but it does not give us
a "how to index a repo" answer because it doesn't pre-index. Shadow
is the source of truth for that.

### 2.3 Devin / DeepWiki (Cognition AI)

Public posts only — internals not in any open repo we can clone.
Used as a directional reference: "agent navigates, supplemented by a
generated wiki" matches what Shadow actually does (Shadow Wiki +
optional semantic_search), so the Devin posture is consistent with
Shadow's implementation.

## 3. Architectural primitives we now have a verified model for

| Concern | Primitive | Anchor (verified) |
| --- | --- | --- |
| Per-repo state row | `RepositoryIndex { repoFullName UNIQUE, lastCommitSha, lastIndexedAt }` | Shadow `schema.prisma` |
| Per-repo memory | `Memory { userId, repoFullName, category enum, content }` keyed by `(userId, repoFullName)` | Shadow `schema.prisma` |
| Per-repo wiki / overview | `CodebaseUnderstanding { repoFullName UNIQUE, content JSONB }` | Shadow `schema.prisma` + `shadowwiki/db-storage.ts` |
| Code graph | `Graph { nodes: REPO/FILE/SYMBOL/CHUNK/IMPORT/COMMENT, edges: CONTAINS/PART_OF/NEXT_CHUNK/CALLS/DOCS_FOR }` | Shadow `indexing/graph.ts` + `indexer.ts` |
| Chunk strategy | tree-sitter symbols, AST subdivision, sliding window, 200-line cap | Shadow `chunker.ts` + `constants.ts` |
| Vector store | Pinecone with namespace per repo, auto-embed API, metadata-only `fullCode` for embedding | Shadow `embedderWrapper.ts` + `pineconeService.ts` |
| Tool surface | `read_file`, `list_dir`, `grep_search`, `file_search`, `edit_file`, `search_replace`, `delete_file`, `run_terminal_cmd`, `todo_write`, `add_memory`, `list_memories`, `remove_memory`, `semantic_search` | Shadow `agent/tools/index.ts` |
| Agent system prompt structure | Identity → environment → operation phases (discovery / planning / execution) → tool-usage hierarchy → parallel-tool guidance → context understanding → quality / security / completion checklist | Shadow `agent/system-prompt.ts` |
| Microagent / AGENTS.md convention | `AGENTS.md` always-on; `.openhands/microagents/*.md` triggered by keywords in frontmatter | OpenHands `AGENTS.md` § Microagents |
| Execution-mode abstraction | `ToolExecutor` interface, factory at process boundary, local vs remote impls behind a single API | Shadow `execution/interfaces/tool-executor.ts` + `execution/index.ts` |

## 4. Big architectural question — sandbox or workflow?

Now answered with verified evidence:

- **Shadow's `indexer.ts` runs synchronously on the same process as
  the chat server**, in a fire-and-forget Promise. It calls into
  `ToolExecutor` for the actual file walk, which means in remote
  mode it talks to the per-task sidecar over HTTP.
- The "background" in `startBackgroundIndexing` is process-level
  asynchronicity, not a separate workflow runtime. Duplicate
  suppression is an in-memory Map keyed by `repoFullName`.
- This works for them because their server is a long-running
  Node process. Ours is Vercel functions.

For us, the equivalent is:

- **Upstash Workflow plays the role of Shadow's
  `startBackgroundIndexing`** — same idempotency guarantees,
  durable retry, no in-process state.
- **Daytona sandbox plays the role of Shadow's `ToolExecutor`** —
  the agent talks to it for grep/read/exec at chat time, and the
  workflow can also use it as the place to clone large repos that
  won't fit in a Vercel function's memory.
- **Postgres replaces Shadow's Prisma DB** for the three persistent
  tables (`repo_indexes`, `repo_memories`, `repo_code_vectors`,
  optionally `repo_wiki`).
- **pgvector replaces Pinecone** for `semantic_search`. Shadow's
  Pinecone use is mostly the auto-embed convenience; we have to
  embed explicitly with Voyage and pin pgvector ≥ 0.8 for
  iterative scans.

## 5. Indexing strategy revisited (with Shadow numbers)

| Decision | Shadow | Our plan |
| --- | --- | --- |
| Chunk strategy | symbol-level via tree-sitter, sliding window for unsupported | same |
| Max chunk size | 200 lines | match (fits Voyage `voyage-code-3` 16k token context easily) |
| Languages with AST | Python, JS, TS, TSX, C, C++ | match for Phase 3, expand later |
| Embedding model | Pinecone auto-embed (likely Cohere/llama under the hood for `multilingual-e5`) | Voyage `voyage-code-3` (1024-dim, code-tuned) |
| Namespace per repo | yes (Pinecone namespace = repo) | partition / index by `repo_index_id` in pgvector |
| Wiki / overview | yes — generated during init by mini model | yes — Phase 4 |
| Per-repo memory | yes (10 categories) | yes — Phase 2 |
| Webhook-driven re-index | NO (only PR-closed handler exists) | match — webhook just sets `is_stale`, re-prep on next selection |
| Trigger | implicit at task creation when `baseCommitSha` differs | explicit on `/api/repo-agent/initialize` cold path |

Shadow's "no webhook re-index" position is actually the simplest
useful answer. It avoids the failure mode that triggered our
`remove-repo-indexer-background-jobs` spec.

## 5b. False positives caught during revalidation

These came from the v1 draft and have been removed or corrected in
the plan doc. Keeping the audit trail so they don't sneak back in.

1. **"OpenHands' default agent uses `grep_search` (ripgrep)"** —
   misleading. The agent + tools live in the sibling
   `software-agent-sdk` repo, not in the cloned `OpenHands/OpenHands`
   repo. The naming convention is real, the implementation isn't
   in the repo I read.
2. **"Shadow's semantic_search is opt-in / Pinecone is optional"** —
   wrong. Pinecone is the only retrieval store in Shadow's indexing
   pipeline. What's optional is whether the user enables indexing
   per-account. When indexing IS enabled, Pinecone is required.
3. **"GitHub access tokens from `connected_apps` are installation
   tokens"** — false. They are OAuth user tokens with `expiry_date`
   and `refresh_token`. Different security and refresh model.
4. **"pgvector pre-filters by composite B-tree, then HNSW on the
   filtered set"** — not how pgvector < 0.8 works. The plan now
   pins `vector >= 0.8` and uses iterative scans.
5. **"Sandbox per chat session"** — actually per-repo-selection
   per-tab in our existing `chat-page.tsx`. Plan reflects that.
6. **"OpenHands microagent loop is the right orientation pattern"** —
   half-true. The `AGENTS.md` + `.openhands/microagents/repo.md`
   convention is real and worth mirroring. But Shadow's `Shadow Wiki`
   is the more useful pattern for our case because it generates
   the orientation content automatically instead of requiring the
   user to write it.

## 6. Constraints and gotchas we already know

- **Vercel function memory and time limits** rule out cloning a
  large monorepo in an API route. Cloning has to live in either an
  Upstash Workflow step (durable, but each step still has a wall
  clock) or inside a Daytona sandbox (no Vercel limits). For repos
  > 200 MB or > 10k files, Daytona is the only viable place.
  Shadow sidesteps this by running everything in a long-lived Node
  process — we can't.
- **Upstash Workflow** has a per-step ceiling that's the underlying
  Vercel function timeout per `context.run`. Set `maxDuration` per
  route; Pro tier raises it.
- **Daytona sandboxes** cost money per active minute. `autoDeleteInterval=15`
  caps the bleeding; aligns with Shadow's K8s "scheduled cleanup" pattern.
- **Voyage AI rate limit** for `voyage-code-3` is roughly 300 RPM
  with batch=128. A 30k-chunk repo takes ~50 minutes to embed. That
  is acceptable for background but unacceptable for "user clicked
  the repo". Shadow uses Pinecone auto-embed which has its own
  rate-limiting, but the same order-of-magnitude problem.
- **Tree-sitter native bindings** need a working `node-gyp`-friendly
  build environment. `tree-sitter`, `tree-sitter-typescript`,
  `tree-sitter-python`, `tree-sitter-javascript`, etc. all ship
  prebuilt binaries for common Linux + Node 22 combos. Worth
  checking Vercel's Node runtime supports the ABI before phase 3.
  Shadow uses Node 22 per their README and this works for them.
- **GitHub tarball download** via `GET /repos/{owner}/{repo}/tarball/{ref}`
  works without git installed on the runner. Streaming the tarball
  in-memory is feasible up to a few hundred MB before it's worth
  switching to disk-backed extraction inside a sandbox. Shadow
  sidesteps this entirely by always cloning into a workspace.
- **Per-user RLS** must be enforced in any new table. The deleted
  schema had it; we re-instate it. Shadow's Prisma model leans on
  app-layer auth (`userId` on every row + Express middleware), no
  RLS; we want both belts and braces because Supabase makes it
  cheap.

## 7. References (verified during clone-and-read pass)

- **Shadow** (`ishaan1013/shadow`, MIT) — local clone read directly:
  - `apps/server/src/indexing/{indexer.ts, graph.ts, chunker.ts,
    languages.ts, embedderWrapper.ts, codebase-retrieval.ts,
    constants.ts, README.md}`
  - `apps/server/src/indexing/shadowwiki/{core.ts, db-storage.ts}`
  - `apps/server/src/agent/tools/index.ts`
  - `apps/server/src/agent/system-prompt.ts`
  - `apps/server/src/initialization/background-indexing.ts`
  - `apps/server/src/execution/{index.ts, interfaces/tool-executor.ts}`
  - `apps/server/src/webhooks/github-webhook.ts`
  - `packages/db/prisma/schema.prisma`
- **OpenHands** (`All-Hands-AI/OpenHands`, MIT) — local clone read
  directly:
  - `AGENTS.md` (full file, including § Microagents)
  - `openhands/app_server/` and `openhands/server/` directory layouts
  - `skills/default-tools.md`
  - confirmed by grep: no embedding/vector/pinecone/chromadb code
    anywhere in the agent path (only in cloud storage modules).
- pgvector 0.8 release notes + Neon / pgedge docs on iterative scans.
- AGENTS.md spec at `github.com/openai/agents.md` — cross-tool
  repo-root convention.

All sources rephrased for compliance with their respective licensing
restrictions. We did not copy any code from either reference repo.
The plan doc is informed by the architecture, but the implementation
will be ours.
