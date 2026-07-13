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
    flightNo: 'CZ3501',
    origin: '北京',
    destination: '广州',
    depart: '09:00',
    price: 1500,
    airline: '南航',
    seats: 4,
  },
];

const task: Task<BookingBackend> = {
  id: 'flight:book-cheapest',
  domain: 'flight',
  difficulty: 'easy',
  userGoal:
    '帮我订一张从北京到上海的最便宜机票，乘客 Alice。订好后告诉我航班号和价格。',
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
    const cheapest = b.flights
      .filter(f => f.origin === '北京' && f.destination === '上海')
      .reduce((a, c) => (c.price < a.price ? c : a));
    if (bk.flightId !== cheapest.id) {
      return {
        pass: false,
        reason: `booked ${bk.flightId}, cheapest was ${cheapest.id}`,
      };
    }
    if (bk.passenger !== 'Alice') {
      return { pass: false, reason: `passenger ${bk.passenger} != Alice` };
    }
    return {
      pass: true,
      reason: `booked cheapest ${cheapest.flightNo} for Alice`,
    };
  },
};

export default task;
