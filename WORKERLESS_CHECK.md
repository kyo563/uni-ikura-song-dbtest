# worker非依存（R2直接参照）構成の導線整理と点検結果

## 結論（先に要点）
- **HTMLの取得先はR2公開JSON直接参照で成立**しています（Worker必須ではありません）。
- ただし、**GAS→R2同期の既定GAS URLがworkflow内だけ別ID**になっており、ここがズレると `songs.json` 未更新や404の原因になります。
- GAS出力は、HTMLが必要とする最低仕様（`items`配列と、`title/artist/kind/memo/liveLink/liveTitle/lastSungDate/publishedAt`）を満たしています。

## 1) 現在の正しい導線（worker非依存）
1. GAS (`doGet?api=songs`) が `{"items": [...]}` を返す。
2. GitHub Actions がそのJSONを取得して R2 の `songs.json` にアップロード。
3. HTML (`index.html`) が `meta[name="songs-r2-json-url"]` のURLへ `fetch`。
4. 取得JSONの `payload.items`（または配列直）を画面表示。

> 重要: HTMLは `/api/songs` を必須にしておらず、R2 URLが正しければ表示可能。

## 2) HTML側が実際に要求している仕様（実装ベース）
### 必須条件
- `songs-r2-json-url` または fallback URL が1つ以上あること。
- そのURLがHTTP 200/304を返し、本文がJSONであること。
- JSONが次のいずれか:
  - ルートが配列
  - `{"items": [...]}` 形式

### アイテム側の期待値
- 現行GAS出力の主フィールドとしては `title`, `artist`, `memo`, `kind`, `liveLink`, `liveTitle`, `lastSungDate`, `publishedAt` を参照可能。
- HTML実装には `otherLink`, `url`, `linkLabel` 参照も残るが、未設定時フォールバックがあるため厳密必須は `items` 配列が主。

## 3) GAS出力のR2向け規格適合チェック
### 合格点
- ルートがオブジェクトで `items` 配列を返している。
- 各行で `title`, `artist`, `kind`, `memo`, `singingTag`, `liveLink`, `liveTitle`, `lastSungDate`, `publishedAt` を生成。
- `ContentService.MimeType.JSON` を返しており、同期スクリプトのJSON検証条件に合致。

### 過去仕様との整理
- 現行の `gas/Code.gs` 実装では `source`, `checked`, `otherLink`, `url` は出力していない（過去仕様の列挙）。

### 注意点
- 掲載チェック（F列）は、空欄や想定外記法を「非掲載」と判定するため、シート運用側でチェック記法を統一すること。
- `lastSungDate/publishedAt` は8桁日付の先頭一致に依存するため、D列フォーマットが崩れると日付欠損になる。
- 実装ソース: `gas/Code.gs` の `items.push` 定義を参照。

## 4) 今回の不具合に直結する主要ズレ
- `sync-songs-to-r2.yml` のデフォルト `GAS_SONGS_API_URL` が、
  - GAS本体コメント/README/スクリプトで使っているURL
  - と異なる script ID になっていた。
- この状態だと、Secrets未設定時に「別WebアプリURL」を叩き、HTML側ではR2の古い/欠損JSONを読む可能性がある。

## 5) 実施済み修正
- workflowの既定 `GAS_SONGS_API_URL` を、リポジトリ内で使っている正規URLに統一。

## 6) 運用チェックリスト（短縮版）
- [ ] `index.html` の `songs-r2-json-url` をブラウザで直接開いて 200 + JSON を確認。
- [ ] Actions最新実行で `sync_songs_to_r2.sh` が成功していることを確認。
- [ ] `songs.json` のルートに `items` 配列があることを確認。
- [ ] エラー時はHTMLの詳細ログ（statusCode / errorName）とR2 URLの404有無を優先確認。
