/**
 * 雲丹ゐくら Songs DB TEST (GAS版)
 *
 * Script Properties:
 * - R2_SONGS_URL: R2 上の songs.json を取得できる URL（公開URL or 署名付きURL）
 * - R2_AUTH_TOKEN: （任意）Authorization: Bearer <token> に使うトークン
 */

function doGet(e) {
  if (e && e.parameter && e.parameter.api === 'songs') {
    return handleSongsApi_(e);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('雲丹ゐくら Songs DB TEST (GAS)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleSongsApi_(e) {
  try {
    const q = String((e.parameter.q || '')).trim().toLowerCase();
    const kind = e.parameter.kind || 'all';
    const sort = e.parameter.sort || 'latest';
    const limitRaw = e.parameter.limit;
    const hasLimit = limitRaw !== undefined && limitRaw !== null && String(limitRaw) !== '';
    const limit = hasLimit ? Math.min(200, Math.max(1, Number(limitRaw))) : null;

    const songs = loadSongsFromR2_();
    const now = new Date();
    const visibleSongs = songs.filter(song => isChecked_(song) && isInPublishWindow_(song, now));

    let filtered = visibleSongs.filter(song => {
      if (kind !== 'all' && String(song.kind || 'other') !== kind) return false;
      if (!q) return true;

      const target = [song.title, song.artist, song.memo]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return target.indexOf(q) !== -1;
    });

    filtered = sortSongs_(filtered, sort);
    if (hasLimit) {
      filtered = filtered.slice(0, limit);
    }

    return jsonOutput_({
      items: filtered,
      count: filtered.length,
      total: visibleSongs.length,
      sourceTotal: songs.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonOutput_({
      error: error.message || String(error),
    });
  }
}

function loadSongsFromR2_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('R2_SONGS_URL');
  const token = props.getProperty('R2_AUTH_TOKEN');

  if (!url) {
    throw new Error('Script Properties に R2_SONGS_URL を設定してください。');
  }

  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {},
  };

  if (token) {
    options.headers.Authorization = 'Bearer ' + token;
  }

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('R2 取得失敗: HTTP ' + code + ' / ' + res.getContentText());
  }

  const data = JSON.parse(res.getContentText());
  return Array.isArray(data) ? data : [];
}

function isChecked_(song) {
  const keys = ['checked', 'enabled', 'publish', 'active', 'isPublic', 'include'];
  const presentValues = keys.filter(key => Object.prototype.hasOwnProperty.call(song, key))
    .map(key => song[key]);

  if (presentValues.length === 0) return true;
  return presentValues.some(isTruthyMarker_);
}

function isInPublishWindow_(song, now) {
  if (isTruthyMarker_(song.paused) || isTruthyMarker_(song.temporaryHidden) || isTruthyMarker_(song.suspended)) {
    return false;
  }

  const from = parseDate_(song.visibleFrom || song.publishFrom || song.startAt);
  const to = parseDate_(song.visibleTo || song.publishTo || song.endAt || song.hiddenAt);

  if (from && now < from) return false;
  if (to && now > to) return false;
  return true;
}

function parseDate_(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isTruthyMarker_(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'checked', 'check', '✅', '☑', '✔'].indexOf(normalized) !== -1;
}

function sortSongs_(items, sort) {
  const cloned = items.slice();
  switch (sort) {
    case 'oldest':
      return cloned.sort((a, b) => dateOf_(a) - dateOf_(b));
    case 'title':
      return cloned.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
    case 'artist':
      return cloned.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'ja'));
    case 'latest':
    default:
      return cloned.sort((a, b) => dateOf_(b) - dateOf_(a));
  }
}

function dateOf_(item) {
  const timestamp = Date.parse((item && item.publishedAt) || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
