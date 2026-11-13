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
