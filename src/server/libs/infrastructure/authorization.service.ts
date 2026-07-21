import { promises as fs } from 'fs';
import path from 'node:path';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

/**
 * 会话级授权授予的低层持久设施——与 WorkspaceService 同层。
 *
 * grant 记录唯一真相源是 workDir 里的一个文件（`.langvis-auth-grants.json`），
 * 服务本身**无状态**：每次调用现读/现写。会话激活/失活/重启文件都在
 * （同日 workDir 路径稳定），故无需 LRU/TTL/SessionDisposed 失效机制——
 * 文件随 workDir 生灭（/tmp 清理或日期翻转即天然边界）。
 *
 * 单写者：仅顶层 interactive run 经 AuthorizationProvider.append 写；子 agent
 * 非 interactive 不写，故无并发。本服务不感知 workDir 的语义，只读写约定文件。
 */
const GRANTS_FILENAME = '.langvis-auth-grants.json';

@service()
export class AuthorizationService {
  constructor(
    @inject(WorkspaceService)
    private readonly workspace: WorkspaceService,
  ) {}

  async hasGrant(conversationId: string, key: string): Promise<boolean> {
    const grants = await this.loadGrants(conversationId);
    return grants.has(key);
  }

  async addGrant(conversationId: string, key: string): Promise<void> {
    const workDir = await this.workspace.getWorkDir(conversationId);
    const filePath = path.join(workDir, GRANTS_FILENAME);
    const grants = await this.readGrantsFile(filePath);
    if (grants.has(key)) return;
    grants.add(key);
    await this.writeGrantsFile(filePath, grants);
  }

  /** 一次性读全部授予（供 provider run 内缓存快照 + write-through，真相仍是文件）。 */
  async loadGrants(conversationId: string): Promise<Set<string>> {
    const workDir = await this.workspace.getWorkDir(conversationId);
    return this.readGrantsFile(path.join(workDir, GRANTS_FILENAME));
  }

  private async readGrantsFile(filePath: string): Promise<Set<string>> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.filter((k): k is string => typeof k === 'string'));
    } catch {
      return new Set();
    }
  }

  private async writeGrantsFile(
    filePath: string,
    grants: Set<string>,
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify([...grants], null, 2), 'utf-8');
  }
}
