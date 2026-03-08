import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';
import ReActAgent from '../ReAct';
import { Prompt } from '../../PromptBuilder';
import { createPrompt } from './prompt';

@agent(AgentIds.FINANCIAL)
export default class FinancialAgent extends ReActAgent {
  declare readonly id: string;
  declare readonly config: AgentConfig;
  declare protected readonly logger: Logger;
  declare readonly tools: any[];

  readonly maxIterations: number = 10;

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }
}
