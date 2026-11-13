#!/usr/bin/env bash
# Shared R2 bucket validation. Source this file, then call validate_r2_bucket.

validate_r2_bucket() {
  local bucket="${R2_BUCKET:-}"
  bucket="$(printf '%s' "$bucket" | tr -d '[:space:]')"
  if [ -z "$bucket" ]; then
    echo "❌ R2_BUCKET env var is required" >&2
    exit 1
  fi
  # S3/R2 bucket names are DNS labels: 3-63 chars, lowercase alphanumerics,
  # dots and hyphens. A slash or space would silently become a key prefix.
  if ! [[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] \
     || [[ "$bucket" == *..* ]] || [[ "$bucket" == *.-* ]] || [[ "$bucket" == *-.* ]]; then
    echo "❌ Invalid R2_BUCKET '$bucket': expected a DNS-compatible bucket name" >&2
    exit 1
  fi
  R2_BUCKET="$bucket"
  export R2_BUCKET
}
