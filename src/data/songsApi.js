export function loadCache({ cacheKey }) {
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function saveCache(entry, { cacheKey }) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(entry));
  } catch (_) {}
}

export function clearApiCache({ cacheKey }) {
  try {
    localStorage.removeItem(cacheKey());
  } catch (_) {}
}

export function isSameOriginRequest(url) {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch (_) {
    return false;
  }
}

export async function load(ctx) {
  const {
    setLoadingStatus,
    clearErrorLog,
    setErrorLog,
    setStoppedStatus,
    setRunningStatus,
    filterItems,
    render,
    headersToObject,
    clipText,
    cacheKey,
    requestCandidates,
    rows,
  } = ctx;

  setLoadingStatus();
  clearErrorLog();
  const cached = loadCache({ cacheKey });

  if (requestCandidates.length === 0) {
    setErrorLog({
      timestamp: new Date().toISOString(),
      errorName: 'MissingSongsJsonUrl',
      statusDescription: 'songs-r2-json-url が未設定',
    });
    rows.innerHTML = '<div class="error">データ取得先が未設定です。meta[name="songs-r2-json-url"] か localStorage("songs_r2_json_url") を設定してください。</div>';
    setStoppedStatus();
    return;
  }

  let requestUrl = requestCandidates[0];
  if (cached?.payload?.items) {
    const cachedItems = filterItems(Array.isArray(cached.payload.items) ? cached.payload.items : []);
    render(cachedItems, { total: cached?.payload?.total ?? cachedItems.length });
  }

  try {
    let res;
    let lastError = null;
    const requestAttemptLogs = [];

    for (const candidateUrl of requestCandidates) {
      requestUrl = candidateUrl;
      try {
        const shouldSendIfNoneMatch = cached?.etag && isSameOriginRequest(candidateUrl);
        res = await fetch(candidateUrl, {
          headers: shouldSendIfNoneMatch ? { 'If-None-Match': cached.etag } : {},
        });
      } catch (fetchErr) {
        lastError = fetchErr;
        requestAttemptLogs.push({ url: candidateUrl, status: 'network_error' });
        continue;
      }

      requestAttemptLogs.push({ url: candidateUrl, status: res.status });
      if (res.ok || res.status === 304) break;

      if (res.status !== 404) {
        const bodyText = await res.text();
        const httpError = new Error(`HTTP ${res.status}`);
        httpError.name = 'HttpResponseError';
        httpError.details = {
          status: res.status,
          statusText: res.statusText,
          headers: headersToObject(res.headers),
          bodyPreview: clipText(bodyText),
          attempts: requestAttemptLogs,
        };
        throw httpError;
      }

      lastError = new Error('HTTP 404');
      lastError.name = 'HttpResponseError';
      lastError.details = { attempts: requestAttemptLogs };
    }

    if (!res) throw lastError || new Error('Fetch failed');

    if (res.status === 304 && cached?.payload) {
      const cachedItems = filterItems(Array.isArray(cached.payload.items) ? cached.payload.items : []);
      render(cachedItems, { total: cached?.payload?.total ?? cachedItems.length });
      setRunningStatus(cachedItems.length, cached?.payload?.total ?? cachedItems.length);
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let payload;
    try {
      payload = await res.json();
    } catch (jsonErr) {
      const parseError = new Error('JSON parse failed');
      parseError.name = 'JsonParseError';
      parseError.details = {
        status: res.status,
        statusText: res.statusText,
        headers: headersToObject(res.headers),
      };
      parseError.cause = jsonErr;
      throw parseError;
    }

    const etag = res.headers.get('etag');
    const sourceItems = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
    const filteredItems = filterItems(sourceItems);
    render(filteredItems, { total: payload?.total ?? sourceItems.length });
    setRunningStatus(filteredItems.length, payload?.total ?? sourceItems.length);

    if (etag) saveCache({ etag, payload }, { cacheKey });
  } catch (err) {
    if (String(err?.message || '').includes('404')) {
      clearApiCache({ cacheKey });
    }
    const statusCode = err?.details?.status || (String(err?.message || '').match(/HTTP\s+(\d{3})/)?.[1] ?? null);
    setErrorLog({
      timestamp: new Date().toISOString(),
      errorName: err?.name || 'Error',
      statusCode,
      statusDescription: '通信エラー',
      message: String(err?.message || ''),
      attempts: err?.details?.attempts || null,
      requestUrl,
    });
    if (!cached?.payload) {
      rows.innerHTML = '<div class="error">データ取得に失敗しました。R2の公開URL設定を確認してください。</div>';
    }
    setStoppedStatus();
  }
}
