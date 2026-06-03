import type { Metadata } from "next";

import { LegalPage } from "@/components/legal";
import { getAppUrlOrLocalhost } from "@/lib/app-url";
import {
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
  PRIVACY_TITLE,
} from "@/lib/legal/privacy-content";

export const metadata: Metadata = {
  title: "Privacy Policy · Openso",
  description:
    "How Openso collects, uses, and protects your data, including OAuth scope justifications, sub-processors, GDPR and CCPA rights, and the Google API Limited Use disclosure.",
  alternates: { canonical: `${getAppUrlOrLocalhost()}/privacy` },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title={PRIVACY_TITLE}
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
    />
  );
}
