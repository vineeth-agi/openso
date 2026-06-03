import { LegalEffectiveDate } from "./legal-effective-date";

import { DashedLine } from "@/components/dashed-line";
import { cn } from "@/lib/utils";


export function LegalHero({ title, intro }: { title: string; intro: string }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 md:px-0">
      <div className="relative flex flex-col items-center gap-5 pt-32 pb-12">
        <DashedLine
          className={cn(
            "max-w-xs",
            "fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards delay-75 duration-500 ease-out",
          )}
        />
        <h1
          className={cn(
            "fade-in slide-in-from-bottom-10 animate-in text-balance fill-mode-backwards text-center text-3xl tracking-tight delay-100 duration-500 ease-out md:text-4xl lg:text-6xl",
            "bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent",
            "text-shadow-[0_0px_50px_rgb(148_163_184/.2)]",
          )}
        >
          {title}
        </h1>
        <p className="fade-in slide-in-from-bottom-10 mx-auto max-w-2xl animate-in fill-mode-backwards text-center text-base text-foreground/80 tracking-wide delay-200 duration-500 ease-out sm:text-lg">
          {intro}
        </p>
        <LegalEffectiveDate className="fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards delay-300 duration-500 ease-out" />
      </div>
    </section>
  );
}
