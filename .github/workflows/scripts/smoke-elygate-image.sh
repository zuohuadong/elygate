#!/usr/bin/env bash
set -euo pipefail
umask 077

image=${1:?usage: smoke-elygate-image.sh IMAGE COMMIT_SHA}
commit=${2:?usage: smoke-elygate-image.sh IMAGE COMMIT_SHA}
if [[ ! "$commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo "expected a full Git commit SHA" >&2
  exit 2
fi
for command in docker jq curl openssl; do
  command -v "$command" >/dev/null
done
docker info >/dev/null

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
workspace=$(mktemp -d "${TMPDIR:-/tmp}/elygate-image.XXXXXX")
prefix="elygate-image-$(openssl rand -hex 8)"
gateway="$prefix-gateway"
postgres="$prefix-postgres"
network="$prefix-network"
gateway_volume="$prefix-runtime"
postgres_volume="$prefix-database"

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    for container in "$gateway" "$postgres"; do
      docker inspect "$container" --format \
        '{{.Name}}: status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} restarts={{.RestartCount}} ports={{json .NetworkSettings.Ports}} health={{json .State.Health}}' >&2 || true
    done
    docker logs --tail 100 "$gateway" 2>&1 |
      jq -Rr --arg pg "${POSTGRES_PASSWORD:-}" --arg encryption "${ENCRYPTION_KEY:-}" \
        --arg setup "${SETUP_TOKEN:-}" --arg admin "${ELYGATE_IMAGE_PASSWORD:-}" '
        def hide($secret):
          if $secret == "" then . else split($secret) | join("[REDACTED_SECRET]") end;
        hide($pg) | hide($encryption) | hide($setup) | hide($admin)
      ' >&2 || true
  fi
  for container in "$gateway" "$postgres"; do
    if docker container inspect "$container" >/dev/null 2>&1; then
      docker rm --force --volumes "$container" >/dev/null || status=1
    elif [ "$status" -eq 0 ]; then
      status=1
    fi
  done
  for volume in "$gateway_volume" "$postgres_volume"; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      docker volume rm "$volume" >/dev/null || status=1
    elif [ "$status" -eq 0 ]; then
      status=1
    fi
  done
  if docker network inspect "$network" >/dev/null 2>&1; then
    docker network rm "$network" >/dev/null || status=1
  elif [ "$status" -eq 0 ]; then
    status=1
  fi
  rm -r "$workspace" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export ELYGATE_IMAGE="$image" POSTGRES_USER=elygate_image POSTGRES_DB=elygate_config
export POSTGRES_PASSWORD ENCRYPTION_KEY SETUP_TOKEN ELYGATE_IMAGE_PASSWORD BIFROST_ENCRYPTION_KEY
POSTGRES_PASSWORD=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
SETUP_TOKEN=$(openssl rand -hex 32)
ELYGATE_IMAGE_PASSWORD="Aa1!$(openssl rand -hex 32)"
BIFROST_ENCRYPTION_KEY="$ENCRYPTION_KEY"
pg_image=$(docker compose -f "$root/examples/single-node-postgres/docker-compose.yml" config --format json |
  jq -er '.services.postgres.image | select(test("@sha256:[a-f0-9]{64}$"))')
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = "1000:0"

# Keep the network isolated to this smoke run while allowing Docker to publish
# the gateway's ephemeral loopback port for host-side HTTP assertions.
docker network create "$network" >/dev/null
docker volume create "$gateway_volume" >/dev/null
docker volume create "$postgres_volume" >/dev/null
docker run --detach --name "$postgres" --network "$network" --network-alias postgres \
  --env POSTGRES_USER --env POSTGRES_PASSWORD --env POSTGRES_DB \
  --volume "$postgres_volume:/var/lib/postgresql/data" "$pg_image" >/dev/null

wait_for_postgres() {
  for ((attempt = 0; attempt < 60; attempt++)); do
    if docker exec "$postgres" pg_isready -q -t 1 -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"; then
      return
    fi
    sleep 2
  done
  echo "private PostgreSQL did not become ready" >&2
  return 1
}
wait_for_postgres
docker exec "$postgres" createdb -U "$POSTGRES_USER" elygate_logs

mkdir "$workspace/catalog"
printf '{}\n' > "$workspace/catalog/pricing.json"
printf '{}\n' > "$workspace/catalog/parameters.json"
printf '{"servers":[]}\n' > "$workspace/catalog/library.json"
jq '
  .providers = {} |
  .client.allowed_origins = [] |
  .client.disable_db_pings_in_health = false |
  .logs_store.config.db_name = "elygate_logs" |
  .governance.auth_config = {
    is_enabled: true, admin_username: "image_acceptance",
    admin_password: "env.ELYGATE_IMAGE_PASSWORD"
  } |
  .framework.pricing = {
    pricing_url: "file:///app/catalog/pricing.json",
    model_parameters_url: "file:///app/catalog/parameters.json",
    mcp_library_url: "file:///app/catalog/library.json"
  }
' "$root/examples/single-node-postgres/config.json" > "$workspace/config.json"
chmod 755 "$workspace/catalog"
chmod 644 "$workspace/config.json" "$workspace/catalog/"*.json
docker run --detach --name "$gateway" --network "$network" --publish 127.0.0.1::8080 \
  --env BIFROST_ENCRYPTION_KEY --env POSTGRES_USER --env POSTGRES_PASSWORD --env POSTGRES_DB \
  --env ELYGATE_IMAGE_PASSWORD --env APP_HOST=0.0.0.0 --env APP_PORT=8080 \
  --volume "$gateway_volume:/app/data" --volume "$workspace/config.json:/app/data/config.json:ro" \
  --volume "$workspace/catalog:/app/catalog:ro" \
  --health-interval 2s --health-timeout 5s --health-start-period 5s --health-retries 60 \
  "$image" >/dev/null
resolve_gateway_origin() {
  local port
  if ! port=$(docker inspect "$gateway" --format '{{json .NetworkSettings.Ports}}' |
    jq -er '[."8080/tcp"[]? | select(.HostIp == "127.0.0.1")] |
      select(length == 1) | .[0].HostPort |
      select(test("^[0-9]+$")) | select(tonumber > 0 and tonumber <= 65535)'); then
    echo "gateway has no unique published loopback HTTP port" >&2
    return 1
  fi
  origin="http://127.0.0.1:$port"
}

wait_for_gateway() {
  # Docker can allocate a different ephemeral host port after stop/start.
  resolve_gateway_origin
  for ((attempt = 0; attempt < 60; attempt++)); do
    test "$(docker inspect "$gateway" --format '{{.State.Running}}')" = true
    if [ "$(docker inspect "$gateway" --format '{{.State.Health.Status}}')" = healthy ] &&
      curl --fail --silent --max-time 5 "$origin/health" > "$workspace/health.json" &&
      jq -e '.status == "ok" and .components.db_pings == "ok"' "$workspace/health.json" >/dev/null; then
      return
    fi
    sleep 2
  done
  echo "gateway did not reach healthy database-backed readiness" >&2
  return 1
}

request() {
  local expected=$1 route=$2 status
  shift 2
  status=$(curl --silent --show-error --max-time 10 -o "$workspace/response.json" \
    --write-out '%{http_code}' "$@" "$origin$route")
  if [ "$status" != "$expected" ]; then
    echo "unexpected HTTP status for $route: $status, expected $expected" >&2
    return 1
  fi
}

verify_stores() {
  test "$(docker exec "$gateway" id -u)" = 1000
  docker exec "$gateway" sh -c 'test ! -e /app/data/config.db && test ! -e /app/data/logs.db'
  test "$(docker exec "$postgres" psql -U "$POSTGRES_USER" -d postgres -Atqc \
    "SELECT count(DISTINCT datname) FROM pg_stat_activity WHERE datname IN ('elygate_config', 'elygate_logs')")" = 2
  test "$(docker inspect "$gateway" --format '{{.State.OOMKilled}}')" = false
  test "$(docker inspect "$gateway" --format '{{.RestartCount}}')" = 0
}

wait_for_gateway
verify_stores
request 401 /api/config
jq -n --arg password "$ELYGATE_IMAGE_PASSWORD" \
  '{username: "image_acceptance", password: $password}' > "$workspace/login.json"
request 200 /api/session/login -X POST -H "Origin: $origin" -H 'Content-Type: application/json' \
  --data-binary "@$workspace/login.json" --cookie-jar "$workspace/cookies"
request 200 /api/config --cookie "$workspace/cookies"
request 200 /api/version --cookie "$workspace/cookies"
jq -e --arg version "v$commit" '. == $version' "$workspace/response.json" >/dev/null

docker stop --time 40 "$gateway" >/dev/null
test "$(docker inspect "$gateway" --format '{{.State.ExitCode}}')" = 0
docker stop --time 40 "$postgres" >/dev/null
test "$(docker inspect "$postgres" --format '{{.State.ExitCode}}')" = 0
docker start "$postgres" >/dev/null
wait_for_postgres
docker start "$gateway" >/dev/null
wait_for_gateway
verify_stores
request 200 /api/config --cookie "$workspace/cookies"
request 200 /api/session/logout -X POST -H "Origin: $origin" --cookie "$workspace/cookies"
request 401 /api/config --cookie "$workspace/cookies"
docker stop --time 40 "$gateway" >/dev/null
test "$(docker inspect "$gateway" --format '{{.State.ExitCode}}')" = 0
echo "PASS image assertions: non-root, dual PostgreSQL, health, version, login/logout and normal restart; cleanup still required"
