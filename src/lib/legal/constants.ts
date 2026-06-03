/**
 * Single source of truth for every legal fact rendered on the public
 * `/terms` and `/privacy` pages.
 *
 * Future updates touch this file only. All constants are exported
 * `as const` so TypeScript narrows their literal types and downstream
 * `.map()` callers get strict typing.
 *
 * NOTE: `LIMITED_USE_DISCLOSURE` is load-bearing for Google OAuth
 * verification — Google reviewers grep for this exact string. Do NOT
 * paraphrase it.
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
// Google API Services User Data Policy — Limited Use
// ────────────────────────────────────────────────────────────────────

/**
 * Verbatim Google API Services User Data Policy "Limited Use"
 * disclosure. Google verification reviewers search for this exact
 * sentence; do NOT edit it.
 */
export const LIMITED_USE_DISCLOSURE =
  "Openso's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements." as const;

export const LIMITED_USE_POLICY_URL =
  "https://developers.google.com/terms/api-services-user-data-policy" as const;

// ────────────────────────────────────────────────────────────────────
// Google OAuth scopes
// ────────────────────────────────────────────────────────────────────

export type GoogleScope = {
  /** Full scope URL as Google verification reviewers paste it. */
  identifier: string;
  /** Short label for table headers and TOC. */
  label: string;
  /** User-facing feature that requires this scope. */
  feature: string;
  /** Why a narrower scope is insufficient. */
  justification: string;
  /** True for Restricted Scopes under the Google API Services User Data Policy. */
  restricted: boolean;
};

export const GOOGLE_SCOPES: readonly GoogleScope[] = [
  {
    identifier: "https://www.googleapis.com/auth/gmail.readonly",
    label: "gmail.readonly",
    feature:
      "Gmail summarization in the dashboard and the daily-digest workflow.",
    justification:
      "Summarization requires reading message bodies and headers across the user's inbox; metadata-only scopes do not expose message content.",
    restricted: true,
  },
  {
    identifier: "https://www.googleapis.com/auth/gmail.send",
    label: "gmail.send",
    feature:
      "Optional reply drafts that the user explicitly chooses to send from Openso.",
    justification:
      "Sending a drafted reply on the user's behalf cannot be performed under gmail.compose because that scope only creates drafts; sending requires gmail.send.",
    restricted: true,
  },
  {
    identifier: "https://www.googleapis.com/auth/gmail.modify",
    label: "gmail.modify",
    feature:
      "Marking summarized threads as read and applying user-chosen labels.",
    justification:
      "Modifying labels and read state on existing threads is not permitted under gmail.readonly; gmail.metadata cannot mutate state.",
    restricted: true,
  },
  {
    identifier: "https://www.googleapis.com/auth/userinfo.email",
    label: "userinfo.email",
    feature:
      "Identifying the authenticated user by email for account creation and lookup.",
    justification:
      "OpenID Connect requires this scope to populate the email claim used as the primary account identifier.",
    restricted: false,
  },
  {
    identifier: "https://www.googleapis.com/auth/userinfo.profile",
    label: "userinfo.profile",
    feature: "Displaying the user's name and avatar in the Openso UI.",
    justification:
      "Profile name and picture claims are only available under userinfo.profile; there is no narrower alternative.",
    restricted: false,
  },
] as const;

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
    name: "Pioneer AI",
    purpose:
      "Hosting AI inference for chat, recruiter chatbot, summarization, and structured extraction workloads.",
    dataCategories: [
      "Account identifiers",
      "Prompts and AI outputs",
      "Gmail message metadata and content (for summarization only)",
    ],
    region: "United States",
    privacyPolicyUrl: "https://pioneer.ai/privacy",
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
      "Job application activity",
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
    purpose: "Authenticating users via Google or GitHub OAuth.",
    legalBasis: "performance of a contract",
  },
  {
    purpose:
      "Operating product features (chat, repo agent, recruiter chatbot, job feed).",
    legalBasis: "performance of a contract",
  },
  {
    purpose:
      "Generating AI outputs from Gmail content, repository content, and resumes under Restricted Scopes.",
    legalBasis: "consent",
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
      "Email address, display name, profile image URL, and provider user id retrieved from your Google or GitHub OAuth profile when you sign in.",
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
    id: "gmail-data",
    label: "Gmail message metadata and content",
    description:
      "Headers, snippets, labels, and message bodies accessed under user-granted Gmail Restricted Scope tokens, used solely to generate the requested summaries.",
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
    id: "job-application-activity",
    label: "Job application activity",
    description:
      "Job listings you save or apply to, application status notes, and the aggregated job board sources you have configured.",
    source: "provided directly",
    ccpaCategory: "(I) Professional or employment-related information",
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
