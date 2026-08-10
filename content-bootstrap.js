// content-bootstrap.js
// 실제 초기화를 시작하는 진입점. 다른 모든 content-*.js가 로드된 "이후" 마지막에 실행되어야 하므로
// manifest.json의 content_scripts.js 배열에서 항상 맨 끝에 위치해야 한다.
// 8. SPA 감지 및 MutationObserver
const observer = new MutationObserver(() => {
  if (isSearchingProcess) return;

  if (location.href !== lastUrl) {
    lastUrl = location.href;
    checkAndInitExtension();
  }

  injectExtensionButton();
});

if (window === window.top) {
  observer.observe(document.body, { childList: true, subtree: true });
  checkAndInitExtension();
}