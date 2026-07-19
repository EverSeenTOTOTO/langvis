/**
 * flight 域：内存订票沙箱 + 虚构工具。
 * 工具是无状态 singleton（registerTool），沙箱经 runId 绑定（fictional-tool 基类取回）。
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tool } from '@/server/decorator/tool';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import { FictionalTool } from '../../fictional-tool';
import type { FictionalToolDef } from '../../types';

export interface Flight {
  id: string;
  flightNo: string;
  origin: string;
  destination: string;
  depart: string; // HH:mm
  price: number;
  airline: string;
  seats: number;
}

export interface Booking {
  id: string;
  flightId: string;
  passenger: string;
}

export class BookingBackend {
  readonly flights: Flight[];
  readonly bookings: Booking[] = [];
  /** runner 注入（attachWorkDir）；订票状态镜像到 bookings.json 供只读审计 cat 复核。 */
  workDir = '';

  constructor(flights: Flight[]) {
    // 深拷贝：book_flight 原地 flight.seats--，若按引用共享调用方数组
    // （task 模块级 const FLIGHTS 跨 trial 复用），座位会被前序 run 扣光、
    // 后序 run 收到 seats=0 → 误判。每 run 拷一份，扣减仅本 run 可见。
    this.flights = flights.map(f => ({ ...f }));
  }

  /**
   * 把订票后端状态快照写 workDir/bookings.json：含当前余票与全部订票记录。
   * 目的是给只读审计一条查询途径——审计子 run 只有 bash，订票真相在内存
   * backend 里它够不着；落盘后 `cat bookings.json` 即可复核 reply 是否站得住
   * （订了几张、是否最便宜、是否还有票），与 fs 域审计 cat demo.py 同构。
   */
  persist(): void {
    if (!this.workDir) return;
    try {
      mkdirSync(this.workDir, { recursive: true });
      writeFileSync(
        join(this.workDir, 'bookings.json'),
        JSON.stringify(
          {
            flights: this.flights.map(f => ({
              id: f.id,
              flightNo: f.flightNo,
              origin: f.origin,
              destination: f.destination,
              depart: f.depart,
              price: f.price,
              airline: f.airline,
              seats: f.seats,
            })),
            bookings: this.bookings.map(b => ({
              id: b.id,
              flightId: b.flightId,
              passenger: b.passenger,
            })),
          },
          null,
          2,
        ),
        'utf-8',
      );
    } catch {
      // 落盘失败不应阻断订票主路径；审计届时会 abstain（无 bookings.json 可读）。
    }
  }
}

// —— 工具 ——

@tool('search_flights' as unknown as ToolIds)
export class SearchFlightsTool extends FictionalTool<
  { flights: Flight[] },
  BookingBackend
> {
  async *run(b: BookingBackend, input: Record<string, unknown>) {
    const { origin, destination } = input as {
      origin?: string;
      destination?: string;
    };
    const flights = b.flights.filter(
      f =>
        (!origin || f.origin === origin) &&
        (!destination || f.destination === destination),
    );
    return { flights };
  }
}

@tool('get_flight_detail' as unknown as ToolIds)
export class GetFlightDetailTool extends FictionalTool<
  { flight: Flight } | { error: string },
  BookingBackend
> {
  async *run(b: BookingBackend, input: Record<string, unknown>) {
    const { flightId } = input as { flightId?: string };
    const flight = b.flights.find(f => f.id === flightId);
    return flight ? { flight } : { error: `flight ${flightId} not found` };
  }
}

@tool('book_flight' as unknown as ToolIds)
export class BookFlightTool extends FictionalTool<
  { bookingId: string } | { error: string },
  BookingBackend
> {
  async *run(b: BookingBackend, input: Record<string, unknown>) {
    const { flightId, passenger } = input as {
      flightId?: string;
      passenger?: string;
    };
    const flight = b.flights.find(f => f.id === flightId);
    if (!flight) return { error: `flight ${flightId} not found` };
    if (flight.seats <= 0) return { error: `flight ${flightId} sold out` };
    flight.seats -= 1;
    const booking: Booking = {
      id: `bk_${b.bookings.length + 1}`,
      flightId: flight.id,
      passenger: passenger ?? '',
    };
    b.bookings.push(booking);
    b.persist();
    return { bookingId: booking.id };
  }
}

@tool('cancel_flight' as unknown as ToolIds)
export class CancelFlightTool extends FictionalTool<
  { cancelled: boolean } | { error: string },
  BookingBackend
> {
  async *run(b: BookingBackend, input: Record<string, unknown>) {
    const { bookingId } = input as { bookingId?: string };
    const idx = b.bookings.findIndex(bk => bk.id === bookingId);
    if (idx === -1) return { error: `booking ${bookingId} not found` };
    b.bookings.splice(idx, 1);
    b.persist();
    return { cancelled: true };
  }
}

// —— 工具配置 + 注册定义 ——

const str = (desc: string) => ({ type: 'string' as const, description: desc });

export const flightToolDefs: FictionalToolDef[] = [
  {
    id: 'search_flights',
    Clz: SearchFlightsTool,
    config: {
      name: 'search_flights',
      description:
        'Search available flights by origin and/or destination (both optional). Returns matching flights.',
      inputSchema: {
        type: 'object',
        properties: {
          origin: str('Departure city, e.g. 北京'),
          destination: str('Arrival city, e.g. 上海'),
        },
      },
    } as unknown as ToolConfig,
  },
  {
    id: 'get_flight_detail',
    Clz: GetFlightDetailTool,
    config: {
      name: 'get_flight_detail',
      description: 'Get full detail of one flight by its id.',
      inputSchema: {
        type: 'object',
        properties: { flightId: str('Flight id, e.g. f2') },
        required: ['flightId'],
      },
    } as unknown as ToolConfig,
  },
  {
    id: 'book_flight',
    Clz: BookFlightTool,
    config: {
      name: 'book_flight',
      description:
        'Book one seat on a flight for a passenger. Decrements available seats.',
      inputSchema: {
        type: 'object',
        properties: {
          flightId: str('Flight id to book'),
          passenger: str('Passenger name'),
        },
        required: ['flightId', 'passenger'],
      },
    } as unknown as ToolConfig,
  },
  {
    id: 'cancel_flight',
    Clz: CancelFlightTool,
    config: {
      name: 'cancel_flight',
      description: 'Cancel an existing booking by booking id.',
      inputSchema: {
        type: 'object',
        properties: { bookingId: str('Booking id to cancel') },
        required: ['bookingId'],
      },
    } as unknown as ToolConfig,
  },
];

const FLIGHT_TOOL_IDS = flightToolDefs.map(d => d.id);

/** flight 域 ToolSet：4 工具 + response_user 全 inline（模型见全 schema）。 */
export function flightToolSet(): ToolSet {
  return ToolSet.of(
    [
      ...FLIGHT_TOOL_IDS.map(id => ({ id, mode: 'inline' as const })),
      { id: ToolIds.RESPONSE_USER, mode: 'inline' as const },
    ],
    [],
  );
}

export function createBookingBackend(flights: Flight[]): BookingBackend {
  return new BookingBackend(flights);
}
