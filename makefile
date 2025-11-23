SHELL := /bin/bash

DIST ?= dist

# Use my forked version
.PHONY: better-auth-typeorm
better-auth-typeorm:
	@if [ ! -d third-party/better-auth-typeorm-pg/package/dist ]; then \
		echo "Building better-auth-typeorm-pg..." && \
		cd third-party/better-auth-typeorm-pg && \
		bun install && \
		cd package && \
		bun run build && \
		bun i && \
		echo "better-auth-typeorm-pg built successfully."; \
	else \
		echo "better-auth-typeorm-pg already built. Skipping build step."; \
	fi

.PHONY: prepare
prepare: better-auth-typeorm
	npx husky
	# https://github.com/oven-sh/bun/issues/4677#issuecomment-1713522789
	# https://github.com/oven-sh/bun/pull/18086
	jq '.main = .module' node_modules/tsyringe/package.json > tmp.json && mv tmp.json node_modules/tsyringe/package.json

.PHONY: lint
lint:
	npx tsc --noEmit
	npx eslint --fix .
	npx stylelint "src/**/*.{css,scss}" --fix
	npx prettier --log-level silent -w .
	@echo -e '\033[1;32mNo lint errors found.'

.PHONY: clean
clean:
	-rm -r ${DIST}

.PHONY: dev
dev:
	NODE_ENV=development bun --watch src/server/index.ts

.PHONY: build
build: clean
	npx vite build --mode production --config config/vite.prod.ts
	npx vite build --mode production --config config/vite.server.ts
	npx vite build --mode production --config config/vite.serverEntry.ts

.PHONY: start
start: build
	NODE_ENV=production bun ${DIST}/server.js

.PHONY: test
test:
	npx vitest run --coverage
