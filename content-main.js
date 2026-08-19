// content-main.js
// 기능: 격리 world 전역 상태·상수, 검색 팝업/모달 생성, 검색 결과 필터링·렌더링,
// 검색 실행·다운로드, 팝업 드래그, 커스텀 alert/confirm/prompt 모달, 확장 초기화 진입점
// (블랙/레드글 등 액션 트리거는 삭제됨, 뱃지 렌더링은 content-badges.js로 분리됨,
// xlsx 생성은 xlsx-writer.js로 분리됨)
//
// §0(전역 상태)이 맨 위, §7(초기화 진입점)이 맨 아래에 위치 - 파일 내부는 위→아래로 순서가
// 보장되므로, 여러 파일로 나뉘어 있을 때 생기던 "로드 순서" 제약 없이 안전하게 초기화된다.

// ══════════════════════════════════════════════════════════════════
// § 0. 격리 world 전역 상태·상수 (다른 어떤 함수보다 먼저 선언되어야 함)
// ══════════════════════════════════════════════════════════════════

console.log("🟢 [ATF2029] content.js 로드 완료 (Frame ID:", window.name || "current", ")");

let lastUrl = location.href;

// 커스텀 검색결과 테이블 식별용 (원본 id/class와 충돌 방지)
const CUSTOM_RESULT_TABLE_ID = "atf-custom-result-container";
const CUSTOM_RESULT_ATTR = "data-atf-role";

// 다운로드 기능에서 사용하는 최근 검색결과 캐시
let lastMatchedItems = [];
let lastMatchedRows = [];

const CUSTOM_PAGINATION_ID = "atf-custom-pagination-container";
let isSearchingProcess = false;

// postMessage 발신처 검증용 확장 origin
// 모든 postMessage 리스너가 이 값과 대조해 위조 메시지를 차단
const ATF_EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);

// ══════════════════════════════════════════════════════════════════
// § 0-1. 커스텀 alert/confirm/prompt 모달 (페이지에 직접 그림 - popup.html 팝업과는 별개)
// ══════════════════════════════════════════════════════════════════
// 브런치 페이지 자체에 확장 스타일의 모달을 직접 그려서 표시. 동적 값은 항상 textContent로만
// 넣어서 XSS 여지를 없앤다.
function atfShowModal_({ title, message, kind, defaultValue }) {
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

    let inputEl = null;
    if (kind === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.value = defaultValue || '';
      Object.assign(inputEl.style, {
        width: '100%', padding: '8px', marginBottom: '14px',
        border: '1px solid #DCE2EE', borderRadius: '6px', boxSizing: 'border-box', fontSize: '12px'
      });
      box.appendChild(inputEl);
    }

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

    if (kind === 'confirm') {
      const cancelBtn = makeBtn('취소', false);
      cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
      const okBtn = makeBtn('확인', true);
      okBtn.addEventListener('click', () => { cleanup(); resolve(true); });
      btnRow.append(cancelBtn, okBtn);
    } else if (kind === 'prompt') {
      const cancelBtn = makeBtn('취소', false);
      cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });
      const okBtn = makeBtn('확인', true);
      okBtn.addEventListener('click', () => { cleanup(); resolve(inputEl.value); });
      btnRow.append(cancelBtn, okBtn);
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
    } else {
      const okBtn = makeBtn('확인', true);
      okBtn.addEventListener('click', () => { cleanup(); resolve(true); });
      btnRow.append(okBtn);
    }

    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    if (inputEl) inputEl.focus();
  });
}

function atfAlert(message, title) {
  return atfShowModal_({ title: title || '안내', message, kind: 'alert' });
}
function atfConfirm(message, title) {
  return atfShowModal_({ title: title || '확인', message, kind: 'confirm' });
}
function atfPrompt(message, defaultValue, title) {
  return atfShowModal_({ title: title || '입력', message, kind: 'prompt', defaultValue });
}

// ══════════════════════════════════════════════════════════════════
// § 1. 초기화 (모달/버튼 생성, injected.js 주입, SPA 재초기화 진입점)
// ══════════════════════════════════════════════════════════════════

// 메인 world 스크립트(injected.js + console-log.js) 동적 주입
// console-log.js의 postMessage 중계에 nonce로 origin 위조를 방지한다
function injectMainWorldScript(onReady) {
  if (window !== window.top) return;

  const existing = document.getElementById("atf-injected-script-main");
  if (existing) {
    if (onReady) onReady();
    return;
  }

  try {
    const nonce = crypto.randomUUID();
    window.__ATF_NONCE__ = nonce;

    const scriptLog = document.createElement("script");
    scriptLog.id = "atf-injected-script-log";
    scriptLog.src = chrome.runtime.getURL("console-log.js");
    scriptLog.async = false;
    scriptLog.dataset.atfNonce = nonce;
    scriptLog.addEventListener("load", () => {
      scriptLog.removeAttribute("data-atf-nonce"); // 읽어간 뒤 즉시 제거해 흔적 최소화
    }, { once: true });

    const scriptMain = document.createElement("script");
    scriptMain.id = "atf-injected-script-main";
    scriptMain.src = chrome.runtime.getURL("injected.js");
    scriptMain.async = false;
    scriptMain.addEventListener("load", () => {
      if (onReady) onReady();
    }, { once: true });

    const parent = document.head || document.documentElement;
    parent.appendChild(scriptLog);
    parent.appendChild(scriptMain);
  } catch (e) {
    console.error("❌ injected.js 주입 실패:", e);
  }
}

// 커스텀 결과 테이블 스타일 주입 (링크 아웃라인 정리, 컬럼 너비 자동조정)
function injectCustomTableStyles() {
  if (document.getElementById("atf-custom-table-style")) return;

  const style = document.createElement("style");
  style.id = "atf-custom-table-style";
  style.textContent = `
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a {
      outline: none;
    }
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a:hover {
      text-decoration: underline;
    }
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a:focus,
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a:focus-visible {
      outline: none;
      text-decoration: underline;
    }
    [${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] {
      table-layout: auto !important;
    }
  `;
  document.head.appendChild(style);
}

// 페이지의 [다운로드] 버튼 옆에 [🔍 조건검색] 버튼 생성
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

// 검색 팝업 모달 iframe 생성
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

function checkAndInitExtension() {
  if (!window.location.href.includes("/article/daily")) return;
  if (window !== window.top) return;

  injectMainWorldScript();
  injectCustomTableStyles();
  createExtensionModal();
  injectExtensionButton();
}

// ══════════════════════════════════════════════════════════════════
// § 2. 검색 결과 필터링 및 렌더링
// ══════════════════════════════════════════════════════════════════

// 발행 시각 원본 타임스탬프(ms) 반환 - 표시용 변환과 필터링 양쪽에서 공유
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

// 발행 시각을 "N분전"/"N일전"/절대날짜 형태로 표시
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

  return new Date(timeMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// 이미지 URL 추출 (문자열/객체 형태 둘 다 지원, http→https 변환)
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

// 게시글 하나가 검색 조건(포함/제외/발행시각)에 맞는지 판정
function checkArticleMatch(item, filterParams) {
  if (!filterParams) return true;

  const {
    includeTags,
    includeEnabled,
    includeMatchMode,
    excludeUserTypes,
    excludeEnabled,
    dateType,
    dateStart,
    dateEnd,
    dateEnabled,
    nowAnchorMs
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

  // 포함 조건 - 태그별 카테고리(제목/키워드/매거진/작가/제목+키워드)에 맞는 필드만 매칭.
  // includeMatchMode가 'AND'면 태그를 전부 만족해야 하고, 'OR'(기본값)면 하나만 만족해도 됨.
  if (includeEnabled && Array.isArray(includeTags) && includeTags.length > 0) {
    const matchesTag = (tagItem) => {
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
    };

    const hasIncludeKeyword = includeMatchMode === 'AND'
      ? includeTags.every(matchesTag)
      : includeTags.some(matchesTag);

    if (!hasIncludeKeyword) isMatch = false;
  }

  // 제외 조건 - 유저타입/멤버십 여부로 필터링
  if (isMatch && excludeEnabled && Array.isArray(excludeUserTypes) && excludeUserTypes.length > 0) {
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
  if (isMatch && dateEnabled && dateType && dateType !== "") {
    const publishTimeMs = getPublishTimeMs(item);

    if (publishTimeMs !== null) {
      if (dateType === "24h") {
        const nowMs = nowAnchorMs || Date.now();
        const withinLast24h = (nowMs - publishTimeMs) <= 24 * 60 * 60 * 1000;
        if (!withinLast24h) isMatch = false;
      } else if (dateType === "direct" && dateStart && dateEnd) {
        const startMs = new Date(`${dateStart}T00:00:00`).getTime();
        const endMs = new Date(`${dateEnd}T23:59:59.999`).getTime();
        if (!isNaN(startMs) && !isNaN(endMs)) {
          if (publishTimeMs < startMs || publishTimeMs > endMs) isMatch = false;
        }
      }
    }
  }

  return isMatch;
}

// 게시글 목록 테이블 탐색 (커스텀 결과 테이블 및 통계 테이블 제외)
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

// 원본 페이지네이션 숨김/노출 (브레드크럼 nav는 제외)
function toggleOriginalPagination(show) {
  const paginators = document.querySelectorAll("nav, .pagination, ul.pagination");
  paginators.forEach(el => {
    if (el.closest(`#${CUSTOM_PAGINATION_ID}`)) return;

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

// 원본 게시글 행(tr)을 복제해 item 데이터로 채운 행을 생성
// (applyArticleBadgesToRow 등 뱃지 렌더링 함수는 content-badges.js에 있음)
function createRowFromItem(item, templateTr) {
  if (!templateTr) return null;
  const clonedTr = templateTr.cloneNode(true);

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

  const userId = item.userId || (item.article && item.article.userId) || '';
  const articleNo = item.articleNo || (item.article && item.article.no) || '';
  const magazineAddress = item.magazineAddress || (item.article && item.article.magazineAddress) || '';
  const magazineLink = item.magazineLink || `https://brunch.co.kr/magazine/${magazineAddress || 'undefined'}`;

  // 체크박스 name 속성 부여 (전체선택 체크박스가 이 name="data"로 대상을 찾음)
  const checkbox = clonedTr.querySelector('input[type="checkbox"]');
  if (checkbox && userId && articleNo) {
    checkbox.setAttribute('name', 'data');
    checkbox.checked = false;
  }

  // 이미지 - 실제 화면에 보일 때만 로드하도록 data-src에 보관 (goToPage에서 src로 전환)
  const imgTd = clonedTr.querySelector('td:nth-child(2)');
  if (imgTd) {
    imgTd.innerHTML = '';
    if (imgUrl) {
      const img = document.createElement('img');
      img.dataset.src = imgUrl;
      img.loading = 'lazy';
      Object.assign(img.style, {
        width: '45px', height: '45px', objectFit: 'cover',
        borderRadius: '4px', display: 'block', margin: '0 auto'
      });
      img.style.setProperty('width', '45px', 'important');
      img.style.setProperty('height', '45px', 'important');
      imgTd.appendChild(img);
    }
  }

  // 제목 & 부제목 & 발행시간
  const titleEl = clonedTr.querySelector('td.text-left > div > a, td.text-left a');
  if (titleEl) {
    titleEl.textContent = title;
    if (userId && articleNo) {
      titleEl.href = `https://brunch.co.kr/@@${userId}/${articleNo}`;
    }
  }

  applyArticleBadgesToRow(clonedTr, item, userId, articleNo);

  // "글 정보" 링크 - 새 탭에서 열리도록 설정
  const infoLink = clonedTr.querySelector('td.text-left .btn-group a.btn');
  if (infoLink && userId && articleNo) {
    infoLink.href = `/article/info?userId=${encodeURIComponent(userId)}&articleNo=${encodeURIComponent(articleNo)}`;
    infoLink.target = '_blank';
    infoLink.rel = 'noopener noreferrer';
  }

  // "블랙글 등록"/"레드글 등록" 메뉴는 원본 클론 상태 그대로(href="javascript:") 남아있어
  // 화면엔 보이지만 클릭해도 동작하지 않는다(등록 기능 자체가 삭제됨).

  // 응원 내역 조회/멤버십 전문 조회 - 클릭 가능한 <a>/<button> 대신 순수 뱃지(<span>)로 표시.
  // clonedTr은 매번 원본(templateTr)에서 새로 복제되므로 이전 렌더링의 잔여물이 남지 않는다.
  const titleBtnGroup = clonedTr.querySelector('td.text-left .btn-group');
  if (titleBtnGroup) {
    const isAllowedDonation = !!(item.isAllowedDonation || (item.article && item.article.isAllowedDonation));
    const isMembership = !!(item.isMembershipContent || item.membershipContent || (item.article && item.article.membershipContent));

    let anchorRef = titleBtnGroup;

    if (isAllowedDonation) {
      const donationSpan = document.createElement('span');
      donationSpan.className = 'label label-info';
      donationSpan.textContent = '응원 내역 조회';
      anchorRef.insertAdjacentElement('afterend', donationSpan);
      anchorRef = donationSpan;
    }

    if (isMembership) {
      const membershipSpan = document.createElement('span');
      membershipSpan.className = 'label label-success';
      membershipSpan.style.marginLeft = '4px';
      membershipSpan.textContent = '멤버십 전문 조회';
      anchorRef.insertAdjacentElement('afterend', membershipSpan);
    }
  }

  const textLeftTd = clonedTr.querySelector('td.text-left, td:nth-child(3)');
  if (textLeftTd) {
    const metaP = textLeftTd.querySelector('p.text-muted');
    if (metaP) {
      const safeSubTitle = subTitle ? subTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
      const safeTimeText = timeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      metaP.innerHTML = `${safeSubTitle}<br><small>${safeTimeText}</small>`;
    } else {
      const subTitleEl = textLeftTd.querySelector('div:not(:has(a)), span.sub-title');
      if (subTitleEl) subTitleEl.textContent = subTitle;
    }
  }

  // 셀별 데이터 및 통계 수치 반영
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
      authorInfoLink.href = `/article/list?search=userId&keyword=${encodeURIComponent(userId)}`;
      authorInfoLink.target = '_blank';
      authorInfoLink.rel = 'noopener noreferrer';
    }

    // 작가정보 드롭다운(화이트/그레이/블랙/레드리스트 등록)은 원본 클론 상태 그대로 남아
    // 클릭해도 동작하지 않는다(등록 기능 자체가 삭제됨).
    applyUserTypeBadgeToRow(clonedTr, item);
  }

  const formatNum = (val) => (val !== undefined && val !== null) ? Number(val).toLocaleString() : '0';

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
    tds[11].textContent = formatNum(item.featureTopCount);

    // 행별 액션 버튼용 td 확보 (없으면 탑리스트 td 뒤에 새로 생성)
    let actionTd = tds[12];
    if (!actionTd) {
      actionTd = document.createElement('td');
      tds[11].insertAdjacentElement('afterend', actionTd);
    }
    actionTd.textContent = '';

    setupFeatureButtons(actionTd, item, userId, articleNo);
  }

  return clonedTr;
}

// 검색 결과를 15개씩 페이지네이션하며 렌더링, 헤더 클릭 정렬 지원
function renderCustomPaginatedTable(matchedRows, originalTable) {
  const ITEMS_PER_PAGE = 15;
  let currentRows = [...matchedRows];
  const totalItems = currentRows.length;
  let totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
  let currentPage = 1;

  clearCustomResultUI();

  // 원본 id/class는 유지하고 data-attribute로만 커스텀 테이블 식별
  // (원본 id를 덮어쓰면 그 id 기준 CSS가 깨지는 문제가 있었음)
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

  const PAGE_WINDOW_SIZE = 10;

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

    const currentBlock = Math.ceil(currentPage / PAGE_WINDOW_SIZE);
    const startPage = (currentBlock - 1) * PAGE_WINDOW_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_WINDOW_SIZE - 1, totalPages);

    pagContainer.appendChild(makePageBtn("처음", 1, { disabled: currentPage === 1, isText: true }));
    if (startPage > 1) {
      pagContainer.appendChild(makePageBtn("«", startPage - PAGE_WINDOW_SIZE));
    }
    pagContainer.appendChild(makePageBtn("‹", currentPage - 1, { disabled: currentPage === 1 }));

    for (let p = startPage; p <= endPage; p++) {
      pagContainer.appendChild(makePageBtn(String(p), p, { isCurrent: p === currentPage }));
    }

    pagContainer.appendChild(makePageBtn("›", currentPage + 1, { disabled: currentPage === totalPages }));
    if (endPage < totalPages) {
      pagContainer.appendChild(makePageBtn("»", endPage + 1));
    }
    pagContainer.appendChild(makePageBtn("마지막", totalPages, { disabled: currentPage === totalPages, isText: true }));

    newTable.insertAdjacentElement("afterend", pagContainer);
  };

  // 컬럼 클릭 정렬 기능은 삭제됨 - 헤더 텍스트/값 표시는 그대로 유지되지만 클릭해도
  // 정렬되지 않는다.

  // 헤더 "전체 선택" 체크박스 - clone 과정에서 원본 바인딩이 유실되어 직접 리스너 부착.
  // 다중선택 툴바가 삭제된 상태라 순수하게 전체 선택/해제 토글만 한다.
  const bindSelectAllCheckbox = () => {
    const selectAllCheckbox = newTable.querySelector('thead tr:not(.table__toolbar-warp) input[type="checkbox"]');
    if (!selectAllCheckbox) return;
    selectAllCheckbox.addEventListener('change', () => {
      newTable.querySelectorAll('tbody input[type="checkbox"][name="data"]')
        .forEach(cb => { cb.checked = selectAllCheckbox.checked; });
    });
  };
  bindSelectAllCheckbox();

  originalTable.style.setProperty("display", "none", "important");
  originalTable.parentNode.insertBefore(newTable, originalTable.nextSibling);

  // 다중선택 툴바(PC홈추천/블랙글/레드글 등록)는 삭제됨 - 체크박스는 그대로 있지만
  // 그 위에 뜨던 액션 버튼 툴바는 더 이상 생성되지 않는다.

  goToPage(1);
}

// ══════════════════════════════════════════════════════════════════
// § 3. 검색 실행/결과 수신, 팝업(iframe) 메시지 처리
// ══════════════════════════════════════════════════════════════════

// injected.js가 수집한 원천 데이터(RES_SVELTE_PAGES) 수신 - 필터링 후 렌더링
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "RES_SVELTE_PAGES") return;
  if (event.source !== window || event.origin !== location.origin) return;

  console.log("📥 [content.js] injected.js로부터 20페이지 수집 결과 도착:", event.data.articles.length, "건");

  const articles = event.data.articles || [];
  const filterParams = event.data.filterParams;
  const usedDefaultRange = !!event.data.usedDefaultRange;
  const lookbackDays = event.data.lookbackDays;
  const fromCache = !!event.data.fromCache;

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

    articles.forEach(item => {
      if (checkArticleMatch(item, filterParams)) {
        const rowDom = createRowFromItem(item, templateTr);
        if (rowDom) {
          matchedRows.push(rowDom);
          matchedItems.push(item);
        }
      }
    });

    lastMatchedItems = matchedItems;
    lastMatchedRows = matchedRows;

    console.log(`✅ [필터링 완료] 최종 검색 일치 항목: ${matchedRows.length}개`);

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

// injected.js(메인 world)가 alert/confirm/prompt를 대신 보여달라고 요청하는 메시지 처리.
// 메인 world는 이 파일(격리 world)의 atfAlert/atfConfirm/atfPrompt를 직접 부를 수 없어서
// (서로 다른 JS 실행공간), postMessage로 요청받아 대신 모달을 띄우고 결과를 돌려준다.
window.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "ATF_MODAL_REQUEST") return;
  if (event.source !== window || event.origin !== location.origin) return;

  const { requestId, kind, message, defaultValue } = event.data;
  let value;
  if (kind === "confirm") value = await atfConfirm(message);
  else if (kind === "prompt") value = await atfPrompt(message, defaultValue);
  else value = await atfAlert(message);

  window.postMessage({ type: "ATF_MODAL_RESULT", requestId, value }, "*");
});

// injected.js의 진행 로그(SEARCH_PROGRESS)를 팝업으로 중계
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

// 팝업(iframe)에서 오는 메시지 처리 - 검색/다운로드 요청, 초기화, 드래그, 창 닫기 등
window.addEventListener("message", (event) => {
  if (!event.data || window !== window.top) return;
  if (event.origin !== ATF_EXTENSION_ORIGIN) return;

  if (event.data.type === "RESIZE_IFRAME") {
    const iframe = document.getElementById("my-extension-modal-iframe");
    if (iframe) iframe.style.height = `${event.data.height}px`;
  }

  if (event.data.type === "REQUEST_LOG_SAVE") {
    downloadAtfLogBufferAsTxt({ force: true });
  }

  if (event.data.type === "EXECUTE_SEARCH") {
    if (isSearchingProcess) return;
    isSearchingProcess = true;

    atfLogBuffer.length = 0; // 새 검색 시작 시 이전 로그 버퍼 비움

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

  if (event.data.type === "CLOSE_MODAL") {
    const iframe = document.getElementById("my-extension-modal-iframe");
    if (iframe) iframe.style.display = "none";
  }

  if (event.data.type === "REQUEST_DOWNLOAD") {
    downloadMatchedResultsXlsx();
  }
});
// xlsx 생성은 xlsx-writer.js에 분리돼 있음 - 완성된 Blob이 필요할 때 window.ATF_buildXlsxBlob()만 호출한다.

// ══════════════════════════════════════════════════════════════════
// § 4. xlsx 다운로드
// ══════════════════════════════════════════════════════════════════


// 대량 다운로드용 - 포트 연결로 진행률(done/total)을 실시간으로 받는 버전
// 다운로드 중 진행 상황(작가 N/M명)을 팝업에 실시간 스트리밍
function resolveBrunchHandlesWithProgress(items, onProgress) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (handles) => {
      if (settled) return;
      settled = true;
      resolve(handles || {});
    };

    try {
      const port = chrome.runtime.connect({ name: "resolveHandlesProgress" });
      port.onMessage.addListener((msg) => {
        if (!msg) return;
        if (msg.type === "PROGRESS" && onProgress) {
          onProgress(msg.done, msg.total);
        } else if (msg.type === "DONE") {
          finish(msg.handles);
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => finish({})); // 연결 끊김 시 빈 결과로 안전하게 마무리
      port.postMessage({ type: "RESOLVE_BRUNCH_HANDLES", items });
    } catch (e) {
      console.warn("⚠️ 브런치 실제 주소 조회(진행률) 요청 실패:", e);
      finish({});
    }
  });
}

// 검색결과 다운로드 오케스트레이션 - 작가 주소 조회, 진행상황 안내, xlsx 조립은
// xlsx-writer.js에 위임, 완성된 파일 다운로드 트리거까지 담당
async function downloadMatchedResultsXlsx() {
  const iframe = document.getElementById("my-extension-modal-iframe");
  const notifyPopup = (payload) => {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: "DOWNLOAD_RESULT", ...payload }, "*");
    }
  };
  const notifyProgress = (message) => {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: "DOWNLOAD_PROGRESS", message }, "*");
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

  // 같은 작가(userId)는 한 번만 조회
  const uniqueMap = new Map();
  baseRows.forEach(r => {
    if (r.userId && r.articleNo && !uniqueMap.has(r.userId)) {
      uniqueMap.set(r.userId, r.articleNo);
    }
  });
  const uniqueItems = Array.from(uniqueMap.entries()).map(([userId, articleNo]) => ({ userId, articleNo }));

  let handles = {};
  if (uniqueItems.length > 0) {
    notifyProgress(`📤 작가 ${uniqueItems.length}명의 실제 주소를 확인하는 중입니다... (결과가 많으면 몇 분 걸릴 수 있어요)`);
    let lastReported = -1;
    handles = await resolveBrunchHandlesWithProgress(uniqueItems, (done, total) => {
      // 10명 단위로만 갱신 (매 건마다 보내면 대량일 때 팝업이 버벅일 수 있음)
      if (done !== total && done - lastReported < 10) return;
      lastReported = done;
      notifyProgress(`📤 작가 주소 조회 중... (${done}/${total}명)`);
    });
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
  URL.revokeObjectURL(blobUrl);

  notifyPopup({ count: rows.length });
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
  const iframe = document.getElementById("my-extension-modal-iframe");
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
  const iframe = document.getElementById("my-extension-modal-iframe");
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

  const iframe = document.getElementById("my-extension-modal-iframe");
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