SHELL := /bin/bash

DIST ?= dist

.PHONY: prepare
prepare:
	npx husky install

.PHONY: lint
lint:
	npx eslint --fix .
	npx stylelint "src/**/*.{css,scss}" --fix
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

.PHONY: build_client
build_client:
	npx vite build --mode production --config config/vite.prod.ts

.PHONY: build_server
build_server:
	npx vite build --mode production --config config/vite.server.ts
	npx vite build --mode production --config config/vite.serverEntry.ts

.PHONY: build
build: clean build_client build_server

.PHONY: start
start: build
	NODE_ENV=production node ${DIST}/server.js

.PHONY: test
test:
	npx jest --coverage
