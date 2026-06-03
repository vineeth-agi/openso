/**
 * Pure helper that derives a stable URL fragment id from a heading string.
 *
 * The transformation:
 *   1. Lowercases the input.
 *   2. Decomposes accented characters via Unicode NFKD and strips the
 *      combining diacritic marks (U+0300–U+036F).
 *   3. Replaces every run of non `[a-z0-9]` characters with a single hyphen.
 *   4. Trims leading and trailing hyphens.
 *
 * The function is intentionally pure and dependency-free so both the legal
 * content modules and the test suite can import it.
 */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
