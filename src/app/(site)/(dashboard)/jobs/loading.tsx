export default function JobsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <div>
          <div className="h-5 w-20 rounded bg-muted" />
          <div className="mt-1.5 h-3 w-40 rounded bg-muted" />
        </div>
        <div className="h-8 w-24 rounded-md bg-muted" />
      </div>

      {/* Table header */}
      <div className="flex items-center gap-4 border-b px-4 py-3 sm:px-6">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-4 w-16 rounded bg-muted" />
      </div>

      {/* Table rows */}
      <div className="flex-1 overflow-auto">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b px-4 py-3 sm:px-6"
          >
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-4 w-20 rounded bg-muted" />
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-5 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
