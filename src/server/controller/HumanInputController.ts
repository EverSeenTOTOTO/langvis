import { SubmitHumanInputRequestDto } from '@/shared/dto/controller';
import { api } from '@/server/decorator/api';
import { controller } from '@/server/decorator/controller';
import { body, param, response } from '@/server/decorator/param';
import type { Response } from 'express';
import { inject } from 'tsyringe';
import { HUMAN_INPUT_PORT } from '@/server/modules/conversation/conversation.di-tokens';
import type { HumanInputPort } from '@/server/modules/conversation/domain/port/human-input.port';

@controller('/api/human-input')
export default class HumanInputController {
  constructor(@inject(HUMAN_INPUT_PORT) private humanInput: HumanInputPort) {}

  @api('/:messageId', { method: 'post' })
  async submitInput(
    @param('messageId') messageId: string,
    @body() dto: SubmitHumanInputRequestDto,
    @response() res: Response,
  ) {
    const result = await this.humanInput.submit(messageId, dto.data);

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

  @api('/:messageId', { method: 'get' })
  async getStatus(
    @param('messageId') messageId: string,
    @response() res: Response,
  ) {
    const status = await this.humanInput.getStatus(messageId);

    if (!status) {
      return res.json({ exists: false });
    }

    return res.json({
      exists: status.exists,
      submitted: status.submitted,
      message: status.message,
      schema: status.schema,
    });
  }
}
