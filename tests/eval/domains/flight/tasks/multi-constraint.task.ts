import type { Task } from '../../../types';
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
  {
    id: 'f3',
    flightNo: 'MU5102',
    origin: '北京',
    destination: '上海',
    depart: '15:00',
    price: 1100,
    airline: '东航',
    seats: 2,
  },
  {
    id: 'f4',
    flightNo: 'MU5102',
    origin: '北京',
    destination: '上海',
    depart: '18:00',
    price: 880,
    airline: '东航',
    seats: 1,
  },
];

const task: Task<BookingBackend> = {
  id: 'flight:multi-constraint',
  domain: 'flight',
  difficulty: 'medium',
  userGoal:
    '帮我订一张北京到上海的机票：必须是下午（12:00 及以后）出发、东方航空（东航）、且在这些条件里最便宜。乘客 Bob。',
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
    if (b.bookings.length !== 1) {
      return {
        pass: false,
        reason: `expected 1 booking, got ${b.bookings.length}`,
      };
    }
    const bk = b.bookings[0]!;
    const candidates = b.flights.filter(
      f =>
        f.origin === '北京' &&
        f.destination === '上海' &&
        f.airline === '东航' &&
        parseInt(f.depart) >= 12,
    );
    const target = candidates.reduce((a, c) => (c.price < a.price ? c : a));
    if (bk.flightId !== target.id) {
      return {
        pass: false,
        reason: `booked ${bk.flightId}, constrained cheapest was ${target.id} (${target.flightNo})`,
      };
    }
    return {
      pass: true,
      reason: `booked constrained cheapest ${target.flightNo}`,
    };
  },
};

export default task;
