(()=>{'use strict';
const $=id=>document.getElementById(id);
let rows=[],db=null,busy=false,csvHeaders=[],importPage=1,reviewStorageKey='';const importMarked=new Set();
function persistReview(){if(!reviewStorageKey)return;try{sessionStorage.setItem(reviewStorageKey,JSON.stringify(rows.map(r=>[r.id,r.decision,r.date,r.dateReview])))}catch(_){/* export CSV remains available */}}
function restoreReview(){if(!reviewStorageKey)return;try{const saved=JSON.parse(sessionStorage.getItem(reviewStorageKey)||'null');if(!Array.isArray(saved))return;const byId=new Map(saved.map(item=>[item[0],item]));for(const r of rows){const item=byId.get(r.id);if(!item)continue;if(['include','exclude','hold'].includes(item[1]))r.decision=item[1];if(dateISO(item[2])){r.date=item[2];r.source.posted_at=item[2]}r.dateReview=!!item[3]}}catch(_){}}
const norm=s=>String(s??'').normalize('NFKC').trim();
const handle=s=>norm(s).replace(/^@/,'').toLowerCase();
const compact=s=>norm(s).replace(/\s+/gu,' ');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parseCSV(t){t=t.replace(/^\uFEFF/,'');let out=[],r=[],v='',quoted=false;for(let i=0;i<t.length;i++){let c=t[i];if(quoted){if(c==='"'&&t[i+1]==='"'){v+='"';i++}else if(c==='"')quoted=false;else v+=c}else if(c==='"')quoted=true;else if(c===','){r.push(v);v=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&t[i+1]==='\n')i++;r.push(v);if(r.some(x=>x!==''))out.push(r);r=[];v=''}else v+=c}if(quoted)throw Error('CSV 따옴표가 닫히지 않았습니다.');r.push(v);if(r.some(x=>x!==''))out.push(r);return out}
function dateISO(v){v=norm(v);if(!v)return '';let m=v.match(/^(\d{4})[-./](\d\d?)[-./](\d\d?)[ T](\d\d?):(\d\d)(?::(\d\d))?(?:\s*([+-]\d\d:\d\d))?$/);if(!m)return '';let iso=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}:${m[6]||'00'}${m[7]||$('offset').value}`;return Number.isNaN(Date.parse(iso))?'':iso}
function sameInstant(a,b){return !!a&&!!b&&!Number.isNaN(Date.parse(a))&&Date.parse(a)===Date.parse(b)}
async function api(path,body){let r=await fetch('/api/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let d=await r.json();if(!r.ok){let e=new Error(d.error||`HTTP ${r.status}`);e.status=r.status;e.existingPostId=d.existing_post_id;throw e}return d}
function todayFallback(){const d=new Date();const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${x.year}-${x.month}-${x.day}T12:00:00+09:00`}
function dbMatches(row){if(!db)return [];const a=db.accounts.find(a=>handle(a.handle)===row.handle);return a?db.posts.filter(p=>p.account_id===a.id&&compact(p.content)===compact(row.content)):[]}
function exactInDb(row){return dbMatches(row).find(p=>sameInstant(p.posted_at,row.date))||null}
const requiredErrors=['임시 ID 없음','아이디 형식 확인','작성자/본문 누락','작성 날짜 누락','부모 ID 없음','자기 참조','답글 부모 미확인','답글과 인용 동시 사용 불가','인용 정보 누락','인용 원문 누락'];
function inspect(){
 const ids=new Set(rows.map(r=>r.id)),byText=new Map();
 rows.forEach(r=>{
  r.errors=[];r.hardDuplicate=false;r.softDuplicate=false;r.exactCsvOf='';
  if(!r.id)r.errors.push('임시 ID 없음');
  if(!/^[a-z0-9_]{1,30}$/.test(r.handle))r.errors.push('아이디 형식 확인');
  if(!r.name||!r.content.trim())r.errors.push('작성자/본문 누락');
  if(!r.date)r.errors.push('작성 날짜 누락');
  if(r.type==='reply'&&!r.parent)r.errors.push('답글 부모 미확인');
  if(r.type==='quote'&&!r.quoteContent)r.errors.push('인용 원문 누락');
  if(r.parent&&!ids.has(r.parent))r.errors.push('부모 ID 없음');
  if(r.parent===r.id)r.errors.push('자기 참조');
  if(r.parent&&r.quoteContent)r.errors.push('답글과 인용 동시 사용 불가');
  if(r.quoteContent&&(!r.quoteName||!/^[a-z0-9_]{1,30}$/.test(r.quoteHandle)))r.errors.push('인용 정보 누락');
  const found=dbMatches(r);
  if(found.some(p=>sameInstant(p.posted_at,r.date))){r.hardDuplicate=true;r.errors.push('기존 DB 동일 게시물 (등록 차단)')}
  else if(found.length){r.softDuplicate=true;r.errors.push('기존 DB 동일 본문 · 날짜 다름 (확인 필요)')}
  if(r.duplicateStatus==='possible_duplicate'){r.softDuplicate=true;r.errors.push('CSV 중복 의심 (확인 필요)')}
  if(r.reviewStatus==='needs_review')r.errors.push('원본 확인 필요');
  const key=r.handle+'\0'+compact(r.content);
  if(r.handle&&compact(r.content)){
   const prev=byText.get(key)||[];
   const exact=prev.find(p=>sameInstant(p.date,r.date));
   if(exact){r.hardDuplicate=true;r.exactCsvOf=exact.exactCsvOf||exact.id;r.errors.push(`CSV 내 동일 게시물: ${r.exactCsvOf} (등록 차단)`)}
   else if(prev.length){r.softDuplicate=true;r.errors.push(`CSV 내 동일 본문 · 날짜 다름 (확인 필요)`);for(const p of prev){p.softDuplicate=true;if(!p.errors.includes('CSV 내 동일 본문 · 날짜 다름 (확인 필요)'))p.errors.push('CSV 내 동일 본문 · 날짜 다름 (확인 필요)')}}
   prev.push(r);byText.set(key,prev);
  }
 });
 rows.forEach(r=>{
  const canRegister=!r.hardDuplicate&&!r.errors.some(e=>requiredErrors.includes(e));
  if(!r.decision)r.decision=(r.sourceDecision==='exclude'?'exclude':(!canRegister||r.sourceDecision==='hold')?'hold':r.sourceDecision==='include'?'include':(r.dateReview||r.softDuplicate||r.reviewStatus==='needs_review')?'hold':'include');
  r.selected=r.decision==='include'&&canRegister;
 });
 render();
}
function filteredRows(){const q=$('importSearch').value.trim().toLowerCase(),d=$('decisionFilter').value,e=$('errorFilter').value;return rows.filter(r=>(!q||[r.id,r.name,r.handle,r.content].some(s=>String(s||'').toLowerCase().includes(q)))&&(!d||r.decision===d)&&(!e||(e==='date'?r.dateReview:e==='duplicate'?r.softDuplicate||r.hardDuplicate:e==='reply'?r.type==='reply':r.errors.length>0)))}
function render(){
 const count=d=>rows.filter(r=>r.decision===d).length,hard=rows.filter(r=>r.hardDuplicate).length,soft=rows.filter(r=>r.softDuplicate&&!r.hardDuplicate).length,ready=rows.filter(r=>r.selected).length;
 $('summary').textContent=`전체 ${rows.length}건 · 포함 ${count('include')}건 (등록 가능 ${ready}건) · 제외 ${count('exclude')}건 · 보류 ${count('hold')}건 · 등록 불가 중복 ${hard}건 · 중복 의심 ${soft}건 · 날짜수정필요 ${rows.filter(r=>r.dateReview).length}건`;
 $('review').hidden=!rows.length;$('check').disabled=!rows.length;$('downloadDecisions').disabled=!rows.length;
 const filtered=filteredRows(),pages=Math.max(1,Math.ceil(filtered.length/40));importPage=Math.max(1,Math.min(importPage,pages));const visible=filtered.slice((importPage-1)*40,importPage*40);
 $('rows').innerHTML=visible.map(r=>{const i=rows.indexOf(r);return `<tr><td><input type="checkbox" class="pia-rowcheck" data-mark="${i}" ${importMarked.has(i)?'checked':''} aria-label="${esc(r.id)} 검토 대상 선택"></td><td><select class="pia-decision ${esc(r.decision)}" data-decision="${i}" aria-label="${esc(r.id)} 포함 제외 보류"><option value="include" ${r.decision==='include'?'selected':''}>포함</option><option value="exclude" ${r.decision==='exclude'?'selected':''}>제외</option><option value="hold" ${r.decision==='hold'?'selected':''}>보류</option></select></td><td><b>${esc(r.id)}</b><br><span class="${r.hardDuplicate||r.softDuplicate||r.errors.length?'bad':'good'}">${esc(r.errors.join(' · ')||'검토 통과')}</span></td><td>${esc(r.name)}<br><span class="muted">@${esc(r.handle)}</span></td><td>${esc(r.date||'미상')}${r.dateReview?'<br><strong class="bad">⚠ 임시 날짜</strong>':''}<br><input type="datetime-local" data-date="${i}" value="${esc(r.date?r.date.slice(0,16):'')}" aria-label="날짜 수정" style="max-width:190px"><label class="pia-pagecheck"><input type="checkbox" data-date-review="${i}" ${r.dateReview?'checked':''}> 날짜수정필요</label></td><td class="content">${esc(r.content)}</td><td>${r.parent?'답글 → '+esc(r.parent):r.type==='reply'?'⚠ 부모 미확인':r.quoteContent?'인용':'일반'}</td></tr>`}).join('');
 $('importPageInfo').textContent=`${importPage}/${pages} 페이지 · 필터 ${filtered.length}건`;$('importPrev').disabled=importPage<=1;$('importNext').disabled=importPage>=pages;
 const indexList=visible.map(r=>rows.indexOf(r));$('importSelectVisible').checked=!!indexList.length&&indexList.every(i=>importMarked.has(i));$('importSelectVisible').indeterminate=indexList.some(i=>importMarked.has(i))&&!$('importSelectVisible').checked;
 $('markedCount').textContent=importMarked.size+'건 선택';
 persistReview();
}
$('rows').addEventListener('change',e=>{
 if(e.target.matches('[data-mark]')){const i=Number(e.target.dataset.mark);e.target.checked?importMarked.add(i):importMarked.delete(i);render();return}
 if(e.target.matches('[data-decision]')){const r=rows[Number(e.target.dataset.decision)];r.decision=e.target.value;inspect();return}
 if(e.target.matches('[data-date-review]')){const r=rows[Number(e.target.dataset.dateReview)];if(!e.target.checked&&!confirm('원본 캡처에서 실제 작성 시각을 직접 확인했나요? 확인했다면 날짜수정필요를 해제합니다.')){render();return}r.dateReview=e.target.checked;if(r.dateReview&&r.decision==='include')r.decision='hold';inspect();return}
 if(e.target.matches('input[data-date]')){const r=rows[Number(e.target.dataset.date)];const iso=dateISO(e.target.value);if(!iso){alert('올바른 날짜와 시간을 입력하세요.');render();return}r.date=iso; // Editing a date does not independently verify the original timestamp.
  r.dateReview=true;r.source.posted_at=iso;r.decision='hold';inspect();return}
});
for(const id of ['importSearch','decisionFilter','errorFilter'])$(id).addEventListener(id==='importSearch'?'input':'change',()=>{importPage=1;render()});
$('importPrev').onclick=()=>{importPage--;render()};$('importNext').onclick=()=>{importPage++;render()};
$('importSelectVisible').addEventListener('change',e=>{const visible=filteredRows().slice((importPage-1)*40,importPage*40);for(const r of visible){const i=rows.indexOf(r);e.target.checked?importMarked.add(i):importMarked.delete(i)}render()});
for(const [id,decision] of [['bulkInclude','include'],['bulkExclude','exclude'],['bulkHold','hold']])$(id).onclick=()=>{for(const i of importMarked)if(rows[i])rows[i].decision=decision;importMarked.clear();inspect()};
function makeCSVLine(values){return values.map(v=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(',')}
$('downloadDecisions').onclick=()=>{const headers=[...csvHeaders.filter(x=>x!=='review_decision'&&x!=='date_needs_review'),'date_needs_review','review_decision'];const lines=[makeCSVLine(headers),...rows.map(r=>makeCSVLine(headers.map(k=>k==='review_decision'?r.decision:k==='date_needs_review'?(r.dateReview?'true':'false'):r.source[k])))];const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='pia-import-review-decisions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
$('file').addEventListener('change',async e=>{try{
 let file=e.target.files[0];if(!file)return;if(file.size>5e6)throw Error('CSV 파일은 5MB 이하만 지원합니다.');
 let table=parseCSV(await file.text());let headers=table.shift().map(norm),required=['temp_id','author_name','author_handle','posted_at','content','post_type','parent_temp_id'];csvHeaders=headers;importMarked.clear();importPage=1;
 if(required.some(k=>!headers.includes(k)))throw Error('게시물 CSV 헤더가 일치하지 않습니다: '+required.filter(k=>!headers.includes(k)).join(', '));
 rows=table.map(values=>{let x=Object.fromEntries(headers.map((h,j)=>[h,values[j]??'']));const parsedDate=dateISO(x.posted_at);return{id:norm(x.temp_id),name:norm(x.author_name),handle:handle(x.author_handle),date:parsedDate||todayFallback(),dateReview:!parsedDate||['true','1','yes'].includes(String(x.date_needs_review||'').toLowerCase())||/임시 날짜|임시 시각|날짜 미확정|시간 미확정/.test(String(x.notes||'')),content:String(x.content||''),type:norm(x.post_type),parent:norm(x.parent_temp_id),quoteName:norm(x.quote_author_name),quoteHandle:handle(x.quote_author_handle),quoteContent:String(x.quote_content||''),quoteDate:dateISO(x.quote_posted_at),duplicateStatus:norm(x.duplicate_status),reviewStatus:norm(x.review_status),notes:String(x.notes||''),source:x,sourceDecision:({exclude:'exclude',excluded:'exclude','제외':'exclude',include:'include',included:'include','포함':'include',hold:'hold','보류':'hold'})[norm(x.review_decision||x.selection||x.include_status).toLowerCase()]||'',decision:'',selected:undefined,manualSelection:false}});
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('temp_id가 중복되었습니다.');
 reviewStorageKey='pia_import_review_v27:'+file.name+':'+file.size+':'+file.lastModified;restoreReview();
 db=await api('admin-data');inspect();$('result').textContent='미리보기 준비 완료. 같은 작성자·본문이지만 날짜가 다른 행은 수동으로 확인 후 선택할 수 있습니다.';
}catch(err){rows=[];render();$('result').textContent='읽기 실패: '+err.message}});
$('check').onclick=async()=>{try{db=await api('admin-data');inspect();$('result').textContent='현재 DB와 다시 비교했습니다.'}catch(e){$('result').textContent=e.message}};
$('selectSafe').onclick=()=>{rows.forEach(r=>{if(r.decision==='exclude')return;const safe=!r.hardDuplicate&&!r.softDuplicate&&!r.dateReview&&r.reviewStatus!=='needs_review'&&!r.errors.some(e=>requiredErrors.includes(e));if(safe)r.decision='include'});inspect()};
$('clear').onclick=()=>{rows.forEach(r=>{if(r.decision==='include')r.decision='hold'});inspect()};
$('save').onclick=async()=>{
 if(busy)return;
 busy=true;$('save').disabled=true;
 let success=0,skipped=[],failed=[],postMap=new Map();
 try{
  // Refresh immediately before saving: previously selected rows may have become duplicates.
  db=await api('admin-data');inspect();
  let chosen=rows.filter(r=>r.selected);
  if(!chosen.length){$('result').textContent='등록 가능한 선택 항목이 없습니다. 중복 검사 결과를 확인하세요.';return}
  const uncertain=chosen.filter(r=>r.dateReview||r.reviewStatus==='needs_review');if(uncertain.length&&!confirm(`원본 검토 또는 실제 시각 확인이 필요한 ${uncertain.length}건이 포함되었습니다. 날짜가 임시일 경우 날짜수정필요 상태로 저장됩니다. 계속할까요?`))return;
  const suspicious=chosen.filter(r=>r.softDuplicate);
  if(suspicious.length&&!confirm(`동일 작성자·본문이지만 날짜가 달라 중복 의심인 ${suspicious.length}건이 선택되었습니다. 실제 별도 게시물인지 확인했나요?`))return;
  if(!confirm(`${chosen.length}건을 등록합니다. 제외·보류는 등록되지 않으며, 부모 게시물도 자동 선택하지 않습니다. 계속할까요?`))return;
  const accountMap=new Map(db.accounts.map(a=>[handle(a.handle),a.id]));
  const byId=new Map(rows.map(r=>[r.id,r]));
  const alias=new Map(rows.filter(r=>r.exactCsvOf).map(r=>[r.id,r.exactCsvOf]));
  function resolveAlias(id){const seen=new Set();while(alias.has(id)&&!seen.has(id)){seen.add(id);id=alias.get(id)}return id}
  for(const r of rows){const found=exactInDb(r);if(found)postMap.set(r.id,found.id)}
  const chosenIds=new Set(chosen.map(r=>r.id));
  const unselectedParents=chosen.filter(r=>r.parent&&!chosenIds.has(resolveAlias(r.parent))&&!postMap.has(resolveAlias(r.parent)));
  if(unselectedParents.length){$('result').textContent='선택하지 않은 부모를 자동 등록하지 않습니다. 부모를 포함으로 바꾼 뒤 다시 시도하세요: '+unselectedParents.slice(0,20).map(r=>r.id+'→'+r.parent).join(', ');return}
  const pending=[...chosen];
  while(pending.length){
   let progressed=false;
   for(let i=0;i<pending.length;){
    const r=pending[i],parentId=r.parent?resolveAlias(r.parent):null;
    if(parentId&&!postMap.has(parentId)){i++;continue}
    try{
     let accountId=accountMap.get(r.handle);
     if(!accountId){let a=await api('accounts',{name:r.name,handle:r.handle});accountId=a.id;accountMap.set(r.handle,accountId);db.accounts.push({id:accountId,handle:r.handle,name:r.name})}
     const existing=exactInDb(r);
     if(existing){postMap.set(r.id,existing.id);skipped.push(`${r.id}: 기존 게시물과 정확히 일치해 건너뜀`)}
     else{
      const payload={account_id:accountId,content:r.content,posted_at:r.date,parent_id:parentId?postMap.get(parentId):null,quote_name:r.quoteContent?r.quoteName:'',quote_handle:r.quoteContent?r.quoteHandle:'',quote_content:r.quoteContent,quote_posted_at:r.quoteDate||null,date_needs_review:r.dateReview,import_guard:true};
      try{let p=await api('posts',payload);postMap.set(r.id,p.id);db.posts.push({...payload,id:p.id});success++}
      catch(err){if(err.status===409){if(err.existingPostId)postMap.set(r.id,err.existingPostId);skipped.push(`${r.id}: ${err.message}`)}else throw err}
     }
    }catch(err){failed.push(`${r.id}: ${err.message}`)}
    progressed=true;pending.splice(i,1);
    $('result').textContent=`저장 중: 신규 ${success}건 / 건너뜀 ${skipped.length}건 / 오류 ${failed.length}건`;
   }
   if(!progressed)break;
  }
  for(const r of pending)failed.push(`${r.id}: 부모 ${r.parent}를 찾지 못했습니다. 부모 게시물을 확인하세요.`);
  $('result').textContent=`완료: 신규 게시물 ${success}건\n중복 건너뜀 ${skipped.length}건\n미등록·오류 ${failed.length}건\n${[...skipped,...failed].join('\n')}\n\n동일 본문·다른 날짜는 실제 별도 게시물인지 확인 후 선택하세요.`;
  // Re-read after save, so subsequent import attempts see new posts.
  try{db=await api('admin-data');inspect()}catch(_){/* saved result remains visible */}
 }catch(err){$('result').textContent=`중단: ${err.message}\n이미 저장된 신규 게시물 ${success}건은 유지됩니다.`}
 finally{busy=false;$('save').disabled=false}
};
})();
