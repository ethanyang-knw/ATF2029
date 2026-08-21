// content-main.js
// 기능: 전역 상태·상수, 발행글 목록 페이지 수집·필터링, 검색 팝업(iframe) 생성 및 메시지 처리,
// 검색 실행·엑셀 다운로드, 작가 실제 주소 조회, 팝업 드래그, 커스텀 alert/confirm 모달,
// 확장 초기화 진입점(SPA 페이지 이동 감지 포함)
//
// §0(전역 상태)이 맨 위, §7(초기화 진입점)이 맨 아래에 위치 - 파일 내부는 위→아래로 순서가
// 보장되므로 안전하게 초기화된다.

// ══════════════════════════════════════════════════════════════════
// § 0. 전역 상태·상수 (다른 어떤 함수보다 먼저 선언되어야 함)
// ══════════════════════════════════════════════════════════════════

console.log("🟢 [ATF2029] content.js 로드 완료 (Frame ID:", window.name || "current", ")");

let lastUrl = location.href;

// 다운로드 기능에서 사용하는 최근 검색결과 캐시
let lastMatchedItems = [];

let isSearchingProcess = false;
let isDownloadingProcess = false; // 다운로드 진행 중 중복클릭으로 재실행되는 것 방지

// postMessage 발신처 검증용 확장 origin
// 모든 postMessage 리스너가 이 값과 대조해 위조 메시지를 차단
const ATF_EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);

const POPUP_IFRAME_ID = "my-extension-modal-iframe";

// 검색 팝업 iframe 요소 조회 - 여러 곳에서 반복되던 document.getElementById 호출을 통일
function getPopupIframe() {
  return document.getElementById(POPUP_IFRAME_ID);
}

// iframe이 없으면 생성까지 해서 반환 (toggleExtensionModal에서 사용)
function ensurePopupIframe() {
  let iframe = getPopupIframe();
  if (!iframe) {
    createExtensionModal();
    iframe = getPopupIframe();
  }
  return iframe;
}

// 팝업(iframe)으로 메시지 전송 - 여러 곳에 흩어져 있던 "iframe 조회 후 postMessage" 패턴을 통일.
// 어차피 iframe.src가 확장 자체 URL(popup.html)이라 iframe의 origin은 항상 ATF_EXTENSION_ORIGIN과 같음.
function postToPopup(type, payload = {}) {
  const iframe = getPopupIframe();
  if (!iframe || !iframe.contentWindow) return false;
  iframe.contentWindow.postMessage({ type, ...payload }, ATF_EXTENSION_ORIGIN);
  return true;
}

// ══════════════════════════════════════════════════════════════════
// § 0-1. 커스텀 alert/confirm/prompt 모달 (페이지에 직접 그림 - popup.html 팝업과는 별개)
// ══════════════════════════════════════════════════════════════════
// 브런치 페이지 자체에 확장 스타일의 모달을 직접 그려서 표시. 동적 값은 항상 textContent로만
// 넣어서 XSS 여지를 없앤다.
function atfShowModal_({ title, message }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.4)', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#fff', borderRadius: '10px', padding: '20px',
      width: '320px', maxWidth: '90vw', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
      fontSize: '13px', color: '#1C2A3A', boxSizing: 'border-box'
    });

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    Object.assign(titleEl.style, { fontWeight: '700', fontSize: '14px', marginBottom: '10px' });

    const msgEl = document.createElement('div');
    msgEl.textContent = message; // XSS 방지 - 항상 textContent로만 삽입
    Object.assign(msgEl.style, { marginBottom: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap' });

    box.append(titleEl, msgEl);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px' });

    const makeBtn = (text, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      Object.assign(b.style, {
        padding: '7px 14px', borderRadius: '6px', border: primary ? 'none' : '1px solid #DCE2EE',
        background: primary ? '#5B8DEF' : '#fff', color: primary ? '#fff' : '#6070A0',
        fontSize: '12px', fontWeight: '600', cursor: 'pointer'
      });
      return b;
    };

    const cleanup = () => overlay.remove();

    const cancelBtn = makeBtn('취소', false);
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
    const okBtn = makeBtn('확인', true);
    okBtn.addEventListener('click', () => { cleanup(); resolve(true); });
    btnRow.append(cancelBtn, okBtn);

    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

function atfConfirm(message, title) {
  return atfShowModal_({ title: title || '확인', message });
}

// ══════════════════════════════════════════════════════════════════
// § 1. 초기화 (모달/버튼 생성, SPA 재초기화 진입점)
// ══════════════════════════════════════════════════════════════════

// 페이지의 [다운로드] 버튼 옆에 [🔍 조건검색] 버튼 생성
function injectExtensionButton() {
  if (window !== window.top) return;
  if (!location.pathname.includes("/article/daily")) return;
  if (document.getElementById("btn-atf-open-modal")) return;

  const buttons = Array.from(document.querySelectorAll("button, a, input[type='button']"));
  const downloadBtn = buttons.find(btn => btn.textContent.trim().includes("다운로드"));

  if (downloadBtn && downloadBtn.parentElement) {
    const customBtn = document.createElement("button");
    customBtn.id = "btn-atf-open-modal";
    customBtn.type = "button";
    customBtn.textContent = "🔍 조건검색";
    customBtn.className = downloadBtn.className || "btn btn-default";
    Object.assign(customBtn.style, {
      fontWeight: "bold",
      backgroundColor: "#4285f4",
      color: "#ffffff",
      border: "1px solid #357ae8",
      cursor: "pointer",
      marginLeft: "4px"
    });

    customBtn.addEventListener("click", () => {
      toggleExtensionModal();
    });

    downloadBtn.parentElement.appendChild(customBtn);
  }
}

// 검색 팝업 모달 iframe 생성
function createExtensionModal() {
  if (window !== window.top) return;
  if (getPopupIframe()) return;

  const iframe = document.createElement("iframe");
  iframe.id = POPUP_IFRAME_ID;

  try {
    iframe.src = chrome.runtime.getURL("popup.html");
  } catch (err) {
    console.error("❌ popup.html 로드 실패", err);
    return;
  }

  Object.assign(iframe.style, {
    position: "fixed",
    top: "30px",
    right: "20px",
    width: "600px",
    height: "235px",
    border: "none",
    borderRadius: "12px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
    zIndex: "9999999",
    background: "#EDF0F5",
    transition: "height 0.15s ease",
    display: "none"
  });

  document.body.appendChild(iframe);
}

function toggleExtensionModal() {
  const iframe = ensurePopupIframe();
  if (!iframe) return;
  iframe.style.display = (iframe.style.display === "none" || !iframe.style.display) ? "block" : "none";
}

function checkAndInitExtension() {
  if (window !== window.top) return;

  if (!window.location.href.includes("/article/daily")) {
    // 조건검색 대상 화면을 벗어나면 삽입해둔 버튼/iframe을 정리 (다른 화면에 남아있지 않도록)
    document.getElementById("btn-atf-open-modal")?.remove();
    getPopupIframe()?.remove();
    return;
  }

  createExtensionModal();
  injectExtensionButton();
}

// ══════════════════════════════════════════════════════════════════
// § 2. 검색 결과 필터링
// ══════════════════════════════════════════════════════════════════

// 발행 시각 원본 타임스탬프(ms) 반환 - 발행시각 필터링에 사용
function getPublishTimeMs(item) {
  if (!item) return null;

  const rawTime = item.publishTime || (item.article && item.article.publishTime);
  if (!rawTime) return null;

  let timeMs = typeof rawTime === 'number' ? rawTime : new Date(rawTime).getTime();

  if (timeMs < 10000000000) {
    timeMs = timeMs * 1000;
  }

  if (isNaN(timeMs) || timeMs <= 0) return null;
  return timeMs;
}

// 게시글 하나가 검색 조건(포함/제외/발행시각)에 맞는지 판정
function checkArticleMatch(item, filterParams) {
  if (!filterParams) return true;

  const {
    includeTags,
    includeMatchMode,
    excludeUserTypes,
    dateType,
    dateStart,
    dateEnd,
    nowAnchorMs
  } = filterParams;

  const title = (item.title || (item.article && item.article.title) || '').toLowerCase();
  const subTitle = (item.subTitle || (item.article && item.article.subTitle) || '').toLowerCase();

  let keywordsArr = [];
  const rawKeywords = item.keywords || (item.article && item.article.keywords);
  if (Array.isArray(rawKeywords)) {
    keywordsArr = rawKeywords.map(k => typeof k === 'object' ? (k.name || k.keyword || '') : k).filter(Boolean);
  } else if (typeof rawKeywords === 'string') {
    keywordsArr = [rawKeywords];
  }
  const keywordsStr = keywordsArr.join(', ').toLowerCase();

  const titleAndSubTitle = `${title} ${subTitle}`;

  let isMatch = true;

  // 포함 조건 - 태그별 카테고리(제목/키워드/제목+키워드)에 맞는 필드만 매칭.
  // includeMatchMode가 'AND'면 태그를 전부 만족해야 하고, 'OR'(기본값)면 하나만 만족해도 됨.
  if (Array.isArray(includeTags) && includeTags.length > 0) {
    const matchesTag = (tagItem) => {
      const isObj = tagItem && typeof tagItem === 'object';
      const tagText = (isObj ? tagItem.text : tagItem || '').toLowerCase().trim();
      if (!tagText) return false;
      const category = (isObj ? tagItem.category : 'keyword') || 'keyword';

      switch (category) {
        case 'title':
          return titleAndSubTitle.includes(tagText);
        case 'title_keyword':
          return titleAndSubTitle.includes(tagText) || keywordsStr.includes(tagText);
        case 'keyword':
        case 'keyword_text':
        default:
          return keywordsStr.includes(tagText);
      }
    };

    const hasIncludeKeyword = includeMatchMode === 'AND'
      ? includeTags.every(matchesTag)
      : includeTags.some(matchesTag);

    if (!hasIncludeKeyword) isMatch = false;
  }

  // 제외 조건 - 유저타입/멤버십 여부로 필터링
  if (isMatch && Array.isArray(excludeUserTypes) && excludeUserTypes.length > 0) {
    const isMembershipPro = !!(item.isMembershipContent || item.membershipContent || (item.article && item.article.membershipContent));
    const userType = item.managedUserType || (item.article && item.article.managedUserType) || '';
    const derivedTypes = userType ? [userType] : [];
    if (isMembershipPro) derivedTypes.push('membership_pro');

    const hasExcludeUser = excludeUserTypes.some(type => {
      const cleanType = type.trim().toLowerCase();
      return cleanType && derivedTypes.includes(cleanType);
    });
    if (hasExcludeUser) isMatch = false;
  }

  // 발행 시각 조건 - 원본 타임스탬프 직접 비교 (24h는 nowAnchorMs 재사용으로 경계선 오차 방지)
  if (isMatch && dateType && dateType !== "") {
    const publishTimeMs = getPublishTimeMs(item);

    if (publishTimeMs === null) {
      // 발행 시각을 확인할 수 없는 게시글은 날짜 조건을 만족하는지 판단 불가 - 안전하게 제외
      isMatch = false;
    } else if (dateType === "24h") {
      const nowMs = nowAnchorMs || Date.now();
      // 미래 시각이면 (nowMs - publishTimeMs)가 음수가 되어 항상 통과하는 버그 방지 - 하한(미래 아님) 조건 추가
      const withinLast24h = publishTimeMs <= nowMs && (nowMs - publishTimeMs) <= 24 * 60 * 60 * 1000;
      if (!withinLast24h) isMatch = false;
    } else if (dateType === "direct" && dateStart && dateEnd) {
      const startMs = new Date(`${dateStart}T00:00:00`).getTime();
      const endMs = new Date(`${dateEnd}T23:59:59.999`).getTime();
      if (!isNaN(startMs) && !isNaN(endMs)) {
        if (publishTimeMs < startMs || publishTimeMs > endMs) isMatch = false;
      }
    }
  }

  return isMatch;
}

// ══════════════════════════════════════════════════════════════════
// § 3-0. 발행글 목록 페이지 수집
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
  if (filterParams && filterParams.dateType === '24h') {
    return `24h__${bucket5min(timeParams.nowAnchorMs || Date.now())}`;
  }
  return `${timeParams.fromTime}__${timeParams.toTime}`;
}

// 진행 로그를 콘솔에 남기고 팝업(SEARCH_PROGRESS)으로 직접 중계
function logProgress(message) {
  console.log(message);
  postToPopup("SEARCH_PROGRESS", { message });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 검색 조건에 맞는 서버 요청용 fromTime/toTime 계산 (dateType: 24h/direct)
function computeTimeRangeParams(filterParams) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} 00:00`;
  const fmtWithTime = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  if (filterParams && filterParams.dateType === 'direct' &&
      filterParams.dateStart && filterParams.dateEnd) {
    const from = new Date(`${filterParams.dateStart}T00:00:00`);
    const to = new Date(`${filterParams.dateEnd}T00:00:00`);
    to.setDate(to.getDate() + 1);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { time: 'custom', fromTime: fmt(from), toTime: fmt(to) };
    }
    return null;
  }

  if (filterParams && filterParams.dateType === '24h') {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { time: 'custom', fromTime: fmtWithTime(from), toTime: fmtWithTime(now), nowAnchorMs: now.getTime() };
  }

  // dateType이 24h/direct 둘 다 아닌 경우의 안전한 기본값: 최근 1일
  const to = new Date();
  to.setDate(to.getDate() + 1);
  const from = new Date();
  from.setDate(from.getDate() - 1);
  return { time: 'custom', fromTime: fmt(from), toTime: fmt(to) };
}

// svelteProps 패턴이 응답 스트림에 도착하는 즉시 연결 종료 (불필요한 나머지 바디 수신 방지)
const SVELTE_PROPS_PATTERN = /svelteProps\s*=\s*\{.*?\};/s;
const FETCH_TIMEOUT_MS = 30000;        // 요청이 이 시간 넘게 응답 없으면 중단
const MAX_BUFFER_CHARS = 5 * 1024 * 1024; // 패턴을 못 찾은 채 버퍼가 이 크기(약 5MB)를 넘으면 페이지 구조 변경으로 보고 중단

async function fetchPage(page, timeParams) {
  const targetUrl = new URL(location.href);
  targetUrl.searchParams.set("page", page);
  if (timeParams) {
    targetUrl.searchParams.set("time", timeParams.time);
    targetUrl.searchParams.set("fromTime", timeParams.fromTime);
    targetUrl.searchParams.set("toTime", timeParams.toTime);
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(targetUrl.toString(), { credentials: "same-origin", signal: abortController.signal });
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

      if (buffer.length > MAX_BUFFER_CHARS) {
        // 패턴을 못 찾았는데 응답이 비정상적으로 커짐 - 페이지 구조 변경 등으로 판단, 무한정 쌓지 않고 실패 처리
        reader.cancel().catch(() => {});
        return null;
      }
    }

    return buffer;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeoutId);
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
    return { dailyList, totalPageCount };
  } catch (e) {
    return null;
  }
}

// start~end 페이지 번호 배열 생성
function createPageRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// 페이지 번호 배열 하나를 동시에 요청해서 파싱까지 수행 - 전체페이지 아는 경우/모르는 경우
// 두 수집 루프에서 거의 동일하게 반복되던 로직을 하나로 통합
async function fetchArticleBatch(pageNumbers, timeParams) {
  const startedAt = performance.now();
  const htmlTexts = await Promise.all(pageNumbers.map(p => fetchPage(p, timeParams)));

  const articles = [];
  let requestFailedCount = 0;
  let hadIssue = false;

  htmlTexts.forEach((html, idx) => {
    const pageNum = pageNumbers[idx];
    if (html === null) {
      requestFailedCount++;
      hadIssue = true;
      return;
    }
    const parsed = parseSveltePropsFromHtml(html);
    if (parsed === null) {
      // 응답은 받았으나 파싱 실패 - 로그인 세션 만료 등으로 페이지 구조가 다를 가능성
      hadIssue = true;
    } else if (parsed.dailyList.length > 0) {
      articles.push(...parsed.dailyList);
      console.log(`  └─ [${pageNum}페이지] ${parsed.dailyList.length}개 원천 게시글 추출 성공`);
    }
  });

  return {
    articles,
    requestCount: pageNumbers.length,
    requestFailedCount,
    hadIssue,
    elapsedSeconds: ((performance.now() - startedAt) / 1000).toFixed(2)
  };
}

// 검색 실행 - 1페이지로 전체 페이지 수 확인 후 배치 단위로 나머지 수집
async function collectArticles(filterParams) {
  const searchStartedAt = performance.now();
  const allArticles = [];
  let totalRequestCount = 0;
  let failedRequestCount = 0;
  // 요청 실패(null) 또는 응답은 받았지만 파싱 실패(세션 만료 등 의심) 시 true -
  // 결과가 일부 누락됐을 수 있다는 뜻이라 검색 완료 후 재검색 권장 안내에 사용됨
  let hadDataIssue = false;

  const timeParams = computeTimeRangeParams(filterParams);
  const cacheKey = buildCacheKey(filterParams, timeParams);

  const buildResult = (fromCache = false, errorMessage = null, cancelled = false) => {
    const elapsedSec = ((performance.now() - searchStartedAt) / 1000).toFixed(1);
    logProgress(`⏱️ [수집] 총 소요시간: ${elapsedSec}초`);
    if (!fromCache && totalRequestCount > 0) {
      const failRate = ((failedRequestCount / totalRequestCount) * 100).toFixed(1);
      logProgress(`📡 [수집] 요청 ${totalRequestCount}건 중 실패 ${failedRequestCount}건 (실패율 ${failRate}%)`);
    }
    logProgress(`✅ [수집] 총 ${allArticles.length}개 게시글 원천 데이터 준비 완료${fromCache ? ' (캐시 사용)' : ''}`);
    return {
      articles: allArticles,
      // nowAnchorMs를 필터링 단계까지 전달 - 검색 소요시간만큼 "지금"이 밀려서
      // 경계선 글이 잘못 제외되는 것 방지
      filterParams: { ...filterParams, nowAnchorMs: timeParams ? timeParams.nowAnchorMs : undefined },
      fromCache: fromCache,
      hadDataIssue: fromCache ? false : hadDataIssue,
      error: errorMessage,
      cancelled: cancelled
    };
  };

  // 캐시 적중 조건: 같은 기간 + TTL 이내 + 강제 재검색 아님
  const isCacheFresh = rawDataCache.key === cacheKey
    && rawDataCache.articles
    && (Date.now() - rawDataCache.cachedAt) < CACHE_TTL_MS
    && !filterParams.forceRefresh;

  if (isCacheFresh) {
    logProgress(`⚡ [수집] 캐시 적중 - 이전에 받아둔 ${rawDataCache.articles.length}개 데이터를 그대로 재사용 (새 요청 없음)`);
    allArticles.push(...rawDataCache.articles);
    return buildResult(true);
  }
  if (filterParams.forceRefresh && rawDataCache.key === cacheKey) {
    logProgress(`🔄 [수집] "캐시 무시하고 재검색" 요청 - 캐시를 건너뛰고 새로 조회합니다`);
  }

  logProgress(`🚀 [수집] 1페이지를 먼저 확인해 전체 페이지 수를 파악한 뒤 수집 시작`);
  if (timeParams) {
    logProgress(`🗓️ [수집] 조회 기간 범위 지정: ${timeParams.fromTime} ~ ${timeParams.toTime}`);
  }

  try {
    // 1페이지로 totalPageCount 확인
    const firstHtml = await fetchPage(1, timeParams);
    totalRequestCount++;
    if (firstHtml === null) failedRequestCount++;
    const firstParsed = parseSveltePropsFromHtml(firstHtml);

    if (firstHtml === null || firstParsed === null) {
      // 1페이지조차 못 읽으면 전체 페이지 수 파악 자체가 불가능 - "0건 검색완료"로 위장하지 않고 바로 실패 처리
      hadDataIssue = true;
      logProgress("🛑 [수집] 1페이지를 불러오지 못했습니다. 로그인 세션 만료 가능성이 있습니다.");
      return buildResult(false, "게시글 목록을 불러오지 못했습니다. 로그인 상태를 확인한 뒤 다시 검색해 주세요.");
    }

    if (firstParsed && firstParsed.dailyList.length > 0) {
      allArticles.push(...firstParsed.dailyList);
      logProgress(`📦 [1페이지] ${firstParsed.dailyList.length}개 수집 (누적 ${allArticles.length}개)`);
    }

    if (firstParsed && Number.isFinite(firstParsed.totalPageCount)) {
      // totalPageCount를 알아냈으니 그만큼만 배치로 수집 (0이어도 유효한 값 - 검색결과 0건인 정상 케이스)
      const totalPageCount = firstParsed.totalPageCount;
      logProgress(`🎯 [수집] 전체 페이지 수 확인됨: ${totalPageCount}페이지`);

      if (totalPageCount > CONFIRM_PAGE_THRESHOLD) {
        const ok = await atfConfirm(
          `이 조건은 약 ${totalPageCount.toLocaleString()}페이지를 조회합니다.\n` +
          `운영툴 서버에 부하가 있을 수 있어요. 진행할까요?\n\n` +
          `(기간을 좁히면 훨씬 빨라집니다)`
        );
        if (!ok) {
          logProgress("🛑 사용자가 조회를 취소했습니다.");
          return buildResult(false, null, true);
        }
      }

      for (let batchStart = 2; batchStart <= totalPageCount; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPageCount);
        const batch = await fetchArticleBatch(createPageRange(batchStart, batchEnd), timeParams);

        allArticles.push(...batch.articles);
        totalRequestCount += batch.requestCount;
        failedRequestCount += batch.requestFailedCount;
        if (batch.hadIssue) hadDataIssue = true;

        const failNote = batch.requestFailedCount > 0 ? `, 실패 ${batch.requestFailedCount}건` : '';
        logProgress(`📦 [배치 ${batchStart}~${batchEnd}/${totalPageCount}] ${batch.articles.length}개 수집 (누적 ${allArticles.length}개, ${batch.elapsedSeconds}초 소요${failNote})`);

        if (batchEnd < totalPageCount) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      // 일부 페이지 실패/파싱실패가 있었다면 불완전한 결과라 캐시에 저장하지 않음 -
      // 재검색 시 다시 시도되게 해서, 재사용된 캐시가 hadDataIssue 경고 없이 "정상"으로 보이는 것 방지
      if (!hadDataIssue) {
        rawDataCache = { key: cacheKey, articles: allArticles.slice(), cachedAt: Date.now() };
      }
      return buildResult();
    }

    // 폴백: totalPageCount 확인 실패 시 빈 배치가 나올 때까지 순차 탐색
    logProgress(`⚠️ [수집] 전체 페이지 수를 확인 못 함 - 빈 배치가 나올 때까지 탐색하는 방식으로 진행`);
    let consecutiveEmptyBatches = 0;

    for (let batchStart = 2; batchStart <= MAX_PAGES; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, MAX_PAGES);
      const batch = await fetchArticleBatch(createPageRange(batchStart, batchEnd), timeParams);

      allArticles.push(...batch.articles);
      totalRequestCount += batch.requestCount;
      failedRequestCount += batch.requestFailedCount;
      if (batch.hadIssue) hadDataIssue = true;

      const failNote = batch.requestFailedCount > 0 ? `, 실패 ${batch.requestFailedCount}건` : '';
      logProgress(`📦 [배치 ${batchStart}~${batchEnd}] ${batch.articles.length}개 수집 (누적 ${allArticles.length}개, ${batch.elapsedSeconds}초 소요${failNote})`);

      if (batch.articles.length === 0) {
        consecutiveEmptyBatches++;
        logProgress(`⚠️ [수집] ${batchStart}~${batchEnd}페이지 빈 배치 (연속 ${consecutiveEmptyBatches}/${EMPTY_BATCHES_TO_STOP})`);
        if (consecutiveEmptyBatches >= EMPTY_BATCHES_TO_STOP) {
          logProgress(`🛑 [수집] 연속 ${EMPTY_BATCHES_TO_STOP}개 배치가 비어 마지막 페이지로 판단, 수집 종료`);
          break;
        }
      } else {
        consecutiveEmptyBatches = 0;
      }

      if (batchEnd < MAX_PAGES) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    if (!hadDataIssue) {
      rawDataCache = { key: cacheKey, articles: allArticles.slice(), cachedAt: Date.now() };
    }
    return buildResult();
  } catch (err) {
    console.error("❌ [수집] 수집 도중 오류 발생:", err);
    return buildResult(false, "게시글 수집 중 오류가 발생했습니다: " + (err?.message || String(err)));
  }
}

// ══════════════════════════════════════════════════════════════════
// § 3. 검색 실행/결과 수신, 팝업(iframe) 메시지 처리
// ══════════════════════════════════════════════════════════════════

// EXECUTE_SEARCH 요청을 받아 수집→필터링까지 전부 수행
async function handleSearchExecution(filterParams) {
  const { articles, filterParams: resolvedFilterParams, fromCache, hadDataIssue, error: collectError, cancelled } = await collectArticles(filterParams);

  console.log("📥 [collectArticles] 수집 결과 도착:", articles.length, "건");

  const notifyPopupAndReset = (count, errorMessage = null, extra = {}) => {
    postToPopup("SEARCH_RESULT_COUNT", {
      count: count,
      error: errorMessage,
      fromCache: fromCache,
      hadDataIssue: !!hadDataIssue,
      ...extra
    });
    downloadAtfLogBufferAsTxt();
  };

  // 사용자가 대량 조회 확인창에서 취소한 경우 - 이미 수집된 일부 데이터로 검색이
  // "완료"된 것처럼 안내하거나 기존 lastMatchedItems(직전 검색결과)를 덮어쓰지 않음
  if (cancelled) {
    notifyPopupAndReset(0, null, { cancelled: true });
    return;
  }

  // 1페이지조차 못 읽는 등 완전 실패한 경우 collectArticles가 이미 안내 메시지를 담아 반환함 -
  // 빈 결과를 "0건 검색완료"로 위장하지 않고 그대로 실패로 안내
  if (collectError) {
    notifyPopupAndReset(0, collectError);
    return;
  }

  try {
    // 검색결과는 화면에 그리지 않고 다운로드만 지원 - 필터링해서 개수만 안내하고
    // 다운로드가 쓸 수 있도록 lastMatchedItems에 저장해둔다.
    const matchedItems = articles.filter(item => checkArticleMatch(item, resolvedFilterParams));
    lastMatchedItems = matchedItems;

    console.log(`✅ [필터링 완료] 최종 검색 일치 항목: ${matchedItems.length}개`);

    notifyPopupAndReset(matchedItems.length);
  } catch (err) {
    console.error("❌ [content.js] 검색 결과 처리 중 예외 발생:", err);
    notifyPopupAndReset(0, "검색 처리 중 오류가 발생했습니다: " + (err?.message || String(err)));
  }
}


// 팝업(iframe)에서 오는 메시지 처리 - 검색/다운로드 요청, 초기화, 드래그, 창 닫기 등
// 팝업(iframe)에서 온 메시지가 맞는지 검증 - origin뿐 아니라 실제 이 확장이 만든
// iframe.contentWindow에서 온 메시지인지(event.source)까지 확인해 위조 가능성을 더 좁힘
function isTrustedPopupMessage(event) {
  const iframe = getPopupIframe();
  return Boolean(
    event.data &&
    window === window.top &&
    event.origin === ATF_EXTENSION_ORIGIN &&
    event.source === iframe?.contentWindow
  );
}

window.addEventListener("message", (event) => {
  if (!isTrustedPopupMessage(event)) return;

  switch (event.data.type) {
    case "RESIZE_IFRAME": {
      const iframe = getPopupIframe();
      if (iframe) iframe.style.height = `${event.data.height}px`;
      break;
    }

    case "REQUEST_LOG_SAVE":
      downloadAtfLogBufferAsTxt({ force: true });
      break;

    case "EXECUTE_SEARCH":
      if (isSearchingProcess) {
        // 이미 진행 중인 검색이 있음 - 조용히 무시하지 않고 별도 메시지로 안내
        // (SEARCH_RESULT_COUNT와 타입을 분리해야 팝업이 두 검색을 헷갈리지 않음)
        postToPopup("SEARCH_ALREADY_RUNNING");
        break;
      }

      isSearchingProcess = true;

      clearAtfLogBuffer(); // 새 검색 시작 시 이전 로그 버퍼 비움

      handleSearchExecution(event.data.params)
        .catch((err) => {
          // handleSearchExecution 내부에서 처리되지 않은 예외 - 조용히 멈추지 않고 안내
          console.error("❌ 검색 처리 중 처리되지 않은 예외:", err);
          postToPopup("SEARCH_RESULT_COUNT", {
            count: 0,
            error: "검색 처리 중 오류가 발생했습니다: " + (err?.message || String(err))
          });
        })
        .finally(() => {
          // 어떤 경로로 끝나든(성공/실패/예외) 검색 잠금을 반드시 해제 -
          // 안 풀리면 이후 검색 버튼이 조용히 무시되는 상태가 됨
          isSearchingProcess = false;
        });
      break;

    case "RESET_FILTER":
      lastMatchedItems = [];
      break;

    case "DRAG_START":
      startModalDrag(event.data.x, event.data.y);
      break;

    case "CLOSE_MODAL": {
      const iframe = getPopupIframe();
      if (iframe) iframe.style.display = "none";
      break;
    }

    case "REQUEST_DOWNLOAD":
      if (isDownloadingProcess) {
        // 검색(SEARCH_ALREADY_RUNNING)과 동일하게 조용히 무시하지 않고 안내
        postToPopup("DOWNLOAD_ALREADY_RUNNING");
        break;
      }
      isDownloadingProcess = true;
      downloadMatchedResultsXlsx();
      break;
  }
});
// xlsx 생성은 xlsx-writer.js에 분리돼 있음 - 완성된 Blob이 필요할 때 window.ATF_buildXlsxBlob()만 호출한다.

// ══════════════════════════════════════════════════════════════════
// § 4. 브런치 실제 주소(작가정보) 조회 + xlsx 다운로드
// 운영툴 자체의 "작가정보" 화면(/article/list?search=userId&keyword=...)에 실제 주소가
// 텍스트로 그대로 있어, 같은 origin에서 fetchPage처럼 직접 fetch+정규식 파싱해서 얻는다.
// ══════════════════════════════════════════════════════════════════

const HANDLE_CACHE_KEY = "atf_handle_cache_v2";
const HANDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일 (필명 변경 대비)
const HANDLE_MAX_CONCURRENT = 3; // 검색(BATCH_SIZE=6)과 부하가 겹치지 않도록 하향
const HANDLE_FETCH_TIMEOUT_MS = 20000; // 장시간 대기 방지를 위해 20초로 제한
// "브런치 주소" 셀 다음 <td><a>실제핸들</a> 패턴 (개발자도구로 실제 구조 확인함)
const HANDLE_PATTERN = /브런치\s*주소<\/td>\s*<td>\s*<a[^>]*>([^<]+)<\/a>/;

async function loadHandleCache() {
  try {
    const r = await chrome.storage.local.get(HANDLE_CACHE_KEY);
    return (r && r[HANDLE_CACHE_KEY]) || {};
  } catch (e) {
    console.warn("⚠️ 핸들 캐시 로드 실패, 빈 캐시로 진행:", e);
    return {};
  }
}

async function saveHandleCache(cache) {
  try {
    await chrome.storage.local.set({ [HANDLE_CACHE_KEY]: cache });
  } catch (e) {
    console.warn("⚠️ 핸들 캐시 저장 실패(조회 결과 자체는 정상 반영됨):", e);
  }
}

// userId로 운영툴 자체의 작가정보 화면을 조회해 실제 브런치 주소(핸들)를 파싱.
// fetchPage와 동일하게 타임아웃 + 패턴 도착 즉시 조기종료 적용 - 이 페이지가 무거운
// 편이라 나머지 바디를 계속 받지 않도록 함
async function resolveOneHandle(userId) {
  const url = `https://brunch-admin.onkakao.net/article/list?search=userId&keyword=${encodeURIComponent(userId)}`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), HANDLE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { credentials: "same-origin", signal: abortController.signal });
    if (!res.ok) return null;

    if (!res.body || !res.body.getReader) {
      const html = await res.text();
      const match = html.match(HANDLE_PATTERN);
      return match ? match[1].trim() : null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const match = buffer.match(HANDLE_PATTERN);
      if (match) {
        reader.cancel().catch(() => {});
        return match[1].trim();
      }

      if (buffer.length > MAX_BUFFER_CHARS) {
        reader.cancel().catch(() => {});
        return null;
      }
    }
    return null;
  } catch (e) {
    // 타임아웃/네트워크 오류 - 폴백 주소(@@userId)로 처리되므로 다운로드 자체는 계속 진행됨
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 여러 userId를 동시 HANDLE_MAX_CONCURRENT개로 제한해 조회하는 워커풀. 캐시 적중(TTL 이내)분은 요청 없이 즉시 반환.
// onProgress(done, total)은 대량 다운로드 시 진행률 표시용 콜백.
async function resolveBrunchHandlesWithProgress(items, onProgress) {
  const cache = await loadHandleCache();
  const handles = {};
  const todo = [];
  let doneCount = 0;

  for (const { userId } of items) {
    if (!userId) continue;
    if (handles[userId] !== undefined) continue;

    const cached = cache[userId];
    if (cached && cached.handle && (Date.now() - cached.at) < HANDLE_TTL_MS) {
      handles[userId] = cached.handle;
      doneCount++;
      continue;
    }
    handles[userId] = null; // 슬롯 선점 - 중복 조회 방지
    todo.push(userId);
  }

  const totalUnique = doneCount + todo.length;
  if (onProgress) onProgress(doneCount, totalUnique);

  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const userId = todo[cursor++];
      const handle = await resolveOneHandle(userId);
      handles[userId] = handle;
      if (handle) cache[userId] = { handle, at: Date.now() };
      doneCount++;
      if (onProgress) onProgress(doneCount, totalUnique);
    }
  }

  const workerCount = Math.min(HANDLE_MAX_CONCURRENT, todo.length);
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await saveHandleCache(cache);
  }

  const resolvedCount = Object.values(handles).filter(Boolean).length;
  return { handles, resolvedCount, failedCount: totalUnique - resolvedCount, totalUnique };
}

// 검색결과 다운로드 오케스트레이션 - 작가 주소 조회, 진행상황 안내, xlsx 조립은
// xlsx-writer.js에 위임, 완성된 파일 다운로드 트리거까지 담당
async function downloadMatchedResultsXlsx() {
  const notifyPopup = (payload) => postToPopup("DOWNLOAD_RESULT", payload);
  const notifyProgress = (message) => postToPopup("DOWNLOAD_PROGRESS", { message });

  try {
  if (!lastMatchedItems || lastMatchedItems.length === 0) {
    notifyPopup({ error: "다운로드할 검색 결과가 없습니다. 먼저 검색을 실행해 주세요." });
    return;
  }

  const baseRows = lastMatchedItems.map(item => {
    const title = item.title || (item.article && item.article.title) || '';
    const userId = item.userId || (item.article && item.article.userId) || '';
    const articleNo = item.articleNo || (item.article && item.article.no) || '';
    const author = item.userName || item.authorName || '';
    return { title, userId, articleNo, author };
  });

  // 같은 작가(userId)는 한 번만 조회
  const uniqueUserIds = [...new Set(baseRows.map(r => r.userId).filter(Boolean))];
  const uniqueItems = uniqueUserIds.map(userId => ({ userId }));

  let handles = {};
  let handleResolvedCount = 0;
  let handleFailedCount = 0;
  let handleTotalUnique = 0;
  if (uniqueItems.length > 0) {
    notifyProgress(`📤 작가 ${uniqueItems.length}명의 실제 주소를 확인하는 중입니다... (결과가 많으면 몇 분 걸릴 수 있어요)`);
    let lastReported = -1;
    const resolveResult = await resolveBrunchHandlesWithProgress(uniqueItems, (done, total) => {
      // 10명 단위로만 갱신 (매 건마다 보내면 대량일 때 팝업이 버벅일 수 있음)
      if (done !== total && done - lastReported < 10) return;
      lastReported = done;
      notifyProgress(`📤 작가 주소 조회 중... (${done}/${total}명)`);
    });
    handles = resolveResult.handles;
    handleResolvedCount = resolveResult.resolvedCount;
    handleFailedCount = resolveResult.failedCount;
    handleTotalUnique = resolveResult.totalUnique;
  }

  const rows = baseRows.map(r => {
    const resolvedHandle = r.userId ? handles[r.userId] : null;
    let url = '';
    if (resolvedHandle && r.articleNo) {
      url = `https://brunch.co.kr/@${resolvedHandle}/${r.articleNo}`;
    } else if (r.userId && r.articleNo) {
      url = `https://brunch.co.kr/@@${r.userId}/${r.articleNo}`; // 조회 실패 시 폴백 주소 (정상 동작함)
    }
    return { title: r.title, url, author: r.author };
  });

  const columns = [
    { header: '순번', align: 'center', widthCap: 8, numeric: true },
    { header: '제목', align: 'left', widthCap: 60 },
    { header: 'URL', align: 'left', widthCap: 70, hyperlink: true },
    { header: '작가명', align: 'center', widthCap: 30 }
  ];
  const dataRows = rows.map((r, idx) => [idx + 1, r.title, r.url, r.author]);

  if (typeof window.ATF_buildXlsxBlob !== 'function') {
    notifyPopup({ error: "다운로드 모듈을 불러오지 못했습니다. 확장프로그램을 새로고침해 주세요." });
    return;
  }

  const blob = window.ATF_buildXlsxBlob('검색결과', columns, dataRows);
  const blobUrl = URL.createObjectURL(blob);

  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const fileName = `검색결과_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}.xlsx`;

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  notifyPopup({
    count: rows.length,
    handleResolved: handleResolvedCount,
    handleFailed: handleFailedCount,
    handleTotal: handleTotalUnique
  });
  } catch (err) {
    console.error("❌ [content.js] 다운로드 처리 중 예외 발생:", err);
    notifyPopup({ error: "다운로드 처리 중 오류가 발생했습니다: " + (err?.message || String(err)) });
  } finally {
    isDownloadingProcess = false;
  }
}

// ══════════════════════════════════════════════════════════════════
// § 5. 검색 팝업 드래그 이동
// ══════════════════════════════════════════════════════════════════
// iframe 위에서는 top window가 mousemove를 못 받으므로, 드래그 중엔 iframe의
// pointer-events를 꺼서 이벤트가 top window로 전달되게 함
let isDraggingModal = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startModalDrag(offsetX, offsetY) {
  const iframe = getPopupIframe();
  if (!iframe) return;

  const rect = iframe.getBoundingClientRect();
  iframe.style.right = "auto";
  iframe.style.left = `${rect.left}px`;
  iframe.style.top = `${rect.top}px`;

  dragOffsetX = offsetX;
  dragOffsetY = offsetY;
  isDraggingModal = true;
  iframe.style.pointerEvents = "none";

  document.addEventListener("mousemove", onModalDragMove);
  document.addEventListener("mouseup", onModalDragEnd);
}

function onModalDragMove(e) {
  if (!isDraggingModal) return;
  const iframe = getPopupIframe();
  if (!iframe) return;

  const margin = 24;
  let newLeft = e.clientX - dragOffsetX;
  let newTop = e.clientY - dragOffsetY;

  newLeft = Math.max(-(iframe.offsetWidth - margin), Math.min(newLeft, window.innerWidth - margin));
  newTop = Math.max(0, Math.min(newTop, window.innerHeight - margin));

  iframe.style.left = `${newLeft}px`;
  iframe.style.top = `${newTop}px`;
}

function onModalDragEnd() {
  if (!isDraggingModal) return;
  isDraggingModal = false;

  const iframe = getPopupIframe();
  if (iframe) iframe.style.pointerEvents = "";

  document.removeEventListener("mousemove", onModalDragMove);
  document.removeEventListener("mouseup", onModalDragEnd);
}


// ══════════════════════════════════════════════════════════════════
// § 7. 초기화 시작 (SPA 페이지 이동 감지 포함)
// ══════════════════════════════════════════════════════════════════
// 이 파일의 다른 모든 함수(checkAndInitExtension, injectExtensionButton 등)가 위에서
// 이미 정의된 뒤에 실행되어야 하므로, 파일의 맨 마지막에 위치한다.

let mutationDebounceTimer = null;

// MutationObserver: DOM 변경 감지 시 URL이 바뀌었으면 재초기화, 버튼이 사라졌으면 재삽입
// DOM 변경이 잦아 콜백이 과도하게 호출되지 않도록 100ms 디바운스
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