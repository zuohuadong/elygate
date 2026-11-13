#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/semver.sh"

# publish-cli-latest.sh <r2-prefix> <version> <binary>
# Publish the already-released, complete versioned prefix to latest/.

PREFIX="$1"
VERSION="${2#v}"
BINARY="$3"
if ! is_semver "$VERSION"; then
  echo "❌ Invalid version: $2 (strict SemVer 2.0.0 without build metadata)" >&2
  exit 1
fi

source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"

validate_r2_bucket
if [ -z "${R2_ENDPOINT:-}" ]; then
  echo "❌ R2_ENDPOINT env var is required" >&2
  exit 1
fi
ENDPOINT="$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')"

SOURCE_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$PREFIX/v${VERSION}/" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
require_platform_listing "$SOURCE_LISTING" "$BINARY" "${CLI_PLATFORMS[@]}"
require_remote_platform_digest "$ENDPOINT" "$R2_BUCKET" "$PREFIX" "$VERSION" "$BINARY" "${CLI_PLATFORMS[@]}"

BACKUP="$PREFIX/latest-backup-$(date +%s)-$$"
RESTORE_ON_FAIL=false
RESTORE_TO_EMPTY=false
restore_latest() {
  local code=$?
  if [ "$RESTORE_ON_FAIL" = "true" ]; then
    trap - EXIT
    if [ "$RESTORE_TO_EMPTY" = "true" ]; then
      echo "↩️ Restoring empty $PREFIX/latest/..."
      if ! aws s3 rm "s3://$R2_BUCKET/$PREFIX/latest/" --recursive \
        --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}"; then
        echo "❌ Clearing $PREFIX/latest/ failed" >&2; exit 1
      fi
    else
      echo "↩️ Restoring previous $PREFIX/latest/ from $BACKUP..."
      if ! aws s3 sync "s3://$R2_BUCKET/$BACKUP/" "s3://$R2_BUCKET/$PREFIX/latest/" \
        --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" --no-progress --delete; then
        echo "❌ Restore from $BACKUP failed" >&2; exit 1
      fi
      if ! require_remote_prefix_digest "$ENDPOINT" "$R2_BUCKET" "$PREFIX/latest" "$BINARY" "${CLI_PLATFORMS[@]}"; then
        echo "❌ Restored $PREFIX/latest/ failed digest verification" >&2; exit 1
      fi
    fi
  fi
  exit "$code"
}
trap restore_latest EXIT

CURRENT_LATEST=$(aws s3 ls --recursive "s3://$R2_BUCKET/$PREFIX/latest/" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
if [ -n "$CURRENT_LATEST" ]; then
  aws s3 sync "s3://$R2_BUCKET/$PREFIX/latest/" "s3://$R2_BUCKET/$BACKUP/" \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" --no-progress
  BACKUP_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$BACKUP/" \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
  if [ -z "$BACKUP_LISTING" ]; then
    echo "❌ Snapshot of $PREFIX/latest/ is empty; refusing to overwrite it" >&2
    exit 1
  fi
else
  echo "ℹ️ $PREFIX/latest/ is empty; initializing the first stable release"
  RESTORE_TO_EMPTY=true
fi
RESTORE_ON_FAIL=true

aws s3 sync "s3://$R2_BUCKET/$PREFIX/v${VERSION}/" "s3://$R2_BUCKET/$PREFIX/latest/" \
  --endpoint-url "$ENDPOINT" \
  --profile "${R2_AWS_PROFILE:-R2}" \
  --no-progress \
  --delete

LATEST_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$PREFIX/latest/" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
require_platform_listing "$LATEST_LISTING" "$BINARY" "${CLI_PLATFORMS[@]}"
require_remote_prefix_digest "$ENDPOINT" "$R2_BUCKET" "$PREFIX/latest" "$BINARY" "${CLI_PLATFORMS[@]}"
LATEST_VERSION=$(aws s3 cp "s3://$R2_BUCKET/$PREFIX/latest/version.txt" - \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
if [ "$LATEST_VERSION" != "v${VERSION#v}" ]; then
  echo "❌ latest/version.txt is '$LATEST_VERSION', expected 'v${VERSION#v}'" >&2
  exit 1
fi
RESTORE_ON_FAIL=false
trap - EXIT
aws s3 rm "s3://$R2_BUCKET/$BACKUP/" --recursive \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" >/dev/null 2>&1 || true
echo "✅ latest/ now matches v${VERSION}"
