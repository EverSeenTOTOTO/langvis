SHELL := /bin/bash

DIST ?= dist

# Use my forked version
.PHONY: better-auth-typeorm
better-auth-typeorm:
	@if [ ! -d third-party/better-auth-typeorm-pg/package/dist ]; then \
		echo "Building better-auth-typeorm-pg..." && \
		cd third-party/better-auth-typeorm-pg && \
		pnpm install && \
		cd package && \
		pnpm run build && \
		pnpm install && \
		echo "better-auth-typeorm-pg built successfully."; \
	else \
		echo "better-auth-typeorm-pg already built. Skipping build step."; \
	fi

.PHONY: prepare
prepare: better-auth-typeorm
	pnpm exec husky

.PHONY: lint
lint:
	pnpm exec tsc --noEmit
	pnpm exec eslint --fix .
	pnpm exec prettier --log-level silent -w .
	@echo -e '\033[1;32mNo lint errors found.'

.PHONY: clean
clean:
	-rm -r ${DIST}

# dev 链禁用 pnpm exec：pnpm 收到 SIGINT 会向 tsx 再转发一发，
# tsx watch 在 kill 飞行中收到第二发会直接 SIGKILL 子进程，graceful shutdown 即死。
.PHONY: dev
dev:
	NODE_ENV=development ./node_modules/.bin/tsx watch src/server/index.ts

.PHONY: build
build: clean
	pnpm exec vite build --mode production --config config/vite.prod.ts
	pnpm exec vite build --mode production --config config/vite.server.ts
	pnpm exec vite build --mode production --config config/vite.serverEntry.ts
	cp -r src/server/locales ${DIST}/server/locales
	mkdir -p ${DIST}/server/modules/agent/implementations/
	cp -r src/server/modules/agent/implementations/skills ${DIST}/server/modules/agent/implementations/skills

.PHONY: start
start: build
	NODE_ENV=production node ${DIST}/server.js

.PHONY: test
test:
	pnpm exec vitest run

# 覆盖率按需跑——默认 `make test` 不带 --coverage（见 CLAUDE.md）。
.PHONY: test-cover
test-cover:
	pnpm exec vitest run --coverage

.PHONY: typecheck
typecheck:
	pnpm exec tsc --noEmit

# 受控迁移——synchronize 已关闭，schema 变更走 migration 流程。
# generate 产出的文件须手动在 src/server/libs/infrastructure/migrations/index.ts 注册。
.PHONY: migration-generate
migration-generate:
	NODE_ENV=development pnpm exec tsx ./node_modules/typeorm/cli.js migration:generate \
		src/server/libs/infrastructure/migrations/$(name) \
		-d src/server/libs/infrastructure/datasource.ts

.PHONY: migration-run
migration-run:
	NODE_ENV=development pnpm exec tsx ./node_modules/typeorm/cli.js migration:run \
		-d src/server/libs/infrastructure/datasource.ts

.PHONY: migration-revert
migration-revert:
	NODE_ENV=development pnpm exec tsx ./node_modules/typeorm/cli.js migration:revert \
		-d src/server/libs/infrastructure/datasource.ts

# e2e：boot 真 server + DB（SSE/SSR/auth 全链路），仅本机开发环境跑。
.PHONY: test-e2e
test-e2e:
	pnpm exec vitest run --config vitest.e2e.config.ts
