import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleWiki} from '../functions/_utils/wiki.js';
import {handleGateRequest} from '../functions/_utils/gate.js';

const db=new DatabaseSync(':memory:');
db.exec(fs.readFileSync(new URL('../migration-v0.3.39-wiki.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}}}}}};
const objects=new Map(), legacy=new Map();
const WIKI_MEDIA_KV={async put(k,v){objects.set(k,v)},async get(k,format){assert.equal(format,'arrayBuffer');return objects.get(k)||null},async delete(k){objects.delete(k)}};
const WIKI_MEDIA={async put(k,v){legacy.set(k,v)},async get(k){return legacy.has(k)?{body:legacy.get(k)}:null},async delete(k){legacy.delete(k)}};
const env={DB,WIKI_MEDIA_KV,WIKI_SESSION_SECRET:'a-random-private-long-signing-secret-0123456789',PIA_ACCESS_PASSWORD:'friends-password-987'};
const origin='https://example.test';
const login=await handleGateRequest(new Request(origin+'/api/gate/login',{method:'POST',headers:{origin},body:JSON.stringify({password:env.PIA_ACCESS_PASSWORD})}),env,async()=>new Response('bad'));
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
const request=(path,options={})=>new Request(origin+'/api/wiki/'+path,{...options,headers:{cookie,...(options.headers||{})}});
async function call(path,options={}){return handleWiki(request(path,options),env,path.split('?')[0])}
let response=await call('session');assert.equal(response.status,200);let json=await response.json();assert.equal(json.mediaReady,true);assert.equal(json.mediaBackend,'kv');
response=await call('doc',{method:'POST',body:JSON.stringify({title:'KV test',blocks:[{type:'text',text:'sample'}]})});assert.equal(response.status,200);const docId=(await response.json()).id;
const payload=new Uint8Array([137,80,78,71,13,10,26,10]);
const form=new FormData();form.append('file',new Blob([payload],{type:'image/png'}),'image.png');
response=await call('assets?docId='+docId,{method:'POST',body:form});assert.equal(response.status,200);const asset=(await response.json()).id;
const row=db.prepare('SELECT object_key,mime_type,size_bytes FROM wiki_assets WHERE id=?').get(asset);
assert.match(row.object_key,/^kv\/wiki\//);assert.equal(row.mime_type,'image/png');assert.equal(row.size_bytes,payload.length);
response=await call('assets/'+asset);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),payload);
response=await handleWiki(new Request(origin+'/api/wiki/assets/'+asset),env,'assets/'+asset);assert.equal(response.status,401);
response=await call('doc/'+docId,{method:'DELETE'});assert.equal(response.status,200);
response=await call('assets/'+asset);assert.equal(response.status,404,'deleted documents cannot leak images');
response=await call('doc/'+docId+'/restore',{method:'POST'});assert.equal(response.status,200);
response=await call('assets/'+asset);assert.equal(response.status,200,'restored documents retain image');
// Legacy R2 objects must remain readable if the old binding is present.
const oldId=crypto.randomUUID(),oldKey='wiki/'+docId+'/'+oldId+'.png';
legacy.set(oldKey,payload.buffer);
db.prepare('INSERT INTO wiki_assets(id,doc_id,object_key,filename,mime_type,size_bytes) VALUES(?,?,?,?,?,?)').run(oldId,docId,oldKey,'old.png','image/png',payload.length);
env.WIKI_MEDIA=WIKI_MEDIA;
response=await call('assets/'+oldId);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),payload);
delete env.WIKI_MEDIA;
response=await call('assets/'+oldId);assert.equal(response.status,503);
response=await call('assets/'+asset);assert.equal(response.status,200);
// No KV binding must prevent uploading, not silently fall back to the public web.
delete env.WIKI_MEDIA_KV;
response=await call('session');json=await response.json();assert.equal(json.mediaReady,false);
response=await call('assets?docId='+docId,{method:'POST',body:form});assert.equal(response.status,503);
response=await call('assets/'+asset);assert.equal(response.status,503);
console.log('PASS: KV upload/read, private access, trash/restore, missing binding, metadata, old R2 compatibility.');
