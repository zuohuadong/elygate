#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/semver.sh"

# Release bifrost-migration-cli component
# Usage: ./release-bifrost-migration-cli.sh <version>

# Get the absolute path of the script directory
if command -v readlink >/dev/null 2>&1 && readlink -f "$0" >/dev/null 2>&1; then
  SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
fi
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
source "$SCRIPT_DIR/release-state.sh"
source "$SCRIPT_DIR/release-artifacts.sh"

# Validate input argument
if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

VERSION="${1#v}"
if ! is_semver "$VERSION"; then
  echo "❌ Invalid bifrost-migration-cli version: $1 (strict SemVer 2.0.0 without build metadata)" >&2
  exit 1
fi
TAG_NAME="bifrost-migration-cli/v${VERSION}"

echo "🚀 Releasing bifrost-migration-cli v$VERSION..."

# Validate bifrost-migration-cli build
echo "🔨 Validating bifrost-migration-cli build..."
COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}"
(cd "$REPO_ROOT/scripts/bifrost-migration-cli" && GOWORK=off go build -ldflags "-X main.version=v${VERSION} -X main.commit=${COMMIT}" ./...)
echo "✅ bifrost-migration-cli build validation successful"

# Build bifrost-migration-cli executables
echo "🔨 Building executables..."
bash "$SCRIPT_DIR/build-bifrost-migration-cli-executables.sh" "$VERSION"

# --- Preflight checks (no side effects) ---

# Capturing changelog
CHANGELOG_BODY=$(cat "$REPO_ROOT/scripts/bifrost-migration-cli/changelog.md")
# Skip comments from changelog
CHANGELOG_BODY=$(printf '%s\n' "$CHANGELOG_BODY" | sed '/<!--/,/-->/d')
# If changelog is empty, return error
if [ -z "$CHANGELOG_BODY" ]; then
  echo "❌ Changelog is empty"
  exit 1
fi
echo "📝 New changelog: $CHANGELOG_BODY"

# Finding previous tag
echo "🔍 Finding previous tag..."
TAG_COUNT=$(git tag -l "bifrost-migration-cli/v*" | wc -l | tr -d ' ')
if [[ "$TAG_COUNT" -eq 0 ]]; then
  PREV_TAG=""
else
  PREV_TAG=$(git tag -l "bifrost-migration-cli/v*" | sort -V | tail -1)
  if [[ "$PREV_TAG" == "$TAG_NAME" ]]; then
    PREV_TAG=$(git tag -l "bifrost-migration-cli/v*" | sort -V | tail -2 | head -1)
    [[ "$PREV_TAG" == "$TAG_NAME" ]] && PREV_TAG=""
  fi
fi
echo "🔍 Previous tag: $PREV_TAG"

# Get message of the tag and compare changelogs
if [[ -n "$PREV_TAG" ]]; then
  echo "🔍 Getting previous tag message..."
  PREV_CHANGELOG=$(git tag -l --format='%(contents:body)' "$PREV_TAG")
  echo "📝 Previous changelog body: $PREV_CHANGELOG"

  # Checking if tag message is the same as the changelog
  if [[ "$PREV_CHANGELOG" == "$CHANGELOG_BODY" ]]; then
    echo "❌ Changelog is the same as the previous changelog"
    exit 1
  fi
else
  echo "ℹ️ No previous bifrost-migration-cli tag found. Skipping changelog comparison."
fi

# Verify GitHub token before any publish steps
if [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Error: GH_TOKEN or GITHUB_TOKEN is not set. Please export one to authenticate the GitHub CLI."
  exit 1
fi

# Fail before any external write when the version tag belongs to another commit.
if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  if [ "$(git rev-list -n 1 "$TAG_NAME")" != "$(git rev-parse HEAD)" ]; then
    echo "❌ Tag $TAG_NAME already exists at a different commit"
    exit 1
  fi
fi

# Configure R2 before reading release state so an existing release is verified
# against its published artifacts, not just the GitHub API.
bash "$SCRIPT_DIR/configure-r2.sh"

verify_r2_artifacts() {
  local listing
  listing=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost-migration-cli/v${VERSION}/" \
    --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" \
    --profile "${R2_AWS_PROFILE:-R2}")
  if [ -z "$listing" ]; then
    echo "❌ No released artifacts at s3://$R2_BUCKET/bifrost-migration-cli/v${VERSION}/"
    return 1
  fi
  require_platform_listing "$listing" bifrost-migration-cli "${CLI_PLATFORMS[@]}"
  require_remote_platform_digest "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" "$R2_BUCKET" "bifrost-migration-cli" "$VERSION" bifrost-migration-cli "${CLI_PLATFORMS[@]}"
  local platform name local_sha remote_sha
  for platform in "${CLI_PLATFORMS[@]}"; do
    name="bifrost-migration-cli"
    [[ "$platform" == windows/* ]] && name+='.exe'
    local_sha=$(sha256_file "./dist/$platform/$name")
    remote_sha=$(aws s3 cp "s3://$R2_BUCKET/bifrost-migration-cli/v${VERSION}/$platform/$name" - \
      --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" \
      --profile "${R2_AWS_PROFILE:-R2}" | sha256_stdin)
    if [ "$local_sha" != "$remote_sha" ]; then
      echo "❌ Remote artifact digest mismatch for $platform/$name"
      return 1
    fi
  done
}

if release_check "$TAG_NAME"; then
  if ! git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null \
     || [ "$(git rev-list -n 1 "$TAG_NAME")" != "$(git rev-parse HEAD)" ]; then
    echo "❌ Release $TAG_NAME exists but its tag is missing or not at HEAD"
    exit 1
  fi
  if ! verify_r2_artifacts; then
    echo "🔁 Versioned R2 prefix is incomplete; repairing from this build"
    SKIP_LATEST_UPLOAD=true bash "$SCRIPT_DIR/upload-bifrost-migration-cli-to-r2.sh" "$TAG_NAME"
    verify_r2_artifacts
  fi
  release_promote_draft "$TAG_NAME"
  if [[ "$VERSION" != *-* ]]; then
    bash "$SCRIPT_DIR/publish-cli-latest.sh" "bifrost-migration-cli" "$VERSION" "bifrost-migration-cli"
  fi
  echo "ℹ️ Release $TAG_NAME and its R2 artifacts already exist. Nothing to do."
  exit 0
else
  status=$?
  if [ "$status" -ne 1 ]; then
    exit 1
  fi
fi

# --- Publish steps (all checks passed) ---

echo "📤 Uploading binaries..."
SKIP_LATEST_UPLOAD=true bash "$SCRIPT_DIR/upload-bifrost-migration-cli-to-r2.sh" "$TAG_NAME"
verify_r2_artifacts

# Create and push tag
if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  if [ "$(git rev-list -n 1 "$TAG_NAME")" != "$(git rev-parse HEAD)" ]; then
    echo "❌ Tag $TAG_NAME already exists at a different commit"
    exit 1
  fi
  echo "ℹ️ Tag $TAG_NAME already exists. Reusing it."
else
  echo "🏷️ Creating tag: $TAG_NAME"
  git tag "$TAG_NAME" -m "Release bifrost-migration-cli v$VERSION" -m "$CHANGELOG_BODY"
  git push origin "$TAG_NAME"
fi

# Create GitHub release
TITLE="Bifrost Migration CLI v$VERSION"

# Mark prereleases when version contains a hyphen
PRERELEASE_FLAG=""
if [[ "$VERSION" == *-* ]]; then
  PRERELEASE_FLAG="--prerelease"
fi

BODY="## Bifrost Migration CLI Release v$VERSION

$CHANGELOG_BODY

### Installation

#### Build from the release tag
\`\`\`bash
git clone --branch bifrost-migration-cli/v$VERSION https://github.com/maximhq/bifrost.git
cd bifrost/scripts/bifrost-migration-cli
go run .
\`\`\`

---
_This release was automatically created._"

echo "🎉 Creating GitHub release for $TITLE..."
gh release create "$TAG_NAME" \
  --title "$TITLE" \
  --notes "$BODY" \
  ${PRERELEASE_FLAG}


if [[ "$VERSION" != *-* ]]; then
  bash "$SCRIPT_DIR/publish-cli-latest.sh" "bifrost-migration-cli" "$VERSION" "bifrost-migration-cli"
fi
echo "✅ Bifrost Migration CLI released successfully"

# Print summary
echo ""
echo "📋 Release Summary:"
echo "   🏷️  Tag: $TAG_NAME"
echo "   🎉 GitHub release: Created"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "success=true" >> "$GITHUB_OUTPUT"
fi
