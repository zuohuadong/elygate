#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/semver.sh"

# Publish a draft transport release only after every Docker/GHCR/UBI9 image and
# manifest succeeded. Also syncs stable latest/ from the verified version prefix.

VERSION="${1#v}"
TAG_NAME="transports/v${VERSION}"
if ! is_semver "$VERSION"; then
  echo "❌ Invalid transport version: $1 (strict SemVer 2.0.0 without build metadata)" >&2
  exit 1
fi

source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"

: "${GH_TOKEN:?GH_TOKEN env var is required}"
validate_r2_bucket
: "${R2_ENDPOINT:?R2_ENDPOINT env var is required}"
ENDPOINT="$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')"

LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/v${VERSION}/" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
require_platform_listing "$LISTING" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
require_remote_platform_digest "$ENDPOINT" "$R2_BUCKET" bifrost "$VERSION" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"

BACKUP=""
RECEIPT_KEY=""
RESTORE_ON_FAIL=false
RESTORE_TO_EMPTY=false
restore_latest() {
  local code=$?
  trap - EXIT
  if [ -n "$RECEIPT_KEY" ]; then
    echo "🧹 Removing incomplete receipt $RECEIPT_KEY..."
    removed=false
    for _ in 1 2 3; do
      if aws s3 rm "s3://$R2_BUCKET/$RECEIPT_KEY" --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" >/dev/null 2>&1; then
        removed=true
        break
      fi
      sleep 2
    done
    if [ "$removed" != "true" ]; then
      echo "❌ Could not remove incomplete receipt $RECEIPT_KEY; manual recovery required" >&2
      exit 1
    fi
  fi
  if [ "$RESTORE_ON_FAIL" = "true" ]; then
    if [ "$RESTORE_TO_EMPTY" = "true" ]; then
      echo "↩️ Restoring empty latest/..."
      aws s3 rm "s3://$R2_BUCKET/bifrost/latest/" --recursive \
        --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" || exit 1
    else
      echo "↩️ Restoring previous latest/ from $BACKUP..."
      if ! aws s3 sync "s3://$R2_BUCKET/$BACKUP/" "s3://$R2_BUCKET/bifrost/latest/" \
        --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" \
        --no-progress --delete; then
        echo "❌ Restore from $BACKUP failed" >&2
        exit 1
      fi
      if ! require_remote_prefix_digest "$ENDPOINT" "$R2_BUCKET" "bifrost/latest" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"; then
        echo "❌ Restored latest/ failed digest verification" >&2
        exit 1
      fi
    fi
  fi
  exit "$code"
}
trap restore_latest EXIT

if [[ "$VERSION" != *-* ]]; then
  CURRENT_LATEST=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/latest/" \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
  if [ -n "$CURRENT_LATEST" ]; then
    BACKUP="bifrost/latest-backup-$(date +%s)-$$"
    aws s3 sync "s3://$R2_BUCKET/bifrost/latest/" "s3://$R2_BUCKET/$BACKUP/" \
      --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" --no-progress
    BACKUP_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$BACKUP/" \
      --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
    if [ -z "$BACKUP_LISTING" ]; then
      echo "❌ Snapshot of latest/ is empty; refusing to overwrite it" >&2
      exit 1
    fi
  else
    echo "ℹ️ bifrost/latest/ is empty; initializing the first stable release"
    RESTORE_TO_EMPTY=true
  fi
  RESTORE_ON_FAIL=true
  aws s3 sync "s3://$R2_BUCKET/bifrost/v${VERSION}/" "s3://$R2_BUCKET/bifrost/latest/" \
    --endpoint-url "$ENDPOINT" \
    --profile "${R2_AWS_PROFILE:-R2}" \
    --no-progress \
    --delete
  LATEST_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/latest/" \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
  require_platform_listing "$LATEST_LISTING" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
  require_remote_prefix_digest "$ENDPOINT" "$R2_BUCKET" "bifrost/latest" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
fi

# Persist a receipt before making the GitHub release public. If the receipt
# write fails, the EXIT trap restores latest/ and the release stays draft.
RECEIPT_KEY="bifrost/v${VERSION}/release-receipt.json"
RECEIPT=$(mktemp)
printf '{"version":"v%s","tag":"%s","run_id":"%s","commit":"%s","ready_at":"%s"}\n' \
  "$VERSION" "$TAG_NAME" "${GITHUB_RUN_ID:-local}" "${GITHUB_SHA:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RECEIPT"
aws s3 cp "$RECEIPT" "s3://$R2_BUCKET/$RECEIPT_KEY" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" --no-progress
rm -f "$RECEIPT"

if [[ "$VERSION" != *-* ]]; then
  gh release edit "$TAG_NAME" --draft=false --latest
else
  gh release edit "$TAG_NAME" --draft=false
fi
RECEIPT_KEY=""

RESTORE_ON_FAIL=false
trap - EXIT
if [ -n "$BACKUP" ]; then
  aws s3 rm "s3://$R2_BUCKET/$BACKUP/" --recursive \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" >/dev/null 2>&1 || true
fi
echo "✅ Published $TAG_NAME after Docker/GHCR/UBI9 gates"
