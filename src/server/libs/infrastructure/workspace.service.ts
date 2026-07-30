import { promises as fs } from 'fs';
import path from 'path';
import { service } from '@/server/decorator/service';
import { resolveSafePath } from '@/server/utils/pathSafety';
import { generateId } from '@/shared/utils';

@service()
export class WorkspaceService {
  private readonly rootDir: string;

  constructor() {
    this.rootDir = path.join('/tmp', 'langvis-workspace');
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

  private configPath(workDir: string): string {
    return path.join(workDir, '.langvis', 'config.json');
  }

  async readConfig(workDir: string): Promise<Record<string, unknown> | null> {
    try {
      const content = await fs.readFile(this.configPath(workDir), 'utf-8');
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async writeConfig(
    workDir: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const file = this.configPath(workDir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  }
}
