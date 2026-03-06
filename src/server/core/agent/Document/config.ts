import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.REACT,
  name: 'Document Agent',
  description:
    'An agent for document archiving and retrieval. Can fetch documents from URLs, archive them with metadata and embeddings, and perform semantic search.',
  tools: [
    ToolIds.WEB_FETCH,
    ToolIds.ANALYSIS,
    ToolIds.RETRIEVE,
    ToolIds.READ_CACHE,
  ],
};
