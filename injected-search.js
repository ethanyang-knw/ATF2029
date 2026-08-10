// injected-search.js
// 발행글 목록 페이지들을 병렬로 수집(REQ_SVELTE_PAGES)하고, 같은 기간 재검색 시 재사용하는
// 메모리 캐시를 관리. 메인 월드(페이지 컨텍스트)에서 실행됨.
// (콘솔 로그를 txt로 저장하기 위한 중계 로직은 console-log.js가 담당 - 이 파일보다 먼저 로드됨)

//    브라우저도 순간적으로 버벅일 수 있어서 배치 단위로 나눠 순차 요청한다.
//    - BATCH_SIZE개씩 동시 요청 → 잠깐 대기 → 다음 배치
//    - 배치 전체가 빈 결과면(=실제 마지막 페이지를 지남) 더 요청하지 않고 조기 종료
// 🔧 페이지 수가 앞으로 계속 늘어날 수 있어서 고정 상한 대신, "빈 배치를 만날 때까지"
//    끝까지 수집한다. MAX_PAGES는 혹시 모를 무한 루프를 막기 위한 안전장치일 뿐,
//    실제로는 거의 항상 그보다 훨씬 전에 빈 배치를 만나 자동 종료된다.
const MAX_PAGES = 5000;  // 안전장치용 상한 (실질적으로는 무제한)
const BATCH_SIZE = 12;   // 한 번에 동시 요청할 페이지 수
const BATCH_DELAY_MS = 50; // 배치 사이 대기 시간 (동시 요청 개수는 그대로라 서버 순간 부담은 안 늘어남)
const EMPTY_BATCHES_TO_STOP = 2; // 🔧 일시적 네트워크 오류로 한 배치만 비었을 때 성급하게 멈추지 않도록, 연속 2번 비어야 종료

// 🔧 캐싱: 같은 발행 시각 범위로 재검색할 때 네트워크 요청 없이 바로 재사용.
//    브라우저 탭을 새로고침하면 사라지는 메모리 캐시(세션 한정).
let rawDataCache = { key: null, articles: null };

// 🔧 주요 진행 로그를 콘솔뿐 아니라 팝업으로도 전달 (검색창 하단에 실시간 표시)
function logProgress(message) {
  console.log(message);
  window.postMessage({ type: "SEARCH_PROGRESS", message }, "*");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 🔧 원본 사이트 자체가 기본으로 "발행 시각 24시간 이내" 게시물만 보여주는 상태라서,
//    아무리 페이지를 많이/끝까지 긁어도 그 24시간 밖의 게시물은 애초에 원본 데이터에
//    존재하지 않아 검색되지 않는 문제가 있었음.
//    원본 사이트의 "직접 지정" 기능이 쓰는 URL 파라미터(time/fromTime/toTime)를
//    우리 검색 조건에 맞게 직접 채워서, 필요한 기간의 데이터가 원본에서부터
//    포함되도록 한다.
function computeTimeRangeParams(filterParams) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} 00:00`;
  // 🔧 direct/month는 "그 날짜의 자정"을 의도한 거라 fmt()의 고정 00:00이 맞지만,
  //    24시간 이내는 "지금 이 순간"이 기준이라 시:분까지 정확히 담아야 한다.
  const fmtWithTime = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  if (filterParams && filterParams.dateEnabled && filterParams.dateType === 'direct' &&
      filterParams.dateStart && filterParams.dateEnd) {
    const from = new Date(`${filterParams.dateStart}T00:00:00`);
    const to = new Date(`${filterParams.dateEnd}T00:00:00`);
    to.setDate(to.getDate() + 1); // 종료일 하루 전체가 포함되도록 다음날 00:00까지
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { time: 'custom', fromTime: fmt(from), toTime: fmt(to) };
    }
    return null;
  }

  // 🔧 "월 단위 지정" - 선택한 달의 1일 00:00 ~ 다음 달 1일 00:00까지를 원본 사이트 조회 범위로 지정
  if (filterParams && filterParams.dateEnabled && filterParams.dateType === 'month' && filterParams.dateMonth) {
    const [y, m] = filterParams.dateMonth.split('-').map(Number);
    if (y && m) {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 1);
      return { time: 'custom', fromTime: fmt(from), toTime: fmt(to) };
    }
    return null;
  }

  if (filterParams && filterParams.dateEnabled && filterParams.dateType === '24h') {
    // 🔧 "사이트 기본값이 알아서 24시간으로 제한해줄 것"이라 가정하고 별도 기간을 안 보냈었는데,
    //    실제로는 그렇지 않아서(페이지네이션을 계속 따라가면 24시간보다 훨씬 오래된 글까지
    //    다 딸려옴) 필요 없는 페이지까지 잔뜩 받아온 뒤 클라이언트에서 뒤늦게 걸러내고
    //    있었음(발견: "조건에 안 맞아 걸러진 글"이 수천 건씩 나오는 문제로 확인됨).
    //    direct/month와 동일하게 "지금-24시간 ~ 지금"을 명시적으로 서버에 요청해서
    //    애초에 필요한 만큼만 받아오도록 수정.
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { time: 'custom', fromTime: fmtWithTime(from), toTime: fmtWithTime(now), nowAnchorMs: now.getTime() };
  }

  // 🔧 날짜 조건이 없는 검색(키워드/제목/매거진/작가 등)은 사이트 기본 24시간 제한에
  //    걸리지 않도록 넓혀야 하지만, 전체 기간(2015~)을 매번 다 훑으면 너무 느려서
  //    기본값은 "최근 1일"로 제한한다(포함/제외 조건만으로 검색 시 사실상 "오늘 날짜로
  //    검색"되는 셈 - popup.js에서 체크 해제 시 이 사실을 안내 메시지로 보여줌).
  //    그보다 더 오래된 글까지 찾고 싶으면 "직접 지정"으로 원하는 기간을 명시하면 된다.
  const DEFAULT_LOOKBACK_DAYS = 1;
  const to = new Date();
  to.setDate(to.getDate() + 1);
  const from = new Date();
  from.setDate(from.getDate() - DEFAULT_LOOKBACK_DAYS);
  return { time: 'custom', fromTime: fmt(from), toTime: fmt(to), isDefaultRange: true, lookbackDays: DEFAULT_LOOKBACK_DAYS };
}

// 🔧 svelteProps는 보통 문서 앞쪽(대략 10~15% 지점)에 있어서, 응답을 끝까지
//    다 받을 필요가 없다. 스트리밍으로 조금씩 읽다가 svelteProps 선언이 통째로
//    도착한 순간 나머지는 안 받고 연결을 바로 끊어버린다(reader.cancel()).
//    서버에 보내는 요청 횟수/빈도는 그대로라 서버 부담은 늘지 않고,
//    우리가 받는 데이터량만 줄어든다.
const SVELTE_PROPS_PATTERN = /svelteProps\s*=\s*\{.*?\};/s;

async function fetchPage(page, timeParams) {
  const targetUrl = new URL(location.href);
  targetUrl.searchParams.set("page", page);
  if (timeParams) {
    targetUrl.searchParams.set("time", timeParams.time);
    targetUrl.searchParams.set("fromTime", timeParams.fromTime);
    targetUrl.searchParams.set("toTime", timeParams.toTime);
  }

  try {
    const res = await fetch(targetUrl.toString(), { credentials: "include" });
    if (!res.ok) return null;

    if (!res.body || !res.body.getReader) {
      // 스트리밍을 지원하지 않는 환경을 위한 폴백 (일반적으로는 여기로 안 옴)
      return await res.text();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (SVELTE_PROPS_PATTERN.test(buffer)) {
        reader.cancel().catch(() => {}); // ✅ 찾았으니 나머지는 받지 않고 바로 끊기
        break;
      }
    }

    return buffer;
  } catch (e) {
    return null;
  }
}

// 🔧 svelteProps에서 게시글 목록뿐 아니라, pageModel.totalPageCount(전체 페이지 수)도 함께 추출.
//    이 값을 알면 "빈 페이지가 나올 때까지 찔러보기" 없이 정확히 필요한 만큼만 요청할 수 있다.
function parseSveltePropsFromHtml(html) {
  if (!html) return null;

  const match = html.match(/svelteProps\s*=\s*(\{.*?\});/s);
  if (!match || !match[1]) return null;

  try {
    const props = JSON.parse(match[1]);
    const dailyList = props.dailyList || props.list || props.articles || [];
    const totalPageCount = props.pageModel && Number.isFinite(props.pageModel.totalPageCount)
      ? props.pageModel.totalPageCount
      : null;
    const totalItemCount = props.pageModel && Number.isFinite(props.pageModel.totalItemCount)
      ? props.pageModel.totalItemCount
      : null;
    return { dailyList, totalPageCount, totalItemCount };
  } catch (e) {
    return null;
  }
}

window.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "REQ_SVELTE_PAGES") return;
  if (event.source !== window || event.origin !== location.origin) return;

  const searchStartedAt = performance.now(); // 🔧 전체 검색 소요시간 측정용

  const filterParams = event.data.params;
  const allArticles = [];
  let totalRequestCount = 0;   // 🔧 요청 성공/실패 집계용
  let failedRequestCount = 0;

  const timeParams = computeTimeRangeParams(filterParams);
  // 🔧 캐시 키: 실제로 어떤 기간의 데이터를 가져왔는지가 기준. 포함/제외 조건은
  //    가져온 데이터 안에서 나중에 필터링하는 것뿐이라 캐시 키에 영향 없음.
  const cacheKey = timeParams ? `${timeParams.fromTime}__${timeParams.toTime}` : '__site_default_24h__';

  const finish = (fromCache = false) => {
    const elapsedSec = ((performance.now() - searchStartedAt) / 1000).toFixed(1);
    logProgress(`⏱️ [injected.js] 총 소요시간: ${elapsedSec}초`);
    if (!fromCache && totalRequestCount > 0) {
      const failRate = ((failedRequestCount / totalRequestCount) * 100).toFixed(1);
      logProgress(`📡 [injected.js] 요청 ${totalRequestCount}건 중 실패 ${failedRequestCount}건 (실패율 ${failRate}%)`);
    }
    logProgress(`✅ [injected.js] 총 ${allArticles.length}개 게시글 원천 데이터 준비 완료${fromCache ? ' (캐시 사용)' : ''}`);
    window.postMessage({
      type: "RES_SVELTE_PAGES",
      articles: allArticles,
      // 🔧 24시간 이내 검색의 경우, 서버 요청에 썼던 "지금" 시각(nowAnchorMs)을 필터링
      //    단계에서도 그대로 재사용하도록 함께 전달 - 검색이 완료되기까지 걸리는 시간만큼
      //    "지금"이 밀려서, 요청 시점엔 24시간 안이었던 경계선 글이 필터링 시점엔 새로
      //    계산한 Date.now() 기준으로 24시간을 살짝 넘겨 잘못 제외되는 문제를 방지.
      filterParams: { ...filterParams, nowAnchorMs: timeParams ? timeParams.nowAnchorMs : undefined },
      usedDefaultRange: !!(timeParams && timeParams.isDefaultRange),
      lookbackDays: timeParams ? timeParams.lookbackDays : null,
      fromCache: fromCache
    }, "*");
  };

  // ✅ 같은 발행 시각 범위로 이미 수집해둔 데이터가 있으면, 네트워크 요청 없이 바로 재사용
  if (rawDataCache.key === cacheKey && rawDataCache.articles) {
    logProgress(`⚡ [injected.js] 캐시 적중 - 이전에 받아둔 ${rawDataCache.articles.length}개 데이터를 그대로 재사용 (새 요청 없음)`);
    allArticles.push(...rawDataCache.articles);
    finish(true);
    return;
  }

  logProgress(`🚀 [injected.js] 1페이지를 먼저 확인해 전체 페이지 수를 파악한 뒤 수집 시작`);
  if (timeParams) {
    logProgress(`🗓️ [injected.js] 조회 기간 범위 지정: ${timeParams.fromTime} ~ ${timeParams.toTime}`);
  }

  try {
    // 1️⃣ 1페이지를 먼저 받아서 전체 페이지 수(totalPageCount)를 확인
    const firstHtml = await fetchPage(1, timeParams);
    totalRequestCount++;
    if (firstHtml === null) failedRequestCount++;
    const firstParsed = parseSveltePropsFromHtml(firstHtml);

    if (firstParsed && firstParsed.dailyList.length > 0) {
      allArticles.push(...firstParsed.dailyList);
      // 🔧 다른 배치 요약 줄(📦 [배치 X~Y])과 마찬가지로 팝업 로그창에도 보이도록 console.log
      //    대신 logProgress를 사용 - 예전엔 1페이지도 일반 배치 흐름 안에 있어서 자연히
      //    보였는데, "1페이지 먼저 확인해 전체 페이지 수 파악" 최적화를 넣으면서 1페이지만
      //    따로 빠지며 콘솔에만 찍히고 팝업엔 안 보이던 부분을 다시 맞춤.
      logProgress(`📦 [1페이지] ${firstParsed.dailyList.length}개 수집 (누적 ${allArticles.length}개)`);
    }

    if (firstParsed && firstParsed.totalPageCount) {
      // ✅ 정확한 전체 페이지 수를 알아냈으니, "빈 페이지 찔러보기" 없이 딱 그만큼만 수집
      const totalPageCount = firstParsed.totalPageCount;
      logProgress(`🎯 [injected.js] 전체 페이지 수 확인됨: ${totalPageCount}페이지`);

      for (let batchStart = 2; batchStart <= totalPageCount; batchStart += BATCH_SIZE) {
        const batchStartedAt = performance.now(); // 🔧 배치별 소요시간 측정
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPageCount);
        const pageNumbers = [];
        for (let p = batchStart; p <= batchEnd; p++) pageNumbers.push(p);

        const htmlTexts = await Promise.all(pageNumbers.map(p => fetchPage(p, timeParams)));

        let batchArticleCount = 0;
        let batchFailCount = 0;
        htmlTexts.forEach((html, idx) => {
          const pageNum = pageNumbers[idx];
          totalRequestCount++;
          if (html === null) {
            failedRequestCount++;
            batchFailCount++;
            return;
          }
          const parsed = parseSveltePropsFromHtml(html);
          if (parsed && parsed.dailyList.length > 0) {
            allArticles.push(...parsed.dailyList);
            batchArticleCount += parsed.dailyList.length;
            console.log(`  └─ [${pageNum}페이지] ${parsed.dailyList.length}개 원천 게시글 추출 성공`);
          }
        });

        const batchElapsedSec = ((performance.now() - batchStartedAt) / 1000).toFixed(2);
        const failNote = batchFailCount > 0 ? `, 실패 ${batchFailCount}건` : '';
        logProgress(`📦 [배치 ${batchStart}~${batchEnd}/${totalPageCount}] ${batchArticleCount}개 수집 (누적 ${allArticles.length}개, ${batchElapsedSec}초 소요${failNote})`);

        if (batchEnd < totalPageCount) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      rawDataCache = { key: cacheKey, articles: allArticles.slice() }; // ✅ 다음 재검색을 위해 캐시에 저장
      finish();
      return;
    }

    // 2️⃣ (폴백) totalPageCount를 못 구한 경우에만, 예전처럼 빈 배치가 나올 때까지 찔러보기
    logProgress(`⚠️ [injected.js] 전체 페이지 수를 확인 못 함 - 빈 배치가 나올 때까지 탐색하는 방식으로 진행`);
    let consecutiveEmptyBatches = 0;

    for (let batchStart = 2; batchStart <= MAX_PAGES; batchStart += BATCH_SIZE) {
      const batchStartedAt = performance.now(); // 🔧 배치별 소요시간 측정
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, MAX_PAGES);
      const pageNumbers = [];
      for (let p = batchStart; p <= batchEnd; p++) pageNumbers.push(p);

      const htmlTexts = await Promise.all(pageNumbers.map(p => fetchPage(p, timeParams)));

      let batchArticleCount = 0;
      let batchFailCount = 0;
      htmlTexts.forEach((html, idx) => {
        const pageNum = pageNumbers[idx];
        totalRequestCount++;
        if (html === null) {
          failedRequestCount++;
          batchFailCount++;
          return;
        }
        const parsed = parseSveltePropsFromHtml(html);
        if (parsed && parsed.dailyList.length > 0) {
          allArticles.push(...parsed.dailyList);
          batchArticleCount += parsed.dailyList.length;
          console.log(`  └─ [${pageNum}페이지] ${parsed.dailyList.length}개 원천 게시글 추출 성공`);
        }
      });

      const batchElapsedSec = ((performance.now() - batchStartedAt) / 1000).toFixed(2);
      const failNote = batchFailCount > 0 ? `, 실패 ${batchFailCount}건` : '';
      logProgress(`📦 [배치 ${batchStart}~${batchEnd}] ${batchArticleCount}개 수집 (누적 ${allArticles.length}개, ${batchElapsedSec}초 소요${failNote})`);

      if (batchArticleCount === 0) {
        consecutiveEmptyBatches++;
        logProgress(`⚠️ [injected.js] ${batchStart}~${batchEnd}페이지 빈 배치 (연속 ${consecutiveEmptyBatches}/${EMPTY_BATCHES_TO_STOP})`);
        if (consecutiveEmptyBatches >= EMPTY_BATCHES_TO_STOP) {
          logProgress(`🛑 [injected.js] 연속 ${EMPTY_BATCHES_TO_STOP}개 배치가 비어 마지막 페이지로 판단, 수집 종료`);
          break;
        }
      } else {
        consecutiveEmptyBatches = 0;
      }

      if (batchEnd < MAX_PAGES) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    rawDataCache = { key: cacheKey, articles: allArticles.slice() }; // ✅ 다음 재검색을 위해 캐시에 저장
    finish();
  } catch (err) {
    console.error("❌ [injected.js] 수집 도중 오류 발생:", err);
    // 🔧 도중에 오류가 나서 불완전할 수 있는 데이터는 캐시하지 않음
    finish();
  }
});
