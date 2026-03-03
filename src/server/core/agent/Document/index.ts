import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';
import { Prompt } from '../../PromptBuilder';
import ReActAgent from '../ReAct';
import { createPrompt } from './prompt';

@agent(AgentIds.DOCUMENT)
export default class DocumentAgent extends ReActAgent {
  declare readonly config: AgentConfig;
  declare protected readonly logger: Logger;

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }
}

export { config } from './config';
