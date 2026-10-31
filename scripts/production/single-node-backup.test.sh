#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH='' cd -- "$script_dir/../.." && pwd)"
backup_script="$script_dir/single-node-backup.sh"
test_root="$repo_root/.codex-tmp/single-node-backup-test-$$"
fake_bin="$test_root/bin"
compose_dir="$test_root/compose"
backup_root="$compose_dir/backups"
env_file="$compose_dir/.env"
secret="test-secret-value-that-is-longer-than-thirty-two-characters"
gateway_image="registry.example/elygate@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
postgres_image="postgres:16-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

cleanup() {
	rm -rf "$test_root"
}
trap cleanup EXIT

fail() {
	printf 'FAIL test: %s\n' "$1" >&2
	exit 1
}

pass() {
	printf 'PASS test: %s\n' "$1"
}

mkdir -p "$fake_bin" "$compose_dir" "$backup_root" "$test_root/runtime"
chmod 700 "$backup_root"
cat >"$compose_dir/docker-compose.yml" <<'EOF'
services:
  elygate:
    image: ${ELYGATE_IMAGE:?required}
  postgres:
    image: postgres:16-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
cp "$repo_root/examples/single-node-postgres/config.json" "$compose_dir/config.json"
cat >"$env_file" <<EOF
ELYGATE_IMAGE=$gateway_image
ENCRYPTION_KEY=$secret
SETUP_TOKEN=$secret
POSTGRES_USER=elygate
POSTGRES_PASSWORD=$secret
POSTGRES_DB=elygate
EOF
chmod 600 "$env_file"
printf 'runtime-state\n' >"$test_root/runtime/state.json"
cat >"$test_root/compose.json" <<EOF
{
  "name": "single-node-postgres",
  "volumes": {
    "elygate-runtime": {"name": "single-node-postgres_elygate-runtime"},
    "postgres-data": {"name": "single-node-postgres_postgres-data"}
  },
  "services": {
    "elygate": {
      "image": "$gateway_image",
      "restart": "unless-stopped",
      "depends_on": {"postgres": {"condition": "service_healthy"}},
      "healthcheck": {"test": ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health"]},
      "environment": {
        "APP_HOST": "0.0.0.0", "APP_PORT": "8080", "LOG_LEVEL": "info",
        "LOG_STYLE": "json", "BIFROST_ENCRYPTION_KEY": "$secret",
        "BIFROST_SETUP_TOKEN": "$secret", "POSTGRES_USER": "elygate",
        "POSTGRES_PASSWORD": "$secret", "POSTGRES_DB": "elygate"
      }
    },
    "postgres": {
      "image": "$postgres_image",
      "restart": "unless-stopped",
      "healthcheck": {"test": ["CMD-SHELL", "pg_isready"]},
      "environment": {
        "POSTGRES_USER": "elygate", "POSTGRES_PASSWORD": "$secret",
        "POSTGRES_DB": "elygate"
      }
    }
  }
}
EOF
cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
gateway_image='registry.example/elygate@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
postgres_image='postgres:16-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
gateway_id='gateway-id'
postgres_id='postgres-id'
secret='test-secret-value-that-is-longer-than-thirty-two-characters'
config_file="$FAKE_CONFIG_FILE"
scenario="${FAKE_SCENARIO:-valid}"
gateway_state="exited"
compose_json="$FAKE_COMPOSE_JSON"
printf '%q ' "$@" >>"$FAKE_TEST_ROOT/docker.calls"
printf '\n' >>"$FAKE_TEST_ROOT/docker.calls"

container_json() {
	local gateway_status="$gateway_state"
	local gateway_running=false
	[[ "$gateway_status" == "running" ]] && gateway_running=true
	cat <<JSON
[
  {
    "Id": "$gateway_id", "Image": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "Mounts": [
      {"Destination": "/app/data", "Type": "volume", "Source": "elygate-runtime",
        "Name": "single-node-postgres_elygate-runtime", "RW": true},
      {"Destination": "/app/data/config.json", "Type": "bind", "Source": "$config_file", "RW": false}
    ],
    "Config": {
      "Image": "$gateway_image",
      "Cmd": ["/app/main"], "Entrypoint": ["/app/docker-entrypoint.sh"],
      "Env": ["APP_DIR=/app/data", "APP_HOST=0.0.0.0", "APP_PORT=8080", "LOG_LEVEL=info", "LOG_STYLE=json",
        "BIFROST_ENCRYPTION_KEY=$secret", "BIFROST_SETUP_TOKEN=$secret",
        "POSTGRES_USER=elygate", "POSTGRES_PASSWORD=$secret", "POSTGRES_DB=elygate"]
    },
    "State": {"Status": "$gateway_status", "Running": $gateway_running, "Restarting": false,
      "OOMKilled": false, "ExitCode": 0, "StartedAt": "2026-10-31T00:00:00Z", "FinishedAt": "2026-10-31T00:01:00Z"}
  },
  {
    "Id": "$postgres_id", "Image": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "Mounts": [{"Destination": "/var/lib/postgresql/data", "Type": "volume", "Source": "postgres-data",
      "Name": "single-node-postgres_postgres-data", "RW": true}],
    "Config": {
      "Image": "$postgres_image",
      "Env": ["POSTGRES_USER=elygate", "POSTGRES_PASSWORD=$secret", "POSTGRES_DB=elygate"]
    },
    "State": {"Status": "running", "Running": true, "Restarting": false,
      "OOMKilled": false, "ExitCode": 0, "StartedAt": "2026-10-31T00:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z",
      "Health": {"Status": "healthy"}}
  }
]
JSON
}

if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
	printf '%s\n' '{"Id":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","Os":"linux","Architecture":"amd64","Config":{"User":"1000:0"}}'
	printf '%s\n' '{"Id":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","Os":"linux","Architecture":"amd64","Config":{"User":"999:999"}}'
	exit 0
fi
if [[ "${1:-}" == "inspect" ]]; then
	if [[ "$scenario" == "inspect-failure" ]]; then
		printf '%s\n' "$secret" >&2
		exit 1
	fi
	container_json | jq --arg scenario "$scenario" \
		--arg changed "$(test -f "$FAKE_TEST_ROOT/source-changed" && printf yes)" '
		if $scenario == "running" then .[0].State.Status = "running" | .[0].State.Running = true
		elif $scenario == "bad-exit" then .[0].State.ExitCode = 137
		elif $scenario == "oom" then .[0].State.OOMKilled = true
		elif $scenario == "unhealthy" then .[1].State.Health.Status = "unhealthy"
		elif $scenario == "wrong-image" then .[0].Config.Image = "old:latest"
		elif $scenario == "wrong-db-env" then .[1].Config.Env = ["POSTGRES_DB=different"]
		elif $scenario == "wrong-encryption-env" then .[0].Config.Env = ["BIFROST_ENCRYPTION_KEY=different"]
		elif $scenario == "wrong-mount" then .[0].Mounts[1].Source = "/other/config.json"
		elif $scenario == "extra-mount" then .[0].Mounts += [{"Destination":"/other/data"}]
		elif $scenario == "stale-runtime-volume" then .[0].Mounts[0].Name = "other-runtime"
		elif $scenario == "stale-postgres-volume" then .[1].Mounts[0].Name = "other-database"
		elif $scenario == "stale-app-dir" then .[0].Config.Env |= map(if startswith("APP_DIR=") then "APP_DIR=/tmp/other-runtime" else . end)
		elif $scenario == "missing-app-dir" then .[0].Config.Env |= map(select(startswith("APP_DIR=") | not))
		elif $scenario == "duplicate-app-dir" then .[0].Config.Env += ["APP_DIR=/tmp/other-runtime"]
		elif $scenario == "stale-command" then .[0].Config.Cmd = ["/app/main", "-app-dir", "/other"]
		elif $scenario == "stale-entrypoint" then .[0].Config.Entrypoint = ["/other-entrypoint.sh"]
		elif $scenario == "source-change" and $changed == "yes" then .[0].State.StartedAt = "2026-10-31T01:00:00Z"
		else . end'
	exit 0
fi
if [[ "${1:-}" == "exec" && "$*" == *"pg_dump"* ]]; then
	if [[ "$scenario" == "dump-failure" ]]; then printf '%s\n' "$secret" >&2; exit 1; fi
	if [[ "$scenario" == "dump-empty" ]]; then exit 0; fi
	printf 'PGDMP test archive\n'
	exit 0
fi
if [[ "${1:-}" == "exec" && "$*" == *"pg_restore --list"* ]]; then
	cat >/dev/null
	if [[ "$scenario" == "list-failure" ]]; then printf '%s\n' "$secret" >&2; exit 1; fi
	if [[ "$scenario" == "list-empty" ]]; then exit 0; fi
	printf '1; TABLE public.example\n'
	exit 0
fi
if [[ "${1:-}" == "cp" && "$*" == *":/app/data/."* ]]; then
	if [[ "$scenario" == "cp-failure" ]]; then printf '%s\n' "$secret" >&2; exit 1; fi
	if [[ "$scenario" == "cp-corrupt" ]]; then printf 'not a tar archive\n'; exit 0; fi
	if [[ "$scenario" == "source-change" ]]; then touch "$FAKE_TEST_ROOT/source-changed"; fi
	if [[ "$scenario" == "config-change" ]]; then printf '{}\n' >"$config_file"; fi
	tar -cf - -C "$FAKE_RUNTIME" .
	exit 0
fi
[[ "${1:-}" == "compose" ]] || exit 1
if [[ "${2:-}" == "version" ]]; then exit 0; fi
if [[ "$*" == *"config --quiet" ]]; then exit 0; fi
if [[ "$*" == *"config --format json" ]]; then cat "$compose_json"; exit 0; fi
if [[ "$*" == *"ps --all --quiet elygate" ]]; then
	if [[ "$scenario" == "missing-gateway" ]]; then exit 0; fi
	if [[ "$scenario" == "multiple-gateways" ]]; then printf 'one\ntwo\n'; exit 0; fi
	printf '%s\n' "$gateway_id"
	exit 0
fi
if [[ "$*" == *"ps --all --quiet postgres" ]]; then printf '%s\n' "$postgres_id"; exit 0; fi
exit 1
EOF
chmod 700 "$fake_bin/docker"
export PATH="$fake_bin:$PATH"
export FAKE_COMPOSE_JSON="$test_root/compose.json"
export FAKE_CONFIG_FILE="$compose_dir/config.json"
export FAKE_RUNTIME="$test_root/runtime"
export FAKE_TEST_ROOT="$test_root"
export ENV_FILE="$env_file"
export BACKUP_ROOT="$backup_root"

expect_failure() {
	local name="$1"
	local expected="$2"
	shift 2
	local output
	if output="$(PATH="$fake_bin:$PATH" "$@" 2>&1)"; then
		fail "$name unexpectedly passed"
	fi
	[[ "$output" == *"$expected"* ]] || fail "$name missing diagnostic"
	[[ "$output" != *"$secret"* ]] || fail "$name leaked a secret"
	pass "$name"
}

expect_failure "missing confirmation" "usage" bash "$backup_script" "$compose_dir"
# Cases: missing/multiple/stale containers, abnormal shutdown, storage/copy errors and source changes.
for scenario in running bad-exit oom unhealthy wrong-image wrong-db-env wrong-encryption-env wrong-mount extra-mount \
	stale-app-dir missing-app-dir duplicate-app-dir stale-command stale-entrypoint \
	stale-runtime-volume stale-postgres-volume; do
	expect_failure "$scenario" "containers must match" env FAKE_SCENARIO="$scenario" \
		bash "$backup_script" "$compose_dir" --confirm-no-writers
done
for scenario in missing-gateway multiple-gateways; do
	expect_failure "$scenario" "exactly one" env FAKE_SCENARIO="$scenario" \
		bash "$backup_script" "$compose_dir" --confirm-no-writers
done
expect_failure "inspect failure" "container state" env FAKE_SCENARIO=inspect-failure \
	bash "$backup_script" "$compose_dir" --confirm-no-writers
for scenario in dump-failure dump-empty list-failure list-empty cp-failure cp-corrupt source-change config-change; do
	case "$scenario" in
		dump-*) diagnostic="pg_dump" ;;
		list-*) diagnostic="archive" ;;
		cp-*) diagnostic="runtime" ;;
		source-change) diagnostic="source containers changed" ;;
		config-change) diagnostic="deployment files changed" ;;
	esac
	expect_failure "$scenario" "$diagnostic" env FAKE_SCENARIO="$scenario" \
		bash "$backup_script" "$compose_dir" --confirm-no-writers
	[[ -z "$(find "$backup_root" -mindepth 1 -maxdepth 1 -print)" ]] ||
		fail "$scenario left an incomplete or final backup"
done
cp "$repo_root/examples/single-node-postgres/config.json" "$compose_dir/config.json"
jq '.config_store.config.host = "external" | .logs_store.config.host = "external"' \
	"$compose_dir/config.json" >"$test_root/external-config.json"
cp "$test_root/external-config.json" "$compose_dir/config.json"
expect_failure "same database name on external instance" "only the template" \
	bash "$backup_script" "$compose_dir" --confirm-no-writers
cp "$repo_root/examples/single-node-postgres/config.json" "$compose_dir/config.json"

bash "$backup_script" "$compose_dir" --confirm-no-writers >/dev/null || fail "valid backup"
backup_dir="$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -print)"
[[ -n "$backup_dir" ]] || fail "backup directory missing"
[[ -f "$backup_dir/database.dump" && -f "$backup_dir/database.list" &&
	-f "$backup_dir/runtime.tar" && -f "$backup_dir/manifest.json" ]] ||
	fail "backup artifacts missing"
[[ ! -e "$backup_dir/.env" ]] || fail "secret env was archived"
(cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null) || fail "backup checksums"
tar -tf "$backup_dir/runtime.tar" | grep -qx './state.json' || fail "runtime archive contents"
file_mode() {
	if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi
}
[[ "$(file_mode "$backup_dir")" == "700" ]] || fail "backup mode"
for artifact in "$backup_dir"/*; do
	[[ "$(file_mode "$artifact")" == "600" ]] || fail "artifact is not private"
done
jq -e '.recovery_verified == false and .topology == "single-database"' \
	"$backup_dir/manifest.json" >/dev/null || fail "recovery boundary"
if rg -q "$secret" "$backup_dir/"*.json "$backup_dir/docker-compose.yml"; then
	fail "metadata contains rendered credentials"
fi
if rg -q '(^| )(stop|start|rm|down|up|restart|pg_restore --clean)( |$)' "$test_root/docker.calls"; then
	fail "backup mutated the source services"
fi
printf 'changed\n' >>"$backup_dir/database.dump"
if (cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null 2>&1); then
	fail "corrupted backup passed checksum validation"
fi
pass "valid backup"
pass "all single-node backup cases"
