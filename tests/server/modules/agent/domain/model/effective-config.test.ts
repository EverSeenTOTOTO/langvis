import { describe, it, expect } from 'vitest';
import { EffectiveConfig } from '@/server/modules/agent/domain/model/effective-config';
import { ConfigValidationError } from '@/server/modules/agent/domain/errors';
import type { AgentConfig, AgentBinding } from '@/shared/types';

describe('EffectiveConfig', () => {
  const simpleAgentConfig: AgentConfig = {
    name: 'Test Agent',
    description: 'A test agent',
    tools: ['tool_a', 'tool_b'],
  };

  const binding: AgentBinding = {
    agentId: 'test-agent',
    config: { model: { modelId: 'gpt-4' }, temperature: 0.7 },
  };

  describe('create', () => {
    it('should merge agentConfig + binding into immutable snapshot', () => {
      const config = EffectiveConfig.create(
        simpleAgentConfig,
        binding,
        'You are helpful',
        8192,
      );

      expect(config.agentId).toBe('test-agent');
      expect(config.agentName).toBe('Test Agent');
      expect(config.systemPrompt).toBe('You are helpful');
      expect(config.tools).toEqual(['tool_a', 'tool_b']);
      expect(config.contextSize).toBe(8192);
      expect(config.runtimeConfig).toEqual({
        model: { modelId: 'gpt-4' },
        temperature: 0.7,
      });
    });

    it('should validate config through configSchema when present', () => {
      const agentConfigWithSchema: AgentConfig = {
        name: 'Schema Agent',
        description: 'Has config schema',
        configSchema: {
          type: 'object',
          properties: {
            temperature: { type: 'number', minimum: 0, maximum: 2 },
          },
          required: ['temperature'],
          additionalProperties: false,
        } as any,
      };

      const validBinding: AgentBinding = {
        agentId: 'schema-agent',
        config: { temperature: 0.5 },
      };

      const config = EffectiveConfig.create(
        agentConfigWithSchema,
        validBinding,
        'prompt',
        4000,
      );

      expect(config.runtimeConfig.temperature).toBe(0.5);
    });

    it('should throw ConfigValidationError on invalid config', () => {
      const agentConfigWithSchema: AgentConfig = {
        name: 'Schema Agent',
        description: 'Has config schema',
        configSchema: {
          type: 'object',
          properties: {
            temperature: { type: 'number', minimum: 0, maximum: 2 },
          },
          required: ['temperature'],
          additionalProperties: false,
        } as any,
      };

      const invalidBinding: AgentBinding = {
        agentId: 'schema-agent',
        config: { temperature: 5 }, // exceeds maximum
      };

      expect(() =>
        EffectiveConfig.create(
          agentConfigWithSchema,
          invalidBinding,
          'prompt',
          4000,
        ),
      ).toThrow(ConfigValidationError);
    });

    it('should shallow-copy config when no configSchema present', () => {
      const config = EffectiveConfig.create(
        simpleAgentConfig,
        binding,
        'prompt',
        4000,
      );

      // runtimeConfig is a copy, not the original binding.config
      expect(config.runtimeConfig).not.toBe(binding.config);
      expect(config.runtimeConfig).toEqual(binding.config);
    });

    it('should produce frozen object', () => {
      const config = EffectiveConfig.create(
        simpleAgentConfig,
        binding,
        'prompt',
        4000,
      );

      expect(Object.isFrozen(config)).toBe(true);
      expect(() => ((config as any).agentId = 'mutated')).toThrow();
    });

    it('should default tools to empty array when not provided', () => {
      const noToolsConfig: AgentConfig = {
        name: 'No Tools Agent',
        description: 'No tools',
      };

      const config = EffectiveConfig.create(
        noToolsConfig,
        binding,
        'prompt',
        4000,
      );

      expect(config.tools).toEqual([]);
    });
  });
});
