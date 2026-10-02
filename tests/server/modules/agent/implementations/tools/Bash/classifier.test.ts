import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { classifyBashCommand } from '@/server/modules/agent/implementations/tools/Bash/classifier';

const PWD = '/tmp/workdir';

describe('classifyBashCommand', () => {
  describe('safe — 只读 + 全在 workDir 子树内', () => {
    const safeCases = [
      'rg foo',
      'rg foo ./sub',
      'rg foo .',
      `rg foo ${PWD}/a.txt`,
      `cat ${PWD}/a.txt`,
      'cat ./a.txt',
      'ls',
      'ls .',
      'find . -name x',
      'grep -r pattern .',
      'wc -l ./a.txt',
      "rg 'foo|bar' ./sub",
      "rg 'with $literal' .",
    ];
    for (const cmd of safeCases) {
      it(`safe: ${cmd}`, () => {
        expect(classifyBashCommand(cmd, PWD).kind).toBe('safe');
      });
    }
  });

  describe('sensitive — 越界 read-path', () => {
    it('rg 越界绝对路径', () => {
      const p = classifyBashCommand('rg foo /etc', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.action).toBe('read-path');
      expect(p.resource).toBe('/etc');
    });

    it('cat 父目录同胞', () => {
      const p = classifyBashCommand('cat ../sib', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.action).toBe('read-path');
    });

    it('find 越界绝对路径', () => {
      const p = classifyBashCommand('find /etc -name x', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.action).toBe('read-path');
    });

    it('cat ~ 路径 → sensitive（~ 展开为 home，越出 pwd）', () => {
      const p = classifyBashCommand('cat ~/Documents/x.pdf', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.action).toBe('read-path');
      expect(p.resource).toBe(path.resolve(os.homedir(), 'Documents/x.pdf'));
    });

    it('rg bare ~ → sensitive（home 越界）', () => {
      const p = classifyBashCommand('rg foo ~', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.resource).toBe(os.homedir());
    });
  });

  describe('sensitive — 危险展开一律 exec-cmd', () => {
    const metaCases = [
      'rg foo > out.txt',
      'rg foo & ls',
      'echo $(date)',
      'rg foo `pwd`',
      'rg "with $literal" .',
      'echo "$(rm ./a)"',
    ];
    for (const cmd of metaCases) {
      it(`meta: ${cmd}`, () => {
        const p = classifyBashCommand(cmd, PWD);
        expect(p.kind).toBe('sensitive');
        if (p.kind !== 'sensitive') return;
        expect(p.action).toBe('exec-cmd');
        expect(p.resource.startsWith('bash:')).toBe(true);
      });
    }
  });

  describe('safe — 管道两侧全只读即放行', () => {
    const pipeCases = [
      'rg foo | head',
      'cat ./a | grep b | wc -l',
      'cat ./a | sort | uniq',
      'git log --oneline | head -5',
      'echo hello | wc -c',
    ];
    for (const cmd of pipeCases) {
      it(`pipe: ${cmd}`, () => {
        expect(classifyBashCommand(cmd, PWD).kind).toBe('safe');
      });
    }

    it('pipe: 任一侧写/exec → sensitive', () => {
      const p = classifyBashCommand('cat ./a | npm run x', PWD);
      expect(p.kind).toBe('sensitive');
    });
  });

  describe('git — 只读子命令', () => {
    const safeGit = [
      'git status',
      'git status --porcelain',
      'git log --oneline -5',
      'git diff',
      'git diff --cached',
      'git show HEAD',
      'git show HEAD:src/a.ts',
      'git branch',
      'git branch -a',
      'git -C sub status',
      `git -C ${PWD} log`,
    ];
    for (const cmd of safeGit) {
      it(`git safe: ${cmd}`, () => {
        expect(classifyBashCommand(cmd, PWD).kind).toBe('safe');
      });
    }

    const sensitiveGit = [
      'git commit -m x',
      'git add ./a',
      'git push',
      'git branch -D feat',
      'git -c user.name=x status',
      'git config user.name',
      'git diff --no-index /etc/a /etc/b',
    ];
    for (const cmd of sensitiveGit) {
      it(`git sensitive: ${cmd}`, () => {
        const p = classifyBashCommand(cmd, PWD);
        expect(p.kind).toBe('sensitive');
        if (p.kind !== 'sensitive') return;
        // --no-index 比较界外文件 → read-path（读越界，语义正确）
        expect(p.action === 'exec-cmd' || p.action === 'read-path').toBe(true);
      });
    }
  });

  describe('变量引用 — 折中判定', () => {
    it('可求值变量代入后过包含检查：$PWD 界内 → safe', () => {
      expect(classifyBashCommand('cat $PWD/a.txt', PWD).kind).toBe('safe');
    });

    it('$HOME 展开越出 workDir → read-path sensitive', () => {
      const p = classifyBashCommand('ls $HOME', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.action).toBe('read-path');
      expect(p.resource).toBe(os.homedir());
    });

    it('未知变量 → sensitive（无法静态判界）', () => {
      const p = classifyBashCommand('rg pattern $TARGET_DIR', PWD);
      expect(p.kind).toBe('sensitive');
      if (p.kind !== 'sensitive') return;
      expect(p.action).toBe('exec-cmd');
    });

    it('echo/printf 的变量 → safe（只写 stdout）', () => {
      expect(classifyBashCommand('echo $ANY_VAR', PWD).kind).toBe('safe');
      expect(classifyBashCommand('printf "%s" $X', PWD).kind).toBe('safe');
    });

    it('良性非路径变量（LANG/TERM 等）→ safe', () => {
      expect(classifyBashCommand('cat file_$LANG', PWD).kind).toBe('safe');
    });

    it('单引号内 $ 字面化 → 不做变量分析', () => {
      expect(classifyBashCommand("rg '$pattern' .", PWD).kind).toBe('safe');
    });

    it('${NAME} 形态照常求值', () => {
      expect(classifyBashCommand('cat ${PWD}/a.txt', PWD).kind).toBe('safe');
    });
  });

  describe('敏感路径黑名单 — 命中即 exec-cmd（auto 档也问）', () => {
    const sensitiveCases = [
      'cat ~/.ssh/id_rsa',
      'ls ~/.ssh',
      `cat ${os.homedir()}/.aws/credentials`,
      'cat .env',
      'cat ./.env.local',
      'cat config/credentials.json',
      'cat server.pem',
      'cat deploy.key',
      'cat ./secrets/token.txt',
    ];
    for (const cmd of sensitiveCases) {
      it(`sensitive path: ${cmd}`, () => {
        const p = classifyBashCommand(cmd, PWD);
        expect(p.kind).toBe('sensitive');
        if (p.kind !== 'sensitive') return;
        expect(p.action).toBe('exec-cmd');
        expect(p.resource.startsWith('sensitive:')).toBe(true);
        expect(p.prompt).toContain('敏感路径');
      });
    }

    it('非敏感近形文件不误伤', () => {
      expect(classifyBashCommand('cat .envelope.ts', PWD).kind).toBe('safe');
      expect(classifyBashCommand('cat id_rsa.pub', PWD).kind).toBe('safe');
      expect(classifyBashCommand('cat CredentialsProvider.tsx', PWD).kind).toBe(
        'safe',
      );
    });
  });

  it('~user 形式无法展开 → sensitive（修绕过）', () => {
    const p = classifyBashCommand('cat ~root/.ssh/id_rsa', PWD);
    expect(p.kind).toBe('sensitive');
    if (p.kind !== 'sensitive') return;
    expect(p.action).toBe('exec-cmd');
  });

  it('find 写副作用 flag → sensitive', () => {
    const p = classifyBashCommand('find . -delete', PWD);
    expect(p.kind).toBe('sensitive');
    if (p.kind !== 'sensitive') return;
    expect(p.action).toBe('exec-cmd');
  });

  describe('safe — &&/||/; 链逐段判定，全段 safe 放行', () => {
    const chainCases = [
      'rg foo && ls',
      'rg foo; ls',
      'ls && rg foo && wc -l ./a.txt',
      'echo hello; ls .',
      'echo "a&&b" && ls',
      'cd sub && cat file',
      `cd ${PWD} && cat ./a.txt && echo hi && head -c 3000 resume/resume.json`,
      `cd ${PWD} && cat README.md && echo "===RESUME===" && head -c 3000 resume/resume.json`,
      "echo 'a;b' && rg 'foo|bar' ./sub",
    ];
    for (const cmd of chainCases) {
      it(`safe chain: ${cmd}`, () => {
        expect(classifyBashCommand(cmd, PWD).kind).toBe('safe');
      });
    }
  });

  describe('sensitive — 链中任一段越界/写/exec → 整条 sensitive', () => {
    const chainCases: Array<[string, string]> = [
      ['cd sub && cat ../../sib', 'read-path'],
      ['cd /etc && ls', 'exec-cmd'],
      ['cd ~ && ls', 'exec-cmd'],
      ['cd && ls', 'exec-cmd'],
      ['cd - && ls', 'exec-cmd'],
      ['cd a b && ls', 'exec-cmd'],
      ['echo hi && rm ./a', 'exec-cmd'],
      ['rg foo && node x.js', 'exec-cmd'],
      ['cd sub && rm x', 'exec-cmd'],
      ['cd "$(echo /etc)" && ls', 'exec-cmd'],
    ];
    for (const [cmd, action] of chainCases) {
      it(`sensitive chain: ${cmd}`, () => {
        const p = classifyBashCommand(cmd, PWD);
        expect(p.kind).toBe('sensitive');
        if (p.kind !== 'sensitive') return;
        expect(p.action).toBe(action);
      });
    }
  });

  it('链式敏感：resource=整条命令 hash，prompt 含完整命令（汇总一次审批）', () => {
    const cmd = 'rg foo && rm ./a';
    const p = classifyBashCommand(cmd, PWD);
    if (p.kind !== 'sensitive') throw new Error();
    expect(p.action).toBe('exec-cmd');
    const expected = `bash:${crypto
      .createHash('sha1')
      .update(cmd)
      .digest('hex')
      .slice(0, 16)}`;
    expect(p.resource).toBe(expected);
    expect(p.prompt).toContain('rg foo && rm ./a');
    expect(p.prompt).toContain(PWD);
  });

  describe('sensitive — 写/exec/未知', () => {
    const execCases = [
      'echo hello > x',
      'rm ./a',
      'mv ./a ./b',
      'cp ./a ./b',
      'mkdir ./d',
      'touch ./f',
      'sed -i s/a/b/ ./f',
      'node ./script.js',
      'python ./s.py',
      'curl http://example.com',
      'unknowncmd foo',
    ];
    for (const cmd of execCases) {
      it(`exec: ${cmd}`, () => {
        const p = classifyBashCommand(cmd, PWD);
        expect(p.kind).toBe('sensitive');
        if (p.kind !== 'sensitive') return;
        expect(p.action).toBe('exec-cmd');
      });
    }
  });

  it('引号内元字符不触发 exec-cmd（rg 只读且在 pwd 内 → safe）', () => {
    expect(classifyBashCommand("rg 'a|b' ./sub", PWD).kind).toBe('safe');
  });

  it('未闭合引号 → sensitive', () => {
    expect(classifyBashCommand("rg 'foo /etc", PWD).kind).toBe('sensitive');
  });

  it('不同命令产生不同 resource hash', () => {
    const a = classifyBashCommand('rm ./a', PWD);
    const b = classifyBashCommand('rm ./b', PWD);
    if (a.kind !== 'sensitive' || b.kind !== 'sensitive') throw new Error();
    expect(a.resource).not.toBe(b.resource);
  });

  it('prompt 含命令与工作目录', () => {
    const p = classifyBashCommand('rm ./a', PWD);
    if (p.kind !== 'sensitive') throw new Error();
    expect(p.prompt).toContain('rm ./a');
    expect(p.prompt).toContain(PWD);
  });
});
