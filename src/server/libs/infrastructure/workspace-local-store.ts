import { promises as fs } from 'fs';
import path from 'path';
import { service } from '@/server/decorator/service';
import { LANGVIS_DIR } from '@/shared/constants';

// WorkspaceLocalStore —— workDir 下 `.langvis/` 内部状态命名空间的唯一所有者。
// 框架自有产物(grants / offload 缓存 / 未来记忆)落盘层,区别于 WorkspaceService 的用户文件 CRUD。
@service()
export class WorkspaceLocalStore {
  /** 读 section JSON:缺失或损坏 → null。name → <workDir>/.langvis/<name>.json。 */
  async readSection<T = unknown>(
    workDir: string,
    name: string,
  ): Promise<T | null> {
    try {
      const raw = await fs.readFile(this.sectionPath(workDir, name), 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** 写 section JSON(整体替换)。 */
  async writeSection(
    workDir: string,
    name: string,
    value: unknown,
  ): Promise<void> {
    const file = this.sectionPath(workDir, name);
    await fs.mkdir(this.dir(workDir), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf-8');
  }

  /** 预建 blob 组目录并返回 workDir 相对路径;调用方把字节写入该路径(如 offload 载荷)。 */
  async reserveBlob(
    workDir: string,
    group: string,
    filename: string,
  ): Promise<string> {
    await fs.mkdir(path.join(this.dir(workDir), group), { recursive: true });
    return path.join(LANGVIS_DIR, group, filename);
  }

  private dir(workDir: string): string {
    return path.join(workDir, LANGVIS_DIR);
  }
  private sectionPath(workDir: string, name: string): string {
    return path.join(this.dir(workDir), `${name}.json`);
  }
}
