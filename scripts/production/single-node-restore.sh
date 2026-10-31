#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backup_dir="${1:-}"
target_dir="${2:-}"
env_file="${ENV_FILE:-$target_dir/.env}"
runtime_container_id=""

fail() {
	printf 'FAIL restore: %s\n' "$1" >&2
	exit 1
}

compose() {
	docker compose --env-file "$env_file" -f "$compose_file" "$@" 2>/dev/null
}

container_snapshot() {
	jq -ce '[.[] | {Id, Image, Mounts: (.Mounts | sort_by(.Destination)), Config, State:
		(.State | {Status, Running, Restarting, OOMKilled, ExitCode, StartedAt, FinishedAt})}]'
}

assert_target_unchanged() {
	local current_snapshot current_compose
	current_snapshot="$(docker inspect "$gateway_id" "$postgres_id" 2>/dev/null | container_snapshot)" ||
		fail "target container snapshot is unavailable"
	current_compose="$(compose config --format json)" || fail "target configuration is unavailable"
	[[ "$current_snapshot" == "$initial_snapshot" && "$current_compose" == "$resolved_json" ]] ||
		fail "target containers or configuration changed during restore"
	cmp -s "$config_file" "$backup_dir/config.json" || fail "target configuration changed"
}

cleanup() {
	local status="$?"
	trap - EXIT
	if [[ -n "$runtime_container_id" ]]; then
		if ! docker rm "$runtime_container_id" >/dev/null 2>&1; then
			printf 'FAIL restore: temporary runtime container cleanup failed\n' >&2
			status=1
		fi
	fi
	exit "$status"
}

[[ "$#" == 3 && "$3" == "--confirm-isolated-no-writers" ]] ||
	fail "usage: single-node-restore.sh BACKUP_DIR TARGET_COMPOSE_DIR --confirm-isolated-no-writers"
for executable in docker jq cmp python3; do
	command -v "$executable" >/dev/null 2>&1 || fail "required command is unavailable: $executable"
done
backup_dir="$(CDPATH='' cd -- "$backup_dir" && pwd -P)" || fail "backup directory is unavailable"
target_dir="$(CDPATH='' cd -- "$target_dir" && pwd -P)" || fail "target directory is unavailable"
[[ "$backup_dir" != "$target_dir" && "$backup_dir" != "$target_dir"/* &&
	"$target_dir" != "$backup_dir"/* ]] || fail "backup and target directories must be separate"
compose_file="$target_dir/docker-compose.yml"
config_file="$target_dir/config.json"

python3 - "$backup_dir" >/dev/null 2>&1 <<'PY' ||
import hashlib
import pathlib
import posixpath
import re
import stat
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
artifacts = {
    "database.dump", "database.list", "runtime.tar", "config.json",
    "docker-compose.yml", "image-refs.json", "image-metadata.json", "manifest.json",
}
if stat.S_IMODE(root.stat().st_mode) != 0o700:
    raise ValueError("private backup directory required")
for name in artifacts | {"SHA256SUMS"}:
    attributes = (root / name).lstat()
    if not stat.S_ISREG(attributes.st_mode) or stat.S_IMODE(attributes.st_mode) != 0o600:
        raise ValueError("private regular artifacts required")
checksums = {}
for line in (root / "SHA256SUMS").read_text().splitlines():
    match = re.fullmatch(r"([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)", line)
    if not match or match[2] not in artifacts or match[2] in checksums:
        raise ValueError("invalid checksum manifest")
    checksums[match[2]] = match[1]
if set(checksums) != artifacts:
    raise ValueError("incomplete checksum manifest")
for name, expected in checksums.items():
    digest = hashlib.sha256()
    with (root / name).open("rb") as artifact:
        for block in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise ValueError("checksum mismatch")

members = {}
links = {}
with tarfile.open(root / "runtime.tar", mode="r|*") as archive:
    for member in archive:
        name = posixpath.normpath(member.name)
        if (name.startswith("/") or ".." in pathlib.PurePosixPath(member.name).parts
                or name in members):
            raise ValueError("unsafe or duplicate archive path")
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise ValueError("special archive entry")
        if member.mode & 0o6000 or (name == "." and not member.isdir()):
            raise ValueError("unsafe archive permissions")
        members[name] = "file" if member.isfile() else "directory" if member.isdir() else "link"
        if member.issym() or member.islnk():
            target = member.linkname
            if ".." in pathlib.PurePosixPath(target).parts:
                raise ValueError("parent-relative archive link")
            if member.issym():
                target = posixpath.join(posixpath.dirname(name), target)
            target = posixpath.normpath(target)
            if target.startswith("/") or target == ".." or target.startswith("../"):
                raise ValueError("escaping archive link")
            links[name] = (target, member.islnk())
if not members:
    raise ValueError("empty runtime archive")
for name in members:
    if any(parent.as_posix() in links for parent in pathlib.PurePosixPath(name).parents):
        raise ValueError("archive entry below a link")
for target, hardlink in links.values():
    if hardlink and members.get(target) != "file":
        raise ValueError("hard link does not reference an archived file")
PY
	fail "backup permissions, checksums or runtime archive are invalid"
jq -e '
	.format == "elygate-single-node-backup-v1" and .topology == "single-database" and
	.recovery_verified == false and
	([.source_project, .source_volumes.elygate_runtime, .source_volumes.postgres_data,
		.source_containers.elygate, .source_containers.postgres] |
		all(.[]; type == "string" and length > 0))
' "$backup_dir/manifest.json" >/dev/null 2>&1 || fail "backup manifest lacks source identity"
for target_file in "$compose_file" "$config_file" "$env_file"; do
	[[ -f "$target_file" && ! -L "$target_file" ]] ||
		fail "target files must be regular and non-symbolic"
done
ENV_FILE="$env_file" bash "$script_dir/single-node-preflight.sh" "$target_dir" >/dev/null 2>&1 ||
	fail "target single-node preflight failed"
cmp -s "$config_file" "$backup_dir/config.json" || fail "target config must match the backup"
jq -e 'all(.config_store.config, .logs_store.config;
	.host == "postgres" and .port == "5432" and .ssl_mode == "disable")' \
	"$config_file" >/dev/null 2>&1 || fail "only template single-database storage is supported"
resolved_json="$(compose config --format json)" || fail "target Compose configuration is unavailable"
printf '%s\n' "$resolved_json" | jq -e --slurpfile manifest "$backup_dir/manifest.json" \
	--slurpfile refs "$backup_dir/image-refs.json" '
	$manifest[0] as $source |
	(.name | type == "string" and length > 0) and .name != $source.source_project and
	([.volumes["elygate-runtime"].name, .volumes["postgres-data"].name] as $targets |
		($targets | all(.[]; type == "string" and length > 0)) and
		($targets | unique | length == 2) and
		all($targets[]; . as $volume |
			$volume != $source.source_volumes.elygate_runtime and
			$volume != $source.source_volumes.postgres_data)) and
	.services.elygate.image == $refs[0].gateway and
	.services.postgres.image == $refs[0].postgres and
	.services.elygate.command == null and .services.elygate.entrypoint == null and
	.services.postgres.command == null and .services.postgres.entrypoint == null and
	.services.elygate.network_mode != "host"
' >/dev/null 2>&1 || fail "target project, volumes or images are not isolated from the backup source"
gateway_id="$(compose ps --all --quiet elygate)" || fail "target gateway container is unavailable"
postgres_id="$(compose ps --all --quiet postgres)" || fail "target PostgreSQL container is unavailable"
for container_id in "$gateway_id" "$postgres_id"; do
	[[ -n "$container_id" && "$container_id" != *[[:space:]]* ]] ||
		fail "exactly one existing target container per service is required"
done
containers_json="$(docker inspect "$gateway_id" "$postgres_id" 2>/dev/null)" ||
	fail "target container state is unavailable"
printf '%s\n%s\n' "$resolved_json" "$containers_json" | jq -es --arg config "$config_file" \
	--slurpfile manifest "$backup_dir/manifest.json" \
	--slurpfile images "$backup_dir/image-metadata.json" '
	.[0] as $compose | .[1] as $containers | $manifest[0] as $source |
	($containers | length == 2) and ($images[0] | length == 2) and
	($containers[0].State | .Running == false and .Restarting == false and .OOMKilled == false and
		(.Status == "created" or (.Status == "exited" and .ExitCode == 0))) and
	($containers[1].State | .Status == "running" and .Running == true and
		.Restarting == false and .Health.Status == "healthy") and
	(all(range(0; 2); . as $index |
		(["elygate", "postgres"][$index]) as $service | $containers[$index] as $container |
		$container.Id != $source.source_containers.elygate and
		$container.Id != $source.source_containers.postgres and
		$container.Config.Image == $compose.services[$service].image and
		$container.Image == $images[0][$index].id and
		all($compose.services[$service].environment | to_entries[];
			. as $env | ($container.Config.Env | index($env.key + "=" + $env.value)) != null))) and
	($containers[0].Mounts | length == 2 and
		any(.[]; .Destination == "/app/data" and .Type == "volume" and .RW == true and
			.Name == $compose.volumes["elygate-runtime"].name) and
		any(.[]; .Destination == "/app/data/config.json" and .Type == "bind" and
			.Source == $config and .RW == false)) and
	($containers[1].Mounts | length == 1 and
		any(.[]; .Destination == "/var/lib/postgresql/data" and .Type == "volume" and .RW == true and
			.Name == $compose.volumes["postgres-data"].name)) and
	($containers[0].Config |
		(.Env | map(select(startswith("APP_DIR="))) == ["APP_DIR=/app/data"]) and
		.Cmd == ["/app/main"] and .Entrypoint == ["/app/docker-entrypoint.sh"])
' >/dev/null 2>&1 || fail "target containers must match isolated volumes, backup images and current configuration"
initial_snapshot="$(printf '%s' "$containers_json" | container_snapshot)"
gateway_image="$(printf '%s' "$containers_json" | jq -er '.[0].Image')"
runtime_volume="$(printf '%s' "$resolved_json" | jq -er '.volumes["elygate-runtime"].name')"
postgres_volume="$(printf '%s' "$resolved_json" | jq -er '.volumes["postgres-data"].name')"
volume_json="$(docker volume inspect "$runtime_volume" "$postgres_volume" 2>/dev/null)" ||
	fail "target data volumes could not be inspected"
printf '%s' "$volume_json" | jq -e --arg runtime "$runtime_volume" --arg postgres "$postgres_volume" '
	length == 2 and .[0].Name == $runtime and .[1].Name == $postgres and
	all(.[]; .Driver == "local" and .Scope == "local" and
		(.Options == null or .Options == {})) and
	(all(.[]; .Mountpoint | type == "string" and length > 0)) and
	([.[].Mountpoint] | unique | length == 2)
' >/dev/null 2>&1 || fail "target volumes must be distinct local volumes without driver options"
runtime_mount="type=volume,source=$runtime_volume,target=/restore,volume-nocopy"

docker run --rm --network none --read-only --cap-drop ALL --user 0 \
	--mount "$runtime_mount" --entrypoint /bin/sh "$gateway_image" \
	-ec 'entries="$(ls -Aq /restore)" || exit 1; test -z "$entries"' >/dev/null 2>&1 ||
	fail "target runtime volume is not empty"
empty_database="$(docker exec "$postgres_id" sh -ec '
	PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X --no-password --host=127.0.0.1 --port=5432 \
		--username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align \
		--set ON_ERROR_STOP=1 --command "
SELECT NOT EXISTS (SELECT FROM pg_namespace WHERE nspname NOT IN ('\''public'\'', '\''information_schema'\'') AND nspname !~ '\''^pg_'\'')
AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE nspname != '\''information_schema'\'' AND nspname !~ '\''^pg_'\'')
AND NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE nspname != '\''information_schema'\'' AND nspname !~ '\''^pg_'\'')
AND NOT EXISTS (SELECT FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE nspname != '\''information_schema'\'' AND nspname !~ '\''^pg_'\'')
AND NOT EXISTS (SELECT FROM pg_extension WHERE extname != '\''plpgsql'\'')
AND NOT EXISTS (SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid != pg_backend_pid());"
' 2>/dev/null)" || fail "target database emptiness check failed"
[[ "$empty_database" == "t" ]] || fail "target database must be empty with no other connected clients"
archive_list="$(docker exec -i "$postgres_id" pg_restore --list \
	< "$backup_dir/database.dump" 2>/dev/null)" || fail "database archive could not be listed"
printf '%s\n' "$archive_list" | cmp -s - "$backup_dir/database.list" ||
	fail "database archive list does not match the backup"
assert_target_unchanged
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker exec -i "$postgres_id" sh -ec '
	PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --no-password --host=127.0.0.1 --port=5432 \
		--exit-on-error --single-transaction --no-owner --no-acl \
		--username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
' < "$backup_dir/database.dump" >/dev/null 2>&1 || fail "database import failed; keep the target isolated"
assert_target_unchanged
created_container_id="$(docker create --network none --read-only --cap-drop ALL --user 0 --mount "$runtime_mount" \
	--entrypoint /bin/true "$gateway_image" 2>/dev/null)" ||
	fail "temporary runtime container creation failed; keep the target isolated"
[[ "$created_container_id" =~ ^[a-f0-9]{64}$ ]] ||
	fail "temporary runtime container identity is invalid"
runtime_container_id="$created_container_id"
docker cp -a - "$runtime_container_id:/restore" < "$backup_dir/runtime.tar" >/dev/null 2>&1 ||
	fail "runtime import failed; keep the partially restored target isolated"
assert_target_unchanged
docker rm "$runtime_container_id" >/dev/null 2>&1 ||
	fail "temporary runtime container cleanup failed"
runtime_container_id=""
printf 'PASS restore imported into isolated target; gateway remains stopped and recovery is not verified\n'
