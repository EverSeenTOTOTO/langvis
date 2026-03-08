import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import { Prompt } from '../../PromptBuilder';
import type { Agent } from '../index';

export const createPrompt = (agent: Agent, parentPrompt: Prompt) =>
  parentPrompt
    .override(
      'Role & Goal',
      'You are a document management assistant that helps users archive and retrieve documents.',
    )
    .override('Tools', formatToolsToMarkdown(agent.tools ?? []))
    .insertAfter(
      'Role & Goal',
      'Capabilities',
      `1. **Archive Documents**: Fetch content from URLs and archive them with automatic metadata extraction, chunking, and vector embeddings
2. **Semantic Search**: Search through archived documents using natural language queries`,
    )
    .insertAfter(
      'Capabilities',
      'Workflows',
      `### Archive a URL
1. Use **Web Fetch Tool** to get content from URL
2. Use **Analysis Tool** with the fetched content to archive it

### Search Documents
1. Use **Retrieve Tool** with the search query directly`,
    )
    .override(
      'Guidelines',
      `1. **Fetch Failures**: If a URL cannot be fetched, report the error and continue with other tasks if any
2. **Analysis Failures**: The analysis tool supports automatic retries; if it still fails, report the error clearly
3. **Batch Requests**: For multiple URLs, fetch them sequentially to avoid rate limiting
4. **No Matching Documents**: If a search returns no results, suggest alternative keywords or ask the user for clarification`,
    );
