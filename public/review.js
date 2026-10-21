/* PIA v0.3.35 — Private pre-import selection, no DB write or outbound upload. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validChoices=new Set(['미선택','등록','제외','보류']);
 const state={records:[],byId:new Map(),currentPage:0,filtered:[],fingerprint:'',source:'',images:new Map(),urls:[],modalUrl:'',issuesOpen:false,db:null};
 const $all=id=>Array.from(document.querySelectorAll(id));
 let toastTimer,typingTimer;
 function notify(message,error=false){const t=$('toast');t.textContent=message;t.classList.toggle('error',error);t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,4400)}
 function saveLabel(v){$('saveState').textContent=v}
 function normalizedChoice(v){return validChoices.has(v)?v:'미선택'}
 function recordOf(raw){
  const fields={...raw};delete fields['원본 열기']; // Do not preserve or export local absolute paths.
  const field=k=>String(fields[k]??'');
  const id=field('게시물 ID').trim();
  const rep=field('대표 게시물 ID').trim();
  return {id,name:field('작성자'),handle:field('아이디'),type:field('게시물 유형(검수안)'),date:field('작성일시(검수안)'),content:field('본문 전체(검수안)'),parent:field('부모 ID(검수안)').trim(),parentOriginal:field('부모 ID(원본)').trim(),duplicate:field('중복 판정'),rep,audit:field('검수 결과'),source:field('원본 캡처 파일명'),dateStatus:field('날짜 판정'),notes:field('추가검토사항'),relation:field('관계 검수'),bodyReview:field('본문 검수'),accountReview:field('계정 검수'),quoteName:field('인용 작성자'),quoteHandle:field('인용 아이디'),quoteContent:field('인용 본문 전체'),quoteDate:field('인용 작성일시(원본)'),memo:field('사용자 메모'),choice:normalizedChoice(field('사용자 최종 선택')),fields};
 }
 function cleanRecord(v){ // strict local-JSON shape validation, no execution or HTML rendering.
  if(!v||typeof v!=='object'||!v.fields||!v.id)return null;
  const x=recordOf(v.fields);
  if(x.id!==v.id)return null;
  x.choice=normalizedChoice(v.choice);x.memo=String(v.memo??'').slice(0,2000);x.fields['사용자 최종 선택']=x.choice;x.fields['사용자 메모']=x.memo;
  return x;
 }
 function openDatabase(){return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(Error('브라우저 로컬 저장소를 사용할 수 없습니다.'));return}
  const request=indexedDB.open('pia-preimport-review-v1',1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('data');db.createObjectStore('choices',{keyPath:'id'})};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 })}
 function dbGet(store,key){return new Promise((ok,bad)=>{const req=state.db.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>ok(req.result);req.onerror=()=>bad(req.error)})}
 function dbPut(store,obj,key){return new Promise((ok,bad)=>{const tx=state.db.transaction(store,'readwrite');const req=key===undefined?tx.objectStore(store).put(obj):tx.objectStore(store).put(obj,key);tx.oncomplete=()=>ok(req.result);tx.onerror=()=>bad(tx.error);tx.onabort=()=>bad(tx.error)})}
 function dbSaveBundle(bundle){return new Promise((ok,bad)=>{const tx=state.db.transaction(['data','choices'],'readwrite');tx.objectStore('data').put(bundle,'active');tx.objectStore('choices').clear();for(const x of bundle.records)if(x.choice!=='미선택'||x.memo)tx.objectStore('choices').put({id:x.id,choice:x.choice,memo:x.memo});tx.oncomplete=ok;tx.onerror=()=>bad(tx.error);tx.onabort=()=>bad(tx.error)})}
 function dbLoadChoices(){return new Promise((ok,bad)=>{const req=state.db.transaction('choices','readonly').objectStore('choices').getAll();req.onsuccess=()=>ok(req.result||[]);req.onerror=()=>bad(req.error)})}
 function setRecords(records,fp,source){
  if(!Array.isArray(records)||!records.length||records.length>10000)throw Error('게시물 데이터가 올바르지 않습니다.');
  const ids=new Set();for(const x of records){if(!/^P\d{3,6}$/.test(x.id)||ids.has(x.id))throw Error('게시물 ID가 잘못됐거나 중복입니다: '+x.id);ids.add(x.id)}
  state.records=records;state.byId=new Map(records.map(r=>[r.id,r]));state.fingerprint=fp;state.source=source;
  state.currentPage=0;state.issuesOpen=false;
  const authors=[...new Set(records.map(x=>x.handle||x.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('authorFilter').innerHTML='<option value="">전체 작성자</option>'+authors.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ['query','authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter'].forEach(id=>$(id).value='');$('sortFilter').value='original';
  ['exportCsv','exportJson','openIssues'].forEach(id=>$(id).disabled=false);
  refresh();
 }
 async function digest(buffer){const bytes=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
 async function importWorkbook(file){
  if(!file)return;
  saveLabel('엑셀 분석 중…');
  const buffer=await file.arrayBuffer();const {records:rows}=await window.PIAReviewXlsx.parseSelectionXlsx(buffer);
  const fingerprint=await digest(buffer),old=state.fingerprint;
  if(old&&old!==fingerprint&&!confirm(`지금 열려 있는 ${state.records.length}건의 선별 데이터를 새 파일로 바꿀까요?\n교체 전에 진행 내용 백업 JSON을 받는 것을 권장합니다.`)){saveLabel('교체 취소');return}
  const data=rows.map(recordOf);
  // Reopening an unchanged workbook restores previously saved choices from this browser.
  if(old===fingerprint&&state.records.length){for(const x of data){const prev=state.byId.get(x.id);if(prev){x.choice=prev.choice;x.memo=prev.memo;x.fields['사용자 최종 선택']=x.choice;x.fields['사용자 메모']=x.memo}}}
  const bundle={format:'pia-review-v1',fingerprint,source:file.name,records:data,updatedAt:new Date().toISOString()};
  if(state.db)await dbSaveBundle(bundle);
  setRecords(data,fingerprint,file.name);
  saveLabel(state.db?`${data.length.toLocaleString()}건 불러옴 · 자동 저장됨`:'로컬 저장 불가 · 반드시 JSON 백업');
  notify(`${data.length.toLocaleString()}건을 불러왔습니다. 아직 PIA DB에는 등록하지 않았습니다.`);
 }
 async function restoreBackup(file){
  if(!file)return;
  const payload=JSON.parse(await file.text());
  if(payload?.format!=='pia-review-v1'||!Array.isArray(payload.records)||payload.records.length<1||payload.records.length>10000)throw Error('이 화면에서 생성된 PIA 선별 백업 JSON이 아닙니다.');
  const records=payload.records.map(cleanRecord);
  if(records.some(x=>!x))throw Error('백업 데이터가 손상됐거나 필수 항목이 없습니다.');
  if(state.records.length&&!confirm('현재 선별 작업을 백업 내용으로 교체할까요? 저장 중인 결과는 덮어씁니다.'))return;
  const fingerprint=String(payload.fingerprint||'backup-'+Date.now()),source=String(payload.source||'JSON 백업');
  if(state.db)await dbSaveBundle({format:'pia-review-v1',fingerprint,source,records,updatedAt:new Date().toISOString()});
  setRecords(records,fingerprint,source);saveLabel(state.db?'백업 복원 완료 · 자동 저장됨':'로컬 저장 불가 · 반드시 JSON 백업');notify(`선별 결과 ${records.length.toLocaleString()}건을 복원했습니다.`);
 }
 async function resume(){
  try{state.db=await openDatabase();const bundle=await dbGet('data','active');if(!bundle?.records?.length)return;
   const records=bundle.records.map(cleanRecord);if(records.some(x=>!x))throw Error('로컬 저장 데이터가 손상됐습니다.');
   const choices=await dbLoadChoices(),map=new Map(choices.map(x=>[x.id,x]));
   for(const x of records){const choice=map.get(x.id);if(choice){x.choice=normalizedChoice(choice.choice);x.memo=String(choice.memo||'');x.fields['사용자 최종 선택']=x.choice;x.fields['사용자 메모']=x.memo}}
   setRecords(records,bundle.fingerprint,bundle.source);saveLabel(`${records.length.toLocaleString()}건 · 이전 작업 복원`);
  }catch(e){saveLabel('로컬 저장 불가 · 백업을 자주 받아 주세요');notify('자동 저장 복원 실패: '+e.message,true)}
 }
 function ensureSave(record){
  if(!state.db){saveLabel('로컬 저장 불가 · 반드시 JSON 백업');return}
  saveLabel('선택 저장 중…');
  dbPut('choices',{id:record.id,choice:record.choice,memo:record.memo}).then(()=>saveLabel('자동 저장됨 · JSON 백업 권장')).catch(e=>{saveLabel('저장 실패 · JSON 백업 필요');notify('로컬 자동 저장 실패: '+e.message,true)});
 }
 function ensureMemoSave(record){ensureSave(record)}
 function decisionTotals(){const c={미선택:0,등록:0,제외:0,보류:0};for(const x of state.records)c[x.choice]++;return c}
 function issues(){
  const out=[],done=new Set();
  for(const x of state.records){
   if(x.choice!=='등록')continue;
   if(x.rep&&x.rep!==x.id&&x.duplicate.includes('확정')){
    const rep=state.byId.get(x.rep);
    if(rep?.choice==='등록'&&!done.has([x.id,x.rep].sort().join('-'))){out.push({id:x.id,message:`중복 ${x.id} · ${x.rep} 양쪽 모두 등록 선택`});done.add([x.id,x.rep].sort().join('-'))}
   }
   if(x.type==='reply'){
    if(!x.parent)out.push({id:x.id,message:`답글 ${x.id}의 부모 게시물 미확인`});
    else{const parent=state.byId.get(x.parent);if(parent?.choice==='제외')out.push({id:x.id,message:`답글 ${x.id}의 부모 ${x.parent}가 제외 상태`});if(!parent)out.push({id:x.id,message:`답글 ${x.id}의 부모 ${x.parent}가 선별표에 없음`})}
   }
   if(!x.date.trim())out.push({id:x.id,message:`${x.id} 작성 날짜·시간 미확정`});
   if(x.audit==='확인 불가')out.push({id:x.id,message:`${x.id} 검수 상태: 확인 불가`});
  }
  return out;
 }
 function updateSummary(){const c=decisionTotals();$('countAll').textContent=state.records.length.toLocaleString();$('countNone').textContent=c.미선택.toLocaleString();$('countKeep').textContent=c.등록.toLocaleString();$('countExclude').textContent=c.제외.toLocaleString();$('countHold').textContent=c.보류.toLocaleString();const is=issues();$('issueCount').textContent=is.length;return is}
 function filteredRows(){
  const q=$('query').value.trim().toLocaleLowerCase(),exactId=/^p\d{3,6}$/.test(q),author=$('authorFilter').value,audit=$('auditFilter').value,choice=$('choiceFilter').value,type=$('typeFilter').value,dup=$('duplicateFilter').value,sort=$('sortFilter').value;
  const rows=state.records.filter(x=>{
   if(q&&(exactId?x.id.toLocaleLowerCase()!==q:![x.id,x.name,x.handle,x.content,x.quoteContent,x.source,x.notes].some(t=>String(t||'').toLocaleLowerCase().includes(q))))return false;
   if(author&&(x.handle||x.name)!==author)return false;
   if(audit&&x.audit!==audit)return false;if(choice&&x.choice!==choice)return false;
   if(type&&x.type!==type)return false;
   if(dup==='confirmed'&&!x.duplicate.includes('확정 중복'))return false;
   if(dup==='suspected'&&!x.duplicate.includes('중복 의심'))return false;
   if(dup==='clean'&&!x.duplicate.includes('후보 미검출'))return false;
   return true;
  });
  if(sort==='author')rows.sort((a,b)=>(a.handle||a.name).localeCompare(b.handle||b.name,'ko')||a.id.localeCompare(b.id));
  if(sort==='audit'){const rank={'확인 불가':0,'중복':1,'수정':2,'보류':3,'정상':4};rows.sort((a,b)=>(rank[a.audit]??9)-(rank[b.audit]??9)||a.id.localeCompare(b.id))}
  if(sort==='date')rows.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id));
  return rows;
 }
 function filenameOf(source){const first=String(source||'').split(/[;,\n]/).map(x=>x.trim()).find(Boolean)||'';return first.split(/[\\/]/).pop()}
 function imageFileFor(record){const source=String(record.source||'').split(/[;,\n]/).map(x=>x.trim().split(/[\\/]/).pop().toLowerCase());return source.map(name=>state.images.get(name)).find(Boolean)}
 function revokeThumbs(){for(const u of state.urls)URL.revokeObjectURL(u);state.urls=[]}
 function renderCard(x){
  const parent=state.byId.get(x.parent),rep=state.byId.get(x.rep),img=imageFileFor(x);
  const typeName={post:'원글',reply:'답글',quote:'인용'}[x.type]||x.type;
  const reviewColor=x.audit==='정상'?'good':x.audit==='보류'||x.audit==='수정'?'warn':x.audit==='중복'||x.audit==='확인 불가'?'bad':'';
  const parentHtml=x.type==='reply'?`<div class="parent-card"><div class="section-label">↳ 답글 대상 ${x.parent?'· '+esc(x.parent):'· 미확정'}</div>${parent?`<strong class="quote-author">${esc(parent.name)} · ${esc(parent.handle)}</strong><p>${esc(parent.content.slice(0,340))}</p><button type="button" class="jump" data-jump="${esc(parent.id)}">원글 확인 ↗</button>`:'<p>답글 부모가 확인되지 않았습니다. 등록 전 연결 검토가 필요합니다.</p>'}</div>`:'';
  const dupHtml=x.duplicate.includes('확정 중복')||x.duplicate.includes('중복 의심')?`<p><strong>${esc(x.duplicate)}</strong>${x.rep?' · 대표 후보 '+esc(x.rep):''} ${rep?`<button type="button" class="jump" data-jump="${esc(rep.id)}">대표 게시물 보기 ↗</button>`:''}</p>`:'';
  const quoteHtml=x.quoteContent?`<div class="quote-card"><div class="quote-label">인용된 게시물</div><div class="quote-author">${esc(x.quoteName||'작성자 미확정')} <span class="handle">${esc(x.quoteHandle)}</span></div><p>${esc(x.quoteContent)}</p>${x.quoteDate?`<small>${esc(x.quoteDate)}</small>`:''}</div>`:'';
  let pic='';if(img){const url=URL.createObjectURL(img);state.urls.push(url);pic=`<img class="snapshot-thumb" src="${esc(url)}" loading="lazy" alt="${esc(x.id)} 원본 캡처 미리보기" data-show-image="${esc(x.id)}">`}
  const issueText=[x.notes,x.dateStatus,x.relation].filter(Boolean).join(' · ').slice(0,1400);
  const note=x.memo||'';
  return `<article class="post-card" id="card-${esc(x.id)}" data-post-id="${esc(x.id)}"><div class="avatar">${esc((x.name||'?').trim()[0]||'?')}</div><div class="post-main"><div class="post-head"><strong class="display-name">${esc(x.name||'작성자 미확정')}</strong><span class="handle">${esc(x.handle||'@아이디 미확정')}</span><span class="post-time">${esc(x.date||'시각 미확정')}</span><span class="post-id">${esc(x.id)}</span></div><div class="chips"><span class="chip">${esc(typeName)}</span><span class="chip ${reviewColor}">${esc('검수: '+x.audit)}</span>${x.duplicate.includes('확정 중복')?'<span class="chip bad">확정 중복</span>':x.duplicate.includes('중복 의심')?'<span class="chip warn">중복 의심</span>':''}${x.dateStatus.includes('시간추정')?'<span class="chip warn">시간 +5분 추정</span>':''}</div>${parentHtml}<div class="post-body">${esc(x.content||'[본문 없음 · 원본 확인 필요]')}</div>${quoteHtml}<div class="evidence"><p><strong>원본</strong> · ${esc(filenameOf(x.source)||'미확정')}</p>${dupHtml}${issueText?`<p><strong>검수 메모</strong> · ${esc(issueText)}</p>`:''}${pic}<button type="button" data-show-image="${esc(x.id)}" class="image-open" ${!img?'disabled title="원본 캡처 폴더 연결 후 사용 가능"':''}>${img?'🔎 원본 캡처 확대':'📷 캡처 폴더 연결 후 이미지 확인'}</button></div><div class="review-controls"><span>보관 여부</span>${[['등록','keep'],['제외','exclude'],['보류','hold'],['미선택','none']].map(([label,cls])=>`<button type="button" class="choice ${cls}${x.choice===label?' selected':''}" data-choose="${esc(label)}" data-id="${esc(x.id)}" aria-pressed="${x.choice===label}">${esc(label)}</button>`).join('')}</div><label class="memo-label" for="memo-${esc(x.id)}">선별 메모<textarea id="memo-${esc(x.id)}" data-memo="${esc(x.id)}" maxlength="2000" rows="2" placeholder="제외 이유 또는 나중에 확인할 내용">${esc(note)}</textarea></label></div></article>`;
 }
 function renderIssues(items){
  const existing=$('issueDetails');if(existing)existing.remove();if(!state.issuesOpen||!items.length)return;
  const section=document.createElement('div');section.className='issue-list';section.id='issueDetails';
  section.innerHTML=`<h3>등록 선택 게시물에서 확인할 항목 ${items.length}개</h3>`+items.slice(0,50).map(i=>`<p><button type="button" data-jump="${esc(i.id)}">${esc(i.id)}</button> · ${esc(i.message)}</p>`).join('')+(items.length>50?`<p>외 ${items.length-50}개. 선택 결과를 백업해 추가 검토해 주세요.</p>`:'');
  $('feed').before(section);
 }
 function refresh(){
  const items=updateSummary(),all=filteredRows(),size=Number($('pageSize').value)||20;
  state.filtered=all;state.currentPage=Math.min(state.currentPage,Math.max(0,Math.ceil(all.length/size)-1));
  const page=all.slice(state.currentPage*size,(state.currentPage+1)*size);
  $('shownCount').textContent=`전체 ${state.records.length.toLocaleString()}건 중 ${all.length.toLocaleString()}건 표시`;
  $('pageLabel').textContent=`이 페이지 ${page.length}건 · 일괄 선택은 다시 변경 가능`;
  $('pageInfo').textContent=all.length?`${state.currentPage+1} / ${Math.ceil(all.length/size)} 페이지`:'—';
  $('prevPage').disabled=state.currentPage===0||!all.length;$('nextPage').disabled=(state.currentPage+1)*size>=all.length;
  ['bulkKeep','bulkExclude','bulkHold'].forEach(id=>$(id).disabled=!page.length);
  revokeThumbs();$('feed').innerHTML=page.length?page.map(renderCard).join(''):`<div class="empty-state"><strong>${state.records.length?'검색 조건에 맞는 게시물이 없습니다.':'아직 불러온 데이터가 없어요'}</strong><p>${state.records.length?'필터를 변경해 주세요.':'Work의 사용자 최종 선별표 엑셀을 불러오세요.'}</p></div>`;
  renderIssues(items);
 }
 function setChoice(id,choice){
  const x=state.byId.get(id);if(!x||!validChoices.has(choice))return;
  if(choice==='등록'&&x.rep&&x.rep!==x.id&&x.duplicate.includes('확정')&&!confirm(`${id}는 ${x.rep}의 확정 중복입니다. 원칙적으로 대표 게시물만 등록하는 것을 권장합니다. 그래도 등록으로 표시할까요?`))return;
  x.choice=choice;x.fields['사용자 최종 선택']=choice;ensureSave(x);refresh();
 }
 function filteredPage(){const size=Number($('pageSize').value)||20;return state.filtered.slice(state.currentPage*size,(state.currentPage+1)*size)}
 function chooseBulk(choice){const items=filteredPage();if(!items.length)return;
  const confirmed=items.filter(x=>x.rep&&x.rep!==x.id&&x.duplicate.includes('확정'));
  if(!confirm(`현재 페이지 ${items.length}건을 모두 「${choice}」로 표시할까요?\n${choice==='등록'&&confirmed.length?`⚠ 이 안에 확정 중복 게시물 ${confirmed.length}건이 포함되어 있습니다.\n`:''}선택은 나중에 바꿀 수 있으며 실제 DB에는 등록하지 않습니다.`))return;
  for(const x of items){x.choice=choice;x.fields['사용자 최종 선택']=choice;ensureSave(x)}refresh();notify(`${items.length}건을 「${choice}」로 표시했습니다.`);
 }
 function jumpTo(id){if(!state.byId.has(id)){notify('선별표에 해당 ID가 없습니다.',true);return}
  $('query').value=id;['authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter'].forEach(k=>$(k).value='');state.currentPage=0;refresh();const target=$('card-'+id);target?.scrollIntoView({behavior:'smooth',block:'start'});
 }
 function closeModal(){if(state.modalUrl){URL.revokeObjectURL(state.modalUrl);state.modalUrl=''}$('imageModal').hidden=true;$('modalImage').removeAttribute('src')}
 function openImage(id){const r=state.byId.get(id),file=r&&imageFileFor(r);if(!file){notify('먼저 원본 캡처 폴더를 연결해 주세요.',true);return}closeModal();state.modalUrl=URL.createObjectURL(file);$('modalImage').src=state.modalUrl;$('modalFilename').textContent=file.name;$('modalTitle').textContent=`원본 캡처 · ${id}`;$('imageModal').hidden=false}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
 function exportBackup(){if(!state.records.length)return;const obj={format:'pia-review-v1',version:1,source:state.source,fingerprint:state.fingerprint,savedAt:new Date().toISOString(),records:state.records};download(new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'}),'PIA_선별진행_백업_'+new Date().toISOString().slice(0,10)+'.json');notify('현재 선택 상태 전체를 JSON으로 백업했습니다.')}
 const csvSafe=v=>{
  let s=String(v??'');
  // Guard spreadsheet formula execution when CSV is opened in Excel.
  if(/^[\s\x00-\x1f]*[=+@\-]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 };
 function exportSelectionCsv(){if(!state.records.length)return;
  const cols=['게시물 ID','사용자 최종 선택','사용자 메모','검수 결과','작성자','아이디','게시물 유형(검수안)','작성일시(검수안)','본문 전체(검수안)','부모 ID(검수안)','중복 판정','대표 게시물 ID','원본 캡처 파일명','날짜 판정','추가검토사항'];
  const lines=[cols.map(csvSafe).join(',')];
  for(const x of state.records){const row=[x.id,x.choice,x.memo,x.audit,x.name,x.handle,x.type,x.date,x.content,x.parent,x.duplicate,x.rep,x.source,x.dateStatus,x.notes];lines.push(row.map(csvSafe).join(','))}
  download(new Blob(['\ufeff',lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),'PIA_사용자_선별결과_'+new Date().toISOString().slice(0,10)+'.csv');
  notify('선별 결과 CSV를 저장했습니다. PIA 직접 등록용 CSV가 아닙니다.');
 }
 function onFilters(){state.currentPage=0;refresh()}
 function bind(){
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{
   const res=await fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('reviewPassword').value})});
   if(!res.ok)throw Error((await res.json().catch(()=>({}))).error||'관리자 로그인 실패');$('reviewPassword').value='';await auth();
  }catch(err){$('loginStatus').textContent=err.message}finally{btn.disabled=false}});
  $('workbookInput').addEventListener('change',async e=>{try{await importWorkbook(e.target.files?.[0])}catch(err){saveLabel('불러오기 실패');notify(err.message,true)}finally{e.target.value=''}});
  $('restoreJson').addEventListener('change',async e=>{try{await restoreBackup(e.target.files?.[0])}catch(err){notify('복원 실패: '+err.message,true)}finally{e.target.value=''}});
  $('imageFolder').addEventListener('change',e=>{const files=[...e.target.files||[]].filter(f=>/^image\//.test(f.type)||/\.(jpe?g|png|webp)$/i.test(f.name));state.images=new Map(files.map(f=>[f.name.toLowerCase(),f]));refresh();notify(`캡처 이미지 ${state.images.size}개를 이 브라우저에서 연결했습니다. 서버로 전송하지 않았습니다.`)});
  for(const id of ['authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter','sortFilter','pageSize'])$(id).addEventListener('change',onFilters);
  $('query').addEventListener('input',()=>{clearTimeout(typingTimer);typingTimer=setTimeout(onFilters,130)});
  $('clearFilters').onclick=()=>{['query','authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter'].forEach(id=>$(id).value='');$('sortFilter').value='original';onFilters()};
  $('prevPage').onclick=()=>{state.currentPage=Math.max(0,state.currentPage-1);refresh();$('feed').scrollIntoView({block:'start'})};
  $('nextPage').onclick=()=>{state.currentPage++;refresh();$('feed').scrollIntoView({block:'start'})};
  $('bulkKeep').onclick=()=>chooseBulk('등록');$('bulkExclude').onclick=()=>chooseBulk('제외');$('bulkHold').onclick=()=>chooseBulk('보류');
  $('exportJson').onclick=exportBackup;$('exportCsv').onclick=exportSelectionCsv;
  $('openIssues').onclick=()=>{state.issuesOpen=!state.issuesOpen;refresh();$('issueDetails')?.scrollIntoView({block:'nearest'})};
  $('feed').addEventListener('click',e=>{const el=e.target.closest('[data-choose],[data-jump],[data-show-image]');if(!el)return;
   if(el.dataset.choose)setChoice(el.dataset.id,el.dataset.choose);
   else if(el.dataset.jump)jumpTo(el.dataset.jump);else if(el.dataset.showImage)openImage(el.dataset.showImage);
  });
  document.addEventListener('click',e=>{const link=e.target.closest('#issueDetails [data-jump]');if(link)jumpTo(link.dataset.jump)});
  $('feed').addEventListener('input',e=>{const node=e.target.closest('[data-memo]');if(!node)return;const x=state.byId.get(node.dataset.memo);if(!x)return;x.memo=node.value;x.fields['사용자 메모']=node.value;ensureMemoSave(x)});
  $('closeImage').onclick=closeModal;$('imageModal').addEventListener('click',e=>{if(e.target===$('imageModal'))closeModal()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
 }
 async function auth(){
  try{const res=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!res.ok)throw Error('로그인 상태를 확인할 수 없습니다.');const s=await res.json();
   if(!s.authenticated){$('loginPanel').hidden=false;$('workspace').hidden=true;$('loginStatus').textContent=s.configured?'관리자 계정으로 로그인해 주세요.':'ADMIN_PASSWORD 설정이 필요합니다.';return}
   $('loginPanel').hidden=true;$('workspace').hidden=false;
   if(!state.db)await resume();
  }catch(err){$('loginPanel').hidden=false;$('workspace').hidden=true;$('loginStatus').textContent='관리자 인증 확인 오류: '+err.message}
 }
 bind();auth();
 window.PIA_REVIEW_TEST={recordOf,issues:()=>issues(),state,downloadChoiceCsv:exportSelectionCsv};
})();
