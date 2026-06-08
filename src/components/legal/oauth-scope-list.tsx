import {
  GITHUB_SCOPES,
  type GitHubScope,
} from "@/lib/legal/constants";

type OAuthScopeListProps = {
  items?: readonly GitHubScope[];
};

export function OAuthScopeList(props: OAuthScopeListProps) {
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
