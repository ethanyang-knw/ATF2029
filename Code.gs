// Code.gs
// 기능: 구글 시트 연동용 Apps Script - 키워드 조회(doGet) / 등록(doPost)

// 저장/조회를 허용할 시트 화이트리스트 - 여기 없는 gid는 서버에서 거부.
// 클라이언트 화면엔 3개만 노출되지만 엔드포인트를 직접 호출하면 임의 gid를 보낼 수 있어서
// 서버 단에서도 반드시 검증해야 함 (sheetName은 위조 가능하므로 신뢰하지 않음)
const ALLOWED_SHEETS = {
  "0": "종교",
  "1945752687": "홍보",
  "1425243656": "노출 불가 키워드"
};

function getAllowedSheet_(spreadsheet, targetGid) {
  const gid = String(targetGid ?? "");

  if (!Object.prototype.hasOwnProperty.call(ALLOWED_SHEETS, gid)) {
    throw new Error("invalid_target_sheet");
  }

  const sheet = spreadsheet.getSheets().find(item => String(item.getSheetId()) === gid);

  if (!sheet || sheet.getName() !== ALLOWED_SHEETS[gid]) {
    throw new Error("sheet_not_found");
  }

  return sheet;
}

function doGet(e) {
  try {
    assertAllowedUser_();
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ result: "forbidden" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    const targetGid = e.parameter && e.parameter.targetGid !== undefined ? String(e.parameter.targetGid) : "0";
    const sheet = getAllowedSheet_(spreadsheet, targetGid);

    const lastRow = sheet.getLastRow();
    let keywords = [];

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
      keywords = values
        .map(row => String(row[0]).trim())
        .filter(val => val !== "" && val !== "null" && val !== "undefined");
    }

    const resultData = {
      result: "success",
      sheetName: sheet.getName(),
      keywords: keywords
    };

    // 순수 JSON으로만 응답
    return ContentService.createTextOutput(JSON.stringify(resultData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const errorData = { result: "error", error: error.toString() };
    return ContentService.createTextOutput(JSON.stringify(errorData))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 배포 설정(액세스 권한)과 무관하게 코드 자체가 요청자 이메일 도메인을 확인해서 이중으로 막는다.
const ALLOWED_DOMAIN = "knworks.co.kr";

function assertAllowedUser_() {
  const email = Session.getActiveUser().getEmail();
  if (!email || !email.endsWith("@" + ALLOWED_DOMAIN)) {
    throw new Error("unauthorized");
  }
  return email;
}

function doPost(e) {
  let actorEmail;
  try {
    actorEmail = assertAllowedUser_();
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ result: "forbidden" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lock = LockService.getDocumentLock();

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter;
    }

    if (!data.value) {
      return ContentService.createTextOutput(JSON.stringify({ result: "error", error: "값이 없습니다." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const targetGid = data.targetGid !== undefined ? String(data.targetGid) : "0";
    const sheet = getAllowedSheet_(spreadsheet, targetGid);

    // 동시 요청(클라이언트가 최대 2개까지 동시 전송)이 같은 빈 행을 골라 서로 덮어쓰지 않도록
    // 빈 행 탐색~저장 구간 전체를 잠금으로 보호
    lock.waitLock(30000);

    let targetRow = 2;
    while (sheet.getRange(targetRow, 2).getValue() !== "") {
      targetRow++;
    }

    let itemNumber = 1;
    if (targetRow > 2) {
      const prevVal = sheet.getRange(targetRow - 1, 2).getValue();
      if (!isNaN(prevVal) && prevVal !== "") {
        itemNumber = Number(prevVal) + 1;
      }
    }

    sheet.getRange(targetRow, 2).setValue(itemNumber);
    sheet.getRange(targetRow, 3).setValue(data.value);

    // 요청자 기록
    try {
      logChange_(spreadsheet, sheet.getName(), data.value, targetRow, actorEmail);
    } catch (logErr) {
      console.error("변경이력 기록 실패:", logErr);
    }

    return ContentService.createTextOutput(JSON.stringify({ result: "success", row: targetRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// 요청자+시간+대상 시트/값/행을 "변경이력" 시트에 기록 (시트 없으면 자동 생성)
function logChange_(spreadsheet, sheetName, value, row, actorEmail) {
  const LOG_SHEET_NAME = "변경이력";
  let logSheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);

  if (!logSheet) {
    logSheet = spreadsheet.insertSheet(LOG_SHEET_NAME);
    logSheet.appendRow(["일시", "요청자", "대상 시트", "추가한 값", "행 번호"]);
    logSheet.getRange(1, 1, 1, 5).setFontWeight("bold");
  }

  logSheet.appendRow([new Date(), actorEmail, sheetName, value, row]);
}
