/* PIA v0.3.35 - XLSX reader: local browser, no CDN/upload. */
(function(root){
 'use strict';
 const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const required=['게시물 ID','사용자 최종 선택','검수 결과','작성자','아이디','게시물 유형(검수안)','본문 전체(검수안)'];
 const utf8=new TextDecoder('utf-8');
 const bad=t=>{throw Error('엑셀 읽기 실패: '+t)};
 function zipEntries(buffer){
  if(!(buffer instanceof ArrayBuffer))bad('잘못된 파일 데이터입니다.');
  const d=new DataView(buffer),raw=new Uint8Array(buffer);
  if(raw.length>30*1024*1024)bad('파일이 너무 큽니다 (최대 30MB).');
  let end=-1;
  for(let p=raw.length-22;p>=Math.max(0,raw.length-65557);p--){if(d.getUint32(p,true)===0x06054b50){end=p;break}}
  if(end<0)bad('XLSX 형식이 아닙니다.');
  const count=d.getUint16(end+10,true),offset=d.getUint32(end+16,true);
  if(!count||count>1000||offset>=raw.length)bad('압축 목록이 올바르지 않습니다.');
  let pos=offset,total=0;const entries=new Map();
  for(let i=0;i<count;i++){
   if(pos+46>raw.length||d.getUint32(pos,true)!==0x02014b50)bad('ZIP 목록이 손상됐습니다.');
   const flags=d.getUint16(pos+8,true),method=d.getUint16(pos+10,true),size=d.getUint32(pos+20,true),unc=d.getUint32(pos+24,true),nl=d.getUint16(pos+28,true),extra=d.getUint16(pos+30,true),comment=d.getUint16(pos+32,true),local=d.getUint32(pos+42,true);
   if(pos+46+nl+extra+comment>raw.length)bad('ZIP 항목 범위가 잘못됐습니다.');
   const name=utf8.decode(raw.subarray(pos+46,pos+46+nl));pos+=46+nl+extra+comment;
   if(!name.startsWith('xl/')||name.endsWith('/'))continue;
   if((flags&1)||![0,8].includes(method)||unc>24*1024*1024||size>24*1024*1024||total+unc>48*1024*1024)bad('지원하지 않는 압축 항목입니다.');
   if(local+30>raw.length||d.getUint32(local,true)!==0x04034b50)bad('압축 항목이 손상됐습니다.');
   const start=local+30+d.getUint16(local+26,true)+d.getUint16(local+28,true);
   if(start+size>raw.length)bad('항목 크기가 올바르지 않습니다.');
   total+=unc;entries.set(name,{bytes:raw.subarray(start,start+size),method,unc});
  }
  return entries;
 }
 async function unzipText(entries,path){
  const item=entries.get(path);if(!item)bad('필수 항목 누락: '+path);
  if(item.method===0)return utf8.decode(item.bytes);
  if(typeof DecompressionStream!=='function')bad('최신 Chrome 또는 Edge에서 다시 시도해 주세요.');
  const bytes=await new Response(new Blob([item.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  if(bytes.byteLength!==item.unc)bad('압축 해제 크기 불일치: '+path);
  return utf8.decode(bytes);
 }
 function xml(t){const d=new DOMParser().parseFromString(t,'application/xml');if(d.getElementsByTagName('parsererror').length)bad('엑셀 XML 파싱 오류');return d}
 function els(n,name){return n.getElementsByTagNameNS(NS,name)}
 const rich=n=>[...els(n,'t')].map(e=>e.textContent||'').join('');
 function value(c,shared){
  const typ=c.getAttribute('t'),v=els(c,'v')[0]?.textContent||'';
  if(typ==='s')return shared[Number(v)]??'';
  if(typ==='inlineStr')return rich(els(c,'is')[0]||c);
  if(typ==='b')return v==='1'?'TRUE':'FALSE';
  return v;
 }
 function rowsOf(doc,shared){
  const sheetData=els(doc,'sheetData')[0];if(!sheetData)bad('시트 데이터가 없습니다.');
  const rows=[...sheetData.children].filter(x=>x.localName==='row');
  if(rows.length<2)bad('데이터 행이 없습니다.');
  let headers=[];const out=[];
  for(const [ri,row] of rows.entries()){
   const cells=[];
   for(const c of row.children){
    if(c.localName!=='c')continue;
    const m=/^([A-Z]+)\d+$/.exec(c.getAttribute('r')||'');if(!m)continue;
    let col=0;for(const l of m[1])col=col*26+l.charCodeAt(0)-64;
    cells[col-1]=value(c,shared);
   }
   if(ri===0){headers=cells;continue}
   const data={};headers.forEach((name,j)=>{if(name)data[name]=cells[j]??''});
   if(String(data['게시물 ID']||'').trim())out.push(data);
  }
  const missing=required.filter(name=>!headers.includes(name));if(missing.length)bad('필수 열 없음: '+missing.join(', '));
  if(out.length>10000)bad('게시물 10,000건 초과');
  const used=new Set();for(const x of out){const id=String(x['게시물 ID']).trim();if(used.has(id))bad('중복된 ID: '+id);used.add(id)}
  return out;
 }
 async function parseSelectionXlsx(buffer){
  const z=zipEntries(buffer),book=xml(await unzipText(z,'xl/workbook.xml')),rels=xml(await unzipText(z,'xl/_rels/workbook.xml.rels'));
  const sheets=[...els(book,'sheet')];
  const sel=sheets.find(e=>e.getAttribute('name')==='사용자 최종 선별')||sheets.find(e=>e.getAttribute('name')==='전체1041건 검수');
  if(!sel)bad('사용자 최종 선별 시트를 찾지 못했습니다.');
  const id=sel.getAttributeNS(REL,'id'),link=[...rels.documentElement.children].find(e=>e.getAttribute('Id')===id);
  if(!link)bad('시트 링크가 없습니다.');
  let target=link.getAttribute('Target')||'';
  target=target.startsWith('/xl/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target.replace(/^\.\//,'');
  if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(target))bad('허용되지 않는 시트 경로입니다.');
  const shared=z.has('xl/sharedStrings.xml')?[...els(xml(await unzipText(z,'xl/sharedStrings.xml')),'si')].map(rich):[];
  return {sheet:sel.getAttribute('name'),records:rowsOf(xml(await unzipText(z,target)),shared)};
 }
 root.PIAReviewXlsx={parseSelectionXlsx};
})(typeof window!=='undefined'?window:globalThis);
