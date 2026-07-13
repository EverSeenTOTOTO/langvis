import type { MultiTurnTask } from '../../../types';
import {
  createBookingBackend,
  flightToolDefs,
  flightToolSet,
  type BookingBackend,
  type Flight,
} from '../sandbox';

const FLIGHTS: Flight[] = [
  {
    id: 'f1',
    flightNo: 'CA1501',
    origin: '北京',
    destination: '上海',
    depart: '08:00',
    price: 1200,
    airline: '国航',
    seats: 5,
  },
  {
    id: 'f2',
    flightNo: 'MU5101',
    origin: '北京',
    destination: '上海',
    depart: '14:00',
    price: 980,
    airline: '东航',
    seats: 3,
  },
];

/**
 * 多 turn smoke：测的是多 turn harness 管线本身——四条压缩机制可观测、跨轮共享沙箱、
 * 事件合并、末轮 success 拿到累积状态。**不**测 summary 在压缩后的存活
 * （那需要 catalog 大到触发 history 压缩，见 G4.3）。
 *
 * turn 1：订一张北京→上海最便宜票，乘客 Alice（→ bookings 应有 1 条 f2）。
 * turn 2：取消这张票——只说"取消我刚才订的那张"，不重述航班/乘客，
 * agent 必须沿用 turn 1 的 bookingId 取消（验证跨轮上下文贯通）。
 */
const task: MultiTurnTask<BookingBackend> = {
  id: 'flight:multi-turn-cancel',
  domain: 'flight',
  difficulty: 'easy',
  turns: [
    '帮我订一张从北京到上海的最便宜机票，乘客 Alice。订好后告诉我航班号。',
    '我改主意了，取消我刚才订的那张票。',
  ],
  setup: () => ({
    sandbox: createBookingBackend(FLIGHTS),
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
    if (b.bookings.length !== 0) {
      return {
        pass: false,
        reason: `expected 0 bookings after cancel, got ${b.bookings.length}`,
      };
    }
    return {
      pass: true,
      reason:
        'booked in turn 1 then cancelled in turn 2 (cross-turn context held)',
    };
  },
};

export default task;
