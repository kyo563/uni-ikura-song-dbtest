#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GAS_SONGS_API_URL="https://script.google.com/macros/s/AKfycbzU9lD1qRGocSkZvZJmh6FTw75XBnLMXgRIAyEDBuwqIG_whykcxbjjrhuk6K789ciS/exec?api=songs"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL:-$DEFAULT_GAS_SONGS_API_URL}"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL//$'\r'/}"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL//$'\n'/}"

: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_OBJECT_KEY:?R2_OBJECT_KEY is required}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

tmp_json="verify.songs.source.json"
tmp_headers="verify.songs.headers"
tmp_r2="verify.songs.r2.json"
trap 'rm -f "$tmp_json" "$tmp_headers" "$tmp_r2"' EXIT

run_id="$(date +%Y%m%d%H%M%S)"
verify_key="${R2_OBJECT_KEY%.json}.verify.${run_id}.json"

extract_http_status() {
  awk 'toupper($1) ~ /^HTTP\/.+/ { s=$2 } END { if (s != "") print s }' "$tmp_headers"
}

echo "[1/4] GASレスポンス検証: $GAS_SONGS_API_URL"
curl -fsSL -H 'Accept: application/json' -D "$tmp_headers" "$GAS_SONGS_API_URL" -o "$tmp_json"

status="$(extract_http_status || true)"
if [[ -n "$status" ]]; then
  echo "  GAS status: $status"
fi

first_char="$(LC_ALL=C awk '{for(i=1;i<=length($0);i++){c=substr($0,i,1);if(c!~ /[[:space:]]/){print c;exit}}}' "$tmp_json")"
if [[ "$first_char" != "{" && "$first_char" != "[" ]]; then
  echo "GAS response is not JSON-like (first non-space char: ${first_char:-<none>})" >&2
  head -c 300 "$tmp_json" >&2 || true
  exit 1
fi

jq -e '.items and (.items | type == "array")' "$tmp_json" >/dev/null
items_count="$(jq '.items | length' "$tmp_json")"
echo "  GAS JSON OK (.items count: $items_count)"

echo "[2/4] R2アップロード検証: s3://${R2_BUCKET}/${verify_key}"
aws s3 cp "$tmp_json" "s3://${R2_BUCKET}/${verify_key}" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --content-type "application/json" \
  --cache-control "no-cache"

echo "[3/4] R2読み取り検証 (S3 API 経由)"
aws s3 cp "s3://${R2_BUCKET}/${verify_key}" "$tmp_r2" --endpoint-url "$R2_ENDPOINT_URL"
jq -e '.items and (.items | type == "array")' "$tmp_r2" >/dev/null
r2_count="$(jq '.items | length' "$tmp_r2")"
echo "  R2 read OK (.items count: $r2_count)"

if [[ -n "${WORKER_BASE_URL:-}" ]]; then
  worker_base="${WORKER_BASE_URL%/}"
  echo "[4/4] Worker読み取り検証: ${worker_base}/api/health と /api/songs"
  health="$(curl -fsSL "${worker_base}/api/health")"
  songs="$(curl -fsSL "${worker_base}/api/songs")"

  echo "$health" | jq -e '.ok == true' >/dev/null
  echo "$songs" | jq -e '.items and (.items | type == "array")' >/dev/null
  visible_count="$(echo "$songs" | jq '.count // (.items | length)')"
  source_total="$(echo "$songs" | jq '.sourceTotal // .total // (.items | length)')"
  echo "  Worker read OK (visible: $visible_count / source: $source_total)"
else
  echo "[4/4] Worker読み取り検証はスキップ (WORKER_BASE_URL 未指定)"
fi

echo "検証完了: upload/read ともに正常です。"
