export default function MemoryBrainLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <div>
          <div className="h-5 w-32 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-52 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 rounded-md bg-muted" />
          <div className="h-8 w-20 rounded-md bg-muted" />
        </div>
      </div>

      {/* Memory items */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border p-4"
            >
              <div className="size-8 shrink-0 rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
