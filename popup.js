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

  const SHEET_INFO = {
    "religion": { gid: 0, name: "종교" },
    "promo": { gid: 1945752687, name: "홍보" },
    "no_expose": { gid: 1425243656, name: "노출 불가 키워드" }
  };

  let currentFetchingGid = null;
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

  const chkDisableDate = document.getElementById("chk-disable-date");
  const chkDisableInclude = document.getElementById("chk-disable-include");
  const chkDisableExclude = document.getElementById("chk-disable-exclude");

  const dateDisabledNote = document.getElementById("date-disabled-note");

  // 발행 시각 조건 끄면 기본 조회범위가 최근 1일로 좁혀짐을 미리 안내
  function updateDateDisabledNote() {
    if (!dateDisabledNote) return;
    dateDisabledNote.style.display = chkDisableDate?.checked ? "none" : "block";
  }
  chkDisableDate?.addEventListener("change", updateDateDisabledNote);
  updateDateDisabledNote();

  const dateSelect = document.getElementById("date-select");
  const dateRangeText = document.getElementById("date-range-text");
  const dateInputGroup = document.getElementById("date-input-group");
  const dateStart = document.getElementById("date-start");
  const dateEnd = document.getElementById("date-end");
  const dateStartDisplay = document.getElementById("date-start-display");
  const dateEndDisplay = document.getElementById("date-end-display");
  const calendarPopup = document.getElementById("calendar-popup");
  const calMonthYear = document.getElementById("cal-month-year");
  const calDays = document.getElementById("calendar-days");
  const calPrev = document.getElementById("cal-prev");
  const calNext = document.getElementById("cal-next");

  const includeSelect = document.getElementById("include-select");
  const includeMatchMode = document.getElementById("include-match-mode");
  const sheetSelect = document.getElementById("sheet-select");
  const keywordSelect = document.getElementById("keyword-select");
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

  // 헤더 드래그로 팝업 이동 (실제 이동은 부모 프레임에서 처리)
  const headerDragArea = document.querySelector(".header");
  headerDragArea?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    window.parent.postMessage({
      type: "DRAG_START",
      x: e.clientX,
      y: e.clientY
    }, "*");
  });

  // 결과 알림 팝업 - 노드 배열을 받아 replaceChildren으로 렌더 (innerHTML 미사용)
  function showAlert(title, parts) {
    if (alertTitle) alertTitle.textContent = title;
    if (alertMessage) {
      alertMessage.replaceChildren();
      [].concat(parts).forEach(p => {
        alertMessage.appendChild(typeof p === "string" ? T(p) : p);
      });
    }
    if (alertModal) alertModal.classList.add("active");
  }

  btnAlertClose?.addEventListener("click", () => {
    alertModal?.classList.remove("active");
    sendHeightToParent();
  });

  // 조건 초기화
  function resetAllConditions() {
    if (chkDisableDate) chkDisableDate.checked = true;
    if (chkDisableInclude) chkDisableInclude.checked = true;
    if (chkDisableExclude) chkDisableExclude.checked = true;
    updateDateDisabledNote();

    if (dateSelect) {
      dateSelect.value = "24h";
      dateSelect.dispatchEvent(new Event("change"));
    }
    if (dateStart) dateStart.value = "";
    if (dateEnd) dateEnd.value = "";
    if (dateStartDisplay) dateStartDisplay.textContent = "";
    if (dateEndDisplay) dateEndDisplay.textContent = "";

    if (includeSelect) {
      includeSelect.value = "";
      includeSelect.dispatchEvent(new Event("change"));
    }
    if (includeTagContainer) includeTagContainer.innerHTML = "";
    if (includeMatchMode) includeMatchMode.value = "OR";

    if (excludeSelect) excludeSelect.value = "";
    if (excludeTagContainer) excludeTagContainer.innerHTML = "";

    if (chkForceRefresh) chkForceRefresh.checked = false;

    if (searchLoadingBox) searchLoadingBox.style.display = "none";

    window.parent.postMessage({ type: "RESET_FILTER" }, "*");
  }

  // 로그 저장 버튼 - 실제 저장은 content-main.js가 격리 world 로그 버퍼로 수행
  btnLogSave?.addEventListener("click", () => {
    window.parent.postMessage({ type: "REQUEST_LOG_SAVE" }, "*");
  });

  btnReset?.addEventListener("click", () => {
    resetAllConditions();
  });

  btnClose?.addEventListener("click", () => {
    window.parent.postMessage({ type: "CLOSE_MODAL" }, "*");
  });

  // 다운로드 버튼 - 검색과 동일한 로딩 박스를 재사용해 진행 상황 표시
  btnDownload?.addEventListener("click", () => {
    if (loadingBoxText) loadingBoxText.textContent = "📤 다운로드를 준비하는 중입니다... 잠시만 기다려주세요.";
    if (searchLoadingBox) searchLoadingBox.style.display = "block";
    if (searchLogBox) {
      searchLogBox.innerHTML = "";
      searchLogBox.style.display = "block";
      sendHeightToParent();
    }

    if (downloadTimeoutId) clearTimeout(downloadTimeoutId);
    downloadTimeoutId = setTimeout(() => {
      if (searchLoadingBox) searchLoadingBox.style.display = "none";
      if (loadingBoxText) loadingBoxText.textContent = DEFAULT_LOADING_TEXT;
      sendHeightToParent();
      showAlert("응답 없음", [T("다운로드 응답을 받지 못했습니다."), BR(), T("페이지를 새로고침한 후 다시 시도해 주세요.")]);
      downloadTimeoutId = null;
    }, 600000);

    window.parent.postMessage({ type: "REQUEST_DOWNLOAD" }, "*");
  });

  // 발행 시각 조건 수집 (검색 시 재사용)
  function collectDateParams() {
    const isDateEnabled = chkDisableDate?.checked;
    return {
      dateEnabled: isDateEnabled,
      dateType: (isDateEnabled && dateSelect) ? dateSelect.value : "",
      dateStart: (isDateEnabled && dateStart) ? dateStart.value : "",
      dateEnd: (isDateEnabled && dateEnd) ? dateEnd.value : ""
    };
  }

  // 검색 버튼 - 미래 날짜 검증 후 조건을 모아 부모에게 검색 요청
  btnSearch?.addEventListener("click", () => {
    const dateParamsCheck = collectDateParams();
    if (dateParamsCheck.dateEnabled && dateParamsCheck.dateType === "direct") {
      const today = new Date();
      const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startCheck = parseDateValue(dateParamsCheck.dateStart);
      const endCheck = parseDateValue(dateParamsCheck.dateEnd);

      if ((startCheck && startCheck > todayDateOnly) || (endCheck && endCheck > todayDateOnly)) {
        showAlert("날짜 확인 필요", [T("아직 발생하지 않은 미래 날짜가 선택되어 있어요."), BR(), T("발행 시각 기간을 다시 확인해 주세요.")]);
        return;
      }
    }

    if (loadingBoxText) loadingBoxText.textContent = DEFAULT_LOADING_TEXT;
    if (searchLoadingBox) searchLoadingBox.style.display = "block";
    if (searchLogBox) {
      searchLogBox.innerHTML = "";
      searchLogBox.style.display = "block";
      sendHeightToParent();
    }

    if (searchTimeoutId) clearTimeout(searchTimeoutId);
    searchTimeoutId = setTimeout(() => {
      if (searchLoadingBox) searchLoadingBox.style.display = "none";
      sendHeightToParent();
      showAlert("응답 없음", [T("검색 응답을 받지 못했습니다."), BR(), T("페이지를 새로고침한 후 다시 시도해 주세요.")]);
      searchTimeoutId = null;
    }, 240000);

    const isIncludeEnabled = chkDisableInclude?.checked;
    const isExcludeEnabled = chkDisableExclude?.checked;

    const includeTags = (isIncludeEnabled && includeTagContainer)
      ? Array.from(includeTagContainer.querySelectorAll(".tag")).map(tagEl => ({
          text: tagEl.querySelector("span")?.textContent.trim() || "",
          category: tagEl.dataset.value || "keyword"
        }))
      : [];

    const excludeUserTypes = (isExcludeEnabled && excludeTagContainer)
      ? Array.from(excludeTagContainer.querySelectorAll(".tag")).map(
          tagEl => tagEl.dataset.value || tagEl.querySelector("span")?.textContent.trim() || ""
        )
      : [];

    const dateParams = collectDateParams();

    window.parent.postMessage({
      type: "EXECUTE_SEARCH",
      params: {
        includeEnabled: isIncludeEnabled,
        excludeEnabled: isExcludeEnabled,
        includeTags: includeTags,
        includeMatchMode: includeMatchMode?.value === "AND" ? "AND" : "OR",
        excludeUserTypes: excludeUserTypes,
        forceRefresh: !!chkForceRefresh?.checked,
        ...dateParams
      }
    }, "*");
  });

  // 부모(content-main.js)로부터 오는 검색/다운로드 진행 및 결과 메시지 수신
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

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

    if (event.data && event.data.type === "SEARCH_RESULT_COUNT") {
      if (searchTimeoutId) { clearTimeout(searchTimeoutId); searchTimeoutId = null; }
      if (searchLoadingBox) searchLoadingBox.style.display = "none";
      sendHeightToParent();

      if (event.data.error) {
        showAlert("검색 실패", [T(event.data.error)]);
      } else {
        const parts = [T("총 "), B(`${event.data.count}건`), T("의 게시글이 검색되었습니다.")];
        if (event.data.fromCache) {
          parts.push(BR(), BR(), T("⚡ 같은 기간으로 이전에 받아둔 데이터를 재사용해서 즉시 조회했어요."));
        }
        if (event.data.usedDefaultRange) {
          const days = event.data.lookbackDays || 1;
          parts.push(
            BR(), BR(),
            T("※ 발행 시각 조건 없이 검색하면 속도를 위해 기본적으로 "), B(`최근 ${days}일`), T(" 게시글만 조회됩니다."),
            BR(),
            T("더 오래된 글도 찾으시려면 발행 시각을 "), B("직접 지정"), T("으로 설정해서 검색해 주세요.")
          );
        }
        showAlert("검색 완료", parts);
      }
    }

    if (event.data && event.data.type === "DOWNLOAD_RESULT") {
      if (downloadTimeoutId) { clearTimeout(downloadTimeoutId); downloadTimeoutId = null; }
      if (searchLoadingBox) searchLoadingBox.style.display = "none";
      if (loadingBoxText) loadingBoxText.textContent = DEFAULT_LOADING_TEXT;
      sendHeightToParent();

      if (event.data.error) {
        showAlert("다운로드 실패", [T(event.data.error)]);
      } else {
        showAlert("다운로드 완료", [T("총 "), B(`${event.data.count}건`), T("의 결과가 엑셀(xlsx) 파일로 다운로드되었습니다.")]);
      }
    }
  });

  // 구글 앱스 스크립트에서 기존 키워드 조회
  async function getExistingKeywords(targetGid, sheetName = "") {
    if (!GOOGLE_SCRIPT_URL) return [];

    try {
      const fetchUrl = `${GOOGLE_SCRIPT_URL}?targetGid=${encodeURIComponent(targetGid)}&sheetName=${encodeURIComponent(sheetName)}`;

      const response = await fetch(fetchUrl, {
        method: "GET",
        redirect: "follow"
      });

      if (!response.ok) return [];

      const data = await response.json();
      console.log("📥 [Code.gs 응답 수신]:", data);

      if (data && data.result === "success" && Array.isArray(data.keywords)) {
        return data.keywords;
      }
      return [];
    } catch (e) {
      console.error("❌ 키워드 로드 예외 발생:", e);
      return [];
    }
  }

  async function fetchKeywordsFromSheet(targetGid, sheetName = "") {
    if (!keywordSelect) return;

    currentFetchingGid = targetGid;
    keywordSelect.style.display = "inline-block";
    keywordSelect.innerHTML = '<option value="">불러오는 중...</option>';

    const keywords = await getExistingKeywords(targetGid, sheetName);

    if (currentFetchingGid !== targetGid) return;

    if (keywords.length > 0) {
      // option 엘리먼트 직접 생성 - 구글시트에서 온 값이 태그로 해석되지 않도록
      keywordSelect.innerHTML = "";
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "키워드 선택";
      keywordSelect.appendChild(defaultOpt);
      keywords.forEach(kw => {
        const opt = document.createElement("option");
        opt.value = kw;
        opt.textContent = kw;
        keywordSelect.appendChild(opt);
      });
    } else {
      keywordSelect.innerHTML = '<option value="">(등록된 키워드 없음)</option>';
    }
  }

  // 구글 시트로 키워드 전송 - 실제 응답을 읽어 성공/실패를 { ok, reason } 형태로 반환.
  // 크로스오리진 요청이라 credentials: "include"로 구글 세션 쿠키를 함께 보내야
  // Code.gs의 assertAllowedUser_()가 요청자를 식별할 수 있다.
  async function sendToGoogleSheet(value, targetGid, sheetName) {
    if (!GOOGLE_SCRIPT_URL) return { ok: false, reason: "저장 주소가 설정되어 있지 않습니다." };

    try {
      const res = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        credentials: "include", // ✅ 구글 세션 쿠키 전달 → Code.gs가 요청자를 식별할 수 있게
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          value: value,
          targetGid: targetGid,
          sheetName: sheetName
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

  function addTagToContainer(container, tagText, isDanger = false, value = null) {
    if (!container || !tagText) return;

    const existingTags = Array.from(container.querySelectorAll(".tag span"))
      .map(span => span.textContent.trim());

    if (existingTags.includes(tagText)) {
      showAlert("안내", "이미 추가되어 있는 키워드입니다.");
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

  // ── 1-1. 커스텀 달력 팝업 (직접 지정) ──
  let calActiveField = null;
  let calViewDate = new Date();
  const MAX_DIRECT_RANGE_DAYS = 3; // 직접 지정 최대 기간 (일)

  const pad2 = (n) => String(n).padStart(2, '0');
  const formatDateValue = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const formatDateDisplay = (d) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
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

  // 시작일 선택 시 종료일을 자동으로 최대 범위(또는 오늘)로 설정
  function setDateField(field, dateObj) {
    const valueStr = formatDateValue(dateObj);
    const displayStr = formatDateDisplay(dateObj);
    if (field === 'start') {
      if (dateStart) dateStart.value = valueStr;
      if (dateStartDisplay) dateStartDisplay.textContent = displayStr;

      const today = new Date();
      const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const maxEnd = addDays(dateObj, MAX_DIRECT_RANGE_DAYS - 1);
      const autoEnd = maxEnd > todayDateOnly ? todayDateOnly : maxEnd;
      if (dateEnd) dateEnd.value = formatDateValue(autoEnd);
      if (dateEndDisplay) dateEndDisplay.textContent = formatDateDisplay(autoEnd);
    } else {
      if (dateEnd) dateEnd.value = valueStr;
      if (dateEndDisplay) dateEndDisplay.textContent = displayStr;
    }
  }

  function isSameDate(a, b) {
    return !!a && !!b && a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // 달력 날짜 셀 렌더링 - 미래 날짜 및 최대 범위 밖 날짜는 선택 비활성화
  function renderCalendarDays() {
    if (!calDays || !calMonthYear) return;

    const year = calViewDate.getFullYear();
    const month = calViewDate.getMonth();
    calMonthYear.textContent = `${month + 1}월 ${year}`;

    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const selectedStr = calActiveField === 'start' ? dateStart?.value : dateEnd?.value;
    const selectedDate = parseDateValue(selectedStr);

    const startDateForRange = parseDateValue(dateStart?.value);
    const maxEndDate = startDateForRange ? addDays(startDateForRange, MAX_DIRECT_RANGE_DAYS - 1) : null;

    const cells = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      cells.push({ day, otherMonth: true, dateObj: new Date(year, month - 1, day) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, otherMonth: false, dateObj: new Date(year, month, d) });
    }
    let nextDay = 1;
    while (cells.length < 42) {
      cells.push({ day: nextDay, otherMonth: true, dateObj: new Date(year, month + 1, nextDay) });
      nextDay++;
    }

    calDays.innerHTML = "";
    cells.forEach(cell => {
      const el = document.createElement("div");
      el.className = "calendar-day";
      if (cell.otherMonth) el.classList.add("other-month");
      if (isSameDate(cell.dateObj, today)) el.classList.add("today");
      if (selectedDate && isSameDate(cell.dateObj, selectedDate)) el.classList.add("selected");

      const isFuture = cell.dateObj > todayDateOnly;
      const isOutOfRange = calActiveField === 'end' && startDateForRange &&
        (cell.dateObj < startDateForRange || cell.dateObj > maxEndDate);
      const isDisabled = isFuture || isOutOfRange;

      if (isDisabled) {
        el.classList.add("disabled");
        el.title = isFuture
          ? "아직 발생하지 않은 날짜는 선택할 수 없어요."
          : `종료일은 시작일로부터 최대 ${MAX_DIRECT_RANGE_DAYS}일까지만 선택할 수 있어요.`;
      }

      el.textContent = cell.day;
      el.addEventListener("click", () => {
        if (!calActiveField || isDisabled) return;
        setDateField(calActiveField, cell.dateObj);
        closeCalendar();
      });
      calDays.appendChild(el);
    });
  }

  function openCalendar(field, triggerEl) {
    calActiveField = field;

    const currentStr = field === 'start' ? dateStart?.value : dateEnd?.value;
    const baseDate = parseDateValue(currentStr) || new Date();
    calViewDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);

    dateStartDisplay?.classList.toggle("active", field === 'start');
    dateEndDisplay?.classList.toggle("active", field === 'end');

    if (calendarPopup && triggerEl) {
      calendarPopup.style.left = `${triggerEl.offsetLeft}px`;
      calendarPopup.style.top = `${triggerEl.offsetTop + triggerEl.offsetHeight + 4}px`;
      calendarPopup.classList.add("active");
    }

    renderCalendarDays();
    sendHeightToParent();
  }

  function closeCalendar() {
    calActiveField = null;
    calendarPopup?.classList.remove("active");
    dateStartDisplay?.classList.remove("active");
    dateEndDisplay?.classList.remove("active");
    sendHeightToParent();
  }

  dateStartDisplay?.addEventListener("click", (e) => {
    e.stopPropagation();
    openCalendar('start', dateStartDisplay);
  });
  dateEndDisplay?.addEventListener("click", (e) => {
    e.stopPropagation();
    openCalendar('end', dateEndDisplay);
  });

  calPrev?.addEventListener("click", (e) => {
    e.stopPropagation();
    calViewDate.setMonth(calViewDate.getMonth() - 1);
    renderCalendarDays();
  });
  calNext?.addEventListener("click", (e) => {
    e.stopPropagation();
    calViewDate.setMonth(calViewDate.getMonth() + 1);
    renderCalendarDays();
  });

  calendarPopup?.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => closeCalendar());

  if (dateSelect) {
    update24hRange();

    dateSelect.addEventListener("change", (e) => {
      const value = e.target.value;

      if (dateRangeText) dateRangeText.style.display = "none";
      if (dateInputGroup) dateInputGroup.style.display = "none";
      closeCalendar();

      if (value === "24h") {
        update24hRange();
        if (dateRangeText) dateRangeText.style.display = "inline-block";
      } else if (value === "direct") {
        if (dateInputGroup) {
          dateInputGroup.style.display = "flex";
          const today = new Date();
          setDateField('start', today);
          setDateField('end', today);
        }
      }
    });
  }

  // ── 2. 포함 조건 제어 ──
  // 텍스트 직접입력 카테고리 (G.키워드는 sheet-select 방식이라 별도)
  const INCLUDE_TEXT_CATEGORIES = {
    title: "제목 검색어 입력..",
    keyword_text: "키워드 입력..",
    magazine: "매거진명 입력..",
    author: "작가명 입력..",
    title_keyword: "제목/키워드 검색어 입력.."
  };

  if (includeSelect) {
    includeSelect.addEventListener("change", (e) => {
      const val = e.target.value;

      if (sheetSelect) { sheetSelect.style.display = "none"; sheetSelect.value = ""; }
      if (keywordSelect) { keywordSelect.style.display = "none"; keywordSelect.innerHTML = '<option value="">키워드 선택</option>'; }
      if (includeInput) { includeInput.style.display = "none"; includeInput.value = ""; }
      if (includeTagContainer) includeTagContainer.innerHTML = "";
      if (includeMatchMode) {
        includeMatchMode.value = "OR";
        includeMatchMode.style.display = (val === "keyword") ? "none" : "inline-block";
      }
      sendHeightToParent();

      if (val === "keyword") {
        if (sheetSelect) sheetSelect.style.display = "inline-block";
      } else if (INCLUDE_TEXT_CATEGORIES[val]) {
        if (includeInput) {
          includeInput.placeholder = INCLUDE_TEXT_CATEGORIES[val];
          includeInput.style.display = "inline-block";
          includeInput.focus();
        }
      }
    });
  }

  if (sheetSelect) {
    sheetSelect.addEventListener("change", (e) => {
      const selectedKey = e.target.value;
      if (selectedKey === "") {
        if (keywordSelect) {
          keywordSelect.style.display = "none";
          keywordSelect.innerHTML = '<option value="">키워드 선택</option>';
        }
      } else {
        const info = SHEET_INFO[selectedKey];
        if (info) fetchKeywordsFromSheet(info.gid, info.name);
      }
    });
  }

  if (keywordSelect) {
    keywordSelect.addEventListener("change", (e) => {
      const selectedVal = e.target.value;
      if (selectedVal !== "") {
        addTagToContainer(includeTagContainer, selectedVal, false, "keyword");
        e.target.value = "";
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
        showAlert("경고", "추가할 검색어를 입력해 주세요.");
        includeInput?.focus();
        return;
      }
      includeInput.value = "";
    } else if (val === "keyword") {
      tagText = keywordSelect ? keywordSelect.value : "";
      if (!tagText) {
        showAlert("경고", "시트 및 키워드를 선택해 주세요.");
        return;
      }
      keywordSelect.value = "";
    } else {
      showAlert("경고", "포함 조건 방식을 선택해 주세요.");
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
    const defaultSheet = (sheetSelect && sheetSelect.value) ? sheetSelect.value : "none";

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

    const usedSheetKeys = new Set(
      [...selectElements].map(sel => sel.value).filter(key => key !== "none" && SHEET_INFO[key])
    );

    const existingMap = {};
    await runWithConcurrencyLimit([...usedSheetKeys], async (key) => {
      existingMap[key] = await getExistingKeywords(SHEET_INFO[key].gid, SHEET_INFO[key].name);
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

      if (existingMap[targetSheetKey].includes(keyword)) {
        resultMap[targetSheetKey].duplicate.push(keyword);
      } else {
        existingMap[targetSheetKey].push(keyword);
        itemsToSave.push({ keyword, targetSheetKey, info });
      }
    }

    await runWithConcurrencyLimit(itemsToSave, async ({ keyword, targetSheetKey, info }) => {
      const result = await sendToGoogleSheet(keyword, info.gid, info.name);
      if (result.ok) {
        resultMap[targetSheetKey].saved.push(keyword);
      } else {
        resultMap[targetSheetKey].failed.push(`${keyword}(${result.reason})`);
      }
    });

    btnIncludeSave.disabled = false;
    btnIncludeSave.textContent = "저장";

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
      showAlert("결과", "저장된 항목이 없습니다.");
    } else {
      showAlert("저장 처리 결과", parts);
    }

    if (sheetSelect && sheetSelect.value) {
      const info = SHEET_INFO[sheetSelect.value];
      if (info) fetchKeywordsFromSheet(info.gid, info.name);
    }
  });

  // 동적 높이 갱신 - 실제 콘텐츠 영역(header+main)만 측정해 부모 iframe 크기 조절
  const headerEl = document.querySelector(".header");
  const mainEl = document.querySelector(".main");

  const sendHeightToParent = () => {
    requestAnimationFrame(() => {
      const headerHeight = headerEl ? headerEl.offsetHeight : 0;
      const mainHeight = mainEl ? mainEl.scrollHeight : 0;
      let actualHeight = headerHeight + mainHeight;

      // 달력 팝업(overflow:visible)이 열려있으면 잘리지 않도록 높이 보정
      if (calendarPopup && calendarPopup.classList.contains("active")) {
        const popupBottom = calendarPopup.offsetTop + calendarPopup.offsetHeight;
        if (popupBottom + 12 > actualHeight) {
          actualHeight = popupBottom + 12;
        }
      }

      window.parent.postMessage({ type: "RESIZE_IFRAME", height: actualHeight }, "*");
    });
  };

  const resizeObserver = new ResizeObserver(() => sendHeightToParent());
  resizeObserver.observe(document.body);
  sendHeightToParent();
});
