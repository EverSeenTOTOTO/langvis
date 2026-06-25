# 记忆压缩（Memory Compaction）领域共识

> 领域共识笔记：统一语言 + 核心模型决策。实现细节见后续 plan。

## 一、问题

ReAct agent 的上下文会随对话历史与单次 loop 累积而撑爆。现状：

- 只有 `SlidingWindowMemory` 按轮次硬截断（被本特性取代）；
- `contextUsage` 只量**原始历史**，看不到 loop 内 `iterMessages` 的膨胀——历史不大、但 loop 中反复读文件把迭代消息撑爆时，现有机制毫无感知。

需要按 token 预算做有损压缩；压缩产物**前端不可见、LLM 可见**，且能跨 run 复用以避免每次对话重压。

## 二、统一语言（Ubiquitous Language）

| 术语                          | 定义                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 对话历史 Conversation History | 跨 run 持久、源真相、前端可见的消息序列。每个完成的 turn 贡献一条"坍缩条目"。                                                                |
| 迭代上下文 Iteration Context  | 单个 ReAct loop 内、临时增长的迭代消息。loop 结束即消亡。                                                                                    |
| Turn                          | 一次用户请求 → 一个 Loop → 坍缩为一条历史条目。                                                                                              |
| 记忆压缩 / Compaction         | 按 token 预算，把消息序列早期部分递归归纳为摘要、近期部分原样保留的过程。（区别于 `cache.provider` 的 compress——后者是工具输出落盘，无关。） |
| 摘要 C / CompactionSummary    | 历史压缩产物。持久值对象 `{content, endMessageId, startRef?}`，按 `end` 位置定位的滚动折叠。                                                 |
| 过程摘要 ProcessSummary       | loop 退出时的最后一次折叠产物，附到 agent message 的隐藏位（`meta` 演进）。用户不可见。                                                      |
| 上下文用量（拆分）            | IterationUsage（当前 loop）与 HistoryUsage（历史），各自 `{used,total,threshold}`。                                                          |

## 三、核心模型：一个 `fold` 原语 + 两层上下文

唯一的折叠原语：

```
fold(prevSummary | null, messages[]) → newSummary
```

三种调用时机，**折叠本身完全一致**，只在折叠范围 / 触发 / 产物去向上不同：

| 用途      | 折叠范围                                | 触发                | 产物去向                                |
| --------- | --------------------------------------- | ------------------- | --------------------------------------- |
| mid-loop  | 本 loop 较早的 actions                  | IterationUsage 超阈 | 临时（loop 内）                         |
| loop-exit | `[last loopCompressed, 剩余 loop msgs]` | loop 退出           | 持久 → ProcessSummary，附 agent message |
| post-turn | `[C, history.tail]`（tail 已含新 turn） | HistoryUsage 超阈   | 持久 → 新 C，取代旧 C                   |

首次折叠 `prevSummary=null`：短 loop 没 mid-fold 时，exit fold 直接从 `[query, 全部 loop msgs]` 起；首个 C 同理（无前驱 C）。**ProcessSummary 与 IterationCompaction 是同一原语，只是"最后一次 + 持久化"。**

**Iteration Context（每步 loop 喂给 LLM 的东西）：**

```
┌──────────────────────────────────┬────────────────────────────────┐
│  [C,  history.slice(C.end)]       │  currentUserQuery, a1,a2,...    │
│   持久的历史压缩前缀（跨 run）     │   本 turn loop 累积（持续增长）  │
└──────────────────────────────────┴────────────────────────────────┘
        ↑ loop 内不重压                          ↑ IterationCompaction 只折这一段
```

## 四、关键决策

1. **摘要按位置（`end` 指针）定位的滚动折叠，非内容寻址 DAG。** 新 C 吸收旧 C 内容、自洽，不存反向依赖。构建有效历史 = 取 `end ≤ 当前` 的最新 C + 其后消息，O(1)。
2. **跨 run 复用 / rewind 复用都免费**：C 按 `end` 的 msg id 定位（稳定），前缀没变即复用；rewind 到点 P 取 `end ≤ P` 的最新 C，仅当 rewind 进入某 C 覆盖区间或编辑已摘要消息时才重算那一段。
3. **坍缩 = 投影**：loop 的全量迭代明细留在 `AgentRun.events`（已有，前端富视图来源），坍缩只是 LLM 所见的有效视图。
4. **ContextUsage 必须拆分** Iteration / History，且量的是**有效上下文**（post-compaction），而非原始历史。`context_compressed` reason 已在 `ContextUsageMeta` 联合类型（`events.ts:78`），只缺生产者。
5. **调试可见性**：loop 每步提交 LLM 前，把最终 IterationContext 落 debug 日志。
