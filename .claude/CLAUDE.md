# Project: langvis

## Toolchain

| Purpose         | Tool     | Notes                                 |
| --------------- | -------- | ------------------------------------- |
| Package Manager | `bun`    | Dependency management & script engine |
| Dev Framework   | `vite`   | Development server & build            |
| Build System    | `make`   | Use instead of npm scripts            |
| Test Framework  | `vitest` | Run specific tests: `bunx vitest run` |

## Shell

The user's shell aliases `rm`/`mv`/`cp`/`ln` with `-i` (interactive confirm) via `~/.alias`. In a non-interactive Claude shell these prompt for input and then hang or no-op (the file is **not** removed). Always pass `-f` for destructive ops (e.g. `rm -f <path>`) or bypass the alias with the absolute binary (e.g. `/usr/bin/rm`). Don't rely on the plain `rm`/`mv` form — it has bitten merges before.

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
- **Server CQRS layering**: A handler orchestrates one use case (load aggregate → call its method → persist → publish event); it must **never** hold business rules or state-dependent authorization. Invariants live on the aggregate (or repo-scope for ownership). Input-shape validation belongs at the DTO/schema boundary; domain/invariant validation belongs in the aggregate. Full guide + handler decision checklist: [docs/cqrs-layering.md](docs/cqrs-layering.md).

## Testing & Validation

- Run specific tests only when necessary, skip coverage.
- Run lint after code generation: `make lint`.
- After modifying entity definitions, verify with: `timeout 10 make dev`.
