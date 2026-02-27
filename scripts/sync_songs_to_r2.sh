#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GAS_SONGS_API_URL:-}" ]]; then
  echo "GAS_SONGS_API_URL is required" >&2
  exit 1
fi

if [[ -z "${R2_ENDPOINT_URL:-}" || -z "${R2_BUCKET:-}" || -z "${R2_OBJECT_KEY:-}" ]]; then
  echo "R2_ENDPOINT_URL / R2_BUCKET / R2_OBJECT_KEY are required" >&2
  exit 1
fi

tmp_json="songs.generated.json"

echo "Fetch from GAS..."
curl -fsSL "$GAS_SONGS_API_URL" -o "$tmp_json"

echo "Validate JSON..."
jq -e '.items and (.items | type == "array")' "$tmp_json" >/dev/null

echo "Upload to R2..."
aws s3 cp "$tmp_json" "s3://${R2_BUCKET}/${R2_OBJECT_KEY}" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --content-type "application/json" \
  --cache-control "no-cache"

echo "Done. uploaded: s3://${R2_BUCKET}/${R2_OBJECT_KEY}"
