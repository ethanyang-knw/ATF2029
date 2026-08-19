// injected.js
// 기능: 메인 world(페이지 컨텍스트)에서 실행 - 발행글 목록 페이지 수집

// 격리 world(content-main.js)로 alert/confirm/prompt 표시를 요청하고 사용자 응답을 기다린다.
// 메인 world는 격리 world의 atfAlert() 등 함수를 직접 부를 수 없어(서로 다른 JS 실행공간),
// postMessage 왕복으로 대신 요청한다.
function requestAtfModal(kind, message, defaultValue) {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const handler = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (!event.data || event.data.type !== "ATF_MODAL_RESULT" || event.data.requestId !== requestId) return;
      window.removeEventListener("message", handler);
      resolve(event.data.value);
    };
    window.addEventListener("message", handler);
    window.postMessage({ type: "ATF_MODAL_REQUEST", requestId, kind, message, defaultValue }, "*");
  });
}

// ══════════════════════════════════════════════════════════════════
// § 1. 발행글 목록 페이지 수집
// ══════════════════════════════════════════════════════════════════

const MAX_PAGES = 5000; // 무한루프 방지용 안전 상한 (실질적으로는 빈 배치에서 먼저 종료)
const BATCH_SIZE = 6;   // 동시 요청 페이지 수
const BATCH_DELAY_MS = 50;
const CONFIRM_PAGE_THRESHOLD = 200; // 이 페이지 수 초과 시 진행 여부 확인창
const EMPTY_BATCHES_TO_STOP = 2;    // 연속 이 횟수만큼 빈 배치면 수집 종료

// 검색 결과 메모리 캐시 (세션 한정, 5분 TTL)
const CACHE_TTL_MS = 5 * 60 * 1000;
let rawDataCache = { key: null, articles: null, cachedAt: 0 };

// 24h 검색용 5분 버킷 - 같은 5분 구간이면 캐시 적중되게 시각을 내림 처리
function bucket5min(ms) {
  const B = 5 * 60 * 1000;
  return Math.floor(ms / B) * B;
}

// 캐시 키 계산 (포함/제외 조건은 캐시 이후 필터링이라 키에 영향 없음)
function buildCacheKey(filterParams, timeParams) {
  if (!timeParams) return '__site_default__';
  if (filterParams && filterParams.dateEnabled && filterParams.dateType === '24h') {
    return `24h__${bucket5min(timeParams.nowAnchorMs || Date.now())}`;
  }
  return `${timeParams.fromTime}__${timeParams.toTime}`;
}

// 진행 로그를 콘솔+팝업(SEARCH_PROGRESS)에 동시 전달
function logProgress(message) {
  console.log(message);
  window.postMessage({ type: "SEARCH_PROGRESS", message }, "*");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 검색 조건에 맞는 서버 요청용 fromTime/toTime 계산
// (24h/직접지정/기본값 각각 다른 방식 - 기본값은 조건 없을 때 최근 1일로 제한)
function computeTimeRangeParams(filterParams) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} 00:00`;
  const fmtWithTime = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  if (filterParams && filterParams.dateEnabled && filterParams.dateType === 'direct' &&
      filterParams.dateStart && filterParams.dateEnd) {
    const from = new Date(`${filterParams.dateStart}T00:00:00`);
    const to = new Date(`${filterParams.dateEnd}T00:00:00`);
    to.setDate(to.getDate() + 1);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { time: 'custom', fromTime: fmt(from), toTime: fmt(to) };
    }
    return null;
  }

  if (filterParams && filterParams.dateEnabled && filterParams.dateType === '24h') {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { time: 'custom', fromTime: fmtWithTime(from), toTime: fmtWithTime(now), nowAnchorMs: now.getTime() };
  }

  const DEFAULT_LOOKBACK_DAYS = 1;
  const to = new Date();
  to.setDate(to.getDate() + 1);
  const from = new Date();
  from.setDate(from.getDate() - DEFAULT_LOOKBACK_DAYS);
  return { time: 'custom', fromTime: fmt(from), toTime: fmt(to), isDefaultRange: true, lookbackDays: DEFAULT_LOOKBACK_DAYS };
}

// svelteProps 패턴이 응답 스트림에 도착하는 즉시 연결 종료 (불필요한 나머지 바디 수신 방지)
const SVELTE_PROPS_PATTERN = /svelteProps\s*=\s*\{.*?\};/s;

async function fetchPage(page, timeParams) {
  const targetUrl = new URL(location.href);
  targetUrl.searchParams.set("page", page);
  if (timeParams) {
    targetUrl.searchParams.set("time", timeParams.time);
    targetUrl.searchParams.set("fromTime", timeParams.fromTime);
    targetUrl.searchParams.set("toTime", timeParams.toTime);
  }

  try {
    const res = await fetch(targetUrl.toString(), { credentials: "same-origin" });
    if (!res.ok) return null;

    if (!res.body || !res.body.getReader) {
      return await res.text();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (SVELTE_PROPS_PATTERN.test(buffer)) {
        reader.cancel().catch(() => {});
        break;
      }
    }

    return buffer;
  } catch (e) {
    return null;
  }
}

// HTML에서 svelteProps 파싱 - 게시글 목록 + 전체 페이지 수 추출
function parseSveltePropsFromHtml(html) {
  if (!html) return null;

  const match = html.match(/svelteProps\s*=\s*(\{.*?\});/s);
  if (!match || !match[1]) return null;

  try {
    const props = JSON.parse(match[1]);
    const dailyList = props.dailyList || props.list || props.articles || [];
    const totalPageCount = props.pageModel && Number.isFinite(props.pageModel.totalPageCount)
      ? props.pageModel.totalPageCount
      : null;
    const totalItemCount = props.pageModel && Number.isFinite(props.pageModel.totalItemCount)
      ? props.pageModel.totalItemCount
      : null;
    return { dailyList, totalPageCount, totalItemCount };
  } catch (e) {
    return null;
  }
}

// 검색 실행 - 1페이지로 전체 페이지 수 확인 후 배치 단위로 나머지 수집
window.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "REQ_SVELTE_PAGES") return;
  if (event.source !== window || event.origin !== location.origin) return;

  const searchStartedAt = performance.now();

  const filterParams = event.data.params;
  const allArticles = [];
  let totalRequestCount = 0;
  let failedRequestCount = 0;

  const timeParams = computeTimeRangeParams(filterParams);
  const cacheKey = buildCacheKey(filterParams, timeParams);

  const finish = (fromCache = false) => {
    const elapsedSec = ((performance.now() - searchStartedAt) / 1000).toFixed(1);
    logProgress(`⏱️ [injected.js] 총 소요시간: ${elapsedSec}초`);
    if (!fromCache && totalRequestCount > 0) {
      const failRate = ((failedRequestCount / totalRequestCount) * 100).toFixed(1);
      logProgress(`📡 [injected.js] 요청 ${totalRequestCount}건 중 실패 ${failedRequestCount}건 (실패율 ${failRate}%)`);
    }
    logProgress(`✅ [injected.js] 총 ${allArticles.length}개 게시글 원천 데이터 준비 완료${fromCache ? ' (캐시 사용)' : ''}`);
    window.postMessage({
      type: "RES_SVELTE_PAGES",
      articles: allArticles,
      // nowAnchorMs를 필터링 단계까지 전달 - 검색 소요시간만큼 "지금"이 밀려서
      // 경계선 글이 잘못 제외되는 것 방지
      filterParams: { ...filterParams, nowAnchorMs: timeParams ? timeParams.nowAnchorMs : undefined },
      usedDefaultRange: !!(timeParams && timeParams.isDefaultRange),
      lookbackDays: timeParams ? timeParams.lookbackDays : null,
      fromCache: fromCache
    }, "*");
  };

  // 캐시 적중 조건: 같은 기간 + TTL 이내 + 강제 재검색 아님
  const isCacheFresh = rawDataCache.key === cacheKey
    && rawDataCache.articles
    && (Date.now() - rawDataCache.cachedAt) < CACHE_TTL_MS
    && !filterParams.forceRefresh;

  if (isCacheFresh) {
    logProgress(`⚡ [injected.js] 캐시 적중 - 이전에 받아둔 ${rawDataCache.articles.length}개 데이터를 그대로 재사용 (새 요청 없음)`);
    allArticles.push(...rawDataCache.articles);
    finish(true);
    return;
  }
  if (filterParams.forceRefresh && rawDataCache.key === cacheKey) {
    logProgress(`🔄 [injected.js] "캐시 무시하고 재검색" 요청 - 캐시를 건너뛰고 새로 조회합니다`);
  }

  logProgress(`🚀 [injected.js] 1페이지를 먼저 확인해 전체 페이지 수를 파악한 뒤 수집 시작`);
  if (timeParams) {
    logProgress(`🗓️ [injected.js] 조회 기간 범위 지정: ${timeParams.fromTime} ~ ${timeParams.toTime}`);
  }

  try {
    // 1페이지로 totalPageCount 확인
    const firstHtml = await fetchPage(1, timeParams);
    totalRequestCount++;
    if (firstHtml === null) failedRequestCount++;
    const firstParsed = parseSveltePropsFromHtml(firstHtml);

    if (firstParsed && firstParsed.dailyList.length > 0) {
      allArticles.push(...firstParsed.dailyList);
      logProgress(`📦 [1페이지] ${firstParsed.dailyList.length}개 수집 (누적 ${allArticles.length}개)`);
    }

    if (firstParsed && firstParsed.totalPageCount) {
      // totalPageCount를 알아냈으니 그만큼만 배치로 수집
      const totalPageCount = firstParsed.totalPageCount;
      logProgress(`🎯 [injected.js] 전체 페이지 수 확인됨: ${totalPageCount}페이지`);

      if (totalPageCount > CONFIRM_PAGE_THRESHOLD) {
        const ok = await requestAtfModal(
          'confirm',
          `이 조건은 약 ${totalPageCount.toLocaleString()}페이지를 조회합니다.\n` +
          `운영툴 서버에 부하가 있을 수 있어요. 진행할까요?\n\n` +
          `(기간을 좁히면 훨씬 빨라집니다)`
        );
        if (!ok) {
          logProgress("🛑 사용자가 조회를 취소했습니다.");
          finish();
          return;
        }
      }

      for (let batchStart = 2; batchStart <= totalPageCount; batchStart += BATCH_SIZE) {
        const batchStartedAt = performance.now();
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPageCount);
        const pageNumbers = [];
        for (let p = batchStart; p <= batchEnd; p++) pageNumbers.push(p);

        const htmlTexts = await Promise.all(pageNumbers.map(p => fetchPage(p, timeParams)));

        let batchArticleCount = 0;
        let batchFailCount = 0;
        htmlTexts.forEach((html, idx) => {
          const pageNum = pageNumbers[idx];
          totalRequestCount++;
          if (html === null) {
            failedRequestCount++;
            batchFailCount++;
            return;
          }
          const parsed = parseSveltePropsFromHtml(html);
          if (parsed && parsed.dailyList.length > 0) {
            allArticles.push(...parsed.dailyList);
            batchArticleCount += parsed.dailyList.length;
            console.log(`  └─ [${pageNum}페이지] ${parsed.dailyList.length}개 원천 게시글 추출 성공`);
          }
        });

        const batchElapsedSec = ((performance.now() - batchStartedAt) / 1000).toFixed(2);
        const failNote = batchFailCount > 0 ? `, 실패 ${batchFailCount}건` : '';
        logProgress(`📦 [배치 ${batchStart}~${batchEnd}/${totalPageCount}] ${batchArticleCount}개 수집 (누적 ${allArticles.length}개, ${batchElapsedSec}초 소요${failNote})`);

        if (batchEnd < totalPageCount) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      rawDataCache = { key: cacheKey, articles: allArticles.slice(), cachedAt: Date.now() };
      finish();
      return;
    }

    // 폴백: totalPageCount 확인 실패 시 빈 배치가 나올 때까지 순차 탐색
    logProgress(`⚠️ [injected.js] 전체 페이지 수를 확인 못 함 - 빈 배치가 나올 때까지 탐색하는 방식으로 진행`);
    let consecutiveEmptyBatches = 0;

    for (let batchStart = 2; batchStart <= MAX_PAGES; batchStart += BATCH_SIZE) {
      const batchStartedAt = performance.now();
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, MAX_PAGES);
      const pageNumbers = [];
      for (let p = batchStart; p <= batchEnd; p++) pageNumbers.push(p);

      const htmlTexts = await Promise.all(pageNumbers.map(p => fetchPage(p, timeParams)));

      let batchArticleCount = 0;
      let batchFailCount = 0;
      htmlTexts.forEach((html, idx) => {
        const pageNum = pageNumbers[idx];
        totalRequestCount++;
        if (html === null) {
          failedRequestCount++;
          batchFailCount++;
          return;
        }
        const parsed = parseSveltePropsFromHtml(html);
        if (parsed && parsed.dailyList.length > 0) {
          allArticles.push(...parsed.dailyList);
          batchArticleCount += parsed.dailyList.length;
          console.log(`  └─ [${pageNum}페이지] ${parsed.dailyList.length}개 원천 게시글 추출 성공`);
        }
      });

      const batchElapsedSec = ((performance.now() - batchStartedAt) / 1000).toFixed(2);
      const failNote = batchFailCount > 0 ? `, 실패 ${batchFailCount}건` : '';
      logProgress(`📦 [배치 ${batchStart}~${batchEnd}] ${batchArticleCount}개 수집 (누적 ${allArticles.length}개, ${batchElapsedSec}초 소요${failNote})`);

      if (batchArticleCount === 0) {
        consecutiveEmptyBatches++;
        logProgress(`⚠️ [injected.js] ${batchStart}~${batchEnd}페이지 빈 배치 (연속 ${consecutiveEmptyBatches}/${EMPTY_BATCHES_TO_STOP})`);
        if (consecutiveEmptyBatches >= EMPTY_BATCHES_TO_STOP) {
          logProgress(`🛑 [injected.js] 연속 ${EMPTY_BATCHES_TO_STOP}개 배치가 비어 마지막 페이지로 판단, 수집 종료`);
          break;
        }
      } else {
        consecutiveEmptyBatches = 0;
      }

      if (batchEnd < MAX_PAGES) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    rawDataCache = { key: cacheKey, articles: allArticles.slice(), cachedAt: Date.now() };
    finish();
  } catch (err) {
    console.error("❌ [injected.js] 수집 도중 오류 발생:", err);
    finish();
  }
});

console.log("🟢 [ATF2029] injected.js 메인 스크립트 주입 완료");
