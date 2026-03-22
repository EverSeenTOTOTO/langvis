import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';
import { Agent } from '..';
import { Tool } from '../../tool';
import { Prompt } from '../../PromptBuilder';
import ReActAgent from '../ReAct';
import { createPrompt } from './prompt';

@agent(AgentIds.FINANCIAL)
export default class FinancialAgent extends ReActAgent {
  declare readonly id: string;
  declare readonly config: AgentConfig;
  declare protected readonly logger: Logger;
  declare readonly tools: Tool[];
  declare readonly agents: Agent[];

  readonly maxIterations: number = 10;

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }
}
