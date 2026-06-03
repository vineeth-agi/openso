import { SUB_PROCESSORS, type SubProcessor } from "@/lib/legal/constants";

export function SubProcessorTable({
  items,
}: {
  items?: readonly SubProcessor[];
}) {
  const processors = items ?? SUB_PROCESSORS;
  return (
    <ul className="grid grid-cols-1 gap-4">
      {processors.map((sp) => (
        <li key={sp.name} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold">{sp.name}</h3>
            <span className="text-xs text-muted-foreground">{sp.region}</span>
          </div>
          <p className="mt-2 text-sm text-foreground/80">{sp.purpose}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">
              Data shared:{" "}
            </span>
            {sp.dataCategories.join(", ")}
          </p>
          <a
            href={sp.privacyPolicyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-foreground/80 underline hover:text-foreground"
          >
            {sp.name} privacy policy
          </a>
        </li>
      ))}
    </ul>
  );
}
