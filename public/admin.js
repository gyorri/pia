const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let db={accounts:[],posts:[]};async function api(path,options={}){let r=await fetch('/api/'+path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});let j=await r.json().catch(()=>({error:'서버 응답 오류'}));if(!r.ok)throw Error(j.error||'요청 실패');return j}function status(s,error=false){const el=$('#status');el.textContent=s;el.hidden=!s;el.classList.toggle('error',error)}async function init(){try{const session=await api('session');if(!session.authenticated)throw Error(session.configured?'로그인 후 계정과 게시물을 관리할 수 있습니다.':'Cloudflare에 ADMIN_PASSWORD Secret을 설정해 주세요.');db=await api('admin-data');$('#loginBox').hidden=true;$('#workspace').hidden=false;refresh()}catch(e){$('#loginBox').hidden=false;$('#workspace').hidden=true;status(e.message,true)}}$('#login').onsubmit=async e=>{e.preventDefault();try{await api('login',{method:'POST',body:JSON.stringify({password:e.target.password.value})});e.target.reset();status('');await init()}catch(e){status(e.message,true)}};$('#logout').onclick=async()=>{await api('logout',{method:'POST'});location.reload()};function avatarEditor(editing){$('#avatarField').hidden=!editing;if(!editing)$('#accountForm').elements.avatar.value=''}function refresh(){const a=db.accounts,p=db.posts;setTimeout(showDuplicates,0);$('#accountCount').textContent=a.length+'개 계정';$('#postCount').textContent=p.length+'개 게시물';const current=$('#accounts').value;$('#accounts').innerHTML='<option value="">작성 계정 선택</option>'+a.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} (@${esc(x.handle)})</option>`).join('');if(a.some(x=>x.id===current))$('#accounts').value=current;refreshParents();renderAccounts();renderPosts()}function refreshParents(){const term=$('#parentSearch').value.toLowerCase(),current=$('#parents').value;let p=db.posts.filter(x=>{let a=db.accounts.find(a=>a.id===x.account_id);return !term||x.content.toLowerCase().includes(term)||(a?.handle||'').toLowerCase().includes(term)});$('#parents').innerHTML='<option value="">연결할 게시물을 선택하세요</option>'+p.map(x=>{let a=db.accounts.find(a=>a.id===x.account_id);return `<option value="${esc(x.id)}">@${esc(a?.handle||'알 수 없음')} · ${esc(x.content.slice(0,70).replace(/\n/g,' '))}</option>`}).join('');if(p.some(x=>x.id===current))$('#parents').value=current}function renderAccounts(){const q=$('#accountSearch').value.toLowerCase(),a=db.accounts.filter(x=>(x.name+' '+x.handle).toLowerCase().includes(q));$('#accountList').innerHTML=a.length?a.map(x=>`<div class="record"><div class="record-main"><div class="record-title">${esc(x.name)}</div><div class="record-meta">@${esc(x.handle)}</div></div><div class="record-actions"><button class="mini" data-edit-account="${esc(x.id)}">수정</button><button class="mini danger" data-delete-account="${esc(x.id)}">삭제</button></div></div>`).join(''):'<div class="empty">등록된 계정이 없습니다.</div>'}function renderPosts(){const q=$('#postSearch').value.toLowerCase(),p=db.posts.filter(x=>{let a=db.accounts.find(a=>a.id===x.account_id);return (x.content+' '+(a?.handle||'')+' '+(a?.name||'')).toLowerCase().includes(q)});$('#postList').innerHTML=p.length?p.map(x=>{let a=db.accounts.find(a=>a.id===x.account_id);return `<div class="record"><div class="record-main"><div class="record-title">${esc(a?.name||'알 수 없는 계정')} <span class="record-meta">@${esc(a?.handle||'')}</span></div><div class="record-meta">${x.parent_id?'↳ 답글 · ':x.quote_content?'인용 게시물 · ':'일반 게시물 · '}${esc(x.posted_at)}${x.date_needs_review?' · ⚠ 날짜수정필요':''}</div><div class="record-content">${esc(x.content)}</div></div><div class="record-actions"><button class="mini" data-edit-post="${esc(x.id)}">수정</button><button class="mini danger" data-delete-post="${esc(x.id)}">삭제</button></div></div>`}).join(''):'<div class="empty">등록된 게시물이 없습니다.</div>'}
function refreshQuoteTargets(){const f=$('#postForm'),q=$('#quotePostId'),term=$('#quotePostSearch').value.toLowerCase(),selected=q.value;const current=f.elements.id.value;q.innerHTML='<option value="">직접 입력 (연결하지 않음)</option>'+db.posts.filter(p=>p.id!==current).filter(p=>{const a=db.accounts.find(a=>a.id===p.account_id);return !term||[p.content,a?.name,a?.handle].some(v=>String(v||'').toLowerCase().includes(term))}).slice(0,150).map(p=>{const a=db.accounts.find(a=>a.id===p.account_id);return `<option value="${esc(p.id)}">${esc(a?.name||'')} (@${esc(a?.handle||'')}) · ${esc(p.content.slice(0,75))}</option>`}).join('');q.value=selected;}
$('#quotePostSearch').addEventListener('input',refreshQuoteTargets);
// 관리자 날짜는 항상 한국 시간(+09:00)으로 입력 및 저장합니다.
// 기존에 다른 시간대로 저장된 기록을 수정할 때는 같은 시점을 한국 시간으로 변환합니다.
function piaAdminKstDateTime(value){
 if(!value)return '';
 const d=new Date(value);
 if(!Number.isFinite(d.getTime()))return '';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);
 const get=type=>parts.find(x=>x.type===type)?.value||'';
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
$('#quotePostId').addEventListener('change',()=>{const id=$('#quotePostId').value,p=db.posts.find(p=>p.id===id);if(!p)return;const a=db.accounts.find(a=>a.id===p.account_id),f=$('#postForm');f.elements.quote_name.value=a?.name||'';f.elements.quote_handle.value=a?.handle||'';f.elements.quote_content.value=p.content;f.elements.quote_posted_at.value=piaAdminKstDateTime(p.posted_at);});
function toggleParent(){const reply=$('#postType').value==='reply',quote=$('#postType').value==='quote';$('#parentField').hidden=!reply;$('#parents').required=reply;if(!reply)$('#parents').value='';$('#quoteField').hidden=!quote;refreshQuoteTargets();for(const name of ['quote_name','quote_handle','quote_content'])$('#postForm').elements[name].required=quote}$('#postType').addEventListener('change',toggleParent);$('#parentSearch').addEventListener('input',refreshParents);$('#accountSearch').addEventListener('input',renderAccounts);
let piaPostSearchTimer;
function piaScheduleAdminLookupRefresh(){
  clearTimeout(piaPostSearchTimer);
  piaPostSearchTimer=setTimeout(()=>{if(!$('#workspace').hidden)reload().catch(e=>status(e.message,true))},350);
}
$('#postSearch').addEventListener('input',()=>{
  renderPosts();
  // Search fresh DB rows, not an older in-memory copy kept by this admin tab.
  piaScheduleAdminLookupRefresh();
});
$('#parentSearch').addEventListener('input',piaScheduleAdminLookupRefresh);
$('#quotePostSearch').addEventListener('input',piaScheduleAdminLookupRefresh);$('#postForm').elements.content.addEventListener('input',()=>{$('#charCount').textContent=$('#postForm').elements.content.value.length});$('#accountForm').addEventListener('reset',()=>{$('#accountSubmit').textContent='계정 저장';avatarEditor(false)});$('#postForm').addEventListener('reset',()=>{setTimeout(()=>{toggleParent();$('#charCount').textContent='0';$('#postSubmit').textContent='게시물 저장';$('#quotePostSearch').value='';refreshQuoteTargets();showDuplicates()},0)});async function reload(){db=await api('admin-data',{cache:'no-store'});refresh()}
const piaSyncChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('pia-posts-sync'):null;
function piaNotifyChanged(){piaSyncChannel?.postMessage('posts-changed')}
function piaAdminRefreshOnReturn(){if(!document.hidden&&!$('#workspace').hidden)reload().catch(e=>status(e.message,true))}
window.addEventListener('focus',piaAdminRefreshOnReturn);
document.addEventListener('visibilitychange',piaAdminRefreshOnReturn);
piaSyncChannel?.addEventListener('message',event=>{if(event.data==='posts-changed')piaAdminRefreshOnReturn()});$('#accountForm').onsubmit=async e=>{e.preventDefault();let d=Object.fromEntries(new FormData(e.target));try{await api('accounts',{method:'POST',body:JSON.stringify(d)});e.target.reset();avatarEditor(false);await reload();piaNotifyChanged();status('계정 저장 완료')}catch(x){status(x.message,true)}};let piaPostSaving=false;
$('#postForm').onsubmit=async e=>{
 e.preventDefault();if(piaPostSaving)return;
 const form=e.target,d=Object.fromEntries(new FormData(form));
 if($('#postType').value==='reply'&&!d.parent_id){status('답글 대상 게시물을 선택하세요.',true);return}
 if($('#postType').value!=='reply')d.parent_id='';
 if($('#postType').value==='quote'){
  d.quote_post_id=$('#quotePostId').value||null;
  d.quote_posted_at=d.quote_posted_at?d.quote_posted_at+'+09:00':null;
 }else{d.quote_post_id=null;d.quote_name='';d.quote_handle='';d.quote_content='';d.quote_posted_at=null}
 d.posted_at=d.posted_at+'+09:00';d.date_needs_review=$('#dateNeedsReview').checked;
 const author=d.account_id,editing=!!d.id,button=$('#postSubmit');
 piaPostSaving=true;button.disabled=true;
 try{
  await api('posts',{method:'POST',body:JSON.stringify(d)});
  form.reset();form.elements.account_id.value=author; // 반복 등록할 때 작성자만 유지
  await reload();piaNotifyChanged();
  status(editing?'게시물 수정 완료':'게시물 저장 완료 · 작성 계정 유지');
  if(!editing)form.elements.content.focus({preventScroll:true});
 }catch(x){status(x.message,true)}finally{piaPostSaving=false;button.disabled=false}
};
// Ctrl/⌘+Enter로 현재 게시물 폼을 저장합니다. 입력 내용은 미리 변경하지 않습니다.
$('#postForm').addEventListener('keydown',e=>{
 if(e.key!=='Enter'||!(e.ctrlKey||e.metaKey)||piaPostSaving)return;
 e.preventDefault();$('#postForm').requestSubmit($('#postSubmit'));
});document.addEventListener('click',async e=>{let b=e.target.closest('button');if(!b)return;let k=b.dataset;if(k.editAccount){let a=db.accounts.find(x=>x.id===k.editAccount),f=$('#accountForm');for(let name of ['id','name','handle','bio','avatar'])f.elements[name].value=a[name]||'';avatarEditor(true);$('#accountSubmit').textContent='계정 수정 저장';f.scrollIntoView({behavior:'smooth'})}if(k.editPost){let p=db.posts.find(x=>x.id===k.editPost),f=$('#postForm');for(let name of ['id','account_id','parent_id','content'])f.elements[name].value=p[name]||'';f.elements.posted_at.value=piaAdminKstDateTime(p.posted_at);$('#dateNeedsReview').checked=!!p.date_needs_review;$('#postType').value=p.parent_id?'reply':p.quote_content?'quote':'original';toggleParent();refreshQuoteTargets();$('#quotePostId').value=p.quote_post_id||'';if(p.parent_id)f.elements.parent_id.value=p.parent_id;for(let name of ['quote_name','quote_handle','quote_content'])f.elements[name].value=p[name]||'';f.elements.quote_posted_at.value=piaAdminKstDateTime(p.quote_posted_at);$('#charCount').textContent=p.content.length;$('#postSubmit').textContent='게시물 수정 저장';f.scrollIntoView({behavior:'smooth'});showDuplicates()}if(k.deleteAccount||k.deletePost){if(!confirm('삭제할까요? 연결된 답글이 있으면 삭제가 거부될 수 있습니다.'))return;try{await api(k.deleteAccount?'accounts':'posts',{method:'DELETE',body:JSON.stringify({id:k.deleteAccount||k.deletePost})});await reload();piaNotifyChanged();status('삭제 완료')}catch(x){status(x.message,true)}}});$('#export').onclick=()=>{let a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.href=u;a.download='pia-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};

// Duplicate suggestions use the already authenticated /api/data response.
// They never send draft content to a separate endpoint.
const duplicatePanel=$('#duplicatePanel');
let duplicateTimer;
const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const compact=s=>normalized(s).replace(/\s/g,'');
function similarity(a,b){
  if(!a||!b)return 0;
  if(a===b)return 1;
  if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)/Math.max(a.length,b.length)*.88;
  const tokens=s=>new Set((s.match(/[\p{L}\p{N}_]{2,}/gu)||[]));
  const x=tokens(a),y=tokens(b);let common=0;for(const t of x)if(y.has(t))common++;
  return x.size+y.size?2*common/(x.size+y.size):0;
}
function showDuplicates(){
 const form=$('#postForm'),raw=form.elements.content.value,query=normalized(raw),dense=compact(raw);
 if(dense.length<8){duplicatePanel.hidden=true;duplicatePanel.replaceChildren();return}
 const current=form.elements.id.value;
 const found=db.posts.filter(p=>String(p.id)!==String(current)).map(p=>{
   const exact=compact(p.content)===dense;
   return {...p,exact,score:exact?1:similarity(query,normalized(p.content))};
 }).filter(p=>p.exact||p.score>=.65).sort((a,b)=>b.score-a.score).slice(0,5);
 if(!found.length){duplicatePanel.hidden=true;duplicatePanel.replaceChildren();return}
 duplicatePanel.hidden=false;
 duplicatePanel.innerHTML='<div class="dup-heading">⚠ 기존 게시물과 유사한 기록 '+found.length+'건'+(found.length===5?' (최대 5건 표시)':'')+'</div>'+
 found.map(p=>{const a=db.accounts.find(a=>a.id===p.account_id);return `<div class="dup-item"><div class="dup-meta"><span class="dup-pill ${p.exact?'dup-exact':''}">${p.exact?'동일 본문':'유사 본문'}</span> ${esc(a?.name||'알 수 없는 계정')} (@${esc(a?.handle||'?')}) · ${esc(p.posted_at||'')}</div><div class="dup-content">${esc(p.content.slice(0,220))}${p.content.length>220?'…':''}</div><button type="button" class="mini" data-duplicate-edit="${esc(p.id)}">기존 게시물 수정하기</button></div>`}).join('')+'<div class="dup-note">중복 경고만 표시하며 저장은 차단하지 않습니다. 날짜·계정이 달라도 본문을 비교합니다.</div>';
}
function scheduleDuplicates(){clearTimeout(duplicateTimer);duplicateTimer=setTimeout(showDuplicates,350)}
$('#postForm').elements.content.addEventListener('input',scheduleDuplicates);
document.addEventListener('click',e=>{const b=e.target.closest('[data-duplicate-edit]');if(!b)return;const id=b.dataset.duplicateEdit;const target=Array.from(document.querySelectorAll("[data-edit-post]")).find(el=>el.dataset.editPost===id);if(target)target.click()});


// 관리자 익명화 전환: 원본 계정은 수정하지 않음
async function refreshAnonState(){try{const d=await api('admin-data');const el=document.querySelector('#anonToggle');if(el){el.checked=!!d.anonymous;document.querySelector('#anonState').textContent=d.anonymous?'현재 공개 화면: 익명화':'현재 공개 화면: 원본 표시'}}catch(e){status(e.message,true)}}
document.querySelector('#anonToggle')?.addEventListener('change',async e=>{const el=e.target;el.disabled=true;try{await api('anonymize',{method:'POST',body:JSON.stringify({enabled:el.checked})});status(el.checked?'익명화가 적용되었습니다.':'원본 표시로 전환했습니다.');await refreshAnonState()}catch(err){el.checked=!el.checked;status(err.message,true)}finally{el.disabled=false}});
const originalInit=init;init=async function(){await originalInit();if(!document.querySelector('#workspace').hidden)await refreshAnonState()};

// Allow pasting copied timestamps into admin post and quoted-post date fields.
function piaAdminParseDate(raw){
 let s=String(raw||'').trim().replace(/\s+/g,' ');
 // X copied timestamp: 오후 2:15 · 2025년 12월 30일
 const x=s.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})\s*[·ㆍ•]\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
 if(x){
  const [,ap,hh,mm,yy,mon,dd]=x;const year=+yy,month=+mon,day=+dd,minute=+mm;let hour=+hh;
  if(hour<1||hour>12||minute>59||month<1||month>12||day<1)return null;
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return null;
  hour=hour%12+(ap==='오후'?12:0);
  return `${yy}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${mm}`;
 }
 // X copied timestamp: 2023. 8. 10. · 오전 12:04
 const reverse=s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*[·ㆍ•]\s*(오전|오후)\s*(\d{1,2}):(\d{2})$/);
 if(reverse){
  const [,yy,mo,dd,ap,hh,mm]=reverse;
  const year=Number(yy),month=Number(mo),day=Number(dd),minute=Number(mm),h=Number(hh);
  if(h<1||h>12||minute>59||month<1||month>12||day<1)return null;
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||check.getUTCDate()!==day)return null;
  const hour=h%12+(ap==='오후'?12:0);
  return `${yy}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${mm}`;
 }
 const mer=s.match(/(오전|오후|AM|PM)/i);s=s.replace(/(오전|오후|AM|PM)/ig,'').trim();
 const m=s.match(/^(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\.?\s*(?:T|\s)\s*(\d{1,2}):(\d{2})(?::\d{2})?$/i);
 if(!m)return null;
 const year=+m[1],month=+m[2],day=+m[3],minute=+m[5];let hour=+m[4];
 if(mer){if(hour<1||hour>12)return null;hour=hour%12+(/오후|PM/i.test(mer[1])?12:0)}
 if(year<1||month<1||month>12||day<1||hour>23||minute>59)return null;
 const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return null;
 return `${m[1]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${m[5]}`;
}
for(const field of ['posted_at','quote_posted_at']){
 const input=$('#postForm').elements[field];
 input.addEventListener('paste',e=>{
  const raw=e.clipboardData?.getData('text');if(!raw)return;
  const parsed=piaAdminParseDate(raw);e.preventDefault();
  if(!parsed){status('날짜 형식을 확인해 주세요. 예: 2026-10-15 14:30',true);return}
  input.value=parsed;input.dispatchEvent(new Event('change',{bubbles:true}));status('날짜가 입력되었습니다. 저장 버튼을 눌러 적용하세요.');
 });
}

// 관리자 화면 탭: 폼 입력 상태를 보존한 채 표시만 전환합니다.
function piaSelectAdminTab(name){
 for(const panel of document.querySelectorAll('[data-admin-panel]'))panel.hidden=panel.dataset.adminPanel!==name;
 for(const tab of document.querySelectorAll('button[data-admin-tab]')){const selected=tab.dataset.adminTab===name;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));}
 try{sessionStorage.setItem('pia_admin_tab',name)}catch(e){}
}
document.querySelectorAll('button[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>piaSelectAdminTab(b.dataset.adminTab)));
let piaInitialTab='post';try{piaInitialTab=sessionStorage.getItem('pia_admin_tab')||'post'}catch(e){}
piaSelectAdminTab(['post','account','settings'].includes(piaInitialTab)?piaInitialTab:'post');
// 기존 수정 버튼에서 해당 폼의 탭으로 먼저 이동합니다.
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.editAccount)piaSelectAdminTab('account');if(b.dataset.editPost)piaSelectAdminTab('post')},true);

// 기존 세션 쿠키가 유효하면 관리자 페이지 진입 시 자동으로 작업 화면을 표시합니다.
init();
