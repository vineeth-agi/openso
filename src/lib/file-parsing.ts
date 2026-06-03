import type { UIMessage } from "ai";
import officeparser from "officeparser";
import { extractText as extractPdfText } from "unpdf";

import { indexDocument } from "@/lib/memory/documents";

// ── Thresholds ──
const NATIVE_CONTEXT_CHAR_LIMIT = 50_000; // Files below this → inject into prompt
// Files above this → chunk + embed + pgvector RAG

export interface RagIndexedFile {
  filename: string;
  sourceId: string;
  chunkCount: number;
  charCount: number;
}

/**
 * Hybrid file attachment processor — ChatGPT-style architecture.
 *
 * For each user message with experimental_attachments:
 * - Images/PDFs → left as native attachments (multimodal AI)
 * - Office/text files < 50K chars → text injected directly into message (context stuffing)
 * - Office/text files ≥ 50K chars → chunked+embedded into pgvector (Dynamic RAG)
 *
 * Returns the modified messages array + a list of files that were RAG-indexed.
 */
export async function interceptAndParseAttachments(
  messages: UIMessage[],
  userId?: string,
  conversationId?: string,
): Promise<{ messages: UIMessage[]; ragIndexedFiles: RagIndexedFile[] }> {
  const ragIndexedFiles: RagIndexedFile[] = [];

  for (const msg of messages) {
    if (msg.role !== "user") continue;

    // ── 1. AGGREGATE ATTACHMENTS ──
    // Next.js AI SDK v4 puts attachments in msg.parts. Older versions used experimental_attachments.
    const attachmentsToProcess: Array<{
      url: string;
      mime: string;
      filename: string;
      isPart: boolean;
      partIndex?: number;
      originalAtt: any;
    }> = [];

    // Collect from experimental_attachments (AI SDK v5 field, cast for v6 compat)
    const msgAny = msg as unknown as { experimental_attachments?: Array<{ url: string; contentType?: string; name?: string }> };
    if (msgAny.experimental_attachments?.length) {
      msgAny.experimental_attachments.forEach((att) => {
        attachmentsToProcess.push({
          url: att.url,
          mime: att.contentType || "",
          filename: att.name || "Document",
          isPart: false,
          originalAtt: att,
        });
      });
    }

    // Collect from parts
    if (msg.parts?.length) {
      msg.parts.forEach((part, index) => {
        const partType = (part as unknown as { type: string }).type;
        if (partType === "file" || partType === "image") {
          const p = part as unknown as { url?: string; image?: string; data?: string; mediaType?: string; mimeType?: string; filename?: string; name?: string };
          attachmentsToProcess.push({
            // SDK maps files either to .data, .url, or .image depending on version
            url: p.url || p.image || p.data || "",
            mime: p.mediaType || p.mimeType || (partType === "image" ? "image/jpeg" : ""),
            filename: p.filename || p.name || "Document",
            isPart: true,
            partIndex: index,
            originalAtt: part,
          });
        }
      });
    }

    if (attachmentsToProcess.length === 0) continue;

    const nativeExperimentalAttachments: any[] = [];
    let extraTextContext = "";
    const partsToRemove = new Set<number>();

    // ── 2. PROCESS FILE BY FILE ──
    for (const att of attachmentsToProcess) {
      if (!att.url || !att.url.startsWith("http")) {
        // Pass-through data URIs natively
        if (!att.isPart) nativeExperimentalAttachments.push(att.originalAtt);
        continue;
      }

      // Native Formats: Images, video, audio pass through directly to multimodal vision
      // PDFs are now text-extracted for better structured parsing (resumes, docs)
      if (
        att.mime.startsWith("image/") ||
        att.mime.startsWith("video/") ||
        att.mime.startsWith("audio/")
      ) {
        if (!att.isPart) nativeExperimentalAttachments.push(att.originalAtt);
        continue;
      }

      // Non-native: Download and extract text (PDF, DOCX, PPTX, CSV, TXT)
      try {
        console.log(`[FileParsing] Fetching: ${att.filename} (${att.mime})`);
        const res = await fetch(att.url);
        if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
        const buffer = await res.arrayBuffer();

        let textContent = "";

        if (att.mime === "application/pdf") {
          // PDF → unpdf (serverless-compatible pdf.js wrapper)
          const { text } = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
          textContent = text;
        } else if (isOfficeFormat(att.mime)) {
          // Office documents → officeparser
          const nodeBuffer = Buffer.from(buffer);
          textContent = await (officeparser as unknown as { parseOffice: (buf: Buffer) => Promise<string> }).parseOffice(nodeBuffer);
        } else {
          // Plain text (CSV, TXT, MD, code files)
          textContent = new TextDecoder("utf-8").decode(buffer);
        }

        if (!textContent.trim()) {
          console.warn(`[FileParsing] Empty content from ${att.filename}, skipping`);
          if (att.isPart && typeof att.partIndex === "number") partsToRemove.add(att.partIndex);
          continue;
        }

        console.log(`[FileParsing] Extracted ${textContent.length} chars from ${att.filename}`);

        // Mark to remove from msg.parts (we translated it to text)
        if (att.isPart && typeof att.partIndex === "number") partsToRemove.add(att.partIndex);

        // HYBRID TIMELINE DECISION: Context Stuffing vs Dynamic RAG
        if (textContent.length < NATIVE_CONTEXT_CHAR_LIMIT) {
          extraTextContext += `\n\n--- Document: ${att.filename} (${textContent.length.toLocaleString()} chars) ---\n${textContent}\n--- End Document ---\n\n`;
        } else {
          if (userId && conversationId) {
            const sourceId = `${conversationId}::${att.filename}::${Date.now()}`;
            try {
              const chunkCount = await indexDocument(userId, "chat_upload", sourceId, att.filename, textContent, {
                originalMime: att.mime,
                conversationId,
                uploadedAt: new Date().toISOString(),
                charCount: textContent.length,
              });

              ragIndexedFiles.push({ filename: att.filename, sourceId, chunkCount, charCount: textContent.length });
              extraTextContext += `\n\n[📚 Document "${att.filename}" (${textContent.length.toLocaleString()} chars) has been indexed for deep search. Use the search_uploaded_docs tool to find information.]\n\n`;
            } catch (err) {
              console.error(`[FileParsing] RAG failure for ${att.filename}`, err);
              extraTextContext += `\n\n--- Document: ${att.filename} (truncated) ---\n${textContent.slice(0, NATIVE_CONTEXT_CHAR_LIMIT)}\n--- End Document ---\n\n`;
            }
          } else {
            extraTextContext += `\n\n--- Document: ${att.filename} (truncated) ---\n${textContent.slice(0, NATIVE_CONTEXT_CHAR_LIMIT)}\n--- End Document ---\n\n`;
          }
        }
      } catch (e) {
        console.error(`[FileParsing] Error parsing ${att.filename}:`, e);
        extraTextContext += `\n\n[Error reading file: ${att.filename}]\n\n`;
      }
    }

    // ── 3. RECONSTRUCT MESSAGE ──
    (msg as unknown as { experimental_attachments?: unknown[] }).experimental_attachments = nativeExperimentalAttachments.length > 0 ? nativeExperimentalAttachments : undefined;
    
    // Remove the files from parts that we just converted into text
    if (msg.parts && partsToRemove.size > 0) {
      msg.parts = msg.parts.filter((_, i) => !partsToRemove.has(i));
    }

    // Append our freshly extracted context as a text block
    if (extraTextContext) {
      const existingParts = msg.parts ?? [];
      msg.parts = [...existingParts, { type: "text" as const, text: extraTextContext }];
    }
  }

  return { messages, ragIndexedFiles };
}

// ── Helpers ──

function isOfficeFormat(mime: string): boolean {
  return [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  // docx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         // xlsx
    "application/msword",                                                         // doc
    "application/vnd.ms-powerpoint",                                              // ppt
    "application/vnd.ms-excel",                                                   // xls
  ].includes(mime);
}
