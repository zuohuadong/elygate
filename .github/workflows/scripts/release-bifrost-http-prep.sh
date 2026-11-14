#!/usr/bin/env bash
source "$(dirname "$0")/semver.sh"
set -euo pipefail

# Prepare bifrost-http release: update dependencies, build UI, validate, commit/push
# Usage: ./release-bifrost-http-prep.sh <version>

# Get the absolute path of the script directory
# Use readlink if available (Linux), otherwise use cd/pwd (macOS compatible)
if command -v readlink >/dev/null 2>&1 && readlink -f "$0" >/dev/null 2>&1; then
  SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
fi

# Source Go utilities for exponential backoff
source "$SCRIPT_DIR/go-utils.sh"
source "$SCRIPT_DIR/release-state.sh"

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

echo "🚀 Preparing bifrost-http v$VERSION release..."

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

echo "🔍 DEBUG: CORE_VERSION: $CORE_VERSION"
echo "🔍 DEBUG: FRAMEWORK_VERSION: $FRAMEWORK_VERSION"


# Get plugin versions from version files
echo "🔌 Getting plugin versions from version files..."
declare -A PLUGIN_VERSIONS

# Get versions for plugins that exist in the plugins/ directory
for plugin_dir in plugins/*/; do
  if [ -d "$plugin_dir" ]; then
    [ -f "${plugin_dir}go.mod" ] || continue
    plugin_name=$(basename "$plugin_dir")
    if [ ! -f "${plugin_dir}version" ]; then
      # Validated against the structured go.mod view below.
      echo "   📦 $plugin_name: no version file (checking local replace)"
      continue
    fi
    PLUGIN_VERSION="v$(read_semver_file "${plugin_dir}version")"
    if ! is_semver "${PLUGIN_VERSION#v}"; then
      echo "❌ Invalid version for plugin $plugin_name: $PLUGIN_VERSION" >&2
      exit 1
    fi
    PLUGIN_VERSIONS["$plugin_name"]="$PLUGIN_VERSION"
    echo "   📦 $plugin_name: $PLUGIN_VERSION (from version file)"
  fi
done

# Also inspect modules that are required by transport go.mod. Parse go mod edit
# -json so replace blocks and comments cannot be mistaken for a version.
cd transports
GOMOD_JSON=$(go mod edit -json)
echo "🔍 Checking for additional plugins in transport go.mod..."
while IFS=$'\t' read -r plugin_name current_version; do
  [ -n "$plugin_name" ] || continue
  local_path="github.com/maximhq/bifrost/plugins/$plugin_name"
  is_local_replace=false
  if jq -e --arg p "$local_path" '.Replace[]? | select(.Old.Path == $p) | select(.New.Path != null) | select(.New.Path | startswith("../"))' >/dev/null <<<"$GOMOD_JSON"; then
    is_local_replace=true
  fi
  if [ ! -f "../plugins/$plugin_name/version" ]; then
    if [ "$is_local_replace" = "true" ]; then
      echo "   📦 $plugin_name: local replace (no version file)"
      continue
    fi
    echo "❌ $plugin_name has no version file and no local replace in transports/go.mod" >&2
    exit 1
  fi
  if ! is_semver "${current_version#v}"; then
    echo "❌ Invalid version for transport plugin $plugin_name: $current_version" >&2
    exit 1
  fi
  if [[ -z "${PLUGIN_VERSIONS[$plugin_name]:-}" ]]; then
    echo "   📦 $plugin_name: $current_version (from transport go.mod)"
    PLUGIN_VERSIONS["$plugin_name"]="$current_version"
  fi
done < <(jq -r '.Require[]? | select(.Path | startswith("github.com/maximhq/bifrost/plugins/")) | [(.Path | split("/") | last), .Version] | @tsv' <<<"$GOMOD_JSON")
cd ..

echo "🔧 Using versions:"
echo "   Core: $CORE_VERSION"
echo "   Framework: $FRAMEWORK_VERSION"
echo "   Plugins:"
for plugin_name in "${!PLUGIN_VERSIONS[@]}"; do
  echo "     - $plugin_name: ${PLUGIN_VERSIONS[$plugin_name]}"
done

# --- Immutable input and preflight (no writes before this block completes) ---
if [ -n "${EXPECTED_COMMIT:-}" ] && [ "$(git rev-parse HEAD)" != "$EXPECTED_COMMIT" ]; then
  echo "❌ HEAD $(git rev-parse HEAD) does not match the input commit $EXPECTED_COMMIT"
  exit 1
fi

TAG_NAME="transports/v${VERSION}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  CURRENT_BRANCH="${GITHUB_REF_NAME:-main}"
fi

# Fetch tags/state only. Pulling would move HEAD past the commit exported by the
# previous release job and break the immutable release chain.
git fetch --tags

TAG_AT_HEAD="false"
if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  if [ "$(git rev-list -n 1 "$TAG_NAME")" != "$(git rev-parse HEAD)" ]; then
    echo "❌ Tag $TAG_NAME already exists at a different commit"
    exit 1
  fi
  TAG_AT_HEAD="true"
fi

# Capturing changelog
CHANGELOG_BODY=$(cat transports/changelog.md)
CHANGELOG_BODY=$(echo "$CHANGELOG_BODY" | grep -v '^<!--' | grep -v '^-->' || true)
if [ -z "$CHANGELOG_BODY" ]; then
  echo "❌ Changelog is empty"
  exit 1
fi
echo "📝 New changelog: $CHANGELOG_BODY"

echo "🔍 Finding previous tag..."
PREV_TAG=$(git tag -l "transports/v*" | sort -V | tail -1)
if [[ "$PREV_TAG" == "$TAG_NAME" ]]; then
  PREV_TAG=$(git tag -l "transports/v*" | sort -V | tail -2 | head -1)
fi
if [ -n "$PREV_TAG" ]; then
  PREV_CHANGELOG=$(git tag -l --format='%(contents:body)' "$PREV_TAG")
  if [[ "$PREV_CHANGELOG" == "$CHANGELOG_BODY" ]]; then
    echo "❌ Changelog is the same as the previous changelog"
    exit 1
  fi
fi

if release_check "$TAG_NAME"; then
  if release_is_draft "$TAG_NAME"; then
    if [ "$TAG_AT_HEAD" = "true" ]; then
      # Let the downstream build jobs rebuild/re-upload every platform, then
      # finalize promotes the existing draft. No R2 read is needed here.
      echo "ℹ️ Draft release $TAG_NAME exists at HEAD; rebuilding artifacts before promotion."
      echo "success=true" >> "$GITHUB_OUTPUT"
      echo "commit-sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    echo "❌ Draft release $TAG_NAME exists but its tag is not at HEAD"
    exit 1
  else
    draft_status=$?
    if [ "$draft_status" -ne 1 ]; then
      echo "❌ Could not determine draft state for $TAG_NAME" >&2
      exit 1
    fi
  fi
  if [ "$TAG_AT_HEAD" = "true" ]; then
    echo "ℹ️ Release $TAG_NAME already exists; rebuilding artifacts for an idempotent repair."
    echo "success=true" >> "$GITHUB_OUTPUT"
    echo "commit-sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "❌ Release $TAG_NAME exists but its tag is missing"
  exit 1
else
  status=$?
  if [ "$status" -ne 1 ]; then
    exit 1
  fi
fi

# Update transport dependencies to use plugin versions from version files
echo "🔧 Using plugin versions from version files for transport..."

# Track which plugins are actually used by the transport
cd transports

# Normalize the local go.mod directive up front so prior-release artifacts
# (e.g. `go 1.27.3` written by earlier `go get` runs) don't trip GOTOOLCHAIN=local.
go mod edit -go=1.27.3 -toolchain=none

for plugin_name in "${!PLUGIN_VERSIONS[@]}"; do
  plugin_version="${PLUGIN_VERSIONS[$plugin_name]}"

  # Check if transport depends on this plugin in the structured require set.
  if jq -e --arg p "github.com/maximhq/bifrost/plugins/$plugin_name" '.Require[]? | select(.Path == $p)' >/dev/null <<<"$GOMOD_JSON"; then
    echo "  📦 Using $plugin_name plugin $plugin_version"
    # Textual require bump — skips loading the currently-declared version's go.mod
    go mod edit -require="github.com/maximhq/bifrost/plugins/$plugin_name@$plugin_version"
  fi
done

# Also ensure core and framework are up to date

echo "  🔧 Updating core to $CORE_VERSION"
go mod edit -require="github.com/maximhq/bifrost/core@$CORE_VERSION"

echo "  📦 Updating framework to $FRAMEWORK_VERSION"
go mod edit -require="github.com/maximhq/bifrost/framework@$FRAMEWORK_VERSION"

# Re-normalize before tidy in case any edit reintroduced a toolchain line
go mod edit -go=1.27.3 -toolchain=none
go mod tidy

cd ..

# We need to build UI first before we can validate the transport build
echo "🎨 Building UI..."
make build-ui

# Building hello-world plugin
echo "🔨 Building hello-world plugin..."
cd examples/plugins/hello-world
make build
cd ../../..

# Validate transport build
echo "🔨 Validating transport build..."
cd transports
go build ./...
cd ..
echo "✅ Transport build validation successful"

# Note: Migration tests run as a separate CI job (test-migrations) before this release job

# Stage any changes made to transports/
git add transports/

# Check if there are staged changes after pulling
if [ "$TAG_AT_HEAD" = "true" ]; then
  echo "ℹ️ Reusing tag $TAG_NAME at HEAD; skipping dependency commit"
elif ! git diff --cached --quiet; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  echo "🔧 Committing and pushing changes..."
  git commit -m "transports: update dependencies --skip-ci"
  git push origin HEAD:"$CURRENT_BRANCH"
else
  echo "ℹ️ No staged changes to commit"
fi

if [ "$TAG_AT_HEAD" = "true" ] && ! git diff --cached --quiet; then
  echo "❌ Dependency changes are staged but tag $TAG_NAME points at the old commit; refusing to publish" >&2
  exit 1
fi

echo "✅ Prep complete for bifrost-http v$VERSION"
echo "success=true" >> "$GITHUB_OUTPUT"
echo "commit-sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
