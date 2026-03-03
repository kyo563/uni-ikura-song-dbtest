# uni-ikura-song-dbtest

公開ページ: https://kyo563.github.io/uni-ikura-song-dbtest/

`kasane-3kHz-songs-dbTEST` を参考にした、**Cloudflare Worker + R2 + Static Assets** 構成です。  
このリポジトリでは、`Performance Record` シートをGASでJSON化し、GitHub ActionsでR2へ定期同期する運用を想定しています。

## 構成

- `gas/Code.gs`: スプレッドシートを `songs.json` 形式で返すGASコード
- `.github/workflows/sync-songs-to-r2.yml`: GAS -> R2 定期同期
- `scripts/sync_songs_to_r2.sh`: 同期用スクリプト
- `worker.js`: `/api/songs` を提供（R2の`songs.json`を配信）
- `index.html`: 楽曲検索UI

---

## 1. GAS（スプレッドシート読み出し）

対象シート名: `Performance Record`

列は以下を前提にしています。

- A: アーティスト名
- B: 曲名
- C: 備考（歌ってみた/ショート情報 + URL可）
- D: 歌枠直リンク（タイトル + URL、または8桁日付のみ）
- E: 出典元情報
- F: 掲載チェック

`掲載チェック` が有効（✅ / ☑ / TRUE / 1 など）の行だけを出力します。

### GASデプロイ手順

1. スプレッドシートで Apps Script を開く
2. `gas/Code.gs` の内容を貼り付け
3. デプロイ > 新しいデプロイ > ウェブアプリ
   - 実行ユーザー: 自分
   - アクセス権: リンクを知っている全員
4. 発行されたURLに `?api=songs` をつけて確認

例:

```text
https://script.google.com/macros/s/AKfycbxSSq9yCXOD1TCbJwu4VS3Fd6YbWPUryzfTU6cFVThOcozGqbunEvQJNNarSgzAb7lZ/exec?api=songs
```

---

## 2. GitHub Actions（GAS -> R2 同期）

ワークフロー: `.github/workflows/sync-songs-to-r2.yml`

- 手動実行: `workflow_dispatch`
- 定期実行: 毎日 JST 14:00（UTC 05:00）

### 必要な GitHub Secrets

- `GAS_SONGS_API_URL`（未設定時は以下のURLを使用）
  - `https://script.google.com/macros/s/AKfycbxSSq9yCXOD1TCbJwu4VS3Fd6YbWPUryzfTU6cFVThOcozGqbunEvQJNNarSgzAb7lZ/exec?api=songs`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_OBJECT_KEY`（通常 `songs.json`）


### R2アップロード/読み取りを個別検証する（切り分け用）

`sync` ワークフローとは別に、アップロード可否と読み取り可否を分けて確認したい場合は次を実行します。

```bash
chmod +x scripts/verify_r2_upload_and_read.sh
R2_ENDPOINT_URL="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
R2_BUCKET="<bucket>" \
R2_OBJECT_KEY="songs.json" \
AWS_ACCESS_KEY_ID="<access_key>" \
AWS_SECRET_ACCESS_KEY="<secret_key>" \
# 任意: Worker経由の読み取りも同時確認
WORKER_BASE_URL="https://uni-ikura-song-dbtest.<account>.workers.dev" \
bash scripts/verify_r2_upload_and_read.sh
```

このスクリプトは以下を順に検証します。

1. GASレスポンスがJSONとして妥当か（`.items` 配列を持つか）
2. R2へアップロードできるか（検証用キーへ保存）
3. R2から同じオブジェクトを読み戻せるか（S3 API経由）
4. 任意でWorker `/api/health` と `/api/songs` が読めるか

### トラブルシュート（Workflow失敗時）

- `Missing credentials` エラー
  - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`（または `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`）を設定。
- `Missing required R2 config` エラー
  - `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_OBJECT_KEY` を設定。
- `jq: parse error: Invalid numeric literal` エラー
  - JSONの数値フォーマット不正だけでなく、**GASがHTMLエラーページを返している**場合にも起こります。
  - まず `GAS_SONGS_API_URL` をブラウザで開き、`{` から始まるJSONが返るかを確認してください（`?api=songs` を必ず付与）。
  - 追加で、`scripts/sync_songs_to_r2.sh` は `Content-Type` も検証します。`text/html` が返る場合はGAS公開設定（アクセス権）またはURL誤りを疑ってください。

- フロントで `サーバー: エラー:HTTP 404` が出る
  - **開いているURLがWorkerドメインか**を最初に確認。GitHub Pagesで開くと `api/songs` が404になりやすいです。
  - Workerドメイン例: `https://uni-ikura-song-dbtest.<account>.workers.dev/`
  - フロントは GitHub Pages (`<owner>.github.io/<repo>/`) で開いた場合、`https://<repo>.<owner>.workers.dev/api/songs` も自動で試行します。
  - Cloudflareアカウント名がGitHubユーザー名と異なる場合、`localStorage.setItem("songs_workers_account", "<account>")` を実行すると `https://<repo>.<account>.workers.dev/api/songs` を自動推定するようになります。
  - 自動推定で接続できない場合は `localStorage.setItem("songs_api_base", "https://uni-ikura-song-dbtest.<account>.workers.dev/")` を実行してAPIベースを固定し、再読込してください。
  - 恒久対応として、`index.html` の `meta[name="songs-api-base"]` に Worker URL を設定するとブラウザごとの再設定が不要になります。
  - `GET /api/health` の `r2.exists` が `true` か確認。`false` なら `SONG_DB` / `SONGS_JSON_KEY` / R2オブジェクトキーを見直してください。

---

## 3. R2に保存するJSONスキーマ

```json
{
  "items": [
    {
      "id": "2",
      "title": "曲名",
      "artist": "アーティスト名",
      "kind": "live",
      "memo": "備考",
      "source": "出典元情報",
      "checked": true,
      "liveLink": "https://...",
      "liveTitle": "配信タイトル",
      "lastSungDate": "2025-01-20",
      "otherLink": "https://...",
      "otherPublishedAt": "",
      "url": "https://...",
      "publishedAt": "2025-01-20"
    }
  ],
  "total": 1,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "schemaVersion": 1
}
```

補足:
- `lastSungDate`: 歌枠直リンクの先頭8桁 (`yyyymmdd`) から生成
- `otherPublishedAt`: 歌枠実績がなく、歌ってみた/ショートのみの場合に利用
- `url/publishedAt`: 既存UI互換のために同梱

---

## 4. Worker / フロント確認

```bash
npx wrangler dev
```

- `GET /api/health`: ヘルスチェック
- `GET /api/songs`: R2上の `songs.json` を返却

Workerは `songs.json` が「配列形式」「{ items: [] } 形式」の両方を受け取れるようにしています。
