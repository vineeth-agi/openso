/**
 * File upload validation helpers.
 *
 * Goals:
 *   - Validate file type by magic bytes, not by client-supplied `file.type`
 *     or filename extension (Finding 12).
 *   - Provide a safe, allow-listed extension chosen from the validated MIME
 *     type, so storage paths never carry attacker-influenced extensions
 *     (Finding 20).
 */

export type ResumeKind = "pdf" | "docx" | "txt" | null;

/** Detects PDF / DOCX / plain-text from the first ~16 bytes of the buffer. */
export function detectResumeKind(buffer: Buffer): ResumeKind {
  if (buffer.length === 0) return null;

  // PDF: starts with `%PDF-`
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return "pdf";
  }

  // DOCX is a ZIP container: `PK\x03\x04`
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "docx";
  }

  // Plain text: a quick heuristic — first 4KB has only printable ASCII +
  // common whitespace and no NUL bytes. We still enforce a UTF-8 decode
  // on the caller side; this just rules out obvious binaries.
  const sample = buffer.slice(0, Math.min(4096, buffer.length));
  for (const b of sample) {
    if (b === 0) return null;
    const isPrintable = (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
    if (!isPrintable) return null;
  }
  return "txt";
}

/** Pick a safe extension based on the validated kind. Never trust the user's filename. */
export function safeExtensionFor(kind: ResumeKind): "pdf" | "docx" | "txt" {
  if (kind === "pdf") return "pdf";
  if (kind === "docx") return "docx";
  return "txt";
}

export type AvatarKind = "png" | "jpeg" | "webp" | "gif" | null;

/** Detect image format from magic bytes. */
export function detectImageKind(buffer: Buffer): AvatarKind {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  // GIF: 47 49 46 38 37 61 or 47 49 46 38 39 61
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "gif";
  }
  // WEBP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export function safeImageExtensionFor(kind: AvatarKind): "png" | "jpg" | "webp" | "gif" | null {
  if (kind === "png") return "png";
  if (kind === "jpeg") return "jpg";
  if (kind === "webp") return "webp";
  if (kind === "gif") return "gif";
  return null;
}

export function safeImageMimeFor(kind: AvatarKind): string | null {
  if (kind === "png") return "image/png";
  if (kind === "jpeg") return "image/jpeg";
  if (kind === "webp") return "image/webp";
  if (kind === "gif") return "image/gif";
  return null;
}
