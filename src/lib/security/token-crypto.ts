/**
 * Application-layer token encryption with key rotation (Findings 22, 7.5; audit DB-03).
 *
 * GitHub / Telegram tokens were previously stored as plaintext in DB
 * columns. The volume is encrypted at rest, but logically extracted data
 * (lost backup, leaked service-role key, SQL injection elsewhere) exposed
 * every connected account. This module wraps each token with AES-256-GCM
 * keyed by a master env secret so DB-level exfil yields only ciphertext.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Storage formats
 * ─────────────────────────────────────────────────────────────────────────
 *   Legacy (single-key):
 *     `enc:v1:<base64url(iv)>:<base64url(tag)>:<base64url(ct)>`
 *
 *   Rotation (multi-key, carries the id of the key that encrypted it):
 *     `enc:v2:<keyId>:<base64url(iv)>:<base64url(tag)>:<base64url(ct)>`
 *
 *   `<keyId>` is a short, stable, colon-free label (e.g. `k1`, `k2`) that
 *   identifies which key in the keyset produced the ciphertext. This is what
 *   makes the master key rotatable: old rows keep their original `keyId` and
 *   stay decryptable while new rows are written under the active key.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Configuration (env vars)
 * ─────────────────────────────────────────────────────────────────────────
 *   - `TOKEN_ENC_KEYS` (rotation mode): JSON object mapping keyId → base64
 *     (or hex / passphrase) 32-byte key, e.g.
 *       {"k1":"<base64-32>","k2":"<base64-32>"}
 *     When set, NEW encryptions use the `enc:v2:<activeKeyId>:` format.
 *
 *   - `TOKEN_ENC_ACTIVE_KEY_ID` (rotation mode): which keyId in
 *     `TOKEN_ENC_KEYS` to use for NEW encryptions (e.g. `k2`). If unset,
 *     defaults to the single key id present, otherwise `k1`.
 *
 *   - `TOKEN_ENC_KEY` (legacy mode / back-compat): a single 32-byte master
 *     key in base64 (hex and passphrase also accepted). Generate with:
 *       node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *     When `TOKEN_ENC_KEYS` is NOT set but this IS set, the module stays in
 *     legacy mode: it keeps writing `enc:v1:` exactly as before so nothing
 *     changes for un-migrated deploys. In rotation mode this key is still
 *     used (under the synthetic id `v1legacy`) to decrypt existing `enc:v1:`
 *     rows.
 *
 *   - If NEITHER is set: in production we hard-fail (throw) so we never
 *     silently store plaintext tokens (Finding 7.5). In dev/test we warn-once
 *     and fall back to plaintext for migration ergonomics.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Behaviour matrix
 * ─────────────────────────────────────────────────────────────────────────
 *   Legacy mode (only TOKEN_ENC_KEY set):
 *     encrypt → `enc:v1:...`           decrypt → `enc:v1:` (TOKEN_ENC_KEY)
 *   Rotation mode (TOKEN_ENC_KEYS set):
 *     encrypt → `enc:v2:<active>:...`  decrypt → `enc:v1:` (TOKEN_ENC_KEY or
 *                                        a `v1`/`v1legacy` entry in the keyset)
 *                                        AND `enc:v2:<keyId>:` (keyset lookup)
 *   Either mode: legacy plaintext rows (no prefix) pass through untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Rotation runbook (audit DB-03)
 * ─────────────────────────────────────────────────────────────────────────
 *   1. Generate a new 32-byte key and add it to `TOKEN_ENC_KEYS` alongside
 *      the current one, e.g. {"k1":"<old>","k2":"<new>"}. (On first move off
 *      legacy, include the old TOKEN_ENC_KEY as a keyset entry — e.g. as
 *      `v1` — or keep TOKEN_ENC_KEY set so `enc:v1:` rows stay readable.)
 *   2. Set `TOKEN_ENC_ACTIVE_KEY_ID=k2` and deploy. New writes are now
 *      `enc:v2:k2:`; all older rows still decrypt.
 *   3. Run a backfill job that calls `reencryptToken(value)` over every
 *      encrypted column — `connected_apps` (GitHub/Telegram tokens)
 *      plus any other encrypted columns — re-encrypting each row onto the
 *      active key.
 *   4. Once the backfill reports zero rows remaining on the old key, retire
 *      it: remove the old entry from `TOKEN_ENC_KEYS` (and unset the legacy
 *      `TOKEN_ENC_KEY`).
 *
 * Migration path for plaintext rows: callers detect plaintext by the missing
 * `enc:` prefix and either return them as-is (read path) or re-encrypt on
 * next write / via the backfill above.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";

/** Synthetic key id under which a legacy `TOKEN_ENC_KEY` is registered. */
const LEGACY_KEY_ID = "v1legacy";

type KeyMode = "legacy" | "rotation" | "none";

interface KeyConfig {
  /** Which configuration is active for this process. */
  mode: KeyMode;
  /** keyId → 32-byte key (for `enc:v2:` lookups and the active key). */
  keys: Map<string, Buffer>;
  /** keyId used for NEW encryptions (rotation mode). null when mode === "none". */
  activeKeyId: string | null;
  /** Raw `TOKEN_ENC_KEY` (used to decrypt `enc:v1:` rows). null if unset. */
  legacyKey: Buffer | null;
}

/**
 * Coerce an operator-supplied key string into a 32-byte Buffer.
 * Accepts base64 (preferred), hex, or — as a last resort — a passphrase
 * that gets SHA-256 derived. Returns null on failure.
 */
function parseKeyBuffer(raw: string): Buffer | null {
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
    // Allow hex too.
    const hexBuf = Buffer.from(raw, "hex");
    if (hexBuf.length === 32) return hexBuf;
    // Fall back to a SHA-256 derivation if the operator supplied a passphrase.
    return createHash("sha256").update(raw).digest();
  } catch {
    return null;
  }
}

/**
 * Resolve the key configuration from the environment. Pure (never throws);
 * production hard-fail is enforced separately by callers that actually need
 * a key. Re-read on every call so env changes (and tests) take effect.
 */
function resolveKeyConfig(): KeyConfig {
  const keysRaw = process.env.TOKEN_ENC_KEYS;
  const legacyRaw = process.env.TOKEN_ENC_KEY;

  const legacyKey = legacyRaw ? parseKeyBuffer(legacyRaw) : null;

  // ── Rotation mode: TOKEN_ENC_KEYS present and usable ──
  if (keysRaw) {
    const keys = new Map<string, Buffer>();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(keysRaw);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof val !== "string") continue;
        // keyIds are embedded in the `enc:v2:<keyId>:` wrapper and parsed via
        // split(":"), so a colon would corrupt the format. Skip such ids.
        if (id.length === 0 || id.includes(":")) continue;
        const buf = parseKeyBuffer(val);
        if (buf) keys.set(id, buf);
      }
    }

    if (keys.size > 0) {
      const requested = process.env.TOKEN_ENC_ACTIVE_KEY_ID;
      let activeKeyId: string;
      if (requested && requested.length > 0) {
        activeKeyId = requested;
      } else if (keys.size === 1) {
        activeKeyId = [...keys.keys()][0]!;
      } else {
        activeKeyId = "k1";
      }
      return { mode: "rotation", keys, activeKeyId, legacyKey };
    }
    // TOKEN_ENC_KEYS set but empty/unparseable → fall through to legacy/none.
  }

  // ── Legacy mode: only TOKEN_ENC_KEY present ──
  if (legacyKey) {
    const keys = new Map<string, Buffer>();
    keys.set(LEGACY_KEY_ID, legacyKey);
    return { mode: "legacy", keys, activeKeyId: LEGACY_KEY_ID, legacyKey };
  }

  // ── No keys configured ──
  return { mode: "none", keys: new Map(), activeKeyId: null, legacyKey: null };
}

/**
 * Resolve config and enforce the production hard-fail (Finding 7.5): if no
 * key is configured in production, throw rather than silently degrade. In
 * dev/test the "none" config is returned so callers can warn + fall back.
 */
function resolveConfigOrThrow(): KeyConfig {
  const config = resolveKeyConfig();
  if (config.mode === "none" && process.env.NODE_ENV === "production") {
    throw new Error(
      "[token-crypto] No encryption key configured in production. Set " +
        "TOKEN_ENC_KEYS (rotation mode) or TOKEN_ENC_KEY (legacy). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return config;
}

/** Resolve the key used to decrypt `enc:v1:` rows (legacy or rotation mode). */
function getV1Key(config: KeyConfig): Buffer | null {
  return (
    config.legacyKey ??
    config.keys.get("v1") ??
    config.keys.get(LEGACY_KEY_ID) ??
    null
  );
}

let warned = false;
function warnOnceMissing(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[token-crypto] No encryption key set (TOKEN_ENC_KEYS / TOKEN_ENC_KEY) — " +
      "connection tokens will be stored plaintext. Configure a key before next rotation.",
  );
}

/** Low-level AES-256-GCM encrypt → {iv, tag, ct}. 12-byte IV. */
function gcmEncrypt(plaintext: string, key: Buffer): {
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ct };
}

/** Low-level AES-256-GCM decrypt from base64url segments. */
function gcmDecrypt(ivB64: string, tagB64: string, ctB64: string, key: Buffer): string {
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Encrypt a token. Returns the original value if no key is configured
 * (dev/test only — production hard-fails). Output format depends on mode:
 * legacy → `enc:v1:...`, rotation → `enc:v2:<activeKeyId>:...`.
 */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (typeof plaintext !== "string" || plaintext.length === 0) return plaintext ?? null;
  // Already encrypted — pass through (idempotency on write paths).
  if (isEncrypted(plaintext)) return plaintext;

  const config = resolveConfigOrThrow();

  if (config.mode === "none") {
    // Dev/test only — production already threw in resolveConfigOrThrow.
    warnOnceMissing();
    return plaintext;
  }

  if (config.mode === "legacy") {
    const key = config.keys.get(LEGACY_KEY_ID)!;
    const { iv, tag, ct } = gcmEncrypt(plaintext, key);
    return [
      "enc",
      "v1",
      iv.toString("base64url"),
      tag.toString("base64url"),
      ct.toString("base64url"),
    ].join(":");
  }

  // Rotation mode.
  const activeKeyId = config.activeKeyId!;
  const key = config.keys.get(activeKeyId);
  if (!key) {
    // Misconfiguration: active id not present in TOKEN_ENC_KEYS. Fail closed.
    throw new Error(
      `[token-crypto] Active key id "${activeKeyId}" not found in TOKEN_ENC_KEYS. ` +
        "Set TOKEN_ENC_ACTIVE_KEY_ID to a key id present in TOKEN_ENC_KEYS.",
    );
  }
  const { iv, tag, ct } = gcmEncrypt(plaintext, key);
  return [
    "enc",
    "v2",
    activeKeyId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a token if it's wrapped; otherwise return as-is (legacy plaintext).
 * Transparently handles `enc:v1:` and `enc:v2:<keyId>:`. Unknown keyId or a
 * missing key fails closed (logs + returns null), matching the original
 * missing-key behaviour.
 */
export function decryptToken(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0) return value ?? null;

  const isV1 = value.startsWith(V1_PREFIX);
  const isV2 = value.startsWith(V2_PREFIX);
  if (!isV1 && !isV2) return value; // legacy plaintext row

  const config = resolveConfigOrThrow();
  if (config.mode === "none") {
    // Dev/test only (production threw). Cannot decrypt — fail closed.
    console.error(
      "[token-crypto] No encryption key configured but an encrypted token was read.",
    );
    return null;
  }

  try {
    const parts = value.split(":");
    if (isV1) {
      // parts: ["enc", "v1", iv, tag, ct]
      if (parts.length !== 5) return null;
      const key = getV1Key(config);
      if (!key) {
        console.error("[token-crypto] No key available to decrypt an enc:v1: token.");
        return null;
      }
      return gcmDecrypt(parts[2]!, parts[3]!, parts[4]!, key);
    }

    // isV2 — parts: ["enc", "v2", keyId, iv, tag, ct]
    if (parts.length !== 6) return null;
    const keyId = parts[2]!;
    const key = config.keys.get(keyId);
    if (!key) {
      console.error(
        `[token-crypto] Unknown key id "${keyId}" — not present in TOKEN_ENC_KEYS. Cannot decrypt.`,
      );
      return null;
    }
    return gcmDecrypt(parts[3]!, parts[4]!, parts[5]!, key);
  } catch (err) {
    console.error("[token-crypto] Failed to decrypt token:", err);
    return null;
  }
}

/**
 * Re-encrypt a stored value onto the current active key (audit DB-03 backfill
 * primitive). Behaviour:
 *   - `null` / empty → returned unchanged.
 *   - plaintext (no `enc:` prefix) → returned unchanged (let the normal write
 *     path encrypt it).
 *   - already on the active key → returned unchanged (no-op).
 *   - otherwise → decrypted with its original key and re-encrypted with the
 *     active key. If it can't be decrypted (unknown/missing key) the original
 *     value is returned unchanged so a backfill never destroys data.
 *
 * A future backfill job calls this over every encrypted column (e.g.
 * `connected_apps`) to migrate all rows onto a newly-rotated key, then the
 * old key can be retired.
 */
export function reencryptToken(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0) return value ?? null;
  // True plaintext — leave it for the normal write path to encrypt.
  if (!isEncrypted(value)) return value;

  const config = resolveConfigOrThrow();
  if (config.mode === "none") {
    // Dev/test only (production threw). Nothing we can do — leave unchanged.
    return value;
  }

  // Already on the active key? (no-op)
  if (config.mode === "legacy" && value.startsWith(V1_PREFIX)) {
    return value;
  }
  if (config.mode === "rotation" && value.startsWith(V2_PREFIX)) {
    const parts = value.split(":");
    if (parts.length === 6 && parts[2] === config.activeKeyId) return value;
  }

  const plain = decryptToken(value);
  if (plain == null) {
    // Couldn't decrypt (unknown/missing key) — never drop data on a backfill.
    return value;
  }
  return encryptToken(plain);
}

/** Check if a stored value is encrypted (vs legacy plaintext). */
export function isEncrypted(value: string | null | undefined): boolean {
  return (
    typeof value === "string" &&
    (value.startsWith(V1_PREFIX) || value.startsWith(V2_PREFIX))
  );
}

// Track which fields have already triggered the warning so we log each
// offender once per process — avoids flooding dev logs when a hot path
// keeps reading legacy plaintext rows.
const _assertWarned = new Set<string>();

/**
 * Asserts at runtime that a value reaching the decrypt boundary was
 * encrypted before being persisted (defensive — DB-HIGH-01).
 *
 * - In production: silently tolerates legacy plaintext rows so the app
 *   keeps working through the migration window.
 * - In development/test: emits a one-time `console.error` per fieldName
 *   if it sees a non-null, non-encrypted value. This surfaces any new
 *   write path that bypasses `encryptToken` so the regression is caught
 *   in dev rather than in a production data dump.
 *
 * Tolerates both `enc:v1:` and `enc:v2:` prefixes. Always tolerant of
 * `null`/`undefined`/`""` (a freshly-revoked connection).
 */
export function assertEncryptedOrNull(
  value: string | null | undefined,
  fieldName: string,
): void {
  if (value == null || value === "") return;
  if (typeof value !== "string") return;
  if (isEncrypted(value)) return;
  if (process.env.NODE_ENV === "production") return;
  if (_assertWarned.has(fieldName)) return;
  _assertWarned.add(fieldName);
  console.error(
    `[token-crypto] assertEncryptedOrNull: field "${fieldName}" was read as plaintext. ` +
      "Some write path is bypassing encryptToken — fix it before this hits production. " +
      "(Legacy plaintext rows from before encryption rollout are tolerated; this warning fires once per field.)",
  );
}
