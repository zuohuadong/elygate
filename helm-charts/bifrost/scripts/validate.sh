#!/bin/bash
# Bifrost Helm Chart Validation Script
# This script validates the Helm chart before installation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

print_success() {
    echo -e "${GREEN}✓ ${NC}$1"
}

print_error() {
    echo -e "${RED}✗ ${NC}$1"
}

print_banner() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                           ║${NC}"
    echo -e "${BLUE}║      Bifrost Chart Validator             ║${NC}"
    echo -e "${BLUE}║                                           ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
    echo ""
}

# Set explicit chart directory (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="$SCRIPT_DIR/.."
# Examples and the chart itself require an explicit tag; validation uses a
# neutral default so both the default values and every example render offline.
IMAGE_TAG="${IMAGE_TAG:-v2.5.1}"

print_banner

if [ "$IMAGE_TAG" = "latest" ]; then
    print_error "IMAGE_TAG must pin a concrete version, not latest"
    exit 1
fi

# Examples must pin an immutable image tag: "latest" makes an example
# non-reproducible and can silently change which image a user deploys.
for config in "$CHART_DIR"/values-examples/*.yaml; do
    tag=$(awk '/^image:/{in_image=1; next} in_image && /^[^[:space:]]/{in_image=0} in_image && /^[[:space:]]+tag:/{gsub(/[" ]/, "", $2); print $2; exit}' "$config")
    if [ -z "$tag" ] || [ "$tag" = "latest" ]; then
        print_error "  $(basename "$config"): image.tag must pin a concrete version"
        exit 1
    fi
done

DOCS_DIR="$CHART_DIR/../../docs"
if [ -d "$DOCS_DIR" ]; then
    if grep -rq 'bifrost:latest' "$DOCS_DIR"; then
        print_error "Deployment docs must not reference bifrost:latest"
        exit 1
    fi
fi

# Check if Helm is installed
print_info "Checking Helm installation..."
if ! command -v helm &> /dev/null; then
    print_error "Helm is not installed"
    exit 1
fi
print_success "Helm is installed"

# Lint the chart
print_info "Linting Helm chart..."
if helm lint "$CHART_DIR" --set image.tag="$IMAGE_TAG"; then
    print_success "Chart linting passed"
else
    print_error "Chart linting failed"
    exit 1
fi

# Template the chart with default values
print_info "Templating chart with default values..."
if helm template test-release "$CHART_DIR" --set image.tag="$IMAGE_TAG" > /dev/null; then
    print_success "Default values template successful"
else
    print_error "Default values template failed"
    exit 1
fi

# Test all example configurations
print_info "Testing example configurations..."
for config in "$CHART_DIR"/values-examples/*.yaml; do
    config_name=$(basename "$config")
    print_info "  Testing $config_name..."
    if helm template test-release "$CHART_DIR" -f "$config" --set image.tag="$IMAGE_TAG" > /dev/null; then
        print_success "  $config_name: OK"
    else
        print_error "  $config_name: FAILED"
        exit 1
    fi
done

# Dry run install
print_info "Performing dry-run installation..."
if helm install test-release "$CHART_DIR" --set image.tag="$IMAGE_TAG" --dry-run --debug > /dev/null 2>&1; then
    print_success "Dry-run installation successful"
else
    print_error "Dry-run installation failed"
    exit 1
fi

echo ""
print_success "All validation checks passed!"
echo ""
print_info "Chart is ready for installation"

