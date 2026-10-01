import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { AgentRunExecutor } from './application/service/agent-run-executor';

// 以 runId 寻址内存中的活跃 AgentRun 聚合（HITL 待输入状态在其上），提交/查询均委托聚合方法。
@Controller('human-input')
export class HumanInputController {
  constructor(@Inject(AgentRunExecutor) private executor: AgentRunExecutor) {}

  @Post(':runId')
  async submitInput(
    @Param('runId') runId: string,
    @Body() dto: { data?: Record<string, unknown> },
  ) {
    const result =
      this.executor.getActiveRun(runId)?.submitInput(dto.data ?? {}) ??
      'not_found';

    if (result === 'not_found') {
      throw new HttpException(
        {
          success: false,
          error: 'Request not found or expired',
        },
        404,
      );
    }

    if (result === 'already_submitted') {
      throw new HttpException(
        {
          success: false,
          error: 'Request already submitted',
        },
        400,
      );
    }

    return { success: true };
  }

  @Get(':runId')
  async getStatus(@Param('runId') runId: string) {
    const status = this.executor.getActiveRun(runId)?.inputStatus();
    if (!status) {
      return { exists: false };
    }
    return status;
  }
}
