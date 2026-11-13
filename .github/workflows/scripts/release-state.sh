#!/usr/bin/env bash
# Shared GitHub release-state helpers for release entrypoints.
set -euo pipefail

release_repo_slug() {
  echo "${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
}

# release_check <tag>
# 0 = GitHub release exists; 1 = definitive HTTP 404 (absent); 2 = unknown/error.
# The tag is one API path segment, so the slash is percent-encoded.
release_check() {
  local tag="$1" repo encoded err
  repo=$(release_repo_slug)
  encoded=${tag//\//%2F}
  err=$(mktemp)
  # A 404 for an inaccessible or misspelled repository must not be mistaken for
  # an absent release.
  if ! gh api "repos/${repo}" >/dev/null 2>"$err"; then
    echo "Could not access repository ${repo}:" >&2
    cat "$err" >&2
    rm -f "$err"
    return 2
  fi
  if gh api "repos/${repo}/releases/tags/${encoded}" >/dev/null 2>"$err"; then
    rm -f "$err"
    return 0
  fi
  if grep -q 'HTTP 404' "$err"; then
    rm -f "$err"
    return 1
  fi
  echo "Could not determine GitHub release state for ${tag}:" >&2
  cat "$err" >&2
  rm -f "$err"
  return 2
}

# release_is_draft <tag>
# 0 = the existing release is a draft; 1 = it is published or absent.
# Unknown API state returns 2 so callers fail closed.
release_is_draft() {
  local tag="$1" repo encoded value err
  repo=$(release_repo_slug)
  encoded=${tag//\//%2F}
  err=$(mktemp)
  if ! value=$(gh api "repos/${repo}/releases/tags/${encoded}" --jq '.draft' 2>"$err"); then
    rm -f "$err"
    return 2
  fi
  rm -f "$err"
  [[ "$value" == "true" ]]
}

# release_promote_draft <tag>: publish an existing draft release. Absence or a
# published release is a no-op; unknown state fails closed.
release_promote_draft() {
  local tag="$1"
  if release_is_draft "$tag"; then
    echo "🚀 Promoting draft GitHub release $tag..."
    gh release edit "$tag" --draft=false
  else
    local status=$?
    if [ "$status" -ne 1 ]; then
      echo "Could not determine draft state for $tag" >&2
      return 1
    fi
  fi
}
