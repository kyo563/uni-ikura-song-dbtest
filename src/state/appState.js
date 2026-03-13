export const DEFAULT_KINDS = ['cover', 'short', 'live'];

export const KIND_MAP = {
  cover: 'cover',
  short: 'short',
  live: 'live',
  stream: 'live',
  '歌ってみた': 'cover',
  '歌みた': 'cover',
  'ショート': 'short',
  '歌枠': 'live',
  '配信': 'live',
};

export const KIND_LABELS = { cover: '歌ってみた', short: 'ショート', live: '歌枠', other: 'その他' };

export const state = {
  q: '',
  kinds: [...DEFAULT_KINDS],
  sortMode: 'date-desc',
  sortField: 'date',
  sortOrder: 'desc',
  selectedSongId: '',
  myDanmaku: '',
};
