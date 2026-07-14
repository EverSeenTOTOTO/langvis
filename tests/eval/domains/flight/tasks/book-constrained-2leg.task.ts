/**
 * G4.3 Task A — 2 程多约束交叉验证(测压缩安全)。
 *
 * catalog 200 条(5 city-pair × 40),本任务用其中 2 对:京→沪 / 沪→广。
 * 实测(8K 模型):每次 search 命中 40 条 + agent 推理文本,单程约 +2400~2800 tok。
 *   - 2 程 ≈ base + 2×search + 2×detail + 2×book,峰值 ~6300 tok,**未爆 8192 全窗**
 *     → baseline(no-compaction)不折叠也能完成
 *   - default(压缩)过 6553 阈值触发 mid-loop 压缩 → 压缩后还过不过,即测压缩无损性
 *
 * 与 4leg(B)的对比:本任务 baseline 活、B baseline 爆窗。default 在两者都压缩,
 * 本任务测「压缩丢不丢信息」(default 须照样过),B 测「压缩救不救命」(headroom 正)。
 *
 * seats=1 陷阱(占 1/4)让"座位>1"约束必须从 search 结果读准——压缩若丢 target 的
 * seats/价格 → 误订 → 挂。这正是 §0 要测的"信息丢失"。
 */
import type { Task } from '../../../types';
import {
  createBookingBackend,
  flightToolDefs,
  flightToolSet,
  type BookingBackend,
} from '../sandbox';
import { generateCatalog, cheapestConstrained } from '../catalog';

/** 2 程:origin→destination 序列。 */
const LEGS: ReadonlyArray<readonly [string, string]> = [
  ['北京', '上海'],
  ['上海', '广州'],
];

/**
 * 每程正确答案:在 **fresh catalog(预订前)** 上满足全约束的最便宜 flight。
 * 须在 setup 预订前算——book_flight 会改座位(seats--),若在 success 里用
 * 已被订过的 b.flights 重算,target 会被座位扣减挤掉、误判。
 * catalog 确定性,故模块加载时算一次即每 run 恒同。
 */
const TARGETS = new Map(
  LEGS.map(([o, d]) => [
    `${o}|${d}`,
    cheapestConstrained(generateCatalog(), o, d).id,
  ]),
);

const task: Task<BookingBackend> = {
  id: 'flight:book-constrained-2leg',
  domain: 'flight',
  difficulty: 'medium',
  userGoal:
    '帮我订下周出差的两程机票：① 周一 北京→上海 ② 周二 上海→广州。' +
    '每程都必须：东方航空（东航）、下午（12:00 及以后）出发、价格低于 ¥1100、剩余座位多于 1。' +
    '每程各选最便宜的一张，共订 2 张。乘客 Alice。',
  setup: () => ({
    sandbox: createBookingBackend(generateCatalog()),
    tools: flightToolDefs,
    toolSet: flightToolSet(),
  }),
  success: (b, run) => {
    if (run.currentStatus !== 'completed') {
      return {
        pass: false,
        reason: `run not completed (status=${run.currentStatus})`,
      };
    }
    if (b.bookings.length !== LEGS.length) {
      return {
        pass: false,
        reason: `expected ${LEGS.length} bookings, got ${b.bookings.length}`,
      };
    }
    // 每程:订到的 flight 须是该程 fresh-catalog 最便宜合格者。
    const used = new Set<string>();
    const failures: string[] = [];
    for (const [o, d] of LEGS) {
      const targetId = TARGETS.get(`${o}|${d}`)!;
      const bk = b.bookings.find(
        x => !used.has(x.id) && x.flightId === targetId,
      );
      if (!bk) {
        const target = b.flights.find(f => f.id === targetId);
        failures.push(
          `${o}→${d}: 未订到 target ${targetId}(${target?.flightNo ?? '?'})`,
        );
        continue;
      }
      used.add(bk.id);
    }
    if (failures.length) return { pass: false, reason: failures.join('; ') };
    return {
      pass: true,
      reason: `booked all ${LEGS.length} constrained-cheapest legs`,
    };
  },
};

export default task;
