import {
  GOVERNING_LAW_STATEMENT,
  LEGAL_CONTACT_EMAIL,
  OPERATOR_NAME,
} from "./constants";

import type { LegalSectionNode } from "@/components/legal/legal-page";


export const TERMS_TITLE = "Terms of Service";

export const TERMS_INTRO =
  "Please read these Terms of Service carefully before using Openso. By accessing or using the Service, you agree to be bound by these terms.";

export const TERMS_SECTIONS: LegalSectionNode[] = [
  {
    id: "acceptance-of-terms",
    heading: "Acceptance of Terms",
    body: (
      <p>
        By creating an account, authorizing OAuth access, or otherwise using
        Openso (the &ldquo;Service&rdquo;), you agree to be bound by these Terms
        of Service and our{" "}
        <a href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </a>
        . If you do not agree to these terms, do not use the Service. Your
        continued use of the Service after any changes to these Terms constitutes
        acceptance of the revised terms.
      </p>
    ),
  },
  {
    id: "description-of-the-service",
    heading: "Description of the Service",
    body: (
      <>
        <p>
          Openso is an AI-powered developer platform that provides the following
          features:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Open-source issue finder with an auto-fix pull request agent running
            in Daytona sandboxes
          </li>
          <li>
            Resume-and-GitHub portfolio with a recruiter chatbot
          </li>

          <li>GitHub memory graph and repository insights</li>
          <li>Chat with any GitHub repository</li>
          <li>Telegram bot integration</li>
          <li>Resume upload supporting PDF, DOCX, and TXT files</li>
        </ul>
      </>
    ),
  },
  {
    id: "eligibility",
    heading: "Eligibility",
    body: (
      <p>
        You must be at least 16 years old and capable of forming a binding
        contract under Indian law to use the Service. By using Openso, you
        represent and warrant that you meet these eligibility requirements.
      </p>
    ),
  },
  {
    id: "user-accounts",
    heading: "User Accounts",
    body: (
      <p>
        Accounts are created via GitHub OAuth. You are responsible for
        maintaining the security of your authentication providers and for all
        activity that occurs under your account. You must notify us immediately
        at{" "}
        <a
          href={`mailto:${LEGAL_CONTACT_EMAIL}`}
          className="underline hover:text-foreground"
        >
          {LEGAL_CONTACT_EMAIL}
        </a>{" "}
        if you become aware of any unauthorized use of your account.
      </p>
    ),
  },
  {
    id: "acceptable-use",
    heading: "Acceptable Use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Reverse engineer, decompile, or disassemble any part of the Service
          </li>
          <li>
            Abuse rate limits or attempt to overload the Service infrastructure
          </li>
          <li>Submit illegal, harmful, or offensive content</li>
          <li>Use the Service to send spam or unsolicited messages</li>

          <li>
            Use the Service to impersonate others or misrepresent your identity
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "user-content-and-license",
    heading: "User Content and License",
    body: (
      <p>
        You retain ownership of your resumes, repository content, prompts, and
        other submissions (&ldquo;User Content&rdquo;). By submitting User
        Content to the Service, you grant Openso a limited, revocable,
        non-exclusive, royalty-free license to process that content solely to
        deliver the Service. We do not claim ownership of your User Content and
        will not use it for purposes unrelated to providing the Service.
      </p>
    ),
  },
  {
    id: "ai-generated-output",
    heading: "AI-Generated Output",
    body: (
      <p>
        Pull requests, summaries, recruiter chatbot replies, and other AI outputs
        are produced by third-party large language models. These outputs may
        contain errors, inaccuracies, or inappropriate content. You must review
        all AI-generated output before relying upon it, merging it into your
        codebase, or sharing it with others. Openso is not responsible for any
        consequences arising from unreviewed AI output.
      </p>
    ),
  },
  {
    id: "third-party-services",
    heading: "Third-Party Services",
    body: (
      <p>
        Use of Openso involves the sub-processors enumerated in our{" "}
        <a href="/privacy#sub-processors" className="underline hover:text-foreground">
          Privacy Policy
        </a>
        . Those services have their own terms of service which apply in addition
        to these Terms. Openso is not responsible for the practices or policies
        of third-party services.
      </p>
    ),
  },
  {
    id: "open-source",
    heading: "Open Source",
    body: (
      <p>
        Portions of Openso are open source. Any applicable open-source license
        terms govern the corresponding code in addition to these Terms. In the
        event of a conflict between an open-source license and these Terms, the
        open-source license prevails for the covered code.
      </p>
    ),
  },
  {
    id: "termination",
    heading: "Termination",
    body: (
      <p>
        The Operator may suspend or terminate accounts that violate these Terms
        at any time without prior notice. You may delete your account at any time
        by emailing{" "}
        <a
          href={`mailto:${LEGAL_CONTACT_EMAIL}`}
          className="underline hover:text-foreground"
        >
          {LEGAL_CONTACT_EMAIL}
        </a>
        . Upon termination, your right to use the Service ceases immediately, and
        we will delete your data in accordance with our Privacy Policy.
      </p>
    ),
  },
  {
    id: "disclaimer-of-warranties",
    heading: "Disclaimer of Warranties",
    body: (
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo; without warranties of any kind, whether express or
        implied, including but not limited to implied warranties of
        merchantability, fitness for a particular purpose, and non-infringement,
        to the maximum extent permitted by Indian law.
      </p>
    ),
  },
  {
    id: "limitation-of-liability",
    heading: "Limitation of Liability",
    body: (
      <p>
        To the maximum extent permitted by Indian law, the Operator&apos;s
        aggregate liability for any claims arising out of or relating to the
        Service or these Terms is limited to the greater of the amount paid by
        you to Openso in the prior twelve (12) months or ₹100 (one hundred
        Indian rupees). In no event shall the Operator be liable for any
        indirect, incidental, special, consequential, or punitive damages.
      </p>
    ),
  },
  {
    id: "governing-law-and-jurisdiction",
    heading: "Governing Law and Jurisdiction",
    body: (
      <>
        <p>
          The Operator of this Service is {OPERATOR_NAME}.
        </p>
        <p>{GOVERNING_LAW_STATEMENT}</p>
        <p>
          For legal notices and inquiries, contact us at{" "}
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
    id: "changes-to-these-terms",
    heading: "Changes to These Terms",
    body: (
      <p>
        The Operator may update these Terms of Service at any time. When material
        changes are made, the Effective Date at the top of this page will be
        revised. Your continued use of the Service after the revised Effective
        Date constitutes acceptance of the updated Terms. We encourage you to
        review this page periodically.
      </p>
    ),
  },
];
