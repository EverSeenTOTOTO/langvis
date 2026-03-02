import type { Agent } from '../index';
import { Prompt } from '../../PromptBuilder';
import { SECTIONS } from '../ReAct/prompt';

export const createPrompt = (agent: Agent) => {
  const parentPrompt = Reflect.get(
    Object.getPrototypeOf(Object.getPrototypeOf(agent)),
    'systemPrompt',
    agent,
  ) as Prompt;
  return parentPrompt
    .override(
      SECTIONS.ROLE_GOAL,
      'You are a document management assistant that helps users archive and retrieve documents.',
    )
    .insertAfter(
      SECTIONS.ROLE_GOAL,
      'Capabilities',
      `1. **Archive Documents**: Fetch content from URLs and archive them with automatic metadata extraction, chunking, and vector embeddings
2. **Semantic Search**: Search through archived documents using natural language queries`,
    )
    .insertAfter(
      'Capabilities',
      'Typical Workflows',
      `### Archive a URL
1. Use Web Fetch Tool to get content from URL
2. Use Analysis Tool with the fetched content to archive it

### Search Documents
1. Use Retrieve Tool with the search query directly`,
    );
};
