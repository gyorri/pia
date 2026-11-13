/* PIA single shared-password entry gate. Protect all pages and APIs server-side.
 * Secrets live in Cloudflare, not GitHub. Rotating the password revokes sessions. */
const encoder = new TextEncoder();
const SHARED_ROLE='owner'; // Wiki permissions only; legacy X admin auth remains separate.
const PASSWORD_KEY='PIA_ACCESS_PASSWORD';
const COOKIE_NAME='__Host-pia_gate';
const SESSION_MS=12*60*60*1000;
const REMEMBER_MS=30*24*60*60*1000;
const json = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
function configured(env){
 const secret=env.WIKI_SESSION_SECRET;
 const password=env[PASSWORD_KEY];
 return typeof secret==='string'&&secret.length>=32&&typeof password==='string'&&password.length>=8&&password.length<=128;
}
const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function hmac(secret,message){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(message)))}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function cookie(value,maxAge){return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`}
function getCookie(req){const hit=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-pia_gate=([^;]+)/);return hit?.[1]||null}
async function signature(env,expires){return hmac(env.WIKI_SESSION_SECRET,`gate-v2.${SHARED_ROLE}.${expires}.${env[PASSWORD_KEY]}`)}
export async function readGateRole(req,env){
 if(!configured(env))return null;
 const token=getCookie(req);if(!token)return null;
 const parts=token.split('.');if(parts.length!==3)return null;
 const [role,expires,sig]=parts;
 if(role!==SHARED_ROLE||!/^[0-9]{13}$/.test(expires)||Number(expires)<=Date.now()||Number(expires)>Date.now()+REMEMBER_MS+60000||!/^[0-9a-f]{64}$/.test(sig))return null;
 return equal(sig,await signature(env,expires))?SHARED_ROLE:null;
}
function loginHtml(message=''){
 const messageHtml=message?`<p class="err" role="alert">${message}</p>`:'';
 return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>PIA · 비공개 자료실 입장</title><style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Noto Sans KR",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 20% 10%,#eee9ff 0,transparent 55%),#faf9ff;display:grid;place-items:center;padding:20px;color:#25223e}.card{width:min(100%,418px);background:white;border:1px solid #e9e6f3;box-shadow:0 20px 68px #23204412;border-radius:25px;padding:35px 31px}.logo{height:52px;width:52px;border-radius:16px;background:#6855b8;color:white;font-weight:850;font-size:30px;display:grid;place-items:center;margin-bottom:25px}.eyebrow{color:#7864b5;letter-spacing:.14em;font-size:11px;font-weight:800}h1{font-size:27px;margin:8px 0 10px}p{color:#746f86;font-size:14px;line-height:1.7;margin:0 0 25px}label{display:block;font-weight:700;font-size:13px;margin-bottom:9px}input[type=password]{width:100%;height:50px;border:1px solid #d9d5e8;border-radius:12px;padding:0 15px;font-size:17px;outline:none}input:focus{border-color:#7862d0;box-shadow:0 0 0 3px #e9e3ff}.remember{font-weight:500;color:#625d75;margin:16px 0 23px;display:flex;align-items:center;gap:9px}.remember input{width:17px;height:17px;accent-color:#6651b5}button{width:100%;background:#6450b5;color:white;border:0;border-radius:12px;height:49px;font-weight:800;font-size:15px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.note{font-size:12px;color:#908ba0;text-align:center;margin-top:21px;line-height:1.7}.err{color:#b12e4c;background:#fff0f3;border-radius:10px;padding:12px;font-size:13px;margin:0 0 16px}</style></head><body><main class="card"><div class="logo">P</div><div class="eyebrow">PIA PRIVATE ARCHIVE</div><h1>우리만의 자료실</h1><p>모임 친구들에게 공유한 비밀번호로 입장해 주세요.<br>아이디나 회원가입은 필요하지 않아요.</p>${messageHtml}<form id="gateForm"><label for="password">입장 비밀번호</label><input id="password" type="password" autocomplete="current-password" maxlength="128" required autofocus placeholder="비밀번호 입력"><label class="remember"><input id="remember" type="checkbox" checked>이 기기에서 30일간 입장 유지</label><button id="submit" type="submit">자료실 입장하기 →</button></form><div class="note">입장하면 위키를 함께 읽고 정리할 수 있어요.<br>공용 기기에서는 입장 유지 체크를 해제하세요.</div></main><script>
document.getElementById('gateForm').addEventListener('submit',async e=>{e.preventDefault();const button=document.getElementById('submit');button.disabled=true;const error=document.querySelector('.err');if(error)error.remove();try{const res=await fetch('/api/gate/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value,remember:document.getElementById('remember').checked})});const data=await res.json();if(!res.ok)throw Error(data.error||'입장할 수 없습니다.');const check=await fetch('/api/gate/session',{credentials:'same-origin',cache:'no-store'});if(!check.ok)throw Error('비밀번호는 확인되었지만 로그인 상태가 유지되지 않습니다. 브라우저의 쿠키 설정 또는 배포 구성을 확인해 주세요.');location.replace('/')}catch(err){const p=document.createElement('p');p.className='err';p.setAttribute('role','alert');p.textContent=err.message;document.getElementById('gateForm').before(p);button.disabled=false}});
</script></body></html>`;
}
function page(body,status=200){return new Response(loginHtml(body),{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none';"}})}
function sameOrigin(request){const origin=request.headers.get('origin');return origin===new URL(request.url).origin}
export async function handleGateRequest(request,env,next){
 const {pathname}=new URL(request.url);const method=request.method;
 if(!configured(env)){
  const msg='Cloudflare Production에 PIA_ACCESS_PASSWORD(8자 이상)와 WIKI_SESSION_SECRET을 설정해야 합니다.';
  return pathname.startsWith('/api/')?json({error:msg},503):page(msg,503);
 }
 if(pathname==='/api/gate/login'){
  if(method!=='POST')return json({error:'허용되지 않는 요청입니다.'},405);
  if(!sameOrigin(request))return json({error:'요청 출처를 확인하세요.'},403);
  if(Number(request.headers.get('content-length')||0)>2000)return json({error:'입력 길이를 확인하세요.'},413);
  const body=await request.json().catch(()=>null);
  const password=body?.password;
  if(typeof password!=='string'||password.length>128||password.length===0)return json({error:'비밀번호를 입력하세요.'},400);
  const given=await hmac(env.WIKI_SESSION_SECRET,password);
  const expected=await hmac(env.WIKI_SESSION_SECRET,env[PASSWORD_KEY]);
  if(!equal(given,expected))return json({error:'비밀번호가 올바르지 않습니다.'},401);
  const duration=body.remember===false?SESSION_MS:REMEMBER_MS;
  const expires=String(Date.now()+duration);
  const token=`${SHARED_ROLE}.${expires}.${await signature(env,expires)}`;
  return json({ok:true,role:SHARED_ROLE,roleLabel:'공동 이용'},200,{'set-cookie':cookie(token,Math.ceil(duration/1000))});
 }
 if(pathname==='/api/gate/logout'){
  if(method!=='POST')return json({error:'허용되지 않는 요청입니다.'},405);
  if(!sameOrigin(request))return json({error:'요청 출처를 확인하세요.'},403);
  return json({ok:true},200,{'set-cookie':cookie('',0)});
 }
 const role=await readGateRole(request,env);
 if(pathname==='/api/gate/session')return role?json({authenticated:true,role,label:'공동 이용'}):json({authenticated:false},401);
 if(!role){
  if(pathname.startsWith('/api/'))return json({error:'자료실 입장 비밀번호를 입력해 주세요.'},401);
  if(method!=='GET'&&method!=='HEAD')return new Response('Unauthorized',{status:401,headers:{'cache-control':'no-store'}});
  const accept=request.headers.get('accept')||'';
  if(!accept.includes('text/html')&&pathname!=='/'&&!pathname.endsWith('.html'))return new Response('Unauthorized',{status:401,headers:{'cache-control':'no-store'}});
  return page();
 }
 const response=await next(role);
 // Avoid shared caches serving personalized archive content.
 const headers=new Headers(response.headers);headers.set('cache-control','private, no-store');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
