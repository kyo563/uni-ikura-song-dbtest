#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GAS_SONGS_API_URL="https://script.google.com/macros/s/AKfycbya8kd5kFaeIproZUePBtsn2-4OFCSYNvyFWKYK9ir2AQQzZXy028i_baiE5EeVjuK3/exec?api=songs"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL:-$DEFAULT_GAS_SONGS_API_URL}"
# GitHub Secrets経由で末尾改行やCRが混入するケースを吸収する
GAS_SONGS_API_URL="$(printf '%s' "$GAS_SONGS_API_URL" | tr -d '\r\n')"

if [[ -z "${R2_ENDPOINT_URL:-}" || -z "${R2_BUCKET:-}" || -z "${R2_OBJECT_KEY:-}" ]]; then
  echo "R2_ENDPOINT_URL / R2_BUCKET / R2_OBJECT_KEY are required" >&2
  exit 1
fi

tmp_json="songs.generated.json"
tmp_headers="songs.generated.headers"

echo "Fetch from GAS..."
curl -fsSL \
  -H 'Accept: application/json' \
  -D "$tmp_headers" \
  "$GAS_SONGS_API_URL" \
  -o "$tmp_json"

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

content_type="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/{sub(/\r$/, "", $0); sub(/^[^:]*:[[:space:]]*/, "", $0); print tolower($0); exit}' "$tmp_headers")"
if [[ -n "$content_type" && "$content_type" != application/json* && "$content_type" != text/json* ]]; then
  echo "Unexpected Content-Type from GAS: $content_type" >&2
  echo "GAS_SONGS_API_URL がJSON APIではなく、HTML/テキストの可能性があります。" >&2
  echo "Hint: GAS Web Appの公開範囲を『全員』にし、URL末尾に '?api=songs' が付いているか確認してください。" >&2
  echo "--- response preview (first 300 bytes) ---" >&2
  head -c 300 "$tmp_json" >&2 || true
  echo >&2
  exit 1
fi

echo "Validate JSON..."
if ! jq -e '.items and (.items | type == "array")' "$tmp_json" >/dev/null; then
  echo "Invalid JSON schema or parse error. Expected object with array field: .items" >&2
  if head -c 100 "$tmp_json" | tr '[:upper:]' '[:lower:]' | grep -q '<!doctype html\|<html'; then
    echo "Detected HTML response. GAS endpoint likely returned an error page." >&2
    echo "Hint: endpoint URL / deployment / access permission を確認してください。" >&2
  fi
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
