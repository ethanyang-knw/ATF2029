// Code.gs
// 기능: 구글 시트 연동용 Apps Script - 키워드 조회(doGet) / 등록(doPost)

function doGet(e) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    const targetGid = e.parameter && e.parameter.targetGid !== undefined ? String(e.parameter.targetGid) : "0";
    const sheetNameHint = e.parameter ? e.parameter.sheetName : "";

    const sheets = spreadsheet.getSheets();
    let sheet = null;

    for (let i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === targetGid) {
        sheet = sheets[i];
        break;
      }
    }

    if (!sheet && sheetNameHint) {
      sheet = spreadsheet.getSheetByName(sheetNameHint);
    }

    if (!sheet) {
      sheet = sheets[0];
    }

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

    // 피드백: JSONP(callback) 분기가 죽은 코드로 남아 콜백 인젝션 위험이 있었음 → 제거, 순수 JSON만 응답
    return ContentService.createTextOutput(JSON.stringify(resultData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const errorData = { result: "error", error: error.toString() };
    return ContentService.createTextOutput(JSON.stringify(errorData))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 피드백: 배포 설정(액세스 권한)이 knworks.co.kr 도메인으로 제한돼 있어도, 그건 배포 화면의
// 설정값일 뿐이라 나중에 누군가 실수로 "모든 사용자"로 바꾸면 그 순간 방어막이 사라진다.
// 배포 설정과 무관하게 코드 자체가 요청자 이메일을 확인해서 이중으로 막아준다.
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
    const sheetNameHint = data.sheetName || "";

    const sheets = spreadsheet.getSheets();
    let sheet = null;

    for (let i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === targetGid) {
        sheet = sheets[i];
        break;
      }
    }

    if (!sheet && sheetNameHint) {
      sheet = spreadsheet.getSheetByName(sheetNameHint);
    }

    if (!sheet) {
      sheet = sheets[0];
    }

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

    // 피드백: 누가 언제 무엇을 등록했는지 추적할 방법이 없었음 → 요청자 기록 추가
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

  logSheet.appendRow([new Date(), actorEmail || "(알수없음)", sheetName, value, row]);
}
