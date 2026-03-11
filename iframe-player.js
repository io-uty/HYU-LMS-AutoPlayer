// iframe-player.js — hycms.hanyang.ac.kr 내부에서 실행
// 재생 버튼 자동 클릭
(function() {
  function tryAutoPlay() {
    // Xinics 플레이어 재생 버튼 셀렉터들
    const selectors = [
      '.vc-front-screen-play-btn',
      '[class*="front-screen-play"]',
      '[class*="play-btn"]',
      '[title="재생"]',
      '[aria-label="재생"]',
      'button[class*="play"]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        console.log('[HY-Play iframe] 재생 버튼 클릭:', sel);
        btn.click();
        return true;
      }
    }

    // video 태그 직접 재생 시도
    const video = document.querySelector('video');
    if (video && video.paused) {
      video.play().catch(() => {});
      console.log('[HY-Play iframe] video.play() 호출');
      return true;
    }

    return false;
  }

  // 페이지 로드 후 바로 시도
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryAutoPlay, 500));
  } else {
    setTimeout(tryAutoPlay, 500);
  }

  // 혹시 늦게 렌더링되면 재시도
  setTimeout(tryAutoPlay, 1500);
  setTimeout(tryAutoPlay, 3000);
})();