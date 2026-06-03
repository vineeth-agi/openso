/**
 * Twitter card image — re-uses the same composition as the OG image.
 *
 * Next.js treats `twitter-image.tsx` as a sibling file convention to
 * `opengraph-image.tsx`. By re-exporting from the OG route we guarantee
 * a single source of truth and avoid two diverging visuals.
 */

export {
  alt,
  size,
  contentType,
  default,
} from "./opengraph-image";
