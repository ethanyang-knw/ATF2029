// content-main.js
// content-globals.js(전역 상수/상태) 다음, content-bootstrap.js(초기화 킥오프) 이전에 로드된다.
// 검색 팝업/모달 생성, 검색 결과 필터링·렌더링, 검색 실행·다운로드 메시지 처리, 팝업 드래그,
// 블랙/레드글·PC홈추천·작가리스트 액션 트리거를 전부 포함한 단일 파일.
// (원래 7개 파일로 나눴다가 파일 수가 너무 많다는 피드백으로 이렇게 합쳤음 - 로드 순서 제약이
//  있는 globals/bootstrap 두 개만 분리 유지)

// ══════════════════════════════════════════════════════════════════
// § 1. 초기화 (모달/버튼 생성, injected-*.js 주입, SPA 재초기화 진입점)
// ══════════════════════════════════════════════════════════════════
// 0. 메인 스크립트(injected-search.js, injected-actions.js) 동적 주입
function injectMainWorldScript(onReady) {
  if (window !== window.top) return;

  const existing = document.getElementById("atf-injected-script-actions");
  if (existing) {
    // 이미 주입된 상태 - injected-*.js는 이미 로드되어 있다고 볼 수 있음
    if (onReady) onReady();
    return;
  }

  try {
    // 🔧 console-log.js는 콘솔 로그를 격리 world로 중계하는 역할이라, injected-search.js/
    //    injected-actions.js의 로그를 하나도 놓치지 않으려면 반드시 이 둘보다 먼저 실행돼야 한다.
    //    동적으로 생성한 <script>는 기본적으로 async=true라 그냥 연달아 appendChild하면 실행
    //    순서가 보장되지 않으므로, 셋 다 async=false로 지정해 추가한 순서대로 실행되도록 고정한다.
    const scriptLog = document.createElement("script");
    scriptLog.id = "atf-injected-script-log";
    scriptLog.src = chrome.runtime.getURL("console-log.js");
    scriptLog.async = false;

    const scriptSearch = document.createElement("script");
    scriptSearch.id = "atf-injected-script-search";
    scriptSearch.src = chrome.runtime.getURL("injected-search.js");
    scriptSearch.async = false;

    const scriptActions = document.createElement("script");
    scriptActions.id = "atf-injected-script-actions";
    scriptActions.src = chrome.runtime.getURL("injected-actions.js");
    scriptActions.async = false;
    if (onReady) scriptActions.addEventListener("load", onReady);

    const parent = document.head || document.documentElement;
    parent.appendChild(scriptLog);
    parent.appendChild(scriptSearch);
    parent.appendChild(scriptActions);
  } catch (e) {
    console.error("❌ injected.js 주입 실패:", e);
  }
}

// 0-1. 커스텀 결과 테이블 내 링크의 포커스/호버 스타일 정리
//      (기본 브라우저 outline이 줄바꿈된 텍스트에서 줄마다 따로 그려져 지저분해 보이는 문제 해결)
function injectCustomTableStyles() {
  if (document.getElementById("atf-custom-table-style")) return;

  const style = document.createElement("style");
  style.id = "atf-custom-table-style";
  style.textContent = `
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a {
      outline: none; /* 🔧 색상은 건드리지 않고, 줄마다 따로 그려지던 기본 아웃라인만 제거 */
    }
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a:hover {
      text-decoration: underline; /* 🔧 색 변경 대신 밑줄만 표시 */
    }
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a:focus,
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a:focus-visible {
      outline: none;
      text-decoration: underline;
    }
    /* 🔧 원본 테이블을 통째로 clone하면서 컬럼 너비가 복제 시점 기준(주로 숫자처럼 좁은 내용)으로
          고정돼버려서, "PC 홈 추천"/"피처링 추천" 버튼처럼 긴 내용이 들어간 셀이 옆으로 튀어나오는
          문제가 있었다. table-layout:auto로 강제해서 브라우저가 실제 내용(버튼 포함) 기준으로
          컬럼 너비를 다시 계산하도록 한다. */
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] {
      table-layout: auto !important;
    }
  `;
  document.head.appendChild(style);
}

// 1. [다운로드] 버튼 옆에 [🔍 조건검색] 버튼 동적 생성
function injectExtensionButton() {
  if (window !== window.top) return;
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

// 2. 모달 iframe 생성
function createExtensionModal() {
  if (window !== window.top) return;
  if (document.getElementById("my-extension-modal-iframe")) return;

  const iframe = document.createElement("iframe");
  iframe.id = "my-extension-modal-iframe";

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

// 3. 모달 토글
function toggleExtensionModal() {
  let iframe = document.getElementById("my-extension-modal-iframe");
  if (!iframe) {
    createExtensionModal();
    iframe = document.getElementById("my-extension-modal-iframe");
  }

  if (iframe) {
    iframe.style.display = (iframe.style.display === "none" || !iframe.style.display) ? "block" : "none";
  }
}

// 📋 이력 창 - 검색 팝업(iframe)과 완전히 별개의 독립된 iframe으로 띄운다.
//    검색 팝업과 같은 iframe 안에 모달로 넣으면, 이력이 길어질 때 iframe 전체(=검색창)가
//    같이 커져버리는 문제가 있었음(iframe은 하나의 사각형 박스라 안의 내용이 iframe 경계를
//    벗어나 보이는 건 애초에 불가능 - position:fixed를 써도 iframe 밖으로는 못 나감).
//    별도 iframe으로 분리하면 검색 팝업 크기는 그대로 두고 이력 창만 독립적으로 커질 수 있다.
function createLogModal() {
  if (window !== window.top) return;
  if (document.getElementById("atf-log-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.id = "atf-log-backdrop";
  Object.assign(backdrop.style, {
    position: "fixed",
    top: "0", left: "0", right: "0", bottom: "0",
    background: "rgba(0,0,0,0.4)",
    zIndex: "9999998", // 검색 팝업(9999999)보다는 낮지만 페이지 나머지보다는 위
    display: "none"
  });
  backdrop.addEventListener("click", () => toggleLogModal(false));
  document.body.appendChild(backdrop);

  const iframe = document.createElement("iframe");
  iframe.id = "atf-log-iframe";

  try {
    iframe.src = chrome.runtime.getURL("action-log.html");
  } catch (err) {
    console.error("❌ action-log.html 로드 실패", err);
    return;
  }

  Object.assign(iframe.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)", // 🔧 항상 화면 중앙에서 시작 (열 때마다 toggleLogModal이 다시 세팅함)
    width: "560px",
    height: "60vh", // 🔧 "위아래 폭을 살짝 줄여달라"는 요청으로 70vh → 60vh로 축소
    border: "none",
    borderRadius: "12px",
    zIndex: "9999999",
    background: "transparent",
    display: "none"
  });

  document.body.appendChild(iframe);
}

function toggleLogModal(show) {
  const backdrop = document.getElementById("atf-log-backdrop");
  const iframe = document.getElementById("atf-log-iframe");
  if (!backdrop || !iframe) return;

  if (show) {
    // 🔧 "이력" 버튼을 누를 때마다 이전에 드래그해서 옮겨놨던 위치는 무시하고,
    //    항상 화면 정중앙에서 다시 시작하도록 위치를 초기화한다(드래그 기능 자체는 유지 -
    //    연 다음에 옮기는 건 자유롭게 가능하고, 다음에 다시 열 때만 중앙으로 리셋됨).
    Object.assign(iframe.style, {
      top: "50%",
      left: "50%",
      right: "auto",
      transform: "translate(-50%, -50%)"
    });
    backdrop.style.display = "block";
    iframe.style.display = "block";
    // 🔧 이미 열려있던 iframe을 다시 보여주는 경우, 그사이 새로 생긴 이력이 있을 수 있으니
    //    매번 새로고침 요청을 보내 최신 상태로 갱신
    iframe.contentWindow?.postMessage({ type: "REFRESH_LOG" }, "*");
  } else {
    backdrop.style.display = "none";
    iframe.style.display = "none";
  }
}

function checkAndInitExtension() {
  if (!window.location.href.includes("/article/daily")) return;
  if (window !== window.top) return;

  injectMainWorldScript();
  injectCustomTableStyles();
  createExtensionModal();
  createLogModal();
  injectExtensionButton();
}

// ⏱️ publishTime 정밀 파싱 헬퍼
// 🔧 발행 시각의 원본 타임스탬프(ms)를 반환 - 표시용 텍스트 변환과 필터링 양쪽에서 공유

// ══════════════════════════════════════════════════════════════════
// § 2. 검색 결과 필터링 및 렌더링
// ══════════════════════════════════════════════════════════════════
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

function parsePublishTime(item) {
  const timeMs = getPublishTimeMs(item);
  if (timeMs === null) return '';

  const diffSec = Math.floor((Date.now() - timeMs) / 1000);
  if (diffSec < 60) return '방금전';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일전`;

  // 🔧 7일 이상 지난 글은 원본 사이트처럼 절대 날짜로 표시 (예: Jul 22, 2026)
  return new Date(timeMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// 🖼️ image 정밀 파싱 헬퍼
function extractImageUrl(item) {
  if (!item) return '';

  const imgVal = item.image || (item.article && item.article.image);
  if (!imgVal) return '';

  if (typeof imgVal === 'string') {
    let url = imgVal;
    if (url.startsWith('//')) url = 'https:' + url;
    return url.replace(/^http:\/\//i, "https://");
  } else if (typeof imgVal === 'object') {
    let url = imgVal.url || imgVal.src || imgVal.path || '';
    if (url.startsWith('//')) url = 'https:' + url;
    return url.replace(/^http:\/\//i, "https://");
  }

  return '';
}

// 🎯 4. 정밀 조건 검사 함수 (체크박스 제어 및 제외 로직 반영)
function checkArticleMatch(item, filterParams) {
  if (!filterParams) return true;

  const {
    includeTags,
    includeEnabled,   // 포함 조건 체크박스 (true: 필터 적용, false: 조건 제외/무시)
    excludeUserTypes,
    excludeEnabled,   // 제외 조건 체크박스 (true: 필터 적용, false: 조건 제외/무시)
    dateType,
    dateStart,
    dateEnd,
    dateMonth,        // "YYYY-MM" 형식 (월 단위 지정)
    dateEnabled,      // 발행 시각 체크박스 (true: 필터 적용, false: 조건 제외/무시)
    nowAnchorMs       // "24시간 이내" 검색 시 서버 요청에 썼던 기준 시각(있으면 재사용)
  } = filterParams;

  const title = (item.title || (item.article && item.article.title) || '').toLowerCase();
  const subTitle = (item.subTitle || (item.article && item.article.subTitle) || '').toLowerCase();
  const author = (item.userName || item.authorName || '').toLowerCase();
  const magazine = (item.magazineTitle || item.magazineName || '').toLowerCase();

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

  // 1. [포함 조건] 체크박스가 '체크(includeEnabled)' 상태일 때만 필터 적용
  //    태그마다 카테고리(G.키워드/제목/키워드/매거진/작가/제목+키워드)가 지정되어 있어서
  //    카테고리에 해당하는 필드에서만 검색어를 찾는다.
  //    - G.키워드/키워드: 키워드 필드 (구글시트 연동이든 직접 입력이든 같은 필드를 검색)
  //    - 제목: 제목/부제
  //    - 매거진: 매거진명
  //    - 작가: 작가명
  //    - 제목+키워드: 제목/부제 + 키워드
  if (includeEnabled && Array.isArray(includeTags) && includeTags.length > 0) {
    const hasIncludeKeyword = includeTags.some(tagItem => {
      const isObj = tagItem && typeof tagItem === 'object';
      const tagText = (isObj ? tagItem.text : tagItem || '').toLowerCase().trim();
      if (!tagText) return false;
      const category = (isObj ? tagItem.category : 'keyword') || 'keyword';

      switch (category) {
        case 'title':
          return titleAndSubTitle.includes(tagText);
        case 'magazine':
          return magazine.includes(tagText);
        case 'author':
          return author.includes(tagText);
        case 'title_keyword':
          return titleAndSubTitle.includes(tagText) || keywordsStr.includes(tagText);
        case 'keyword':
        case 'keyword_text':
        default:
          return keywordsStr.includes(tagText);
      }
    });

    if (!hasIncludeKeyword) isMatch = false;
  }

  // 2. [제외 조건] 체크박스가 '체크(excludeEnabled)' 상태일 때만 유저타입 필터 적용
  if (isMatch && excludeEnabled && Array.isArray(excludeUserTypes) && excludeUserTypes.length > 0) {
    // 실제 유저 타입은 managedUserType 필드로 판별. 값이 없으면(뱃지 공백) 어떤 유저 타입에도
    // 속하지 않는 것으로 처리 - 예전엔 'gray'로 기본값 처리해서 뱃지가 없는 게시물까지
    // '그레이유저' 제외 조건에 걸려 잘못 필터링되던 버그가 있었음.
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

  // 3. [발행 시각] 체크박스가 '체크(dateEnabled)' 상태일 때만 날짜 필터 적용
  //    🔧 예전엔 "N분전/N일전" 같은 화면 표시용 상대 시간 텍스트를 파싱해서 비교했는데,
  //       '직접 지정'(날짜 범위) 모드는 그 텍스트에서 애초에 나올 수 없는 절대 날짜 패턴을
  //       찾으려 해서 항상 매칭에 실패해 사실상 필터가 전혀 동작하지 않았음.
  //       원본 타임스탬프(getPublishTimeMs)를 직접 비교하도록 수정.
  if (isMatch && dateEnabled && dateType && dateType !== "") {
    const publishTimeMs = getPublishTimeMs(item);

    if (publishTimeMs !== null) {
      if (dateType === "24h") {
        // 🔧 검색이 완료되기까지 걸리는 시간만큼 "지금"이 계속 앞으로 밀리기 때문에,
        //    매번 새로 Date.now()를 부르면 서버 요청 시점엔 24시간 안이었던 경계선 글이
        //    필터링 시점엔 살짝 넘겨서 잘못 제외될 수 있다 - 서버 요청에 썼던 바로 그
        //    "지금" 시각(nowAnchorMs)이 있으면 그걸 그대로 재사용해 기준을 통일한다.
        const nowMs = nowAnchorMs || Date.now();
        const withinLast24h = (nowMs - publishTimeMs) <= 24 * 60 * 60 * 1000;
        if (!withinLast24h) isMatch = false;
      } else if (dateType === "direct" && dateStart && dateEnd) {
        const startMs = new Date(`${dateStart}T00:00:00`).getTime();
        const endMs = new Date(`${dateEnd}T23:59:59.999`).getTime();
        if (!isNaN(startMs) && !isNaN(endMs)) {
          if (publishTimeMs < startMs || publishTimeMs > endMs) isMatch = false;
        }
      } else if (dateType === "month" && dateMonth) {
        // 🔧 "YYYY-MM" → 해당 월의 1일 00:00 ~ 다음 달 1일 00:00 직전까지
        const [y, m] = dateMonth.split('-').map(Number);
        if (y && m) {
          const startMs = new Date(y, m - 1, 1).getTime();
          const endMs = new Date(y, m, 1).getTime() - 1;
          if (publishTimeMs < startMs || publishTimeMs > endMs) isMatch = false;
        }
      }
    }
  }

  return isMatch;
}

// 🎯 5. 게시글 전용 Table 탐색 (커스텀 컨테이너 제외)
function getArticleTable() {
  const tables = Array.from(document.querySelectorAll("table"));
  for (const table of tables) {
    if (table.closest(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"]`)) continue;

    const text = table.textContent || "";
    if (text.includes("오늘의 발행글") || text.includes("어제의 발행글") || text.includes("상승 비율")) {
      continue;
    }
    const hasArticleRow = table.querySelector("tbody tr td");
    if (hasArticleRow) {
      return table;
    }
  }
  return null;
}

// 원본 페이지네이션 숨김/노출 헬퍼
function toggleOriginalPagination(show) {
  const paginators = document.querySelectorAll("nav, .pagination, ul.pagination");
  paginators.forEach(el => {
    if (el.closest(`#${CUSTOM_PAGINATION_ID}`)) return;

    // 상단 메뉴 카테고리(브레드크럼) 등 실제 페이지네이션이 아닌 nav는 건드리지 않음
    // (nav 태그는 페이지네이션 래퍼로도 쓰이지만, 브레드크럼 nav도 있어 기존엔 이것까지 통째로 숨겨졌음)
    if (el.tagName === 'NAV') {
      const isBreadcrumb = (el.getAttribute('aria-label') || '').toLowerCase().includes('breadcrumb') || el.querySelector('.breadcrumb, ol.breadcrumb');
      const hasPagination = el.querySelector('.pagination, ul.pagination');
      if (isBreadcrumb || !hasPagination) return;
    }

    el.style.setProperty("display", show ? "" : "none", "important");
  });
}

// 기존 커스텀 결과 UI 제거
function clearCustomResultUI() {
  const customContainer = document.querySelector(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"]`);
  if (customContainer) customContainer.remove();

  const customPag = document.getElementById(CUSTOM_PAGINATION_ID);
  if (customPag) customPag.remove();
}

// 🛠️ JSON 객체 ➔ <tr> 복제 및 수치 매핑 (정렬용 dataset 바인딩 포함)
function createRowFromItem(item, templateTr) {
  if (!templateTr) return null;
  const clonedTr = templateTr.cloneNode(true);

  // 정렬용 수치 dataset을 tr 노드에 바인딩
  clonedTr.dataset.clickCount = item.clickCount || 0;
  clonedTr.dataset.commentCount = item.commentCount || 0;
  clonedTr.dataset.editorpickCount = item.editorpickCount || 0;
  clonedTr.dataset.whiteList = (item.managedUserType === 'white') ? 1 : 0;
  clonedTr.dataset.likeCount = item.likeCount || 0;
  clonedTr.dataset.featureTopCount = item.featureTopCount || 0;

  const title = item.title || (item.article && item.article.title) || '';
  const subTitle = item.subTitle || (item.article && item.article.subTitle) || '';
  const timeText = parsePublishTime(item);
  const imgUrl = extractImageUrl(item);

  let keywordsArr = [];
  const rawKeywords = item.keywords || (item.article && item.article.keywords);
  if (Array.isArray(rawKeywords)) {
    keywordsArr = rawKeywords.map(k => typeof k === 'object' ? (k.name || k.keyword || '') : k).filter(Boolean);
  } else if (typeof rawKeywords === 'string') {
    keywordsArr = [rawKeywords];
  }
  const keywordsStr = keywordsArr.join(', ');

  const magazine = item.magazineTitle || item.magazineName || '';
  const author = item.userName || item.authorName || '';

  // 🔗 링크 재구성에 필요한 식별자 (기존엔 이 값들이 반영되지 않아 모든 행이 템플릿 원본 링크를 그대로 유지하던 문제 수정)
  const userId = item.userId || (item.article && item.article.userId) || '';
  const articleNo = item.articleNo || (item.article && item.article.no) || '';
  const profileId = item.profileId || (item.article && item.article.profileId) || ''; // 🔧 블랙리스트 등록 등에 필요 (userId와는 다른 값)
  const magazineAddress = item.magazineAddress || (item.article && item.article.magazineAddress) || '';
  const magazineLink = item.magazineLink || `https://brunch.co.kr/magazine/${magazineAddress || 'undefined'}`;

  // ☑️ 체크박스의 user/articleno 속성을 현재 게시글에 맞게 갱신.
  //    (원본 사이트의 블랙/레드글 일괄 등록 로직이 이 속성을 그대로 읽어서 서버로 보내기 때문에,
  //     갱신 안 하면 템플릿 원본 게시글 정보로 등록되는 심각한 사고로 이어질 수 있었음)
  // 🔧 원본 템플릿 행의 체크박스에는 name="data"가 정적으로 붙어있지 않고(사이트 자체 JS가
  //    페이지 로드 시 나중에 동적으로 부여하는 값으로 추정), 우리가 clone한 시점엔 그 스크립트가
  //    다시 돌지 않아 name 속성이 비어있는 상태로 복제됨 → [name="data"] 필터로는 못 찾으므로
  //    필터 없이 첫 체크박스를 찾은 뒤 name/user/articleno를 우리가 직접 부여한다.
  const checkbox = clonedTr.querySelector('input[type="checkbox"]');
  if (checkbox && userId && articleNo) {
    checkbox.setAttribute('name', 'data');
    checkbox.setAttribute('user', userId);
    checkbox.setAttribute('articleno', articleNo);
    checkbox.checked = false; // 복제 시 이전 체크 상태가 남아있지 않도록 항상 초기화
  }

  // 1. 이미지
  //    🔧 img의 src를 여기서 바로 채우면, 화면에 붙기도 전인(검색 결과 전체) 모든 행이
  //       한꺼번에 이미지를 다운로드하려 들어서 - 결과가 많을 때 브라우저에 과부하가 걸리고
  //       뒤쪽 페이지 이미지들이 누락/실패하는 원인이 됨.
  //       실제로 화면(현재 페이지)에 표시될 때만 로드하도록 data-src에 잠시 보관해둔다.
  //       (goToPage에서 실제 페이지에 삽입될 때 src로 옮겨짐)
  const imgTd = clonedTr.querySelector('td:nth-child(2)');
  if (imgTd) {
    imgTd.innerHTML = '';
    if (imgUrl) {
      // 🔧 innerHTML 템플릿 문자열 대신 createElement + 속성 설정을 사용 - imgUrl 값에
      //    따옴표 등이 섞여있어도(이론상 가능성) 속성 컨텍스트를 벗어날 수 없어 더 안전함
      const img = document.createElement('img');
      img.dataset.src = imgUrl;
      img.loading = 'lazy';
      Object.assign(img.style, {
        width: '45px', height: '45px', objectFit: 'cover',
        borderRadius: '4px', display: 'block', margin: '0 auto'
      });
      // 🔧 width/height는 사이트 CSS가 !important로 덮어쓸 수 있어 원래도 style 속성에
      //    !important를 직접 넣어야 했던 부분 - style 객체 할당으로는 !important를 못 넣으므로
      //    setProperty로 별도 지정
      img.style.setProperty('width', '45px', 'important');
      img.style.setProperty('height', '45px', 'important');
      imgTd.appendChild(img);
    }
  }

  // 2. 제목 & 부제목 & 발행시간
  const titleEl = clonedTr.querySelector('td.text-left > div > a, td.text-left a');
  if (titleEl) {
    titleEl.textContent = title;
    if (userId && articleNo) {
      titleEl.href = `https://brunch.co.kr/@@${userId}/${articleNo}`;
    }
  }

  // 제목 옆의 span - id는 게시글에 맞게 갱신하고, 원본 addFeatureDataCallback 성공 핸들러와
  // 동일한 규칙(class/text)으로 채워서 "이미 탑 추천인지" 클라이언트 체크가 실제로 동작하게 함:
  //   featureData.type === 'top'     → class label-danger,  text '탑 추천'
  //   featureData.type === 'channel' → class label-warning, text 'PC 홈 추천'
  //   featureData 없음(추천 안 된 상태) → 빈 라벨 유지
  const titleLabelSpan = clonedTr.querySelector('td.text-left > div > span.label');
  if (titleLabelSpan && userId && articleNo) {
    titleLabelSpan.id = `label-${userId}-${articleNo}`;
    titleLabelSpan.classList.remove('label-danger', 'label-warning');
    titleLabelSpan.textContent = '';
    const featureType = item.featureData && item.featureData.type;
    if (featureType === 'top') {
      titleLabelSpan.classList.add('label-danger');
      titleLabelSpan.textContent = '탑 추천';
    } else if (featureType === 'channel') {
      titleLabelSpan.classList.add('label-warning');
      titleLabelSpan.textContent = 'PC 홈 추천';
    }
  }

  // 🏷️ 블랙글/레드글/오늘만무료 뱃지 (제목 옆). Sources 탭에서 확인한 원본 조건문
  //    (`l[22].black && Qt()`, `l[22].red && Ot()`, `l[22].isMembershipPromotion && qt()`) 그대로 반영.
  //    템플릿 게시글 기준으로 클론돼있던 뱃지가 남아있을 수 있으므로 먼저 지우고 현재 item 기준으로 다시 그림
  const titleContainer = titleEl && titleEl.closest('div');
  if (titleContainer) {
    // 🔧 [id] 없는 것만 정리 - titleLabelSpan(탑 추천 상태 표시)은 id가 있어서 여기서 제외됨.
    //    id가 없으면 우리가 이전에 그려둔 블랙/레드/오늘만무료 뱃지이므로 안전하게 지워도 됨
    titleContainer.querySelectorAll('span.label-black:not([id]), span.label-danger:not([id]), span.label-success:not([id])').forEach(el => el.remove());
    const anchorAfter = titleLabelSpan || titleEl;
    if (item.black) {
      const blackSpan = document.createElement('span');
      blackSpan.className = 'label label-black';
      blackSpan.textContent = '블랙글';
      anchorAfter.insertAdjacentElement('afterend', blackSpan);
    }
    if (item.red) {
      const redSpan = document.createElement('span');
      redSpan.className = 'label label-danger';
      redSpan.textContent = '레드글';
      anchorAfter.insertAdjacentElement('afterend', redSpan);
    }
    if (item.isMembershipPromotion) {
      const promoSpan = document.createElement('span');
      promoSpan.className = 'label label-success';
      promoSpan.textContent = '오늘만 무료';
      anchorAfter.insertAdjacentElement('afterend', promoSpan);
    }
  }

  // "글 정보" 링크 href 갱신 + 새 탭에서 열리도록 설정 (검색 결과가 있는 현재 탭은 그대로 유지)
  const infoLink = clonedTr.querySelector('td.text-left .btn-group a.btn');
  if (infoLink && userId && articleNo) {
    infoLink.href = `/article/info?userId=${userId}&articleNo=${articleNo}`;
    infoLink.target = '_blank';
    infoLink.rel = 'noopener noreferrer'; // 🔧 새 탭이 원래 탭의 window 객체에 접근 못 하게 하는 보안 관례
  }

  // 🖤🔴 "블랙글 등록"/"레드글 등록" 메뉴 - 원본은 href가 "javascript:"뿐이라 클론된 행에서는
  //    완전히 죽어있던 링크. 상단 툴바와 동일한 방식(이 행의 체크박스만 임시로 체크 → 등록 함수를
  //    인자 없이 호출해서 confirm 창을 원본 그대로 띄움)으로 즉시 등록되도록 구현.
  //    다른 행에 이미 체크된 게 있어도 이 한 건만 대상이 되도록, 트리거 직전에 다른 체크는 모두
  //    풀어둔다(취소 시 기존 다중 선택이 사라지는 점은 감수 - 어차피 성공 시 페이지가 새로고침됨).
  if (userId && articleNo) {
    const registerLinks = [...clonedTr.querySelectorAll('td.text-left .dropdown-menu a')]
      .filter(a => a.textContent.trim() === '블랙글 등록' || a.textContent.trim() === '레드글 등록');
    registerLinks.forEach(a => {
      const type = a.textContent.trim() === '블랙글 등록' ? 'black' : 'red';
      a.removeAttribute('href');
      a.style.cursor = 'pointer';
      // 🔧 여기서 addEventListener로 직접 붙이면 PC 홈 추천 버튼과 동일한 이유(goToPage의
      //    document.importNode(row, true)가 리스너를 복사 안 함)로 페이지네이션 이후 죽는다.
      //    data 속성만 부여하고 문서 전체 이벤트 위임으로 클릭을 잡는다.
      a.dataset.atfBlackredType = type;
    });
  }
  // 🏷️ 응원 내역 조회 / 멤버십 전문 조회 뱃지 (btn-group 뒤에 조건부로 붙는 형제 <a> 요소)
  // 기존엔 이 두 뱃지를 그리는 로직이 아예 없어서, 조건에 해당하는 게시글이어도 표시되지 않았음
  const titleBtnGroup = clonedTr.querySelector('td.text-left .btn-group');
  if (titleBtnGroup) {
    // 기존에 클론된 뱃지 링크(템플릿 게시글 기준)는 일단 제거하고 현재 item 기준으로 다시 생성
    let sibling = titleBtnGroup.nextElementSibling;
    while (sibling && sibling.tagName === 'A' && sibling.querySelector('span.label')) {
      const toRemove = sibling;
      sibling = sibling.nextElementSibling;
      toRemove.remove();
    }

    const isAllowedDonation = !!(item.isAllowedDonation || (item.article && item.article.isAllowedDonation));
    const isMembership = !!(item.isMembershipContent || item.membershipContent || (item.article && item.article.membershipContent));

    let anchorRef = titleBtnGroup;

    if (isAllowedDonation && userId && articleNo) {
      const donationA = document.createElement('a');
      donationA.href = `/donationCommentPayment/list?userId=${userId}&articleNo=${articleNo}`;
      donationA.innerHTML = `<span class="label label-info">응원 내역 조회</span>`;
      anchorRef.insertAdjacentElement('afterend', donationA);
      anchorRef = donationA;
    }

    if (isMembership && articleNo) {
      const membershipA = document.createElement('a');
      membershipA.href = `https://cbt-brunch.dev.onkakao.net/@hana-island/${articleNo}/html?who=brunchCloud`;
      membershipA.target = '_blank';
      membershipA.rel = 'noreferrer';
      membershipA.innerHTML = `<span class="label label-success">멤버십 전문 조회</span>`;
      anchorRef.insertAdjacentElement('afterend', membershipA);
    }
  }

  const textLeftTd = clonedTr.querySelector('td.text-left, td:nth-child(3)');
  if (textLeftTd) {
    // 🔧 원본 구조 확인 결과: 부제목과 발행시각은 별도 요소가 아니라
    //    <p class="text-muted" style="margin:4px 0px;">부제목<br><small>시간</small></p>
    //    형태로 하나의 p 안에 <br>로 줄바꿈되어 있었음.
    //    이 원본 p를 그대로 재사용해야 사이트 자체 CSS(margin, small 폰트 등)와
    //    정확히 동일한 여백/스타일이 유지된다.
    const metaP = textLeftTd.querySelector('p.text-muted');
    if (metaP) {
      const safeSubTitle = subTitle ? subTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
      const safeTimeText = timeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      metaP.innerHTML = `${safeSubTitle}<br><small>${safeTimeText}</small>`;
    } else {
      // 혹시 구조가 다른 경우를 대비한 폴백
      const subTitleEl = textLeftTd.querySelector('div:not(:has(a)), span.sub-title');
      if (subTitleEl) subTitleEl.textContent = subTitle;
    }
  }

  // 3. 셀별 데이터 및 통계 수치(카운트) 반영
  const tds = clonedTr.querySelectorAll('td');
  if (tds.length >= 4) tds[3].textContent = keywordsStr;
  if (tds.length >= 5) {
    const magLink = tds[4].querySelector('a') || tds[4];
    magLink.textContent = magazine;
    if (magLink.tagName === 'A') magLink.href = magazineLink;
  }
  if (tds.length >= 6) {
    const authorTd = tds[5];
    const authorLink = authorTd.querySelector('a') || authorTd;
    authorLink.textContent = author;
    if (authorLink.tagName === 'A' && userId) authorLink.href = `https://brunch.co.kr/@@${userId}`;

    const authorInfoLink = authorTd.querySelector('.btn-group a.btn');
    if (authorInfoLink && userId) {
      authorInfoLink.href = `/article/list?search=userId&keyword=${userId}`;
      authorInfoLink.target = '_blank';
      authorInfoLink.rel = 'noopener noreferrer';
    }

    // 🖤🩶🔴 "그레이리스트 등록"/"블랙리스트 등록"/"레드리스트 등록" 메뉴 - "글 정보" 드롭다운과
    //    동일하게 href가 "javascript:"뿐이라 죽어있던 링크. Network 탭으로 실제 요청을 캡처해
    //    확인한 결과(POST /user/addManagedUser.json?type=black&userId=...&innerComment=...),
    //    전역 노출된 adminB 함수를 쓰는 게 아니라 지역 함수라 직접 fetch로 재현함. 사유(코멘트)를
    //    입력받는 절차가 있어서(원본은 별도 입력 UI로 추정) 우선 prompt()로 사유를 입력받는다.
    if (userId) {
      const restrictLinks = [...authorTd.querySelectorAll('.dropdown-menu a')]
        .filter(a => ['그레이리스트 등록', '블랙리스트 등록', '레드리스트 등록'].includes(a.textContent.trim()));
      restrictLinks.forEach(a => {
        const text = a.textContent.trim();
        const type = text === '그레이리스트 등록' ? 'gray' : (text === '블랙리스트 등록' ? 'black' : 'red');
        a.removeAttribute('href');
        a.style.cursor = 'pointer';
        a.dataset.atfManagedUserType = type;
        a.dataset.userId = userId;
      });
    }

    // 🤍 "화이트리스트 등록 / 수정" 메뉴 - 위 그레이/블랙/레드와 달리 JSON API가 아니라
    //    서버 렌더링 HTML 폼(#whiteModal)을 그대로 불러와 띄우는 방식이라 별도 data 속성으로 구분.
    //    실제 모달 로드/표시/저장 로직은 injected.js의 TRIGGER_WHITE_MODAL 핸들러가 담당.
    if (userId) {
      const whiteLink = [...authorTd.querySelectorAll('.dropdown-menu a')]
        .find(a => a.textContent.trim() === '화이트리스트 등록 / 수정');
      if (whiteLink) {
        whiteLink.removeAttribute('href');
        whiteLink.style.cursor = 'pointer';
        whiteLink.dataset.atfWhiteUserId = userId;
      }
    }

    // 🏷️ 유저 타입 뱃지 (managedUserType 필드 기반 - 유저타입이 지정된 게시글에만 조건부로 존재)
    // white: label-info, black: label-black (둘 다 실사례 확인됨) / red·gray는 label-black과 동일한 네이밍 규칙 추정 - 미확인
    let badgeSpan = authorTd.querySelector('span.label');
    const userType = item.managedUserType || (item.article && item.article.managedUserType) || '';
    const badgeMap = {
      white: { cls: 'label-info', text: '화이트유저' },
      black: { cls: 'label-black', text: '블랙유저' },
      red: { cls: 'label-red', text: '레드유저' },
      gray: { cls: 'label-default', text: '그레이유저' }
    };
    const badgeInfo = badgeMap[userType];

    if (badgeInfo) {
      if (!badgeSpan) {
        badgeSpan = document.createElement('span');
        authorTd.appendChild(badgeSpan);
      }
      badgeSpan.className = `label ${badgeInfo.cls}`;
      badgeSpan.textContent = badgeInfo.text;
    } else if (badgeSpan) {
      badgeSpan.remove();
    }
  }

  // 📊 4. 통계/카운트 수치 영역
  const formatNum = (val) => (val !== undefined && val !== null) ? Number(val).toLocaleString() : '0';
  const formatBool = (val) => (val === true || val === 'Y' || val === 1) ? 'O' : 'X';

  if (tds.length >= 7) {
    const clickEl = tds[6].querySelector('a') || tds[6];
    clickEl.textContent = formatNum(item.clickCount);
    if (clickEl.dataset && userId && articleNo) {
      clickEl.dataset.articleNo = articleNo;
      clickEl.dataset.userId = userId;
    }
  }
  if (tds.length >= 8) {
    const commentEl = tds[7].querySelector('a') || tds[7];
    commentEl.textContent = formatNum(item.commentCount);
  }
  if (tds.length >= 9) {
    tds[8].textContent = formatNum(item.editorpickCount);
  }
  if (tds.length >= 10) {
    tds[9].textContent = (item.managedUserType === 'white') ? 'O' : 'X';
  }
  if (tds.length >= 11) {
    tds[10].textContent = formatNum(item.likeCount);
  }
  if (tds.length >= 12) {
    // 🔧 탑리스트(숫자 카운팅)와 PC 홈 추천/피처링 추천 버튼은 원본 사이트에서 서로 다른
    //    별개의 컬럼이다(탑리스트=tds[11]은 항상 숫자, 버튼은 그 옆의 별도 13번째 td).
    //    버튼은 탑리스트 값과 무관하게 모든 게시물에 항상 노출한다(운영자가 언제든 누를 수 있는
    //    액션이라, 조회/댓글/탑리스트처럼 이용자 액션으로 자동 카운팅되는 값과는 무관함).
    tds[11].textContent = formatNum(item.featureTopCount);

    // 버튼용 13번째 td 확보 - templateTr에 이미 있으면(하필 탑리스트=0인 실제 글이었던 경우) 재사용,
    // 없으면(보통의 경우) 새로 만들어서 탑리스트 td 바로 뒤에 삽입해 항상 존재하도록 함
    let actionTd = tds[12];
    if (!actionTd) {
      actionTd = document.createElement('td');
      tds[11].insertAdjacentElement('afterend', actionTd);
    }
    actionTd.textContent = '';

    if (userId && articleNo) {
      // 🔧 우리가 임의로 만든 인라인 스타일 대신, 원본 사이트가 실제로 쓰는 클래스를 그대로 사용
      //    (실제 마크업: btn btn-warning btn-xs / btn btn-danger btn-xs)
      //    → 사이트 자체 CSS로 이미 이 칸 크기에 맞게 튜닝돼 있어 우리가 다시 맞출 필요가 없다
      // 🔧 여기서 addEventListener로 직접 리스너를 붙이면, 페이지네이션 시 goToPage가
      //    document.importNode(row, true)로 이 행을 다시 복제하면서 리스너가 통째로 유실된다
      //    (importNode/cloneNode는 DOM 구조만 복사하고 JS 리스너는 복사하지 않음).
      //    그래서 클릭해도 콘솔에 아무 로그도 없이 조용히 반응이 없었음 - 체크박스 전체선택 때와 동일한 종류의 버그.
      //    → 리스너를 직접 붙이는 대신 data 속성만 부여하고, 문서 전체에 한 번만 건 이벤트
      //    위임(delegation)으로 클릭을 잡아서 몇 번을 복제해도 항상 동작하도록 한다.
      const pcHomeMiniBtn = document.createElement('button');
      pcHomeMiniBtn.type = 'button';
      pcHomeMiniBtn.className = 'btn btn-warning btn-xs';
      pcHomeMiniBtn.textContent = 'PC 홈 추천';
      pcHomeMiniBtn.dataset.atfFeatureType = 'channel';
      pcHomeMiniBtn.dataset.userId = userId;
      pcHomeMiniBtn.dataset.articleNo = articleNo;

      const featuringMiniBtn = document.createElement('button');
      featuringMiniBtn.type = 'button';
      featuringMiniBtn.className = 'btn btn-danger btn-xs';
      featuringMiniBtn.style.marginTop = '5px';
      featuringMiniBtn.textContent = '피처링 추천';
      featuringMiniBtn.dataset.atfFeatureType = 'top';
      featuringMiniBtn.dataset.userId = userId;
      featuringMiniBtn.dataset.articleNo = articleNo;

      actionTd.append(pcHomeMiniBtn, featuringMiniBtn);

      // 🎁 "오늘만무료 추천" - 멤버십 전문 콘텐츠(응원 내역 옆 "멤버십 전문 조회" 뱃지가
      //    붙는 것과 동일한 조건)일 때만 조건부로 노출. 지금은 UI만 만들어두고 실제 등록
      //    액션(POST /membership-promotion-recommend.json, 이전에 소스 분석으로 확인해둔
      //    엔드포인트)은 아직 연결하지 않음 - 나중에 필요해지면 이 버튼에 로직만 추가하면 됨.
      const isMembershipPromoTarget = !!(item.isMembershipContent || item.membershipContent || (item.article && item.article.membershipContent));
      if (isMembershipPromoTarget) {
        const promoMiniBtn = document.createElement('button');
        promoMiniBtn.type = 'button';
        promoMiniBtn.className = 'btn btn-success btn-xs';
        promoMiniBtn.style.marginTop = '5px';
        promoMiniBtn.textContent = '오늘만무료 추천';
        promoMiniBtn.title = '2026년 7월 7일 "오늘만무료 추천" 종료';
        // 🔧 여기서도 다른 행별 버튼들과 동일한 이유로 addEventListener를 직접 붙이지 않고
        //    data 속성만 부여 - 실제 클릭 처리는 문서 레벨 위임에서 담당(아래 참고)
        promoMiniBtn.dataset.atfPromoPlaceholder = '1';
        actionTd.appendChild(promoMiniBtn);
      }
    }
  }

  return clonedTr;
}

// 📄 15개씩 잘라 그려주는 커스텀 테이블 & 페이지네이션 및 헤더 정렬 기능
function renderCustomPaginatedTable(matchedRows, originalTable) {
  const ITEMS_PER_PAGE = 15;
  let currentRows = [...matchedRows]; // 정렬 상태 유지를 위한 복사본
  const totalItems = currentRows.length;
  let totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
  let currentPage = 1;

  clearCustomResultUI();

  // 🔧 예전엔 <div id=CUSTOM_RESULT_TABLE_ID>로 테이블을 한 번 더 감쌌는데,
  //    이 래퍼가 원본 테이블과 부모 사이에 한 단계(depth)를 추가하면서
  //    사이트 CSS의 '부모 > table' 같은 직계 자식 선택자가 더 이상 매치되지 않아
  //    검색 결과 행의 위아래 padding/높이가 줄어들어 보이는 원인일 수 있었음.
  //    → 래퍼 없이 원본과 동일하게 부모의 '직접 자식'으로 삽입한다.
  // 🔧 (중요) 원본 테이블이 가진 고유 id를 우리 식별자로 덮어쓰면, 그 id를 기준으로 하는
  //    사이트 자체 CSS(padding/높이 등)가 통째로 깨질 수 있어 원본 id/class는 그대로 두고
  //    별도의 data-attribute로만 우리 테이블임을 표시한다.
  const newTable = originalTable.cloneNode(true);
  newTable.setAttribute(CUSTOM_RESULT_ATTR, CUSTOM_RESULT_TABLE_ID);
  newTable.style.setProperty("display", "", "important");
  newTable.style.marginTop = "10px";

  const newTbody = newTable.querySelector("tbody");

  const goToPage = (page) => {
    currentPage = page;
    newTbody.innerHTML = "";

    if (currentRows.length > 0) {
      const startIdx = (page - 1) * ITEMS_PER_PAGE;
      const pageRows = currentRows.slice(startIdx, startIdx + ITEMS_PER_PAGE);

      pageRows.forEach(row => {
        row.style.setProperty("display", "", "important");
        const importedRow = document.importNode(row, true);
        newTbody.appendChild(importedRow);

        // 🔧 실제로 화면에 삽입되는 이 페이지의 이미지만 지금 로드
        importedRow.querySelectorAll('img[data-src]').forEach(img => {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        });
      });
    } else {
      const colCount = originalTable.querySelectorAll("th").length || 10;
      newTbody.innerHTML = `
        <tr>
          <td colspan="${colCount}" style="text-align: center; padding: 50px 0; color: #888; background-color: #ffffff;">
            검색 조건에 일치하는 게시글이 없습니다. (최대 20페이지 탐색 완료)
          </td>
        </tr>
      `;
    }

    renderPaginationUI();
  };

  const PAGE_WINDOW_SIZE = 10; // 🔧 한 번에 보여줄 페이지 번호 개수

  const makePageBtn = (label, targetPage, { isCurrent = false, disabled = false, isText = false } = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = disabled;
    Object.assign(btn.style, {
      minWidth: isText ? "48px" : "32px",
      height: "32px",
      padding: "0 10px",
      border: `1px solid ${isCurrent ? "#4285f4" : "#dcdfe3"}`,
      background: isCurrent ? "#4285f4" : "#ffffff",
      color: disabled ? "#ccc" : (isCurrent ? "#ffffff" : "#444444"),
      borderRadius: "6px",
      cursor: disabled ? "default" : "pointer",
      fontWeight: isCurrent ? "700" : "500",
      fontSize: "13px"
    });
    if (!disabled) btn.addEventListener("click", () => goToPage(targetPage));
    return btn;
  };

  const renderPaginationUI = () => {
    let pagContainer = document.getElementById(CUSTOM_PAGINATION_ID);
    if (pagContainer) pagContainer.remove();

    if (totalPages <= 1) return;

    pagContainer = document.createElement("div");
    pagContainer.id = CUSTOM_PAGINATION_ID;
    Object.assign(pagContainer.style, {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "6px",
      marginTop: "15px",
      marginBottom: "25px"
    });

    // 🔧 전체 페이지를 다 나열하지 않고, 현재 페이지가 속한 10개 단위 구간만 표시
    const currentBlock = Math.ceil(currentPage / PAGE_WINDOW_SIZE);
    const startPage = (currentBlock - 1) * PAGE_WINDOW_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_WINDOW_SIZE - 1, totalPages);

    // 처음 페이지로 한 번에 이동
    pagContainer.appendChild(makePageBtn("처음", 1, { disabled: currentPage === 1, isText: true }));
    if (startPage > 1) {
      pagContainer.appendChild(makePageBtn("«", startPage - PAGE_WINDOW_SIZE)); // 이전 10페이지
    }
    pagContainer.appendChild(makePageBtn("‹", currentPage - 1, { disabled: currentPage === 1 }));

    for (let p = startPage; p <= endPage; p++) {
      pagContainer.appendChild(makePageBtn(String(p), p, { isCurrent: p === currentPage }));
    }

    pagContainer.appendChild(makePageBtn("›", currentPage + 1, { disabled: currentPage === totalPages }));
    if (endPage < totalPages) {
      pagContainer.appendChild(makePageBtn("»", endPage + 1)); // 다음 10페이지
    }
    // 마지막 페이지로 한 번에 이동
    pagContainer.appendChild(makePageBtn("마지막", totalPages, { disabled: currentPage === totalPages, isText: true }));

    newTable.insertAdjacentElement("afterend", pagContainer);
  };

  // 📊 헤더 정렬 이벤트 바인딩
  const bindHeaderSortEvents = () => {
    const ths = newTable.querySelectorAll("thead th");

    // 컬럼 키와 데이터 매핑 헤더
    const sortKeyMap = {
      "조회": "clickCount",
      "댓글": "commentCount",
      "에디터픽": "editorpickCount",
      "화이트": "whiteList",
      "라이킷": "likeCount",
      "탑리스트": "featureTopCount"
    };

    ths.forEach(th => {
      const text = th.textContent.trim();
      let matchedKey = null;

      for (const [keyName, dataKey] of Object.entries(sortKeyMap)) {
        if (text.includes(keyName)) {
          matchedKey = dataKey;
          break;
        }
      }

      if (matchedKey) {
        th.style.cursor = "pointer";
        th.title = "클릭하여 정렬";

        th.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          // 정렬 토글
          if (currentSortState.column === matchedKey) {
            currentSortState.asc = !currentSortState.asc;
          } else {
            currentSortState.column = matchedKey;
            currentSortState.asc = false; // 내림차순(높은순) 기본
          }

          console.log(`📊 [정렬 실행] 컬럼: ${matchedKey}, 오름차순: ${currentSortState.asc}`);

          // 배열 정렬
          currentRows.sort((a, b) => {
            const valA = parseFloat(a.dataset[matchedKey] || 0);
            const valB = parseFloat(b.dataset[matchedKey] || 0);
            return currentSortState.asc ? valA - valB : valB - valA;
          });

          // 1페이지로 돌아가 재렌더링
          goToPage(1);
        });
      }
    });
  };

  bindHeaderSortEvents();

  // ☑️ 헤더의 "전체 선택" 체크박스도 원본 Svelte 바인딩이 clone 과정에서 유실되므로,
  //    직접 change 리스너를 붙여 현재 페이지에 보이는 행들의 체크박스를 일괄 토글해준다.
  //    (table__toolbar-warp 행 안의 체크박스는 없지만 혹시 몰라 제외하고 검색)
  const bindSelectAllCheckbox = () => {
    const selectAllCheckbox = newTable.querySelector('thead tr:not(.table__toolbar-warp) input[type="checkbox"]');
    if (!selectAllCheckbox) return;
    selectAllCheckbox.addEventListener('change', () => {
      newTable.querySelectorAll('tbody input[type="checkbox"][name="data"]')
        .forEach(cb => { cb.checked = selectAllCheckbox.checked; });
      updateBlackRedToolbar();
    });
  };
  bindSelectAllCheckbox();

  originalTable.style.setProperty("display", "none", "important");
  originalTable.parentNode.insertBefore(newTable, originalTable.nextSibling);
  // 🔧 블랙/레드 툴바를 "발행글 리스트" 텍스트 옆에 배치.
  //    원본 테이블 thead 안에 <div class="table__toolbar">(flex, "발행글 리스트" 텍스트 포함)가
  //    있고, 이건 네이티브 사이트가 체크 시 이 텍스트를 자체 툴바로 바꿔치기하는 자리다.
  //    newTable은 originalTable을 통째로 clone한 것이라 이 자리도 그대로 복제돼 있으므로,
  //    그 안에 우리 툴바를 넣으면 flex로 "발행글 리스트" 옆에 자연스럽게 나란히 붙는다.
  //    (구조가 안 맞는 예외 상황 대비, 못 찾으면 기존처럼 테이블 바로 위에 배치)
  const toolbarSlot = newTable.querySelector('.table__toolbar');
  if (toolbarSlot) {
    toolbarSlot.appendChild(ensureBlackRedToolbar());
  } else {
    newTable.parentNode.insertBefore(ensureBlackRedToolbar(), newTable);
  }

  goToPage(1);
}

// ══════════════════════════════════════════════════════════════════
// § 3. 검색 실행/결과 수신, 팝업(iframe) 메시지 처리
// ══════════════════════════════════════════════════════════════════
// 6. window.postMessage 응답 수신 핸들러
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "RES_SVELTE_PAGES") return;
  // 🔐 injected.js는 같은 창(main world)에서 postMessage하므로 source가 window 자신이어야 하고
  //    origin도 페이지 자신이어야 한다. 다른 프레임/스크립트가 위조한 메시지는 여기서 차단.
  if (event.source !== window || event.origin !== location.origin) return;

  console.log("📥 [content.js] injected.js로부터 20페이지 수집 결과 도착:", event.data.articles.length, "건");

  const articles = event.data.articles || [];
  const filterParams = event.data.filterParams;
  const usedDefaultRange = !!event.data.usedDefaultRange;
  const lookbackDays = event.data.lookbackDays;
  const fromCache = !!event.data.fromCache;

  // 🔧 어떤 상황(에러 포함)에서도 반드시 팝업으로 결과/에러를 알려주고
  //    isSearchingProcess를 리셋해서 "검색 중..." 박스가 영구히 남지 않도록 보장
  const notifyPopupAndReset = (count, errorMessage = null) => {
    const iframe = document.getElementById("my-extension-modal-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: "SEARCH_RESULT_COUNT",
        count: count,
        error: errorMessage,
        usedDefaultRange: usedDefaultRange,
        lookbackDays: lookbackDays,
        fromCache: fromCache
      }, "*");
    }
    isSearchingProcess = false;
    // 🗂️ 검색이 끝나는 시점(성공/실패 상관없이)마다 이번 검색에서 쌓인 로그를 자동으로
    //    txt로 저장 - "혹시 모를 오류에 대응"하기 위한 근거 자료. 저장 후 버퍼는 비워져서
    //    다음 검색은 또 처음부터 새로 쌓인다.
    downloadAtfLogBufferAsTxt();
  };

  try {
    const originalTable = getArticleTable();
    if (!originalTable) {
      console.error("❌ 원본 테이블을 찾을 수 없습니다.");
      notifyPopupAndReset(0, "원본 게시글 테이블을 찾을 수 없습니다.");
      return;
    }

    const templateTr = originalTable.querySelector("tbody > tr");
    if (!templateTr) {
      console.error("❌ templateTr을 찾을 수 없습니다.");
      notifyPopupAndReset(0, "게시글 행 템플릿을 찾을 수 없습니다.");
      return;
    }

    const matchedRows = [];
    const matchedItems = [];
    const excludedForDiagnosis = []; // 🔧 진단용 - 조건에 안 맞아 걸러진 글을 원인 파악을 위해 따로 기록

    // 🔧 이 브라우저의 로컬 타임존(=운영자가 보고 있는 한국 시간) 기준으로 "YYYY-MM-DD HH:mm:ss"
    //    형태로 포맷 - 이전엔 toISOString()(UTC)을 그대로 찍어서 "8/1 15시"처럼 보이는 게 실은
    //    한국 시간으로 "8/2 0시"였던 걸 착각하게 만들었던 문제를 여기서 바로잡는다.
    const formatLocalDateTime = (ms) => {
      const d = new Date(ms);
      const p2 = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    };

    articles.forEach(item => {
      if (checkArticleMatch(item, filterParams)) {
        const rowDom = createRowFromItem(item, templateTr);
        if (rowDom) {
          matchedRows.push(rowDom);
          matchedItems.push(item);
        }
      } else {
        // 🔧 "포함 조건"/"제외 조건"에 안 맞아 걸러진 것까지 전부 진단 로그에 찍으면
        //    키워드 조건을 걸었을 때 너무 많이 쏟아져서 정작 보고 싶은 발행 시각 경계
        //    케이스를 찾기 어려워짐. 그래서 "발행 시각 조건만 없었다면 통과했을 글"인
        //    경우에만(=정말로 발행 시각 때문에 제외된 경우에만) 진단 로그에 남긴다.
        const excludedByDateOnly = checkArticleMatch(item, { ...filterParams, dateEnabled: false });
        if (excludedByDateOnly) {
          const title = item.title || (item.article && item.article.title) || '(제목 없음)';
          const userId = item.userId || (item.article && item.article.userId) || '';
          const publishTimeMs = getPublishTimeMs(item);
          excludedForDiagnosis.push({
            title,
            userId,
            publishTimeLocal: publishTimeMs ? formatLocalDateTime(publishTimeMs) : '(발행시각 파싱 실패)'
          });
        }
      }
    });

    lastMatchedItems = matchedItems; // 🔧 다운로드 버튼에서 사용

    console.log(`✅ [필터링 완료] 최종 검색 일치 항목: ${matchedRows.length}개`);
    // 🔧 진단용 로그 - "원천 데이터 개수"와 "최종 검색 일치 개수"가 왜 차이 나는지 바로 확인 가능하도록,
    //    걸러진 글들의 제목/작가/정확한 발행시각(한국 로컬 시간 기준)을 콘솔뿐 아니라
    //    팝업의 배치 로그 박스에도 그대로 띄운다(기존 SEARCH_PROGRESS 채널 재사용).
    if (excludedForDiagnosis.length > 0) {
      console.log(`🔍 [진단] 조건에 안 맞아 걸러진 글 ${excludedForDiagnosis.length}건:`, excludedForDiagnosis);

      const diagIframe = document.getElementById("my-extension-modal-iframe");
      if (diagIframe && diagIframe.contentWindow) {
        diagIframe.contentWindow.postMessage({
          type: "SEARCH_PROGRESS",
          message: `🔍 [진단] 조건에 안 맞아 걸러진 글 ${excludedForDiagnosis.length}건`
        }, "*");
        excludedForDiagnosis.forEach(({ title, userId, publishTimeLocal }) => {
          diagIframe.contentWindow.postMessage({
            type: "SEARCH_PROGRESS",
            message: `  └─ "${title}" (작가:${userId || '?'}) 발행시각(한국시간)=${publishTimeLocal}`
          }, "*");
        });
      }
    }

    renderCustomPaginatedTable(matchedRows, originalTable);
    toggleOriginalPagination(false);

    const iframe = document.getElementById("my-extension-modal-iframe");
    if (iframe) iframe.style.display = "block";

    notifyPopupAndReset(matchedRows.length);
  } catch (err) {
    console.error("❌ [content.js] 검색 결과 처리 중 예외 발생:", err);
    notifyPopupAndReset(0, "검색 처리 중 오류가 발생했습니다: " + (err?.message || String(err)));
  }
});

// 6-1. injected.js의 진행 로그(SEARCH_PROGRESS)를 팝업으로 중계
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "SEARCH_PROGRESS") return;
  if (event.source !== window || event.origin !== location.origin) return;

  const iframe = document.getElementById("my-extension-modal-iframe");
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({
      type: "SEARCH_PROGRESS",
      message: event.data.message
    }, "*");
  }
});

// 7. iframe 메시지 수신 핸들러
window.addEventListener("message", (event) => {
  if (!event.data || window !== window.top) return;
  // 🔐 이 리스너는 popup.html(iframe)에서만 와야 한다 - 우리 확장 자신의 origin이 아니면 무시
  if (event.origin !== ATF_EXTENSION_ORIGIN) return;

  if (event.data.type === "RESIZE_IFRAME") {
    const iframe = document.getElementById("my-extension-modal-iframe");
    if (iframe) iframe.style.height = `${event.data.height}px`;
  }

  if (event.data.type === "EXECUTE_SEARCH") {
    if (isSearchingProcess) return;
    isSearchingProcess = true;

    window.postMessage({
      type: "REQ_SVELTE_PAGES",
      params: event.data.params
    }, "*");
  }

  if (event.data.type === "RESET_FILTER") {
    clearCustomResultUI();

    const originalTable = getArticleTable();
    if (originalTable) originalTable.style.setProperty("display", "", "important");

    toggleOriginalPagination(true);
  }

  if (event.data.type === "DRAG_START") {
    startModalDrag(event.data.x, event.data.y);
  }

  // 📋 이력 창 열기/닫기/드래그 이동 - 검색 팝업(popup.html)의 "이력" 버튼과, 별도 iframe인
  //    action-log.html 양쪽에서 다 이 메시지를 보낼 수 있다(둘 다 우리 확장 자신의 origin이라
  //    위의 origin 검증을 그대로 통과함).
  if (event.data.type === "OPEN_LOG_VIEW") {
    toggleLogModal(true);
  }

  if (event.data.type === "CLOSE_LOG_VIEW") {
    toggleLogModal(false);
  }

  if (event.data.type === "LOG_DRAG_START") {
    startLogModalDrag(event.data.x, event.data.y);
  }

  if (event.data.type === "CLOSE_MODAL") {
    const iframe = document.getElementById("my-extension-modal-iframe");
    if (iframe) iframe.style.display = "none";
  }

  if (event.data.type === "REQUEST_DOWNLOAD") {
    downloadMatchedResultsCSV();
  }
});

// ══════════════════════════════════════════════════════════════════
// § 4. xlsx 다운로드
// ══════════════════════════════════════════════════════════════════
// 🔧 background.js(서비스워커)에 실제 브런치 주소(vanity handle) 조회를 요청.
//    content script의 fetch는 CORS에 막히지만, 백그라운드는 host_permissions 덕분에
//    brunch.co.kr을 CORS 제약 없이 요청할 수 있어서 여기로 위임한다.
function resolveBrunchHandles(items) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "RESOLVE_BRUNCH_HANDLES", items },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ 브런치 실제 주소 조회 실패:", chrome.runtime.lastError.message);
            resolve({});
            return;
          }
          resolve((response && response.handles) || {});
        }
      );
    } catch (e) {
      console.warn("⚠️ 브런치 실제 주소 조회 요청 실패:", e);
      resolve({});
    }
  });
}

// 📥 검색 결과 다운로드 (제목 / URL / 작가명 CSV)
async function downloadMatchedResultsCSV() {
  const iframe = document.getElementById("my-extension-modal-iframe");
  const notifyPopup = (payload) => {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: "DOWNLOAD_RESULT", ...payload }, "*");
    }
  };

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

  // 같은 작가(userId)는 한 번만 조회하면 충분하므로 중복 제거 후 요청
  const uniqueMap = new Map();
  baseRows.forEach(r => {
    if (r.userId && r.articleNo && !uniqueMap.has(r.userId)) {
      uniqueMap.set(r.userId, r.articleNo);
    }
  });
  const uniqueItems = Array.from(uniqueMap.entries()).map(([userId, articleNo]) => ({ userId, articleNo }));

  const handles = uniqueItems.length > 0 ? await resolveBrunchHandles(uniqueItems) : {};

  const rows = baseRows.map(r => {
    const resolvedHandle = r.userId ? handles[r.userId] : null;
    let url = '';
    if (resolvedHandle && r.articleNo) {
      url = `https://brunch.co.kr/@${resolvedHandle}/${r.articleNo}`; // ✅ 실제 최종 주소
    } else if (r.userId && r.articleNo) {
      url = `https://brunch.co.kr/@@${r.userId}/${r.articleNo}`; // 조회 실패 시 폴백 (그래도 정상 동작함)
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
    notifyPopup({ error: "다운로드 모듈(xlsx-writer.js)을 불러오지 못했습니다. 확장프로그램을 새로고침해 주세요." });
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
  URL.revokeObjectURL(blobUrl);

  notifyPopup({ count: rows.length });
}

// ══════════════════════════════════════════════════════════════════
// § 5. 검색 팝업 드래그 이동
// ══════════════════════════════════════════════════════════════════
// 🖱️ 팝업 자유 이동(드래그) 처리
//    iframe 위에서는 top window가 mousemove를 못 받으므로, 드래그 중엔
//    iframe의 pointer-events를 꺼서 이벤트가 top window로 그대로 전달되게 한다.
let isDraggingModal = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startModalDrag(offsetX, offsetY) {
  const iframe = document.getElementById("my-extension-modal-iframe");
  if (!iframe) return;

  // 최초 1회, right 기반 위치를 left 기반으로 전환 (드래그로 자유 이동시키기 위함)
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
  const iframe = document.getElementById("my-extension-modal-iframe");
  if (!iframe) return;

  const margin = 24; // 화면 밖으로 완전히 사라지지 않도록 최소 여백 확보
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

  const iframe = document.getElementById("my-extension-modal-iframe");
  if (iframe) iframe.style.pointerEvents = "";

  document.removeEventListener("mousemove", onModalDragMove);
  document.removeEventListener("mouseup", onModalDragEnd);
}

// 🖱️ 이력 창(log iframe)도 검색 팝업과 동일한 방식으로 자유롭게 옮길 수 있게 한다.
//    처음엔 top:30px/right:20px에 고정돼 있다가, 드래그를 시작하는 순간 left/top 기반으로
//    전환해서 자유 이동시킨다(검색 팝업 드래그와 완전히 같은 패턴, 상태만 별도로 관리).
let isDraggingLogModal = false;
let logDragOffsetX = 0;
let logDragOffsetY = 0;

function startLogModalDrag(offsetX, offsetY) {
  const iframe = document.getElementById("atf-log-iframe");
  if (!iframe) return;

  const rect = iframe.getBoundingClientRect();
  iframe.style.right = "auto";
  iframe.style.left = `${rect.left}px`;
  iframe.style.top = `${rect.top}px`;
  // 🔧 화면 중앙 정렬에 쓰던 transform:translate(-50%,-50%)를 그대로 두면, 방금 구한
  //    left/top(이미 그 transform까지 적용된 최종 위치) 위에 transform이 또 한 번 적용돼서
  //    드래그 시작하자마자 위치가 훅 튀는 버그가 생긴다 - left/top 기반으로 전환하는 시점에
  //    반드시 같이 제거해야 함.
  iframe.style.transform = "none";

  logDragOffsetX = offsetX;
  logDragOffsetY = offsetY;
  isDraggingLogModal = true;
  iframe.style.pointerEvents = "none";

  document.addEventListener("mousemove", onLogModalDragMove);
  document.addEventListener("mouseup", onLogModalDragEnd);
}

function onLogModalDragMove(e) {
  if (!isDraggingLogModal) return;
  const iframe = document.getElementById("atf-log-iframe");
  if (!iframe) return;

  const margin = 24;
  let newLeft = e.clientX - logDragOffsetX;
  let newTop = e.clientY - logDragOffsetY;

  newLeft = Math.max(-(iframe.offsetWidth - margin), Math.min(newLeft, window.innerWidth - margin));
  newTop = Math.max(0, Math.min(newTop, window.innerHeight - margin));

  iframe.style.left = `${newLeft}px`;
  iframe.style.top = `${newTop}px`;
}

function onLogModalDragEnd() {
  if (!isDraggingLogModal) return;
  isDraggingLogModal = false;

  const iframe = document.getElementById("atf-log-iframe");
  if (iframe) iframe.style.pointerEvents = "";

  document.removeEventListener("mousemove", onLogModalDragMove);
  document.removeEventListener("mouseup", onLogModalDragEnd);
}

// ══════════════════════════════════════════════════════════════════
// § 6. 블랙/레드글·PC홈추천·작가리스트 액션 트리거
// ══════════════════════════════════════════════════════════════════
// 실제 액션 트리거 함수와 그 클릭/체크박스 이벤트 위임 처리.
// 🖤🔴 체크박스 선택 시 뜨는 블랙/레드글 일괄 등록 툴바
//    원본 사이트의 adminB.article.addBlackRedArticle(type)를 인자 없이 호출하면
//    체크된 항목(input[name=data]:checked)들을 스스로 모아서 confirm 확인 후 서버에 등록한다.
//    (직접 userId/articleNo를 넘기면 확인창 없이 바로 등록되어 위험하므로, 항상 이 체크박스
//     경로로만 호출한다 - 원본 코드 확인 결과 이 경로에서만 confirm이 뜸)
let blackRedToolbar = null;

function ensureBlackRedToolbar() {
  if (blackRedToolbar) return blackRedToolbar;

  blackRedToolbar = document.createElement('div');
  blackRedToolbar.id = 'atf-blackred-toolbar';
  // 🔧 버튼 자체(class="btn btn-default btn-sm")는 원본 사이트 CSS를 그대로 타므로,
  //    이 바깥 컨테이너는 배치(레이아웃)에 필요한 최소한의 스타일만 지정한다.
  Object.assign(blackRedToolbar.style, {
    marginLeft: '0',
    marginTop: '-8px',
    marginBottom: '14px',
    width: 'fit-content',
    boxSizing: 'border-box',
    zIndex: '100',
    display: 'none',
    alignItems: 'center',
    gap: '8px'
  });

  // 🔧 실제 원본 마크업(DevTools Inspect로 캡처): 취소 버튼 → 선택 개수 표시(.small) →
  //    PC 홈 추천 버튼 → .btn-group(F_블랙글/R_레드글 등록) 순서, 전부 class="btn btn-default btn-sm"
  const makeBtn = (text) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-default btn-sm';
    btn.textContent = text;
    return btn;
  };

  const cancelBtn = makeBtn('취소');
  cancelBtn.addEventListener('click', () => {
    document.querySelectorAll(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`)
      .forEach(cb => { cb.checked = false; });
    // 🔧 개별 체크박스만 풀고 헤더의 "전체 선택" 체크박스는 그대로 두면 상태가 안 맞으므로 같이 해제
    document.querySelectorAll(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] thead tr:not(.table__toolbar-warp) input[type="checkbox"]`)
      .forEach(cb => { cb.checked = false; });
    updateBlackRedToolbar();
  });

  const countLabel = document.createElement('div');
  countLabel.className = 'small';
  const countNumSpan = document.createElement('span');
  countNumSpan.id = 'atf-blackred-count';
  countLabel.append(countNumSpan, document.createTextNode('개 항목 선택 됨'));

  const pcHomeBtn = makeBtn('PC 홈 추천');
  pcHomeBtn.addEventListener('click', () => triggerPcHomeRecommend());

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';
  btnGroup.setAttribute('role', 'group');

  const blackBtn = makeBtn('F_블랙글 등록');
  blackBtn.addEventListener('click', () => triggerBlackRedRegister('black'));

  const redBtn = makeBtn('R_레드글 등록');
  redBtn.addEventListener('click', () => triggerBlackRedRegister('red'));

  btnGroup.append(blackBtn, redBtn);
  blackRedToolbar.append(cancelBtn, countLabel, pcHomeBtn, btnGroup);
  document.body.appendChild(blackRedToolbar);
  return blackRedToolbar;
}

async function triggerPcHomeRecommend() {
  // 🔧 블랙/레드글과 동일한 안전장치: 우리 검색결과 밖에 체크된 게 남아있으면 먼저 해제
  document.querySelectorAll('input[type="checkbox"][name="data"]:checked').forEach(cb => {
    if (!cb.closest(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"]`)) cb.checked = false;
  });

  const checkedBoxes = [...document.querySelectorAll(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`
  )];
  if (checkedBoxes.length === 0) return;

  const ids = checkedBoxes.map(cb => ({
    userId: cb.getAttribute('user'),
    articleNo: cb.getAttribute('articleno')
  }));

  // 🔧 원본 사이트의 검증 로직(이미 top 상태면 차단)은 서버가 어차피 항목별로 다시 확인해주지만,
  //    확인창이 여러 번 뜨기 전에 미리 걸러내면 사용자 경험이 낫다.
  const hasAlreadyTop = ids.some(({ userId, articleNo }) => {
    const item = lastMatchedItems.find(it => it.userId === userId && it.articleNo === articleNo);
    return !!(item && item.featureData && item.featureData.type === 'top');
  });
  if (hasAlreadyTop) {
    alert('탑 추천글은 PC 홈 추천글로 변경할 수 없습니다.');
    return;
  }

  // 🔧 adminB.article.addFeatureData의 "인자 없는 일괄 모드"는 우리 클론 행에는 없는
  //    별도 jQuery 데이터 구조(.daily-data[data-no=...])에 의존하고 있어 그대로 재현하기 어렵지만,
  //    그 안에서 최종적으로 호출하는 adminB.article.addFeatureDataCallback은 contentIdList
  //    배열만 채워서 넘기면 되므로 이걸 직접 호출한다. 원본 사이트와 동일하게 confirm 1번 +
  //    요청 1번으로 선택된 항목 전부가 한 번에 처리된다 (원본도 일괄 모드에서는 블랙/레드/미발행
  //    서버 검증을 하지 않으므로, 우리도 동일 수준 - 이미 top 상태 차단만 위에서 미리 걸러줌).
  const contentIdList = ids.map(({ userId, articleNo }) => `${userId}-${articleNo}`);
  triggerAddFeatureDataBatch('channel', contentIdList);
}

// 📌 PC 홈 추천/피처링 추천 일괄 처리 - adminB.article.addFeatureDataCallback에 직접 위임.
//    contentIdList 여러 건을 한 번에 넘기면 confirm 1번 + 요청 1번으로 전부 처리된다.
function triggerAddFeatureDataBatch(type, contentIdList) {
  if (!contentIdList || contentIdList.length === 0) return;
  logAction(type === 'top' ? 'featuring' : 'pcHome', { count: contentIdList.length, targets: contentIdList });
  window.postMessage({ type: 'TRIGGER_ADD_FEATURE_DATA_BATCH', regType: type, contentIdList }, '*');
}

// 📌 PC 홈 추천/피처링 추천 - 실제 adminB.article.addFeatureData(type, articleNo, userId)에 위임.
//    이 "단건 모드"는 confirm 창부터 블랙/레드/미발행 서버 검증, 등록, 성공 시 라벨 갱신까지
//    전부 원본 사이트 코드가 그대로 처리해준다 - 우리가 요청 형식을 추측할 필요가 없다.
function triggerAddFeatureData(type, articleNo, userId) {
  if (!articleNo || !userId) return;
  const item = lastMatchedItems.find(it => it.userId === userId && it.articleNo === articleNo);
  const title = (item && (item.title || (item.article && item.article.title))) || '';
  logAction(type === 'top' ? 'featuring' : 'pcHome', { userId, articleNo, title });
  window.postMessage({ type: 'TRIGGER_ADD_FEATURE_DATA', regType: type, articleNo, userId }, '*');
}

function updateBlackRedToolbar() {
  const toolbar = ensureBlackRedToolbar();
  const checkedCount = document.querySelectorAll(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`).length;
  const countLabel = document.getElementById('atf-blackred-count');
  if (countLabel) countLabel.textContent = String(checkedCount);
  toolbar.style.display = checkedCount > 0 ? 'flex' : 'none';

  // 🔧 툴바가 들어간 .table__toolbar 안의 "발행글 리스트" 텍스트(우리 툴바 외 나머지 자식들)를
  //    네이티브처럼 체크 시 숨기고, 선택 해제 시 다시 보이도록 함
  const toolbarSlot = toolbar.parentElement;
  if (toolbarSlot && toolbarSlot.classList.contains('table__toolbar')) {
    Array.from(toolbarSlot.children).forEach(child => {
      if (child !== toolbar) {
        child.style.setProperty('display', checkedCount > 0 ? 'none' : '', checkedCount > 0 ? 'important' : '');
      }
    });
    // 가운데 정렬은 오른쪽 컬럼까지 포함해 계산되어 화면상 치우쳐 보이므로 원래 왼쪽 정렬 유지
  }
}

function triggerBlackRedRegister(type) {
  // 🔧 addBlackRedArticle()은 문서 전체에서 체크된 항목을 긁어가는 구조라서,
  //    혹시 원본(숨겨진) 테이블에 체크된 게 남아있으면 같이 등록될 위험이 있다.
  //    우리 검색 결과 영역 밖의 체크박스는 호출 직전에 전부 강제로 해제해서,
  //    반드시 "지금 화면에 보이는 검색 결과"만 대상이 되도록 격리한다.
  document.querySelectorAll('input[type="checkbox"][name="data"]:checked').forEach(cb => {
    if (!cb.closest(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"]`)) {
      cb.checked = false;
    }
  });

  // 📝 confirm 창이 뜨기 전, 지금 대상이 정확히 뭔지 이력에 남겨둔다(제목까지 포함해서
  //    나중에 "이게 맞게 등록된 거였나" 다시 확인할 수 있게)
  const targets = [...document.querySelectorAll(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`
  )].map(cb => {
    const titleEl = cb.closest('tr')?.querySelector('td.text-left a');
    return { userId: cb.getAttribute('user'), articleNo: cb.getAttribute('articleno'), title: titleEl?.textContent?.trim() || '' };
  });
  logAction(type === 'black' ? 'black' : 'red', { count: targets.length, targets });

  // 🔧 adminB는 페이지 메인 스크립트 공간에만 있어서, injected.js를 통해 호출을 위임한다.
  window.postMessage({ type: 'TRIGGER_BLACK_RED_REGISTER', regType: type }, '*');
}

// 검색 결과 내 체크박스 변경 감지 (이벤트 위임 - 매 페이지 전환마다 다시 붙일 필요 없음)
document.addEventListener('change', (e) => {
  if (e.target && e.target.matches(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]`)) {
    updateBlackRedToolbar();
  }
});

// 🔧 행별 PC 홈 추천/피처링 추천 버튼 클릭 감지 (이벤트 위임)
//    - goToPage가 document.importNode(row, true)로 행을 다시 복제할 때 JS 리스너는 복사되지
//      않으므로, 버튼에 직접 addEventListener를 붙이는 대신 문서 전체에 한 번만 위임을 걸어둔다.
document.addEventListener('click', (e) => {
  const featureBtn = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] [data-atf-feature-type]`
  );
  if (featureBtn) {
    const { atfFeatureType: type, userId, articleNo } = featureBtn.dataset;
    triggerAddFeatureData(type, articleNo, userId);
    return;
  }

  // 🎁 "오늘만무료 추천" - 아직 UI만 구현된 상태라 클릭하면 안내만 띄운다
  const promoBtn = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] [data-atf-promo-placeholder]`
  );
  if (promoBtn) {
    alert('2026년 7월 7일 "오늘만무료 추천" 종료');
    return;
  }

  // 🔧 "글 정보" 드롭다운의 블랙글/레드글 등록 링크도 같은 이유로 이벤트 위임 방식으로 처리
  const registerLink = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a[data-atf-blackred-type]`
  );
  if (registerLink) {
    e.preventDefault();
    const type = registerLink.dataset.atfBlackredType;
    const row = registerLink.closest('tr');
    const rowCheckbox = row && row.querySelector('input[type="checkbox"][name="data"]');
    if (!rowCheckbox) return;
    document.querySelectorAll(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`)
      .forEach(cb => { if (cb !== rowCheckbox) cb.checked = false; });
    rowCheckbox.checked = true;
    updateBlackRedToolbar();
    triggerBlackRedRegister(type);
    return;
  }

  // 🔧 "작가 정보" 드롭다운의 그레이/블랙/레드리스트 등록 링크도 같은 이유로 이벤트 위임 방식으로 처리
  const managedUserLink = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a[data-atf-managed-user-type]`
  );
  if (managedUserLink) {
    e.preventDefault();
    const { atfManagedUserType: type, userId } = managedUserLink.dataset;
    triggerAddManagedUser(type, userId);
    return;
  }

  // 🤍 "화이트리스트 등록 / 수정" 링크도 동일한 이유로 이벤트 위임 방식으로 처리.
  //    adminB/jQuery 접근이 필요해 content.js가 아니라 injected.js(메인 월드)에 위임한다.
  const whiteLink = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a[data-atf-white-user-id]`
  );
  if (whiteLink) {
    e.preventDefault();
    const userId = whiteLink.dataset.atfWhiteUserId;
    // 📝 모달 안 저장 버튼은 원본 리스너를 그대로 타서 저장 성공 여부를 우리가 확인할 방법이
    //    없다 - 그래서 "저장됨"이 아니라 "모달을 열었다(시도)"로 정직하게 기록해둔다.
    logAction('whiteOpen', { userId, note: '모달 오픈 - 실제 저장 완료 여부는 확인 불가' });
    window.postMessage({ type: 'TRIGGER_WHITE_MODAL', userId }, '*');
  }
});

// 📌 작가 화이트/그레이/블랙/레드리스트 등록 - 전역 노출 함수가 없어 Network 캡처로 확인한
//    실제 요청(POST /user/addManagedUser.json?type=...&userId=...&innerComment=...)을 직접 재현.
//    사유(코멘트) 입력이 필요해서 prompt()로 받는다(취소하면 중단).
async function triggerAddManagedUser(type, userId) {
  if (!userId) return;
  const typeLabel = { gray: '그레이리스트', black: '블랙리스트', red: '레드리스트' }[type] || type;
  const comment = prompt(`${typeLabel}로 등록할 사유를 입력해 주세요.`);
  if (comment === null) return; // 취소
  if (!comment.trim()) {
    alert('사유를 입력해 주세요.');
    return;
  }

  const params = new URLSearchParams({ type, userId, innerComment: comment });
  try {
    const res = await fetch(`/user/addManagedUser.json?${params.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json;charset=utf-8' }
    });
    if (!res.ok) {
      alert(res.status === 401 ? '권한이 없습니다.' : '오류가 발생하였습니다.');
      return;
    }
    // 🔧 실제 응답 캡처 결과: {"data":null,"success":true,"error":false} 형태로
    //    HTTP 200이어도 본문 안에 success/error 필드가 따로 있음 - 상태 코드만으로 판단하지 않고
    //    이 필드를 직접 확인한다 (블랙/레드글 등록 handler.success와 동일한 패턴).
    const result = await res.json();
    if (result && result.success && !result.error) {
      alert(`${typeLabel}로 등록되었습니다.`);
      logAction('managedUser', { type, userId, comment });
      window.location.reload();
    } else {
      alert((result && result.errorMessage) || '오류가 발생하였습니다.');
    }
  } catch (err) {
    console.error('❌ [작가 리스트 등록] 요청 실패:', err);
    alert('요청 중 오류가 발생했습니다.');
  }
}
