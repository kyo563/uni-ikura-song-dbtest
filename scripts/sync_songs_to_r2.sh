#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GAS_SONGS_API_URL="https://script.google.com/macros/s/AKfycbxSSq9yCXOD1TCbJwu4VS3Fd6YbWPUryzfTU6cFVThOcozGqbunEvQJNNarSgzAb7lZ/exec?api=songs"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL:-$DEFAULT_GAS_SONGS_API_URL}"
# GitHub Secrets経由で末尾改行やCRが混入するケースを吸収する
GAS_SONGS_API_URL="${GAS_SONGS_API_URL//$'\r'/}"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL//$'\n'/}"

if [[ -z "${R2_ENDPOINT_URL:-}" || -z "${R2_BUCKET:-}" || -z "${R2_OBJECT_KEY:-}" ]]; then
  echo "R2_ENDPOINT_URL / R2_BUCKET / R2_OBJECT_KEY are required" >&2
  exit 1
fi

tmp_json="songs.generated.json"
tmp_headers="songs.generated.headers"
content_type=""

debug_enabled="${DEBUG_SYNC:-0}"

if [[ "$debug_enabled" == "1" ]]; then
  set -x
fi

print_response_preview() {
  echo "--- response preview (first 300 bytes) ---" >&2
  head -c 300 "$tmp_json" >&2 || true
  echo >&2
}

extract_http_status() {
  awk 'toupper($1) ~ /^HTTP\/./ { status=$2 } END { if (status != "") print status }' "$tmp_headers"
}

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

first_char="$(LC_ALL=C awk '{for (i = 1; i <= length($0); i++) { c = substr($0, i, 1); if (c !~ /[[:space:]]/) { print c; exit } }}' "$tmp_json")"
if [[ "$first_char" != "{" && "$first_char" != "[" ]]; then
  echo "Response does not look like JSON. GAS may have returned an HTML error page." >&2
  echo "Hint: verify the endpoint includes '?api=songs' and is publicly accessible." >&2
  http_status="$(extract_http_status)"
  if [[ -n "$http_status" ]]; then
    echo "HTTP status from GAS: $http_status" >&2
  fi
  print_response_preview
  exit 1
fi

echo "Validate JSON..."
if ! jq -e '.items and (.items | type == "array")' "$tmp_json" >/dev/null; then
  echo "Invalid JSON schema or parse error. Expected object with array field: .items" >&2
  response_head="$(head -c 100 "$tmp_json")"
  response_head="${response_head,,}"
  if grep -qiE '<!doctype html|<html' <<<"$response_head"; then
    echo "Detected HTML response. GAS endpoint likely returned an error page." >&2
    echo "Hint: endpoint URL / deployment / access permission を確認してください。" >&2
  fi
  http_status="$(extract_http_status)"
  if [[ -n "$http_status" ]]; then
    echo "HTTP status from GAS: $http_status" >&2
  fi
  if [[ -n "$content_type" ]]; then
    echo "Content-Type from GAS: $content_type" >&2
  fi
  print_response_preview
  exit 1
fi

content_type="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/{sub(/\r$/, "", $0); sub(/^[^:]*:[[:space:]]*/, "", $0); print tolower($0); exit}' "$tmp_headers")"
if [[ -n "$content_type" && "$content_type" != application/json* && "$content_type" != text/json* ]]; then
  echo "Warning: Unexpected Content-Type from GAS: $content_type" >&2
  echo "レスポンス本体はJSONとして正常に解析できたため、このまま処理を続行します。" >&2
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
