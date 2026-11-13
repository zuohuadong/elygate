#!/bin/bash

# Script to verify if bifrost-http was successfully released
# This ensures Docker images are only built after a successful bifrost-http release
# Exits with code 0 if release is verified or not needed, exits with code 78 to skip if release failed

set -e

source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"

VERSION=$1
RELEASE_NEEDED=${2:-}

if [ -z "$VERSION" ]; then
    echo "❌ Error: Version not provided"
    exit 1
fi

TAG_NAME="transports/v${VERSION}"
# Even when no new transport release is needed, Docker builds must be based on
# the exact tag commit and its complete published artifact set.
echo "🔍 Verifying bifrost-http release v${VERSION}..."

# Check if the git tag exists
if ! git rev-parse --verify "refs/tags/${TAG_NAME}" >/dev/null 2>&1; then
    echo "⚠️  Git tag ${TAG_NAME} not found"
    echo "   Bifrost-http release did not complete successfully"
    echo "   Skipping Docker image build..."
    exit 78  # Exit code 78 will be used to skip the job
fi

TAG_COMMIT=$(git rev-list -n 1 "${TAG_NAME}")
if [ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]; then
    echo "❌ Git tag ${TAG_NAME} points at ${TAG_COMMIT}, not at the build commit $(git rev-parse HEAD)"
    exit 78
fi
echo "✅ Git tag found at the build commit: ${TAG_NAME}"

# Check if the GitHub release exists
if [ -z "$GH_TOKEN" ]; then
    echo "❌ Error: GH_TOKEN not set; cannot verify the GitHub release"
    echo "   Refusing to build images without a verified release"
    exit 78
fi
echo "🔍 Checking GitHub release..."
REPO_SLUG="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
if ! gh api "repos/${REPO_SLUG}" >/dev/null 2>&1; then
    echo "❌ Error: repository ${REPO_SLUG} is not accessible with GH_TOKEN"
    exit 78
fi
# The tag is one API path segment; an unencoded slash returns 404 even when the
# release exists.
RELEASE_TAG_PATH=${TAG_NAME//\//%2F}
if gh api "repos/${REPO_SLUG}/releases/tags/${RELEASE_TAG_PATH}" >/dev/null 2>&1; then
    echo "✅ GitHub release found for ${TAG_NAME}"
else
    echo "⚠️  GitHub release for ${TAG_NAME} not found or not readable"
    echo "   Bifrost-http release did not complete successfully"
    exit 78
fi

# Verify the published artifact set on R2. The upload jobs run on separate
# runners, so the local dist/ is intentionally absent here; the versioned R2
# prefix is the authoritative released artifact.
: "${R2_ENDPOINT:?R2_ENDPOINT env var is required to verify released artifacts}"
validate_r2_bucket
echo "🔍 Checking released artifacts in R2..."
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID env var is required to verify released artifacts}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY env var is required to verify released artifacts}"
export AWS_DEFAULT_REGION=us-east-1
R2_NO_PROFILE=1
if ! ARTIFACT_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/v${VERSION}/" \
      --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" 2>&1); then
    echo "❌ Could not list s3://$R2_BUCKET/bifrost/v${VERSION}/"
    echo "$ARTIFACT_LISTING"
    exit 78
fi
if [ -z "$ARTIFACT_LISTING" ]; then
    echo "❌ No released artifacts at s3://$R2_BUCKET/bifrost/v${VERSION}/"
    exit 78
fi
require_platform_listing "$ARTIFACT_LISTING" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
require_remote_platform_digest "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" "$R2_BUCKET" bifrost "$VERSION" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
echo "✅ Released artifacts found in R2"

echo ""
echo "✅ Verification complete: bifrost-http v${VERSION} was successfully released"
echo "    Proceeding with Docker image build..."

