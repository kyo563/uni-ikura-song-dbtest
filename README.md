# uni-ikura-song-dbtest

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
https://script.google.com/macros/s/AKfycbya8kd5kFaeIproZUePBtsn2-4OFCSYNvyFWKYK9ir2AQQzZXy028i_baiE5EeVjuK3/exec?api=songs
```

---

## 2. GitHub Actions（GAS -> R2 同期）

ワークフロー: `.github/workflows/sync-songs-to-r2.yml`

- 手動実行: `workflow_dispatch`
- 定期実行: 毎日 JST 14:00（UTC 05:00）

### 必要な GitHub Secrets

- `GAS_SONGS_API_URL`（未設定時は以下のURLを使用）
  - `https://script.google.com/macros/s/AKfycbya8kd5kFaeIproZUePBtsn2-4OFCSYNvyFWKYK9ir2AQQzZXy028i_baiE5EeVjuK3/exec?api=songs`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_OBJECT_KEY`（通常 `songs.json`）

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
