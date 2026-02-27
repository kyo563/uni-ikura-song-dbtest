export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'uni-ikura-song-dbtest-worker' });
    }

    if (url.pathname === '/api/songs') {
      return handleSongs(request, url, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleSongs(request, url, env) {
  const key = env.SONGS_JSON_KEY || 'songs.json';
  const head = await env.SONG_DB.head(key);

  if (!head) {
    return json({ error: `R2 object not found: ${key}` }, 404);
  }

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const kind = url.searchParams.get('kind') || 'all';
  const sort = url.searchParams.get('sort') || 'latest';
  const limitRaw = url.searchParams.get('limit');
  const hasLimit = limitRaw !== null && limitRaw !== '';
  const limit = hasLimit ? Math.min(200, Math.max(1, Number(limitRaw))) : null;

  const sourceEtag = normalizeEtag(head.httpEtag || head.etag || '');
  const responseEtag = `W/"${sourceEtag}:${hashOf([q, kind, sort, hasLimit ? limit : 'all'].join('|'))}"`;
  const ifNoneMatch = request.headers.get('if-none-match');

  if (ifNoneMatch && ifNoneMatch === responseEtag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: responseEtag,
        'cache-control': 'no-cache',
      },
    });
  }

  const object = await env.SONG_DB.get(key);
  if (!object) {
    return json({ error: `R2 object not found: ${key}` }, 404);
  }

  const raw = await object.text();
  const list = JSON.parse(raw);
  const sourceItems = Array.isArray(list) ? list : (Array.isArray(list?.items) ? list.items : []);
  const songs = sourceItems.map(normalizeSong);

  const now = new Date();
  const visibleSongs = songs.filter((song) => isChecked(song) && isInPublishWindow(song, now));

  let filtered = visibleSongs.filter((song) => {
    if (kind !== 'all' && (song.kind || 'other') !== kind) return false;
    if (!q) return true;

    const target = [song.title, song.artist, song.memo]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return target.includes(q);
  });

  filtered = sortSongs(filtered, sort);
  if (hasLimit) {
    filtered = filtered.slice(0, limit);
  }

  return json(
    {
      items: filtered,
      count: filtered.length,
      total: visibleSongs.length,
      sourceTotal: songs.length,
      updatedAt: object.uploaded?.toISOString?.() || null,
    },
    200,
    {
      etag: responseEtag,
      'cache-control': 'no-cache',
    },
  );
}

function isChecked(song) {
  const keys = ['checked', 'enabled', 'publish', 'active', 'isPublic', 'include', '掲載チェック'];
  const presentValues = keys
    .filter((key) => key in song)
    .map((key) => song[key]);

  if (presentValues.length === 0) return true;
  return presentValues.some(isTruthyMarker);
}

function normalizeSong(song) {
  const artist = firstText(song, ['artist', 'artistName', 'アーティスト名']);
  const title = firstText(song, ['title', 'song', 'songName', '曲名', '楽曲名']);
  const memo = firstText(song, ['memo', 'note', 'remarks', '備考']);

  const liveLinkTitle = firstText(song, ['liveLinkTitle', 'liveTitle', '歌枠タイトル', '歌枠直リンクタイトル']);
  const liveLinkRaw = firstText(song, ['liveLink', 'liveUrl', 'latestLiveLink', '歌枠直リンク']);
  const liveLink = song.liveLink || extractFirstUrl(liveLinkRaw);
  const otherLink = firstText(song, ['otherLink', 'coverLink', 'shortLink']) || extractFirstUrl(memo);
  const url = liveLink || otherLink || firstText(song, ['url']);

  const kindRaw = firstText(song, ['kind', 'type', 'category']);
  const kind = normalizeKind(kindRaw || memo);

  const ymd =
    firstYmd(firstText(song, ['publishedAt', 'date', 'lastSungDate', 'otherPublishedAt'])) ||
    firstYmd(liveLinkTitle) ||
    firstYmd(liveLinkRaw);

  const publishedAt = ymd ? toIsoDate(ymd) : firstText(song, ['publishedAt', 'date', 'lastSungDate', 'otherPublishedAt']);

  return {
    ...song,
    artist,
    title,
    memo,
    kind,
    liveLink,
    otherLink,
    url,
    linkLabel: liveLinkTitle || (liveLink ? '歌枠リンクを開く' : (otherLink ? '関連リンクを開く' : '')),
    publishedAt,
  };
}

function firstText(source, keys) {
  for (const key of keys) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function extractFirstUrl(text) {
  if (!text) return '';
  const m = String(text).match(/https?:\/\/[^\s)]+/i);
  return m ? m[0] : '';
}

function firstYmd(text) {
  if (!text) return '';
  const m = String(text).match(/(^|\D)(\d{8})(\D|$)/);
  return m ? m[2] : '';
}

function toIsoDate(ymd) {
  const y = ymd.slice(0, 4);
  const m = ymd.slice(4, 6);
  const d = ymd.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function normalizeKind(raw) {
  const text = String(raw || '').toLowerCase();
  if (!text) return 'other';
  if (text.includes('short') || text.includes('ショート')) return 'short';
  if (text.includes('cover') || text.includes('歌ってみた')) return 'cover';
  if (text.includes('live') || text.includes('歌枠') || text.includes('stream')) return 'live';
  return 'other';
}

function isInPublishWindow(song, now) {
  if (isTruthyMarker(song.paused) || isTruthyMarker(song.temporaryHidden) || isTruthyMarker(song.suspended)) {
    return false;
  }

  const from = parseDate(song.visibleFrom || song.publishFrom || song.startAt);
  const to = parseDate(song.visibleTo || song.publishTo || song.endAt || song.hiddenAt);

  if (from && now < from) return false;
  if (to && now > to) return false;
  return true;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTruthyMarker(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'checked', 'check', '✅', '☑', '✔'].includes(normalized);
}

function normalizeEtag(value) {
  return String(value).replaceAll('"', '').trim() || 'unknown';
}

function hashOf(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

function sortSongs(items, sort) {
  const cloned = [...items];
  switch (sort) {
    case 'oldest':
      return cloned.sort((a, b) => dateOf(a) - dateOf(b));
    case 'title':
      return cloned.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
    case 'artist':
      return cloned.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'ja'));
    case 'latest':
    default:
      return cloned.sort((a, b) => dateOf(b) - dateOf(a));
  }
}

function dateOf(item) {
  const t = Date.parse(item?.publishedAt || '');
  return Number.isNaN(t) ? 0 : t;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
