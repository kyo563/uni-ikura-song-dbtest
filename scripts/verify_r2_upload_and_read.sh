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
run_id="$(date +%Y%m%d%H%M%S)"
verify_key="${R2_OBJECT_KEY%.json}.verify.${run_id}.json"
uploaded_verify_object=0

cleanup() {
  local exit_status=$?

  rm -f "$tmp_json" "$tmp_headers" "$tmp_r2"

  if [[ "$uploaded_verify_object" -eq 1 ]]; then
    aws s3 rm "s3://${R2_BUCKET}/${verify_key}" --endpoint-url "$R2_ENDPOINT_URL" >/dev/null 2>&1 || {
      echo "Warning: 検証用オブジェクトの削除に失敗しました: s3://${R2_BUCKET}/${verify_key}" >&2
      true
    }
  fi

  exit "$exit_status"
}

trap cleanup EXIT

extract_http_status() {
  awk 'toupper($1) ~ /^HTTP\/.+/ { s=$2 } END { if (s != "") print s }' "$tmp_headers"
}

echo "[1/3] GASレスポンス検証: $GAS_SONGS_API_URL"
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

echo "[2/3] R2アップロード検証: s3://${R2_BUCKET}/${verify_key}"
aws s3 cp "$tmp_json" "s3://${R2_BUCKET}/${verify_key}" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --content-type "application/json" \
  --cache-control "no-cache"
uploaded_verify_object=1

echo "[3/3] R2読み取り検証 (S3 API 経由)"
aws s3 cp "s3://${R2_BUCKET}/${verify_key}" "$tmp_r2" --endpoint-url "$R2_ENDPOINT_URL"
jq -e '.items and (.items | type == "array")' "$tmp_r2" >/dev/null
r2_count="$(jq '.items | length' "$tmp_r2")"
echo "  R2 read OK (.items count: $r2_count)"

if [[ -n "${WORKER_BASE_URL:-}" ]]; then
  echo "Note: WORKER_BASE_URL は廃止済みのため無視します（R2検証のみ実施）。"
fi

echo "検証完了: upload/read ともに正常です。"
