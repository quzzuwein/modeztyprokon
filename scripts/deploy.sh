#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [ -z "${JWT_SECRET:-}" ]; then
  echo "JWT_SECRET is required" >&2
  exit 1
fi

echo "[1/6] Installing dependencies..."
npm install

echo "[2/6] Generating Prisma client..."
npx prisma generate

echo "[3/6] Running database migrations..."
if [ "${NODE_ENV:-development}" = "production" ]; then
  npx prisma migrate deploy
else
  npx prisma migrate deploy
fi

echo "[4/6] Running smoke tests..."
npm run smoke:test

echo "[5/6] Building application..."
npm run build

echo "[6/6] Starting application..."
nohup npm run start > /tmp/modeztyprokon.log 2>&1 &

echo "Deployment completed. Logs: /tmp/modeztyprokon.log"
