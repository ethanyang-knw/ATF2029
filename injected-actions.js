// injected-actions.js
// content.js가 postMessage로 위임한 블랙/레드글 등록, 화이트리스트 모달, PC 홈 추천/피처링 추천
// (단건·일괄)을 실제 원본 함수(adminB.article.*)로 그대로 호출. 메인 월드(페이지 컨텍스트)에서 실행됨.
console.log("🟢 [ATF2029] injected.js 메인 스크립트 주입 완료");

// 🖤🔴 content.js(격리된 world)는 adminB에 직접 접근할 수 없어서, 메인 스크립트 공간에서
//    대신 호출해준다. 인자 없이 호출해야 원본 사이트가 체크박스 기반 경로를 타면서
//    confirm 확인창을 띄운 뒤 등록하므로(직접 userId/articleNo를 넘기면 확인 없이 즉시 등록되어 위험),
//    항상 타입만 넘기고 인자는 비워둔다.
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "TRIGGER_BLACK_RED_REGISTER") return;
  // 🔐 이 메시지는 항상 content.js가 같은 창(main world)으로 보내는 것만 신뢰한다.
  //    다른 프레임/스크립트가 postMessage로 위조해서 임의로 블랙/레드글 등록을
  //    트리거하는 걸 막기 위한 검증.
  if (event.source !== window || event.origin !== location.origin) return;

  try {
    if (window.adminB && window.adminB.article && typeof window.adminB.article.addBlackRedArticle === 'function') {
      window.adminB.article.addBlackRedArticle(event.data.regType);
    } else {
      console.error("❌ [injected.js] adminB.article.addBlackRedArticle 함수를 찾을 수 없습니다.");
      alert("등록 기능을 찾을 수 없습니다. 페이지를 새로고침한 후 다시 시도해 주세요.");
    }
  } catch (err) {
    console.error("❌ [injected.js] 블랙/레드글 등록 호출 중 오류:", err);
  }
});

// 🤍 "작가 정보" 드롭다운의 "화이트리스트 등록/수정" - 원본 사이트가 쓰는 f(v,"white") 로직을
//    소스 레벨(브레이크포인트+Step Into)로 확인해 그대로 재현한다. 그레이/블랙/레드 유저 등록과
//    달리 JSON API가 아니라, 서버가 렌더링한 HTML 폼 조각을 GET으로 받아와 페이지에 이미 존재하는
//    #whiteModal에 그대로 삽입(innerHTML)한 뒤 jQuery modal로 띄우는 방식이다.
//    이 방식의 장점: 모달 안의 "저장" 버튼은 원본 페이지가 최초 로드 시점에 이미 걸어둔
//    document 레벨 위임 리스너를 그대로 타므로, 우리가 POST /user/white/update.json 로직을
//    따로 구현할 필요 없이 원본 저장 동작이 그대로 재사용된다(Network 캡처로 실제 저장 성공까지 확인됨).
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "TRIGGER_WHITE_MODAL") return;
  if (event.source !== window || event.origin !== location.origin) return;

  const userId = event.data.userId;
  if (!userId) return;

  try {
    const $ = window.jQuery;
    if (!$ || !$.get) {
      console.error("❌ [injected.js] jQuery를 찾을 수 없습니다.");
      alert("화이트리스트 모달을 열 수 없습니다. 페이지를 새로고침한 후 다시 시도해 주세요.");
      return;
    }

    const checkUrl = `/user/white/check?userId=${encodeURIComponent(userId)}`;
    $("#keywordModal").modal("hide"); // 원본과 동일 - 혹시 열려있을 수 있는 다른 모달 정리
    $.get(checkUrl, function (html) {
      $("#whiteModal").html(html);
      $("#whiteModal").modal("show");

      if (window.adminB && window.adminB.keywordMap && typeof window.adminB.keywordMap.init === "function") {
        window.adminB.keywordMap.init();
      }
      $(".btn-category").trigger("click");
      $(".white-level .btn").on("click", function () {
        $(".white-level .btn.active").removeClass("active");
        $(this).addClass("active");
      });
    }).fail(function (xhr) {
      console.error("❌ [injected.js] 화이트리스트 모달 로드 실패:", xhr && xhr.status);
      alert("화이트리스트 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
  } catch (err) {
    console.error("❌ [injected.js] 화이트리스트 모달 호출 중 오류:", err);
  }
});

// 📌 PC 홈 추천/피처링 추천 - articleNo/userId를 명시적으로 넘기는 "단건" 모드로 위임.
//    이 모드는 원본 사이트가 서버에 블랙/레드/미발행 여부를 먼저 확인(GET /article/check/condition)한
//    뒤 confirm 창을 띄우고 등록까지 진행하므로, 우리가 직접 요청을 구성하는 것보다 훨씬 안전하다.
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "TRIGGER_ADD_FEATURE_DATA") return;
  if (event.source !== window || event.origin !== location.origin) return;

  try {
    if (window.adminB && window.adminB.article && typeof window.adminB.article.addFeatureData === 'function') {
      window.adminB.article.addFeatureData(event.data.regType, event.data.articleNo, event.data.userId);
    } else {
      console.error("❌ [injected.js] adminB.article.addFeatureData 함수를 찾을 수 없습니다.");
      alert("추천 기능을 찾을 수 없습니다. 페이지를 새로고침한 후 다시 시도해 주세요.");
    }
  } catch (err) {
    console.error("❌ [injected.js] PC 홈/피처링 추천 호출 중 오류:", err);
  }
});

// 📌 PC 홈 추천/피처링 추천 "일괄" 처리 - adminB.article.addFeatureDataCallback에 직접 위임.
//    contentIdList(여러 건)를 한 번에 넘기면 원본과 동일하게 confirm 1번 + 요청 1번으로
//    전부 처리된다. (원본 사이트의 "인자 없는 일괄 모드"가 내부적으로 최종 호출하는 함수와 동일)
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "TRIGGER_ADD_FEATURE_DATA_BATCH") return;
  if (event.source !== window || event.origin !== location.origin) return;

  try {
    if (window.adminB && window.adminB.article && typeof window.adminB.article.addFeatureDataCallback === 'function') {
      window.adminB.article.addFeatureDataCallback(
        '/article/daily/addFeatureData.json',
        event.data.regType,
        event.data.contentIdList
      );
    } else {
      console.error("❌ [injected.js] adminB.article.addFeatureDataCallback 함수를 찾을 수 없습니다.");
      alert("추천 기능을 찾을 수 없습니다. 페이지를 새로고침한 후 다시 시도해 주세요.");
    }
  } catch (err) {
    console.error("❌ [injected.js] PC 홈/피처링 추천 일괄 호출 중 오류:", err);
  }
});
