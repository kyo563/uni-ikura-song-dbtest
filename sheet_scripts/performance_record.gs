/***** 既存：リンク変換 用 設定 *****/
const CFG = {
  SHEET_NAME: 'Performance Record', // 対象シート名
  START_ROW: 4,                     // データ開始行（先頭3行をスキップする想定）
  COLUMNS: ['D'],                   // 変換対象列（'C' も足せます: ['C','D']）
  LABEL_MODE: 'AS_IS',              // 'AS_IS'=既存テキスト、'ARROW'=常に「▶前回」
  DRY_RUN: false                    // true で書き換えせずログのみ
};

/***** 追加：日付自動挿入 用 設定 *****/
const CFG_DATE = {
  SHEET_NAME: 'Performance Record', // 日付自動挿入の対象
  HEADER_ROW: 3,                    // 見出し行
  DATA_START_ROW: 4,                // 実データ開始行
  RANGE_COL_START: 1,               // A列
  RANGE_COL_END: 6,                 // F列
  DATE_COL: 7,                      // G列（更新日）
  DATE_FORMAT: 'yyyy-mm-dd'         // 表示形式
};

/***** 追加：エクスポート 用 設定 *****/
const CFG_EXPORT = {
  SHEET_NAME: 'Performance Record', // 抽出元シート
  HEADER_ROW: 3,                    // ヘッダー行（A3:G3）
  DATA_START_ROW: 4,                // データ開始行（A4～）
  COL_START: 1,                     // A列
  COL_END: 7,                       // G列
  DATE_COL: 7,                      // G列（更新日）
  EXPORT_SHEET_BASENAME: 'DB差分',  // 出力シート名の接頭辞
  EXPORT_FILE_BASENAME: '歌唱DB'    // 出力ファイル名の接頭辞
};

/***** 追加：歌唱DB整理 用 設定 *****/
const CFG_SONG_CLEANUP = {
  SHEET_NAME: 'Performance Record',
  DATA_START_ROW: 4,   // 実データ開始行
  COL_ARTIST: 1,       // A列
  COL_TITLE: 2,        // B列
  COL_NOTE: 3,         // C列（備考）
  COL_LINK: 4,         // D列（歌枠直リンク）
  COL_UPDATED: 7,      // G列（最新更新日）
  COL_START: 1,        // A列
  COL_END: 7,          // G列まで取得
  DRY_RUN: false,
  LOG_LIMIT: 200
};

/***** メニュー（統合版） *****/
function onOpen(){
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('リンク変換')
    .addItem('UIリンク → HYPERLINK() に変換', 'convertUiLinksToHyperlink')
    .addItem('DRY RUN（書き換えなしで確認）', 'dryRun_convert')
    .addToUi();

  ui.createMenu('エクスポート')
    .addItem('更新日でExcel出力', 'showExportDialog')
    .addToUi();

  ui.createMenu('歌唱DB整理')
    .addItem('DRY RUN（削除せず判定だけ）', 'dryRun_cleanupSongRecords')
    .addItem('重複整理を実行', 'cleanupSongRecords')
    .addToUi();
}

function dryRun_convert() {
  CFG.DRY_RUN = true;
  try {
    convertUiLinksToHyperlink();
  } finally {
    CFG.DRY_RUN = false;
  }
}

function dryRun_cleanupSongRecords() {
  CFG_SONG_CLEANUP.DRY_RUN = true;
  try {
    cleanupSongRecords();
  } finally {
    CFG_SONG_CLEANUP.DRY_RUN = false;
  }
}

/***** 本体：リンク変換（既存） *****/
function convertUiLinksToHyperlink() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_NAME);
  if (!sh) throw new Error('指定シートが見つかりません: ' + CFG.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < CFG.START_ROW) {
    Logger.log('処理対象がありません。');
    return;
  }

  const colIndexes = CFG.COLUMNS.map(c => letterToColumn(c));
  const numRows = lastRow - CFG.START_ROW + 1;

  let changed = 0;
  const actions = [];

  colIndexes.forEach(col => {
    const rng = sh.getRange(CFG.START_ROW, col, numRows, 1);
    const values = rng.getDisplayValues();
    const formulas = rng.getFormulas();
    const rich = rng.getRichTextValues();

    for (let i = 0; i < numRows; i++) {
      const row = CFG.START_ROW + i;
      const cellVal = values[i][0] || '';
      const cellFormula = formulas[i][0] || '';
      const rtv = rich[i][0];

      if (/^\s*=\s*HYPERLINK\(/i.test(cellFormula)) continue;

      const url = pickUrlFromRich(rtv) || pickUrlFromFormula(cellFormula) || pickUrlFromText(cellVal);
      if (!url) continue;

      const label = CFG.LABEL_MODE === 'ARROW' ? '▶前回' : (cellVal.trim() || url);
      const formula = makeHyperlinkFormula(url, label);

      if (!CFG.DRY_RUN) {
        sh.getRange(row, col).setFormula(formula);
      }
      changed++;
      actions.push(`#${row}${columnToLetter(col)}: "${cellVal}" → ${formula}`);
    }
  });

  Logger.log(`変換完了: ${changed} セル更新${CFG.DRY_RUN ? '（DRY RUN）' : ''}`);
  actions.slice(0, 200).forEach(line => Logger.log(line));
}

/***** 追加：A～F編集時にG列へ日付自動挿入 *****/
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CFG_DATE.SHEET_NAME) return;

    const rowStart = e.range.getRow();
    const numRows  = e.range.getNumRows();
    const colStart = e.range.getColumn();
    const numCols  = e.range.getNumColumns();
    const colEnd   = colStart + numCols - 1;
    const rowEnd   = rowStart + numRows - 1;

    const writeStartRow = Math.max(rowStart, CFG_DATE.DATA_START_ROW);
    if (writeStartRow > rowEnd) return;

    // G列を人手で編集した時は無視（再帰防止）
    if (colStart <= CFG_DATE.DATE_COL && CFG_DATE.DATE_COL <= colEnd) return;

    // A～Fとの交差がなければ何もしない
    const intersectsAF = !(colStart > CFG_DATE.RANGE_COL_END || colEnd < CFG_DATE.RANGE_COL_START);
    if (!intersectsAF) return;

    const today = new Date();
    const out = [];
    for (let r = writeStartRow; r <= rowEnd; r++) out.push([today]);

    const rng = sh.getRange(writeStartRow, CFG_DATE.DATE_COL, out.length, 1);
    rng.setValues(out);
    rng.setNumberFormat(CFG_DATE.DATE_FORMAT);
  } catch (err) {
    console.error(err);
  }
}

/***** 追加：更新日指定でExcelダウンロード（要件反映） *****/
// ダイアログ表示
function showExportDialog() {
  const html = HtmlService.createHtmlOutputFromFile('export')
    .setWidth(460)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '更新日でExcel出力');
}

// G列（更新日）のユニーク値（yyyy-mm-dd）を新しい順で返す
function getUniqueDates() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG_EXPORT.SHEET_NAME);
  if (!sh) throw new Error('シートが見つかりません: ' + CFG_EXPORT.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < CFG_EXPORT.DATA_START_ROW) return [];

  const rng = sh.getRange(CFG_EXPORT.DATA_START_ROW, CFG_EXPORT.DATE_COL, lastRow - CFG_EXPORT.DATA_START_ROW + 1, 1);
  const vals = rng.getValues().flat();

  const set = new Set();
  for (const v of vals) {
    const d = _toDateOrNull_(v);
    if (!d) continue;
    set.add(_fmtYmd_(d));
  }
  return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * 選択日付（yyyy-mm-dd文字列配列）のうち最小日付を基準に抽出。
 * - ヘッダー(A3:G3)をExcelの1行目に設定
 * - 本文は2行目から
 * - C/DはRichTextの本文のみ。Dは文頭8桁を yyyy/mm/dd に整形
 * - ファイル名：歌唱DByyyymmdd.xlsx（yyyymmdd=最小日付）
 * - シート名：DB差分yyyymmdd
 */
function exportSinceDates(selectedDateStrs) {
  if (!Array.isArray(selectedDateStrs) || selectedDateStrs.length === 0) {
    throw new Error('日付が選択されていません。');
  }
  const minStr = selectedDateStrs.reduce((m, x) => (x < m ? x : m));
  const minNum = Number(minStr.replace(/-/g, ''));

  const src = SpreadsheetApp.getActive().getSheetByName(CFG_EXPORT.SHEET_NAME);
  if (!src) throw new Error('シートが見つかりません: ' + CFG_EXPORT.SHEET_NAME);

  const lastRow = src.getLastRow();
  if (lastRow < CFG_EXPORT.DATA_START_ROW) throw new Error('抽出対象データがありません。');

  // 本文(A4:G*)
  const numRows = lastRow - CFG_EXPORT.DATA_START_ROW + 1;
  const dataRange = src.getRange(CFG_EXPORT.DATA_START_ROW, CFG_EXPORT.COL_START, numRows, CFG_EXPORT.COL_END);
  const dataValues = dataRange.getValues();
  const dataRich   = dataRange.getRichTextValues();

  // ヘッダー(A3:G3)
  const header = src.getRange(CFG_EXPORT.HEADER_ROW, CFG_EXPORT.COL_START, 1, CFG_EXPORT.COL_END).getValues()[0];

  // 抽出＆C/D整形
  const filtered = [];
  for (let i = 0; i < dataValues.length; i++) {
    const rowVals = dataValues[i].slice();
    const rowRich = dataRich[i];

    // G列（更新日）判定
    const gVal = rowVals[CFG_EXPORT.DATE_COL - 1];
    const d = _toDateOrNull_(gVal);
    if (!d) continue;
    const ymdNum = Number(_fmtYmd_(d).replace(/-/g, ''));
    if (ymdNum < minNum) continue;

    // C列: RichText本文のみ
    rowVals[2] = _richTextToPlain_(rowRich[2], rowVals[2]);

    // D列: RichText本文→文頭8桁→yyyy/mm/dd
    const dPlain = _richTextToPlain_(rowRich[3], rowVals[3]);
    const m = String(dPlain || '').match(/^(\d{8})/);
    rowVals[3] = m ? _yyyymmddToSlash_(m[1]) : '';

    filtered.push(rowVals);
  }

  // 新規ブック作成
  const yyyymmdd = minStr.replace(/-/g, '');
  const fileTitle = `${CFG_EXPORT.EXPORT_FILE_BASENAME}${yyyymmdd}`;
  const sheetName = `${CFG_EXPORT.EXPORT_SHEET_BASENAME}${yyyymmdd}`;

  const outSS = SpreadsheetApp.create(fileTitle);
  const outSh = outSS.getActiveSheet();
  outSh.setName(sheetName);

  // ヘッダー1行目、本文2行目以降に出力
  if (header && header.length) {
    outSh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  if (filtered.length > 0) {
    outSh.getRange(2, 1, filtered.length, filtered[0].length).setValues(filtered);
  }
  outSh.autoResizeColumns(1, CFG_EXPORT.COL_END);

  const fileId = outSS.getId();
  const gid = outSh.getSheetId();
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx&gid=${gid}`;
  return {
    fileId,
    name: `${fileTitle}.xlsx`,
    url,
    rows: filtered.length,
    since: minStr,
    sheet: sheetName
  };
}

/***** 追加：歌唱DB整理 本体 *****/
/**
 * 対象：Performance Record シートのみ
 *
 * 判定ルール
 * 1) A列アーティスト名 + B列曲名 が一致する行を同一歌唱曲データとする
 * 2) 同一曲内で D列のURLが完全一致する行は重複
 *    → 新しい方のデータを削除
 *    → 新しさ判定は G列（最新更新日）が新しい方
 *      同値/空欄なら下にある行を新しい方とみなす
 * 3) 同一曲内で C列またはD列が異なるものは別日歌唱候補
 *    → 歌ってみた > 歌枠 > ショート
 *    → 同順位なら D列表示文字列の冒頭8桁(yyyymmdd) が新しい方を残す
 *    → さらに同値なら G列（最新更新日）が新しい方
 *    → さらに同値なら上にある行を残す
 */
function cleanupSongRecords() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG_SONG_CLEANUP.SHEET_NAME);
  if (!sh) throw new Error('指定シートが見つかりません: ' + CFG_SONG_CLEANUP.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < CFG_SONG_CLEANUP.DATA_START_ROW) {
    SpreadsheetApp.getUi().alert('処理対象データがありません。');
    return;
  }

  const numRows = lastRow - CFG_SONG_CLEANUP.DATA_START_ROW + 1;
  const rng = sh.getRange(
    CFG_SONG_CLEANUP.DATA_START_ROW,
    CFG_SONG_CLEANUP.COL_START,
    numRows,
    CFG_SONG_CLEANUP.COL_END
  );

  const values   = rng.getValues();
  const displays = rng.getDisplayValues();
  const formulas = rng.getFormulas();
  const richs    = rng.getRichTextValues();

  const records = [];
  for (let i = 0; i < numRows; i++) {
    const row = CFG_SONG_CLEANUP.DATA_START_ROW + i;

    const artistRaw  = values[i][CFG_SONG_CLEANUP.COL_ARTIST - 1];
    const titleRaw   = values[i][CFG_SONG_CLEANUP.COL_TITLE - 1];
    const noteRaw    = values[i][CFG_SONG_CLEANUP.COL_NOTE - 1];
    const linkDisp   = displays[i][CFG_SONG_CLEANUP.COL_LINK - 1] || '';
    const linkForm   = formulas[i][CFG_SONG_CLEANUP.COL_LINK - 1] || '';
    const linkRich   = richs[i][CFG_SONG_CLEANUP.COL_LINK - 1];
    const updatedRaw = values[i][CFG_SONG_CLEANUP.COL_UPDATED - 1];

    const artist = _normalizeSongKeyText_(artistRaw);
    const title  = _normalizeSongKeyText_(titleRaw);

    // A/Bどちらかが空なら対象外
    if (!artist || !title) continue;

    const linkUrl = pickUrlFromRich(linkRich) || pickUrlFromFormula(linkForm) || pickUrlFromText(linkDisp);
    const songDateNum = _extractSongDateNumFromDisplay_(linkDisp);
    const updatedMs = _toMsOrNull_(updatedRaw);
    const sourceRank = _detectSourceRank_(noteRaw);

    records.push({
      row,
      artist,
      title,
      key: artist + '\t' + title,
      note: noteRaw == null ? '' : String(noteRaw),
      linkDisplay: linkDisp,
      linkUrl: linkUrl || '',
      updatedMs,
      songDateNum,
      sourceRank
    });
  }

  if (records.length === 0) {
    SpreadsheetApp.getUi().alert('A列・B列が埋まっている処理対象データがありません。');
    return;
  }

  // A+Bでグループ化
  const groups = {};
  records.forEach(rec => {
    if (!groups[rec.key]) groups[rec.key] = [];
    groups[rec.key].push(rec);
  });

  const deleteMap = {}; // row => reason
  let exactDupDeleted = 0;
  let rankedDeleted = 0;
  const logs = [];

  Object.keys(groups).forEach(key => {
    const group = groups[key];

    /***** Step 1: 同一URL完全重複の削除（新しい方を削除） *****/
    const urlBuckets = {};
    group.forEach(rec => {
      if (!rec.linkUrl) return;
      if (!urlBuckets[rec.linkUrl]) urlBuckets[rec.linkUrl] = [];
      urlBuckets[rec.linkUrl].push(rec);
    });

    Object.keys(urlBuckets).forEach(url => {
      const bucket = urlBuckets[url];
      if (bucket.length <= 1) return;

      // 古い順に並べ、先頭を残す
      bucket.sort(_compareOlderFirstForExactDup_);

      const keeper = bucket[0];
      for (let i = 1; i < bucket.length; i++) {
        const rec = bucket[i];
        if (!deleteMap[rec.row]) {
          deleteMap[rec.row] =
            `同一URL重複のため削除（残す行: ${keeper.row} / URL: ${url}）`;
          exactDupDeleted++;
          if (logs.length < CFG_SONG_CLEANUP.LOG_LIMIT) {
            logs.push(`Row ${rec.row} 削除: 同一URL重複 → keep Row ${keeper.row} [${rec.artist} / ${rec.title}]`);
          }
        }
      }
    });

    /***** Step 2: 同一曲内で最優先1件だけ残す *****/
    const remain = group.filter(rec => !deleteMap[rec.row]);
    if (remain.length <= 1) return;

    let keeper = remain[0];
    for (let i = 1; i < remain.length; i++) {
      if (_compareBetterSongRecord_(remain[i], keeper) > 0) {
        keeper = remain[i];
      }
    }

    remain.forEach(rec => {
      if (rec.row === keeper.row) return;
      if (!deleteMap[rec.row]) {
        deleteMap[rec.row] =
          `同一曲の優先順位で削除（残す行: ${keeper.row} / 種別優先: ${_sourceRankLabel_(keeper.sourceRank)} / 日付: ${keeper.songDateNum || 'なし'}）`;
        rankedDeleted++;
        if (logs.length < CFG_SONG_CLEANUP.LOG_LIMIT) {
          logs.push(`Row ${rec.row} 削除: 同一曲整理 → keep Row ${keeper.row} [${rec.artist} / ${rec.title}]`);
        }
      }
    });
  });

  const rowsToDelete = Object.keys(deleteMap).map(Number).sort((a, b) => b - a);

  if (!CFG_SONG_CLEANUP.DRY_RUN && rowsToDelete.length > 0) {
    _deleteRowsDescendingInChunks_(sh, rowsToDelete);
  }

  Logger.log('--- 歌唱DB整理 結果 ---');
  Logger.log(`対象曲キー数: ${Object.keys(groups).length}`);
  Logger.log(`削除候補行数: ${rowsToDelete.length}${CFG_SONG_CLEANUP.DRY_RUN ? '（DRY RUN）' : ''}`);
  Logger.log(`  - 同一URL重複: ${exactDupDeleted}`);
  Logger.log(`  - 同一曲優先順位整理: ${rankedDeleted}`);
  logs.forEach(line => Logger.log(line));

  const preview = logs.slice(0, 20).join('\n');
  SpreadsheetApp.getUi().alert(
    `歌唱DB整理 ${CFG_SONG_CLEANUP.DRY_RUN ? '（DRY RUN）' : '完了'}\n\n` +
    `対象曲キー数: ${Object.keys(groups).length}\n` +
    `削除${CFG_SONG_CLEANUP.DRY_RUN ? '候補' : ''}行数: ${rowsToDelete.length}\n` +
    `- 同一URL重複: ${exactDupDeleted}\n` +
    `- 同一曲優先順位整理: ${rankedDeleted}\n\n` +
    (preview ? `詳細（先頭20件）:\n${preview}` : '削除対象はありません。')
  );
}

/***** ヘルパー（既存：リンク変換） *****/
function pickUrlFromRich(rtv) {
  if (!rtv) return '';
  try {
    const u = rtv.getLinkUrl && rtv.getLinkUrl();
    if (u) return String(u).trim();
  } catch(e){}
  try {
    const runs = rtv.getRuns ? rtv.getRuns() : [];
    for (let k = 0; k < runs.length; k++) {
      const s = runs[k].getTextStyle();
      const u = s && s.getLinkUrl && s.getLinkUrl();
      if (u) return String(u).trim();
    }
  } catch(e){}
  return '';
}

function pickUrlFromFormula(f) {
  if (!f) return '';
  let m = f.match(/HYPERLINK\(\s*"([^"]+)"/i); if (m) return m[1].trim();
  m = f.match(/HYPERLINK\(\s*'([^']+)'/i); if (m) return m[1].trim();
  m = f.match(/href="([^"]+)"/i) || f.match(/href=\\"([^\\"]+)\\"/i); if (m) return m[1].trim();
  m = f.match(/HYPERLINK\(&quot;([^&]+)&quot;/i); if (m) return m[1].trim();
  return '';
}

function pickUrlFromText(s) {
  if (!s) return '';
  const m = String(s).match(/https?:\/\/\S+/i);
  return m ? m[0].trim() : '';
}

function makeHyperlinkFormula(url, label) {
  const esc = (t) => String(t).replace(/"/g, '""');
  return `=HYPERLINK("${esc(url)}","${esc(label)}")`;
}

function letterToColumn(letter){
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.toUpperCase().charCodeAt(i) - 64);
  }
  return col;
}

function columnToLetter(column) {
  let temp = '', letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

/***** 追加：ユーティリティ（エクスポート） *****/
function _toDateOrNull_(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function _fmtYmd_(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return `${y}-${m}-${day}`;
}

function _timestamp_() {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Kuala_Lumpur';
  return Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
}

function _richTextToPlain_(rtv, fallback) {
  try {
    if (rtv && typeof rtv.getText === 'function') return rtv.getText();
  } catch(e){}
  return (fallback == null) ? '' : String(fallback);
}

function _yyyymmddToSlash_(s8) {
  return `${s8.slice(0,4)}/${s8.slice(4,6)}/${s8.slice(6,8)}`;
}

/***** 追加：歌唱DB整理 ヘルパー *****/

// 同一URL重複用：古い方を残すため古い順で比較
function _compareOlderFirstForExactDup_(a, b) {
  const au = a.updatedMs == null ? -Infinity : a.updatedMs;
  const bu = b.updatedMs == null ? -Infinity : b.updatedMs;

  if (au !== bu) return au - bu; // 古い → 新しい
  return a.row - b.row;          // 上 → 下（下を新しい扱い）
}

// どちらを残すべきか比較。aが優先なら正数を返す
function _compareBetterSongRecord_(a, b) {
  // 1) C列優先: 歌ってみた > 歌枠 > ショート > その他
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;

  // 2) 同順位なら D列表示文字列の冒頭8桁 yyyymmdd が新しい方
  if (a.songDateNum !== b.songDateNum) return a.songDateNum - b.songDateNum;

  // 3) さらに同値なら G列（最新更新日）が新しい方
  const au = a.updatedMs == null ? -Infinity : a.updatedMs;
  const bu = b.updatedMs == null ? -Infinity : b.updatedMs;
  if (au !== bu) return au - bu;

  // 4) 最後は上にある行を優先
  return b.row - a.row;
}

function _detectSourceRank_(note) {
  const s = note == null ? '' : String(note).toLowerCase();

  let rank = 0;
  if (s.indexOf('歌ってみた') !== -1) rank = Math.max(rank, 300);
  if (s.indexOf('歌枠') !== -1)       rank = Math.max(rank, 200);
  if (s.indexOf('ショート') !== -1)   rank = Math.max(rank, 100);
  if (s.indexOf('short') !== -1)      rank = Math.max(rank, 100);
  if (s.indexOf('shorts') !== -1)     rank = Math.max(rank, 100);

  return rank;
}

function _sourceRankLabel_(rank) {
  if (rank >= 300) return '歌ってみた';
  if (rank >= 200) return '歌枠';
  if (rank >= 100) return 'ショート';
  return 'その他';
}

function _extractSongDateNumFromDisplay_(displayText) {
  const s = displayText == null ? '' : String(displayText).trim();
  const m = s.match(/^(\d{8})/);
  return m ? Number(m[1]) : 0;
}

function _normalizeSongKeyText_(v) {
  return String(v == null ? '' : v)
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _toMsOrNull_(v) {
  const d = _toDateOrNull_(v);
  return d ? d.getTime() : null;
}

// 行削除は下からまとめて行う
function _deleteRowsDescendingInChunks_(sh, rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return;

  const rows = rowNumbers.slice().sort((a, b) => b - a);
  let startRow = rows[0];
  let count = 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (row === startRow - 1) {
      count++;
      startRow = row;
      continue;
    }

    sh.deleteRows(startRow, count);
    startRow = row;
    count = 1;
  }

  sh.deleteRows(startRow, count);
}

/** シート上の図形ボタンに割り当てる入口（任意） */
function runExportDialogFromButton() {
  showExportDialog();
}
