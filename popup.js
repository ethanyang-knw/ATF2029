// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const GOOGLE_SCRIPT_URL = "https://script.google.com/a/macros/knworks.co.kr/s/AKfycbyuSEKNemIfwbXrw28R3VIXw6zZZSCr9NU16_NFN85hI62c524YeGfJO4TGgIkRNg5D/exec";
  const SPREADSHEET_ID = "1pFRSpbsbe7vVCtY8SuzOAcJNaQEapVrxXgX9CqAO1BI";

  const SHEET_INFO = {
    "religion": { gid: 0, name: "종교" },
    "promo": { gid: 1945752687, name: "홍보" },
    "no_expose": { gid: 1425243656, name: "노출 불가 키워드" }
  };

  let currentFetchingGid = null;
  let searchTimeoutId = null; // 🔧 검색 응답이 없을 때를 대비한 타임아웃 안전장치

  // 🔧 Google Apps Script는 동시 요청이 너무 많이 몰리면 리다이렉트 처리가 꼬여 404가 나는 경우가
  //    있어서, 완전 병렬(Promise.all 전부 동시) 대신 동시 실행 개수를 제한해서 처리한다.
  //    (background.js의 MAX_CONCURRENT_REQUESTS와 동일한 패턴)
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
  const btnReset = document.getElementById("btn-reset");
  const btnClose = document.getElementById("btn-close");
  const btnSearch = document.getElementById("btn-search");
  const btnDownload = document.getElementById("btn-download");

  const chkDisableDate = document.getElementById("chk-disable-date");
  const chkDisableInclude = document.getElementById("chk-disable-include");
  const chkDisableExclude = document.getElementById("chk-disable-exclude");

  const dateDisabledNote = document.getElementById("date-disabled-note");

  // 🔧 발행 시각 조건을 꺼두면(포함/제외 조건만으로 검색) 서버 조회 기본 범위가 "최근 1일"이라
  //    사실상 오늘 날짜로만 검색되는 셈 - 그 사실을 미리 안내해서 "왜 결과가 이렇게 적지?" 하는
  //    혼란을 방지한다.
  function updateDateDisabledNote() {
    if (!dateDisabledNote) return;
    dateDisabledNote.style.display = chkDisableDate?.checked ? "none" : "block";
  }
  chkDisableDate?.addEventListener("change", updateDateDisabledNote);
  updateDateDisabledNote(); // 초기 상태 반영

  const dateSelect = document.getElementById("date-select");
  const dateMonthInput = document.getElementById("date-month-input");
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
  const sheetSelect = document.getElementById("sheet-select");
  const keywordSelect = document.getElementById("keyword-select");
  const includeInput = document.getElementById("include-input");
  const includeTagContainer = document.getElementById("include-tag-container");

  const excludeSelect = document.getElementById("exclude-select");
  const excludeTagContainer = document.getElementById("exclude-tag-container");

  const btnIncludeAdd = document.getElementById("btn-include-add");
  const btnIncludeSave = document.getElementById("btn-include-save");
  const btnIncludeTagsReset = document.getElementById("btn-include-tags-reset");

  // 모달 요소 참조
  const sheetMappingModal = document.getElementById("sheet-mapping-modal");
  const modalMappingList = document.getElementById("modal-mapping-list");
  const btnModalCancel = document.getElementById("btn-modal-cancel");
  const btnModalSaveStart = document.getElementById("btn-modal-save-start");

  const alertModal = document.getElementById("alert-modal");
  const alertTitle = document.getElementById("alert-title");
  const alertMessage = document.getElementById("alert-message");
  const btnAlertClose = document.getElementById("btn-alert-close");

  const btnLog = document.getElementById("btn-log");

  const searchLoadingBox = document.getElementById("search-loading-box");
  const searchLogBox = document.getElementById("search-log-box");

  // 🖱️ 헤더 드래그로 팝업 자유 이동
  //    (iframe 내부에서는 iframe 자체를 못 옮기므로, 시작 지점만 부모(content.js)에 알려주고
  //     실제 이동은 top window에서 처리)
  const headerDragArea = document.querySelector(".header");
  headerDragArea?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return; // 버튼 클릭 시엔 드래그 시작하지 않음
    e.preventDefault(); // 드래그 중 텍스트가 선택되는 것 방지
    window.parent.postMessage({
      type: "DRAG_START",
      x: e.clientX,
      y: e.clientY
    }, "*");
  });

  // 📢 커스텀 알림 팝업 함수
  function showAlert(title, messageHtml) {
    if (alertTitle) alertTitle.textContent = title;
    if (alertMessage) alertMessage.innerHTML = messageHtml;
    if (alertModal) alertModal.classList.add("active");
  }

  btnAlertClose?.addEventListener("click", () => {
    alertModal?.classList.remove("active");
    sendHeightToParent(); // 🔧 모달이 닫힌 뒤 실제 콘텐츠 높이로 재계산
  });

  // 📋 이력 창은 검색 팝업(이 iframe)과 완전히 별개의 독립 iframe(action-log.html)으로 뜨도록
  //    분리했다 - 검색 팝업 안에 모달로 넣으면 이력이 길어질 때 iframe 전체(=검색창)가
  //    같이 커져버리는 문제가 있었어서, 부모(content.js)에게 별도 창을 열어달라고만 요청한다.
  btnLog?.addEventListener("click", () => {
    window.parent.postMessage({ type: "OPEN_LOG_VIEW" }, "*");
  });

  // 🔄 조건 초기화 함수
  function resetAllConditions() {
    // 🔧 체크 = 조건 적용(기본값), 체크 해제 = 조건 제외 → 초기화 시 전체 체크 상태로 복원
    if (chkDisableDate) chkDisableDate.checked = true;
    if (chkDisableInclude) chkDisableInclude.checked = true;
    if (chkDisableExclude) chkDisableExclude.checked = true;
    updateDateDisabledNote(); // 🔧 체크 상태를 되돌렸으니 안내 문구도 다시 숨김

    if (dateSelect) {
      dateSelect.value = "24h";
      dateSelect.dispatchEvent(new Event("change"));
    }
    if (dateMonthInput) dateMonthInput.value = "";
    if (dateStart) dateStart.value = "";
    if (dateEnd) dateEnd.value = "";
    if (dateStartDisplay) dateStartDisplay.textContent = "";
    if (dateEndDisplay) dateEndDisplay.textContent = "";

    if (includeSelect) {
      includeSelect.value = "";
      includeSelect.dispatchEvent(new Event("change"));
    }
    if (includeTagContainer) includeTagContainer.innerHTML = "";

    if (excludeSelect) excludeSelect.value = "";
    if (excludeTagContainer) excludeTagContainer.innerHTML = "";

    if (searchLoadingBox) searchLoadingBox.style.display = "none";

    window.parent.postMessage({ type: "RESET_FILTER" }, "*");
  }

  btnReset?.addEventListener("click", () => {
    resetAllConditions();
  });

  btnClose?.addEventListener("click", () => {
    window.parent.postMessage({ type: "CLOSE_MODAL" }, "*");
  });

  btnDownload?.addEventListener("click", () => {
    window.parent.postMessage({ type: "REQUEST_DOWNLOAD" }, "*");
  });

  // 🔧 발행 시각 조건만 추출 (검색/개수확인 둘 다에서 재사용)
  function collectDateParams() {
    const isDateEnabled = chkDisableDate?.checked;
    return {
      dateEnabled: isDateEnabled,
      dateType: (isDateEnabled && dateSelect) ? dateSelect.value : "",
      dateStart: (isDateEnabled && dateStart) ? dateStart.value : "",
      dateEnd: (isDateEnabled && dateEnd) ? dateEnd.value : "",
      dateMonth: (isDateEnabled && dateMonthInput) ? dateMonthInput.value : ""
    };
  }

  // 🔍 [검색 버튼] 검색 실행
  btnSearch?.addEventListener("click", () => {
    // 🔧 검색을 실제로 시작하기 전에, "직접 지정" 기간이나 "월 단위 지정"에 아직 발생하지 않은
    //    미래 날짜/월이 끼어있지는 않은지 먼저 확인 (문제 있으면 로딩 표시 없이 바로 경고)
    const dateParamsCheck = collectDateParams();
    if (dateParamsCheck.dateEnabled && dateParamsCheck.dateType === "direct") {
      const today = new Date();
      const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startCheck = parseDateValue(dateParamsCheck.dateStart);
      const endCheck = parseDateValue(dateParamsCheck.dateEnd);

      if ((startCheck && startCheck > todayDateOnly) || (endCheck && endCheck > todayDateOnly)) {
        showAlert("날짜 확인 필요", "아직 발생하지 않은 미래 날짜가 선택되어 있어요.<br>발행 시각 기간을 다시 확인해 주세요.");
        return;
      }
    }
    if (dateParamsCheck.dateEnabled && dateParamsCheck.dateType === "month" && dateParamsCheck.dateMonth) {
      const currentMonthStr = getCurrentMonthValue();
      if (dateParamsCheck.dateMonth > currentMonthStr) {
        showAlert("날짜 확인 필요", "아직 발생하지 않은 미래 월이 선택되어 있어요.<br>발행 시각 기간을 다시 확인해 주세요.");
        return;
      }
    }

    if (searchLoadingBox) searchLoadingBox.style.display = "block";
    if (searchLogBox) {
      searchLogBox.innerHTML = "";
      searchLogBox.style.display = "block";
      sendHeightToParent();
    }

    // 🔧 페이지 수가 앞으로 계속 늘어날 수 있어 마지막 페이지까지 수집하도록 바뀌었으므로,
    //    타임아웃을 240초(4분)로 넉넉하게 설정 (그 안에 응답 없으면 자동 해제)
    if (searchTimeoutId) clearTimeout(searchTimeoutId);
    searchTimeoutId = setTimeout(() => {
      if (searchLoadingBox) searchLoadingBox.style.display = "none";
      sendHeightToParent(); // 🔧 타임아웃 시에도 높이 재계산
      showAlert("응답 없음", "검색 응답을 받지 못했습니다.<br>페이지를 새로고침한 후 다시 시도해 주세요.");
      searchTimeoutId = null;
    }, 240000);

    // 🔧 체크 = 조건 적용, 체크 해제 = 조건 제외
    const isIncludeEnabled = chkDisableInclude?.checked;
    const isExcludeEnabled = chkDisableExclude?.checked;

    // 🔧 각 태그의 카테고리(G.키워드/제목/키워드/매거진/작가/제목+키워드)를 함께 전달해서
    //    content.js에서 카테고리에 맞는 필드만 매칭하도록 함
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
      : []; // 🔧 content.js의 managedUserType 코드값과 매칭되도록 data-value 우선 사용

    const dateParams = collectDateParams();

    window.parent.postMessage({
      type: "EXECUTE_SEARCH",
      params: {
        includeEnabled: isIncludeEnabled,
        excludeEnabled: isExcludeEnabled,
        includeTags: includeTags,
        excludeUserTypes: excludeUserTypes,
        ...dateParams
      }
    }, "*");
  });

  // 📥 검색 결과 메세지 수신
  window.addEventListener("message", (event) => {
    // 🔐 이 iframe의 부모(content.js가 실행 중인 페이지)에서 온 메시지만 신뢰한다.
    //    출처 origin은 사이트마다(브런치 운영툴의 서브도메인 등) 달라질 수 있어 고정 문자열
    //    비교 대신, "진짜 부모 프레임에서 왔는가"(event.source === window.parent)로 검증한다.
    if (event.source !== window.parent) return;

    if (event.data && event.data.type === "SEARCH_PROGRESS") {
      if (searchLogBox) {
        const line = document.createElement("div");
        line.textContent = event.data.message;
        searchLogBox.appendChild(line);
        searchLogBox.scrollTop = searchLogBox.scrollHeight; // 항상 최신 로그로 자동 스크롤
        sendHeightToParent(); // 🔧 로그 박스가 160px까지 커지는 동안 iframe 높이도 함께 갱신
      }
      return;
    }

    if (event.data && event.data.type === "SEARCH_RESULT_COUNT") {
      if (searchTimeoutId) { clearTimeout(searchTimeoutId); searchTimeoutId = null; } // 🔧 정상 응답 시 타임아웃 해제
      if (searchLoadingBox) searchLoadingBox.style.display = "none";
      sendHeightToParent(); // 🔧 로딩 박스가 사라진 만큼 iframe 높이를 즉시 재계산

      if (event.data.error) {
        showAlert("검색 실패", event.data.error);
      } else {
        let msg = `총 <b>${event.data.count}건</b>의 게시글이 검색되었습니다.`;
        if (event.data.fromCache) {
          msg += `<br><br>⚡ 같은 기간으로 이전에 받아둔 데이터를 재사용해서 즉시 조회했어요.`;
        }
        if (event.data.usedDefaultRange) {
          const days = event.data.lookbackDays || 1; // 🔧 기본 조회 범위가 1일로 바뀌었으므로 fallback도 맞춤(예전 90일 시절 잔재)
          msg += `<br><br>※ 발행 시각 조건 없이 검색하면 속도를 위해 기본적으로 <b>최근 ${days}일</b> 게시글만 조회됩니다.<br>더 오래된 글도 찾으시려면 발행 시각을 <b>직접 지정</b>으로 설정해서 검색해 주세요.`;
        }
        showAlert("검색 완료", msg);
      }
    }

    if (event.data && event.data.type === "DOWNLOAD_RESULT") {
      if (event.data.error) {
        showAlert("다운로드 실패", event.data.error);
      } else {
        showAlert("다운로드 완료", `총 <b>${event.data.count}건</b>의 결과가 엑셀(xlsx) 파일로 다운로드되었습니다.`);
      }
    }
  });

  // 📥 구글 앱스 스크립트 파라미터 규격(targetGid, sheetName) 맞춤 수집 함수
  async function getExistingKeywords(targetGid, sheetName = "") {
    if (!GOOGLE_SCRIPT_URL) return [];

    try {
      // 💡 Code.gs의 e.parameter.targetGid 및 sheetName 파라미터에 정확하게 맞춰 요청!
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
      // 🔧 innerHTML 문자열 조합 대신 <option> 엘리먼트를 직접 생성 - keywords는 다른
      //    협업자도 편집 가능한 구글시트에서 오는 값이라, 악성 값이 섞여있어도 태그/속성으로
      //    해석되지 않고 항상 순수 텍스트(선택지)로만 표시되도록 함
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

  async function sendToGoogleSheet(value, targetGid, sheetName) {
    if (!GOOGLE_SCRIPT_URL) return false;

    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          value: value,
          targetGid: targetGid,
          sheetName: sheetName
        }),
      });
      return true;
    } catch (error) {
      console.error("❌ 전송 실패:", error);
      return false;
    }
  }

  function createTag(text, isDanger = false, value = null) {
    const newTag = document.createElement("div");
    newTag.className = isDanger ? "tag tag-danger" : "tag";
    if (value) newTag.dataset.value = value; // 🔧 실제 매칭용 코드값(white/gray/black/red 등) 보관

    // 🔧 innerHTML 템플릿 문자열 대신 요소를 직접 만들어서 text를 삽입 - text가 사용자 직접
    //    입력이거나(포함 조건 키워드) 구글시트에서 가져온 값이라 악성 HTML이 섞여있어도
    //    태그/속성으로 해석되지 않고 항상 순수 텍스트로만 표시되도록 함
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
  let calActiveField = null; // 'start' | 'end'
  let calViewDate = new Date();
  const MAX_DIRECT_RANGE_DAYS = 31; // 🔧 직접 지정 최대 기간(시작일로부터 최대 한 달=31일)

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

  function setDateField(field, dateObj) {
    const valueStr = formatDateValue(dateObj);
    const displayStr = formatDateDisplay(dateObj);
    if (field === 'start') {
      if (dateStart) dateStart.value = valueStr;
      if (dateStartDisplay) dateStartDisplay.textContent = displayStr;

      // 🔧 시작일을 고르면 종료일을 "시작일 + 30일"(최대 한 달 범위)으로 자동 설정.
      //    단, 그 값이 아직 발생하지 않은 미래 날짜라면 오늘 날짜까지만 채운다.
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

    // 🔧 종료일을 고를 땐 시작일 ~ 시작일+30일(최대 한 달) 범위 밖은 선택 못 하게 함
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

      // 🔧 아직 발생하지 않은 미래 날짜는 시작일/종료일 둘 다 선택 자체를 막음
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
    sendHeightToParent(); // 🔧 팝업이 잘리지 않도록 높이 재계산
  }

  function closeCalendar() {
    calActiveField = null;
    calendarPopup?.classList.remove("active");
    dateStartDisplay?.classList.remove("active");
    dateEndDisplay?.classList.remove("active");
    sendHeightToParent(); // 🔧 팝업이 닫힌 만큼 높이 재계산
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

  // 🔧 "월 단위 지정" 미래월 선택 차단 및 기본값 설정에 공통으로 쓰는 현재 월 문자열(YYYY-MM)
  function getCurrentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }

  if (dateSelect) {
    update24hRange();

    dateSelect.addEventListener("change", (e) => {
      const value = e.target.value;

      if (dateRangeText) dateRangeText.style.display = "none";
      if (dateMonthInput) dateMonthInput.style.display = "none";
      if (dateInputGroup) dateInputGroup.style.display = "none";
      closeCalendar();

      if (value === "24h") {
        update24hRange();
        if (dateRangeText) dateRangeText.style.display = "inline-block";
      } else if (value === "month") {
        if (dateMonthInput) {
          const currentMonthStr = getCurrentMonthValue();
          dateMonthInput.max = currentMonthStr; // 🔧 브라우저 네이티브 월 선택기에서부터 미래월 선택 차단
          // 🔧 "직접 지정"과 동일하게, 월 단위 지정을 다시 선택할 때마다 이전에 골랐던 월은 잊고 이번 달로 초기화
          dateMonthInput.value = currentMonthStr;
          dateMonthInput.style.display = "inline-block";
          dateMonthInput.focus();
        }
      } else if (value === "direct") {
        if (dateInputGroup) {
          dateInputGroup.style.display = "flex";
          // 🔧 직접 지정을 다시 선택할 때마다 이전에 골랐던 기간은 잊고 오늘 날짜로 초기화
          const today = new Date();
          setDateField('start', today);
          setDateField('end', today);
        }
      }
    });
  }

  // ── 2. 포함 조건 제어 ──
  // 🔧 텍스트로 직접 검색어를 입력받는 카테고리 (제목/키워드/매거진/작가/제목+키워드)
  //    - 'keyword'(G.키워드, 구글시트 연동)는 기존 sheet-select 방식 그대로 유지, 여기 포함 안 함
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
      if (includeTagContainer) includeTagContainer.innerHTML = ""; // 🔧 카테고리 재선택 시 기존 추가된 태그 자동 삭제
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
        addTagToContainer(excludeTagContainer, selectedText, true, val); // 🔧 코드값(val)도 함께 저장
        e.target.value = "";
      }
    });
  }

  // ── 4. 버튼 이벤트 ──
  btnIncludeTagsReset?.addEventListener("click", () => {
    if (includeTagContainer) includeTagContainer.innerHTML = "";
    sendHeightToParent(); // 🔧 태그가 사라진 만큼 높이 재계산
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

    // 🔧 태그에 카테고리(G.키워드/제목/키워드/매거진/작가/제목+키워드)를 함께 저장해서
    //    검색 시 해당 카테고리에 맞는 필드만 매칭하도록 함
    addTagToContainer(includeTagContainer, tagText, false, val || "keyword");
  });

  btnIncludeSave?.addEventListener("click", () => {
    const tags = includeTagContainer ? Array.from(includeTagContainer.querySelectorAll(".tag span")) : [];

    if (tags.length === 0) {
      showAlert("안내", "저장할 키워드가 없습니다.<br>먼저 키워드를 추가해 주세요.");
      return;
    }

    if (modalMappingList) modalMappingList.innerHTML = "";
    const defaultSheet = (sheetSelect && sheetSelect.value) ? sheetSelect.value : "none";

    tags.forEach((tag) => {
      const kwText = tag.textContent.trim();
      const item = document.createElement("div");
      item.className = "modal-mapping-item";

      // 🔧 innerHTML 템플릿 문자열 대신 요소를 직접 만들어서 kwText를 삽입 - 이 값이
      //    구글시트(다른 협업자도 편집 가능)에서 온 키워드일 수 있어, title/data 속성이나
      //    태그 내용으로 그대로 문자열 결합하면 악성 값이 섞였을 때 XSS로 이어질 수 있었음
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

  btnModalSaveStart?.addEventListener("click", async () => {
    const selectElements = modalMappingList ? modalMappingList.querySelectorAll(".modal-mapping-select") : [];
    sheetMappingModal?.classList.remove("active");

    if (!btnIncludeSave) return;
    btnIncludeSave.disabled = true;
    btnIncludeSave.textContent = "저장 중...";

    // 🔧 실제로 이번에 선택된 시트만 조회(불필요한 시트까지 매번 3개 다 조회하던 걸 줄임)
    const usedSheetKeys = new Set(
      [...selectElements].map(sel => sel.value).filter(key => key !== "none" && SHEET_INFO[key])
    );

    const existingMap = {};
    await runWithConcurrencyLimit([...usedSheetKeys], async (key) => {
      existingMap[key] = await getExistingKeywords(SHEET_INFO[key].gid, SHEET_INFO[key].name);
    });
    // 선택되지 않은 시트는 조회하지 않았으므로 빈 배열로 채워둠(아래 로직에서 안전하게 사용하기 위함)
    for (const key in SHEET_INFO) {
      if (!existingMap[key]) existingMap[key] = [];
    }

    const resultMap = {
      religion: { saved: [], duplicate: [] },
      promo: { saved: [], duplicate: [] },
      no_expose: { saved: [], duplicate: [] }
    };

    let skippedCount = 0;

    // 🔧 1단계: 어떤 키워드를 저장할지 먼저 다 걸러낸다 (기존 중복 + 이번 배치 내 중복도 여기서 즉시 반영)
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
        existingMap[targetSheetKey].push(keyword); // 같은 배치 안에서 동일 키워드가 또 나와도 중복으로 걸리도록 미리 반영
        itemsToSave.push({ keyword, targetSheetKey, info });
      }
    }

    // 🔧 2단계: 실제 전송도 완전 병렬 대신 동시 2개로 제한해서 처리 (속도와 안정성의 균형)
    await runWithConcurrencyLimit(itemsToSave, async ({ keyword, targetSheetKey, info }) => {
      const success = await sendToGoogleSheet(keyword, info.gid, info.name);
      if (success) {
        resultMap[targetSheetKey].saved.push(keyword);
      }
    });

    btnIncludeSave.disabled = false;
    btnIncludeSave.textContent = "저장";

    let msgHtml = "";
    let totalSaved = 0;
    let totalDup = 0;

    for (const key in resultMap) {
      const saved = resultMap[key].saved;
      const dup = resultMap[key].duplicate;
      const sheetName = SHEET_INFO[key].name;

      if (saved.length > 0 || dup.length > 0) {
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${SHEET_INFO[key].gid}`;
        msgHtml += `<b>[${sheetName}] 시트 결과</b> <a href="${sheetUrl}" target="_blank" rel="noopener noreferrer" style="font-size:11px; color:var(--accent); text-decoration:underline;">시트 열기 ↗</a><br>`;
        if (saved.length > 0) {
          // 🔧 이 저장 요청은 구글 앱스 스크립트에 no-cors로 보내져서 서버 쪽 성공/실패를
          //    응답으로 확인할 방법이 없다(브라우저가 응답 내용을 아예 읽지 못하게 막는 모드라,
          //    네트워크 요청 자체가 나갔다는 것만 알 수 있음). 그래서 "저장됨"이라고 단정하는
          //    대신 "요청을 보냈다"는 정직한 표현을 쓰고, 실제 반영 여부는 시트에서 확인하도록 안내한다.
          msgHtml += `📤 저장 요청 전송: ${saved.join(", ")}<br>`;
          totalSaved += saved.length;
        }
        if (dup.length > 0) {
          msgHtml += `⚠️ 중복 제외: ${dup.join(", ")}<br>`;
          totalDup += dup.length;
        }
        msgHtml += `<br>`;
      }
    }

    if (skippedCount > 0) {
      msgHtml += `ℹ️ <b>저장 안 함 (해당 없음):</b> ${skippedCount}건<br>`;
    }

    if (totalSaved > 0) {
      msgHtml += `<span style="font-size:11px; color:var(--text-sub);">※ 전송 완료 여부(성공/실패)는 이 화면에서 확인이 불가능해요. 위 "시트 열기" 링크에서 실제 반영됐는지 확인해 주세요.</span><br>`;
    }

    if (totalSaved === 0 && totalDup === 0 && skippedCount === 0) {
      showAlert("결과", "저장된 항목이 없습니다.");
    } else {
      showAlert("저장 처리 결과", msgHtml);
    }

    if (sheetSelect && sheetSelect.value) {
      const info = SHEET_INFO[sheetSelect.value];
      if (info) fetchKeywordsFromSheet(info.gid, info.name);
    }
  });

  // 🔥 동적 높이 갱신
  // 🔧 document.documentElement.scrollHeight는 position:fixed 모달(높이 100%)이 떠 있을 때
  //    뷰포트 기준 높이에 고정되어 버리므로, 실제 콘텐츠 영역(header + main)만 직접 측정한다.
  const headerEl = document.querySelector(".header");
  const mainEl = document.querySelector(".main");

  const sendHeightToParent = () => {
    requestAnimationFrame(() => {
      const headerHeight = headerEl ? headerEl.offsetHeight : 0;
      const mainHeight = mainEl ? mainEl.scrollHeight : 0;
      let actualHeight = headerHeight + mainHeight;

      // 🔧 커스텀 달력 팝업이 열려 있으면(overflow:visible이라 scrollHeight에 잡히지 않음)
      //    팝업 하단이 잘리지 않도록 필요한 높이를 추가로 반영
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