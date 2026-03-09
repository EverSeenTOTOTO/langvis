# Project: langvis

## Toolchain

| Purpose         | Tool     | Notes                                 |
| --------------- | -------- | ------------------------------------- |
| Package Manager | `bun`    | Dependency management & script engine |
| Dev Framework   | `vite`   | Development server & build            |
| Build System    | `make`   | Use instead of npm scripts            |
| Test Framework  | `vitest` | Run specific tests: `bunx vitest run` |
| HTTP Client     | `curl`   | Use instead of `web_fetch` tool       |

## Code Style

- **Template Strings**: Always use backticks for multi-line strings or interpolation, never `+` concatenation.
- **Comments**: Avoid useless comments, keep code clean and self-documenting.
- **CSS Layout**: Use flexbox or grid. Never use `float` for layout.
- **CSS Specificity**: Avoid `!important` unless overriding uncontrollable third-party styles.

## Architecture

- **API Layer**: Declare API calls in store modules first, then consume in components.
- **Async State**: Use `useAsyncFn` from `react-use`. Never use raw `fetch` or manual `useState` for loading states.
- **ID Generation**: Always use `generateId(prefix)` from `@/shared/utils`. Common prefixes:
  - `conv_` - conversation
  - `msg_` - message
  - `convgrp_` - conversation group
  - `req_` - request
  - `tc_` - tool call
- **Prefer application-layer timestamps over database-generated ones** (e.g., avoid `@CreateDateColumn`). Use `new Date()` in service layer to ensure consistent timezone handling across all timestamp fields.

## Testing & Validation

- Run specific tests only when necessary, skip coverage.
- Run lint after code generation: `make lint`.
- After modifying entity definitions, verify with: `timeout 10 make dev`.
