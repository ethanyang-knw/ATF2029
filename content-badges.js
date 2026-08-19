// content-badges.js
// 기능: 검색결과 뱃지 렌더링 + 행별 PC홈/피처링/오늘만무료 버튼 UI 생성
// (버튼은 UI만 존재하며 클릭해도 동작하지 않음 - 등록 액션 자체가 삭제된 상태)

// ══════════════════════════════════════════════════════════════════
// § 1. 뱃지 렌더링
// ══════════════════════════════════════════════════════════════════

// 제목 옆 뱃지(탑추천/PC홈추천/블랙글/레드글/오늘만무료) 렌더링 - createRowFromItem이 호출
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

// 작가 열의 유저타입 뱃지(화이트/블랙/그레이/레드유저) 렌더링 - createRowFromItem이 호출
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
// § 2. 행별 PC 홈 추천/피처링 추천/오늘만무료 추천 버튼 (UI만 - 클릭해도 동작 없음)
// ══════════════════════════════════════════════════════════════════
function setupFeatureButtons(actionTd, item, userId, articleNo) {
  if (!userId || !articleNo) return;

  const pcHomeMiniBtn = document.createElement('button');
  pcHomeMiniBtn.type = 'button';
  pcHomeMiniBtn.className = 'btn btn-warning btn-xs';
  pcHomeMiniBtn.textContent = 'PC 홈 추천';

  const featuringMiniBtn = document.createElement('button');
  featuringMiniBtn.type = 'button';
  featuringMiniBtn.className = 'btn btn-danger btn-xs';
  featuringMiniBtn.style.marginTop = '5px';
  featuringMiniBtn.textContent = '피처링 추천';

  actionTd.append(pcHomeMiniBtn, featuringMiniBtn);

  // 오늘만무료 추천 - 멤버십 전문 콘텐츠 조건일 때만 노출(뱃지 표시 조건과 동일)
  const isMembershipPromoTarget = !!(item.isMembershipContent || item.membershipContent || (item.article && item.article.membershipContent));
  if (isMembershipPromoTarget) {
    const promoMiniBtn = document.createElement('button');
    promoMiniBtn.type = 'button';
    promoMiniBtn.className = 'btn btn-success btn-xs';
    promoMiniBtn.style.marginTop = '5px';
    promoMiniBtn.textContent = '오늘만무료 추천';
    actionTd.appendChild(promoMiniBtn);
  }
}
