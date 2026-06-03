import { EFFECTIVE_DATE, LAST_UPDATED } from "@/lib/legal/constants";
import { cn } from "@/lib/utils";

export function LegalEffectiveDate({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      <span>Effective Date: {EFFECTIVE_DATE}</span>
      <span className="mx-2 text-muted-foreground/50">·</span>
      <span>Last Updated: {LAST_UPDATED}</span>
    </p>
  );
}
