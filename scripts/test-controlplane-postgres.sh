#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${POSTGRES_BIN:-}" ]]; then
	export PATH="$POSTGRES_BIN:$PATH"
fi
for executable in initdb postgres pg_ctl pg_isready psql go; do
	if ! command -v "$executable" >/dev/null 2>&1; then
		printf 'Missing %s; add PostgreSQL bin and Go to PATH.\n' "$executable" >&2
		exit 1
	fi
done

umask 077
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/elygate-cp-pg.XXXXXX")"
SOCKET_DIR="$WORK_DIR/s"
POSTGRES_PID=""
mkdir "$SOCKET_DIR"

cleanup() {
	local status=$?
	trap - EXIT
	if [[ -n "$POSTGRES_PID" ]] && kill -0 "$POSTGRES_PID" 2>/dev/null; then
		if ! pg_ctl -D "$WORK_DIR/data" -m fast -w -t 30 stop >>"$WORK_DIR/postgres.log" 2>&1; then
			printf 'Failed to stop the test PostgreSQL instance.\n' >&2
			status=1
		fi
		if ! wait "$POSTGRES_PID"; then
			status=1
		fi
	fi
	printf 'PostgreSQL test artifacts: %s\n' "$WORK_DIR"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ${#SOCKET_DIR} -gt 90 ]]; then
	printf 'TMPDIR is too long for a PostgreSQL Unix socket; choose a shorter path.\n' >&2
	exit 1
fi
initdb -D "$WORK_DIR/data" --username=elygate_controlplane_test \
	--auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale >"$WORK_DIR/initdb.log" 2>&1
postgres -D "$WORK_DIR/data" -h "" -k "$SOCKET_DIR" -p 5432 \
	-c unix_socket_permissions=0700 >"$WORK_DIR/postgres.log" 2>&1 &
POSTGRES_PID=$!

ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
	if pg_isready -q -h "$SOCKET_DIR" -p 5432 -U elygate_controlplane_test -d postgres; then
		ready=true
		break
	fi
	if ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
		printf 'PostgreSQL exited during startup; see %s/postgres.log.\n' "$WORK_DIR" >&2
		exit 1
	fi
	sleep 1
done
if [[ "$ready" != true ]]; then
	printf 'PostgreSQL did not become ready within 60 seconds.\n' >&2
	exit 1
fi

export ELYGATE_TEST_POSTGRES_SOCKET="$SOCKET_DIR"
cd "$ROOT_DIR/transports"
GOWORK=off go test -count=1 -timeout=5m "$@" ./bifrost-http/controlplane

remaining="$(psql -X -h "$SOCKET_DIR" -p 5432 -U elygate_controlplane_test -d postgres -At \
	-c "SELECT count(*) FROM pg_database WHERE starts_with(datname, 'elygate_cp_test_')")"
if [[ "$remaining" != 0 ]]; then
	printf '%s test databases were not cleaned up.\n' "$remaining" >&2
	exit 1
fi
