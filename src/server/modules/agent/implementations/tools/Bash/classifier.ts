import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { shortenHome } from '@/server/modules/agent/infrastructure/authorization.provider';
import type { AuthAction } from '@/server/modules/agent/domain/port/authorization.port';

// Bash 命令分类器（工具侧 pwd-containment 判定）：auth 层对 workDir 一无所知。
// safe（只读命令+子树内+不涉敏感路径，管道/链逐段判定）直放不调 auth；sensitive 整条一次走 ensureApproved。

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
  'sort',
  'uniq',
  'nl',
  'cut',
  'paste',
  'rev',
  'seq',
  'tac',
  'tr',
  'numfmt',
  'which',
  'whoami',
  'uname',
  'id',
  'pwd',
  'date',
  'printenv',
]);

/** 白名单命令的写副作用 flag（命中即 sensitive）。 */
const CMD_FLAG_BLACKLIST: Record<string, readonly string[]> = {
  find: [
    '-exec',
    '-execdir',
    '-ok',
    '-okdir',
    '-delete',
    '-fls',
    '-fprint',
    '-fprint0',
    '-fprintf',
  ],
  rg: ['--pre', '--hostname-bin'],
  sort: ['-o', '--output'],
  date: ['-s', '--set'],
};

const GIT_READONLY_SUBS = new Set(['status', 'log', 'diff', 'show', 'branch']);
const GIT_BRANCH_WRITE_FLAGS = [
  '-d',
  '-D',
  '--delete',
  '-m',
  '-M',
  '-e',
  '--edit-description',
  '-u',
  '--set-upstream-to',
  '--set-upstream',
];

// 变量引用折中：可静态求值的代入后照常走路径判定；良性非路径变量免路径检查；
// 其余未知变量 → sensitive（非确定展开无法静态判界）。
const EVALUABLE_VARS: Record<string, (cwd: string) => string> = {
  PWD: cwd => cwd,
  HOME: () => os.homedir(),
};
const BENIGN_VARS = new Set([
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'USER',
  'LOGNAME',
  'SHELL',
  'HOSTNAME',
]);

// 敏感路径黑名单：命中升级 exec-cmd（auto 档也问）——凭证/密钥不属"普通读写"。
const sensitivePrefixes = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.aws'),
    path.join(home, '.config', 'gcloud'),
    path.join(home, '.kube'),
    path.join(home, '.docker'),
    path.join(home, '.netrc'),
    path.join(home, '.git-credentials'),
    '/etc/shadow',
    '/etc/sudoers',
    '/etc/ssh',
  ];
};
const SENSITIVE_BASENAME_RE: RegExp[] = [
  /^\.env(\.|$)/,
  /^\.?credentials?(\.[^.]+)?$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)$/,
  /\.pem$/,
  /\.key$/,
];
const SENSITIVE_COMPONENTS = new Set(['secrets', '.secrets']);

function isSensitivePath(abs: string): boolean {
  if (
    sensitivePrefixes().some(p => abs === p || abs.startsWith(p + path.sep))
  ) {
    return true;
  }
  const base = path.basename(abs);
  if (SENSITIVE_BASENAME_RE.some(re => re.test(base))) return true;
  return abs.split(path.sep).some(c => SENSITIVE_COMPONENTS.has(c));
}

/** shell 元字符：未引号出现即判 sensitive（&&/||/;/| 已先行拆段；$ 不在其中——变量走折中判定）。 */
const SHELL_METACHARS = /[|&;\n()<>`\\]/;

interface Token {
  value: string;
  /** token 是否含单引号段（单引号字面化，$ 不展开）。 */
  singlyQuoted: boolean;
}

// 保守 argv 拆分：尊重单/双引号，引号未闭合 → 返回 null（判 sensitive）。 不做变量展开 / glob 展开（交给 shell）；此处只需识别结构。
function tokenize(command: string): Token[] | null {
  const tokens: Token[] = [];
  let cur = '';
  let quoted: 'none' | 'single' | 'double' = 'none';
  let singlyQuoted = false;
  let hasContent = false;

  const push = () => {
    tokens.push({ value: cur, singlyQuoted });
    cur = '';
    singlyQuoted = false;
    hasContent = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quoted === 'none') {
      if (ch === "'" || ch === '"') {
        quoted = ch === "'" ? 'single' : 'double';
        if (ch === "'") singlyQuoted = true;
        hasContent = true;
        continue;
      }
      if (/\s/.test(ch)) {
        if (hasContent) push();
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
  if (hasContent) push();
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
  return path.resolve(workDir, token);
}

/** `~user/` 形式无法静态展开（真实 shell 会解析到该用户 home）→ 判界失败。 */
function isTildeUserForm(token: string): boolean {
  return token.startsWith('~') && token !== '~' && !token.startsWith('~/');
}

interface VarExpansion {
  text: string;
  benignOnly: boolean;
  unknown: boolean;
}

// 展开 token 中的 $NAME/${NAME}：可求值代入、良性保留、未知标记。
function expandVars(token: string, cwd: string): VarExpansion {
  let out = '';
  let benignOnly = false;
  let unknown = false;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]!;
    if (ch !== '$') {
      out += ch;
      continue;
    }
    const next = token[i + 1];
    if (next === undefined || !/[\w{]/.test(next)) {
      out += ch; // 尾部 $ / $$ / $? 等非变量形态
      continue;
    }
    let name = '';
    let j = i + 1;
    if (next === '{') {
      j = i + 2;
      while (j < token.length && /\w/.test(token[j]!)) {
        name += token[j]!;
        j++;
      }
      if (token[j] === '}') j++;
      if (!name) {
        unknown = true;
        out += token.slice(i, j);
        i = j - 1;
        continue;
      }
    } else {
      while (j < token.length && /\w/.test(token[j]!)) {
        name += token[j]!;
        j++;
      }
    }
    const evaluabel = EVALUABLE_VARS[name];
    if (evaluabel) {
      out += evaluabel(cwd);
    } else if (BENIGN_VARS.has(name)) {
      out += token.slice(i, j);
      benignOnly = true;
    } else {
      unknown = true;
      out += token.slice(i, j);
    }
    i = j - 1;
  }
  return { text: out, benignOnly, unknown };
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

// 顶层拆分：引号感知，按 && / || / ; / 换行 / |（管道）分段（尊重 \\ 转义）。未闭合引号或行尾反斜杠 → null。
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
      if (ch === '|' || ch === '&') {
        if (command[i + 1] === ch) {
          segments.push(cur);
          cur = '';
          i++;
          continue;
        }
        if (ch === '|') {
          segments.push(cur); // 管道：两侧各为独立段
          cur = '';
          continue;
        }
        cur += ch; // 单个 & 留给段内元字符判定
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

// 段内危险展开判定：未引号元字符，或双引号内 $(/反引号（shell 会实际展开），皆 sensitive。
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
      else if (ch === '$' && command[i + 1] === '(') return true;
      else if (ch === '`') return true;
    }
  }
  return false;
}

// 分类 bash 命令：顶层拆段（&&/||/;/换行/管道）后逐段判定，cwd 随 cd 推进。
// 任一段 sensitive → 整条一次授权；全 safe → safe 放行。
export function classifyBashCommand(
  command: string,
  workDir: string,
): BashPermission {
  const promptHeader = `### 执行命令\n\n\`\`\`bash\n${command.trimEnd()}\n\`\`\`\n\n**工作目录:** \`${shortenHome(workDir)}\``;
  const sensitiveExec = (reason?: string): BashPermission => ({
    kind: 'sensitive',
    action: 'exec-cmd',
    resource: `bash:${hashCommand(command)}`,
    prompt: reason ? `${promptHeader}\n\n**${reason}**` : promptHeader,
  });
  const sensitiveRead = (resolved: string): BashPermission => ({
    kind: 'sensitive',
    action: 'read-path',
    resource: resolved,
    prompt: promptHeader,
  });
  const sensitivePathHit = (resolved: string): BashPermission => ({
    kind: 'sensitive',
    action: 'exec-cmd',
    resource: `sensitive:${resolved}`,
    prompt: `${promptHeader}\n\n**涉及敏感路径:** \`${shortenHome(resolved)}\``,
  });

  // 单个路径 token 的三态判定：敏感 / 越界 / 界内。
  const checkPathToken = (
    raw: string,
    cwd: string,
    singlyQuoted: boolean,
  ): BashPermission | undefined => {
    if (isTildeUserForm(raw)) {
      return sensitiveExec('~user 形式无法静态展开，判界失败');
    }
    let candidate = raw;
    if (!singlyQuoted && raw.includes('$')) {
      const { text, benignOnly, unknown } = expandVars(raw, cwd);
      if (unknown) {
        return sensitiveExec('含未知变量，无法静态判界');
      }
      if (benignOnly) return undefined; // 非路径 token
      candidate = text;
    }
    const resolved = resolveArgPath(candidate, cwd);
    if (isSensitivePath(resolved)) return sensitivePathHit(resolved);
    if (!isWithin(resolved, workDir)) return sensitiveRead(resolved);
    return undefined;
  };

  const segments = splitTopLevel(command);
  if (segments === null) return sensitiveExec();

  let cwd = workDir;
  for (const raw of segments) {
    const segment = raw.trim();
    if (segment === '') continue; // 空段（如尾部 `&&`）

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
      const target = args[0]!;
      if (isTildeUserForm(target.value)) return sensitiveExec();
      const resolved = resolveArgPath(target.value, cwd);
      if (!isWithin(resolved, workDir)) return sensitiveExec();
      cwd = resolved;
      continue;
    }

    // echo/printf 只写 stdout；替换已由危险展开拦截，$VAR 无害
    if (cmd === 'echo' || cmd === 'printf') continue;

    if (cmd === 'git') {
      let segCwd = cwd;
      let sub: string | undefined;
      for (let i = cmdIdx + 1; i < tokens.length; i++) {
        const t = tokens[i]!;

        if (t.value === '-C') {
          const target = tokens[++i];
          if (!target) return sensitiveExec('git -C 缺参数');
          let candidate = target.value;
          if (!target.singlyQuoted && target.value.includes('$')) {
            const { text, benignOnly, unknown } = expandVars(
              target.value,
              segCwd,
            );
            if (unknown) return sensitiveExec('含未知变量，无法静态判界');
            if (benignOnly) return sensitiveExec();
            candidate = text;
          }
          if (isTildeUserForm(candidate)) return sensitiveExec();
          const resolved = resolveArgPath(candidate, segCwd);
          if (!isWithin(resolved, workDir)) {
            return sensitiveExec('git -C 越出工作目录');
          }
          segCwd = resolved;
          continue;
        }
        if (t.value === '-c' || /^-c.+/.test(t.value)) {
          return sensitiveExec('git -c 配置覆盖不走只读路径');
        }
        if (
          sub === 'branch' &&
          GIT_BRANCH_WRITE_FLAGS.some(
            f => t.value === f || t.value.startsWith(f + '='),
          )
        ) {
          return sensitiveExec(`git branch 的 ${t.value} 是写操作`);
        }
        if (t.value.startsWith('-')) {
          if (t.value.startsWith('--output')) {
            return sensitiveExec('git --output 有写副作用');
          }
          continue;
        }

        if (!sub) {
          sub = t.value;
          if (!GIT_READONLY_SUBS.has(sub)) return sensitiveExec();
          continue;
        }

        const hit = checkPathToken(t.value, segCwd, t.singlyQuoted);
        if (hit) return hit;
      }
      continue;
    }

    if (READONLY_CMDS.has(cmd)) {
      const blacklisted = CMD_FLAG_BLACKLIST[cmd];
      for (let i = cmdIdx + 1; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.value.startsWith('-')) {
          if (
            blacklisted?.some(f => t.value === f || t.value.startsWith(f + '='))
          ) {
            return sensitiveExec(`${cmd} 的 ${t.value} 有写副作用`);
          }
          if (t.value.includes('=')) {
            const val = t.value.slice(t.value.indexOf('=') + 1);
            const hit = checkPathToken(val, cwd, false);
            if (hit) return hit;
          }
          continue;
        }
        const hit = checkPathToken(t.value, cwd, t.singlyQuoted);
        if (hit) return hit;
      }
      continue;
    }

    // 写 / exec / 未知 一律敏感（resource=整条命令 hash）。
    return sensitiveExec();
  }
  return { kind: 'safe' };
}
