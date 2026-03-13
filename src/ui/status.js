import { byId } from './dom.js';

const status = byId('status');
const statusShell = byId('statusShell');

export function setStatus(text, state = 'ok') {
  status.textContent = text;
  statusShell.dataset.state = state;
}

export function setLoadingStatus() {
  setStatus('読込中…', 'loading');
}

export function setRunningStatus(visibleCount, totalCount) {
  setStatus(`サーバー稼働中(${visibleCount}/${totalCount}件 表示)`, 'ok');
}

export function setStoppedStatus() {
  setStatus('サーバー停止中', 'ok');
}

export function setErrorStatus() {
  setStatus('エラー', 'error');
}
