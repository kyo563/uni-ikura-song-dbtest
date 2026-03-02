export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    if (url.pathname === '/api/health') {
      return handleHealth(request, env);
    }

    if (url.pathname === '/api/songs') {
      return handleSongs(request, url, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleHealth(request, env) {
  const key = env.SONGS_JSON_KEY || 'songs.json';
  try {
    const head = await env.SONG_DB?.head?.(key);
    return json(request, {
      ok: true,
      service: 'uni-ikura-song-dbtest-worker',
      r2: {
        key,
        exists: Boolean(head),
      },
    });
  } catch (error) {
    return json(request, {
      ok: false,
      service: 'uni-ikura-song-dbtest-worker',
      error: error?.message || 'Health check failed',
      hint: 'Check SONG_DB binding and R2 configuration.',
    }, 500);
  }
}

async function handleSongs(request, url, env) {
  const key = env.SONGS_JSON_KEY || 'songs.json';
  if (!env.SONG_DB || typeof env.SONG_DB.get !== 'function' || typeof env.SONG_DB.head !== 'function') {
    return json(request, {
      error: 'SONG_DB binding is not available',
      hint: 'Check wrangler.toml [[r2_buckets]] binding name.',
    }, 500);
  }

  const head = await env.SONG_DB.head(key);

  if (!head) {
    return json(request, {
      error: `R2 object not found: ${key}`,
      key,
      hint: 'Check SONG_DB binding, SONGS_JSON_KEY, and object key in R2.',
    }, 404);
  }

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const kind = url.searchParams.get('kind') || 'all';
  const sort = url.searchParams.get('sort') || 'latest';
  const sourceEtag = normalizeEtag(head.httpEtag || head.etag || '');
  const responseEtag = `W/"${sourceEtag}:${hashOf([q, kind, sort, 'all'].join('|'))}"`;
  const ifNoneMatch = request.headers.get('if-none-match');

  if (ifNoneMatch && ifNoneMatch === responseEtag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders(request),
        etag: responseEtag,
        'cache-control': 'no-cache',
      },
    });
  }

  const object = await env.SONG_DB.get(key);
  if (!object) {
    return json(request, {
      error: `R2 object not found: ${key}`,
      key,
      hint: 'Check SONG_DB binding, SONGS_JSON_KEY, and object key in R2.',
    }, 404);
  }

  const raw = await object.text();
  let list;
  try {
    list = JSON.parse(raw);
  } catch (_) {
    return json(request, {
      error: 'Invalid songs JSON in R2 object',
      key,
      hint: 'songs.json must be valid JSON.',
    }, 502);
  }
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

  return json(
    request,
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
  const kindFromField = normalizeKind(kindRaw);
  const kind = kindFromField === 'other' ? normalizeKind(memo) : kindFromField;

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

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'If-None-Match,Content-Type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(request, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
