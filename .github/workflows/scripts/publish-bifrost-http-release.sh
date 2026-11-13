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

if [[ "$VERSION" != *-* ]]; then
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
echo "✅ Published $TAG_NAME after Docker/GHCR/UBI9 gates"
