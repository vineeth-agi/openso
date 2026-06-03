import {
  PROCESSING_PURPOSES,
  type ProcessingPurpose,
} from "@/lib/legal/constants";

export function ProcessingPurposeTable({
  items,
}: {
  items?: readonly ProcessingPurpose[];
}) {
  const purposes = items ?? PROCESSING_PURPOSES;
  return (
    <ul className="grid grid-cols-1 gap-4">
      {purposes.map((p) => (
        <li key={p.purpose} className="rounded-lg border p-4">
          <p className="text-sm font-medium text-foreground/90">{p.purpose}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">
              Legal basis:{" "}
            </span>
            {p.legalBasis}
          </p>
          {p.legitimateInterest && (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">
                Legitimate interest:{" "}
              </span>
              {p.legitimateInterest}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
