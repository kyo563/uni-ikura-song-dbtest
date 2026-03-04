# worker非依存構成の点検結果

## 結論
- フロントエンド（`index.html`）は `songs-r2-json-url`（または `songs-r2-fallbacks`）で指定した **R2公開JSONを直接参照**する構成で成立しています。
- 今回、デフォルト候補から `/api/songs` を外したため、Workerが無い環境でも誤ってWorker依存の経路にフォールバックしません。
- `worker.js` / `wrangler.toml` は引き続き「任意の補助API」として残っていますが、通常の表示経路には必須ではありません。

## 点検観点
1. データ同期経路
   - GAS -> GitHub Actions -> R2 (`songs.json`) のバッチ同期はWorkerを経由しません。
2. フロント取得経路
   - 主経路: `meta[name="songs-r2-json-url"]` または `localStorage("songs_r2_json_url")`
   - 予備経路: `meta[name="songs-r2-fallbacks"]`
   - `/api/songs` の自動フォールバックは無効化済み。
3. 補助機能
   - `worker.js` はデバッグ/補助用途として任意利用可能。

## 運用上の確認ポイント
- `index.html` の `songs-r2-json-url` が有効な公開URLを指していること。
- R2バケットに `songs.json` が定期同期されていること（GitHub Actions成功）。
- CORS設定でブラウザからR2 JSONを読めること。
