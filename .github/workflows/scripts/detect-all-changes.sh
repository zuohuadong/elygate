#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
source "$(dirname "$0")/release-state.sh"
source "$(dirname "$0")/r2-bucket.sh"
source "$(dirname "$0")/release-artifacts.sh"

# Detect what components need to be released based on version changes
# Usage: ./detect-all-changes.sh
echo "🔍 Auto-detecting version changes across all components..."

# Initialize outputs
CORE_NEEDS_RELEASE="false"
FRAMEWORK_NEEDS_RELEASE="false"
PLUGINS_NEED_RELEASE="false"
BIFROST_HTTP_NEEDS_RELEASE="false"
DOCKER_NEEDS_RELEASE="false"
CHANGED_PLUGINS="[]"

# Every version read here is echoed into GITHUB_OUTPUT and then interpolated with
# ${{ }} into `run:` blocks throughout the release pipeline. GitHub expands ${{ }}
# TEXTUALLY, before the shell parses the line, so quoting at the call site cannot
# contain a value carrying command substitution - "$(id)" still runs. Validating once
# here, where the value enters the pipeline, is what makes every downstream
# interpolation safe; there are dozens of them and guarding each is neither reliable
# nor reviewable.
validate_version() {
  local value="$1"
  local name="$2"
  # Anchored, and a regex rather than a glob: a `case` pattern like
  # [0-9]*.[0-9]*.[0-9]* looks structural but is not, because each `*` matches
  # anything - it accepted 1x.2.3, 1.2.3rc1 and 1.2.3.4. Three numeric components are
  # required, and a suffix is permitted only after PATCH and only when introduced by
  # `-` or `+`. The suffix quantifier is `+`, not `*`: a separator introducing nothing
  # (1.2.3- / 1.2.3+) is malformed per Semantic Versioning 2.0.0 clauses 9 and 10,
  # which both require that identifiers MUST NOT be empty - and it is the shape a
  # truncated version file takes, which is worth catching here rather than at tag time.
  if [[ ! "$value" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.+_-]+)?$ ]]; then
    echo "::error::refusing malformed $name version: '$value' (expected MAJOR.MINOR.PATCH, optionally v-prefixed, with an optional -suffix)" >&2
    return 1
  fi
  # A second, independent check on the character set. The regex above already implies
  # it, so this is belt-and-braces: it is what keeps a future loosening of the shape
  # pattern from silently re-admitting shell metacharacters. The set is deliberately wide
  # enough for the prerelease shapes this repo actually ships - v2.0.0-prerelease1,
  # and multi-hyphen forms like v1.5.0-prerelease3-ajhfix-base - because a guard that
  # false-rejects blocks a release, and every character admitted here is inert to a
  # shell.
  case "$value" in
    *[!v0-9.A-Za-z_+-]*)
      echo "::error::refusing $name version with unexpected characters: '$value'" >&2
      return 1
      ;;
  esac
}

# Plugin names travel the same way and by a sharper edge: they are collected into the
# changed-plugins JSON and interpolated as '${{ ... }}' inside single quotes at the
# release-all-plugins.sh call site. jq -R escapes double quotes and backslashes when
# building that JSON but leaves single quotes alone, so a name containing one closes
# the shell string. A plugin name is a directory name - it has no business containing
# anything but the characters below.
validate_plugin_name() {
  local value="$1"
  case "$value" in
    "")
      echo "::error::refusing empty plugin name" >&2
      return 1
      ;;
    *[!A-Za-z0-9._-]*)
      echo "::error::refusing plugin name with unexpected characters: '$value'" >&2
      return 1
      ;;
    *..*)
      echo "::error::refusing plugin name containing '..': '$value'" >&2
      return 1
      ;;
  esac
}

# Get current versions
CORE_VERSION=$(cat core/version)
FRAMEWORK_VERSION=$(cat framework/version)
TRANSPORT_VERSION=$(cat transports/version)

validate_version "$CORE_VERSION" "core"
validate_version "$FRAMEWORK_VERSION" "framework"
validate_version "$TRANSPORT_VERSION" "transport"

echo "📦 Current versions:"
echo "   Core: $CORE_VERSION"
echo "   Framework: $FRAMEWORK_VERSION"
echo "   Transport: $TRANSPORT_VERSION"

START_FROM="none"

# A tag is a valid released marker only when it exists and is in HEAD history. A
# same-name branch or a tag from an unrelated history must fail closed instead of
# suppressing a release.
tag_exists() {
  TAG_RELEASE_MISSING="false"
  local tag="$1" path="$2"
  git rev-parse --verify "refs/tags/$tag" >/dev/null 2>&1 || return 1
  local commit
  commit=$(git rev-list -n 1 "$tag")
  if ! git merge-base --is-ancestor "$commit" HEAD; then
    echo "❌ Tag $tag is not in HEAD history; refusing to treat it as released" >&2
    exit 1
  fi
  # A tag is only evidence for the current release when it points at HEAD, or
  # when the package content since the tag has not changed. Otherwise an old tag
  # would mask a needed release for a version that should have been bumped.
  if [ "$commit" != "$(git rev-parse HEAD)" ] && ! git diff --quiet "$tag" HEAD -- "$path"; then
    echo "❌ Tag $tag points at $commit but $path has changed since then; bump the version" >&2
    exit 1
  fi
  local status
  if release_check "$tag"; then
    return 0
  else
    status=$?
  fi
  if [ "$status" -ne 1 ]; then
    echo "❌ Could not determine release state for $tag" >&2
    exit 1
  fi
  if [ "$commit" = "$(git rev-parse HEAD)" ]; then
    TAG_RELEASE_MISSING="true"
    return 1
  fi
  echo "❌ Tag $tag exists but its GitHub release is missing and the tag is not at HEAD; manual recovery is required" >&2
  exit 1
}


# Check Core
echo ""
echo "🔧 Checking core..."
CORE_TAG="core/v${CORE_VERSION}"
if tag_exists "$CORE_TAG" core; then
  echo "   ⏭️ Tag $CORE_TAG already exists"
else
  if [ "$TAG_RELEASE_MISSING" = "true" ]; then
    CORE_NEEDS_RELEASE="true"
  fi
  # Extract major.minor track from version (e.g., "1.3.55" -> "1.3", "1.4.0-prerelease1" -> "1.4")
  CORE_BASE_VERSION=$(echo "$CORE_VERSION" | sed 's/-.*$//')
  CORE_MAJOR_MINOR=$(echo "$CORE_BASE_VERSION" | cut -d. -f1,2)
  echo "   🔍 Checking track: ${CORE_MAJOR_MINOR}.x"
  
  # Get previous version in the same track
  LATEST_CORE_TAG=$(git tag -l "core/v${CORE_MAJOR_MINOR}.*" | sort -V | tail -1)
  echo "🏷️ Latest core tag in track ${CORE_MAJOR_MINOR}.x: $LATEST_CORE_TAG"
  if [ -z "$LATEST_CORE_TAG" ]; then
    echo "   ✅ First core release in track ${CORE_MAJOR_MINOR}.x: $CORE_VERSION"
    CORE_NEEDS_RELEASE="true"
  else
    if [[ "$CORE_VERSION" == *"-"* ]]; then
      # current_version has prerelease, so include all versions but prefer stable
      ALL_TAGS=$(git tag -l "core/v${CORE_MAJOR_MINOR}.*" | sort -V)
      STABLE_TAGS=$(echo "$ALL_TAGS" | grep -v '\-' || true)
      PRERELEASE_TAGS=$(echo "$ALL_TAGS" | grep '\-' || true)
      if [ -n "$STABLE_TAGS" ]; then
        # Get the highest stable version
        LATEST_CORE_TAG=$(echo "$STABLE_TAGS" | tail -1)
        echo "latest core tag (stable preferred): $LATEST_CORE_TAG"
      else
        # No stable versions, get highest prerelease
        LATEST_CORE_TAG=$(echo "$PRERELEASE_TAGS" | tail -1)
        echo "latest core tag (prerelease only): $LATEST_CORE_TAG"
      fi
    else
      # VERSION has no prerelease, so only consider stable releases in same track
      LATEST_CORE_TAG=$(git tag -l "core/v${CORE_MAJOR_MINOR}.*" | grep -v '\-' | sort -V | tail -1 || true)
      echo "latest core tag (stable only): $LATEST_CORE_TAG"
    fi
    PREVIOUS_CORE_VERSION=${LATEST_CORE_TAG#core/v}
    echo "   📋 Previous: $PREVIOUS_CORE_VERSION, Current: $CORE_VERSION"
    # Fixed: Use head -1 instead of tail -1 for your sort -V behavior, and check against current version
    if [ "$(printf '%s\n' "$PREVIOUS_CORE_VERSION" "$CORE_VERSION" | sort -V | tail -1)" = "$CORE_VERSION" ] && [ "$PREVIOUS_CORE_VERSION" != "$CORE_VERSION" ]; then
      echo "   ✅ Core version incremented: $PREVIOUS_CORE_VERSION → $CORE_VERSION"
      CORE_NEEDS_RELEASE="true"
    else
      echo "   ⏭️ No core version increment"
    fi
  fi
fi

# Check Framework
echo ""
echo "📦 Checking framework..."
FRAMEWORK_TAG="framework/v${FRAMEWORK_VERSION}"
if tag_exists "$FRAMEWORK_TAG" framework; then
  echo "   ⏭️ Tag $FRAMEWORK_TAG already exists"
else
  if [ "$TAG_RELEASE_MISSING" = "true" ]; then
    FRAMEWORK_NEEDS_RELEASE="true"
  fi
  # Extract major.minor track from version (e.g., "1.3.55" -> "1.3", "1.4.0-prerelease1" -> "1.4")
  FRAMEWORK_BASE_VERSION=$(echo "$FRAMEWORK_VERSION" | sed 's/-.*$//')
  FRAMEWORK_MAJOR_MINOR=$(echo "$FRAMEWORK_BASE_VERSION" | cut -d. -f1,2)
  echo "   🔍 Checking track: ${FRAMEWORK_MAJOR_MINOR}.x"
  
  LATEST_FRAMEWORK_TAG=""
  if [[ "$FRAMEWORK_VERSION" == *"-"* ]]; then
    # current_version has prerelease, so include all versions but prefer stable
    ALL_TAGS=$(git tag -l "framework/v${FRAMEWORK_MAJOR_MINOR}.*" | sort -V)
    STABLE_TAGS=$(echo "$ALL_TAGS" | grep -v '\-' || true)
    PRERELEASE_TAGS=$(echo "$ALL_TAGS" | grep '\-' || true)
    if [ -n "$STABLE_TAGS" ]; then
      # Get the highest stable version
      LATEST_FRAMEWORK_TAG=$(echo "$STABLE_TAGS" | tail -1)
      echo "latest framework tag (stable preferred): $LATEST_FRAMEWORK_TAG"
    else
      # No stable versions, get highest prerelease
      LATEST_FRAMEWORK_TAG=$(echo "$PRERELEASE_TAGS" | tail -1)
      echo "latest framework tag (prerelease only): $LATEST_FRAMEWORK_TAG"
    fi
  else
    # VERSION has no prerelease, so only consider stable releases in same track
    LATEST_FRAMEWORK_TAG=$(git tag -l "framework/v${FRAMEWORK_MAJOR_MINOR}.*" | grep -v '\-' | sort -V | tail -1 || true)
    echo "latest framework tag (stable only): $LATEST_FRAMEWORK_TAG"
  fi
  if [ -z "$LATEST_FRAMEWORK_TAG" ]; then
    echo "   ✅ First framework release in track ${FRAMEWORK_MAJOR_MINOR}.x: $FRAMEWORK_VERSION"
    FRAMEWORK_NEEDS_RELEASE="true"
  else
    PREVIOUS_FRAMEWORK_VERSION=${LATEST_FRAMEWORK_TAG#framework/v}
    echo "   📋 Previous: $PREVIOUS_FRAMEWORK_VERSION, Current: $FRAMEWORK_VERSION"
    # Fixed: Use head -1 instead of tail -1 for your sort -V behavior, and check against current version
    if [ "$(printf '%s\n' "$PREVIOUS_FRAMEWORK_VERSION" "$FRAMEWORK_VERSION" | sort -V | tail -1)" = "$FRAMEWORK_VERSION" ] && [ "$PREVIOUS_FRAMEWORK_VERSION" != "$FRAMEWORK_VERSION" ]; then
      echo "   ✅ Framework version incremented: $PREVIOUS_FRAMEWORK_VERSION → $FRAMEWORK_VERSION"
      FRAMEWORK_NEEDS_RELEASE="true"
    else
      echo "   ⏭️ No framework version increment"
    fi
  fi
fi

# Check Plugins
echo ""
echo "🔌 Checking plugins..."
PLUGIN_CHANGES=()

for plugin_dir in plugins/*/; do
  if [ ! -d "$plugin_dir" ]; then
    continue
  fi

  plugin_name=$(basename "$plugin_dir")
  validate_plugin_name "$plugin_name"
  version_file="${plugin_dir}version"

  if [ ! -f "$version_file" ]; then
    echo "   ⚠️ No version file for: $plugin_name"
    continue
  fi

  current_version=$(cat "$version_file" | tr -d '\n\r')
  if [ -z "$current_version" ]; then
    echo "   ⚠️ Empty version file for: $plugin_name"
    continue
  fi
  # A missing or empty version file means "this plugin is not versioned" and is skipped
  # above. A version file that exists and holds something malformed is a different
  # thing - a repo error - so it stops the run rather than silently dropping the plugin
  # from the release, which would be far harder to notice.
  validate_version "$current_version" "plugin $plugin_name"

  tag_name="plugins/${plugin_name}/v${current_version}"
  echo "   📦 Plugin: $plugin_name (v$current_version)"

  if tag_exists "$tag_name" "plugins/${plugin_name}"; then
    echo "      ⏭️ Tag already exists"
    continue
  fi
  if [ "$TAG_RELEASE_MISSING" = "true" ]; then
    echo "      🏷️ Tag exists but its GitHub release is missing - plugin release needed"
    PLUGIN_CHANGES+=("$plugin_name")
    continue
  fi

  # Extract major.minor track from version (e.g., "1.3.55" -> "1.3", "1.4.0-prerelease1" -> "1.4")
  plugin_base_version=$(echo "$current_version" | sed 's/-.*$//')
  plugin_major_minor=$(echo "$plugin_base_version" | cut -d. -f1,2)
  echo "      🔍 Checking track: ${plugin_major_minor}.x"

  if [[ "$current_version" == *"-"* ]]; then
    # current_version has prerelease, so include all versions but prefer stable
    ALL_TAGS=$(git tag -l "plugins/${plugin_name}/v${plugin_major_minor}.*" | sort -V)
    STABLE_TAGS=$(echo "$ALL_TAGS" | grep -v '\-' || true)
    PRERELEASE_TAGS=$(echo "$ALL_TAGS" | grep '\-' || true)

    if [ -n "$STABLE_TAGS" ]; then
      # Get the highest stable version
      LATEST_PLUGIN_TAG=$(echo "$STABLE_TAGS" | tail -1)
      echo "latest plugin tag (stable preferred): $LATEST_PLUGIN_TAG"
    else
      # No stable versions, get highest prerelease
      LATEST_PLUGIN_TAG=$(echo "$PRERELEASE_TAGS" | tail -1)
      echo "latest plugin tag (prerelease only): $LATEST_PLUGIN_TAG"
    fi
  else
    # VERSION has no prerelease, so only consider stable releases in same track
    LATEST_PLUGIN_TAG=$(git tag -l "plugins/${plugin_name}/v${plugin_major_minor}.*" | grep -v '\-' | sort -V | tail -1 || true)
    echo "latest plugin tag (stable only): $LATEST_PLUGIN_TAG"
  fi

  latest_tag=$LATEST_PLUGIN_TAG
  if [ -z "$latest_tag" ]; then
    echo "      ✅ First release in track ${plugin_major_minor}.x"
    PLUGIN_CHANGES+=("$plugin_name")
  else
    previous_version=${latest_tag#plugins/${plugin_name}/v}
    echo "previous version: $previous_version"
    echo "current version: $current_version"
    echo "latest tag: $latest_tag"
    if [ "$(printf '%s\n' "$previous_version" "$current_version" | sort -V | tail -1)" = "$current_version" ] && [ "$previous_version" != "$current_version" ]; then
      echo "      ✅ Version incremented: $previous_version → $current_version"
      PLUGIN_CHANGES+=("$plugin_name")
    else
      echo "      ⏭️ No version increment"
    fi
  fi
done

if [ ${#PLUGIN_CHANGES[@]} -gt 0 ]; then
  PLUGINS_NEED_RELEASE="true"
  echo "   🔄 Plugins with changes: ${PLUGIN_CHANGES[*]}"
else
  echo "   ⏭️ No plugin changes detected"
fi

# Check Bifrost HTTP
echo ""
echo "🚀 Checking bifrost-http..."
TRANSPORT_TAG="transports/v${TRANSPORT_VERSION}"
DOCKER_TAG_EXISTS="false"

# Check if Git tag exists
GIT_TAG_EXISTS="false"
if tag_exists "$TRANSPORT_TAG" transports; then
  echo "   ⏭️ Git tag $TRANSPORT_TAG already exists"
  # An existing transport release is only usable when all five platform
  # binaries and checksums are actually present in R2.
  validate_r2_bucket
  R2_LISTING=$(aws s3 ls --recursive "s3://$R2_BUCKET/bifrost/v${TRANSPORT_VERSION}/" \
    --endpoint-url "$(printf '%s' "$R2_ENDPOINT" | tr -d '[:space:]')" \
    --profile "${R2_AWS_PROFILE:-R2}")
  if [ -z "$R2_LISTING" ]; then
    echo "❌ Transport release $TRANSPORT_TAG has no artifacts in R2" >&2
    exit 1
  fi
  require_platform_listing "$R2_LISTING" bifrost-http "${BIFROST_HTTP_PLATFORMS[@]}"
  GIT_TAG_EXISTS="true"
elif [ "$TAG_RELEASE_MISSING" = "true" ]; then
  echo "   🏷️ Git tag exists but its GitHub release is missing - transport release needed"
  BIFROST_HTTP_NEEDS_RELEASE="true"
fi

# A tag only counts as published when the manifest exists and contains both
# architectures. Checking every registry/edition lets a failed GHCR mirror or a
# missing UBI9 manifest trigger an idempotent Docker repair on rerun.
manifest_complete() {
  local image="$1" json
  json=$(docker manifest inspect "$image" 2>/dev/null) || return 1
  jq -e '((.manifests // []) | map(.platform.architecture) | (index("amd64") != null and index("arm64") != null))' <<<"$json" >/dev/null
}

echo "   🐳 Checking DockerHub for tag v${TRANSPORT_VERSION}..."
DOCKER_ERR=$(mktemp)
DOCKER_CODE=$(curl -sS -o "$DOCKER_ERR" -w '%{http_code}' "https://registry.hub.docker.com/v2/repositories/maximhq/bifrost/tags/v${TRANSPORT_VERSION}/" || echo 000)
if [ "$DOCKER_CODE" = "200" ] && grep -q '"name"' "$DOCKER_ERR"; then
  rm -f "$DOCKER_ERR"
  echo "   ⏭️ Docker tag v${TRANSPORT_VERSION} already exists on DockerHub"
  DOCKER_TAG_EXISTS="true"
elif [ "$DOCKER_CODE" = "404" ]; then
  rm -f "$DOCKER_ERR"
  echo "   ❌ Docker tag v${TRANSPORT_VERSION} not found on DockerHub"
  DOCKER_TAG_EXISTS="false"
else
  echo "   ❌ Could not determine Docker Hub state (HTTP $DOCKER_CODE)" >&2
  cat "$DOCKER_ERR" >&2
  rm -f "$DOCKER_ERR"
  exit 1
fi

if [ "$DOCKER_TAG_EXISTS" = "true" ]; then
  GHCR_REPO="$(printf '%s' "${GITHUB_REPOSITORY:-}" | tr '[:upper:]' '[:lower:]')"
  if [ -z "$GHCR_REPO" ]; then
    echo "❌ GITHUB_REPOSITORY is required to verify GHCR images" >&2
    exit 1
  fi
  for image in \
    "docker.io/maximhq/bifrost:v${TRANSPORT_VERSION}" \
    "ghcr.io/${GHCR_REPO}:v${TRANSPORT_VERSION}" \
    "docker.io/maximhq/bifrost:v${TRANSPORT_VERSION}-ubi9" \
    "ghcr.io/${GHCR_REPO}:v${TRANSPORT_VERSION}-ubi9"; do
    if ! manifest_complete "$image"; then
      echo "   ❌ Missing or incomplete manifest: $image"
      DOCKER_TAG_EXISTS="false"
    fi
  done
fi

# Determine if release is needed
if [ "$GIT_TAG_EXISTS" = "true" ] && [ "$DOCKER_TAG_EXISTS" = "true" ]; then
  echo "   ⏭️ Both Git tag and Docker image exist - no release needed"
else
  # Extract major.minor track from version (e.g., "1.3.55" -> "1.3", "1.4.0-prerelease1" -> "1.4")
  TRANSPORT_BASE_VERSION=$(echo "$TRANSPORT_VERSION" | sed 's/-.*$//')
  TRANSPORT_MAJOR_MINOR=$(echo "$TRANSPORT_BASE_VERSION" | cut -d. -f1,2)
  echo "   🔍 Checking track: ${TRANSPORT_MAJOR_MINOR}.x"
  
  # Get all transport tags in the same track, prioritize stable over prerelease for same base version
  ALL_TRANSPORT_TAGS=$(git tag -l "transports/v${TRANSPORT_MAJOR_MINOR}.*" | sort -V)
  
  # Function to get base version (remove prerelease suffix)
  get_base_version() {
    echo "$1" | sed 's/-.*$//'
  }
  
  # Find the latest version, prioritizing stable over prerelease
  LATEST_TRANSPORT_TAG=""
  LATEST_BASE_VERSION=""
  
  for tag in $ALL_TRANSPORT_TAGS; do
    version=${tag#transports/v}
    base_version=$(get_base_version "$version")
    
    # If this base version is newer, or same base version but current is stable and we had prerelease
    if [ -z "$LATEST_BASE_VERSION" ] || \
       [ "$(printf '%s\n' "$LATEST_BASE_VERSION" "$base_version" | sort -V | tail -1)" = "$base_version" ]; then
      
      if [ "$base_version" = "$LATEST_BASE_VERSION" ]; then
        # Same base version - prefer stable (no hyphen) over prerelease, otherwise take the later one
        if [[ "$version" != *"-"* ]]; then
          # Current is stable, always prefer it
          LATEST_TRANSPORT_TAG="$tag"
        elif [[ "${LATEST_TRANSPORT_TAG#transports/v}" == *"-"* ]]; then
          # Both are prereleases, take the later one (thanks to sort -V)
          LATEST_TRANSPORT_TAG="$tag"
        fi
      else
        # New base version is higher
        LATEST_TRANSPORT_TAG="$tag"
        LATEST_BASE_VERSION="$base_version"
      fi
    fi
  done
  
  if [ -n "$LATEST_TRANSPORT_TAG" ]; then
    echo "   🏷️ Latest transport tag: $LATEST_TRANSPORT_TAG"
  fi
  if [ -z "$LATEST_TRANSPORT_TAG" ]; then
    echo "   ✅ First transport release in track ${TRANSPORT_MAJOR_MINOR}.x: $TRANSPORT_VERSION"
    if [ "$GIT_TAG_EXISTS" = "false" ]; then
      echo "   🏷️  Git tag missing - transport release needed"
      BIFROST_HTTP_NEEDS_RELEASE="true"
    fi
  else
    PREVIOUS_TRANSPORT_VERSION=${LATEST_TRANSPORT_TAG#transports/v}
    echo "   📋 Previous: $PREVIOUS_TRANSPORT_VERSION, Current: $TRANSPORT_VERSION"
    
    # Function to compare versions with proper prerelease handling
    # Returns 0 if $1 < $2, 1 otherwise
    version_less_than() {
      local v1="$1"
      local v2="$2"
      
      # Extract base versions (remove prerelease suffix)
      local base1=$(echo "$v1" | sed 's/-.*$//')
      local base2=$(echo "$v2" | sed 's/-.*$//')
      
      # Compare base versions
      if [ "$base1" != "$base2" ]; then
        # Different base versions, use sort -V
        [ "$(printf '%s\n' "$base1" "$base2" | sort -V | head -1)" = "$base1" ]
        return $?
      fi
      
      # Same base version, check prereleases
      local pre1=$(echo "$v1" | grep -o '\-.*$' || echo "")
      local pre2=$(echo "$v2" | grep -o '\-.*$' || echo "")
      
      if [ -z "$pre1" ] && [ -n "$pre2" ]; then
        # v1 is stable, v2 is prerelease: v2 < v1
        return 1
      elif [ -n "$pre1" ] && [ -z "$pre2" ]; then
        # v1 is prerelease, v2 is stable: v1 < v2
        return 0
      elif [ -n "$pre1" ] && [ -n "$pre2" ]; then
        # Both prereleases, compare them
        [ "$(printf '%s\n' "$pre1" "$pre2" | sort -V | head -1)" = "$pre1" ]
        return $?
      else
        # Both stable and same base: equal
        return 1
      fi
    }
    
    # Check if current version is greater than previous
    if version_less_than "$PREVIOUS_TRANSPORT_VERSION" "$TRANSPORT_VERSION"; then
      echo "   ✅ Transport version incremented: $PREVIOUS_TRANSPORT_VERSION → $TRANSPORT_VERSION"
      if [ "$GIT_TAG_EXISTS" = "false" ]; then
        echo "   🏷️  Git tag missing - transport release needed"
        BIFROST_HTTP_NEEDS_RELEASE="true"
      fi
    else
      echo "   ⏭️ No transport version increment"
    fi
  fi
fi
  
# Check if Docker image needs to be built (independent of transport release)
if [ "$DOCKER_TAG_EXISTS" = "false" ]; then
  echo "   🐳 Docker image missing - docker release needed"
  DOCKER_NEEDS_RELEASE="true"
fi


# Convert plugin array to JSON (compact format)
if [ ${#PLUGIN_CHANGES[@]} -eq 0 ]; then
  CHANGED_PLUGINS_JSON="[]"
else
  CHANGED_PLUGINS_JSON=$(printf '%s\n' "${PLUGIN_CHANGES[@]}" | jq -R . | jq -s -c .)
fi

echo "CHANGED_PLUGINS_JSON: $CHANGED_PLUGINS_JSON"

# Summary
echo ""
echo "📋 Release Summary:"
echo "   Core: $CORE_NEEDS_RELEASE (v$CORE_VERSION)"
echo "   Framework: $FRAMEWORK_NEEDS_RELEASE (v$FRAMEWORK_VERSION)"
echo "   Plugins: $PLUGINS_NEED_RELEASE (${#PLUGIN_CHANGES[@]} plugins)"
echo "   Bifrost HTTP: $BIFROST_HTTP_NEEDS_RELEASE (v$TRANSPORT_VERSION)"
echo "   Docker: $DOCKER_NEEDS_RELEASE (v$TRANSPORT_VERSION)"

# Set outputs (only when running in GitHub Actions)
# Version strings are read straight out of the repo's version files and are then
# interpolated by callers into shell commands (the R2 upload steps, the changelog
# push, the docker manifest). A value carrying a quote, a space or a newline would
# break out of the generated command, and GITHUB_OUTPUT is line-oriented so a
# newline would additionally forge an extra output line. Nothing downstream can
# defend against that once it is written, so it is rejected here, at the single
# point where these values enter the workflow.
for _pair in "core:$CORE_VERSION" "framework:$FRAMEWORK_VERSION" "transport:$TRANSPORT_VERSION"; do
  _name="${_pair%%:*}"
  _value="${_pair#*:}"
  case "$_value" in
    "") continue ;;
    *[!0-9A-Za-z.+_-]*)
      echo "❌ refusing to emit $_name version with unexpected characters: $_value" >&2
      exit 1
      ;;
  esac
done

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "core-needs-release=$CORE_NEEDS_RELEASE"
    echo "framework-needs-release=$FRAMEWORK_NEEDS_RELEASE"
    echo "plugins-need-release=$PLUGINS_NEED_RELEASE"
    echo "bifrost-http-needs-release=$BIFROST_HTTP_NEEDS_RELEASE"
    echo "docker-needs-release=$DOCKER_NEEDS_RELEASE"
    echo "changed-plugins=$CHANGED_PLUGINS_JSON"
    echo "core-version=$CORE_VERSION"
    echo "framework-version=$FRAMEWORK_VERSION"
    echo "transport-version=$TRANSPORT_VERSION"
  } >> "$GITHUB_OUTPUT"
else
  echo "ℹ️ GITHUB_OUTPUT not set; skipping outputs write (local run)"
fi