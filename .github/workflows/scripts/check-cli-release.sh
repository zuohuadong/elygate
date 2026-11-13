#!/usr/bin/env bash
set -euo pipefail

# check-cli-release.sh <tag> <binary> <r2-prefix> <version>
# Prints exists=true when the tag, GitHub release and complete R2 artifact set
# all match HEAD; exits non-zero for any inconsistent or unverifiable state.

TAG="$1"
BINARY="$2"
PREFIX="$3"
VERSION="$4"

source "$(dirname "$0")/release-state.sh"
source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"

HEAD_SHA="$(git rev-parse HEAD)"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  TAG_COMMIT="$(git rev-list -n 1 "$TAG")"
  if [ "$TAG_COMMIT" != "$HEAD_SHA" ]; then
    echo "Tag $TAG points at $TAG_COMMIT, not at build commit $HEAD_SHA" >&2
    exit 1
  fi
  if release_check "$TAG"; then
    validate_r2_bucket
    LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/$PREFIX/v${VERSION}/" \
      --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" \
      --profile "${R2_AWS_PROFILE:-R2}")
    require_platform_listing "$LISTING" "$BINARY" "${CLI_PLATFORMS[@]}"
    echo "exists=true" >> "$GITHUB_OUTPUT"
    exit 0
  else
    status=$?
  fi
  if [ "$status" -ne 1 ]; then
    echo "Could not determine release state for $TAG" >&2
    exit 1
  fi
  echo "exists=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

if release_check "$TAG"; then
  echo "Release $TAG exists but its tag is missing; refusing to publish" >&2
  exit 1
else
  status=$?
fi
if [ "$status" -ne 1 ]; then
  echo "Could not determine release state for $TAG" >&2
  exit 1
fi
echo "exists=false" >> "$GITHUB_OUTPUT"
