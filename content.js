// content.js — HY-Play v5.0
// Xinics 진도율 API 직접 폴링으로 완료 감지
(function () {
  'use strict';

  let panel = null;
  let queue = [];
  let modules = [];
  let currentIdx = -1;
  let isPlaying = false;
  let dragSrcIdx = null;
  let settings = { autoNext: true, autoComplete: true, showProgress: true };
  let completionInterval = null;
  let completionNotified = false;
  let progressApiUrl = null;
  let initialProgress = -1; // 페이지 진입 시 진도율 (이전 완료 판별용)

  const courseId = (typeof ENV !== 'undefined' && ENV.context_asset_string)
    ? ENV.context_asset_string.replace('course_', '')
    : (location.pathname.match(/\/courses\/(\d+)/) || [])[1];

  if (!document.getElementById('hyplay-fonts')) {
    const l = document.createElement('link');
    l.id = 'hyplay-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap';
    document.head.appendChild(l);
  }

  /* ── Storage ── */
  async function loadState() {
    const d = await chrome.storage.local.get(['hyplay_queue','hyplay_settings','hyplay_playing','hyplay_idx']);
    queue      = d.hyplay_queue    || [];
    settings   = d.hyplay_settings || { autoNext:true, autoComplete:true, showProgress:true };
    isPlaying  = !!d.hyplay_playing;
    currentIdx = (d.hyplay_idx !== undefined) ? d.hyplay_idx : -1;
  }
  async function saveState() {
    await chrome.storage.local.set({ hyplay_queue: queue, hyplay_playing: isPlaying, hyplay_idx: currentIdx });
  }
  async function saveProgress(pct) { await chrome.storage.local.set({ hyplay_progress: pct }); }

  /* ── Canvas API ── */
  async function fetchModules() {
    if (!courseId) return [];
    try {
      const r = await fetch(`/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`, { headers:{Accept:'application/json'} });
      return r.ok ? r.json() : [];
    } catch(e){ return []; }
  }
  async function fetchModuleItems(moduleId) {
    if (!courseId) return [];
    try {
      const r = await fetch(`/api/v1/courses/${courseId}/modules/${moduleId}/items?per_page=100`, { headers:{Accept:'application/json'} });
      return r.ok ? r.json() : [];
    } catch(e){ return []; }
  }

  // 영상 강의 판별 — 제목 패턴 기반
  // 영상: [들어가기], [학습하기], oop-XX 등
  // 비영상: [정리하기], [생각해보기], 퀴즈, 채움노트 등
  const EXCLUDE_TITLE_KW = ['정리하기','생각해보기','채움노트','학습정리','학습평가',
                             '퀴즈','quiz','토론','discussion','설문','survey',
                             '공지','notice','pdf','과제','assignment','게시','안내','소개'];
  const VIDEO_TITLE_KW   = ['들어가기','학습하기','인터뷰','강의','lecture','video','영상','plus talk'];

  function isVideoItem(item) {
    if (['File','Assignment','Quiz'].includes(item.type)) return false;
    const title = item.title || '';
    const lower = title.toLowerCase();
    // 명시적 비영상 키워드 제외
    if (EXCLUDE_TITLE_KW.some(k => lower.includes(k))) return false;
    // oop-XX 패턴 (슬라이드 강의) — 항상 포함
    if (/^oop-\d+/i.test(title.trim())) return true;
    // 영상 키워드 포함 시 포함
    if (VIDEO_TITLE_KW.some(k => lower.includes(k))) return true;
    // 대괄호 태그 없는 순수 제목 포함
    if (!/^\[/.test(title.trim())) return true;
    return false;
  }

  /* ════════════════════════════════════
     Xinics 진도율 API 추출 & 폴링
     iframe src의 TargetUrl 파라미터에
     progress API URL이 인코딩되어 있음
  ════════════════════════════════════ */
  function extractProgressApiUrl() {
    progressApiUrl = null;
    // 방법 1: iframe src에서 TargetUrl 추출
    document.querySelectorAll('iframe').forEach(f => {
      if (progressApiUrl) return;
      try {
        const src = f.src || f.getAttribute('src') || '';
        const m = src.match(/TargetUrl=([^&"]+)/);
        if (m) {
          const decoded = decodeURIComponent(m[1]);
          if (decoded.includes('/progress')) {
            progressApiUrl = decoded;
          }
        }
      } catch(_) {}
    });

    // 방법 2: 페이지 HTML 소스에서 progress URL 검색
    if (!progressApiUrl) {
      try {
        const html = document.documentElement.innerHTML;
        const m = html.match(/learningx\/api\/v1\/[^"'&\s]+\/progress[^"'&\s]*/);
        if (m) progressApiUrl = 'https://learning.hanyang.ac.kr/' + m[0];
      } catch(_) {}
    }

    // 방법 3: #root data 속성에서 추출 (Xinics React 앱)
    if (!progressApiUrl) {
      try {
        const root = document.getElementById('root');
        if (root) {
          const returnUrl = root.getAttribute('data-return-url') || '';
          // course ID, section, component ID 등을 조합
          const cid  = root.getAttribute('data-course-id');
          const iid  = root.getAttribute('data-item-id');
          if (cid && iid) {
            // component progress API 패턴 추정
            progressApiUrl = `/learningx/api/v1/courses/${cid}/sections/0/components/${iid}/progress`;
          }
        }
      } catch(_) {}
    }

    if (progressApiUrl) console.log('[HY-Play] 진도율 API 추출:', progressApiUrl);
    return progressApiUrl;
  }

  async function fetchProgressFromApi() {
    if (!progressApiUrl) extractProgressApiUrl();
    if (!progressApiUrl) return null;
    try {
      const r = await fetch(progressApiUrl, {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      });
      if (!r.ok) return null;
      const data = await r.json();
      console.log('[HY-Play] API 응답:', JSON.stringify(data).slice(0,200));
      // 다양한 응답 형태 처리
      if (data.is_completed || data.status === 'completed') return 100;
      const pct = data.progress ?? data.percent ?? data.rate ??
                  data.play_time_rate ?? data.playback_rate ?? null;
      return pct !== null ? parseFloat(pct) : null;
    } catch(e) {
      console.log('[HY-Play] API 오류:', e.message);
      return null;
    }
  }

  /* ── 페이지 텍스트 파싱 (폴백) ── */
  function getAllPageText() {
    const texts = [document.body.innerText || ''];
    document.querySelectorAll('iframe').forEach(f => {
      try { if (f.contentDocument?.body) texts.push(f.contentDocument.body.innerText); } catch(_){}
    });
    return texts.join('\n');
  }

  function parseProgressFromText() {
    const text = getAllPageText();
    const m = text.match(/\((\d+(?:\.\d+)?)%\)/);
    return m ? parseFloat(m[1]) : null;
  }

  function isPageCompleted() {
    const text = getAllPageText();
    if (text.match(/\(100(?:\.0+)?%\)/)) return true;
    if (/학습 완료|수강완료|이미 완료|완료되었습니다/.test(text)) return true;
    return false;
  }

  /* ════════════════════════════════════
     완료 감지 — API + 텍스트 이중 감지
  ════════════════════════════════════ */
  function startProgressWatch() {
    completionNotified = false;
    progressApiUrl = null;
    clearInterval(completionInterval);

    // iframe 로드 후 API URL 추출
    setTimeout(extractProgressApiUrl, 1000);
    setTimeout(extractProgressApiUrl, 3000);

    // 페이지 진입 직후는 이미 완료된 강의일 수 있으므로
    // 첫 완료 체크는 15초 후부터 시작 (영상 시작 시간 확보)
    // 진도율 표시만 먼저 시작
    setTimeout(() => {
      fetchProgressFromApi().then(pct => {
        if (pct !== null) {
          // 진입 시 이미 100%면 → 이전 완료 상태, 기록만 하고 완료 트리거 안 함
          initialProgress = pct;
          updateProgressUI(pct);
          console.log('[HY-Play] 진입 시 진도율:', pct + '%');
        }
      });
    }, 2000);

    // 15초 후부터 본격 완료 감지 시작
    setTimeout(() => {
      completionInterval = setInterval(checkCompletion, 4000);
      console.log('[HY-Play] 완료 감지 시작 (15초 딜레이 후)');
    }, 15000);
  }

  async function checkCompletion() {
    if (!isPlaying || completionNotified) return;

    let pct = null;

    // 1) Xinics API
    pct = await fetchProgressFromApi();

    // 2) 페이지 텍스트 파싱 (API 실패 시)
    if (pct === null) pct = parseProgressFromText();

    // 진도율 UI 업데이트
    if (pct !== null) {
      updateProgressUI(pct);
      saveProgress(pct);
    }

    // 완료 판정
    // initialProgress가 이미 100%이면 새로 완료된 게 아님 → 무시
    if (pct !== null && pct >= 100 && initialProgress < 100) { triggerCompletion('진도율 100%'); return; }
    if (isPageCompleted() && initialProgress < 100)           { triggerCompletion('완료 텍스트'); return; }

    // video 태그 ended
    [...document.querySelectorAll('video')].forEach(v => {
      if (v.ended) triggerCompletion('video ended');
    });
  }

  function triggerCompletion(reason) {
    if (completionNotified || !isPlaying) return;
    completionNotified = true;
    clearInterval(completionInterval);
    console.log('[HY-Play] 완료:', reason);
    showToast('✅ 수강 완료! 잠시 후 다음 강의로...', 4000);
    setTimeout(goNext, 4500);
  }

  /* ── 진도율 UI ── */
  function updateProgressUI(pct) {
    const p = document.getElementById('hp-progress-pct');
    const f = document.getElementById('hp-progress-fill');
    const s = document.getElementById('hp-progress-status');
    if (p) p.textContent = pct.toFixed(1) + ' %';
    if (f) f.style.width = Math.min(pct, 100) + '%';
    if (s) { s.textContent = pct >= 100 ? '✅ 완료' : `진행 중`; s.style.color = pct >= 100 ? '#15803D' : '#6B85A0'; }
  }

  function refreshProgress() {
    parseProgressFromText().then ? null : (() => {
      const pct = parseProgressFromText();
      if (pct !== null) updateProgressUI(pct);
    })();
    setTimeout(refreshProgress, 5000);
  }

  /* ════════════════════════════════════
     패널 HTML
  ════════════════════════════════════ */
  function createPanel() {
    if (document.getElementById('hyplay-panel')) return;
    panel = document.createElement('div');
    panel.id = 'hyplay-panel';
    panel.innerHTML = `
      <div class="hp-header">
        <div class="hp-logo-row">
          <div class="hp-logo"><div class="hp-logo-icon">▶</div><div class="hp-logo-text">HY<span>-Play</span></div></div>
          <button class="hp-close" id="hp-close-btn">✕</button>
        </div>
      </div>
      <div class="hp-tabs">
        <button class="hp-tab active" data-tab="queue">📋 재생목록 <span class="hp-tab-badge" id="hp-queue-badge">0</span></button>
        <button class="hp-tab" data-tab="browse">🔍 강의 추가</button>
      </div>
      <div class="hp-tab-content active" id="hp-tab-queue">
        <div class="hp-progress-section">
          <div class="hp-progress-row">
            <div class="hp-progress-label">현재 강의 진도율</div>
            <div class="hp-progress-pct" id="hp-progress-pct">— %</div>
          </div>
          <div class="hp-progress-bar-bg"><div class="hp-progress-bar-fill" id="hp-progress-fill"></div></div>
          <div class="hp-progress-status" id="hp-progress-status"></div>
        </div>
        <div class="hp-controls">
          <button class="hp-btn hp-btn-play" id="hp-btn-play">▶ 재생 시작</button>
          <button class="hp-btn hp-btn-stop" id="hp-btn-stop">⏹ 정지</button>
          <button class="hp-btn hp-btn-clear" id="hp-btn-clear">🗑</button>
        </div>
        <div class="hp-queue-list" id="hp-queue-list">
          <div class="hp-empty">
            <div class="hp-empty-icon">📋</div>
            <div class="hp-empty-text">재생 목록이 비어있습니다</div>
            <div class="hp-empty-sub">"강의 추가" 탭에서<br>강의를 선택하세요</div>
          </div>
        </div>
        <div class="hp-now-playing" id="hp-now-playing">
          <div class="hp-np-label">🔴 재생 중</div>
          <div class="hp-np-title" id="hp-np-title">—</div>
        </div>
      </div>
      <div class="hp-tab-content" id="hp-tab-browse">
        <div class="hp-browse-toolbar">
          <button class="hp-browse-refresh" id="hp-browse-refresh">↺ 새로고침</button>
          <button class="hp-browse-addall" id="hp-browse-addall">＋ 영상 전체 추가</button>
        </div>
        <div class="hp-browse-list" id="hp-browse-list">
          <div class="hp-loading"><div class="hp-spinner"></div><div>강의 목록 불러오는 중...</div></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    if (!document.getElementById('hyplay-toast')) {
      const t = document.createElement('div'); t.id = 'hyplay-toast'; document.body.appendChild(t);
    }

    bindEvents();
    renderQueue();
    updatePlayBtn();
    loadBrowseTab();

    // 페이지 로드 시 재생 중이었으면 복원
    if (isPlaying && currentIdx >= 0 && currentIdx < queue.length) {
      const cur = queue[currentIdx];
      const pageItemId = (location.href.match(/\/items\/(\d+)/) || [])[1];
      if (!pageItemId || pageItemId === String(cur.id)) {
        updateNowPlaying(cur.title);
        startProgressWatch();
      }
    }

    // 진도율 초기 표시
    setTimeout(() => {
      const pct = parseProgressFromText();
      if (pct !== null) updateProgressUI(pct);
    }, 1500);

    requestAnimationFrame(() => {
      panel.classList.add('open');
      document.body.classList.add('hyplay-panel-open');
    });
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    document.getElementById('hp-close-btn').onclick = closePanel;
    panel.querySelectorAll('.hp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.hp-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.hp-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('hp-tab-' + tab.dataset.tab).classList.add('active');
      });
    });
    document.getElementById('hp-btn-play').onclick  = () => isPlaying ? pausePlayback() : startPlayback();
    document.getElementById('hp-btn-stop').onclick  = stopPlayback;
    document.getElementById('hp-btn-clear').onclick = () => {
      if (!confirm('재생 목록을 모두 삭제할까요?')) return;
      queue=[]; currentIdx=-1; isPlaying=false;
      clearInterval(completionInterval);
      saveState(); renderQueue(); updatePlayBtn(); updateNowPlaying();
      showToast('목록이 초기화되었습니다');
    };
    document.getElementById('hp-browse-refresh').onclick = () => loadBrowseTab(true);
    document.getElementById('hp-browse-addall').onclick  = addAllVisible;
  }

  /* ── 강의 탐색 탭 ── */
  async function loadBrowseTab(force=false) {
    if (modules.length > 0 && !force) { renderBrowse(); return; }
    const listEl = document.getElementById('hp-browse-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="hp-loading"><div class="hp-spinner"></div><div>강의 목록 불러오는 중...</div></div>';
    const rawMods = await fetchModules();
    const populated = await Promise.all(rawMods.map(async mod => {
      let items = mod.items || [];
      if (!items.length) items = await fetchModuleItems(mod.id);
      return { ...mod, items: items.filter(isVideoItem) };
    }));
    modules = populated.filter(m => m.items.length > 0);
    renderBrowse();
  }

  function renderBrowse() {
    const listEl = document.getElementById('hp-browse-list');
    if (!listEl) return;
    if (!modules.length) {
      listEl.innerHTML = `<div class="hp-empty" style="padding:30px 16px;"><div class="hp-empty-icon">😕</div><div class="hp-empty-text">강의 목록을 찾을 수 없습니다</div><div class="hp-empty-sub">주차학습 페이지에서 다시 시도해주세요</div></div>`;
      return;
    }
    listEl.innerHTML = '';
    modules.forEach(mod => {
      if (!mod.items.length) return;
      const allAdded = mod.items.every(item => queue.some(q => q.id === String(item.id)));
      const header = document.createElement('div');
      header.className = 'hp-browse-module-header';
      header.innerHTML = `<div class="hp-browse-module-title">${escapeHtml(mod.name)}</div><button class="hp-browse-add-module ${allAdded?'added':''}">${allAdded?'✓ 추가됨':'+ 전체'}</button>`;
      header.querySelector('.hp-browse-add-module').onclick = (e) => { addModuleToQueue(mod); e.target.textContent='✓ 추가됨'; e.target.classList.add('added'); };
      listEl.appendChild(header);
      mod.items.forEach(item => {
        const inQueue = queue.some(q => q.id === String(item.id));
        const el = document.createElement('div');
        el.className = 'hp-browse-item' + (inQueue?' in-queue':'');
        el.innerHTML = `<div class="hp-browse-item-icon">🎬</div><div class="hp-browse-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div><button class="hp-browse-add-btn ${inQueue?'added':''}">${inQueue?'✓':'+'}</button>`;
        el.querySelector('.hp-browse-add-btn').onclick = (e) => {
          if (e.target.classList.contains('added')) return;
          addItemToQueue(item, mod.name);
          e.target.textContent='✓'; e.target.classList.add('added'); el.classList.add('in-queue');
        };
        listEl.appendChild(el);
      });
    });
  }

  /* ── 큐 관리 ── */
  function addItemToQueue(item, moduleName) {
    if (queue.some(q => q.id === String(item.id))) { showToast('이미 목록에 있습니다'); return; }
    const url = item.html_url || `/courses/${courseId}/modules/items/${item.id}`;
    queue.push({ id:String(item.id), title:item.title, url, module:moduleName||'', done:false });
    saveState(); renderQueue();
    showToast(`✅ "${truncate(item.title,18)}" 추가됨`);
  }
  function addModuleToQueue(mod) {
    let added=0;
    mod.items.forEach(item => {
      if (!queue.some(q => q.id === String(item.id))) {
        const url = item.html_url || `/courses/${courseId}/modules/items/${item.id}`;
        queue.push({ id:String(item.id), title:item.title, url, module:mod.name, done:false }); added++;
      }
    });
    saveState(); renderQueue(); showToast(`✅ ${mod.name} ${added}개 추가됨`);
  }
  function addAllVisible() {
    let added=0;
    modules.forEach(mod => mod.items.forEach(item => {
      if (!queue.some(q => q.id === String(item.id))) {
        const url = item.html_url || `/courses/${courseId}/modules/items/${item.id}`;
        queue.push({ id:String(item.id), title:item.title, url, module:mod.name, done:false }); added++;
      }
    }));
    saveState(); renderQueue(); renderBrowse();
    showToast(`✅ 전체 ${added}개 강의 추가됨`);
  }

  /* ── 큐 렌더링 ── */
  function renderQueue() {
    const listEl = document.getElementById('hp-queue-list');
    const badge  = document.getElementById('hp-queue-badge');
    if (!listEl) return;
    if (badge) badge.textContent = queue.length;
    if (!queue.length) {
      listEl.innerHTML = `<div class="hp-empty"><div class="hp-empty-icon">📋</div><div class="hp-empty-text">재생 목록이 비어있습니다</div><div class="hp-empty-sub">"강의 추가" 탭에서<br>강의를 선택하세요</div></div>`;
      return;
    }
    listEl.innerHTML = '';
    queue.forEach((item, idx) => {
      const isCur = idx === currentIdx;
      const el = document.createElement('div');
      el.className = 'hp-item' + (isCur?' current':'') + (item.done?' done':'');
      el.draggable = true; el.dataset.idx = idx;
      el.innerHTML = `
        <div class="hp-item-num">${idx+1}</div>
        <div class="hp-item-content">
          <div class="hp-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="hp-item-meta">${escapeHtml(item.module||'강의')}</div>
        </div>
        <div class="hp-item-status">${item.done?'✅':(isCur&&isPlaying?'▶️':'⏸️')}</div>
        <button class="hp-item-remove" data-idx="${idx}">✕</button>
      `;
      el.addEventListener('click', e => { if (!e.target.classList.contains('hp-item-remove')) jumpTo(idx); });
      el.addEventListener('dragstart', e => { dragSrcIdx=idx; el.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      el.addEventListener('dragend',   () => el.classList.remove('dragging'));
      el.addEventListener('dragover',  e => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault(); el.classList.remove('drag-over');
        if (dragSrcIdx!==null && dragSrcIdx!==idx) {
          const moved=queue.splice(dragSrcIdx,1)[0]; queue.splice(idx,0,moved);
          if (currentIdx===dragSrcIdx) currentIdx=idx;
          dragSrcIdx=null; saveState(); renderQueue();
        }
      });
      listEl.appendChild(el);
    });
    listEl.querySelectorAll('.hp-item-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const i=parseInt(btn.dataset.idx);
        queue.splice(i,1);
        if (currentIdx>=i) currentIdx=Math.max(currentIdx-1,-1);
        saveState(); renderQueue(); renderBrowse();
        showToast('강의가 목록에서 제거되었습니다');
      });
    });
  }

  /* ── 재생 제어 ── */
  function startPlayback() {
    if (!queue.length) { showToast('재생 목록이 비어있습니다'); return; }
    isPlaying = true;
    if (currentIdx<0 || currentIdx>=queue.length || queue[currentIdx].done)
      currentIdx = queue.findIndex(q => !q.done);
    if (currentIdx<0) { showToast('모든 강의를 완료했습니다 🎉'); isPlaying=false; updatePlayBtn(); return; }
    saveState(); updatePlayBtn();
    navigateToItem(currentIdx);
  }
  function pausePlayback()  { isPlaying=false; clearInterval(completionInterval); saveState(); updatePlayBtn(); showToast('일시정지'); }
  function stopPlayback()   { isPlaying=false; currentIdx=-1; clearInterval(completionInterval); saveState(); updatePlayBtn(); updateNowPlaying(); renderQueue(); showToast('정지됨'); }
  function jumpTo(idx)      { clearInterval(completionInterval); currentIdx=idx; isPlaying=true; saveState(); updatePlayBtn(); navigateToItem(idx); }

  function navigateToItem(idx) {
    const item = queue[idx]; if (!item) return;
    updateNowPlaying(item.title); renderQueue();
    const pageItemId = (location.href.match(/\/items\/(\d+)/) || [])[1];
    if (pageItemId && pageItemId === String(item.id)) {
      showToast(`▶ ${truncate(item.title,22)}`);
      startProgressWatch();
      return;
    }
    showToast(`🔄 이동 중: ${truncate(item.title,18)}`);
    setTimeout(() => { location.href = item.url; }, 400);
  }

  function goNext() {
    clearInterval(completionInterval);
    if (!isPlaying) return;
    if (currentIdx>=0 && currentIdx<queue.length) queue[currentIdx].done = true;
    const nextIdx = queue.findIndex((q,i) => i>currentIdx && !q.done);
    if (nextIdx<0) {
      isPlaying=false; currentIdx=-1;
      saveState(); renderQueue(); updatePlayBtn(); updateNowPlaying();
      showToast('🎉 모든 강의를 완료했습니다!'); return;
    }
    currentIdx=nextIdx; saveState();
    navigateToItem(currentIdx);
  }

  /* ── 패널 토글 ── */
  function openPanel()   { if (!panel) createPanel(); else { panel.classList.add('open'); document.body.classList.add('hyplay-panel-open'); } }
  function closePanel()  { if (panel) { panel.classList.remove('open'); document.body.classList.remove('hyplay-panel-open'); } }
  function togglePanel() { (!panel||!panel.classList.contains('open')) ? openPanel() : closePanel(); }

  function updatePlayBtn() {
    const btn = document.getElementById('hp-btn-play'); if (!btn) return;
    btn.textContent = isPlaying ? '⏸ 일시정지' : '▶ 재생 시작';
    btn.classList.toggle('playing', isPlaying);
  }
  function updateNowPlaying(title) {
    const bar=document.getElementById('hp-now-playing'), t=document.getElementById('hp-np-title');
    if (!bar||!t) return;
    if (title) { bar.classList.add('visible'); t.textContent=title; } else bar.classList.remove('visible');
  }
  function showToast(msg, ms=2500) {
    let el=document.getElementById('hyplay-toast');
    if (!el) { el=document.createElement('div'); el.id='hyplay-toast'; document.body.appendChild(el); }
    el.textContent=msg; el.classList.add('show');
    clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),ms);
  }
  function escapeHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function truncate(s,n) { return (s||'').length>n ? s.slice(0,n)+'…' : (s||''); }

  /* ── 메시지 수신 ── */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type==='TOGGLE_PANEL')    togglePanel();
    if (msg.type==='CLEAR_QUEUE')     { queue=[]; currentIdx=-1; isPlaying=false; saveState(); renderQueue(); }
    if (msg.type==='SETTINGS_UPDATE') settings=msg.settings;
  });

  /* ── 초기화 ── */
  async function init() {
    await loadState();
    if (location.href.includes('/courses/') && (queue.length>0 || isPlaying)) {
      createPanel();
    }
  }

  init();
})();