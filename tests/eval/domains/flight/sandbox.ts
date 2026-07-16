/**
 * flight 域：内存订票沙箱 + 虚构工具。
 * 工具是无状态 singleton（registerTool），沙箱经 runId 绑定（fictional-tool 基类取回）。
 */
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
  constructor(flights: Flight[]) {
    this.flights = flights;
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
