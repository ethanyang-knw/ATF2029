// content-actions.js
// 기능: 블랙/레드글·PC홈/피처링추천·작가리스트 등록 액션 트리거 및 검색결과 뱃지 렌더링
// content-main.js에서 유지보수 목적으로 분리됨 (같은 격리 world 공유, 전역 그대로 사용 가능)

// ══════════════════════════════════════════════════════════════════
// § 1. 뱃지 렌더링
// ══════════════════════════════════════════════════════════════════

// 제목 옆 뱃지(탑추천/PC홈추천/블랙글/레드글/오늘만무료) 렌더링
// createRowFromItem(최초 렌더링)과 refreshArticleBadge(등록 후 갱신) 양쪽에서 공용으로 사용
function applyArticleBadgesToRow(rowEl, item, userId, articleNo) {
  const titleEl = rowEl.querySelector('td.text-left > div > a, td.text-left a');
  const titleLabelSpan = rowEl.querySelector('td.text-left > div > span.label');

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

  const titleContainer = titleEl && titleEl.closest('div');
  if (titleContainer) {
    titleContainer.querySelectorAll('span.label-black:not([id]), span.label-danger:not([id]), span.label-success:not([id])').forEach(el => el.remove());
    const anchorAfter = titleLabelSpan || titleEl;
    if (anchorAfter) {
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
  }
}

// 작가 열의 유저타입 뱃지(화이트/블랙/그레이/레드유저) 렌더링
function applyUserTypeBadgeToRow(rowEl, item) {
  const tds = rowEl.querySelectorAll('td');
  if (tds.length < 6) return;
  const authorTd = tds[5];
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

// ══════════════════════════════════════════════════════════════════
// § 2. 행 생성 시 액션 링크/버튼 셋업 (createRowFromItem이 호출)
// ══════════════════════════════════════════════════════════════════

// "블랙글 등록"/"레드글 등록" 메뉴 셋업 - 원본 href가 죽어있어 data 속성 부여 후 이벤트 위임으로 처리
function setupBlackRedLinks(clonedTr, userId, articleNo) {
  if (!userId || !articleNo) return;
  const registerLinks = [...clonedTr.querySelectorAll('td.text-left .dropdown-menu a')]
    .filter(a => a.textContent.trim() === '블랙글 등록' || a.textContent.trim() === '레드글 등록');
  registerLinks.forEach(a => {
    const type = a.textContent.trim() === '블랙글 등록' ? 'black' : 'red';
    a.removeAttribute('href');
    a.style.cursor = 'pointer';
    a.dataset.atfBlackredType = type;
  });
}

// "작가 정보" 드롭다운의 그레이/블랙/레드리스트 등록 + 화이트리스트 등록/수정 메뉴 셋업
function setupManagedUserLinks(authorTd, userId, articleNo, profileId) {
  if (!userId) return;

  const restrictLinks = [...authorTd.querySelectorAll('.dropdown-menu a')]
    .filter(a => ['그레이리스트 등록', '블랙리스트 등록', '레드리스트 등록'].includes(a.textContent.trim()));
  restrictLinks.forEach(a => {
    const text = a.textContent.trim();
    const type = text === '그레이리스트 등록' ? 'gray' : (text === '블랙리스트 등록' ? 'black' : 'red');
    a.removeAttribute('href');
    a.style.cursor = 'pointer';
    a.dataset.atfManagedUserType = type;
    a.dataset.userId = userId;
    if (articleNo) a.dataset.articleNo = articleNo;
    if (profileId) a.dataset.profileId = profileId;
  });

  const whiteLink = [...authorTd.querySelectorAll('.dropdown-menu a')]
    .find(a => a.textContent.trim() === '화이트리스트 등록 / 수정');
  if (whiteLink) {
    whiteLink.removeAttribute('href');
    whiteLink.style.cursor = 'pointer';
    whiteLink.dataset.atfWhiteUserId = userId;
  }
}

// 행별 PC 홈 추천/피처링 추천/오늘만무료 추천 버튼 생성
function setupFeatureButtons(actionTd, item, userId, articleNo) {
  if (!userId || !articleNo) return;

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

  // 오늘만무료 추천 - 멤버십 전문 콘텐츠 조건일 때만 노출. 실제 등록 기능은 종료되어 UI만 존재
  const isMembershipPromoTarget = !!(item.isMembershipContent || item.membershipContent || (item.article && item.article.membershipContent));
  if (isMembershipPromoTarget) {
    const promoMiniBtn = document.createElement('button');
    promoMiniBtn.type = 'button';
    promoMiniBtn.className = 'btn btn-success btn-xs';
    promoMiniBtn.style.marginTop = '5px';
    promoMiniBtn.textContent = '오늘만무료 추천';
    promoMiniBtn.title = '2026년 7월 7일 "오늘만무료 추천" 종료';
    promoMiniBtn.dataset.atfPromoPlaceholder = '1';
    actionTd.appendChild(promoMiniBtn);
  }
}

// ══════════════════════════════════════════════════════════════════
// § 3. 등록 후 뱃지 갱신 (전체 재검색 없이 그 글 하나만 재조회)
// ══════════════════════════════════════════════════════════════════
// 피드백: 예전엔 작가 리스트 등록 성공 시 전체 새로고침으로 뱃지를 갱신했는데,
// 원본 사이트 자체는 새로고침하지 않는다는 게 확인되어 이 방식으로 교체
const ARTICLE_REFRESH_DELAY_MS = 2500; // 서버 반영 시간을 감안한 지연

function refreshArticleBadge({ userId, articleNo, profileId }) {
  if (!userId || !articleNo || !profileId) return;

  setTimeout(() => {
    const requestId = `${userId}-${articleNo}-${Date.now()}`;

    const handler = (event) => {
      // 피드백: origin/source 검증 누락으로 위조된 응답을 받아들일 수 있던 취약점 → 검증 추가
      if (event.source !== window || event.origin !== location.origin) return;
      if (!event.data || event.data.type !== "REFRESH_ARTICLE_RESULT") return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener("message", handler);

      const freshArticle = event.data.article;
      if (!freshArticle) return;

      const idx = lastMatchedItems.findIndex((it) =>
        (it.userId || (it.article && it.article.userId)) === userId &&
        String(it.articleNo || (it.article && it.article.no)) === String(articleNo)
      );
      if (idx === -1) return;

      Object.assign(lastMatchedItems[idx], freshArticle);
      const updatedItem = lastMatchedItems[idx];

      // 오프 DOM 마스터 행 갱신 (다음 페이지 이동 시에도 정확히 보이도록)
      const masterRow = lastMatchedRows[idx];
      if (masterRow) {
        applyArticleBadgesToRow(masterRow, updatedItem, userId, articleNo);
        applyUserTypeBadgeToRow(masterRow, updatedItem);
      }

      // 지금 화면에 보이는 행도 즉시 갱신
      const liveCheckbox = document.querySelector(
        `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[name="data"][user="${CSS.escape(userId)}"][articleno="${CSS.escape(String(articleNo))}"]`
      );
      const liveRow = liveCheckbox && liveCheckbox.closest("tr");
      if (liveRow && liveRow !== masterRow) {
        applyArticleBadgesToRow(liveRow, updatedItem, userId, articleNo);
        applyUserTypeBadgeToRow(liveRow, updatedItem);
      }
    };
    window.addEventListener("message", handler);
    window.postMessage({ type: "REQUEST_REFRESH_ARTICLE", requestId, profileId, articleNo }, "*");
  }, ARTICLE_REFRESH_DELAY_MS);
}

// ══════════════════════════════════════════════════════════════════
// § 4. 다중선택 툴바 (체크박스 선택 시 노출되는 PC홈추천/블랙글/레드글 등록)
// ══════════════════════════════════════════════════════════════════
let blackRedToolbar = null;

// 툴바 DOM 최초 생성 (버튼 스타일은 원본 사이트 클래스 그대로 사용)
function ensureBlackRedToolbar() {
  if (blackRedToolbar) return blackRedToolbar;

  blackRedToolbar = document.createElement('div');
  blackRedToolbar.id = 'atf-blackred-toolbar';
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
  blackBtn.addEventListener('click', () => triggerBlackRedRegisterAndRefresh('black'));

  const redBtn = makeBtn('R_레드글 등록');
  redBtn.addEventListener('click', () => triggerBlackRedRegisterAndRefresh('red'));

  btnGroup.append(blackBtn, redBtn);
  blackRedToolbar.append(cancelBtn, countLabel, pcHomeBtn, btnGroup);
  document.body.appendChild(blackRedToolbar);
  return blackRedToolbar;
}

// 체크된 개수에 따라 툴바 표시/숨김 갱신
function updateBlackRedToolbar() {
  const toolbar = ensureBlackRedToolbar();
  const checkedCount = document.querySelectorAll(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`).length;
  const countLabel = document.getElementById('atf-blackred-count');
  if (countLabel) countLabel.textContent = String(checkedCount);
  toolbar.style.display = checkedCount > 0 ? 'flex' : 'none';

  const toolbarSlot = toolbar.parentElement;
  if (toolbarSlot && toolbarSlot.classList.contains('table__toolbar')) {
    Array.from(toolbarSlot.children).forEach(child => {
      if (child !== toolbar) {
        child.style.setProperty('display', checkedCount > 0 ? 'none' : '', checkedCount > 0 ? 'important' : '');
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// § 5. 트리거 함수들
// ══════════════════════════════════════════════════════════════════

// 다중선택 PC 홈 추천 - 이미 탑추천인 글이 섞여있으면 사전 차단 후 일괄 등록
async function triggerPcHomeRecommend() {
  document.querySelectorAll('input[type="checkbox"][name="data"]:checked').forEach(cb => {
    if (!cb.closest(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"]`)) cb.checked = false;
  });

  const checkedBoxes = [...document.querySelectorAll(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`
  )];
  if (checkedBoxes.length === 0) return;

  const ids = checkedBoxes.map(cb => ({
    userId: cb.getAttribute('user'),
    articleNo: cb.getAttribute('articleno'),
    profileId: cb.getAttribute('profileid')
  }));

  const hasAlreadyTop = ids.some(({ userId, articleNo }) => {
    const item = lastMatchedItems.find(it => it.userId === userId && it.articleNo === articleNo);
    return !!(item && item.featureData && item.featureData.type === 'top');
  });
  if (hasAlreadyTop) {
    await atfAlert('탑 추천글은 PC 홈 추천글로 변경할 수 없습니다.');
    return;
  }

  const contentIdList = ids.map(({ userId, articleNo }) => `${userId}-${articleNo}`);
  triggerAddFeatureDataBatch('channel', contentIdList);

  ids.forEach(refreshArticleBadge);
}

// PC 홈 추천/피처링 추천 일괄 처리 - adminB.article.addFeatureDataCallback에 위임
function triggerAddFeatureDataBatch(type, contentIdList) {
  if (!contentIdList || contentIdList.length === 0) return;
  window.postMessage({ type: 'TRIGGER_ADD_FEATURE_DATA_BATCH', regType: type, contentIdList, nonce: window.__ATF_NONCE__ }, '*');
}

// PC 홈 추천/피처링 추천 단건 처리 - adminB.article.addFeatureData에 위임
function triggerAddFeatureData(type, articleNo, userId) {
  if (!articleNo || !userId) return;
  window.postMessage({ type: 'TRIGGER_ADD_FEATURE_DATA', regType: type, articleNo, userId, nonce: window.__ATF_NONCE__ }, '*');
}

// 블랙/레드글 등록 - adminB.article.addBlackRedArticle 인자 없이 호출 위임
function triggerBlackRedRegister(type) {
  // 검색결과 밖에 체크된 게 남아있으면 같이 등록될 수 있어 사전 해제
  document.querySelectorAll('input[type="checkbox"][name="data"]:checked').forEach(cb => {
    if (!cb.closest(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"]`)) {
      cb.checked = false;
    }
  });

  window.postMessage({ type: 'TRIGGER_BLACK_RED_REGISTER', regType: type, nonce: window.__ATF_NONCE__ }, '*');
}

// 다중선택 블랙/레드글 등록 + 각 대상별 뱃지 갱신 예약
function triggerBlackRedRegisterAndRefresh(type) {
  const checkedBoxes = [...document.querySelectorAll(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]:checked`
  )];
  const targets = checkedBoxes.map(cb => ({
    userId: cb.getAttribute('user'),
    articleNo: cb.getAttribute('articleno'),
    profileId: cb.getAttribute('profileid')
  }));

  triggerBlackRedRegister(type);

  targets.forEach(refreshArticleBadge);
}

// 작가 화이트/그레이/블랙/레드리스트 등록 - 전역 함수가 없어 실제 요청을 fetch로 재현
// 피드백: 기존엔 확인 절차 없이 즉시 POST → 대상/유형을 명시한 confirm 추가, 불필요한 Content-Type 헤더 제거
async function triggerAddManagedUser(type, userId, articleNo, profileId) {
  if (!userId) return;
  const typeLabel = { gray: '그레이리스트', black: '블랙리스트', red: '레드리스트' }[type] || type;
  const comment = await atfPrompt(`${typeLabel}로 등록할 사유를 입력해 주세요.`);
  if (comment === null) return;
  const trimmedComment = comment.trim();
  if (!trimmedComment) {
    await atfAlert('사유를 입력해 주세요.');
    return;
  }

  const confirmed = await atfConfirm(`작가 [${userId}] 를 ${typeLabel}에 등록합니다.\n사유: ${trimmedComment}\n\n진행할까요?`);
  if (!confirmed) {
    return;
  }

  const params = new URLSearchParams({ type, userId, innerComment: trimmedComment });
  try {
    const res = await fetch(`/user/addManagedUser.json?${params.toString()}`, {
      method: 'POST',
      credentials: 'same-origin'
    });
    if (!res.ok) {
      await atfAlert(res.status === 401 ? '권한이 없습니다.' : '오류가 발생하였습니다.');
      return;
    }
    const result = await res.json();
    if (result && result.success && !result.error) {
      await atfAlert(`${typeLabel}로 등록되었습니다.`);
      refreshArticleBadge({ userId, articleNo, profileId });
    } else {
      await atfAlert((result && result.errorMessage) || '오류가 발생하였습니다.');
    }
  } catch (err) {
    console.error('❌ [작가 리스트 등록] 요청 실패:', err);
    await atfAlert('요청 중 오류가 발생했습니다.');
  }
}

// ══════════════════════════════════════════════════════════════════
// § 6. 이벤트 위임 (체크박스 change + 클릭)
// ══════════════════════════════════════════════════════════════════
// 페이지네이션 시 행이 복제되며 개별 리스너가 유실되므로 문서 레벨 위임으로 처리
document.addEventListener('change', (e) => {
  if (e.target && e.target.matches(`[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] input[type="checkbox"][name="data"]`)) {
    updateBlackRedToolbar();
  }
});

// 행별 액션 버튼/링크 클릭 처리 (멤버십 전문 조회는 성격이 달라 content-main.js에 별도 존재)
document.addEventListener('click', (e) => {
  const featureBtn = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] [data-atf-feature-type]`
  );
  if (featureBtn) {
    const { atfFeatureType: type, userId, articleNo } = featureBtn.dataset;
    triggerAddFeatureData(type, articleNo, userId);
    const row = featureBtn.closest('tr');
    const rowCheckbox = row && row.querySelector('input[type="checkbox"][name="data"]');
    refreshArticleBadge({
      userId,
      articleNo,
      profileId: rowCheckbox ? rowCheckbox.getAttribute('profileid') : null
    });
    return;
  }

  const promoBtn = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] [data-atf-promo-placeholder]`
  );
  if (promoBtn) {
    atfAlert('2026년 7월 7일 "오늘만무료 추천" 종료');
    return;
  }

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
    refreshArticleBadge({
      userId: rowCheckbox.getAttribute('user'),
      articleNo: rowCheckbox.getAttribute('articleno'),
      profileId: rowCheckbox.getAttribute('profileid')
    });
    return;
  }

  const managedUserLink = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a[data-atf-managed-user-type]`
  );
  if (managedUserLink) {
    e.preventDefault();
    const { atfManagedUserType: type, userId, articleNo, profileId } = managedUserLink.dataset;
    triggerAddManagedUser(type, userId, articleNo, profileId);
    return;
  }

  const whiteLink = e.target && e.target.closest(
    `[${CUSTOM_RESULT_ATTR}="${CUSTOM_RESULT_TABLE_ID}"] a[data-atf-white-user-id]`
  );
  if (whiteLink) {
    e.preventDefault();
    const userId = whiteLink.dataset.atfWhiteUserId;
    window.postMessage({ type: 'TRIGGER_WHITE_MODAL', userId, nonce: window.__ATF_NONCE__ }, '*');
  }
});