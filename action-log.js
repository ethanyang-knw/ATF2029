// action-log.js
// 검색 팝업(popup.html)과 완전히 별개의 독립 iframe에서 실행된다. content-globals.js가
// chrome.storage.local에 남기는 액션 이력(atf_action_log)을 읽어와 보여주고, 부모(content.js)와
// 메시지로 통신해 자신의 iframe 크기를 검색 팝업과 무관하게 스스로 조절한다.
document.addEventListener("DOMContentLoaded", () => {
  const logList = document.getElementById("log-list");
  const btnLogClear = document.getElementById("btn-log-clear");
  const btnLogClose = document.getElementById("btn-log-close");
  const logPageHeader = document.getElementById("log-page-header");

  // 🔧 이 키 이름은 content-globals.js의 ATF_LOG_STORAGE_KEY와 반드시 같아야 한다.
  const ATF_LOG_STORAGE_KEY = "atf_action_log";

  const ACTION_LABELS = {
    black: { label: "블랙글 등록", badge: "log-badge-black" },
    red: { label: "레드글 등록", badge: "log-badge-red" },
    pcHome: { label: "PC 홈 추천", badge: "log-badge-pcHome" },
    featuring: { label: "피처링 추천", badge: "log-badge-featuring" },
    managedUser: { label: "작가 리스트 등록", badge: "log-badge-managedUser" },
    whiteOpen: { label: "화이트 모달 오픈", badge: "log-badge-whiteOpen" }
  };

  function formatLogTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || "";
    const p2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  // 🔧 이력 종류별로 저장된 상세 정보(targets 배열 또는 단건 title/userId/type/comment 등)를
  //    사람이 읽기 좋은 한 줄 문장으로 변환
  function describeLogEntry(entry) {
    if (Array.isArray(entry.targets) && entry.targets.length > 0) {
      const titles = entry.targets
        .map(t => (typeof t === "string" ? t : (t.title || t.userId || t.articleNo || "")))
        .filter(Boolean);
      const shown = titles.slice(0, 5).join(", ");
      const more = titles.length > 5 ? ` 외 ${titles.length - 5}건` : "";
      return `${entry.count ?? entry.targets.length}건: ${shown}${more}`;
    }
    const parts = [];
    if (entry.title) parts.push(entry.title);
    if (entry.userId) parts.push(`작가:${entry.userId}`);
    if (entry.type) parts.push(`유형:${entry.type}`);
    if (entry.comment) parts.push(`사유:${entry.comment}`);
    if (entry.note) parts.push(entry.note);
    return parts.join(" · ") || "(상세 정보 없음)";
  }

  function renderLogList(entries) {
    if (!logList) return;
    logList.innerHTML = "";

    if (!entries || entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "아직 기록된 이력이 없어요.";
      logList.appendChild(empty);
      return;
    }

    [...entries].reverse().forEach(entry => { // 최신 항목이 위로 오도록
      const item = document.createElement("div");
      item.className = "log-item";

      const top = document.createElement("div");
      top.className = "log-item-top";

      const meta = ACTION_LABELS[entry.action] || { label: entry.action || "알 수 없음", badge: "" };
      const badge = document.createElement("span");
      badge.className = `log-item-badge ${meta.badge}`;
      badge.textContent = meta.label;

      const time = document.createElement("span");
      time.className = "log-item-time";
      time.textContent = formatLogTime(entry.at);

      top.append(badge, time);

      const detail = document.createElement("div");
      detail.className = "log-item-detail";
      detail.textContent = describeLogEntry(entry);

      item.append(top, detail);
      logList.appendChild(item);
    });
  }

  function loadAndRenderLog() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      renderLogList([]);
      return;
    }
    chrome.storage.local.get(ATF_LOG_STORAGE_KEY, (result) => {
      const entries = (result && Array.isArray(result[ATF_LOG_STORAGE_KEY])) ? result[ATF_LOG_STORAGE_KEY] : [];
      renderLogList(entries);
    });
  }

  btnLogClose?.addEventListener("click", () => {
    window.parent.postMessage({ type: "CLOSE_LOG_VIEW" }, "*");
  });

  btnLogClear?.addEventListener("click", () => {
    if (!confirm("전체 이력을 삭제할까요? 되돌릴 수 없어요.")) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.remove(ATF_LOG_STORAGE_KEY, () => {
      renderLogList([]);
    });
  });

  // 🖱️ 제목 줄을 잡고 드래그하면 이 창을 옮길 수 있다 - 검색 팝업의 드래그 방식과 동일하게,
  //    이 iframe 안에서는 자기 자신을 못 옮기므로 시작 좌표만 부모(content.js)에게 알려주고
  //    실제 이동은 top window(부모)에서 처리한다.
  logPageHeader?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    window.parent.postMessage({ type: "LOG_DRAG_START", x: e.clientX, y: e.clientY }, "*");
  });

  // 🔧 이 창이 이미 열려있는 상태에서 다시 "이력" 버튼을 눌렀을 때(content.js가 재사용),
  //    그사이 새로 쌓였을 이력을 반영하도록 부모가 이 메시지로 새로고침을 요청할 수 있다.
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "REFRESH_LOG") return;
    // 🔐 부모(content.js, 우리 확장이 삽입된 페이지)에서만 오는 메시지를 신뢰한다.
    if (event.source !== window.parent) return;
    loadAndRenderLog();
  });

  loadAndRenderLog();
});
