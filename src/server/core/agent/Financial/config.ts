import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig } from '@/shared/types';

export const config: AgentConfig = {
  extends: AgentIds.REACT,
  name: 'Financial Agent',
  description:
    'A financial advisor agent that provides investment knowledge and position adjustment advice.',
  tools: [
    ToolIds.ASK_USER,
    ToolIds.POSITION_ADJUSTMENT_ADVICE,
    ToolIds.CACHED_READ,
  ],
};
