.PHONY: setup dev typecheck build db-validate db-generate lab-setup lab-dev lab-test lab-openapi lab-docker-gpu

setup:
pnpm install
$(MAKE) lab-setup

dev:
pnpm -r --parallel dev

typecheck:
pnpm -r exec tsc --noEmit

build:
pnpm -r build

db-validate:
pnpm --filter @son1k/db exec prisma validate

db-generate:
pnpm --filter @son1k/db exec prisma generate

lab-setup:
cd services/music-lab && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

lab-dev:
cd services/music-lab && MUSIC_LAB_MODE=simulation .venv/bin/uvicorn app.main:app --reload --port 8001

lab-test:
cd services/music-lab && .venv/bin/pytest -q

lab-openapi:
cd services/music-lab && .venv/bin/python scripts/export_openapi.py

lab-docker-gpu:
cd services/music-lab && docker build -f Dockerfile.gpu -t son1kverse/music-lab:gpu .
