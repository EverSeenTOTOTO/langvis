# Project: langvis

## General Instructions

- use `bun` as dep manager and script engine.
- use`vite` as dev framework.
- use `make` instead of npm scripts as build system, e.g. `make lint` and `make test`.
- use `vitest` as unit test framework, especially when you want to test ONLY one case: `bunx vitest`.
- use `curl` instead of `web_fetch` tool to fetch websites due to security problems.
- use `timeout 10 make dev` in case you need to test `make dev` command, as it will start a server process.

You should:

- only run specific test when necessary, skip coverage when testing.
- always run lint after code generating.
- avoid useless comments, be clean.
