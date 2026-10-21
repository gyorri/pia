/* PIA v0.3.34 – 100% free browser-side OCR; no third-party image API, no server-side image uploads.
   OCR program, WASM, and kor/eng traineddata are downloaded by Tesseract.js from public CDNs.
   Only reviewed, user-approved text is submitted to the existing PIA API. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeAttr=escapeHtml;
const state={images:[],items:[],db:{accounts:[],posts:[]},seq:0,processing:false,cancel:false,worker:null,workerLoading:null,opened:false,regionRunning:false,ingestChain:Promise.resolve(),selectionDrag:null,paddleBusy:false};
const MAX_FILES=20,MAX_BYTES=18*1024*1024,MAX_TOTAL=60,MAX_CANVAS_PIXELS=9000000;
const OCR_SCRIPT='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const norm=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
const normHandle=s=>String(s??'').trim().replace(/^@/,'').toLowerCase();
const normBody=s=>norm(s).toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[“”‘’]/g,'"');
const handleValid=s=>/^[A-Za-z0-9_]{1,30}$/.test(String(s??''));
const getAccountByHandle=h=>state.db.accounts.find(a=>normHandle(a.handle)===normHandle(h));
const getAccountById=id=>state.db.accounts.find(a=>String(a.id)===String(id));
const getPostById=id=>state.db.posts.find(p=>String(p.id)===String(id));
const LINK_THRESHOLD=.90; // Text similarity, not OCR confidence. Same confirmed author is required.
const tzOffset='+09:00';
const localeTime=s=>s?`${s.length===16?s+':00':s}${tzOffset}`:'';
const charLimit=(s,n)=>String(s??'').slice(0,n);
const message=(text,error=false)=>{const t=$('captureToast');t.textContent=text;t.classList.toggle('error',error);t.hidden=false;clearTimeout(message.timer);message.timer=setTimeout(()=>t.hidden=true,6500)};
const progress=text=>{$('captureProgress').textContent=text};
async function api(route,payload){const response=await fetch('/api/'+route,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});const d=await response.json().catch(()=>({}));if(!response.ok){const e=new Error(d.error||`서버 오류 ${response.status}`);e.status=response.status;throw e}return d}
async function refreshDb(){state.db=await api('admin-data');renderItems();message(`DB 목록 갱신 완료: 게시물 ${state.db.posts.length}건`)}
async function auth(){try{const session=await api('session');if(!session.authenticated)throw Error('로그인이 필요합니다.');state.db=await api('admin-data');state.opened=true;$('captureWorkspace').hidden=false;$('captureGate').hidden=true;renderAll()}catch(e){state.opened=false;$('captureWorkspace').hidden=true;$('captureGate').hidden=false;message(e.message,true)}}
// PIA v0.3.30: X screenshot metadata detection. Never use a body mention as the author.
const xDatePattern=/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일|(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\.?/;
function dateFromText(source){
 const text=String(source||'').replace(/[ㆍᆞ•∙⋅・]/g,'·').replace(/\u00a0/g,' ');
 const dates=[...text.matchAll(new RegExp(xDatePattern.source,'g'))];
 for(const match of dates){
  const y=Number(match[1]||match[4]),m=Number(match[2]||match[5]),d=Number(match[3]||match[6]);
  const valid=new Date(Date.UTC(y,m-1,d));
  if(valid.getUTCFullYear()!==y||valid.getUTCMonth()!==m-1||valid.getUTCDate()!==d)continue;
  // The timestamp must be adjacent to the *same* date, not a reply below it.
  const lineStart=text.lastIndexOf('\n',match.index)+1;
  const lineEnd=text.indexOf('\n',match.index);
  const line=text.slice(lineStart,lineEnd===-1?text.length:lineEnd);
  const times=[...line.matchAll(/(오전|오후)\s*(\d{1,2})\s*:\s*(\d{2})|(\d{1,2})\s*:\s*(\d{2})\s*(오전|오후)/g)];
  let hh=12,mi=0,confirmed=false;
  for(const t of times){
   const period=t[1]||t[6],hour=Number(t[2]||t[4]),minute=Number(t[3]||t[5]);
   const lineDateIndex=match.index-lineStart;
   const distance=t.index+t[0].length<lineDateIndex?lineDateIndex-(t.index+t[0].length):t.index>lineDateIndex+match[0].length?t.index-(lineDateIndex+match[0].length):0;
   if(distance>25||hour<1||hour>12||minute>59)continue;
   hh=hour%12+(period==='오후'?12:0);mi=minute;confirmed=true;break;
  }
  const value=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
  return {value,confirmed,source:confirmed?'visible datetime':'visible date only'};
 }
 return {value:'',confirmed:false,source:'unreadable'};
}
// X replies: OCR often corrupts just the final '답글' (e.g. "관련성이 가장 높은 HE v").
// A heading alone must NEVER create a new post: require neighboring reply-account cues.
const xReplySeparator=line=>/^(?:[▽∨vV﹀⌄]\s*)?(?:관련성\s*이?\s*가장\s*높은\s*답글|답글\s*(?:모두\s*)?보기|모든\s*답글\s*보기|답글\s*정렬|답글\s*\d+\s*개|답글\s*\d+\s*건)(?:\s*[▽∨vV﹀⌄])?\s*$/u.test(String(line||'').trim());
const xReplyHeading=line=>xReplySeparator(line)||/^\s*(?:[▽∨vV﹀⌄]\s*)?관련성\s*이?\s*가장\s*높은(?:\s+.{0,14})?\s*$/u.test(String(line||'').trim());
const xReplyTo=line=>/@\s*[A-Za-z0-9_. ]{2,40}\s*님에게\s*보내는\s*답(?:글)?/u.test(String(line||''))||/님에게\s*보내는\s*답(?:글)?/u.test(String(line||''));
const xUiHeader=line=>/^\s*[^\p{L}\p{N}]{0,6}\s*(?:게시하기|게시물|포스트|검색|홈|뒤로가기)\s*$/u.test(String(line||''));
const xMetricsLine=line=>/^\s*(?:\d[\d,.천만KkMm]*\s*)?(?:마음에\s*들어요|조회수\s*\d*|리포스트|좋아요|북마크|공유)\s*(?:\d+[건회])?\s*$/u.test(String(line||''));
const xDateLine=line=>xDatePattern.test(String(line||''))&&(/\d{1,2}\s*:\s*\d{2}|조회수|^\s*20\d{2}/.test(String(line||'')));
const xBrokenHandleLine=line=>/^(?:[^\n@]{0,22}\s+)?@[A-Za-z0-9_]{2,20}\s+[A-Za-z0-9_]{2,20}(?:\s*[-–].*)?$/u.test(String(line||'').trim());

// A screenshot can show an original followed by its own reply. Use only a
// visible original date+clock and a matching "replying to @..." cue for a
// provisional +5-minute reply timestamp. Never infer a parent relationship.
const xAuthorFingerprint=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function xVisibleAuthorKey(segment,header){
 const lines=String(segment||'').split('\n');
 const last=Math.min(lines.length,Math.max(6,(header?.index??0)+1));
 for(let i=0;i<last;i++){
  const line=lines[i].trim();
  if(xReplyTo(line)||xDateLine(line))break;
  const m=line.match(/@\s*([a-z0-9_]+(?:[.\s_]+[a-z0-9_]+){0,2})(?=\s*$|\s*[·•ㆍᆞ|\-–])/i)
    ||line.match(/^@\s*([a-z0-9_]+(?:[.\s_]+[a-z0-9_]+){0,2})\s*$/i);
  if(m)return xAuthorFingerprint(m[1]);
 }
 return xAuthorFingerprint(header?.handle||'');
}
function xReplyRecipientKey(segment){
 const line=String(segment||'').split('\n').find(xReplyTo)||'';
 const m=line.match(/@\s*([a-z0-9_. ]{2,50}?)\s*님에게\s*보내는\s*답(?:글)?/i);
 return m?xAuthorFingerprint(m[1]):'';
}
function xAddFiveMinutesKst(local){
 if(!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local||'')))return '';
 const ms=Date.parse(`${local}:00+09:00`);
 if(!Number.isFinite(ms))return '';
 const back=new Date(ms+9*3600000).toISOString().slice(0,16);
 if(back!==local)return ''; // reject impossible dates such as February 30
 return new Date(ms+5*60*1000+9*3600000).toISOString().slice(0,16);
}
function xAddFiveMinutesToStoredPost(post){
 if(!post||!(post.date_needs_review===false||post.date_needs_review===0)||!post.posted_at)return '';
 const ms=Date.parse(post.posted_at);
 return Number.isFinite(ms)?new Date(ms+5*60*1000+9*3600000).toISOString().slice(0,16):'';
}

function xLineHandle(line){
 const s=String(line||'').trim();
 // Standalone handle (handle+relative time), and one-line "nickname @handle" account headers.
 const m=s.match(/(?:^|\s)@([A-Za-z0-9_]{2,30})(?=\s*(?:$|[·•ㆍᆞ|]|[-–]\s*(?:\d{1,2}시|\d{1,2}[시간A-Za-z])))/);
 if(!m)return null;
 const after=s.slice(m.index+m[0].length).trim();
 if(/^[A-Za-z_]{2,}\b/.test(after))return null; // "@drt CHRM" is ambiguous; never truncate to "drt".
 const before=s.slice(0,m.index).replace(/^[\s\d@#⋯.\-]+/g,'').replace(/[\s@#⋯.\-]+$/g,'').trim();
 return {handle:m[1],name:before};
}
function xCleanNickname(line){
 const value=String(line||'').trim().replace(/[↩←<>]+/g,'').replace(/[@#⋯.\s]+$/g,'').trim();
 if(!value||xUiHeader(value)||xReplyTo(value)||xReplyHeading(value)||xMetricsLine(value)||xDateLine(value))return '';
 if(/^[#@][A-Za-z0-9]{0,3}$/.test(value)||/^[#@©&=▦0-9\s]+$/.test(value)||/^관련성/.test(value))return '';
 return value.length<=48?value:'';
}
function xHeader(lines){
 let best=null;
 for(let i=0;i<Math.min(lines.length,8);i++){
  const line=lines[i].trim();
  if(xUiHeader(line)||xReplyTo(line)||xReplyHeading(line))continue;
  const found=xLineHandle(line);
  if(!found){
   // Preserve an uncertain author without inventing a truncated handle.
   if(xBrokenHandleLine(line)){
    const previous=i>0?xCleanNickname(lines[i-1]):'';
    return {index:i,name:previous,handle:'',nameIndex:previous?i-1:-1};
   }
   continue;
  }
  // A mention inside text must not be interpreted as an account header.
  const lead=found.name,previous=i>0?xCleanNickname(lines[i-1]):'';
  const singleAccount=/^\s*@[A-Za-z0-9_]{2,30}(?:\s*[·•ㆍᆞ].*)?\s*$/.test(line);
  if(!lead&&!singleAccount&&!previous)continue;
  let name=lead||previous;
  if(/^[@#]/.test(name))name='';
  best={index:i,name,handle:found.handle,nameIndex:!lead&&previous?i-1:-1};break;
 }
 return best;
}
// Two independent signals are required for a weak OCR reply heading.
// After a visible timestamp, a later "reply to" line can rescue a reply even
// when the heading is absent or the @handle contains OCR spaces.
const xAccountCue=line=>!!(xLineHandle(line)||xBrokenHandleLine(line));
const xNearbyReplyTo=(lines,from,windowSize=9)=>lines.slice(from+1,Math.min(lines.length,from+1+windowSize)).some(xReplyTo);
function xSegmentOcr(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n'),segments=[];
 let start=0,reply=false;
 const push=(end)=>{const block=lines.slice(start,end).join('\n').trim();if(block)segments.push({text:block,reply})};
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();
  // Visible metadata for the preceding post distinguishes a new reply card
  // from an ordinary sentence containing '관련성이 가장 높은'.
  const hasPreviousPost=i>start+3;
  const previousMeta=hasPreviousPost&&lines.slice(start,i).some(s=>xDateLine(s)||xMetricsLine(s));
  if(xReplyHeading(line)&&hasPreviousPost){
   const nextLines=lines.slice(i+1,Math.min(lines.length,i+11));
   const hasReplyLine=nextLines.some(xReplyTo);
   const hasAccount=nextLines.some(xAccountCue);
   if(previousMeta&&hasReplyLine&&hasAccount){
    push(i);start=i+1;reply=true;continue;
   }
  }
  // No (readable) section heading: detect an author row followed by the
  // explicit reply-to label, only after the previous post's date or metrics.
  if(hasPreviousPost&&previousMeta&&xAccountCue(line)&&xNearbyReplyTo(lines,i,5)){
   push(i);start=i;reply=true;continue;
  }
  // The account row itself may be unreadable. Keep the reply as an independent
  // review item instead of silently discarding everything after the date.
  if(hasPreviousPost&&previousMeta&&xReplyTo(line)){
   push(i);start=i;reply=true;continue;
  }
 }
 push(lines.length);
 return segments.length?segments:[{text:String(text||''),reply:false}];
}
function parseCandidates(text){
 const raw=String(text??'').replace(/\r/g,'').trim();
 if(!raw)return [{name:'',handle:'',content:'',date:'',dateReview:true,reason:'인식한 글자가 없습니다. 원문을 직접 입력해 주세요.',type:'original'}];
 const segments=xSegmentOcr(raw);const results=[];const originalTimes=[];
 for(const segment of segments){
  const lines=segment.text.split('\n').map(s=>s.trimEnd());
  const header=xHeader(lines);
  const start=header?header.index+1:0;
  const ignored=new Set(header?[header.index,...(header.nameIndex>=0?[header.nameIndex]:[])]:[]);
  const d=dateFromText(segment.text);
  const body=[];let ended=false;
  for(let i=0;i<lines.length;i++){
   const s=lines[i].trim();
   if(ignored.has(i)||xUiHeader(s)||xReplyTo(s))continue;
   if(i<Math.max(start,3)&&(/^\s*[#@&=©]{1,4}[a-z0-9]{0,2}\s*$/i.test(s)||xBrokenHandleLine(s)))continue;
   if(xDateLine(s)&&i>=start){ended=true;continue}
   if(ended)continue; // everything after X's date is metrics, toolbar, or another card
   if(i<start)continue;
   if(xMetricsLine(s)&&body.length){ended=true;continue}
   // Ignore isolated toolbar OCR noise, but never silently "correct" ordinary Korean sentences.
   if(/^[©®◁▷↑↓↪↩↗↘\s0-9QΙ|\/=]+$/.test(s)&&body.length)continue;
   body.push(lines[i]);
  }
  const content=body.join('\n').trim().slice(0,10000);
  if(!content&&!header&&!segment.reply)continue;
  const reasons=[];
  const isReply=segment.reply||lines.slice(0,8).some(line=>xReplyTo(line));
  let assignedDate=d.value,dateBasis=d.confirmed?'visible-exact':d.value?'visible-date':'missing';
  // No original timestamp is invented. A *matching* same-image original must
  // have an actually visible clock time, not a 12:00 date-only placeholder.
  if(isReply&&!d.confirmed){
   const recipient=xReplyRecipientKey(segment.text);
   const parent=[...originalTimes].reverse().find(x=>recipient&&x.authorKey===recipient);
   if(parent){
    const suggested=xAddFiveMinutesKst(parent.date);
    if(suggested&&(!d.value||d.value.slice(0,10)===suggested.slice(0,10))){
     assignedDate=suggested;dateBasis='parent-plus-5';
     reasons.push(`동일 캡처의 원글 ${parent.date.replace('T',' ')} +5분 → ${assignedDate.replace('T',' ')} (임시 시각, 원글·답글 관계 확인 필요).`);
    }
   }
  }
  if(!header?.handle)reasons.push('작성자 헤더가 불명확함: 본문의 @멘션을 작성자로 사용하지 않았습니다.');
  if(!d.value&&dateBasis!=='parent-plus-5')reasons.push('원본의 정확한 날짜·시각을 읽지 못했습니다.');
  else if(!d.confirmed&&dateBasis!=='parent-plus-5')reasons.push('날짜만 인식: 12:00은 임시 시각이며 실제 작성 시간이 아닙니다.');
  if(segment.reply||lines.slice(0,8).some(line=>xReplyTo(line)))reasons.push('답글 별도 후보: 원본 내용·작성자·날짜와 부모 글을 직접 확인하세요.');
  if(!content)reasons.push('본문이 비어 있어 원문 확인이 필요합니다.');
  results.push({name:charLimit(header?.name||'',100),handle:header?.handle||'',content,date:assignedDate,dateBasis,dateReview:true,type:isReply?'reply':'original',reason:reasons.join(' '),block:results.length});
  if(!isReply&&d.confirmed&&d.value){const authorKey=xVisibleAuthorKey(segment.text,header);if(authorKey)originalTimes.push({date:d.value,authorKey});}
 }
 return results.length?results:[{name:'',handle:'',content:raw,date:'',dateReview:true,reason:'게시물 구조를 자동 분리하지 못했습니다. 원문과 비교해 직접 수정하세요.',type:'original'}];
}

function newItem(image,extracted={}){return {id:'c'+(++state.seq),imageId:image.id,sourceName:image.name,name:extracted.name||'',handle:extracted.handle||'',accountId:'',content:extracted.content||'',date:extracted.date||'',dateBasis:extracted.dateBasis||(extracted.date?'manual':'missing'),dateReview:extracted.dateReview!==false,type:extracted.type||'original',parentId:'',quotePostId:'',quoteName:'',quoteHandle:'',quoteContent:'',quoteDate:'',parentSearch:'',quoteSearch:'',decision:'pending',manualSeparate:false,checking:false,saving:false,resultId:'',reason:extracted.reason||'',allowDistinct:false,linkedPostId:''};}
function sameBody(a,b){return normBody(a)===normBody(b)}
function similarBody(a,b){a=normBody(a);b=normBody(b);if(!a||!b)return 0;if(a===b)return 1;if(Math.min(a.length,b.length)>40&&(a.includes(b)||b.includes(a)))return Math.min(a.length,b.length)/Math.max(a.length,b.length);if(a.length>850||b.length>850){a=a.slice(0,850);b=b.slice(0,850)}if(Math.max(a.length,b.length)/Math.max(1,Math.min(a.length,b.length))>1.3)return 0;
 // Damerau-free edit distance with two rows; bounded for local UI responsiveness.
 const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);for(let i=1;i<=a.length;i++){cur[0]=i;for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<prev.length;j++)prev[j]=cur[j]}return 1-prev[b.length]/Math.max(a.length,b.length)}
function duplicateHits(item){const handle=normHandle(getAccountById(item.accountId)?.handle||item.handle),body=normBody(item.content);if(!handle||!body||body.length<3)return [];
 const matched=[];for(const post of state.db.posts){const acct=getAccountById(post.account_id);if(normHandle(acct?.handle)!==handle)continue;const exact=sameBody(body,post.content);let score=exact?1:0;if(!exact&&body.length>=15&&String(post.content||'').length>=15)score=similarBody(body,post.content);if(score>=.84)matched.push({exact,score,post,other:null})}
 for(const other of state.items){if(other.id===item.id||other.decision==='excluded'||other.decision==='registered'||other.decision==='linked'||normHandle(getAccountById(other.accountId)?.handle||other.handle)!==handle)continue;const score=sameBody(body,other.content)?1:similarBody(body,other.content);if(score>=.84)matched.push({exact:score===1,score,post:null,other})}
 return matched.sort((a,b)=>b.score-a.score).slice(0,6)}
// Candidates for *reusing* an already stored original, never an automatic link.
// Restrict to the same confirmed account, an original in DB, and >= 90% text similarity.
function reusableOriginalHits(item){
 if(!item||item.type!=='original')return [];
 const author=getAccountById(item.accountId)||getAccountByHandle(item.handle);
 const body=normBody(item.content);
 if(!author||body.length<3)return [];
 const matched=[];
 for(const post of state.db.posts){
  if(post.parent_id||String(post.account_id)!==String(author.id))continue;
  const exact=sameBody(body,post.content);
  const score=exact?1:body.length>=15&&normBody(post.content).length>=15?similarBody(body,post.content):0;
  if(score>=LINK_THRESHOLD)matched.push({exact,score,post,other:null});
 }
 return matched.sort((a,b)=>b.score-a.score).slice(0,8);
}
function linkedOriginalsForReply(reply){
 if(!reply||reply.type!=='reply')return [];
 return state.items.filter(x=>x.imageId===reply.imageId&&x.type==='original'&&x.decision==='linked'&&x.linkedPostId)
  .map(item=>({item,post:getPostById(item.linkedPostId)})).filter(x=>x.post&&!x.post.parent_id);
}
function savedPostLabel(p){const a=getAccountById(p?.account_id);return `@${a?.handle||'unknown'} · ${p?.posted_at||'날짜 미확정'}`;}
function ocrDiffSummary(a,b){
 const left=String(a||'').split('\n'),right=String(b||'').split('\n');
 const count=Math.max(left.length,right.length);let diff=0;const examples=[];
 for(let i=0;i<count;i++){
  if((left[i]||'').trim()!==(right[i]||'').trim()){
   diff++;
   if(examples.length<5)examples.push({index:i+1,before:(left[i]||'').slice(0,180),after:(right[i]||'').slice(0,180)});
  }
 }
 return {diff,examples};
}
// Experimental PaddleOCR result is a separate, opt-in comparison; it never registers posts.
function paddleComparisonHtml(img){
 const running=img.paddleStatus==='loading',ready=img.paddleStatus==='ready',failed=img.paddleStatus==='error';
 const messageText=img.paddleMessage||'';
 return `<section class="capture-paddle" aria-label="PaddleOCR 브라우저 시험 비교">
  <div class="capture-paddle-head"><div><strong>시험 OCR · PaddleOCR.js (한국어 PP-OCRv5)</strong><small>무료 · 별도 설치 없음 · 선택한 이미지에서만 실행 · DB 자동 변경 없음</small></div><button type="button" data-image-action="paddle-run" data-id="${safeAttr(img.id)}" ${(!img.file||running||state.paddleBusy||state.processing||state.regionRunning)?'disabled':''}>${running?'시험 OCR 실행 중…':ready?'Paddle 다시 인식':'Paddle 시험 OCR 실행'}</button></div>
  <div class="capture-paddle-status ${failed?'capture-paddle-error':''}" role="status" aria-live="polite">${escapeHtml(running?'모델 다운로드 및 브라우저 인식 중… 첫 실행은 오래 걸릴 수 있습니다.':failed?'시험 OCR 실패: '+messageText:ready?'시험 완료 · '+messageText:'아직 실행하지 않았습니다. 기존 Tesseract 인식 결과에는 영향이 없습니다.')}</div>
  ${ready?`<div class="capture-compare-grid"><label>Tesseract 기존 기본 결과<textarea readonly spellcheck="false">${escapeHtml(img.baselineRaw||'')}</textarea></label><label>PaddleOCR 시험 결과<textarea readonly spellcheck="false" data-paddle-text="${safeAttr(img.id)}">${escapeHtml(img.paddleRaw||'')}</textarea></label></div><div class="capture-photo-tools"><button type="button" data-image-action="paddle-copy" data-id="${safeAttr(img.id)}">Paddle 텍스트 복사</button><button type="button" data-image-action="paddle-apply" data-id="${safeAttr(img.id)}" ${img.paddleRaw?'':'disabled'}>Paddle 결과를 검토 원문에 반영</button></div><small>원문 반영은 게시물 후보나 DB에 바로 적용되지 않습니다. 수동 검수 후 「이 텍스트로 게시물 다시 나누기」를 별도로 누르세요.</small>`:''}
  ${failed?'<small>모델/CDN 다운로드 실패 또는 브라우저 호환성 오류일 수 있습니다. 기존 무료 OCR은 계속 사용할 수 있습니다.</small>':''}
  </section>`;
}
async function runPaddleComparison(img){
 if(!img?.file){message('JSON 초안에는 이미지가 들어 있지 않습니다. 캡처 원본을 다시 추가해 주세요.',true);return}
 if(state.processing||state.regionRunning||state.paddleBusy){message('다른 인식 작업이 끝난 뒤 시험 OCR을 실행해 주세요.',true);return}
 state.paddleBusy=true;img.paddleStatus='loading';img.paddleMessage='';renderImages();
 try{
  const {runPaddleOCR}=await import('/capture-paddle.mjs?v=34');
  const result=await runPaddleOCR(img.file,(status)=>{if(img.paddleStatus==='loading'){img.paddleMessage=String(status||'').slice(0,200);const label=$('captureImages').querySelector(`[data-img="${img.id}"] .capture-paddle-status`);if(label)label.textContent=img.paddleMessage}});
  if(!state.images.includes(img))return;
  img.paddleRaw=result.text;img.paddleMetrics=result.metrics;img.paddleStatus='ready';
  img.paddleMessage=`${result.count}개 텍스트 줄 · 평균 인식 점수 ${result.meanScore==null?'미제공':(result.meanScore*100).toFixed(1)+'%'} (OCR 점수는 정확도 보증이 아닙니다.)`;
  message(`${img.name}: PaddleOCR 시험 결과가 준비됐습니다. 원본 이미지와 비교해 주세요.`);
 }catch(error){if(!state.images.includes(img))return;img.paddleStatus='error';img.paddleMessage=String(error?.message||error).slice(0,500);message('PaddleOCR 시험 실패: '+img.paddleMessage,true)}
 finally{state.paddleBusy=false;renderImages()}
}
function applyPaddleText(img){
 if(img.paddleStatus!=='ready'||!img.paddleRaw)return;
 if(img.raw!==img.paddleRaw&&!confirm('PaddleOCR 결과를 「현재 검토 중인 OCR 원문」에 복사할까요? 직접 고친 원문이 덮어써질 수 있습니다. 게시물 후보는 아직 변경되지 않습니다.'))return;
 img.raw=img.paddleRaw;renderImages();message('검토 원문에만 반영했습니다. 원본과 대조한 뒤 게시물 다시 나누기를 눌러 주세요.');
}
async function copyPaddleText(img){
 if(img.paddleStatus!=='ready')return;
 try{await navigator.clipboard.writeText(img.paddleRaw||'');message('PaddleOCR 시험 결과를 복사했습니다.')}
 catch(e){const textarea=$('captureImages').querySelector(`[data-paddle-text="${img.id}"]`);textarea?.focus();textarea?.select();message('자동 복사가 제한됐습니다. 선택된 텍스트를 Ctrl+C로 복사하세요.',true)}
}
function renderImages(){const node=$('captureImages');$('captureCount').textContent=state.images.length+'장';if(!state.images.length){node.innerHTML='<div class="empty">아직 추가한 이미지가 없습니다.</div>';return}
 node.innerHTML=state.images.map(img=>{
  const hasAlt=typeof img.altRaw==='string'&&img.altRaw.length>0;
  const diff=hasAlt?ocrDiffSummary(img.baselineRaw||'',img.altRaw):null;
  const highlighted=diff?diff.examples.map(x=>`<div class="capture-ocr-change"><b>${x.index}번째 줄</b><div>기본: ${escapeHtml(x.before||'(없음)')}</div><div>보정: ${escapeHtml(x.after||'(없음)')}</div></div>`).join(''):'';
  return `<article class="capture-image-card" data-img="${safeAttr(img.id)}"><div class="capture-card-head"><strong>${escapeHtml(img.name)}</strong><div class="capture-card-tools"><button type="button" data-image-action="scan" data-id="${safeAttr(img.id)}" ${img.status==='scanning'?'disabled':''}>다시 인식</button><button type="button" data-image-action="remove" data-id="${safeAttr(img.id)}">제거</button></div></div><div class="capture-photo-row"><div>${img.url?`<div class="capture-preview-scroller"><div class="capture-crop-surface" data-crop-image="${safeAttr(img.id)}" data-selecting="${img.selecting?'true':'false'}"><img class="capture-photo-preview" src="${safeAttr(img.url)}" alt="원본 ${safeAttr(img.name)}" draggable="false"><div class="capture-select-box" ${img.selection?`style="left:${img.selection.x*100}%;top:${img.selection.y*100}%;width:${img.selection.w*100}%;height:${img.selection.h*100}%;"`:'hidden'}></div></div></div><div class="capture-photo-tools"><a href="${safeAttr(img.url)}" target="_blank" rel="noopener noreferrer">원본 크기로 보기 ↗</a><button type="button" data-image-action="select" data-id="${safeAttr(img.id)}" ${img.file?'':'disabled'}>${img.selecting?'드래그 선택 취소':'작은 영역 직접 선택'}</button><button type="button" data-image-action="region" data-id="${safeAttr(img.id)}" ${img.selection&&img.file?'':'disabled'}>선택 영역 정밀 재인식</button></div><small>"작은 영역 직접 선택"을 누르고 이미지에서 마우스로 범위를 드래그하세요. 결과는 원문에 자동 합치지 않습니다.</small>${img.regionRaw!=null?`<label class="capture-region-result">선택 영역 재인식 결과<textarea readonly class="capture-region-text" data-region-result="${safeAttr(img.id)}">${escapeHtml(img.regionRaw)}</textarea></label><div class="capture-photo-tools"><button type="button" data-image-action="copy-region" data-id="${safeAttr(img.id)}">영역 텍스트 복사</button><button type="button" data-image-action="append-region" data-id="${safeAttr(img.id)}">전체 OCR에 추가 (확인 후)</button></div>`:''}`:'<div class="capture-no-preview">JSON에서 불러온 기록입니다. 이미지 미리보기는 없습니다.</div>'}</div><div><div class="capture-ocr-meta">${escapeHtml(img.status==='scanning'?'인식 중…':img.status==='done'?'인식 완료':img.status==='error'?'OCR 실패 · 수동 입력 가능':img.status==='queued'?'인식 대기':img.status==='paused'?'대기 중지':'텍스트 검토')} ${img.confidence==null?'':`· 기본 인식 신뢰도 ${Math.round(img.confidence)}% (참고)`} ${hasAlt&&img.altConfidence!=null?`· 보정 인식 ${Math.round(img.altConfidence)}% (참고)`:''}</div>
  ${hasAlt?`<div class="capture-variant"><strong>원본 OCR ↔ 확대·대비 보정 OCR</strong><span>서로 다른 줄 약 ${diff.diff}개 · 높은 신뢰도가 항상 정답은 아닙니다.</span><div class="capture-compare-grid"><label>기본 결과<textarea readonly spellcheck="false">${escapeHtml(img.baselineRaw||'')}</textarea></label><label>보정 결과<textarea readonly spellcheck="false">${escapeHtml(img.altRaw)}</textarea></label></div><div class="capture-compare-changes">${highlighted||'<span>줄별 비교에서 차이가 없습니다.</span>'}${diff.diff>diff.examples.length?`<small>그 외 차이 ${diff.diff-diff.examples.length}개 · 전체 결과는 위에서 비교하세요.</small>`:''}</div><div class="capture-photo-tools"><button type="button" data-image-action="use-basic" data-id="${safeAttr(img.id)}">기본 결과 적용</button><button type="button" data-image-action="use-enhanced" data-id="${safeAttr(img.id)}">보정 결과 적용</button></div></div>`:''}
  ${paddleComparisonHtml(img)}
  <label>현재 검토 중인 OCR 원문<textarea class="capture-ocr-text" data-image-text="${safeAttr(img.id)}" spellcheck="false" placeholder="OCR 결과를 수정해 주세요.">${escapeHtml(img.raw||'')}</textarea></label><div class="capture-photo-tools"><button type="button" data-image-action="parse" data-id="${safeAttr(img.id)}">이 텍스트로 게시물 다시 나누기</button><button type="button" data-image-action="add" data-id="${safeAttr(img.id)}">게시물 직접 추가</button></div><small>게시물 ${state.items.filter(i=>i.imageId===img.id).length}건 · 재분리하면 미등록 후보의 수정 내용이 교체됩니다. 등록 완료된 글은 DB에서 삭제되지 않습니다.</small></div></div></article>`;
 }).join('');
}
function optionPost(p){const a=getAccountById(p.account_id);return `<option value="${safeAttr(p.id)}">@${escapeHtml(a?.handle||'unknown')} · ${escapeHtml(String(p.content||'').slice(0,85).replace(/\n/g,' '))}</option>`}
function duplicateHtml(item){const hits=duplicateHits(item);for(const extra of reusableOriginalHits(item)){if(!hits.some(h=>h.post&&String(h.post.id)===String(extra.post.id)))hits.push(extra)}hits.sort((a,b)=>b.score-a.score);let intro='';if(!normHandle(item.handle)&&!item.accountId)intro='<div class="capture-warn">작성자 확인 후 중복 비교가 가능합니다.</div>';else if(!item.content.trim())intro='<div class="capture-warn">본문을 입력하면 중복 비교가 가능합니다.</div>';else if(!hits.length)intro='<div class="capture-none">현재 불러온 DB와 대기열에서 일치하는 글이 없습니다. 등록 직전에 다시 검사합니다.</div>';
 return intro+hits.map(hit=>{const p=hit.post,a=p?getAccountById(p.account_id):null;const label=hit.exact?'본문이 동일함':'유사 게시물';const when=p?.posted_at||hit.other?.date||'';const url=p?`<a target="_blank" rel="noopener" href="/#/post/${encodeURIComponent(p.id)}">기존 글 보기 ↗</a>`:'이번 대기열의 다른 후보';const reuse=p&&item.type==='original'&&!p.parent_id&&hit.score>=LINK_THRESHOLD&&item.decision==='pending'?`<button type="button" class="capture-reuse-button" data-action="reuse-existing" data-post-id="${safeAttr(p.id)}" ${item.saving?'disabled':''}>이 기존 원글 사용 · 중복 등록 건너뛰기</button>`:'';return `<div class="capture-duplicate"><strong>${escapeHtml(label)} · 유사도 ${Math.round(hit.score*100)}%</strong>${escapeHtml(a?.name||hit.other?.name||'')} ${escapeHtml(when)}<p>${escapeHtml(String(p?.content||hit.other?.content||'').slice(0,160))}</p>${url}${reuse}</div>`}).join('')}
function renderItems(){const filter=$('captureFilter').value,display=state.items.filter(it=>filter==='all'||it.decision===filter);$('captureCandidateCount').textContent=state.items.length+'건';const box=$('captureCandidates');if(!display.length){box.innerHTML='<div class="empty">현재 표시할 게시물이 없습니다.</div>';return}
 const accounts=state.db.accounts;const accountChoices=accounts.map(a=>`<option value="${safeAttr(a.id)}">${escapeHtml(a.name)} (@${escapeHtml(a.handle)})</option>`).join('');
 const allPosts=state.db.posts;
 box.innerHTML=display.map((it,ix)=>{
  const hits=duplicateHits(it),linked=it.decision==='linked',reusable=reusableOriginalHits(it),dateOnly=it.dateBasis==='visible-date'||it.reason.includes('날짜만'),estimated=it.dateBasis==='parent-plus-5',reg=it.decision==='registered',locked=reg||linked?'disabled':'';
  const postSearch=(text,selected)=>{
   const q=norm(text).toLowerCase();const list=allPosts.filter(p=>p.id!==it.resultId).filter(p=>{const author=getAccountById(p.account_id);return !q||[p.content,author?.handle,author?.name].some(v=>String(v||'').toLowerCase().includes(q))}).slice(0,80);
   if(selected&&!list.some(p=>String(p.id)===String(selected))){const selectedPost=getPostById(selected);if(selectedPost)list.unshift(selectedPost)}
   return list.map(optionPost).join('');
  };
  const parentOptions=postSearch(it.parentSearch,it.parentId);
  const quoteOptions=postSearch(it.quoteSearch,it.quotePostId);
  const suggestedAuthors=[...new Set(state.items.filter(x=>x.imageId===it.imageId&&x.id!==it.id&&handleValid(x.handle)).map(x=>x.handle))].filter(h=>normHandle(h)!==normHandle(it.handle));
  const reuseReply=linkedOriginalsForReply(it);
  const linkedReplyHtml=reuseReply.length?`<div class="capture-wide capture-reuse-options"><strong>같은 캡처에서 기존 DB 원글로 확인한 후보</strong><small>OCR 원글은 중복 등록하지 않습니다. 아래에서 답글의 실제 부모 글을 직접 선택하세요.</small>${reuseReply.map(({post})=>`<div class="capture-reuse-choice"><div><b>${escapeHtml(savedPostLabel(post))}</b><p>${escapeHtml(String(post.content||'').slice(0,180))}</p></div>${String(it.parentId)===String(post.id)?'<span class="capture-reuse-selected">답글 대상으로 선택됨</span>':`<button type="button" data-action="choose-parent" data-post-id="${safeAttr(post.id)}" ${locked}>이 게시물을 답글 대상으로 선택</button>`}</div>`).join('')}</div>`:'';
  const hintHtml=!it.handle&&suggestedAuthors.length?`<div class="capture-wide capture-author-suggest">같은 캡처의 다른 글에서 ${suggestedAuthors.map(h=>`<button type="button" class="secondary" data-action="suggest-author" data-handle="${safeAttr(h)}" ${locked}>@${escapeHtml(h)} 확인 후 사용</button>`).join(' ')} · 같은 계정인지 캡처를 보고 선택하세요.</div>`:'';
  return `<article class="capture-candidate" data-item="${safeAttr(it.id)}" aria-busy="${it.saving?'true':'false'}"><div class="capture-card-head"><strong>${escapeHtml(it.sourceName)} · 후보 ${ix+1}</strong><span class="capture-state ${it.decision}">${({pending:'검토 대기',hold:'보류',excluded:'제외',registered:'등록 완료',linked:'기존 원글 사용'})[it.decision]}</span></div>
  <div class="capture-candidate-main"><div class="capture-form-grid">
   <label>OCR 작성자 닉네임<input data-key="name" maxlength="100" value="${safeAttr(it.name)}" ${locked} placeholder="원본에서 확인"></label>
   <label>@아이디<input data-key="handle" maxlength="30" value="${safeAttr(it.handle)}" ${locked} placeholder="@ 없이 입력"></label>
   ${hintHtml}
   <label class="capture-wide">PIA 작성 계정 선택<select data-key="accountId" ${locked}><option value="">@아이디로 기존 계정 자동 검색</option>${accountChoices}</select><small>계정이 없으면 아래에서 새 계정 등록(명시적 승인)</small></label>
   <div class="capture-wide capture-inline"><small>계정이 목록에 없다면 닉네임과 @아이디를 확인하세요.</small><button type="button" data-action="create-account" ${locked}>이 작성자 계정 등록</button></div>
   <label>게시물 유형<select data-key="type" ${locked}><option value="original">일반 게시물</option><option value="reply">답글</option><option value="quote">인용 게시물</option></select></label>
   <label>원본 작성일시(KST)<input type="datetime-local" data-key="date" step="60" value="${safeAttr(it.date)}" ${locked}><small>${estimated?'원글 작성 시각 +5분으로 자동 입력한 임시 시각입니다. 실제 답글 시간은 확인되지 않았으며 날짜수정필요를 유지하세요.':dateOnly?'시각은 OCR에서 확인되지 않아 12:00을 임시 기입했습니다.':'원본 날짜가 불확실하면 직접 확인하세요.'}</small></label>
   <label class="capture-wide capture-checkbox"><input type="checkbox" data-key="dateReview" ${it.dateReview?'checked':''} ${locked}> 날짜수정필요(원본 시각 미확정이면 반드시 유지)</label>
   <label class="capture-wide">게시물 본문<textarea data-key="content" rows="6" maxlength="10000" ${locked} placeholder="원본 이미지와 비교하여 수정하세요.">${escapeHtml(it.content)}</textarea></label>
   ${it.type==='reply'?`${linkedReplyHtml}<label class="capture-wide">답글 대상 원글 검색<input data-key="parentSearch" type="search" value="${safeAttr(it.parentSearch)}" placeholder="원글 본문 또는 @아이디 입력 후 엔터/화면 밖 클릭" ${locked}><small>기존 게시물 전체에서 검색합니다.</small></label><label class="capture-wide">답글 대상 원글 (직접 확인 필수)<select data-key="parentId" ${locked}><option value="">답글을 연결할 게시물 선택</option>${parentOptions}</select><small>잘못 연결하지 않도록 자동 선택하지 않습니다.</small></label>`:''}
   ${it.type==='quote'?`<label class="capture-wide">인용 원문 검색<input data-key="quoteSearch" type="search" value="${safeAttr(it.quoteSearch)}" placeholder="원글 본문 또는 @아이디 입력 후 엔터/화면 밖 클릭" ${locked}></label><label class="capture-wide">기존 게시물 인용 연결 (선택)<select data-key="quotePostId" ${locked}><option value="">원문 정보를 직접 입력</option>${quoteOptions}</select></label><label>인용 원문 닉네임<input data-key="quoteName" value="${safeAttr(it.quoteName)}" ${locked}></label><label>인용 원문 @아이디<input data-key="quoteHandle" value="${safeAttr(it.quoteHandle)}" ${locked}></label><label class="capture-wide">인용 원문 본문<textarea data-key="quoteContent" ${locked}>${escapeHtml(it.quoteContent)}</textarea></label><label class="capture-wide">인용 원문 날짜(KST, 선택)<input type="datetime-local" data-key="quoteDate" value="${safeAttr(it.quoteDate)}" ${locked}></label>`:''}
  </div><aside class="capture-side"><h3>기존 게시물 중복 비교</h3>${duplicateHtml(it)}<p>작성자가 다르거나 이미지 인식 오타가 있으면 중복을 놓칠 수 있습니다. 반드시 원본과 비교하세요.</p>${(hits.some(x=>x.exact)||(it.type==='original'&&reusable.length))?`<label class="capture-checkbox"><input type="checkbox" data-key="allowDistinct" ${it.allowDistinct?'checked':''} ${locked}> ${it.type==='original'&&reusable.length?'유사도 90% 이상 기존 원글과 **별개의 게시물**임을 원본과 날짜로 확인했습니다.':'동일 본문이지만 서로 다른 게시물임을 날짜로 확인했습니다.'}</label>`:''}${estimated?'<p class="capture-estimate-note">시각 추정: 원글 +5분 · 실제 작성 시각이 아닙니다.</p>':''}${it.reason?`<p>OCR 메모: ${escapeHtml(it.reason)}</p>`:''}${reg?`<p><strong>등록 ID:</strong> ${escapeHtml(it.resultId)}</p>`:''}${linked?`<div class="capture-linked-info"><strong>기존 원글 재사용 · 새 글은 등록하지 않음</strong>${getPostById(it.linkedPostId)?`<p>${escapeHtml(savedPostLabel(getPostById(it.linkedPostId)))}</p><a target="_blank" rel="noopener" href="/#/post/${encodeURIComponent(it.linkedPostId)}">기존 원글 열기 ↗</a>`:'<p>선택한 기존 게시물을 DB에서 찾지 못했습니다. 재사용을 취소하고 확인하세요.</p>'}</div>`:''}</aside></div>
  <div class="capture-final-actions">${reg?`<a class="capture-link" href="/#/post/${encodeURIComponent(it.resultId)}" target="_blank" rel="noopener">등록 게시물 보기 ↗</a>`:linked?`<button type="button" class="secondary" data-action="undo-reuse">기존 원글 사용 취소</button><small>원글은 새로 등록되지 않습니다. 답글은 각 카드에서 직접 부모를 선택하세요.</small>`:`<button class="primary" type="button" data-action="save" ${(it.saving||it.decision!=='pending')?'disabled':''}>중복 검사 후 등록</button><button class="secondary" type="button" data-action="hold" ${it.saving?'disabled':''}>보류</button><button class="secondary" type="button" data-action="pending">검토 대기</button><button class="danger" type="button" data-action="exclude">제외</button><button class="secondary" type="button" data-action="duplicate">이 이미지에서 글 추가</button>`}</div></article>`;
 }).join('');
 for(const it of display){const card=box.querySelector(`[data-item="${it.id}"]`);if(!card)continue;const select=card.querySelector('[data-key=accountId]');if(select)select.value=it.accountId||'';const ty=card.querySelector('[data-key=type]');if(ty)ty.value=it.type;const par=card.querySelector('[data-key=parentId]');if(par)par.value=it.parentId||'';const quote=card.querySelector('[data-key=quotePostId]');if(quote)quote.value=it.quotePostId||''}
}
function renderAll(){renderImages();renderItems()}
function findItem(id){return state.items.find(it=>it.id===id)}
function setImageText(img,value){img.raw=value}
function reparse(img,{confirmReplace=true}={}){if(state.items.some(it=>it.imageId===img.id&&(it.decision==='registered'||it.decision==='linked'))){message('이미 등록하거나 기존 원글을 재사용한 글이 있습니다. 먼저 재사용을 취소한 후 재분리하세요. 등록 완료된 글은 별도로 유지됩니다.',true);return}if(confirmReplace&&state.items.some(it=>it.imageId===img.id)){if(!confirm('이 이미지의 미등록 후보는 새 OCR 내용으로 교체됩니다. 직접 수정한 내용은 사라집니다. 등록 완료된 글은 DB에 유지됩니다. 계속할까요?'))return}
 const extracted=parseCandidates(img.raw);state.items=state.items.filter(it=>it.imageId!==img.id||it.decision==='registered');state.items.push(...extracted.map(t=>newItem(img,t)));renderAll();const replies=extracted.filter(t=>t.type==='reply').length;message(`${img.name}: ${extracted.length}개 후보 (답글 ${replies}건)를 만들었습니다. 원본과 확인해 주세요.`)}
function normalizeCropRect(rect){if(!rect)return null;const x=Math.max(0,Math.min(1,Number(rect.x))),y=Math.max(0,Math.min(1,Number(rect.y)));
 const w=Math.max(0,Math.min(1-x,Number(rect.w))),h=Math.max(0,Math.min(1-y,Number(rect.h)));
 return [x,y,w,h].every(Number.isFinite)&&w>.012&&h>.012?{x,y,w,h}:null}
function canvasForSource(bitmap,selection=null,{enhance=false}={}){
 const crop=normalizeCropRect(selection)||{x:0,y:0,w:1,h:1};
 const sx=Math.round(bitmap.width*crop.x),sy=Math.round(bitmap.height*crop.y);
 const sw=Math.max(1,Math.min(bitmap.width-sx,Math.round(bitmap.width*crop.w))),sh=Math.max(1,Math.min(bitmap.height-sy,Math.round(bitmap.height*crop.h)));
 let scale=enhance?Math.min(3,Math.max(1.4,1700/sw)):Math.min(2.5,Math.max(1,900/sw));
 scale=Math.min(scale,Math.sqrt(MAX_CANVAS_PIXELS/(sw*sh)));
 if(!Number.isFinite(scale)||scale<=0)throw Error('이미지 크기가 너무 큽니다. 작은 영역만 선택해 주세요.');
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:enhance});if(!ctx)throw Error('이미지 처리 공간을 만들 수 없습니다.');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
 if(enhance){const data=ctx.getImageData(0,0,canvas.width,canvas.height),px=data.data;
  let sum=0,n=0;for(let i=0;i<px.length;i+=Math.max(4,Math.floor(px.length/12000/4)*4)){sum+=.299*px[i]+.587*px[i+1]+.114*px[i+2];n++}
  const invert=n>0&&sum/n<112;
  for(let i=0;i<px.length;i+=4){let v=.299*px[i]+.587*px[i+1]+.114*px[i+2];if(invert)v=255-v;v=Math.max(0,Math.min(255,Math.round((v-127)*1.34+127)));px[i]=px[i+1]=px[i+2]=v;px[i+3]=255}
  ctx.putImageData(data,0,0);
 }
 return canvas;
}
async function loadBitmap(file){if(typeof createImageBitmap==='function')return createImageBitmap(file);const blob=URL.createObjectURL(file);try{return await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('이미지를 열 수 없습니다.'));im.src=blob})}finally{URL.revokeObjectURL(blob)}}
function rankOcrText(value,confidence){const raw=String(value||'');const length=raw.replace(/\s/g,'').length;const handleHits=(raw.match(/@[a-zA-Z0-9_]{2,30}/g)||[]).length;
 const replacements=(raw.match(/[�□■]/g)||[]).length;const dateHits=dateFromText(raw).value?1:0;
 return Math.min(length,4000)*.008+handleHits*2.5+dateHits*3+(Number.isFinite(confidence)?confidence*.15:0)-replacements*3;
}
async function performOCR(worker,input,mode='3'){
 try{await worker.setParameters({tessedit_pageseg_mode:String(mode)})}catch(e){console.warn('OCR 페이지 분리 모드를 설정하지 못해 기본 설정으로 실행합니다.',e)}
 return worker.recognize(input)
}
function setSelection(img,rect){img.selection=normalizeCropRect(rect);renderImages()}
async function scanRegion(img){if(state.processing||state.regionRunning){message('이미지 대기열 인식이 끝난 뒤 영역 재인식을 실행하세요.',true);return}if(!img.file||!img.selection){message('이미지에서 읽을 영역을 먼저 드래그하세요.',true);return}
 state.regionRunning=true;try{const bitmap=await loadBitmap(img.file);let canvas;try{canvas=canvasForSource(bitmap,img.selection,{enhance:true})}finally{bitmap.close?.()}
  const worker=await ensureWorker();progress(`${img.name}: 선택 영역을 재인식하는 중…`);
  const result=await performOCR(worker,canvas,6);img.regionRaw=String(result?.data?.text||'').trim();
  renderImages();message(img.regionRaw?'영역 인식 완료. 원본과 비교한 뒤 복사하거나 수동으로 적용해 주세요.':'선택 영역에서 문자를 찾지 못했습니다. 범위를 넓혀 다시 선택해 보세요.');
 }catch(e){message('영역 재인식 실패: '+e.message,true)}finally{state.regionRunning=false;if(state.images.some(x=>x.status==='queued'))processQueue()}}
async function useVariant(img,kind){const value=kind==='enhanced'?img.altRaw:img.baselineRaw;if(typeof value!=='string')return;
 if(state.items.some(it=>it.imageId===img.id&&it.decision==='linked')){message('기존 원글 사용을 취소해야 재분리할 수 있습니다.',true);return}
 if(img.raw!==value&&!confirm('현재 편집한 OCR 원문을 다른 인식 결과로 바꿀까요? 직접 수정한 글자가 덮어써질 수 있습니다.'))return;
 if(state.items.some(it=>it.imageId===img.id&&it.decision!=='registered')&&!confirm('선택한 결과로 게시물을 다시 나누면 미등록 후보의 편집 내용이 교체됩니다. 계속할까요?'))return;
 img.raw=value;reparse(img,{confirmReplace:false});message(kind==='enhanced'?'보정 OCR 결과를 적용했습니다. 원본 캡처와 다시 대조하세요.':'기본 OCR 결과를 적용했습니다. 원본 캡처와 다시 대조하세요.')}
async function ensureWorker(){if(state.worker)return state.worker;if(state.workerLoading)return state.workerLoading;
 state.workerLoading=(async()=>{
  if(!window.Tesseract){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=OCR_SCRIPT;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error('무료 OCR 프로그램을 내려받지 못했습니다. 네트워크 또는 CDN 차단을 확인하세요.'));document.head.appendChild(s)})}
  if(!window.Tesseract?.createWorker)throw Error('OCR 프로그램 초기화에 실패했습니다.');
  progress('무료 OCR 한글·영문 모델을 내려받는 중입니다. 첫 실행은 시간이 걸릴 수 있습니다.');
  state.worker=await Tesseract.createWorker(['kor','eng'],1,{logger:m=>{if(m.status&&state.processing)progress(`브라우저 OCR: ${m.status} ${m.progress?Math.round(m.progress*100)+'%':''}`)}});
  return state.worker;
 })().finally(()=>{state.workerLoading=null});return state.workerLoading}
async function scanImage(img){if(!img.file||state.cancel)return;img.status='scanning';renderImages();try{
 const worker=await ensureWorker();if(state.cancel){img.status='paused';return;}
 progress(`${img.name}: 기본 OCR을 진행하는 중…`);
 const base=await performOCR(worker,img.file,3);
 const baseline=String(base?.data?.text||''),baseConf=Number.isFinite(base?.data?.confidence)?base.data.confidence:null;
 img.baselineRaw=baseline;img.raw=baseline;img.confidence=baseConf;img.altRaw='';img.altConfidence=null;
 if(($('captureMode')?.value||'precise')==='precise'&&!state.cancel){
  try{progress(`${img.name}: 확대·대비 보정본을 추가로 인식하는 중…`);
   const bitmap=await loadBitmap(img.file);let canvas;try{canvas=canvasForSource(bitmap,null,{enhance:true})}finally{bitmap.close?.()}
   const revised=await performOCR(worker,canvas,3);
   img.altRaw=String(revised?.data?.text||'');img.altConfidence=Number.isFinite(revised?.data?.confidence)?revised.data.confidence:null;
   // Accuracy cannot be determined from OCR confidence alone: preserve the original and ask the user to compare.
   img.bestSuggestion=rankOcrText(img.altRaw,img.altConfidence)>rankOcrText(baseline,baseConf)?'enhanced':'basic';
   if(!baseline.trim()&&img.altRaw.trim())img.raw=img.altRaw; // empty baseline: show usable alternative for review
  }catch(e){img.altRaw='';img.altConfidence=null;message(`${img.name}: 보정 인식을 실행하지 못했지만 기본 인식 결과는 유지됩니다. ${e.message}`,true)}
 }
 img.status='done';reparse(img,{confirmReplace:false});
 }catch(e){img.status='error';progress(`인식 실패: ${e.message}. 아래 원문 입력칸에 직접 적을 수도 있습니다.`);message(`인식 오류: ${e.message}`,true)}finally{renderImages()}}
async function processQueue(){if(state.processing||state.regionRunning)return;state.processing=true;state.cancel=false;$('captureCancel').disabled=false;try{while(!state.cancel){const queued=state.images.find(img=>img.status==='queued'&&img.file);if(!queued)break;await scanImage(queued)}}finally{state.processing=false;$('captureCancel').disabled=true;if(state.cancel){for(const img of state.images)if(img.status==='queued')img.status='paused';progress('대기열을 중지했습니다. 이미 인식한 글자는 보존됩니다.')}else progress(`인식 대기열 완료 · 이미지 ${state.images.length}장 · 검토 후보 ${state.items.length}건`);renderAll()}}
async function fileHash(file){if(!window.crypto?.subtle)return `${file.name}:${file.size}:${file.lastModified}`;const buffer=await file.arrayBuffer();const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')}
async function ingestFiles(incoming,source='file'){let accepted=0;if(incoming.length>MAX_FILES)message(`한 번에 ${MAX_FILES}장까지 처리합니다. 나머지는 다시 선택해 주세요.`,true);
 for(const file of incoming.slice(0,MAX_FILES)){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){message(`지원하지 않는 파일: ${file.name}`,true);continue}
  if(file.size>MAX_BYTES){message(`${file.name}은 18MB가 넘어서 건너뜁니다.`,true);continue}
  if(state.images.length>=MAX_TOTAL){message(`브라우저 메모리 보호를 위해 대기열은 최대 ${MAX_TOTAL}장입니다. 검토 초안을 저장한 뒤 대기열을 비우고 다시 진행하세요.`,true);break}
  const hash=await fileHash(file);if(state.images.some(img=>img.hash===hash)){message(`${file.name}: 동일 이미지가 이미 대기열에 있습니다.`);continue}
  const img={id:'i'+(++state.seq),name:file.name,file,hash,url:URL.createObjectURL(file),status:'queued',raw:'',baselineRaw:'',altRaw:'',regionRaw:null,confidence:null,altConfidence:null,paddleRaw:'',paddleStatus:'idle',paddleMessage:'',paddleMetrics:null,selection:null,selecting:false};state.images.push(img);accepted++;
 }
 if(accepted){renderAll();message(`${source==='paste'?'클립보드':'이미지'} ${accepted}장 추가됨 · 현재 ${state.images.length}장. 순서대로 인식합니다.`);processQueue()}
}
function addFiles(files,source='file'){
 const incoming=Array.from(files||[]);if(!incoming.length)return state.ingestChain;
 // Queue image ingestion, including hashing, to prevent races across rapid Ctrl+V events.
 state.ingestChain=state.ingestChain.catch(()=>{}).then(()=>ingestFiles(incoming,source)).catch(e=>message('이미지 추가 실패: '+e.message,true));
 return state.ingestChain;
}
function updateItemField(it,key,value){
 if(!it||it.decision==='registered'||it.decision==='linked')return;
 if(key==='dateReview'&&it.dateBasis==='parent-plus-5'&&!value){
  it.dateReview=true;message('원글 +5분은 임시 시각입니다. 실제 시간을 확인해 날짜를 직접 수정한 후 체크를 해제하세요.',true);return;
 }
 if(key==='dateReview'||key==='allowDistinct')it[key]=!!value;else it[key]=String(value);
 if(key==='handle'){const acct=getAccountByHandle(value);it.accountId=acct?.id||''}
 if(key==='accountId'&&value){const acct=getAccountById(value);if(acct){it.handle=acct.handle;it.name=acct.name}}
 if(key==='type'&&value!=='reply'&&it.dateBasis==='parent-plus-5'){
  // An estimated reply time cannot survive a switch to a different post type.
  it.date='';it.dateBasis='missing';it.dateReview=true;
 }
 if(key==='date'){
  it.dateBasis='manual';if(it.date)it.dateReview=true;
 }
 if(key==='parentId'&&it.type==='reply'&&value){
  const parent=getPostById(value);
  if(['missing','visible-date','parent-plus-5'].includes(it.dateBasis)){
   const suggested=xAddFiveMinutesToStoredPost(parent);
   if(suggested&&(!it.date||it.dateBasis==='parent-plus-5'||it.date.slice(0,10)===suggested.slice(0,10))){
    it.date=suggested;it.dateBasis='parent-plus-5';it.dateReview=true;
    it.reason='선택한 기존 원글의 작성 시각 +5분으로 자동 입력한 임시 시각입니다. 실제 답글 작성 시간을 확인하세요.';
   }
  }
 }
 if(key==='content'||key==='date'||key==='handle'||key==='accountId')it.allowDistinct=false;
}
async function useExistingOriginal(it,postId){
 if(!it||it.saving||it.type!=='original'||it.decision!=='pending')return;
 it.saving=true;renderItems();
 try{
  state.db=await api('admin-data'); // Re-check against current DB at confirmation time.
  const hit=reusableOriginalHits(it).find(h=>String(h.post.id)===String(postId));
  if(!hit){message('선택한 기존 원글이 없어졌거나 유사도·작성자 조건이 달라졌습니다. 목록을 새로 확인하세요.',true);return}
  const p=hit.post,a=getAccountById(p.account_id);
  const replies=state.items.filter(x=>x.imageId===it.imageId&&x.type==='reply'&&x.decision!=='registered').length;
  if(!confirm(`이 게시물이 OCR 원글과 같은 글인지 확인해 주세요.\n\n기존 작성자: @${a?.handle||'unknown'}\n유사도: ${Math.round(hit.score*100)}%\n기존 날짜: ${p.posted_at||'날짜 미상'}\n본문: ${String(p.content||'').slice(0,300)}\n\n[확인]을 누르면 OCR 원글은 새로 등록하지 않습니다.\n같은 이미지의 답글 ${replies}건에는 선택 버튼만 제시되며, 연결은 자동 확정하지 않습니다.`))return;
  it.decision='linked';it.linkedPostId=String(p.id);it.allowDistinct=false;
  renderAll();message('기존 원글을 재사용하도록 표시했습니다. 각 답글 카드에서 부모 게시물을 직접 선택해 주세요.');
 }catch(e){message('기존 원글 연결 검사 실패: '+e.message,true)}finally{it.saving=false;renderItems()}
}
function chooseExistingParent(it,postId){
 if(!it||it.type!=='reply'||it.decision==='registered'||it.decision==='linked')return;
 const eligible=linkedOriginalsForReply(it).find(x=>String(x.post.id)===String(postId));
 if(!eligible){message('이 캡처에서 확인된 기존 원글이 아닙니다. 목록을 다시 확인하세요.',true);return}
 const p=eligible.post;
 if(!confirm(`답글 대상 원글을 이 게시물로 연결할까요?\n\n${savedPostLabel(p)}\n${String(p.content||'').slice(0,300)}\n\n실제 캡처의 답글 관계를 확인했을 때만 진행하세요.`))return;
 updateItemField(it,'parentId',String(p.id));renderItems();message('답글 대상 원글을 연결했습니다. 본문과 임시 날짜를 확인한 뒤 답글만 등록하세요.');
}
function undoExistingOriginal(it){
 if(!it||it.decision!=='linked')return;
 if(!confirm('기존 원글 재사용을 취소할까요? 이미 선택한 답글의 부모 게시물은 그대로 유지됩니다.'))return;
 it.decision='pending';it.linkedPostId='';renderAll();message('기존 원글 재사용이 취소됐습니다. 원글을 다시 검토해 주세요.');
}
async function createAccount(it){const name=it.name.trim(),handle=normHandle(it.handle);if(!name||!handleValid(handle)){message('닉네임과 올바른 @아이디를 먼저 입력하세요.',true);return}const old=getAccountByHandle(handle);if(old){it.accountId=old.id;it.name=old.name;it.handle=old.handle;renderItems();message('기존 계정을 연결했습니다.');return}
 if(!confirm(`새 계정을 등록할까요?\n\n닉네임: ${name}\n아이디: @${handle}\n\n캡처 원본과 비교한 후 확인을 누르세요.`))return;
 try{await api('accounts',{name,handle,bio:''});state.db=await api('admin-data');const a=getAccountByHandle(handle);it.accountId=a?.id||'';renderItems();message(`@${handle} 계정을 등록했습니다.`)}catch(e){message('계정 등록 실패: '+e.message,true)}}
function reviewError(it){if(it.decision!=='pending')return '보류·제외 항목은 검토 대기로 되돌려야 등록할 수 있습니다.';const acct=getAccountById(it.accountId)||getAccountByHandle(it.handle);if(!acct)return '작성자를 PIA 계정과 연결하거나 새 계정을 먼저 등록해 주세요.';
 if(!it.content.trim())return '원문 본문이 비어 있습니다.';if(it.content.length>10000)return '본문이 너무 깁니다.';
 if(!it.date||Number.isNaN(Date.parse(localeTime(it.date))))return '원본 날짜를 확인해 주세요. 자동으로 오늘 날짜를 넣지 않습니다.';
 if(it.dateBasis==='parent-plus-5'&&!it.dateReview)return '원글 +5분은 임시 시각입니다. 날짜수정필요 체크를 유지하세요.';
 if(it.type==='reply'&&!it.parentId)return '답글 대상 원글을 직접 선택해 주세요.';
 if(it.type==='reply'&&!getPostById(it.parentId))return '원글이 DB에 없습니다. 새로고침 후 확인하세요.';
 if(it.type==='quote'&&!it.quotePostId&&(!it.quoteName.trim()||!handleValid(normHandle(it.quoteHandle))||!it.quoteContent.trim()))return '인용 원문의 닉네임·아이디·본문 또는 기존 게시물을 확인해 주세요.';
 if(it.type==='quote'&&it.quotePostId&&!getPostById(it.quotePostId))return '인용 원본 글을 다시 선택해 주세요.';
 if(it.type==='original'&&reusableOriginalHits(it).length&&!it.allowDistinct)return '90% 이상 유사한 기존 원글이 있습니다. 기존 원글을 재사용하거나, 서로 다른 게시물인 근거를 확인하고 체크해 주세요.';
 if(duplicateHits(it).some(h=>h.exact)&&!it.allowDistinct)return '동일 작성자의 동일 본문이 있습니다. 별개 게시물인지 날짜와 원문을 확인한 뒤 체크해 주세요.';
 return ''}
async function saveItem(it){if(it.saving||it.decision==='registered'||it.decision==='linked')return;
 // Latest DB must be considered before writing (another admin may have saved during review).
 it.saving=true;renderItems();try{
  state.db=await api('admin-data');const error=reviewError(it);if(error){message(error,true);return}
  const acct=getAccountById(it.accountId)||getAccountByHandle(it.handle);
  const hits=duplicateHits(it);
  if(hits.length&&!confirm(`유사하거나 같은 게시물 ${hits.length}건이 있습니다.\n\n원본과 날짜를 대조했고, 서로 다른 게시물인 것을 확인했다면 계속하세요.\n실제 같은 글이면 취소해 주세요.`))return;
  if(!confirm(`다음 게시물을 PIA에 등록할까요?\n\n작성자: @${acct.handle}\n종류: ${{original:'일반 글',reply:'답글',quote:'인용'}[it.type]}\n날짜: ${it.date} (KST)${it.dateReview?' · 날짜수정필요':''}\n본문: ${it.content.slice(0,150)}${it.content.length>150?'…':''}`))return;
  const payload={account_id:acct.id,content:it.content,posted_at:localeTime(it.date),date_needs_review:it.dateBasis==='parent-plus-5'||!!it.dateReview,parent_id:it.type==='reply'?it.parentId:null,quote_post_id:it.type==='quote'?(it.quotePostId||null):null,quote_name:it.type==='quote'?it.quoteName.trim():'',quote_handle:it.type==='quote'?normHandle(it.quoteHandle):'',quote_content:it.type==='quote'?it.quoteContent:'',quote_posted_at:it.type==='quote'&&it.quoteDate?localeTime(it.quoteDate):null};
  const out=await api('posts',payload);it.decision='registered';it.resultId=out.id||'';state.db=await api('admin-data');renderAll();message('등록 완료. 원본 캡처는 서버에 업로드되지 않았습니다.');
  if(typeof BroadcastChannel==='function'){const bc=new BroadcastChannel('pia-posts-sync');bc.postMessage('posts-changed');bc.close()}
 }catch(e){message('게시물 저장 실패: '+e.message,true)}finally{it.saving=false;renderItems()}}
function deleteImg(img){if(!img)return;if(img.status==='scanning'){message('현재 인식 중인 이미지는 완료 후 제거할 수 있습니다.',true);return}if(state.items.some(it=>it.imageId===img.id&&it.decision==='registered')){if(!confirm('등록된 게시물은 DB에 유지됩니다. 이미지와 검토 기록만 제거할까요?'))return}
 if(img.url)URL.revokeObjectURL(img.url);state.images=state.images.filter(i=>i.id!==img.id);state.items=state.items.filter(it=>it.imageId!==img.id);renderAll()}
function saveDraft(){const draft={format:'pia-capture-draft-v1',created_at:new Date().toISOString(),images:state.images.map(({id,name,hash,status,raw,baselineRaw,altRaw,confidence,altConfidence,regionRaw,paddleRaw,paddleStatus,paddleMessage,paddleMetrics})=>({id,name,hash,status:'manual',raw,baselineRaw,altRaw,confidence,altConfidence,regionRaw,paddleRaw:paddleStatus==='ready'?paddleRaw:'',paddleStatus:paddleStatus==='ready'?'ready':'idle',paddleMessage:paddleStatus==='ready'?paddleMessage:'',paddleMetrics:paddleStatus==='ready'?paddleMetrics:null})),items:state.items.map(it=>{const {saving,checking,...rest}=it;return rest})};const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='pia-capture-review-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);message('검토 초안 저장 완료. 원본 이미지는 JSON에 포함되지 않습니다.')}
async function loadDraft(file){try{if(state.processing)throw Error('현재 이미지 인식 중입니다. 대기열을 중지하고 다시 시도해 주세요.');const body=JSON.parse(await file.text());if(body.format!=='pia-capture-draft-v1'||!Array.isArray(body.images)||!Array.isArray(body.items))throw Error('PIA 캡처 초안 형식이 아닙니다.');if(body.items.length>3000||body.images.length>3000)throw Error('너무 많은 기록입니다.');if((state.images.length||state.items.length)&&!confirm('현재 미등록 검토 대기열을 모두 교체할까요? DB의 기존 등록 글은 삭제되지 않습니다.'))return;
 for(const img of state.images)if(img.url)URL.revokeObjectURL(img.url);
 state.images=body.images.map((v,i)=>({id:'i'+(i+1),name:charLimit(v.name,200)||'원본 파일',hash:String(v.hash||''),status:'manual',raw:charLimit(v.raw,300000),baselineRaw:charLimit(v.baselineRaw,300000),altRaw:charLimit(v.altRaw,300000),regionRaw:v.regionRaw==null?null:charLimit(v.regionRaw,300000),confidence:Number.isFinite(v.confidence)?v.confidence:null,altConfidence:Number.isFinite(v.altConfidence)?v.altConfidence:null,paddleRaw:charLimit(v.paddleRaw,300000),paddleStatus:v.paddleStatus==='ready'?'ready':'idle',paddleMessage:charLimit(v.paddleMessage,200),paddleMetrics:v.paddleMetrics&&typeof v.paddleMetrics==='object'?v.paddleMetrics:null,selection:null,selecting:false,url:null,file:null}));
 const ids=new Map(body.images.map((v,i)=>[String(v.id),'i'+(i+1)]));
 state.items=body.items.map((v,i)=>({id:'c'+(i+1),imageId:ids.get(String(v.imageId))||state.images[0]?.id||'',sourceName:charLimit(v.sourceName,200),name:charLimit(v.name,100),handle:charLimit(v.handle,30),accountId:String(v.accountId||''),content:charLimit(v.content,10000),date:charLimit(v.date,19),dateBasis:['missing','visible-date','visible-exact','parent-plus-5','manual'].includes(v.dateBasis)?v.dateBasis:(v.date?'manual':'missing'),dateReview:v.dateBasis==='parent-plus-5'||v.dateReview!==false,type:['original','reply','quote'].includes(v.type)?v.type:'original',parentId:String(v.parentId||''),quotePostId:String(v.quotePostId||''),quoteName:charLimit(v.quoteName,100),quoteHandle:charLimit(v.quoteHandle,30),quoteContent:charLimit(v.quoteContent,10000),quoteDate:charLimit(v.quoteDate,19),parentSearch:charLimit(v.parentSearch,120),quoteSearch:charLimit(v.quoteSearch,120),decision:['pending','hold','excluded','registered','linked'].includes(v.decision)?v.decision:'hold',linkedPostId:String(v.linkedPostId||''),manualSeparate:true,checking:false,saving:false,resultId:String(v.resultId||''),reason:charLimit(v.reason,300),allowDistinct:false}));
 for(const it of state.items){if(it.decision==='linked'&&(!it.linkedPostId||!reusableOriginalHits(it).some(h=>String(h.post.id)===String(it.linkedPostId)))){it.decision='hold';it.linkedPostId='';it.reason='초안의 기존 원글 연결 대상을 DB에서 찾지 못했습니다. 다시 확인하세요.'}}
 state.seq=Math.max(state.images.length,state.items.length)+1;renderAll();message('검토 초안을 불러왔습니다. 원본 이미지 미리보기는 다시 선택해야 합니다.');
 }catch(e){message('초안 가져오기 실패: '+e.message,true)}}
// Events
$('captureFiles').addEventListener('change',e=>{addFiles(e.target.files);e.target.value=''})
$('capturePasteButton').addEventListener('click',async()=>{
 try{
  if(!navigator.clipboard?.read)throw Error('이 브라우저에서는 클립보드 읽기 버튼을 지원하지 않습니다. Ctrl+V를 사용해 주세요.');
  const items=await navigator.clipboard.read(),files=[];
  for(const item of items){const kind=item.types.find(t=>['image/png','image/jpeg','image/webp'].includes(t));if(!kind)continue;
   const blob=await item.getType(kind);files.push(new File([blob],`pasted_${Date.now()}_${files.length}.${kind.split('/')[1]==='jpeg'?'jpg':kind.split('/')[1]}`,{type:kind}))
  }
  if(!files.length){message('클립보드에 이미지가 없습니다. 화면을 캡처하거나 이미지를 복사해 주세요.',true);return}
  await addFiles(files,'paste');
 }catch(e){message('클립보드 이미지를 읽지 못했습니다. 페이지에서 Ctrl+V로 다시 시도하세요. '+e.message,true)}
})
const drop=$('captureDrop');drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('captureFiles').click()}});for(const kind of ['dragenter','dragover'])drop.addEventListener(kind,e=>{e.preventDefault();drop.classList.add('dragover')});for(const kind of ['dragleave','drop'])drop.addEventListener(kind,e=>{e.preventDefault();drop.classList.remove('dragover')});drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
document.addEventListener('paste',e=>{if(!state.opened)return;const images=Array.from(e.clipboardData?.items||[]).filter(i=>i.type.startsWith('image/')).map((i,index)=>{const f=i.getAsFile();return f?new File([f],`pasted_${Date.now()}_${index}.png`,{type:f.type}):null}).filter(Boolean);if(images.length){e.preventDefault();addFiles(images,'paste')}})
$('captureCancel').addEventListener('click',()=>{state.cancel=true;message('현재 이미지 인식이 끝나면 대기열을 중지합니다.')});
$('captureSaveDraft').addEventListener('click',saveDraft);
$('captureDraftFile').addEventListener('change',e=>{const file=e.target.files[0];if(file)loadDraft(file);e.target.value=''})
$('captureClear').addEventListener('click',()=>{if(state.processing){message('인식 대기열을 먼저 중지해 주세요.',true);return}if(!confirm('대기열과 검토 기록을 초기화할까요? 이미 PIA DB에 등록된 글은 삭제되지 않습니다.'))return;for(const i of state.images)if(i.url)URL.revokeObjectURL(i.url);state.images=[];state.items=[];renderAll()});
$('captureFilter').addEventListener('change',renderItems);$('captureRefreshDb').addEventListener('click',()=>refreshDb().catch(e=>message(e.message,true)));
$('captureImages').addEventListener('input',e=>{const id=e.target.dataset.imageText,img=state.images.find(x=>x.id===id);if(img)setImageText(img,e.target.value)});
$('captureImages').addEventListener('click',async e=>{const button=e.target.closest('[data-image-action]');if(!button)return;const img=state.images.find(x=>x.id===button.dataset.id);if(!img)return;switch(button.dataset.imageAction){
 case 'remove':deleteImg(img);break;
 case 'parse':reparse(img);break;
 case 'add':state.items.push(newItem(img,{reason:'직접 분리한 게시물입니다. 원본을 확인해 주세요.'}));renderItems();break;
 case 'scan':if(!img.file){message('원본 이미지가 없습니다. 이미지를 다시 추가해 주세요.',true);return}if(state.items.some(it=>it.imageId===img.id&&it.decision!=='registered')&&!confirm('다시 인식하면 이 이미지의 미등록 후보 편집 내용이 사라집니다. 계속할까요?'))return;if(state.processing||state.regionRunning){message('현재 다른 이미지를 인식하는 중입니다.',true);return}img.status='queued';processQueue();break;
 case 'paddle-run':await runPaddleComparison(img);break;
 case 'paddle-copy':await copyPaddleText(img);break;
 case 'paddle-apply':applyPaddleText(img);break;
 case 'use-basic':await useVariant(img,'basic');break;
 case 'use-enhanced':await useVariant(img,'enhanced');break;
 case 'select':img.selecting=!img.selecting;img.selection=null;renderImages();message(img.selecting?'이미지에서 읽을 부분을 드래그해 사각형으로 선택하세요.':'영역 선택을 취소했습니다.');break;
 case 'region':await scanRegion(img);break;
 case 'copy-region':if(img.regionRaw){const ta=$('captureImages').querySelector(`[data-region-result="${img.id}"]`);try{await navigator.clipboard.writeText(ta?.value||img.regionRaw);message('영역 결과를 복사했습니다.')}catch(e){ta?.focus();ta?.select();message('자동 복사가 제한됐습니다. 선택된 텍스트를 Ctrl+C로 복사하세요.',true)}}break;
 case 'append-region':if(!img.regionRaw)return;if(!confirm('선택 영역의 결과를 전체 OCR 끝에 추가할까요? 이미 읽은 문장이 중복될 수 있으므로 원본과 비교해야 합니다.'))return;img.raw=[img.raw,img.regionRaw].filter(Boolean).join('\n');renderImages();message('원문에 추가했습니다. 게시물에 반영하려면 「이 텍스트로 게시물 다시 나누기」를 누르세요.');break;
 }});
// Drag a precise ROI directly on the original image preview; no bytes leave the browser.
$('captureImages').addEventListener('pointerdown',e=>{
 const surface=e.target.closest('[data-crop-image]');if(!surface)return;const img=state.images.find(x=>x.id===surface.dataset.cropImage);if(!img?.selecting||!img.file)return;
 const r=surface.getBoundingClientRect();if(r.width<=0||r.height<=0)return;
 e.preventDefault();const x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
 state.selectionDrag={id:img.id,startX:x,startY:y,pointerId:e.pointerId};surface.setPointerCapture?.(e.pointerId);
 const box=surface.querySelector('.capture-select-box');if(box){box.hidden=false;box.style.cssText=`left:${x*100}%;top:${y*100}%;width:0;height:0;`}
});
$('captureImages').addEventListener('pointermove',e=>{
 const drag=state.selectionDrag;if(!drag||drag.pointerId!==e.pointerId)return;const surface=e.target.closest('[data-crop-image]')||$('captureImages').querySelector(`[data-crop-image="${drag.id}"]`);if(!surface)return;
 const r=surface.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
 const box=surface.querySelector('.capture-select-box');if(box){box.hidden=false;box.style.cssText=`left:${Math.min(x,drag.startX)*100}%;top:${Math.min(y,drag.startY)*100}%;width:${Math.abs(x-drag.startX)*100}%;height:${Math.abs(y-drag.startY)*100}%;`}
});
function finishSelection(e){const drag=state.selectionDrag;if(!drag||drag.pointerId!==e.pointerId)return;state.selectionDrag=null;
 const surface=$('captureImages').querySelector(`[data-crop-image="${drag.id}"]`);if(!surface)return;
 const r=surface.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
 const rect=normalizeCropRect({x:Math.min(x,drag.startX),y:Math.min(y,drag.startY),w:Math.abs(x-drag.startX),h:Math.abs(y-drag.startY)});
 const img=state.images.find(i=>i.id===drag.id);if(!img)return;img.selection=rect;img.selecting=false;
 renderImages();message(rect?'선택한 영역을 정밀 재인식할 수 있습니다.':'영역이 너무 작습니다. 다시 넓게 선택해 주세요.',!rect);
}
$('captureImages').addEventListener('pointerup',finishSelection);
$('captureImages').addEventListener('pointercancel',()=>{state.selectionDrag=null});
$('captureCandidates').addEventListener('input',e=>{const card=e.target.closest('[data-item]'),it=card&&findItem(card.dataset.item),key=e.target.dataset.key;if(!it||!key)return;updateItemField(it,key,e.target.type==='checkbox'?e.target.checked:e.target.value)})
$('captureCandidates').addEventListener('change',e=>{const card=e.target.closest('[data-item]'),it=card&&findItem(card.dataset.item),key=e.target.dataset.key;if(!it||!key)return;updateItemField(it,key,e.target.type==='checkbox'?e.target.checked:e.target.value);if(key==='date'&&it.date){it.reason='날짜를 직접 수정했습니다. 원본 확인 전까지 날짜수정필요를 유지하세요.'}renderItems()})
$('captureCandidates').addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const card=button.closest('[data-item]'),it=card&&findItem(card.dataset.item);if(!it)return;const act=button.dataset.action;
 if(act==='suggest-author'){const h=button.dataset.handle;if(!handleValid(h))return;if(!confirm(`이 게시물의 작성자가 @${h}가 맞나요? 원본 캡처의 작성자 영역을 확인한 경우에만 선택해 주세요.`))return;updateItemField(it,'handle',h);const acct=getAccountByHandle(h);if(acct)it.name=acct.name;renderItems();return}
 if(act==='reuse-existing'){useExistingOriginal(it,button.dataset.postId);return}
 if(act==='choose-parent'){chooseExistingParent(it,button.dataset.postId);return}
 if(act==='undo-reuse'){undoExistingOriginal(it);return}
 if(act==='create-account'){createAccount(it);return}if(act==='save'){saveItem(it);return}
 if(act==='duplicate'){const img=state.images.find(x=>x.id===it.imageId);if(img){state.items.splice(state.items.indexOf(it)+1,0,newItem(img,{name:it.name,handle:it.handle,date:it.date,dateReview:true,reason:'캡처에 함께 있는 다른 게시물입니다. 본문을 입력하세요.'}));renderItems()}return}
 if(['hold','pending','exclude'].includes(act)){it.decision=act==='exclude'?'excluded':act;renderItems();message(act==='exclude'?'이 후보는 등록하지 않습니다. 원본 이미지는 보존됩니다.':act==='hold'?'검토 보류로 변경했습니다.':'검토 대기로 되돌렸습니다.')}});
window.addEventListener('beforeunload',e=>{if(state.items.some(i=>i.decision==='pending'||i.decision==='hold')){e.preventDefault();e.returnValue=''}});
// Pure functions exposed for local regression tests; no server action.
window.PIA_CAPTURE_TEST={reusableOriginalHits,linkedOriginalsForReply,chooseExistingParent,useExistingOriginal,undoExistingOriginal,duplicateHits,reviewError,dateFromText,parseCandidates,xAddFiveMinutesKst,xAddFiveMinutesToStoredPost,updateItemField,normBody,normHandle,similarBody,ocrDiffSummary,normalizeCropRect,rankOcrText,canvasForSource};
auth();
})();
