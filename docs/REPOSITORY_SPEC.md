# リポジトリ構成・仕様書

本書は、`uni-ikura-song-dbtest` リポジトリの**現状実装**を整理した仕様書です。既存の `README.md` と矛盾しないよう、Worker 非依存（R2 直接参照）構成を前提に記述します。

## 1. システム全体像

このリポジトリは、次の流れで動作します。

1. Google スプレッドシート（`Performance Record`）を GAS (`gas/Code.gs`) が JSON 化
2. GitHub Actions (`.github/workflows/sync-songs-to-r2.yml`) が定期的に JSON を取得
3. シェルスクリプト (`scripts/sync_songs_to_r2.sh`) が Cloudflare R2 に `songs.json` をアップロード
4. フロントエンド（`index.html` + `src/*.js`）が R2 の `songs.json` を直接 `fetch` して表示

> 補足: 実運用は Worker を必須としない構成です（R2 直接参照）。

---

## 2. リポジトリ構成（トップレベル）

| パス | 役割 |
|---|---|
| `index.html` | 画面本体（HTML + CSS + モジュール初期化） |
| `src/app.js` | フロント全体の制御（イベント、状態反映、読み込み開始、描画連携） |
| `src/data/songsApi.js` | `songs.json` 取得処理（候補URL順試行・キャッシュ利用・エラーハンドリング） |
| `src/ui/renderSongs.js` | 楽曲一覧DOM描画 |
| `src/ui/status.js` | 接続状態表示（読込中/稼働中/停止/エラー） |
| `src/ui/dom.js` | DOM参照ユーティリティ |
| `src/state/appState.js` | クライアント状態・種別マッピング定義 |
| `gas/Code.gs` | スプレッドシートを JSON (`items`) に整形して返す Web アプリ |
| `.github/workflows/sync-songs-to-r2.yml` | GAS → R2 同期の CI/CD |
| `scripts/sync_songs_to_r2.sh` | 同期本体（取得・JSON検証・R2アップロード） |
| `scripts/verify_r2_upload_and_read.sh` | 切り分け検証（取得/アップロード/読み戻し） |
| `assets/icons/*` | ファビコン・PWA関連アセット |
| `README.md` | セットアップ・運用手順の一次ドキュメント |
| `WORKERLESS_CHECK.md` | Worker非依存導線の点検メモ |

---

## 3. フロントエンド仕様（HTML/CSS/JS）

### 3.1 HTML 配置仕様（どのように配置しているか）

`index.html` は 1 ページ構成で、主に **上段（絞り込み・メモ）/中段（一覧）/下段（検索・弾幕）** の3層です。

- `main#songsPage.container` がアプリ全体のコンテナ
- 上段: `.top-form` 内に `#topSwipeTrack`（2枚カード）
  - 1枚目: 絞り込みカード（ステータス、件数、チェックボックス、並び替え）
  - 2枚目: メモカード（`#memoInput`）
- 中段: `.middle-form` 内 `#rows.song-cards`（楽曲カードの描画先）
- 下段: `.bottom-form` 内に `#bottomSwipeTrack`（2枚カード）
  - 1枚目: 検索カード（`#q`, `#clear`）
  - 2枚目: マイ弾幕作成カード（`#myEmoji`, `#saveMyDanmaku`）
  - 固定コントロール: 弾幕セレクト `#danmakuType` + コピー `#copyDanmaku`

配置の要点:

- モバイル操作を重視し、上段・下段ともに**横スワイプで 2 ページ切替**
- 一覧は `#rows` で独立スクロールし、スクロール量に応じて上段の折りたたみを制御
- 表示高さは CSS カスタムプロパティ（`--top-expanded-height` など）と JS 再計算で同期
- ステータス表示 (`#statusShell`) とエラーログ (`#errorLogWrap`) は上段に集約

### 3.2 CSS レイアウト仕様（実装方針）

- `body` はフルハイト（`100dvh`）で背景グラデーション固定
- `body::before/::after` で泡アニメーションを重ねる
- 主要パネルは `card` デザインで統一（角丸 + 枠線 + 余白）
- `top/middle/bottom` はレスポンシブに再配置され、モバイル時はトップの折りたたみやカード展開制御を強める
- スクロール終端の被り防止用にダミー高さ（`--dummy-end-card-height` など）を使用

---

## 4. フロント処理順序（どの順番で処理を行っているか）

以下は、ページロード後の実行順序です。

1. `index.html` の `<script type="module">` が `src/app.js` を import
2. 初期化呼び出しを**この順**で実行
   - `bind()`
   - `setupTopSwipe()`
   - `setupBottomSwipe()`
   - `initializeApp()`

### 4.1 `bind()` の責務

- 入力イベントを全て接続
  - 検索文字、種別チェック、ソート項目/順、クリア
  - 弾幕コピー、メモコピー/ペースト、エラーログコピー
- スクロール/リサイズ時の再計算を接続
  - 上段の折りたたみ判定
  - パネル位置合わせ、ダミー高さ更新
  - バブル演出
- メディアクエリ変化（モバイル⇔PC）に追従

### 4.2 `setupTopSwipe()` / `setupBottomSwipe()` の責務

- それぞれのスワイプトラックに Pointer イベントを設定
- しきい値を超えたドラッグでカード index を切替
- ページインジケータ（ドット）を同期
- 上段はメモフォーカス時に2枚目へ遷移、折りたたみ状態とも連携
- 下段はヒントアニメーションを一定間隔で再提示

### 4.3 `initializeApp()` の責務

- 初期ソート状態を反映
- セッションキャッシュから「マイ弾幕」を復元
- 必要に応じてスワイプヒントを開始
- `loadSongs()` を呼び、データ取得を開始

### 4.4 `loadSongs()` → `songsApi.load()` の責務

`loadSongs()` は取得候補URLを次の優先順で組み立てます。

1. `window.__SONGS_JSON_URL__`（あれば）
2. `localStorage('songs_r2_json_url')`
3. `meta[name="songs-r2-json-url"]`
4. `meta[name="songs-r2-fallbacks"]` 群
5. `meta[name="songs-gas-api-url"]`

`songsApi.load()` は以下を実行します。

1. ステータスを「読込中」に変更
2. localStorage キャッシュを取得し、あれば先に暫定描画
3. 候補URLを先頭から順に `fetch`
   - 200/304なら採用
   - 404 は次候補へフォールバック
   - 404以外のHTTPエラーは詳細付きで失敗
4. JSONパース後、`items` 配列を抽出
5. `filterItems()`（種別・検索語・並び替え）適用
6. `renderSongs.render()` へ渡してDOM再描画
7. 件数表示とステータス（稼働中/停止）を更新
8. `etag` があればキャッシュ保存

失敗時は詳細ログ（`errorName`, `statusCode`, `attempts`, `requestUrl` など）を保持し、キャッシュなしの場合はエラーメッセージを一覧領域に表示します。

---

## 5. データ仕様（フロント観点）

取得 JSON は次を受け付けます。

- ルート配列 `[...]`
- オブジェクト `{ "items": [...] }`

各 `item` で主に利用する項目:

- `title`
- `artist`
- `kind`（または `memo/singingTag` から種別推定）
- `memo`
- `liveLink`
- `liveTitle`
- `lastSungDate`
- `publishedAt`

`kind` は `cover / short / live / other` に正規化して扱います。

---

## 6. バックエンド連携仕様（GAS / Actions / R2）

### 6.1 GAS (`gas/Code.gs`)

- シート `Performance Record` を読み取り
- 掲載チェック列が有効な行のみ採用
- 文字列整形、URL抽出、日付抽出（先頭8桁）を行い `items` へ詰める
- `doGet?api=songs` で JSON を返却

### 6.2 同期ワークフロー

- `sync-songs-to-r2.yml` は手動実行 + 毎日定期実行
- シークレット検証後 `scripts/sync_songs_to_r2.sh` を実行
- 同期スクリプトは
  1. GAS応答取得
  2. JSON妥当性検証（`.items` 配列必須）
  3. R2にアップロード
  4. 公開URL疎通確認（設定時）

---

## 7. 運用上の注意

- フロント表示異常時は、まず `songs-r2-json-url` の直接アクセスで 200/JSON を確認
- 404 が続く場合、R2 の `songs.json` 配置キーと Actions 成功履歴を確認
- GAS 側の公開設定や URL パラメータ（`?api=songs`）不足は HTML 応答化の原因になる

