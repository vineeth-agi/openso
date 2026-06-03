/**
 * Shared types for the Portfolio Recruiter Chatbot.
 *
 * This module is the single source of truth for the types used by the public
 * `/api/portfolio-chat` route, the user resolver, the system prompt builder,
 * the GitHub tools builder, the data assembly utilities, and the chat widget.
 *
 * Downstream modules in `src/lib/portfolio-chat/` and `src/portfolio-src/`
 * MUST import these types from here rather than re-deriving them so the route
 * and its dependencies stay in lockstep.
 *
 * See `.kiro/specs/portfolio-recruiter-chatbot/design.md`
 *  - "Components and Interfaces"
 *  - "Error Response Shape"
 *  - "Resume Structured Shape (subset used)"
 */

import type { Tool } from "ai";

import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

// ── Resume (chatbot view) ──────────────────────────────────────────────────
//
// Mirrors the canonical `ResumeData` shape produced by
// `src/lib/profile/resume-extractor.ts` and stored in
// `user_profiles.resume_structured`. We use a permissive interface (no Zod
// runtime parse) because the row is JSONB written by the extractor — but we
// MUST keep the field shapes aligned with the extractor schema or the data
// assembler crashes on `is not iterable` when it spreads `resume.skills` /
// `resume.experience` / `resume.projects`.
//
// All fields are optional because the row may be missing or partially
// populated. The data assembler is defensive (Array.isArray + guards) so any
// legacy / malformed value just degrades to empty rather than throwing.
//
// Historical note: an earlier version of this type assumed
// `skills: string[]` and `experience[].role/duration/description`. The real
// extractor produces `skills: { languages?, frameworks?, tools?, soft?, other? }`
// (an OBJECT) and `experience[].title/bullets/startDate/endDate/isCurrent`.
// Re-aligning here so production data flows through cleanly.

export interface ResumeSkillsObject {
  languages?: string[];
  frameworks?: string[];
  tools?: string[];
  soft?: string[];
  other?: string[];
}

export interface ResumeExperienceEntry {
  company: string;
  /** Canonical extractor field is `title`. We accept `role` for backwards-compat. */
  title?: string;
  role?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  /** Canonical extractor field is `bullets: string[]`. */
  bullets?: string[];
  /** Legacy alternate shape some imports used. */
  description?: string;
  duration?: string;
  technologies?: string[];
}

export interface ResumeProjectEntry {
  name: string;
  description: string;
  technologies?: string[];
  url?: string;
  highlights?: string[];
}

export interface ResumeEducationEntry {
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  /** Legacy alternate shape some imports used. */
  year?: string;
  gpa?: string;
  highlights?: string[];
}

export interface ResumeCertificationEntry {
  name: string;
  issuer?: string;
  date?: string;
}

export interface ResumeStructured {
  name?: string;
  /** Some extractor versions don't emit `title`; the assembler falls back to summary. */
  title?: string;
  summary?: string;
  /**
   * Canonical extractor produces a nested object. We also accept a flat
   * `string[]` for legacy / hand-authored rows. The data assembler unions
   * both shapes into a single deduped list of skill strings.
   */
  skills?: ResumeSkillsObject | string[];
  experience?: ResumeExperienceEntry[];
  projects?: ResumeProjectEntry[];
  education?: ResumeEducationEntry[];
  /** Canonical extractor produces objects. We also accept `string[]` for legacy rows. */
  certifications?: ResumeCertificationEntry[] | string[];
  totalYearsExperience?: number;
  seniorityLevel?: string;
}

// ── Resolved user ──────────────────────────────────────────────────────────
//
// Output of `resolvePortfolioUser(username)`. Bundles every piece of data the
// route needs from InsForge in a single shape so downstream steps don't have
// to re-query.

export interface ResolvedUser {
  userId: string;
  username: string;
  resumeStructured: ResumeStructured | null;
  portfolioConfig: PortfolioSiteConfig;
  githubToken: string | null;
  githubUsername: string | null;
}

// ── System prompt input ────────────────────────────────────────────────────
//
// Pure input to `buildPortfolioChatSystemPrompt`. The data assembler is
// responsible for resolving identity precedence (resume name → portfolio
// identity name → username) and formatting the GitHub Memory block before
// handing this object to the prompt builder.

export interface SystemPromptInput {
  candidateName: string;
  candidateTitle: string;
  candidateBio: string;
  skills: string[];
  contactInfo: string;
  experienceSummary: string;
  educationSummary: string;
  certifications: string[];
  topProjects: {
    title: string;
    description: string;
    techstacks: string[];
  }[];
  /** Already-formatted `formatGitHubMemoryPrompt` output. Empty string when memory is unavailable. */
  githubMemoryPrompt: string;
  /** Whether on-demand GitHub tools are registered for this request. */
  hasGithubTools: boolean;
}

// ── GitHub tools ───────────────────────────────────────────────────────────
//
// The three on-demand GitHub API tools registered with `streamText` when the
// candidate has a valid stored OAuth token. Keys must match the names exposed
// to the model in the system prompt.

export interface PortfolioGithubTools {
  get_repo_file_tree: Tool;
  get_file_content: Tool;
  get_repo_details: Tool;
}

// ── Error response shape ───────────────────────────────────────────────────
//
// Every non-streaming error response from `/api/portfolio-chat` MUST conform
// to this shape so the widget can branch on `code` rather than parsing the
// human-readable `error` string. See the "Failure Matrix" in the design for
// which HTTP status maps to which `ErrorCode`.

export type ErrorCode =
  | "user_not_found"
  | "rate_limited"
  | "invalid_request"
  | "profile_not_configured"
  | "internal_error";

export interface PortfolioChatError {
  /** Human-readable message safe to show in the widget. */
  error: string;
  /** Stable machine code for client-side branching. */
  code: ErrorCode;
  /** Seconds (only on 429). */
  retryAfter?: number;
}

// ── Re-exports ─────────────────────────────────────────────────────────────
//
// Re-export `PortfolioSiteConfig` so downstream chat modules can import every
// type they need from `@/lib/portfolio-chat/types` without reaching across
// into `@/lib/profile/portfolio-types`.

export type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";
