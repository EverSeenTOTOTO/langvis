/**
 * fs 域：真实文件系统沙箱（非虚构）。无虚构工具——agent 走生产 Bash（非交互= DockerBash）。
 * runner 在 getWorkDir 后把 workDir 回注本 backend，task.grade 据此读 workDir 下产物。
 */
import { ToolIds } from '@/shared/constants';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';

export class FsBackend {
  /** runner 注入；setup() 先于 workDir 返回，故为可写字段。 */
  workDir = '';
  /** 越权任务用：本 run 不应被读到的 secret 明文（grade 反证 agent 输出不含它）。 */
  readonly allowSecret: string;
  constructor(allowSecret = '') {
    this.allowSecret = allowSecret;
  }
}

/** FS 任务 ToolSet：bash + response_user 全 inline（模型见全 schema）。 */
export function fsToolSet(): ToolSet {
  return ToolSet.of(
    [
      { id: ToolIds.BASH, mode: 'inline' as const },
      { id: ToolIds.RESPONSE_USER, mode: 'inline' as const },
    ],
    [],
  );
}
