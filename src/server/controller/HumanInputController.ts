import { SubmitHumanInputRequestDto } from '@/shared/dto/controller';
import { api } from '@/server/decorator/api';
import { controller } from '@/server/decorator/controller';
import { body, param, response } from '@/server/decorator/param';
import type { Response } from 'express';
import { inject } from 'tsyringe';
import { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';

// 以 runId 寻址内存中的活跃 AgentRun 聚合（HITL 待输入状态在其上），提交/查询均委托聚合方法。
@controller('/api/human-input')
export default class HumanInputController {
  constructor(@inject(AgentRunExecutor) private executor: AgentRunExecutor) {}

  @api('/:runId', { method: 'post' })
  async submitInput(
    @param('runId') runId: string,
    @body() dto: SubmitHumanInputRequestDto,
    @response() res: Response,
  ) {
    const result =
      this.executor.getActiveRun(runId)?.submitInput(dto.data) ?? 'not_found';

    if (result === 'not_found') {
      return res.status(404).json({
        success: false,
        error: 'Request not found or expired',
      });
    }

    if (result === 'already_submitted') {
      return res.status(400).json({
        success: false,
        error: 'Request already submitted',
      });
    }

    return res.json({ success: true });
  }

  @api('/:runId', { method: 'get' })
  async getStatus(@param('runId') runId: string, @response() res: Response) {
    const status = this.executor.getActiveRun(runId)?.inputStatus();

    if (!status) {
      return res.json({ exists: false });
    }

    return res.json(status);
  }
}
