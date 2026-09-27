/**
 * KSP Image — Pipeline Cost Tracker (r7.20a)
 *
 * Two responsibilities:
 *
 * 1. Calculate USD cost from token counts (text AI) or fixed price (image AI).
 *    Pricing values reflect public list prices as of May 2026; see PROVIDER_PRICING
 *    below. Update if vendors change.
 *
 * 2. Emit cost events when AI calls complete, so a project-scoped cost log
 *    (project.pipelineCost) can accumulate during a pipeline run and display
 *    in the UI live.
 *
 * Why a module-level emitter and not just call site → store?
 *   - There are ~50 `callAi` sites; passing a cost callback through every
 *     stage signature would be a big refactor.
 *   - The cost calculation is identical regardless of caller (just provider +
 *     token counts), so it belongs in one place.
 *   - The UI subscriber lives in a React component and updates Zustand,
 *     while callAi lives in a plain async function — emitter bridges them
 *     without coupling.
 *
 * Scope of tracking:
 *   - Per pipeline run. A "pipeline run" begins when the user clicks
 *     "Analyze Idea" (handleOpenPreviewFlow) and ends when auto-chain reaches
 *     the Shot List stage (last stage since r8.0).
 *   - Each new run RESETS the cost. Regen calls after a completed run
 *     continue to accumulate into the last run's total.
 *   - Future expansion (Voice + Music + SFX stages) plugs in by emitting
 *     the same `emitTextCost` / `emitImageCost` events from those engines.
 */

export type CostProvider = "gemini-flash" | "gemini-pro" | "openai-4o";
export type ImageQuality = "high" | "low";

/**
 * Public list prices in USD per token (text) or per image (image).
 *
 * STANDARD INTERACTIVE rates as of May 2026 (NOT Batch/Flex 50% discount tier).
 * Source: https://ai.google.dev/gemini-api/docs/pricing — official Google docs
 *
 * IMPORTANT HISTORY (r7.36-fix):
 *   - PRE-FIX values ($0.075 input / $0.30 output for Gemini Flash) reflected
 *     OLD batch-tier pricing OR outdated 1.5-era rates. Standard interactive
 *     usage at May 2026 charges $0.30 input / $2.50 output — 4x/8x higher.
 *   - Symptom: Jason reported actual cost 5-6k VND vs estimate 400-600 VND
 *     (~10x off). After fix, estimate ~ actual (within ±20%).
 *   - Pricing for batch/cached prompts NOT applied — KSP uses standard interactive.
 */
const PROVIDER_PRICING: Record<CostProvider, { inputPerToken: number; outputPerToken: number }> = {
  "gemini-flash": {
    // Gemini 2.5 Flash standard interactive — $0.30 input / $2.50 output per 1M tokens
    inputPerToken: 0.30 / 1_000_000,
    outputPerToken: 2.50 / 1_000_000,
  },
  "gemini-pro": {
    // Gemini 2.5 Pro standard interactive (≤200K context) — $1.25 input / $10 output per 1M
    inputPerToken: 1.25 / 1_000_000,
    outputPerToken: 10.0 / 1_000_000,
  },
  "openai-4o": {
    // GPT-4o — $2.50 input / $10 output per 1M
    inputPerToken: 2.50 / 1_000_000,
    outputPerToken: 10.0 / 1_000_000,
  },
};

/**
 * GPT Image 2 (OpenAI Images API) prices per generation, fixed.
 * High quality is what KSP uses by default for character concept sheets.
 */
const IMAGE_PRICING: Record<ImageQuality, number> = {
  high: 0.21,
  low: 0.04,
};

/**
 * USD to VND exchange rate used for display. Updated periodically.
 * Slightly conservative (real rate ~25.4k as of writing) to err on the high side.
 */
export const USD_TO_VND = 25500;

export interface TextCostEvent {
  kind: "text";
  provider: CostProvider;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ts: number;
}

export interface ImageCostEvent {
  kind: "image";
  quality: ImageQuality;
  costUsd: number;
  ts: number;
}

export type CostEvent = TextCostEvent | ImageCostEvent;

export function calculateTextCostUsd(
  provider: CostProvider,
  inputTokens: number,
  outputTokens: number
): number {
  const price = PROVIDER_PRICING[provider];
  if (!price) return 0;
  return inputTokens * price.inputPerToken + outputTokens * price.outputPerToken;
}

export function calculateImageCostUsd(quality: ImageQuality): number {
  return IMAGE_PRICING[quality] ?? 0;
}

// ============================================================================
// EMITTER — module-level pub/sub
// ============================================================================

type Listener = (event: CostEvent) => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to cost events. Returns an unsubscribe function.
 * Multiple subscribers OK (e.g. cost tracker store + per-stage badge).
 */
export function subscribeCost(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Emit a cost event after a text AI call completes. Token counts come from
 * the provider's response usage metadata (Gemini: usageMetadata, OpenAI: usage).
 *
 * Safe to call with zero tokens — emitter will still fire but cost will be 0.
 */
export function emitTextCost(
  provider: CostProvider,
  inputTokens: number,
  outputTokens: number
): void {
  const costUsd = calculateTextCostUsd(provider, inputTokens, outputTokens);
  const event: TextCostEvent = {
    kind: "text",
    provider,
    inputTokens,
    outputTokens,
    costUsd,
    ts: Date.now(),
  };
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      // Don't let a buggy listener break others or the AI call flow.
      console.error("[CostTracker] listener threw:", err);
    }
  });
}

/**
 * Emit a cost event after an image AI generation completes.
 */
export function emitImageCost(quality: ImageQuality): void {
  const costUsd = calculateImageCostUsd(quality);
  const event: ImageCostEvent = {
    kind: "image",
    quality,
    costUsd,
    ts: Date.now(),
  };
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      console.error("[CostTracker] listener threw:", err);
    }
  });
}

export function formatUsd(costUsd: number): string {
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  if (costUsd < 1) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(2)}`;
}

export function formatVnd(costUsd: number): string {
  const vnd = Math.round(costUsd * USD_TO_VND);
  if (vnd < 1000) return `${vnd} VND`;
  // Use Vietnamese-style thousands separator (period)
  return `${vnd.toLocaleString("vi-VN")} VND`;
}
