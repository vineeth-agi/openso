/**
 * Open Issues Sync Workflow.
 *
 * Triggered on-demand from server actions / cron via:
 *   workflowClient.trigger({
 *     url: workflowUrl("open-issues-sync"),
 *     body: { repoIds?: string[]; fullSync?: boolean }
 *   })
 */

import { Octokit } from "@octokit/rest";
import { serve } from "@upstash/workflow/nextjs";
import { createHash } from "crypto";

import { createAdminClient } from "@/lib/insforge/admin";
import { voyageEmbedRaw } from "@/lib/memory/embeddings";
import { CACHE_KEYS, cacheDel, cacheDelByPattern } from "@/lib/redis";

const VOYAGE_MODEL = "voyage-code-3";

const EASY_LABELS = [
  "good first issue", "good-first-issue", "beginner",
  "beginner-friendly", "starter", "easy", "trivial",
  "first-timers-only", "up-for-grabs", "junior",
  "low-hanging-fruit", "newbie",
];
const MEDIUM_LABELS = ["medium", "intermediate", "moderate"];
const HARD_LABELS = ["hard", "advanced", "complex", "expert", "architecture", "core"];
const TYPE_MAP: Record<string, string> = {
  documentation: "documentation", docs: "documentation", doc: "documentation",
  test: "test", testing: "test", tests: "test",
  bug: "bug", fix: "bug", defect: "bug",
  enhancement: "feature", feature: "feature", "feature request": "feature",
  "feature-request": "feature",
  refactor: "refactor", refactoring: "refactor", cleanup: "refactor",
  performance: "refactor",
};
const HELP_WANTED_LABELS = [
  "help wanted", "help-wanted", "contributions welcome",
  "contributions-welcome", "hacktoberfest",
];
const CLAIMED_LABELS = [
  "wip", "work in progress", "in progress", "in-progress",
  "claimed", "taken", "assigned", "being worked on",
  "pr open", "pr-open", "working",
];
const STALE_LABELS = ["stale", "inactive", "abandoned"];
const TRIAGE_LABELS = [
  "needs-triage", "needs triage", "triage", "needs-investigation",
  "needs investigation", "investigating", "under review",
];
const BLOCKED_LABELS = [
  "blocked", "blocking", "on hold", "on-hold", "waiting",
  "waiting for upstream", "waiting-for-upstream",
];
const SKIP_LABELS = [
  "duplicate", "wontfix", "wont-fix", "wont fix",
  "invalid", "spam", "question", "discussion",
];

// Domain / expertise labels — drives the chat search `filter_expertise` filter.
const EXPERTISE_MAP: Record<string, string> = {
  frontend: "frontend", "front end": "frontend", ui: "frontend", ux: "frontend",
  css: "frontend", html: "frontend", react: "frontend", vue: "frontend", svelte: "frontend",
  backend: "backend", "back end": "backend", server: "backend", api: "backend",
  fullstack: "fullstack", "full stack": "fullstack",
  devops: "devops", ci: "devops", cd: "devops",
  infrastructure: "devops", infra: "devops",
  docker: "devops", kubernetes: "devops", k8s: "devops",
  database: "database", db: "database", sql: "database",
  postgres: "database", postgresql: "database", mysql: "database",
  ml: "ml", ai: "ml", "machine learning": "ml", "deep learning": "ml",
  llm: "ml", embedding: "ml", embeddings: "ml", rag: "ml",
  security: "security", auth: "security",
  authentication: "security", authorization: "security", "auth/authn": "security",
  mobile: "mobile", ios: "mobile", android: "mobile",
  "react native": "mobile", "react-native": "mobile",
  design: "design", ux_design: "design",
  data: "data", analytics: "data", pipeline: "data",
};

const BOUNTY_LABELS = ["bounty", "paid", "rewarded", "$$$"];
const BOUNTY_AMOUNT_RE = /(?:bounty|reward|prize)[\s:]*[$₹€£]?(\d+(?:[.,]\d+)?\s*[kK]?)|[$₹€£](\d+(?:[.,]\d+)?\s*[kK]?)\s*(?:bounty|reward|prize)/i;
const BOUNTY_PRESENCE_RE = /\b(bounty|prize\s+pool|reward\s+pool)\b/i;

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(area|scope|type|category|kind)[:/]/, "")
    .replace(/-/g, " ")
    .trim();
}

function classifyLabels(rawLabels: string[]) {
  let difficulty: string | null = null;
  let issueType = "other";
  let hasHelpWanted = false;
  let isClaimed = false;
  let isStale = false;
  let isTriage = false;
  let isBlocked = false;
  let shouldSkip = false;

  for (const raw of rawLabels) {
    const n = normalizeLabel(raw);
    if (EASY_LABELS.includes(n)) difficulty = "easy";
    else if (MEDIUM_LABELS.includes(n)) difficulty = "medium";
    else if (HARD_LABELS.includes(n)) difficulty = "hard";
    if (TYPE_MAP[n]) issueType = TYPE_MAP[n];
    if (HELP_WANTED_LABELS.includes(n)) hasHelpWanted = true;
    if (CLAIMED_LABELS.includes(n)) isClaimed = true;
    if (STALE_LABELS.includes(n)) isStale = true;
    if (TRIAGE_LABELS.includes(n)) isTriage = true;
    if (BLOCKED_LABELS.includes(n)) isBlocked = true;
    if (SKIP_LABELS.includes(n)) shouldSkip = true;
  }
  return { difficulty, issueType, hasHelpWanted, isClaimed, isStale, isTriage, isBlocked, shouldSkip };
}

/**
 * Fallback difficulty inference. When GitHub labels don't carry an explicit
 * difficulty signal (most issues), derive one from estimated_minutes and
 * issue type so chat search and the dashboard see usable buckets instead of
 * `"unknown"`. Mirrors the helper in
 * `scripts/_archive/test-open-source-sync.mjs`.
 */
function inferDifficulty(
  labelDifficulty: string | null,
  estimatedMinutes: number,
  issueType: string,
  hasSubIssues: boolean,
): string {
  if (labelDifficulty) return labelDifficulty;
  if (issueType === "documentation" && !hasSubIssues) return "easy";
  if (estimatedMinutes <= 60) return "easy";
  if (estimatedMinutes <= 180) return "medium";
  return "hard";
}

function truncateBody(body: string | null, maxLen = 500): string {
  if (!body || body.length <= maxLen) return body || "";
  const truncated = body.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function estimateMinutes(
  title: string,
  body: string,
  issueType: string,
  bodyLength: number,
  hasSub: boolean,
): number {
  const combined = title + " " + body;
  if (/\btypo\b|fix\s+(spelling|link|wording)/i.test(title)) return 15;
  if (issueType === "documentation" && bodyLength < 500) return 30;
  if (/one[-\s]?liner|trivial|small\s+(fix|change)/i.test(combined)) return 30;
  if (bodyLength < 300) return 60;
  if (bodyLength < 1000) return 180;
  if (hasSub) return 1440;
  return 480;
}

function detectBodyQuality(body: string) {
  return {
    has_code_block: /```[\s\S]*?```/.test(body),
    has_reproduction_steps: /steps?\s+to\s+reproduce|1\.\s+\w/i.test(body),
    has_screenshots: /!\[|<img\s/.test(body),
    has_error_log: /Error:|Traceback|at\s+\w+\.\w+\(/.test(body),
  };
}

function inferExpertise(rawLabels: string[]): string {
  for (const raw of rawLabels) {
    const n = normalizeLabel(raw);
    if (EXPERTISE_MAP[n]) return EXPERTISE_MAP[n];
  }
  return "unknown";
}

function detectBounty(
  rawLabels: string[],
  title: string,
  body: string,
): { hasBounty: boolean; bountyAmount: string | null } {
  let hasBounty = false;
  for (const raw of rawLabels) {
    const n = normalizeLabel(raw);
    if (BOUNTY_LABELS.includes(n)) { hasBounty = true; break; }
  }
  const haystack = `${title}\n${body}`;
  if (!hasBounty) hasBounty = BOUNTY_PRESENCE_RE.test(haystack);
  let bountyAmount: string | null = null;
  const m = haystack.match(BOUNTY_AMOUNT_RE);
  if (m) {
    const captured = (m[1] ?? m[2] ?? "").trim();
    if (captured) {
      bountyAmount = captured;
      hasBounty = true;
    }
  }
  return { hasBounty, bountyAmount };
}

// PR closing-keyword regex — matches GitHub's auto-close keywords:
//   close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved
// followed by `#N`. Used to populate `has_open_pr` on issues already being
// worked on, so chat search hides them.
const CLOSING_KEYWORDS_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\s:]+#(\d+)/gi;

async function fetchIssuesWithOpenPRs(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<Set<number>> {
  const referenced = new Set<number>();
  let page = 1;
  while (true) {
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo: name,
      state: "open",
      per_page: 100,
      page,
      headers: { accept: "application/vnd.github+json" },
    });
    if (!prs || prs.length === 0) break;
    for (const pr of prs) {
      const haystack = `${pr.title ?? ""}\n${pr.body ?? ""}`;
      const matches = haystack.matchAll(CLOSING_KEYWORDS_RE);
      for (const m of matches) {
        const n = parseInt(m[1] ?? "", 10);
        if (Number.isFinite(n) && n > 0) referenced.add(n);
      }
    }
    if (prs.length < 100) break;
    page++;
    await delay(200);
  }
  return referenced;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type OpenIssuesSyncPayload = {
  repoIds?: string[];
  fullSync?: boolean;
};

export const { POST } = serve<OpenIssuesSyncPayload>(async (context) => {
  const db = createAdminClient();
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");

  const octokit = new Octokit({
    auth: token,
    userAgent: "OpenSourceFinder/1.0",
  });

  const { repoIds, fullSync } = context.requestPayload ?? {};

  const repos = (await context.run("fetch-repos", async () => {
    let q = db.database.from("open_source_repos")
      .select("id, name, owner, language, stars, avatar");
    if (repoIds && repoIds.length > 0) q = q.in("id", repoIds);
    const { data } = await q;
    return (data ?? []) as Array<{
      id: string;
      name: string;
      owner: string;
      language: string | null;
      stars: number | null;
      avatar: string | null;
    }>;
  })) as Array<{
    id: string;
    name: string;
    owner: string;
    language: string | null;
    stars: number | null;
    avatar: string | null;
  }>;

  if (repos.length === 0) {
    return { status: "no_repos", synced: 0 };
  }

  const allResults: Record<string, unknown> = {};

  for (const repo of repos) {
    const result = await context.run(
      `sync-${repo.owner}-${repo.name}`,
      async () => {
        const logId = crypto.randomUUID();
        await db.database.from("open_issues_sync_log").insert({
          id: logId,
          repo_id: repo.id,
          repo_name: `${repo.owner}/${repo.name}`,
          is_full_sync: !!fullSync,
        });

        let issuesFetched = 0;
        let issuesUpserted = 0;
        let issuesDeleted = 0;
        let embeddingsNew = 0;
        let embeddingsSkipped = 0;
        let apiCallsUsed = 0;

        try {
          const { data: lastIssue } = await db.database.from("open_source_issues")
            .select("synced_at")
            .eq("repo_id", repo.id)
            .order("synced_at", { ascending: false })
            .limit(1)
            .single();

          const sinceDate =
            !fullSync && lastIssue?.synced_at ? lastIssue.synced_at : undefined;

          const allIssues: Array<Record<string, unknown>> = [];
          let page = 1;
          while (true) {
            const { data: pageIssues } = await octokit.rest.issues.listForRepo({
              owner: repo.owner,
              repo: repo.name,
              state: "open",
              per_page: 100,
              sort: "updated",
              direction: "desc",
              since: sinceDate || undefined,
              page,
              headers: { accept: "application/vnd.github+json" },
            });
            apiCallsUsed++;
            if (!pageIssues || pageIssues.length === 0) break;
            allIssues.push(...(pageIssues as unknown as Array<Record<string, unknown>>));
            if (pageIssues.length < 100) break;
            page++;
            await delay(200);
          }
          issuesFetched = allIssues.length;

          // Scan open PRs once and collect issue numbers referenced via
          // closing keywords (Fixes #N / Closes #N / Resolves #N). Used to
          // populate `has_open_pr` so chat search hides issues already
          // being worked on.
          const prRefSet = await fetchIssuesWithOpenPRs(
            octokit,
            repo.owner,
            repo.name,
          );

          const toUpsert: Array<Record<string, unknown>> = [];
          const toEmbed: Array<{ index: number; text: string }> = [];

          for (const issue of allIssues) {
            if (issue.pull_request) continue;
            if (issue.state_reason === "not_planned") continue;
            if (issue.locked) continue;

            const rawLabels = ((issue.labels ?? []) as Array<
              string | { name?: string }
            >)
              .map((l) => (typeof l === "string" ? l : l.name))
              .filter((x): x is string => Boolean(x));

            const cls = classifyLabels(rawLabels);
            if (cls.shouldSkip) continue;

            const body = (issue.body as string | null) ?? "";
            const bodyTrunc = truncateBody(body);
            const embedText = `${issue.title}\n${bodyTrunc}`;
            const embedHash = sha256(embedText);

            const reactions =
              (issue.reactions as Record<string, number> | null) ?? {};
            const subSummary = issue.sub_issues_summary as
              | { total?: number }
              | undefined;
            const hasSub = (subSummary?.total ?? 0) > 0;
            const milestone = issue.milestone as
              | { due_on?: string }
              | undefined;
            const milestoneDate = milestone?.due_on
              ? new Date(milestone.due_on)
              : null;
            const milestoneSoon = milestoneDate
              ? milestoneDate.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000
              : false;

            const bodyQuality = detectBodyQuality(body);
            const expertiseRequired = inferExpertise(rawLabels);
            const bounty = detectBounty(rawLabels, issue.title as string, body);
            const authorAssoc = (issue.author_association as string) || "NONE";
            const isMaintainer = ["OWNER", "MEMBER", "COLLABORATOR"].includes(
              authorAssoc,
            );
            const createdAt = new Date(issue.created_at as string);
            const isFresh =
              Date.now() - createdAt.getTime() < 7 * 24 * 60 * 60 * 1000;
            const isStuckLong =
              !isFresh &&
              Date.now() - new Date(issue.updated_at as string).getTime() >
                90 * 24 * 60 * 60 * 1000;

            const row: Record<string, unknown> = {
              repo_id: repo.id,
              github_id: issue.id,
              number: issue.number,
              title: issue.title,
              url: issue.html_url,
              labels: rawLabels,
              difficulty: inferDifficulty(
                cls.difficulty,
                estimateMinutes(
                  issue.title as string,
                  body,
                  cls.issueType,
                  body.length,
                  hasSub,
                ),
                cls.issueType,
                hasSub,
              ),
              issue_type: cls.issueType,
              has_help_wanted: cls.hasHelpWanted,
              is_assigned:
                ((issue.assignees as unknown[] | null)?.length ?? 0) > 0,
              has_open_pr: prRefSet.has(issue.number as number),
              is_claimed_by_label: cls.isClaimed,
              comment_count: issue.comments ?? 0,
              is_stale: cls.isStale,
              is_needs_triage: cls.isTriage,
              is_blocked: cls.isBlocked,
              is_duplicate: false,
              body_length: body.length,
              reactions_plus_one: reactions["+1"] ?? reactions.plus_one ?? 0,
              reactions_eyes: reactions.eyes ?? 0,
              reactions_rocket: reactions.rocket ?? 0,
              author_is_maintainer: isMaintainer,
              has_sub_issues: hasSub,
              has_code_block: bodyQuality.has_code_block,
              has_reproduction_steps: bodyQuality.has_reproduction_steps,
              has_screenshots: bodyQuality.has_screenshots,
              has_error_log: bodyQuality.has_error_log,
              has_milestone: !!issue.milestone,
              milestone_due_soon: milestoneSoon,
              is_locked: false,
              estimated_minutes: estimateMinutes(
                issue.title as string,
                body,
                cls.issueType,
                body.length,
                hasSub,
              ),
              expertise_required: expertiseRequired,
              has_bounty: bounty.hasBounty,
              bounty_amount: bounty.bountyAmount,
              is_fresh: isFresh,
              is_stuck_long_term: isStuckLong,
              created_at: issue.created_at,
              updated_at: issue.updated_at,
              synced_at: new Date().toISOString(),
              embed_text_hash: embedHash,
              embedding_model: VOYAGE_MODEL,
            };

            const idx = toUpsert.length;
            toUpsert.push(row);

            const { data: existing } = await db.database.from("open_source_issues")
              .select("embed_text_hash")
              .eq("repo_id", repo.id)
              .eq("number", issue.number as number)
              .single();

            if (existing?.embed_text_hash === embedHash) {
              embeddingsSkipped++;
            } else {
              toEmbed.push({ index: idx, text: embedText });
            }
          }

          // Embed in batches
          const BATCH_SIZE = 20;
          for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
            const batch = toEmbed.slice(i, i + BATCH_SIZE);
            const texts = batch.map((b) => b.text);
            try {
              const embeddings = await voyageEmbedRaw(texts, "document", {
                model: "voyage-code-3",
                outputDimension: 1024,
              });
              for (let j = 0; j < batch.length; j++) {
                toUpsert[batch[j].index].embedding = JSON.stringify(
                  embeddings[j],
                );
              }
              embeddingsNew += batch.length;
            } catch (err) {
              console.error(`[Sync] Embedding batch failed: ${err}`);
            }
            if (i + BATCH_SIZE < toEmbed.length) await delay(1500);
          }

          for (let i = 0; i < toUpsert.length; i += 50) {
            const batch = toUpsert.slice(i, i + 50);
            const { error } = await db.database.from("open_source_issues")
              .upsert(batch, { onConflict: "repo_id,number" });
            if (error) {
              console.error(`[Sync] Upsert error: ${error.message}`);
            } else {
              issuesUpserted += batch.length;
            }
          }

          if (fullSync && toUpsert.length > 0) {
            const openNumbers = toUpsert.map((r) => r.number as number);
            const { data: dbIssues } = await db.database.from("open_source_issues")
              .select("number")
              .eq("repo_id", repo.id);
            if (dbIssues) {
              const toDelete = dbIssues
                .filter((d) => !openNumbers.includes(d.number))
                .map((d) => d.number);
              if (toDelete.length > 0) {
                await db.database.from("open_source_issues")
                  .delete()
                  .eq("repo_id", repo.id)
                  .in("number", toDelete);
                issuesDeleted = toDelete.length;
              }
            }
          }

          // Refresh repo-level health (community profile + languages).
          // Mirrors the trailing step of the original seeding script so the
          // detail page's Community Profile Health card stays populated.
          // Failures are non-fatal — issue sync already succeeded.
          try {
            const healthUpdates: Record<string, unknown> = {
              last_synced_at: new Date().toISOString(),
            };
            try {
              const { data: community } = (await octokit.request(
                "GET /repos/{owner}/{repo}/community/profile",
                { owner: repo.owner, repo: repo.name },
              )) as {
                data: {
                  health_percentage?: number;
                  files?: {
                    code_of_conduct?: unknown;
                    contributing?: { html_url?: string } | null;
                    issue_template?: unknown;
                    pull_request_template?: unknown;
                    license?: { spdx_id?: string } | null;
                  } | null;
                };
              };
              if (typeof community.health_percentage === "number") {
                healthUpdates.health_percentage = community.health_percentage;
              }
              const files = community.files ?? {};
              healthUpdates.has_code_of_conduct = !!files.code_of_conduct;
              healthUpdates.has_contributing = !!files.contributing;
              healthUpdates.contributing_url =
                files.contributing?.html_url ?? null;
              healthUpdates.has_issue_template = !!files.issue_template;
              healthUpdates.has_pr_template = !!files.pull_request_template;
              if (files.license) {
                const spdx = files.license.spdx_id ?? "";
                healthUpdates.license_name = spdx;
                healthUpdates.license_spdx = spdx;
                healthUpdates.license_type = [
                  "MIT",
                  "Apache-2.0",
                  "BSD-2-Clause",
                  "BSD-3-Clause",
                  "ISC",
                  "Unlicense",
                ].includes(spdx)
                  ? "permissive"
                  : "other";
              }
            } catch (err) {
              console.error(`[Sync] community/profile failed:`, err);
            }
            try {
              const { data: langs } = (await octokit.request(
                "GET /repos/{owner}/{repo}/languages",
                { owner: repo.owner, repo: repo.name },
              )) as { data: Record<string, number> };
              healthUpdates.languages = langs;
            } catch (err) {
              console.error(`[Sync] languages failed:`, err);
            }
            const { error: healthErr } = await db.database
              .from("open_source_repos")
              .update(healthUpdates)
              .eq("id", repo.id);
            if (healthErr) {
              console.error(
                `[Sync] repo health update failed: ${healthErr.message}`,
              );
            }
          } catch (err) {
            console.error(`[Sync] repo health refresh threw:`, err);
          }

          await db.database.from("open_issues_sync_log")
            .update({
              finished_at: new Date().toISOString(),
              status: "success",
              issues_fetched: issuesFetched,
              issues_upserted: issuesUpserted,
              issues_deleted: issuesDeleted,
              embeddings_new: embeddingsNew,
              embeddings_skipped: embeddingsSkipped,
              api_calls_used: apiCallsUsed,
            })
            .eq("id", logId);

          return {
            repo: `${repo.owner}/${repo.name}`,
            issuesFetched,
            issuesUpserted,
            issuesDeleted,
            embeddingsNew,
            embeddingsSkipped,
            apiCallsUsed,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[Sync] Failed for ${repo.owner}/${repo.name}:`, err);
          await db.database.from("open_issues_sync_log")
            .update({
              finished_at: new Date().toISOString(),
              status: "failed",
              error_message: message?.slice(0, 500),
            })
            .eq("id", logId);
          return { repo: `${repo.owner}/${repo.name}`, error: message };
        }
      },
    );

    allResults[`${repo.owner}/${repo.name}`] = result;
  }

  await context.run("update-repo-health", async () => {
    for (const repo of repos) {
      try {
        const { data: community } =
          await octokit.rest.repos.getCommunityProfileMetrics({
            owner: repo.owner,
            repo: repo.name,
          });

        const updates: Record<string, unknown> = {
          health_percentage: community.health_percentage,
          has_code_of_conduct: !!community.files?.code_of_conduct,
          has_contributing: !!community.files?.contributing,
          contributing_url: community.files?.contributing?.html_url || null,
          has_issue_template: !!community.files?.issue_template,
          has_pr_template: !!community.files?.pull_request_template,
          last_synced_at: new Date().toISOString(),
        };

        if (community.files?.license) {
          const spdx = community.files.license.spdx_id || "";
          updates.license_name = community.files.license.name;
          updates.license_spdx = spdx;
          const permissive = [
            "MIT",
            "Apache-2.0",
            "BSD-2-Clause",
            "BSD-3-Clause",
            "ISC",
            "Unlicense",
          ];
          const copyleft = [
            "GPL-2.0",
            "GPL-3.0",
            "AGPL-3.0",
            "LGPL-2.1",
            "LGPL-3.0",
            "MPL-2.0",
          ];
          updates.license_type = permissive.includes(spdx)
            ? "permissive"
            : copyleft.includes(spdx)
              ? "copyleft"
              : spdx
                ? "other"
                : "none";
        }

        try {
          const { data: langs } = await octokit.rest.repos.listLanguages({
            owner: repo.owner,
            repo: repo.name,
          });
          updates.languages = langs;
        } catch {
          // Non-critical
        }

        try {
          const { data: activity } =
            await octokit.rest.repos.getCommitActivityStats({
              owner: repo.owner,
              repo: repo.name,
            });
          if (Array.isArray(activity) && activity.length >= 4) {
            const last4 = activity.slice(-4);
            const avg = last4.reduce((s, w) => s + w.total, 0) / 4;
            updates.commits_per_week = Math.round(avg * 10) / 10;
            updates.activity_level =
              avg > 10
                ? "Very Active"
                : avg > 3
                  ? "Active"
                  : avg > 1
                    ? "Moderate"
                    : "Low Activity";
          }
        } catch {
          // GitHub may return 202 — retry next sync
        }

        await db.database.from("open_source_repos")
          .update(updates)
          .eq("id", repo.id);

        await delay(200);
      } catch (err) {
        console.error(
          `[Sync] Health update failed for ${repo.owner}/${repo.name}:`,
          err,
        );
      }
    }
    return null;
  });

  // Bust the read-through caches that the dashboard endpoints rely on.
  // We do this in its own `context.run` step so a Redis hiccup doesn't
  // mark the whole workflow as failed (caches are best-effort), and we
  // include the jobs:list:* prefix because new repo activity can ripple
  // into related job-board content too.
  await context.run("bust-caches", async () => {
    try {
      await cacheDel(CACHE_KEYS.openSourceRepos, CACHE_KEYS.openSourceIssues);
      await cacheDelByPattern(`${CACHE_KEYS.jobsListPrefix}*`);
    } catch (err) {
      console.warn("[Sync] cache invalidation failed (non-fatal):", err);
    }
    return null;
  });

  return { status: "complete", results: allResults };
});
