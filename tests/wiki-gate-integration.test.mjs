import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {onRequest} from '../functions/_middleware.js';
import {handleWiki} from '../functions/_utils/wiki.js';

const db=new DatabaseSync(':memory:');
db.exec(fs.readFileSync(new URL('../migration-v0.3.39-wiki.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}}}}}};
const env={DB,WIKI_SESSION_SECRET:'super-private-signing-secret-random-long-0001',PIA_ACCESS_PASSWORD:'some-strong-shared-password'};
const origin='https://example.test';
async function route(path, {method='GET',cookie='',body=null,headers={}}={}){
  const h={...headers}; if(cookie)h.cookie=cookie;
  if(body!==null)h['content-type']='application/json';
  const request=new Request(origin+path,{method,headers:h,body:body===null?undefined:JSON.stringify(body)});
  let fellThrough=false;
  const response=await onRequest({request,env,next:()=>{fellThrough=true;return new Response('fallback')},data:{}});
  return {response,fellThrough};
}
// Site entrance page is protected until the shared password is supplied.
let x=await route('/');assert.equal(x.response.status,200);assert.match(await x.response.text(),/입장 비밀번호/);
x=await route('/api/wiki/session');assert.equal(x.response.status,401);assert.equal(x.fellThrough,false);
x=await route('/api/wiki/data');assert.equal(x.response.status,401);
// Authenticate using the same path and cookie rules as the production middleware.
x=await route('/api/gate/login',{method:'POST',headers:{origin},body:{password:env.PIA_ACCESS_PASSWORD,remember:true}});
assert.equal(x.response.status,200);const cookie=x.response.headers.get('set-cookie').split(';')[0];assert.match(cookie,/__Host-pia_gate=/);
x=await route('/api/gate/session',{cookie});assert.equal(x.response.status,200);assert.equal((await x.response.json()).authenticated,true);
// Wiki API dispatch happens INSIDE the already verified site gate.
x=await route('/api/wiki/session',{cookie});assert.equal(x.response.status,200);assert.equal(x.fellThrough,false);assert.equal((await x.response.json()).member.role,'owner');
x=await route('/api/wiki/data',{cookie});assert.equal(x.response.status,200);assert.deepEqual((await x.response.json()).docs,[]);
x=await route('/api/wiki/folder',{method:'POST',cookie,body:{title:'테마 A'}});assert.equal(x.response.status,200);const folderId=(await x.response.json()).id;
x=await route('/api/wiki/doc',{method:'POST',cookie,body:{title:'기록 A',folderId,blocks:[{type:'text',text:'memo'}]}});assert.equal(x.response.status,200);
x=await route('/api/wiki/data',{cookie});assert.equal((await x.response.json()).docs.length,1);
// For all other paths the original X/static handling remains delegated to next().
x=await route('/x.html',{cookie});assert.equal(x.response.status,200);assert.equal(x.fellThrough,true);
x=await route('/api/data',{cookie});assert.equal(x.response.status,200);assert.equal(x.fellThrough,true);
// If routing ever reaches the API handler WITHOUT middleware, cookie auth is still mandatory.
const bareReq=new Request(origin+'/api/wiki/session',{headers:{cookie}});
x={response:await handleWiki(bareReq,env,'session')};assert.equal(x.response.status,200);assert.equal((await x.response.json()).member.role,'owner');
x={response:await handleWiki(new Request(origin+'/api/wiki/session'),env,'session')};assert.equal(x.response.status,401);
console.log('PASS: middleware-gate/wiki integrated dispatch, session, CRUD, standalone signed-cookie authorization, X routes unchanged.');
