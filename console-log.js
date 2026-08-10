// console-log.js
// 🗂️ 검색용 txt 로그 저장 기능 - "혹시 모를 오류에 대응"하기 위해, 확장프로그램이 스스로 찍는
//    로그(배치 진행/진단/액션 이력/오류 - 사이트 자체 로그는 제외)를 검색 한 번당 모아뒀다가
//    검색이 끝날 때(성공/실패 모두) 자동으로 .txt로 다운로드한다. 크롬 콘솔은 새로고침하면
//    사라지지만, 이 파일은 컴퓨터에 남아서 나중에 오류 재현/문의할 때 근거 자료로 쓸 수 있다.
//
// ⚠️ action-log.js(별도 액션 이력 조회 창)와는 완전히 다른, 무관한 기능이다 - 이름이 비슷해 보여도
//    섞이지 않도록 파일을 분리해뒀다.
//
// 🌐 이 파일 하나가 격리 world(content-*.js, manifest content_scripts로 로드)와 메인 world
//    (injected-*.js, content-main.js가 <script>로 동적 주입) 양쪽에 동일하게 로드된다.
//    두 world는 변수를 직접 공유할 수 없지만, 이 파일은 "console 호출 → 항상 postMessage로
//    중계 → 같은 파일의 리스너가 그 메시지를 받아 버퍼에 기록"하는 구조라서, 격리 world든
//    메인 world든 어느 쪽에서 로드되어도 동일하게 동작한다(로드된 그 world 안에서 발생한
//    console 호출은 스스로 다시 받아서 처리하는 셈). 실제 txt 다운로드(downloadAtfLogBufferAsTxt)는
//    content-main.js가 격리 world에서 직접 호출하므로, 그 world의 버퍼만 실제로 쓰인다
//    (메인 world 쪽 버퍼는 아무도 다운로드를 트리거하지 않아 그냥 쌓였다 비워지는 정도로 무해함).
//
// ⚠️ 로드 순서: 이 파일은 각 world에서 가장 먼저 로드되어야 한다 - 다른 content-*.js/
//    injected-*.js 파일들의 console.log/warn/error를 전부 놓치지 않고 캡처하기 위해서.

const atfLogBuffer = [];

function pushToAtfLogBuffer(line) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const ts = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
  atfLogBuffer.push(`[${ts}] ${line}`);
}

function downloadAtfLogBufferAsTxt() {
  if (atfLogBuffer.length === 0) return;

  // 🔧 매 검색마다 항상 저장하면 다운로드 폴더에 파일이 계속 쌓여 지저분해진다는 피드백으로,
  //    "오류(ERROR)"나 "진단 로그(🔍 [진단])"가 하나라도 있는 경우에만 저장하도록 함.
  //    깨끗하게 끝난 검색은 파일을 안 남기고 버퍼만 비운다.
  const hasNoteworthyLine = atfLogBuffer.some(
    line => line.includes("[ERROR]") || line.includes("🔍 [진단]")
  );
  if (!hasNoteworthyLine) {
    atfLogBuffer.length = 0;
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
    atfLogBuffer.length = 0; // 다음 검색을 위해 비움
  }
}

// 🖨️ console.log/warn/error를 오버라이드해 원래 동작은 그대로 유지하면서, 동시에 항상
//    postMessage(ATF_CONSOLE_LINE)로 중계한다. 격리 world든 메인 world든 같은 window를
//    공유하므로(콘텐츠 스크립트는 페이지와 JS 변수는 못 나눠 써도 window.postMessage로는
//    서로 통신 가능), 아래 리스너가 자기 자신이 보낸 메시지까지 그대로 받아서 처리한다.
const __atfOrigConsoleLog = console.log.bind(console);
const __atfOrigConsoleWarn = console.warn.bind(console);
const __atfOrigConsoleError = console.error.bind(console);
const __atfStringifyArg = (a) => {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch (e) { return String(a); }
};
const __atfRelayConsoleLine = (line) => {
  try {
    window.postMessage({ type: "ATF_CONSOLE_LINE", message: line }, "*");
  } catch (e) { /* 무시 - 로그 중계 실패가 실제 동작에 영향 주지 않도록 */ }
};
console.log = (...args) => {
  __atfOrigConsoleLog(...args);
  __atfRelayConsoleLine(args.map(__atfStringifyArg).join(" "));
};
console.warn = (...args) => {
  __atfOrigConsoleWarn(...args);
  __atfRelayConsoleLine("[WARN] " + args.map(__atfStringifyArg).join(" "));
};
console.error = (...args) => {
  __atfOrigConsoleError(...args);
  __atfRelayConsoleLine("[ERROR] " + args.map(__atfStringifyArg).join(" "));
};

// 🔐 자기 자신(같은 window)이 보낸 메시지만 신뢰 - 다른 프레임/스크립트가 위조한 메시지는 무시.
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "ATF_CONSOLE_LINE") return;
  if (event.source !== window || event.origin !== location.origin) return;
  pushToAtfLogBuffer(event.data.message);
});
