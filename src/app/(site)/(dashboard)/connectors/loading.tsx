export default function ConnectorsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="h-5 w-28 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-52 rounded bg-muted" />
        </div>
        <div className="h-8 w-20 rounded-md bg-muted" />
      </div>

      {/* Security note */}
      <div className="mx-4 mt-4 h-12 rounded-lg bg-muted sm:mx-6" />

      {/* Card grid */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col rounded-xl border border-border bg-card p-5"
            >
              <div className="flex items-start gap-3.5">
                <div className="size-11 rounded-xl bg-muted" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-3 w-32 rounded bg-muted" />
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-3/4 rounded bg-muted" />
              </div>
              <div className="mt-3 flex gap-1">
                <div className="h-4 w-10 rounded bg-muted" />
                <div className="h-4 w-12 rounded bg-muted" />
                <div className="h-4 w-14 rounded bg-muted" />
              </div>
              <div className="mt-auto pt-4">
                <div className="h-8 w-full rounded-md bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
