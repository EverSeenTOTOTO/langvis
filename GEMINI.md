# Project: langvis

## General Instructions

- use `bun` as dep manager and script engine.
- use`vite` as dev framework.
- use `make` instead of npm scripts as build system, e.g. `make lint` or `make test`.
- use `vitest` as unit test framework, especially when you want to test ONLY one case: `bunx vitest run`.
- use `curl` instead of `web_fetch` tool to fetch websites due to security problems.
- use `timeout 10 make dev` in case you need to test `make dev` command, as it will start a server process.

## Best Practices

- only run specific test when necessary, skip coverage when testing.
- always run lint after code generating.
- avoid useless comments, be clean.
- **Always use template strings (backticks) for multi-line strings or string interpolation** instead of string concatenation with `+` operator.
- API calls must be declared in store first, then consumed in components.
- DO NOT use raw `fetch` or `useState` for loading states (e.g. `const [loading, setLoading] = useState(false)`) in components. Prefer `useAsyncFn` from `react-use`.
- run `timeout 10 make dev` to check if TypeORM still works once you modified entity definition.
- **Always use `generateId(prefix)` from `@/shared/utils` for ID generation** instead of `uuid()`, `crypto.randomUUID()`, or similar. Use meaningful prefixes like `conv_`, `msg_`, `convgrp_`, `req_`, `tc_` (tool call), etc.
