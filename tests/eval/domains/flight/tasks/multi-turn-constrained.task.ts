/**
 * G4.5 多 turn 会话级压缩任务 — 跨 turn 累积压到 history 阈值，逼出 turn-end
 * CompactTransform（会话级压缩），是 4leg 的会话级镜像。
 *
 * 5 turn、每 turn 订一个 distinct city-pair（catalog 5 对全用），cross-turn 共享沙箱。
 * 每 turn user 消息内嵌一段 ~1k tok 的差旅备忘（真实、逐 turn 不同——非同质填充）。
 * user 消息不被 processSummary 折叠（只折 assistant turn→meta.summary），故逐 turn
 * 原样累积进 history：system(~2.5k) + 5×(user ~1k + summary ~0.5k) → ~turn3-4 越过
 * 0.8×8192=6553。
 *
 *   - bare：loop/history fragment 省略 → mid-loop fold 与 turn-end CompactTransform
 *     都早 return；context 跨 turn 无界增长 → ~turn4-5 爆 8192 → run failed(400 overflow)。
 *   - compact-only/hybrid：turn-end CompactTransform 触发，把 tail 折成一条 compact 摘要 →
 *     回到窗内 → 跑完 5 turn。offload-only：offload(0.5) 桩化老 user 消息到盘 → 同样在窗内。
 *
 * 预期 headroom 正（压缩救活 baseline 必挂的跨 turn 累积爆窗）——验证"会话级压缩触发与否"。
 * hist_compact 列（runner 计 meta.kind=compact 条数）即本任务的核心读数。
 *
 * grading 与 4leg 同：fresh-catalog cheapestConstrained target、distinct pair 无 seat 冲突。
 */
import type { MultiTurnTask } from '../../../types';
import {
  createBookingBackend,
  flightToolDefs,
  flightToolSet,
  type BookingBackend,
} from '../sandbox';
import { CITY_PAIRS, generateCatalog, cheapestConstrained } from '../catalog';

/** 5 distinct city-pair，每 turn 一个。顺序对应 turns 里的工作日。 */
const LEGS: ReadonlyArray<readonly [string, string]> = CITY_PAIRS;

/** 每 turn 正确答案：fresh catalog 上满足全约束的最便宜 flight（见 4leg 注释）。 */
const TARGETS = new Map(
  LEGS.map(([o, d]) => [
    `${o}|${d}`,
    cheapestConstrained(generateCatalog(), o, d).id,
  ]),
);

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五'];

/**
 * 逐 turn 差旅备忘（内容各异）：同行人 / 预算 / 会议目的 / 到达安排 / 特殊说明 / 应急。
 * 真实差旅语境，非同质填充。
 *
 * TODO(exec-eval)：实测 9B 在 turn 3-5 不再调 search_flights，却在 response_user 里"我筛选了
 * 符合条件的航班：f80 MU1081…"——把未搜索的 leg 伪造成已筛选（且 f80 真值是 CA1080/国航/07:30/
 * ¥960/座1，模型编成 MU1081/东航/12:30/¥953/座2 全部"恰好"满足约束），再"是否确认预订？"而非
 * book_flight。这是对 search/filter 步骤输出的幻觉，非幻觉工具调用本身。success 只验末态 bookings，
 * 抓不到"未搜索就报数据"——需加 agent 执行评判机制：每条 response_user 引用的实体(航班号/价格)
 * 须能在本轮前置 tool_result 中追溯，否则判 hallucination fail。当前留 TODO，任务本身保留以暴露此行为。
 */
const BRIEFINGS: string[] = [
  `【差旅备忘·第 1 程 / 京→沪】华东区客户回访季首站。同行人：技术总监 Bob Chen（东航金卡，积分尾号 8841）。预算：本程机票上限 ¥1000，超出走 OA 二级审批（财务王经理 8211）。会议：与张江客户"芯启科技"做 Q3 系统集成方案评审，对方负责人 Linda Wang（138xxxx4920），14:00 入场、14:30 我主讲方案、16:00 Q&A。到达：浦东落地打车去张江园区（~35min ¥120），行李寄存全季张江店（确认码 Q-7732）。特殊说明：Bob 只坐东航（MU 字头），上午有晨会须下午 12:00 后出发。剩余座位多于 1（Bob 同行另订同班次，本程只订 Alice 一张）。如最便宜不满足约束，顺位次便宜，全程只订一张。`,
  `【差旅备忘·第 2 程 / 沪→广】参加供应链年度供应商大会。独行。预算：差旅包干 ¥5000，已订琶洲展馆店 ¥620/晚×2（订单 GZ-1108），机票预算 ¥1100 内。会议：13:30 签到换证（带名片 30 张）、14:30 主题演讲（采购陈总）、15:45 分组圆桌（B 组电子料件组桌号 7，我备 5min Q4 交付能力陈述）、17:00 晚宴。到达：白云 T2 落地乘 3 号线转 8 号线到琶洲 A 口（~50min ¥7），行李先放酒店。特殊说明：东航金卡走优先安检，只订东航；下午出发以便上午收尾上海客户纪要。座>1 硬约束（留改签缓冲）。不要早班（与上海收尾冲突）。`,
  `【差旅备忘·第 3 程 / 广→京】广返京汇报区域进展。同行人：区域销售 Sara Liu（同部门，东航银卡）。预算：本程上限 ¥1050，二人合计 ¥2100，部门差旅池（leader 张明飞书已批）。会议：周五 16:00 总部季度经营分析会（CFO 主持），提前 1h 到场与财务对齐口径，会议室 B 栋 3 层 301，我汇报华东区 Q3 业绩+Q4 预测（材料 /华东区/Q3复盘.pptx）。到达：首都 T3 落地打车回国贸总部（~40min，避开晚高峰）。特殊说明：只坐东航；下午出发避开广州上午雷雨延误高发（7-9 点延误率 40%）。座>1（各订一张，留改签空间）。`,
  `【差旅备忘·第 4 程 / 京→广】华南数据中心选址踏勘（Q4 重点项目）。同行人：基建负责人 Mark Zhao（工号 I-073，负责测算与电力对接）。预算：本程 ¥1000 内，基建专项（基建总监老周已批，CAPEX-2026-0317）。会议：周二 15:00 与广州开发区管委会踏勘候选地块（A：知识城 NFC-7 电力富余；B：科学城 SCS-2 网络骨干），14:00 前到管委会与李处（139xxxx8810）碰头，带选址测算表+无人机航拍许可。到达：白云→知识城管委会打车 ~40min，当晚住知识城亚朵（确认码 AT-9921）。特殊说明：Mark 只坐东航；下午出发以便上午在总部过踏勘清单。座>1（各订一张，便于现场协同）。`,
  `【差旅备忘·第 5 程 / 沪→京】沪返京收尾出差、赶次周周会。独行。预算：本程 ¥950 内（包干余额紧，前 4 程用 ¥4080，剩 ¥920）。会议：次周一 9:00 总部周会（CEO 主持须准时），故周五下午返京。到达：首都 T3 落地打车回顺义（~1h ¥180，提前滴滴预约接机）。特殊说明：只订东航；下午出发以便上午定稿客户回访纪要（发 Linda+Slack #华东区，抄送 leader 张明）。座>1（周末返程高峰，留缓冲勿订边缘票）。如余座仅 1 跳过选次便宜。`,
];

const turns: string[] = LEGS.map(
  ([o, d], i) =>
    `帮我订第 ${i + 1} 程：${WEEKDAYS[i]} ${o}→${d}。` +
    `要求：东方航空（东航）、下午（12:00 及以后）出发、价格低于 ¥1100、剩余座位多于 1，` +
    `选最便宜的一张。乘客 Alice。本轮只订这一张。\n\n${BRIEFINGS[i]}`,
);

const task: MultiTurnTask<BookingBackend> = {
  id: 'flight:multi-turn-constrained',
  domain: 'flight',
  difficulty: 'hard',
  turns,
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
      reason: `booked all ${LEGS.length} constrained-cheapest legs across turns`,
    };
  },
};

export default task;
