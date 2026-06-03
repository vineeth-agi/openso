export default function ChatLoading() {
  return (
    <div className="flex h-full flex-col animate-pulse">
      {/* Chat header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="size-8 rounded-full bg-muted" />
        <div className="h-4 w-28 rounded bg-muted" />
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* AI message */}
        <div className="flex gap-3 max-w-[80%]">
          <div className="size-7 shrink-0 rounded-full bg-muted" />
          <div className="space-y-2 flex-1">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-4/5 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
        </div>

        {/* User message */}
        <div className="flex justify-end">
          <div className="space-y-2 max-w-[60%]">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-3/4 rounded bg-muted" />
          </div>
        </div>

        {/* AI message */}
        <div className="flex gap-3 max-w-[80%]">
          <div className="size-7 shrink-0 rounded-full bg-muted" />
          <div className="space-y-2 flex-1">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-3/5 rounded bg-muted" />
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="h-12 w-full rounded-xl bg-muted" />
      </div>
    </div>
  );
}
