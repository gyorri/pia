const icons={
 home:'<path d="M3.5 10.8 12 3l8.5 7.8V21h-6v-6.5h-5V21h-6V10.8Z"/>',
 search:'<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.7 3.7-7.5 8-7.5s8 2.8 8 7.5"/>',
 chat:'<path d="M12 3.2c-5.06 0-9 3.34-9 7.62 0 2.25 1.08 4.15 3.13 5.55l-.64 3.35 3.49-1.91c.97.35 2.03.53 3.02.53 5.06 0 9-3.33 9-7.62S17.06 3.2 12 3.2Z"/>',
 repeat:'<path d="M4.5 9.4V7.2c0-1.1.9-2 2-2h12.3"/><path d="m15.2 1.6 3.6 3.6-3.6 3.6"/><path d="M19.5 14.6v2.2c0 1.1-.9 2-2 2H5.2"/><path d="m8.8 22.4-3.6-3.6 3.6-3.6"/>',
 heart:'<path d="M20.4 5.1a5.3 5.3 0 0 0-7.5 0L12 6l-.9-.9a5.3 5.3 0 0 0-7.5 7.5L12 21l8.4-8.4a5.3 5.3 0 0 0 0-7.5Z"/>',
 chart:'<path d="M4.25 20.5v-8.4m5.1 8.4V4.8m5.1 15.7v-11m5.1 11v-6.6"/>',
 bookmark:'<path d="M6.4 3.5h11.2c.55 0 1 .45 1 1v16.15L12 16.7l-6.6 3.95V4.5c0-.55.45-1 1-1Z"/>',
 share:'<path d="M12 15.3V3.1m0 0L8 7.2M12 3.1l4 4.1M5 13.2v5.4c0 1.15.9 2.05 2.05 2.05h9.9c1.15 0 2.05-.9 2.05-2.05v-5.4"/>',
 more:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'
};
const ico=k=>`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k]}</svg>`;
let db={accounts:[],posts:[]};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const account=id=>db.accounts.find(a=>a.id===id)||{id,handle:'unknown',name:'알 수 없는 계정',avatar:''};const av=(a,big=false)=>`<div class="avatar ${big?'bigavatar':''}">${a.avatar?`<img src="${esc(a.avatar)}" alt="">`:'<svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 22c0-9 16-9 16 0"/></svg>'}</div>`;const dt=s=>{if(s==null||!String(s).trim()||/^(nan|invalid date|null|undefined)$/i.test(String(s).trim()))return '날짜 미상';const d=new Date(s);if(Number.isNaN(d.getTime()))return '날짜 미상';const now=new Date(),diff=now.getTime()-d.getTime();if(diff>=0&&diff<60000)return '방금';if(diff>=60000&&diff<3600000)return Math.floor(diff/60000)+'분';if(diff>=3600000&&diff<86400000)return Math.floor(diff/3600000)+'시간';const tz='Asia/Seoul',year=x=>new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric'}).format(x),sameYear=year(d)===year(now);return new Intl.DateTimeFormat('ko-KR',{timeZone:tz,...(sameYear?{}:{year:'numeric'}),month:'numeric',day:'numeric'}).format(d).replace(/\.$/,'')};const piaCompactCount=value=>{if(value==null||value==='')return '';const n=Number(value);if(!Number.isFinite(n)||n<=0)return '';if(n<1000)return String(Math.floor(n));if(n<1000000)return `${Number((n/1000).toFixed(1))}K`;return `${Number((n/1000000).toFixed(1))}M`};
const piaDetailDate=value=>{const d=new Date(value);if(Number.isNaN(d.getTime()))return '날짜 미상';return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(d)};
const pathProfile=a=>'/#/@'+encodeURIComponent(a.handle);const pathPost=p=>'/#/post/'+encodeURIComponent(p.id);const root=document.getElementById('app');function postHtml(p,detailMode=false){
 const detail=detailMode===true;
 const a=account(p.account_id),parent=db.posts.find(x=>x.id===p.parent_id),pa=parent?account(parent.account_id):null;
 const replies=db.posts.filter(x=>x.parent_id===p.id).length;
 const linkedQuote=p.quote_post_id?db.posts.find(x=>String(x.id)===String(p.quote_post_id)):null;
 const qa=linkedQuote?account(linkedQuote.account_id):null;
 const quoteText=linkedQuote?linkedQuote.content:p.quote_content;
 const quoteName=qa?qa.name:p.quote_name,quoteHandle=qa?qa.handle:p.quote_handle;
 const quoteDate=linkedQuote?linkedQuote.posted_at:p.quote_posted_at;
 const quote=quoteText?`<div class="quote-card ${linkedQuote?'quote-card-linked':''}" ${linkedQuote?`role="link" tabindex="0" data-quote-target="${esc(linkedQuote.id)}" aria-label="인용된 게시물 열기"`:''}>
   <div class="quote-card-header"><span class="quote-avatar">${qa?av(qa):ico('user')}</span><strong>${esc(quoteName||'알 수 없는 계정')}</strong><span class="meta">@${esc(quoteHandle||'unknown')}${quoteDate?' · '+dt(quoteDate):''}</span></div>
   <div class="quote-card-content content">${esc(quoteText)}</div></div>`:'';
 const action=(type,icon,count='',attr='',title='')=>`<span class="action-slot"><span class="action action-${type}" ${title?`title="${title}"`:''}${attr}><span class="action-icon">${ico(icon)}</span>${count?`<span class="action-count">${count}</span>`:''}</span></span>`;
 const reply=`<span class="action-slot"><button type="button" class="action action-reply quick-reply" data-reply-id="${esc(p.id)}" title="이 게시물에 답글 등록" aria-label="답글 등록"><span class="action-icon">${ico('chat')}</span>${replies>0?`<span class="action-count">${piaCompactCount(replies)}</span>`:''}</button></span>`;
 const share=`<span class="action-slot"><button type="button" class="action action-share share-post" data-share-id="${esc(p.id)}" title="링크 복사" aria-label="게시물 링크 복사"><span class="action-icon">${ico('share')}</span></button></span>`;
 return `<article class="tweet ${p.parent_id?'is-reply':''}${detail?' tweet-detail':''}" data-post="${esc(p.id)}">
 <a class="tweet-avatar-link" href="${pathProfile(a)}">${av(a)}</a>
 <div class="twbody"><div class="twhead"><a class="name" href="${pathProfile(a)}">${esc(a.name)}</a><a class="handle" href="${pathProfile(a)}">@${esc(a.handle)}</a><span class="meta">· ${dt(p.posted_at)}</span>${p.date_needs_review?'<span class="date-review-badge" title="임시 날짜입니다. 실제 작성일 확인 필요">날짜수정필요</span>':''}<button type="button" class="tweet-more manage-post" data-manage-id="${esc(p.id)}" aria-label="게시물 관리" title="게시물 관리">${ico('more')}</button></div>
 ${pa?`<div class="replyto"><a href="${pathProfile(pa)}">@${esc(pa.handle)}</a> 님에게 보내는 답글</div>`:''}
 <div class="content">${esc(p.content)}</div>${quote}
 ${detail?`<div class="detail-time">${esc(piaDetailDate(p.posted_at))}</div>`:''}
 <div class="actions" aria-label="게시물 정보">
 ${reply}
 ${action('repeat','repeat',piaCompactCount(p.repost_count),'','재게시')}
 ${action('heart','heart',piaCompactCount(p.like_count),'','좋아요')}
 ${action('view','chart',piaCompactCount(p.view_count),'','조회수')}
 ${action('bookmark','bookmark','','','북마크')}
 ${share}</div></div></article>`;
}
function shell(title,content,mode=""){root.innerHTML=`<div class="shell"><aside class="left"><a class="logo" href="/" aria-label="X 홈">𝕏</a><nav class="nav"><a href="/" data-nav="home" aria-label="홈 타임라인">${ico('home')}<span>홈</span></a><a href="/#/search" data-nav="search" aria-label="게시물 검색">${ico('search')}<span>탐색하기</span></a><a href="/#/accounts" data-nav="accounts" aria-label="전체 계정">${ico('user')}<span>계정</span></a><a href="/admin.html" data-nav="admin" aria-label="관리자">${ico('more')}<span>관리자</span></a></nav><button type="button" class="postbtn" data-compose-new>게시하기</button></aside><main class="center"><header class="top"><div class="top-title ${title==='홈'?'home-title':''}">${title==='홈'?'':'<a class="top-back" href="/" aria-label="홈으로 돌아가기"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M5 12h14"/></svg></a>'}<span>${title==='홈'?'𝕏':esc(/^(nan|undefined|null)$/i.test(String(title).trim())?'계정 정보 없음':title)}</span></div>${title==='홈'?'<div class="home-tabs"><span class="home-tab">추천</span><span class="home-tab active">팔로잉</span></div>':''}</header>${content}</main><aside class="right"><input class="search" id="q" placeholder="검색" aria-label="게시물 검색"><div class="panel"><h3>계정 둘러보기</h3>${db.accounts.slice(0,8).map(a=>`<a class="side-account" href="${pathProfile(a)}">${av(a)}<span><b>${esc(a.name)}</b><small>@${esc(a.handle)}</small></span></a>`).join('')}</div></aside></div>`;root.querySelectorAll('[data-post]').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('a,button'))return;location.hash='/post/'+encodeURIComponent(el.dataset.post)}));root.querySelectorAll('[data-quote-target]').forEach(el=>{
  const openQuote=()=>{location.hash='/post/'+encodeURIComponent(el.dataset.quoteTarget)};
  el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openQuote()});
  el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();openQuote()}});
});
const searchField=root.querySelector('#mainSearch');
searchField?.addEventListener('keydown',e=>{if(e.key==='Enter'){const params=new URLSearchParams({q:searchField.value});location.hash='/search?'+params.toString()}});
const section=location.hash.startsWith('#/search')?'search':location.hash.startsWith('#/accounts')?'accounts':location.hash.startsWith('#/@')?'accounts':'home';root.querySelector("[data-nav=\""+section+"\"]")?.setAttribute('aria-current','page');let q=document.getElementById('q');q?.addEventListener('keydown',e=>{if(e.key==='Enter')location.hash='/search?q='+encodeURIComponent(q.value)})}
function render(){let hash=decodeURIComponent(location.hash.slice(1)||'/');let profile=hash.match(/^\/@([^/?]+)/),post=hash.match(/^\/post\/([^/?]+)/);if(profile){let a=db.accounts.find(x=>x.handle===profile[1]);if(!a)return shell('계정 없음','<div class="empty">계정을 찾을 수 없습니다.</div>');let tab=new URLSearchParams(hash.split('?')[1]||'').get('tab')||'posts';let posts=db.posts.filter(p=>p.account_id===a.id&&(tab==='replies'?!!p.parent_id:tab==='posts'?!p.parent_id:true)).sort((x,y)=>new Date(y.posted_at)-new Date(x.posted_at));return shell(a.name,`<div class="cover"></div><div class="profile">${av(a,true)}<button type="button" class="profile-compose" data-compose-account="${esc(a.id)}">이 계정으로 게시물 작성</button><h2 style="margin:12px 0 0">${esc(a.name)}</h2><div class="handle">@${esc(a.handle)}</div><div class="bio">${esc(a.bio||'')}</div></div><div class="tabs">${[['posts','게시물'],['replies','답글'],['all','전체']].map(([id,t])=>`<button class="${tab===id?'active':''}" data-tab="${id}">${t}</button>`).join('')}</div>${posts.length?posts.map(postHtml).join(''):'<div class="empty">등록된 게시물이 없습니다.</div>'}`),root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{location.hash='/@'+encodeURIComponent(a.handle)+'?tab='+b.dataset.tab})}if(post){let p=db.posts.find(x=>x.id===post[1]);if(!p)return shell('게시물','<div class="empty">게시물을 찾을 수 없습니다.</div>');let ancestors=[],cur=p,seen=new Set([p.id]);while(cur.parent_id&&ancestors.length<30){let x=db.posts.find(z=>z.id===cur.parent_id);if(!x||seen.has(x.id))break;ancestors.unshift(x);seen.add(x.id);cur=x}let desc=[];function addReplies(id,depth=0){if(depth>30)return;db.posts.filter(x=>x.parent_id===id&&!seen.has(x.id)).sort((a,b)=>new Date(a.posted_at)-new Date(b.posted_at)).forEach(x=>{seen.add(x.id);desc.push(x);addReplies(x.id,depth+1)})}addReplies(p.id);return shell('게시물','<div class="thread">'+ancestors.map(x=>'<div class="thread-ancestor">'+postHtml(x)+'</div>').join('')+'<div class="thread-focus">'+postHtml(p,true)+'</div>'+ (desc.length?'<div class="thread-divider">답글</div>':'')+desc.map(x=>'<div class="thread-descendant">'+postHtml(x)+'</div>').join('')+'</div>')}if(hash==='/accounts'){return shell('계정',db.accounts.length?'<div class="account-directory">'+db.accounts.map(a=>`<a class="account-directory-item" href="${pathProfile(a)}">${av(a)}<span><strong>${esc(a.name)}</strong><small>@${esc(a.handle)}</small></span></a>`).join('')+'</div>':'<div class="empty">등록된 계정이 없습니다.</div>')}if(hash.startsWith('/search')){let q=new URLSearchParams(hash.split('?')[1]||'').get('q')||'';return shell('검색',`<div class="pia-search-bar"><span class="pia-search-icon">${ico('search')}</span><input class="search" id="mainSearch" type="search" placeholder="게시물 검색" value="${esc(q)}" aria-label="게시물 내용 검색"></div>`+db.posts.filter(p=>p.content.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>Date.parse(b.posted_at)-Date.parse(a.posted_at)).map(postHtml).join(''))}let posts=db.posts.filter(p=>!p.parent_id).sort((a,b)=>{const at=Date.parse(a.posted_at),bt=Date.parse(b.posted_at);return (Number.isFinite(bt)?bt:-Infinity)-(Number.isFinite(at)?at:-Infinity)||String(b.id).localeCompare(String(a.id))});return shell('홈',posts.length?posts.map(postHtml).join(''):'<div class="empty">등록된 게시물이 없습니다.</div>')};// Search and timelines must not reuse snapshots from before a post was deleted in another tab.
let piaDataSeq=0,piaLastDataRefresh=0;
const piaIsSearchRoute=()=>decodeURIComponent(location.hash.slice(1)||'/').startsWith('/search');
async function piaLoadFresh({loading=false,throwOnError=false}={}){
  const seq=++piaDataSeq;
  if(loading&&piaIsSearchRoute())shell('검색','<div class="empty">최신 검색 결과를 불러오는 중…</div>');
  try{
    const response=await fetch('/api/data',{cache:'no-store'});
    if(!response.ok)throw Error('게시물 목록을 새로 불러오지 못했습니다.');
    const fresh=await response.json();
    if(seq!==piaDataSeq)return false;
    db=fresh;piaLastDataRefresh=Date.now();render();return true;
  }catch(err){
    if(seq===piaDataSeq&&loading&&piaIsSearchRoute())shell('검색','<div class="empty">검색 결과를 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.</div>');
    if(throwOnError)throw err;
    return false;
  }
}
window.addEventListener('hashchange',()=>{
  if(piaIsSearchRoute())piaLoadFresh({loading:true});
  else render();
});
function piaRefreshIfStale(){
  if(document.hidden||Date.now()-piaLastDataRefresh<800)return;
  piaLoadFresh({loading:piaIsSearchRoute()});
}
window.addEventListener('focus',piaRefreshIfStale);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)piaRefreshIfStale()});
const piaPublicUpdates=typeof BroadcastChannel==='function'?new BroadcastChannel('pia-posts-sync'):null;
function piaNotifyPublicChanged(){piaPublicUpdates?.postMessage('posts-changed')}
piaPublicUpdates?.addEventListener('message',event=>{
  if(event.data==='posts-changed')piaLoadFresh({loading:piaIsSearchRoute()});
});
piaLoadFresh({loading:piaIsSearchRoute()});


// v0.3.1: Authenticated quick composer. Never expose admin-data to non-admin visitors.
let quickAdminAccounts=null,quickAdminPosts=[],quickSaving=false,quickLastAuthor='';
const quickDate=()=>{const d=new Date();return new Date(d.getTime()+9*3600000).toISOString().slice(0,16)};
// Reply composer default only: inherit the parent's calendar date in Korea, not its time.
// Never infer an original timestamp from an invalid or missing parent date.
function quickReplyDefault(parent){
  if(!parent || !parent.posted_at)return quickDate();
  const parsed=new Date(parent.posted_at);
  if(!Number.isFinite(parsed.getTime()))return quickDate();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed);
  const field=type=>parts.find(x=>x.type===type)?.value;
  return `${field('year')}-${field('month')}-${field('day')}T12:00`;
}
function quickClose(){document.getElementById('quickComposer')?.remove();document.body.classList.remove('quick-modal-open')}
async function quickOpen({replyId='',authorId=''}={}){
  quickClose();
  let accounts;
  try{
    const r=await fetch('/api/admin-data',{credentials:'same-origin',cache:'no-store'});
    if(r.status===401){if(confirm('빠른 등록은 관리자 로그인이 필요합니다. 관리자 로그인 화면으로 이동할까요?'))location.href='/admin.html';return}
    const data=await r.json();if(!r.ok)throw Error(data.error||'관리자 데이터를 불러오지 못했습니다.');
    accounts=data.accounts||[];quickAdminAccounts=accounts;quickAdminPosts=data.posts||[];
  }catch(err){alert('빠른 등록을 열 수 없습니다: '+err.message);return}
  if(!accounts.length){alert('먼저 관리자에서 계정을 등록해 주세요.');return}
  const target=db.posts.find(p=>p.id===replyId);
  const targetAccount=target?account(target.account_id):null;
  const selected=authorId||quickLastAuthor||accounts[0].id;
  const overlay=document.createElement('div');overlay.id='quickComposer';overlay.className='quick-overlay';
  overlay.innerHTML=`<section class="quick-dialog" role="dialog" aria-modal="true" aria-labelledby="quickTitle">
    <div class="quick-header"><strong id="quickTitle">${replyId?'답글 빠른 등록':'게시물 빠른 등록'}</strong><button type="button" class="quick-close" aria-label="닫기">✕</button></div>
    ${target?`<div class="quick-target"><span>답글 대상 · ${esc(targetAccount?.name||'알 수 없음')} @${esc(targetAccount?.handle||'')}</span><p>${esc(target.content.slice(0,250))}</p></div>`:''}
    <form id="quickForm"><label for="quickAuthor">작성 계정</label><select id="quickAuthor" required>${accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)} (@${esc(a.handle)})</option>`).join('')}</select>
    <label for="quickContent">${replyId?'답글 내용':'게시물 내용'}</label><textarea id="quickContent" rows="5" maxlength="10000" placeholder="내용을 입력하세요" required></textarea>
    <div id="quickDuplicateToast" class="quick-duplicate-toast" role="status" aria-live="polite" hidden></div>
    <div class="quick-fields"><div><label for="quickTime">원본 작성 날짜·시간</label><input id="quickTime" type="datetime-local" required value="${replyId?quickReplyDefault(target):quickDate()}"></div><div><label for="quickOffset">시간대</label><select id="quickOffset"><option value="+09:00">한국 +09:00</option><option value="+00:00">UTC +00:00</option></select></div></div>
    <div class="quick-footer"><span id="quickMessage" role="status"></span><button type="submit" class="quick-submit">${replyId?'답글 저장':'게시물 저장'}</button></div>
    </form></section>`;
  document.body.append(overlay);document.body.classList.add('quick-modal-open');
  piaBindDatePaste(overlay.querySelector('#quickTime'),overlay.querySelector('#quickMessage'));
  // Search only the selected author’s existing posts. No draft is sent to a server.
  const authorField=overlay.querySelector('#quickAuthor');
  const contentField=overlay.querySelector('#quickContent');
  const duplicateToast=overlay.querySelector('#quickDuplicateToast');
  let duplicateTimer;
  const normalizeText=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  const tightText=s=>normalizeText(s).replace(/\s/g,'');
  const textSimilarity=(a,b)=>{
    if(a===b)return 1;
    if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)/Math.max(a.length,b.length)*.88;
    const tokens=s=>new Set(s.match(/[\p{L}\p{N}_]{2,}/gu)||[]);
    const x=tokens(a),y=tokens(b);let same=0;
    for(const token of x)if(y.has(token))same++;
    return x.size+y.size?2*same/(x.size+y.size):0;
  };
  const checkDuplicates=()=>{
    const raw=contentField.value,normalized=normalizeText(raw),dense=tightText(raw);
    if(dense.length<8){duplicateToast.hidden=true;duplicateToast.replaceChildren();return}
    const matches=quickAdminPosts.filter(p=>String(p.account_id)===String(authorField.value)).map(p=>{
      const exact=tightText(p.content)===dense;
      return {post:p,exact,score:exact?1:textSimilarity(normalized,normalizeText(p.content))};
    }).filter(x=>x.exact||x.score>=.65).sort((a,b)=>b.score-a.score).slice(0,4);
    if(!matches.length){duplicateToast.hidden=true;duplicateToast.replaceChildren();return}
    duplicateToast.hidden=false;
    duplicateToast.innerHTML='<div class="quick-dup-heading">⚠ 같은 작성자의 기존 게시물 '+matches.length+'건 발견</div>'+matches.map(({post,exact})=>
      `<div class="quick-dup-result"><span class="quick-dup-tag">${exact?'본문 일치':'유사 내용'}</span><span class="quick-dup-date">${esc(post.posted_at||'')}</span><p>${esc(String(post.content||'').slice(0,180))}${String(post.content||'').length>180?'…':''}</p><a href="${pathPost(post)}" class="quick-dup-link" target="_blank" rel="noopener">기존 글 보기 ↗</a></div>`
    ).join('')+'<div class="quick-dup-note">중복 확인용 안내이며 저장은 차단하지 않습니다.</div>';
  };
  const scheduleDuplicates=()=>{clearTimeout(duplicateTimer);duplicateTimer=setTimeout(checkDuplicates,280)};
  contentField.addEventListener('input',scheduleDuplicates);
  authorField.addEventListener('change',()=>{clearTimeout(duplicateTimer);checkDuplicates()});
  overlay.querySelector('.quick-close').onclick=quickClose;
  overlay.addEventListener('click',e=>{if(e.target===overlay)quickClose()});
  overlay.querySelector('#quickForm').onsubmit=async e=>{
    e.preventDefault();if(quickSaving)return;
    const author=overlay.querySelector('#quickAuthor').value,content=overlay.querySelector('#quickContent').value;
    const date=overlay.querySelector('#quickTime').value,offset=overlay.querySelector('#quickOffset').value;
    const msg=overlay.querySelector('#quickMessage'),submit=overlay.querySelector('.quick-submit');
    if(!content.trim()||!date){msg.textContent='내용과 작성 시간을 확인해 주세요.';return}
    quickSaving=true;submit.disabled=true;msg.textContent='저장 중…';
    try{
      const r=await fetch('/api/posts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:author,parent_id:replyId||'',content,posted_at:date+offset})});
      const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'저장 실패');
      quickLastAuthor=author;
      const fresh=await fetch('/api/data',{cache:'no-store'});if(!fresh.ok)throw Error('저장되었지만 타임라인을 새로고침하지 못했습니다.');
      db=await fresh.json();quickClose();render();piaNotifyPublicChanged();
      const notice=document.createElement('div');notice.className='quick-toast';notice.textContent=replyId?'답글이 등록되었습니다.':'게시물이 등록되었습니다.';document.body.append(notice);setTimeout(()=>notice.remove(),2600);
    }catch(err){msg.textContent=err.message}finally{quickSaving=false;submit.disabled=false}
  };
  overlay.querySelector('#quickContent').focus();
}
document.addEventListener('click',e=>{
  const reply=e.target.closest('[data-reply-id]');if(reply){e.preventDefault();e.stopPropagation();quickOpen({replyId:reply.dataset.replyId});return}
  const profile=e.target.closest('[data-compose-account]');if(profile){e.preventDefault();quickOpen({authorId:profile.dataset.composeAccount});return}
  if(e.target.closest('[data-compose-new]')){e.preventDefault();quickOpen()}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')quickClose()});

// v0.3.3: Share an archive permalink, not a simulated X engagement action.
document.addEventListener('click',async e=>{const btn=e.target.closest('[data-share-id]');if(!btn)return;e.preventDefault();e.stopPropagation();const url=new URL(pathPost({id:btn.dataset.shareId}),location.origin).href;try{await navigator.clipboard.writeText(url);const toast=document.createElement('div');toast.className='quick-toast';toast.textContent='게시물 링크를 복사했습니다.';document.body.append(toast);setTimeout(()=>toast.remove(),2200)}catch{prompt('게시물 링크',url)}});

// Date paste support for both quick registration and editing.
function piaBindDatePaste(input, feedback){
 if(!input)return;
 input.addEventListener('paste',e=>{
  const raw=e.clipboardData?.getData('text');if(!raw)return;
  const parsed=piaParsePastedDate(raw);
  e.preventDefault();
  if(!parsed){if(feedback)feedback.textContent='날짜 형식을 확인해 주세요. 예: 2026-10-15 14:30';return}
  input.value=parsed;input.dispatchEvent(new Event('change',{bubbles:true}));
  if(feedback)feedback.textContent='날짜가 입력되었습니다. 저장 버튼을 눌러 적용하세요.';
 });
}
// v0.3.8: manage posts only with authenticated admin session.
let piaManageAuthorized=false;
fetch('/api/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{piaManageAuthorized=!!d?.authenticated;document.body.classList.toggle('pia-admin-session',piaManageAuthorized)}).catch(()=>{});
function piaLocalTime(iso){const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`}
// Accept copied Korean/local date strings in the post edit dialog without changing saved data until submit.
function piaParsePastedDate(raw){
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
 const meridiem=s.match(/(오전|오후|AM|PM)/i);
 s=s.replace(/(오전|오후|AM|PM)/ig,'').trim();
 const m=s.match(/^(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\.?\s*(?:T|\s)\s*(\d{1,2}):(\d{2})(?::\d{2})?$/i);
 if(!m)return null;
 let [,y,mo,d,h,mi]=m;let hour=Number(h),minute=Number(mi),month=Number(mo),day=Number(d),year=Number(y);
 if(meridiem){if(hour<1||hour>12)return null;hour=hour%12+(/오후|PM/i.test(meridiem[1])?12:0)}
 if(year<1||month<1||month>12||day<1||hour>23||minute>59)return null;
 const check=new Date(Date.UTC(year,month-1,day));
 if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||check.getUTCDate()!==day)return null;
 return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${mi}`;
}
async function piaRefreshPosts(){await piaLoadFresh({throwOnError:true})}
function piaManageDialog(id){const p=db.posts.find(x=>String(x.id)===String(id));if(!p)return;
 const overlay=document.createElement('div');overlay.className='pia-manage-overlay';
 overlay.innerHTML=`<section class="pia-manage-dialog" role="dialog" aria-modal="true" aria-label="게시물 수정"><div class="pia-manage-head"><strong>게시물 수정</strong><button type="button" data-close aria-label="닫기">✕</button></div><form id="piaManageForm"><label>작성자<select name="account_id" required>${db.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===p.account_id?'selected':''}>${esc(a.name)} (@${esc(a.handle)})</option>`).join('')}</select></label><label>내용<textarea name="content" required maxlength="10000" rows="6">${esc(p.content)}</textarea></label><label>원본 날짜·시간 (한국 시간)<input name="posted_at" type="datetime-local" value="${esc(piaLocalTime(p.posted_at))}" required></label><label class="pia-review-check"><input name="date_needs_review" type="checkbox" ${p.date_needs_review?'checked':''}> 날짜수정필요</label><label>답글 대상<select name="parent_id"><option value="">일반 게시물 (부모 없음)</option>${db.posts.filter(x=>x.id!==p.id).map(x=>`<option value="${esc(x.id)}" ${x.id===p.parent_id?'selected':''}>${esc(account(x.account_id).name)}: ${esc(String(x.content).slice(0,55))}</option>`).join('')}</select></label><p class="pia-manage-note">인용 게시물의 원문 정보는 기존 값을 유지합니다. 인용 원문 수정은 관리자 화면을 이용하세요.</p><div class="pia-manage-actions"><button type="button" class="pia-delete" data-delete>삭제</button><button type="submit" class="pia-save">변경 저장</button></div><p class="pia-manage-message" role="status"></p></form></section>`;
 document.body.append(overlay);const close=()=>overlay.remove();overlay.querySelector('[data-close]').onclick=close;overlay.addEventListener('click',e=>{if(e.target===overlay)close()});const form=overlay.querySelector('form'),msg=overlay.querySelector('.pia-manage-message');let busy=false;
 const dateInput=form.elements.namedItem('posted_at');
 piaBindDatePaste(dateInput,msg);
 const submit=async(method,body)=>{if(busy)return;busy=true;msg.textContent='처리 중…';try{const r=await fetch('/api/posts',{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'요청 실패');await piaRefreshPosts();piaNotifyPublicChanged();close()}catch(e){msg.textContent=e.message||'오류가 발생했습니다.'}finally{busy=false}};
 form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form),parent=String(fd.get('parent_id')||'')||null;if(parent&&p.quote_content){msg.textContent='인용 게시물은 답글 대상으로 연결할 수 없습니다.';return}submit('POST',{id:p.id,account_id:String(fd.get('account_id')),content:String(fd.get('content')),posted_at:String(fd.get('posted_at'))+':00+09:00',parent_id:parent,quote_name:p.quote_name||'',quote_handle:p.quote_handle||'',quote_content:p.quote_content||'',quote_posted_at:p.quote_posted_at||null,quote_post_id:p.quote_post_id||null,date_needs_review:fd.has('date_needs_review')})};
 overlay.querySelector('[data-delete]').onclick=()=>{const children=db.posts.filter(x=>x.parent_id===p.id).length;if(!confirm('이 게시물을 삭제할까요?'+(children?'\n연결된 답글 '+children+'건이 있어 삭제가 실패할 수 있습니다.':'')))return;submit('DELETE',{id:p.id})};
}
document.addEventListener('click',async e=>{const b=e.target.closest('.manage-post');if(!b)return;e.preventDefault();e.stopPropagation();if(!piaManageAuthorized){const r=await fetch('/api/session',{cache:'no-store'}).then(x=>x.json()).catch(()=>null);piaManageAuthorized=!!r?.authenticated;document.body.classList.toggle('pia-admin-session',piaManageAuthorized)}if(!piaManageAuthorized){alert('관리자 로그인 후 수정·삭제할 수 있습니다.');return}piaManageDialog(b.dataset.manageId)});
