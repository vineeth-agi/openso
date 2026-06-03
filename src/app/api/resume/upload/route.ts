/**
 * POST /api/resume/upload
 *
 * Uploads a resume file to InsForge storage (resumes bucket),
 * then triggers the ingest-resume pipeline (extraction + synthesis).
 *
 * Accepts: multipart/form-data with a "file" field (PDF, DOCX, TXT)
 * Returns: { success, resumeUrl, resume, factsAdded, ... }
 *
 * Security:
 *   - File type validated by MAGIC BYTES, not by client-supplied `file.type`
 *     or filename extension (Finding 12).
 *   - 10 MB hard cap enforced before parsing.
 *   - Storage path uses a SERVER-CHOSEN extension based on the validated
 *     content type (Finding 20). Filename is never interpolated.
 *   - PDF / DOCX parsers wrapped in a Promise.race timeout to bound CPU.
 */

import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/insforge/admin";
import { getAuthUser } from "@/lib/insforge/server";
import { ingestResume } from "@/lib/profile/resume-extractor";
import { synthesizeProfile } from "@/lib/profile/synthesizer";
import { detectResumeKind, safeExtensionFor } from "@/lib/security/file-upload";
import { safeErrorResponse } from "@/lib/security/safe-error";

export const maxDuration = 60;

const MAX_RESUME_SIZE = 10 * 1024 * 1024; // 10 MB
const PARSE_TIMEOUT_MS = 25_000; // 25s — keep < maxDuration

/** Run an async parser with a hard timeout so a malicious PDF/DOCX can't OOM us. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = auth;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    if (file.size > MAX_RESUME_SIZE) {
      return NextResponse.json({ error: "Resume must be under 10 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Re-check size after read just in case the multipart layer was lenient.
    if (buffer.length > MAX_RESUME_SIZE) {
      return NextResponse.json({ error: "Resume must be under 10 MB." }, { status: 400 });
    }

    // Magic-byte detection — never trust file.type / file.name.
    const kind = detectResumeKind(buffer);
    if (!kind) {
      return NextResponse.json(
        { error: "Unsupported file type. Use PDF, DOCX, or TXT." },
        { status: 400 },
      );
    }

    const db = createAdminClient();

    // 1. Upload to storage with a server-chosen safe path.
    const ext = safeExtensionFor(kind);
    const safeMime =
      kind === "pdf"
        ? "application/pdf"
        : kind === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain";
    const storagePath = `${user.id}/${Date.now()}-resume.${ext}`;

    const blob = new Blob([buffer], { type: safeMime });
    const { error: uploadError } = await db.storage.from("resumes")
      .upload(storagePath, blob);

    if (uploadError) {
      return safeErrorResponse(uploadError, {
        scope: "/api/resume/upload:storage",
        clientHint: "Upload failed. Please try again.",
        status: 500,
      });
    }

    // 1a. Resolve the persistent download URL for the resume so that
    //     `site_config.contact.resumeUrl` (consumed by the portfolio Hero
    //     "Resume" button) actually points at the uploaded file.
    //     `resumes` bucket is provisioned as PUBLIC in InsForge — calling
    //     `getPublicUrl` returns a stable URL we can persist (Issue #2).
    let resumeUrl: string | null = null;
    try {
      const url = db.storage.from("resumes")
        .getPublicUrl(storagePath) as unknown as string;
      if (typeof url === "string" && url.length > 0) resumeUrl = url;
    } catch (urlErr) {
      console.warn("[resume/upload] getPublicUrl failed:", urlErr);
    }

    // 2. Extract text from file (with hard timeout).
    let rawText: string;

    try {
      if (kind === "pdf") {
        const { extractText } = await import("unpdf");
        const result = await withTimeout(
          extractText(new Uint8Array(buffer), { mergePages: true }),
          PARSE_TIMEOUT_MS,
          "PDF parse",
        );
        rawText = result.text;
      } else if (kind === "docx") {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mammoth = require("mammoth") as {
          extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
        };
        const result = await withTimeout(
          mammoth.extractRawText({ buffer }),
          PARSE_TIMEOUT_MS,
          "DOCX parse",
        );
        rawText = result.value;
      } else {
        rawText = buffer.toString("utf-8");
      }
    } catch (err) {
      return safeErrorResponse(err, {
        scope: "/api/resume/upload:parse",
        clientHint: "Failed to parse the file. It may be corrupted or too complex.",
        status: 400,
      });
    }

    if (!rawText || rawText.trim().length < 50) {
      return NextResponse.json({ error: "Resume text too short or empty" }, { status: 400 });
    }

    // 3. Ingest resume (extract structured data + write memory facts)
    try {
      const { resume, factsAdded } = await ingestResume(user.id, rawText);

      // 3a. Persist resume URL + storage path (Issue #2):
      //     - `user_profiles.resume_storage_path` for ops/audit
      //     - `user_portfolios.site_config.contact.resumeUrl` so the public
      //       portfolio Hero's "Resume" button links to the uploaded file.
      //     - `user_portfolios.resume_url` (top-level column) when present.
      try {
        await db.database.from("user_profiles")
          .upsert({
            user_id: user.id,
            resume_storage_path: storagePath,
            resume_url: resumeUrl,
            resume_uploaded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
      } catch (profileErr) {
        // The storage_path / url columns are non-critical for portfolio
        // rendering — `ingestResume` already persisted the structured
        // resume — so log and continue.
        console.warn(
          "[resume/upload] resume_url upsert warning:",
          profileErr instanceof Error ? profileErr.message : profileErr,
        );
      }

      // Inject resumeUrl into the portfolio config if one already exists.
      // We do not CREATE a row here — that's `/api/portfolio/generate`'s job.
      if (resumeUrl) {
        try {
          const { data: existingRows } = await db.database
            .from("user_portfolios")
            .select("site_config")
            .eq("user_id", user.id)
            .limit(1);
          const existingConfig =
            (existingRows?.[0]?.site_config ?? null) as Record<string, unknown> | null;
          if (existingConfig) {
            const merged = {
              ...existingConfig,
              contact: {
                ...((existingConfig.contact as Record<string, unknown> | undefined) ?? {}),
                resumeUrl,
              },
            };
            await db.database.from("user_portfolios")
              .update({
                site_config: merged,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", user.id);
          }
        } catch (cfgErr) {
          console.warn(
            "[resume/upload] site_config.resumeUrl merge warning:",
            cfgErr instanceof Error ? cfgErr.message : cfgErr,
          );
        }
      }

      const { markdown, skills, techStack } = await synthesizeProfile(user.id);

      return NextResponse.json({
        success: true,
        storagePath,
        resumeUrl,
        resume: {
          name: resume.name,
          seniorityLevel: resume.seniorityLevel,
          totalYearsExperience: resume.totalYearsExperience,
          skillCount: [
            ...(resume.skills.languages ?? []),
            ...(resume.skills.frameworks ?? []),
            ...(resume.skills.tools ?? []),
          ].length,
          experienceCount: resume.experience.length,
          educationCount: resume.education.length,
          projectCount: resume.projects?.length ?? 0,
        },
        factsAdded,
        techStack,
        verifiedSkillCount: Object.values(skills).filter(
          (s) => s.claimed_resume && s.evidenced_github,
        ).length,
        profileMarkdownLength: markdown.length,
      });
    } catch (err) {
      return safeErrorResponse(err, {
        scope: "/api/resume/upload:ingest",
        clientHint: "Failed to process resume.",
        status: 500,
      });
    }
  } catch (err) {
    return safeErrorResponse(err, { scope: "/api/resume/upload", status: 500 });
  }
}
