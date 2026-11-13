#!/usr/bin/env bash
# Sourced by read-version-file.sh and extract-npx-version.sh.
#
# is_semver <value>: succeeds only for a Semantic Versioning 2.0.0 string
# (https://semver.org, the BNF at the end). Numeric identifiers carry no leading
# zero and no identifier is empty, so `01.2.3` and `1.0.0-..` fail. Build
# metadata is rejected: it is legal SemVer, but Docker tags, R2 prefixes and
# release tags cannot carry `+`, so accepting it would create a version that
# some artifacts can represent and others cannot.
is_semver() {
  local num='(0|[1-9][0-9]*)'
  local pre='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
  [[ "$1" =~ ^${num}\.${num}\.${num}(-${pre}(\.${pre})*)?$ ]]
}

# read_semver_file <path>: prints a bare SemVer read from a version file.
# Removes exactly one trailing line ending; any other whitespace (an internal
# newline, a split version, tabs) makes the value invalid instead of joining it
# into a version the file never held. A leading 'v' is normalised away.
read_semver_stdin() {
  local value
  # Command substitution strips every trailing newline, which would hide input
  # ending in a blank line. Append a sentinel and remove it instead.
  value="$(cat; printf x)"
  value="${value%x}"
  if [[ "$value" == *$'\n' ]]; then
    value="${value%$'\n'}"
    value="${value%$'\r'}"
  fi
  [[ ! "$value" =~ [[:space:]] ]] || return 1
  value="${value#v}"
  is_semver "$value" || return 1
  printf '%s\n' "$value"
}

read_semver_file() {
  [[ -f "$1" ]] || return 1
  read_semver_stdin < "$1"
}
