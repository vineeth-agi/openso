import type { LegalSectionNode } from "./legal-page";

export function LegalSection({ node }: { node: LegalSectionNode }) {
  return (
    <section id={node.id} className="scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {node.heading}
      </h2>
      <div className="mt-4 space-y-4 text-base text-foreground/85 leading-relaxed">
        {node.body}
      </div>
      {node.subsections?.map((sub) => (
        <section key={sub.id} id={sub.id} className="mt-8 scroll-mt-24">
          <h3 className="text-xl font-semibold tracking-tight">
            {sub.heading}
          </h3>
          <div className="mt-3 space-y-3 text-base text-foreground/85 leading-relaxed">
            {sub.body}
          </div>
        </section>
      ))}
    </section>
  );
}
