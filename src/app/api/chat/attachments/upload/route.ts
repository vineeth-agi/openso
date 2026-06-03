import { NextResponse } from "next/server";

import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";

/**
 * POST /api/chat/attachments/upload
 *
 * Accepts a multipart/form-data POST with a single `file` field, stores
 * the bytes in the `chat_attachments` bucket on InsForge, and returns
 * the resulting object's public URL.
 *
 * Why this is a server endpoint and not a direct browser SDK call:
 * the browser cannot read the httpOnly `insforge_access_token` cookie,
 * and the SDK cannot reach `https://*.insforge.app` cross-origin
 * without the bearer attached. Routing through this same-origin
 * endpoint lets the server forward the bearer.
 */
export async function POST(req: Request) {
  // Auth check (rejects 401 without a valid session).
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Must be logged in to upload attachments" },
      { status: 401 },
    );
  }
  const user = auth.user;

  // Parse form-data.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || (file as File).name === undefined) {
    return NextResponse.json(
      { error: "Missing `file` in form data" },
      { status: 400 },
    );
  }
  const f = file as File;

  // Generate a safe, unique key.
  const fileExt = f.name.split(".").pop() ?? "bin";
  const safeName = f.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  // CSE-04: random suffix prevents URL-guessing of other users' attachments. NOTE: the chat_attachments bucket is still public-read; a follow-up should move to signed URLs (tracked as P2-8 remainder).
  const rand = randomBytes(16).toString("base64url");
  const key = `${user.id}/${Date.now()}-${rand}-${safeName}`;

  // Upload via the admin client (server-side, has bearer).
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("chat_attachments")
      .upload(key, f);
    if (error) {
      console.error("[chat/attachments/upload] InsForge upload error:", error);
      return NextResponse.json(
        { error: `Upload failed: ${(error as Error).message ?? String(error)}` },
        { status: 500 },
      );
    }

    const publicUrl =
      (data as { url?: string } | null)?.url ??
      `${process.env.NEXT_PUBLIC_INSFORGE_BASE_URL}/api/storage/buckets/chat_attachments/objects/${encodeURIComponent(key)}`;

    return NextResponse.json({
      url: publicUrl,
      name: f.name,
      contentType: f.type || getContentTypeFromExt(fileExt),
    });
  } catch (err) {
    console.error("[chat/attachments/upload] threw:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

function getContentTypeFromExt(ext: string): string {
  const lower = ext.toLowerCase();
  switch (lower) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc": return "application/msword";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "csv": return "text/csv";
    case "txt": return "text/plain";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}
