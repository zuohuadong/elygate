#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH='' cd -- "$script_dir/../.." && pwd)"
preflight="$script_dir/single-node-preflight.sh"
test_root="$repo_root/.codex-tmp/single-node-preflight-test-$$"
fake_bin="$test_root/bin"
compose_dir="$test_root/compose"
backup_dir="$compose_dir/backups"
env_file="$compose_dir/.env"
secret="test-secret-value-that-is-longer-than-thirty-two-characters"
other_secret="another-secret-value-that-is-longer-than-thirty-two-characters"

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

mkdir -p "$fake_bin" "$compose_dir" "$backup_dir"
chmod 700 "$backup_dir"
cat >"$compose_dir/docker-compose.yml" <<'EOF'
services:
  elygate:
    image: ${ELYGATE_IMAGE:?required}
  postgres:
    image: postgres:16-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
cp "$repo_root/examples/single-node-postgres/config.json" "$compose_dir/config.json"
cat >"$env_file" <<EOF
ELYGATE_IMAGE=registry.example/elygate@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ENCRYPTION_KEY=$secret
SETUP_TOKEN=$secret
POSTGRES_USER=elygate
POSTGRES_PASSWORD=$secret
POSTGRES_DB=elygate
EOF
chmod 600 "$env_file"
jq -n --arg secret "$secret" '{
	services: {
		elygate: {
			image: ("registry.test/elygate@sha256:" + ("b" * 64)),
			environment: {
				BIFROST_ENCRYPTION_KEY: $secret, BIFROST_SETUP_TOKEN: $secret,
				POSTGRES_USER: "elygate", POSTGRES_PASSWORD: $secret, POSTGRES_DB: "elygate"
			}
		},
		postgres: {
			image: ("postgres:16-alpine@sha256:" + ("a" * 64)),
			environment: {
				POSTGRES_USER: "elygate", POSTGRES_PASSWORD: $secret, POSTGRES_DB: "elygate"
			}
		}
	}
}' >"$test_root/compose-original.json"
cp "$test_root/compose-original.json" "$test_root/compose.json"
cp "$compose_dir/config.json" "$test_root/config-original.json"
cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "compose" ]]; then exit 1; fi
if [[ "${2:-}" == "version" ]]; then exit 0; fi
if [[ "$*" == *" config --quiet" ]]; then
	if [[ "${FAKE_COMPOSE_FAIL:-0}" != "0" ]]; then
		printf '%s\n' "$FAKE_ERROR_SECRET" >&2
	fi
	exit "${FAKE_COMPOSE_FAIL:-0}"
fi
if [[ "$*" == *" config --format json" ]]; then
	cat "$FAKE_COMPOSE_JSON"
	exit "${FAKE_COMPOSE_FAIL:-0}"
fi
exit 1
EOF
chmod 700 "$fake_bin/docker"
export PATH="$fake_bin:$PATH"
export FAKE_COMPOSE_JSON="$test_root/compose.json"
export ENV_FILE="$env_file"
export BACKUP_DIR="$backup_dir"
export FAKE_ERROR_SECRET="$secret"

expect_success() {
	PATH="$fake_bin:$PATH" FAKE_COMPOSE_FAIL=0 bash "$preflight" "$compose_dir" >/dev/null ||
		fail "$1"
	pass "$1"
}

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
	[[ "$output" != *"$other_secret"* ]] || fail "$name leaked a mismatched secret"
	pass "$name"
}

expect_success "valid configuration"
rm "$compose_dir/config.json"
expect_failure "missing config" "config.json" bash "$preflight" "$compose_dir"
printf '{invalid\n' >"$compose_dir/config.json"
expect_failure "invalid config JSON" "config.json" bash "$preflight" "$compose_dir"
printf '[]\n' >"$compose_dir/config.json"
expect_failure "non-object config JSON" "config.json" bash "$preflight" "$compose_dir"
printf '{}\n' >"$compose_dir/config.json"
expect_failure "empty config object" "config_store" bash "$preflight" "$compose_dir"
printf '{}\n{}\n' >"$compose_dir/config.json"
expect_failure "multiple config objects" "config.json" bash "$preflight" "$compose_dir"
cp "$test_root/config-original.json" "$compose_dir/config.json"
chmod 644 "$env_file"
expect_failure "private env mode" ".env" bash "$preflight" "$compose_dir"
chmod 600 "$env_file"
chmod 755 "$backup_dir"
expect_failure "private backup mode" "backup_dir" bash "$preflight" "$compose_dir"
chmod 700 "$backup_dir"
for service in elygate postgres; do
	jq --arg service "$service" '.services[$service].image = "floating:latest"' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "$service floating image" "$service.image" bash "$preflight" "$compose_dir"
done
for store in config_store logs_store; do
	jq --arg store "$store" '.[ $store ].enabled = false' \
		"$test_root/config-original.json" >"$compose_dir/config.json"
	expect_failure "$store disabled" "$store" bash "$preflight" "$compose_dir"
	jq --arg store "$store" '.[ $store ].type = "sqlite"' \
		"$test_root/config-original.json" >"$compose_dir/config.json"
	expect_failure "$store wrong type" "$store" bash "$preflight" "$compose_dir"
	for field in user password db_name; do
		jq --arg store "$store" --arg field "$field" '.[$store].config[$field] = "wrong-reference"' \
			"$test_root/config-original.json" >"$compose_dir/config.json"
		expect_failure "$store $field broken environment reference" "$store" bash "$preflight" "$compose_dir"
	done
done
jq '.client.disable_db_pings_in_health = true' "$test_root/config-original.json" >"$compose_dir/config.json"
expect_failure "database health pings disabled" "health pings" bash "$preflight" "$compose_dir"
cp "$test_root/config-original.json" "$compose_dir/config.json"
for field in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
	jq --arg field "$field" 'del(.services.postgres.environment[$field])' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "postgres $field missing" "postgres.$field" bash "$preflight" "$compose_dir"
	jq --arg field "$field" '.services.postgres.environment[$field] = 1' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "postgres $field invalid type" "postgres.$field" bash "$preflight" "$compose_dir"
	jq --arg field "$field" --arg other "$other_secret" \
		'.services.postgres.environment[$field] = (if $field == "POSTGRES_PASSWORD" then $other else "different" end)' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "postgres $field mismatch" "postgres.$field" bash "$preflight" "$compose_dir"
done
jq '.services.postgres.environment.POSTGRES_PASSWORD = "replace-me-placeholder-value-with-more-than-32-characters"' \
	"$test_root/compose-original.json" >"$test_root/compose.json"
expect_failure "postgres password placeholder" "postgres.POSTGRES_PASSWORD" bash "$preflight" "$compose_dir"
cp "$test_root/compose-original.json" "$test_root/compose.json"
for field in BIFROST_ENCRYPTION_KEY BIFROST_SETUP_TOKEN POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB; do
	jq --arg field "$field" 'del(.services.elygate.environment[$field])' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "$field missing" "$field" bash "$preflight" "$compose_dir"
	jq --arg field "$field" '.services.elygate.environment[$field] = "replace-me-placeholder-value-with-more-than-32-characters"' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "$field placeholder" "$field" bash "$preflight" "$compose_dir"
done
for field in BIFROST_ENCRYPTION_KEY BIFROST_SETUP_TOKEN POSTGRES_PASSWORD; do
	jq --arg field "$field" '.services.elygate.environment[$field] = "short"' \
		"$test_root/compose-original.json" >"$test_root/compose.json"
	expect_failure "$field short" "$field" bash "$preflight" "$compose_dir"
done
cp "$test_root/compose-original.json" "$test_root/compose.json"
expect_failure "compose failure" "docker compose config" env FAKE_COMPOSE_FAIL=1 bash "$preflight" "$compose_dir"
jq '.client.disable_db_pings_in_health = false' "$test_root/config-original.json" >"$compose_dir/config.json"
expect_success "explicit database health pings enabled"
pass "all single-node preflight cases"
