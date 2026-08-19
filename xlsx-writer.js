// xlsx-writer.js
// 기능: 검색 결과를 .xlsx(엑셀) 파일로 만드는 유틸리티
// 외부 라이브러리 없이 순수 JS로 ZIP 포맷 + OOXML(엑셀 XML 스키마)을 직접 구현한다.
// 확장 환경에서는 외부 CDN 스크립트를 실행 시점에 불러올 수 없어서 직접 구현했다.
// content-main.js의 다운로드 로직이 window.ATF_buildXlsxBlob(sheetName, columns, dataRows)
// 하나만 호출해서 쓰는, 완전히 독립된 유틸이라 별도 파일로 분리했다.

(function () {
  // CRC32 (ZIP 포맷 필수)
  const CRC_TABLE = (() => {
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // 압축 없는 STORED 방식 ZIP 작성기
  function writeUint32LE(arr, offset, val) {
    arr[offset] = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
    arr[offset + 2] = (val >>> 16) & 0xFF;
    arr[offset + 3] = (val >>> 24) & 0xFF;
  }
  function writeUint16LE(arr, offset, val) {
    arr[offset] = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      writeUint32LE(localHeader, 0, 0x04034b50);
      writeUint16LE(localHeader, 4, 20);
      writeUint16LE(localHeader, 6, 0);
      writeUint16LE(localHeader, 8, 0);
      writeUint16LE(localHeader, 10, 0);
      writeUint16LE(localHeader, 12, 0x21);
      writeUint32LE(localHeader, 14, crc);
      writeUint32LE(localHeader, 18, data.length);
      writeUint32LE(localHeader, 22, data.length);
      writeUint16LE(localHeader, 26, nameBytes.length);
      writeUint16LE(localHeader, 28, 0);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      writeUint32LE(centralHeader, 0, 0x02014b50);
      writeUint16LE(centralHeader, 4, 20);
      writeUint16LE(centralHeader, 6, 20);
      writeUint16LE(centralHeader, 8, 0);
      writeUint16LE(centralHeader, 10, 0);
      writeUint16LE(centralHeader, 12, 0);
      writeUint16LE(centralHeader, 14, 0x21);
      writeUint32LE(centralHeader, 16, crc);
      writeUint32LE(centralHeader, 20, data.length);
      writeUint32LE(centralHeader, 24, data.length);
      writeUint16LE(centralHeader, 28, nameBytes.length);
      writeUint16LE(centralHeader, 30, 0);
      writeUint16LE(centralHeader, 32, 0);
      writeUint16LE(centralHeader, 34, 0);
      writeUint16LE(centralHeader, 36, 0);
      writeUint32LE(centralHeader, 38, 0);
      writeUint32LE(centralHeader, 42, offset);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    });

    const centralDirOffset = offset;
    let centralDirSize = 0;
    centralParts.forEach(p => { centralDirSize += p.length; });

    const eocd = new Uint8Array(22);
    writeUint32LE(eocd, 0, 0x06054b50);
    writeUint16LE(eocd, 4, 0);
    writeUint16LE(eocd, 6, 0);
    writeUint16LE(eocd, 8, files.length);
    writeUint16LE(eocd, 10, files.length);
    writeUint32LE(eocd, 12, centralDirSize);
    writeUint32LE(eocd, 16, centralDirOffset);
    writeUint16LE(eocd, 20, 0);

    const totalSize = offset + centralDirSize + eocd.length;
    const result = new Uint8Array(totalSize);
    let pos = 0;
    localParts.forEach(p => { result.set(p, pos); pos += p.length; });
    centralParts.forEach(p => { result.set(p, pos); pos += p.length; });
    result.set(eocd, pos);

    return result;
  }

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  // 엑셀 열 문자(A~Z, AA, AB...) 계산 - 컬럼 수 제한 없이 정확한 열 문자 생성
  function colIndexToLetters(index) {
    let n = index + 1;
    let result = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  // 문자열 표시 너비 계산 (한글/한자 등 2바이트 문자는 넓게 취급)
  function visualWidth(str) {
    let width = 0;
    for (const ch of String(str ?? '')) {
      width += ch.charCodeAt(0) > 0x2E80 ? 1.9 : 1;
    }
    return width;
  }

  // 최소 유효한 xlsx 구성(OOXML) 생성
  function buildXlsxBlob(sheetName, columns, dataRows) {
    const encoder = new TextEncoder();

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

    // 스타일: 0=기본, 1=헤더(굵게+배경+가운데), 2=가운데정렬, 3=하이퍼링크
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE9AE"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const STYLE_HEADER = 1;
    const STYLE_CENTER = 2;
    const STYLE_HYPERLINK = 3;

    const styleForColumn = (col) => {
      if (col.hyperlink) return STYLE_HYPERLINK;
      if (col.align === 'center') return STYLE_CENTER;
      return 0;
    };

    const cellXml = (colIndex, rowIndex, value, styleIdx, isNumeric) => {
      const ref = `${colIndexToLetters(colIndex)}${rowIndex}`;
      const s = styleIdx ? ` s="${styleIdx}"` : '';
      if (isNumeric && value !== '' && value !== null && !isNaN(Number(value))) {
        return `<c r="${ref}"${s}><v>${Number(value)}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    };

    const HEADER_ROW_HEIGHT = 20;
    const DATA_ROW_HEIGHT = 20;

    const rowsXml = [];
    rowsXml.push(
      `<row r="1" ht="${HEADER_ROW_HEIGHT}" customHeight="1">${columns.map((col, i) => cellXml(i, 1, col.header, STYLE_HEADER, false)).join('')}</row>`
    );

    const hyperlinkRels = [];
    const hyperlinkRefs = [];

    dataRows.forEach((row, rIdx) => {
      const rowNum = rIdx + 2;
      const cells = columns.map((col, cIdx) => {
        const value = row[cIdx];
        const styleIdx = styleForColumn(col);

        if (col.hyperlink && value) {
          const rId = `rIdLink${hyperlinkRels.length + 1}`;
          hyperlinkRels.push({ id: rId, target: value });
          hyperlinkRefs.push({ ref: `${colIndexToLetters(cIdx)}${rowNum}`, rId });
        }

        return cellXml(cIdx, rowNum, value, styleIdx, !!col.numeric);
      });
      rowsXml.push(`<row r="${rowNum}" ht="${DATA_ROW_HEIGHT}" customHeight="1">${cells.join('')}</row>`);
    });

    // 자동 열 너비 (헤더+데이터 중 최대 표시너비, widthCap 상한)
    const colsXml = columns.map((col, i) => {
      let maxW = visualWidth(col.header);
      dataRows.forEach(row => {
        const w = visualWidth(row[i]);
        if (w > maxW) maxW = w;
      });
      const cap = col.widthCap || 60;
      const width = Math.max(8, Math.min(Math.ceil(maxW) + 3, cap));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    }).join('');

    const hyperlinksXml = hyperlinkRefs.length
      ? `<hyperlinks>${hyperlinkRefs.map(h => `<hyperlink ref="${h.ref}" r:id="${h.rId}"/>`).join('')}</hyperlinks>`
      : '';

    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<cols>${colsXml}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
${hyperlinksXml}
</worksheet>`;

    const files = [
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
      { name: '_rels/.rels', data: encoder.encode(rootRels) },
      { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
      { name: 'xl/styles.xml', data: encoder.encode(styles) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet1) }
    ];

    if (hyperlinkRels.length > 0) {
      const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hyperlinkRels.map(h => `<Relationship Id="${h.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(h.target)}" TargetMode="External"/>`).join('\n')}
</Relationships>`;
      files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: encoder.encode(sheetRels) });
    }

    const zipBytes = buildZip(files);
    return new Blob([zipBytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  window.ATF_buildXlsxBlob = buildXlsxBlob;
})();
