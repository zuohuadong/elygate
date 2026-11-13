#!/usr/bin/env bash

source "$(dirname "$0")/semver.sh"
source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"
set -euo pipefail

# Upload CLI builds to R2 with retry logic
# Usage: ./upload-cli-to-r2.sh <cli-version>

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <cli-version> (e.g., cli/v1.0.0)"
  exit 1
fi
CLI_TAG="$1"
VERSION_PART="${CLI_TAG#cli/v}"
if [[ "$CLI_TAG" != cli/v* ]] || ! is_semver "$VERSION_PART"; then
  echo "❌ Invalid tag format: $CLI_TAG"
  echo "   Expected format: cli/vX.Y.Z or cli/vX.Y.Z-prerelease (e.g., cli/v1.0.0, cli/v1.0.0-rc.1)"
  echo "   Build metadata (+...) is not supported: Docker and R2 tags cannot carry '+'."
  exit 1
fi
if [[ ! -d "./dist" ]]; then
  echo "❌ ./dist not found. Build artifacts must be present before upload."
  exit 1
fi
: "${R2_ENDPOINT:?R2_ENDPOINT env var is required}"
validate_r2_bucket

# Every release platform must be present with a matching checksum.
require_platform_dist ./dist bifrost "${CLI_PLATFORMS[@]}"

# Strip 'cli/' prefix from version
VERSION_ONLY=${CLI_TAG#cli/v}
CLI_VERSION="v${VERSION_ONLY}"
printf '%s' "$CLI_VERSION" > "./dist/version.txt"
R2_ENDPOINT="$(echo "$R2_ENDPOINT" | tr -d '[:space:]')"

echo "📤 Uploading CLI binaries for version: $CLI_VERSION"

# Function to upload with retry
upload_with_retry() {
  local source_path="$1"
  local dest_path="$2"
  local max_retries=3

  for attempt in $(seq 1 $max_retries); do
    echo "🔄 Attempt $attempt/$max_retries: Uploading to $dest_path"

    if aws s3 sync "$source_path" "$dest_path" \
       --endpoint-url "$R2_ENDPOINT" \
       --profile "${R2_AWS_PROFILE:-R2}" \
       --no-progress \
       --delete; then
      echo "✅ Upload successful to $dest_path"
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

  echo "❌ All $max_retries attempts failed for $dest_path"
  return 1
}

# Upload to versioned path
if ! upload_with_retry "./dist/" "s3://$R2_BUCKET/bifrost-cli/$CLI_VERSION/"; then
  exit 1
fi

if [[ "${SKIP_LATEST_UPLOAD:-false}" == "true" ]]; then
  echo "⏭️ Skipping latest/ upload; it is published after the GitHub release exists"
  exit 0
fi

# Check if this is a prerelease version (semver: presence of a hyphen denotes pre-release)
if [[ "$CLI_VERSION" == *-* ]]; then
  echo "🔍 Detected prerelease version: $CLI_VERSION"
  echo "⏭️ Skipping upload to latest/ for prerelease"
else
  echo "🔍 Detected stable release: $CLI_VERSION"

  # Small delay between uploads (configurable; default 2s)
  sleep "${INTER_UPLOAD_SLEEP_SECONDS:-2}"

  # Upload to latest path
  echo "📤 Uploading to latest/"
  if ! upload_with_retry "./dist/" "s3://$R2_BUCKET/bifrost-cli/latest/"; then
    exit 1
  fi
fi

echo "🎉 All CLI binaries uploaded successfully to R2"
