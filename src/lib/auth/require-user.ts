import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

/**
 * `requireUser` — identify the current request's user AND guarantee
 * a matching `public.profiles` row exists.
 *
 * ## Why this exists
 *
 * The legacy schema relied on the trigger
 *
 *   `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
 *    EXECUTE FUNCTION public.handle_new_user();`
 *
 * to mirror every new auth user into `public.profiles`. InsForge
 * sandboxes the `auth` schema — it silently rejects user-defined
 * triggers there, so on InsForge the trigger never fires. When a
 * brand-new user signs in (OAuth or magic link), `auth.users` gets
 * the row but `public.profiles` does not. Any subsequent write to
 * a table whose `user_id` foreign-keys to `profiles(id)` —
 * `connected_apps`, `chat_session_summaries`, `agent_cron_jobs`,
 * `conversations`, etc. — fails with a 23503 foreign_key_violation.
 * The Gmail OAuth callback is a textbook case: token exchange
 * succeeds, then `upsertConnection` blows up on the FK and the
 * user lands on `/connectors?error=google_callback_failed`.
 *
 * ## What this does
 *
 * 1. Resolves the authenticated user via the existing
 *    `getAuthUser()` helper (cookie-bound SSR client + one-time
 *    refresh-token retry; per-request memoized via `cache()`).
 * 2. Idempotently upserts a `public.profiles` row keyed on the
 *    InsForge user id. The upsert uses `ignoreDuplicates: true`
 *    so once the row exists the call is a fast no-op — no row is
 *    rewritten and no `updated_at` triggers fire.
 *
 * The upsert runs on the admin client because RLS on `profiles`
 * forbids inserting a row whose `id` does not yet match
 * `auth.uid()` from the user's own bearer (the row has to exist
 * before the INSERT policy can match against it).
 *
 * ## When to call it
 *
 * Anywhere a route handler currently does:
 *
 *   `const { data: { user } } = await client.auth.getCurrentUser();`
 *
 * and then writes to a table whose `user_id` FK targets
 * `profiles(id)`. Routes that only read are safe to leave alone
 * — the helper is idempotent so adopting it everywhere does no
 * harm, but the migration can be incremental.
 */
export async function requireUser(): Promise<{
  id: string;
  email?: string | null;
  [k: string]: unknown;
} | null> {
  const auth = await getAuthUser();
  if (!auth) return null;

  const user = auth.user;

  // InsForge stores OAuth metadata in `user.profile` (jsonb on
  // `auth.users`). Different providers populate it under different
  // keys — Google uses `name` / `picture`, GitHub uses `name` /
  // `avatar_url` / `login`. Probe both shapes.
  const profile = (user as { profile?: Record<string, unknown> }).profile ?? {};
  const fullName =
    (profile.full_name as string | undefined) ??
    (profile.name as string | undefined) ??
    (user.email as string | undefined) ??
    null;
  const avatarUrl =
    (profile.avatar_url as string | undefined) ??
    (profile.picture as string | undefined) ??
    null;

  // Fire-and-forget would be tempting but a write that hasn't
  // committed yet is exactly the race condition we are trying to
  // avoid (FK insert beats profile insert). Awaiting the upsert is
  // the whole point.
  const admin = createAdminClient();
  const { error } = await admin.database.from("profiles").upsert([
    {
      id: user.id as string,
      email: (user.email as string | undefined) ?? null,
      full_name: fullName,
      avatar_url: avatarUrl,
    }
  ], { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    // Don't break the request if the bootstrap fails — log loudly
    // and return the user. The most likely cause is a transient DB
    // hiccup; the next request will retry. The only scenario where
    // we'd actually need to abort is the FK insert in the caller,
    // which will surface its own 23503 if profiles is still empty.
    console.error("[requireUser] profile bootstrap failed:", error);
  }

  return user;
}
