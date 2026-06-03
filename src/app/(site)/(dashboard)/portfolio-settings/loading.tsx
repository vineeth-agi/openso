export default function PortfolioSettingsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <div>
          <div className="h-5 w-36 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-48 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded-md bg-muted" />
          <div className="h-8 w-20 rounded-md bg-muted" />
        </div>
      </div>

      {/* Settings sections */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-4">
              <div className="h-5 w-32 rounded bg-muted" />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="space-y-2">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-10 w-full rounded-md bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
