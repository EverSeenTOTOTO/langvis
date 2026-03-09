# Agent VM 设计文档

## 一、设计目标

Agent VM 是一个用于执行 LLM 驱动 Agent 的运行时系统。与传统 Agent（如 ReAct）不同，本系统将 Agent 行为抽象为一组可执行指令，由虚拟机负责执行，LLM 负责生成指令。

### 核心目标

1. 将 Agent 行为表示为明确的控制流，而非隐式推理过程
2. 保证执行过程确定性（deterministic runtime）
3. 将短期数据流与长期上下文分离（记忆系统）
4. 支持 Agent 调用（类似函数调用），支持工具调用（类似系统调用）
5. 支持变量作用域和上下文覆盖
6. 允许用户中断、暂停或切换任务

### 核心理念

```
LLM = compiler（编译器）
Agent VM = runtime（运行时）
```

LLM 不负责执行任务，只负责生成指令。VM 负责解释和执行指令。

### Agent 是一等公民

Agent 从"调用目标"变成"可操作的数据"。支持：
- 高阶 Agent（Agent 作为参数传递）
- Agent 闭包（捕获环境变量）
- Agent 组合（map/filter/compose）

---

## 二、核心概念

系统由三个基本结构组成：

### 1. 虚拟机（VM）

- 执行循环
- 维护 Frame 栈
- 执行指令
- 管理 LLM 调用

### 2. 调用栈（Frame Stack）

- 后进先出（LIFO）
- 每个 Agent 调用对应一个 Frame
- Frame 之间形成调用关系

### 3. Agent Frame

单个 Agent 的执行上下文。

```
Frame {
  locals: Map<string, Value>    // 局部变量
  operand_stack: Value[]        // 操作栈
  parent: Frame | null          // 父 Frame
}
```

**locals**

存储当前 Agent 的变量：
- `agent`：当前 Agent 闭包
- `goal`：当前目标
- 中间结果
- 工具引用（预置）

**operand stack**

存储短期数据：
- 工具调用返回值
- Agent 返回值
- 临时计算结果
- 函数参数
- Agent 闭包

**parent**

指向调用该 Agent 的 Frame，用于实现变量作用域链。

---

## 三、执行模型

### 主循环

```
while (frame_stack not empty) {
  frame = top(frame_stack)
  context = build_context(frame)
  transaction = LLM(context)    // 生成一个事务
  execute(transaction)          // 执行事务内所有指令
}
```

### 事务（Transaction）

事务是原子执行单位，包含多条指令。

特性：
- 一个事务内调用一次 LLM
- 事务内指令顺序执行
- 事务执行期间不被打断
- 事务边界是中断点

### LLM 上下文构造

每次调用 LLM 时构造输入上下文：

```
Agent: <当前 Agent 名称>
Goal: <当前目标>

Variables:
  <当前 Frame 的变量列表>

Operand Stack:
  <栈顶若干元素>

Available Tools:
  <工具列表及描述>

Available Agents:
  <可调用的 Agent 列表>

Allowed Instructions:
  <允许的指令及描述>
```

LLM 输出一个事务的指令序列。

---

## 四、变量作用域

### 作用域链

变量访问遵循链式查找规则：

1. 先查找当前 `Frame.locals`
2. 若不存在，查找 `parent Frame`
3. 依次向上，直到根 Frame

### 变量覆盖（Shadowing）

子 Frame 可以覆盖父 Frame 的变量：

```
Frame A:
  goal = "完成需求"

Frame B (child of A):
  goal = "分析文档"

// Frame B 中读取 goal → "分析文档"
// Frame A 不受影响
```

### 工具作为预置变量

工具在根 Frame 初始化时注入到 `locals`：

```
root_frame.locals = {
  web_fetch: Syscall("web_fetch"),
  doc_analysis: Syscall("doc_analysis"),
  ...
}
```

通过 `LOAD` 指令加载工具引用，与普通变量一致。

---

## 五、操作栈

操作栈用于传递短期数据，遵循 LIFO 结构。

### 特性

- 只属于当前 Frame
- 子 Frame 不继承父 Frame 的栈
- 用于传递 CALL/SYSCALL 的参数和返回值

### 参数传递约定

参数按顺序压入栈，栈顶是最后一个参数：

```
// 调用 send_email(to, subject, body)
PUSH body
PUSH subject
PUSH to
LOAD send_email
CALL
// 参数顺序：to, subject, body
```

---

## 六、指令集

### 完整指令集

| 指令 | 参数 | 语义 |
|------|------|------|
| `PUSH` | `value` | 压入字面量到操作栈 |
| `LOAD` | `var` | 将变量值压入操作栈 |
| `STORE` | `var` | 弹出栈顶并存入变量 |
| `PUSH_AGENT` | `agent_id` | 创建 Agent 闭包（捕获当前环境）并压入栈 |
| `CALL` | 无 | 调用栈顶的 callable |
| `RET` | 无 | 返回，弹出当前 Frame |

### VM 值类型

```
enum Value {
  Literal      // JSON 值：string | number | boolean | null | array | object
  Closure      // Agent 闭包 { agent_id, captured_vars }
  Syscall      // 工具引用 { tool_id }
  Continuation // 延续（P1）
}
```

**Literal**

所有 JSON 可表示的值统一为 `Literal` 类型：
- `string`、`number`、`boolean`、`null`
- `array`（`Value[]`）
- `object`（`Map<string, Value>`）

**Closure**

Agent 闭包，捕获当前环境的变量：
```
Closure {
  agent_id: string
  captured_vars: Map<string, Value>
}
```

**Syscall**

工具引用，在根 Frame 初始化时注入：
```
Syscall {
  tool_id: string
}
```

**Continuation**

延续，用于高级控制流（P1）。

### 指令格式

指令序列使用 JSON 数组格式：

```json
[
  {"op": "PUSH", "value": "https://example.com"},
  {"op": "LOAD", "var": "web_fetch"},
  {"op": "CALL"},
  {"op": "STORE", "var": "page"}
]
```

### 指令详解

#### PUSH

压入字面量值。

```json
{"op": "PUSH", "value": "hello"}
{"op": "PUSH", "value": 42}
{"op": "PUSH", "value": {"key": "value"}}
```

#### LOAD

从 locals 加载变量，压入栈顶。支持作用域链查找。

```json
{"op": "LOAD", "var": "url"}
{"op": "LOAD", "var": "web_fetch"}  // 加载工具
```

#### STORE

弹出栈顶，存入当前 Frame 的 locals。

```json
{"op": "STORE", "var": "page"}
```

#### PUSH_AGENT

创建 Agent 闭包，捕获当前环境的变量，压入栈。

```json
{"op": "PUSH_AGENT", "agent_id": "document_agent"}
```

#### CALL

调用栈顶的 callable：

- 若是 `Syscall`：调用工具，返回值压入栈
- 若是 `Closure`：创建新 Frame，入栈，开始执行

```json
{"op": "CALL"}
```

#### RET

结束当前 Agent 执行：

1. 弹出当前 Frame
2. 若有返回值，压入父 Frame 的操作栈
3. 继续执行父 Frame 的下一条指令

```json
{"op": "RET"}
```

---

## 七、事务与回滚

### 事务边界

- 每次调用 LLM 生成一个事务
- 事务内指令顺序执行，不可打断
- 事务执行完成后，VM 检查中断信号

### 取消与补偿（Saga 模式）

不支持传统回滚（时间旅行式撤销）。采用 Saga 补偿模式：

- 用户请求取消 → LLM 生成补偿指令序列
- 补偿操作追加执行，而非撤销历史
- 补偿可能不完美（如已发送的邮件），由 LLM 告知用户

### 工具职责边界

工具不持有流程执行状态，也不提供 `undo` 方法。

回滚补偿由 LLM 结合当前可用工具判断如何执行：
- LLM 决定调用哪些工具来补偿
- 补偿逻辑是运行时决策，而非工具内置能力

---

## 八、错误处理

### 错误作为值

工具调用失败不打断事务，错误作为返回值：

```typescript
type Result<T> = 
  | { ok: true; data: T }
  | { ok: false; error: string }
```

示例：

```json
[
  {"op": "PUSH", "value": "https://example.com"},
  {"op": "LOAD", "var": "web_fetch"},
  {"op": "CALL"},
  {"op": "STORE", "var": "result"}
]
// result = { ok: true, data: "..." } 或 { ok: false, error: "timeout" }
```

LLM 根据结果决定下一步操作。

---

## 九、中断与恢复

### 取消任务

用户 `Ctrl-C` 或前端取消对话：
- 终止 VM 执行循环

### Rewind（回退到指定 Frame）

用户请求"回退到某个 Frame"，例如当前在 A→B→C 链上，用户要取消 C 回到 B：

1. LLM 在 C 的 Frame 中生成补偿指令
2. 执行补偿，清理 C 的副作用
3. C 执行 `RET`，返回 `{ cancelled: true, reason: "..." }`
4. B 收到返回值，LLM 决定下一步（继续或也取消）

### 返回值结构

```typescript
type RetValue = 
  | { ok: true, data: any }           // 正常返回
  | { ok: false, error: string }      // 执行失败
  | { cancelled: true, reason: string }  // 被取消/rewind
```

RET 统一处理所有返回场景。

### Human-in-the-loop

`HumanInTheLoopTool` 与其他工具一致：
- 等待用户输入
- 采集结果
- 返回给 Agent 分析下一步

---

## 十、执行限制

### 栈深度限制

防止无限递归：

```
max_frame_depth = 100  // 可配置
```

超过限制时抛出错误。

### 尾调用优化（P1）

Agent 调用后立即返回的场景：

```
// Agent A 的最后一步
PUSH_AGENT B
CALL
RET  // 可优化为：直接跳转到 B，复用当前 Frame
```

---

## 十一、记忆系统

长期记忆以 facts 形式存在，作为变量注入：

- 在合适的时机注入到 `locals`
- VM 层面不感知记忆逻辑

本期不作为重点。

---

## 十二、示例

### 示例 1：获取并分析文档

```json
[
  {"op": "PUSH", "value": "https://example.com/doc"},
  {"op": "LOAD", "var": "web_fetch"},
  {"op": "CALL"},
  {"op": "STORE", "var": "page"},
  {"op": "LOAD", "var": "page"},
  {"op": "LOAD", "var": "doc_analysis"},
  {"op": "CALL"},
  {"op": "STORE", "var": "analysis"},
  {"op": "LOAD", "var": "analysis"},
  {"op": "RET"}
]
```

### 示例 2：创建 Agent 闭包并调用

```json
[
  {"op": "PUSH", "value": "分析下 https://example.com/1"},
  {"op": "PUSH_AGENT", "agent_id": "document_agent"},
  {"op": "CALL"},
  {"op": "STORE", "var": "result1"}
]
```

### 示例 3：处理错误

第一个事务：尝试请求

```json
[
  {"op": "PUSH", "value": "https://flaky-api.com"},
  {"op": "LOAD", "var": "web_fetch"},
  {"op": "CALL"},
  {"op": "STORE", "var": "result"}
]
// result = { ok: false, error: "timeout" }
```

第二个事务（LLM 根据错误结果生成）：重试

```json
[
  {"op": "PUSH", "value": "https://flaky-api.com"},
  {"op": "LOAD", "var": "web_fetch"},
  {"op": "CALL"},
  {"op": "STORE", "var": "result"}
]
```

第三个事务（成功后）：继续处理

```json
[
  {"op": "LOAD", "var": "result"},
  {"op": "PUSH", "value": "data"},
  {"op": "LOAD", "var": "get_field"},
  {"op": "CALL"},
  {"op": "STORE", "var": "data"},
  {"op": "RET"}
]
```

---

## 十三、设计原则总结

1. **指令集最小化** — 6 条指令，避免 LLM 幻觉
2. **确定性执行** — VM 行为可预测，便于调试和恢复
3. **错误作为值** — 不打断执行，LLM 决定处理方式
4. **Saga 补偿** — 不支持回滚，追加补偿操作
5. **作用域隔离** — 子 Frame 变量独立，避免污染
6. **一等公民 Agent** — 支持闭包、组合、高阶调用

---
