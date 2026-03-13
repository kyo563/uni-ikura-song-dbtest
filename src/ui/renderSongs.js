export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
    };
  }

  if (host.includes('nicovideo.jp') || host.includes('nico.ms')) {
    const idMatch = `${parsed.pathname}${parsed.search}${parsed.hash}`.match(/(?:sm|nm|so)(\d+)/i);
    if (!idMatch) return null;
    return {
      type: 'ニコニコ動画',
      thumbnailUrl: `https://tn.smilevideo.jp/smile?i=${encodeURIComponent(idMatch[1])}`,
    };
  }

  return null;
}

const renderStateByRows = new WeakMap();

function updatePreviewToggle(card, button, willShowPreview) {
  card.classList.toggle('preview-visible', willShowPreview);
  button.textContent = willShowPreview ? '▼リンクを閉じる' : '▶リンクを開く';
  button.setAttribute('aria-expanded', String(willShowPreview));
}

function ensureRowsDelegatedEvents(rows, deps = {}) {
  if (!rows || rows.dataset.delegatedEventsBound === '1') return;

  const {
    eventTargetElement,
    isInteractiveTarget,
    copyTextToClipboard,
    showToast,
    isMobileLayout,
    collapseExpandedCards,
  } = deps;

  rows.addEventListener('click', (evt) => {
    const targetEl = eventTargetElement(evt.target);
    const card = targetEl?.closest?.('.song-card');
    if (!card || !rows.contains(card)) return;

    const renderState = renderStateByRows.get(rows);
    if (!renderState) return;

    const { state, itemById } = renderState;
    const id = card.dataset.id || '';
    const item = itemById.get(id) || {};

    const previewToggleButton = targetEl?.closest?.('button[data-preview-toggle]');
    if (previewToggleButton) {
      updatePreviewToggle(card, previewToggleButton, !card.classList.contains('preview-visible'));
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

    state.selectedSongId = id;
    rows.dataset.selected = JSON.stringify(item);

    if (!isMobileLayout()) return;
    const willExpand = !card.classList.contains('expanded');
    collapseExpandedCards();
    if (willExpand) card.classList.add('expanded');
  });

  rows.addEventListener('keydown', (evt) => {
    const targetEl = eventTargetElement(evt.target);
    const card = targetEl?.closest?.('.song-card');
    if (!card || !rows.contains(card)) return;
    if (isInteractiveTarget(evt.target)) return;
    if (evt.key !== 'Enter' && evt.key !== ' ') return;

    const renderState = renderStateByRows.get(rows);
    if (!renderState) return;

    const id = card.dataset.id || '';
    const item = renderState.itemById.get(id) || {};
    evt.preventDefault();
    renderState.state.selectedSongId = id;
    rows.dataset.selected = JSON.stringify(item);
  });

  rows.dataset.delegatedEventsBound = '1';
}

export function applySelectionState(items, deps = {}) {
  const { rows, state, isMobileLayout } = deps;
  if (!rows || !state) return;

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

function buildCardElement(item, deps = {}) {
  const { stableSongId, fmtDate, resolveSingingTag, bestExternalUrl } = deps;
  const id = stableSongId(item);
  const detailLinks = linksForExpanded(item, { resolveSingingTag, bestExternalUrl });

  const article = document.createElement('article');
  article.className = 'song-card';
  article.dataset.id = id;
  article.tabIndex = 0;

  const main = document.createElement('div');
  main.className = 'song-card-main';

  const head = document.createElement('div');
  head.className = 'song-head';

  const summary = document.createElement('div');
  summary.className = 'song-summary';
  const title = document.createElement('div');
  title.className = 'song-title';
  title.textContent = String(item.title || '-');
  const artist = document.createElement('div');
  artist.className = 'song-artist';
  artist.textContent = String(item.artist || '-');
  summary.append(title, artist);

  const copyButton = document.createElement('button');
  copyButton.className = 'icon-btn copy-text-btn';
  copyButton.type = 'button';
  copyButton.dataset.copyKind = 'song-artist';
  copyButton.title = '楽曲名 / アーティスト名をコピー';
  copyButton.setAttribute('aria-label', '楽曲名 / アーティスト名をコピー');
  copyButton.textContent = 'コピー';
  head.append(summary, copyButton);

  const details = document.createElement('div');
  details.className = 'song-details';
  const meta = document.createElement('div');
  meta.className = 'song-meta';
  const metaTop = document.createElement('div');
  metaTop.className = 'song-meta-top';

  const tagWrap = document.createElement('div');
  if (detailLinks.singingTagLabel) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = detailLinks.singingTagLabel;
    tagWrap.appendChild(tag);
  } else {
    const muted = document.createElement('span');
    muted.className = 'muted';
    muted.textContent = '-';
    tagWrap.appendChild(muted);
  }

  const latest = document.createElement('div');
  latest.className = 'song-meta-latest';
  latest.textContent = `Latest: ${fmtDate(item.lastSungDate || item.publishedAt)}`;
  metaTop.append(tagWrap, latest);

  const linkRow = document.createElement('div');
  linkRow.className = 'song-link-row';
  if (detailLinks.detailUrl) {
    const linkInline = document.createElement('span');
    linkInline.className = 'song-link-inline';

    const toggleButton = document.createElement('button');
    toggleButton.className = 'song-date-link toggle-preview-btn';
    toggleButton.type = 'button';
    toggleButton.dataset.previewToggle = '';
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.textContent = '▶リンクを開く';
    linkInline.appendChild(toggleButton);

    const rawLinkTitle = String(item.liveTitle || item.linkLabel || item.lastSungDate || '').trim();
    if (rawLinkTitle) {
      const titleLink = document.createElement('a');
      titleLink.className = 'song-date-link song-link-title';
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.href = encodeURI(detailLinks.detailUrl);
      titleLink.textContent = rawLinkTitle;
      linkInline.appendChild(titleLink);
    }

    linkRow.appendChild(linkInline);

    const preview = extractVideoPreview(detailLinks.detailUrl);
    if (preview) {
      const previewWrap = document.createElement('div');
      previewWrap.className = 'song-preview-wrap';

      const previewCard = document.createElement('a');
      previewCard.className = 'song-preview-card song-detail-link';
      previewCard.target = '_blank';
      previewCard.rel = 'noopener noreferrer';
      previewCard.title = rawLinkTitle || 'リンクなし';
      previewCard.href = encodeURI(detailLinks.detailUrl);

      const img = document.createElement('img');
      img.className = 'song-preview-image';
      img.src = preview.thumbnailUrl;
      img.alt = `${preview.type}のサムネイル`;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';

      const previewLabel = document.createElement('p');
      previewLabel.className = 'song-preview-label';
      previewLabel.textContent = preview.type;

      previewCard.append(img, previewLabel);
      previewWrap.appendChild(previewCard);
      meta.appendChild(previewWrap);
    }
  } else {
    const muted = document.createElement('span');
    muted.className = 'muted';
    muted.textContent = 'リンクなし';
    linkRow.appendChild(muted);
  }

  meta.append(metaTop, linkRow);
  details.appendChild(meta);
  main.append(head, details);
  article.appendChild(main);

  return { card: article, id };
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

  ensureRowsDelegatedEvents(rows, deps);

  const fragment = document.createDocumentFragment();
  const topDummy = document.createElement('div');
  topDummy.className = 'dummy-top-card';
  topDummy.textContent = '--- TOP ---';
  fragment.appendChild(topDummy);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '該当データがありません';
    fragment.appendChild(empty);

    const endDummy = document.createElement('div');
    endDummy.className = 'dummy-end-card';
    endDummy.append('--- END --- ');
    const endLink = document.createElement('a');
    endLink.target = '_blank';
    endLink.rel = 'noopener noreferrer';
    endLink.href = 'https://lit.link/unisuke';
    endLink.textContent = 'https://lit.link/unisuke';
    endDummy.appendChild(endLink);
    fragment.appendChild(endDummy);

    rows.replaceChildren(fragment);
    renderStateByRows.set(rows, { state, itemById: new Map() });
    rows.dataset.selected = '{}';
    state.selectedSongId = '';
    return;
  }

  const itemById = new Map();
  items.forEach((item) => {
    const { card, id } = buildCardElement(item, { stableSongId, fmtDate, resolveSingingTag, bestExternalUrl });
    itemById.set(id, item);
    fragment.appendChild(card);
  });

  const endDummy = document.createElement('div');
  endDummy.className = 'dummy-end-card';
  endDummy.append('--- END --- ');
  const endLink = document.createElement('a');
  endLink.target = '_blank';
  endLink.rel = 'noopener noreferrer';
  endLink.href = 'https://lit.link/unisuke';
  endLink.textContent = 'https://lit.link/unisuke';
  endDummy.appendChild(endLink);
  fragment.appendChild(endDummy);

  rows.replaceChildren(fragment);
  renderStateByRows.set(rows, { state, itemById });
  applySelectionState(items, deps);
}
