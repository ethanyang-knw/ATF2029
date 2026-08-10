// content-globals.js
// 여러 content-*.js 파일이 공유하는 전역 상태/상수. 항상 다른 content-*.js보다 먼저 로드되어야 한다.
// (단, txt 로그 저장을 담당하는 console-log.js는 이 파일보다도 더 먼저 로드되어야 함 -
//  이 파일 자신이 찍는 "🟢 로드 완료" 로그까지 놓치지 않고 캡처하기 위해서)
// content.js
console.log("🟢 [ATF2029] content.js 로드 완료 (Frame ID:", window.name || "current", ")");

let lastUrl = location.href;
const CUSTOM_RESULT_TABLE_ID = "atf-custom-result-container"; // 값 자체는 유지하되, 아래처럼 id가 아닌 data-attribute로 사용
const CUSTOM_RESULT_ATTR = "data-atf-role"; // 🔧 원본 테이블의 id/class를 덮어쓰지 않기 위해 별도 속성으로 식별
let lastMatchedItems = []; // 🔧 다운로드 기능에서 사용할 최근 검색 결과(원본 데이터) 보관
const CUSTOM_PAGINATION_ID = "atf-custom-pagination-container";
let isSearchingProcess = false;

// 🔐 postMessage 발신처 검증용. content.js↔injected.js는 같은 창(window)에서 오가므로
//    event.origin이 페이지 자신의 origin과 같아야 하고, content.js↔popup(iframe)은
//    우리 확장 자신의 chrome-extension:// origin에서 와야 한다. 이 두 origin이 아닌
//    메시지(예: 페이지 내 다른 iframe/스크립트가 위조해서 보낸 메시지)는 전부 무시한다.
const ATF_EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);

// 정렬 상태 관리 객체 (컬럼별 오름차순/내림차순 토글)
const currentSortState = {
  column: null,
  asc: false // 기본 내림차순(높은순)
};

// 📝 액션 이력(감사 로그) - 블랙/레드글 등록, PC 홈 추천, 작가 리스트 등록처럼 되돌리기 어려운
//    액션을 실행할 때마다 chrome.storage.local에 기록해서, 나중에 "언제 뭘 했는지" 팝업의
//    "이력" 버튼으로 다시 확인할 수 있게 한다. 콘솔 로그와 달리 새로고침/탭 종료와 무관하게 남는다.
//    최근 ATF_LOG_MAX_ENTRIES건만 유지 - 무한정 쌓이지 않도록 오래된 것부터 자동 삭제.
const ATF_LOG_STORAGE_KEY = "atf_action_log";
const ATF_LOG_MAX_ENTRIES = 300;

// 🖨️ storage 기록과 별개로, 지금 이 순간 콘솔에서 바로 확인할 수 있는 통일된 포맷 한 줄도 남긴다.
//    확인창(confirm)이 뜨기 직전에 호출되므로, "정말 이 대상이 맞는지" F12 콘솔로 한 번 더
//    확인하고 싶을 때 쓸 수 있다. blackred/PC홈추천처럼 confirm 이전(=아직 서버 확정 전) 시점에
//    기록하는 액션은 [시도]로, managedUser처럼 서버 성공 응답을 받은 뒤에만 기록하는 액션은
//    [성공]으로 - 실제로 확정됐는지 여부를 라벨에서도 정직하게 구분한다.
const ATF_LOG_ACTION_LABELS = {
  black: "블랙글 등록",
  red: "레드글 등록",
  pcHome: "PC 홈 추천",
  featuring: "피처링 추천",
  managedUser: "작가 리스트 등록",
  whiteOpen: "화이트 모달 오픈"
};
const ATF_LOG_STATUS_LABELS = {
  black: "시도", red: "시도", pcHome: "시도", featuring: "시도",
  managedUser: "성공", whiteOpen: "오픈"
};

function formatLogConsoleLine(entry) {
  const label = ATF_LOG_ACTION_LABELS[entry.action] || entry.action;
  const status = ATF_LOG_STATUS_LABELS[entry.action] || "";

  let detail;
  if (Array.isArray(entry.targets) && entry.targets.length > 0) {
    // 🔧 예: 대상 5건: [제목1(작가1), 제목2(작가2), ...]
    const list = entry.targets.map(t => {
      if (typeof t === "string") return t;
      const title = t.title || t.articleNo || "";
      const author = t.userId || "";
      return author ? `${title}(${author})` : title;
    }).join(", ");
    detail = `대상 ${entry.count ?? entry.targets.length}건: [${list}]`;
  } else {
    const parts = [];
    if (entry.userId) parts.push(`userId=${entry.userId}`);
    if (entry.articleNo) parts.push(`articleNo=${entry.articleNo}`);
    if (entry.title) parts.push(`제목=${entry.title}`);
    if (entry.type) parts.push(`type=${entry.type}`);
    if (entry.comment) parts.push(`사유=${entry.comment}`);
    if (entry.note) parts.push(entry.note);
    detail = parts.join(" ");
  }

  const at = entry.at.replace("T", " ").slice(0, 19); // "2026-08-07 14:32:10" 형태로 축약
  return `🔒 [ATF2029][액션][${label}][${status}] ${detail} at=${at}`;
}

function logAction(action, detail) {
  const entry = {
    at: new Date().toISOString(),
    action,       // 'black' | 'red' | 'pcHome' | 'featuring' | 'managedUser' | 'whiteOpen' 등
    ...detail      // { userId, articleNo, title, type, count, ... } - 액션마다 다른 부가정보
  };

  // 🔧 storage 저장이 실패하거나(권한 없음 등) 비동기로 늦게 처리되더라도,
  //    콘솔 출력만큼은 항상 즉시 - confirm 창 뜨기 전에 바로 눈으로 확인 가능해야 하므로
  console.log(formatLogConsoleLine(entry));

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;

  try {
    chrome.storage.local.get(ATF_LOG_STORAGE_KEY, (result) => {
      const list = (result && Array.isArray(result[ATF_LOG_STORAGE_KEY])) ? result[ATF_LOG_STORAGE_KEY] : [];
      list.push(entry);
      // 🔧 앞에서부터(오래된 것부터) 잘라내 최근 N건만 유지
      const trimmed = list.length > ATF_LOG_MAX_ENTRIES ? list.slice(list.length - ATF_LOG_MAX_ENTRIES) : list;
      chrome.storage.local.set({ [ATF_LOG_STORAGE_KEY]: trimmed });
    });
  } catch (e) {
    console.error("❌ [content] 액션 이력 저장 실패:", e);
  }
}
