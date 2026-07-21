import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'node:path';
import { AuthorizationService } from '@/server/libs/infrastructure/authorization.service';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

async function readGrants(workDir: string): Promise<unknown> {
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(workDir, '.langvis-auth-grants.json'),
        'utf-8',
      ),
    );
  } catch {
    return null;
  }
}

describe('AuthorizationService', () => {
  let workspace: WorkspaceService;
  let service: AuthorizationService;
  const convIds: string[] = [];

  beforeEach(() => {
    workspace = new WorkspaceService();
    service = new AuthorizationService(workspace);
    convIds.push(`conv-test-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    // 清理本批会话目录
    for (const id of convIds) {
      const dir = await workspace.getWorkDir(id);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('hasGrant 缺失文件 → false', async () => {
    const conv = convIds[convIds.length - 1]!;
    expect(await service.hasGrant(conv, 'read-path:/etc')).toBe(false);
  });

  it('addGrant → 写文件 → hasGrant true', async () => {
    const conv = convIds[convIds.length - 1]!;
    await service.addGrant(conv, 'read-path:/etc');
    expect(await service.hasGrant(conv, 'read-path:/etc')).toBe(true);
    const workDir = await workspace.getWorkDir(conv);
    expect(await readGrants(workDir)).toEqual(['read-path:/etc']);
  });

  it('重复 addGrant 幂等（不重复写）', async () => {
    const conv = convIds[convIds.length - 1]!;
    await service.addGrant(conv, 'read-path:/etc');
    await service.addGrant(conv, 'read-path:/etc');
    const workDir = await workspace.getWorkDir(conv);
    expect(await readGrants(workDir)).toEqual(['read-path:/etc']);
  });

  it('loadGrants 返回全部授予', async () => {
    const conv = convIds[convIds.length - 1]!;
    await service.addGrant(conv, 'read-path:/etc');
    await service.addGrant(conv, 'exec-cmd:bash:abc');
    const grants = await service.loadGrants(conv);
    expect(grants.size).toBe(2);
    expect(grants.has('read-path:/etc')).toBe(true);
    expect(grants.has('exec-cmd:bash:abc')).toBe(true);
  });

  it('跨“run”（同 convId 新实例）复用文件——会话持久', async () => {
    const conv = convIds[convIds.length - 1]!;
    await service.addGrant(conv, 'read-path:/etc');
    // 模拟会话失活再激活：新 service 实例，同 conversationId → 同 workDir → 同文件
    const resurrected = new AuthorizationService(workspace);
    expect(await resurrected.hasGrant(conv, 'read-path:/etc')).toBe(true);
  });
});
