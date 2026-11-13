#!/usr/bin/env bash
set -euo pipefail

# publish-cli-latest.sh <r2-prefix> <version> <binary>
# Publish the already-released, complete versioned prefix to latest/.

PREFIX="$1"
VERSION="$2"
BINARY="$3"

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

aws s3 sync "s3://$R2_BUCKET/$PREFIX/v${VERSION}/" "s3://$R2_BUCKET/$PREFIX/latest/" \
  --endpoint-url "$ENDPOINT" \
  --profile "${R2_AWS_PROFILE:-R2}" \
  --no-progress \
  --delete

LATEST_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$PREFIX/latest/" \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
require_platform_listing "$LATEST_LISTING" "$BINARY" "${CLI_PLATFORMS[@]}"
LATEST_VERSION=$(aws s3 cp "s3://$R2_BUCKET/$PREFIX/latest/version.txt" - \
  --endpoint-url "$ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
if [ "$LATEST_VERSION" != "$VERSION" ]; then
  echo "❌ latest/version.txt is '$LATEST_VERSION', expected '$VERSION'" >&2
  exit 1
fi
echo "✅ latest/ now matches v${VERSION}"
