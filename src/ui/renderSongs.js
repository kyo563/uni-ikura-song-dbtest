export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitSingingTags(text) {
  return String(text || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function tagClassForLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === '歌ってみた' || normalized === '歌みた' || normalized === 'cover') {
    return 'tag-utattemita';
  }
  if (normalized === '歌枠' || normalized === 'live' || normalized === 'stream') {
    return 'tag-utawaku';
  }
  if (normalized === 'ショート' || normalized === 'short') {
    return 'tag-short';
  }
  return '';
}

export function linksForExpanded(item, deps = {}) {
  const { resolveSingingTag = () => ({ label: '' }), bestExternalUrl = () => '' } = deps;
  const rawTagText = String(item.singingTag || item.memo || '').trim();
  const resolvedTag = resolveSingingTag(rawTagText);
  const singingTagLabel = resolvedTag.label || rawTagText;

  const liveUrl = bestExternalUrl(item.liveLink) || bestExternalUrl(item.singingTagLink);
  const detailUrl = liveUrl || bestExternalUrl(item.url);

  return {
    singingTagLabel,
    singingTagUrl: liveUrl,
    latestDateUrl: liveUrl,
    detailUrl,
  };
}

export function extractVideoPreview(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    let videoId = '';
    if (host.includes('youtu.be')) {
      videoId = path.split('/').filter(Boolean)[0] || '';
    } else {
      videoId = parsed.searchParams.get('v') || '';
      if (!videoId && path.startsWith('/shorts/')) videoId = path.split('/')[2] || '';
      if (!videoId && path.startsWith('/embed/')) videoId = path.split('/')[2] || '';
    }
    if (!videoId) return null;
    return {
      type: 'YouTube',
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      referrerPolicy: 'no-referrer',
    };
  }

  if (host.includes('nicovideo.jp') || host.includes('nico.ms')) {
    const idMatch = `${parsed.pathname}${parsed.search}${parsed.hash}`.match(/(?:sm|nm|so)\d+/i);
    if (!idMatch) return null;
    const videoId = idMatch[0].toLowerCase();
    const numericId = videoId.replace(/^[a-z]+/i, '');
    return {
      type: 'ニコニコ動画',
      thumbnailUrl: `https://nicovideo.cdn.nimg.jp/thumbnails/${encodeURIComponent(numericId)}/${encodeURIComponent(numericId)}`,
      fallbackThumbnailUrl: `https://tn.smilevideo.jp/smile?i=${encodeURIComponent(numericId)}`,
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
  }

  return null;
}

export function render(items, totals = {}, deps = {}) {
  const {
    rows,
    selectedCount,
    totalCount,
    state,
    stableSongId,
    fmtDate,
    eventTargetElement,
    isInteractiveTarget,
    copyTextToClipboard,
    showToast,
    isMobileLayout,
    collapseExpandedCards,
    resolveSingingTag,
    bestExternalUrl,
  } = deps;

  selectedCount.textContent = String(items.length);
  totalCount.textContent = String(totals.total ?? items.length);

  if (!items.length) {
    rows.innerHTML = '<div class="dummy-top-card">--- TOP ---</div><div class="muted">該当データがありません</div><div class="dummy-end-card">--- END --- <a href="https://lit.link/unisuke" target="_blank" rel="noopener noreferrer">https://lit.link/unisuke</a></div>';
    rows.dataset.selected = '{}';
    state.selectedSongId = '';
    return;
  }

  const cardsHtml = items.map((item) => {
    const id = stableSongId(item);
    const detailLinks = linksForExpanded(item, { resolveSingingTag, bestExternalUrl });
    const rawTagText = detailLinks.singingTagLabel || String(item.singingTag || item.memo || '').trim();
    const tagLabels = splitSingingTags(rawTagText);
    const singingTagHtml = tagLabels.length
      ? tagLabels
        .map((label) => {
          const extraClass = tagClassForLabel(label);
          const className = extraClass ? `tag ${extraClass}` : 'tag';
          return `<span class="${className}">${escapeHtml(label)}</span>`;
        })
        .join(' ')
      : '<span class="muted">-</span>';
    const latestDate = escapeHtml(fmtDate(item.lastSungDate || item.publishedAt));
    const rawLinkTitle = String(item.liveTitle || item.linkLabel || item.lastSungDate || '').trim();
    const fallbackLinkLabel = escapeHtml(rawLinkTitle || 'リンクなし');
    const fallbackLinkTitle = rawLinkTitle
      ? `<a class="song-date-link song-link-title" href="${escapeHtml(encodeURI(detailLinks.detailUrl || ''))}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawLinkTitle)}</a>`
      : '';
    const fallbackLinkHtml = detailLinks.detailUrl
      ? `<span class="song-link-inline"><button class="song-date-link toggle-preview-btn" type="button" data-preview-toggle aria-expanded="false">▶リンクを開く</button>${fallbackLinkTitle}</span>`
      : '<span class="muted">リンクなし</span>';
    const preview = extractVideoPreview(detailLinks.detailUrl);
    const previewHtml = preview
      ? `<div class="song-preview-wrap"><a class="song-preview-card song-detail-link" href="${escapeHtml(encodeURI(detailLinks.detailUrl))}" target="_blank" rel="noopener noreferrer" title="${fallbackLinkLabel}"><img class="song-preview-image" src="${escapeHtml(preview.thumbnailUrl)}" alt="${escapeHtml(preview.type)}のサムネイル" loading="lazy" referrerpolicy="${escapeHtml(preview.referrerPolicy || 'no-referrer')}" data-fallback-thumbnail="${escapeHtml(preview.fallbackThumbnailUrl || '')}" /><p class="song-preview-label">${escapeHtml(preview.type)}</p></a></div>`
      : '';
    return `<article class="song-card" data-id="${id}" tabindex="0"><div class="song-card-main"><div class="song-head"><div class="song-summary"><div class="song-title">${escapeHtml(item.title || '-')}</div><div class="song-artist">${escapeHtml(item.artist || '-')}</div></div><button class="icon-btn copy-text-btn" type="button" data-copy-kind="song-artist" title="楽曲名 / アーティスト名をコピー" aria-label="楽曲名 / アーティスト名をコピー">コピー</button></div><div class="song-details"><div class="song-meta"><div class="song-meta-top"><div>${singingTagHtml}</div><div class="song-meta-latest">Latest: ${latestDate}</div></div><div class="song-link-row">${fallbackLinkHtml}</div>${previewHtml}</div></div></div></article>`;
  }).join('');

  rows.innerHTML = '<div class="dummy-top-card">--- TOP ---</div>' + cardsHtml + '<div class="dummy-end-card">--- END --- <a href="https://lit.link/unisuke" target="_blank" rel="noopener noreferrer">https://lit.link/unisuke</a></div>';

  rows.querySelectorAll('.song-card').forEach((el, idx) => {
    const item = items[idx] || {};
    const id = el.dataset.id || '';
    const select = () => {
      state.selectedSongId = id;
      rows.dataset.selected = JSON.stringify(item);
    };

    el.addEventListener('click', (evt) => {
      const targetEl = eventTargetElement(evt.target);
      const previewToggleButton = targetEl?.closest?.('button[data-preview-toggle]');
      if (previewToggleButton) {
        const willShowPreview = !el.classList.contains('preview-visible');
        el.classList.toggle('preview-visible', willShowPreview);
        previewToggleButton.textContent = willShowPreview ? '▼リンクを閉じる' : '▶リンクを開く';
        previewToggleButton.setAttribute('aria-expanded', String(willShowPreview));
        evt.stopPropagation();
        return;
      }
      if (targetEl?.closest?.('a.song-detail-link, a.song-date-link')) {
        evt.stopPropagation();
        return;
      }
      if (targetEl?.closest?.('button[data-copy-kind]')) {
        evt.preventDefault();
        evt.stopPropagation();
        const text = [String(item.title || '').trim(), String(item.artist || '').trim()].filter(Boolean).join(' / ');
        copyTextToClipboard(text).then((copied) => { if (copied) showToast('コピーしました'); });
        return;
      }

      select();
      if (!isMobileLayout()) return;
      const willExpand = !el.classList.contains('expanded');
      collapseExpandedCards();
      if (willExpand) el.classList.add('expanded');
    });

    el.addEventListener('keydown', (evt) => {
      if (isInteractiveTarget(evt.target)) return;
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      evt.preventDefault();
      select();
    });
  });

  rows.querySelectorAll('.song-preview-image').forEach((img) => {
    img.addEventListener('error', () => {
      const fallbackUrl = String(img.dataset.fallbackThumbnail || '').trim();
      const hasTriedFallback = img.dataset.fallbackTried === '1';
      if (fallbackUrl && !hasTriedFallback) {
        img.dataset.fallbackTried = '1';
        img.src = fallbackUrl;
        return;
      }
      const wrap = img.closest('.song-preview-wrap');
      if (wrap) wrap.remove();
    });
  });

  if (!rows.querySelector(`.song-card[data-id="${CSS.escape(state.selectedSongId)}"]`)) {
    const first = rows.querySelector('.song-card');
    if (first) {
      state.selectedSongId = first.dataset.id || '';
      rows.dataset.selected = JSON.stringify(items[0] || {});
    }
  }

  if (!isMobileLayout()) {
    rows.querySelectorAll('.song-card').forEach((card) => card.classList.add('expanded'));
  }
}
