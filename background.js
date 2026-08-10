// background.js
// 게시글 다운로드(CSV) 시, @@ID 형태 주소가 실제로 리다이렉트되는
// 최종 브런치 주소(vanity handle, 예: /@iammerry)를 알아내기 위한 서비스워커.
//
// content script(페이지 컨텍스트)에서 brunch.co.kr로 fetch를 하면 페이지의
// origin(brunch-admin.onkakao.net) 기준 CORS 정책에 막히지만, 확장프로그램의
// 백그라운드 컨텍스트는 manifest.json의 host_permissions에 등록된 도메인에 한해
// CORS 제약 없이 요청할 수 있어서 여기서 대신 조회한다.

const MAX_CONCURRENT_REQUESTS = 6; // 🔧 한 번에 너무 많은 요청이 나가지 않도록 동시 실행 개수 제한
const REQUEST_TIMEOUT_MS = 8000;   // 🔧 응답이 없는 요청이 다운로드 전체를 무한정 붙잡지 않도록 타임아웃

async function resolveOneHandle(userId, articleNo) {
  const safeUserId = encodeURIComponent(userId);
  const safeArticleNo = encodeURIComponent(articleNo);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`https://brunch.co.kr/@@${safeUserId}/${safeArticleNo}`, {
      redirect: "follow",
      signal: controller.signal
    });
    // res.url은 리다이렉트를 모두 따라간 뒤의 최종 주소
    const match = res.url.match(/^https:\/\/brunch\.co\.kr\/@([^/?#]+)/);
    return match ? match[1] : null;
  } catch (e) {
    console.warn(`⚠️ [background.js] ${userId} 주소 조회 실패:`, e.name === "AbortError" ? "타임아웃" : e);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 🔧 동시 실행 개수를 MAX_CONCURRENT_REQUESTS로 제한하는 간단한 워커 풀
async function resolveHandlesWithConcurrencyLimit(items) {
  const handles = {};
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const { userId, articleNo } = items[cursor++];
      if (!userId || !articleNo || handles[userId] !== undefined) continue;
      handles[userId] = await resolveOneHandle(userId, articleNo);
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return handles;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "RESOLVE_BRUNCH_HANDLES") return;

  const items = Array.isArray(message.items) ? message.items : [];

  resolveHandlesWithConcurrencyLimit(items).then((handles) => {
    sendResponse({ handles });
  });

  return true; // 비동기 응답(sendResponse)을 위해 true 반환 필수
});
