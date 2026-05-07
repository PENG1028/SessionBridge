#!/usr/bin/env bash
# SessionBridge — Portable Launcher (Linux / macOS)
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     SessionBridge                     ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# Build if needed
if [ ! -f dist/index.js ]; then
  echo "  First time setup — building..."
  npx next build || { echo "  Frontend build failed"; exit 1; }
  npx tsc -p tsconfig.server.json || { echo "  Server build failed"; exit 1; }
  echo "  Build complete."
  echo ""
fi

exec node scripts/serve.js "$@"
