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
      'rg foo | head',
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
