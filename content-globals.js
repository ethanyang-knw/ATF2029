// content-globals.js
// 기능: 격리 world 전역 상태/상수 (다른 content-*.js보다 먼저 로드)

console.log("🟢 [ATF2029] content.js 로드 완료 (Frame ID:", window.name || "current", ")");

let lastUrl = location.href;

// 커스텀 검색결과 테이블 식별용 (원본 id/class와 충돌 방지)
const CUSTOM_RESULT_TABLE_ID = "atf-custom-result-container";
const CUSTOM_RESULT_ATTR = "data-atf-role";

// 다운로드 및 등록 후 뱃지 갱신(refreshArticleBadge)에 사용하는 최근 검색결과 캐시
let lastMatchedItems = [];
let lastMatchedRows = [];

const CUSTOM_PAGINATION_ID = "atf-custom-pagination-container";
let isSearchingProcess = false;

// postMessage 발신처 검증용 확장 origin
// 피드백: 위조된 메시지 차단을 위해 모든 postMessage 리스너가 이 값과 대조
const ATF_EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);

// 결과 테이블 컬럼 정렬 상태 (오름차순/내림차순 토글)
const currentSortState = {
  column: null,
  asc: false
};

// ══════════════════════════════════════════════════════════════════
// 커스텀 alert/confirm/prompt 모달 (페이지에 직접 그림 - popup.html 팝업과는 별개)
// ══════════════════════════════════════════════════════════════════
// 피드백: content-actions.js/injected.js가 네이티브 alert()/confirm()/prompt()를 그대로 쓰고
// 있어서, popup.js의 showAlert() 커스텀 모달 체계와 UI가 따로 놀았음(브라우저 기본 다이얼로그는
// 확장 스타일을 못 입히고, 페이지에 따라 표시 위치도 제각각). 브런치 페이지 자체에 우리
// 스타일의 모달을 직접 그려서 하나로 통일한다. 동적 값은 항상 textContent로만 넣어서 XSS 여지를
// 없앤다(showAlert와 동일한 원칙).
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
