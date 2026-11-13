#!/usr/bin/env bash
# Shared release artifact completeness checks.

BIFROST_HTTP_PLATFORMS=("darwin/amd64" "darwin/arm64" "linux/amd64" "linux/arm64" "windows/amd64")
CLI_PLATFORMS=("darwin/amd64" "darwin/arm64" "linux/amd64" "linux/arm64" "windows/amd64")
PLUGIN_PLATFORMS=("darwin/amd64" "darwin/arm64" "linux/amd64" "linux/arm64" "windows/amd64")

platform_output_name() {
  local binary="$1" platform="$2"
  if [[ "$platform" == windows/* ]]; then
    echo "${binary}.exe"
  else
    echo "$binary"
  fi
}

# require_platform_dist <dist-root> <binary> <platform...>
require_platform_dist() {
  local base="$1" binary="$2"; shift 2
  local platform name artifact
  for platform in "$@"; do
    name="$(platform_output_name "$binary" "$platform")"
    artifact="$base/$platform/$name"
    if [ ! -s "$artifact" ] || [ ! -s "$artifact.sha256" ]; then
      echo "❌ Incomplete build: missing $artifact or its checksum" >&2
      return 1
    fi
    local expected actual
    expected=$(awk '{print $1}' "$artifact.sha256")
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$artifact" | awk '{print $1}')
    else
      actual=$(shasum -a 256 "$artifact" | awk '{print $1}')
    fi
    if [ "$expected" != "$actual" ]; then
      echo "❌ Checksum mismatch for $artifact" >&2
      return 1
    fi
  done
}

# require_platform_listing <s3-ls-recursive-output> <binary> <platform...>
require_platform_listing() {
  local listing="$1" binary="$2"; shift 2
  local platform name
  for platform in "$@"; do
    name="$(platform_output_name "$binary" "$platform")"
    if ! grep -qE "/$platform/$name[[:space:]]*$" <<<"$listing" || ! grep -qE "/$platform/$name\.sha256[[:space:]]*$" <<<"$listing"; then
      echo "❌ Published artifacts are missing $platform/$name or its checksum" >&2
      return 1
    fi
  done
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'; else shasum -a 256 | awk '{print $1}'; fi
}
