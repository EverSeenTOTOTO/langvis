/**
 * 确定性大 catalog 生成器(G4.3):5 city-pair × 40 条 = 200。
 *
 * 目的:让 8K 模型(localhost:qwen3.5-9b, 阈值 ~6553 tok)在多程任务里累积大观测,
 * 触发 mid-loop 压缩(>4 步 + 过阈);baseline 不折叠则爆 8192 全窗。
 *
 * 纯函数派生(无 Math.random/Date):同输入恒同输出,per-run 可复现,跨 trial 确定性。
 * 约束空间(东航 + 下午 + <¥1100 + seats>1)在每对内有唯一最便宜解,供 success 重算比对。
 *
 * city-pair 覆盖多程起讫:
 *   京沪(京→沪) / 沪广(沪→广) / 广京(广→京) / 京广(京→广) / 沪京(沪→京)
 *   A(3leg): 京→沪 / 沪→广 / 广→京
 *   B(4leg): + 京→广
 */
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

/**
 * 由全局 index 派生一条 flight。字段都从 index 算术出,无随机。
 * - airline:4 航司轮转(每对内 ~10 条/航司)
 * - depart:5 时段轮转(保证每对里早/午/晚都有)
 * - price:800..1399 散布,经乘数错位避免相邻 index 雷同
 * - seats:1..4 轮转(刻意掺 seats=1 陷阱,占 1/4)
 */
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
