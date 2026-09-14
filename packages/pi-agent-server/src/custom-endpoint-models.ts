export type CustomEndpointInput = 'text' | 'image'

/** Custom endpoint protocol — determines which streaming adapter Pi SDK uses. */
export type CustomEndpointApi = 'openai-completions' | 'anthropic-messages'

export interface CustomEndpointModelDefaults {
  supportsImages?: boolean
}

export interface CustomEndpointModelOverrides {
  contextWindow?: number
  supportsImages?: boolean
}

export interface CustomEndpointModelEntry extends CustomEndpointModelOverrides {
  id: string
}

export type CustomEndpointModelConfig = string | {
  id: string
  contextWindow?: number
  supportsImages?: boolean
}

/** Strip bare model IDs (remove pi/ prefix if present). */
export function stripPiPrefix(id: string): string {
  return id.startsWith('pi/') ? id.slice(3) : id
}

/**
 * Normalize a user-configured custom endpoint model for Pi SDK registration.
 *
 * Keep explicit per-model capability overrides intact. In particular,
 * `supportsImages: false` is meaningful because it can override a global
 * endpoint default of `supportsImages: true` for text-only models.
 */
export function normalizeCustomEndpointModelEntry(model: CustomEndpointModelConfig): CustomEndpointModelEntry {
  if (typeof model === 'string') {
    return { id: stripPiPrefix(model) }
  }

  return {
    id: stripPiPrefix(model.id),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
  }
}

/**
 * Identity mapping for the thinking levels a custom-endpoint model accepts.
 * 'max' is deliberately excluded: OpenAI-compatible team gateways commonly gate
 * 'max' behind per-key permissions (the team Codex gateway rejects it with
 * `reasoning_effort_not_allowed`). pi's clampThinkingLevel degrades a requested
 * 'max' to the nearest supported level ('xhigh'), so sessions pinned to 'max'
 * still run at the highest level the key is allowed to use.
 */
const CUSTOM_ENDPOINT_THINKING_LEVEL_MAP: Record<string, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
}

/**
 * Build a synthetic model definition for a custom endpoint.
 * Uses reasonable defaults for context window and max tokens since we can't
 * query the endpoint for its actual capabilities. Image support must be
 * explicitly enabled either at the connection level or per-model.
 *
 * Reasoning is enabled so craft-side thinking levels pass through as
 * `reasoning_effort`: without `reasoning: true`, pi-ai clamps every level to
 * 'off' and requests carry no effort parameter at all (the model then runs at
 * its own default effort). Only connections that explicitly configure a
 * customEndpoint protocol reach this path; catalog providers keep their own
 * per-model reasoning declarations.
 *
 * For `openai-completions` endpoints we set `compat.supportsStore = false` so the
 * pi-ai driver omits the OpenAI-platform-specific `store` param entirely. Third-party
 * OpenAI-compatible gateways gain nothing from `store`, and strict ones reject unknown
 * params with a 400 — which made those connections unusable. See craft-agents-oss#1022.
 */
export function buildCustomEndpointModelDef(
  id: string,
  defaults?: CustomEndpointModelDefaults,
  overrides?: CustomEndpointModelOverrides,
  api?: CustomEndpointApi,
) {
  const supportsImages = overrides?.supportsImages ?? defaults?.supportsImages ?? false
  const input: CustomEndpointInput[] = supportsImages ? ['text', 'image'] : ['text']

  return {
    id,
    name: id,
    reasoning: true,
    thinkingLevelMap: CUSTOM_ENDPOINT_THINKING_LEVEL_MAP,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: overrides?.contextWindow ?? 131_072,
    maxTokens: 8_192,
    ...(api === 'openai-completions' ? { compat: { supportsStore: false } } : {}),
  }
}
