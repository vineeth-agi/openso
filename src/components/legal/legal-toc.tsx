import Link from "next/link";

import type { LegalSectionNode } from "./legal-page";

export function LegalTOC({ sections }: { sections: LegalSectionNode[] }) {
  return (
    <nav
      aria-label="Table of contents"
      className="rounded-lg border bg-card/30 p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        {sections.map((s) => (
          <li key={s.id}>
            <Link
              href={`#${s.id}`}
              className="text-foreground/80 hover:text-foreground hover:underline"
            >
              {s.heading}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
