# uni-ikura-song-dbtest

`kasane-3kHz-songs-dbTEST` を参考に、**Cloudflare Worker + R2 + Static Assets** 構成へ組み替えた検証用リポジトリです。

## 構成

- `index.html`: 検索・フィルタ付きのフロント UI（ETag + localStorage で通信量を削減）
- `worker.js`: `/api/songs` を提供する API 層（R2 から `songs.json` を読み取り）
- `wrangler.toml`: Worker / R2 / Assets のデプロイ設定

## データ形式（R2内 `songs.json`）

配列 JSON を想定します。

```json
[
  {
    "title": "曲名",
    "artist": "アーティスト",
    "kind": "cover",
    "publishedAt": "2025-01-20",
    "url": "https://www.youtube.com/watch?v=xxxx",
    "memo": "任意",
    "checked": "✅",
    "visibleFrom": "2026-02-20T14:00:00+09:00",
    "visibleTo": "2026-12-31T23:59:59+09:00",
    "paused": false
  }
]
```

### 公開制御ルール

- `checked / enabled / publish / active / isPublic / include` のいずれかが存在する場合、**真値の行のみ配信**。
- `paused / temporaryHidden / suspended` が真値なら一時非表示。
- `visibleFrom(or publishFrom/startAt)` より前は非表示。
- `visibleTo(or publishTo/endAt/hiddenAt)` を過ぎたら非表示。

> これにより「登録済みだが一時的に出さない」制御を R2 データだけで切り替えできます。

## 通信量を抑える仕組み

- API は R2 `head` の ETag を使ってレスポンス ETag を返却。
- UI は `If-None-Match` を送信し、差分なし時は `304`（本文なし）を受け取る。
- UI は前回レスポンスを localStorage へ保存し、再表示時に即時表示。

## R2更新運用

- `songs.json` の更新は **1日1回・14:00（JST）** を基準運用とする。
- 更新後は Worker 側の ETag が変わるため、次回アクセス時に自動で最新化される。

## セットアップ

1. R2 バケットを作成（例: `uni-ikura-song-dbtest`）。
2. `songs.json` をアップロード。
3. 必要に応じて `wrangler.toml` の `bucket_name` / `SONGS_JSON_KEY` を修正。
4. デプロイ。

```bash
npx wrangler deploy
```

## API

- `GET /api/health` : ヘルスチェック
- `GET /api/songs?q=&kind=&sort=&limit=` : 曲一覧取得

`kind` は `all | cover | original | short` を想定。

## ローカル確認

```bash
npx wrangler dev
```

ブラウザで表示し、検索条件を変えながら API 経由でデータが表示されることを確認してください。
