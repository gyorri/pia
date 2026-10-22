/* PIA v0.3.38 — Fast list / grouped selection / timeline, backward-compatible exclusion ledger. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validChoices=new Set(['미선택','등록','제외','보류']);
 const state={records:[],byId:new Map(),currentPage:0,filtered:[],fingerprint:'',source:'',images:new Map(),urls:[],modalUrl:'',issuesOpen:false,db:null,dbStatus:'idle',dbPostCount:0,dbMatches:new Map(),undo:[],ledger:new Map(),viewReady:false,mode:'quick',groupBy:'author',pending:new Set(),anchorId:'',cursorId:'',pageGroups:[],pageIds:[],expandedRows:new Set()};
 const $all=id=>Array.from(document.querySelectorAll(id));
 let toastTimer,typingTimer,viewTimer;
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
 // Persist excluded post IDs independently of the current Work workbook / review round.
 function excludedEntry(x,previousChoice='미선택',source=state.source){
  return {id:x.id,excludedAt:new Date().toISOString(),source:source||'',name:x.name,handle:x.handle,type:x.type,content:x.content,parent:x.parent,filename:x.source,memo:x.memo||'',previousChoice};
 }
 function ledgerArray(){return [...state.ledger.values()].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}))}
 function ledgerFromRecords(rows,source=state.source){for(const x of rows)if(x.choice==='제외'&&!state.ledger.has(x.id))state.ledger.set(x.id,excludedEntry(x,'미선택',source))}
 function loadLedger(rows){const next=new Map();for(const x of (Array.isArray(rows)?rows:[])){
   const id=String(x?.id||'');if(!/^P\d{3,6}$/.test(id)||next.has(id)||next.size>=10000)continue;
   next.set(id,{id,excludedAt:String(x.excludedAt||''),source:String(x.source||''),name:String(x.name||''),handle:String(x.handle||''),type:String(x.type||''),content:String(x.content||''),parent:String(x.parent||''),filename:String(x.filename||''),memo:String(x.memo||'').slice(0,2000),previousChoice:normalizedChoice(x.previousChoice)});
  }return next;
 }
 function enforceExclusions(rows){for(const r of rows){if(state.ledger.has(r.id)){
   r.choice='제외';r.fields['사용자 최종 선택']='제외';
  }}return rows}
 function saveChoicesAndLedger(changed){return new Promise((ok,bad)=>{
  if(!state.db){bad(Error('로컬 저장소에 연결되지 않았습니다.'));return}
  const tx=state.db.transaction(['data','choices'],'readwrite');const choices=tx.objectStore('choices');
  for(const x of changed)choices.put({id:x.id,choice:x.choice,memo:x.memo});
  tx.objectStore('data').put(ledgerArray(),'exclusionLedger');
  tx.oncomplete=ok;tx.onerror=()=>bad(tx.error);tx.onabort=()=>bad(tx.error);
 })}
 function openDatabase(){return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(Error('브라우저 로컬 저장소를 사용할 수 없습니다.'));return}
  const request=indexedDB.open('pia-preimport-review-v1',1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('data');db.createObjectStore('choices',{keyPath:'id'})};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 })}
 function dbGet(store,key){return new Promise((ok,bad)=>{const req=state.db.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>ok(req.result);req.onerror=()=>bad(req.error)})}
 function dbPut(store,obj,key){return new Promise((ok,bad)=>{const tx=state.db.transaction(store,'readwrite');const req=key===undefined?tx.objectStore(store).put(obj):tx.objectStore(store).put(obj,key);tx.oncomplete=()=>ok(req.result);tx.onerror=()=>bad(tx.error);tx.onabort=()=>bad(tx.error)})}
 function dbSaveBundle(bundle){return new Promise((ok,bad)=>{const tx=state.db.transaction(['data','choices'],'readwrite');tx.objectStore('data').put(bundle,'active');tx.objectStore('choices').clear();for(const x of bundle.records)if(x.choice!=='미선택'||x.memo)tx.objectStore('choices').put({id:x.id,choice:x.choice,memo:x.memo});tx.oncomplete=ok;tx.onerror=()=>bad(tx.error);tx.onabort=()=>bad(tx.error)})}
 function dbSaveChoices(changes){return new Promise((ok,bad)=>{if(!state.db){bad(Error('로컬 저장소에 연결되지 않았습니다.'));return}const tx=state.db.transaction('choices','readwrite'),store=tx.objectStore('choices');for(const x of changes)store.put({id:x.id,choice:x.choice,memo:x.memo});tx.oncomplete=ok;tx.onerror=()=>bad(tx.error);tx.onabort=()=>bad(tx.error)})}
 function dbLoadChoices(){return new Promise((ok,bad)=>{const req=state.db.transaction('choices','readonly').objectStore('choices').getAll();req.onsuccess=()=>ok(req.result||[]);req.onerror=()=>bad(req.error)})}
 function setRecords(records,fp,source){
  if(!Array.isArray(records)||!records.length||records.length>10000)throw Error('게시물 데이터가 올바르지 않습니다.');
  const ids=new Set();for(const x of records){if(!/^P\d{3,6}$/.test(x.id)||ids.has(x.id))throw Error('게시물 ID가 잘못됐거나 중복입니다: '+x.id);ids.add(x.id)}
  state.viewReady=false;state.records=records;state.byId=new Map(records.map(r=>[r.id,r]));state.fingerprint=fp;state.source=source;
  state.currentPage=0;state.issuesOpen=false;state.undo=[];state.pending.clear();state.anchorId='';state.cursorId='';state.expandedRows.clear();
  const authors=[...new Set(records.map(x=>x.handle||x.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('authorFilter').innerHTML='<option value="">전체 작성자</option>'+authors.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  ['query','authorFilter','auditFilter','typeFilter','duplicateFilter'].forEach(id=>$(id).value='');$('choiceFilter').value='active';$('sortFilter').value='original';
  ['exportCsv','exportJson','exportWork'].forEach(id=>$(id).disabled=false);
  updateDbMatches();refresh();
 }
 async function digest(buffer){const bytes=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
 async function importWorkbook(file){
  if(!file)return;
  saveLabel('엑셀 분석 중…');
  const buffer=await file.arrayBuffer();const {records:rows}=await window.PIAReviewXlsx.parseSelectionXlsx(buffer);
  const fingerprint=await digest(buffer),old=state.fingerprint;
  if(old&&old!==fingerprint&&!confirm(`현재 ${state.records.length}건의 검토본을 새 Work 파일로 교체할까요?\n기존 제외 ${state.ledger.size}건은 누적 유지됩니다. 백업 JSON을 먼저 저장해 주세요.`)){saveLabel('교체 취소');return}
  const data=rows.map(recordOf);
  // Never drop excluded IDs when the next Work workbook omits already excluded rows.
  ledgerFromRecords(state.records);
  for(const x of data){const prev=state.byId.get(x.id);if(prev){
   x.choice=prev.choice;x.memo=prev.memo;x.fields['사용자 최종 선택']=x.choice;x.fields['사용자 메모']=x.memo;
  }}
  enforceExclusions(data);ledgerFromRecords(data);
  const bundle={format:'pia-review-v1',fingerprint,source:file.name,records:data,updatedAt:new Date().toISOString()};
  if(state.db){await dbSaveBundle(bundle);await dbPut('data',ledgerArray(),'exclusionLedger')}
  setRecords(data,fingerprint,file.name);state.viewReady=true;storeView();
  saveLabel(state.db?`${data.length.toLocaleString()}건 · 제외 누적 ${state.ledger.size}건 보존`:'로컬 저장 불가 · 반드시 JSON 백업');
  notify(`새 검토본 ${data.length.toLocaleString()}건을 불러왔습니다. 기존 제외 ${state.ledger.size}건은 유지됩니다.`);
 }
 async function restoreBackup(file){
  if(!file)return;
  const payload=JSON.parse(await file.text());
  if(payload?.format!=='pia-review-v1'||!Array.isArray(payload.records)||payload.records.length<1||payload.records.length>10000)throw Error('PIA 선별 백업 JSON이 아닙니다.');
  const records=payload.records.map(cleanRecord);
  if(records.some(x=>!x))throw Error('백업 데이터가 손상됐거나 필수 항목이 없습니다.');
  if(state.records.length&&!confirm('백업 데이터로 현재 검토본을 교체할까요? 제외 이력은 기존+백업을 합쳐 보존합니다.'))return;
  ledgerFromRecords(state.records);const previous=ledgerArray();state.ledger=loadLedger(previous);
  for(const [id,e] of loadLedger(payload.exclusionLedger||[]))if(!state.ledger.has(id))state.ledger.set(id,e);
  const fingerprint=String(payload.fingerprint||'backup-'+Date.now()),source=String(payload.source||'JSON 백업');
  ledgerFromRecords(records,source);enforceExclusions(records);
  if(state.db){await dbSaveBundle({format:'pia-review-v1',fingerprint,source,records,updatedAt:new Date().toISOString()});await dbPut('data',ledgerArray(),'exclusionLedger')}
  setRecords(records,fingerprint,source);state.viewReady=true;storeView();
  saveLabel(state.db?'백업 복원 완료 · 누적 제외 보존':'로컬 저장 불가 · 반드시 JSON 백업');
  notify(`검토본 ${records.length.toLocaleString()}건 복원 · 누적 제외 ${state.ledger.size}건`);
 }
 async function resume(){
  try{state.db=await openDatabase();const bundle=await dbGet('data','active');if(!bundle?.records?.length)return;
   const records=bundle.records.map(cleanRecord);if(records.some(x=>!x))throw Error('로컬 저장 데이터가 손상됐습니다.');
   const choices=await dbLoadChoices(),map=new Map(choices.map(x=>[x.id,x]));
   for(const x of records){const choice=map.get(x.id);if(choice){x.choice=normalizedChoice(choice.choice);x.memo=String(choice.memo||'');x.fields['사용자 최종 선택']=x.choice;x.fields['사용자 메모']=x.memo}}
   const savedLedger=await dbGet('data','exclusionLedger');state.ledger=loadLedger(savedLedger);
   ledgerFromRecords(records);enforceExclusions(records);
   if(!Array.isArray(savedLedger))await dbPut('data',ledgerArray(),'exclusionLedger');
   const view=await dbGet('data','viewPrefs');setRecords(records,bundle.fingerprint,bundle.source);
   if(view&&view.fingerprint===state.fingerprint){if(['quick','groups','timeline'].includes(view.mode))state.mode=view.mode;if(['author','capture'].includes(view.groupBy))state.groupBy=view.groupBy;$('groupBy').value=state.groupBy;for(const k of ['query','authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter','sortFilter','pageSize']){
     const value=view[k];if(typeof value!=='string')continue;
     if(k==='choiceFilter'&&value==='미선택')$(k).value='active';else if(k==='query'||[...$(k).options].some(opt=>opt.value===value))$(k).value=value;
    }state.currentPage=Math.max(0,Number(view.page)||0)}state.viewReady=true;refresh();saveLabel(`${records.length.toLocaleString()}건 · 이전 작업 복원`);
  }catch(e){saveLabel('로컬 저장 불가 · 백업을 자주 받아 주세요');notify('자동 저장 복원 실패: '+e.message,true)}
 }
 function storeView(){
  if(!state.db||!state.records.length||!state.viewReady)return;
  clearTimeout(viewTimer);viewTimer=setTimeout(()=>{const view={fingerprint:state.fingerprint,page:state.currentPage,mode:state.mode,groupBy:state.groupBy};for(const k of ['query','authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter','sortFilter','pageSize'])view[k]=$(k).value;dbPut('data',view,'viewPrefs').catch(()=>{})},180);
 }
 // The comparison is READ-ONLY: /api/admin-data is authenticated, never written to.
 const normalizeHandle=s=>String(s||'').normalize('NFKC').toLowerCase().trim().replace(/^@+/, '').replace(/\s+/g,'');
 const normalizeBody=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[^\p{L}\p{N}]/gu,'');
 function shingleScore(a,b){
  if(a===b)return 1;
  if(a.length<8||b.length<8)return 0;
  const ratio=Math.min(a.length,b.length)/Math.max(a.length,b.length);
  if(ratio<.72)return 0;
  const grams=x=>{const counts=new Map();for(let i=0;i<x.length-1;i++){const part=x.slice(i,i+2);counts.set(part,(counts.get(part)||0)+1)}return counts};
  const A=grams(a),B=grams(b);let both=0;for(const [k,n] of A)both+=Math.min(n,B.get(k)||0);
  return 2*both/((a.length-1)+(b.length-1));
 }
 function matchExisting(records,accounts,posts){
  const author=new Map(accounts.map(x=>[String(x.id),normalizeHandle(x.handle)]));
  const perAuthor=new Map(),globalExact=new Map();
  for(const p of posts){const body=normalizeBody(p.content),handle=author.get(String(p.account_id))||'';if(body.length<4)continue;const info={id:String(p.id),body,handle,content:String(p.content||''),postedAt:String(p.posted_at||'')};if(handle){if(!perAuthor.has(handle))perAuthor.set(handle,[]);perAuthor.get(handle).push(info)}if(!globalExact.has(body))globalExact.set(body,[]);globalExact.get(body).push(info)}
  const out=new Map();for(const x of records){const body=normalizeBody(x.content),handle=normalizeHandle(x.handle);if(body.length<4)continue;const matches=[],seen=new Set();
   for(const p of perAuthor.get(handle)||[]){const score=shingleScore(body,p.body);if(score>=.82){seen.add(p.id);matches.push({...p,score,kind:score===1&&body.length<8?'short-exact':score===1?'exact':score>=.90?'strong':'possible'})}}
   // An exact body registered under another handle is surfaced as an *uncertain* match.
   for(const p of body.length>=8?(globalExact.get(body)||[]):[])if(!seen.has(p.id)){seen.add(p.id);matches.push({...p,score:1,kind:'other-account'})}
   if(matches.length)out.set(x.id,matches.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,5));
  }return out;
 }
 function updateDbMatches(){if(state.dbStatus!=='ready')return;state.dbMatches=matchExisting(state.records,state.dbAccounts||[],state.dbPosts||[]);updateDbStatus()}
 function updateDbStatus(){const el=$('dbCompareStatus');if(!el)return;const labels={idle:'기존 DB 비교 대기',loading:'기존 DB와 비교 중…',error:'기존 DB 비교 실패 · 새로고침 필요',ready:`DB ${state.dbPostCount.toLocaleString()}건 비교 완료 · 중복 후보 ${state.dbMatches.size.toLocaleString()}건`};el.textContent=labels[state.dbStatus]||labels.idle;el.classList.toggle('error',state.dbStatus==='error');$('refreshDb').disabled=state.dbStatus==='loading'}
 async function refreshExistingDb(){if(state.dbStatus==='loading')return;state.dbStatus='loading';updateDbStatus();try{const response=await fetch('/api/admin-data',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('관리자 세션 또는 DB 조회 오류 ('+response.status+')');const data=await response.json();if(!Array.isArray(data.posts)||!Array.isArray(data.accounts))throw Error('DB 조회 결과 형식 오류');state.dbAccounts=data.accounts;state.dbPosts=data.posts;state.dbPostCount=data.posts.length;state.dbStatus='ready';updateDbMatches();refresh()}catch(e){state.dbStatus='error';state.dbMatches=new Map();updateDbStatus();notify('기존 DB 중복 비교 실패: '+e.message,true);refresh()}}
 function updateQuickUI(){const quick=$('choiceFilter').value==='active';$('quickUnselected').classList.toggle('active',quick);$('quickAll').classList.toggle('active',!quick);$('undoChoice').disabled=!state.undo.length;
  $('quickStatus').textContent=quick?'제외만 선택하세요. 나머지 글은 다음 Work 검토본에 남습니다.':'전체 보기: 이전에 제외한 글도 취소할 수 있습니다.';
 }
 function commitChoice(changes,label){
  if(!changes.length)return;const batch=[];
  for(const c of changes){const x=state.byId.get(c.id);if(!x||!['제외','미선택'].includes(c.choice)||x.choice===c.choice)continue;
   batch.push({id:x.id,choice:x.choice,ledger:state.ledger.get(x.id)||null});
   if(c.choice==='제외')state.ledger.set(x.id,excludedEntry(x,x.choice));
   else state.ledger.delete(x.id);
   x.choice=c.choice;x.fields['사용자 최종 선택']=c.choice;
  }
  if(!batch.length)return;
  for(const a of batch)state.pending.delete(a.id);
  state.undo.push(batch);if(state.undo.length>50)state.undo.shift();updateQuickUI();
  const changed=batch.map(a=>state.byId.get(a.id));
  if(state.db)saveChoicesAndLedger(changed).then(()=>saveLabel('제외 상태·이력 자동 저장됨')).catch(e=>{saveLabel('저장 실패 · JSON 백업 필요');notify('선별 저장 실패: '+e.message,true)});
  else saveLabel('로컬 저장 불가 · 반드시 JSON 백업');
  refresh();notify(label+` · ${batch.length}건 (되돌리기 가능)`);
 }
 function undoLast(){const batch=state.undo.pop();if(!batch)return;const changed=[];
  for(const a of batch){const x=state.byId.get(a.id);if(!x)continue;
   x.choice=a.choice;x.fields['사용자 최종 선택']=x.choice;
   if(a.ledger)state.ledger.set(a.id,a.ledger);else state.ledger.delete(a.id);
   changed.push(x);
  }
  if(state.db)saveChoicesAndLedger(changed).then(()=>saveLabel('제외 상태·이력 자동 저장됨')).catch(e=>notify('되돌리기 저장 실패: '+e.message,true));
  refresh();notify(`${changed.length}건의 마지막 선별 작업을 되돌렸습니다.`);
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
 function updateSummary(){const c=decisionTotals();$('countAll').textContent=state.records.length.toLocaleString();$('countNone').textContent=(state.records.length-c.제외).toLocaleString();$('countExclude').textContent=c.제외.toLocaleString();$('countLedger').textContent=state.ledger.size.toLocaleString();const is=issues();$('issueCount').textContent=is.length;return is}
 function filteredRows(){
  const q=$('query').value.trim().toLocaleLowerCase(),exactId=/^p\d{3,6}$/.test(q),author=$('authorFilter').value,audit=$('auditFilter').value,choice=$('choiceFilter').value,type=$('typeFilter').value,dup=$('duplicateFilter').value,sort=$('sortFilter').value;
  const rows=state.records.filter(x=>{
   if(q&&(exactId?x.id.toLocaleLowerCase()!==q:![x.id,x.name,x.handle,x.content,x.quoteContent,x.source,x.notes].some(t=>String(t||'').toLocaleLowerCase().includes(q))))return false;
   if(author&&(x.handle||x.name)!==author)return false;
   if(audit&&x.audit!==audit)return false;if(choice==='active'&&x.choice==='제외')return false; if(choice&&choice!=='active'&&x.choice!==choice)return false;
   if(type&&x.type!==type)return false;
   if(dup==='confirmed'&&!x.duplicate.includes('확정 중복'))return false;
   if(dup==='suspected'&&!x.duplicate.includes('중복 의심'))return false;
   if(dup==='clean'&&(!x.duplicate.includes('후보 미검출')||state.dbMatches.has(x.id)))return false;
   if(dup==='db'&&!state.dbMatches.has(x.id))return false;
   if(dup==='any'&&!state.dbMatches.has(x.id)&&!x.duplicate.includes('확정 중복')&&!x.duplicate.includes('중복 의심'))return false;
   return true;
  });
  if(state.mode==='groups')rows.sort((a,b)=>groupKey(a).localeCompare(groupKey(b),'ko')||a.id.localeCompare(b.id,undefined,{numeric:true}));
  else if(sort==='author')rows.sort((a,b)=>(a.handle||a.name).localeCompare(b.handle||b.name,'ko')||a.id.localeCompare(b.id));
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
  const dbHits=state.dbMatches.get(x.id)||[];const dbHitHtml=dbHits.length?`<div class="db-hits"><strong>⚠ PIA DB 기존 글 비교 후보 ${dbHits.length}건</strong>${dbHits.map(hit=>`<div class="db-hit"><span>${hit.kind==='exact'?'같은 계정 · 동일 본문':hit.kind==='short-exact'?'같은 계정 · 짧은 동일 본문 (확인 필요)':hit.kind==='strong'?`같은 계정 · 유사도 ${Math.round(hit.score*100)}%`:hit.kind==='other-account'?'다른 계정 · 동일 본문 (확인 필요)':`유사도 ${Math.round(hit.score*100)}% · 확인 필요`}</span><small>${esc(hit.handle?'@'+hit.handle:'작성자 미확정')} · ${esc(hit.postedAt)}</small><p>${esc(hit.content.slice(0,190))}</p><a href="/#/post/${encodeURIComponent(hit.id)}" target="_blank" rel="noopener">기존 게시물 열기 ↗</a></div>`).join('')}<small>같은 글인지 작성자·날짜·본문을 비교하고, 등록 여부는 직접 선택하세요. 자동 제외하지 않습니다.</small></div>`:'';
  const dupHtml=x.duplicate.includes('확정 중복')||x.duplicate.includes('중복 의심')?`<p><strong>${esc(x.duplicate)}</strong>${x.rep?' · 대표 후보 '+esc(x.rep):''} ${rep?`<button type="button" class="jump" data-jump="${esc(rep.id)}">대표 게시물 보기 ↗</button>`:''}</p>`:'';
  const quoteHtml=x.quoteContent?`<div class="quote-card"><div class="quote-label">인용된 게시물</div><div class="quote-author">${esc(x.quoteName||'작성자 미확정')} <span class="handle">${esc(x.quoteHandle)}</span></div><p>${esc(x.quoteContent)}</p>${x.quoteDate?`<small>${esc(x.quoteDate)}</small>`:''}</div>`:'';
  let pic='';if(img){const url=URL.createObjectURL(img);state.urls.push(url);pic=`<img class="snapshot-thumb" src="${esc(url)}" loading="lazy" alt="${esc(x.id)} 원본 캡처 미리보기" data-show-image="${esc(x.id)}">`}
  const issueText=[x.notes,x.dateStatus,x.relation].filter(Boolean).join(' · ').slice(0,1400);
  const note=x.memo||'';
  return `<article class="post-card" id="card-${esc(x.id)}" data-post-id="${esc(x.id)}"><div class="avatar">${esc((x.name||'?').trim()[0]||'?')}</div><div class="post-main"><div class="post-head"><strong class="display-name">${esc(x.name||'작성자 미확정')}</strong><span class="handle">${esc(x.handle||'@아이디 미확정')}</span><span class="post-time">${esc(x.date||'시각 미확정')}</span><span class="post-id">${esc(x.id)}</span></div><div class="chips"><span class="chip">${esc(typeName)}</span><span class="chip ${reviewColor}">${esc('검수: '+x.audit)}</span>${x.duplicate.includes('확정 중복')?'<span class="chip bad">확정 중복</span>':x.duplicate.includes('중복 의심')?'<span class="chip warn">중복 의심</span>':''}${x.dateStatus.includes('시간추정')?'<span class="chip warn">시간 +5분 추정</span>':''}${dbHits.length?'<span class="chip bad">⚠ DB 기존 글 후보</span>':''}</div>${parentHtml}<div class="post-body">${esc(x.content||'[본문 없음 · 원본 확인 필요]')}</div>${quoteHtml}<div class="review-controls exclude-only"><span>${x.choice==='제외'?'제외 목록에 기록됨':x.choice==='등록'||x.choice==='보류'?'이전 선별 표시: '+esc(x.choice):'제외할 글만 선택'}</span><button type="button" class="choice exclude${x.choice==='제외'?' selected':''}" data-choose="${x.choice==='제외'?'미선택':'제외'}" data-id="${esc(x.id)}" aria-pressed="${x.choice==='제외'}">${x.choice==='제외'?'↶ 제외 취소':'✕ 제외하기'}</button></div><details class="post-detail" ${dbHits.length||note?'open':''}><summary>검수 근거 · 원본 이미지 · 메모 ${dbHits.length?'(DB 중복 후보 확인)':''}</summary><div class="evidence"><p><strong>원본</strong> · ${esc(filenameOf(x.source)||'미확정')}</p>${dupHtml}${dbHitHtml}${issueText?`<p><strong>검수 메모</strong> · ${esc(issueText)}</p>`:''}${pic}<button type="button" data-show-image="${esc(x.id)}" class="image-open" ${!img?'disabled title="원본 캡처 폴더 연결 후 사용 가능"':''}>${img?'🔎 원본 캡처 확대':'📷 캡처 폴더 연결 후 이미지 확인'}</button></div><label class="memo-label" for="memo-${esc(x.id)}">선별 메모<textarea id="memo-${esc(x.id)}" data-memo="${esc(x.id)}" maxlength="2000" rows="2" placeholder="제외 이유 또는 나중에 확인할 내용">${esc(note)}</textarea></label></details></div></article>`;
 }
 // Compact modes never change the saved pia-review-v1 record schema.
 function groupKey(x){return state.groupBy==='capture'?filenameOf(x.source)||'(원본 파일 미확인)':(x.handle||x.name||'(작성자 미확인)').toLocaleLowerCase()}
 function groupTitle(x){return state.groupBy==='capture'?(filenameOf(x.source)||'원본 파일 미확인'):`${x.name||'작성자 미확인'}${x.handle?' · '+x.handle:''}`}
 function summaryChips(x){const bits=[];
  bits.push(`<span class="mini-tag">${esc(({post:'원글',reply:'답글',quote:'인용'}[x.type])||x.type)}</span>`);
  if(x.audit==='확인 불가'||x.audit==='중복')bits.push(`<span class="mini-tag caution">${esc(x.audit)}</span>`);
  if(x.duplicate.includes('확정 중복'))bits.push('<span class="mini-tag danger">중복 확정</span>');
  else if(x.duplicate.includes('중복 의심'))bits.push('<span class="mini-tag caution">중복 의심</span>');
  if(state.dbMatches.has(x.id))bits.push(`<span class="mini-tag danger">DB 기존 글 후보 ${state.dbMatches.get(x.id).length}</span>`);
  if(x.choice==='제외')bits.push('<span class="mini-tag excluded">제외됨</span>');
  return bits.join('');
 }
 function renderCompactRow(x){
  const marked=state.pending.has(x.id),excluded=x.choice==='제외';
  const parent=state.byId.get(x.parent),rep=state.byId.get(x.rep),dbHits=state.dbMatches.get(x.id)||[];
  const notes=[x.notes,x.dateStatus].filter(Boolean).join(' · ');
  const dbHtml=dbHits.length?`<div class="compact-db"><strong>DB에 이미 등록된 글 후보 ${dbHits.length}건 · 자동 제외 아님</strong>${dbHits.map(hit=>`<p>${esc(hit.kind==='other-account'?'다른 계정 동일 본문':hit.kind==='exact'?'같은 계정 동일 본문':'유사 본문')} · ${esc(hit.handle)} · ${esc(hit.content.slice(0,240))} <a href="/#/post/${encodeURIComponent(hit.id)}" rel="noopener" target="_blank">DB 글 열기 ↗</a></p>`).join('')}</div>`:'';
  const expanded=state.expandedRows.has(x.id);
  return `<article class="quick-row${marked?' checked':''}${excluded?' is-excluded':''}${state.cursorId===x.id?' is-cursor':''}" tabindex="-1" id="card-${esc(x.id)}" data-post-id="${esc(x.id)}">
   <label class="quick-pick" aria-label="${esc(x.id)} 일괄 작업 대상으로 체크"><input type="checkbox" data-mark="${esc(x.id)}" ${marked?'checked':''}></label>
   <div class="quick-content"><div class="quick-meta"><strong>${esc(x.name||'작성자 미확인')}</strong><span>${esc(x.handle||'@미확정')}</span><span class="quick-id">${esc(x.id)}</span><span>${esc(x.date||'날짜 미확정')}</span></div>
    <div class="quick-text">${esc(x.content||'[본문 없음 · 원본 확인 필요]')}</div><div class="mini-tags">${summaryChips(x)}</div>
    <details class="quick-detail" data-detail-id="${esc(x.id)}" ${expanded?'open':''}><summary>전체 본문·원글/인용·검수 상세</summary><div class="quick-detail-inner"><p class="quick-full">${esc(x.content||'[본문 없음]')}</p>${x.type==='reply'?`<p><b>↳ 부모 ${esc(x.parent||'미확정')}</b> ${parent?esc(parent.content.slice(0,400)):'부모 본문 미확인'}</p>`:''}${x.quoteContent?`<p><b>인용:</b> ${esc(x.quoteName)} ${esc(x.quoteHandle)} · ${esc(x.quoteContent)}</p>`:''}${x.rep&&x.rep!==x.id?`<p><b>중복 대표 후보 ${esc(x.rep)}:</b> ${rep?esc(rep.content.slice(0,400)):'검토본에 없음'}</p>`:''}<p><b>원본:</b> ${esc(x.source||'미확정')}</p><p><b>검수:</b> ${esc(notes||'별도 메모 없음')}</p>${dbHtml}<div class="quick-detail-actions"><button type="button" data-show-image="${esc(x.id)}" ${!imageFileFor(x)?'disabled':''}>${imageFileFor(x)?'🖼 원본 캡처 보기':'캡처 폴더 연결 후 이미지 보기'}</button><button type="button" data-jump="${esc(x.id)}">타임라인 상세에서 확인 ↗</button></div><label>선별 메모<textarea data-memo="${esc(x.id)}" rows="2" maxlength="2000" placeholder="확인할 점을 기록하세요">${esc(x.memo)}</textarea></label></div></details>
   </div><div class="quick-row-actions"><button type="button" class="quick-exclude${excluded?' cancelled':''}" data-choose="${excluded?'미선택':'제외'}" data-id="${esc(x.id)}">${excluded?'↶ 취소':'✕ 제외'}</button></div>
  </article>`;
 }
 function renderGrouped(page){state.pageGroups=[];const groups=[];for(const x of page){const key=groupKey(x);let g=groups[groups.length-1];if(!g||g.key!==key){g={key,title:groupTitle(x),ids:[]};groups.push(g)}g.ids.push(x.id)}state.pageGroups=groups;
  return groups.map((g,i)=>{const checked=g.ids.filter(id=>state.pending.has(id)).length;return `<section class="review-group"><header class="group-header"><div><strong>${esc(g.title)}</strong><span>이 페이지 ${g.ids.length}건${checked?' · 체크 '+checked+'건':''}</span></div><button type="button" data-mark-group="${i}">${checked===g.ids.length?'체크 해제':'이 묶음 체크'}</button></header>${g.ids.map(id=>renderCompactRow(state.byId.get(id))).join('')}</section>`}).join('');
 }
 function updateModeUI(){
  document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===state.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
  $('groupSettings').hidden=state.mode!=='groups';$('batchToolbar').hidden=state.mode==='timeline';$('bulkExclude').hidden=state.mode!=='timeline';
  $('groupBy').value=state.groupBy;$('workspace').dataset.reviewMode=state.mode;
  $('focusDuplicates').classList.toggle('active',$('duplicateFilter').value==='any');
  const descriptions={quick:'한 줄씩 읽고 체크한 글을 한꺼번에 제외하세요. 버튼으로 개별 제외도 가능해요.',groups:'작성자별·캡처별로 묶어 확인하세요. 묶음 체크는 현재 페이지에 보이는 글만 선택합니다.',timeline:'원래 방식으로 글·인용·답글 관계와 원본 근거를 자세히 확인하세요.'};
  $('modeDescription').textContent=descriptions[state.mode];
 }
 function updateBatchUI(){
  for(const id of [...state.pending])if(!state.pageIds.includes(id))state.pending.delete(id);
  const n=state.pending.size;const checked=n>0&&state.pageIds.every(id=>state.pending.has(id));
  $('checkPage').checked=checked;$('checkPage').indeterminate=n>0&&!checked;
  $('batchCount').textContent=`이 페이지 ${n}건 체크`;
  $('excludeMarked').disabled=!n;$('clearMarked').disabled=!n;
  $('excludeMarked').textContent=n?`체크 ${n}건 제외하기`:'체크한 글 제외';
  $('floatingBatch').hidden=state.mode==='timeline'||!n;$('floatingCount').textContent=`선택 ${n}건`;
 }
 function setMode(mode){if(!['quick','groups','timeline'].includes(mode)||state.mode===mode)return;
  state.mode=mode;state.currentPage=0;state.pending.clear();state.anchorId='';state.cursorId='';refresh();
 }
 function setGroupBy(next){if(!['author','capture'].includes(next))return;state.groupBy=next;state.currentPage=0;state.pending.clear();state.anchorId='';state.cursorId='';refresh()}
 function togglePending(id,shift=false){if(!state.pageIds.includes(id))return;
  const n=state.pageIds,idx=n.indexOf(id),start=n.indexOf(state.anchorId),select=!state.pending.has(id);
  if(shift&&start>=0){const from=Math.min(start,idx),to=Math.max(start,idx);for(const value of n.slice(from,to+1))state.pending.add(value)}
  else if(select)state.pending.add(id);else state.pending.delete(id);
  state.anchorId=id;state.cursorId=id;refresh();focusCursor(false)
 }
 function markCurrentPage(flag){for(const id of state.pageIds)flag?state.pending.add(id):state.pending.delete(id);refresh()}
 function markGroup(index){const group=state.pageGroups[index];if(!group)return;const full=group.ids.every(id=>state.pending.has(id));for(const id of group.ids)full?state.pending.delete(id):state.pending.add(id);refresh()}
 function excludePending(){const ids=[...state.pending].filter(id=>state.pageIds.includes(id));if(!ids.length)return;
  state.pending.clear();state.anchorId='';commitChoice(ids.map(id=>({id,choice:'제외'})),`체크한 글 ${ids.length}건 제외`);
 }
 function focusCursor(scroll=true){if(!state.cursorId)return;const row=$('card-'+state.cursorId);if(!row)return;row.focus({preventScroll:true});if(scroll)row.scrollIntoView({block:'nearest',behavior:'instant'})}
 function moveCursor(direction){if(state.mode==='timeline'||!state.filtered.length)return;
  const index=state.filtered.findIndex(x=>x.id===state.cursorId),next=Math.max(0,Math.min(state.filtered.length-1,(index<0?(direction>0?-1:1):index)+direction));
  const x=state.filtered[next];if(!x)return;const size=Number($('pageSize').value)||20,page=Math.floor(next/size);
  if(page!==state.currentPage){state.currentPage=page;state.pending.clear();state.anchorId='';state.cursorId=x.id;refresh()}else{state.cursorId=x.id;document.querySelectorAll('.quick-row.is-cursor').forEach(el=>el.classList.remove('is-cursor'));$('card-'+x.id)?.classList.add('is-cursor')}
  focusCursor();storeView();
 }
 function toggleDetailAtCursor(){if(!state.cursorId)return;const row=$('card-'+state.cursorId),details=row?.querySelector('details.quick-detail');if(details){details.open=!details.open;if(details.open)state.expandedRows.add(state.cursorId);else state.expandedRows.delete(state.cursorId)}}
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
  state.pageIds=page.map(x=>x.id);
  $('shownCount').textContent=`전체 ${state.records.length.toLocaleString()}건 중 ${all.length.toLocaleString()}건 표시`;
  $('pageLabel').textContent=state.mode==='timeline'?`현재 페이지 ${page.length}건 · 제외한 글은 Work에서만 제거`:`현재 페이지 ${page.length}건 · 체크는 일괄 제외 전까지 적용되지 않아요`;
  updateQuickUI();updateModeUI();updateBatchUI();
  $('pageInfo').textContent=all.length?`${state.currentPage+1} / ${Math.ceil(all.length/size)} 페이지`:'—';
  $('prevPage').disabled=state.currentPage===0||!all.length;$('nextPage').disabled=(state.currentPage+1)*size>=all.length;
  $('bulkExclude').disabled=!page.length;
  revokeThumbs();$('feed').innerHTML=page.length?(state.mode==='timeline'?page.map(renderCard).join(''):state.mode==='groups'?renderGrouped(page):page.map(renderCompactRow).join('')):`<div class="empty-state"><strong>${state.records.length?'검색 조건에 맞는 게시물이 없습니다.':'아직 불러온 데이터가 없어요'}</strong><p>${state.records.length?'필터를 변경해 주세요.':'Work의 사용자 최종 선별표 엑셀을 불러오세요.'}</p></div>`;
  renderIssues(items);storeView();
 }
 function setChoice(id,choice){const x=state.byId.get(id);if(!x||!['제외','미선택'].includes(choice))return;commitChoice([{id,choice}],`${id} → ${choice}`)}
 function filteredPage(){const size=Number($('pageSize').value)||20;return state.filtered.slice(state.currentPage*size,(state.currentPage+1)*size)}
 function chooseBulk(choice){const items=filteredPage();if(!items.length)return;commitChoice(items.map(x=>({id:x.id,choice})),`현재 페이지 ${choice}`)}
 function jumpTo(id){if(!state.byId.has(id)){notify('선별표에 해당 ID가 없습니다.',true);return}
  state.mode='timeline';state.pending.clear();state.anchorId='';$('query').value=id;['authorFilter','auditFilter','choiceFilter','typeFilter','duplicateFilter'].forEach(k=>$(k).value='');state.currentPage=0;refresh();const target=$('card-'+id);target?.scrollIntoView({behavior:'smooth',block:'start'});
 }
 function closeModal(){if(state.modalUrl){URL.revokeObjectURL(state.modalUrl);state.modalUrl=''}$('imageModal').hidden=true;$('modalImage').removeAttribute('src')}
 function openImage(id){const r=state.byId.get(id),file=r&&imageFileFor(r);if(!file){notify('먼저 원본 캡처 폴더를 연결해 주세요.',true);return}closeModal();state.modalUrl=URL.createObjectURL(file);$('modalImage').src=state.modalUrl;$('modalFilename').textContent=file.name;$('modalTitle').textContent=`원본 캡처 · ${id}`;$('imageModal').hidden=false}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
 function exportBackup(){if(!state.records.length)return;const obj={format:'pia-review-v1',version:1,source:state.source,fingerprint:state.fingerprint,savedAt:new Date().toISOString(),records:state.records,exclusionLedger:ledgerArray()};download(new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'}),'PIA_선별진행_백업_'+new Date().toISOString().slice(0,10)+'.json');notify('현재 선택 상태 전체를 JSON으로 백업했습니다.')}
 function exportWorkXlsx(){if(!state.records.length)return;try{const blob=window.PIAReviewExportXlsx.createWorkbook({records:state.records,ledger:ledgerArray(),source:state.source});download(blob,'PIA_Work_제외체크_누적이력_'+new Date().toISOString().slice(0,10)+'.xlsx');notify(`제외 체크표와 누적 제외 ${state.ledger.size}건을 엑셀로 저장했습니다.`)}catch(e){notify('제외 엑셀 생성 오류: '+e.message,true)}}
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
 function onFilters(){state.currentPage=0;state.pending.clear();state.anchorId='';state.cursorId='';refresh()}
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
  $('clearFilters').onclick=()=>{['query','authorFilter','auditFilter','typeFilter','duplicateFilter'].forEach(id=>$(id).value='');$('choiceFilter').value='active';$('sortFilter').value='original';onFilters()};
  $('quickUnselected').onclick=()=>{$('choiceFilter').value='active';onFilters()};$('quickAll').onclick=()=>{$('choiceFilter').value='';onFilters()};$('undoChoice').onclick=undoLast;$('refreshDb').onclick=refreshExistingDb;
  $('prevPage').onclick=()=>{state.currentPage=Math.max(0,state.currentPage-1);refresh();$('feed').scrollIntoView({block:'start'})};
  $('nextPage').onclick=()=>{state.currentPage++;refresh();$('feed').scrollIntoView({block:'start'})};
  $('bulkExclude').onclick=()=>chooseBulk('제외');
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  $('groupBy').addEventListener('change',e=>setGroupBy(e.target.value));
  $('focusDuplicates').onclick=()=>{const enabled=$('duplicateFilter').value!=='any';$('duplicateFilter').value=enabled?'any':'';$('choiceFilter').value='active';state.mode='quick';onFilters()};
  $('checkPage').addEventListener('change',e=>markCurrentPage(e.target.checked));
  $('clearMarked').onclick=()=>markCurrentPage(false);$('excludeMarked').onclick=excludePending;
  $('floatingClear').onclick=()=>markCurrentPage(false);$('floatingExclude').onclick=excludePending;
  $('exportJson').onclick=exportBackup;$('exportWork').onclick=exportWorkXlsx;$('exportCsv').onclick=exportSelectionCsv;
  $('openIssues').onclick=()=>{state.issuesOpen=!state.issuesOpen;refresh();$('issueDetails')?.scrollIntoView({block:'nearest'})};
  $('feed').addEventListener('click',e=>{
   const cb=e.target.closest('[data-mark]');if(cb){e.preventDefault();togglePending(cb.dataset.mark,e.shiftKey);return}
   const group=e.target.closest('[data-mark-group]');if(group){markGroup(Number(group.dataset.markGroup));return}
   const row=e.target.closest('.quick-row');if(row&& !e.target.closest('button,input,textarea,a,summary,label,select,details')){state.cursorId=row.dataset.postId;row.focus({preventScroll:true})}
   const el=e.target.closest('[data-choose],[data-jump],[data-show-image]');if(!el)return;
   if(el.dataset.choose)setChoice(el.dataset.id,el.dataset.choose);
   else if(el.dataset.jump)jumpTo(el.dataset.jump);else if(el.dataset.showImage)openImage(el.dataset.showImage);
  });
  document.addEventListener('click',e=>{const link=e.target.closest('#issueDetails [data-jump]');if(link)jumpTo(link.dataset.jump)});
  $('feed').addEventListener('toggle',e=>{const det=e.target.closest('[data-detail-id]');if(!det)return;det.open?state.expandedRows.add(det.dataset.detailId):state.expandedRows.delete(det.dataset.detailId)},true);
  $('feed').addEventListener('input',e=>{const node=e.target.closest('[data-memo]');if(!node)return;const x=state.byId.get(node.dataset.memo);if(!x)return;x.memo=node.value;x.fields['사용자 메모']=node.value;ensureMemoSave(x)});
  $('closeImage').onclick=closeModal;$('imageModal').addEventListener('click',e=>{if(e.target===$('imageModal'))closeModal()});
  document.addEventListener('keydown',e=>{
   if(e.key==='Escape'){closeModal();return}
   if(state.mode==='timeline'||$('workspace').hidden||!state.records.length||!$('imageModal').hidden||e.ctrlKey||e.altKey||e.metaKey)return;
   const target=e.target;if(target?.closest('input,textarea,select,button,[contenteditable="true"],details[open] textarea'))return;
   const key=e.key.toLowerCase();if(key==='j'||key==='k'){e.preventDefault();moveCursor(key==='j'?1:-1)}
   else if(key==='x'&&state.cursorId){e.preventDefault();const x=state.byId.get(state.cursorId);if(!x)return;const idx=state.filtered.findIndex(a=>a.id===x.id);
     setChoice(x.id,x.choice==='제외'?'미선택':'제외');if($('card-'+x.id))focusCursor();else{const next=state.filtered[Math.min(idx,state.filtered.length-1)];state.cursorId=next?.id||'';focusCursor()}}
   else if(e.code==='Space'&&state.cursorId){e.preventDefault();toggleDetailAtCursor()}
  });
 }
 async function auth(){
  try{const res=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!res.ok)throw Error('로그인 상태를 확인할 수 없습니다.');const s=await res.json();
   if(!s.authenticated){$('loginPanel').hidden=false;$('workspace').hidden=true;$('loginStatus').textContent=s.configured?'관리자 계정으로 로그인해 주세요.':'ADMIN_PASSWORD 설정이 필요합니다.';return}
   $('loginPanel').hidden=true;$('workspace').hidden=false;
   if(!state.db)await resume();await refreshExistingDb();
  }catch(err){$('loginPanel').hidden=false;$('workspace').hidden=true;$('loginStatus').textContent='관리자 인증 확인 오류: '+err.message}
 }
 bind();auth();
 window.PIA_REVIEW_TEST={recordOf,issues:()=>issues(),state,matchExisting,shingleScore,normalizeBody,setChoice,undoLast,chooseBulk,downloadChoiceCsv:exportSelectionCsv,ledgerFromRecords,enforceExclusions,loadLedger,ledgerArray,importWorkbook,restoreBackup,resume,setMode,setGroupBy,togglePending,markCurrentPage,markGroup,excludePending,moveCursor,groupKey,renderCompactRow,renderGrouped,refresh,updateBatchUI};
})();
