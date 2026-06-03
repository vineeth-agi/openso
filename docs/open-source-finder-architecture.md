# Open Source Issue Finder — Architecture & Implementation Plan

> Natural language search for open source contribution opportunities using pgvector semantic search + structured filters.

> **Note on runtime:** This document refers throughout to "Inngest" — the
> background-sync runtime described here was migrated to **Upstash Workflow**.
> Conceptually nothing changes (durable steps, cron triggers, concurrency
> controls); only the SDK/API surface differs. The current handler lives at
> `src/app/api/workflow/open-issues-sync/route.ts` and is triggered via
> `workflowClient.trigger(...)` instead of `inngest.send(...)`. Cron is
> declared in `src/lib/workflow/schedules.ts` and provisioned with
> `npm run workflow:sync-schedules`.

---

## Overview

When a user asks "find easy auth bugs in Python AI projects", the system:
1. **Parses** the query into structured filters (language, difficulty, type) + semantic topic
2. **Embeds** the semantic topic into a vector
3. **Queries** Supabase pgvector with filters + vector similarity
4. **Returns** ranked, context-rich issues

No GitHub API calls at search time — all data is pre-synced.

---

## Architecture Diagram

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PART 1 — BACKGROUND SYNC (Inngest cron, every 6 hours)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

open_source_repos table (7 curated repos)
         │
         ▼
For each repo → GitHub REST API
  GET /repos/{owner}/{name}/issues
    ?state=open
    &per_page=100
    &sort=updated
    &since={last_synced_at}   ← incremental after first sync
    Paginate through ALL pages
         │
         ▼
For each issue:
  ├─ SKIP if pull_request field present (it's a PR)
  ├─ SKIP if state_reason = "not_planned"
  ├─ SKIP if is_locked = true
  │
  ├─ Extract metadata:
  │   number, title, body[:500], url
  │   labels[], assignees[], comments
  │   reactions["+1"], author_association
  │   milestone, created_at, updated_at
  │
  ├─ Classify fields:
  │   difficulty     → from labels (see label map below)
  │   issue_type     → from labels (see label map below)
  │   has_help_wanted → "help wanted" label present
  │   is_assigned    → assignees.length > 0
  │   body_length    → body.length (quality signal)
  │   author_is_maintainer → author_association in [OWNER, MEMBER, COLLABORATOR]
  │
  ├─ Build embed text:
  │   ONLY semantic content:
  │     title + "\n" + body[:500]
  │   DO NOT embed language/labels/repo name
  │
  └─ embedBatch(20 at a time)  // respect 40 RPM rate limit
         │
         ▼
Upsert into open_source_issues table
Delete issues no longer open (closed since last sync)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PART 2 — SEARCH PIPELINE (on user query, real-time)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User: "find easy auth bugs in Python AI projects"
         │
         ▼
LLM parses into structured tool call:
  {
    topic: "authentication bugs",     ← semantic search
    language: "Python",               ← structured filter
    difficulty: "easy",               ← structured filter
    issue_type: "bug",                ← structured filter
    unassigned_only: true,            ← structured filter
    help_wanted_only: false,
    well_described_only: true,
    max_age_days: 90,
    limit: 10
  }
         │
         ▼
embed("authentication bugs") → vector[768]
         │
         ▼
supabase.rpc('match_open_issues', {
  query_embedding: vector,
  filter_language: "Python",
  filter_difficulty: "easy",
  filter_type: "bug",
  filter_unassigned: true,
  ...
})
         │
         ▼
SQL: filter WHERE clauses + ORDER BY vector similarity
         │
         ▼
JOIN open_source_repos → get stars, language, avatar
         │
         ▼
Return formatted results to chat
```

---

## Key Design Principle: Separate EMBED from FILTER

### EMBED (semantic content only)
Only the **meaning** of the issue goes into the vector:
```
title: "JWT token not refreshing on 401"
body[:500]: "When a user authenticates with OAuth2 and the
             JWT expires after 1hr, the refresh token
             silently fails causing 401 on all API calls..."
```

### FILTER (structured metadata)
Stored as normal columns, queried with SQL WHERE:
```
language         → "Python" / "TypeScript"    (from repo table)
labels[]         → ["auth", "good first issue"]
difficulty       → "easy" / "medium" / "hard"
issue_type       → "bug" / "documentation" / "test" / "feature"
has_help_wanted  → boolean
is_assigned      → boolean
comment_count    → integer
body_length      → integer (quality proxy)
reactions_plus_one → integer (popularity signal)
author_is_maintainer → boolean (trust signal)
updated_at       → recency filter
```

### WHY separate?
If you embed "Python" into the vector, an issue titled "Fix Python parser in TypeScript codebase" matches "Python" queries. **Wrong.** Structured data must be filtered, not embedded.

---

## Database Schema

### Table: `open_source_issues`

```sql
CREATE TABLE open_source_issues (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id               uuid REFERENCES open_source_repos(id) ON DELETE CASCADE,
  github_id             bigint UNIQUE NOT NULL,
  number                int NOT NULL,
  title                 text NOT NULL,
  url                   text NOT NULL,
  labels                text[] DEFAULT '{}',

  -- Difficulty & type classification
  difficulty            text DEFAULT 'unknown',      -- easy/medium/hard/unknown
  issue_type            text DEFAULT 'other',        -- bug/documentation/test/feature/refactor/other
  has_help_wanted       boolean DEFAULT false,       -- "help wanted" label present

  -- Availability signals
  is_assigned           boolean DEFAULT false,
  has_open_pr           boolean DEFAULT false,       -- someone already opened a PR for this
  is_claimed_by_label   boolean DEFAULT false,       -- "wip"/"claimed"/"in-progress" label present
  comment_count         int DEFAULT 0,

  -- Skip signals (issues not worth contributing to)
  is_stale              boolean DEFAULT false,       -- "stale" label = risky
  is_needs_triage       boolean DEFAULT false,       -- "needs-triage" = not yet reviewed
  is_blocked            boolean DEFAULT false,       -- "blocked" label
  is_duplicate          boolean DEFAULT false,       -- marked as duplicate via timeline

  -- Quality & popularity signals
  body_length           int DEFAULT 0,               -- chars of body (quality proxy)
  reactions_plus_one    int DEFAULT 0,               -- 👍 community wants this fixed
  reactions_eyes        int DEFAULT 0,               -- 👀 maintainer watching (confirmed priority)
  reactions_rocket      int DEFAULT 0,               -- 🚀 excitement/momentum
  author_is_maintainer  boolean DEFAULT false,       -- OWNER/MEMBER/COLLABORATOR
  has_sub_issues        boolean DEFAULT false,       -- has sub-issues (might be complex parent)

  -- Status
  has_milestone         boolean DEFAULT false,
  milestone_due_soon    boolean DEFAULT false,       -- milestone due within 30 days (urgent/wanted)
  is_locked             boolean DEFAULT false,
  created_at            timestamptz,
  updated_at            timestamptz,
  synced_at             timestamptz DEFAULT now(),

  -- Semantic search vector (title + body[:500] ONLY)
  embedding             vector(768),
  embed_text_hash       text,                      -- hash of embed input; skip reembed if unchanged

  UNIQUE(repo_id, number)
);

-- Vector search index (HNSW for fast approximate nearest neighbor)
CREATE INDEX idx_osi_embedding ON open_source_issues
  USING hnsw (embedding vector_cosine_ops);

-- Structured filter indexes
CREATE INDEX idx_osi_difficulty ON open_source_issues (difficulty);
CREATE INDEX idx_osi_issue_type ON open_source_issues (issue_type);
CREATE INDEX idx_osi_is_assigned ON open_source_issues (is_assigned);
CREATE INDEX idx_osi_help_wanted ON open_source_issues (has_help_wanted);
CREATE INDEX idx_osi_labels ON open_source_issues USING GIN (labels);
CREATE INDEX idx_osi_updated_at ON open_source_issues (updated_at DESC);
CREATE INDEX idx_osi_reactions ON open_source_issues (reactions_plus_one DESC);
CREATE INDEX idx_osi_available ON open_source_issues (is_assigned, has_open_pr, is_claimed_by_label);
CREATE INDEX idx_osi_skip ON open_source_issues (is_stale, is_needs_triage, is_blocked, is_duplicate);
```

### RPC Function: `match_open_issues`

```sql
CREATE FUNCTION match_open_issues(
  query_embedding       vector(768),
  filter_language       text        DEFAULT NULL,
  filter_difficulty     text        DEFAULT NULL,
  filter_type           text        DEFAULT NULL,
  filter_repo_name      text        DEFAULT NULL,   -- NEW: filter to specific repo
  filter_unassigned     boolean     DEFAULT NULL,
  filter_help_wanted    boolean     DEFAULT NULL,
  filter_well_described boolean     DEFAULT NULL,
  filter_max_age_days   int         DEFAULT 90,
  match_count           int         DEFAULT 50,     -- fetch 50 for TypeScript reranking
  min_similarity        float       DEFAULT 0.2     -- lower threshold, reranker handles quality
)
RETURNS TABLE (
  number int, title text, url text, labels text[],
  difficulty text, issue_type text, has_help_wanted boolean,
  is_assigned boolean, has_open_pr boolean,
  is_claimed_by_label boolean, comment_count int,
  body_length int, reactions_plus_one int, reactions_eyes int,
  author_is_maintainer boolean, has_sub_issues boolean,
  milestone_due_soon boolean,
  repo_name text, repo_owner text, repo_language text,
  repo_stars text, repo_avatar text,
  similarity float
)
AS $$
  SELECT
    osi.number, osi.title, osi.url, osi.labels,
    osi.difficulty, osi.issue_type, osi.has_help_wanted,
    osi.is_assigned, osi.has_open_pr,
    osi.is_claimed_by_label, osi.comment_count,
    osi.body_length, osi.reactions_plus_one, osi.reactions_eyes,
    osi.author_is_maintainer, osi.has_sub_issues,
    osi.milestone_due_soon,
    osr.name, osr.owner, osr.language,
    osr.stars, osr.avatar,
    1 - (osi.embedding <=> query_embedding) AS similarity
  FROM open_source_issues osi
  JOIN open_source_repos osr ON osi.repo_id = osr.id
  WHERE
    osi.is_locked = false
    AND osi.is_stale = false              -- skip stale issues
    AND osi.is_needs_triage = false       -- skip untriaged issues
    AND osi.is_blocked = false            -- skip blocked issues
    AND osi.is_duplicate = false          -- skip duplicates
    AND (filter_repo_name IS NULL OR osr.name ILIKE filter_repo_name)
    AND (filter_language IS NULL OR osr.language ILIKE filter_language)
    AND (filter_difficulty IS NULL OR osi.difficulty = filter_difficulty)
    AND (filter_type IS NULL OR osi.issue_type = filter_type)
    AND (filter_unassigned IS NULL OR (osi.is_assigned = false AND osi.has_open_pr = false AND osi.is_claimed_by_label = false))
    AND (filter_help_wanted IS NULL OR osi.has_help_wanted = true)
    AND (filter_well_described IS NULL OR osi.body_length > 50)
    AND osi.updated_at > NOW() - (filter_max_age_days || ' days')::interval
    AND 1 - (osi.embedding <=> query_embedding) > min_similarity
  ORDER BY osi.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
```

---

## Label Classification Maps

### Difficulty Classification

```typescript
const EASY_LABELS = [
  'good first issue', 'good-first-issue', 'beginner',
  'beginner-friendly', 'starter', 'easy', 'trivial',
  'first-timers-only', 'up-for-grabs', 'junior',
  'low-hanging-fruit', 'newbie',
];

const MEDIUM_LABELS = [
  'medium', 'intermediate', 'moderate',
];

const HARD_LABELS = [
  'hard', 'advanced', 'complex', 'expert',
  'architecture', 'core',
];
```

### Issue Type Classification

```typescript
const TYPE_MAP: Record<string, string> = {
  'documentation': 'documentation',
  'docs': 'documentation',
  'doc': 'documentation',
  'test': 'test',
  'testing': 'test',
  'tests': 'test',
  'bug': 'bug',
  'fix': 'bug',
  'defect': 'bug',
  'enhancement': 'feature',
  'feature': 'feature',
  'feature request': 'feature',
  'feature-request': 'feature',
  'refactor': 'refactor',
  'refactoring': 'refactor',
  'cleanup': 'refactor',
  'performance': 'refactor',
};
```

### Help Wanted Detection

```typescript
const HELP_WANTED_LABELS = [
  'help wanted', 'help-wanted', 'contributions welcome',
  'contributions-welcome', 'hacktoberfest',
];
```

### Claiming Labels (issue NOT available — skip or flag)

```typescript
const CLAIMED_LABELS = [
  'wip', 'work in progress', 'in progress', 'in-progress',
  'claimed', 'taken', 'assigned', 'being worked on',
  'pr open', 'pr-open', 'working',
];
```

### Skip Labels (issue not worth contributing to)

```typescript
const STALE_LABELS = [
  'stale', 'inactive', 'abandoned',
];

const TRIAGE_LABELS = [
  'needs-triage', 'needs triage', 'triage', 'needs-investigation',
  'needs investigation', 'investigating', 'under review',
];

const BLOCKED_LABELS = [
  'blocked', 'blocking', 'on hold', 'on-hold', 'waiting',
  'waiting for upstream', 'waiting-for-upstream',
];

const SKIP_LABELS = [
  'duplicate', 'wontfix', 'wont-fix', 'wont fix',
  'invalid', 'spam', 'question', 'discussion',
];
```

### Priority Labels (boost in ranking)

```typescript
const HIGH_PRIORITY_LABELS = [
  'priority/critical', 'priority/high', 'p0', 'p1',
  'critical', 'urgent', 'high-priority', 'high priority',
];
```

---

## GitHub Data Extraction (Per Issue)

### Fields from GitHub REST API

```
GET /repos/{owner}/{repo}/issues?state=open&per_page=100&sort=updated

Per issue response:
  number              → issue number
  title               → main content for embedding
  body                → description for embedding (truncate to 500 chars)
  html_url            → direct link
  labels[].name       → difficulty / type / help_wanted / claimed / skip classification
  assignees[]         → is_assigned = assignees.length > 0
  comments            → comment count
  reactions["+1"]     → 👍 popularity signal
  reactions["eyes"]   → 👀 maintainer watching = confirmed on their radar
  reactions["rocket"] → 🚀 excitement/momentum signal
  reactions.total_count → total reactions
  pull_request        → IF PRESENT → SKIP (it's a PR, not an issue)
  locked              → skip locked issues
  milestone           → has_milestone = milestone !== null
  milestone.due_on    → milestone_due_soon = due within 30 days
  created_at          → age
  updated_at          → freshness
  author_association  → OWNER/MEMBER/COLLABORATOR/CONTRIBUTOR/NONE
  state_reason        → skip "not_planned" and "duplicate"
  sub_issues_summary  → has_sub_issues = sub_issues_summary.total > 0
```

### Extra API Call: Timeline (for has_open_pr + is_duplicate)

```
GET /repos/{owner}/{repo}/issues/{number}/timeline
  (only for issues where is_assigned = false)

Look for event type = "cross-referenced":
  source.type = "pull_request"
  source.issue.state = "open"   → has_open_pr = true

Look for event type = "marked_as_duplicate":
  → is_duplicate = true → delete from DB or skip

Cost: 1 extra API call per unassigned issue
      ~600 issues × 1 call = 600 calls (within 5000/hr limit)
```

### Fields We DON'T Store (intentionally)
```
  body (full text)      → only used for embedding, then discarded
  comments content      → not useful for finding issues
  code diffs            → irrelevant (issues, not PRs)
  full user profiles    → not needed
```

---

## Tool Definition

```typescript
const search_open_source_issues = tool({
  description: `Search for open source issues to contribute to. 
    Searches across curated open source repositories using semantic 
    search combined with structured filters. Returns issues ranked 
    by relevance to the user's topic with full context.`,
  inputSchema: z.object({
    topic: z.string()
      .describe("The semantic topic — what the issue is about (e.g. 'authentication', 'memory leak', 'websocket'). Use 'open source contribution' if user has no specific topic."),
    language: z.string().optional()
      .describe("Programming language filter: 'Python', 'TypeScript', etc."),
    difficulty: z.enum(["easy", "medium", "hard", "any"]).optional().default("any")
      .describe("Difficulty level. 'easy' = good first issue/beginner. 'any' = no filter."),
    issue_type: z.enum(["bug", "documentation", "test", "feature", "any"]).optional().default("any")
      .describe("Type of issue. 'documentation' = docs only. 'bug' = bug fixes. 'any' = no filter."),
    repo_name: z.string().optional()
      .describe("Filter to a specific repo, e.g. 'supabase', 'mem0', 'cal.com'. Use when user asks about a specific project."),
    unassigned_only: z.boolean().optional().default(true)
      .describe("Only show fully available issues (not assigned, no open PR, not claimed)"),
    help_wanted_only: z.boolean().optional().default(false)
      .describe("Only show issues with 'help wanted' label — maintainer is actively seeking contributor"),
    well_described_only: z.boolean().optional().default(true)
      .describe("Only show issues with body length > 50 chars (well described = easier to understand)"),
    max_age_days: z.number().optional().default(90)
      .describe("Only issues updated within N days"),
    offset: z.number().optional().default(0)
      .describe("Pagination offset — use 10 for 'show more', 20 for third page etc."),
    limit: z.number().optional().default(10)
      .describe("Number of results to return"),
  }),
  execute: async ({ topic, language, difficulty, issue_type, repo_name,
                    unassigned_only, help_wanted_only, 
                    well_described_only, max_age_days, offset = 0, limit = 10 }) => {
    // 1. Embed ONLY the semantic topic
    const queryVector = await embed(topic);

    // 2. Stage 1: Fetch top 50 candidates from pgvector (broad net)
    const { data: candidates, error } = await supabase.rpc('match_open_issues', {
      query_embedding: queryVector,
      filter_language: language || null,
      filter_difficulty: difficulty === "any" ? null : difficulty,
      filter_type: issue_type === "any" ? null : issue_type,
      filter_repo_name: repo_name || null,
      filter_unassigned: unassigned_only || null,
      filter_help_wanted: help_wanted_only || null,
      filter_well_described: well_described_only || null,
      filter_max_age_days: max_age_days,
      match_count: 50,  // fetch more for reranking
    });

    if (error) return { error: error.message };
    if (!candidates?.length) return { issues: [], total: 0, message: "No matching issues found." };

    // 3. Stage 2: Re-rank with composite score in TypeScript
    const reranked = candidates
      .map((issue: IssueRow) => ({
        ...issue,
        score: issue.similarity * 1.0
          + Math.min(issue.reactions_plus_one / 100, 1) * 0.15
          + (issue.reactions_eyes > 0 ? 0.15 : 0)
          + (issue.has_help_wanted ? 0.20 : 0)
          + (issue.author_is_maintainer ? 0.10 : 0)
          + (issue.body_length > 100 ? 0.10 : 0)
          + (issue.milestone_due_soon ? 0.15 : 0)
          + (issue.comment_count >= 1 && issue.comment_count <= 5 ? 0.05 : 0)
          - (issue.is_assigned ? 0.50 : 0)
          - (issue.has_open_pr ? 0.40 : 0)
          - (issue.is_claimed_by_label ? 0.30 : 0)
          - (issue.has_sub_issues ? 0.10 : 0)
          - (issue.comment_count > 20 ? 0.10 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);  // pagination

    // 4. Include freshness info
    const { data: syncStats } = await supabase
      .from("open_source_issues")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    return {
      issues: reranked,
      total: candidates.length,
      showing: `${offset + 1}–${offset + reranked.length} of ${candidates.length}`,
      last_synced_at: syncStats?.synced_at,
    };
  }
});
```

### Example LLM Parses

```
"find easy auth bugs in Python"
→ { topic: "authentication bugs", language: "Python", difficulty: "easy", issue_type: "bug" }

"documentation issues I can help with"
→ { topic: "documentation improvements", issue_type: "documentation", help_wanted_only: true }

"only supabase issues"
→ { topic: "open source contribution", repo_name: "supabase" }

"what issues does mem0 have?"
→ { topic: "open source contribution", repo_name: "mem0" }

"unassigned TypeScript websocket issues"
→ { topic: "websocket", language: "TypeScript", unassigned_only: true }

"show me more" (after first results)
→ { ...same params..., offset: 10 }

"any beginner-friendly issues"
→ { topic: "beginner contribution", difficulty: "easy" }

"popular issues that need help"
→ { topic: "highly requested features", help_wanted_only: true }
```

---

## Sync Pipeline (Inngest)

### File: `src/inngest/functions/open-issues-sync.ts`

```
Cron: every 6 hours
Trigger: "issues/sync.scheduled"

Step 1: Read repos from open_source_repos table (7 repos)

Step 2: For each repo — run as PARALLEL Inngest steps:
  // step.run(`sync-repo-${repo.owner}-${repo.name}`, async () => { ... })
  // All 7 repos sync in parallel → first sync 10min → 3min
  a. Get last_synced_at from most recent issue's synced_at
  b. GitHub API: GET /repos/{owner}/{name}/issues
       ?state=open
       &per_page=100
       &sort=updated
       &direction=desc
       &since={last_synced_at}       ← incremental sync
     Paginate through ALL pages

  c. For each issue in response:
     - SKIP if pull_request field present (it's a PR)
     - SKIP if state_reason in ["not_planned", "duplicate"]
     - SKIP if locked = true
     - Extract all metadata fields including reactions (all types)
     - Classify:
         difficulty          ← easy/medium/hard label map
         issue_type          ← bug/docs/test/feature label map
         has_help_wanted     ← "help wanted" / "contributions welcome"
         is_claimed_by_label ← "wip" / "claimed" / "in-progress" labels
         is_stale            ← "stale" label
         is_needs_triage     ← "needs-triage" / "triage" labels
         is_blocked          ← "blocked" label
         has_sub_issues      ← sub_issues_summary.total > 0
         milestone_due_soon  ← milestone.due_on within 30 days

  d. Timeline check (only for is_assigned = false issues):
     GET /repos/{owner}/{name}/issues/{number}/timeline
     - Look for "cross-referenced" event with open PR → has_open_pr = true
     - Look for "marked_as_duplicate" event → is_duplicate = true → SKIP
     - 200ms delay between timeline calls (secondary rate limit)

  e. Build embed text: title + "\n" + truncateAtWord(body, 500)
     Compute hash: sha256(embedText)
     IF hash === stored embed_text_hash → SKIP re-embedding (reuse existing vector)
     Saves ~70% of embedding calls on incremental syncs

  f. Batch embed only CHANGED issues (20 at a time) via embedBatch()
     - Rate limit: 40 RPM for Gemini embeddings
     - Retry with exponential backoff
     - On failure: store issue WITHOUT embedding (embedding = NULL)

  g. Upsert into open_source_issues (ON CONFLICT repo_id, number DO UPDATE)

Step 3: Cleanup
  - DELETE issues from DB where no longer open on GitHub
  - DELETE issues where is_duplicate = true
```

### Sync Efficiency

```
First sync:
  ~70  GitHub list-issues calls  (7 repos × ~10 pages)
  ~600 GitHub timeline calls     (1 per unassigned issue, with 200ms delay)
  ~35  embedBatch calls          (20 issues per batch)
  Total time: ~8-10 minutes      (within Inngest 10min step timeout)

After that (incremental):
  ~10  list-issues calls         (only updated since last sync)
  ~50  timeline calls            (only new unassigned issues)
  ~5   embedBatch calls
  Total time: ~2 minutes
```

### GitHub API Rate Limits

```
With GITHUB_SYNC_TOKEN:  5,000 requests/hour
First sync uses:         ~670 calls = well within 5000/hr
Incremental uses:        ~60 calls = trivial

Secondary rate limit:    200ms delay between timeline calls
                         = 600 × 200ms = 120 seconds of intentional delay
```

---

## Ranking Formula

After vector similarity filtering, issues are ranked by this composite score:

```
score = semantic_similarity       * 1.0    // how relevant to query

  // BOOST signals
  + (reactions_plus_one / 100)    * 0.15   // 👍 community wants this fixed
  + (reactions_eyes > 0 ? 0.15 : 0)        // 👀 maintainer watching = on their radar
  + (reactions_rocket / 50)       * 0.10   // 🚀 excitement
  + (has_help_wanted ? 0.20 : 0)           // maintainer actively seeking help
  + (author_is_maintainer ? 0.10 : 0)      // filed by maintainer = legit + scoped
  + (body_length > 100 ? 0.10 : 0)         // well-described = easier to understand
  + (milestone_due_soon ? 0.15 : 0)        // maintainer NEEDS this for next release
  + (comment_count BETWEEN 1 AND 5 ? 0.05 : 0) // some discussion but not too busy

  // PENALTY signals
  - (is_assigned ? 0.50 : 0)               // officially assigned to someone
  - (has_open_pr ? 0.40 : 0)              // someone already opened a PR
  - (is_claimed_by_label ? 0.30 : 0)      // "wip"/"claimed" label
  - (has_sub_issues ? 0.10 : 0)           // complex parent issue
  - (comment_count > 20 ? 0.10 : 0)       // too contested/complex
```

Implement as SQL expression in ORDER BY, or as post-processing in execute function.

---

## Storage Estimates

```
Per issue row:
  metadata fields:   ~400 bytes
  embedding (768d):  3,072 bytes (768 floats × 4 bytes)
  HNSW index:        ~3,072 bytes overhead
  Total per row:     ~6.5 KB

7 repos × ~200 open issues = 1,400 rows
1,400 × 6.5 KB = ~9 MB

With 100 repos: ~130 MB
Supabase free tier: 500 MB → plenty of room
```

---

## Files to Build

```
1. supabase/migrations/20260506_open_source_issues.sql
   → Table + match_open_issues RPC + indexes + RLS

2. src/inngest/functions/open-issues-sync.ts
   → Cron sync: GitHub API → classify → embed → upsert
   → Register in src/inngest/functions/index.ts

3. src/lib/jarvis/native-tools/github.ts
   → Replace github_search_contributor_issues tool
   → New: search_open_source_issues (pgvector-based)

4. src/lib/jarvis/tool-router.ts
   → Already has needsContribution detection ✅

5. src/app/api/chat/route.ts
   → System prompt already updated ✅
```

---

## Existing Infrastructure (Reusable)

```
✅ embed() / embedBatch()     → src/lib/memory/embeddings.ts
✅ pgvector extension          → supabase migrations (already installed)
✅ match_code_chunks pattern   → SQL template to copy
✅ Inngest background jobs     → src/inngest/functions/
✅ open_source_repos table     → 7 curated repos with metadata
✅ Intent router               → needsContribution detection
✅ System prompt               → contribution formatting rules
✅ GitHub connection            → user tokens via connected_apps
```

---

## Display Format (Chat UI)

```
🐍 #891 — Memory leak in agent loop
Repo: mem0ai/mem0 ⭐ 48.3k  [Python]
Difficulty: Easy  |  Type: Bug  |  Help Wanted ✅
Labels: memory-leak, good first issue
👍 42  |  💬 2 comments  |  Unassigned ✅
[View Issue →](https://github.com/mem0ai/mem0/issues/891)

🔐 #4521 — JWT token not refreshing on 401
Repo: supabase/supabase ⭐ 98.3k  [TypeScript]
Difficulty: Easy  |  Type: Bug
Labels: auth, good first issue
👍 18  |  💬 0 comments  |  Unassigned ✅
[View Issue →](https://github.com/supabase/supabase/issues/4521)

📝 #234 — Add API reference for tool calling
Repo: crewAIInc/crewAI ⭐ 44.8k  [Python]
Difficulty: Easy  |  Type: Documentation  |  Help Wanted ✅
Labels: docs, help wanted
👍 8  |  💬 1 comment  |  Unassigned ✅
[View Issue →](https://github.com/crewAIInc/crewAI/issues/234)
```

---

## Edge Cases, Gaps & Mitigations

### 1. GitHub Token for Background Sync (CRITICAL)

The sync runs as an Inngest cron — **no user session exists**. Need a dedicated token.

```
Option A (recommended): GITHUB_SYNC_TOKEN env var
  - A Personal Access Token (classic, read:public_repo)
  - Or a GitHub App installation token
  - 5,000 requests/hour

Option B: Unauthenticated requests
  - 60 requests/hour
  - 7 repos × ~10 pages = 70 calls → EXCEEDS limit on first sync
  - Only viable after initial seed for incremental syncs

→ Decision: Use GITHUB_SYNC_TOKEN env var. Add to .env.example.
```

### 2. Reactions May NOT Be in List Issues Response

The GitHub REST API example response for `GET /repos/{owner}/{repo}/issues` does **not** always include `reactions`. It depends on API version.

```
Mitigation options:
  A. Use Accept: application/vnd.github+json header (modern API, includes reactions)
  B. If reactions missing: use GraphQL API instead (fetches reactions in one call)
  C. Skip reactions on initial version, add later if available

→ Decision: Try REST first with modern Accept header. 
  If reactions is undefined, set reactions_plus_one = 0.
  Log warning. Can upgrade to GraphQL later.
```

### 3. No-Results Fallback

If pgvector returns 0 results (too strict filters), the tool should auto-relax.

```typescript
// Fallback strategy:
let results = await searchWithFilters(topic, language, difficulty, ...);

if (results.length === 0) {
  // Round 2: drop difficulty + issue_type filter
  results = await searchWithFilters(topic, language, null, null, ...);
}

if (results.length === 0) {
  // Round 3: drop language filter too (broadest search)
  results = await searchWithFilters(topic, null, null, null, ...);
}

if (results.length === 0) {
  return { 
    issues: [], 
    message: "No matching issues found. Try a broader topic.",
    synced_at: lastSyncTime 
  };
}
```

### 4. Repo Diversity in Results

All 10 results could come from supabase/supabase (largest repo). Need diversity.

```sql
-- Option: Use DISTINCT ON or a window function to limit per-repo results
-- In the match_open_issues RPC, add max_per_repo parameter:

WITH ranked AS (
  SELECT *, 
    ROW_NUMBER() OVER (PARTITION BY osi.repo_id ORDER BY embedding <=> query_embedding) as repo_rank
  FROM open_source_issues osi
  JOIN open_source_repos osr ON osi.repo_id = osr.id
  WHERE ... (filters)
)
SELECT * FROM ranked
WHERE repo_rank <= 3           -- max 3 per repo
ORDER BY embedding <=> query_embedding
LIMIT match_count;
```

### 5. Sub-Label Patterns (area/auth, type/bug, priority/P1)

Many repos use prefixed labels: `area/auth`, `type:bug`, `priority/high`, `scope:frontend`.

```typescript
// Classification must handle prefixed labels
function classifyLabel(label: string): void {
  const normalized = label.toLowerCase()
    .replace(/^(area|scope|type|category|kind)[:/]/, '')  // strip prefixes
    .replace(/-/g, ' ')                                    // normalize dashes
    .trim();
  
  // Then match against existing maps
  if (EASY_LABELS.includes(normalized)) difficulty = 'easy';
  if (TYPE_MAP[normalized]) issueType = TYPE_MAP[normalized];
  // etc.
}
```

### 6. Stale Data Indicator

Users should know how fresh the data is.

```typescript
// Tool response should include:
return {
  issues: data,
  total: data?.length ?? 0,
  last_synced_at: latestSyncedAt,          // "2025-05-06T12:00:00Z"
  freshness: "Issues synced 3 hours ago",  // human-readable
};
```

### 7. NULL Embedding Handling

If embedding fails for an issue (API error, empty body, etc.):

```
- Store the issue WITHOUT embedding (embedding = NULL)
- Excluded from vector search automatically (can't compute distance)
- Re-attempt embedding on next sync cycle
- Log: "[Sync] Failed to embed issue #{number} in {repo}: {error}"
```

### 8. Body Truncation at Word Boundary

500 chars might cut mid-word or mid-sentence.

```typescript
function truncateBody(body: string, maxLen = 500): string {
  if (!body || body.length <= maxLen) return body || '';
  // Find last space before maxLen
  const truncated = body.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}
```

### 9. Concurrent Sync Prevention

Two sync jobs could overlap if one takes > 6 hours.

```typescript
// Inngest has built-in concurrency control:
inngest.createFunction(
  { 
    id: "open-issues-sync",
    concurrency: { limit: 1 },  // only 1 instance at a time
    ...
  }
);
```

### 10. Initial Seed Trigger

How to populate the DB for the first time?

```
Option A: First sync runs on deploy (Inngest cron fires immediately)
Option B: Manual trigger via API endpoint
Option C: Auto-trigger on first user contribution query if DB is empty

→ Decision: Use all three:
  - Cron fires on deploy (Inngest default)
  - Add POST /api/admin/sync-issues endpoint for manual trigger
  - Tool checks if issues count = 0, triggers sync if empty
```

### 11. GitHub API Pagination

GitHub uses Link header pagination. Must handle properly.

```typescript
// Use Octokit's built-in pagination:
const allIssues = await octokit.paginate(
  'GET /repos/{owner}/{repo}/issues',
  {
    owner, repo,
    state: 'open',
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
    since: lastSyncedAt || undefined,
  }
);
// octokit.paginate auto-follows Link headers
```

### 12. RLS Policies (Missing from schema)

```sql
-- Row Level Security
ALTER TABLE open_source_issues ENABLE ROW LEVEL SECURITY;

-- Anyone can read (public issue data)
CREATE POLICY "Anyone can read open source issues"
  ON open_source_issues FOR SELECT USING (true);

-- Only service_role can write (sync job)
CREATE POLICY "Service role can manage issues"
  ON open_source_issues FOR ALL
  USING (auth.role() = 'service_role');

-- Grant RPC access
GRANT EXECUTE ON FUNCTION match_open_issues TO authenticated;
GRANT EXECUTE ON FUNCTION match_open_issues TO service_role;
```

### 13. Embedding Model Migration

If we change from `gemini-embedding-001` to a different model later, all vectors become incompatible.

```
Mitigation:
  - Store embedding_model column (text) on each row
  - On model change: flag all rows as needs_reembedding
  - Next sync cycle re-embeds flagged rows
  - Or: add migration script that bulk re-embeds all rows
```

### 14. `since` Param Edge Case

If sync is down for 48h, issues opened AND closed during the gap are never captured.

```
Mitigation:
  - Every 7 days (weekly cron), do a FULL sync (no since param)
  - Daily syncs use incremental (since param)
  - Track last_full_sync_at per repo
```

### 15. Multi-Language Repos

cal.com is TypeScript but might have Python SDK issues. Language filter only uses repo-level language.

```
Mitigation:
  - Accept this limitation for v1
  - Future: detect language from issue labels (e.g., "lang:python", "SDK: Python")
  - Future: use file paths mentioned in issue body to infer language
```

### 16. Secondary Rate Limits (GitHub)

GitHub has secondary rate limits: too many requests in a short burst even if under 5000/hr.

```typescript
// Add small delay between requests during sync:
async function fetchWithDelay<T>(fn: () => Promise<T>, delayMs = 200): Promise<T> {
  const result = await fn();
  await new Promise(r => setTimeout(r, delayMs));
  return result;
}
```

---

## Advanced Improvements

### 17. Personalization — User's GitHub Languages (Big Win)

If the user has GitHub connected, we know their repos and languages. Use this to auto-boost matching language issues without them having to ask.

```typescript
// In the tool execute, before calling RPC:
const { data: userGithub } = await supabase
  .from("connected_apps")
  .select("metadata")
  .eq("user_id", userId)
  .eq("slug", "github")
  .single();

const userLanguages = userGithub?.metadata?.top_languages ?? [];
// e.g. ["TypeScript", "Python"]

// If user hasn't specified a language AND we know theirs:
if (!language && userLanguages.length > 0) {
  // Pass as hint — LLM or tool can prefer user's languages
  // OR: run parallel queries for each user language and merge
}
```

### 18. Fresh Issue Bonus (Opened Within 7 Days)

Hot new issues = maintainer just filed it = actively on their mind = PR will be welcomed fast.

```sql
-- Add to composite score in TypeScript reranker:
+ (daysAgo(issue.created_at) <= 7 ? 0.15 : 0)   // brand new issue = hot
+ (daysAgo(issue.created_at) <= 30 ? 0.05 : 0)  // recent = still active
```

Also add `is_fresh` boolean to DB:
```sql
is_fresh  boolean GENERATED ALWAYS AS (created_at > NOW() - INTERVAL '7 days') STORED
```

### 19. Repo Health Signals (Missing from `open_source_repos`)

Currently `open_source_repos` has no freshness signals. PRs for dead repos are wasted effort.

```sql
-- Add these columns to open_source_repos:
ALTER TABLE open_source_repos ADD COLUMN last_commit_at    timestamptz;
ALTER TABLE open_source_repos ADD COLUMN has_contributing  boolean DEFAULT false;
ALTER TABLE open_source_repos ADD COLUMN contributing_url  text;
ALTER TABLE open_source_repos ADD COLUMN avg_pr_close_days int;   -- how fast PRs get reviewed
```

Update during sync:
```
GET /repos/{owner}/{name}/commits?per_page=1  → last_commit_at
GET /repos/{owner}/{name}/contents/CONTRIBUTING.md → has_contributing, contributing_url
```

Display to user:
```
⚠️  Last commit: 8 months ago — PRs may take a while
📖  CONTRIBUTING.md available → [Read before starting]
```

Filter dead repos:
```sql
AND osr.last_commit_at > NOW() - INTERVAL '6 months'  -- skip dead repos
```

### 21. Community Health Profile — GitHub Has a Built-In API! (BIG FIND)

```
GET /repos/{owner}/{repo}/community/profile

Response:
{
  "health_percentage": 87,               ← overall contributor-readiness score
  "files": {
    "contributing":          { "html_url": "..." },  ← CONTRIBUTING.md link
    "issue_template":        { "html_url": "..." },  ← has issue template?
    "pull_request_template": { "html_url": "..." },  ← has PR template?
    "license":               { "name": "MIT License", "spdx_id": "MIT" },
    "code_of_conduct":       { "html_url": "..." },  ← welcoming community?
    "readme":                { "html_url": "..." }
  }
}
```

**One API call per repo (7 total).** Gives us everything about whether a repo is contributor-friendly.

Store on `open_source_repos`:
```sql
ALTER TABLE open_source_repos ADD COLUMN health_percentage     int;
ALTER TABLE open_source_repos ADD COLUMN license_name          text;     -- "MIT License"
ALTER TABLE open_source_repos ADD COLUMN license_spdx          text;     -- "MIT"
ALTER TABLE open_source_repos ADD COLUMN contributing_url      text;     -- link to CONTRIBUTING.md
ALTER TABLE open_source_repos ADD COLUMN has_issue_template    boolean DEFAULT false;
ALTER TABLE open_source_repos ADD COLUMN has_pr_template       boolean DEFAULT false;
ALTER TABLE open_source_repos ADD COLUMN has_code_of_conduct   boolean DEFAULT false;
```

Show to user:
```
📊  Community Health: 87/100
📄  License: MIT (permissive ✅)
📖  CONTRIBUTING.md → [Read before starting]
✅  Has issue templates · ✅ Has PR templates · ✅ Code of Conduct
```

### 22. License Detection — Corporate Users Can't Use Copyleft

```
Permissive (safe for everyone):     MIT, Apache-2.0, BSD-2, BSD-3, ISC, Unlicense
Copyleft (corporate users beware):  GPL-2.0, GPL-3.0, AGPL-3.0, LGPL, MPL-2.0
No license (legally risky):         null
```

Add `filter_license` to tool:
```typescript
license_type: z.enum(["permissive", "copyleft", "any"]).optional().default("any")
  .describe("License filter. 'permissive' = MIT/Apache/BSD safe for corporate. 'copyleft' = GPL. 'any' = no filter.")
```

### 23. Multi-Language Breakdown — Repos Have Multiple Languages

```
GET /repos/{owner}/{repo}/languages
→ { "TypeScript": 245999, "Python": 12300, "Shell": 500 }
```

Store as JSONB on `open_source_repos`:
```sql
ALTER TABLE open_source_repos ADD COLUMN languages jsonb DEFAULT '{}';
-- e.g. {"TypeScript": 245999, "Python": 12300}
```

**Why it matters:** cal.com is labeled "TypeScript" but has Python SDK issues.
With multi-language data, `filter_language = 'Python'` can also match repos where Python is 10%+ of the codebase.

Updated SQL filter:
```sql
AND (filter_language IS NULL
  OR osr.language ILIKE filter_language
  OR osr.languages ? filter_language)  -- JSONB key exists check
```

### 24. Body Quality Signals — Simple Regex During Sync

From the issue body (already fetched for embedding), detect:

```typescript
// CHEAP to compute — simple regex on the body text
const bodyQuality = {
  has_code_block:        /```[\s\S]*?```/.test(body),       // has code sample
  has_reproduction_steps: /steps?\s+to\s+reproduce|1\.\s+\w/i.test(body), // structured steps
  has_screenshots:       /!\[|<img\s/.test(body),            // has images (UI bug)
  has_error_log:         /Error:|Traceback|at\s+\w+\.\w+\(/.test(body), // stack trace
  has_expected_behavior: /expected\s+(behavior|result|output)/i.test(body), // clear acceptance
};
```

Store as individual booleans:
```sql
has_code_block           boolean DEFAULT false,
has_reproduction_steps   boolean DEFAULT false,
has_screenshots          boolean DEFAULT false,
has_error_log            boolean DEFAULT false,
```

**Why it matters:**
- `has_code_block + has_reproduction_steps` = very clear issue, easy to start
- `has_screenshots` = UI/frontend bug (matches designers/frontend devs)
- `has_error_log` = crash bug with stack trace (often straightforward to fix)

Add to composite ranking:
```typescript
+ (issue.has_reproduction_steps ? 0.10 : 0)  // well-structured = easier
+ (issue.has_code_block ? 0.05 : 0)          // has code context
```

### 25. Repo Activity Score — Is This Repo Alive?

```
GET /repos/{owner}/{repo}/stats/commit_activity
→ [{ "total": 23, "week": 1699142400 }, ...]   // last 52 weeks of data
```

Calculate:
```typescript
const last4Weeks = data.slice(-4);
const avgCommitsPerWeek = last4Weeks.reduce((s, w) => s + w.total, 0) / 4;

// Classify:
// > 10 commits/week  = "Very Active"
// 3-10               = "Active"
// 1-3                = "Moderate"
// < 1                = "Low Activity" ⚠️
```

Store on `open_source_repos`:
```sql
ALTER TABLE open_source_repos ADD COLUMN commits_per_week  float;
ALTER TABLE open_source_repos ADD COLUMN activity_level    text;  -- "Very Active"/"Active"/etc.
```

Show to user + filter dead repos:
```
🟢 Very Active (23 commits/week)
🟡 Active (5 commits/week)
🔴 Low Activity (0.5 commits/week) ⚠️ PRs may take long to review
```

### 26. Sort Options — Users Ask for Different Orderings

```typescript
// Add to tool inputSchema:
sort_by: z.enum(["relevance", "reactions", "newest", "oldest", "most_commented"]).optional().default("relevance")
  .describe("How to sort results. 'relevance' = composite score (default). 'reactions' = most 👍. 'newest' = recently opened.")
```

In the re-ranking stage:
```typescript
switch (sort_by) {
  case "reactions":
    reranked.sort((a, b) => b.reactions_plus_one - a.reactions_plus_one);
    break;
  case "newest":
    reranked.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    break;
  case "oldest":
    reranked.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    break;
  case "most_commented":
    reranked.sort((a, b) => b.comment_count - a.comment_count);
    break;
  default: // "relevance" — composite score already applied
    break;
}
```

Example queries:
```
"show me the most popular issues"        → sort_by: "reactions"
"what are the newest open issues?"       → sort_by: "newest"
"show me the most discussed issues"      → sort_by: "most_commented"
```

---

## Hardening from 300-Query Analysis

After mentally simulating 300 hard/tricky queries (see `docs/open-source-finder-300-queries.md`), 11 gaps surfaced. Each is a real user pattern.

### Gap 1: `estimated_minutes` — effort vs difficulty

`difficulty` = skill required. `estimated_minutes` = time required. A docs typo is `easy + 15min`. An auth refactor is `medium + 1day`.

```sql
estimated_minutes int   -- derived during sync
```

Heuristic during sync:
```typescript
function estimateMinutes(issue): number {
  if (/\btypo\b|fix\s+(spelling|link|wording)/i.test(issue.title)) return 15;
  if (issue.issue_type === 'documentation' && issue.body_length < 500) return 30;
  if (/one[-\s]?liner|trivial|small\s+(fix|change)/i.test(issue.title + issue.body)) return 30;
  if (issue.body_length < 300 && issue.has_code_block) return 60;
  if (issue.body_length < 1000) return 180;
  if (issue.has_sub_issues) return 1440;  // 1 day+
  return 480;  // ~half day default
}
```

Tool param: `max_minutes` for "30 min fix", "weekend project" queries.

### Gap 2: Vague-topic detection — skip embedding

"find me something", "anything good?" → embedding garbage strings returns garbage results.

```typescript
const VAGUE_TOPIC_RE = /^(anything|something|any\s+issue|whatever|surprise|find\s+me|give\s+me|pick|i\s+don.?t\s+know)/i;

if (VAGUE_TOPIC_RE.test(topic) || topic.length < 4) {
  // Skip embedding → just rank by composite score with current filters
  query_embedding = null;  // RPC handles null = no similarity filter
}
```

Update RPC to allow null `query_embedding` → returns all matching filtered rows ordered by composite score.

### Gap 3: Conversation result memory

"the third one", "more like that", "skip what you showed" require memory of previous results.

```typescript
// In the tool execute, accept previous results:
previous_issue_ids: z.array(z.string()).optional()
  .describe("UUIDs from previous search results in this conversation. Used to resolve 'the third one' or exclude already-shown."),
exclude_seen: z.boolean().optional().default(false)
  .describe("Skip issues already shown in this conversation."),
```

Wire-up in chat route: after each tool call returns results, append issue UUIDs to conversation memory. Pass them back on follow-up calls.

### Gap 4: `similar_to_issue_id` parameter

"more like the second one", "issues like the ones I fixed before"

```typescript
similar_to_issue_id: z.string().optional()
  .describe("Find issues similar to this UUID. Uses its stored embedding instead of embedding 'topic'.")
```

```typescript
// In execute:
if (similar_to_issue_id) {
  const { data: source } = await supabase
    .from("open_source_issues")
    .select("embedding")
    .eq("id", similar_to_issue_id)
    .single();
  query_embedding = source.embedding;  // reuse stored vector
}
```

### Gap 5: `mentioned_files` — extract code paths from body

"show me the code area", "what files do I need to change?"

```typescript
const FILE_PATH_RE = /[\w\-\/]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|md|yml|yaml|json|sql)\b/g;

function extractMentionedFiles(body: string): string[] {
  const matches = [...body.matchAll(FILE_PATH_RE)].map(m => m[0]);
  return [...new Set(matches)].slice(0, 5);  // unique, max 5
}
```

```sql
mentioned_files text[] DEFAULT '{}'
```

Show in results: `Likely files: src/auth/jwt.ts, middleware/cors.ts`

### Gap 6: `onboard` action — beginner flow

"i'm completely new", "where do I start?"

```typescript
action: z.enum(["search", "list_repos", "repo_detail", "stats", "check_issue", "onboard"])
```

`action: "onboard"` returns:
```typescript
{
  step1_pick_repo: bestBeginnerRepo,  // highest health_percentage + has_contributing
  step2_read_guide: bestBeginnerRepo.contributing_url,
  step3_pick_issue: easyHelpWantedWellDescribed[0],
  step4_claim: `Comment on ${issueUrl}: "I'd like to work on this"`,
  step5_workspace: `daytona://create?repo=${repoUrl}`,
}
```

### Gap 7: Persona detection in system prompt

"I'm a frontend dev" → infer filters automatically.

Add to chat route system prompt:
```
PERSONA → AUTO-FILTER MAPPING (when user states their role):
- frontend dev          → languages: ["TypeScript","JavaScript"], topics: ["react","vue","svelte","tailwind","css"]
- backend dev           → languages: ["Python","Go","Rust","Java"], topics: ["api","database","auth"]
- fullstack dev         → languages: ["TypeScript","Python"], no topic filter
- devops engineer       → topics: ["docker","kubernetes","ci-cd","terraform"]
- ml/ai engineer        → languages: ["Python"], topics: ["llm","ai-agents","ml","ai-tools"]
- mobile dev            → topics: ["react-native","flutter","swift","kotlin"]
- designer / writer     → issue_type: "documentation", well_described_only: true
- qa / tester           → labels: ["test","testing","qa"]
- security researcher   → labels: ["security","vulnerability"]
```

### Gap 8: `stats` action with `group_by`

"how many python issues?", "language distribution"

```typescript
action: "stats", group_by: z.enum(["language","difficulty","issue_type","repo","labels"]).optional()
```

Implementation:
```typescript
// Direct SQL via Supabase:
const { data } = await supabase.rpc('issue_stats', { group_by });
// Returns: [{ key: "Python", count: 234 }, { key: "TypeScript", count: 189 }, ...]
```

New RPC:
```sql
CREATE FUNCTION issue_stats(group_by text)
RETURNS TABLE(key text, count bigint) AS $$
  SELECT
    CASE group_by
      WHEN 'language' THEN osr.language
      WHEN 'difficulty' THEN osi.difficulty
      WHEN 'issue_type' THEN osi.issue_type
      WHEN 'repo' THEN osr.name
    END AS key,
    COUNT(*)::bigint AS count
  FROM open_source_issues osi
  JOIN open_source_repos osr ON osi.repo_id = osr.id
  WHERE osi.is_locked = false AND osi.is_duplicate = false
  GROUP BY 1
  ORDER BY count DESC;
$$ LANGUAGE sql STABLE;
```

### Gap 9: `max_age_hours` for sub-day precision

"issues from last hour", "today's issues"

```typescript
max_age_hours: z.number().optional()
  .describe("Time window in hours. Use 1 for 'last hour', 24 for 'today', 168 for 'this week'. Overrides max_age_days."),
```

```sql
WHERE osi.updated_at > NOW() - (
  CASE WHEN filter_max_age_hours IS NOT NULL
       THEN (filter_max_age_hours || ' hours')::interval
       ELSE (filter_max_age_days || ' days')::interval
  END
)
```

### Gap 10: `exclude_repo_names` array

"anything but cal.com", "skip the supabase ones"

```typescript
exclude_repo_names: z.array(z.string()).optional()
  .describe("Repos to exclude from results: ['cal.com', 'mem0']"),
```

```sql
AND (filter_exclude_repos IS NULL OR NOT (osr.name = ANY(filter_exclude_repos)))
```

### Gap 11: `check_issue` action — live API bypass

"is #891 still open?", "did anyone claim #352?"

Synced data is ≤6h stale. For real-time queries, bypass DB and call GitHub directly:

```typescript
if (action === "check_issue" && issue_url) {
  const { owner, repo, number } = parseGithubIssueUrl(issue_url);
  const [issueRes, timelineRes] = await Promise.all([
    octokit.issues.get({ owner, repo, issue_number: number }),
    octokit.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline',
      { owner, repo, issue_number: number, per_page: 20 }),
  ]);
  
  const recentEvents = timelineRes.slice(-5);
  const linkedOpenPRs = timelineRes
    .filter(e => e.event === 'cross-referenced' && e.source?.issue?.state === 'open')
    .map(e => e.source.issue.html_url);
  
  return {
    state: issueRes.data.state,
    is_assigned: issueRes.data.assignees.length > 0,
    assignees: issueRes.data.assignees.map(a => a.login),
    comment_count: issueRes.data.comments,
    last_updated: issueRes.data.updated_at,
    linked_open_prs: linkedOpenPRs,
    recent_events: recentEvents,
    is_live: true,  // flag: this is real-time, not synced
  };
}
```

---

## Hardening from 500-Query Persona Analysis

After researching dev personas (`r/learnprogramming`, `r/cscareerquestions`, dev imposter-syndrome blogs) and simulating 500 queries across 8 personas (see `docs/open-source-finder-500-queries.md`), 9 NEW gaps emerged on top of the 11 from the 300-query pass.

### Gap 12: `expertise_required` for senior devs

**Trigger queries**: "expert level", "phd-level algorithm issues", "compiler issues", "low-level memory issues", "distributed consensus problems"

`difficulty: hard` is too coarse. Senior devs want **domain expertise** matching, not just "hard".

```sql
expertise_required text[] DEFAULT '{}'
-- e.g. ['concurrency', 'compilers', 'distributed-systems', 'cryptography', 'graphics', 'compilers']
```

Detect during sync via label patterns + body keywords:
```typescript
const EXPERTISE_KEYWORDS = {
  concurrency: /\b(concurren|race condition|deadlock|thread safe|atomic|lock|mutex)\b/i,
  compilers: /\b(parser|tokenizer|ast|codegen|compiler|interpreter|jit)\b/i,
  distributed: /\b(consensus|raft|paxos|cap theorem|eventual consistency|partition)\b/i,
  cryptography: /\b(encrypt|decrypt|hash|signature|tls|cert|hmac|bcrypt|argon)\b/i,
  performance: /\b(performance|optimization|profiling|benchmark|hotpath)\b/i,
  security: /\b(vulnerab|cve|csrf|xss|sql injection|rce|ssrf)\b/i,
};
```

### Gap 13: Maintainer Responsiveness Score

**Trigger queries** (~30 across personas): "won't be ghosted", "responsive maintainer", "guaranteed review within a week", "where prs get merged quickly", "maintainer responds fast"

Add to `open_source_repos`:
```sql
ALTER TABLE open_source_repos ADD COLUMN avg_first_response_hours int;     -- maintainer's first comment time
ALTER TABLE open_source_repos ADD COLUMN prs_merged_last_30_days int;
ALTER TABLE open_source_repos ADD COLUMN maintainer_engagement_score int;  -- 0-100 composite
```

Calculate during weekly repo refresh:
```typescript
// Fetch last 20 closed PRs
const closedPRs = await octokit.paginate('GET /repos/{owner}/{repo}/pulls', {
  owner, repo, state: 'closed', sort: 'updated', per_page: 20
});

// For each PR, fetch first comment time, calculate response delay
const responseTimes = await Promise.all(closedPRs.map(async pr => {
  const comments = await octokit.issues.listComments({ 
    owner, repo, issue_number: pr.number, per_page: 1 
  });
  if (!comments.data.length) return null;
  return (new Date(comments.data[0].created_at) - new Date(pr.created_at)) / (1000 * 60 * 60);
}));

const avgFirstResponseHours = average(responseTimes.filter(Boolean));
```

### Gap 14: `beginner_friendly_score` per Repo

**Trigger queries** (60+ from beginner persona): "non-judgmental community", "won't be ignored", "beginner success stories", "where my first pr won't be ignored", "mentor available"

Composite score 0-100 derived from already-collected data:
```sql
ALTER TABLE open_source_repos ADD COLUMN beginner_friendly_score int;
```

```typescript
function computeBeginnerScore(repo): number {
  let score = 0;
  score += repo.health_percentage * 0.30;            // GitHub's own score
  score += repo.has_code_of_conduct ? 15 : 0;
  score += repo.has_contributing ? 15 : 0;
  score += repo.has_issue_template ? 10 : 0;
  score += repo.commits_per_week > 1 ? 10 : 0;
  score += repo.avg_first_response_hours < 48 ? 15 : 0;
  score += goodFirstIssueCount > 5 ? 5 : 0;
  return Math.min(100, score);
}
```

Use as primary sort for `action: "onboard"` and beginner queries.

### Gap 15: `is_stuck_long_term` Flag

**Trigger queries** (senior persona): "lonely subsystems", "abandoned features", "issues stuck due to disagreement", "open because no one knows the answer", "long-standing bugs (1 year+)"

```sql
is_stuck_long_term boolean DEFAULT false
-- created_at < NOW() - INTERVAL '365 days'
-- AND comment_count > 5
-- AND is_assigned = false
-- AND has_open_pr = false
```

Compute as a Postgres GENERATED column or update during sync. Senior contributors specifically want these "rescue mission" issues — a feature, not a penalty.

### Gap 16: `has_design_discussion`

**Trigger queries** (senior/mid): "rfc/proposal-stage issues", "issues needing architectural decision", "design discussion issues", "issues with multiple competing solutions"

```sql
has_design_discussion boolean DEFAULT false
```

Detect during sync:
```typescript
const has_design_discussion =
  /\b(RFC|proposal|design doc|architecture)\b/i.test(issue.body) ||
  issue.comment_count > 20;
```

### Gap 17: Repo Trending / Stargazer Velocity

**Trigger queries** (career-focused): "trending projects", "venture-backed", "what's hot right now", "projects used at startups"

```sql
ALTER TABLE open_source_repos ADD COLUMN stars_gained_last_30d int DEFAULT 0;
ALTER TABLE open_source_repos ADD COLUMN is_trending boolean GENERATED ALWAYS AS
  (stars_gained_last_30d > 1000) STORED;
```

GitHub doesn't expose star history directly via REST, but we can:
- Snapshot `stargazers_count` on each weekly repo refresh
- Compare to previous snapshot → derive `stars_gained_last_30d`
- Need additional column `previous_stars_count` or separate `repo_star_history` table

Simpler approach (good enough): use the `stargazers_count` from `GET /repos/{owner}/{repo}` and compare to prev snapshot stored in `open_source_repos.last_star_snapshot`.

### Gap 18: Bounty / Sponsored Issue Detection

**Trigger queries** (career persona): "paid bounty issues", "gsoc", "outreachy", "sponsored issues"

```sql
has_bounty   boolean DEFAULT false
bounty_amount text     -- "$200", "$500", "GSoC", "Outreachy"
```

Detect via labels:
```typescript
const BOUNTY_LABELS = ['bounty', 'gsoc', 'outreachy', 'sponsored', 'paid', '$bounty'];
const has_bounty = labels.some(l => BOUNTY_LABELS.includes(l.toLowerCase()));

// Extract amount from body (regex):
const bountyMatch = issue.body?.match(/\$(\d+(?:,\d{3})*)/);
const bounty_amount = has_bounty ? (bountyMatch?.[0] ?? null) : null;
```

### Gap 19: Compound / Conditional Query Handling — System Prompt Only

**Trigger queries** (471-485): "if no easy python show easy js", "5 easy and 5 hard", "one from each repo"

No code change needed. The LLM handles this natively via **multi-tool-calls**. Add to chat route system prompt:

```
COMPOUND OPEN-SOURCE QUERY HANDLING:
When user asks compound queries about open source issues:
- "If no X, show Y"          → call search with X. If empty, call again with Y.
- "5 easy and 5 hard"        → call twice with limit:5 each, merge results.
- "one from each repo"       → call once with limit:50, group results by repo, pick top from each.
- "diverse set across repos" → call once with limit:30, then sample for diversity.
- "show 5 then ask for more" → call once, present, await user "more" → call with offset.
```

### Gap 20: Casual Language / Slang Normalization

**Trigger queries** (486-500): "gimme", "sup", "ngl", "fr fr", "phyton", "javascrpt", "rn"

Add to chat route system prompt:

```
USER LANGUAGE NORMALIZATION (open source queries):
- Slang stripping:
   "gimme/show me/find/give me/yo/sup" → search intent
   "ngl/fr fr/no cap/tbh"             → strip filler before parsing
   "rn/asap/right now"                → max_age_hours: 24
- Common typos (auto-correct before passing to tool):
   phyton→Python, javascrpt→JavaScript, juniour→junior, isuses→issues,
   typescirpt→TypeScript, reactjs→React, nextjs→Next.js
```

This is purely a prompt-level instruction. The Gemini model handles typo recognition well — we just need to ensure it normalizes to canonical names before the tool call.

---

## Final Architecture Coverage Summary

| Source | Total Queries | Gaps Found | Status |
|---|---|---|---|
| Initial design | — | (foundation) | ✅ |
| Edge cases pass | (16) | 16 mitigations | ✅ |
| Architecture doc deep review | — | 6 (filter_repo, reranking, hash, parallel, pagination, repos table) | ✅ |
| GitHub API survey | — | 7 (community/profile, license, languages, body quality, activity, sort, archived) | ✅ |
| 300-query analysis | 300 | 11 (Gaps 1-11) | ✅ |
| 500-query persona analysis | 500 | 9 (Gaps 12-20) | ✅ |
| **GRAND TOTAL** | **800** | **49 distinct improvements** | **All covered** |

---

## User Scenario Matrix — Every Question a User Might Ask

### Category A: Finding Issues (core search — COVERED ✅)

```
"find easy auth bugs in Python"              ✅ topic + language + difficulty + issue_type
"documentation issues I can help with"       ✅ issue_type: "documentation"
"unassigned TypeScript websocket issues"     ✅ topic + language + unassigned_only
"help wanted issues"                         ✅ help_wanted_only: true
"show me more"                               ✅ offset: 10
"only supabase issues"                       ✅ repo_name: "supabase"
"most popular issues"                        ✅ sort_by: "reactions"
"newest issues"                              ✅ sort_by: "newest"
"show me easy issues with no open PR"        ✅ difficulty + unassigned_only (covers has_open_pr)
```

### Category B: Discovery Questions — NEED `action` param or separate tool

```
"what repos do you cover?"                   ⚠️ MISSING: need list_repos action
"how many issues do you have?"               ⚠️ MISSING: need stats action
"what languages are available?"              ⚠️ MISSING: need stats action
"which repo is most beginner-friendly?"      ⚠️ MISSING: need repo comparison
"compare supabase vs cal.com"                ⚠️ MISSING: need repo comparison
```

### Category C: "How to Get Started" Questions — NEED enrichment

```
"how do I contribute to supabase?"           ⚠️ MISSING: need CONTRIBUTING.md link
"how do I claim this issue?"                 ⚠️ MISSING: need claiming guidance
"what's the PR process for cal.com?"         ⚠️ MISSING: need contributing guide
"what do I need before my first PR?"         ⚠️ MISSING: need onboarding flow
```

### Category D: Follow-up / Real-time Questions — NEED live GitHub calls

```
"is issue #891 still open?"                  ⚠️ MISSING: need real-time issue check
"has anyone claimed issue #352 yet?"         ⚠️ MISSING: need live status
"can you help me fix this issue?"            ⚠️ MISSING: transition to coding workflow
```

### Category E: Advanced Filters — NEED tool schema expansion

```
"I know Python and JavaScript"              ⚠️ MISSING: multi-language input
"not TypeScript"                             ⚠️ MISSING: exclude_language filter
"anything except documentation"              ⚠️ MISSING: exclude_type filter
"issues from the last 24 hours"             ✅ max_age_days: 1
"trending issues this week"                  ⚠️ MISSING: trending filter
"issues in AI/ML projects"                   ⚠️ MISSING: repo topic/tag filter
"only MIT licensed repos"                    ✅ license_type: "permissive" (already planned)
```

### Category F: Personalization — NEED user context

```
"issues matching my skills"                  ⚠️ MISSING: user's GitHub languages
"issues in repos I've starred"               ⚠️ MISSING: user's starred repos
"which repo would look good on my resume?"   ⚠️ MISSING: star count ranking
```

---

## Fixes for Missing Scenarios

### Fix 1: Add `action` param to tool (handles Category B)

```typescript
// Expand tool to handle multiple actions:
action: z.enum(["search", "list_repos", "repo_detail", "stats"]).optional().default("search")
  .describe("Action to perform. 'search' = find issues. 'list_repos' = show all indexed repos. 'repo_detail' = deep info on one repo. 'stats' = DB stats.")
```

`action: "list_repos"` returns:
```typescript
const { data: repos } = await supabase
  .from("open_source_repos")
  .select("name, owner, language, stars, health_percentage, license_spdx, activity_level, contributing_url, tags");

return {
  repos,
  total_issues: await supabase.from("open_source_issues").select("id", { count: "exact" }),
  languages: [...new Set(repos.map(r => r.language))],
};
```

User sees:
```
📚 We index 7 open source repos with 1,247 open issues:

1. supabase/supabase ⭐ 98.3k [TypeScript]
   📊 Health: 100/100 · 📄 MIT · 🟢 Very Active
   
2. browser-use/browser-use ⭐ 79.2k [Python]
   📊 Health: 87/100 · 📄 Apache-2.0 · 🟢 Very Active
   ...

Languages: TypeScript, Python, Go
```

### Fix 2: Contributing Guide & Claiming (handles Category C)

During sync, store CONTRIBUTING.md URL per repo (from community/profile endpoint — already planned).

**System prompt guidance** — add to chat route system prompt:
```
When showing open source issues, ALWAYS:
1. Include the CONTRIBUTING.md link if available
2. Tell user: "To claim this issue, comment 'I'd like to work on this' on the GitHub issue"
3. If user wants to code, offer to set up a Daytona workspace
4. Warn about copyleft licenses for corporate users
5. Show repo health and activity level
```

### Fix 3: Real-Time Issue Check (handles Category D)

When user asks about a SPECIFIC issue, make a LIVE GitHub API call:

```typescript
// In the tool execute, when action === "check_issue":
if (action === "check_issue" && issue_url) {
  const { owner, repo, number } = parseGithubIssueUrl(issue_url);
  const issue = await octokit.issues.get({ owner, repo, issue_number: number });
  return {
    state: issue.data.state,              // "open" | "closed"
    is_assigned: issue.data.assignees.length > 0,
    assignees: issue.data.assignees.map(a => a.login),
    comments: issue.data.comments,
    updated_at: issue.data.updated_at,
    // ... live data
  };
}
```

### Fix 4: Multi-Language & Exclude Filters (handles Category E)

```typescript
// Replace single language with array + exclude:
languages: z.array(z.string()).optional()
  .describe("Languages to include: ['Python', 'TypeScript']. Matches repos with ANY of these."),
exclude_languages: z.array(z.string()).optional()
  .describe("Languages to EXCLUDE: ['Java']. Remove from results."),
exclude_types: z.array(z.string()).optional()
  .describe("Issue types to exclude: ['documentation']. 'anything except docs'."),
```

SQL update:
```sql
AND (filter_languages IS NULL OR osr.language ILIKE ANY(filter_languages))
AND (exclude_languages IS NULL OR NOT (osr.language ILIKE ANY(exclude_languages)))
```

### Fix 5: Trending Issues Filter (handles "what's hot?")

```typescript
// Add to tool:
trending: z.boolean().optional().default(false)
  .describe("Show trending issues = opened within 7 days AND high reactions")
```

SQL:
```sql
AND (filter_trending IS NULL OR (
  osi.created_at > NOW() - INTERVAL '7 days'
  AND osi.reactions_plus_one > 3
))
```

### Fix 6: User Personalization (handles Category F)

```typescript
// In tool execute, before RPC call:
// Fetch user's connected GitHub profile
const { data: connectedGithub } = await supabase
  .from("connected_apps")
  .select("metadata, access_token")
  .eq("user_id", userId)
  .eq("slug", "github")
  .single();

// Option A: Auto-detect languages from user's repos
const userLanguages = connectedGithub?.metadata?.top_languages ?? [];

// Option B: Check user's starred repos against our curated list
if (connectedGithub?.access_token) {
  const userOctokit = new Octokit({ auth: connectedGithub.access_token });
  const starred = await userOctokit.paginate('GET /user/starred', { per_page: 100 });
  const matchingRepos = starred.filter(s => 
    curatedRepoNames.includes(s.full_name)
  );
  // Boost issues from repos user has starred
}
```

### Fix 7: PR Merge Time Per Repo (handles "will my PR get reviewed?")

```
GET /repos/{owner}/{repo}/pulls?state=closed&sort=updated&per_page=10

For each closed+merged PR:
  merge_time = merged_at - created_at

avg_merge_time = average(merge_times)
```

Store on `open_source_repos`:
```sql
ALTER TABLE open_source_repos ADD COLUMN avg_pr_merge_hours int;
-- e.g. 48 = PRs merge in ~2 days on average
```

Show to user:
```
⏱️  Avg PR merge time: 2 days (fast!)
⏱️  Avg PR merge time: 14 days ⚠️ (slow)
```

Cost: 1 API call per repo = 7 calls (done during weekly repo metadata refresh)

### Fix 8: Repo Topic/Tag Filter (handles "issues in AI projects")

```typescript
// Add to tool:
repo_topic: z.string().optional()
  .describe("Filter by repo topic/tag: 'ai-agents', 'react', 'database', 'llm'. Matches against repo tags.")
```

SQL:
```sql
AND (filter_topic IS NULL OR filter_topic = ANY(osr.tags))
```

Example:
```
"issues in AI projects"  → repo_topic: "ai-agents"
"React project issues"   → repo_topic: "react"
```

### Fix 9: GitHub Search API Fallback (when local DB is empty)

When our local pgvector search returns 0 results AND filters have been fully relaxed:

```typescript
// Last resort fallback — search ALL of GitHub
if (reranked.length === 0 && !repo_name) {
  const globalResults = await octokit.search.issuesAndPullRequests({
    q: `${topic} is:issue is:open label:"good first issue"`,
    per_page: limit,
    sort: "reactions",
  });
  
  return {
    issues: globalResults.data.items.map(formatIssue),
    total: globalResults.data.total_count,
    source: "github_global_search",  // flag: results from global search, not curated
    message: "No matches in curated repos. Showing results from all of GitHub.",
  };
}
```

---

## Complete LLM Parse Examples (All User Scenarios)

```
SEARCH:
"find easy auth bugs in Python"              → { action: "search", topic: "auth bugs", language: "Python", difficulty: "easy", issue_type: "bug" }
"show me trending issues"                    → { action: "search", topic: "open source", trending: true }
"I know Python and JavaScript"               → { action: "search", topic: "open source", languages: ["Python", "JavaScript"] }
"not TypeScript"                             → { action: "search", topic: "open source", exclude_languages: ["TypeScript"] }
"anything except documentation"              → { action: "search", topic: "open source", exclude_types: ["documentation"] }
"issues in AI projects"                      → { action: "search", topic: "AI", repo_topic: "ai-agents" }
"issues in repos I've starred"               → { action: "search", topic: "open source", use_starred: true }
"most popular issues"                        → { action: "search", topic: "open source", sort_by: "reactions" }
"only MIT licensed repos"                    → { action: "search", topic: "open source", license_type: "permissive" }
"show me more"                               → { ...prev_params, offset: 10 }

DISCOVERY:
"what repos do you cover?"                   → { action: "list_repos" }
"which repo is most beginner-friendly?"      → { action: "list_repos" }  // LLM sorts by health_percentage
"how many issues do you have?"               → { action: "stats" }
"compare supabase vs cal.com"                → { action: "list_repos" }  // LLM compares two

GETTING STARTED:
"how do I contribute to supabase?"           → { action: "repo_detail", repo_name: "supabase" }
"how do I claim issue #891?"                 → LLM answers: "Comment on the issue saying you want to work on it"

REAL-TIME:
"is issue #891 still open?"                  → { action: "check_issue", issue_url: "..." }
"can you help me fix this issue?"            → LLM transitions to Daytona coding workflow
```

---

### 27. Archived Repos Filter — Don't Show Dead Repos

```
GET /repos/{owner}/{repo} → { "archived": true }
```

If a repo is archived (read-only), NO contributions are possible.
Check during sync and skip entirely:
```typescript
if (repoData.archived) {
  console.log(`[Sync] Skipping ${repo.owner}/${repo.name} — archived`);
  continue;
}
```

Also store on `open_source_repos`:
```sql
ALTER TABLE open_source_repos ADD COLUMN is_archived boolean DEFAULT false;
```

---

### 20. Sync Monitoring (Know When It Breaks)

```sql
-- Add sync_stats table:
CREATE TABLE open_issues_sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at        timestamptz DEFAULT now(),
  repos_synced  int,
  issues_upserted int,
  issues_deleted  int,
  embed_skipped   int,   -- skipped due to hash match
  embed_failed    int,   -- failed to embed
  duration_ms   int,
  error         text
);
```

Log at end of each sync. Query to check health:
```sql
SELECT * FROM open_issues_sync_log ORDER BY run_at DESC LIMIT 5;
```

---

## Summary of All Required Env Vars

```
# Required for sync
GITHUB_SYNC_TOKEN=ghp_xxx                    # PAT for background sync
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# Required for embeddings
GOOGLE_GENERATIVE_AI_API_KEY=xxx             # or GEMINI_API_KEY

# Optional overrides
GEMINI_EMBEDDING_MODEL=gemini-embedding-001  # default
EMBEDDING_RATE_LIMIT_RPM=40                  # default
```

---

## Complete API Call Map (All GitHub Endpoints Used During Sync)

### Per-Repo Calls (7 repos, run once during initial sync or refreshed weekly):

```
1. GET /repos/{owner}/{repo}/community/profile     → health_percentage, license,
                                                       contributing_url, has_issue_template,
                                                       has_pr_template, code_of_conduct
   Cost: 1 call per repo = 7 calls

2. GET /repos/{owner}/{repo}/languages              → multi-language breakdown (JSONB)
   Cost: 1 call per repo = 7 calls

3. GET /repos/{owner}/{repo}/stats/commit_activity   → commits_per_week, activity_level
   Cost: 1 call per repo = 7 calls

4. GET /repos/{owner}/{repo}                        → archived, subscribers_count
   Cost: 1 call per repo = 7 calls
```

### Per-Issue Calls (every 6h sync):

```
5. GET /repos/{owner}/{repo}/issues                 → all issue data, reactions,
   ?state=open&per_page=100&sort=updated               labels, assignees, milestone,
   &since={last_synced_at}                             body, author_association
   Cost: ~70 calls first sync, ~10 incremental

6. GET /repos/{owner}/{repo}/issues/{n}/timeline    → has_open_pr, is_duplicate
   (only for unassigned issues)                        (cross-referenced events)
   Cost: ~600 calls first sync, ~50 incremental
   Rate: 200ms delay between calls
```

### Embedding Calls:

```
7. embedBatch(20 texts at a time)                   → generate vector[768]
   Model: gemini-embedding-001                         for title + body[:500]
   Rate: 40 RPM                                        Skip if embed_text_hash unchanged
   Cost: ~35 calls first sync, ~5 incremental
```

### Total First Sync Cost:

```
GitHub API:  7 + 7 + 7 + 7 + 70 + 600 = ~698 calls (within 5000/hr)
Embedding:   ~35 batch calls
Time:        ~3-5 min (parallel repo steps)
```

---

## Complete Data Per Layer

### `open_source_repos` (7 rows) — repo-level metadata:

```
FROM EXISTING TABLE:    name, owner, description, url, stars, forks, language,
                        language_color, tags, avatar, yc_backed

ADD DURING SYNC:        health_percentage, license_name, license_spdx,
                        contributing_url, has_issue_template, has_pr_template,
                        has_code_of_conduct, languages (jsonb),
                        commits_per_week, activity_level,
                        last_commit_at, is_archived
```

### `open_source_issues` (~700-1400 rows) — issue-level data:

```
IDENTITY:               github_id, repo_id, number, title, url

CLASSIFICATION:         difficulty, issue_type, has_help_wanted, labels[]

AVAILABILITY:           is_assigned, has_open_pr, is_claimed_by_label

SKIP SIGNALS:           is_stale, is_needs_triage, is_blocked, is_duplicate, is_locked

QUALITY:                body_length, reactions_plus_one, reactions_eyes, reactions_rocket,
                        author_is_maintainer, has_sub_issues,
                        has_code_block, has_reproduction_steps,
                        has_screenshots, has_error_log

STATUS:                 has_milestone, milestone_due_soon, created_at, updated_at

SEARCH:                 embedding (vector[768]), embed_text_hash
```

### `open_issues_sync_log` — monitoring:

```
STATS:                  repos_synced, issues_upserted, issues_deleted,
                        embed_skipped, embed_failed, duration_ms, error
```

---

## Updated Files to Build

```
1. supabase/migrations/20260506_open_source_issues.sql
   → open_source_issues table + ALL indexes
   → ALTER open_source_repos (add health, license, languages, activity cols)
   → match_open_issues RPC (with filter_repo_name, filter_license)
   → open_issues_sync_log table
   → RLS policies + GRANT

2. src/inngest/functions/open-issues-sync.ts
   → Cron sync (6h incremental + weekly full)
   → Parallel Inngest steps per repo
   → GitHub API → classify labels → detect body quality → embed → upsert
   → Timeline check for has_open_pr + is_duplicate
   → Community health + languages + commit_activity (weekly refresh)
   → Embed hash skip for unchanged issues
   → Concurrency: { limit: 1 }
   → Log to open_issues_sync_log

3. src/lib/jarvis/native-tools/github.ts
   → Replace github_search_contributor_issues tool
   → New: search_open_source_issues (pgvector two-stage)
   → Stage 1: RPC fetch 50 candidates
   → Stage 2: TypeScript composite score re-rank → return 10
   → No-results fallback (auto-relax filters)
   → Sort options (relevance/reactions/newest/oldest)
   → Pagination (offset)
   → Stale data indicator + repo health in response

4. src/inngest/functions/index.ts
   → Register openIssuesSync in allFunctions

5. src/app/api/admin/sync-issues/route.ts  (optional)
   → Manual trigger endpoint for initial seed / re-sync
```
