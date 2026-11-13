#!/usr/bin/env bash
set -euo pipefail

# Publish a draft transport release only after every Docker/GHCR/UBI9 image and
# manifest succeeded. Also syncs stable latest/ from the verified version prefix.

VERSION="$1"
TAG_NAME="transports/v${VERSION}"

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
RESTORE_ON_FAIL=false
restore_latest() {
  local code=$?
  if [ "$RESTORE_ON_FAIL" = "true" ] && [ -n "$BACKUP" ]; then
    trap - EXIT
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
  exit "$code"
}
trap restore_latest EXIT

if [[ "$VERSION" != *-* ]]; then
  BACKUP="bifrost/latest-backup-$(date +%s)-$$"
  aws s3 sync "s3://$R2_BUCKET/bifrost/latest/" "s3://$R2_BUCKET/$BACKUP/" \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" --no-progress
  BACKUP_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$BACKUP/" \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
  if [ -z "$BACKUP_LISTING" ]; then
    echo "❌ Snapshot of latest/ is empty; refusing to overwrite it" >&2
    exit 1
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

if [[ "$VERSION" != *-* ]]; then
  gh release edit "$TAG_NAME" --draft=false --latest
else
  gh release edit "$TAG_NAME" --draft=false
fi

# Persist a receipt tying the promoted release to its source prefix and run.
RECEIPT=$(mktemp)
printf '{"version":"v%s","tag":"%s","run_id":"%s","commit":"%s","published_at":"%s"}\n' \
  "$VERSION" "$TAG_NAME" "${GITHUB_RUN_ID:-local}" "${GITHUB_SHA:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RECEIPT"
aws s3 cp "$RECEIPT" "s3://$R2_BUCKET/bifrost/v${VERSION}/release-receipt.json" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" --no-progress
rm -f "$RECEIPT"

RESTORE_ON_FAIL=false
trap - EXIT
if [ -n "$BACKUP" ]; then
  aws s3 rm "s3://$R2_BUCKET/$BACKUP/" --recursive \
    --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}" >/dev/null 2>&1 || true
fi
echo "✅ Published $TAG_NAME after Docker/GHCR/UBI9 gates"
