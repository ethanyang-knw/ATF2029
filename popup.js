// popup.js
// 기능: 검색 조건 입력 팝업 UI - 조건 수집, 검색/다운로드 요청, 결과 표시, 구글시트 연동
document.addEventListener("DOMContentLoaded", () => {
  // XSS 방지용 DOM 빌더 헬퍼 - 동적 값이 항상 텍스트로만 삽입되도록 함
  const T = (text) => document.createTextNode(String(text ?? ""));
  const B = (text) => { const e = document.createElement("b"); e.textContent = text; return e; };
  const BR = () => document.createElement("br");
  const A = (href, text) => {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  };

  const GOOGLE_SCRIPT_URL = "https://script.google.com/a/macros/knworks.co.kr/s/AKfycbyuSEKNemIfwbXrw28R3VIXw6zZZSCr9NU16_NFN85hI62c524YeGfJO4TGgIkRNg5D/exec";
  const SPREADSHEET_ID = "1pFRSpbsbe7vVCtY8SuzOAcJNaQEapVrxXgX9CqAO1BI";

  // 부모(브런치 운영툴) origin - 발신/수신 양쪽에서 이 상수 하나만 사용해 위조 메시지 전달을 막음
  const PARENT_ORIGIN = "https://brunch-admin.onkakao.net";

  const SHEET_INFO = {
    "religion": { gid: 0, name: "종교" },
    "promo": { gid: 1945752687, name: "홍보" },
    "no_expose": { gid: 1425243656, name: "노출 불가 키워드" }
  };

  let searchTimeoutId = null;
  let downloadTimeoutId = null;

  // 동시 요청 개수 제한 워커 풀 (Apps Script가 완전 병렬 요청 시 404를 낼 때가 있어서)
  const APPS_SCRIPT_MAX_CONCURRENT = 2;
  async function runWithConcurrencyLimit(items, worker, maxConcurrent = APPS_SCRIPT_MAX_CONCURRENT) {
    let cursor = 0;
    async function runNext() {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    }
    const workerCount = Math.min(maxConcurrent, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  }

  // DOM 요소 참조
  const btnLogSave = document.getElementById("btn-log-save");
  const btnReset = document.getElementById("btn-reset");
  const btnClose = document.getElementById("btn-close");
  const btnSearch = document.getElementById("btn-search");
  const btnDownload = document.getElementById("btn-download");
  const chkForceRefresh = document.getElementById("chk-force-refresh");
  const chkRegulatedKeywords = document.getElementById("chk-regulated-keywords");

  const dateSelect = document.getElementById("date-select");
  const dateRangeText = document.getElementById("date-range-text");
  const dateInputGroup = document.getElementById("date-input-group");
  const dateStart = document.getElementById("date-start");
  const dateEnd = document.getElementById("date-end");

  const includeSelect = document.getElementById("include-select");
  const includeMatchMode = document.getElementById("include-match-mode");
  const includeInput = document.getElementById("include-input");
  const includeTagContainer = document.getElementById("include-tag-container");

  const excludeSelect = document.getElementById("exclude-select");
  const excludeTagContainer = document.getElementById("exclude-tag-container");

  const btnIncludeAdd = document.getElementById("btn-include-add");
  const btnIncludeSave = document.getElementById("btn-include-save");
  const btnIncludeTagsReset = document.getElementById("btn-include-tags-reset");

  const sheetMappingModal = document.getElementById("sheet-mapping-modal");
  const modalMappingList = document.getElementById("modal-mapping-list");
  const btnModalCancel = document.getElementById("btn-modal-cancel");
  const btnModalSaveStart = document.getElementById("btn-modal-save-start");

  const alertModal = document.getElementById("alert-modal");
  const alertTitle = document.getElementById("alert-title");
  const alertMessage = document.getElementById("alert-message");
  const btnAlertClose = document.getElementById("btn-alert-close");

  const searchLoadingBox = document.getElementById("search-loading-box");
  const searchLogBox = document.getElementById("search-log-box");
  const loadingBoxText = document.getElementById("loading-box-text");
  const DEFAULT_LOADING_TEXT = "🔍 전체 페이지 데이터를 탐색 및 필터링하는 중입니다... 잠시만 기다려주세요.";

  // 검색/다운로드가 공통으로 쓰는 로딩 박스 표시·해제 - 문구 변경, 로딩박스/로그박스 표시,
  // 로그 초기화, iframe 높이 갱신까지 한 번에 처리해 두 버튼 핸들러의 중복을 제거
  function startLoading(message) {
    if (loadingBoxText) loadingBoxText.textContent = message;
    if (searchLoadingBox) searchLoadingBox.style.display = "block";
    if (searchLogBox) {
      searchLogBox.replaceChildren();
      searchLogBox.style.display = "block";
    }
    sendHeightToParent();
  }

  function stopLoading() {
    if (searchLoadingBox) searchLoadingBox.style.display = "none";
    if (loadingBoxText) loadingBoxText.textContent = DEFAULT_LOADING_TEXT;
    sendHeightToParent();
  }

  // 검색/다운로드 진행 중 버튼을 비활성화 - 중복 클릭 방지 + 진행 상태를 눈으로도 알 수 있게 함
  function setBusy(busy) {
    if (btnSearch) btnSearch.disabled = busy;
    if (btnDownload) btnDownload.disabled = busy;
    if (btnReset) btnReset.disabled = busy;
  }

  // 헤더 드래그로 팝업 이동 (실제 이동은 부모 프레임에서 처리)
  const headerDragArea = document.querySelector(".header");
  headerDragArea?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    window.parent.postMessage({
      type: "DRAG_START",
      x: e.clientX,
      y: e.clientY
    }, PARENT_ORIGIN);
  });

  // 결과 알림 팝업 - 노드 배열을 받아 replaceChildren으로 렌더 (innerHTML 미사용)
  function showAlert(title, parts) {
    if (alertTitle) alertTitle.textContent = title;
    if (alertMessage) {
      alertMessage.replaceChildren(...parts);
    }
    if (alertModal) alertModal.classList.add("active");
  }

  btnAlertClose?.addEventListener("click", () => {
    alertModal?.classList.remove("active");
    sendHeightToParent();
  });

  // 조건 초기화
  function resetAllConditions() {
    if (dateSelect) {
      dateSelect.value = "24h";
      dateSelect.dispatchEvent(new Event("change"));
    }
    if (dateStart) dateStart.value = "";
    if (dateEnd) dateEnd.value = "";

    if (includeSelect) {
      includeSelect.value = "";
      includeSelect.dispatchEvent(new Event("change"));
    }
    if (includeTagContainer) includeTagContainer.innerHTML = "";
    if (includeMatchMode) includeMatchMode.value = "OR";

    if (excludeSelect) excludeSelect.value = "";
    applyDefaultExcludeTags();

    if (chkForceRefresh) chkForceRefresh.checked = false;
    if (chkRegulatedKeywords) chkRegulatedKeywords.checked = true;

    if (searchLoadingBox) searchLoadingBox.style.display = "none";

    window.parent.postMessage({ type: "RESET_FILTER" }, PARENT_ORIGIN);
  }

  // 로그 저장 버튼 - 실제 저장은 content-main.js의 로그 버퍼로 수행
  btnLogSave?.addEventListener("click", () => {
    window.parent.postMessage({ type: "REQUEST_LOG_SAVE" }, PARENT_ORIGIN);
  });

  btnReset?.addEventListener("click", () => {
    resetAllConditions();
  });

  btnClose?.addEventListener("click", () => {
    window.parent.postMessage({ type: "CLOSE_MODAL" }, PARENT_ORIGIN);
  });

  // 다운로드 버튼 - 검색과 동일한 로딩 박스를 재사용해 진행 상황 표시
  btnDownload?.addEventListener("click", () => {
    startLoading("📤 다운로드를 준비하는 중입니다... 잠시만 기다려주세요.");
    setBusy(true);

    if (downloadTimeoutId) clearTimeout(downloadTimeoutId);
    downloadTimeoutId = setTimeout(() => {
      stopLoading();
      setBusy(false);
      showAlert("응답 없음", [T("다운로드 응답을 받지 못했습니다."), BR(), T("페이지를 새로고침한 후 다시 시도해 주세요.")]);
      downloadTimeoutId = null;
    }, 600000);

    window.parent.postMessage({ type: "REQUEST_DOWNLOAD" }, PARENT_ORIGIN);
  });

  // 발행 시각 조건 수집 (검색 시 재사용) - dateType(24h/direct) 중 하나가 항상 적용됨
  function collectDateParams() {
    return {
      dateType: dateSelect ? dateSelect.value : "24h",
      dateStart: dateStart ? dateStart.value : "",
      dateEnd: dateEnd ? dateEnd.value : ""
    };
  }

  // 검색 버튼 - 미래 날짜 검증 후 조건을 모아 부모에게 검색 요청
  btnSearch?.addEventListener("click", async () => {
    const dateParamsCheck = collectDateParams();
    if (dateParamsCheck.dateType === "direct") {
      const today = new Date();
      const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startCheck = parseDateValue(dateParamsCheck.dateStart);
      const endCheck = parseDateValue(dateParamsCheck.dateEnd);

      if ((startCheck && startCheck > todayDateOnly) || (endCheck && endCheck > todayDateOnly)) {
        showAlert("날짜 확인 필요", [T("아직 발생하지 않은 미래 날짜가 선택되어 있어요."), BR(), T("발행 시각 기간을 다시 확인해 주세요.")]);
        return;
      }
    }

    startLoading(DEFAULT_LOADING_TEXT);
    setBusy(true);

    if (searchTimeoutId) clearTimeout(searchTimeoutId);
    searchTimeoutId = setTimeout(() => {
      stopLoading();
      setBusy(false);
      showAlert("응답 없음", [T("검색 응답을 받지 못했습니다."), BR(), T("페이지를 새로고침한 후 다시 시도해 주세요.")]);
      searchTimeoutId = null;
    }, 240000);

    // 규제 키워드 조회(비동기 대기)가 끝나기 전에 조건이 바뀌는 것을 막기 위해,
    // forceRefresh를 포함한 모든 조건을 여기서 한 번에 스냅샷 떠둔다 (초기화 버튼도 setBusy로 잠김)
    const includeTags = includeTagContainer
      ? Array.from(includeTagContainer.querySelectorAll(".tag")).map(tagEl => ({
          text: tagEl.querySelector("span")?.textContent.trim() || "",
          category: tagEl.dataset.value || "keyword"
        }))
      : [];

    const excludeUserTypes = excludeTagContainer
      ? Array.from(excludeTagContainer.querySelectorAll(".tag")).map(
          tagEl => tagEl.dataset.value || tagEl.querySelector("span")?.textContent.trim() || ""
        )
      : [];

    const dateParams = collectDateParams();
    const forceRefresh = !!chkForceRefresh?.checked;
    const regulatedKeywordsEnabled = !!chkRegulatedKeywords?.checked;
    const includeMatchModeValue = includeMatchMode?.value === "AND" ? "AND" : "OR";

    // 규제 키워드(종교/홍보/노출불가) 자동포함 - 목록은 화면에 안 보이고 내부 검색조건에만 실림
    let regulatedKeywords = [];
    let regulatedKeywordsFailedSheets = []; // 이 요청 자체에 실어 보내서 결과 메시지로 그대로 돌려받음(전역변수로 안 둠)
    if (regulatedKeywordsEnabled) {
      const r = await fetchRegulatedKeywords();
      regulatedKeywords = r.keywords;

      if (r.anyFailed && r.keywords.length === 0) {
        // 전부 실패 - 포함조건이 통째로 빠져서 "전체 게시글"이 검색될 수 있으므로
        // 조용히 진행하지 않고 검색 자체를 중단(fail-closed)
        if (searchTimeoutId) { clearTimeout(searchTimeoutId); searchTimeoutId = null; }
        stopLoading();
        setBusy(false);
        showAlert("규제 키워드 조회 실패", [
          T("종교/홍보/노출불가 키워드 목록을 하나도 불러오지 못했어요."), BR(),
          T("검색을 중단했습니다. 잠시 후 다시 시도해 주세요."), BR(), BR(),
          T("(포함 조건 없이 계속 진행하면 전체 게시글이 검색되니, 필요하면 체크박스를 끄고 검색해 주세요.)")
        ]);
        return;
      }

      if (r.anyFailed) {
        // 일부만 실패 - 즉시 알림을 띄우면 뒤이어 뜨는 "검색 완료" 알림이 같은 모달을
        // 덮어써서 사용자가 볼 새도 없이 사라짐. EXECUTE_SEARCH에 실어보내 결과 메시지로 돌려받아 합쳐서 보여줌.
        regulatedKeywordsFailedSheets = r.failedSheetNames;
      }
    }

    window.parent.postMessage({
      type: "EXECUTE_SEARCH",
      params: {
        includeTags: includeTags,
        includeMatchMode: includeMatchModeValue,
        excludeUserTypes: excludeUserTypes,
        forceRefresh: forceRefresh,
        regulatedKeywords: regulatedKeywords,
        regulatedKeywordsEnabled: regulatedKeywordsEnabled,
        regulatedKeywordsFailedSheets: regulatedKeywordsFailedSheets,
        ...dateParams
      }
    }, PARENT_ORIGIN);
  });

  // 부모(content-main.js)로부터 오는 검색/다운로드 진행 및 결과 메시지 수신
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (event.origin !== PARENT_ORIGIN) return;

    if (event.data && (event.data.type === "SEARCH_PROGRESS" || event.data.type === "DOWNLOAD_PROGRESS")) {
      if (searchLogBox) {
        const line = document.createElement("div");
        line.textContent = event.data.message;
        searchLogBox.appendChild(line);
        searchLogBox.scrollTop = searchLogBox.scrollHeight;
        sendHeightToParent();
      }
      return;
    }

    if (event.data && event.data.type === "SEARCH_ALREADY_RUNNING") {
      // 이 클릭으로 새로 만들어진 타이머를 반드시 정리 - 안 지우면 먼저 시작된 검색이
      // 끝난 뒤에도 이 타이머가 뒤늦게 울려서 엉뚱하게 "응답 없음"이 뜰 수 있음
      if (searchTimeoutId) { clearTimeout(searchTimeoutId); searchTimeoutId = null; }
      stopLoading();
      setBusy(false);

      showAlert("검색 진행 중", [T("이전 검색이 아직 진행 중입니다."), BR(), T("검색이 완료될 때까지 잠시만 기다려 주세요.")]);
      return;
    }

    if (event.data && event.data.type === "SEARCH_RESULT_COUNT") {
      if (searchTimeoutId) { clearTimeout(searchTimeoutId); searchTimeoutId = null; }
      stopLoading();
      setBusy(false);

      // content-main.js가 이 검색요청 자체에 실려있던 값을 그대로 돌려준 것 - 전역변수가 아니라
      // 이 결과 메시지에 매칭되는 값이라, 장시간 검색 중 다른 요청이 끼어들어도 안 섞임
      const failedSheets = Array.isArray(event.data.regulatedKeywordsFailedSheets) ? event.data.regulatedKeywordsFailedSheets : [];

      if (event.data.cancelled) {
        const parts = [T("대량 조회를 취소했습니다."), BR(), T("이전 검색 결과가 있다면 그대로 유지돼요.")];
        if (failedSheets.length > 0) parts.push(BR(), BR(), T(`⚠️ ${failedSheets.join(", ")} 시트의 규제 키워드를 불러오지 못했습니다.`));
        showAlert("검색 취소", parts);
      } else if (event.data.error) {
        const parts = [T(event.data.error), BR(), BR(), T("잠시 후 다시 검색해 주세요.")];
        if (failedSheets.length > 0) parts.push(BR(), BR(), T(`⚠️ ${failedSheets.join(", ")} 시트의 규제 키워드도 불러오지 못했습니다.`));
        showAlert("검색 실패", parts);
      } else {
        const parts = [T("총 "), B(`${event.data.count}건`), T("의 게시글이 검색되었습니다.")];
        if (event.data.fromCache) {
          parts.push(BR(), BR(), T("⚡ 같은 기간으로 이전에 받아둔 데이터를 재사용해서 즉시 조회했어요."));
        }
        if (event.data.hadDataIssue) {
          parts.push(BR(), BR(), T("⚠️ 일부 데이터가 정상적으로 조회되지 않았어요. 재검색을 권장합니다."));
        }
        if (failedSheets.length > 0) parts.push(BR(), BR(), T(`⚠️ ${failedSheets.join(", ")} 시트의 규제 키워드를 불러오지 못해, 나머지 키워드로만 검색했습니다.`));
        showAlert("검색 완료", parts);
      }
    }

    if (event.data && event.data.type === "DOWNLOAD_ALREADY_RUNNING") {
      // 이 클릭으로 새로 만들어진 타이머를 정리 (검색 쪽과 동일한 이유)
      if (downloadTimeoutId) { clearTimeout(downloadTimeoutId); downloadTimeoutId = null; }
      stopLoading();
      setBusy(false);

      showAlert("다운로드 진행 중", [T("이전 다운로드가 아직 진행 중입니다."), BR(), T("작가 수가 많으면 몇 분 걸릴 수 있어요. 완료될 때까지 기다려 주세요.")]);
      return;
    }

    if (event.data && event.data.type === "DOWNLOAD_RESULT") {
      if (downloadTimeoutId) { clearTimeout(downloadTimeoutId); downloadTimeoutId = null; }
      stopLoading();
      setBusy(false);

      if (event.data.error) {
        showAlert("다운로드 실패", [T(event.data.error)]);
      } else {
        const parts = [T("총 "), B(`${event.data.count}건`), T("의 결과가 엑셀(xlsx) 파일로 다운로드되었습니다.")];
        if (event.data.handleFailed > 0) {
          parts.push(BR(), BR(), T(`ℹ️ 작가 ${event.data.handleTotal}명 중 ${event.data.handleFailed}명은 실제 주소를 확인하지 못해 기본 주소(@@형식)로 저장됐어요.`));
          if (event.data.handleFailed >= event.data.handleTotal / 2) {
            parts.push(BR(), T("⚠️ 실패 비율이 높습니다. 운영툴 화면 구조가 바뀌었을 수 있으니 확인해 주세요."));
          }
        }
        showAlert("다운로드 완료", parts);
      }
    }
  });

  // 구글 앱스 스크립트에서 기존 키워드 조회 - 조회 자체의 성공/실패와 "결과가 빈 배열인 것"을
  // 구분해서 반환함 (실패를 빈 시트로 오판해 중복 저장하는 것 방지)
  const GET_EXISTING_KEYWORDS_TIMEOUT_MS = 15000;

  async function getExistingKeywords(targetGid) {
    if (!GOOGLE_SCRIPT_URL) return { ok: true, keywords: [] };

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), GET_EXISTING_KEYWORDS_TIMEOUT_MS);

    try {
      const fetchUrl = `${GOOGLE_SCRIPT_URL}?targetGid=${encodeURIComponent(targetGid)}`;

      const response = await fetch(fetchUrl, {
        method: "GET",
        credentials: "include", // 구글 세션 쿠키 전달 - Code.gs의 assertAllowedUser_()가 요청자를 식별할 수 있게
        redirect: "follow",
        signal: abortController.signal
      });

      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, keywords: [] };

      const data = await response.json();
      console.log("📥 [Code.gs 응답 수신]:", data);

      if (data && data.result === "forbidden") {
        return { ok: false, reason: "권한 없음(사내 계정으로 로그인되어 있는지 확인해 주세요)", keywords: [] };
      }
      if (data && data.result === "success" && Array.isArray(data.keywords)) {
        return { ok: true, keywords: data.keywords };
      }
      return { ok: false, reason: (data && data.error) || "알 수 없는 오류", keywords: [] };
    } catch (e) {
      console.error("❌ 키워드 로드 예외 발생:", e);
      return { ok: false, reason: e.name === "AbortError" ? "응답 시간 초과" : (e.message || "네트워크 오류"), keywords: [] };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 규제 키워드(종교/홍보/노출불가 3개 시트) 통합 조회 - "규제 키워드 자동 포함" 체크 시 사용.
  // 검색창엔 목록을 표시하지 않고 내부 검색조건에만 반영하므로, 매 검색마다 새로 조회하지 않도록
  // 5분 캐시를 둔다(구글시트 저장용 캐시와는 별개).
  const REGULATED_KEYWORDS_CACHE_TTL_MS = 5 * 60 * 1000;
  let regulatedKeywordsCache = { keywords: [], cachedAt: 0 };

  async function fetchRegulatedKeywords() {
    if (Date.now() - regulatedKeywordsCache.cachedAt < REGULATED_KEYWORDS_CACHE_TTL_MS) {
      return { keywords: regulatedKeywordsCache.keywords, anyFailed: false, failedSheetNames: [] };
    }

    const merged = new Set();
    let anyFailed = false;
    const failedSheetNames = [];
    await runWithConcurrencyLimit(Object.keys(SHEET_INFO), async (key) => {
      const result = await getExistingKeywords(SHEET_INFO[key].gid);
      if (result.ok) {
        result.keywords.forEach(k => { if (k) merged.add(String(k).toLowerCase()); });
      } else {
        anyFailed = true;
        failedSheetNames.push(SHEET_INFO[key].name);
      }
    });

    const list = [...merged];
    if (!anyFailed) {
      regulatedKeywordsCache = { keywords: list, cachedAt: Date.now() };
    }
    return { keywords: list, anyFailed, failedSheetNames };
  }

  // 구글 시트로 키워드 전송 - 실제 응답을 읽어 성공/실패를 { ok, reason } 형태로 반환.
  // 크로스오리진 요청이라 credentials: "include"로 구글 세션 쿠키를 함께 보내야
  // Code.gs의 assertAllowedUser_()가 요청자를 식별할 수 있다.
  async function sendToGoogleSheet(value, targetGid) {
    if (!GOOGLE_SCRIPT_URL) return { ok: false, reason: "저장 주소가 설정되어 있지 않습니다." };

    try {
      const res = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        credentials: "include", // ✅ 구글 세션 쿠키 전달 → Code.gs가 요청자를 식별할 수 있게
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          value: value,
          targetGid: targetGid
        }),
        redirect: "follow"
      });

      if (!res.ok) {
        return { ok: false, reason: `HTTP ${res.status}` };
      }

      const data = await res.json();
      if (data && data.result === "forbidden") {
        return { ok: false, reason: "권한 없음(사내 계정으로 로그인되어 있는지 확인해 주세요)" };
      }
      if (!data || data.result !== "success") {
        return { ok: false, reason: (data && data.error) || "알 수 없는 오류" };
      }
      return { ok: true };
    } catch (error) {
      console.error("❌ 전송 실패:", error);
      return { ok: false, reason: error.message || "네트워크 오류" };
    }
  }

  // 태그 DOM 생성 - 사용자 입력/구글시트 값이 항상 텍스트로만 삽입되도록 요소 직접 생성
  function createTag(text, isDanger = false, value = null) {
    const newTag = document.createElement("div");
    newTag.className = isDanger ? "tag tag-danger" : "tag";
    if (value) newTag.dataset.value = value;

    const textSpan = document.createElement("span");
    textSpan.textContent = text;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tag-close";
    closeBtn.title = "삭제";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      newTag.remove();
    });

    newTag.append(textSpan, closeBtn);

    return newTag;
  }

  // 제외 조건 기본값 - 검색창을 새로 열 때/초기화할 때 항상 이 5개가 미리 선택돼 있도록 함
  const EXCLUDE_DEFAULT_OPTIONS = [
    { value: "white", text: "화이트유저" },
    { value: "gray", text: "그레이유저" },
    { value: "black", text: "블랙유저" },
    { value: "red", text: "레드유저" },
    { value: "membership_pro", text: "멤버십 전문 조회" }
  ];

  function applyDefaultExcludeTags() {
    if (!excludeTagContainer) return;
    excludeTagContainer.innerHTML = "";
    EXCLUDE_DEFAULT_OPTIONS.forEach(opt => {
      excludeTagContainer.appendChild(createTag(opt.text, true, opt.value));
    });
  }

  function addTagToContainer(container, tagText, isDanger = false, value = null) {
    if (!container || !tagText) return;

    const existingTags = Array.from(container.querySelectorAll(".tag span"))
      .map(span => span.textContent.trim());

    if (existingTags.includes(tagText)) {
      showAlert("안내", [T("이미 추가되어 있는 키워드입니다.")]);
      return;
    }

    container.appendChild(createTag(tagText, isDanger, value));
  }

  // ── 1. 발행 시각 제어 ──
  function update24hRange() {
    const now = new Date();
    const past = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    const formatDate = (date) => {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month}.${day} ${hours}:${minutes}`;
    };

    if (dateRangeText) {
      dateRangeText.textContent = `${formatDate(past)} ~ ${formatDate(now)}`;
    }
  }

  // ── 1-1. "직접 지정" 날짜 범위 제약 (네이티브 <input type="date">의 min/max 속성으로 강제) ──
  const MAX_DIRECT_RANGE_DAYS = 3; // 직접 지정 최대 기간 (일)

  const pad2 = (n) => String(n).padStart(2, '0');
  const formatDateValue = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (d, days) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  function parseDateValue(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  // 시작일이 바뀔 때마다 종료일의 min/max를 갱신하고, 범위를 벗어난 종료일은 자동 보정
  function updateEndDateConstraints() {
    if (!dateEnd) return;
    const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startDate = parseDateValue(dateStart?.value);
    if (!startDate) return;

    dateEnd.min = formatDateValue(startDate);
    const maxEnd = addDays(startDate, MAX_DIRECT_RANGE_DAYS - 1);
    const clampedMax = maxEnd > todayDateOnly ? todayDateOnly : maxEnd;
    dateEnd.max = formatDateValue(clampedMax);

    const endDate = parseDateValue(dateEnd.value);
    if (!endDate || endDate < startDate || endDate > clampedMax) {
      dateEnd.value = formatDateValue(clampedMax);
    }
  }

  dateStart?.addEventListener("change", updateEndDateConstraints);

  if (dateStart) dateStart.max = formatDateValue(new Date()); // 미래 날짜는 애초에 선택 불가

  applyDefaultExcludeTags(); // 검색창을 새로 열었을 때도 제외조건 기본값이 미리 채워져 있도록

  if (dateSelect) {
    update24hRange();

    dateSelect.addEventListener("change", (e) => {
      const value = e.target.value;

      if (dateRangeText) dateRangeText.style.display = "none";
      if (dateInputGroup) dateInputGroup.style.display = "none";

      if (value === "24h") {
        update24hRange();
        if (dateRangeText) dateRangeText.style.display = "inline-block";
      } else if (value === "direct") {
        if (dateInputGroup) {
          dateInputGroup.style.display = "flex";
          const today = new Date();
          if (dateStart && !dateStart.value) dateStart.value = formatDateValue(today);
          updateEndDateConstraints();
        }
      }
      sendHeightToParent();
    });
  }

  // ── 2. 포함 조건 제어 ──
  // 텍스트 직접입력 카테고리
  const INCLUDE_TEXT_CATEGORIES = {
    title: "제목 검색어 입력..",
    keyword_text: "키워드 입력..",
    title_keyword: "제목/키워드 검색어 입력.."
  };

  if (includeSelect) {
    includeSelect.addEventListener("change", (e) => {
      const val = e.target.value;

      if (includeInput) { includeInput.style.display = "none"; includeInput.value = ""; }
      if (includeTagContainer) includeTagContainer.innerHTML = "";
      if (includeMatchMode) includeMatchMode.value = "OR";
      sendHeightToParent();

      if (INCLUDE_TEXT_CATEGORIES[val]) {
        if (includeInput) {
          includeInput.placeholder = INCLUDE_TEXT_CATEGORIES[val];
          includeInput.style.display = "inline-block";
          includeInput.focus();
        }
      }
    });
  }

  if (includeInput) {
    includeInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnIncludeAdd?.click();
      }
    });
  }

  // ── 3. 제외 조건 제어 ──
  if (excludeSelect) {
    excludeSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      const selectedText = e.target.options[e.target.selectedIndex]?.text;

      if (val !== "" && selectedText) {
        addTagToContainer(excludeTagContainer, selectedText, true, val);
        e.target.value = "";
      }
    });
  }

  // ── 4. 버튼 이벤트 ──
  btnIncludeTagsReset?.addEventListener("click", () => {
    if (includeTagContainer) includeTagContainer.innerHTML = "";
    sendHeightToParent();
  });

  btnIncludeAdd?.addEventListener("click", () => {
    const val = includeSelect?.value;
    let tagText = "";

    if (INCLUDE_TEXT_CATEGORIES[val]) {
      tagText = includeInput ? includeInput.value.trim() : "";
      if (!tagText) {
        showAlert("경고", [T("추가할 검색어를 입력해 주세요.")]);
        includeInput?.focus();
        return;
      }
      includeInput.value = "";
    } else {
      showAlert("경고", [T("포함 조건 방식을 선택해 주세요.")]);
      return;
    }

    addTagToContainer(includeTagContainer, tagText, false, val || "keyword");
  });

  btnIncludeSave?.addEventListener("click", () => {
    const tags = includeTagContainer ? Array.from(includeTagContainer.querySelectorAll(".tag span")) : [];

    if (tags.length === 0) {
      showAlert("안내", [T("저장할 키워드가 없습니다."), BR(), T("먼저 키워드를 추가해 주세요.")]);
      return;
    }

    if (modalMappingList) modalMappingList.innerHTML = "";
    const defaultSheet = "none";

    tags.forEach((tag) => {
      const kwText = tag.textContent.trim();
      const item = document.createElement("div");
      item.className = "modal-mapping-item";

      // 구글시트에서 온 값이 XSS로 이어지지 않도록 요소를 직접 생성
      const keywordSpan = document.createElement("span");
      keywordSpan.className = "modal-mapping-keyword";
      keywordSpan.title = kwText;
      keywordSpan.textContent = kwText;

      const select = document.createElement("select");
      select.className = "custom-select modal-mapping-select";
      select.dataset.keyword = kwText;

      const options = [
        { value: "none", label: "해당 없음(저장 안 함)" },
        { value: "religion", label: "종교" },
        { value: "promo", label: "홍보" },
        { value: "no_expose", label: "노출 불가 키워드" }
      ];
      options.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (defaultSheet === value) opt.selected = true;
        select.appendChild(opt);
      });

      item.append(keywordSpan, select);
      modalMappingList?.appendChild(item);
    });

    sheetMappingModal?.classList.add("active");
  });

  btnModalCancel?.addEventListener("click", () => {
    sheetMappingModal?.classList.remove("active");
  });

  // 시트 선택 저장 - 기존 키워드 조회 후 중복 걸러내고 신규만 전송
  btnModalSaveStart?.addEventListener("click", async () => {
    const selectElements = modalMappingList ? modalMappingList.querySelectorAll(".modal-mapping-select") : [];
    sheetMappingModal?.classList.remove("active");

    if (!btnIncludeSave) return;
    btnIncludeSave.disabled = true;
    btnIncludeSave.textContent = "저장 중...";

    try {
    const usedSheetKeys = new Set(
      [...selectElements].map(sel => sel.value).filter(key => key !== "none" && SHEET_INFO[key])
    );

    const existingMap = {};
    const lookupFailReasons = {};
    await runWithConcurrencyLimit([...usedSheetKeys], async (key) => {
      const result = await getExistingKeywords(SHEET_INFO[key].gid);
      existingMap[key] = result.keywords;
      if (!result.ok) lookupFailReasons[key] = result.reason;
    });
    for (const key in SHEET_INFO) {
      if (!existingMap[key]) existingMap[key] = [];
    }

    const resultMap = {
      religion: { saved: [], duplicate: [], failed: [] },
      promo: { saved: [], duplicate: [], failed: [] },
      no_expose: { saved: [], duplicate: [], failed: [] }
    };

    let skippedCount = 0;

    const itemsToSave = [];
    for (const sel of selectElements) {
      const keyword = sel.getAttribute("data-keyword");
      const targetSheetKey = sel.value;

      if (targetSheetKey === "none") {
        skippedCount++;
        continue;
      }

      const info = SHEET_INFO[targetSheetKey];
      if (!keyword || !info) continue;

      if (lookupFailReasons[targetSheetKey]) {
        // 기존 키워드 조회 자체가 실패한 시트는 중복 여부를 확인할 수 없으므로 저장을 건너뜀
        resultMap[targetSheetKey].failed.push(`${keyword}(기존 키워드 확인 실패: ${lookupFailReasons[targetSheetKey]})`);
        continue;
      }

      if (existingMap[targetSheetKey].includes(keyword)) {
        resultMap[targetSheetKey].duplicate.push(keyword);
      } else {
        existingMap[targetSheetKey].push(keyword);
        itemsToSave.push({ keyword, targetSheetKey, info });
      }
    }

    await runWithConcurrencyLimit(itemsToSave, async ({ keyword, targetSheetKey, info }) => {
      const result = await sendToGoogleSheet(keyword, info.gid);
      if (result.ok) {
        resultMap[targetSheetKey].saved.push(keyword);
      } else {
        resultMap[targetSheetKey].failed.push(`${keyword}(${result.reason})`);
      }
    });

    const parts = [];
    let totalSaved = 0;
    let totalDup = 0;
    let totalFailed = 0;

    for (const key in resultMap) {
      const saved = resultMap[key].saved;
      const dup = resultMap[key].duplicate;
      const failed = resultMap[key].failed;
      const sheetName = SHEET_INFO[key].name;

      if (saved.length > 0 || dup.length > 0 || failed.length > 0) {
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${SHEET_INFO[key].gid}`;
        parts.push(B(`[${sheetName}] 시트 결과 `), A(sheetUrl, "시트 열기 ↗"), BR());
        if (saved.length > 0) {
          // 이제 실제 서버 응답(result:"success")을 확인한 뒤에만 "완료"로 표시
          parts.push(T(`✅ 저장 완료: ${saved.join(", ")}`), BR());
          totalSaved += saved.length;
        }
        if (dup.length > 0) {
          parts.push(T(`⚠️ 중복 제외: ${dup.join(", ")}`), BR());
          totalDup += dup.length;
        }
        if (failed.length > 0) {
          parts.push(T(`❌ 저장 실패: ${failed.join(", ")}`), BR());
          totalFailed += failed.length;
        }
        parts.push(BR());
      }
    }

    if (skippedCount > 0) {
      parts.push(T(`ℹ️ 저장 안 함 (해당 없음): ${skippedCount}건`), BR());
    }

    if (totalSaved === 0 && totalDup === 0 && totalFailed === 0 && skippedCount === 0) {
      showAlert("결과", [T("저장된 항목이 없습니다.")]);
    } else {
      showAlert("저장 처리 결과", parts);
    }
    } catch (err) {
      console.error("❌ 키워드 저장 중 예외 발생:", err);
      showAlert("저장 실패", [T("키워드 저장 중 오류가 발생했습니다: " + (err?.message || String(err)))]);
    } finally {
      btnIncludeSave.disabled = false;
      btnIncludeSave.textContent = "저장";
    }
  });

  // 동적 높이 갱신 - 실제 콘텐츠 영역(header+main)만 측정해 부모 iframe 크기 조절
  const headerEl = document.querySelector(".header");
  const mainEl = document.querySelector(".main");

  const sendHeightToParent = () => {
    requestAnimationFrame(() => {
      const headerHeight = headerEl ? headerEl.offsetHeight : 0;
      const mainHeight = mainEl ? mainEl.scrollHeight : 0;
      const actualHeight = headerHeight + mainHeight;

      window.parent.postMessage({ type: "RESIZE_IFRAME", height: actualHeight }, PARENT_ORIGIN);
    });
  };

  const resizeObserver = new ResizeObserver(() => sendHeightToParent());
  resizeObserver.observe(document.body);
  sendHeightToParent();
});