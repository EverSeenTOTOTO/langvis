// G4.3 Task A：2 程多约束，测压缩无损性——baseline 不折叠可过，default
// 触发 mid-loop 压缩仍须过；target 的 seats/价格若被压缩丢即误订。
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

// 正确答案须在 setup 预订前于 fresh catalog 上算：book_flight 会扣 seats，
// 若用订后 b.flights 重算，target 会被扣减挤掉。确定性，加载时算一次即可。
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
