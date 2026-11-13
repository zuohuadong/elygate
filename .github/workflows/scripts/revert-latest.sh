#!/usr/bin/env bash

source "$(dirname "$0")/r2-bucket.sh"
set -euo pipefail

# Overwrite latest with a specific version from R2
# Usage: ./revert-latest.sh <version>

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version> (e.g., v1.2.3)"
  exit 1
fi

VERSION="$1"
# Ensure version starts with 'v'
if [[ ! "$VERSION" =~ ^v ]]; then
  VERSION="v${VERSION}"
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
if ! grep -q 'bifrost-http' <<<"$SOURCE_LISTING" || ! grep -q '\.sha256' <<<"$SOURCE_LISTING"; then
  echo "❌ Version prefix s3://$R2_BUCKET/bifrost/$VERSION/ is missing binaries or checksums; refusing to overwrite latest/"
  exit 1
fi

echo "✅ Version $VERSION found in R2"

# Sync the specific version to latest
if ! sync_with_retry "s3://$R2_BUCKET/bifrost/$VERSION/" "s3://$R2_BUCKET/bifrost/latest/"; then
  exit 1
fi

echo "🎉 Successfully reverted latest to version $VERSION"
