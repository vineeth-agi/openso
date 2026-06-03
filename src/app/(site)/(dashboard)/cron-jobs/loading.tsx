export default function CronJobsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <div>
          <div className="h-5 w-24 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-44 rounded bg-muted" />
        </div>
        <div className="h-8 w-28 rounded-md bg-muted" />
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-lg bg-muted" />
                <div className="space-y-2">
                  <div className="h-4 w-36 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-5 w-16 rounded-full bg-muted" />
                <div className="h-8 w-8 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
