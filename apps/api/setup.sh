#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo "SON1KVERSE - Setup"
echo "----------------------------------------"

if ! command -v node > /dev/null; then
  echo "Node.js 20+ es requerido."
  exit 1
fi

echo "Node $(node -v)"

if ! command -v pnpm > /dev/null; then
  echo "pnpm 9 es requerido. Instala con: corepack enable && corepack prepare pnpm@9.15.9 --activate"
  exit 1
fi

echo "Instalando dependencias..."
pnpm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Creado .env desde .env.example"
fi

if [ ! -f apps/api/.env ]; then
  cp apps/api/.env.example apps/api/.env
  echo "Creado apps/api/.env desde apps/api/.env.example"
fi

echo "Generando cliente Prisma..."
pnpm db:generate

echo ""
echo "Setup completo."
echo "Edita .env y apps/api/.env con JWT_SECRET y OPENROUTER_API_KEY."
echo "Para arrancar: pnpm dev"
