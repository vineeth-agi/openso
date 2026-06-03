/**
 * Unit tests for `src/lib/profile/project-merger.ts`.
 *
 * Validates the deterministic merge + ranking behaviour required by Issue #1
 * of the portfolio audit:
 *   - Resume + GitHub repos are both included.
 *   - Same/similar projects collapse to a single entry.
 *   - Resume content wins on conflict.
 *   - Ranking is reproducible: same input ⇒ same score ⇒ same order.
 */

import { describe, expect, it } from "vitest";

import type { RepoAnalysis } from "@/lib/profile/github-analyzer";
import {
  mergeAndRankProjects,
  projectSlug,
  scoreProject,
  slugSimilarity,
  type MergedProject,
} from "@/lib/profile/project-merger";
import type { ResumeData } from "@/lib/profile/resume-extractor";

// ── Test helpers ───────────────────────────────────────────────────────────

const mkRepo = (overrides: Partial<RepoAnalysis>): RepoAnalysis => ({
  name: overrides.name ?? "repo",
  url: overrides.url ?? `https://github.com/me/${overrides.name ?? "repo"}`,
  description: overrides.description ?? null,
  techStack: overrides.techStack ?? [],
  stars: overrides.stars ?? 0,
  forks: overrides.forks ?? 0,
  topics: overrides.topics ?? [],
  lastPushed: overrides.lastPushed ?? "2026-01-01T00:00:00Z",
  mergedPRs: overrides.mergedPRs ?? 0,
  role: overrides.role ?? "owner",
});

const mkResume = (
  projects: NonNullable<ResumeData["projects"]> = [],
): ResumeData =>
  ({
    name: "Test User",
    education: [],
    experience: [],
    projects,
    skills: {},
  }) as ResumeData;

// ── projectSlug + slugSimilarity ───────────────────────────────────────────

describe("projectSlug", () => {
  it("normalises spaces and case", () => {
    expect(projectSlug("AI Blox")).toBe("ai-blox");
    expect(projectSlug("Portfolio Site")).toBe("portfolio-site");
  });

  it("strips punctuation", () => {
    expect(projectSlug("Foo! @ Bar?")).toBe("foo-bar");
    expect(projectSlug("Foo/Bar")).toBe("foo-bar");
  });

  it("collapses dashes", () => {
    expect(projectSlug("foo--bar---baz")).toBe("foo-bar-baz");
  });
});

describe("slugSimilarity", () => {
  it("returns 1 for exact match", () => {
    expect(slugSimilarity("portfolio-site", "portfolio-site")).toBe(1);
  });

  it("returns 0 for empty input", () => {
    expect(slugSimilarity("", "anything")).toBe(0);
    expect(slugSimilarity("anything", "")).toBe(0);
  });

  it("returns >= 0.6 for token-overlapping slugs", () => {
    // "portfolio-site" vs "portfolio" share 1 of 2 tokens → 0.5
    // "ai-blox-generator" vs "ai-blox" share 2 of 3 tokens → 2/3 ≈ 0.66
    expect(slugSimilarity("ai-blox-generator", "ai-blox")).toBeGreaterThanOrEqual(0.6);
  });

  it("returns < 0.6 for unrelated slugs", () => {
    expect(slugSimilarity("portfolio-site", "ai-blox")).toBeLessThan(0.6);
  });
});

// ── mergeAndRankProjects ───────────────────────────────────────────────────

describe("mergeAndRankProjects", () => {
  it("includes BOTH resume and GitHub projects when distinct", () => {
    const resume = mkResume([
      { name: "Resume Only", description: "from resume", technologies: ["Rust"] },
    ]);
    const repos = [
      mkRepo({ name: "github-only", description: "from github", stars: 10 }),
    ];

    const merged = mergeAndRankProjects(resume, repos);
    const titles = merged.map((p) => p.title.toLowerCase());
    expect(titles).toContain("resume only");
    expect(titles).toContain("github-only");
    expect(merged).toHaveLength(2);
  });

  it("dedupes when resume and GitHub describe the same project", () => {
    const resume = mkResume([
      {
        name: "Portfolio Site",
        description: "User-curated description.",
        technologies: ["Next.js"],
      },
    ]);
    const repos = [
      mkRepo({
        name: "portfolio-site",
        description: "Auto-generated readme blurb.",
        stars: 42,
        topics: ["nextjs", "portfolio"],
      }),
    ];

    const merged = mergeAndRankProjects(resume, repos);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.source).toBe("merged");
    // Resume content wins for description.
    expect(m.description).toBe("User-curated description.");
    // GitHub stars + topics are merged in.
    expect(m.stars).toBe(42);
    expect(m.techstacks).toContain("Next.js");
    expect(m.techstacks.some((t) => t.toLowerCase() === "nextjs")).toBe(true);
  });

  it("ranks resume + pinned + many-stars project highest", () => {
    const resume = mkResume([
      { name: "starred-pinned", description: "User-built and shipped to prod.", technologies: ["TypeScript", "Postgres", "Redis"] },
      { name: "resume-only", description: "Just a resume entry.", technologies: ["Java"] },
    ]);
    const repos = [
      mkRepo({
        name: "starred-pinned",
        url: "https://github.com/me/starred-pinned",
        description: "Repo desc.",
        stars: 500,
        topics: ["typescript"],
        lastPushed: new Date().toISOString(),
      }),
      mkRepo({
        name: "github-quiet",
        url: "https://github.com/me/github-quiet",
        stars: 0,
        lastPushed: "2020-01-01T00:00:00Z",
      }),
    ];

    const ranked = mergeAndRankProjects(resume, repos, {
      pinnedRepos: ["me/starred-pinned"],
      now: new Date("2026-05-27T00:00:00Z"),
    });

    expect(ranked[0].slug).toBe("starred-pinned");
    expect(ranked[ranked.length - 1].slug).toBe("github-quiet");
  });

  it("is deterministic — same input twice gives identical ordering and scores", () => {
    const resume = mkResume([
      { name: "Alpha", description: "a", technologies: ["A"] },
      { name: "Beta", description: "b", technologies: ["B"] },
    ]);
    const repos = [
      mkRepo({ name: "gamma", stars: 5, lastPushed: "2025-06-01T00:00:00Z" }),
      mkRepo({ name: "delta", stars: 50, lastPushed: "2026-01-01T00:00:00Z" }),
    ];

    const fixedNow = new Date("2026-05-27T00:00:00Z");
    const a = mergeAndRankProjects(resume, repos, { now: fixedNow });
    const b = mergeAndRankProjects(resume, repos, { now: fixedNow });
    expect(a.map((p) => [p.slug, p.score])).toEqual(b.map((p) => [p.slug, p.score]));
  });
});

// ── scoreProject ───────────────────────────────────────────────────────────

describe("scoreProject", () => {
  it("rewards resume presence", () => {
    const base: MergedProject = {
      title: "x",
      slug: "x",
      category: "p",
      description: "this is a sufficiently long description for the description bonus",
      techstacks: ["a", "b", "c"],
      status: "active",
      link: "https://x.example.com",
      github: "me/x",
      stars: 0,
      lastPushed: new Date().toISOString(),
      source: "github",
      score: 0,
    };
    const githubOnlyScore = scoreProject(base);
    const resumeScore = scoreProject({ ...base, source: "merged" });
    expect(resumeScore).toBeGreaterThan(githubOnlyScore);
  });

  it("returns a value in [0, 1]", () => {
    const fully: MergedProject = {
      title: "x",
      slug: "x",
      category: "p",
      description: "long description that crosses thirty characters",
      techstacks: ["a", "b", "c", "d", "e", "f"],
      status: "active",
      link: "https://x.example.com",
      github: "me/x",
      stars: 1000,
      lastPushed: new Date().toISOString(),
      source: "merged",
      score: 0,
    };
    const empty: MergedProject = {
      ...fully,
      description: "",
      techstacks: [],
      link: null,
      github: null,
      stars: null,
      lastPushed: null,
      source: "github",
    };
    expect(scoreProject(fully, { pinnedRepos: ["me/x"] })).toBeLessThanOrEqual(1);
    expect(scoreProject(fully, { pinnedRepos: ["me/x"] })).toBeGreaterThan(0);
    expect(scoreProject(empty)).toBeGreaterThanOrEqual(0);
    expect(scoreProject(empty)).toBeLessThan(0.4);
  });
});
