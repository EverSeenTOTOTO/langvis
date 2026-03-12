# Langvis

A personal AI Agent platform with streaming conversation and document intelligence.

## Highlights

### AsyncGenerator Control Flow

Agent execution uses native AsyncGenerator for fine-grained control:

```typescript
// Agent yields events, tools yield results
yield ctx.agentToolCallEvent(tool, input);
const result = yield * tool.call(input, ctx);
yield ctx.agentToolResultEvent(tool, result);
```

**Benefits:**

- Natural suspension points for each event
- Built-in progress reporting via `yield`
- Stack unwinding on abort/cancel
- No callback hell or promise chaining

### Lifecycle-Aware Abort Mechanism

Every execution context carries an `AbortController`:

```typescript
// Anywhere in the execution chain
ctx.abort('User cancelled');

// Generator breaks at next yield point
// Resources cleanup in finally block
```

**Propagation:**

- Frontend → HTTP `/cancel` → `session.cancel()` → `ctx.abort()`
- Client disconnect → SSE close event → `session.handleDisconnect()`
- Timeout/background → direct `ctx.abort()`

### Phase State Machine

Both frontend and backend use explicit phase machines:

```
Backend Session:  waiting → running → done
Frontend View:    idle → connecting → streaming → (final|error|cancelled)
```

Phase determines valid transitions and cancellation behavior:

- `waiting`: SSE connected, no agent running → cleanup only
- `running`: Agent active → abort + persist + cleanup
- `done`: Terminal state → idempotent

### Seamless Reconnection

Agent execution is decoupled from SSE connection:

```
User refreshes page
    │
    ├─ SSE disconnects
    │     └─ Agent continues, events persisted to DB
    │
    └─ Page loads
          ├─ GET /session/:id → { phase: 'running' }
          └─ Reconnect SSE, resume receiving events
```

Session state stored in Redis survives process restarts and supports cross-instance reconnection.

## Prerequisites

- Node.js 18+ or Bun
- PostgreSQL 14+ with pgvector
- Redis 6+
- OpenAI API key

## Getting Started

```bash
bun install
make prepare
cp .env.example .env.development
# Edit .env.development with your credentials
make dev
```

See `makefile` for all available commands.

## Documentation

- [Chat Architecture](docs/chat.md) — SSE streaming, agent execution, reconnection
- [Human in the Loop](docs/human_in_the_loop.md) — Human in the loop

## License

[MIT](LICENSE)
