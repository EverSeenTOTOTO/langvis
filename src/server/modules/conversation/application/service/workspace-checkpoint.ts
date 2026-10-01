import { execFile } from 'child_process';
import { promisify } from 'util';
import Logger from '@/server/utils/logger';

const exec = promisify(execFile);
const logger = Logger.child({ source: 'WorkspaceCheckpoint' });

const REF_PREFIX = 'refs/langvis/checkpoints';

function git(args: string[], cwd: string) {
  return exec('git', args, { cwd, timeout: 10_000 });
}

// workspace git 快照（rewind 数据面）：turn-start `git stash create`+update-ref 保住
// dangling commit；restore=checkout 影子 ref 树。非 git / 无变更 no-op。
export class WorkspaceCheckpoint {
  /** turn 前快照。返回 ref 名（null=非 git repo 或无变更，无可恢复点）。 */
  async snapshot(
    workDir: string,
    key: string,
  ): Promise<{ ref: string; sha: string } | null> {
    try {
      await git(['rev-parse', '--is-inside-work-tree'], workDir);
    } catch {
      return null; // 非 git workspace
    }

    try {
      const { stdout } = await git(['stash', 'create'], workDir);
      const sha = stdout.trim();
      if (!sha) return null; // 无变更——nothing to snapshot

      const ref = `${REF_PREFIX}/${key}`;
      await git(['update-ref', ref, sha], workDir);
      return { ref, sha };
    } catch (err) {
      logger.warn(`snapshot failed (non-fatal): ${err}`);
      return null;
    }
  }

  /** 恢复到快照点：checkout 影子 ref 树（之后修改丢弃）。 */
  async restore(workDir: string, key: string): Promise<boolean> {
    const ref = `${REF_PREFIX}/${key}`;
    try {
      await git(['rev-parse', '--verify', ref], workDir);
    } catch {
      return false; // 无此快照
    }
    try {
      await git(['checkout', ref, '--', '.'], workDir);
      return true;
    } catch (err) {
      logger.warn(`restore failed: ${err}`);
      return false;
    }
  }

  /** 列出某 workspace 的全部快照 key。 */
  async list(workDir: string): Promise<Array<{ key: string; sha: string }>> {
    try {
      const { stdout } = await git(
        ['for-each-ref', '--format=%(refname) %(objectname)', `${REF_PREFIX}/`],
        workDir,
      );
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [full, sha] = line.split(' ');
          return {
            key: full.replace(`${REF_PREFIX}/`, ''),
            sha: sha ?? '',
          };
        });
    } catch {
      return [];
    }
  }
}
