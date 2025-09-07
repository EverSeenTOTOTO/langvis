import type { Request, Response } from 'express';
import { singleton } from 'tsyringe';
import ReActAgent from '../core/agent/ReAct';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';

@singleton()
@controller('/api/agent')
export class AgentController {
  readonly agents = [ReActAgent];

  @api('/', { method: 'get' })
  async getAllAgents(_req: Request, res: Response) {
    return res.json(
      this.agents.map(agent => ({
        name: agent.Name,
        description: agent.Description,
      })),
    );
  }
}
