
import type { LegalSectionNode } from "./legal-page";
import { LegalSection } from "./legal-section";
import { LegalTOC } from "./legal-toc";

import { cn } from "@/lib/utils";

export function LegalArticle({ sections }: { sections: LegalSectionNode[] }) {
  return (
    <article
      className={cn(
        "mx-auto w-full max-w-5xl px-4 pb-24 md:px-0",
        "scroll-smooth",
        "fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards delay-300 duration-500 ease-out",
      )}
    >
      <LegalTOC sections={sections} />
      <div className="mt-12 space-y-12">
        {sections.map((s) => (
          <LegalSection key={s.id} node={s} />
        ))}
      </div>
    </article>
  );
}
