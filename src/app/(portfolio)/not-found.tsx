import Link from "next/link";

export default function PortfolioNotFound() {
  return (
    <>
      {/* Hide the portfolio nav, footer, and oneko cat on 404 */}
      <style>{`
        nav { display: none !important; }
        footer { display: none !important; }
        [data-oneko-cat] { display: none !important; }
      `}</style>
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <div className="space-y-6">
          <div className="font-doto text-8xl font-bold text-muted-foreground/30">
            404
          </div>
          <div className="space-y-2">
            <h1 className="font-doto text-2xl font-bold md:text-3xl">
              Portfolio not found
            </h1>
            <p className="max-w-md font-space-mono text-sm text-muted-foreground md:text-base">
              This portfolio doesn&apos;t exist or hasn&apos;t been published yet.
              The username might be incorrect.
            </p>
          </div>
          <div className="pt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-5 py-2.5 font-space-mono text-sm text-foreground transition-colors hover:bg-muted"
            >
              ← Go home
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
