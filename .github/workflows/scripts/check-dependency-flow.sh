#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/semver.sh"

# Check the dependency flow and suggest next steps
# Usage: ./check-dependency-flow.sh <stage> [version]
#   stage: core|framework|plugins
#   version: required for core/framework; optional for plugins
usage() {
  echo "Usage: $0 <stage: core|framework|plugins> [version]" >&2
  echo "Examples:" >&2
  echo "  $0 core v1.2.3" >&2
  echo "  $0 framework v1.2.3" >&2
  echo "  $0 plugins" >&2
}
if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi
STAGE="${1:-}"
VERSION="${2:-}"
if [ -n "$VERSION" ] && ! is_semver "${VERSION#v}"; then
  echo "❌ Invalid version: $VERSION (strict SemVer 2.0.0 without build metadata)" >&2
  exit 1
fi
VERSION="${VERSION#v}"

# Validate stage first, then enforce version requirement by stage
case "$STAGE" in
  core|framework|plugins)
    ;;
  *)
    echo "❌ Unknown stage: $STAGE" >&2
    usage
    exit 1
    ;;
esac

# VERSION is required for core/framework; optional for plugins
if [[ "$STAGE" != "plugins" && -z "${VERSION:-}" ]]; then
  echo "❌ VERSION is required for stage '$STAGE'." >&2
  usage
  exit 2
fi

case "$STAGE" in
  "core")
    echo "🔧 Core v$VERSION released!"
    echo ""
    echo "📋 Dependency Flow Status:"
    echo "✅ Core: v$VERSION (just released)"
    echo "❓ Framework: Check if update needed"
    echo "❓ Plugins: Will check after framework"
    echo "❓ Bifrost HTTP: Will check after plugins"
    echo ""
    echo "🔄 Next Step: Manually trigger Framework Release if needed"
    ;;

  "framework")
    echo "📦 Framework v$VERSION released!"
    echo ""
    echo "📋 Dependency Flow Status:"
    echo "✅ Core: (already updated)"
    echo "✅ Framework: v$VERSION (just released)"
    echo "❓ Plugins: Check if any need updates"
    echo "❓ Bifrost HTTP: Will check after plugins"
    echo ""
    echo "🔄 Next Step: Check Plugins Release workflow"
    ;;

  "plugins")
    echo "🔌 Plugins ${VERSION:+v$VERSION }released!"
    echo ""
    echo "📋 Dependency Flow Status:"
    echo "✅ Core: (already updated)"
    echo "✅ Framework: (already updated)"
    echo "✅ Plugins: (just released)"
    echo "❓ Bifrost HTTP: Check if update needed"
    echo ""
    echo "🔄 Next Step: Manually trigger Bifrost HTTP Release if needed"
    ;;

  *)
    echo "❌ Unknown stage: $STAGE"
    exit 1
    ;;
esac
