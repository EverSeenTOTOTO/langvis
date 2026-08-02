// G4.4 跨 city-pair 比价订票，测 offload 无损性/回查链：2 次 search 累积过 8K 阈值，
// offload 变体下老 obs 被桩化，模型仍须正确比价订票（offload 应可回取、不丢信息）。
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
