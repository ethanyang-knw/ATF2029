// content-bootstrap.js
// 기능: 확장 초기화 시작 + SPA 페이지 이동 감지
// 로드 순서: manifest.json content_scripts 배열의 맨 마지막

let mutationDebounceTimer = null;

// MutationObserver: DOM 변경 감지 시 URL이 바뀌었으면 재초기화, 버튼이 사라졌으면 재삽입
// 피드백: DOM 변경이 잦아 콜백이 과도하게 호출되는 문제 → 100ms 디바운스 적용
const observer = new MutationObserver(() => {
  if (isSearchingProcess) return;

  clearTimeout(mutationDebounceTimer);
  mutationDebounceTimer = setTimeout(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      checkAndInitExtension();
    }
    injectExtensionButton();
  }, 100);
});

// 최상위 프레임에서만 실행 (iframe 중복 실행 방지)
if (window === window.top) {
  observer.observe(document.body, { childList: true, subtree: true });
  checkAndInitExtension();
}
