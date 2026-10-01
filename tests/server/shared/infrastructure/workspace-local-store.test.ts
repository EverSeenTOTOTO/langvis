import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceLocalStore } from '@/server/libs/infrastructure/workspace-local-store';

describe('WorkspaceLocalStore', () => {
  let store: WorkspaceLocalStore;
  let workDir: string;

  beforeEach(async () => {
    store = new WorkspaceLocalStore();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wslocal-'));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  describe('readSection / writeSection', () => {
    it('缺失 → null；写入后可读回', async () => {
      expect(await store.readSection(workDir, 'grants')).toBeNull();
      await store.writeSection(workDir, 'grants', ['read-path:/etc']);
      expect(await store.readSection(workDir, 'grants')).toEqual([
        'read-path:/etc',
      ]);
    });

    it('落到 <workDir>/.langvis/<name>.json', async () => {
      await store.writeSection(workDir, 'grants', { foo: 1 });
      const raw = await fs.readFile(
        path.join(workDir, '.langvis', 'grants.json'),
        'utf-8',
      );
      expect(JSON.parse(raw)).toEqual({ foo: 1 });
    });

    it('name=config → .langvis/config.json（兼容旧文件位）', async () => {
      await store.writeSection(workDir, 'config', { model: { modelId: 'g' } });
      const raw = await fs.readFile(
        path.join(workDir, '.langvis', 'config.json'),
        'utf-8',
      );
      expect(JSON.parse(raw)).toMatchObject({ model: { modelId: 'g' } });
    });
  });

  describe('reserveBlob', () => {
    it('预建组目录并返回 workDir 相对路径，可写入', async () => {
      const rel = await store.reserveBlob(workDir, 'offload', 'fc_1');
      expect(rel).toBe(path.join('.langvis', 'offload', 'fc_1'));
      await fs.writeFile(path.join(workDir, rel), 'payload');
      expect(await fs.readFile(path.join(workDir, rel), 'utf-8')).toBe(
        'payload',
      );
    });
  });
});
