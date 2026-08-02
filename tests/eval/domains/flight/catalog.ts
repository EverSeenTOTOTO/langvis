// 确定性 catalog：5 city-pair × 40 = 200，纯函数派生，逼 8K 模型累积观测触发 mid-loop 压缩。
import type { Flight } from './sandbox';

const AIRLINES = ['国航', '东航', '南航', '海航'] as const;
const DONGHANG = '东航';

/** 5 city-pair(方向固定):[origin, destination]。 */
export const CITY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['北京', '上海'], // 京沪
  ['上海', '广州'], // 沪广
  ['广州', '北京'], // 广京
  ['北京', '广州'], // 京广
  ['上海', '北京'], // 沪京
];

const PAIR_SIZE = 40;
const TIMES_OF_DAY = ['07:30', '09:00', '12:30', '15:00', '18:00'] as const;

// 由全局 index 算术派生字段（无随机）：航司/时段轮转、价格散布、seats=1 陷阱。
function makeFlight(globalIndex: number): Flight {
  const pairIndex = Math.floor(globalIndex / PAIR_SIZE);
  const within = globalIndex % PAIR_SIZE;
  const [origin, destination] = CITY_PAIRS[pairIndex]!;
  const airline = AIRLINES[within % AIRLINES.length]!;
  const depart = TIMES_OF_DAY[within % TIMES_OF_DAY.length]!;
  const price = 800 + ((globalIndex * 37) % 600); // 800..1399
  const seats = 1 + (globalIndex % 4); // 1..4
  const flightNo = `${airline === DONGHANG ? 'MU' : airline === '国航' ? 'CA' : airline === '南航' ? 'CZ' : 'HU'}${1000 + globalIndex}`;
  return {
    id: `f${globalIndex + 1}`,
    flightNo,
    origin,
    destination,
    depart,
    price,
    airline,
    seats,
  };
}

export function generateCatalog(): Flight[] {
  const total = CITY_PAIRS.length * PAIR_SIZE; // 200
  const flights: Flight[] = [];
  for (let i = 0; i < total; i++) flights.push(makeFlight(i));
  return flights;
}

/** 约束集(与 task 的 userGoal 一致);success 据此重算每程唯一 target。 */
export const CONSTRAINTS = {
  airline: DONGHANG,
  minDepart: '12:00',
  maxPrice: 1100,
  minSeats: 2,
} as const;

/** 某方向上满足全部约束的最便宜 flight(任务正确答案);无解抛错(生成器缺陷保护)。 */
export function cheapestConstrained(
  flights: readonly Flight[],
  origin: string,
  destination: string,
): Flight {
  const cand = flights
    .filter(
      f =>
        f.origin === origin &&
        f.destination === destination &&
        f.airline === CONSTRAINTS.airline &&
        f.depart >= CONSTRAINTS.minDepart &&
        f.price < CONSTRAINTS.maxPrice &&
        f.seats >= CONSTRAINTS.minSeats,
    )
    .sort((a, b) => a.price - b.price);
  const best = cand[0];
  if (!best) {
    throw new Error(
      `no constrained cheapest for ${origin}→${destination} (catalog gen defect)`,
    );
  }
  return best;
}
