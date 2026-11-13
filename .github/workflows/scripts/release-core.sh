#!/usr/bin/env bash
source "$(dirname "$0")/semver.sh"
set -euo pipefail

source "$(dirname "$0")/release-state.sh"

# Release core component
# Usage: ./release-core.sh <version>

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.2.0"
  exit 1
fi
VERSION="${1#v}"
if ! is_semver "$VERSION"; then
  echo "❌ Invalid core version: $1 (strict SemVer 2.0.0 without build metadata)" >&2
  exit 1
fi

TAG_NAME="core/v${VERSION}"

echo "🔧 Releasing core v$VERSION..."

# Validate core build
echo "🔨 Validating core build..."
cd core

if [[ ! -f version ]]; then
  echo "❌ Missing core/version file"
  exit 1
fi
FILE_VERSION="$(read_semver_file version)"
if [[ "$FILE_VERSION" != "$VERSION" ]]; then
  echo "❌ Version mismatch: arg=$VERSION, core/version=$FILE_VERSION"
  exit 1
fi

# Compile the module before any tag/release write. The workflow can skip the
# test matrix, so this is the last deterministic build gate on the release path.
echo "🔨 Compiling core module..."
go build ./...

cd ..

# Capturing changelog
CHANGELOG_BODY=$(cat core/changelog.md)
# Skip comments from changelog
CHANGELOG_BODY=$(echo "$CHANGELOG_BODY" | grep -v '^<!--' | grep -v '^-->')
# If changelog is empty, return error
if [ -z "$CHANGELOG_BODY" ]; then
  echo "❌ Changelog is empty"
  exit 1
fi
echo "📝 New changelog: $CHANGELOG_BODY"

# Finding previous tag
echo "🔍 Finding previous tag..."
PREV_TAG=$(git tag -l "core/v*" | sort -V | tail -1)
if [[ "$PREV_TAG" == "$TAG_NAME" ]]; then
  PREV_TAG=$(git tag -l "core/v*" | sort -V | tail -2 | head -1)
fi
echo "🔍 Previous tag: $PREV_TAG"

# Get message of the tag
echo "🔍 Getting previous tag message..."
PREV_CHANGELOG=$(git tag -l --format='%(contents:body)' "$PREV_TAG")
echo "📝 Previous changelog body: $PREV_CHANGELOG"

# Checking if tag message is the same as the changelog
if [[ "$PREV_CHANGELOG" == "$CHANGELOG_BODY" ]]; then
  echo "❌ Changelog is the same as the previous changelog"
  exit 1
fi

# Validate tag binding first, then the release state, before any write.
TAG_AT_HEAD="false"
if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  if [ "$(git rev-list -n 1 "$TAG_NAME")" != "$(git rev-parse HEAD)" ]; then
    echo "❌ Tag $TAG_NAME already exists at a different commit"
    exit 1
  fi
  TAG_AT_HEAD="true"
fi
if release_check "$TAG_NAME"; then
  if [ "$TAG_AT_HEAD" = "true" ]; then
    if release_is_draft "$TAG_NAME"; then
      echo "ℹ️ Draft release $TAG_NAME exists; running release checks before promotion."
      RELEASE_IS_DRAFT="true"
    else
      draft_status=$?
      if [ "$draft_status" -ne 1 ]; then
        echo "❌ Could not determine draft state for $TAG_NAME" >&2
        exit 1
      fi
      echo "ℹ️ Release $TAG_NAME already exists. Nothing to do."
      exit 0
    fi
  fi
  echo "❌ Release $TAG_NAME exists but its tag is missing"
  exit 1
else
  status=$?
  if [ "$status" -ne 1 ]; then
    exit 1
  fi
fi
if [ "$TAG_AT_HEAD" = "true" ]; then
  echo "ℹ️ Reusing existing tag $TAG_NAME at HEAD"
else
  echo "🏷️ Creating tag: $TAG_NAME"
  git tag "$TAG_NAME" -m "Release core v$VERSION" -m "$CHANGELOG_BODY"
fi
git push origin "$TAG_NAME"

# Create GitHub release
TITLE="Core v$VERSION"

# Mark prereleases when version contains a hyphen
PRERELEASE_FLAG=""
if [[ "$VERSION" == *-* ]]; then
  PRERELEASE_FLAG="--prerelease"
fi

LATEST_FLAG=""
if [[ "$VERSION" != *-* ]]; then
  LATEST_FLAG="--latest"
fi

BODY="## Core Release v$VERSION

$CHANGELOG_BODY

### Installation

\`\`\`bash
go get github.com/maximhq/bifrost/core@v$VERSION
\`\`\`

---
_This release was automatically created from version file: \`core/version\`_"

echo "🎉 Creating GitHub release for $TITLE..."
if [ "${RELEASE_IS_DRAFT:-false}" = "true" ]; then
  release_promote_draft "$TAG_NAME"
else
gh release create "$TAG_NAME" \
  --title "$TITLE" \
  --notes "$BODY" \
  ${PRERELEASE_FLAG} ${LATEST_FLAG}

echo "✅ Core released successfully"
echo "success=true" >> "$GITHUB_OUTPUT"
fi
