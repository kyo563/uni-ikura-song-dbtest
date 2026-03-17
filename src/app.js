import { state, DEFAULT_KINDS, KIND_MAP, KIND_LABELS } from './state/appState.js';
import { byId } from './ui/dom.js';
import { setStatus, setLoadingStatus, setRunningStatus, setStoppedStatus, setErrorStatus } from './ui/status.js';
import { render } from './ui/renderSongs.js';
import { load } from './data/songsApi.js';

const CACHE_PREFIX = 'songs-cache-v3';
const DATA_CACHE_KEY = 'dataset';
const DATA_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
const MY_DANMAKU_CACHE_KEY = 'my-danmaku-cache-v1';
const MY_DANMAKU_CACHE_MS = 15 * 60 * 1000;
const SWIPE_HINT_INTERVAL_MS = 3 * 60 * 1000;
const MAX_ERROR_BODY_CHARS = 4000;
const ENABLE_ERROR_LOG_UI = true;

function songsCacheKey() {
  return `${CACHE_PREFIX}:${DATA_CACHE_KEY}`;
}

const rows = byId('rows');
const selectedCount = byId('selectedCount');
const totalCount = byId('totalCount');
const toast = byId('toast');
const errorLogWrap = byId('errorLogWrap');
const errorLog = byId('errorLog');
const scrollBubbles = byId('scrollBubbles');

let latestErrorLogText = '';
let toastTimer = null;
let sourceItemsCache = [];
let sourceTotalCache = 0;
let hasSourceItemsCache = false;

function showToast(text, durationMs = 300) {
      if (!toast || !text) return;
      toast.textContent = text;
      toast.classList.add('show');
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toast.classList.remove('show');
      }, durationMs);
    }

function clipText(value, max = MAX_ERROR_BODY_CHARS) {
      const text = String(value ?? '');
      if (text.length <= max) return text;
      return `${text.slice(0, max)}\n...<truncated ${text.length - max} chars>`;
    }

function headersToObject(headers) {
      const picked = ['content-type', 'cache-control', 'etag', 'cf-ray', 'server', 'date'];
      const obj = {};
      for (const key of picked) {
        const value = headers.get(key);
        if (value) obj[key] = value;
      }
      return obj;
    }

    function setErrorLog(logObject) {
      latestErrorLogText = JSON.stringify(logObject, null, 2);
      if (ENABLE_ERROR_LOG_UI) {
        errorLog.textContent = latestErrorLogText;
        errorLogWrap.classList.add('show');
        syncTopPanelSize();
      }
      console.error('songs-db-detailed-error', logObject);
    }

    function clearErrorLog() {
      latestErrorLogText = '';
      if (ENABLE_ERROR_LOG_UI) {
        errorLog.textContent = 'エラー時に情報を表示します。';
      }
      errorLogWrap.classList.remove('show');
      syncTopPanelSize();
    }

    async function copyErrorLog() {
      if (!latestErrorLogText) {
        showToast('ログなし');
        return;
      }
      const copied = await copyTextToClipboard(latestErrorLogText);
      if (!copied) {
        setErrorStatus();
      }
    }

    let setSwipeCard = () => {};
    let setTopSwipeCard = () => {};
    let getTopSwipeCard = () => 0;
    let triggerSwipeHint = () => {};
    let swipeHintIntervalId = null;
    let topMenuCollapsed = false;
    let topSwipeCardIndex = 0;

    function setupSwipeTrack({ wrap, track, panelWidthPercent = 50, onCardChange = null }) {
      let current = 0;
      let dragging = false;
      let startX = 0;
      let deltaX = 0;
      let pointerId = null;

      const setCard = (index, withAnimation = true) => {
        current = Math.max(0, Math.min(1, index));
        track.style.transition = withAnimation
          ? 'transform 0.45s cubic-bezier(0.2, 0.9, 0.2, 1)'
          : 'none';
        track.style.transform = `translateX(${-current * panelWidthPercent}%)`;
        if (typeof onCardChange === 'function') {
          onCardChange(current);
        }
      };

      const getThreshold = () => Math.max(54, wrap.clientWidth * 0.12);

      const onPointerMove = (evt) => {
        if (!dragging || evt.pointerId !== pointerId) return;
        deltaX = evt.clientX - startX;
        const base = -current * panelWidthPercent;
        const ratio = (deltaX / wrap.clientWidth) * panelWidthPercent;
        const next = Math.max(-panelWidthPercent, Math.min(0, base + ratio));
        track.style.transform = `translateX(${next}%)`;
      };

      const onPointerUp = (evt) => {
        if (!dragging || evt.pointerId !== pointerId) return;
        dragging = false;
        track.classList.remove('dragging');
        track.releasePointerCapture(pointerId);
        const threshold = getThreshold();
        if (Math.abs(deltaX) > threshold) {
          if (deltaX < 0) setCard(current + 1);
          else setCard(current - 1);
        } else {
          setCard(current);
        }
        pointerId = null;
        deltaX = 0;
      };

      track.addEventListener('pointerdown', (evt) => {
        if (evt.pointerType === 'mouse' && evt.button !== 0) return;
        dragging = true;
        startX = evt.clientX;
        deltaX = 0;
        pointerId = evt.pointerId;
        track.classList.add('dragging');
        track.setPointerCapture(pointerId);
      });

      track.addEventListener('pointermove', onPointerMove);
      track.addEventListener('pointerup', onPointerUp);
      track.addEventListener('pointercancel', onPointerUp);

      setCard(0, false);
      return {
        setCard,
        getCurrent: () => current,
      };
    }

    function updatePageIndicator(indicator, activeIndex) {
      if (!indicator) return;
      const dots = indicator.querySelectorAll('.dot');
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === activeIndex);
      });
    }


    function getCollapsedTopHeight(topForm, filterPanel) {
      if (!topForm || !filterPanel) return 0;
      const wasCollapsed = topForm.classList.contains('collapsed');
      topForm.classList.add('collapsed');
      const statusSummary = filterPanel.querySelector('.top-summary .summary-box');
      const collapsedHeightBase = Math.ceil((statusSummary || filterPanel).getBoundingClientRect().height);
      const collapsedHeight = collapsedHeightBase + 2;
      if (!wasCollapsed) {
        topForm.classList.remove('collapsed');
      }
      return collapsedHeight;
    }

    function applyTopFormCollapsedState() {
      const topForm = byId('topForm');
      if (!topForm) return;
      const shouldCollapse = topSwipeCardIndex === 0 && topMenuCollapsed;
      topForm.classList.toggle('collapsed', shouldCollapse);
    }

    function setTopMenuCollapsed(nextCollapsed) {
      topMenuCollapsed = Boolean(nextCollapsed);
      applyTopFormCollapsedState();
      syncTopPanelSize();
      updateDummyCardsHeight();
    }

    function syncTopPanelSize() {
      const filterPanel = document.querySelector('.top-panel[aria-label="絞り込みカード"]');
      const topForm = byId('topForm');
      if (!filterPanel || !topForm) return;

      const hasCollapsed = topForm.classList.contains('collapsed');

      topForm.classList.remove('collapsed');
      const expandedHeight = Math.ceil(filterPanel.getBoundingClientRect().height);

      const collapsedHeight = getCollapsedTopHeight(topForm, filterPanel);

      topForm.classList.toggle('collapsed', hasCollapsed);

      if (expandedHeight > 0) {
        topForm.style.setProperty('--top-expanded-height', `${expandedHeight}px`);
      }
      if (collapsedHeight > 0) {
        topForm.style.setProperty('--top-collapsed-height', `${collapsedHeight}px`);
      }

      window.requestAnimationFrame(() => {
        updateMiddleCardsHeight();
        updateDummyCardsHeight();
      });
    }

    function setupTopSwipe() {
      const wrap = byId('topSwipeWrap');
      const track = byId('topSwipeTrack');
      const memoInput = byId('memoInput');
      const topForm = byId('topForm');
      const topPageIndicator = byId('topPageIndicator');
      const collapseButton = byId('collapseTopMenu');
      const expandButton = byId('expandTopMenu');

      if (!wrap || !track) return;
      const topSwipe = setupSwipeTrack({
        wrap,
        track,
        panelWidthPercent: 50,
        onCardChange: (index) => {
          topSwipeCardIndex = index;
          updatePageIndicator(topPageIndicator, index);
          const isMemo = index === 1;
          topForm?.classList.toggle('memo-active', isMemo);
          if (isMemo) {
            setTopMenuCollapsed(false);
            return;
          }
          applyTopFormCollapsedState();
          syncTopPanelSize();
          updateDummyCardsHeight();
        },
      });
      setTopSwipeCard = topSwipe.setCard;
      getTopSwipeCard = topSwipe.getCurrent;

      if (memoInput) {
        memoInput.addEventListener('focus', () => {
          setTopSwipeCard(1);
        });
      }

      collapseButton?.addEventListener('click', () => {
        if (!topForm || topSwipeCardIndex !== 0) return;
        setTopMenuCollapsed(true);
      });

      expandButton?.addEventListener('click', () => {
        if (!topForm) return;
        setTopMenuCollapsed(false);
      });

      syncTopPanelSize();
      window.addEventListener('resize', syncTopPanelSize);
    }

    function setupBottomSwipe() {
      const wrap = byId('bottomSwipeWrap');
      const track = byId('bottomSwipeTrack');
      const bottomPageIndicator = byId('bottomPageIndicator');
      const stopHint = () => {
        track.classList.remove('hinting');
      };

      const startHint = () => {
        track.classList.remove('hinting');
        void track.offsetWidth;
        track.classList.add('hinting');
        window.setTimeout(() => {
          track.classList.remove('hinting');
        }, 6500);
      };

      const bottomSwipe = setupSwipeTrack({
        wrap,
        track,
        panelWidthPercent: 50,
        onCardChange: (index) => {
          updatePageIndicator(bottomPageIndicator, index);
        },
      });
      const setCard = bottomSwipe.setCard;

      track.addEventListener('pointerdown', () => {
        stopHint();
      });
      byId('q').addEventListener('focus', stopHint, { once: true });
      byId('myEmoji').addEventListener('focus', stopHint, { once: true });

      byId('danmakuType').addEventListener('change', (evt) => {
        if (evt.target.value === 'my') setCard(1);
      });

      byId('saveMyDanmaku').addEventListener('click', () => {
        setCard(0);
      });

      setSwipeCard = setCard;
      triggerSwipeHint = startHint;

      startHint();
    }


    function createScrollBubbles(mode = 'normal') {
      if (!scrollBubbles) return;
      if (scrollBubbles.childElementCount > 0) return;
      const burst = mode === 'burst';
      const bubbleCount = burst ? 6 : 2;
      for (let i = 0; i < bubbleCount; i += 1) {
        const bubble = document.createElement('span');
        bubble.className = 'scroll-bubble';
        const size = burst ? 12 + Math.random() * 24 : 8 + Math.random() * 18;
        bubble.style.left = `${6 + Math.random() * 88}%`;
        bubble.style.width = `${size}px`;
        bubble.style.height = `${size}px`;
        bubble.style.animationDelay = `${i * 0.08}s`;
        bubble.style.animationDuration = burst
          ? `${2.2 + Math.random() * 0.9}s`
          : `${2.6 + Math.random() * 1.4}s`;
        scrollBubbles.appendChild(bubble);
        window.setTimeout(() => bubble.remove(), 5200);
      }
    }

    function collapseExpandedWhenOutOfView() {
      if (!isMobileLayout()) return;
      const activeCards = rows.querySelectorAll('.song-card.expanded, .song-card.preview-visible');
      if (!activeCards.length) return;
      const rowsRect = rows.getBoundingClientRect();
      activeCards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const isOutOfView = cardRect.bottom <= rowsRect.top || cardRect.top >= rowsRect.bottom;
        if (!isOutOfView) return;
        card.classList.remove('expanded');
        if (card.classList.contains('preview-visible')) {
          card.classList.remove('preview-visible');
          const toggleBtn = card.querySelector('button[data-preview-toggle]');
          if (toggleBtn) {
            toggleBtn.textContent = '▶リンクを開く';
            toggleBtn.setAttribute('aria-expanded', 'false');
          }
        }
      });
    }

    function updateMiddleCardsHeight() {
      if (!rows) return;

      const middleForm = document.querySelector('.middle-form');
      if (!middleForm) return;

      const middleRect = middleForm.getBoundingClientRect();
      const available = Math.floor(middleRect.height - 4);
      if (available > 120) {
        rows.style.maxHeight = `${available}px`;
      } else {
        rows.style.removeProperty('max-height');
      }
    }

    function updateDummyCardsHeight() {
      const topForm = byId('topForm');
      if (topForm) {
        const rootStyle = getComputedStyle(document.documentElement);
        const fixedTopDummyHeight = rootStyle.getPropertyValue('--dummy-top-card-height-fixed').trim();
        if (fixedTopDummyHeight && fixedTopDummyHeight !== 'auto') {
          document.documentElement.style.setProperty('--dummy-top-card-height', fixedTopDummyHeight);
        } else {
          const isCollapsed = topForm.classList.contains('collapsed');
          const topVarName = isCollapsed
            ? '--top-collapsed-height'
            : '--top-expanded-height';
          const topCssHeight = getComputedStyle(topForm).getPropertyValue(topVarName).trim();
          const extraExpanded = rootStyle.getPropertyValue('--dummy-top-card-extra-expanded').trim() || '3px';
          const extraCollapsed = rootStyle.getPropertyValue('--dummy-top-card-extra-collapsed').trim() || '7px';
          const extraTopDummy = isCollapsed ? extraCollapsed : extraExpanded;
          if (topCssHeight) {
            document.documentElement.style.setProperty('--dummy-top-card-height', `calc(${topCssHeight} + ${extraTopDummy})`);
          } else {
            const topHeight = Math.ceil(topForm.getBoundingClientRect().height);
            if (topHeight > 0) {
              document.documentElement.style.setProperty('--dummy-top-card-height', `calc(${topHeight}px + ${extraTopDummy})`);
            }
          }
        }
      }

      const searchPanel = document.querySelector('.bottom-panel[aria-label="検索フォームカード"]');
      if (!searchPanel) return;
      const bottomHeight = Math.ceil(searchPanel.getBoundingClientRect().height * 2);
      if (bottomHeight > 0) {
        document.documentElement.style.setProperty('--dummy-end-card-height', `${bottomHeight}px`);
      }
    }

    function buildMyDanmaku(emoji) {
      const raw = (emoji || '').trim();
      const safeEmoji = raw || '🙂';
      const emojiLength = Array.from(safeEmoji).length;
      const repeat = emojiLength >= 3 ? 2 : 3;
      return `🍣🧡${safeEmoji}`.repeat(repeat);
    }

    function saveMyDanmakuCache(text) {
      const entry = { value: text, expiresAt: Date.now() + MY_DANMAKU_CACHE_MS };
      state.myDanmaku = text;
      try {
        sessionStorage.setItem(MY_DANMAKU_CACHE_KEY, JSON.stringify(entry));
      } catch (_) {}
    }

    function loadMyDanmakuCache() {
      try {
        const raw = sessionStorage.getItem(MY_DANMAKU_CACHE_KEY);
        if (!raw) return '';
        const entry = JSON.parse(raw);
        if (!entry?.value || Date.now() > Number(entry.expiresAt || 0)) {
          sessionStorage.removeItem(MY_DANMAKU_CACHE_KEY);
          return '';
        }
        return String(entry.value);
      } catch (_) {
        return '';
      }
    }

    function fmtDate(value) {
      if (!value) return '-';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('ja-JP');
    }

    function normalizeKind(kind) {
      const raw = String(kind || '').trim();
      if (!raw) return 'other';
      const lowered = raw.toLowerCase();
      if (KIND_MAP[lowered]) return KIND_MAP[lowered];
      if (KIND_MAP[raw]) return KIND_MAP[raw];
      if (lowered.includes('short') || raw.includes('ショート')) return 'short';
      if (lowered.includes('cover') || raw.includes('歌ってみた') || raw.includes('歌みた')) return 'cover';
      if (lowered.includes('live') || lowered.includes('stream') || raw.includes('歌枠') || raw.includes('配信')) return 'live';
      return 'other';
    }

    function kindLabel(kind) {
      return KIND_LABELS[kind] || 'その他';
    }

    function dateOf(item) {
      const t = Date.parse(item?.publishedAt || '');
      return Number.isNaN(t) ? 0 : t;
    }

    function eventTargetElement(target) {
      if (target instanceof Element) return target;
      return target?.parentElement || null;
    }

    function isInteractiveTarget(target) {
      const el = eventTargetElement(target);
      return Boolean(el?.closest?.('a, button, input, select, textarea, [role="button"]'));
    }

    function urlsFromText(text) {
      if (!text) return [];
      const matches = String(text).match(/https?:\/\/[^\s)]+/ig) || [];
      return Array.from(new Set(matches.map((url) => url.trim()).filter(Boolean)));
    }

    function hrefUrlsFromHtml(text) {
      if (!text) return [];
      const source = String(text);
      const urls = [];
      const hrefPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/ig;
      let match;
      while ((match = hrefPattern.exec(source)) !== null) {
        const candidate = normalizeExternalUrl(match[1] || match[2] || match[3]);
        if (candidate) urls.push(candidate);
      }
      return Array.from(new Set(urls));
    }

    function normalizeExternalUrl(value) {
      const url = String(value || '').trim();
      return /^https?:\/\//i.test(url) ? url : '';
    }

    function bestExternalUrl(value) {
      const direct = normalizeExternalUrl(value);
      if (direct) return direct;

      const hrefUrl = hrefUrlsFromHtml(value)[0];
      if (hrefUrl) return hrefUrl;

      return urlsFromText(value)[0] || '';
    }

    function resolveSingingTag(text) {
      const raw = String(text || '').trim();
      if (!raw) return { kind: 'other', label: '' };
      const lowered = raw.toLowerCase();

      if (lowered.includes('short') || raw.includes('ショート')) {
        return { kind: 'short', label: 'ショート' };
      }

      if (lowered.includes('cover') || raw.includes('歌ってみた') || raw.includes('歌みた')) {
        return { kind: 'cover', label: '歌ってみた' };
      }

      if (lowered.includes('live') || lowered.includes('stream') || raw.includes('歌枠') || raw.includes('配信')) {
        return { kind: 'live', label: '' };
      }

      return { kind: 'other', label: '' };
    }

    function kindForFilter(item) {
      const tagText = String(item?.singingTag || item?.memo || '').trim();
      if (tagText) {
        return resolveSingingTag(tagText).kind;
      }
      return normalizeKind(item?.kind);
    }

    function stableSongId(item) {
      const videoId = String(item?.videoId || item?.videoid || item?.video_id || '').trim();
      const title = String(item?.title || '').trim();
      const artist = String(item?.artist || '').trim();
      return [videoId, title, artist].map((part) => encodeURIComponent(part)).join('|');
    }

    function isMobileLayout() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function collapseExpandedCards() {
      rows.querySelectorAll('.song-card.expanded').forEach((card) => {
        card.classList.remove('expanded');
      });
    }

    async function copyTextToClipboard(text) {
      const normalized = String(text || '').trim();
      if (!normalized) return false;
      try {
        await navigator.clipboard.writeText(normalized);
        return true;
      } catch (_) {
        try {
          const fallbackInput = document.createElement('textarea');
          fallbackInput.value = normalized;
          fallbackInput.setAttribute('readonly', '');
          fallbackInput.style.position = 'fixed';
          fallbackInput.style.top = '-9999px';
          document.body.appendChild(fallbackInput);
          fallbackInput.focus();
          fallbackInput.select();
          const copied = document.execCommand('copy');
          document.body.removeChild(fallbackInput);
          return copied;
        } catch (_) {
          return false;
        }
      }
    }

    function sortItems(items) {
      const sorted = [...items];
      switch (state.sortMode) {
        case 'artist-asc':
          return sorted.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'ja'));
        case 'artist-desc':
          return sorted.sort((a, b) => String(b.artist || '').localeCompare(String(a.artist || ''), 'ja'));
        case 'title-asc':
          return sorted.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
        case 'title-desc':
          return sorted.sort((a, b) => String(b.title || '').localeCompare(String(a.title || ''), 'ja'));
        case 'date-asc':
          return sorted.sort((a, b) => dateOf(a) - dateOf(b));
        case 'date-desc':
        default:
          return sorted.sort((a, b) => dateOf(b) - dateOf(a));
      }
    }

    function filterItems(items) {
      const q = state.q.toLowerCase();
      const kinds = new Set(state.kinds);
      return sortItems(
        items
          .filter((item) => kinds.has(kindForFilter(item)))
          .filter((item) => {
            if (!q) return true;
            const target = [item.title, item.artist, item.memo].filter(Boolean).join(' ').toLowerCase();
            return target.includes(q);
          }),
      );
    }

    const META_FALLBACK_JSON_URLS =
      document.querySelector('meta[name="songs-r2-fallbacks"]')?.content
        ?.split(',')
        .map((v) => v.trim())
        .filter(Boolean)
      || [];

    const GAS_SONGS_API_URL =
      document.querySelector('meta[name="songs-gas-api-url"]')?.content
      || '';

    // 一時的にブラウザからのGAS直フォールバックを無効化する。
    // 再実装時は true に戻すだけで既存コードを再利用できる。
    const ENABLE_GAS_FALLBACK = false;

    function isPlaceholderUrl(url) {
      const text = String(url || '').trim();
      return text.includes('xxxxxxxx') || text.includes('<') || text.includes('example.com');
    }

    const SONGS_JSON_URL_OVERRIDE = [
      window.__SONGS_JSON_URL__,
      localStorage.getItem('songs_r2_json_url'),
      document.querySelector('meta[name="songs-r2-json-url"]')?.content,
    ]
      .map((value) => String(value || '').trim())
      .find((value) => value && !isPlaceholderUrl(value))
      || '';

    const SONGS_JSON_FALLBACK_URLS = Array.from(new Set([
      ...META_FALLBACK_JSON_URLS,
    ]
      .map((value) => String(value || '').trim())
      .filter((value) => value && !isPlaceholderUrl(value))));


    const renderDeps = {
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
    };

    function loadSongs() {
      const requestCandidates = [
        SONGS_JSON_URL_OVERRIDE,
        ...SONGS_JSON_FALLBACK_URLS,
        ...(ENABLE_GAS_FALLBACK ? [GAS_SONGS_API_URL] : []),
      ].filter(Boolean);
      return load({
        setLoadingStatus,
        clearErrorLog,
        setErrorLog,
        setStoppedStatus,
        setRunningStatus,
        filterItems,
        render: (items, totals) => render(items, totals, renderDeps),
        headersToObject,
        clipText,
        cacheKey: songsCacheKey,
        cacheMaxAgeMs: DATA_REFRESH_TTL_MS,
        requestCandidates,
        rows,
      }).then((result) => {
        if (!result) return result;
        sourceItemsCache = Array.isArray(result.sourceItems) ? result.sourceItems : [];
        sourceTotalCache = Number(result.total ?? sourceItemsCache.length);
        hasSourceItemsCache = true;
        return result;
      });
    }

    function rerenderFromLocalCache() {
      if (!hasSourceItemsCache) return false;
      const filteredItems = filterItems(sourceItemsCache);
      render(filteredItems, { total: sourceTotalCache }, renderDeps);
      setRunningStatus(filteredItems.length, sourceTotalCache);
      return true;
    }

    function rerenderOrLoadSongs() {
      if (rerenderFromLocalCache()) return;
      loadSongs();
    }

    async function copyMemo() {
      const memoInput = byId('memoInput');
      if (!memoInput) return;
      const copied = await copyTextToClipboard(memoInput.value || '');
      if (!copied) {

        return;
      }
      showToast('コピーしました');

    }

    function insertTextIntoMemo(memoInput, text) {
      if (!memoInput) return;
      const safeText = String(text ?? '');
      const start = Number.isInteger(memoInput.selectionStart) ? memoInput.selectionStart : memoInput.value.length;
      const end = Number.isInteger(memoInput.selectionEnd) ? memoInput.selectionEnd : memoInput.value.length;
      memoInput.setRangeText(safeText, start, end, 'end');
      memoInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function pasteMemo() {
      const memoInput = byId('memoInput');
      if (!memoInput) return;

      memoInput.focus();
      try {
        const text = await navigator.clipboard.readText();
        insertTextIntoMemo(memoInput, text);
        memoInput.focus();
        showToast('貼り付けました');

      } catch (_) {
        const fallback = window.prompt('クリップボードへのアクセスに失敗しました。貼り付ける文字列を入力してください。', '');
        if (fallback === null) {

          return;
        }
        insertTextIntoMemo(memoInput, fallback);
        memoInput.focus();
        showToast('貼り付けました');

      }
    }

    async function copyDanmaku() {
      const type = byId('danmakuType').value;
      const isCustomDanmaku = type.startsWith('custom:');
      if (!isCustomDanmaku && type !== 'my') {
        showToast('対象なし');
        return;
      }

      let text = '';
      if (type === 'my') text = state.myDanmaku || loadMyDanmakuCache();
      if (isCustomDanmaku) text = type.slice('custom:'.length);

      if (!text.trim()) {
        showToast('対象なし');
        return;
      }

      const copied = await copyTextToClipboard(text.trim());
      if (copied) {
        showToast('弾幕を作成しました');
      }
    }

    function toggleKind(kind) {
      const set = new Set(state.kinds);
      if (set.has(kind)) set.delete(kind);
      else set.add(kind);
      state.kinds = [...set];

      if (state.kinds.length === 0) {
        state.kinds = [...DEFAULT_KINDS];
        byId('kindCover').checked = true;
        byId('kindShort').checked = true;
        byId('kindLive').checked = true;
      }
      rerenderOrLoadSongs();
    }

    function bind() {
      if (!ENABLE_ERROR_LOG_UI) {
        errorLogWrap.hidden = true;
      }

      byId('q').addEventListener('input', (e) => {
        state.q = e.target.value.trim();
        rerenderOrLoadSongs();
      });

      byId('kindCover').addEventListener('change', () => toggleKind('cover'));
      byId('kindShort').addEventListener('change', () => toggleKind('short'));
      byId('kindLive').addEventListener('change', () => toggleKind('live'));

      byId('sortField').addEventListener('change', (e) => {
        state.sortField = e.target.value;
        state.sortMode = `${state.sortField}-${state.sortOrder}`;
        rerenderOrLoadSongs();
      });

      byId('sortOrder').addEventListener('change', (e) => {
        state.sortOrder = e.target.value;
        state.sortMode = `${state.sortField}-${state.sortOrder}`;
        rerenderOrLoadSongs();
      });

      byId('clear').addEventListener('click', () => {
        state.q = '';
        byId('q').value = '';
        rerenderOrLoadSongs();
      });

      byId('copyDanmaku').addEventListener('click', copyDanmaku);
      byId('copyMemo')?.addEventListener('click', copyMemo);
      byId('pasteMemo')?.addEventListener('click', pasteMemo);
      if (ENABLE_ERROR_LOG_UI) {
        byId('copyErrorLog').addEventListener('click', copyErrorLog);
      }

      byId('saveMyDanmaku').addEventListener('click', () => {
        const text = buildMyDanmaku(byId('myEmoji').value);
        saveMyDanmakuCache(text);
        byId('danmakuType').value = 'my';
        const select = byId('danmakuType');
        select.classList.remove('roll-highlight');
        void select.offsetWidth;
        select.classList.add('roll-highlight');
        setSwipeCard(0);
        showToast('弾幕を作成しました');

      });

      const updateTopFormCollapseByScroll = () => {
        const topForm = byId('topForm');
        if (!topForm || !isMobileLayout()) return;
        if (getTopSwipeCard() === 1) return;

        const cardSample = rows?.querySelector('.song-card');
        const rowGap = Number.parseFloat(window.getComputedStyle(rows).rowGap || '0') || 0;
        const cardHeight = cardSample ? (cardSample.offsetHeight + rowGap) : 44;
        const collapseThreshold = cardHeight * 2;
        const currentScrollTop = rows?.scrollTop ?? window.scrollY;
        const shouldCollapse = currentScrollTop > collapseThreshold;
        if (shouldCollapse === topMenuCollapsed) return;
        setTopMenuCollapsed(shouldCollapse);
      };

      const updateScrollTopOffset = () => {
        const container = byId('songsPage');
        const topForm = byId('topForm');
        const middleForm = document.querySelector('.middle-form');
        const bottomForm = document.querySelector('.bottom-form');
        if (!bottomForm || !container) return;

        const containerRect = container.getBoundingClientRect();
        const sharedLeft = `${Math.round(containerRect.left)}px`;
        const sharedWidth = `${Math.round(containerRect.width)}px`;

        if (topForm) {
          topForm.style.left = sharedLeft;
          topForm.style.width = sharedWidth;
        }
        if (middleForm) {
          middleForm.style.left = sharedLeft;
          middleForm.style.width = sharedWidth;
        }
        bottomForm.style.left = sharedLeft;
        bottomForm.style.width = sharedWidth;

        const rect = bottomForm.getBoundingClientRect();
        const overlap = Math.max(0, window.innerHeight - rect.top);
        const offset = overlap > 0 ? overlap + 8 : 0;
        document.documentElement.style.setProperty('--scroll-top-offset', `${offset}px`);
        updateMiddleCardsHeight();
        updateDummyCardsHeight();
        syncTopPanelSize();
      };

      let lastBubbleAt = 0;
      let previousRowsScrollTop = 0;
      const maybeBubble = () => {
        const now = Date.now();
        if (now - lastBubbleAt < 120) return;
        lastBubbleAt = now;
        createScrollBubbles();
      };

      window.addEventListener('scroll', () => {
        updateTopFormCollapseByScroll();
        updateScrollTopOffset();
        maybeBubble();
      });

      window.addEventListener('resize', updateScrollTopOffset);

      rows.addEventListener('scroll', () => {
        const cardSample = rows.querySelector('.song-card');
        const rowGap = Number.parseFloat(window.getComputedStyle(rows).rowGap || '0') || 0;
        const cardHeight = cardSample ? (cardSample.offsetHeight + rowGap) : 44;
        const deltaRows = Math.abs(rows.scrollTop - previousRowsScrollTop) / Math.max(1, cardHeight);
        previousRowsScrollTop = rows.scrollTop;

        if (deltaRows >= 10) {
          createScrollBubbles('burst');
        } else {
          maybeBubble();
        }

        updateTopFormCollapseByScroll();
        collapseExpandedWhenOutOfView();
      });


      const media = window.matchMedia('(max-width: 768px)');
      media.addEventListener('change', () => {
        collapseExpandedCards();
        if (!isMobileLayout()) {
          rows.querySelectorAll('.song-card').forEach((card) => card.classList.add('expanded'));
        }
        updateScrollTopOffset();
      });

      updateScrollTopOffset();
      updateMiddleCardsHeight();
      updateTopFormCollapseByScroll();
    }

export function initializeApp() {
    byId('sortField').value = state.sortField;
    byId('sortOrder').value = state.sortOrder;
    state.sortMode = `${state.sortField}-${state.sortOrder}`;
    state.myDanmaku = loadMyDanmakuCache();
    if (!state.myDanmaku) triggerSwipeHint();
    if (!swipeHintIntervalId) {
      swipeHintIntervalId = window.setInterval(() => {
        if (!loadMyDanmakuCache()) triggerSwipeHint();
      }, SWIPE_HINT_INTERVAL_MS);
    }
    loadSongs();
}

export { bind, setupTopSwipe, setupBottomSwipe };
  
