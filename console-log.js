// console-log.js
// 기능: 검색 중 로그를 모아뒀다가 오류 발생 시 자동으로 txt 파일 저장
// 격리 world(manifest 로드) + 메인 world(content-main.js가 동적 주입) 양쪽에서 실행됨

const atfLogBuffer = [];

// 로그 한 줄을 타임스탬프와 함께 버퍼에 저장
function pushToAtfLogBuffer(line) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const ts = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
  atfLogBuffer.push(`[${ts}] ${line}`);
}

// 버퍼를 txt 파일로 다운로드
// force=false(자동): [ERROR] 있을 때만 저장, force=true(수동 버튼): 항상 저장
// 피드백: 예전엔 진단 로그만 있어도 자동저장돼 파일이 계속 쌓이던 문제 → ERROR만으로 조건 좁힘
function downloadAtfLogBufferAsTxt({ force = false } = {}) {
  if (atfLogBuffer.length === 0) return;

  const hasError = atfLogBuffer.some(line => line.includes("[ERROR]"));
  if (!force && !hasError) {
    return;
  }

  try {
    const blob = new Blob([atfLogBuffer.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const filename = `atf2029-log_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.txt`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error("❌ [atf-log] 로그 txt 저장 실패:", e);
  } finally {
    atfLogBuffer.length = 0;
  }
}

// 현재 world 판별용 nonce. 메인 world로 동적 주입될 때만 <script> 태그에 실려 온다
// (격리 world는 대응하는 <script> 태그가 없어 document.currentScript가 항상 null)
// 피드백: 콘솔로그가 매번 무조건 postMessage로 왕복해 성능 저하 + 페이지의 다른 스크립트도
// 로그를 엿볼 수 있던 문제 → 같은 world는 직접 기록, 메인→격리 전달만 nonce로 검증 후 중계
const ATF_NONCE = (document.currentScript && document.currentScript.dataset)
  ? document.currentScript.dataset.atfNonce || null
  : null;
const IS_MAIN_WORLD = !!ATF_NONCE;

const __atfOrigConsoleLog = console.log.bind(console);
const __atfOrigConsoleWarn = console.warn.bind(console);
const __atfOrigConsoleError = console.error.bind(console);
const __atfStringifyArg = (a) => {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch (e) { return String(a); }
};

// 이 world의 로그를 자신의 버퍼에 직접 기록. 메인 world일 때만 격리 world로 nonce와 함께 중계
const __atfRecordLine = (line) => {
  pushToAtfLogBuffer(line);
  if (IS_MAIN_WORLD) {
    try {
      window.postMessage({ type: "ATF_CONSOLE_LINE", nonce: ATF_NONCE, message: line }, "*");
    } catch (e) { /* 무시 */ }
  }
};

// console.log/warn/error 오버라이드 - 원래 동작 유지 + 버퍼 기록
console.log = (...args) => {
  __atfOrigConsoleLog(...args);
  __atfRecordLine(args.map(__atfStringifyArg).join(" "));
};
console.warn = (...args) => {
  __atfOrigConsoleWarn(...args);
  __atfRecordLine("[WARN] " + args.map(__atfStringifyArg).join(" "));
};
console.error = (...args) => {
  __atfOrigConsoleError(...args);
  __atfRecordLine("[ERROR] " + args.map(__atfStringifyArg).join(" "));
};

// 격리 world 수신 리스너 - nonce가 자신의 window.__ATF_NONCE__와 일치하는 메시지만 신뢰
// (메인 world 인스턴스는 이 전역이 없어 자기 메시지를 다시 받는 일도 자연히 방지됨)
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!event.data || event.data.type !== "ATF_CONSOLE_LINE") return;
  if (event.data.nonce !== window.__ATF_NONCE__) return;
  pushToAtfLogBuffer(event.data.message);
});
