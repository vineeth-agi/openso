/**
 * POST /api/portfolio/avatar
 *
 * Uploads a portfolio avatar/profile image to InsForge storage,
 * then updates the user_portfolios row with the public URL.
 *
 * Accepts: multipart/form-data with an "image" field (PNG, JPG, WebP, GIF)
 *
 * Security:
 *   - Image format validated by magic bytes, not client `file.type` (Finding 12).
 *   - 5 MB hard cap.
 *   - Storage path uses a server-chosen extension (Finding 20).
 */

import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import {
  detectImageKind,
  safeImageExtensionFor,
  safeImageMimeFor,
} from "@/lib/security/file-upload";
import { safeErrorResponse } from "@/lib/security/safe-error";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = auth;

    const formData = await request.formData();
    const image = formData.get("image") as File | null;
    if (!image) return NextResponse.json({ error: "No image provided" }, { status: 400 });

    if (image.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    if (buffer.length > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 400 });
    }

    const kind = detectImageKind(buffer);
    const ext = safeImageExtensionFor(kind);
    const mime = safeImageMimeFor(kind);
    if (!kind || !ext || !mime) {
      return NextResponse.json(
        { error: "Unsupported image type. Use PNG, JPG, WebP, or GIF." },
        { status: 400 },
      );
    }

    const db = createAdminClient();
    const storagePath = `${user.id}/avatar-${Date.now()}.${ext}`;

    // Upload — InsForge SDK signature: upload(key, file). Bucket-level
    // settings handle content-type / upsert defaults. The SDK requires
    // a Blob/File rather than a Node Buffer; convert here.
    const blob = new Blob([buffer], { type: mime });
    const { error: uploadError } = await db.storage.from("portfolio-images")
      .upload(storagePath, blob);

    if (uploadError) {
      return safeErrorResponse(uploadError, {
        scope: "/api/portfolio/avatar:storage",
        clientHint: "Upload failed. Please try again.",
        status: 500,
      });
    }

    // InsForge `getPublicUrl(key)` returns a string directly.
    const publicUrl = db.storage.from("portfolio-images")
      .getPublicUrl(storagePath) as unknown as string;

    // Clean up old avatar files in storage to prevent bloat.
    try {
      const newFileName = storagePath.split("/")[1];
      // InsForge `list()` accepts an options object with `prefix`, and
      // returns `{ pagination, objects: [{ url, key, size, ... }] }`.
      const listResult = await db.storage.from("portfolio-images")
        .list({ prefix: user.id });
      const files: Array<{ key: string }> =
        (listResult as unknown as { objects?: Array<{ key: string }> }).objects ?? [];

      if (files.length > 0) {
        const filesToDelete = files
          .filter((f: { key: string }) =>
            /^avatar-\d+\.(png|jpg|webp|gif)$/i.test(f.key.split("/").pop() ?? "") &&
            (f.key.split("/").pop() ?? "") !== newFileName,
          )
          .map((f: { key: string }) => f.key);

        if (filesToDelete.length > 0) {
          // InsForge `remove()` takes a single key per call (no batch).
          await Promise.all(
            filesToDelete.map((key) =>
              db.storage.from("portfolio-images").remove(key),
            ),
          );
        }
      }
    } catch (err) {
      console.warn("[portfolio/avatar] Cleanup warning:", err);
    }

    // Update user_portfolios row + inject avatarUrl into site_config
    const { data: existingRows } = await db.database.from("user_portfolios")
      .select("site_config")
      .eq("user_id", user.id)
      .limit(1);

    const existingConfig = (existingRows?.[0]?.site_config ?? {}) as Record<string, unknown>;
    const mergedConfig = { ...existingConfig, avatarUrl: publicUrl };

    const { error: updateError } = await db.database.from("user_portfolios")
      .update({
        avatar_url: publicUrl,
        site_config: mergedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (updateError) {
      console.warn("[portfolio/avatar] DB update warning:", updateError.message);
    }

    return NextResponse.json({ success: true, avatarUrl: publicUrl });
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/portfolio/avatar", status: 500 });
  }
}
