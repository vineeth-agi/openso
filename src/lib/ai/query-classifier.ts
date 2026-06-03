/**
 * Query Classifier — Lightweight heuristic classifier for auto model routing.
 *
 * Inspired by GPT-5's 4-pillar routing approach:
 *   1. Conversation type detection
 *   2. Task complexity estimation
 *   3. Tool/capability needs
 *   4. Explicit user intent signals
 *
 * This is a zero-cost classifier (no LLM call) — runs in <1ms using
 * pattern matching, keyword detection, and message history analysis.
 */

import type { TaskCategory } from "./model-registry";

// ── Classification Result ──
export interface QueryClassification {
  /** Primary task category */
  category: TaskCategory;
  /** Complexity score (0-1) */
  complexity: number;
  /** Estimated input token count (rough) */
  estimatedInputTokens: number;
  /** Whether the query needs tool calling */
  needsTools: boolean;
  /** Whether thinking/reasoning mode would help */
  needsThinking: boolean;
  /** Whether the query involves multimodal content */
  isMultimodal: boolean;
  /** Confidence in the classification (0-1) */
  confidence: number;
  /** Human-readable reasoning for the classification */
  reason: string;
}

// ── Pattern Definitions ──

const CODE_PATTERNS = [
  /\b(code|function|class|interface|type|import|export|const|let|var|return|async|await)\b/i,
  /\b(debug|fix|refactor|implement|build|deploy|compile|lint|test|unit test)\b/i,
  /\b(javascript|typescript|python|java|rust|golang|sql|html|css|react|next\.?js|node\.?js)\b/i,
  /\b(api|endpoint|route|handler|middleware|webhook|database|query|schema|migration)\b/i,
  /```[\s\S]*```/,  // code blocks
  /\b(github|git|commit|merge|pull request|PR|branch)\b/i,
  /\b(npm|pip|cargo|maven|yarn|pnpm|bun)\b/i,
];

const COMPLEX_REASONING_PATTERNS = [
  /\b(analyze|evaluate|compare|contrast|assess|critique|review)\b/i,
  /\b(why|how come|explain|reason|cause|because|therefore|consequently)\b/i,
  /\b(step[- ]by[- ]step|think through|break down|in detail|thoroughly)\b/i,
  /\b(trade[- ]?off|pros? and cons?|advantages?|disadvantages?)\b/i,
  /\b(design|architect|plan|strategy|approach|methodology)\b/i,
  /\b(complex|difficult|challenging|tricky|nuanced)\b/i,
  /\b(think hard|deeply|carefully|thoroughly)\b/i,
];

const RESEARCH_PATTERNS = [
  /\b(research|investigate|find out|look up|search for|discover)\b/i,
  /\b(sources?|references?|citations?|papers?|studies?|articles?)\b/i,
  /\b(comprehensive|exhaustive|in[- ]depth|detailed overview)\b/i,
  /\b(state of the art|latest|recent|current trends?)\b/i,
  /\b(survey|review|meta[- ]analysis|literature)\b/i,
];

const CREATIVE_PATTERNS = [
  /\b(write|draft|compose|create|generate|brainstorm)\b/i,
  /\b(story|poem|essay|article|blog|post|script|narrative)\b/i,
  /\b(creative|imaginative|original|innovative|unique)\b/i,
  /\b(tone|style|voice|mood|perspective|character)\b/i,
];

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|sup|yo|thanks?|thank you|ok|okay|sure|yes|no|bye|goodbye)\b/i,
  /^(what is|define|who is|when was|where is)\b/i,
  /^.{0,30}$/,  // very short messages
  /\b(quick|brief|short|simple|just|only|fast)\b/i,
];

const STRUCTURED_PATTERNS = [
  /\b(json|xml|csv|table|list|format|parse|extract|schema|structured)\b/i,
  /\b(convert|transform|map|filter|sort|group|aggregate)\b/i,
  /\b(data|dataset|record|field|column|row|entry)\b/i,
];

const MULTIMODAL_INDICATORS = [
  /\b(image|photo|picture|screenshot|diagram|chart|graph)\b/i,
  /\b(video|audio|recording|voice|sound)\b/i,
  /\b(look at|see|view|show|display|visualize)\b/i,
  /\b(upload|attach|file|document|pdf)\b/i,
];

// ── Explicit Intent Signals (GPT-5 Pillar 4) ──
const THINKING_SIGNALS = [
  /\b(think hard|think deeply|think carefully|reason through)\b/i,
  /\b(step by step|chain of thought|let'?s think|reasoning)\b/i,
  /\b(analyze deeply|thorough analysis|detailed reasoning)\b/i,
];

const FAST_SIGNALS = [
  /\b(quick|fast|brief|short|tl;?dr|summary|just tell me)\b/i,
  /\b(one word|one sentence|briefly|concisely)\b/i,
  /\b(yes or no|true or false|simple answer)\b/i,
];

// ── Classifier ──

function countPatternMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, p) => count + (p.test(text) ? 1 : 0), 0);
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Classify a user query to determine the best model routing.
 *
 * @param query - The current user message
 * @param conversationLength - Number of messages in the conversation so far
 * @param hasAttachments - Whether the message includes images/files/audio
 * @param systemPromptLength - Length of system prompt in chars
 */
export function classifyQuery(
  query: string,
  conversationLength: number = 0,
  hasAttachments: boolean = false,
  systemPromptLength: number = 0,
): QueryClassification {
  const text = query.trim();
  const lowerText = text.toLowerCase();

  // Score each category
  const scores: Record<TaskCategory, number> = {
    simple: 0,
    moderate: 0,
    complex: 0,
    creative: 0,
    code: 0,
    research: 0,
    structured: 0,
    multimodal: 0,
  };

  // ── Pillar 1: Conversation type ──
  scores.code = countPatternMatches(text, CODE_PATTERNS) * 2;
  scores.creative = countPatternMatches(text, CREATIVE_PATTERNS) * 1.5;
  scores.research = countPatternMatches(text, RESEARCH_PATTERNS) * 2;
  scores.structured = countPatternMatches(text, STRUCTURED_PATTERNS) * 1.5;
  scores.simple = countPatternMatches(text, SIMPLE_PATTERNS) * 1.5;

  // ── Pillar 2: Task complexity ──
  const complexityHits = countPatternMatches(text, COMPLEX_REASONING_PATTERNS);
  scores.complex = complexityHits * 2;

  // Message length as complexity signal
  if (text.length > 500) scores.complex += 2;
  else if (text.length > 200) scores.moderate += 1.5;
  else if (text.length < 50) scores.simple += 2;

  // Multi-turn conversations tend to be more complex
  if (conversationLength > 10) scores.complex += 1;
  else if (conversationLength > 5) scores.moderate += 1;

  // ── Pillar 3: Tool/capability needs ──
  const multimodalHits = countPatternMatches(text, MULTIMODAL_INDICATORS);
  if (hasAttachments || multimodalHits > 0) {
    scores.multimodal += (multimodalHits + (hasAttachments ? 3 : 0));
  }

  // ── Pillar 4: Explicit intent signals ──
  const thinkingSignals = countPatternMatches(text, THINKING_SIGNALS);
  const fastSignals = countPatternMatches(text, FAST_SIGNALS);

  if (thinkingSignals > 0) {
    scores.complex += thinkingSignals * 3;
    scores.simple = 0; // override simple if thinking requested
  }
  if (fastSignals > 0) {
    scores.simple += fastSignals * 2;
    scores.complex = Math.max(0, scores.complex - 2);
  }

  // ── Default: moderate if nothing stands out ──
  if (Object.values(scores).every((s) => s < 1)) {
    scores.moderate = 2;
  }

  // ── Pick winner ──
  let bestCategory: TaskCategory = "moderate";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores) as [TaskCategory, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  // ── Compute complexity score (0-1) ──
  const rawComplexity =
    (scores.complex * 3 + scores.research * 2 + scores.code * 1.5 + scores.creative) /
    (Math.max(1, text.length / 100) + 5);
  const complexity = Math.min(1, Math.max(0, rawComplexity));

  // ── Determine needs ──
  const needsThinking =
    thinkingSignals > 0 ||
    complexity > 0.6 ||
    bestCategory === "complex" ||
    bestCategory === "research";

  const needsTools =
    bestCategory === "code" ||
    bestCategory === "research" ||
    bestCategory === "structured" ||
    conversationLength > 0; // multi-turn usually has tools

  const isMultimodal = hasAttachments || scores.multimodal > 1;

  const estimatedInputTokens =
    estimateTokens(text) +
    estimateTokens(" ".repeat(systemPromptLength)) +
    (conversationLength * 200); // rough avg per previous message

  // ── Confidence ──
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? Math.min(1, bestScore / totalScore + 0.3) : 0.5;

  // ── Build reason ──
  const topCategories = (Object.entries(scores) as [TaskCategory, number][])
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([c, s]) => `${c}(${s.toFixed(1)})`)
    .join(", ");

  return {
    category: bestCategory,
    complexity,
    estimatedInputTokens,
    needsTools,
    needsThinking,
    isMultimodal,
    confidence,
    reason: `Category=${bestCategory} complexity=${complexity.toFixed(2)} scores=[${topCategories}]`,
  };
}
