/**
 * @module model-tiers
 * @description
 * Model tier routing — assign different LLM models to different task types.
 *
 * Tiers:
 *   - heartbeat: cheap/fast models for routine check-ins (haiku)
 *   - standard: balanced models for day-to-day work (sonnet)
 *   - strategic: most capable models for high-stakes decisions (opus)
 *
 * Resolution priority: Agent-level override > OrchestratorConfig tier > Default tier
 */

import type { ProviderConfig } from './agent-runtime/providers';

export type ModelTier = 'heartbeat' | 'standard' | 'strategic';

export interface TierConfig {
  provider: string;
  model: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export type ModelTierMap = Record<ModelTier, TierConfig>;

const DEFAULT_TIERS: ModelTierMap = {
  heartbeat: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    temperature: 0.5,
  },
  standard: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    temperature: 0.7,
  },
  strategic: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 8192,
    temperature: 0.7,
  },
};

/**
 * Resolve the config for a given tier, merging custom config over defaults.
 */
export function resolveTier(
  tier: ModelTier,
  customTiers?: Partial<ModelTierMap> | null,
): TierConfig {
  const base = DEFAULT_TIERS[tier];
  const override = customTiers?.[tier];
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Get the default tier map (for seeding / display).
 */
export function getDefaultTiers(): ModelTierMap {
  return { ...DEFAULT_TIERS };
}

/**
 * Convert a TierConfig into ProviderConfig(s) suitable for callLLM().
 *
 * If the agent has its own provider/model set, those take priority (returned as-is).
 */
export function resolveProviderConfigs(
  tier: ModelTier,
  customTiers?: Partial<ModelTierMap> | null,
  agentOverride?: {
    providerPrimary?: string | null;
    modelPrimary?: string | null;
    providerFallback?: string | null;
    modelFallback?: string | null;
  },
): { primary: ProviderConfig; fallback?: ProviderConfig } {
  // Agent-level override takes priority
  if (agentOverride?.providerPrimary && agentOverride?.modelPrimary) {
    const primary: ProviderConfig = {
      provider: agentOverride.providerPrimary as ProviderConfig['provider'],
      model: agentOverride.modelPrimary,
    };
    const fallback =
      agentOverride.providerFallback && agentOverride.modelFallback
        ? {
            provider: agentOverride.providerFallback as ProviderConfig['provider'],
            model: agentOverride.modelFallback,
          }
        : undefined;
    return { primary, fallback };
  }

  // Fall back to tier config
  const tierConfig = resolveTier(tier, customTiers);
  const primary: ProviderConfig = {
    provider: tierConfig.provider as ProviderConfig['provider'],
    model: tierConfig.model,
    maxTokens: tierConfig.maxTokens,
    temperature: tierConfig.temperature,
  };

  const fallback =
    tierConfig.fallbackProvider && tierConfig.fallbackModel
      ? {
          provider: tierConfig.fallbackProvider as ProviderConfig['provider'],
          model: tierConfig.fallbackModel,
        }
      : undefined;

  return { primary, fallback };
}

/**
 * Determine the appropriate tier for a schedule type.
 */
export function scheduleTypeToTier(scheduleType: string): ModelTier {
  switch (scheduleType) {
    case 'heartbeat':
    case 'check_in':
      return 'heartbeat';
    case 'strategy':
    case 'planning':
    case 'review':
      return 'strategic';
    default:
      return 'standard';
  }
}
