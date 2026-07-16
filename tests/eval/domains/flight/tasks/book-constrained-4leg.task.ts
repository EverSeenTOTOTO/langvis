/**
 * G4.3 Task B — 4 程多约束交叉验证(测压缩贡献)。
 *
 * 在 3leg 基础上加第 4 程 京→广。估算累积峰值 ~9400 tok,爆 8192 全窗:
 *   - baseline(bare)不折叠,4 次大 search 累积爆窗 → 失败(provider 截断/信息丢失)
 *   - default(压缩)过阈后折叠掉早期 search → 回到窗内 → 能完成
 *   → headroom 应为正(default 救活 baseline 必挂的 run),即 driver 贡献的正面证据。
 *
 * 8 步(search×4 + book×4)稳破 keepRecent=4。catalog 与 3leg 共用同一生成器。
 */
import type { Task } from '../../../types';
import {
  createBookingBackend,
  flightToolDefs,
  flightToolSet,
  type BookingBackend,
} from '../sandbox';
import { generateCatalog, cheapestConstrained } from '../catalog';

/** 4 程:origin→destination 序列。 */
const LEGS: ReadonlyArray<readonly [string, string]> = [
  ['北京', '上海'],
  ['上海', '广州'],
  ['广州', '北京'],
  ['北京', '广州'],
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
  id: 'flight:book-constrained-4leg',
  domain: 'flight',
  difficulty: 'hard',
  userGoal:
    '帮我订下周出差的四程机票：① 周一 北京→上海 ② 周二 上海→广州 ③ 周五 广州→北京 ' +
    '④ 次周二 北京→广州。每程都必须：东方航空（东航）、下午（12:00 及以后）出发、' +
    '价格低于 ¥1100、剩余座位多于 1。每程各选最便宜的一张，共订 4 张。乘客 Alice。',
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
