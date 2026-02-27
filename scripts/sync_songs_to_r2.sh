#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GAS_SONGS_API_URL="https://script.google.com/macros/s/AKfycbya8kd5kFaeIproZUePBtsn2-4OFCSYNvyFWKYK9ir2AQQzZXy028i_baiE5EeVjuK3/exec?api=songs"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL:-$DEFAULT_GAS_SONGS_API_URL}"

if [[ -z "${R2_ENDPOINT_URL:-}" || -z "${R2_BUCKET:-}" || -z "${R2_OBJECT_KEY:-}" ]]; then
  echo "R2_ENDPOINT_URL / R2_BUCKET / R2_OBJECT_KEY are required" >&2
  exit 1
fi

tmp_json="songs.generated.json"

echo "Fetch from GAS..."
curl -fsSL "$GAS_SONGS_API_URL" -o "$tmp_json"

if [[ ! -s "$tmp_json" ]]; then
  echo "Fetched response is empty. Check GAS_SONGS_API_URL and GAS deployment settings." >&2
  exit 1
fi

first_char="$(LC_ALL=C tr -d '[:space:]' < "$tmp_json" | head -c 1)"
if [[ "$first_char" != "{" && "$first_char" != "[" ]]; then
  echo "Response does not look like JSON. GAS may have returned an HTML error page." >&2
  echo "Hint: verify the endpoint includes '?api=songs' and is publicly accessible." >&2
  echo "--- response preview (first 300 bytes) ---" >&2
  head -c 300 "$tmp_json" >&2 || true
  echo >&2
  exit 1
fi

echo "Validate JSON..."
if ! jq -e '.items and (.items | type == "array")' "$tmp_json" >/dev/null; then
  echo "Invalid JSON schema or parse error. Expected object with array field: .items" >&2
  echo "--- response preview (first 300 bytes) ---" >&2
  head -c 300 "$tmp_json" >&2 || true
  echo >&2
  exit 1
fi

echo "Upload to R2..."
aws s3 cp "$tmp_json" "s3://${R2_BUCKET}/${R2_OBJECT_KEY}" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --content-type "application/json" \
  --cache-control "no-cache"

echo "Done. uploaded: s3://${R2_BUCKET}/${R2_OBJECT_KEY}"

if [[ -n "${R2_PUBLIC_BASE_URL:-}" ]]; then
  public_base_url="${R2_PUBLIC_BASE_URL%/}"
  object_key_no_leading_slash="${R2_OBJECT_KEY#/}"
  echo "Public URL: ${public_base_url}/${object_key_no_leading_slash}"
fi
