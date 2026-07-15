/**
 * G4.4 检索压力任务 — 跨 city-pair 比价条件订票（测 offload 无损性 / 回查链）。
 *
 * 模型须 search 两个 pair（京沪 + 京广），比较各自约束最便宜价，按条件选订其一。
 * - 2 次 search × ~40 条 ≈ 累积过 8K 模型阈值（6553）→ offload-only/hybrid 变体下老 search obs 被桩化。
 * - 模型要么在 thought 里记下两价（单次消化，offload 无损），要么 cached_read/rg 回查被桩 obs。
 *   offload 设计目标正是"无损、可按需回取"——本任务端到端验证：桩化后模型仍能正确比价订票。
 *
 * 与 2leg/4leg 区别：那两个测累积爆窗（压缩救不救命）；本任务累积较轻（2 search），
 * 重点看 offload/hybrid 变体下桩化是否丢信息（default 不桩、照样过；offload 桩了也须照样过）。
 *
 * grader：京广约束最便宜价 < PRICE_GATE(850) 则订京广 target，否则订京沪 target。
 *   实测 fresh-catalog：京沪 f34@821、京广 f150@913 → 913≥850 → target = 京沪 f34。
 *   若 catalog 调整使 gate 跨越，target 自动重算（fresh-catalog，模块加载时算一次）。
 *
 * 风险：信息能被单次消化进 thought 时，offload 不强制回查——本任务对"回查链"的诊断力有限，
 * 是 offload 无损性的端到端冒烟；强回查任务（须多次精确引用原文细节）待 offload 行为实测后精调。
 */
import type { Task } from '../../../types';
import {
  createBookingBackend,
  flightToolDefs,
  flightToolSet,
  type BookingBackend,
} from '../sandbox';
import { generateCatalog, cheapestConstrained } from '../catalog';

const PAIR_A: readonly [string, string] = ['北京', '上海']; // 京沪
const PAIR_B: readonly [string, string] = ['北京', '广州']; // 京广
const PRICE_GATE = 850;

/** fresh-catalog 上两 pair 的约束最便宜；据此决定本任务 target。 */
const TARGET_A = cheapestConstrained(generateCatalog(), ...PAIR_A);
const TARGET_B = cheapestConstrained(generateCatalog(), ...PAIR_B);
const TARGET = TARGET_B.price < PRICE_GATE ? TARGET_B : TARGET_A;
const EXPECTED_PAIR = TARGET === TARGET_B ? PAIR_B : PAIR_A;

const task: Task<BookingBackend> = {
  id: 'flight:book-constrained-revisit',
  domain: 'flight',
  difficulty: 'hard',
  userGoal:
    `帮我订一张机票，但有个条件：先查 北京→上海 和 北京→广州 两个方向，` +
    `都按 东航 / 下午（12:00 及以后）/ 价格低于 ¥1100 / 剩余座位多于 1 筛，各取最便宜的一张。` +
    `如果 北京→广州 的那张最便宜价低于 ¥${PRICE_GATE}，就订 北京→广州 那张；` +
    `否则订 北京→上海 那张。乘客 Alice。只订一张。`,
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
    if (b.bookings.length !== 1) {
      return {
        pass: false,
        reason: `expected 1 booking, got ${b.bookings.length}`,
      };
    }
    const bk = b.bookings[0]!;
    if (bk.flightId !== TARGET.id) {
      return {
        pass: false,
        reason:
          `booked ${bk.flightId}, expected target ${TARGET.id} ` +
          `(${EXPECTED_PAIR[0]}→${EXPECTED_PAIR[1]} @${TARGET.price}; ` +
          `gate ${PAIR_B[0]}→${PAIR_B[1]} ${TARGET_B.price} ${TARGET_B.price < PRICE_GATE ? '<' : '≥'} ${PRICE_GATE})`,
      };
    }
    return {
      pass: true,
      reason: `booked correct conditional target ${TARGET.id} (${EXPECTED_PAIR[0]}→${EXPECTED_PAIR[1]} @${TARGET.price})`,
    };
  },
};

export default task;
