import { promises as fs } from 'fs';
import path from 'path';
import { service } from '../decorator/service';
import { resolveSafePath } from '../utils/pathSafety';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

@service()
export class WorkspaceService {
  private readonly rootDir: string;

  constructor() {
    this.rootDir = path.join('/tmp', 'langvis-workspace');
  }

  async getWorkDir(conversationId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.rootDir, date, conversationId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async readFile(
    filename: string,
    workDir: string,
  ): Promise<{ content: string; size: number } | null> {
    const filePath = resolveSafePath(filename, workDir);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return null;
    if (!stat.isFile()) throw new Error(`Not a file: ${filename}`);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large (${(stat.size / 1024).toFixed(0)}KB, max ${MAX_FILE_SIZE / 1024}KB). ` +
          `Use bash tool with commands like head, tail, sed, or rg to read specific parts.`,
      );
    }
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
