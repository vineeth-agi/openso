/**
 * Link validation utilities for portfolio rendering.
 *
 * Two layers:
 *
 *   1. `isSafePublicUrl(url)` — synchronous structural check. Rejects
 *      empty / non-string / non-http(s) / private-net / loopback / linklocal /
 *      `javascript:` / `data:` / `file:` URLs. Used as a fast gate before
 *      any network call.
 *
 *   2. `validateExternalLink(url, opts)` — async HEAD-then-GET probe with
 *      a hard timeout. Treats any 2xx/3xx as valid. 4xx/5xx and network
 *      errors return `{ ok: false, reason }`. Bounded to `timeoutMs`
 *      (default 4s) so a slow upstream can't stall portfolio generation.
 *
 *   3. `validateLinksInProjects(projects)` — bulk-validate `link` and
 *      `github` fields on the merged project list before persisting the
 *      portfolio config. Invalid entries are stripped (not fabricated).
 *
 * No external dependencies — uses the platform `fetch` and `URL`.
 */

// ── Structural gate ────────────────────────────────────────────────────────

const PRIVATE_NET_PREFIXES = [
  "10.",
  "127.",
  "169.254.", // link-local
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "::1",
  "fc00:", "fd00:", // unique local IPv6
  "fe80:",          // link-local IPv6
];

const FORBIDDEN_PROTOCOLS = new Set([
  "javascript:", "data:", "vbscript:", "file:", "ftp:",
]);

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
]);

/**
 * Synchronous structural URL check. NEVER returns true for:
 *   - non-http(s) protocols
 *   - localhost / loopback / private-net IPs
 *   - empty, malformed, or relative URLs
 *
 * Use this as a fast gate before any user-visible link is rendered.
 */
export function isSafePublicUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const proto = parsed.protocol.toLowerCase();
  if (proto !== "https:" && proto !== "http:") return false;
  if (FORBIDDEN_PROTOCOLS.has(proto)) return false;

  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (PRIVATE_HOSTNAMES.has(host)) return false;
  for (const prefix of PRIVATE_NET_PREFIXES) {
    if (host === prefix || host.startsWith(prefix)) return false;
  }
  return true;
}

// ── Async probe ────────────────────────────────────────────────────────────

export type LinkValidation =
  | { ok: true; url: string; status: number }
  | { ok: false; url: string; reason: "blocked" | "timeout" | "network" | "http_error"; status?: number };

const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * Async probe of an external URL. Returns `{ ok: false, reason: "blocked" }`
 * synchronously if the URL fails the structural check (no network call
 * issued). Otherwise issues a HEAD with a short timeout; falls back to a
 * bounded GET (range-limited by `Range: bytes=0-0` header) when HEAD is
 * not allowed by the host. 2xx and 3xx responses are valid.
 */
export async function validateExternalLink(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<LinkValidation> {
  if (!isSafePublicUrl(url)) {
    return { ok: false, url, reason: "blocked" };
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const probe = async (method: "HEAD" | "GET"): Promise<LinkValidation> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers:
          method === "GET"
            ? { Range: "bytes=0-0", "User-Agent": "portfolio-link-validator/1.0" }
            : { "User-Agent": "portfolio-link-validator/1.0" },
      });
      if (res.status >= 200 && res.status < 400) {
        return { ok: true, url, status: res.status };
      }
      return { ok: false, url, reason: "http_error", status: res.status };
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name ?? "";
      if (name === "AbortError") return { ok: false, url, reason: "timeout" };
      return { ok: false, url, reason: "network" };
    } finally {
      clearTimeout(timer);
    }
  };

  // HEAD first; if disallowed (405) or treated as 4xx by some hosts, retry GET.
  const head = await probe("HEAD");
  if (head.ok) return head;
  if (head.reason === "http_error" && (head.status === 405 || head.status === 403)) {
    return probe("GET");
  }
  // For network/timeout errors HEAD is enough — don't double the latency.
  return head;
}

// ── Bulk validator ─────────────────────────────────────────────────────────

export interface ValidatableProject {
  link: string | null;
  github: string | null;
}

/**
 * Validate `link` and `github` fields on a list of projects in parallel
 * (bounded concurrency to avoid hammering one host). Mutates a copy of the
 * projects: invalid `link` is set to `null`, invalid `github` is set to
 * `null`. Returns the cleaned list plus a report keyed by project index.
 */
export async function validateLinksInProjects<T extends ValidatableProject>(
  projects: T[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<{ projects: T[]; report: Record<number, { link?: LinkValidation; github?: LinkValidation }> }> {
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const report: Record<number, { link?: LinkValidation; github?: LinkValidation }> = {};
  const cleaned = projects.map((p) => ({ ...p }));

  const tasks: { i: number; field: "link" | "github"; url: string }[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const p = cleaned[i];
    if (p.link) tasks.push({ i, field: "link", url: p.link });
    if (p.github) {
      // GitHub field is "owner/repo"; turn it into a URL for validation.
      const ghUrl = `https://github.com/${p.github}`;
      tasks.push({ i, field: "github", url: ghUrl });
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const me = cursor++;
      const t = tasks[me];
      if (!t) break;
      const result = await validateExternalLink(t.url, { timeoutMs });
      report[t.i] = report[t.i] ?? {};
      report[t.i][t.field] = result;
      if (!result.ok) {
        if (t.field === "link") cleaned[t.i].link = null;
        // For github we never blank the slug to "null" purely on a network
        // failure: the upstream `link-validator` might be transient. We
        // only blank the URL if the structural check failed (blocked).
        if (t.field === "github" && result.reason === "blocked") {
          cleaned[t.i].github = null;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { projects: cleaned, report };
}
