import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.REACT,
  name: 'Document Agent',
  description:
    'An agent for document archiving and retrieval. Can fetch documents from URLs, archive them with metadata and embeddings, and perform semantic search.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            default: 'glm-5',
          },
        },
      },
    },
  } as any,
  tools: [
    ToolIds.WEB_FETCH,
    ToolIds.DOCUMENT_ARCHIVE,
    ToolIds.DOCUMENT_SEARCH,
    ToolIds.CACHED_READ,
    ToolIds.LINKS_EXTRACT,
    ToolIds.DOCUMENT_ARCHIVE_BATCH,
    ToolIds.ASK_USER,
  ],
};
