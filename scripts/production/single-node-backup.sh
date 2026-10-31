#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="${1:-}"
backup_root="${BACKUP_ROOT:-$compose_dir/backups}"
env_file="${ENV_FILE:-$compose_dir/.env}"

fail() {
	printf 'FAIL backup: %s\n' "$1" >&2
	exit 1
}

compose() {
	docker compose --env-file "$env_file" -f "$compose_file" "$@" 2>/dev/null
}

hash_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1"
	else
		shasum -a 256 "$1"
	fi
}

container_snapshot() {
	jq -ce '[.[] | {Id, Image, Mounts, Config: (.Config | {Image, Env, Cmd, Entrypoint}),
		State: (.State | {Status, Running, Restarting, OOMKilled, ExitCode,
			StartedAt, FinishedAt, Health: .Health.Status})}]'
}

[[ "$#" == 2 && "$2" == "--confirm-no-writers" ]] ||
	fail "usage: single-node-backup.sh COMPOSE_DIR --confirm-no-writers (stop the gateway and exclude all other writers first)"
for executable in docker jq tar cmp mktemp; do
	command -v "$executable" >/dev/null 2>&1 || fail "required command is unavailable: $executable"
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
	fail "sha256sum or shasum is required"
fi
compose_dir="$(CDPATH='' cd -- "$compose_dir" && pwd -P)" || fail "compose directory is unavailable"
compose_file="$compose_dir/docker-compose.yml"
config_file="$compose_dir/config.json"
BACKUP_DIR="$backup_root" ENV_FILE="$env_file" \
	bash "$script_dir/single-node-preflight.sh" "$compose_dir" >/dev/null 2>&1 ||
	fail "single-node preflight failed"
backup_root="$(CDPATH='' cd -- "$backup_root" && pwd -P)" || fail "backup directory is unavailable"

# 同库不等于同一实例；外部地址或其他端口不能由本地容器的 dump 代替。
jq -e '
	all(.config_store.config, .logs_store.config;
		.host == "postgres" and .port == "5432" and .ssl_mode == "disable")
' "$config_file" >/dev/null 2>&1 ||
	fail "only the template PostgreSQL host, port and single-database topology are supported"
resolved_json="$(compose config --format json)" || fail "Compose configuration could not be read"
gateway_id="$(compose ps --all --quiet elygate)" || fail "gateway container could not be found"
postgres_id="$(compose ps --all --quiet postgres)" || fail "PostgreSQL container could not be found"
for container_id in "$gateway_id" "$postgres_id"; do
	[[ -n "$container_id" && "$container_id" != *[[:space:]]* ]] ||
		fail "exactly one existing container per service is required"
done
containers_json="$(docker inspect "$gateway_id" "$postgres_id" 2>/dev/null)" ||
	fail "container state could not be read"
# inspect/Compose 原文含密钥，只在内存中比对，不写入文件、参数或日志。
printf '%s\n%s\n' "$resolved_json" "$containers_json" | jq -es --arg config "$config_file" '
	.[0] as $compose | .[1] as $containers |
	($containers | length == 2) and
	($containers[0].State | .Status == "exited" and .Running == false and
		.Restarting == false and .OOMKilled == false and .ExitCode == 0) and
	($containers[1].State | .Status == "running" and .Running == true and
		.Restarting == false and .Health.Status == "healthy") and
	(all(range(0; 2); . as $index |
		(["elygate", "postgres"][$index]) as $service |
		$containers[$index] as $container |
		$container.Config.Image == $compose.services[$service].image and
		($container.Image | test("^sha256:[0-9a-f]{64}$")) and
		all($compose.services[$service].environment | to_entries[];
			. as $env | ($container.Config.Env | index($env.key + "=" + $env.value)) != null))) and
	($containers[0].Mounts | length == 2 and
		any(.[]; .Destination == "/app/data" and .Type == "volume" and
			.Name == $compose.volumes["elygate-runtime"].name) and
		any(.[]; .Destination == "/app/data/config.json" and .Source == $config and .RW == false)) and
	($containers[1].Mounts |
		any(.[]; .Destination == "/var/lib/postgresql/data" and .Type == "volume" and
			.Name == $compose.volumes["postgres-data"].name)) and
	($containers[0].Config |
		(.Env | map(select(startswith("APP_DIR="))) == ["APP_DIR=/app/data"]) and
		.Cmd == ["/app/main"] and .Entrypoint == ["/app/docker-entrypoint.sh"]) and
	($compose.services.elygate.command == null and $compose.services.elygate.entrypoint == null) and
	(($compose.services.elygate.environment.APP_DIR // "/app/data") == "/app/data")
' >/dev/null 2>&1 || fail "containers must match the template, gateway must have exited normally, and PostgreSQL must be healthy"
initial_snapshot="$(printf '%s' "$containers_json" | container_snapshot)" || fail "initial container snapshot failed"
gateway_image="$(printf '%s' "$containers_json" | jq -er '.[0].Image')"
postgres_image="$(printf '%s' "$containers_json" | jq -er '.[1].Image')"
image_metadata="$(docker image inspect "$gateway_image" "$postgres_image" \
	--format '{{json .}}' 2>/dev/null |
	jq -cs '[.[] | {id: .Id, os: .Os, architecture: .Architecture, user: .Config.User}]')" ||
	fail "actual container image metadata is unavailable"
printf '%s' "$image_metadata" | jq -e --arg gateway "$gateway_image" --arg postgres "$postgres_image" '
	length == 2 and .[0].id == $gateway and .[1].id == $postgres and
	all(.[]; (.os | type == "string" and length > 0) and
		(.architecture | type == "string" and length > 0))
' >/dev/null 2>&1 || fail "actual container image metadata is invalid"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary_dir="$(mktemp -d "$backup_root/.elygate-backup-$timestamp.XXXXXXXX")" ||
	fail "private backup directory could not be created"
backup_name="${temporary_dir##*/}"
final_dir="$backup_root/${backup_name#.}"
cleanup() {
	local status="$?"
	trap - EXIT
	rm -rf -- "$temporary_dir"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp "$config_file" "$temporary_dir/config.json" 2>/dev/null || fail "configuration copy failed"
cp "$compose_file" "$temporary_dir/docker-compose.yml" 2>/dev/null || fail "Compose copy failed"
docker exec "$postgres_id" sh -ec \
	'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --host=127.0.0.1 --port=5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
	> "$temporary_dir/database.dump" 2>/dev/null || fail "pg_dump failed"
[[ -s "$temporary_dir/database.dump" ]] || fail "pg_dump produced an empty archive"
docker exec -i "$postgres_id" pg_restore --list \
	< "$temporary_dir/database.dump" > "$temporary_dir/database.list" 2>/dev/null ||
	fail "database archive could not be listed"
[[ -s "$temporary_dir/database.list" ]] || fail "database archive list is empty"
# Docker 的 tar 流保留容器内权限和 UID/GID，不在宿主展开潜在的链接或特殊文件。
docker cp "$gateway_id:/app/data/." - > "$temporary_dir/runtime.tar" 2>/dev/null ||
	fail "runtime archive copy failed"
if [[ ! -s "$temporary_dir/runtime.tar" ]] ||
	! tar -tf "$temporary_dir/runtime.tar" >/dev/null 2>&1; then
	fail "runtime archive is unreadable"
fi
if ! cmp -s "$config_file" "$temporary_dir/config.json" ||
	! cmp -s "$compose_file" "$temporary_dir/docker-compose.yml"; then
	fail "deployment files changed during backup"
fi
final_snapshot="$(docker inspect "$gateway_id" "$postgres_id" 2>/dev/null | container_snapshot)" ||
	fail "final container snapshot failed"
[[ "$initial_snapshot" == "$final_snapshot" ]] || fail "source containers changed during backup"

printf '%s' "$resolved_json" | jq '{
	gateway: .services.elygate.image, postgres: .services.postgres.image
}' > "$temporary_dir/image-refs.json"
printf '%s\n' "$image_metadata" > "$temporary_dir/image-metadata.json"
jq -n --arg created "$timestamp" '{
	format: "elygate-single-node-backup-v1", created_at: $created,
	topology: "single-database", writers_excluded: "operator-confirmed",
	secrets: "restore from separate secret management", recovery_verified: false
}' > "$temporary_dir/manifest.json"
chmod 600 "$temporary_dir"/*
(
	cd "$temporary_dir"
	for artifact in database.dump database.list runtime.tar config.json docker-compose.yml image-refs.json image-metadata.json manifest.json; do
		hash_file "$artifact"
	done
) > "$temporary_dir/SHA256SUMS" || fail "checksum generation failed"
[[ ! -e "$final_dir" && ! -L "$final_dir" ]] || fail "backup destination already exists"
mv "$temporary_dir" "$final_dir"
[[ ! -e "$temporary_dir" ]] || fail "backup destination was not published"
trap - EXIT INT TERM
printf 'PASS backup captured (recovery not verified): %s\n' "$final_dir"
