/**
 * fast-check arbitraries for the Portfolio Recruiter Chatbot property tests.
 *
 * Each arbitrary in this module produces values that satisfy the corresponding
 * Zod schema or TypeScript interface from `@/lib/portfolio-chat/types` and
 * `@/lib/portfolio-chat/request-schema`. The downstream property suites under
 * `src/__tests__/portfolio-chat/` consume these to drive `numRuns: 100`
 * exploration of the request schema, the resolver, the system prompt builder,
 * and the GitHub tools builder.
 *
 * Conventions:
 *  - Strings that flow into Zod schemas with `.min(1)` are constrained via
 *    `fc.string({ minLength: 1, maxLength: <bound> })` so generation always
 *    succeeds rather than getting filtered out.
 *  - Optional fields use `fc.option(_, { nil: undefined })` so the produced
 *    objects pass through the schema unchanged (Zod treats `undefined` as
 *    "field absent" for `.optional()` keys).
 *  - Free-form display strings (titles, descriptions) intentionally allow
 *    arbitrary unicode so prompt-builder properties exercise edge cases like
 *    surrogate pairs and zero-width characters that real resumes may contain.
 *
 * Imports types only from `@/lib/portfolio-chat/types` per the task brief.
 */

import fc from "fast-check";

import type {
  PortfolioSiteConfig,
  ResumeStructured,
  SystemPromptInput,
} from "@/lib/portfolio-chat/types";

// ── Primitive arbitraries ──────────────────────────────────────────────────

/**
 * Non-empty bounded string. The default `fc.string()` allows the empty string,
 * but most resume / portfolio fields are required and would fail Zod
 * validation when empty — so we wrap it once here for reuse.
 */
const nonEmptyString = (maxLength: number = 80) =>
  fc.string({ minLength: 1, maxLength });

/**
 * Short bounded array helper — keeps generated objects small enough that
 * property tests run fast while still exercising the iteration paths in the
 * prompt builder (which loops over skills / experiences / projects).
 */
const smallArray = <T>(arb: fc.Arbitrary<T>, max: number = 5): fc.Arbitrary<T[]> =>
  fc.array(arb, { minLength: 0, maxLength: max });

// ── usernameArb ────────────────────────────────────────────────────────────
//
// kebab-case strings of length 1–100. The shape is one or more segments of
// `[a-z0-9]+` joined by a single `-`. The total length is clamped to <= 100
// so the value always passes `z.string().min(1).max(100)` from
// `PortfolioChatRequestSchema`.

const KEBAB_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const kebabSegmentArb = fc
  .stringMatching(new RegExp(`^[${KEBAB_CHARS}]{1,12}$`))
  .filter((s) => s.length > 0);

export const usernameArb: fc.Arbitrary<string> = fc
  .array(kebabSegmentArb, { minLength: 1, maxLength: 6 })
  .map((segments) => segments.join("-"))
  // Belt-and-braces: ensure 1 <= length <= 100 even for pathological corners.
  .filter((s) => s.length >= 1 && s.length <= 100);

// ── ipAddressArb ───────────────────────────────────────────────────────────
//
// Plain IPv4 strings. We don't need IPv6 here — the rate-limit key only sees
// the literal string from `extractClientIp`, which itself is opaque to the
// limiter. Using `fc.ipV4()` keeps the generator focused and fast.

export const ipAddressArb: fc.Arbitrary<string> = fc.ipV4();

// ── resumeStructuredArb ────────────────────────────────────────────────────
//
// All fields on `ResumeStructured` are optional, mirroring the reality that
// `user_profiles.resume_structured` may be entirely absent or partially
// populated. We wrap each field in `fc.option(_, { nil: undefined })` so the
// generator covers both "field present" and "field absent" cases.

const resumeExperienceArb = fc.record({
  company: nonEmptyString(40),
  role: nonEmptyString(40),
  duration: nonEmptyString(20),
  description: nonEmptyString(120),
});

const resumeProjectArb = fc.record({
  name: nonEmptyString(40),
  description: nonEmptyString(120),
  technologies: smallArray(nonEmptyString(20)),
});

const resumeEducationArb = fc.record({
  institution: nonEmptyString(40),
  degree: nonEmptyString(40),
  year: nonEmptyString(10),
});

export const resumeStructuredArb: fc.Arbitrary<ResumeStructured> = fc.record({
  name: fc.option(nonEmptyString(40), { nil: undefined }),
  title: fc.option(nonEmptyString(40), { nil: undefined }),
  summary: fc.option(nonEmptyString(160), { nil: undefined }),
  skills: fc.option(smallArray(nonEmptyString(20)), { nil: undefined }),
  experience: fc.option(smallArray(resumeExperienceArb), { nil: undefined }),
  projects: fc.option(smallArray(resumeProjectArb), { nil: undefined }),
  education: fc.option(smallArray(resumeEducationArb), { nil: undefined }),
  certifications: fc.option(smallArray(nonEmptyString(40)), { nil: undefined }),
});

// ── portfolioSiteConfigArb ─────────────────────────────────────────────────
//
// Produces values that satisfy `PortfolioSiteConfigSchema` from
// `src/lib/profile/portfolio-types.ts`. We mirror that schema field-for-field
// here. Where the schema accepts `.nullable()`, we choose `null` or a real
// value with `fc.option(_, { nil: null })`.

const richTextSegmentArb = fc.record({
  text: nonEmptyString(60),
  bold: fc.option(fc.boolean(), { nil: undefined }),
});

const socialEntryArb = fc.record({
  label: nonEmptyString(20),
  username: nonEmptyString(20),
  url: fc.webUrl(),
});

const identityArb = fc.record({
  name: nonEmptyString(40),
  firstName: nonEmptyString(20),
  title: nonEmptyString(40),
  tagline: nonEmptyString(40),
  bio: nonEmptyString(160),
  intros: smallArray(nonEmptyString(30)),
});

const contactArb = fc.record({
  email: fc.option(fc.emailAddress(), { nil: null }),
  url: fc.option(fc.webUrl(), { nil: null }),
  calUrl: fc.option(fc.webUrl(), { nil: null }),
  resumeUrl: fc.option(fc.webUrl(), { nil: null }),
});

const assetsArb = fc.record({
  ogImage: fc.webUrl(),
  blogOgImage: fc.webUrl(),
  favicon: nonEmptyString(40),
});

const socialsArb = fc.record({
  github: fc.option(socialEntryArb, { nil: null }),
  twitter: fc.option(socialEntryArb, { nil: null }),
  linkedin: fc.option(socialEntryArb, { nil: null }),
  leetcode: fc.option(socialEntryArb, { nil: null }),
  tryhackme: fc.option(socialEntryArb, { nil: null }),
  codeforces: fc.option(socialEntryArb, { nil: null }),
});

const seoArb = fc.record({
  titleTemplate: nonEmptyString(40),
  defaultTitle: nonEmptyString(40),
  defaultDescription: nonEmptyString(120),
  keywords: smallArray(nonEmptyString(20)),
  twitterHandle: fc.option(nonEmptyString(20), { nil: null }),
  locale: fc.constantFrom("en_US", "en_GB", "fr_FR", "de_DE", "ja_JP"),
  themeColor: fc.constantFrom("#0B0D0E", "#FFFFFF", "#000000", "#1E40AF"),
});

const navArb = fc.record({
  path: fc.constantFrom("/", "/about", "/work", "/projects", "/blog", "/contact"),
  name: nonEmptyString(20),
});

const portfolioExperienceArb = fc.record({
  role: nonEmptyString(40),
  year: nonEmptyString(20),
  company: nonEmptyString(40),
  type: fc.constantFrom("Full-Time", "Internship", "Contract", "Part-Time"),
  location: nonEmptyString(40),
  logo: fc.option(fc.webUrl(), { nil: null }),
  responsibility: fc.option(smallArray(smallArray(richTextSegmentArb, 3), 4), {
    nil: undefined,
  }),
  techstacks: fc.option(smallArray(nonEmptyString(20)), { nil: undefined }),
});

const portfolioProjectArb = fc.record({
  title: nonEmptyString(40),
  category: nonEmptyString(40),
  description: nonEmptyString(120),
  techstacks: smallArray(nonEmptyString(20)),
  status: fc.constantFrom("live", "building", "active", "archived"),
  link: fc.option(fc.webUrl(), { nil: null }),
  github: fc.option(
    fc
      .tuple(nonEmptyString(20), nonEmptyString(20))
      .map(([owner, repo]) => `${owner}/${repo}`),
    { nil: null }
  ),
  preview: fc.option(fc.webUrl(), { nil: null }),
  previewDark: fc.option(fc.webUrl(), { nil: undefined }),
});

const portfolioHackathonArb = fc.record({
  title: nonEmptyString(40),
  event: nonEmptyString(40),
  year: nonEmptyString(20),
  placement: fc.option(nonEmptyString(20), { nil: null }),
  college: fc.option(nonEmptyString(40), { nil: null }),
  body: smallArray(richTextSegmentArb, 4),
  techstacks: smallArray(nonEmptyString(20)),
  link: fc.option(fc.webUrl(), { nil: null }),
});

const portfolioResearchArb = fc.record({
  title: nonEmptyString(60),
  year: nonEmptyString(10),
  authors: fc.option(smallArray(nonEmptyString(30)), { nil: undefined }),
  venue: fc.option(nonEmptyString(40), { nil: undefined }),
  link: fc.option(fc.webUrl(), { nil: undefined }),
  description: fc.option(nonEmptyString(120), { nil: undefined }),
});

export const portfolioSiteConfigArb: fc.Arbitrary<PortfolioSiteConfig> = fc.record({
  identity: identityArb,
  contact: contactArb,
  assetsUrl: fc.webUrl(),
  avatarUrl: fc.option(fc.webUrl(), { nil: undefined }),
  assets: assetsArb,
  socials: socialsArb,
  seo: seoArb,
  nav: smallArray(navArb, 6),
  experiences: smallArray(portfolioExperienceArb, 4),
  projects: smallArray(portfolioProjectArb, 4),
  hackathons: smallArray(portfolioHackathonArb, 3),
  research: smallArray(portfolioResearchArb, 3),
});

// ── systemPromptInputArb ───────────────────────────────────────────────────
//
// Drives Property 1 (system prompt structural invariants) and Property 2
// (GitHub tools presence reflects token availability). The shape is a flat
// view of what the data assembler hands to `buildPortfolioChatSystemPrompt`.

const topProjectArb = fc.record({
  title: nonEmptyString(40),
  description: nonEmptyString(120),
  techstacks: smallArray(nonEmptyString(20)),
});

export const systemPromptInputArb: fc.Arbitrary<SystemPromptInput> = fc.record({
  candidateName: nonEmptyString(40),
  candidateTitle: nonEmptyString(40),
  candidateBio: nonEmptyString(160),
  skills: smallArray(nonEmptyString(20), 8),
  contactInfo: nonEmptyString(100),
  experienceSummary: nonEmptyString(200),
  educationSummary: nonEmptyString(200),
  certifications: smallArray(nonEmptyString(40), 5),
  topProjects: smallArray(topProjectArb, 5),
  // `formatGitHubMemoryPrompt` returns the empty string when memory is absent
  // and a non-empty `<github_*>`-tagged blob when present. We model both.
  githubMemoryPrompt: fc.oneof(
    fc.constant(""),
    fc.string({ minLength: 1, maxLength: 200 })
  ),
  hasGithubTools: fc.boolean(),
});

// ── messagesArb ────────────────────────────────────────────────────────────
//
// Produces arrays of length 1–20 of objects that pass
// `PortfolioChatMessageSchema`. Each message has a `parts` array containing
// at least one `{ type: "text", text }` part. We sometimes also include a
// legacy `content` string so the schema's union of optional fields is
// exercised. "Mixed text parts" means messages may have one or several text
// parts of varying lengths.

const textPartArb = fc.record({
  type: fc.constant("text" as const),
  text: nonEmptyString(120),
});

const messageArb = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom("user" as const, "assistant" as const),
  content: fc.option(nonEmptyString(120), { nil: undefined }),
  parts: fc.array(textPartArb, { minLength: 1, maxLength: 4 }),
});

export const messagesArb: fc.Arbitrary<
  Array<{
    id: string;
    role: "user" | "assistant";
    content?: string;
    parts?: Array<{ type: "text"; text: string }>;
  }>
> = fc.array(messageArb, { minLength: 1, maxLength: 20 });
