import {readGateRole} from './gate.js';
/* Private group wiki for Cloudflare Pages Functions + D1 + private R2.
   Shared passwords are verified by the site gate; X admin auth remains separate. */
const j=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const uid=()=>crypto.randomUUID();
const toHex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const enc=new TextEncoder();
const bounded=(value,max=255)=>String(value??'').trim().slice(0,max);
const safeHttpUrl=value=>{const s=bounded(value,2000);if(!s)return '';try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}};
const roles=['owner','editor','viewer'];
const kinds=['general','person','x','instagram','postype','report','chat','link'];
const statuses=['draft','needs_review','source_checked'];
const imageTypes={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
async function hmac(secret,message){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return toHex(await crypto.subtle.sign('HMAC',key,enc.encode(message)))}
async function currentMember(req,env){
 const role=await readGateRole(req,env);
 return role?{id:null,username:'shared_member',display_name:'모임 구성원',role}:null;
}
const publicMember=m=>m?{id:m.id,username:m.username,name:m.display_name,role:m.role}:null;
const readBody=async req=>{if(Number(req.headers.get('content-length')||0)>280000)return null;const txt=await req.text();if(txt.length>280000)return null;try{return JSON.parse(txt)}catch{return null}};
const authError=()=>j({error:'위키 로그인 후 이용할 수 있습니다.'},401);
const permissionError=()=>j({error:'이 작업은 편집 권한이 필요합니다.'},403);
const ownerOnly=member=>member.role==='owner';
const canEdit=member=>member.role==='owner'||member.role==='editor';
const notFound=()=>j({error:'자료를 찾을 수 없습니다.'},404);
function tagsFrom(val){if(!Array.isArray(val))return [];return [...new Set(val.map(x=>bounded(x,30)).filter(Boolean))].slice(0,12)}
function validateBlocks(value){if(!Array.isArray(value)||value.length>160)return null;const out=[];for(const b of value){if(!b||typeof b!=='object')return null;const type=b.type;if(!['text','heading','quote','image','gallery','link','checklist','divider'].includes(type))return null;const id=/^[a-z\d-]{1,80}$/i.test(b.id||'')?b.id:uid();if(type==='text'||type==='heading'||type==='quote')out.push({id,type,text:String(b.text??'').slice(0,15000)});
else if(type==='image'){if(!/^[a-f0-9-]{36}$/.test(b.assetId||''))return null;out.push({id,type,assetId:b.assetId,caption:String(b.caption??'').slice(0,400)})}
else if(type==='gallery'){if(!Array.isArray(b.assetIds)||b.assetIds.length<1||b.assetIds.length>40||b.assetIds.some(x=>!/^\w{8}-[\da-f-]{27,}$/i.test(x)))return null;out.push({id,type,assetIds:[...new Set(b.assetIds)],caption:String(b.caption??'').slice(0,400)})}
else if(type==='link'){const link=safeHttpUrl(b.url);if(b.url&&!link)return null;out.push({id,type,url:link,label:bounded(b.label,250),note:bounded(b.note,1500)})}
else if(type==='checklist'){if(!Array.isArray(b.items)||b.items.length>80)return null;out.push({id,type,items:b.items.map(i=>({text:bounded(i?.text,800),done:i?.done===true}))})}
else out.push({id,type});}return JSON.stringify(out)}
function docPayload(data,existing=false){const title=bounded(data?.title,160);if(!title)return {error:'문서 제목을 입력하세요.'};const kind=kinds.includes(data.kind)?data.kind:'general';const status=statuses.includes(data.status)?data.status:'draft';const source= safeHttpUrl(data.sourceUrl);if(data.sourceUrl&&!source)return {error:'출처 링크는 http(s) 주소만 입력할 수 있습니다.'};const date=bounded(data.eventDate,10);if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return {error:'날짜 형식을 확인하세요.'};const blocks=validateBlocks(data.blocks||[]);if(!blocks||blocks.length>180000)return {error:'본문 블록 형식이나 크기를 확인하세요.'};return {title,kind,status,source,date,tags:JSON.stringify(tagsFrom(data.tags)),blocks,folderId:data.folderId||null,revision:Number(data.revision)}}
async function folderExists(DB,id){if(!id)return true;return !!await DB.prepare('SELECT id FROM wiki_folders WHERE id=?').bind(id).first()}
async function validateAssetRefs(DB,docId,blocks){const ids=[...new Set(JSON.parse(blocks).flatMap(b=>b.type==='image'?[b.assetId]:b.type==='gallery'?b.assetIds:[]))];for(const id of ids){const r=await DB.prepare('SELECT id FROM wiki_assets WHERE id=? AND doc_id=?').bind(id,docId).first();if(!r)return false}return true}
const docRow=d=>({...d,tags:JSON.parse(d.tags_json||'[]'),blocks:JSON.parse(d.blocks_json||'[]')});
export async function handleWiki(request,env,route){
 const method=request.method;
 if(!env.WIKI_SESSION_SECRET)return j({error:'WIKI_SESSION_SECRET 환경변수 설정이 필요합니다.'},503);
 const parts=route.split('/').filter(Boolean);const action=parts[0]||'';
 try{
  if(action==='session'&&method==='GET'){
   const member=await currentMember(request,env);
   return j({member:publicMember(member),needsSetup:false,canSetup:false,mediaReady:!!env.WIKI_MEDIA});
  }
  // Shared roles are authenticated by the global site gate. Legacy user account APIs are disabled.
  if(['setup','login','logout','password','members'].includes(action))return notFound();
  const member=await currentMember(request,env);if(!member)return authError();
  if(action==='search'&&method==='GET'){
   const raw=bounded(new URL(request.url).searchParams.get('q'),100);if(!raw)return j({docs:[]});
   const pattern='%'+raw.toLowerCase().replace(/[\%_]/g,c=>'\\'+c)+'%';
   const r=await env.DB.prepare("SELECT id,folder_id,title,kind,status,source_url,event_date,tags_json,updated_at,revision FROM wiki_docs WHERE deleted_at IS NULL AND (LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(source_url) LIKE ? ESCAPE '\\' OR LOWER(tags_json) LIKE ? ESCAPE '\\' OR LOWER(blocks_json) LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 200").bind(pattern,pattern,pattern,pattern).all();
   return j({docs:r.results.map(d=>({...d,tags:JSON.parse(d.tags_json||'[]')}))});
  }
  if(action==='data'&&method==='GET'){
   const [fr,dr]=await Promise.all([env.DB.prepare('SELECT id,parent_id,title,position,created_at FROM wiki_folders ORDER BY position,created_at').all(),env.DB.prepare(`SELECT d.id,d.folder_id,d.title,d.kind,d.status,d.source_url,d.event_date,d.tags_json,d.revision,d.created_at,d.updated_at,m.display_name AS updated_name FROM wiki_docs d LEFT JOIN wiki_members m ON d.updated_by=m.id WHERE d.deleted_at IS NULL ORDER BY d.updated_at DESC LIMIT 1500`).all()]);
   return j({folders:fr.results,docs:dr.results.map(d=>({...d,tags:JSON.parse(d.tags_json||'[]')})),member:publicMember(member)});
  }
  if(action==='folder'){
   if(method==='POST'){
    if(!canEdit(member))return permissionError();const b=await readBody(request),title=bounded(b?.title,100),parent=b?.parentId||null;if(!title||!await folderExists(env.DB,parent))return j({error:'메뉴 이름 또는 상위 메뉴를 확인하세요.'},400);
    const id=uid();await env.DB.prepare('INSERT INTO wiki_folders(id,parent_id,title,position,created_by) VALUES(?,?,?,?,?)').bind(id,parent,title,Date.now(),member.id).run();return j({id});
   }
   if(parts[1]&&['PATCH','DELETE'].includes(method)){
    if(!canEdit(member))return permissionError();const found=await env.DB.prepare('SELECT * FROM wiki_folders WHERE id=?').bind(parts[1]).first();if(!found)return notFound();
    if(method==='DELETE'){
     const child=await env.DB.prepare('SELECT COUNT(*) AS n FROM wiki_folders WHERE parent_id=?').bind(found.id).first();const docs=await env.DB.prepare('SELECT COUNT(*) AS n FROM wiki_docs WHERE folder_id=?').bind(found.id).first();if(child.n||docs.n)return j({error:'하위 메뉴나 문서가 있는 메뉴는 삭제할 수 없습니다. 먼저 이동해 주세요.'},409);
     await env.DB.prepare('DELETE FROM wiki_folders WHERE id=?').bind(found.id).run();return j({ok:true});
    }
    const b=await readBody(request);if(!b)return j({error:'잘못된 요청입니다.'},400);const title=b.title===undefined?found.title:bounded(b.title,100);let parent=b.parentId===undefined?found.parent_id:(b.parentId||null);
    if(!title||!await folderExists(env.DB,parent))return j({error:'메뉴 이름이나 상위 메뉴를 확인하세요.'},400);
    let walk=parent,n=0;while(walk&&n++<30){if(walk===found.id)return j({error:'자기 메뉴 안으로 이동할 수 없습니다.'},400);const p=await env.DB.prepare('SELECT parent_id FROM wiki_folders WHERE id=?').bind(walk).first();walk=p?.parent_id}
    if(n>=30)return j({error:'메뉴 깊이를 확인하세요.'},400);
    await env.DB.prepare('UPDATE wiki_folders SET title=?,parent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(title,parent,found.id).run();return j({ok:true});
   }
  }
  if(action==='doc'){
   if(method==='POST'&&!parts[1]){
    if(!canEdit(member))return permissionError();const b=await readBody(request);if(!b)return j({error:'잘못된 요청입니다.'},400);const p=docPayload({...b,blocks:b.blocks||[{id:uid(),type:'text',text:''}]});if(p.error)return j({error:p.error},400);if(!await folderExists(env.DB,p.folderId))return j({error:'존재하지 않는 메뉴입니다.'},400);
    const id=uid();await env.DB.prepare(`INSERT INTO wiki_docs(id,folder_id,title,kind,status,source_url,event_date,tags_json,blocks_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,p.folderId,p.title,p.kind,p.status,p.source,p.date,p.tags,p.blocks,member.id,member.id).run();return j({id,revision:1});
   }
   const id=parts[1];if(!id)return notFound();const d=await env.DB.prepare('SELECT * FROM wiki_docs WHERE id=?').bind(id).first();if(!d)return notFound();
   if(method==='GET'){if(d.deleted_at)return notFound();const assets=await env.DB.prepare('SELECT id,filename,mime_type,size_bytes,created_at FROM wiki_assets WHERE doc_id=? ORDER BY created_at').bind(id).all();const owner=await env.DB.prepare('SELECT display_name FROM wiki_members WHERE id=?').bind(d.updated_by).first();return j({doc:{...docRow(d),updated_name:owner?.display_name||'공동 작성'},assets:assets.results})}
   if(method==='PUT'){
    if(!canEdit(member))return permissionError();if(d.deleted_at)return notFound();const b=await readBody(request);if(!b)return j({error:'잘못된 요청입니다.'},400);const p=docPayload(b,true);if(p.error)return j({error:p.error},400);if(!Number.isInteger(p.revision)||p.revision<1)return j({error:'문서 버전이 필요합니다.'},400);
    if(!await folderExists(env.DB,p.folderId))return j({error:'메뉴가 존재하지 않습니다.'},400);if(!await validateAssetRefs(env.DB,id,p.blocks))return j({error:'다른 문서의 이미지가 포함되어 있습니다.'},400);
    const result=await env.DB.prepare(`UPDATE wiki_docs SET folder_id=?,title=?,kind=?,status=?,source_url=?,event_date=?,tags_json=?,blocks_json=?,updated_by=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND deleted_at IS NULL`).bind(p.folderId,p.title,p.kind,p.status,p.source,p.date,p.tags,p.blocks,member.id,id,p.revision).run();if(!result.meta.changes)return j({error:'다른 친구가 먼저 수정했습니다. 내용을 복사한 뒤 최신 문서를 확인해 주세요.',conflict:true},409);return j({ok:true,revision:p.revision+1});
   }
   if(method==='DELETE'){
    if(!canEdit(member))return permissionError();await env.DB.prepare('UPDATE wiki_docs SET deleted_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL').bind(member.id,id).run();return j({ok:true});
   }
   if(method==='POST'&&parts[2]==='restore'){
    if(!ownerOnly(member))return permissionError();await env.DB.prepare('UPDATE wiki_docs SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();return j({ok:true});
   }
  }
  if(action==='trash'&&method==='GET'){
   if(!ownerOnly(member))return permissionError();const r=await env.DB.prepare('SELECT id,title,deleted_at FROM wiki_docs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100').all();return j({docs:r.results});
  }
  if(action==='assets'){
   if(!env.WIKI_MEDIA)return j({error:'WIKI_MEDIA(R2 버킷) 바인딩이 필요합니다.'},503);
   if(method==='POST'){
    if(!canEdit(member))return permissionError();const id=bounded(new URL(request.url).searchParams.get('docId'),80);const d=await env.DB.prepare('SELECT id FROM wiki_docs WHERE id=? AND deleted_at IS NULL').bind(id).first();if(!d)return notFound();
    if(Number(request.headers.get('content-length')||0)>11*1024*1024)return j({error:'이미지는 한 장에 최대 10MB까지 가능합니다.'},413);
    const data=await request.formData().catch(()=>null),file=data?.get('file');if(!file||typeof file.arrayBuffer!=='function')return j({error:'이미지 파일을 선택하세요.'},400);
    const extension=imageTypes[file.type];if(!extension)return j({error:'JPG, PNG, WebP, GIF만 지원합니다. HEIC는 JPG로 변환해 주세요.'},415);
    if(file.size>10*1024*1024||file.size===0)return j({error:'이미지는 한 장에 최대 10MB까지 가능합니다.'},413);
    const fileId=uid(),key=`wiki/${id}/${fileId}.${extension}`;
    await env.WIKI_MEDIA.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
    try{await env.DB.prepare('INSERT INTO wiki_assets(id,doc_id,object_key,filename,mime_type,size_bytes,created_by) VALUES(?,?,?,?,?,?,?)').bind(fileId,id,key,bounded(file.name||'image',200),file.type,file.size,member.id).run()}catch(e){await env.WIKI_MEDIA.delete(key);throw e}
    return j({id:fileId,url:`/api/wiki/assets/${fileId}`,name:bounded(file.name||'image',200)});
   }
   if(method==='GET'&&parts[1]){
    const a=await env.DB.prepare('SELECT a.object_key,a.mime_type FROM wiki_assets a JOIN wiki_docs d ON a.doc_id=d.id WHERE a.id=? AND d.deleted_at IS NULL').bind(parts[1]).first();if(!a)return notFound();const obj=await env.WIKI_MEDIA.get(a.object_key);if(!obj)return notFound();return new Response(obj.body,{headers:{'content-type':a.mime_type,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}})
   }
  }
  return j({error:'위키 요청을 찾을 수 없습니다.'},404);
 }catch(error){console.error('wiki api error',error);return j({error:'위키 요청을 처리하지 못했습니다. 데이터베이스 마이그레이션과 설정을 확인하세요.'},500)}
}
