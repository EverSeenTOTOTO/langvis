import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { resolveSafePath } from '@/server/utils/pathSafety';
import { formatToday, generateId } from '@/shared/utils';
import { renderDirectoryTree } from './directory-tree';

const execFileAsync = promisify(execFile);

export class WorkspaceService {
  private readonly rootDir: string;

  constructor() {
    this.rootDir = path.join('/tmp', 'langvis-workspace');
  }

  /** 会话环境快照（session-context 注入）：日期/平台/git 概要/目录树，逐段降级不抛。 */
  async environmentSnapshot(workDir: string): Promise<string> {
    const [git, tree] = await Promise.all([
      this.gitSummary(workDir),
      renderDirectoryTree(workDir),
    ]);
    return [
      `Today's date: ${formatToday()}`,
      `Platform: ${process.platform} ${os.release()}`,
      `Workspace Directory: ${workDir}`,
      git,
      tree,
    ].join('\n');
  }

  private async gitSummary(workDir: string): Promise<string> {
    try {
      const { stdout: branch } = await execFileAsync(
        'git',
        ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { timeout: 3000 },
      );
      const { stdout: status } = await execFileAsync(
        'git',
        ['-C', workDir, 'status', '--short'],
        { timeout: 3000, maxBuffer: 64 * 1024 },
      );
      const lines = status.split('\n').filter(Boolean);
      const head = lines.slice(0, 15).join('\n');
      const more =
        lines.length > 15 ? `\n… ${lines.length - 15} more entries` : '';
      return `Git: branch ${branch.trim()}, ${lines.length} changed entries${head ? `\n${head}` : ''}${more}`;
    } catch {
      return 'Git: not a repository (or git unavailable)';
    }
  }

  /** Legacy:为 workspacePath 为空的老会话按 conversationId 重新生成 /tmp 沙箱(eval 也用)。新会话走 workspacePath。 */
  async getWorkDir(conversationId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.rootDir, date, conversationId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Web 新会话取一个唯一 /tmp 路径(不落库,只返字符串;由调用方存为 conversation.workspacePath)。 */
  generateEphemeralPath(): string {
    return path.join(this.rootDir, generateId('ws'));
  }

  async readFile(
    filename: string,
    workDir: string,
  ): Promise<{ content: string; size: number } | null> {
    const filePath = resolveSafePath(filename, workDir);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return null;
    if (!stat.isFile()) throw new Error(`Not a file: ${filename}`);
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, size: stat.size };
  }

  async writeFile(
    filename: string,
    content: string,
    workDir: string,
  ): Promise<{ size: number }> {
    const filePath = resolveSafePath(filename, workDir);

    const exists = await fs
      .stat(filePath)
      .then(s => s.isFile())
      .catch(() => false);
    if (exists) {
      throw new Error(
        `File already exists: ${filename}. Use edit_file to modify it.`,
      );
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return { size: Buffer.byteLength(content, 'utf-8') };
  }

  async editFile(
    filename: string,
    oldString: string,
    newString: string,
    workDir: string,
  ): Promise<{ changes: number }> {
    const filePath = resolveSafePath(filename, workDir);

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`File not found: ${filename}`);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const index = content.indexOf(oldString);
    if (index === -1) {
      throw new Error(`old_string not found in ${filename}`);
    }

    const updated =
      content.slice(0, index) +
      newString +
      content.slice(index + oldString.length);
    await fs.writeFile(filePath, updated, 'utf-8');
    return { changes: 1 };
  }
}
