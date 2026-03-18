import {
  resolveTier,
  getDefaultTiers,
  resolveProviderConfigs,
  scheduleTypeToTier,
  type ModelTier,
  type ModelTierMap,
} from '../model-tiers';

describe('model-tiers', () => {
  // ---------------------------------------------------------------------------
  // getDefaultTiers
  // ---------------------------------------------------------------------------
  describe('getDefaultTiers', () => {
    it('returns all three tiers', () => {
      const tiers = getDefaultTiers();
      expect(tiers).toHaveProperty('heartbeat');
      expect(tiers).toHaveProperty('standard');
      expect(tiers).toHaveProperty('strategic');
    });

    it('returns a shallow copy (not the same reference)', () => {
      const a = getDefaultTiers();
      const b = getDefaultTiers();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('heartbeat uses haiku', () => {
      expect(getDefaultTiers().heartbeat.model).toMatch(/haiku/);
    });

    it('standard uses sonnet', () => {
      expect(getDefaultTiers().standard.model).toMatch(/sonnet/);
    });

    it('strategic uses opus', () => {
      expect(getDefaultTiers().strategic.model).toMatch(/opus/);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveTier
  // ---------------------------------------------------------------------------
  describe('resolveTier', () => {
    it('returns defaults when no custom tiers provided', () => {
      const cfg = resolveTier('heartbeat');
      expect(cfg.provider).toBe('anthropic');
      expect(cfg.model).toMatch(/haiku/);
    });

    it('returns defaults when customTiers is null', () => {
      const cfg = resolveTier('standard', null);
      expect(cfg.model).toMatch(/sonnet/);
    });

    it('merges custom overrides over defaults', () => {
      const custom: Partial<ModelTierMap> = {
        heartbeat: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          maxTokens: 1024,
        },
      };
      const cfg = resolveTier('heartbeat', custom);
      expect(cfg.provider).toBe('openai');
      expect(cfg.model).toBe('gpt-4o-mini');
      expect(cfg.maxTokens).toBe(1024);
      // temperature should come from default
      expect(cfg.temperature).toBe(0.5);
    });

    it('does not affect other tiers when only one is overridden', () => {
      const custom: Partial<ModelTierMap> = {
        heartbeat: { provider: 'openai', model: 'gpt-4o-mini' },
      };
      const standard = resolveTier('standard', custom);
      expect(standard.model).toMatch(/sonnet/);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveProviderConfigs
  // ---------------------------------------------------------------------------
  describe('resolveProviderConfigs', () => {
    it('returns tier-based config when no agent override', () => {
      const { primary, fallback } = resolveProviderConfigs('heartbeat');
      expect(primary.provider).toBe('anthropic');
      expect(primary.model).toMatch(/haiku/);
      expect(primary.maxTokens).toBe(2048);
      expect(primary.temperature).toBe(0.5);
      expect(fallback).toBeUndefined();
    });

    it('returns fallback when tier config has fallback fields', () => {
      const custom: Partial<ModelTierMap> = {
        standard: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          fallbackProvider: 'openai',
          fallbackModel: 'gpt-4o',
        },
      };
      const { primary, fallback } = resolveProviderConfigs('standard', custom);
      expect(primary.provider).toBe('anthropic');
      expect(fallback).toBeDefined();
      expect(fallback!.provider).toBe('openai');
      expect(fallback!.model).toBe('gpt-4o');
    });

    it('agent override takes priority over tier config', () => {
      const { primary } = resolveProviderConfigs('heartbeat', null, {
        providerPrimary: 'gemini',
        modelPrimary: 'gemini-2.0-flash',
      });
      expect(primary.provider).toBe('gemini');
      expect(primary.model).toBe('gemini-2.0-flash');
    });

    it('agent override includes fallback when provided', () => {
      const { primary, fallback } = resolveProviderConfigs('heartbeat', null, {
        providerPrimary: 'openai',
        modelPrimary: 'gpt-4o',
        providerFallback: 'anthropic',
        modelFallback: 'claude-sonnet-4-6',
      });
      expect(primary.provider).toBe('openai');
      expect(fallback).toBeDefined();
      expect(fallback!.provider).toBe('anthropic');
    });

    it('ignores agent override when providerPrimary is missing', () => {
      const { primary } = resolveProviderConfigs('strategic', null, {
        modelPrimary: 'gpt-4o',
      });
      // Should fall through to tier config
      expect(primary.model).toMatch(/opus/);
    });

    it('ignores agent override when modelPrimary is missing', () => {
      const { primary } = resolveProviderConfigs('strategic', null, {
        providerPrimary: 'openai',
      });
      expect(primary.model).toMatch(/opus/);
    });
  });

  // ---------------------------------------------------------------------------
  // scheduleTypeToTier
  // ---------------------------------------------------------------------------
  describe('scheduleTypeToTier', () => {
    it.each([
      ['heartbeat', 'heartbeat'],
      ['check_in', 'heartbeat'],
    ] as const)('maps "%s" to heartbeat tier', (input, expected) => {
      expect(scheduleTypeToTier(input)).toBe(expected);
    });

    it.each([
      ['strategy', 'strategic'],
      ['planning', 'strategic'],
      ['review', 'strategic'],
    ] as const)('maps "%s" to strategic tier', (input, expected) => {
      expect(scheduleTypeToTier(input)).toBe(expected);
    });

    it.each(['task', 'execute', 'unknown', ''])(
      'maps "%s" to standard tier (default)',
      (input) => {
        expect(scheduleTypeToTier(input)).toBe('standard');
      },
    );
  });
});
