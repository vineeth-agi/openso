import {
  LEGAL_CONTACT_EMAIL,
  LIMITED_USE_DISCLOSURE,
  LIMITED_USE_POLICY_URL,
} from "./constants";

import { CcpaCategoryTable } from "@/components/legal/ccpa-category-table";
import type { LegalSectionNode } from "@/components/legal/legal-page";
import { OAuthScopeList } from "@/components/legal/oauth-scope-list";
import { ProcessingPurposeTable } from "@/components/legal/processing-purpose-table";
import { SubProcessorTable } from "@/components/legal/sub-processor-table";


export const PRIVACY_TITLE = "Privacy Policy";

export const PRIVACY_INTRO =
  "This Privacy Policy explains how Openso collects, uses, shares, and protects your personal data when you use our Service.";

export const PRIVACY_SECTIONS: LegalSectionNode[] = [
  {
    id: "information-we-collect",
    heading: "Information We Collect",
    body: (
      <>
        <p>We collect the following categories of personal data:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account identifiers</strong> — Email address, display name,
            profile image URL, and provider user id retrieved from your Google or
            GitHub OAuth profile when you sign in.{" "}
            <em className="text-muted-foreground">
              (Third-party, with consent)
            </em>
          </li>
          <li>
            <strong>Resume files and parsed text</strong> — Resume files you
            upload in PDF, DOCX, or TXT format, and the structured text extracted
            from those files.{" "}
            <em className="text-muted-foreground">(Provided directly)</em>
          </li>
          <li>
            <strong>GitHub repository metadata and file contents</strong> —
            Repository names, branches, commit metadata, and selected file
            contents from repositories you authorize for chat-with-repo and the
            GitHub memory graph.{" "}
            <em className="text-muted-foreground">
              (Third-party, with consent)
            </em>
          </li>
          <li>
            <strong>Gmail message metadata and content</strong> — Headers,
            snippets, labels, and message bodies accessed under user-granted
            Gmail Restricted Scope tokens, used solely to generate the requested
            summaries.{" "}
            <em className="text-muted-foreground">
              (Third-party, with consent)
            </em>
          </li>
          <li>
            <strong>Telegram chat identifiers and messages</strong> — The
            Telegram chat id you connect to Openso and the messages you exchange
            with the Openso Telegram bot.{" "}
            <em className="text-muted-foreground">(Provided directly)</em>
          </li>
          <li>
            <strong>Recruiter chatbot transcripts</strong> — The conversations
            recruiters have with your portfolio chatbot, including their questions
            and the chatbot&apos;s responses about you.{" "}
            <em className="text-muted-foreground">(Provided directly)</em>
          </li>
          <li>
            <strong>Job application activity</strong> — Job listings you save or
            apply to, application status notes, and the aggregated job board
            sources you have configured.{" "}
            <em className="text-muted-foreground">(Provided directly)</em>
          </li>
          <li>
            <strong>AI prompts and outputs</strong> — The prompts you send to AI
            features and the outputs those features generate, including
            pull-request descriptions, summaries, and chat replies.{" "}
            <em className="text-muted-foreground">(Provided directly)</em>
          </li>
          <li>
            <strong>Server logs</strong> — Standard request logs collected
            automatically when you interact with Openso, including IP address,
            user agent, request path, and timestamps.{" "}
            <em className="text-muted-foreground">(Automatic)</em>
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "oauth-scopes",
    heading: "OAuth Scopes and Why We Need Them",
    body: (
      <p>
        Openso requests only the OAuth scopes necessary to deliver the features
        you use. You may revoke any granted OAuth scope at any time through the
        respective provider&apos;s account security settings and via the Openso
        connected-apps page.
      </p>
    ),
    subsections: [
      {
        id: "google-oauth-scopes",
        heading: "Google OAuth Scopes",
        body: (
          <>
            <p>
              The following Google OAuth scopes are requested. Scopes marked
              &ldquo;Restricted&rdquo; are subject to the{" "}
              <a
                href={LIMITED_USE_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Google API Services User Data Policy
              </a>
              .
            </p>
            <OAuthScopeList provider="google" />
          </>
        ),
      },
      {
        id: "github-oauth-scopes",
        heading: "GitHub OAuth Scopes",
        body: (
          <>
            <p>
              The following GitHub OAuth scopes are requested for repository
              access, issue access, and pull request creation:
            </p>
            <OAuthScopeList provider="github" />
          </>
        ),
      },
    ],
  },
  {
    id: "limited-use",
    heading: "Google API Services User Data Policy — Limited Use",
    body: (
      <>
        <p>{LIMITED_USE_DISCLOSURE}</p>
        <p>
          For more information, see the{" "}
          <a
            href={LIMITED_USE_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Google API Services User Data Policy
          </a>
          .
        </p>
        <p>Specifically, Openso:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Does not transfer Gmail data to third parties except as necessary to
            provide the user-facing summarization feature, with prior user
            consent, to comply with applicable law, or as part of a merger or
            acquisition where the acquirer is bound to the same Limited Use
            terms.
          </li>
          <li>Does not use Gmail data for serving advertisements.</li>
          <li>
            Does not allow humans to read Gmail data except with the user&apos;s
            affirmative consent for specific messages, when necessary for
            security purposes such as investigating abuse, to comply with
            applicable law, or for Openso&apos;s internal operations where the
            data has been aggregated and anonymized.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "how-we-use-your-information",
    heading: "How We Use Your Information",
    body: (
      <>
        <p>
          We process your personal data for the purposes listed below. For each
          purpose, we identify the GDPR Article 6 legal basis. Where we rely on
          legitimate interests, we describe the specific interest.
        </p>
        <ProcessingPurposeTable />
        <p className="text-sm text-muted-foreground">
          Where Openso processes data under Restricted Scopes (Gmail), the legal
          basis is the user&apos;s explicit consent granted at OAuth time.
        </p>
      </>
    ),
  },
  {
    id: "sub-processors",
    heading: "Sub-Processors",
    body: (
      <>
        <p>
          Openso shares personal data with the following sub-processors to
          deliver the Service. Each entry lists the processing purpose,
          categories of data shared, primary processing region, and a link to the
          sub-processor&apos;s privacy policy.
        </p>
        <SubProcessorTable />
        <p className="text-sm text-muted-foreground">
          The Operator may add or change sub-processors. Material changes will be
          reflected by updating this Privacy Policy and revising the Effective
          Date.
        </p>
      </>
    ),
  },
  {
    id: "data-retention",
    heading: "Data Retention",
    body: (
      <>
        <p>We retain your data according to the following criteria:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Account identifiers</strong> — Retained for the lifetime of
            your account. Deleted when you delete your account.
          </li>
          <li>
            <strong>Resume files</strong> — Retained until you delete the resume
            or delete your account.
          </li>
          <li>
            <strong>GitHub repository data</strong> — Retained while the
            repository connection is active. Removed when you disconnect the
            repository or delete your account.
          </li>
          <li>
            <strong>Gmail message content</strong> — Processed for summarization
            and not stored beyond the time required to generate and deliver the
            summary, except for derived summaries that you explicitly save.
          </li>
          <li>
            <strong>Telegram data</strong> — Retained while the Telegram bot
            connection is active. Removed when you disconnect or delete your
            account.
          </li>
          <li>
            <strong>Recruiter chatbot transcripts</strong> — Retained for the
            lifetime of your account.
          </li>
          <li>
            <strong>Job application activity</strong> — Retained for the lifetime
            of your account.
          </li>
          <li>
            <strong>AI prompts and outputs</strong> — Retained for the lifetime
            of your account unless you delete individual conversations.
          </li>
          <li>
            <strong>Server logs</strong> — Retained for up to 90 days for
            security and debugging purposes, then automatically purged.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "how-to-delete-your-data",
    heading: "How to Delete Your Data",
    body: (
      <>
        <p>
          You can delete your account and all associated data through the
          in-product account settings page. Alternatively, you may submit a
          deletion request by emailing{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="underline hover:text-foreground"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          When we receive a deletion request via email, we will respond within 30
          days and complete the deletion promptly thereafter.
        </p>
      </>
    ),
  },
  {
    id: "your-rights-under-gdpr",
    heading: "Your Rights Under GDPR",
    body: (
      <>
        <p>
          If you are located in the European Economic Area or the United Kingdom,
          you have the following rights under the General Data Protection
          Regulation:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Right of access</strong> — You may request a copy of the
            personal data we hold about you.
          </li>
          <li>
            <strong>Right to rectification</strong> — You may request correction
            of inaccurate or incomplete personal data.
          </li>
          <li>
            <strong>Right to erasure (right to be forgotten)</strong> — You may
            request deletion of your personal data.
          </li>
          <li>
            <strong>Right to restriction of processing</strong> — You may request
            that we limit how we use your data.
          </li>
          <li>
            <strong>Right to data portability</strong> — You may request your
            data in a structured, commonly used, machine-readable format.
          </li>
          <li>
            <strong>Right to object</strong> — You may object to processing based
            on legitimate interests.
          </li>
          <li>
            <strong>Right to withdraw consent</strong> — Where processing is
            based on consent, you may withdraw it at any time.
          </li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="underline hover:text-foreground"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          . We will respond within the timeframe required by GDPR Article 12
          (generally within one month).
        </p>
        <p>
          You also have the right to lodge a complaint with your national
          supervisory authority if you believe your data protection rights have
          been violated.
        </p>
      </>
    ),
  },
  {
    id: "international-data-transfers",
    heading: "International Data Transfers",
    body: (
      <p>
        Your data may be transferred outside your jurisdiction to sub-processors
        listed above. The Operator relies on standard contractual clauses or
        equivalent safeguards offered by those sub-processors to ensure an
        adequate level of data protection for international transfers.
      </p>
    ),
  },
  {
    id: "your-rights-under-ccpa-and-cpra",
    heading: "Your Rights Under CCPA and CPRA",
    body: (
      <>
        <p>
          If you are a California consumer, you have the following rights under
          the California Consumer Privacy Act and the California Privacy Rights
          Act:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Right to know</strong> — You may request disclosure of the
            categories and specific pieces of personal information we have
            collected about you.
          </li>
          <li>
            <strong>Right to delete</strong> — You may request deletion of your
            personal information.
          </li>
          <li>
            <strong>Right to correct</strong> — You may request correction of
            inaccurate personal information.
          </li>
          <li>
            <strong>Right to opt out of sale or sharing</strong> — You may opt
            out of the sale or sharing of your personal information.
          </li>
          <li>
            <strong>Right to limit use of sensitive personal information</strong>{" "}
            — You may limit the use and disclosure of sensitive personal
            information.
          </li>
          <li>
            <strong>Right to non-discrimination</strong> — You will not be
            discriminated against for exercising any of these rights.
          </li>
        </ul>
        <p>
          California consumers may submit verifiable requests via{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="underline hover:text-foreground"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          . We will verify your identity by matching the email address on your
          request with the email address associated with your Openso account.
        </p>
      </>
    ),
    subsections: [
      {
        id: "do-not-sell-or-share",
        heading: "Do Not Sell or Share My Personal Information",
        body: (
          <p>
            Openso does not sell or share personal information as those terms are
            defined under the CCPA and CPRA. Because we do not sell or share your
            personal information, no opt-out mechanism is required.
          </p>
        ),
      },
    ],
  },
  {
    id: "categories-of-personal-information-collected-ccpa",
    heading: "Categories of Personal Information Collected (CCPA)",
    body: (
      <>
        <p>
          The following table maps each category of personal data we collect to
          the corresponding CCPA category enumerated in California Civil Code
          § 1798.140:
        </p>
        <CcpaCategoryTable />
      </>
    ),
  },
  {
    id: "cookies-and-similar-technologies",
    heading: "Cookies and Similar Technologies",
    body: (
      <>
        <p>Openso uses the following categories of cookies:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Strictly necessary cookies</strong> — Authentication session
            cookies required to keep you signed in and to protect against
            cross-site request forgery. These cannot be disabled.
          </li>
        </ul>
        <p>
          Openso does not use analytics cookies, advertising cookies, or
          third-party tracking pixels.
        </p>
      </>
    ),
  },
  {
    id: "childrens-privacy",
    heading: "Children&apos;s Privacy",
    body: (
      <>
        <p>
          The Service is not directed to children under 16. We do not knowingly
          collect personal information from children under 16. If we become aware
          that personal information has been collected from a child under 16
          without verifiable parental consent, we will delete that information
          promptly upon discovery or notification.
        </p>
        <p>
          If you believe a child under 16 has provided us with personal
          information, please contact us at{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="underline hover:text-foreground"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "security",
    heading: "Security",
    body: (
      <>
        <p>
          We implement technical and organizational measures to protect your
          personal data, including:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Transport encryption (HTTPS) for all data in transit</li>
          <li>Encrypted storage of OAuth tokens at rest</li>
          <li>
            Scoped database access with row-level security policies
          </li>
          <li>Use of audited sub-processors with their own security programs</li>
        </ul>
        <p>
          No internet transmission or storage system is fully secure. While we
          strive to protect your data, we cannot guarantee absolute security.
          There is always a residual risk that unauthorized parties may intercept
          data or breach our systems despite our safeguards.
        </p>
        <p>
          If a personal data breach affecting data subjects occurs, we will
          notify affected users via email and update this Privacy Policy within
          the timeframes required by applicable law.
        </p>
      </>
    ),
  },
  {
    id: "contact-us",
    heading: "Contact Us",
    body: (
      <>
        <p>
          For all privacy matters, data subject rights requests, Limited Use
          enforcement reports, and legal inquiries, contact us at:
        </p>
        <p>
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="underline hover:text-foreground"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
        <p className="text-sm text-muted-foreground">
          The Operator is reachable at this email address for all privacy and
          legal matters.
        </p>
      </>
    ),
  },
];
