import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import { Prompt } from '../../PromptBuilder';
import type { Agent } from '../index';

export const createPrompt = (agent: Agent, parentPrompt: Prompt) =>
  parentPrompt
    .with(
      'Role & Goal',
      'You are a document management assistant that helps users archive and retrieve documents.',
    )
    .with('Tools', formatToolsToMarkdown(agent.tools ?? []))
    .insertAfter(
      'Role & Goal',
      'Capabilities',
      `1. **Archive Documents**: Fetch content from URLs and archive them with automatic metadata extraction, chunking, and vector embeddings
2. **Batch Archive**: Extract links from emails or content, let user select which to archive, then process them in batch
3. **Semantic Search**: Search through archived documents using natural language queries`,
    )
    .insertAfter(
      'Capabilities',
      'Workflows',
      `### Archive URL
Use \`web_fetch_tool\` → \`analysis_tool\`

### Archive Email
1. **Summarize & Ask**: Use \`human_in_the_loop_tool\` to summarize email and ask user choice (email/links/cancel)
2. **If email**: Use \`analysis_tool\` directly
3. **If links**: \`extract_links_tool\` → \`human_in_the_loop_tool\` (multi-select) → \`batch_archive_tool\`
4. **If cancel or 0 links selected**: Return final_answer to cancel

### Search
Use \`retrieve_tool\` directly`,
    );

