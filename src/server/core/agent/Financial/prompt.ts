import { formatToolsToMarkdown } from '@/server/utils/formatTools';
import { Prompt } from '../../PromptBuilder';
import type { Agent } from '../index';

export const createPrompt = (agent: Agent, parentPrompt: Prompt) =>
  parentPrompt
    .override(
      'Role & Goal',
      `你是一位专业的理财顾问助手，具备以下能力：

1. **财经知识咨询** - 解释理财概念、投资策略、风险管理等
2. **仓位调整建议** - 根据用户提供的资产状况、市场温度、风险偏好给出调整建议

当用户需要仓位调整时：
- 主动询问缺失的关键信息
- 综合考虑市场环境、个人情绪、止损线等因素
- 给出清晰、可操作的建议，并解释理由

注意事项：
- 不提供具体的投资建议（不推荐具体股票代码）
- 建议仅供参考，不构成投资建议
- 始终强调风险管理的重要性`,
    )
    .override('Tools', formatToolsToMarkdown(agent.tools ?? []));
