import type { Metadata } from "next";

import { LegalPage } from "@/components/legal";
import { getAppUrlOrLocalhost } from "@/lib/app-url";
import {
  TERMS_INTRO,
  TERMS_SECTIONS,
  TERMS_TITLE,
} from "@/lib/legal/terms-content";

export const metadata: Metadata = {
  title: "Terms of Service · Openso",
  description:
    "The legal agreement between Openso and users of the open-source issue finder, AI portfolio, repo chat, and Gmail summarization service.",
  alternates: { canonical: `${getAppUrlOrLocalhost()}/terms` },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage
      title={TERMS_TITLE}
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
    />
  );
}
