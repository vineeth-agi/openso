/**
 * Single source of truth for every legal fact rendered on the public
 * `/terms` and `/privacy` pages.
 *
 * Future updates touch this file only. All constants are exported
 * `as const` so TypeScript narrows their literal types and downstream
 * `.map()` callers get strict typing.

 */

// ────────────────────────────────────────────────────────────────────
// Operator and dates
// ────────────────────────────────────────────────────────────────────

export const EFFECTIVE_DATE = "May 27, 2026" as const;
export const LAST_UPDATED = "May 27, 2026" as const;

export const OPERATOR_NAME =
  "Openso, operated by Vineeth Kumar (solo developer, not incorporated)" as const;
export const OPERATOR_SHORT_NAME = "Openso" as const;
export const LEGAL_CONTACT_EMAIL = "support@openso.dev" as const;

export const GOVERNING_LAW = "India" as const;
export const GOVERNING_LAW_STATEMENT =
  "These Terms are governed by the laws of India. Any disputes arising out of or relating to the Service or these Terms are subject to the exclusive jurisdiction of the courts of India." as const;



// ────────────────────────────────────────────────────────────────────
// GitHub OAuth scopes
// ────────────────────────────────────────────────────────────────────

export type GitHubScope = {
  identifier: string;
  feature: string;
  justification: string;
};

export const GITHUB_SCOPES: readonly GitHubScope[] = [
  {
    identifier: "read:user",
    feature:
      "Reading the authenticated user's public profile to populate the developer narrative.",
    justification:
      "GitHub does not expose a narrower scope that returns the full public profile required for the recruiter chatbot.",
  },
  {
    identifier: "user:email",
    feature: "Reading the user's verified primary email for account creation.",
    justification:
      "user:email is the minimum scope GitHub provides for verified email retrieval.",
  },
  {
    identifier: "repo",
    feature:
      "Reading repository metadata and file contents for chat-with-repo and the GitHub memory graph.",
    justification:
      "Public-only scopes (public_repo) cannot index private repos the user explicitly opts in to. Pull-request creation on private repos requires the full repo scope.",
  },
  {
    identifier: "read:org",
    feature:
      "Listing organizations the user belongs to so they can scope ingestion to an org.",
    justification:
      "Organization membership is not exposed under user-only scopes.",
  },
] as const;

// ────────────────────────────────────────────────────────────────────
// Sub-processors (Requirement 12.2)
// ────────────────────────────────────────────────────────────────────

export type SubProcessor = {
  name: string;
  purpose: string;
  /** Categories of personal data shared with this sub-processor. */
  dataCategories: readonly string[];
  /** Country or region of primary processing. */
  region: string;
  privacyPolicyUrl: string;
};

export const SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    name: "xAI",
    purpose:
      "Hosting AI inference for chat, recruiter chatbot, developer profile synthesis, and structured extraction workloads.",
    dataCategories: [
      "Account identifiers",
      "Prompts and AI outputs",
    ],
    region: "United States",
    privacyPolicyUrl: "https://x.ai/privacy",
  },
  {
    name: "GitHub",
    purpose:
      "OAuth authentication; reading repository metadata and file contents.",
    dataCategories: [
      "Account identifiers",
      "Repository metadata and selected file contents",
    ],
    region: "United States",
    privacyPolicyUrl:
      "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
  },
  {
    name: "Insforge",
    purpose:
      "Primary application database, authentication session storage, and file storage.",
    dataCategories: [
      "Account identifiers",
      "Encrypted OAuth tokens",
      "Resume files and parsed text",
    ],
    region: "Provider-managed cloud regions",
    privacyPolicyUrl: "https://insforge.dev/privacy",
  },
  {
    name: "Daytona",
    purpose: "Sandboxed execution environments for the Repo Agent.",
    dataCategories: ["Repository contents during a sandbox run"],
    region: "Provider-managed cloud regions",
    privacyPolicyUrl: "https://www.daytona.io/privacy",
  },
  {
    name: "Upstash QStash",
    purpose:
      "Background workflow queue for ingestion, dream-cycle, and digest jobs.",
    dataCategories: [
      "Job payload identifiers",
      "User identifiers referenced by background jobs",
    ],
    region: "AWS regions selected per project",
    privacyPolicyUrl: "https://upstash.com/trust/privacy.pdf",
  },
  {
    name: "Telegram Bot API",
    purpose:
      "Sending and receiving messages with users who connect the Openso Telegram bot.",
    dataCategories: [
      "Telegram chat identifiers",
      "Message content sent to or from the bot",
    ],
    region: "Telegram's global infrastructure",
    privacyPolicyUrl: "https://telegram.org/privacy",
  },
] as const;

// ────────────────────────────────────────────────────────────────────
// Processing purposes and GDPR Article 6 legal bases (Requirement 11)
// ────────────────────────────────────────────────────────────────────

export type LegalBasis =
  | "consent"
  | "performance of a contract"
  | "legitimate interests"
  | "legal obligation"
  | "vital interests"
  | "public task";

export type ProcessingPurpose = {
  purpose: string;
  legalBasis: LegalBasis;
  /** Required when legalBasis === "legitimate interests". */
  legitimateInterest?: string;
};

export const PROCESSING_PURPOSES: readonly ProcessingPurpose[] = [
  {
    purpose: "Authenticating users via GitHub OAuth.",
    legalBasis: "performance of a contract",
  },
  {
    purpose:
      "Operating product features (chat, repo agent, recruiter chatbot).",
    legalBasis: "performance of a contract",
  },
  {
    purpose:
      "Sending product communications (account, security, digest emails).",
    legalBasis: "legitimate interests",
    legitimateInterest:
      "Keeping users informed about activity on their account and the workflows they have configured.",
  },
  {
    purpose: "Detecting and preventing abuse, spam, and unauthorized access.",
    legalBasis: "legitimate interests",
    legitimateInterest:
      "Protecting the integrity of the Service and the safety of other users.",
  },
  {
    purpose: "Complying with subpoenas, court orders, and legal requests.",
    legalBasis: "legal obligation",
  },
] as const;

// ────────────────────────────────────────────────────────────────────
// Data categories (Requirement 8.1) with CCPA mapping (Requirement 15.5)
//
// Each entry maps an internal category to its corresponding CCPA
// Civ. Code § 1798.140(o) category. The (A)–(K) labels correspond to
// the statutory subparagraphs. References:
//   (A) Identifiers (incl. email, account name, IP address, online
//       identifiers, persistent identifiers).
//   (F) Internet or other electronic network activity information.
//   (I) Professional or employment-related information.
//   (K) Inferences drawn from other personal information.
// ────────────────────────────────────────────────────────────────────

export type DataCategory = {
  /** Internal short identifier used in the table header. */
  id: string;
  label: string;
  description: string;
  /** How the category is collected. */
  source: "provided directly" | "third-party (with consent)" | "automatic";
  /** Corresponding CCPA Civ. Code § 1798.140 category, e.g. "(A) Identifiers". */
  ccpaCategory: string;
};

export const DATA_CATEGORIES: readonly DataCategory[] = [
  {
    id: "account-identifiers",
    label: "Account identifiers",
    description:
      "Email address, display name, profile image URL, and provider user id retrieved from your GitHub OAuth profile when you sign in.",
    source: "third-party (with consent)",
    ccpaCategory: "(A) Identifiers",
  },
  {
    id: "resume-files",
    label: "Resume files and parsed text",
    description:
      "Resume files you upload in PDF, DOCX, or TXT format, and the structured text extracted from those files for the developer narrative and recruiter chatbot.",
    source: "provided directly",
    ccpaCategory: "(I) Professional or employment-related information",
  },
  {
    id: "github-repo-data",
    label: "GitHub repository metadata and file contents",
    description:
      "Repository names, branches, commit metadata, and selected file contents from repositories you authorize for chat-with-repo and the GitHub memory graph.",
    source: "third-party (with consent)",
    ccpaCategory:
      "(F) Internet or other electronic network activity information",
  },

  {
    id: "telegram-data",
    label: "Telegram chat identifiers and messages",
    description:
      "The Telegram chat id you connect to Openso and the messages you exchange with the Openso Telegram bot.",
    source: "provided directly",
    ccpaCategory: "(A) Identifiers",
  },
  {
    id: "recruiter-chatbot-transcripts",
    label: "Recruiter chatbot transcripts",
    description:
      "The conversations recruiters have with your portfolio chatbot, including their questions and the chatbot's responses about you.",
    source: "provided directly",
    ccpaCategory:
      "(F) Internet or other electronic network activity information",
  },

  {
    id: "ai-prompts-and-outputs",
    label: "AI prompts and outputs",
    description:
      "The prompts you send to AI features and the outputs those features generate, including pull-request descriptions, summaries, and chat replies.",
    source: "provided directly",
    ccpaCategory: "(K) Inferences drawn from other personal information",
  },
  {
    id: "server-logs",
    label: "Server logs",
    description:
      "Standard request logs collected automatically when you interact with Openso, including IP address, user agent, request path, and timestamps.",
    source: "automatic",
    ccpaCategory:
      "(F) Internet or other electronic network activity information",
  },
] as const;
