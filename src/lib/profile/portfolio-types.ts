/**
 * PortfolioSiteConfig — mirrors the exact shape of
 * src/portfolio-src/site.config.ts so that DB-generated configs
 * are drop-in compatible with the portfolio components.
 *
 * Nullable fields are fields AI may not be able to infer
 * from resume + GitHub alone.
 */

import { z } from "zod";

// ── Shared primitives ──────────────────────────────────────────────────────

export const RichTextSegmentSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
});

export const SocialEntrySchema = z.object({
  label: z.string(),
  username: z.string(),
  url: z.string(),
});

// ── Sub-schemas ────────────────────────────────────────────────────────────

export const PortfolioIdentitySchema = z.object({
  name: z.string().describe("Full name from resume"),
  firstName: z.string().describe("First name only"),
  title: z.string().describe("Job title / role e.g. 'Full Stack Engineer'"),
  tagline: z.string().describe("Short tagline e.g. 'MS CS @ MIT' or 'Building at Scale'"),
  bio: z.string().describe("2-3 sentence professional bio"),
  intros: z.array(z.string()).describe("Rotating intro labels e.g. ['Software Engineer', 'Open Source Contributor']"),
});

export const PortfolioContactSchema = z.object({
  email: z.string().nullable().describe("Email from resume, null if not found"),
  url: z.string().nullable().describe("Personal website URL, null if not found"),
  calUrl: z.string().nullable().describe("Cal.com or Calendly URL, null if not found"),
  resumeUrl: z.string().nullable().describe("Direct URL to resume PDF, null if not available"),
});

export const PortfolioAssetsSchema = z.object({
  ogImage: z.string().describe("OG image URL"),
  blogOgImage: z.string().describe("Blog OG image URL"),
  favicon: z.string().describe("Favicon path"),
});

export const PortfolioSocialsSchema = z.object({
  github: SocialEntrySchema.nullable().describe("GitHub profile, extracted from OAuth token"),
  twitter: SocialEntrySchema.nullable().describe("Twitter/X profile, null if not found"),
  linkedin: SocialEntrySchema.nullable().describe("LinkedIn profile from resume URL, null if not found"),
  leetcode: SocialEntrySchema.nullable().describe("LeetCode profile, null if not found"),
  tryhackme: SocialEntrySchema.nullable().describe("TryHackMe profile, null if not found"),
  codeforces: SocialEntrySchema.nullable().describe("Codeforces profile, null if not found"),
});

export const PortfolioExperienceSchema = z.object({
  role: z.string(),
  year: z.string().describe("Date range e.g. 'Jan 2023 - Jun 2023'"),
  company: z.string(),
  type: z.string().describe("e.g. 'Full-Time', 'Internship', 'Contract'"),
  location: z.string().describe("e.g. 'San Francisco, Remote'"),
  logo: z.string().nullable().optional().describe("Company logo URL, null if unavailable"),
  responsibility: z.array(
    z.array(RichTextSegmentSchema)
  ).optional().describe("Rich text bullet points. Each bullet is an array of segments."),
  techstacks: z.array(z.string()).optional(),
  _customSection: z.string().optional().describe("Internal: marks item as belonging to a custom section"),
}).passthrough();

export const PortfolioProjectSchema = z.object({
  title: z.string(),
  category: z.string().describe("e.g. 'SaaS · Storage' or 'Open Source · npm'"),
  description: z.string(),
  techstacks: z.array(z.string()),
  status: z.enum(["live", "building", "active", "archived"]).describe("Current project status"),
  link: z.string().nullable().describe("Live project URL, null if not available"),
  github: z.string().nullable().describe("GitHub repo slug e.g. 'owner/repo', null if private"),
  preview: z.string().nullable().describe("Preview image URL, null if not available"),
  previewDark: z.string().nullable().optional().describe("Dark mode preview image URL"),
});

export const PortfolioHackathonSchema = z.object({
  title: z.string().describe("Project/product name built at hackathon"),
  event: z.string().describe("Hackathon event name"),
  year: z.string().describe("e.g. 'Apr 2026'"),
  placement: z.string().nullable().describe("e.g. '1st Place', 'Finalist', null if not placed"),
  college: z.string().nullable().describe("Hosting institution, null if not available"),
  body: z.array(RichTextSegmentSchema).describe("Rich text description of what was built"),
  techstacks: z.array(z.string()),
  link: z.string().nullable().describe("Devpost or demo link, null if not available"),
});

export const PortfolioResearchSchema = z.object({
  title: z.string(),
  year: z.string(),
  authors: z.array(z.string()).optional(),
  venue: z.string().optional().describe("Conference or journal"),
  link: z.string().optional(),
  description: z.string().optional(),
});

export const PortfolioSEOSchema = z.object({
  titleTemplate: z.string().describe("e.g. '%s | John Doe'"),
  defaultTitle: z.string(),
  defaultDescription: z.string(),
  keywords: z.array(z.string()),
  twitterHandle: z.string().nullable(),
  locale: z.string().default("en_US"),
  themeColor: z.string().default("#0B0D0E"),
});

export const PortfolioNavSchema = z.object({
  path: z.string(),
  name: z.string(),
});

// ── Root schema ────────────────────────────────────────────────────────────

export const PortfolioSiteConfigSchema = z.object({
  identity: PortfolioIdentitySchema,
  contact: PortfolioContactSchema,
  assetsUrl: z.string().describe("Base CDN URL for assets"),
  avatarUrl: z.string().nullable().optional().describe("Uploaded avatar image URL, takes priority over assetsUrl/GitHub avatar"),
  assets: PortfolioAssetsSchema,
  socials: PortfolioSocialsSchema,
  seo: PortfolioSEOSchema,
  nav: z.array(PortfolioNavSchema),
  experiences: z.array(PortfolioExperienceSchema),
  projects: z.array(PortfolioProjectSchema),
  hackathons: z.array(PortfolioHackathonSchema),
  research: z.array(PortfolioResearchSchema),
});

export type PortfolioSiteConfig = z.infer<typeof PortfolioSiteConfigSchema>;

// ── Type for DB row ────────────────────────────────────────────────────────

export interface UserPortfolioRow {
  id: string;
  user_id: string;
  username: string | null;
  site_config: PortfolioSiteConfig;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  tech_stack: string[] | null;
  years_experience: number | null;
  config_generated_at: string | null;
  config_source: "ai" | "manual";
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
