import { LegalArticle } from "./legal-article";
import { LegalHero } from "./legal-hero";

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";


export type LegalSectionNode = {
  id: string;
  heading: string;
  body: React.ReactNode;
  subsections?: ReadonlyArray<{
    id: string;
    heading: string;
    body: React.ReactNode;
  }>;
};

type LegalPageProps = {
  title: string;
  intro: string;
  sections: LegalSectionNode[];
};

export function LegalPage({ title, intro, sections }: LegalPageProps) {
  return (
    <main>
      <Header />
      <LegalHero title={title} intro={intro} />
      <LegalArticle sections={sections} />
      <Footer />
    </main>
  );
}
