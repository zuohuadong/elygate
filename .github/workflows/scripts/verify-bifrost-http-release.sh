#!/bin/bash

# Script to verify if bifrost-http was successfully released
# This ensures Docker images are only built after a successful bifrost-http release
# Exits with code 0 if release is verified or not needed, exits with code 78 to skip if release failed

set -e

VERSION=$1
RELEASE_NEEDED=$2

if [ -z "$VERSION" ]; then
    echo "❌ Error: Version not provided"
    exit 1
fi

TAG_NAME="transports/v${VERSION}"
echo "🔍 Verifying bifrost-http release v${VERSION}..."

# Check if the git tag exists
if ! git rev-parse "${TAG_NAME}" >/dev/null 2>&1; then
    echo "⚠️  Git tag ${TAG_NAME} not found"
    echo "   Bifrost-http release did not complete successfully"
    echo "   Skipping Docker image build..."
    exit 78  # Exit code 78 will be used to skip the job
fi

echo "✅ Git tag found: ${TAG_NAME}"

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

# Check if dist binaries exist for the version
echo "🔍 Checking if release binaries exist..."
BINARY_FOUND=false

# Check for common binary paths
for arch in "darwin/amd64" "darwin/arm64" "linux/amd64"; do
    BINARY_PATH="dist/${arch}/bifrost-http"
    if [ -f "$BINARY_PATH" ]; then
        echo "✅ Found binary: $BINARY_PATH"
        BINARY_FOUND=true
        break
    fi
done

if [ "$BINARY_FOUND" = false ]; then
    echo "⚠️  Warning: No release binaries found in dist/, but continuing..."
    echo "    This might be expected if binaries are uploaded to external storage"
fi

echo ""
echo "✅ Verification complete: bifrost-http v${VERSION} was successfully released"
echo "    Proceeding with Docker image build..."

