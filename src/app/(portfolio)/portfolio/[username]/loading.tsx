export default function PortfolioLoading() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 pt-10">
      <div className="flex flex-col gap-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="h-8 w-64 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-28 w-28 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      <div className="space-y-8">
        <div className="space-y-2">
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-[140px] w-full animate-pulse rounded-lg bg-muted/30" />
      </div>
    </div>
  );
}
