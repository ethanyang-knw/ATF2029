// background.js
// 기능: 서비스워커. userId → 브런치 공개 주소(vanity handle) 조회

const MAX_CONCURRENT_REQUESTS = 6;
const REQUEST_TIMEOUT_MS = 8000;
const HANDLE_CACHE_KEY = "atf_handle_cache_v2";
const HANDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일 (필명 변경 대비)

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

// userId+articleNo로 실제 공개 주소(handle) 1건 조회. HEAD로 우선 시도하고,
// 서버가 HEAD를 거부하면(405/501 등) GET으로 1회 폴백한다.
async function resolveOneHandle(userId, articleNo) {
  const safeUserId = encodeURIComponent(userId);
  const safeArticleNo = encodeURIComponent(articleNo);
  const url = `https://brunch.co.kr/@@${safeUserId}/${safeArticleNo}`;
  const HANDLE_URL_PATTERN = /^https:\/\/brunch\.co\.kr\/@([^/?#]+)/;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    let match = res.url.match(HANDLE_URL_PATTERN);

    if (!match && (res.status === 405 || res.status === 501 || !res.ok)) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
      match = res.url.match(HANDLE_URL_PATTERN);
    }

    return match ? match[1] : null;
  } catch (e) {
    console.warn(`⚠️ [background.js] ${userId} 주소 조회 실패:`, e.name === "AbortError" ? "타임아웃" : e);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 여러 건을 동시 6개로 제한해서 조회하는 워커 풀. 캐시 적중(TTL 이내)분은 네트워크 요청 없이
// 즉시 반환. onProgress(done, total)는 대량 다운로드 시 진행률 표시용 콜백.
async function resolveHandlesWithConcurrencyLimit(items, onProgress) {
  const cache = await loadHandleCache();
  const handles = {};
  const todo = [];
  let doneCount = 0;

  for (const { userId, articleNo } of items) {
    if (!userId || !articleNo) continue;
    if (handles[userId] !== undefined) continue;

    const cached = cache[userId];
    if (cached && cached.handle && (Date.now() - cached.at) < HANDLE_TTL_MS) {
      handles[userId] = cached.handle;
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
      if (handle) cache[userId] = { handle, at: Date.now() };
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

// 포트 기반 진행률 스트리밍 조회 (대량 다운로드용)
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
