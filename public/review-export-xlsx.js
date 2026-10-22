/* PIA v0.3.37 — local XLSX (uncompressed ZIP) writer. No server, CDN, or paid APIs. */
(function(root){'use strict';
 const E=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
 const encoder=new TextEncoder();
 const col=n=>{let out='';for(n++;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out};
 const rowXml=(items,n,header=false)=>`<row r="${n}">${items.map((val,i)=>`<c r="${col(i)}${n}" t="inlineStr"${header?' s="1"':''}><is><t xml:space="preserve">${E(String(val??'').slice(0,32767))}</t></is></c>`).join('')}</row>`;
 const SHEETS=[
  {name:'현재검토본_제외체크',heads:['게시물 ID','제외 체크','작성자','아이디','유형','작성일시','본문 전체','부모 ID','중복 판정','대표 게시물 ID','검수 결과','원본 캡처 파일명','사용자 메모','기존 선택 상태']},
  {name:'누적제외목록',heads:['게시물 ID','제외 체크','제외 이력 기록 시각','제외 당시 검토본','작성자','아이디','유형','본문 전체','부모 ID','원본 캡처 파일명','사용자 메모','현재 검토본 포함 여부']},
 ];
 function sheetXml(def,rows){
  const count=rows.length+1,lastCol=col(def.heads.length-1),lastRow=count;
  const body=[rowXml(def.heads,1,true),...rows.map((r,i)=>rowXml(r,i+2))].join('');
  const widths=def.heads.map(h=>/본문/.test(h)?42:/캡처/.test(h)?35:/작성자|아이디|검수/.test(h)?21:/게시물 ID/.test(h)?14:/메모/.test(h)?34:19);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${lastCol}${lastRow}"/></worksheet>`;
 }
 const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C3A57"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf></cellXfs></styleSheet>';
 // Portable ZIP store writer. CRC is required for Excel, which rejects incomplete archives.
 const u16=(n)=>[n&255,(n>>>8)&255],u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
 let crcTable=null;
 function crc32(bytes){if(!crcTable){crcTable=new Uint32Array(256);for(let k=0;k<256;k++){let c=k;for(let j=0;j<8;j++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;crcTable[k]=c>>>0}}let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
 function makeZip(entries){let offset=0,locals=[],central=[],size=0;
  for(const [name,text] of entries){const nm=encoder.encode(name),body=encoder.encode(text),crc=crc32(body);
   const local=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(body.length),...u32(body.length),...u16(nm.length),...u16(0),...nm]);
   locals.push(local,body);
   const cd=new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(body.length),...u32(body.length),...u16(nm.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...nm]);
   central.push(cd);offset+=local.length+body.length;size+=cd.length;
  }
  const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(size),...u32(offset),...u16(0)]);
  return new Blob([...locals,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 }
 function createWorkbook({records,ledger}){
  if(!Array.isArray(records)||!Array.isArray(ledger)||records.length>10000||ledger.length>10000)throw Error('선별 데이터가 올바르지 않습니다.');
  const ids=new Set(records.map(x=>x.id));
  const active=records.map(x=>[x.id,x.choice==='제외'?'제외':'',x.name,x.handle,x.type,x.date,x.content,x.parent,x.duplicate,x.rep,x.audit,x.source,x.memo,x.choice]);
  const hist=ledger.map(x=>[x.id,'제외',x.excludedAt,x.source,x.name,x.handle,x.type,x.content,x.parent,x.filename,x.memo,ids.has(x.id)?'현재 검토본 있음':'이전 회차에서 제외됨']);
  const names=SHEETS.map(s=>s.name);
  const entries=[
   ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
   ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name,i)=>`<sheet name="${E(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
   ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${names.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
   ['xl/styles.xml',styles],
   ...SHEETS.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s,i===0?active:hist)]),
  ];
  return makeZip(entries);
 }
 root.PIAReviewExportXlsx={createWorkbook};
})(typeof window!=='undefined'?window:globalThis);
