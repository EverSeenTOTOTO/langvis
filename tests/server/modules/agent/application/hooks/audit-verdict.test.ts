import { describe, it, expect } from 'vitest';
import { deriveVerdict } from '@/server/modules/agent/application/hooks/audit-response-hook';

describe('AuditResponseHook deriveVerdict（sound-gate 重定位，仅门控 RESULT）', () => {
  it('UNKNOWN / 空 / 无 RESULT 行 → abstain', () => {
    expect(deriveVerdict('UNKNOWN', [''])).toMatchObject({ verdict: 'unable' });
    expect(deriveVerdict('', ['x'])).toMatchObject({ verdict: 'unable' });
    expect(deriveVerdict('VERDICT: refuted — 没找到', ['x'])).toMatchObject({
      verdict: 'unable',
    });
  });

  it('RESULT 在某条 tool 输出里 → veto，evidence 为该真实 tool 输出', () => {
    const msg = 'RESULT: no booking found for MU5101';
    const toolOutputs = [
      '{"exit":2}',
      'search: no booking found for MU5101 here',
    ];
    expect(deriveVerdict(msg, toolOutputs)).toMatchObject({
      verdict: 'refuted',
      evidence: 'no booking found for MU5101',
    });
  });

  it('RESULT 不在任何 tool 输出（confabulate 证据/把 reply 当 tool 输出）→ abstain', () => {
    // 审计把答复里的"航班号为 MU5101"当作 RESULT，但它不在任何 tool 输出 → 重定位失败
    const msg = 'RESULT: 航班号为 MU5101';
    expect(deriveVerdict(msg, ['some unrelated tool output'])).toMatchObject({
      verdict: 'unable',
    });
  });

  it('RESULT 为审计自撰散文总结（非真实 tool 输出原样子串）→ abstain', () => {
    // 9B 在空目录时常见失败：把空 rg 结果总结成"工作目录为空"的散文 → 不嵌套 → 弃权
    const msg = 'RESULT: 当前工作目录为空，没有任何文件存在';
    expect(
      deriveVerdict(msg, ['{"exitCode":2,"stdout":"","stderr":""}']),
    ).toMatchObject({ verdict: 'unable' });
  });

  it('空白归一化：容忍 RESULT 跨行/多空格漂移，仍要求字面嵌套', () => {
    const msg = 'RESULT: no\nbooking\nfound';
    const toolOutputs = ['no  booking   found for MU5101'];
    expect(deriveVerdict(msg, toolOutputs)).toMatchObject({
      verdict: 'refuted',
      evidence: 'no\nbooking\nfound',
    });
  });

  it('RESULT 行存在但为空 → abstain', () => {
    expect(deriveVerdict('RESULT:', ['x'])).toMatchObject({
      verdict: 'unable',
    });
    expect(deriveVerdict('RESULT:   ', ['x'])).toMatchObject({
      verdict: 'unable',
    });
  });

  it('RESULT 出现在 RESULT: 之后的所有内容（跨行）', () => {
    const msg = 'RESULT: line1\nline2';
    expect(deriveVerdict(msg, ['prefix line1\nline2 suffix'])).toMatchObject({
      verdict: 'refuted',
      evidence: 'line1\nline2',
    });
  });
});
