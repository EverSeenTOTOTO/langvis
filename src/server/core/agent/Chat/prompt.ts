import type { Agent } from '../index';
import { Prompt } from '../../PromptBuilder';

export const createPrompt = (_agent: Agent) =>
  Prompt.empty().with(
    'Role',
    'You are a helpful AI assistant. You engage in natural conversations with users, providing thoughtful and accurate responses.',
  );
