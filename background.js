// background.js
// 기능: 서비스워커. userId → 브런치 공개 주소(vanity handle) 조회

const MAX_CONCURRENT_REQUESTS = 6;
const REQUEST_TIMEOUT_MS = 8000;
const HANDLE_CACHE_KEY = "atf_handle_cache";

// chrome.storage.local에서 핸들 캐시 불러오기
async function loadHandleCache() {
  try {
    const r = await chrome.storage.local.get(HANDLE_CACHE_KEY);
    return (r && r[HANDLE_CACHE_KEY]) || {};
  } catch (e) {
    console.warn("⚠️ [background.js] 핸들 캐시 로드 실패, 빈 캐시로 진행:", e);
    return {};
  }
}

async function saveHandleCache(cache) {
  try {
    await chrome.storage.local.set({ [HANDLE_CACHE_KEY]: cache });
  } catch (e) {
    console.warn("⚠️ [background.js] 핸들 캐시 저장 실패(조회 결과 자체는 정상 반환됨):", e);
  }
}

// userId+articleNo로 실제 공개 주소(handle) 1건 조회
// 피드백: GET으로 페이지 전체를 받아서 버리던 것 → HEAD 요청으로 트래픽 절감
async function resolveOneHandle(userId, articleNo) {
  const safeUserId = encodeURIComponent(userId);
  const safeArticleNo = encodeURIComponent(articleNo);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`https://brunch.co.kr/@@${safeUserId}/${safeArticleNo}`, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal
    });
    const match = res.url.match(/^https:\/\/brunch\.co\.kr\/@([^/?#]+)/);
    return match ? match[1] : null;
  } catch (e) {
    console.warn(`⚠️ [background.js] ${userId} 주소 조회 실패:`, e.name === "AbortError" ? "타임아웃" : e);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 여러 건을 동시 6개로 제한해서 조회하는 워커 풀. 캐시 적중분은 네트워크 요청 없이 즉시 반환
// 피드백: 매 다운로드마다 같은 작가를 재조회하던 것 → chrome.storage.local 캐싱 + 동시성 제한 추가
// onProgress(done, total): 대량 다운로드 시 진행률 표시용 콜백
async function resolveHandlesWithConcurrencyLimit(items, onProgress) {
  const cache = await loadHandleCache();
  const handles = {};
  const todo = [];
  let doneCount = 0;

  for (const { userId, articleNo } of items) {
    if (!userId || !articleNo) continue;
    if (handles[userId] !== undefined) continue;
    if (cache[userId]) {
      handles[userId] = cache[userId];
      doneCount++;
      continue;
    }
    handles[userId] = null; // 슬롯 선점 - 중복 조회 방지
    todo.push({ userId, articleNo });
  }

  const totalUnique = doneCount + todo.length;
  if (onProgress) onProgress(doneCount, totalUnique);

  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const { userId, articleNo } = todo[cursor++];
      const handle = await resolveOneHandle(userId, articleNo);
      handles[userId] = handle;
      if (handle) cache[userId] = handle;
      doneCount++;
      if (onProgress) onProgress(doneCount, totalUnique);
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, todo.length);
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await saveHandleCache(cache);
  }

  return handles;
}

// 단발성 조회 (멤버십 전문 조회 등 1건짜리 즉시 조회용, 진행률 불필요)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "RESOLVE_BRUNCH_HANDLES") return;
  const items = Array.isArray(message.items) ? message.items : [];
  resolveHandlesWithConcurrencyLimit(items).then((handles) => {
    sendResponse({ handles });
  });
  return true;
});

// 포트 기반 진행률 스트리밍 조회 (대량 다운로드용)
// 피드백: "다운로드가 오래 걸리는데 멈춘 건지 알 수 없다" → 진행 상황을 실시간 전송하도록 추가
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "resolveHandlesProgress") return;

  port.onMessage.addListener(async (message) => {
    if (!message || message.type !== "RESOLVE_BRUNCH_HANDLES") return;
    const items = Array.isArray(message.items) ? message.items : [];

    try {
      const handles = await resolveHandlesWithConcurrencyLimit(items, (done, total) => {
        try { port.postMessage({ type: "PROGRESS", done, total }); } catch (e) { /* 팝업 닫힘 무시 */ }
      });
      port.postMessage({ type: "DONE", handles });
    } catch (e) {
      console.warn("⚠️ [background.js] 진행률 포함 핸들 조회 실패:", e);
      port.postMessage({ type: "DONE", handles: {} });
    }
  });
});
