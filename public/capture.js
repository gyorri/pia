/* PIA v0.3.28 – 100% free browser-side OCR; no third-party image API, no server-side image uploads.
   OCR program, WASM, and kor/eng traineddata are downloaded by Tesseract.js from public CDNs.
   Only reviewed, user-approved text is submitted to the existing PIA API. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeAttr=escapeHtml;
const state={images:[],items:[],db:{accounts:[],posts:[]},seq:0,processing:false,cancel:false,worker:null,workerLoading:null,opened:false};
const MAX_FILES=20,MAX_BYTES=18*1024*1024;
const OCR_SCRIPT='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const norm=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
const normHandle=s=>String(s??'').trim().replace(/^@/,'').toLowerCase();
const normBody=s=>norm(s).toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[“”‘’]/g,'"');
const handleValid=s=>/^[A-Za-z0-9_]{1,30}$/.test(String(s??''));
const getAccountByHandle=h=>state.db.accounts.find(a=>normHandle(a.handle)===normHandle(h));
const getAccountById=id=>state.db.accounts.find(a=>String(a.id)===String(id));
const getPostById=id=>state.db.posts.find(p=>String(p.id)===String(id));
const tzOffset='+09:00';
const localeTime=s=>s?`${s.length===16?s+':00':s}${tzOffset}`:'';
const charLimit=(s,n)=>String(s??'').slice(0,n);
const message=(text,error=false)=>{const t=$('captureToast');t.textContent=text;t.classList.toggle('error',error);t.hidden=false;clearTimeout(message.timer);message.timer=setTimeout(()=>t.hidden=true,6500)};
const progress=text=>{$('captureProgress').textContent=text};
async function api(route,payload){const response=await fetch('/api/'+route,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});const d=await response.json().catch(()=>({}));if(!response.ok){const e=new Error(d.error||`서버 오류 ${response.status}`);e.status=response.status;throw e}return d}
async function refreshDb(){state.db=await api('admin-data');renderItems();message(`DB 목록 갱신 완료: 게시물 ${state.db.posts.length}건`)}
async function auth(){try{const session=await api('session');if(!session.authenticated)throw Error('로그인이 필요합니다.');state.db=await api('admin-data');state.opened=true;$('captureWorkspace').hidden=false;$('captureGate').hidden=true;renderAll()}catch(e){state.opened=false;$('captureWorkspace').hidden=true;$('captureGate').hidden=false;message(e.message,true)}}
function dateFromText(source){
 const text=String(source||'').normalize('NFKC').replace(/\s+/g,' ');
 const yr='(20\\d{2})',month='(\\d{1,2})',day='(\\d{1,2})';
 let y,m,d,h='',min='',period='';
 const find1=text.match(new RegExp(`(오전|오후)\\s*(\\d{1,2}):(\\d{2})(?:\\s*[·•|]\\s*)?${yr}년\\s*${month}월\\s*${day}일`));
 const find2=text.match(new RegExp(`${yr}년\\s*${month}월\\s*${day}일(?:\\s*[·•|]\\s*|\\s+)(오전|오후)\\s*(\\d{1,2}):(\\d{2})`));
 const find3=text.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\.?\s*[·•]?\s*(오전|오후)\s*(\d{1,2}):(\d{2})/);
 const find4=text.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
 const find5=text.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
 if(find1){[,period,h,min,y,m,d]=find1}else if(find2||find3){[,y,m,d,period,h,min]=find2||find3}else if(find4||find5){[,y,m,d]=find4||find5}else return {value:'',confirmed:false,source:'unreadable'};
 const yy=Number(y),mm=Number(m),dd=Number(d),date=new Date(Date.UTC(yy,mm-1,dd));if(date.getUTCFullYear()!==yy||date.getUTCMonth()!==mm-1||date.getUTCDate()!==dd)return {value:'',confirmed:false,source:'invalid'};
 let full=false,hh=12,mi=0;
 if(h&&min){hh=Number(h);mi=Number(min);if(hh<1||hh>12||mi>59)return {value:'',confirmed:false,source:'invalid'};hh=(hh%12)+(period==='오후'?12:0);full=true}
 const value=`${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
 return {value,confirmed:full,source:full?'visible datetime':'visible date only'};
}
function parseCandidates(text){
 const raw=String(text??'').replace(/\r/g,'').trim(),lines=raw.split('\n');
 if(!raw)return [{name:'',handle:'',content:'',date:'',dateReview:true,reason:'인식한 글자가 없습니다. 원문을 직접 입력해 주세요.'}];
 const marks=[];
 lines.forEach((line,i)=>{const match=line.match(/^\s*(?:[^@\n]{0,40}\s+)?@([A-Za-z0-9_]{2,30})(?:\s|$|[·•])/);if(match&&i>0)marks.push(i)});
 // Split only at lines resembling account headers (prefer blank separators / nearby X dates).
 const boundaries=[0];for(const m of marks){
  if(m<=boundaries[boundaries.length-1]+2)continue;
  const next=(lines[m+1]||'').trim(),prev=(lines[m-1]||'').trim();
  const strongHeader=/^\s*[^@\n]{1,35}\s+@[A-Za-z0-9_]{2,30}\s*(?:[·•].*)?$/.test(lines[m]);
  const dateNeighbor=/(?:오전|오후)\s*\d{1,2}:\d\d|20\d{2}년\s*\d+월|20\d{2}[.\-/]\d{1,2}/.test(next);
  if(!prev||(strongHeader&&dateNeighbor))boundaries.push(m)
 }
 const blocks=boundaries.map((start,i)=>lines.slice(start,boundaries[i+1]??lines.length).join('\n').trim()).filter(Boolean);
 return blocks.map((block,index)=>{
  const bLines=block.split('\n').map(x=>x.trimEnd());let detectedHandle='',name='';
  let headerIdx=-1;
  for(let i=0;i<Math.min(6,bLines.length);i++){
   const line=bLines[i].trim();const inline=line.match(/^(.{1,45}?)\s+@([A-Za-z0-9_]{2,30})(?:\s*[·•].*)?$/);
   const only=line.match(/^@([A-Za-z0-9_]{2,30})(?:\s*[·•].*)?$/);
   if(inline||only){detectedHandle=(inline||only)[2]||(only&&only[1])||'';name=inline?inline[1].trim():i>0?bLines[i-1].trim().slice(0,100):'';headerIdx=i;break}
  }
  if(!detectedHandle){const mt=block.match(/@([A-Za-z0-9_]{2,30})/);if(mt)detectedHandle=mt[1]}
  const parsedDate=dateFromText(block);
  const scrub=bLines.filter((l,i)=>{
   if(i===headerIdx||(i===headerIdx-1&&name&&l.trim()===name))return false;
   if(/^\s*(?:\d[\d,.만천KkMm]*)?\s*조회수\s*$/.test(l))return false;
   if(/^(?:오전|오후)\s*\d{1,2}:\d\d\s*[·•]?\s*20\d{2}년.*$/.test(l.trim()))return false;
   if(/^20\d{2}년\s*\d+월\s*\d+일.*(?:오전|오후)\s*\d+:\d\d/.test(l.trim()))return false;
   if(/^[\s·•]*(?:답글|리포스트|마음에 들어요|좋아요|북마크|공유|보기)[\s·•]*$/.test(l))return false;
   return true;
  });
  const content=scrub.join('\n').trim().slice(0,10000);
  return {name:charLimit(name,100),handle:detectedHandle,content,date:parsedDate.value,dateReview:true,reason:parsedDate.confirmed?'원본 시각이 감지됐지만 사람이 확인해야 합니다.':parsedDate.value?'날짜만 감지됨: 12:00은 임시 시각입니다.':'원본 날짜를 인식하지 못했습니다.',block:index};
 });
}
function newItem(image,extracted={}){return {id:'c'+(++state.seq),imageId:image.id,sourceName:image.name,name:extracted.name||'',handle:extracted.handle||'',accountId:'',content:extracted.content||'',date:extracted.date||'',dateReview:extracted.dateReview!==false,type:'original',parentId:'',quotePostId:'',quoteName:'',quoteHandle:'',quoteContent:'',quoteDate:'',parentSearch:'',quoteSearch:'',decision:'pending',manualSeparate:false,checking:false,saving:false,resultId:'',reason:extracted.reason||'',allowDistinct:false};}
function sameBody(a,b){return normBody(a)===normBody(b)}
function similarBody(a,b){a=normBody(a);b=normBody(b);if(!a||!b)return 0;if(a===b)return 1;if(Math.min(a.length,b.length)>40&&(a.includes(b)||b.includes(a)))return Math.min(a.length,b.length)/Math.max(a.length,b.length);if(a.length>850||b.length>850){a=a.slice(0,850);b=b.slice(0,850)}if(Math.max(a.length,b.length)/Math.max(1,Math.min(a.length,b.length))>1.3)return 0;
 // Damerau-free edit distance with two rows; bounded for local UI responsiveness.
 const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);for(let i=1;i<=a.length;i++){cur[0]=i;for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<prev.length;j++)prev[j]=cur[j]}return 1-prev[b.length]/Math.max(a.length,b.length)}
function duplicateHits(item){const handle=normHandle(getAccountById(item.accountId)?.handle||item.handle),body=normBody(item.content);if(!handle||!body||body.length<3)return [];
 const matched=[];for(const post of state.db.posts){const acct=getAccountById(post.account_id);if(normHandle(acct?.handle)!==handle)continue;const exact=sameBody(body,post.content);let score=exact?1:0;if(!exact&&body.length>=15&&String(post.content||'').length>=15)score=similarBody(body,post.content);if(score>=.84)matched.push({exact,score,post,other:null})}
 for(const other of state.items){if(other.id===item.id||other.decision==='excluded'||other.decision==='registered'||normHandle(getAccountById(other.accountId)?.handle||other.handle)!==handle)continue;const score=sameBody(body,other.content)?1:similarBody(body,other.content);if(score>=.84)matched.push({exact:score===1,score,post:null,other})}
 return matched.sort((a,b)=>b.score-a.score).slice(0,6)}
function renderImages(){const node=$('captureImages');$('captureCount').textContent=state.images.length+'장';if(!state.images.length){node.innerHTML='<div class="empty">아직 추가한 이미지가 없습니다.</div>';return}
 node.innerHTML=state.images.map(img=>`<article class="capture-image-card" data-img="${safeAttr(img.id)}"><div class="capture-card-head"><strong>${escapeHtml(img.name)}</strong><div class="capture-card-tools"><button type="button" data-image-action="scan" data-id="${safeAttr(img.id)}" ${img.status==='scanning'?'disabled':''}>다시 인식</button><button type="button" data-image-action="remove" data-id="${safeAttr(img.id)}">제거</button></div></div><div class="capture-photo-row"><div>${img.url?`<a href="${safeAttr(img.url)}" target="_blank" rel="noopener noreferrer" title="원본 크기로 이미지 보기"><img class="capture-photo-preview" src="${safeAttr(img.url)}" alt="원본 ${safeAttr(img.name)}"></a><small>이미지를 누르면 원본 크기로 볼 수 있습니다.</small>`:'<div class="capture-no-preview">JSON에서 불러온 기록입니다. 이미지 미리보기는 없습니다.</div>'}</div><div><div class="capture-ocr-meta">${escapeHtml(img.status==='scanning'?'인식 중…':img.status==='done'?'인식 완료':img.status==='error'?'OCR 실패 · 수동 입력 가능':img.status==='queued'?'인식 대기':'텍스트 검토')} ${img.confidence==null?'':`· 글자 인식 신뢰도 참고값 ${Math.round(img.confidence)}%`}</div><label>인식한 글자 전체<textarea class="capture-ocr-text" data-image-text="${safeAttr(img.id)}" spellcheck="false" placeholder="OCR 결과를 수정해 주세요.">${escapeHtml(img.raw||'')}</textarea></label><div class="capture-photo-tools"><button type="button" data-image-action="parse" data-id="${safeAttr(img.id)}">이 텍스트로 게시물 다시 나누기</button><button type="button" data-image-action="add" data-id="${safeAttr(img.id)}">게시물 직접 추가</button></div><small>게시물 ${state.items.filter(i=>i.imageId===img.id).length}건 · 재분리하면 기존 미등록 후보를 교체합니다. 이미 등록된 게시물은 DB에서 삭제되지 않습니다.</small></div></div></article>`).join('')}
function optionPost(p){const a=getAccountById(p.account_id);return `<option value="${safeAttr(p.id)}">@${escapeHtml(a?.handle||'unknown')} · ${escapeHtml(String(p.content||'').slice(0,85).replace(/\n/g,' '))}</option>`}
function duplicateHtml(item){const hits=duplicateHits(item);let intro='';if(!normHandle(item.handle)&&!item.accountId)intro='<div class="capture-warn">작성자 확인 후 중복 비교가 가능합니다.</div>';else if(!item.content.trim())intro='<div class="capture-warn">본문을 입력하면 중복 비교가 가능합니다.</div>';else if(!hits.length)intro='<div class="capture-none">현재 불러온 DB와 대기열에서 일치하는 글이 없습니다. 등록 직전에 다시 검사합니다.</div>';
 return intro+hits.map(hit=>{const p=hit.post,a=p?getAccountById(p.account_id):null;const label=hit.exact?'본문이 동일함':'유사 게시물';const when=p?.posted_at||hit.other?.date||'';const url=p?`<a target="_blank" rel="noopener" href="/#/post/${encodeURIComponent(p.id)}">기존 글 보기 ↗</a>`:'이번 대기열의 다른 후보';return `<div class="capture-duplicate"><strong>${escapeHtml(label)} · 유사도 ${Math.round(hit.score*100)}%</strong>${escapeHtml(a?.name||hit.other?.name||'')} ${escapeHtml(when)}<p>${escapeHtml(String(p?.content||hit.other?.content||'').slice(0,160))}</p>${url}</div>`}).join('')}
function renderItems(){const filter=$('captureFilter').value,display=state.items.filter(it=>filter==='all'||it.decision===filter);$('captureCandidateCount').textContent=state.items.length+'건';const box=$('captureCandidates');if(!display.length){box.innerHTML='<div class="empty">현재 표시할 게시물이 없습니다.</div>';return}
 const accounts=state.db.accounts;const accountChoices=accounts.map(a=>`<option value="${safeAttr(a.id)}">${escapeHtml(a.name)} (@${escapeHtml(a.handle)})</option>`).join('');
 const allPosts=state.db.posts;
 box.innerHTML=display.map((it,ix)=>{
  const hits=duplicateHits(it),dateOnly=it.reason.includes('날짜만'),reg=it.decision==='registered',locked=reg?'disabled':'';
  const postSearch=(text,selected)=>{
   const q=norm(text).toLowerCase();const list=allPosts.filter(p=>p.id!==it.resultId).filter(p=>{const author=getAccountById(p.account_id);return !q||[p.content,author?.handle,author?.name].some(v=>String(v||'').toLowerCase().includes(q))}).slice(0,80);
   if(selected&&!list.some(p=>String(p.id)===String(selected))){const selectedPost=getPostById(selected);if(selectedPost)list.unshift(selectedPost)}
   return list.map(optionPost).join('');
  };
  const parentOptions=postSearch(it.parentSearch,it.parentId);
  const quoteOptions=postSearch(it.quoteSearch,it.quotePostId);
  return `<article class="capture-candidate" data-item="${safeAttr(it.id)}" aria-busy="${it.saving?'true':'false'}"><div class="capture-card-head"><strong>${escapeHtml(it.sourceName)} · 후보 ${ix+1}</strong><span class="capture-state ${it.decision}">${({pending:'검토 대기',hold:'보류',excluded:'제외',registered:'등록 완료'})[it.decision]}</span></div>
  <div class="capture-candidate-main"><div class="capture-form-grid">
   <label>OCR 작성자 닉네임<input data-key="name" maxlength="100" value="${safeAttr(it.name)}" ${locked} placeholder="원본에서 확인"></label>
   <label>@아이디<input data-key="handle" maxlength="30" value="${safeAttr(it.handle)}" ${locked} placeholder="@ 없이 입력"></label>
   <label class="capture-wide">PIA 작성 계정 선택<select data-key="accountId" ${locked}><option value="">@아이디로 기존 계정 자동 검색</option>${accountChoices}</select><small>계정이 없으면 아래에서 새 계정 등록(명시적 승인)</small></label>
   <div class="capture-wide capture-inline"><small>계정이 목록에 없다면 닉네임과 @아이디를 확인하세요.</small><button type="button" data-action="create-account" ${locked}>이 작성자 계정 등록</button></div>
   <label>게시물 유형<select data-key="type" ${locked}><option value="original">일반 게시물</option><option value="reply">답글</option><option value="quote">인용 게시물</option></select></label>
   <label>원본 작성일시(KST)<input type="datetime-local" data-key="date" step="60" value="${safeAttr(it.date)}" ${locked}><small>${dateOnly?'시각은 OCR에서 확인되지 않아 12:00을 임시 기입했습니다.': '원본 날짜가 불확실하면 직접 확인하세요.'}</small></label>
   <label class="capture-wide capture-checkbox"><input type="checkbox" data-key="dateReview" ${it.dateReview?'checked':''} ${locked}> 날짜수정필요(원본 시각 미확정이면 반드시 유지)</label>
   <label class="capture-wide">게시물 본문<textarea data-key="content" rows="6" maxlength="10000" ${locked} placeholder="원본 이미지와 비교하여 수정하세요.">${escapeHtml(it.content)}</textarea></label>
   ${it.type==='reply'?`<label class="capture-wide">답글 대상 원글 검색<input data-key="parentSearch" type="search" value="${safeAttr(it.parentSearch)}" placeholder="원글 본문 또는 @아이디 입력 후 엔터/화면 밖 클릭" ${locked}><small>기존 게시물 전체에서 검색합니다.</small></label><label class="capture-wide">답글 대상 원글 (직접 확인 필수)<select data-key="parentId" ${locked}><option value="">답글을 연결할 게시물 선택</option>${parentOptions}</select><small>잘못 연결하지 않도록 자동 선택하지 않습니다.</small></label>`:''}
   ${it.type==='quote'?`<label class="capture-wide">인용 원문 검색<input data-key="quoteSearch" type="search" value="${safeAttr(it.quoteSearch)}" placeholder="원글 본문 또는 @아이디 입력 후 엔터/화면 밖 클릭" ${locked}></label><label class="capture-wide">기존 게시물 인용 연결 (선택)<select data-key="quotePostId" ${locked}><option value="">원문 정보를 직접 입력</option>${quoteOptions}</select></label><label>인용 원문 닉네임<input data-key="quoteName" value="${safeAttr(it.quoteName)}" ${locked}></label><label>인용 원문 @아이디<input data-key="quoteHandle" value="${safeAttr(it.quoteHandle)}" ${locked}></label><label class="capture-wide">인용 원문 본문<textarea data-key="quoteContent" ${locked}>${escapeHtml(it.quoteContent)}</textarea></label><label class="capture-wide">인용 원문 날짜(KST, 선택)<input type="datetime-local" data-key="quoteDate" value="${safeAttr(it.quoteDate)}" ${locked}></label>`:''}
  </div><aside class="capture-side"><h3>기존 게시물 중복 비교</h3>${duplicateHtml(it)}<p>작성자가 다르거나 이미지 인식 오타가 있으면 중복을 놓칠 수 있습니다. 반드시 원본과 비교하세요.</p>${hits.some(x=>x.exact)?`<label class="capture-checkbox"><input type="checkbox" data-key="allowDistinct" ${it.allowDistinct?'checked':''} ${locked}> 동일 본문이지만 서로 다른 게시물임을 날짜로 확인했습니다.</label>`:''}${it.reason?`<p>OCR 메모: ${escapeHtml(it.reason)}</p>`:''}${reg?`<p><strong>등록 ID:</strong> ${escapeHtml(it.resultId)}</p>`:''}</aside></div>
  <div class="capture-final-actions">${reg?`<a class="capture-link" href="/#/post/${encodeURIComponent(it.resultId)}" target="_blank" rel="noopener">등록 게시물 보기 ↗</a>`:`<button class="primary" type="button" data-action="save" ${(it.saving||it.decision!=='pending')?'disabled':''}>중복 검사 후 등록</button><button class="secondary" type="button" data-action="hold" ${it.saving?'disabled':''}>보류</button><button class="secondary" type="button" data-action="pending">검토 대기</button><button class="danger" type="button" data-action="exclude">제외</button><button class="secondary" type="button" data-action="duplicate">이 이미지에서 글 추가</button>`}</div></article>`;
 }).join('');
 for(const it of display){const card=box.querySelector(`[data-item="${it.id}"]`);if(!card)continue;const select=card.querySelector('[data-key=accountId]');if(select)select.value=it.accountId||'';const ty=card.querySelector('[data-key=type]');if(ty)ty.value=it.type;const par=card.querySelector('[data-key=parentId]');if(par)par.value=it.parentId||'';const quote=card.querySelector('[data-key=quotePostId]');if(quote)quote.value=it.quotePostId||''}
}
function renderAll(){renderImages();renderItems()}
function findItem(id){return state.items.find(it=>it.id===id)}
function setImageText(img,value){img.raw=value}
function reparse(img,{confirmReplace=true}={}){if(confirmReplace&&state.items.some(it=>it.imageId===img.id)){if(!confirm('이 이미지의 미등록 후보는 새 OCR 내용으로 교체됩니다. 직접 수정한 내용은 사라집니다. 등록 완료된 글은 DB에 유지됩니다. 계속할까요?'))return}
 const extracted=parseCandidates(img.raw);state.items=state.items.filter(it=>it.imageId!==img.id||it.decision==='registered');state.items.push(...extracted.map(t=>newItem(img,t)));renderAll();message(`${img.name}: ${extracted.length}개 후보를 만들었습니다. 원본과 확인해 주세요.`)}
async function ensureWorker(){if(state.worker)return state.worker;if(state.workerLoading)return state.workerLoading;
 state.workerLoading=(async()=>{
  if(!window.Tesseract){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=OCR_SCRIPT;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error('무료 OCR 프로그램을 내려받지 못했습니다. 네트워크 또는 CDN 차단을 확인하세요.'));document.head.appendChild(s)})}
  if(!window.Tesseract?.createWorker)throw Error('OCR 프로그램 초기화에 실패했습니다.');
  progress('무료 OCR 한글·영문 모델을 내려받는 중입니다. 첫 실행은 시간이 걸릴 수 있습니다.');
  state.worker=await Tesseract.createWorker(['kor','eng'],1,{logger:m=>{if(m.status&&state.processing)progress(`브라우저 OCR: ${m.status} ${m.progress?Math.round(m.progress*100)+'%':''}`)}});
  return state.worker;
 })().finally(()=>{state.workerLoading=null});return state.workerLoading}
async function scanImage(img){if(!img.file||state.cancel)return;img.status='scanning';renderImages();try{const worker=await ensureWorker();if(state.cancel)return;progress(`${img.name}: 이미지의 글자를 읽는 중…`);const result=await worker.recognize(img.file);img.raw=String(result?.data?.text||'');img.confidence=Number.isFinite(result?.data?.confidence)?result.data.confidence:null;img.status='done';reparse(img,{confirmReplace:false})}catch(e){img.status='error';progress(`인식 실패: ${e.message}. 아래 원문 입력칸에 직접 적을 수도 있습니다.`);message(`인식 오류: ${e.message}`,true)}finally{renderImages()}}
async function processQueue(){if(state.processing)return;state.processing=true;state.cancel=false;$('captureCancel').disabled=false;try{while(!state.cancel){const queued=state.images.find(img=>img.status==='queued'&&img.file);if(!queued)break;await scanImage(queued)}}finally{state.processing=false;$('captureCancel').disabled=true;if(state.cancel){for(const img of state.images)if(img.status==='queued')img.status='paused';progress('대기열을 중지했습니다. 이미 인식한 글자는 보존됩니다.')}else progress(`인식 대기열 완료 · 이미지 ${state.images.length}장 · 검토 후보 ${state.items.length}건`);renderAll()}}
async function fileHash(file){if(!window.crypto?.subtle)return `${file.name}:${file.size}:${file.lastModified}`;const buffer=await file.arrayBuffer();const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')}
async function addFiles(files){let accepted=0;const incoming=Array.from(files||[]);if(incoming.length>MAX_FILES)message(`한 번에 ${MAX_FILES}장까지 처리합니다. 나머지는 다시 선택해 주세요.`,true);for(const file of incoming.slice(0,MAX_FILES)){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)){message(`지원하지 않는 파일: ${file.name}`,true);continue}
 if(file.size>MAX_BYTES){message(`${file.name}은 18MB가 넘어서 건너뜁니다.`,true);continue}
 const hash=await fileHash(file);if(state.images.some(img=>img.hash===hash)){message(`${file.name}: 동일 이미지가 이미 대기열에 있습니다.`);continue}
 const img={id:'i'+(++state.seq),name:file.name,file,hash,url:URL.createObjectURL(file),status:'queued',raw:'',confidence:null};state.images.push(img);accepted++}
 if(accepted){renderAll();if(!state.processing)processQueue()}}
function updateItemField(it,key,value){if(!it||it.decision==='registered')return;if(key==='dateReview'||key==='allowDistinct')it[key]=!!value;else it[key]=String(value);if(key==='handle'){const acct=getAccountByHandle(value);it.accountId=acct?.id||''}if(key==='accountId'&&value){const acct=getAccountById(value);if(acct){it.handle=acct.handle;it.name=acct.name}}if(key==='date'&&it.date)it.dateReview=true;if(key==='content'||key==='date'||key==='handle'||key==='accountId')it.allowDistinct=false}
async function createAccount(it){const name=it.name.trim(),handle=normHandle(it.handle);if(!name||!handleValid(handle)){message('닉네임과 올바른 @아이디를 먼저 입력하세요.',true);return}const old=getAccountByHandle(handle);if(old){it.accountId=old.id;it.name=old.name;it.handle=old.handle;renderItems();message('기존 계정을 연결했습니다.');return}
 if(!confirm(`새 계정을 등록할까요?\n\n닉네임: ${name}\n아이디: @${handle}\n\n캡처 원본과 비교한 후 확인을 누르세요.`))return;
 try{await api('accounts',{name,handle,bio:''});state.db=await api('admin-data');const a=getAccountByHandle(handle);it.accountId=a?.id||'';renderItems();message(`@${handle} 계정을 등록했습니다.`)}catch(e){message('계정 등록 실패: '+e.message,true)}}
function reviewError(it){if(it.decision!=='pending')return '보류·제외 항목은 검토 대기로 되돌려야 등록할 수 있습니다.';const acct=getAccountById(it.accountId)||getAccountByHandle(it.handle);if(!acct)return '작성자를 PIA 계정과 연결하거나 새 계정을 먼저 등록해 주세요.';
 if(!it.content.trim())return '원문 본문이 비어 있습니다.';if(it.content.length>10000)return '본문이 너무 깁니다.';
 if(!it.date||Number.isNaN(Date.parse(localeTime(it.date))))return '원본 날짜를 확인해 주세요. 자동으로 오늘 날짜를 넣지 않습니다.';
 if(it.type==='reply'&&!it.parentId)return '답글 대상 원글을 직접 선택해 주세요.';
 if(it.type==='reply'&&!getPostById(it.parentId))return '원글이 DB에 없습니다. 새로고침 후 확인하세요.';
 if(it.type==='quote'&&!it.quotePostId&&(!it.quoteName.trim()||!handleValid(normHandle(it.quoteHandle))||!it.quoteContent.trim()))return '인용 원문의 닉네임·아이디·본문 또는 기존 게시물을 확인해 주세요.';
 if(it.type==='quote'&&it.quotePostId&&!getPostById(it.quotePostId))return '인용 원본 글을 다시 선택해 주세요.';
 if(duplicateHits(it).some(h=>h.exact)&&!it.allowDistinct)return '동일 작성자의 동일 본문이 있습니다. 별개 게시물인지 날짜와 원문을 확인한 뒤 체크해 주세요.';
 return ''}
async function saveItem(it){if(it.saving||it.decision==='registered')return;
 // Latest DB must be considered before writing (another admin may have saved during review).
 it.saving=true;renderItems();try{
  state.db=await api('admin-data');const error=reviewError(it);if(error){message(error,true);return}
  const acct=getAccountById(it.accountId)||getAccountByHandle(it.handle);
  const hits=duplicateHits(it);
  if(hits.length&&!confirm(`유사하거나 같은 게시물 ${hits.length}건이 있습니다.\n\n원본과 날짜를 대조했고, 서로 다른 게시물인 것을 확인했다면 계속하세요.\n실제 같은 글이면 취소해 주세요.`))return;
  if(!confirm(`다음 게시물을 PIA에 등록할까요?\n\n작성자: @${acct.handle}\n종류: ${{original:'일반 글',reply:'답글',quote:'인용'}[it.type]}\n날짜: ${it.date} (KST)${it.dateReview?' · 날짜수정필요':''}\n본문: ${it.content.slice(0,150)}${it.content.length>150?'…':''}`))return;
  const payload={account_id:acct.id,content:it.content,posted_at:localeTime(it.date),date_needs_review:!!it.dateReview,parent_id:it.type==='reply'?it.parentId:null,quote_post_id:it.type==='quote'?(it.quotePostId||null):null,quote_name:it.type==='quote'?it.quoteName.trim():'',quote_handle:it.type==='quote'?normHandle(it.quoteHandle):'',quote_content:it.type==='quote'?it.quoteContent:'',quote_posted_at:it.type==='quote'&&it.quoteDate?localeTime(it.quoteDate):null};
  const out=await api('posts',payload);it.decision='registered';it.resultId=out.id||'';state.db=await api('admin-data');renderAll();message('등록 완료. 원본 캡처는 서버에 업로드되지 않았습니다.');
  if(typeof BroadcastChannel==='function'){const bc=new BroadcastChannel('pia-posts-sync');bc.postMessage('posts-changed');bc.close()}
 }catch(e){message('게시물 저장 실패: '+e.message,true)}finally{it.saving=false;renderItems()}}
function deleteImg(img){if(!img)return;if(img.status==='scanning'){message('현재 인식 중인 이미지는 완료 후 제거할 수 있습니다.',true);return}if(state.items.some(it=>it.imageId===img.id&&it.decision==='registered')){if(!confirm('등록된 게시물은 DB에 유지됩니다. 이미지와 검토 기록만 제거할까요?'))return}
 if(img.url)URL.revokeObjectURL(img.url);state.images=state.images.filter(i=>i.id!==img.id);state.items=state.items.filter(it=>it.imageId!==img.id);renderAll()}
function saveDraft(){const draft={format:'pia-capture-draft-v1',created_at:new Date().toISOString(),images:state.images.map(({id,name,hash,status,raw,confidence})=>({id,name,hash,status:'manual',raw,confidence})),items:state.items.map(it=>{const {saving,checking,...rest}=it;return rest})};const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='pia-capture-review-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);message('검토 초안 저장 완료. 원본 이미지는 JSON에 포함되지 않습니다.')}
async function loadDraft(file){try{if(state.processing)throw Error('현재 이미지 인식 중입니다. 대기열을 중지하고 다시 시도해 주세요.');const body=JSON.parse(await file.text());if(body.format!=='pia-capture-draft-v1'||!Array.isArray(body.images)||!Array.isArray(body.items))throw Error('PIA 캡처 초안 형식이 아닙니다.');if(body.items.length>3000||body.images.length>3000)throw Error('너무 많은 기록입니다.');if((state.images.length||state.items.length)&&!confirm('현재 미등록 검토 대기열을 모두 교체할까요? DB의 기존 등록 글은 삭제되지 않습니다.'))return;
 for(const img of state.images)if(img.url)URL.revokeObjectURL(img.url);
 state.images=body.images.map((v,i)=>({id:'i'+(i+1),name:charLimit(v.name,200)||'원본 파일',hash:String(v.hash||''),status:'manual',raw:charLimit(v.raw,300000),confidence:null,url:null,file:null}));
 const ids=new Map(body.images.map((v,i)=>[String(v.id),'i'+(i+1)]));
 state.items=body.items.map((v,i)=>({id:'c'+(i+1),imageId:ids.get(String(v.imageId))||state.images[0]?.id||'',sourceName:charLimit(v.sourceName,200),name:charLimit(v.name,100),handle:charLimit(v.handle,30),accountId:String(v.accountId||''),content:charLimit(v.content,10000),date:charLimit(v.date,19),dateReview:v.dateReview!==false,type:['original','reply','quote'].includes(v.type)?v.type:'original',parentId:String(v.parentId||''),quotePostId:String(v.quotePostId||''),quoteName:charLimit(v.quoteName,100),quoteHandle:charLimit(v.quoteHandle,30),quoteContent:charLimit(v.quoteContent,10000),quoteDate:charLimit(v.quoteDate,19),parentSearch:charLimit(v.parentSearch,120),quoteSearch:charLimit(v.quoteSearch,120),decision:['pending','hold','excluded','registered'].includes(v.decision)?v.decision:'hold',manualSeparate:true,checking:false,saving:false,resultId:String(v.resultId||''),reason:charLimit(v.reason,300),allowDistinct:false}));
 state.seq=Math.max(state.images.length,state.items.length)+1;renderAll();message('검토 초안을 불러왔습니다. 원본 이미지 미리보기는 다시 선택해야 합니다.');
 }catch(e){message('초안 가져오기 실패: '+e.message,true)}}
// Events
$('captureFiles').addEventListener('change',e=>{addFiles(e.target.files);e.target.value=''})
const drop=$('captureDrop');drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('captureFiles').click()}});for(const kind of ['dragenter','dragover'])drop.addEventListener(kind,e=>{e.preventDefault();drop.classList.add('dragover')});for(const kind of ['dragleave','drop'])drop.addEventListener(kind,e=>{e.preventDefault();drop.classList.remove('dragover')});drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
document.addEventListener('paste',e=>{if(!state.opened)return;const images=Array.from(e.clipboardData?.items||[]).filter(i=>i.type.startsWith('image/')).map((i,index)=>{const f=i.getAsFile();return f?new File([f],`pasted_${Date.now()}_${index}.png`,{type:f.type}):null}).filter(Boolean);if(images.length){e.preventDefault();addFiles(images)}})
$('captureCancel').addEventListener('click',()=>{state.cancel=true;message('현재 이미지 인식이 끝나면 대기열을 중지합니다.')});
$('captureSaveDraft').addEventListener('click',saveDraft);
$('captureDraftFile').addEventListener('change',e=>{const file=e.target.files[0];if(file)loadDraft(file);e.target.value=''})
$('captureClear').addEventListener('click',()=>{if(state.processing){message('인식 대기열을 먼저 중지해 주세요.',true);return}if(!confirm('대기열과 검토 기록을 초기화할까요? 이미 PIA DB에 등록된 글은 삭제되지 않습니다.'))return;for(const i of state.images)if(i.url)URL.revokeObjectURL(i.url);state.images=[];state.items=[];renderAll()});
$('captureFilter').addEventListener('change',renderItems);$('captureRefreshDb').addEventListener('click',()=>refreshDb().catch(e=>message(e.message,true)));
$('captureImages').addEventListener('input',e=>{const id=e.target.dataset.imageText,img=state.images.find(x=>x.id===id);if(img)setImageText(img,e.target.value)});
$('captureImages').addEventListener('click',e=>{const button=e.target.closest('[data-image-action]');if(!button)return;const img=state.images.find(x=>x.id===button.dataset.id);if(!img)return;switch(button.dataset.imageAction){case 'remove':deleteImg(img);break;case 'parse':reparse(img);break;case 'add':state.items.push(newItem(img,{reason:'직접 분리한 게시물입니다. 원본을 확인해 주세요.'}));renderItems();break;case 'scan':if(!img.file){message('원본 이미지가 없습니다. 이미지를 다시 추가해 주세요.',true);return}if(state.items.some(it=>it.imageId===img.id)&&!confirm('다시 인식하면 이 이미지의 미등록 후보 편집 내용이 사라집니다. 계속할까요?'))return;if(state.processing){message('현재 다른 이미지를 인식하는 중입니다.',true);return}img.status='queued';processQueue();break}})
$('captureCandidates').addEventListener('input',e=>{const card=e.target.closest('[data-item]'),it=card&&findItem(card.dataset.item),key=e.target.dataset.key;if(!it||!key)return;updateItemField(it,key,e.target.type==='checkbox'?e.target.checked:e.target.value)})
$('captureCandidates').addEventListener('change',e=>{const card=e.target.closest('[data-item]'),it=card&&findItem(card.dataset.item),key=e.target.dataset.key;if(!it||!key)return;updateItemField(it,key,e.target.type==='checkbox'?e.target.checked:e.target.value);if(key==='date'&&it.date){it.reason='수동으로 날짜를 수정했습니다. 원본 확인 전까지 날짜수정필요를 유지하세요.'}renderItems()})
$('captureCandidates').addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const card=button.closest('[data-item]'),it=card&&findItem(card.dataset.item);if(!it)return;const act=button.dataset.action;
 if(act==='create-account'){createAccount(it);return}if(act==='save'){saveItem(it);return}
 if(act==='duplicate'){const img=state.images.find(x=>x.id===it.imageId);if(img){state.items.splice(state.items.indexOf(it)+1,0,newItem(img,{name:it.name,handle:it.handle,date:it.date,dateReview:true,reason:'캡처에 함께 있는 다른 게시물입니다. 본문을 입력하세요.'}));renderItems()}return}
 if(['hold','pending','exclude'].includes(act)){it.decision=act==='exclude'?'excluded':act;renderItems();message(act==='exclude'?'이 후보는 등록하지 않습니다. 원본 이미지는 보존됩니다.':act==='hold'?'검토 보류로 변경했습니다.':'검토 대기로 되돌렸습니다.')}});
window.addEventListener('beforeunload',e=>{if(state.items.some(i=>i.decision==='pending'||i.decision==='hold')){e.preventDefault();e.returnValue=''}});
// Pure functions exposed for local regression tests; no server action.
window.PIA_CAPTURE_TEST={dateFromText,parseCandidates,normBody,normHandle,similarBody};
auth();
})();
