#!/usr/bin/env bash
set -euo pipefail

# smoke-published-image.sh <image> [port]
# Pull the exact published image and verify health, JSON API and admin auth.

IMAGE="$1"
PORT="${2:-18083}"
NAME="smoke-$(printf '%s' "$IMAGE" | tr -c 'a-zA-Z0-9' '-' | tail -c 40)-${RANDOM}"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker pull "$IMAGE"
docker run -d --name "$NAME" -p "${PORT}:8080" "$IMAGE"

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health"; then
    break
  fi
  sleep 2
done
curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health"

BODY=$(mktemp)
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' -H 'Authorization: Bearer smoke-invalid' \
  "http://127.0.0.1:${PORT}/v1/models" || true)
if [ -z "$CODE" ] || [ "$CODE" = "000" ] || ! grep -qE '^[[:space:]]*[\[{]' "$BODY"; then
  echo "❌ $IMAGE /v1/models returned HTTP ${CODE:-none} without JSON" >&2
  cat "$BODY" >&2 || true
  docker logs "$NAME" 2>&1 | tail -50 >&2 || true
  exit 1
fi
LOGIN=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"username":"smoke","password":"wrong"}' \
  "http://127.0.0.1:${PORT}/api/session/login" || true)
case "$LOGIN" in
  400|401|403) ;;
  *) echo "❌ $IMAGE invalid admin login returned HTTP ${LOGIN:-none}" >&2; exit 1;;
esac
rm -f "$BODY"
echo "✅ $IMAGE smoke passed (models=$CODE login=$LOGIN)"
