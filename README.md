# Langvis

A personal AI agent platform — streaming conversation, tool use, document intelligence, and voice, built around a resilient, event-sourced agent runtime.

## Highlights

### Agent & conversation

- **Tool-using agent** out of the box: web fetch, document archive & semantic search, Docker-sandboxed shell, file editing, sub-agent orchestration, and more.
- **Skills system**: drop a markdown file under `skills/` to teach the agent a new workflow — ships with translate, mock interview, document archive, and others.
- **Long-context memory**: a fold-based compaction model keeps conversations coherent well past the model's context window.
- **Human in the loop**: structured forms (`ask_user`) let the agent pause and collect input mid-run.
- **Voice**: text-to-speech and speech-to-text are first-class, so skills can speak their replies.

### Document intelligence

- Archive web pages and emails into a vector store (pgvector) with automatic metadata extraction, chunking, and embeddings — then retrieve them semantically.

### Under the hood

- **Event-sourced agent runs**: execution and read-side projection are cleanly separated, so the live stream, persistence, and resume all read from the same event log.
- **CQRS layering**: handlers orchestrate one use case each; invariants live on aggregates, validation at the DTO boundary.
- **Provider-agnostic LLM/cache ports**: swap models or cache backends without touching the agent core.
- **Lifecycle-aware cancellation**: a single abort signal propagates from the UI, a client disconnect, or a timeout down to every tool, with stack unwinding at each yield point.

## Tech Stack

- **Frontend**: React 18, Ant Design V6, Lexical editor, MobX, Vite
- **Backend**: Express, TypeORM, PostgreSQL + pgvector, Redis
- **LLM**: OpenAI-compatible API
- **Tooling**: Bun, Make, Vitest

## Getting Started

Prerequisites: Node.js 18+ or Bun, PostgreSQL 14+ with pgvector, Redis 6+, an OpenAI API key.

```bash
bun install
make prepare
cp .env.example .env.development   # then fill in your credentials
make dev
```

See the `makefile` for all commands (`lint`, `test`, `build`, `start`).

## License

[MIT](LICENSE)
