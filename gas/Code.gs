/**
 * Performance Record -> songs.json 用 API (GAS)
 *
 * 使い方:
 * 1) スプレッドシートに紐づく Apps Script にこのファイルを貼り付け
 * 2) デプロイ > 新しいデプロイ > ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセス権: リンクを知っている全員
 * 3) GitHub Actions から: https://.../exec?api=songs
 */

const SHEET_NAME = 'Performance Record';

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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet not found: ' + SHEET_NAME);
  }

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length <= 1) {
    return { items: [], total: 0, generatedAt: new Date().toISOString() };
  }

  const rows = values.slice(1);
  const items = [];

  rows.forEach((row, i) => {
    const artist = clean_(row[0]); // A
    const title = clean_(row[1]); // B
    const memo = clean_(row[2]); // C
    const liveField = clean_(row[3]); // D
    const source = clean_(row[4]); // E
    const checked = clean_(row[5]); // F

    if (!isChecked_(checked)) return;
    if (!artist || !title) return;

    const liveUrl = extractUrl_(liveField);
    const liveTitle = extractLiveTitle_(liveField);
    const liveYmd = extractYmd_(liveField);

    const memoUrl = extractUrl_(memo);
    const memoYmd = extractYmd_(memo);
    const memoKind = inferKindFromText_(memo);

    const hasLive = !!liveUrl;
    const hasOther = !!memoUrl;

    let kind = 'other';
    if (hasLive) kind = 'live';
    else if (memoKind) kind = memoKind;

    const item = {
      id: String(i + 2),
      title,
      artist,
      kind,
      memo,
      source,
      checked: true,
      liveLink: liveUrl || '',
      liveTitle: liveTitle || '',
      lastSungDate: liveYmd ? formatYmd_(liveYmd) : '',
      otherLink: hasOther ? memoUrl : '',
      otherPublishedAt: !hasLive && memoYmd ? formatYmd_(memoYmd) : '',
      // 互換フィールド（既存UI/Worker向け）
      url: liveUrl || memoUrl || '',
      publishedAt: liveYmd
        ? formatYmd_(liveYmd)
        : (!hasLive && memoYmd ? formatYmd_(memoYmd) : ''),
    };

    items.push(item);
  });

  return {
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function clean_(v) {
  return String(v || '').trim();
}

function isChecked_(value) {
  const v = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'checked', 'check', '✅', '☑', '✔'].indexOf(v) !== -1;
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
