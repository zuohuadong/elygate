#!/usr/bin/env bash
set -euo pipefail
set +x

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH='' cd -- "$script_dir/../.." && pwd)"
compose_dir="${1:-$repo_root/examples/single-node-postgres}"
compose_file="$compose_dir/docker-compose.yml"
config_file="$compose_dir/config.json"
env_file="${ENV_FILE:-$compose_dir/.env}"
backup_dir="${BACKUP_DIR:-$compose_dir/backups}"

fail() {
	printf 'FAIL %s: %s\n' "$1" "$2" >&2
	exit 1
}

pass() {
	printf 'PASS %s\n' "$1"
}

file_mode() {
	if stat -f '%Lp' "$1" >/dev/null 2>&1; then
		stat -f '%Lp' "$1"
	else
		stat -c '%a' "$1"
	fi
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "$1" "required command is unavailable"
}

resolved_env_value() {
	printf '%s' "$resolved_json" | jq -er --arg service "$1" --arg field "$2" \
		'.services[$service].environment[$field] | select(type == "string" and length > 0)' 2>/dev/null
}

validate_secret() {
	local name="$1"
	local value="$2"
	local minimum="$3"
	local lower
	[[ -n "$value" ]] || fail "$name" "missing value"
	lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
	case "$lower" in
		*changeme*|*change-me*|*replace*|*example*|*placeholder*|*your_*|*'<'*|*'>'*)
			fail "$name" "placeholder value is not allowed"
			;;
	esac
	(( ${#value} >= minimum )) || fail "$name" "value is shorter than the required minimum"
}

[[ -d "$compose_dir" ]] || fail "compose_dir" "directory does not exist"
[[ -f "$compose_file" ]] || fail "docker-compose.yml" "file does not exist"
[[ -f "$config_file" ]] || fail "config.json" "file does not exist"
[[ -f "$env_file" ]] || fail ".env" "file does not exist"
[[ -d "$backup_dir" ]] || fail "backup_dir" "directory does not exist"
[[ "$(file_mode "$env_file")" == "600" ]] || fail ".env" "file mode must be 0600"
[[ "$(file_mode "$backup_dir")" == "700" ]] || fail "backup_dir" "directory mode must be 0700"
pass "required files and private permissions"
require_command jq
jq -e -s 'length == 1 and (.[0] | type == "object")' "$config_file" >/dev/null 2>&1 ||
	fail "config.json" "must contain a JSON object"
jq -e '(.client // {} | .disable_db_pings_in_health != true)' "$config_file" >/dev/null 2>&1 ||
	fail "config.json" "database health pings must remain enabled"
for store in config_store logs_store; do
	jq -e --arg store "$store" \
		'.[$store] | type == "object" and .enabled == true and .type == "postgres"' \
		"$config_file" >/dev/null 2>&1 ||
		fail "$store" "must be an enabled PostgreSQL store"
	jq -e --arg store "$store" \
		'.[$store].config | type == "object"' "$config_file" >/dev/null 2>&1 ||
		fail "$store" "config must be an object"
	jq -e --arg store "$store" \
		'(.[$store].config.user == "env.POSTGRES_USER" and
		  .[$store].config.password == "env.POSTGRES_PASSWORD" and
		  .[$store].config.db_name == "env.POSTGRES_DB")' \
		"$config_file" >/dev/null 2>&1 ||
		fail "$store" "user, password and db_name must use the PostgreSQL environment references"
done
pass "PostgreSQL storage configuration and database health pings"

require_command docker
docker compose version >/dev/null 2>&1 || fail "docker compose" "Compose plugin is unavailable"
pass "docker compose and jq availability"

docker compose --env-file "$env_file" -f "$compose_file" config --quiet >/dev/null 2>&1 ||
	fail "docker compose config" "configuration validation failed"
resolved_json="$(docker compose --env-file "$env_file" -f "$compose_file" config --format json 2>/dev/null)" ||
	fail "docker compose config" "resolved configuration could not be read"
printf '%s' "$resolved_json" | jq -e . >/dev/null 2>&1 ||
	fail "docker compose config" "resolved configuration is not valid JSON"

elygate_resolved_image="$(printf '%s' "$resolved_json" | jq -r '.services.elygate.image // empty')"
postgres_resolved_image="$(printf '%s' "$resolved_json" | jq -r '.services.postgres.image // empty')"
[[ "$elygate_resolved_image" =~ ^[^@[:space:]]+@sha256:[0-9a-f]{64}$ ]] ||
	fail "elygate.image" "image must use a sha256 digest"
[[ "$postgres_resolved_image" =~ ^[^@[:space:]]+@sha256:[0-9a-f]{64}$ ]] ||
	fail "postgres.image" "image must use a sha256 digest"
pass "immutable image references"

for field in BIFROST_ENCRYPTION_KEY BIFROST_SETUP_TOKEN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
	field_value="$(resolved_env_value elygate "$field")" || fail "$field" "missing or invalid value"
	minimum=1
	case "$field" in
		BIFROST_ENCRYPTION_KEY|BIFROST_SETUP_TOKEN|POSTGRES_PASSWORD) minimum=32 ;;
	esac
	validate_secret "$field" "$field_value" "$minimum"
	if [[ "$field" == POSTGRES_* ]]; then
		postgres_value="$(resolved_env_value postgres "$field")" ||
			fail "postgres.$field" "missing or invalid value"
		[[ "$postgres_value" == "$field_value" ]] ||
			fail "postgres.$field" "must match the gateway environment value"
		validate_secret "postgres.$field" "$postgres_value" "$minimum"
	fi
done
pass "required environment values and storage alignment"

pass "single-node production preflight"
