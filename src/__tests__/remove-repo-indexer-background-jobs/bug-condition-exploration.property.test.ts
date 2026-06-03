/**
 * Bug Condition Exploration Property Tests — Background-Job Repo-Indexer Invocation
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 *
 * This test encodes the EXPECTED behavior after the fix:
 *   For every background-job entry point — `github-memory-ingest-complete`,
 *   `github-memory-sync-scheduled`, and `github-webhook-push` with a matched
 *   installation — the runtime body must NOT invoke any function exported
 *   from `@/lib/repo-indexer` and must NOT trigger the `repo-index-incremental`
 *   workflow.
 *
 * Scoped PBT approach (per design.md): each property is scoped to ONE concrete
 * deterministic trigger (Bug Condition cases 1, 2, 3) and asserts:
 *   (a) zero invocations of any `@/lib/repo-indexer` export, AND
 *   (b) zero downstream `workflowClient.trigger` calls for `repo-index-incremental`
 *       (push-webhook case only), AND
 *   (c) zero `repo-indexing` / `mark-stale-repos` / `repo-index-${userId}` /
 *       `stale-reindex-${userId}` step IDs in the executed workflow body.
 *
 * On UNFIXED code these properties are EXPECTED TO FAIL — failure confirms each
 * background-job entry point currently reaches into `@/lib/repo-indexer`. The
 * counterexamples are recorded in the bugfix spec as evidence of the bug.
 *
 * **DO NOT attempt to fix the test or the code when it fails.**
 *
 * Mocking strategy:
 *   - Mock `@upstash/workflow/nextjs` `serve()` at the import boundary to
 *     capture the workflow handler function and run it with a fake context.
 *   - Mock `@/lib/repo-indexer` to record every call to its exports.
 *   - Mock `@/lib/workflow/client` to record every `workflowClient.trigger` call.
 *   - Mock `@/lib/github-memory`, `@/lib/github-memory/dream-cycle`,
 *     `@/lib/memory/notifications`, and `@/lib/insforge/admin` so the
 *     non-indexer parts of each entry point can run end-to-end.
 */
// @vitest-environment node
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ensure the webhook signature check is bypassed by leaving the secret unset
// at module-evaluation time. The handler reads `process.env.GITHUB_WEBHOOK_SECRET`
// once at import; deleting it here (hoisted) guarantees `WEBHOOK_SECRET` is
// undefined when the route module is evaluated.
vi.hoisted(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

// ── Shared mock state captured across all three scoped tests ───────────────
const calls = vi.hoisted(() => ({
  // Captured calls into @/lib/repo-indexer
  indexRepositoriesForUser: [] as unknown[][],
  markStaleRepositories: [] as unknown[][],
  reindexStaleRepositories: [] as unknown[][],
  indexRepository: [] as unknown[][],
  // Captured calls to workflowClient.trigger
  workflowTrigger: [] as { url: string; body: unknown }[],
  // The handler function captured by our serve() mock
  serveHandler: { fn: null as null | ((ctx: unknown) => Promise<unknown>) },
}));

vi.mock("@upstash/workflow/nextjs", () => ({
  serve: (fn: (ctx: unknown) => Promise<unknown>) => {
    calls.serveHandler.fn = fn;
    return {
      POST: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    };
  },
}));

vi.mock("@/lib/repo-indexer", () => ({
  indexRepositoriesForUser: async (...args: unknown[]) => {
    calls.indexRepositoriesForUser.push(args);
  },
  markStaleRepositories: async (...args: unknown[]) => {
    calls.markStaleRepositories.push(args);
    return 0;
  },
  reindexStaleRepositories: async (...args: unknown[]) => {
    calls.reindexStaleRepositories.push(args);
  },
  indexRepository: async (...args: unknown[]) => {
    calls.indexRepository.push(args);
    return { status: "ready", totalChunks: 0, commitSha: "" };
  },
}));

vi.mock("@/lib/workflow/client", () => ({
  workflowBaseUrl: () => "https://example.test",
  workflowUrl: (slug: string) =>
    `https://example.test/api/workflow/${slug.replace(/^\/+|\/+$/g, "")}`,
  workflowClient: {
    trigger: async (opts: { url: string; body: unknown }) => {
      calls.workflowTrigger.push({ url: opts.url, body: opts.body });
      return { workflowRunId: "run-1" };
    },
  },
  qstashClient: {},
}));

vi.mock("@/lib/github-memory", () => ({
  createIngestionJob: async (_userId: string) => "job-1",
  embedGitHubMemory: async () => undefined,
  getJob: async (_jobId: string) => ({
    id: "job-1",
    userId: "user-1",
    githubUsername: "octocat",
    status: "completed" as const,
    completedStages: ["repos", "commits", "prs", "issues"] as const,
    nextRetryAt: null,
    reposProcessed: 5,
    commitsProcessed: 10,
    prsProcessed: 2,
    issuesProcessed: 1,
    totalEntities: 18,
    totalEmbeddings: 18,
  }),
  runIngestion: async () => undefined,
}));

vi.mock("@/lib/github-memory/dream-cycle", () => ({
  runGitHubDreamCycle: async () => ({
    readmesSummarized: 5,
    narrativeSections: 3,
    insightsExtracted: 7,
  }),
}));

vi.mock("@/lib/memory/notifications", () => ({
  sendNotification: async () => ({ activityId: "activity-1" }),
}));

// Fake DB with a chainable, thenable query builder that satisfies both
// the sync workflow's `from(...).select(...).in(...)` and `update(...).eq(...)`
// patterns and the webhook's `from(...).select(...).eq(...).eq(...).eq(...).single()`.
type DbMockConfig = {
  github_ingestion_jobs?: { list?: { data: unknown[]; error: null } };
  connected_apps?: {
    single?: { data: { user_id: string } | null; error: null };
    list?: { data: unknown[]; error: null };
  };
};

class FakeQueryBuilder<T = unknown> {
  constructor(private table: string, private config: DbMockConfig) {}
  select() {
    return this;
  }
  update() {
    return this;
  }
  insert() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  lt() {
    return this;
  }
  gte() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  // Awaiting the builder triggers the table-default response.
  then(onFulfilled: (value: { data: unknown; error: null }) => unknown) {
    const result =
      this.table === "github_ingestion_jobs"
        ? this.config.github_ingestion_jobs?.list ?? { data: [], error: null }
        : this.table === "connected_apps"
        ? this.config.connected_apps?.list ?? { data: [], error: null }
        : { data: null, error: null };
    onFulfilled(result);
  }
  async single() {
    if (this.table === "connected_apps") {
      return (
        this.config.connected_apps?.single ?? { data: null, error: null }
      );
    }
    return { data: null, error: null };
  }
  async maybeSingle() {
    if (this.table === "connected_apps") {
      return (
        this.config.connected_apps?.single ?? { data: null, error: null }
      );
    }
    return { data: null, error: null };
  }
}

let dbMockConfig: DbMockConfig = {};

vi.mock("@/lib/insforge/admin", () => ({
  createAdminClient: () => ({
    database: {
      from: (table: string) => new FakeQueryBuilder(table, dbMockConfig),
    },
    // Harmless stubs for the other InsForge client surfaces in case a
    // route under test references them.
    storage: {},
    auth: {},
  }),
}));

// ── Test helpers ───────────────────────────────────────────────────────────

/** Reset all captured calls and the InsForge fake before each test. */
function resetCaptured() {
  calls.indexRepositoriesForUser.length = 0;
  calls.markStaleRepositories.length = 0;
  calls.reindexStaleRepositories.length = 0;
  calls.indexRepository.length = 0;
  calls.workflowTrigger.length = 0;
  dbMockConfig = {};
}

/** Drive a workflow body. The fake `context` records executed step IDs. */
async function runWorkflow(
  handler: (ctx: unknown) => Promise<unknown>,
  payload: unknown,
): Promise<{ executedStepIds: string[]; result: unknown }> {
  const executedStepIds: string[] = [];
  const context = {
    requestPayload: payload,
    run: async <R,>(stepId: string, fn: () => Promise<R> | R): Promise<R> => {
      executedStepIds.push(stepId);
      return await fn();
    },
  };
  const result = await handler(context);
  return { executedStepIds, result };
}

// ── Properties ─────────────────────────────────────────────────────────────

describe("Bug Condition: Background-Job Entry Points Do Not Invoke Repo-Indexer", () => {
  beforeEach(() => {
    vi.resetModules();
    resetCaptured();
    calls.serveHandler.fn = null;
  });

  afterEach(() => {
    resetCaptured();
    calls.serveHandler.fn = null;
  });

  // ── Test case 1 — github-memory-ingest-complete ─────────────────────────
  it("Property 1a: `github-memory-ingest-complete` does not invoke @/lib/repo-indexer (Requirements 1.1, 2.1)", async () => {
    // Scoped to the `github-memory-ingest-complete` Bug Condition trigger:
    // job.status === "completed" AND completedStages.length >= 4.
    // The handler is deterministic given the mocked `getJob` return value,
    // but we wrap the assertion in fast-check to satisfy the scoped-PBT shape
    // described in design.md (one constant input per concrete trigger).
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("user-1", "user-abc-123", "00000000-0000-0000-0000-000000000001"),
        async (userId) => {
          resetCaptured();

          // Importing the route module triggers the mocked `serve()` which
          // captures the workflow handler.
          await import(
            "@/app/api/workflow/github-memory-ingest/route"
          );
          const handler = calls.serveHandler.fn;
          expect(handler).not.toBeNull();

          const { executedStepIds } = await runWorkflow(handler!, { userId });

          // Property (a): zero invocations of any @/lib/repo-indexer export.
          expect(calls.indexRepositoriesForUser).toEqual([]);
          expect(calls.markStaleRepositories).toEqual([]);
          expect(calls.reindexStaleRepositories).toEqual([]);
          expect(calls.indexRepository).toEqual([]);

          // Property (c): the executed step IDs do not include `repo-indexing`.
          expect(executedStepIds).not.toContain("repo-indexing");

          // Sanity: the non-indexer steps still ran (preservation envelope).
          expect(executedStepIds).toContain("create-job");
          expect(executedStepIds).toContain("run-stage-repos");
          expect(executedStepIds).toContain("run-stage-commits");
          expect(executedStepIds).toContain("run-stage-prs");
          expect(executedStepIds).toContain("run-stage-issues");
          expect(executedStepIds).toContain("run-stage-postprocess");
          expect(executedStepIds).toContain("notify-user");
        },
      ),
      { numRuns: 3 },
    );
  });

  // ── Test case 2 — github-memory-sync-scheduled ──────────────────────────
  it("Property 1b: `github-memory-sync-scheduled` does not invoke @/lib/repo-indexer (Requirements 1.2, 2.2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("user-sync-1", "user-sync-2"),
        async (userId) => {
          resetCaptured();
          dbMockConfig = {
            github_ingestion_jobs: {
              list: {
                data: [
                  {
                    user_id: userId,
                    id: "job-sync-1",
                    github_username: "octocat",
                  },
                ],
                error: null,
              },
            },
            connected_apps: {
              list: {
                data: [{ user_id: userId }],
                error: null,
              },
            },
          };

          await import("@/app/api/workflow/github-memory-sync/route");
          const handler = calls.serveHandler.fn;
          expect(handler).not.toBeNull();

          const { executedStepIds } = await runWorkflow(handler!, {});

          // Property (a): zero invocations of any @/lib/repo-indexer export.
          expect(calls.indexRepositoriesForUser).toEqual([]);
          expect(calls.markStaleRepositories).toEqual([]);
          expect(calls.reindexStaleRepositories).toEqual([]);
          expect(calls.indexRepository).toEqual([]);

          // Property (c): the executed step IDs do not include the indexing
          // steps. `mark-stale-repos`, `repo-index-${userId}`, and
          // `stale-reindex-${userId}` must all be absent.
          expect(executedStepIds).not.toContain("mark-stale-repos");
          expect(executedStepIds).not.toContain(`repo-index-${userId}`);
          expect(executedStepIds).not.toContain(`stale-reindex-${userId}`);

          // Sanity: discovery and per-user sync still run (preservation envelope).
          expect(executedStepIds).toContain("find-synced-users");
          expect(executedStepIds).toContain(`sync-${userId}`);
        },
      ),
      { numRuns: 2 },
    );
  });

  // ── Test case 3 — github-webhook-push matched installation ──────────────
  it("Property 1c: `github-webhook-push` (matched installation) does not trigger repo-index-incremental (Requirements 1.3, 2.3)", async () => {
    // Generator: small variation in installation id, repo full name, and
    // commits payload, all paired with a connected installation in the
    // InsForge fake (so `installationResolvesToConnectedUser(input) === true`).
    const installationIdArb = fc.integer({ min: 1, max: 1_000_000 });
    const repoFullNameArb = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9_-]{0,15}$/),
        fc.stringMatching(/^[a-z][a-z0-9_-]{0,15}$/),
      )
      .map(([owner, name]) => `${owner}/${name}`);
    const fileChangeArb = fc.record({
      added: fc.array(fc.stringMatching(/^[a-z][a-z0-9/_.-]{0,40}$/), {
        maxLength: 3,
      }),
      modified: fc.array(fc.stringMatching(/^[a-z][a-z0-9/_.-]{0,40}$/), {
        maxLength: 3,
      }),
      removed: fc.array(fc.stringMatching(/^[a-z][a-z0-9/_.-]{0,40}$/), {
        maxLength: 3,
      }),
    });

    await fc.assert(
      fc.asyncProperty(
        installationIdArb,
        repoFullNameArb,
        fc.array(fileChangeArb, { maxLength: 3, minLength: 1 }),
        async (installationId, repoFullName, commits) => {
          resetCaptured();
          // Configure the connected_apps lookup to RESOLVE TO A CONNECTED USER
          // (matched installation = Bug Condition input).
          dbMockConfig = {
            connected_apps: {
              single: { data: { user_id: "user-webhook-1" }, error: null },
            },
          };

          const { POST } = await import(
            "@/app/api/webhooks/github/route"
          );

          const payload = {
            ref: "refs/heads/main",
            after: "deadbeefcafe1234567890abcdef0123456789ab",
            installation: { id: installationId },
            repository: { full_name: repoFullName },
            commits,
          };
          const body = JSON.stringify(payload);
          const req = new Request("https://example.test/api/webhooks/github", {
            method: "POST",
            headers: {
              "x-github-event": "push",
              "x-github-delivery": "delivery-1",
              "content-type": "application/json",
            },
            body,
          });

          const response = await POST(req as never);
          // Drain the body so any async work in the handler completes.
          await response.text();

          // Property (a): zero invocations of any @/lib/repo-indexer export.
          expect(calls.indexRepositoriesForUser).toEqual([]);
          expect(calls.markStaleRepositories).toEqual([]);
          expect(calls.reindexStaleRepositories).toEqual([]);
          expect(calls.indexRepository).toEqual([]);

          // Property (b): zero downstream workflowClient.trigger calls for
          // the `repo-index-incremental` URL.
          const repoIndexTriggers = calls.workflowTrigger.filter((t) =>
            t.url.endsWith("/api/workflow/repo-index-incremental"),
          );
          expect(repoIndexTriggers).toEqual([]);
        },
      ),
      { numRuns: 5 },
    );
  });
});
