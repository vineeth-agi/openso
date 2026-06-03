export default function OpenSourceLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <div>
          <div className="h-5 w-36 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-56 rounded bg-muted" />
        </div>
        <div className="h-8 w-24 rounded-md bg-muted" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 border-b px-4 py-3 sm:px-6">
        <div className="h-8 w-24 rounded-md bg-muted" />
        <div className="h-8 w-20 rounded-md bg-muted" />
        <div className="h-8 w-28 rounded-md bg-muted" />
      </div>

      {/* Issue cards */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="size-5 rounded bg-muted" />
                <div className="h-4 w-48 rounded bg-muted" />
              </div>
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-muted" />
                <div className="h-5 w-12 rounded-full bg-muted" />
                <div className="h-5 w-20 rounded-full bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
