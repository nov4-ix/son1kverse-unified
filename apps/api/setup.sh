#!/usr/bin/env bash
# ─── SON1KVERSE — Setup en Ubuntu ────────────────────────────────────────────
set -e

echo ""
echo "⬡  SON1KVERSE — Setup"
echo "─────────────────────────────────────────────────────"

# Node.js 20+ requerido
if ! command -v node &> /dev/null; then
  echo "⚠  Node.js no encontrado. Instalando via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
fi

echo "✓ Node $(node -v)"

# Dependencias
echo "→ Instalando dependencias..."
npm install

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠  Creado .env desde .env.example"
  echo "⚠  IMPORTANTE: Edita .env y configura:"
  echo "     JWT_SECRET=<genera con: openssl rand -base64 64>"
  echo "     OPENROUTER_API_KEY=<tu key de openrouter.ai>"
  echo ""
fi

# Prisma
echo "→ Generando cliente Prisma..."
npx prisma generate

echo "→ Creando base de datos SQLite..."
npx prisma db push

echo ""
echo "✓ Setup completo."
echo ""
echo "Para arrancar:"
echo "  npm run dev"
echo ""
echo "⬡  PIXEL listo para orquestar."
