import {
  GITHUB_SCOPES,
  GOOGLE_SCOPES,
  type GitHubScope,
  type GoogleScope,
} from "@/lib/legal/constants";
import { cn } from "@/lib/utils";

type OAuthScopeListProps =
  | { provider: "google"; items?: readonly GoogleScope[] }
  | { provider: "github"; items?: readonly GitHubScope[] };

export function OAuthScopeList(props: OAuthScopeListProps) {
  if (props.provider === "google") {
    const scopes = props.items ?? GOOGLE_SCOPES;
    return (
      <ul className="grid grid-cols-1 gap-4">
        {scopes.map((scope) => (
          <li key={scope.identifier} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-sm font-medium">{scope.identifier}</code>
              {scope.restricted && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  Restricted
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-foreground/80">
              <span className="font-medium text-foreground/90">Feature: </span>
              {scope.feature}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">
                Justification:{" "}
              </span>
              {scope.justification}
            </p>
          </li>
        ))}
      </ul>
    );
  }

  const scopes = props.items ?? GITHUB_SCOPES;
  return (
    <ul className="grid grid-cols-1 gap-4">
      {scopes.map((scope) => (
        <li key={scope.identifier} className="rounded-lg border p-4">
          <code className="text-sm font-medium">{scope.identifier}</code>
          <p className="mt-2 text-sm text-foreground/80">
            <span className="font-medium text-foreground/90">Feature: </span>
            {scope.feature}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">
              Justification:{" "}
            </span>
            {scope.justification}
          </p>
        </li>
      ))}
    </ul>
  );
}
