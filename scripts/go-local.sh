#!/usr/bin/env bash
set -euo pipefail

# Keep local Go builds deterministic on macOS and avoid linker pressure from
# concurrent cgo packages. Override any variable when a different toolchain is
# intentionally required.
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.27.0}"
export CGO_ENABLED="${CGO_ENABLED:-1}"
export GOMAXPROCS="${GOMAXPROCS:-4}"
# Do not inherit a global cache placed on /Volumes/Data: metadata-heavy Go
# cache access there can stall package loading/linking. Use local /tmp unless
# the caller explicitly opts into another path.
export GOCACHE="${ELYGATE_GOCACHE:-/tmp/elygate-go-cache}"

if [[ $# -eq 0 ]]; then
  echo "usage: scripts/go-local.sh <go-subcommand> [args...]" >&2
  exit 2
fi

exec go "$@"
