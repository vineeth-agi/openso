/**
 * Resume Extractor — Structured extraction from resume files.
 *
 * Always operates on plain text. Callers (e.g. /api/resume/upload) extract text
 * from the source file (PDF via `unpdf`, DOCX via `mammoth`) and pass it here.
 * The AI PDF-vision path was removed because it caused 60s+ timeouts on
 * Vercel and produced no better results than text+LLM extraction.
 *
 * Writes extracted facts to memory_facts (source: "resume")
 * and structured data to user_profiles.resume_structured.
 */

import { generateObject } from "ai";
import { z } from "zod";

import { google, getDefaultPioneerModel } from "@/lib/ai/google-provider";
import { createAdminClient } from "@/lib/insforge/admin";
import { addFactsBatch } from "@/lib/memory/store";

// ── Schema ──────────────────────────────────────────────────

const ResumeSchema = z.object({
  name: z.string().describe("Full name"),
  email: z.string().optional().describe("Email address"),
  phone: z.string().optional().describe("Phone number"),
  location: z.string().optional().describe("City/State/Country"),
  linkedIn: z.string().optional().describe("LinkedIn profile URL"),
  summary: z.string().optional().describe("Professional summary or objective, 2-3 sentences"),

  education: z.array(z.object({
    institution: z.string(),
    degree: z.string(),
    field: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    gpa: z.string().optional(),
    highlights: z.array(z.string()).optional(),
  })).describe("Education history"),

  experience: z.array(z.object({
    company: z.string(),
    title: z.string(),
    location: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    isCurrent: z.boolean().optional(),
    bullets: z.array(z.string()).describe("Key achievements/responsibilities"),
    technologies: z.array(z.string()).optional(),
  })).describe("Work experience, most recent first"),

  projects: z.array(z.object({
    name: z.string(),
    description: z.string(),
    technologies: z.array(z.string()),
    url: z.string().optional(),
    highlights: z.array(z.string()).optional(),
  })).optional().describe("Personal or academic projects"),

  skills: z.object({
    languages: z.array(z.string()).optional().describe("Programming languages"),
    frameworks: z.array(z.string()).optional().describe("Frameworks and libraries"),
    tools: z.array(z.string()).optional().describe("Tools, platforms, databases"),
    soft: z.array(z.string()).optional().describe("Soft skills / methodologies"),
    other: z.array(z.string()).optional().describe("Other skills"),
  }).describe("Skills organized by category"),

  certifications: z.array(z.object({
    name: z.string(),
    issuer: z.string().optional(),
    date: z.string().optional(),
  })).optional(),

  languages: z.array(z.object({
    language: z.string(),
    proficiency: z.string().optional(),
  })).optional().describe("Human languages spoken"),

  totalYearsExperience: z.number().optional().describe("Estimated total years of professional experience"),
  seniorityLevel: z.enum(["intern", "entry", "mid", "senior", "lead", "staff", "principal", "director"]).optional(),
});

export type ResumeData = z.infer<typeof ResumeSchema>;

// ── Extractor ───────────────────────────────────────────────

function getModel() {
  return google(process.env.PIONEER_MODEL || getDefaultPioneerModel());
}

const RESUME_EXTRACTION_PROMPT = `You are a resume parsing expert. Extract ALL information from this resume into the structured format.
Be thorough — capture every job, project, skill, and certification.
If a field is not present in the resume, omit it.
For dates, use the format shown in the resume (e.g. "Jan 2023", "2023-present", "2021").
For seniority level, infer from job titles and years of experience.
IMPORTANT: Do NOT skip any work experience, internship, or job. Extract ALL of them.`;

/**
 * Extract structured resume data from raw text.
 * Used for all file types (PDF/DOCX/TXT) — callers extract text upstream.
 */
async function extractResumeFromText(rawText: string): Promise<ResumeData> {
  const { object } = await generateObject({
    model: getModel(),
    schema: ResumeSchema,
    prompt: `${RESUME_EXTRACTION_PROMPT}

Resume text:
${rawText.slice(0, 15000)}`,
    maxOutputTokens: 8192,
  });

  return object;
}

// ── Ingest to Memory + DB ──────────────────────────────────

/**
 * Full resume ingestion pipeline:
 * 1. Extract structured data via AI text completion
 * 2. Write facts to memory_facts
 * 3. Save structured data + raw text to user_profiles
 *
 * @param userId - The user's ID
 * @param rawText - Extracted text (used for extraction and stored in DB)
 */
export async function ingestResume(
  userId: string,
  rawText: string,
): Promise<{ resume: ResumeData; factsAdded: number }> {
  const db = createAdminClient();
  const resume = await extractResumeFromText(rawText);

  // ── Write to memory_facts ──────────────────────────────
  // We collect all facts first, then write them in parallel batches.
  // The embedding service has its own rate limiter, so we don't add per-call sleeps.
  type FactInput = {
    category: "personal" | "professional" | "technical" | "goal";
    fact: string;
    importance: number;
  };
  const facts: FactInput[] = [];
  const push = (
    category: FactInput["category"],
    fact: string,
    importance: number,
  ) => facts.push({ category, fact, importance });

  // Personal facts
  if (resume.name) push("personal", `Name is ${resume.name}`, 0.9);
  if (resume.location) push("personal", `Located in ${resume.location}`, 0.7);
  if (resume.summary) push("professional", `Professional summary: ${resume.summary}`, 0.8);
  if (resume.seniorityLevel) push("professional", `Seniority level: ${resume.seniorityLevel}`, 0.8);
  if (resume.totalYearsExperience) push("professional", `Has ${resume.totalYearsExperience} years of professional experience`, 0.8);

  // Education
  for (const edu of resume.education) {
    push("personal", `${edu.degree}${edu.field ? ` in ${edu.field}` : ""} from ${edu.institution}${edu.endDate ? ` (${edu.endDate})` : ""}`, 0.7);
  }

  // Experience
  for (const exp of resume.experience) {
    const dateRange = [exp.startDate, exp.isCurrent ? "present" : exp.endDate].filter(Boolean).join(" – ");
    push("professional", `Worked as ${exp.title} at ${exp.company}${dateRange ? ` (${dateRange})` : ""}`, 0.85);
    if (exp.technologies?.length) {
      push("technical", `Used ${exp.technologies.join(", ")} at ${exp.company}`, 0.8);
    }
    // Top 2 bullets as facts
    for (const bullet of (exp.bullets ?? []).slice(0, 2)) {
      push("professional", `At ${exp.company}: ${bullet}`, 0.7);
    }
  }

  // Projects
  for (const proj of resume.projects ?? []) {
    push("professional", `Built project "${proj.name}": ${proj.description.slice(0, 200)}`, 0.7);
    if (proj.technologies.length) {
      push("technical", `Used ${proj.technologies.join(", ")} in project "${proj.name}"`, 0.75);
    }
  }

  // Skills
  const allSkills = [
    ...(resume.skills.languages ?? []),
    ...(resume.skills.frameworks ?? []),
    ...(resume.skills.tools ?? []),
    ...(resume.skills.other ?? []),
  ];
  if (allSkills.length) {
    // Group into chunks of 8 to avoid 100+ individual facts
    for (let i = 0; i < allSkills.length; i += 8) {
      const chunk = allSkills.slice(i, i + 8);
      push("technical", `Technical skills: ${chunk.join(", ")}`, 0.85);
    }
  }

  // Certifications
  for (const cert of resume.certifications ?? []) {
    push("professional", `Certified: ${cert.name}${cert.issuer ? ` by ${cert.issuer}` : ""}`, 0.7);
  }

  // Ingest facts in a single optimized batch
  let factsAdded = 0;
  try {
    const batchResult = await addFactsBatch(
      userId,
      facts.map((f) => ({
        category: f.category,
        fact: f.fact,
        confidence: 0.95,
        importance: f.importance,
        memoryType: "fact" as const,
      })),
      "resume",
    );
    factsAdded = batchResult.addedCount;
  } catch (err) {
    console.error("[ingest-resume] Failed to batch ingest facts:", err);
  }

  // ── Save to user_profiles ───────────────────────────────
  await db.database.from("user_profiles")
    .upsert({
      user_id: userId,
      resume_raw_text: rawText.slice(0, 50000),
      resume_structured: resume as unknown as Record<string, unknown>,
      resume_uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  return { resume, factsAdded };
}
