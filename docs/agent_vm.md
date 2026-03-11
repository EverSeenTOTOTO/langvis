# Agent VM 设计文档

## 一、设计目标

Agent VM 是一个用于执行 LLM 驱动 Agent 的运行时系统。LLM 每次生成**一条指令**，VM 执行后返回结果，形成"思考-行动-观察"循环。

### 核心目标

1. 将 Agent 行为表示为明确的控制流，而非隐式推理过程
2. 保证执行过程确定性（deterministic runtime）
3. 将短期数据流与长期上下文分离（记忆系统）
4. 支持 Agent 调用（类似函数调用），支持工具调用（类似系统调用）
5. 支持变量作用域和上下文覆盖
6. 允许用户中断、暂停或切换任务

### 核心理念

```
LLM = 决策者（每次一个动作）
Agent VM = 执行者（确定性运行时）
```

LLM 不负责执行任务，只负责生成**单条指令**。VM 负责执行指令并返回结果，LLM 根据结果决定下一步。

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
  parent: Frame | null          // 父 Frame
}
```

**locals**

存储当前 Agent 的变量：

- `goal`：当前目标
- 中间结果

**parent**

指向调用该 Agent 的 Frame，用于实现变量作用域链。

---

## 三、执行模型

### 主循环（ReAct 风格）

```
while (frame_stack not empty) {
  frame = top(frame_stack)
  context = build_context(frame)
  instruction = LLM(context)    // 生成单条指令
  result = execute(instruction) // 执行并返回结果
  if (instruction stores result) {
    frame.locals[instruction.result] = result
  }
}
```

### 关键差异：每次一条指令

与传统 ReAct 对比：

| 特性     | ReAct            | Agent VM           |
| -------- | ---------------- | ------------------ |
| LLM 输出 | Thought + Action | 单条指令           |
| 观察时机 | 每个 Action 后   | 每条指令后         |
| 状态管理 | 隐式（对话历史） | 显式（Frame 变量） |
| 可恢复性 | 困难             | 天然支持           |
| 可中断性 | 有限             | 每条指令后可中断   |

### LLM 上下文构造

每次调用 LLM 时构造输入上下文：

```
Agent: <当前 Agent 名称>
Goal: <当前目标>

Variables:
  <当前 Frame 的变量列表>

Last Result:
  <上一条指令的执行结果（如果有）>

Available Tools:
  <工具列表及描述>

Available Agents:
  <可调用的 Agent 列表>

Allowed Instructions:
  <允许的指令及描述>
```

LLM 输出**单条指令**。

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

---

## 五、指令集

### 设计原则

1. **每条指令是原子操作** — 执行后立即返回结果
2. **参数内联** — 不需要压栈操作，参数直接写在指令中
3. **结果可命名** — 可选择存储到变量供后续使用

### 完整指令集

| 指令    | 参数                    | 语义                 |
| ------- | ----------------------- | -------------------- |
| `CALL`  | `tool`, `args`, `into?` | 调用工具             |
| `STORE` | `from`, `into`          | 复制/重命名变量      |
| `RET`   | `value?`                | 返回，结束当前 Frame |

### 指令格式

指令使用 JSON 对象格式：

```json
{
  "op": "CALL",
  "tool": "web_fetch",
  "args": ["https://example.com"],
  "into": "page"
}
```

### 指令详解

#### CALL

调用工具，参数直接内联。

```json
{ "op": "CALL", "tool": "web_fetch", "args": ["https://example.com"] }
{ "op": "CALL", "tool": "web_fetch", "args": ["https://example.com"], "into": "page" }
{ "op": "CALL", "tool": "send_email", "args": { "to": "user@example.com", "subject": "Hello", "body": "..." } }
```

- `tool`：工具名称
- `args`：参数，数组或对象（取决于工具签名）
- `into`：可选，将结果存储到变量

**调用 Agent 也是通过工具实现：**

```json
{
  "op": "CALL",
  "tool": "call_agent",
  "args": { "agent": "document_agent", "goal": "分析这份文档" },
  "into": "result"
}
```

`call_agent` 工具内部创建新 Frame 并入栈，主循环在新 Frame 中继续执行。

执行结果：

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
```

#### STORE

复制或重命名变量。

```json
{ "op": "STORE", "from": "result", "into": "final_answer" }
```

#### RET

结束当前 Agent 执行，返回父 Frame。

```json
{ "op": "RET" }
{ "op": "RET", "value": "分析完成，结果如下..." }
{ "op": "RET", "value": { "from": "analysis" } }  // 引用变量
```

- `value`：可选，返回值。可以是字面量或变量引用

执行后：

1. 弹出当前 Frame
2. 若有返回值，存储到父 Frame 的 `last_result` 变量
3. 继续执行父 Frame

---

## 六、VM 值类型

所有变量值为 JSON 可表示的类型：

- `string`、`number`、`boolean`、`null`
- `array`
- `object`

工具调用结果也遵循相同格式。

---

## 七、错误处理

### 错误作为值

工具调用失败不打断执行，错误作为返回值：

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
```

示例：

```json
{
  "op": "CALL",
  "tool": "web_fetch",
  "args": ["https://flaky-api.com"],
  "into": "result"
}


// result = { ok: true, data: "..." } 或 { ok: false, error: "timeout" }
```

LLM 在下一次调用时看到 `result` 的值，决定是否重试或换策略。

---

## 八、中断与恢复

### 取消任务

用户 `Ctrl-C` 或前端取消对话：

- 终止 VM 执行循环

### Rewind（回退到指定 Frame）

用户请求"回退到某个 Frame"，例如当前在 A→B→C 链上，用户要取消 C 回到 B：

1. 标记 C 为"已取消"
2. VM 在下次指令生成时告知 LLM：当前 Frame 已取消
3. LLM 生成 `RET` 指令，返回 `{ cancelled: true, reason: "..." }`
4. B 收到返回值，LLM 决定下一步

### 返回值结构

```typescript
type RetValue =
  | { ok: true; data: any } // 正常返回
  | { ok: false; error: string } // 执行失败
  | { cancelled: true; reason: string }; // 被取消/rewind
```

### Human-in-the-loop

`human_input` 工具与其他工具一致：

```json
{
  "op": "CALL",
  "tool": "human_input",
  "args": { "prompt": "请提供文档链接" },
  "into": "doc_url"
}
```

---

## 九、执行限制

### 栈深度限制

防止无限递归：

```
max_frame_depth = 100  // 可配置
```

超过限制时抛出错误。

### 指令数限制

防止无限循环：

```
max_instructions_per_frame = 1000  // 可配置
```

---

## 十、记忆系统

长期记忆以 facts 形式存在，作为变量注入：

- 在合适的时机注入到 `locals`
- VM 层面不感知记忆逻辑

本期不作为重点。

---

## 十一、示例

### 示例 1：获取并分析文档

**第一轮：获取网页**

```json
{
  "op": "CALL",
  "tool": "web_fetch",
  "args": ["https://example.com/doc"],
  "into": "page"
}
```

结果：`page = { ok: true, data: "文档内容..." }`

**第二轮：分析文档**

```json
{
  "op": "CALL",
  "tool": "doc_analysis",
  "args": { "from": "page.data" },
  "into": "analysis"
}
```

结果：`analysis = { ok: true, data: { summary: "...", keywords: [...] } }`

**第三轮：返回结果**

```json
{ "op": "RET", "value": { "from": "analysis" } }
```

### 示例 2：调用子 Agent

**第一轮：调用第一个 Agent**

```json
{
  "op": "CALL",
  "tool": "call_agent",
  "args": { "agent": "document_agent", "goal": "分析 https://example.com/1" },
  "into": "result1"
}
```

**第二轮：调用第二个 Agent**

```json
{
  "op": "CALL",
  "tool": "call_agent",
  "args": { "agent": "document_agent", "goal": "分析 https://example.com/2" },
  "into": "result2"
}
```

**第三轮：汇总返回**

```json
{
  "op": "RET",
  "value": { "results": [{ "from": "result1" }, { "from": "result2" }] }
}
```

### 示例 3：处理错误并重试

**第一轮：尝试请求**

```json
{
  "op": "CALL",
  "tool": "web_fetch",
  "args": ["https://flaky-api.com"],
  "into": "result"
}
```

结果：`result = { ok: false, error: "timeout" }`

**第二轮：LLM 看到错误，决定重试**

```json
{
  "op": "CALL",
  "tool": "web_fetch",
  "args": ["https://flaky-api.com"],
  "into": "result"
}
```

结果：`result = { ok: true, data: "..." }`

**第三轮：继续处理**

```json
{
  "op": "CALL",
  "tool": "parse_json",
  "args": { "from": "result.data" },
  "into": "data"
}
```

### 示例 4：询问用户

**第一轮：询问用户**

```json
{
  "op": "CALL",
  "tool": "human_input",
  "args": { "prompt": "请提供要分析的文档链接" },
  "into": "doc_url"
}
```

结果：`doc_url = { ok: true, data: "https://example.com/doc" }`

**第二轮：使用用户输入**

```json
{
  "op": "CALL",
  "tool": "web_fetch",
  "args": [{ "from": "doc_url.data" }],
  "into": "page"
}
```

---

## 十二、变量引用语法

在指令中使用变量值：

| 语法                | 语义                     |
| ------------------- | ------------------------ |
| `"literal"`         | 字面量字符串             |
| `{ "from": "x" }`   | 引用变量 `x` 的值        |
| `{ "from": "x.y" }` | 引用变量 `x` 的 `y` 属性 |

示例：

```json
{
  "op": "CALL",
  "tool": "send_email",
  "args": {
    "to": { "from": "user_email" },
    "subject": "分析结果",
    "body": { "from": "analysis.summary" }
  }
}
```

---

## 十三、设计原则总结

1. **单指令决策** — 每次 LLM 只生成一条指令，降低规划难度
2. **参数内联** — 不需要压栈操作，减少 LLM 认知负担
3. **确定性执行** — VM 行为可预测，便于调试和恢复
4. **错误作为值** — 不打断执行，LLM 决定处理方式
5. **作用域隔离** — 子 Frame 变量独立，避免污染

---
