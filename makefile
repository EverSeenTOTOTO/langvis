SHELL := /bin/bash

DIST ?= dist

.PHONY: prepare
prepare:
	npx husky install
	# https://github.com/oven-sh/bun/issues/4677#issuecomment-1713522789
	# https://github.com/oven-sh/bun/pull/18086
	jq '.main = .module' node_modules/tsyringe/package.json > tmp.json && mv tmp.json node_modules/tsyringe/package.json

.PHONY: lint
lint:
	npx tsc --noEmit
	npx eslint --fix .
	npx stylelint "src/**/*.{css,scss}" --fix
	npx prettier -w .
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
	npx vitest run -c config/vite.common.ts --coverage
