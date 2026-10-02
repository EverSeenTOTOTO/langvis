import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { renderDirectoryTree } from '@/server/infrastructure/workspace/directory-tree';

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'langvis-tree-'));
  await fs.mkdir(path.join(root, 'src', 'server'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'left-pad'), {
    recursive: true,
  });
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'x');
  await fs.writeFile(path.join(root, 'src', 'server', 'b.ts'), 'y');
  await fs.writeFile(path.join(root, 'README.md'), 'z');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('renderDirectoryTree', () => {
  it('渲染目录树：文件+子目录+截断标记+忽略目录不展开', async () => {
    const out = await renderDirectoryTree(root);
    expect(out).toContain(`Directory structure (up to 200 items`);
    expect(out).toContain(`${root}/`);
    expect(out).toContain('├── README.md');
    expect(out).toContain('└── src/'); // src 是 root 最后一个子项
    expect(out).toContain('├── a.ts');
    expect(out).toContain('└── server/');
    expect(out).toContain('└── b.ts');
    // node_modules 被忽略：目录名出现但不展开内部
    expect(out).toMatch(/node_modules\/ ?…/);
    expect(out).not.toContain('left-pad');
  });

  it('不可读根目录仍返回带截断标记的文本（不抛）', async () => {
    const out = await renderDirectoryTree(
      path.join(root, 'src', 'a.ts', 'not-a-dir'),
    );
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
