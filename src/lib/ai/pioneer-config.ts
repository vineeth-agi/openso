/**
 * Pioneer AI Configuration
 *
 * Loads Pioneer AI API credentials for the OpenAI-compatible inference endpoint.
 *
 * Environment variables:
 *   - PIONEER_API_KEY   ->  API key from pioneer.ai → Settings → API Keys
 *   - PIONEER_BASE_URL  ->  Override base URL (default: https://api.pioneer.ai/v1)
 *   - PIONEER_MODEL     ->  Default model ID (e.g. "deepseek-ai/DeepSeek-V4-Flash")
 */

export interface PioneerConfig {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

const DEFAULT_BASE_URL = "https://api.pioneer.ai/v1";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4-Flash";

/**
 * Load and validate Pioneer AI credentials from environment variables.
 */
export function getPioneerConfig(): PioneerConfig {
  const apiKey = process.env.PIONEER_API_KEY || process.env.PIONEER_API;

  if (!apiKey) {
    throw new Error(
      "Pioneer AI API key not configured. Set PIONEER_API_KEY or PIONEER_API in your environment.",
    );
  }

  const baseURL = process.env.PIONEER_BASE_URL ?? DEFAULT_BASE_URL;
  const defaultModel = process.env.PIONEER_MODEL ?? DEFAULT_MODEL;

  return { apiKey, baseURL, defaultModel };
}

/**
 * Returns a summary of the Pioneer AI configuration (safe for logging).
 */
export function getPioneerConfigSummary(): {
  baseURL: string;
  defaultModel: string;
  hasApiKey: boolean;
  isConfigured: boolean;
} {
  try {
    const cfg = getPioneerConfig();
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

