// content-main.js
// 기능: 검색 팝업/모달 생성, 검색 결과 필터링·렌더링, 검색 실행·다운로드·xlsx 생성,
// 팝업 드래그, "멤버십 전문 조회" 클릭 처리
// (블랙/레드글 등 액션 트리거와 뱃지 렌더링은 content-actions.js로 분리됨)

const ATF_CONFIG = {
  // 피드백: 멤버십 전문 조회 링크가 개발서버 도메인+특정 작가 핸들로 하드코딩되어 있던 문제
  // → 실사용 확인 결과 도메인 자체는 정상 사용처였고, 문제는 핸들 하드코딩이었음(클릭 시점에
  // background.js로 실제 필명을 조회해 채우도록 §6에서 처리)
  MEMBERSHIP_VIEW_ENABLED: true,
  MEMBERSHIP_VIEW_ORIGIN: "https://cbt-brunch.dev.onkakao.net",
};

// ══════════════════════════════════════════════════════════════════
// § 1. 초기화 (모달/버튼 생성, injected.js 주입, SPA 재초기화 진입점)
// ══════════════════════════════════════════════════════════════════

// 메인 world 스크립트(injected.js + console-log.js) 동적 주입
// 피드백: console-log.js의 postMessage 중계에 origin 위조 방지가 필요해서 nonce 방식 도입
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
    scriptMain.dataset.atfNonce = nonce; // 피드백: injected.js가 위임받는 등록 액션에도 nonce 검증 추가
    scriptMain.addEventListener("load", () => {
      scriptMain.removeAttribute("data-atf-nonce");
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

// 헤더 클릭 정렬용 값 추출 - createRowFromItem의 dataset과 동일 기준
function getSortValue(item, key) {
  if (key === 'whiteList') return (item.managedUserType === 'white') ? 1 : 0;
  return Number(item[key]) || 0;
}

// 원본 게시글 행(tr)을 복제해 item 데이터로 채운 행을 생성
// (applyArticleBadgesToRow 등 뱃지/액션 셋업 함수는 content-actions.js에 있음)
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
  const profileId = item.profileId || (item.article && item.article.profileId) || '';
  const magazineAddress = item.magazineAddress || (item.article && item.article.magazineAddress) || '';
  const magazineLink = item.magazineLink || `https://brunch.co.kr/magazine/${magazineAddress || 'undefined'}`;

  // 체크박스 user/articleno 속성을 이 게시글 기준으로 갱신
  // 피드백: 갱신 안 하면 원본 함수가 템플릿 게시글 정보로 등록하는 사고로 이어질 수 있었음
  const checkbox = clonedTr.querySelector('input[type="checkbox"]');
  if (checkbox && userId && articleNo) {
    checkbox.setAttribute('name', 'data');
    checkbox.setAttribute('user', userId);
    checkbox.setAttribute('articleno', articleNo);
    if (profileId) checkbox.setAttribute('profileid', profileId);
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

  setupBlackRedLinks(clonedTr, userId, articleNo);

  // 응원 내역 조회 / 멤버십 전문 조회 링크 (조건부 표시)
  const titleBtnGroup = clonedTr.querySelector('td.text-left .btn-group');
  if (titleBtnGroup) {
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
      donationA.href = `/donationCommentPayment/list?userId=${encodeURIComponent(userId)}&articleNo=${encodeURIComponent(articleNo)}`;
      donationA.innerHTML = `<span class="label label-info">응원 내역 조회</span>`;
      anchorRef.insertAdjacentElement('afterend', donationA);
      anchorRef = donationA;
    }

    // 멤버십 전문 조회 - 클릭 시점에 실제 필명을 조회해 URL을 완성 (§6에서 클릭 처리)
    if (ATF_CONFIG.MEMBERSHIP_VIEW_ENABLED && isMembership && userId && articleNo) {
      const membershipBtn = document.createElement('button');
      membershipBtn.type = 'button';
      membershipBtn.dataset.atfMembershipUserId = userId;
      membershipBtn.dataset.atfMembershipArticleNo = articleNo;
      const span = document.createElement('span');
      span.className = 'label label-success';
      span.style.cursor = 'pointer';
      span.textContent = '멤버십 전문 조회';
      membershipBtn.style.cssText = 'background:none;border:none;padding:0;margin-left:4px;';
      membershipBtn.appendChild(span);
      anchorRef.insertAdjacentElement('afterend', membershipBtn);
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

    setupManagedUserLinks(authorTd, userId, articleNo, profileId);
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
function renderCustomPaginatedTable(matchedRows, originalTable, matchedItems) {
  const ITEMS_PER_PAGE = 15;
  let currentRows = [...matchedRows];
  let currentItems = [...(matchedItems || [])];
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

  // 헤더 클릭 정렬 - DOM dataset 대신 원본 데이터(currentItems) 기준으로 정렬
  const bindHeaderSortEvents = () => {
    const ths = newTable.querySelectorAll("thead th");

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

          if (currentSortState.column === matchedKey) {
            currentSortState.asc = !currentSortState.asc;
          } else {
            currentSortState.column = matchedKey;
            currentSortState.asc = false;
          }

          console.log(`📊 [정렬 실행] 컬럼: ${matchedKey}, 오름차순: ${currentSortState.asc}`);

          const paired = currentRows.map((row, i) => [row, currentItems[i]]);
          paired.sort((a, b) => {
            const valA = getSortValue(a[1] || {}, matchedKey);
            const valB = getSortValue(b[1] || {}, matchedKey);
            return currentSortState.asc ? valA - valB : valB - valA;
          });
          currentRows = paired.map(p => p[0]);
          currentItems = paired.map(p => p[1]);

          goToPage(1);
        });
      }
    });
  };

  bindHeaderSortEvents();

  // 헤더 "전체 선택" 체크박스 - clone 과정에서 원본 바인딩이 유실되어 직접 리스너 부착
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

  // 블랙/레드 툴바를 원본의 "발행글 리스트" 툴바 슬롯에 배치
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

    renderCustomPaginatedTable(matchedRows, originalTable, matchedItems);
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
    downloadMatchedResultsCSV();
  }
});

// ══════════════════════════════════════════════════════════════════
// § 3-1. xlsx 생성 유틸 (예전엔 xlsx-writer.js로 분리돼 있었으나 파일 수를 줄이기 위해 통합)
// ══════════════════════════════════════════════════════════════════
// 외부 라이브러리 없이 순수 JS로 ZIP+OOXML을 직접 구현해 xlsx 파일 생성
// window.ATF_buildXlsxBlob(sheetName, columns, dataRows) => Blob
(function () {
  // CRC32 (ZIP 포맷 필수)
  const CRC_TABLE = (() => {
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // 압축 없는 STORED 방식 ZIP 작성기
  function writeUint32LE(arr, offset, val) {
    arr[offset] = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
    arr[offset + 2] = (val >>> 16) & 0xFF;
    arr[offset + 3] = (val >>> 24) & 0xFF;
  }
  function writeUint16LE(arr, offset, val) {
    arr[offset] = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      writeUint32LE(localHeader, 0, 0x04034b50);
      writeUint16LE(localHeader, 4, 20);
      writeUint16LE(localHeader, 6, 0);
      writeUint16LE(localHeader, 8, 0);
      writeUint16LE(localHeader, 10, 0);
      writeUint16LE(localHeader, 12, 0x21);
      writeUint32LE(localHeader, 14, crc);
      writeUint32LE(localHeader, 18, data.length);
      writeUint32LE(localHeader, 22, data.length);
      writeUint16LE(localHeader, 26, nameBytes.length);
      writeUint16LE(localHeader, 28, 0);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      writeUint32LE(centralHeader, 0, 0x02014b50);
      writeUint16LE(centralHeader, 4, 20);
      writeUint16LE(centralHeader, 6, 20);
      writeUint16LE(centralHeader, 8, 0);
      writeUint16LE(centralHeader, 10, 0);
      writeUint16LE(centralHeader, 12, 0);
      writeUint16LE(centralHeader, 14, 0x21);
      writeUint32LE(centralHeader, 16, crc);
      writeUint32LE(centralHeader, 20, data.length);
      writeUint32LE(centralHeader, 24, data.length);
      writeUint16LE(centralHeader, 28, nameBytes.length);
      writeUint16LE(centralHeader, 30, 0);
      writeUint16LE(centralHeader, 32, 0);
      writeUint16LE(centralHeader, 34, 0);
      writeUint16LE(centralHeader, 36, 0);
      writeUint32LE(centralHeader, 38, 0);
      writeUint32LE(centralHeader, 42, offset);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    });

    const centralDirOffset = offset;
    let centralDirSize = 0;
    centralParts.forEach(p => { centralDirSize += p.length; });

    const eocd = new Uint8Array(22);
    writeUint32LE(eocd, 0, 0x06054b50);
    writeUint16LE(eocd, 4, 0);
    writeUint16LE(eocd, 6, 0);
    writeUint16LE(eocd, 8, files.length);
    writeUint16LE(eocd, 10, files.length);
    writeUint32LE(eocd, 12, centralDirSize);
    writeUint32LE(eocd, 16, centralDirOffset);
    writeUint16LE(eocd, 20, 0);

    const totalSize = offset + centralDirSize + eocd.length;
    const result = new Uint8Array(totalSize);
    let pos = 0;
    localParts.forEach(p => { result.set(p, pos); pos += p.length; });
    centralParts.forEach(p => { result.set(p, pos); pos += p.length; });
    result.set(eocd, pos);

    return result;
  }

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  // 엑셀 열 문자(A~Z, AA, AB...) 계산 - 컬럼 수 제한 없이 정확한 열 문자 생성
  function colIndexToLetters(index) {
    let n = index + 1;
    let result = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  // 문자열 표시 너비 계산 (한글/한자 등 2바이트 문자는 넓게 취급)
  function visualWidth(str) {
    let width = 0;
    for (const ch of String(str ?? '')) {
      width += ch.charCodeAt(0) > 0x2E80 ? 1.9 : 1;
    }
    return width;
  }

  // 최소 유효한 xlsx 구성(OOXML) 생성
  function buildXlsxBlob(sheetName, columns, dataRows) {
    const encoder = new TextEncoder();

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

    // 스타일: 0=기본, 1=헤더(굵게+배경+가운데), 2=가운데정렬, 3=하이퍼링크
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE9AE"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const STYLE_HEADER = 1;
    const STYLE_CENTER = 2;
    const STYLE_HYPERLINK = 3;

    const styleForColumn = (col) => {
      if (col.hyperlink) return STYLE_HYPERLINK;
      if (col.align === 'center') return STYLE_CENTER;
      return 0;
    };

    const cellXml = (colIndex, rowIndex, value, styleIdx, isNumeric) => {
      const ref = `${colIndexToLetters(colIndex)}${rowIndex}`;
      const s = styleIdx ? ` s="${styleIdx}"` : '';
      if (isNumeric && value !== '' && value !== null && !isNaN(Number(value))) {
        return `<c r="${ref}"${s}><v>${Number(value)}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    };

    const HEADER_ROW_HEIGHT = 20;
    const DATA_ROW_HEIGHT = 20;

    const rowsXml = [];
    rowsXml.push(
      `<row r="1" ht="${HEADER_ROW_HEIGHT}" customHeight="1">${columns.map((col, i) => cellXml(i, 1, col.header, STYLE_HEADER, false)).join('')}</row>`
    );

    const hyperlinkRels = [];
    const hyperlinkRefs = [];

    dataRows.forEach((row, rIdx) => {
      const rowNum = rIdx + 2;
      const cells = columns.map((col, cIdx) => {
        const value = row[cIdx];
        const styleIdx = styleForColumn(col);

        if (col.hyperlink && value) {
          const rId = `rIdLink${hyperlinkRels.length + 1}`;
          hyperlinkRels.push({ id: rId, target: value });
          hyperlinkRefs.push({ ref: `${colIndexToLetters(cIdx)}${rowNum}`, rId });
        }

        return cellXml(cIdx, rowNum, value, styleIdx, !!col.numeric);
      });
      rowsXml.push(`<row r="${rowNum}" ht="${DATA_ROW_HEIGHT}" customHeight="1">${cells.join('')}</row>`);
    });

    // 자동 열 너비 (헤더+데이터 중 최대 표시너비, widthCap 상한)
    const colsXml = columns.map((col, i) => {
      let maxW = visualWidth(col.header);
      dataRows.forEach(row => {
        const w = visualWidth(row[i]);
        if (w > maxW) maxW = w;
      });
      const cap = col.widthCap || 60;
      const width = Math.max(8, Math.min(Math.ceil(maxW) + 3, cap));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    }).join('');

    const hyperlinksXml = hyperlinkRefs.length
      ? `<hyperlinks>${hyperlinkRefs.map(h => `<hyperlink ref="${h.ref}" r:id="${h.rId}"/>`).join('')}</hyperlinks>`
      : '';

    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<cols>${colsXml}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
${hyperlinksXml}
</worksheet>`;

    const files = [
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
      { name: '_rels/.rels', data: encoder.encode(rootRels) },
      { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
      { name: 'xl/styles.xml', data: encoder.encode(styles) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet1) }
    ];

    if (hyperlinkRels.length > 0) {
      const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hyperlinkRels.map(h => `<Relationship Id="${h.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(h.target)}" TargetMode="External"/>`).join('\n')}
</Relationships>`;
      files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: encoder.encode(sheetRels) });
    }

    const zipBytes = buildZip(files);
    return new Blob([zipBytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  window.ATF_buildXlsxBlob = buildXlsxBlob;
})();

// ══════════════════════════════════════════════════════════════════
// § 4. xlsx 다운로드
// ══════════════════════════════════════════════════════════════════

// background.js에 브런치 실제 주소(vanity handle) 단건 조회 요청 (멤버십 전문 조회용)
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

// 대량 다운로드용 - 포트 연결로 진행률(done/total)을 실시간으로 받는 버전
// 피드백: 다운로드 중 화면에 아무 표시가 없어 "멈춘 건가" 오해하기 쉬웠음 → 진행 상황 스트리밍 추가
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

// 검색 결과 다운로드 (제목/URL/작가명 xlsx)
async function downloadMatchedResultsCSV() {
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
// § 6. "멤버십 전문 조회" 버튼 클릭 처리
// (나머지 액션 트리거·뱃지 렌더링은 content-actions.js 참고 - 이건 조회 후 새 탭 이동이라 성격이 달라 여기 유지)
// ══════════════════════════════════════════════════════════════════
document.addEventListener('click', (e) => {
  const membershipBtn = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] [data-atf-membership-article-no]`
  );
  if (!membershipBtn) return;
  if (membershipBtn.disabled) return;
  const { atfMembershipUserId: userId, atfMembershipArticleNo: articleNo } = membershipBtn.dataset;
  membershipBtn.disabled = true;
  const labelSpan = membershipBtn.querySelector('span');
  const originalText = labelSpan ? labelSpan.textContent : '';
  if (labelSpan) labelSpan.textContent = '조회 중...';
  resolveBrunchHandles([{ userId, articleNo }])
    .then((handles) => {
      const handle = handles && handles[userId];
      if (!handle) {
        atfAlert('작가의 공개 주소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const url = `${ATF_CONFIG.MEMBERSHIP_VIEW_ORIGIN}/@${encodeURIComponent(handle)}/${encodeURIComponent(articleNo)}/html?who=brunchCloud`;
      window.open(url, '_blank', 'noopener,noreferrer');
    })
    .finally(() => {
      membershipBtn.disabled = false;
      if (labelSpan) labelSpan.textContent = originalText;
    });
});
