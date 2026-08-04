import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { container } from 'tsyringe';
import {
  CacheProvider,
  PREVIEW_LENGTH,
} from '@/server/modules/agent/infrastructure/cache.provider';
import type { CachedReference } from '@/server/modules/agent/domain/port/cache.port';
import { WorkspaceLocalStore } from '@/server/libs/infrastructure/workspace-local-store';

let testDir: string;

const mockWorkspaceService = {
  getWorkDir: vi.fn().mockImplementation(async () => {
    if (!testDir) {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-test-'));
    }
    return testDir;
  }),
};

describe('CacheProvider', () => {
  let cacheService: CacheProvider;
  let workDir: string;

  afterAll(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    container.register(WorkspaceLocalStore, {
      useValue: new WorkspaceLocalStore(),
    });
    cacheService = container.resolve(CacheProvider);
    workDir = await mockWorkspaceService.getWorkDir();
  });

  describe('offload', () => {
    it('always writes to disk and returns a CachedReference (even for small content)', async () => {
      const result = await cacheService.offload(workDir, 'tiny');

      expect(result.$cached).toMatch(/^\.langvis\/offload\/fc_/);
      expect(result.$size).toBe(4);
      expect(result.$preview).toBe('tiny');
      // offload 始终写盘，小内容也落文件
      const reread = await fs.readFile(
        path.join(workDir, result.$cached),
        'utf-8',
      );
      expect(reread).toBe('tiny');
    });

    it('truncates $preview to PREVIEW_LENGTH for long content', async () => {
      const long = 'a'.repeat(PREVIEW_LENGTH + 50);
      const result = await cacheService.offload(workDir, long);
      expect(result.$preview).toBe('a'.repeat(PREVIEW_LENGTH));
    });

    it('uses semantic filename + $label when hint given', async () => {
      const result = (await cacheService.offload(
        workDir,
        'x'.repeat(500),
        'search-flights 京→沪, 40 records',
      )) as CachedReference;

      // hint 规整为文件名安全段，前置语义 + '__' + fc_<id>
      expect(result.$cached).toMatch(
        /^\.langvis\/offload\/search-flights-40-records__fc_/,
      );
      expect(result.$label).toBe('search-flights-40-records');
      expect(result.$size).toBe(500);
    });

    it('falls back to fc_<id> when hint absent or empty', async () => {
      const noHint = await cacheService.offload(workDir, 'data');
      expect(noHint.$cached).toMatch(/^\.langvis\/offload\/fc_/);
      expect(noHint.$label).toBeUndefined();

      const emptyHint = await cacheService.offload(workDir, 'data', '   ');
      expect(emptyHint.$cached).toMatch(/^\.langvis\/offload\/fc_/);
      expect(emptyHint.$label).toBeUndefined();
    });

    it('offloads non-string value by JSON-stringifying', async () => {
      const obj = { flights: [{ id: 'f1' }, { id: 'f2' }] };
      const result = await cacheService.offload(workDir, obj, 'search-flights');
      const reread = JSON.parse(
        await fs.readFile(path.join(workDir, result.$cached), 'utf-8'),
      ) as Record<string, unknown>;
      expect(reread).toEqual(obj);
    });

    it('reflow 解码 untrusted 包裹内 JSON 转义（\\n/\\"），盘上存真字符', async () => {
      // 模拟 observation getter 对 bash 对象 stringify 后再 wrapUntrusted 的产物（含字面 \n / \"）。
      const obs =
        '<untrusted_content>\n' +
        '{"exitCode":0,"stdout":"line1\\nline2 \\"q\\""}' +
        '\n</untrusted_content>';
      const ref = await cacheService.offload(workDir, obs, 'bash-cat');
      const disk = await fs.readFile(path.join(workDir, ref.$cached), 'utf-8');
      expect(disk).not.toContain('\\'); // 转义全解回真字符，无残留反斜杠
      expect(disk).toContain('line1\nline2'); // \n 解为真换行
      expect(disk).toContain('"q"'); // \" 解为真引号
    });

    it('紧凑 JSON 裂行：search_flights 单行 {"flights":[...]} → 多行，rg -C3 可切片', async () => {
      // 无转义的紧凑 JSON（真实 search_flights Observation 形）——unescape no-op，
      // 靠结构化 pretty-print 裂行：每字段/每元素一行，否则 rg 一命中回整条。
      const obj = {
        flights: [
          { id: 'f1', flightNo: 'CA1000', price: 800 },
          { id: 'f2', flightNo: 'MU1001', price: 837 },
        ],
      };
      const ref = await cacheService.offload(workDir, obj, 'search-flights');
      const disk = await fs.readFile(path.join(workDir, ref.$cached), 'utf-8');
      expect(disk).toContain('\n'); // 已裂多行
      expect(disk).toContain('"flights":');
      expect(disk).toContain('"flightNo": "CA1000"'); // 元素单独成行
      // resolve 回路仍等价（缩进 JSON.parse 还原原值）
      expect(JSON.parse(disk)).toEqual(obj);
    });

    it('cat 循环不滚雪球：二代 offload 转义层数不翻倍', async () => {
      // 一代：offload stringified bash 结果。
      const obs0 =
        '<untrusted_content>\n' +
        '{"exitCode":0,"stdout":"line1\\nline2 \\"q\\""}' +
        '\n</untrusted_content>';
      const ref0 = await cacheService.offload(workDir, obs0, 'bash-cat');
      const disk0 = await fs.readFile(
        path.join(workDir, ref0.$cached),
        'utf-8',
      );

      // 二代：模拟 agent cat 一代文件 → bash 返回 {stdout: 一代盘内容} → stringify → 新 observation。
      const obs1 =
        '<untrusted_content>\n' +
        JSON.stringify({ exitCode: 0, stdout: disk0 }) +
        '\n</untrusted_content>';
      const ref1 = await cacheService.offload(workDir, obs1, 'bash-cat');
      const disk1 = await fs.readFile(
        path.join(workDir, ref1.$cached),
        'utf-8',
      );

      expect(disk1).not.toContain('\\\\'); // 无翻倍反斜杠（雪球标志）
      expect(disk1).not.toContain('\\"'); // 无残留 \"
      expect(disk1).toContain('line1\nline2'); // 真换行保留
    });
  });
});
