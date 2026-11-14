#!/usr/bin/env bash

source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"
source "$(dirname "$0")/release-state.sh"
set -euo pipefail
source "$(dirname "$0")/semver.sh"

# Finalize bifrost-http release: changelog, tagging, GitHub release, R2 latest copy
# Usage: ./release-bifrost-http-finalize.sh <version>

# Validate input argument
if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

VERSION="${1#v}"
if ! is_semver "$VERSION"; then
  echo "❌ Invalid transport version: $1 (strict SemVer 2.0.0 without build metadata)" >&2
  exit 1
fi
if ! TRANSPORT_FILE_VERSION="$(read_semver_file transports/version)" || [ "$TRANSPORT_FILE_VERSION" != "$VERSION" ]; then
  echo "❌ transports/version must be '$VERSION' (read '${TRANSPORT_FILE_VERSION:-invalid}')" >&2
  exit 1
fi
TAG_NAME="transports/v${VERSION}"

echo "🏷️ Finalizing bifrost-http v$VERSION release..."

# Get core and framework versions from version files
CORE_VERSION="v$(read_semver_file core/version)"
FRAMEWORK_VERSION="v$(read_semver_file framework/version)"
if ! is_semver "${CORE_VERSION#v}"; then
  echo "❌ Invalid core/version: $CORE_VERSION" >&2
  exit 1
fi
if ! is_semver "${FRAMEWORK_VERSION#v}"; then
  echo "❌ Invalid framework/version: $FRAMEWORK_VERSION" >&2
  exit 1
fi

# Re-compute plugin versions from version files and transports/go.mod
declare -A PLUGIN_VERSIONS
PLUGINS_USED=()

for plugin_dir in plugins/*/; do
  if [ -d "$plugin_dir" ]; then
    [ -f "${plugin_dir}go.mod" ] || continue
    plugin_name=$(basename "$plugin_dir")
    if [ ! -f "${plugin_dir}version" ]; then
      # Validated against the structured go.mod view below.
      continue
    fi
    PLUGIN_VERSION="v$(read_semver_file "${plugin_dir}version")"
    if ! is_semver "${PLUGIN_VERSION#v}"; then
      echo "❌ Invalid version for plugin $plugin_name: $PLUGIN_VERSION" >&2
      exit 1
    fi
    PLUGIN_VERSIONS["$plugin_name"]="$PLUGIN_VERSION"
  fi
done

# Check which plugins are actually used by the transport. Parse go mod edit
# -json so replace blocks and comments cannot be mistaken for requirements.
GOMOD_JSON=$(cd transports && go mod edit -json)
while IFS=$'\t' read -r plugin_name plugin_version; do
  [ -n "$plugin_name" ] || continue
  local_path="github.com/maximhq/bifrost/plugins/$plugin_name"
  is_local_replace=false
  if jq -e --arg p "$local_path" '.Replace[]? | select(.Old.Path == $p) | select(.New.Path != null) | select(.New.Path | startswith("../"))' >/dev/null <<<"$GOMOD_JSON"; then
    is_local_replace=true
  fi
  if [ ! -f "plugins/$plugin_name/version" ]; then
    if [ "$is_local_replace" = "true" ]; then
      continue
    fi
    echo "❌ $plugin_name has no version file and no local replace in transports/go.mod" >&2
    exit 1
  fi
  if ! is_semver "${plugin_version#v}"; then
    echo "❌ Invalid version for transport plugin $plugin_name: $plugin_version" >&2
    exit 1
  fi
  if [[ -n "${PLUGIN_VERSIONS[$plugin_name]:-}" ]]; then
    if [ "v${PLUGIN_VERSIONS[$plugin_name]#v}" != "v${plugin_version#v}" ]; then
      echo "❌ $plugin_name version mismatch: version file ${PLUGIN_VERSIONS[$plugin_name]}, go.mod $plugin_version" >&2
      exit 1
    fi
    PLUGINS_USED+=("$plugin_name:${PLUGIN_VERSIONS[$plugin_name]}")
  else
    PLUGIN_VERSIONS["$plugin_name"]="$plugin_version"
    PLUGINS_USED+=("$plugin_name:$plugin_version")
  fi
done < <(jq -r '.Require[]? | select(.Path | startswith("github.com/maximhq/bifrost/plugins/")) | [(.Path | split("/") | last), .Version] | @tsv' <<<"$GOMOD_JSON")

CORE_REQUIRE=$(jq -r '.Require[]? | select(.Path == "github.com/maximhq/bifrost/core") | .Version' <<<"$GOMOD_JSON")
FRAMEWORK_REQUIRE=$(jq -r '.Require[]? | select(.Path == "github.com/maximhq/bifrost/framework") | .Version' <<<"$GOMOD_JSON")
if [ "v${CORE_REQUIRE#v}" != "v${CORE_VERSION#v}" ]; then
  echo "❌ transports/go.mod requires core $CORE_REQUIRE, but core/version is $CORE_VERSION" >&2
  exit 1
fi
if [ "v${FRAMEWORK_REQUIRE#v}" != "v${FRAMEWORK_VERSION#v}" ]; then
  echo "❌ transports/go.mod requires framework $FRAMEWORK_REQUIRE, but framework/version is $FRAMEWORK_VERSION" >&2
  exit 1
fi

echo "🔧 Versions:"
echo "   Core: $CORE_VERSION"
echo "   Framework: $FRAMEWORK_VERSION"
echo "   Plugins:"
for plugin_name in "${!PLUGIN_VERSIONS[@]}"; do
  echo "     - $plugin_name: ${PLUGIN_VERSIONS[$plugin_name]}"
done

# Capturing changelog
CHANGELOG_BODY=$(cat transports/changelog.md)
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
PREV_TAG=$(git tag -l "transports/v*" | sort -V | tail -1)
if [[ "$PREV_TAG" == "$TAG_NAME" ]]; then
  PREV_TAG=$(git tag -l "transports/v*" | sort -V | tail -2 | head -1)
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

# Authenticate and validate the release target before publishing anything. A tag
# pushed before this check would leave a release-less tag behind on failure.
if [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Error: GH_TOKEN or GITHUB_TOKEN is not set. Please export one to authenticate the GitHub CLI."
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "Error: GitHub CLI is not authenticated; refusing to push a release tag."
  exit 1
fi
REPO_SLUG="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
if ! ORIGIN_SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner); then
  echo "Error: cannot resolve the origin repository."
  exit 1
fi
if [ "$REPO_SLUG" != "$ORIGIN_SLUG" ]; then
  echo "Error: target repository $REPO_SLUG does not match origin $ORIGIN_SLUG."
  exit 1
fi
if ! gh api "repos/${REPO_SLUG}" >/dev/null 2>&1; then
  echo "Error: repository $REPO_SLUG is not accessible with the current token."
  exit 1
fi
RELEASE_ERR=$(mktemp)
trap 'rm -f "$RELEASE_ERR"' EXIT
# The tag is a single path segment. GitHub's API returns 404 for a slash left
# unencoded (transports/v1.2.3), which would look like an absent release.
RELEASE_TAG_PATH=${TAG_NAME//\//%2F}
RELEASE_EXISTS="false"
if gh api "repos/${REPO_SLUG}/releases/tags/${RELEASE_TAG_PATH}" >/dev/null 2>"$RELEASE_ERR"; then
  RELEASE_EXISTS="true"
elif ! grep -q 'HTTP 404' "$RELEASE_ERR"; then
  # Only a definitive 404 means the release is absent. Auth, network, permission,
  # and repository errors must not be treated as permission to publish a tag.
  echo "Error: could not determine whether GitHub release $TAG_NAME exists."
  cat "$RELEASE_ERR" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  TAG_COMMIT=$(git rev-list -n 1 "$TAG_NAME")
  if [ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]; then
    echo "Error: tag $TAG_NAME points at $TAG_COMMIT, not at HEAD."
    exit 1
  fi
elif [ "$RELEASE_EXISTS" = "true" ]; then
  echo "Error: GitHub release $TAG_NAME exists but its tag is missing."
  exit 1
fi


# Verify the complete released artifact set before publishing a tag or release.
# This must happen before any remote write so a missing platform does not leave a
# tag/release without artifacts.
if [ -z "${R2_ENDPOINT:-}" ]; then
  echo "Error: R2_ENDPOINT is required to verify released artifacts."
  exit 1
fi
validate_r2_bucket
R2_ENDPOINT="$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')"
ARTIFACT_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/v$VERSION/" --endpoint-url "$R2_ENDPOINT" --profile "${R2_AWS_PROFILE:-R2}")
if [ -z "$ARTIFACT_LISTING" ]; then
  echo "Error: versioned R2 prefix s3://$R2_BUCKET/bifrost/v$VERSION/ is empty; refusing to publish."
  exit 1
fi
require_platform_listing "$ARTIFACT_LISTING" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
require_remote_platform_digest "$R2_ENDPOINT" "$R2_BUCKET" bifrost "$VERSION" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
echo "✅ Complete five-platform artifact set found in R2"

if [ "$RELEASE_EXISTS" = "true" ]; then
  if release_is_draft "$TAG_NAME"; then
    echo "ℹ️ Draft release $TAG_NAME already exists; keeping it for Docker promotion."
  else
    draft_status=$?
    if [ "$draft_status" -ne 1 ]; then
      echo "❌ Could not determine draft state for $TAG_NAME" >&2
      exit 1
    fi
    echo "ℹ️ Published release $TAG_NAME already exists; no release to create."
  fi
fi
if [ "$RELEASE_EXISTS" = "false" ]; then
# Create the tag once, but tolerate a previous run that pushed it before the
# release was created. Reusing a tag is only safe when it points at this commit.
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  TAG_COMMIT=$(git rev-list -n 1 "$TAG_NAME")
  if [ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]; then
    echo "Error: tag $TAG_NAME already exists at $TAG_COMMIT, not at HEAD."
    exit 1
  fi
  echo "🏷️ Reusing existing tag $TAG_NAME at HEAD"
else
  echo "🏷️ Creating tag: $TAG_NAME"
  git tag "$TAG_NAME" -m "Release transports v$VERSION" -m "$CHANGELOG_BODY"
fi
git push origin "$TAG_NAME"

# Create GitHub release
TITLE="Bifrost HTTP v$VERSION"

# Mark prereleases when version contains a hyphen
PRERELEASE_FLAG=""
if [[ "$VERSION" == *-* ]]; then
  PRERELEASE_FLAG="--prerelease"
fi

# Generate plugin version summary
PLUGIN_UPDATES=""
if [ ${#PLUGINS_USED[@]} -gt 0 ]; then
  PLUGIN_UPDATES="

### 🔌 Plugin Versions
This release includes the following plugin versions:
"
  for plugin_info in "${PLUGINS_USED[@]}"; do
    plugin_name="${plugin_info%%:*}"
    plugin_version="${plugin_info##*:}"
    PLUGIN_UPDATES="$PLUGIN_UPDATES- **$plugin_name**: \`$plugin_version\`
"
  done
else
  # Show all available plugin versions even if not directly used
  PLUGIN_UPDATES="

### 🔌 Available Plugin Versions
The following plugin versions are compatible with this release:
"
  for plugin_name in "${!PLUGIN_VERSIONS[@]}"; do
    plugin_version="${PLUGIN_VERSIONS[$plugin_name]}"
    PLUGIN_UPDATES="$PLUGIN_UPDATES- **$plugin_name**: \`$plugin_version\`
"
  done
fi

BODY="## Bifrost HTTP Transport Release v$VERSION

$CHANGELOG_BODY
$PLUGIN_UPDATES

### Installation

#### Docker
\`\`\`bash
docker run -p 8080:8080 maximhq/bifrost:v$VERSION
\`\`\`

#### Binary Download
\`\`\`bash
npx @maximhq/bifrost --transport-version v$VERSION
\`\`\`

### Docker Images
- **\`maximhq/bifrost:v$VERSION\`** - This specific version
- **\`maximhq/bifrost:latest\`** - Latest version (updated with this release)

---
_This release was automatically created with dependencies: core \`$CORE_VERSION\`, framework \`$FRAMEWORK_VERSION\`. All plugins have been validated and updated._"

echo "🎉 Creating GitHub release for $TITLE..."
gh release create "$TAG_NAME" \
  --title "$TITLE" \
  --notes "$BODY" \
  --draft --latest=false \
  ${PRERELEASE_FLAG}

echo "✅ Bifrost HTTP released successfully"
else
  echo "ℹ️ GitHub release $TAG_NAME already exists; verifying R2 latest/ only."
fi

# Print summary
echo ""
echo "📋 Release Summary:"
echo "   🏷️  Tag: $TAG_NAME"
echo "   🔧 Core version: $CORE_VERSION"
echo "   🔧 Framework version: $FRAMEWORK_VERSION"
echo "   📦 Transport: Updated"
if [ ${#PLUGINS_USED[@]} -gt 0 ]; then
  echo "   🔌 Plugins used: ${PLUGINS_USED[*]}"
else
  echo "   🔌 Available plugins: $(printf "%s " "${!PLUGIN_VERSIONS[@]}")"
fi
echo "   🎉 GitHub release: Created"

echo "success=true" >> "$GITHUB_OUTPUT"
