import { copyFile } from 'fs/promises';
import path from 'path';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Task } from '../../../types';
import { FsBackend, fsDocToolSet } from '../sandbox';

/** 本机路径：eval 本地直跑（bun tests/eval/cli.ts），PDF 存于用户 ~/Documents。 */
const HOST_PDF =
  '/home/everseen/Documents/financial-report/geely/2024/c00175_Annual-Report_20250428-1.pdf';
const WORKDIR_PDF = 'geely-2024-annual-report.pdf';

/**
 * 判分两层：
 *  - success（确定性硬门槛）：run completed + 确实调用了 pdf_extract（反幻觉：非凭参数臆造）。
 *  - judge（模型评判）：四项数值是否落在容差内。本质模糊、对表面形态敏感（语言/单位/算式表达），
 *    交 LLM judge 跨中英文与等价单位统一判数值对错——规避 anchor 正则对英文答复的误杀
 *    （如 agent 因 response_user JSON 转义错误被迫切英文作答、值却全对的假阴性）。
 *  gradeOutcome 取 success ∩ judge，guard 命中再覆盖为 fail。
 */
const task: Task<FsBackend> = {
  id: 'fs:geely-2024-metrics',
  domain: 'fs',
  difficulty: 'medium',
  userGoal:
    `工作目录下有 ${WORKDIR_PDF}（吉利汽车控股有限公司 2024 年度报告，中文/繁体）。\n` +
    '请基于该年报的"綜合收益表"（Consolidated Income Statement，列有收益/銷售成本/毛利/本年度溢利等行项目，' +
    '同时给出 2024 与 2023 两列对照）计算以下指标，并用 response_user 把结果（含所用数值与计算式）告诉我：\n' +
    '1. 2024 年营业收入（"收益"行），以人民币亿元为单位，保留 1 位小数；\n' +
    '2. 营业收入同比增速 = (2024 收益 − 2023 收益) ÷ 2023 收益 × 100%，百分比，保留 1 位小数；\n' +
    '3. 2024 年毛利率 = "毛利"行 ÷ "收益"行 × 100%（其中毛利 = 收益 − 銷售成本，取綜合收益表中的"毛利"行），百分比，保留 1 位小数；\n' +
    '4. 2024 年净利润 = "本年度溢利"行（注意是利润表的本年度溢利，不是"歸屬本公司股權持有人溢利"），以人民币亿元为单位，保留 1 位小数。\n',
  budget: { maxIterations: 30 },
  setup: () => ({
    sandbox: new FsBackend(),
    tools: [],
    toolSet: fsDocToolSet(),
  }),
  seedWorkDir: async workDir => {
    await copyFile(HOST_PDF, path.join(workDir, WORKDIR_PDF));
  },
  success: (_sandbox, run, events) => {
    if (run.currentStatus !== 'completed') {
      return {
        pass: false,
        reason: `run not completed (status=${run.currentStatus})`,
      };
    }
    const calledPdf = events.some(
      e =>
        e.type === 'tool_call' &&
        (e as Extract<EnrichedEvent, { type: 'tool_call' }>).toolName ===
          'pdf_extract',
    );
    if (!calledPdf) {
      return { pass: false, reason: '未调用 pdf_extract 读取 PDF' };
    }
    return { pass: true, reason: '确定性门槛通过（completed + pdf_extract）' };
  },
  judge: {
    rubric: `判断 agent 最终答复是否正确报告了吉利汽车 2024 年报"綜合收益表"四项指标。Ground truth（单位：人民币千元）与容差：
1. 2024 营业收入（"收益"行）= 240,194,270 千元 ≈ 240.2 亿元；接受 2390–2410 亿元，或 240,000–241,000 百万元，或 240,000,000–240,400,000 千元，任一即可。
2. 营收同比增速 = (240,194,270 − 179,203,592) ÷ 179,203,592 ≈ 34.0%；接受 32–36%。
3. 2024 毛利率 = 毛利 38,200,849 ÷ 收益 240,194,270 ≈ 15.9%；接受 15.4–16.4%。
4. 2024 净利润 = "本年度溢利"行 = 16,799,095 千元 ≈ 168.0 亿元；接受 164–172 亿元，或 16,790–16,810 百万元，或 16,790,000–16,810,000 千元。注意须是"本年度溢利"，不是"歸屬本公司股權持有人溢利"（约 166.3 亿，不在容差内）。
pass 当且仅当四项数值均在容差内。答复语言（中/英/混）、单位、是否带计算式不限，只判数值正确性。`,
  },
};

export default task;
