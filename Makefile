# OCPP charge-point simulator — convenience targets.
# Wraps the npm scripts in packages/* so day-to-day commands are short.

SHELL          := /bin/bash
OCPP_URL       ?= ws://localhost:19000
HOST           ?= 127.0.0.1
PORT           ?= 3001
IMAGE          ?= ocpp-sim
CONTAINER      ?= ocpp-sim
DATA_VOLUME    ?= ocpp-sim-data
AUTH_TOKEN     ?=

.DEFAULT_GOAL := help

.PHONY: help install update build clean \
        ocpp web dev \
        test conformance lint format typecheck qa \
        docker-build docker-run docker-stop

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Install / update --------------------------------------------------------

install: ## Install all workspace dependencies
	npm install

update: ## Update dependencies and refresh the lockfile
	npm update
	npm install

# --- Dev: the two long-running processes -------------------------------------

ocpp: ## Run the OCPP back-end (dev:server) against $$OCPP_URL
	OCPP_URL=$(OCPP_URL) HOST=$(HOST) PORT=$(PORT) npm run dev:server

web: ## Run the simulator web UI (Vite on :5173)
	npm run dev:web

dev: ## Run back-end + web UI together (Ctrl-C stops both)
	@trap 'kill 0' INT TERM; \
	OCPP_URL=$(OCPP_URL) HOST=$(HOST) PORT=$(PORT) npm run dev:server & \
	npm run dev:web & \
	wait

# --- Build -------------------------------------------------------------------

build: ## Build every workspace
	npm run build

# --- Quality control ---------------------------------------------------------

test: ## Run the full test suite
	npm test

conformance: ## Run the OCPP 1.6 conformance suite
	npm run conformance

lint: ## Lint with biome
	npm run lint

format: ## Auto-format with biome
	npm run format

typecheck: ## Typecheck every workspace
	npm --workspaces run typecheck --if-present

qa: lint typecheck test ## Lint + typecheck + test (run before pushing)

# --- Docker ------------------------------------------------------------------

docker-build: ## Build the production Docker image
	docker build -t $(IMAGE) .

docker-run: ## Run the production image; pass AUTH_TOKEN=... to override
	docker run --rm -d \
		-p $(PORT):3001 \
		-v $(DATA_VOLUME):/data \
		-e OCPP_URL=$(OCPP_URL) \
		$(if $(AUTH_TOKEN),-e AUTH_TOKEN=$(AUTH_TOKEN),) \
		--name $(CONTAINER) $(IMAGE)

docker-stop: ## Stop and remove the running container
	-docker stop $(CONTAINER)

# --- Housekeeping ------------------------------------------------------------

clean: ## Remove build outputs, node_modules, and the local SQLite database
	rm -rf node_modules packages/*/node_modules packages/*/dist data/sim.sqlite*
