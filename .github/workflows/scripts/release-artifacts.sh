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

# require_remote_platform_digest <endpoint> <bucket> <prefix> <version> <binary> <platform...>
require_remote_platform_digest() {
  local endpoint="$1" bucket="$2" prefix="$3" version="$4" binary="$5"; shift 5
  local platform name remote_sha remote_actual
  local -a R2_PROFILE_ARGS=()
  [ "${R2_NO_PROFILE:-0}" = "1" ] || R2_PROFILE_ARGS=(--profile "${R2_AWS_PROFILE:-R2}")
  for platform in "$@"; do
    name="$(platform_output_name "$binary" "$platform")"
    remote_sha=$(aws s3 cp "s3://$bucket/$prefix/v$version/$platform/$name.sha256" - \
      --endpoint-url "$endpoint" "${R2_PROFILE_ARGS[@]}" | awk '{print $1}')
    remote_actual=$(aws s3 cp "s3://$bucket/$prefix/v$version/$platform/$name" - \
      --endpoint-url "$endpoint" "${R2_PROFILE_ARGS[@]}" | sha256_stdin)
    if [ -z "$remote_sha" ] || [ "$remote_sha" != "$remote_actual" ]; then
      echo "❌ Remote checksum mismatch for $platform/$name" >&2
      return 1
    fi
  done
}

# require_remote_prefix_digest <endpoint> <bucket> <key-prefix> <binary> <platform...>
require_remote_prefix_digest() {
  local endpoint="$1" bucket="$2" key_prefix="$3" binary="$4"; shift 4
  local platform name remote_sha remote_actual
  local -a R2_PROFILE_ARGS=()
  [ "${R2_NO_PROFILE:-0}" = "1" ] || R2_PROFILE_ARGS=(--profile "${R2_AWS_PROFILE:-R2}")
  for platform in "$@"; do
    name="$(platform_output_name "$binary" "$platform")"
    remote_sha=$(aws s3 cp "s3://$bucket/$key_prefix/$platform/$name.sha256" - \
      --endpoint-url "$endpoint" "${R2_PROFILE_ARGS[@]}" | awk '{print $1}')
    remote_actual=$(aws s3 cp "s3://$bucket/$key_prefix/$platform/$name" - \
      --endpoint-url "$endpoint" "${R2_PROFILE_ARGS[@]}" | sha256_stdin)
    if [ -z "$remote_sha" ] || [ "$remote_sha" != "$remote_actual" ]; then
      echo "❌ Remote checksum mismatch for $key_prefix/$platform/$name" >&2
      return 1
    fi
  done
}
