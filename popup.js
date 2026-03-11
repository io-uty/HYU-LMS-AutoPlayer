// popup.js — HY-Play

const LMS_URL = 'https://learning.hanyang.ac.kr';

/* ───── helpers ───── */
function showNotif(msg, duration = 2000) {
  const el = document.getElementById('notif');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function updateStatus(active) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.className  = 'status-dot ' + (active ? 'active' : 'inactive');
  text.innerHTML = active
    ? '<strong>LMS 페이지 감지됨</strong>'
    : '한양대 LMS 페이지가 아님';
}

/* ───── init ───── */
document.addEventListener('DOMContentLoaded', async () => {

  // 1) 현재 탭이 LMS인지 확인
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLMS = tab && tab.url && tab.url.startsWith(LMS_URL);
  updateStatus(isLMS);

  // 2) storage에서 세션 통계 로드
  const data = await chrome.storage.local.get(['hyplay_queue', 'hyplay_done', 'hyplay_progress', 'hyplay_settings']);
  const queue    = data.hyplay_queue    || [];
  const done     = data.hyplay_done     || [];
  const progress = data.hyplay_progress || null;
  const settings = data.hyplay_settings || { autoNext: true, autoComplete: true, showProgress: true };

  document.getElementById('queueCount').textContent  = queue.length;
  document.getElementById('doneCount').textContent   = done.length;
  document.getElementById('progressVal').textContent = progress ? progress + '%' : '—';

  // 3) 설정 적용
  document.getElementById('autoNext').checked     = settings.autoNext;
  document.getElementById('autoComplete').checked = settings.autoComplete;
  document.getElementById('showProgress').checked = settings.showProgress;

  // 4) 토글 이벤트 — 변경 즉시 저장 & content script에 전달
  ['autoNext', 'autoComplete', 'showProgress'].forEach(id => {
    document.getElementById(id).addEventListener('change', async () => {
      const newSettings = {
        autoNext:     document.getElementById('autoNext').checked,
        autoComplete: document.getElementById('autoComplete').checked,
        showProgress: document.getElementById('showProgress').checked,
      };
      await chrome.storage.local.set({ hyplay_settings: newSettings });
      if (isLMS) {
        chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATE', settings: newSettings });
      }
    });
  });

  // 5) 패널 열기 버튼
  document.getElementById('btnPanel').addEventListener('click', async () => {
    if (!isLMS) {
      showNotif('⚠️ LMS 페이지에서 실행해주세요');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    window.close();
  });

  // 6) 목록 초기화
  document.getElementById('btnClear').addEventListener('click', async () => {
    await chrome.storage.local.set({ hyplay_queue: [], hyplay_done: [] });
    document.getElementById('queueCount').textContent = '0';
    document.getElementById('doneCount').textContent  = '0';
    if (isLMS) chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_QUEUE' });
    showNotif('✅ 목록이 초기화되었습니다');
  });

  // 7) LMS 열기
  document.getElementById('btnGo').addEventListener('click', () => {
    chrome.tabs.create({ url: LMS_URL });
    window.close();
  });
});
