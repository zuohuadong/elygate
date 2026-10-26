# Control Plane Tests

The default package suite uses a fresh SQLite store per test:

```sh
cd transports
GOWORK=off go test -count=1 ./bifrost-http/controlplane
```

Run the same contracts against a real PostgreSQL server from the repository
root. PostgreSQL binaries and Go must be on `PATH`; alternatively set
`POSTGRES_BIN` to the PostgreSQL `bin` directory. The runner uses the checked-in
module manifests with `GOWORK=off`, not an optional local workspace:

```sh
bash scripts/test-controlplane-postgres.sh
bash scripts/test-controlplane-postgres.sh -race -timeout=15m
```

Additional `go test` flags are forwarded unchanged. The longer timeout gives
race-instrumented migrations time to finish on slower storage.

The runner initializes a private local cluster, disables TCP listeners, and
uses a directory-restricted Unix socket without passwords. Every test creates
a randomly named database, opens the production configstore migration/runtime
pools, and closes those pools before dropping only its own database.
An explicitly selected PostgreSQL backend fails on setup or migration errors;
it never falls back to SQLite or silently skips.

The runner checks for leaked test databases and stops its PostgreSQL process
on success or failure. Logs and stopped database files remain in the printed
artifact directory. Set `TMPDIR` to select an artifact volume; its path must
be short enough for Unix sockets. No existing database or Docker daemon is used.

This covers package-level migration, key lifecycle, audit, usage projection,
reconciliation, filters and summary contracts. It does not establish real
provider, browser, production deployment, or backup/restore acceptance.
