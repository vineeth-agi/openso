/**
 * xAI Configuration
 *
 * Loads xAI API credentials for the OpenAI-compatible inference endpoint.
 *
 * Environment variables:
 *   - XAI_API_KEY   ->  API key from x.ai
 *   - XAI_BASE_URL  ->  Override base URL (default: https://api.x.ai/v1)
 *   - XAI_MODEL     ->  Default model ID (default: "grok-4.20-0309-non-reasoning")
 */

export interface XAIConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";

/**
 * Load and validate xAI credentials from environment variables.
 */
export function getXAIConfig(): XAIConfig {
  const apiKey = process.env.XAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "xAI API key not configured. Set XAI_API_KEY in your environment.",
    );
  }

  const baseURL = process.env.XAI_BASE_URL ?? DEFAULT_BASE_URL;
  const defaultModel = process.env.XAI_MODEL ?? DEFAULT_MODEL;

  return { apiKey, baseURL, defaultModel };
}

/**
 * Returns a summary of the xAI configuration (safe for logging).
 */
export function getXAIConfigSummary(): {
  baseURL: string;
  defaultModel: string;
  hasApiKey: boolean;
  isConfigured: boolean;
} {
  try {
    const cfg = getXAIConfig();
    return {
      baseURL: cfg.baseURL,
      defaultModel: cfg.defaultModel,
      hasApiKey: true,
      isConfigured: true,
    };
  } catch {
    return {
      baseURL: DEFAULT_BASE_URL,
      defaultModel: DEFAULT_MODEL,
      hasApiKey: false,
      isConfigured: false,
    };
  }
}
