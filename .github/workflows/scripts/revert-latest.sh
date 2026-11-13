#!/usr/bin/env bash

source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"
source "$(dirname "$0")/release-state.sh"
source "$(dirname "$0")/semver.sh"
set -euo pipefail

# Overwrite latest with a specific version from R2
# Usage: ./revert-latest.sh <version>

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version> (e.g., v1.2.3)"
  exit 1
fi

VERSION="$1"
if [[ ! "$VERSION" =~ ^v ]]; then
  VERSION="v${VERSION}"
fi
if ! is_semver "${VERSION#v}" || [[ "$VERSION" == *-* ]] || [[ "$VERSION" == *+* ]]; then
  echo "❌ Invalid or non-stable version '$VERSION'; latest requires a stable vX.Y.Z" >&2
  exit 1
fi
: "${GH_TOKEN:?GH_TOKEN env var is required to verify the release before rollback}"
if ! git rev-parse -q --verify "refs/tags/transports/${VERSION}" >/dev/null; then
  echo "❌ Git tag transports/${VERSION} does not exist" >&2
  exit 1
fi
if ! release_check "transports/${VERSION}"; then
  echo "❌ GitHub release transports/${VERSION} does not exist or is unreadable" >&2
  exit 1
fi

# Validate required environment variables
: "${R2_ENDPOINT:?R2_ENDPOINT env var is required}"
validate_r2_bucket

# Clean endpoint URL
R2_ENDPOINT="$(echo "$R2_ENDPOINT" | tr -d '[:space:]')"

echo "🔄 Reverting latest to version: $VERSION"

# Function to sync with retry logic
sync_with_retry() {
  local source_path="$1"
  local dest_path="$2"
  local max_retries=3

  for attempt in $(seq 1 $max_retries); do
    echo "🔄 Attempt $attempt/$max_retries: Syncing $source_path to $dest_path"

    if aws s3 sync "$source_path" "$dest_path" \
       --endpoint-url "$R2_ENDPOINT" \
       --profile "${R2_AWS_PROFILE:-R2}" \
       --no-progress \
       --delete; then
      echo "✅ Sync successful from $source_path to $dest_path"
      return 0
    else
      echo "⚠️ Attempt $attempt failed"
      if [ $attempt -lt $max_retries ]; then
        delay=$((2 ** attempt))
        echo "🕐 Waiting ${delay}s before retry..."
        sleep $delay
      fi
    fi
  done

  echo "❌ All $max_retries attempts failed for syncing to $dest_path"
  return 1
}

# Check if the version exists and actually contains artifacts. `aws s3 ls` on an
# empty prefix returns 0, so the listing content is the only reliable signal.
echo "🔍 Checking if version $VERSION exists..."
if ! SOURCE_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/$VERSION/" \
     --endpoint-url "$R2_ENDPOINT" \
     --profile "${R2_AWS_PROFILE:-R2}" 2>&1); then
  echo "❌ Version $VERSION not found in R2 bucket"
  echo "Available versions:"
  aws s3 ls "s3://$R2_BUCKET/bifrost/" \
    --endpoint-url "$R2_ENDPOINT" \
    --profile "${R2_AWS_PROFILE:-R2}" | grep "PRE v" | awk '{print $2}' | sed 's/\///g' || true
  exit 1
fi
if [ -z "$SOURCE_LISTING" ]; then
  echo "❌ Version prefix s3://$R2_BUCKET/bifrost/$VERSION/ is empty; refusing to overwrite latest/"
  exit 1
fi
require_platform_listing "$SOURCE_LISTING" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
require_remote_platform_digest "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" "$R2_BUCKET" bifrost "${VERSION#v}" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"

echo "✅ Version $VERSION found in R2"

# Keep a temporary copy of the current latest/ so a failed switch can restore it.
BACKUP="bifrost/latest-backup-$(date +%s)-$$"
RESTORE_ON_FAIL=false
restore_latest() {
  local code=$?
  if [ "$RESTORE_ON_FAIL" = "true" ]; then
    trap - EXIT
    echo "↩️ Restoring previous latest/ from $BACKUP..."
    if ! aws s3 sync "s3://$R2_BUCKET/$BACKUP/" "s3://$R2_BUCKET/bifrost/latest/" \
      --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" \
      --profile "${R2_AWS_PROFILE:-R2}" --no-progress --delete; then
      echo "❌ Restore from $BACKUP failed" >&2
      exit 1
    fi
    if ! require_remote_prefix_digest "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" "$R2_BUCKET" "bifrost/latest" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"; then
      echo "❌ Restored latest/ failed digest verification" >&2
      exit 1
    fi
  fi
  exit "$code"
}
trap restore_latest EXIT
if ! sync_with_retry "s3://$R2_BUCKET/bifrost/latest/" "s3://$R2_BUCKET/$BACKUP/"; then
  echo "❌ Could not snapshot current latest/; refusing to overwrite it" >&2
  exit 1
fi
BACKUP_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$BACKUP/" \
  --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" --profile "${R2_AWS_PROFILE:-R2}")
if [ -z "$BACKUP_LISTING" ]; then
  echo "❌ Snapshot of latest/ is empty; refusing to overwrite it" >&2
  exit 1
fi
RESTORE_ON_FAIL=true
if ! sync_with_retry "s3://$R2_BUCKET/bifrost/$VERSION/" "s3://$R2_BUCKET/bifrost/latest/"; then
  exit 1
fi
require_remote_prefix_digest "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" "$R2_BUCKET" "bifrost/latest" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
RESTORE_ON_FAIL=false
trap - EXIT
aws s3 rm "s3://$R2_BUCKET/$BACKUP/" --recursive \
  --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" \
  --profile "${R2_AWS_PROFILE:-R2}" >/dev/null 2>&1 || true
echo "🎉 Successfully reverted latest to version $VERSION"
