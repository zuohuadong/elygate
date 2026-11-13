#!/usr/bin/env bash
set -euo pipefail

# Configure AWS CLI for R2 uploads
# Usage: ./configure-r2.sh

echo "⚙️ Configuring AWS CLI for R2..."

pip install awscli

# Clean and trim environment variables (removing any whitespace)
R2_ENDPOINT="$(echo "$R2_ENDPOINT" | tr -d '[:space:]')"
R2_ACCESS_KEY_ID="$(echo "$R2_ACCESS_KEY_ID" | tr -d '[:space:]')"
R2_SECRET_ACCESS_KEY="$(echo "$R2_SECRET_ACCESS_KEY" | tr -d '[:space:]')"

# Validate environment variables
if [ -z "${R2_BUCKET:-}" ] || [ -z "$R2_ENDPOINT" ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
  echo "❌ Missing required R2 credentials or bucket"
  exit 1
fi

# Configure AWS CLI for R2 using dedicated profile
aws configure set --profile R2 aws_access_key_id "$R2_ACCESS_KEY_ID"
aws configure set --profile R2 aws_secret_access_key "$R2_SECRET_ACCESS_KEY"
aws configure set --profile R2 region us-east-1
aws configure set --profile R2 s3.signature_version s3v4

# Test connection
echo "🔍 Testing R2 connection..."
aws s3 ls "s3://${R2_BUCKET}/" --endpoint-url "$R2_ENDPOINT" --profile R2 >/dev/null
echo "✅ R2 connection successful"
