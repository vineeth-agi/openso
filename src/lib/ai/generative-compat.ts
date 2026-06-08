/**
 * Legacy `GoogleGenerativeAI` compatibility shim — now backed by xAI.
 *
 * Preserves the legacy API surface used by older routes (github-analyze,
 * pioneer-compat-helper) so callers keep working without code changes:
 *
 * ```ts
 * const genAI = new GoogleGenerativeAI();
 * const model = genAI.getGenerativeModel({ model: "grok-4.20-0309-non-reasoning" });
 * const result = await model.generateContent("prompt or content array");
 * const text = result.response.text();
 * ```
 *
 * Internally delegates to Vercel AI SDK `generateText` against our xAI
 * provider (OpenAI-compatible, Grok). The optional `apiKey`
 * constructor argument is accepted but ignored (xAI uses its own key).
 */

import { generateText } from "ai";

import { google } from "./google-provider";

type LegacyGenerationConfig = {
  candidateCount?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  stopSequences?: string[];
  temperature?: number;
  topK?: number;
  topP?: number;
};

type LegacySystemInstruction =
  | string
  | { parts?: Array<{ text?: string }>; text?: string }
  | { role?: string; parts?: Array<{ text?: string }> }
  | undefined;

type LegacyModelOptions = {
  model: string;
  generationConfig?: LegacyGenerationConfig;
  systemInstruction?: LegacySystemInstruction;
};

type LegacyGenerateResult = {
  response: {
    text: () => string;
  };
};

function normalizeSystem(instruction: LegacySystemInstruction): string | undefined {
  if (!instruction) return undefined;
  if (typeof instruction === "string") return instruction;
  if (typeof instruction === "object") {
    if ("text" in instruction && typeof instruction.text === "string") {
      return instruction.text;
    }
    if ("parts" in instruction && Array.isArray(instruction.parts)) {
      return instruction.parts
        .map((p) => (p && typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
    }
  }
  return undefined;
}

function normalizeContents(contents: unknown): string {
  // String prompt
  if (typeof contents === "string") return contents;

  // Array of parts: [{ text }, ...] or [{ role, parts: [{ text }] }, ...]
  if (Array.isArray(contents)) {
    return contents
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const e = entry as { text?: string; parts?: Array<{ text?: string }> };
          if (typeof e.text === "string") return e.text;
          if (Array.isArray(e.parts)) {
            return e.parts
              .map((p) => (p && typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n");
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  // Object: { text } or { parts: [{ text }] }
  if (contents && typeof contents === "object") {
    const c = contents as { text?: string; parts?: Array<{ text?: string }> };
    if (typeof c.text === "string") return c.text;
    if (Array.isArray(c.parts)) {
      return c.parts
        .map((p) => (p && typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
    }
  }

  return "";
}

class GenerativeModelCompat {
  constructor(private readonly options: LegacyModelOptions) {}

  async generateContent(contents: unknown): Promise<LegacyGenerateResult> {
    const prompt = normalizeContents(contents);
    const system = normalizeSystem(this.options.systemInstruction);
    const cfg = this.options.generationConfig ?? {};

    const result = await generateText({
      model: google(this.options.model),
      prompt,
      system,
      maxOutputTokens: cfg.maxOutputTokens,
      temperature: cfg.temperature,
      topP: cfg.topP,
      topK: cfg.topK,
      stopSequences: cfg.stopSequences,
      providerOptions: undefined, // xAI (OpenAI-compatible) doesn't use providerOptions
    });

    const text = result.text ?? "";
    return { response: { text: () => text } };
  }
}

export class GoogleGenerativeAI {
  // apiKey is accepted for backwards compatibility but ignored — xAI
  // uses its own API key from the environment.
  constructor(_apiKey?: string) {}

  getGenerativeModel(options: LegacyModelOptions): GenerativeModelCompat {
    return new GenerativeModelCompat(options);
  }
}
