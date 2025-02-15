SHELL := /bin/bash

DIST ?= dist

.PHONY: prepare
prepare:
	npx husky install
	# https://github.com/oven-sh/bun/issues/4677#issuecomment-1713522789
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

.PHONY: dev\:client
dev\:client: clean
	npx vite --mode development --config config/vite.dev.ts

.PHONY: dev\:server
dev\:server:
	NODE_ENV=development bun --watch src/server/index.ts

.PHONY: build\:client
build\:client:
	npx vite build --mode production --config config/vite.prod.ts

.PHONY: build\:server
build\:server:
	npx vite build --mode production --config config/vite.server.ts
	npx vite build --mode production --config config/vite.serverEntry.ts

.PHONY: build
build: clean build\:client build\:server

.PHONY: start
start: build
	NODE_ENV=production bun ${DIST}/server.js

.PHONY: test
test:
	npx vitest run -c config/vite.common.ts --coverage
