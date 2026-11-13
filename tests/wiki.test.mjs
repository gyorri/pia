import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {handleWiki} from '../functions/_utils/wiki.js';
import {handleGateRequest,readGateRole} from '../functions/_utils/gate.js';

const db=new DatabaseSync(':memory:');
db.exec(fs.readFileSync(new URL('../migration-v0.3.39-wiki.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:result.changes}}}}}};
const files=new Map();
const WIKI_MEDIA={async put(key,data){files.set(key,new Uint8Array(data))},async get(key){const body=files.get(key);return body?{body}:null},async delete(key){files.delete(key)}};
const env={DB,WIKI_MEDIA,WIKI_SESSION_SECRET:'long-random-secret-for-cookie-signing-0123456789',PIA_ACCESS_PASSWORD:'friends#2026'};
const origin='https://example.test';
let member='';
const gateRequest=(path,options={})=>new Request(origin+path,options);
async function gate(path,opts={},next=async()=>new Response('private',{status:200})) {return handleGateRequest(gateRequest(path,opts),env,next)}
async function login(password,remember=true){const r=await gate('/api/gate/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({password,remember})});return {res:r,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
let r=await gate('/');assert.equal(r.status,200);assert((await r.text()).includes('입장 비밀번호'));
r=await gate('/x.html',{headers:{accept:'text/html'}});assert.equal(r.status,200);assert((await r.text()).includes('입장 비밀번호'));
r=await gate('/app.js');assert.equal(r.status,401);
r=await gate('/api/data');assert.equal(r.status,401);
r=await gate('/api/wiki/data');assert.equal(r.status,401);
r=await gate('/api/gate/login',{method:'POST',body:JSON.stringify({password:env.PIA_ACCESS_PASSWORD})});assert.equal(r.status,403,'cross-origin login posts are blocked');
let bad=await login('incorrect-password');assert.equal(bad.res.status,401);
let a=await login(env.PIA_ACCESS_PASSWORD);assert.equal(a.res.status,200);member=a.cookie;
assert(a.res.headers.get('set-cookie').includes('Max-Age=2592000'));
assert.equal(a.data.role,'owner');
assert.equal(await readGateRole(gateRequest('/',{headers:{cookie:member}}),env),'owner');
a=await login(env.PIA_ACCESS_PASSWORD,false);assert.equal(a.res.status,200);assert(a.res.headers.get('set-cookie').includes('Max-Age=43200'));
assert.equal(await readGateRole(gateRequest('/',{headers:{cookie:a.cookie}}),env),'owner');
async function wiki(path,roleCookie='',method='GET',data=null){const url=origin+'/api/wiki/'+path;const request=new Request(url,{method,headers:roleCookie?{cookie:roleCookie}:{},body:data===null?undefined:JSON.stringify(data)});const res=await handleWiki(request,env,path.split('?')[0]);const payload=await res.json();return {res,payload,status:res.status}}
let result=await wiki('session',member);assert.equal(result.payload.member.role,'owner');assert.equal(result.payload.needsSetup,false);
result=await wiki('data','');assert.equal(result.status,401,'backend must independently authenticate');
result=await wiki('setup',member,'POST',{setupKey:'any'});assert.equal(result.status,404,'old per-user setup is disabled');
result=await wiki('members',member);assert.equal(result.status,404,'old member management is disabled');
result=await wiki('folder','', 'POST',{title:'금지'});assert.equal(result.status,401);
result=await wiki('folder',member,'POST',{title:'SNS 증빙 자료'});assert.equal(result.status,200);const folderId=result.payload.id;
result=await wiki('doc',member,'POST',{folderId,title:'원본 기록',kind:'x',sourceUrl:'https://x.com/example/status/1',blocks:[{type:'text',text:'공개 게시물 원문 요약'}]});assert.equal(result.status,200);const docId=result.payload.id;
result=await wiki('data',member);assert.equal(result.status,200);assert.equal(result.payload.docs.length,1);
result=await wiki('doc/'+docId,member);assert.equal(result.status,200);assert.equal(result.payload.doc.title,'원본 기록');
result=await wiki('doc/'+docId,'','DELETE');assert.equal(result.status,401);
let imgForm=new FormData();imgForm.append('file',new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'}),'sample.jpg');
let req=new Request(origin+'/api/wiki/assets?docId='+docId,{method:'POST',headers:{cookie:member},body:imgForm});let res=await handleWiki(req,env,'assets');let imageResult=await res.json();assert.equal(res.status,200);assert(imageResult.id);
result=await wiki('doc/'+docId,member,'PUT',{title:'원본 기록 수정',kind:'x',status:'needs_review',folderId,sourceUrl:'https://x.com/example/status/1',blocks:[{id:crypto.randomUUID(),type:'text',text:'희귀 단어 테스트'},{id:crypto.randomUUID(),type:'gallery',assetIds:[imageResult.id],caption:'캡처'}],tags:['SNS'],revision:1});assert.equal(result.status,200);assert.equal(result.payload.revision,2);
result=await wiki('doc/'+docId,member,'PUT',{title:'오래된 편집',kind:'x',folderId,revision:1,blocks:[]});assert.equal(result.status,409);
result=await wiki('search?q='+encodeURIComponent('희귀 단어'),member);assert.equal(result.status,200);assert.equal(result.payload.docs.length,1);
result=await wiki('doc/'+docId,member,'DELETE');assert.equal(result.status,200);
result=await wiki('trash','');assert.equal(result.status,401);
result=await wiki('trash',member);assert.equal(result.status,200);assert.equal(result.payload.docs.length,1);
result=await wiki('doc/'+docId+'/restore',member,'POST',{});assert.equal(result.status,200);
result=await wiki('doc/'+docId,member);assert.equal(result.status,200);
let middlewareFollow=0;
r=await gate('/x.html',{headers:{cookie:member}},async()=>{middlewareFollow++;return new Response('X content')});assert.equal(r.status,200);assert.equal(await r.text(),'X content');assert.equal(r.headers.get('cache-control'),'private, no-store');
r=await gate('/api/data',{headers:{cookie:member}},async()=>{middlewareFollow++;return new Response('{"posts":[]}',{headers:{'content-type':'application/json'}})});assert.equal(r.status,200);assert.equal(middlewareFollow,2);
const prior=env.PIA_ACCESS_PASSWORD;env.PIA_ACCESS_PASSWORD='changed-shared-password-abc123';
assert.equal(await readGateRole(gateRequest('/',{headers:{cookie:member}}),env),null,'password rotation must revoke old cookies');env.PIA_ACCESS_PASSWORD=prior;
const logout=await gate('/api/gate/logout',{method:'POST',headers:{origin,cookie:member}});assert.equal(logout.status,200);assert(logout.headers.get('set-cookie').includes('Max-Age=0'));
const noConfig={...env,PIA_ACCESS_PASSWORD:undefined};
r=await handleGateRequest(gateRequest('/api/data'),noConfig,async()=>new Response('unsafe'));assert.equal(r.status,503,'missing secrets must deny, not bypass');
const routes=JSON.parse(fs.readFileSync(new URL('../public/_routes.json',import.meta.url),'utf8'));assert.deepEqual(routes,{version:1,include:['/*'],exclude:[]});
// Missing or weak password must fail closed; no preview or data bypass.
for(const badPassword of ['', '1234567']){ const wrongEnv={...env,PIA_ACCESS_PASSWORD:badPassword};let response=await handleGateRequest(gateRequest('/api/data'),wrongEnv,async()=>new Response('unsafe'));assert.equal(response.status,503);}
console.log('PASS: single-password gate, 30-day/12-hour sessions, X/wiki protection, rotation, CRUD, gallery, search, conflict, trash/restore, fail closed.');
