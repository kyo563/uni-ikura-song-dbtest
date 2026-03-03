/**
 * Performance Record -> songs.json 用 API (GAS)
 *
 * 使い方:
 * 1) スプレッドシートに紐づく Apps Script にこのファイルを貼り付け
 * 2) デプロイ > 新しいデプロイ > ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセス権: リンクを知っている全員
 * 3) GitHub Actions から: https://script.google.com/macros/s/AKfycbxSSq9yCXOD1TCbJwu4VS3Fd6YbWPUryzfTU6cFVThOcozGqbunEvQJNNarSgzAb7lZ/exec?api=songs
 */

const SHEET_NAME = 'Performance Record';
const REQUIRED_COLUMNS = 6;
const CHECKED_MARKERS = ['true', '1', 'yes', 'y', 'on', 'checked', 'check', '✅', '☑', '✔'];
const SPREADSHEET_ID = '1Rr1pYbfVcj0ae5EhzIsK8UbEIIE0cUz-00zjruxZQK0';

function doGet(e) {
  const api = String((e && e.parameter && e.parameter.api) || '');
  if (api === 'songs') {
    return outputJson_(buildSongsPayload_());
  }

  return ContentService.createTextOutput(
    'OK: add ?api=songs to fetch songs.json payload.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

function buildSongsPayload_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet not found: ' + SHEET_NAME + ' (シート名を確認してください)');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { items: [], total: 0, generatedAt: new Date().toISOString() };
  }

  // 現要件は A〜F のみ利用するため、必要列だけ読む
  const range = sheet.getRange(1, 1, lastRow, REQUIRED_COLUMNS);
  const values = range.getDisplayValues();
  const richTexts = range.getRichTextValues();
  const rows = values.slice(1);
  const items = [];

  // 重複データはスプレッドシート作成・編集時に解消される前提で扱う
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const richRow = richTexts[i + 1] || [];
    const artist = clean_(row[0]); // A
    const title = clean_(row[1]); // B
    const memo = clean_(row[2]); // C
    const liveField = clean_(row[3]); // D
    const memoRich = richRow[2] || null; // C rich text
    const liveRich = richRow[3] || null; // D rich text
    const source = clean_(row[4]); // E
    const checked = clean_(row[5]); // F

    if (!isChecked_(checked) || !artist || !title) continue;

    const liveUrl = extractCellUrl_(liveField, liveRich);
    const liveTitle = extractLiveTitle_(liveField);
    const liveYmd = extractYmd_(liveField);

    const memoUrl = extractCellUrl_(memo, memoRich);
    const memoYmd = extractYmd_(memo);
    const memoKind = inferKindFromText_(memo);

    const hasLive = !!liveUrl || !!liveYmd;
    const normalizedLiveDate = liveYmd ? formatYmd_(liveYmd) : '';
    const normalizedMemoDate = memoYmd ? formatYmd_(memoYmd) : '';
    const kind = hasLive ? 'live' : (memoKind || 'other');

    items.push({
      id: String(i + 2),
      title,
      artist,
      kind,
      memo,
      source,
      checked: true,
      liveLink: liveUrl || '',
      liveTitle: liveTitle || '',
      lastSungDate: normalizedLiveDate,
      otherLink: memoUrl || '',
      otherPublishedAt: hasLive ? '' : normalizedMemoDate,
      // 互換フィールド（既存UI/Worker向け）
      url: liveUrl || memoUrl || '',
      publishedAt: normalizedLiveDate || (hasLive ? '' : normalizedMemoDate),
    });
  }

  return {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  if (!SPREADSHEET_ID) {
    throw new Error(
      'Spreadsheet could not be resolved. Webアプリ実行時は getActiveSpreadsheet() が null になる場合があります。SPREADSHEET_ID を設定してください。'
    );
  }

  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (error) {
    throw new Error('Failed to open spreadsheet by SPREADSHEET_ID: ' + error.message);
  }
}

function clean_(v) {
  return String(v || '').trim();
}

function isChecked_(value) {
  const v = String(value || '').trim().toLowerCase();
  return CHECKED_MARKERS.includes(v);
}

function extractCellUrl_(text, richText) {
  const richUrl = extractRichTextUrl_(richText);
  return richUrl || extractUrl_(text);
}

function extractRichTextUrl_(richText) {
  if (!richText || typeof richText.getRuns !== 'function') return '';

  const direct = richText.getLinkUrl();
  if (direct) return String(direct).trim();

  const runs = richText.getRuns() || [];
  for (let i = 0; i < runs.length; i += 1) {
    const runUrl = runs[i].getLinkUrl();
    if (runUrl) return String(runUrl).trim();
  }
  return '';
}

function extractUrl_(text) {
  if (!text) return '';
  const m = String(text).match(/https?:\/\/[^\s)]+/i);
  return m ? m[0] : '';
}

function extractYmd_(text) {
  if (!text) return '';
  const m = String(text).match(/(^|\D)(\d{8})(\D|$)/);
  return m ? m[2] : '';
}

function formatYmd_(ymd) {
  return ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
}

function extractLiveTitle_(liveField) {
  if (!liveField) return '';
  const raw = String(liveField).trim();
  if (/^\d{8}$/.test(raw)) return '';

  const noUrl = raw.replace(/https?:\/\/[^\s)]+/ig, '').trim();
  const noDateHead = noUrl.replace(/^\d{8}[\s_-]*/, '').trim();
  return noDateHead;
}

function inferKindFromText_(memo) {
  const t = String(memo || '').toLowerCase();
  if (!t) return '';
  if (t.indexOf('ショート') !== -1 || t.indexOf('short') !== -1) return 'short';
  if (t.indexOf('歌ってみた') !== -1 || t.indexOf('cover') !== -1) return 'cover';
  return 'other';
}

function outputJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
