SHELL := /bin/bash
.DEFAULT_GOAL := help

API_PORT ?= 3001
MUSIC_LAB_PORT ?= 8002
WEB_PORT ?= 5173

.PHONY: help setup env up dev api-dev web-dev lab-setup lab-dev lab-test lab-openapi lab-docker-gpu typecheck build test db-validate db-generate db-migrate db-status web-build

help:
	@echo "SON1KVERSE — comandos disponibles"
	@echo "  make setup       Instala Node + Python, crea apps/api/.env con JWT_SECRET"
	@echo "  make up          setup + db-migrate + dev (PostgreSQL ya disponible)"
	@echo "  make dev         Levanta Music Lab (:$(MUSIC_LAB_PORT)), API (:$(API_PORT)) y Web (:$(WEB_PORT))"
	@echo "  make test        Ejecuta tests de API y Music Lab"
	@echo "  make typecheck   tsc --noEmit en todo el workspace"
	@echo "  make build       Build de producción de paquetes y apps"
	@echo "  make db-migrate  Aplica migraciones Prisma (requiere PostgreSQL)"
	@echo "  make db-status   Muestra el estado de migraciones Prisma"

setup:
	pnpm install
	@if [ ! -f apps/api/.env ]; then \
		cp .env.example apps/api/.env; \
		secret=$$(openssl rand -base64 64 | tr -d '\n'); \
		sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$$secret|" apps/api/.env; \
		echo "apps/api/.env creado con JWT_SECRET aleatorio"; \
	else \
		echo "apps/api/.env ya existe; no se toca"; \
	fi
	$(MAKE) lab-setup

env:
	@test -f apps/api/.env || $(MAKE) setup

up: setup db-migrate dev

dev:
	@test -x services/music-lab/.venv/bin/uvicorn || { echo "Falta el entorno Python. Ejecuta: make setup"; exit 1; }
	@set -e; \
	(cd services/music-lab && MUSIC_LAB_MODE=simulation .venv/bin/uvicorn app.main:app --reload --port $(MUSIC_LAB_PORT)) & \
	lab_pid=$$!; \
	trap 'kill $$lab_pid 2>/dev/null || true' EXIT INT TERM; \
	pnpm -r --parallel dev

api-dev:
	pnpm --filter @son1k/api dev

web-dev:
	pnpm --filter @son1k/web dev --port $(WEB_PORT)

lab-setup:
	cd services/music-lab && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

lab-dev:
	cd services/music-lab && MUSIC_LAB_MODE=simulation .venv/bin/uvicorn app.main:app --reload --port $(MUSIC_LAB_PORT)

lab-test:
	cd services/music-lab && .venv/bin/pytest -q

lab-openapi:
	cd services/music-lab && .venv/bin/python scripts/export_openapi.py

lab-docker-gpu:
	cd services/music-lab && docker build -f Dockerfile.gpu -t son1kverse/music-lab:gpu .

typecheck:
	pnpm typecheck

build:
	pnpm build

test:
	pnpm --filter @son1k/api test
	$(MAKE) lab-test

db-validate:
	pnpm --filter @son1k/db prisma:validate

db-generate:
	pnpm --filter @son1k/db prisma:generate

db-migrate:
	@set -a; [ -f apps/api/.env ] && . apps/api/.env; set +a; \
	pnpm --filter @son1k/db exec prisma migrate deploy

db-status:
	@set -a; [ -f apps/api/.env ] && . apps/api/.env; set +a; \
	pnpm --filter @son1k/db exec prisma migrate status

web-build:
	pnpm --filter @son1k/web build
