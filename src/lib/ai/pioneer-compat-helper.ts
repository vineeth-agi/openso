import { GoogleGenerativeAI } from "@/lib/ai/generative-compat";

function createPioneerModel() {
  const genAI = new GoogleGenerativeAI();
  const modelName = process.env.PIONEER_MODEL || "deepseek-ai/DeepSeek-V4-Flash";
  return genAI.getGenerativeModel({ model: modelName });
}

export async function generateText(prompt: string): Promise<string> {
  const model = createPioneerModel();
  
  // Retry with exponential backoff (handles API 503/429 errors)
  let result;
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break; // success
    } catch (retryErr: unknown) {
      const status = (retryErr as { status?: number }).status;
      const isRetryable = status === 503 || status === 429 || status === 500;
      if (attempt < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`[pioneer-compat] Pioneer ${status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw retryErr;
      }
    }
  }
  if (!result) throw new Error("All retry attempts failed");
  
  return result.response.text().trim();
}

