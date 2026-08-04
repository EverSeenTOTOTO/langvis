import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { shortenHome } from '@/server/modules/agent/infrastructure/authorization.provider';
import type { AuthAction } from '@/server/modules/agent/domain/port/authorization.port';

// Bash 命令分类器（工具侧 pwd-containment 判定）：auth 层对 workDir 一无所知。
// safe（只读+在子树内，含 &&/||/; 链的逐段判定）直放行不调 auth；sensitive 整条一次走 ensureApproved。

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

/** shell 元字符：未引号出现即判 sensitive（&&/||/; 已先行拆段，此处管管道/重定向/展开/转义）。 */
const SHELL_METACHARS = /[|&;\n$()<>`\\]/;

interface Token {
  value: string;
  /** 该 token 是否处于引号内（引号内不视为路径/元字符源）。 */
  quoted: boolean;
}

// 保守 argv 拆分：尊重单/双引号，引号未闭合 → 返回 null（判 sensitive）。 不做变量展开 / glob 展开（交给 shell）；此处只需识别结构。
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

// 解析路径 token 到绝对路径。先展开 `~`/`~/`（不展开会误判 safe——安全漏洞）。
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

// 顶层拆分：引号感知，按 && / || / ; / 换行 分段（尊重 \\ 转义）。未闭合引号或行尾反斜杠 → null。
function splitTopLevel(command: string): string[] | null {
  const segments: string[] = [];
  let cur = '';
  let quoted: 'none' | 'single' | 'double' = 'none';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quoted === 'none') {
      if (ch === '\\') {
        if (command[i + 1] === undefined) return null; // 行尾续行未闭合
        cur += ch + command[i + 1]!;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quoted = ch === "'" ? 'single' : 'double';
        cur += ch;
        continue;
      }
      if (ch === '&' || ch === '|') {
        if (command[i + 1] === ch) {
          segments.push(cur);
          cur = '';
          i++;
          continue;
        }
        cur += ch; // 单个 & / | 不拆，留给段内判定
        continue;
      }
      if (ch === ';' || ch === '\n') {
        segments.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    } else if (quoted === 'single') {
      cur += ch;
      if (ch === "'") quoted = 'none';
    } else {
      cur += ch;
      if (ch === '"') quoted = 'none';
      else if (ch === '\\' && command[i + 1] !== undefined) {
        cur += command[i + 1]!;
        i++;
      }
    }
  }
  if (quoted !== 'none') return null;
  segments.push(cur);
  return segments;
}

// 分类 bash 命令：顶层拆段（&&/||/; 换行）后逐段判定，cwd 随 cd 更新。
// 任一段 sensitive → 整条一次授权（resource=整条命令 hash）；全 safe → safe 放行。
export function classifyBashCommand(
  command: string,
  workDir: string,
): BashPermission {
  const promptHeader = `### 执行命令\n\n\`\`\`bash\n${command.trimEnd()}\n\`\`\`\n\n**工作目录:** \`${shortenHome(workDir)}\``;
  const sensitiveExec = (): BashPermission => ({
    kind: 'sensitive',
    action: 'exec-cmd',
    resource: `bash:${hashCommand(command)}`,
    prompt: promptHeader,
  });

  const segments = splitTopLevel(command);
  if (segments === null) return sensitiveExec();

  let cwd = workDir;
  for (const raw of segments) {
    const segment = raw.trim();
    if (segment === '') continue; // 空段（如尾部 `&&`）

    // 段内危险展开（管道/重定向/后台/替换/转义，含双引号内 $/反引号）→ 整条 sensitive。
    if (hasDangerousExpansion(segment)) return sensitiveExec();

    const tokens = tokenize(segment);
    if (tokens === null) return sensitiveExec();
    const cmdToken = findCommandToken(tokens);
    if (!cmdToken) return sensitiveExec();
    const cmd = cmdToken.value;
    const cmdIdx = tokens.indexOf(cmdToken);

    if (cmd === 'cd') {
      // cd 仅允许在 workDir 子树内移动；裸 cd / cd - / 多参数 → sensitive。
      const args = tokens
        .slice(cmdIdx + 1)
        .filter(t => !t.value.startsWith('-'));
      if (args.length !== 1) return sensitiveExec();
      const resolved = resolveArgPath(args[0]!.value, cwd);
      if (!isWithin(resolved, workDir)) return sensitiveExec();
      cwd = resolved;
      continue;
    }

    if (cmd === 'echo') continue; // 只写 stdout、参数非路径；替换已由 hasDangerousExpansion 拦截

    if (READONLY_CMDS.has(cmd)) {
      // 只读命令：检查所有非 flag token 是否落在 workDir 子树内（相对当前 cwd 解析）。
      for (let i = cmdIdx + 1; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.value.startsWith('-')) continue; // flag
        const resolved = resolveArgPath(t.value, cwd);
        if (!isWithin(resolved, workDir)) {
          return {
            kind: 'sensitive',
            action: 'read-path',
            resource: resolved,
            prompt: promptHeader,
          };
        }
      }
      continue;
    }

    // 写 / exec / 未知 一律敏感（resource=整条命令 hash）。
    return sensitiveExec();
  }
  return { kind: 'safe' };
}

// 段内危险展开判定：未引号元字符，或双引号内 $/反引号（shell 会实际展开），皆 sensitive。
// 单引号内容字面化（'$(x)' 不展开）；双引号内 \\ 转义其后一字符（"\$x" 为字面 $）。
function hasDangerousExpansion(command: string): boolean {
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
      else if (ch === '$' || ch === '`') return true;
    }
  }
  return false;
}
