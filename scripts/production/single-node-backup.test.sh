#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH='' cd -- "$script_dir/../.." && pwd)"
backup_script="$script_dir/single-node-backup.sh"
restore_script="$script_dir/single-node-restore.sh"
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

assert_no_matches() {
	local diagnostic="$1" status=0
	shift
	grep "$@" >/dev/null 2>&1 || status=$?
	case "$status" in
		1) return ;;
		0) fail "$diagnostic" ;;
		*) fail "$diagnostic (scan failed)" ;;
	esac
}

mkdir -p "$fake_bin" "$compose_dir" "$backup_root" "$test_root/runtime" "$test_root/newline-runtime" \
	"$test_root/hidden-runtime" "$test_root/empty-runtime"
touch "$test_root/newline-runtime/"$'\n'
touch "$test_root/hidden-runtime/.state"
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
if [[ "${FAKE_RESTORE:-}" == 1 ]]; then
	gateway_id='restored-gateway-id'
	postgres_id='restored-postgres-id'
fi
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
if [[ "${FAKE_RESTORE:-}" == 1 ]]; then
	case "${1:-}" in
		volume)
			if [[ "$scenario" == aliased-volume ]]; then
				printf '[{"Name":"recovery-runtime","Mountpoint":"/source","Driver":"local","Scope":"local","Options":null},{"Name":"recovery-postgres","Mountpoint":"/source","Driver":"local","Scope":"local","Options":null}]\n'
			else
				printf '[{"Name":"recovery-runtime","Mountpoint":"/runtime","Driver":"local","Scope":"local","Options":null},{"Name":"recovery-postgres","Mountpoint":"/postgres","Driver":"local","Scope":"local","Options":null}]\n'
			fi
			exit ;;
		run)
			while [[ "$#" -gt 0 && "$1" != -ec ]]; do shift; done
			[[ "$#" -gt 1 ]] || exit 1
			shift
			program="$1"
			shift
			sh -ec "$program" "$@"
			exit ;;
		create)
			[[ "$scenario" != create-failure ]] || exit 1
			printf '%064d\n' 3
			exit ;;
		cp)
			if [[ "${2:-}" == - || ("${2:-}" == -a && "${3:-}" == -) ]]; then
				cat >"$FAKE_TEST_ROOT/restored-runtime.tar"
				[[ "$scenario" != restore-cp-failure ]]
				exit
			fi ;;
		rm)
			[[ "${2:-}" == "$(printf '%064d' 3)" ]] || exit 1
			[[ "$scenario" != cleanup-failure ]]
			exit ;;
		exec)
			if [[ "$*" == *psql* ]]; then
				if [[ "$scenario" == database-not-empty ]]; then printf 'f\n'; else printf 't\n'; fi
				exit
			fi
			if [[ "$*" == *"pg_restore --no-password"* ]]; then
				cat >"$FAKE_TEST_ROOT/restored-database.dump"
				[[ "$scenario" != restore-db-failure ]] || exit 1
				if [[ "$scenario" == target-change ]]; then touch "$FAKE_TEST_ROOT/source-changed"; fi
				if [[ "$scenario" == target-mount-change ]]; then touch "$FAKE_TEST_ROOT/source-changed"; fi
				if [[ "$scenario" == mount-order-only ]]; then touch "$FAKE_TEST_ROOT/mounts-permuted"; fi
				exit
			fi ;;
	esac
fi
if [[ "${1:-}" == "inspect" ]]; then
	if [[ "$scenario" == "inspect-failure" ]]; then
		printf '%s\n' "$secret" >&2
		exit 1
	fi
	container_json | jq --argjson restore "${FAKE_RESTORE:-0}" --slurpfile compose "$compose_json" \
		'if $restore == 1 then
			.[0].Mounts[0].Name = $compose[0].volumes["elygate-runtime"].name |
			.[0].Mounts[0].RW = true |
			.[1].Mounts[0].Name = $compose[0].volumes["postgres-data"].name |
			.[1].Mounts[0].RW = true
		else . end' |
		jq --arg permuted "$(test -f "$FAKE_TEST_ROOT/mounts-permuted" && printf yes)" \
			'if $permuted == "yes" then .[0].Mounts |= reverse else . end' |
		jq --arg scenario "$scenario" \
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
		elif ($scenario == "source-change" or $scenario == "target-change") and $changed == "yes" then .[0].State.StartedAt = "2026-10-31T01:00:00Z"
		elif ($scenario == "source-mount-change" or $scenario == "target-mount-change") and $changed == "yes" then .[0].Mounts[0].Name = "changed-runtime"
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
	if [[ "$scenario" == "source-mount-change" ]]; then touch "$FAKE_TEST_ROOT/source-changed"; fi
	if [[ "$scenario" == "mount-order-only" ]]; then touch "$FAKE_TEST_ROOT/mounts-permuted"; fi
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
cat >"$fake_bin/find" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == /restore ]]; then
	shift
	case "${FAKE_SCENARIO:-valid}" in
		runtime-nonempty) exec "$FAKE_REAL_FIND" "$FAKE_TEST_ROOT/runtime" "$@" ;;
		runtime-newline-only) exec "$FAKE_REAL_FIND" "$FAKE_TEST_ROOT/newline-runtime" "$@" ;;
		runtime-hidden) exec "$FAKE_REAL_FIND" "$FAKE_TEST_ROOT/hidden-runtime" "$@" ;;
		runtime-enumeration-failure) exit 1 ;;
		*) exec "$FAKE_REAL_FIND" "$FAKE_TEST_ROOT/empty-runtime" "$@" ;;
	esac
fi
exec "$FAKE_REAL_FIND" "$@"
EOF
chmod 700 "$fake_bin/find"
export FAKE_REAL_FIND
FAKE_REAL_FIND="$(command -v find)"
cat >"$fake_bin/ls" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${2:-}" == /restore ]]; then
	printf 'ls: unrecognized option: q\n' >&2
	exit 1
fi
exec "$FAKE_REAL_LS" "$@"
EOF
chmod 700 "$fake_bin/ls"
for executable in chmod chown; do
	cat >"$fake_bin/$executable" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
executable="${0##*/}"
if [[ "${2:-}" == /restore && "$#" == 2 ]]; then
	printf '%s %s /restore\n' "$executable" "$1" >>"$FAKE_TEST_ROOT/root-metadata.calls"
	[[ "${FAKE_SCENARIO:-}" != root-metadata-failure ]]
	exit
fi
if [[ "$executable" == chmod ]]; then exec "$FAKE_REAL_CHMOD" "$@"; fi
exit 1
EOF
	chmod 700 "$fake_bin/$executable"
done
export FAKE_REAL_CHMOD
FAKE_REAL_CHMOD="$(command -v chmod)"
export FAKE_REAL_LS
FAKE_REAL_LS="$(command -v ls)"
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

expect_failure "scan detects forbidden content" "forbidden content" \
	assert_no_matches "forbidden content" -F -- "$secret" "$env_file"
expect_failure "scan error fails closed" "scan failed" \
	assert_no_matches "test artifact scan" -F -- "$secret" "$test_root/missing-artifact"
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
for scenario in dump-failure dump-empty list-failure list-empty cp-failure cp-corrupt source-change source-mount-change config-change; do
	case "$scenario" in
		dump-*) diagnostic="pg_dump" ;;
		list-*) diagnostic="archive" ;;
		cp-*) diagnostic="runtime" ;;
		source-change|source-mount-change) diagnostic="source containers changed" ;;
		config-change) diagnostic="deployment files changed" ;;
	esac
	expect_failure "$scenario" "$diagnostic" env FAKE_SCENARIO="$scenario" \
		bash "$backup_script" "$compose_dir" --confirm-no-writers
	rm -f "$test_root/source-changed"
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

mkdir -m 700 "$test_root/ordering-backups"
env FAKE_SCENARIO=mount-order-only BACKUP_ROOT="$test_root/ordering-backups" \
	bash "$backup_script" "$compose_dir" --confirm-no-writers >/dev/null ||
	fail "equivalent backup mount ordering"
rm -f "$test_root/mounts-permuted"
pass "equivalent backup mount ordering"

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
jq -e '.source_project == "single-node-postgres" and
	.source_volumes.elygate_runtime == "single-node-postgres_elygate-runtime" and
	.source_volumes.postgres_data == "single-node-postgres_postgres-data" and
	.source_containers == {"elygate":"gateway-id","postgres":"postgres-id"}' \
	"$backup_dir/manifest.json" >/dev/null || fail "backup source identity"
assert_no_matches "metadata contains rendered credentials" -F -- \
	"$secret" "$backup_dir/"*.json "$backup_dir/docker-compose.yml"
assert_no_matches "backup mutated the source services" -E -- \
	'(^| )(stop|start|rm|down|up|restart|pg_restore --clean)( |$)' "$test_root/docker.calls"
pass "valid backup"

target_dir="$test_root/recovery"
mkdir -p "$target_dir/backups"
chmod 700 "$target_dir/backups"
cp "$compose_dir/config.json" "$target_dir/config.json"
cp "$compose_dir/docker-compose.yml" "$target_dir/docker-compose.yml"
cp "$env_file" "$target_dir/.env"
chmod 600 "$target_dir/.env"
jq '.name = "recovery" |
	.volumes["elygate-runtime"].name = "recovery-runtime" |
	.volumes["postgres-data"].name = "recovery-postgres"' \
	"$test_root/compose.json" >"$test_root/recovery.json"
cp "$test_root/recovery.json" "$test_root/valid-recovery.json"
export FAKE_RESTORE=1
export FAKE_COMPOSE_JSON="$test_root/recovery.json"
export FAKE_CONFIG_FILE="$target_dir/config.json"
export ENV_FILE="$target_dir/.env"
restore() {
	bash "$restore_script" "$backup_dir" "$target_dir" --confirm-isolated-no-writers
}
assert_no_restore_writes() {
	[[ ! -e "$test_root/restored-database.dump" && ! -e "$test_root/restored-runtime.tar" ]] ||
		fail "rejected restore wrote target data"
}
expect_failure "restore confirmation" "usage" bash "$restore_script" "$backup_dir" "$target_dir"
for scenario in running bad-exit oom unhealthy wrong-image wrong-db-env wrong-encryption-env \
	wrong-mount extra-mount stale-app-dir missing-app-dir duplicate-app-dir stale-command stale-entrypoint \
	stale-runtime-volume stale-postgres-volume; do
	expect_failure "restore $scenario" "target containers must match" env FAKE_SCENARIO="$scenario" \
		bash "$restore_script" "$backup_dir" "$target_dir" --confirm-isolated-no-writers
	assert_no_restore_writes
done
for filter in '.name = "single-node-postgres"' \
	'.volumes["elygate-runtime"].name = "single-node-postgres_elygate-runtime"' \
	'.volumes["postgres-data"].name = "single-node-postgres_postgres-data"' \
	'.volumes["elygate-runtime"].name = "single-node-postgres_postgres-data"' \
	'.volumes["postgres-data"].name = .volumes["elygate-runtime"].name'; do
	jq "$filter" "$test_root/valid-recovery.json" >"$test_root/recovery.json"
	expect_failure "source or shared target volume" "not isolated" restore
	assert_no_restore_writes
done
cp "$test_root/valid-recovery.json" "$test_root/recovery.json"
for scenario in aliased-volume runtime-nonempty runtime-newline-only runtime-hidden runtime-enumeration-failure database-not-empty list-failure; do
	case "$scenario" in
		aliased-*) diagnostic="local volumes without driver options" ;;
		runtime-*) diagnostic="runtime volume is not empty" ;;
		database-*) diagnostic="database must be empty" ;;
		list-*) diagnostic="archive could not be listed" ;;
	esac
	expect_failure "restore $scenario" "$diagnostic" env FAKE_SCENARIO="$scenario" \
		bash "$restore_script" "$backup_dir" "$target_dir" --confirm-isolated-no-writers
	assert_no_restore_writes
done
for scenario in restore-db-failure create-failure restore-cp-failure root-metadata-failure target-change target-mount-change cleanup-failure; do
	case "$scenario" in
		restore-db-*) diagnostic="database import failed" ;;
		create-*) diagnostic="container creation failed" ;;
		restore-cp-*) diagnostic="runtime import failed" ;;
		root-metadata-*) diagnostic="runtime root metadata restoration failed" ;;
		target-*) diagnostic="changed during restore" ;;
		cleanup-*) diagnostic="cleanup failed" ;;
	esac
	expect_failure "restore $scenario" "$diagnostic" env FAKE_SCENARIO="$scenario" \
		bash "$restore_script" "$backup_dir" "$target_dir" --confirm-isolated-no-writers
	rm -f "$test_root/restored-database.dump" "$test_root/restored-runtime.tar" "$test_root/source-changed"
done

# Complete checksums are required even when every individual line is otherwise valid.
cp "$backup_dir/SHA256SUMS" "$test_root/complete-checksums"
sed '/database.dump$/d' "$test_root/complete-checksums" >"$backup_dir/SHA256SUMS"
expect_failure "incomplete checksums" "backup permissions, checksums" restore
assert_no_restore_writes
cp "$test_root/complete-checksums" "$backup_dir/SHA256SUMS"
printf '%064d  ../outside\n' 0 >>"$backup_dir/SHA256SUMS"
expect_failure "checksum path escape" "backup permissions, checksums" restore
assert_no_restore_writes
cp "$test_root/complete-checksums" "$backup_dir/SHA256SUMS"
cp "$backup_dir/runtime.tar" "$test_root/original-runtime.tar"
refresh_checksums() {
	(
		cd "$backup_dir"
		sha256sum database.dump database.list runtime.tar config.json docker-compose.yml \
			image-refs.json image-metadata.json manifest.json
	) >"$backup_dir/SHA256SUMS"
}
for archive_case in parent absolute duplicate symlink-escape symlink-graph link-child special setuid root-uid root-gid missing-root; do
	python3 - "$backup_dir/runtime.tar" "$archive_case" <<'PY'
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], "w") as archive:
    case = sys.argv[2]
    if case in ("root-uid", "root-gid"):
        root = tarfile.TarInfo(".")
        root.type = tarfile.DIRTYPE
        root.uid = -1 if case == "root-uid" else 0
        root.gid = 4294967295 if case == "root-gid" else 0
        archive.addfile(root)
        raise SystemExit
    if case != "missing-root":
        root = tarfile.TarInfo(".")
        root.type = tarfile.DIRTYPE
        archive.addfile(root)
    if case == "symlink-graph":
        first = tarfile.TarInfo("a")
        first.type = tarfile.SYMTYPE
        first.linkname = "."
        archive.addfile(first)
        second = tarfile.TarInfo("escape")
        second.type = tarfile.SYMTYPE
        second.linkname = "a/../outside"
        archive.addfile(second)
        raise SystemExit
    entry = tarfile.TarInfo({"parent": "../outside", "absolute": "/outside"}.get(case, "state"))
    if case in ("symlink-escape", "link-child"):
        entry.type = tarfile.SYMTYPE
        entry.linkname = "../outside" if case == "symlink-escape" else "inside"
    elif case == "special":
        entry.type = tarfile.FIFOTYPE
    elif case == "setuid":
        entry.mode = 0o4755
    archive.addfile(entry, io.BytesIO(b""))
    if case == "duplicate":
        archive.addfile(entry, io.BytesIO(b""))
    if case == "link-child":
        archive.addfile(tarfile.TarInfo("state/child"), io.BytesIO(b""))
PY
	refresh_checksums
	expect_failure "unsafe runtime $archive_case" "backup permissions, checksums" restore
	assert_no_restore_writes
done
python3 - "$backup_dir/runtime.tar" <<'PY'
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], "w") as archive:
    root = tarfile.TarInfo(".")
    root.type = tarfile.DIRTYPE
    root.uid, root.gid, root.mode = 1234, 42, 0o750
    archive.addfile(root)
    regular = tarfile.TarInfo("inside")
    regular.size = 5
    archive.addfile(regular, io.BytesIO(b"state"))
    symlink = tarfile.TarInfo("alias")
    symlink.type = tarfile.SYMTYPE
    symlink.linkname = "inside"
    archive.addfile(symlink)
    hardlink = tarfile.TarInfo("copy")
    hardlink.type = tarfile.LNKTYPE
    hardlink.linkname = "inside"
    archive.addfile(hardlink)
PY
refresh_checksums
: >"$test_root/root-metadata.calls"
restore >/dev/null || fail "valid internal links restore"
cmp -s "$test_root/restored-runtime.tar" "$backup_dir/runtime.tar" ||
	fail "internal links archive differs"
grep -Fxq -- 'chmod 750 /restore' "$test_root/root-metadata.calls" ||
	fail "runtime root mode was not restored"
grep -Fxq -- 'chown 1234:42 /restore' "$test_root/root-metadata.calls" ||
	fail "runtime root ownership was not restored"
assert_no_matches "runtime root metadata changed child entries" -F -- '-R' "$test_root/root-metadata.calls"
grep -Fq -- '--cap-drop ALL --cap-add CHOWN --cap-add FOWNER --user 0' "$test_root/docker.calls" ||
	fail "runtime root helper lacks restricted capabilities"
rm -f "$test_root/restored-database.dump" "$test_root/restored-runtime.tar"
pass "valid internal links restore"
cp "$test_root/original-runtime.tar" "$backup_dir/runtime.tar"
python3 - "$backup_dir/runtime.tar" <<'PY'
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], "a") as archive:
    marker = tarfile.TarInfo("recovery-marker")
    marker.uid, marker.gid, marker.mode = 1000, 0, 0o600
    marker.size = len(b"runtime-marker")
    archive.addfile(marker, io.BytesIO(b"runtime-marker"))
PY
refresh_checksums
chmod 644 "$backup_dir/database.dump"
expect_failure "public backup artifact" "backup permissions, checksums" restore
assert_no_restore_writes
chmod 600 "$backup_dir/database.dump"
restore >/dev/null || fail "valid isolated restore"
cmp -s "$test_root/restored-database.dump" "$backup_dir/database.dump" || fail "database input differs"
cmp -s "$test_root/restored-runtime.tar" "$backup_dir/runtime.tar" || fail "runtime input differs"
grep -Fq -- 'cp - ' "$test_root/docker.calls" || fail "runtime archive was not imported without ownership remapping"
assert_no_matches "runtime archive import remapped ownership" -F -- 'cp -a - ' "$test_root/docker.calls"
python3 - "$test_root/restored-runtime.tar" <<'PY'
import sys
import tarfile

with tarfile.open(sys.argv[1]) as archive:
    marker = archive.getmember("recovery-marker")
    assert (marker.uid, marker.gid, marker.mode) == (1000, 0, 0o600)
    assert archive.extractfile(marker).read() == b"runtime-marker"
PY
assert_no_matches "restore started services or removed source data" -E -- \
	'(^| )(stop|start|down|up|restart|--clean)( |$)' "$test_root/docker.calls"
(cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null) || fail "restore changed source backup"
pass "valid isolated restore"

env FAKE_SCENARIO=mount-order-only bash "$restore_script" "$backup_dir" "$target_dir" \
	--confirm-isolated-no-writers >/dev/null || fail "equivalent restore mount ordering"
cmp -s "$test_root/restored-database.dump" "$backup_dir/database.dump" || fail "reordered database input differs"
cmp -s "$test_root/restored-runtime.tar" "$backup_dir/runtime.tar" || fail "reordered runtime input differs"
rm -f "$test_root/mounts-permuted" "$test_root/restored-database.dump" "$test_root/restored-runtime.tar"
pass "equivalent restore mount ordering"

printf 'changed\n' >>"$backup_dir/database.dump"
if (cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null 2>&1); then
	fail "corrupted backup passed checksum validation"
fi
expect_failure "corrupted restore archive" "backup permissions, checksums" restore
pass "all single-node backup cases"
