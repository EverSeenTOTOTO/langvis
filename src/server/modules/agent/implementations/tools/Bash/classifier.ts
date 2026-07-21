import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { shortenHome } from '@/server/modules/agent/infrastructure/authorization.provider';
import type { AuthAction } from '@/server/modules/agent/domain/port/authorization.port';

/**
 * Bash 命令分类器（工具侧 pwd-containment 判定）。
 *
 * 设计约束：auth 层对 workDir 一无所知——"命令是否落在 pwd 子树内"由本分类器
 * 在工具侧判定。safe（只读 + 全在 workDir 子树内）→ 工具直接放行、**不调 auth**；
 * sensitive（越界 / 写 / exec / 含元字符 / 未知）→ 走 ensureApproved。
 *
 * v1 保守：含 shell 元字符一律 sensitive（不做"管道内全只读可否 safe"的细语义）。
 * 越界 read-path 的 resource = 解析后的绝对路径本身（不归一化到父目录）：
 * 避免对目录路径（如 /etc）错剥到根（过宽授权）；grant 按精确路径，同路径跨 run 复用即满足
 * "辅助阅读 workDir 外文件"的会话复用诉求。
 */

export type BashPermission =
  | { kind: 'safe' }
  | {
      kind: 'sensitive';
      action: AuthAction;
      resource: string;
      prompt: string;
    };

/** 只读命令白名单——不带副作用、仅读取。 */
const READONLY_CMDS = new Set([
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'rga',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'ls',
  'find',
  'wc',
  'file',
  'stat',
  'basename',
  'dirname',
  'du',
  'df',
  'tree',
  'realpath',
  'readlink',
]);

/** shell 元字符：出现即判 sensitive（保守，管道/重定向/命令替换/变量展开皆此）。 */
const SHELL_METACHARS = /[|&;\n$()<>`\\]/;

interface Token {
  value: string;
  /** 该 token 是否处于引号内（引号内不视为路径/元字符源）。 */
  quoted: boolean;
}

/**
 * 保守 argv 拆分：尊重单/双引号，引号未闭合 → 返回 null（判 sensitive）。
 * 不做变量展开 / glob 展开（交给 shell）；此处只需识别结构。
 */
function tokenize(command: string): Token[] | null {
  const tokens: Token[] = [];
  let cur = '';
  let quoted: 'none' | 'single' | 'double' = 'none';
  let hasContent = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quoted === 'none') {
      if (ch === "'" || ch === '"') {
        quoted = ch === "'" ? 'single' : 'double';
        hasContent = true;
        continue;
      }
      if (/\s/.test(ch)) {
        if (hasContent) {
          tokens.push({ value: cur, quoted: false });
          cur = '';
          hasContent = false;
        }
        continue;
      }
      cur += ch;
      hasContent = true;
    } else if (quoted === 'single') {
      if (ch === "'") {
        quoted = 'none';
        continue;
      }
      cur += ch;
    } else {
      if (ch === '"') {
        quoted = 'none';
        continue;
      }
      if (ch === '\\' && command[i + 1] !== undefined) {
        cur += command[++i]!;
        continue;
      }
      cur += ch;
    }
  }
  if (quoted !== 'none') return null;
  if (hasContent) tokens.push({ value: cur, quoted: false });
  return tokens;
}

/** child 是否在 parent 子树内（含自身）。 */
function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 解析单个路径 token 到绝对路径。先展开 `~`/`~/`（shell 会展开 `~` 到 home，
 * 不展开则会被 path.resolve 当成 workDir 子路径误判为 safe——安全漏洞），再按 workDir 解析。
 */
function resolveArgPath(token: string, workDir: string): string {
  if (token === '~') return os.homedir();
  if (token.startsWith('~/')) return path.resolve(os.homedir(), token.slice(2));
  // `~user/` 形式罕见，v1 不展开 → 落 workDir 子树 → 通常越界后由 caller 判 sensitive
  return path.resolve(workDir, token);
}

/** 取首个非 flag token 作命令名（跳过 env 赋值 `FOO=bar` 与 `--`/`-x` flag）。 */
function findCommandToken(tokens: Token[]): Token | undefined {
  for (const t of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.value)) continue; // env 赋值
    if (t.value.startsWith('-')) continue; // flag
    return t;
  }
  return undefined;
}

function hashCommand(command: string): string {
  return crypto.createHash('sha1').update(command).digest('hex').slice(0, 16);
}

/**
 * 分类一条 bash 命令。
 *
 * - 含元字符 → sensitive(exec-cmd, resource=hash)：保守不拆管道语义。
 * - 命令名在只读白名单：逐个非 flag token resolve 到 workDir，全在子树内 → safe；
 *   任一越界 → sensitive(read-path, resource=normalizeRoot(越界路径))。
 * - 写/可执行命令 → sensitive(edit-path|exec-cmd, resource=hash)。
 * - 未知命令 → sensitive(exec-cmd, resource=hash, review 语义)。
 */
export function classifyBashCommand(
  command: string,
  workDir: string,
): BashPermission {
  const promptHeader = `### 执行命令\n\n\`\`\`bash\n${command}\`\`\`\n\n**工作目录:** \`${shortenHome(workDir)}\``;

  // 元字符（含未引号包裹的）→ sensitive。
  // 取引号外的元字符：逐字符扫描是否处于引号内。
  if (hasUnquotedMetachar(command)) {
    return {
      kind: 'sensitive',
      action: 'exec-cmd',
      resource: `bash:${hashCommand(command)}`,
      prompt: promptHeader,
    };
  }

  const tokens = tokenize(command);
  if (tokens === null) {
    return {
      kind: 'sensitive',
      action: 'exec-cmd',
      resource: `bash:${hashCommand(command)}`,
      prompt: promptHeader,
    };
  }

  const cmdToken = findCommandToken(tokens);
  if (!cmdToken) {
    // 纯 flag / 空命令——保守 sensitive。
    return {
      kind: 'sensitive',
      action: 'exec-cmd',
      resource: `bash:${hashCommand(command)}`,
      prompt: promptHeader,
    };
  }
  const cmd = cmdToken.value;
  const cmdIdx = tokens.indexOf(cmdToken);

  if (READONLY_CMDS.has(cmd)) {
    // 只读命令：检查所有非 flag、非首命令 token 是否落在 workDir 子树内。
    for (let i = cmdIdx + 1; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.value.startsWith('-')) continue; // flag
      const resolved = resolveArgPath(t.value, workDir);
      if (!isWithin(resolved, workDir)) {
        return {
          kind: 'sensitive',
          action: 'read-path',
          resource: resolved,
          prompt: promptHeader,
        };
      }
    }
    return { kind: 'safe' };
  }

  // 非只读：写 / exec / 未知 一律 sensitive（resource=hash，逐命令授权）。
  return {
    kind: 'sensitive',
    action: 'exec-cmd',
    resource: `bash:${hashCommand(command)}`,
    prompt: promptHeader,
  };
}

/** 扫描 command，返回是否存在未被引号包裹的 shell 元字符。 */
function hasUnquotedMetachar(command: string): boolean {
  let quoted: 'none' | 'single' | 'double' = 'none';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quoted === 'none') {
      if (ch === "'" || ch === '"') {
        quoted = ch === "'" ? 'single' : 'double';
        continue;
      }
      if (SHELL_METACHARS.test(ch)) return true;
    } else if (quoted === 'single') {
      if (ch === "'") quoted = 'none';
    } else {
      if (ch === '"') quoted = 'none';
      else if (ch === '\\' && command[i + 1] !== undefined) i++;
    }
  }
  return false;
}
